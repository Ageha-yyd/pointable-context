import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { performance } from "node:perf_hooks";
import type {
  ActivationIssueResult,
  ActivationTicket,
  AuthorityResult,
  AuthoritativeProvider,
  BlockReason,
  CandidateMatch,
  ContextBindingPort,
  ContextBindingResult,
  ContextIndexPort,
  ContextScopeRef,
  ExplicitLookupIntent,
  HostContext,
  LookupOutcome,
  ResolvedCandidate,
  SelectionInput,
  TrustedContextBinding,
} from "./contracts.js";
import {
  contextScopeTuple,
  isContextScopeKind,
  sameContextScope,
} from "./context-scope.js";
import { evaluateEligibility } from "./eligibility.js";
import { resolveSelection } from "./resolver.js";
import { renderLookupOutcome } from "./text-renderer.js";
import {
  ContractError,
  IdentityMismatchError,
  validateAuthorityVerification,
  validateContextIndexForRuntime,
  validateSnapshotForCandidate,
} from "./validation.js";

function blocked(reason: BlockReason): LookupOutcome {
  const outcome: LookupOutcome = { kind: "blocked", reason, fallbackText: "" };
  outcome.fallbackText = renderLookupOutcome(outcome);
  return outcome;
}

function noMatch(): LookupOutcome {
  const outcome: LookupOutcome = { kind: "no_match", fallbackText: "" };
  outcome.fallbackText = renderLookupOutcome(outcome);
  return outcome;
}

function candidates(matches: CandidateMatch[]): LookupOutcome {
  const outcome: LookupOutcome = {
    kind: "candidates",
    candidates: matches,
    fallbackText: "",
  };
  outcome.fallbackText = renderLookupOutcome(outcome);
  return outcome;
}

function overflow(
  candidateCount: number,
  reason: "too_many" | "mixed_types" | "ambiguous_normalized",
): LookupOutcome {
  const outcome: LookupOutcome = {
    kind: "overflow",
    candidateCount,
    reason,
    fallbackText: "",
  };
  outcome.fallbackText = renderLookupOutcome(outcome);
  return outcome;
}

function unavailable(
  reason: "not_found" | "provider_unavailable" | "operation_timeout",
  retryable: boolean,
): LookupOutcome {
  const outcome: LookupOutcome = {
    kind: "unavailable",
    reason,
    retryable,
    fallbackText: "",
  };
  outcome.fallbackText = renderLookupOutcome(outcome);
  return outcome;
}

class RequestAbortedError extends Error {
  constructor() {
    super("lookup request was aborted by its caller");
    this.name = "RequestAbortedError";
  }
}

class OperationTimeoutError extends Error {
  constructor(readonly operation: string) {
    super(`${operation} exceeded its deadline`);
    this.name = "OperationTimeoutError";
  }
}

export interface LookupServiceOptions {
  /** Applied independently to every binding, index, revalidation, and provider call. */
  operationTimeoutMs?: number;
}

function interruptionOutcome(error: unknown): LookupOutcome | undefined {
  if (error instanceof RequestAbortedError) {
    return blocked("request_aborted");
  }
  if (error instanceof OperationTimeoutError) {
    return unavailable("operation_timeout", true);
  }
  return undefined;
}

/**
 * Give each port call a fresh combined cancellation scope. The returned promise
 * settles even when a broken adapter ignores AbortSignal and never resolves.
 */
function runBounded<T>(
  operationName: string,
  operation: (signal: AbortSignal) => Promise<T>,
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    const deadlineAt = performance.now() + timeoutMs;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    };
    const settleSuccess = (value: T): void => {
      if (settled) return;
      if (performance.now() >= deadlineAt) {
        abortAndFail(new OperationTimeoutError(operationName));
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };
    const settleFailure = (error: unknown): void => {
      if (settled) return;
      if (performance.now() >= deadlineAt) {
        abortAndFail(new OperationTimeoutError(operationName));
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const abortAndFail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      controller.abort(error);
      reject(error);
    };
    function onCallerAbort(): void {
      abortAndFail(new RequestAbortedError());
    }

    if (callerSignal?.aborted) {
      abortAndFail(new RequestAbortedError());
      return;
    }
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    timer = setTimeout(
      () => abortAndFail(new OperationTimeoutError(operationName)),
      timeoutMs,
    );

    queueMicrotask(() => {
      if (settled) return;
      try {
        operation(controller.signal).then(settleSuccess, settleFailure);
      } catch (error) {
        settleFailure(error);
      }
    });
  });
}

function bindingFailure(kind: "missing" | "ambiguous" | "context_changed"): LookupOutcome {
  switch (kind) {
    case "missing":
      return blocked("context_binding_missing");
    case "ambiguous":
      return blocked("context_binding_ambiguous");
    case "context_changed":
      return blocked("context_changed");
  }
}

function sameBinding(
  left: TrustedContextBinding,
  right: TrustedContextBinding,
): boolean {
  return (
    sameContextScope(left.scope, right.scope) &&
    left.bindingRevision === right.bindingRevision &&
    left.evidence === right.evidence &&
    left.selectionGeneration === right.selectionGeneration &&
    left.threadRef === right.threadRef &&
    left.routeRef === right.routeRef &&
    left.workspaceRoot === right.workspaceRoot
  );
}

function boundedText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 4_096
  );
}

function optionalBoundedText(value: unknown): value is string | undefined {
  return value === undefined || boundedText(value);
}

function parseContextScope(value: unknown): ContextScopeRef | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  try {
    const raw = value as Record<string, unknown>;
    const kind = raw.kind;
    const namespace = raw.namespace;
    const id = raw.id;
    if (
      !isContextScopeKind(kind) ||
      !boundedText(namespace) ||
      !boundedText(id)
    ) {
      return undefined;
    }
    return Object.freeze({ kind, namespace, id });
  } catch {
    return undefined;
  }
}

function parseBindingResult(value: unknown): ContextBindingResult | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  try {
    const raw = value as Record<string, unknown>;
    const kind = raw.kind;
    if (kind === "missing" || kind === "context_changed") {
      return Object.freeze({ kind });
    }
    if (kind === "ambiguous") {
      const rawScopes = raw.scopes;
      if (!Array.isArray(rawScopes)) return undefined;
      const length = rawScopes.length;
      if (length < 1 || length > 100) return undefined;
      const scopes: ContextScopeRef[] = [];
      for (let index = 0; index < length; index += 1) {
        const scope = parseContextScope(rawScopes[index]);
        if (!scope) return undefined;
        scopes.push(scope);
      }
      return Object.freeze({ kind, scopes: Object.freeze(scopes) }) as ContextBindingResult;
    }
    if (kind !== "trusted") return undefined;

    // Read every untrusted field exactly once before validating or comparing it.
    const scope = parseContextScope(raw.scope);
    const bindingRevision = raw.bindingRevision;
    const evidence = raw.evidence;
    const selectionGeneration = raw.selectionGeneration;
    const threadRef = raw.threadRef;
    const routeRef = raw.routeRef;
    const workspaceRoot = raw.workspaceRoot;
    if (
      !scope ||
      !boundedText(bindingRevision) ||
      (evidence !== "verified_thread" &&
        evidence !== "verified_workspace" &&
        evidence !== "explicit_user" &&
        evidence !== "fixture_manifest") ||
      !Number.isSafeInteger(selectionGeneration) ||
      Number(selectionGeneration) < 0 ||
      !optionalBoundedText(threadRef) ||
      !optionalBoundedText(routeRef) ||
      !optionalBoundedText(workspaceRoot) ||
      (evidence === "verified_thread" && threadRef === undefined) ||
      ((evidence === "verified_workspace" || evidence === "fixture_manifest") &&
        workspaceRoot === undefined)
    ) {
      return undefined;
    }

    const binding: TrustedContextBinding = {
      kind,
      scope,
      bindingRevision,
      evidence,
      selectionGeneration: selectionGeneration as number,
    };
    if (threadRef !== undefined) binding.threadRef = threadRef;
    if (routeRef !== undefined) binding.routeRef = routeRef;
    if (workspaceRoot !== undefined) binding.workspaceRoot = workspaceRoot;
    return Object.freeze(binding);
  } catch {
    return undefined;
  }
}

interface PinnedHostContext {
  readonly selectionGeneration: number;
  readonly explicitScope: ContextScopeRef;
  readonly threadRef?: string;
  readonly routeRef?: string;
  readonly workspaceRoot?: string;
}

type HostContextParseResult =
  | { kind: "valid"; context: PinnedHostContext }
  | { kind: "missing_scope" }
  | { kind: "invalid" };

function parseHostContext(value: HostContext): HostContextParseResult {
  try {
    const selectionGeneration = value.selectionGeneration;
    const rawScope = value.explicitScope;
    const threadRef = value.threadRef;
    const routeRef = value.routeRef;
    const workspaceRoot = value.workspaceRoot;
    if (rawScope === undefined) return { kind: "missing_scope" };
    const explicitScope = parseContextScope(rawScope);
    if (
      !explicitScope ||
      !Number.isSafeInteger(selectionGeneration) ||
      selectionGeneration < 0 ||
      !optionalBoundedText(threadRef) ||
      !optionalBoundedText(routeRef) ||
      !optionalBoundedText(workspaceRoot)
    ) {
      return { kind: "invalid" };
    }
    const context: {
      selectionGeneration: number;
      explicitScope: ContextScopeRef;
      threadRef?: string;
      routeRef?: string;
      workspaceRoot?: string;
    } = { selectionGeneration, explicitScope };
    if (threadRef !== undefined) context.threadRef = threadRef;
    if (routeRef !== undefined) context.routeRef = routeRef;
    if (workspaceRoot !== undefined) context.workspaceRoot = workspaceRoot;
    return { kind: "valid", context: Object.freeze(context) };
  } catch {
    return { kind: "invalid" };
  }
}

function isAuthorityResult(value: unknown): value is AuthorityResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "not_found" || candidate.kind === "access_denied") {
    return true;
  }
  if (candidate.kind === "unavailable") {
    return typeof candidate.retryable === "boolean";
  }
  return (
    candidate.kind === "snapshot" &&
    typeof candidate.snapshot === "object" &&
    candidate.snapshot !== null &&
    typeof candidate.verification === "object" &&
    candidate.verification !== null
  );
}

function bindingMatchesIntent(
  binding: TrustedContextBinding,
  selection: SelectionInput,
  hostContext: PinnedHostContext,
): boolean {
  return (
    binding.selectionGeneration === selection.selectionGeneration &&
    binding.selectionGeneration === hostContext.selectionGeneration &&
    sameContextScope(binding.scope, hostContext.explicitScope) &&
    binding.threadRef === hostContext.threadRef &&
    binding.routeRef === hostContext.routeRef &&
    binding.workspaceRoot === hostContext.workspaceRoot &&
    (binding.evidence !== "verified_thread" || binding.threadRef !== undefined) &&
    (binding.evidence !== "verified_workspace" ||
      binding.workspaceRoot !== undefined) &&
    (binding.evidence !== "fixture_manifest" ||
      binding.workspaceRoot !== undefined)
  );
}

interface ActivationRecord {
  activatedAt: number;
  digest: Buffer;
  state: "pending" | "consumed";
}

export class LookupService {
  readonly #providers = new Map<string, AuthoritativeProvider>();
  readonly #activations = new Map<string, ActivationRecord>();
  readonly #activationSecret = randomBytes(32);
  readonly #nonceTtlMs = 5 * 60_000;
  readonly #maxActivations = 4_096;
  readonly #operationTimeoutMs: number;

  constructor(
    readonly binding: ContextBindingPort,
    readonly index: ContextIndexPort,
    providers: AuthoritativeProvider[],
    options: LookupServiceOptions = {},
  ) {
    const operationTimeoutMs = options.operationTimeoutMs ?? 5_000;
    if (
      !Number.isSafeInteger(operationTimeoutMs) ||
      operationTimeoutMs < 10 ||
      operationTimeoutMs > 30_000
    ) {
      throw new RangeError("operationTimeoutMs must be an integer from 10 to 30000");
    }
    this.#operationTimeoutMs = operationTimeoutMs;
    for (const provider of providers) {
      if (this.#providers.has(provider.providerId)) {
        throw new Error(`duplicate provider: ${provider.providerId}`);
      }
      this.#providers.set(provider.providerId, provider);
    }
  }

  /**
   * Host-private activation boundary. Call only from the handler for a verified
   * explicit user action; never expose this method as a public data/MCP tool.
   * The returned ticket is service-minted and bound to the selection, context,
   * and optional candidate.
   */
  issueActivation(
    selection: SelectionInput,
    hostContext: HostContext,
    chosenEntityId?: string,
  ): ActivationIssueResult {
    const eligibility = evaluateEligibility(selection);
    if (eligibility.kind === "ineligible") {
      return eligibility;
    }
    const parsedHostContext = parseHostContext(hostContext);
    if (parsedHostContext.kind === "missing_scope") {
      return { kind: "ineligible", reason: "missing_scope" };
    }
    if (parsedHostContext.kind === "invalid") {
      return { kind: "ineligible", reason: "invalid_host_context" };
    }
    if (
      selection.selectionGeneration !==
      parsedHostContext.context.selectionGeneration
    ) {
      return { kind: "ineligible", reason: "invalid_generation" };
    }

    const now = Date.now();
    this.#pruneActivations(now);
    if (this.#activations.size >= this.#maxActivations) {
      return { kind: "capacity_exceeded" };
    }

    const ticket: ActivationTicket = {
      activationNonce: `act:${randomUUID()}`,
      activatedAt: now,
    };
    this.#activations.set(ticket.activationNonce, {
      activatedAt: now,
      digest: this.#activationDigest(
        selection,
        parsedHostContext.context,
        chosenEntityId,
      ),
      state: "pending",
    });
    return { kind: "issued", ticket };
  }

  async submitLookupIntent(
    intent: ExplicitLookupIntent,
    signal?: AbortSignal,
  ): Promise<LookupOutcome> {
    if (signal?.aborted) {
      return blocked("request_aborted");
    }
    const parsedHostContext = parseHostContext(intent.hostContext);
    if (parsedHostContext.kind !== "valid") {
      return blocked("invalid_activation");
    }
    const activationFailure = this.#consumeActivation(
      intent,
      parsedHostContext.context,
    );
    if (activationFailure) {
      return activationFailure;
    }

    const eligibility = evaluateEligibility(intent.selection);
    if (eligibility.kind === "ineligible") {
      return blocked("invalid_activation");
    }

    let bindingResult: unknown;
    try {
      bindingResult = await runBounded(
        "binding.resolve",
        (operationSignal) =>
          this.binding.resolve(parsedHostContext.context, operationSignal),
        signal,
        this.#operationTimeoutMs,
      );
    } catch (error) {
      const interruption = interruptionOutcome(error);
      if (interruption) return interruption;
      return blocked("context_binding_unavailable");
    }
    const parsedBindingResult = parseBindingResult(bindingResult);
    if (!parsedBindingResult) {
      return blocked("context_binding_unavailable");
    }
    if (parsedBindingResult.kind !== "trusted") {
      return bindingFailure(parsedBindingResult.kind);
    }
    if (
      !bindingMatchesIntent(
        parsedBindingResult,
        intent.selection,
        parsedHostContext.context,
      )
    ) {
      return blocked("context_changed");
    }
    const trustedBinding = parsedBindingResult;

    let records;
    try {
      const rawRecords = await runBounded(
        "index.list",
        (operationSignal) => this.index.list(trustedBinding, operationSignal),
        signal,
        this.#operationTimeoutMs,
      );
      records = validateContextIndexForRuntime(
        rawRecords,
        trustedBinding.scope,
        eligibility.selection.text,
      );
    } catch (error) {
      const interruption = interruptionOutcome(error);
      if (interruption) return interruption;
      return error instanceof ContractError
        ? blocked("authority_contract_invalid")
        : unavailable("provider_unavailable", true);
    }

    const afterIndex = await this.#revalidate(trustedBinding, signal);
    if (afterIndex) return afterIndex;
    if (signal?.aborted) return blocked("request_aborted");

    const resolution = resolveSelection(
      trustedBinding.scope,
      eligibility.selection.text,
      records,
    );

    switch (resolution.kind) {
      case "no_match":
        return intent.chosenEntityId ? blocked("invalid_candidate") : noMatch();
      case "overflow":
        return intent.chosenEntityId
          ? blocked("invalid_candidate")
          : overflow(resolution.candidateCount, resolution.reason);
      case "candidates": {
        if (!intent.chosenEntityId) {
          return candidates(resolution.candidates.map((candidate) => candidate.match));
        }
        const chosen = resolution.candidates.find(
          (candidate) => candidate.record.entityId === intent.chosenEntityId,
        );
        return chosen
          ? this.#readDetail(trustedBinding, chosen, signal)
          : blocked("invalid_candidate");
      }
      case "unique":
        if (
          intent.chosenEntityId &&
          intent.chosenEntityId !== resolution.candidate.record.entityId
        ) {
          return blocked("invalid_candidate");
        }
        return this.#readDetail(trustedBinding, resolution.candidate, signal);
    }
  }

  #activationDigest(
    selection: SelectionInput,
    hostContext: PinnedHostContext,
    chosenEntityId?: string,
  ): Buffer {
    const payload = JSON.stringify([
      selection.text,
      selection.surface,
      selection.selectionGeneration,
      hostContext.selectionGeneration,
      contextScopeTuple(hostContext.explicitScope),
      hostContext.threadRef ?? null,
      hostContext.routeRef ?? null,
      hostContext.workspaceRoot ?? null,
      chosenEntityId ?? null,
    ]);
    return createHmac("sha256", this.#activationSecret).update(payload).digest();
  }

  #consumeActivation(
    intent: ExplicitLookupIntent,
    hostContext: PinnedHostContext,
  ): LookupOutcome | undefined {
    const now = Date.now();
    this.#pruneActivations(now);
    if (!/^[A-Za-z0-9:_-]{8,128}$/u.test(intent.activationNonce)) {
      return blocked("invalid_activation");
    }
    const record = this.#activations.get(intent.activationNonce);
    if (!record || record.activatedAt !== intent.activatedAt) {
      return blocked("invalid_activation");
    }
    if (record.state === "consumed") {
      return blocked("replayed_activation");
    }
    const presented = this.#activationDigest(
      intent.selection,
      hostContext,
      intent.chosenEntityId,
    );
    if (
      presented.length !== record.digest.length ||
      !timingSafeEqual(presented, record.digest)
    ) {
      return blocked("invalid_activation");
    }
    record.state = "consumed";
    return undefined;
  }

  #pruneActivations(now: number): void {
    for (const [nonce, record] of this.#activations) {
      if (now - record.activatedAt > this.#nonceTtlMs) {
        this.#activations.delete(nonce);
      }
    }
  }

  async #revalidate(
    trustedBinding: TrustedContextBinding,
    callerSignal?: AbortSignal,
  ): Promise<LookupOutcome | undefined> {
    let revalidated: unknown;
    try {
      revalidated = await runBounded(
        "binding.revalidate",
        (operationSignal) => this.binding.revalidate(trustedBinding, operationSignal),
        callerSignal,
        this.#operationTimeoutMs,
      );
    } catch (error) {
      const interruption = interruptionOutcome(error);
      if (interruption) return interruption;
      return blocked("context_binding_unavailable");
    }
    const parsedRevalidated = parseBindingResult(revalidated);
    if (
      !parsedRevalidated ||
      parsedRevalidated.kind !== "trusted" ||
      !sameBinding(trustedBinding, parsedRevalidated)
    ) {
      return blocked("context_changed");
    }
    return undefined;
  }

  async #readDetail(
    trustedBinding: TrustedContextBinding,
    candidate: ResolvedCandidate,
    callerSignal?: AbortSignal,
  ): Promise<LookupOutcome> {
    if (callerSignal?.aborted) return blocked("request_aborted");
    const provider = this.#providers.get(candidate.record.authorityRef.provider);
    if (!provider) {
      return blocked("provider_unregistered");
    }

    const requestStartedAt = Date.now();
    let result: unknown;
    try {
      result = await runBounded(
        "provider.getDetail",
        (operationSignal) =>
          provider.getDetail({
            binding: trustedBinding,
            entityId: candidate.record.entityId,
            entityType: candidate.record.entityType,
            authorityLocator: candidate.record.authorityRef.locator,
            revisionPolicy: "current-or-explicit-stale",
            signal: operationSignal,
          }),
        callerSignal,
        this.#operationTimeoutMs,
      );
    } catch (error) {
      const interruption = interruptionOutcome(error);
      if (interruption) return interruption;
      return error instanceof ContractError
        ? blocked("authority_contract_invalid")
        : unavailable("provider_unavailable", true);
    }

    const afterProvider = await this.#revalidate(trustedBinding, callerSignal);
    if (afterProvider) return afterProvider;
    if (callerSignal?.aborted) return blocked("request_aborted");

    if (!isAuthorityResult(result)) {
      return blocked("authority_contract_invalid");
    }

    if (result.kind === "not_found") {
      return unavailable("not_found", false);
    }
    if (result.kind === "access_denied") {
      return blocked("access_denied");
    }
    if (result.kind === "unavailable") {
      return unavailable("provider_unavailable", result.retryable);
    }

    let snapshot;
    let verification;
    try {
      snapshot = validateSnapshotForCandidate(result.snapshot, {
        scope: trustedBinding.scope,
        entityId: candidate.record.entityId,
        entityType: candidate.record.entityType,
      });
      verification = validateAuthorityVerification(
        result.verification,
        snapshot,
        requestStartedAt,
      );
    } catch (error) {
      return error instanceof IdentityMismatchError
        ? blocked("authority_identity_mismatch")
        : blocked("authority_contract_invalid");
    }

    const outcome: LookupOutcome = {
      kind: "detail",
      candidate: candidate.match,
      detail: snapshot,
      verification,
      fallbackText: "",
    };
    outcome.fallbackText = renderLookupOutcome(outcome);
    return outcome;
  }
}

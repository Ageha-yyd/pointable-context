import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { isAbsolute, join, resolve } from "node:path";
import type {
  AuthoritativeProvider,
  AuthorityVerification,
  CandidateMatch,
  ContextBindingPort,
  ContextIndexPort,
  DetailSnapshot,
  ResolvedCandidate,
  TrustedContextBinding,
} from "../contracts.js";
import {
  copyContextScope,
  sameContextScope,
} from "../context-scope.js";
import { evaluateEligibility } from "../eligibility.js";
import { resolveSelection } from "../resolver.js";
import { renderLookupOutcome } from "../text-renderer.js";
import {
  ContractError,
  IdentityMismatchError,
  validateAuthorityVerification,
  validateContextIndexForRuntime,
  validateSnapshotForCandidate,
} from "../validation.js";
import {
  FixtureFileProjectBinding,
  JsonAuthoritativeProvider,
  JsonContextIndex,
  fixtureProjectId,
  fixtureProjectScope,
} from "../adapters/json-files.js";

export const FIXTURE_RUNTIME = "fixture_probe" as const;
export const FIXTURE_WARNING =
  "FIXTURE-ONLY probe: local JSON data is not a production project binding or live authority.";

type ToolError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type ReferencedCandidate = Omit<CandidateMatch, "scope"> & {
  projectId: string;
  entity_ref: string;
};

export type ResolveStructuredContent = {
  ok: boolean;
  runtime: typeof FIXTURE_RUNTIME;
  warning: string;
  operation: "resolve_project_entities";
  status: "unique" | "candidates" | "no_match" | "overflow" | "error";
  projectId: string | null;
  candidateCount: number;
  candidates: ReferencedCandidate[];
  overflowReason: "too_many" | "mixed_types" | "ambiguous_normalized" | null;
  error: ToolError | null;
};

export type ReadEntity = {
  entityId: string;
  entityType: string;
  label: string;
  summary: string;
  entityRevision: string;
  observedAt: string;
  freshness: DetailSnapshot["freshness"];
  facts: DetailSnapshot["facts"];
  relations: string[];
  sources: Array<{ sourceType: string; sourceId: string }>;
};

export type ReadStructuredContent = {
  ok: boolean;
  runtime: typeof FIXTURE_RUNTIME;
  warning: string;
  operation: "read_project_entity";
  status: "detail" | "error";
  projectId: string | null;
  entity: ReadEntity | null;
  verification: AuthorityVerification | null;
  error: ToolError | null;
};

export type ToolReply<T extends ResolveStructuredContent | ReadStructuredContent> = {
  structuredContent: T;
  text: string;
  isError: boolean;
};

export interface FixtureProbeDependencies {
  workspaceRoot: string;
  projectId: string;
  binding: ContextBindingPort;
  index: ContextIndexPort;
  providers: AuthoritativeProvider[];
}

interface ReferenceRecord {
  binding: TrustedContextBinding;
  entityId: string;
  entityType: string;
  indexRevision: string;
  authorityProvider: string;
  authorityLocator: string;
  issuedAt: number;
}

interface LoadedProject {
  binding: TrustedContextBinding;
  records: ReturnType<typeof validateContextIndexForRuntime>;
}

interface FixtureProbeServiceOptions {
  clock?: () => number;
  referenceTtlMs?: number;
  maxReferences?: number;
  operationTimeoutMs?: number;
}

class FixtureProbeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "FixtureProbeError";
  }
}

class RequestAbortedError extends Error {
  constructor() {
    super("fixture probe request was aborted");
    this.name = "RequestAbortedError";
  }
}

class OperationTimeoutError extends Error {
  constructor(readonly operation: string) {
    super(`${operation} exceeded its deadline`);
    this.name = "OperationTimeoutError";
  }
}

/**
 * Bound every adapter call even when a broken adapter ignores AbortSignal and
 * never settles. A synchronous overrun cannot be reported as success because
 * the elapsed-time check runs before either resolution path is accepted.
 */
function runBounded<T>(
  operationName: string,
  operation: (signal: AbortSignal) => Promise<T>,
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const controller = new AbortController();
    const deadlineAt = performance.now() + timeoutMs;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    };
    const abortAndReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      controller.abort(error);
      rejectPromise(error);
    };
    function onCallerAbort(): void {
      abortAndReject(new RequestAbortedError());
    }
    const resolveWithinDeadline = (value: T): void => {
      if (settled) return;
      if (performance.now() >= deadlineAt) {
        abortAndReject(new OperationTimeoutError(operationName));
        return;
      }
      settled = true;
      cleanup();
      resolvePromise(value);
    };
    const rejectWithinDeadline = (error: unknown): void => {
      if (settled) return;
      if (performance.now() >= deadlineAt) {
        abortAndReject(new OperationTimeoutError(operationName));
        return;
      }
      settled = true;
      cleanup();
      rejectPromise(error);
    };

    if (callerSignal?.aborted) {
      abortAndReject(new RequestAbortedError());
      return;
    }
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    timer = setTimeout(
      () => abortAndReject(new OperationTimeoutError(operationName)),
      timeoutMs,
    );

    queueMicrotask(() => {
      if (settled) return;
      try {
        operation(controller.signal).then(
          resolveWithinDeadline,
          rejectWithinDeadline,
        );
      } catch (error) {
        rejectWithinDeadline(error);
      }
    });
  });
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

function copyTrustedBinding(
  binding: TrustedContextBinding,
): TrustedContextBinding {
  // Adapter results are a runtime trust boundary. Read every field once so a
  // getter cannot change the scope or anchors between validation and pinning.
  const scope = binding.scope;
  const bindingRevision = binding.bindingRevision;
  const evidence = binding.evidence;
  const selectionGeneration = binding.selectionGeneration;
  const threadRef = binding.threadRef;
  const routeRef = binding.routeRef;
  const workspaceRoot = binding.workspaceRoot;
  const copy: TrustedContextBinding = {
    kind: "trusted",
    scope: copyContextScope(scope),
    bindingRevision,
    evidence,
    selectionGeneration,
  };
  if (threadRef !== undefined) copy.threadRef = threadRef;
  if (routeRef !== undefined) copy.routeRef = routeRef;
  if (workspaceRoot !== undefined) copy.workspaceRoot = workspaceRoot;
  return Object.freeze(copy);
}

export function resolveFailure(
  code: string,
  message: string,
  retryable = false,
): ToolReply<ResolveStructuredContent> {
  return {
    structuredContent: {
      ok: false,
      runtime: FIXTURE_RUNTIME,
      warning: FIXTURE_WARNING,
      operation: "resolve_project_entities",
      status: "error",
      projectId: null,
      candidateCount: 0,
      candidates: [],
      overflowReason: null,
      error: { code, message, retryable },
    },
    text: `${FIXTURE_WARNING}\n解析失败：${message}`,
    isError: true,
  };
}

export function readFailure(
  code: string,
  message: string,
  retryable = false,
): ToolReply<ReadStructuredContent> {
  return {
    structuredContent: {
      ok: false,
      runtime: FIXTURE_RUNTIME,
      warning: FIXTURE_WARNING,
      operation: "read_project_entity",
      status: "error",
      projectId: null,
      entity: null,
      verification: null,
      error: { code, message, retryable },
    },
    text: `${FIXTURE_WARNING}\n读取失败：${message}`,
    isError: true,
  };
}

function errorDetails(error: unknown): FixtureProbeError {
  if (error instanceof RequestAbortedError) {
    return new FixtureProbeError(
      "request_aborted",
      "调用方已取消请求。",
      true,
    );
  }
  if (error instanceof OperationTimeoutError) {
    return new FixtureProbeError(
      "operation_timeout",
      "fixture 数据操作超时。",
      true,
    );
  }
  if (error instanceof FixtureProbeError) return error;
  if (error instanceof IdentityMismatchError) {
    return new FixtureProbeError(
      "authority_identity_mismatch",
      "权威详情与项目索引中的实体身份不一致。",
    );
  }
  if (error instanceof ContractError) {
    return new FixtureProbeError(
      "fixture_contract_invalid",
      "本地 fixture 数据不符合协议约束。",
    );
  }
  return new FixtureProbeError(
    "fixture_unavailable",
    "本地 fixture 运行时不可用。",
    true,
  );
}

export class FixtureProjectEntityToolService {
  readonly #workspaceRoot: string;
  readonly #projectId: string;
  readonly #providers = new Map<string, AuthoritativeProvider>();
  readonly #references = new Map<string, ReferenceRecord>();
  readonly #referenceTtlMs: number;
  readonly #maxReferences: number;
  readonly #operationTimeoutMs: number;
  readonly #clock: () => number;

  constructor(
    readonly dependencies: FixtureProbeDependencies,
    options: FixtureProbeServiceOptions = {},
  ) {
    if (!isAbsolute(dependencies.workspaceRoot)) {
      throw new Error("fixture workspaceRoot must be an explicit absolute path");
    }
    if (dependencies.projectId.trim().length === 0) {
      throw new Error("fixture projectId must be explicit");
    }
    const resolvedRoot = resolve(dependencies.workspaceRoot);
    try {
      if (!statSync(resolvedRoot).isDirectory()) throw new Error("not a directory");
      this.#workspaceRoot = realpathSync.native(resolvedRoot);
    } catch {
      throw new Error("fixture workspaceRoot must reference an existing directory");
    }
    this.#projectId = dependencies.projectId;
    this.#clock = options.clock ?? Date.now;
    this.#referenceTtlMs = options.referenceTtlMs ?? 5 * 60_000;
    this.#maxReferences = options.maxReferences ?? 4_096;
    this.#operationTimeoutMs = options.operationTimeoutMs ?? 5_000;
    if (
      !Number.isSafeInteger(this.#referenceTtlMs) ||
      this.#referenceTtlMs < 1 ||
      this.#referenceTtlMs > 60 * 60_000
    ) {
      throw new RangeError("referenceTtlMs must be an integer from 1 to 3600000");
    }
    if (
      !Number.isSafeInteger(this.#maxReferences) ||
      this.#maxReferences < 1 ||
      this.#maxReferences > 4_096
    ) {
      throw new RangeError("maxReferences must be an integer from 1 to 4096");
    }
    if (
      !Number.isSafeInteger(this.#operationTimeoutMs) ||
      this.#operationTimeoutMs < 10 ||
      this.#operationTimeoutMs > 30_000
    ) {
      throw new RangeError(
        "operationTimeoutMs must be an integer from 10 to 30000",
      );
    }
    for (const provider of dependencies.providers) {
      if (this.#providers.has(provider.providerId)) {
        throw new Error(`duplicate fixture provider: ${provider.providerId}`);
      }
      this.#providers.set(provider.providerId, provider);
    }
  }

  async resolveProjectEntities(
    selectionText: string,
    signal?: AbortSignal,
  ): Promise<ToolReply<ResolveStructuredContent>> {
    const eligibility = evaluateEligibility({
      text: selectionText,
      surface: "assistant_message",
      selectionGeneration: 0,
    });
    if (eligibility.kind === "ineligible") {
      return resolveFailure(
        "invalid_selection",
        `选区不可解析：${eligibility.reason}。`,
      );
    }

    try {
      const loaded = await this.#loadProject(eligibility.selection.text, signal);
      const resolution = resolveSelection(
        loaded.binding.scope,
        eligibility.selection.text,
        loaded.records,
      );
      if (resolution.kind === "no_match") {
        return {
          structuredContent: {
            ok: true,
            runtime: FIXTURE_RUNTIME,
            warning: FIXTURE_WARNING,
            operation: "resolve_project_entities",
            status: "no_match",
            projectId: fixtureProjectId(loaded.binding.scope),
            candidateCount: 0,
            candidates: [],
            overflowReason: null,
            error: null,
          },
          text: `${FIXTURE_WARNING}\n当前 fixture 项目中没有匹配实体。`,
          isError: false,
        };
      }
      if (resolution.kind === "overflow") {
        return {
          structuredContent: {
            ok: true,
            runtime: FIXTURE_RUNTIME,
            warning: FIXTURE_WARNING,
            operation: "resolve_project_entities",
            status: "overflow",
            projectId: fixtureProjectId(loaded.binding.scope),
            candidateCount: resolution.candidateCount,
            candidates: [],
            overflowReason: resolution.reason,
            error: null,
          },
          text: `${FIXTURE_WARNING}\n命中 ${resolution.candidateCount} 个实体，但结果存在 ${resolution.reason}；请缩小选区。`,
          isError: false,
        };
      }

      const resolved =
        resolution.kind === "unique"
          ? [resolution.candidate]
          : resolution.candidates;
      this.#pruneReferences(this.#clock());
      if (this.#references.size + resolved.length > this.#maxReferences) {
        throw new FixtureProbeError(
          "reference_capacity",
          "实体引用容量暂时已满，请稍后重试。",
          true,
        );
      }
      const candidates = resolved.map((candidate) =>
        this.#referenceCandidate(candidate, loaded.binding),
      );
      const status = resolution.kind === "unique" ? "unique" : "candidates";
      const renderedCandidates = renderLookupOutcome({
        kind: "candidates",
        candidates: resolved.map((candidate) => candidate.match),
        fallbackText: "",
      });
      const references = candidates.map(
        (candidate, index) => `${index + 1}. entity_ref: ${candidate.entity_ref}`,
      );
      return {
        structuredContent: {
          ok: true,
          runtime: FIXTURE_RUNTIME,
          warning: FIXTURE_WARNING,
          operation: "resolve_project_entities",
          status,
          projectId: fixtureProjectId(loaded.binding.scope),
          candidateCount: candidates.length,
          candidates,
          overflowReason: null,
          error: null,
        },
        text: [
          FIXTURE_WARNING,
          "尚未读取详情。",
          renderedCandidates,
          ...references,
        ].join("\n"),
        isError: false,
      };
    } catch (error) {
      const details = errorDetails(error);
      return resolveFailure(details.code, details.message, details.retryable);
    }
  }

  async readProjectEntity(
    entityRef: string,
    signal?: AbortSignal,
  ): Promise<ToolReply<ReadStructuredContent>> {
    try {
      if (signal?.aborted) throw new RequestAbortedError();
      this.#pruneReferences(this.#clock());
      const reference = this.#references.get(entityRef);
      if (!reference) {
        throw new FixtureProbeError(
          "invalid_entity_ref",
          "实体引用无效或已过期；请重新调用 resolve_project_entities。",
        );
      }

      const loaded = await this.#loadReferencedProject(reference, signal);
      const record = loaded.records.find(
        (candidate) =>
          sameContextScope(candidate.scope, reference.binding.scope) &&
          candidate.entityId === reference.entityId &&
          candidate.entityType === reference.entityType,
      );
      if (
        !record ||
        record.deleted ||
        record.indexRevision !== reference.indexRevision ||
        record.authorityRef.provider !== reference.authorityProvider ||
        record.authorityRef.locator !== reference.authorityLocator
      ) {
        throw new FixtureProbeError(
          "stale_entity_ref",
          "项目索引已变化；请重新调用 resolve_project_entities。",
        );
      }

      const provider = this.#providers.get(record.authorityRef.provider);
      if (!provider) {
        throw new FixtureProbeError(
          "provider_unregistered",
          "项目索引指定的详情提供方未注册。",
        );
      }
      const requestStartedAt = this.#clock();
      const result = await runBounded(
        "provider.getDetail",
        (operationSignal) =>
          provider.getDetail({
            binding: loaded.binding,
            entityId: record.entityId,
            entityType: record.entityType,
            // The locator is intentionally derived only from the freshly-read index.
            authorityLocator: record.authorityRef.locator,
            revisionPolicy: "current-or-explicit-stale",
            signal: operationSignal,
          }),
        signal,
        this.#operationTimeoutMs,
      );
      await this.#assertBindingStillCurrent(loaded.binding, signal);

      if (result.kind === "not_found") {
        throw new FixtureProbeError("detail_not_found", "项目实体详情不存在。", false);
      }
      if (result.kind === "access_denied") {
        throw new FixtureProbeError("access_denied", "无权读取项目实体详情。", false);
      }
      if (result.kind === "unavailable") {
        throw new FixtureProbeError(
          "provider_unavailable",
          "项目实体详情暂时不可用。",
          result.retryable,
        );
      }

      const snapshot = validateSnapshotForCandidate(result.snapshot, {
        scope: loaded.binding.scope,
        entityId: record.entityId,
        entityType: record.entityType,
      });
      const verification = validateAuthorityVerification(
        result.verification,
        snapshot,
        requestStartedAt,
        this.#clock(),
      );
      const entity: ReadEntity = {
        entityId: snapshot.entityId,
        entityType: snapshot.entityType,
        label: record.canonicalKey ?? record.canonicalName,
        summary: record.summary,
        entityRevision: snapshot.entityRevision,
        observedAt: snapshot.observedAt,
        freshness: snapshot.freshness,
        facts: Object.fromEntries(Object.entries(snapshot.facts)),
        relations: [...snapshot.relations],
        sources: snapshot.sourceRefs.map((source) => ({ ...source })),
      };
      return {
        structuredContent: {
          ok: true,
          runtime: FIXTURE_RUNTIME,
          warning: FIXTURE_WARNING,
          operation: "read_project_entity",
          status: "detail",
          projectId: fixtureProjectId(loaded.binding.scope),
          entity,
          verification,
          error: null,
        },
        text: `${FIXTURE_WARNING}\n${renderLookupOutcome({
          kind: "detail",
          candidate: {
            scope: copyContextScope(record.scope),
            entityId: record.entityId,
            entityType: record.entityType,
            label: record.canonicalKey ?? record.canonicalName,
            summary: record.summary,
            matchKind: "exact_id",
            indexRevision: record.indexRevision,
            indexedAt: record.indexedAt,
            detailFreshness: "unknown",
          },
          detail: snapshot,
          verification,
          fallbackText: "",
        })}`,
        isError: false,
      };
    } catch (error) {
      const details = errorDetails(error);
      return readFailure(details.code, details.message, details.retryable);
    }
  }

  async #loadProject(selection: string, signal?: AbortSignal): Promise<LoadedProject> {
    if (signal?.aborted) throw new RequestAbortedError();
    const binding = await runBounded(
      "binding.resolve",
      (operationSignal) =>
        this.dependencies.binding.resolve(
          {
            explicitScope: fixtureProjectScope(this.#projectId),
            selectionGeneration: 0,
            workspaceRoot: this.#workspaceRoot,
          },
          operationSignal,
        ),
      signal,
      this.#operationTimeoutMs,
    );
    const pinnedBinding = binding.kind === "trusted"
      ? copyTrustedBinding(binding)
      : undefined;
    if (
      pinnedBinding === undefined ||
      !sameContextScope(pinnedBinding.scope, fixtureProjectScope(this.#projectId)) ||
      pinnedBinding.evidence !== "fixture_manifest" ||
      pinnedBinding.selectionGeneration !== 0 ||
      pinnedBinding.workspaceRoot !== this.#workspaceRoot ||
      pinnedBinding.threadRef !== undefined ||
      pinnedBinding.routeRef !== undefined
    ) {
      throw new FixtureProbeError(
        "fixture_binding_unavailable",
        "无法建立明确的 fixture 项目绑定。",
      );
    }
    const rawRecords = await runBounded(
      "index.list",
      (operationSignal) => this.dependencies.index.list(pinnedBinding, operationSignal),
      signal,
      this.#operationTimeoutMs,
    );
    const records = validateContextIndexForRuntime(
      rawRecords,
      pinnedBinding.scope,
      selection,
    );
    await this.#assertBindingStillCurrent(pinnedBinding, signal);
    return { binding: pinnedBinding, records };
  }

  async #loadReferencedProject(
    reference: ReferenceRecord,
    signal?: AbortSignal,
  ): Promise<LoadedProject> {
    if (signal?.aborted) throw new RequestAbortedError();
    const binding = copyTrustedBinding(reference.binding);
    await this.#assertBindingStillCurrent(binding, signal);
    const rawRecords = await runBounded(
      "index.list",
      (operationSignal) => this.dependencies.index.list(binding, operationSignal),
      signal,
      this.#operationTimeoutMs,
    );
    const records = validateContextIndexForRuntime(
      rawRecords,
      binding.scope,
      reference.entityId,
    );
    await this.#assertBindingStillCurrent(binding, signal);
    return { binding, records };
  }

  async #assertBindingStillCurrent(
    binding: TrustedContextBinding,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw new RequestAbortedError();
    const revalidated = await runBounded(
      "binding.revalidate",
      (operationSignal) =>
        this.dependencies.binding.revalidate(binding, operationSignal),
      signal,
      this.#operationTimeoutMs,
    );
    if (revalidated.kind !== "trusted" || !sameBinding(binding, revalidated)) {
      throw new FixtureProbeError(
        "project_context_changed",
        "项目上下文在查询期间发生变化。",
      );
    }
  }

  #referenceCandidate(
    candidate: ResolvedCandidate,
    binding: TrustedContextBinding,
  ): ReferencedCandidate {
    if (!sameContextScope(candidate.record.scope, binding.scope)) {
      throw new FixtureProbeError(
        "scope_identity_mismatch",
        "候选实体不属于当前 fixture 项目。",
      );
    }
    const entityRef = `fixture-entity-ref:${randomUUID()}`;
    this.#references.set(entityRef, {
      binding: copyTrustedBinding(binding),
      entityId: candidate.record.entityId,
      entityType: candidate.record.entityType,
      indexRevision: candidate.record.indexRevision,
      authorityProvider: candidate.record.authorityRef.provider,
      authorityLocator: candidate.record.authorityRef.locator,
      issuedAt: this.#clock(),
    });
    const { scope, ...legacyMatch } = candidate.match;
    return {
      ...legacyMatch,
      projectId: fixtureProjectId(scope),
      entity_ref: entityRef,
    };
  }

  #pruneReferences(now: number): void {
    for (const [entityRef, reference] of this.#references) {
      if (
        now < reference.issuedAt ||
        now - reference.issuedAt >= this.#referenceTtlMs
      ) {
        this.#references.delete(entityRef);
      }
    }
  }
}

export function createLocalFixtureToolService(options: {
  workspaceRoot: string;
  projectId: string;
}): FixtureProjectEntityToolService {
  if (!isAbsolute(options.workspaceRoot)) {
    throw new Error("--fixture-root must be an explicit absolute path");
  }
  const workspaceRoot = resolve(options.workspaceRoot);
  return new FixtureProjectEntityToolService({
    workspaceRoot,
    projectId: options.projectId,
    binding: new FixtureFileProjectBinding(
      join(workspaceRoot, "project-context.json"),
      workspaceRoot,
    ),
    index: new JsonContextIndex(join(workspaceRoot, "index.json")),
    providers: [
      new JsonAuthoritativeProvider(join(workspaceRoot, "details.json")),
    ],
  });
}

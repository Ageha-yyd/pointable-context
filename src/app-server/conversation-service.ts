import { createHash, randomBytes } from "node:crypto";
import { basename, resolve } from "node:path";
import { realpath, stat } from "node:fs/promises";
import {
  LocalWorkspaceAuthoritativeProvider,
  LocalWorkspaceContextIndex,
} from "../adapters/local-workspace.js";
import type {
  CandidateMatch,
  ContextBindingPort,
  ContextBindingResult,
  ContextScopeRef,
  HostContext,
  LookupOutcome,
  SelectionInput,
  SourceSurface,
  TrustedContextBinding,
} from "../contracts.js";
import { sameContextScope } from "../context-scope.js";
import { LookupService } from "../lookup-service.js";
import {
  LOCAL_WORKSPACE_PROVIDER_ID,
  localWorkspaceScope,
} from "../host/codex-cdp/task-workspace-binding.js";
import { createPointableReferent, createReferentInjectionItem } from "./referent.js";

const ROUTE_REF = "pointable-app-server-client:v1";
const MAX_MESSAGE_CHARS = 8_000;
const MAX_SELECTION_CHARS = 512;
const DEFAULT_GRANT_TTL_MS = 2 * 60_000;
const DEFAULT_MAX_GRANTS = 256;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pathKey(value: string): string {
  return process.platform === "win32" ? value.toLocaleLowerCase("en-US") : value;
}

function pathsEqual(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right);
}

function safeText(value: string, maximum: number): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu, " ")
    .replace(/[\r\n\u2028\u2029]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}

function boundedText(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maximum) {
    throw new RangeError(`${name} must contain from 1 to ${maximum} characters`);
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(normalized)) {
    throw new TypeError(`${name} contains unsupported control characters`);
  }
  return normalized;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return Number(value);
}

function opaque(prefix: string): string {
  return `${prefix}:${randomBytes(32).toString("base64url")}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function threadId(value: unknown): string {
  if (!record(value) || !record(value.thread) || typeof value.thread.id !== "string") {
    throw new Error("app_server_thread_invalid");
  }
  return value.thread.id;
}

function turnId(value: unknown): string {
  if (!record(value) || !record(value.turn) || typeof value.turn.id !== "string") {
    throw new Error("app_server_turn_invalid");
  }
  return value.turn.id;
}

function completedTurn(value: unknown, expectedThreadId: string, expectedTurnId: string): boolean {
  return (
    record(value) &&
    value.threadId === expectedThreadId &&
    record(value.turn) &&
    value.turn.id === expectedTurnId &&
    value.turn.status === "completed"
  );
}

function agentTextFromThread(value: unknown, expectedThreadId: string, expectedTurnId: string): string {
  if (
    !record(value) ||
    !record(value.thread) ||
    value.thread.id !== expectedThreadId ||
    !Array.isArray(value.thread.turns)
  ) {
    throw new Error("app_server_thread_read_invalid");
  }
  const turn = value.thread.turns.find(
    (candidate) => record(candidate) && candidate.id === expectedTurnId,
  );
  if (!record(turn) || !Array.isArray(turn.items)) throw new Error("app_server_turn_missing");
  return turn.items
    .filter((item) => record(item) && item.type === "agentMessage" && typeof item.text === "string")
    .map((item) => String((item as Record<string, unknown>).text))
    .join("\n")
    .trim();
}

function deltaFromNotification(
  value: unknown,
  expectedThreadId: string,
  expectedTurnId: string | undefined,
): string | undefined {
  if (
    !record(value) ||
    value.threadId !== expectedThreadId ||
    typeof value.delta !== "string" ||
    (expectedTurnId !== undefined && value.turnId !== expectedTurnId)
  ) {
    return undefined;
  }
  return value.delta;
}

export interface ConversationRpc {
  request<T = unknown>(method: string, params: unknown): Promise<T>;
  waitForNotification<T = unknown>(
    method: string,
    predicate?: (params: unknown) => boolean,
    timeoutMs?: number,
  ): Promise<T>;
  onNotification(listener: (method: string, params: unknown) => void): () => void;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

export interface ConversationReferentChip {
  id: string;
  entityId: string;
  entityType: string;
  label: string;
  revision: string;
  freshness: "current" | "stale" | "partial";
  observedAt: string;
}

export interface ConversationCandidateView {
  candidateRef: string;
  label: string;
  entityType: string;
  summary: string;
  matchKind: string;
}

export interface ConversationDetailView {
  detailRef: string;
  entityId: string;
  entityType: string;
  label: string;
  summary: string;
  revision: string;
  observedAt: string;
  freshness: "current" | "stale" | "partial";
  verification: string;
  facts: Array<{ label: string; value: string }>;
  sources: Array<{ label: string }>;
}

export type ConversationLookupResult =
  | { kind: "detail"; detail: ConversationDetailView }
  | { kind: "candidates"; candidates: ConversationCandidateView[] }
  | { kind: "error"; code: string; message: string; retryable: boolean };

export interface ConversationClientState {
  status: "ready" | "busy";
  threadId: string;
  workspaceName: string;
  messages: ConversationMessage[];
  referents: ConversationReferentChip[];
}

export interface ConversationServiceOptions {
  rpc: ConversationRpc;
  workspaceRoot: string;
  operationTimeoutMs?: number;
  grantTtlMs?: number;
  maxGrants?: number;
  clock?: () => number;
  ephemeral?: boolean;
  serviceName?: string;
}

interface CandidateGrant {
  entityId: string;
  selectionDigest: string;
  selectionGeneration: number;
  expiresAt: number;
}

interface DetailGrant {
  outcome: Extract<LookupOutcome, { kind: "detail" }>;
  selectionDigest: string;
  selectionGeneration: number;
  expiresAt: number;
}

class AppServerWorkspaceBinding implements ContextBindingPort {
  readonly scope: ContextScopeRef;
  readonly bindingRevision: string;

  constructor(
    readonly workspaceRoot: string,
    readonly threadRef: string,
  ) {
    this.scope = localWorkspaceScope(workspaceRoot);
    this.bindingRevision = sha256(`${threadRef}\u0000${pathKey(workspaceRoot)}\u0000${randomBytes(32).toString("hex")}`);
  }

  async #rootIsCurrent(): Promise<boolean> {
    try {
      return pathsEqual(await realpath(this.workspaceRoot), this.workspaceRoot);
    } catch {
      return false;
    }
  }

  #trusted(selectionGeneration: number): TrustedContextBinding {
    return Object.freeze({
      kind: "trusted",
      scope: Object.freeze({ ...this.scope }),
      bindingRevision: this.bindingRevision,
      evidence: "explicit_user",
      selectionGeneration,
      threadRef: this.threadRef,
      routeRef: ROUTE_REF,
      workspaceRoot: this.workspaceRoot,
    });
  }

  async resolve(context: HostContext, signal?: AbortSignal): Promise<ContextBindingResult> {
    if (signal?.aborted || !(await this.#rootIsCurrent())) return { kind: "context_changed" };
    if (
      context.selectionGeneration < 1 ||
      context.threadRef !== this.threadRef ||
      context.routeRef !== ROUTE_REF ||
      context.workspaceRoot === undefined ||
      !pathsEqual(context.workspaceRoot, this.workspaceRoot) ||
      context.explicitScope === undefined ||
      !sameContextScope(context.explicitScope, this.scope)
    ) {
      return { kind: "context_changed" };
    }
    return this.#trusted(context.selectionGeneration);
  }

  async revalidate(
    binding: TrustedContextBinding,
    signal?: AbortSignal,
  ): Promise<ContextBindingResult> {
    if (signal?.aborted || !(await this.#rootIsCurrent())) return { kind: "context_changed" };
    if (
      binding.evidence !== "explicit_user" ||
      binding.bindingRevision !== this.bindingRevision ||
      binding.threadRef !== this.threadRef ||
      binding.routeRef !== ROUTE_REF ||
      binding.workspaceRoot === undefined ||
      !pathsEqual(binding.workspaceRoot, this.workspaceRoot) ||
      !sameContextScope(binding.scope, this.scope)
    ) {
      return { kind: "context_changed" };
    }
    return this.#trusted(binding.selectionGeneration);
  }
}

function scalar(value: unknown): string {
  if (Array.isArray(value)) return safeText(value.map(String).join(", "), 220);
  return safeText(value === null ? "null" : String(value), 220);
}

function lookupError(outcome: Exclude<LookupOutcome, { kind: "detail" | "candidates" }>): ConversationLookupResult {
  if (outcome.kind === "no_match") {
    return { kind: "error", code: "not_found", message: "所选文字中没有找到当前工作区对象。", retryable: false };
  }
  if (outcome.kind === "overflow") {
    return { kind: "error", code: outcome.reason, message: "匹配对象过多，请缩小选区。", retryable: false };
  }
  if (outcome.kind === "unavailable") {
    return {
      kind: "error",
      code: outcome.reason,
      message: outcome.reason === "operation_timeout" ? "工作区查询超时，请重试。" : "对象详情暂时不可用。",
      retryable: outcome.retryable,
    };
  }
  return {
    kind: "error",
    code: outcome.reason,
    message: outcome.reason === "context_changed" ? "任务或工作区已经变化，请重新选择。" : "当前对象无法安全读取。",
    retryable: outcome.reason === "context_changed" || outcome.reason === "request_aborted",
  };
}

function candidateView(candidate: CandidateMatch, candidateRef: string): ConversationCandidateView {
  return {
    candidateRef,
    label: safeText(candidate.label, 256),
    entityType: safeText(candidate.entityType, 128),
    summary: safeText(candidate.summary, 1_024),
    matchKind: candidate.matchKind,
  };
}

export class PointableConversationService {
  readonly #messages: ConversationMessage[] = [];
  readonly #referents: ConversationReferentChip[] = [];
  readonly #candidateGrants = new Map<string, CandidateGrant>();
  readonly #detailGrants = new Map<string, DetailGrant>();
  readonly #referenceInFlight = new Set<string>();
  readonly #clock: () => number;
  readonly #grantTtlMs: number;
  readonly #maxGrants: number;
  readonly #lookup: LookupService;
  readonly #binding: AppServerWorkspaceBinding;
  #busy = false;
  #latestSelectionGeneration = 0;

  private constructor(
    readonly rpc: ConversationRpc,
    readonly workspaceRoot: string,
    readonly threadId: string,
    options: ConversationServiceOptions,
  ) {
    this.#clock = options.clock ?? Date.now;
    this.#grantTtlMs = options.grantTtlMs ?? DEFAULT_GRANT_TTL_MS;
    this.#maxGrants = options.maxGrants ?? DEFAULT_MAX_GRANTS;
    if (!Number.isSafeInteger(this.#grantTtlMs) || this.#grantTtlMs < 1_000 || this.#grantTtlMs > 300_000) {
      throw new RangeError("grantTtlMs must be an integer from 1000 to 300000");
    }
    if (!Number.isSafeInteger(this.#maxGrants) || this.#maxGrants < 1 || this.#maxGrants > 4_096) {
      throw new RangeError("maxGrants must be an integer from 1 to 4096");
    }
    this.#binding = new AppServerWorkspaceBinding(workspaceRoot, `codex-app-server:${threadId}`);
    this.#lookup = new LookupService(
      this.#binding,
      new LocalWorkspaceContextIndex(),
      [new LocalWorkspaceAuthoritativeProvider()],
      options.operationTimeoutMs === undefined ? {} : { operationTimeoutMs: options.operationTimeoutMs },
    );
  }

  static async start(options: ConversationServiceOptions): Promise<PointableConversationService> {
    const requestedRoot = resolve(options.workspaceRoot);
    const canonicalRoot = await realpath(requestedRoot);
    const info = await stat(canonicalRoot);
    if (!info.isDirectory() || !pathsEqual(requestedRoot, canonicalRoot)) {
      throw new Error("workspace_root_must_be_canonical_directory");
    }
    const started = await options.rpc.request("thread/start", {
      cwd: canonicalRoot,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: options.ephemeral ?? false,
      serviceName: options.serviceName ?? "pointable_context_conversation_client",
    });
    return new PointableConversationService(
      options.rpc,
      canonicalRoot,
      threadId(started),
      options,
    );
  }

  state(): ConversationClientState {
    return Object.freeze({
      status: this.#busy ? "busy" : "ready",
      threadId: this.threadId,
      workspaceName: basename(this.workspaceRoot),
      messages: this.#messages.map((message) => Object.freeze({ ...message })),
      referents: this.#referents.map((referent) => Object.freeze({ ...referent })),
    });
  }

  async lookup(request: {
    text: unknown;
    surface: unknown;
    generation: unknown;
    candidateRef?: unknown;
    signal?: AbortSignal;
  }): Promise<ConversationLookupResult> {
    const text = boundedText(request.text, "selection text", MAX_SELECTION_CHARS);
    const surface = request.surface;
    if (surface !== "assistant_message" && surface !== "user_message") {
      throw new TypeError("selection surface is unsupported");
    }
    const generation = positiveInteger(request.generation, "selection generation");
    if (generation < this.#latestSelectionGeneration) {
      return { kind: "error", code: "selection_superseded", message: "该选区已经被后续选择替代。", retryable: false };
    }
    if (generation > this.#latestSelectionGeneration) {
      this.#latestSelectionGeneration = generation;
      this.#candidateGrants.clear();
      this.#detailGrants.clear();
    }
    this.#prune();
    const digest = sha256(text);
    let chosenEntityId: string | undefined;
    if (request.candidateRef !== undefined) {
      const candidateRef = boundedText(request.candidateRef, "candidateRef", 256);
      const grant = this.#candidateGrants.get(candidateRef);
      if (
        grant === undefined ||
        grant.selectionDigest !== digest ||
        grant.selectionGeneration !== generation ||
        grant.expiresAt <= this.#now()
      ) {
        return { kind: "error", code: "candidate_ref_invalid", message: "候选引用无效或已过期。", retryable: true };
      }
      this.#candidateGrants.delete(candidateRef);
      chosenEntityId = grant.entityId;
    }
    const selection: SelectionInput = {
      text,
      surface: surface as SourceSurface,
      selectionGeneration: generation,
    };
    const hostContext: HostContext = {
      selectionGeneration: generation,
      explicitScope: { ...this.#binding.scope },
      threadRef: this.#binding.threadRef,
      routeRef: ROUTE_REF,
      workspaceRoot: this.workspaceRoot,
    };
    const activation = this.#lookup.issueActivation(selection, hostContext, chosenEntityId);
    if (activation.kind !== "issued") {
      return {
        kind: "error",
        code: activation.kind === "capacity_exceeded" ? "lookup_capacity" : "invalid_selection",
        message: activation.kind === "capacity_exceeded" ? "查询容量暂时已满。" : "选区不符合查询要求。",
        retryable: activation.kind === "capacity_exceeded",
      };
    }
    const outcome = await this.#lookup.submitLookupIntent({
      ...activation.ticket,
      selection,
      hostContext,
      ...(chosenEntityId === undefined ? {} : { chosenEntityId }),
    }, request.signal);
    if (outcome.kind === "candidates") {
      if (!this.#hasGrantCapacity(outcome.candidates.length)) {
        return { kind: "error", code: "candidate_capacity", message: "候选引用容量已满，请重试。", retryable: true };
      }
      const expiresAt = this.#now() + this.#grantTtlMs;
      return {
        kind: "candidates",
        candidates: outcome.candidates.map((candidate) => {
          const candidateRef = opaque("pcand");
          this.#candidateGrants.set(candidateRef, {
            entityId: candidate.entityId,
            selectionDigest: digest,
            selectionGeneration: generation,
            expiresAt,
          });
          return candidateView(candidate, candidateRef);
        }),
      };
    }
    if (outcome.kind !== "detail") return lookupError(outcome);
    if (!this.#hasGrantCapacity(1)) {
      return { kind: "error", code: "detail_capacity", message: "详情引用容量已满，请重试。", retryable: true };
    }
    const detailRef = opaque("pdetail");
    this.#detailGrants.set(detailRef, {
      outcome,
      selectionDigest: digest,
      selectionGeneration: generation,
      expiresAt: this.#now() + this.#grantTtlMs,
    });
    return {
      kind: "detail",
      detail: {
        detailRef,
        entityId: safeText(outcome.detail.entityId, 512),
        entityType: safeText(outcome.detail.entityType, 128),
        label: safeText(outcome.candidate.label, 256),
        summary: safeText(outcome.candidate.summary, 1_024),
        revision: safeText(outcome.detail.entityRevision, 512),
        observedAt: outcome.detail.observedAt,
        freshness: outcome.detail.freshness,
        verification: outcome.verification.method,
        facts: Object.entries(outcome.detail.facts).slice(0, 5).map(([label, value]) => ({
          label: safeText(label, 128),
          value: scalar(value),
        })),
        sources: outcome.detail.sourceRefs.slice(0, 5).map((source) => ({
          label: safeText(`${source.sourceType} / ${source.sourceId}`, 640),
        })),
      },
    };
  }

  async reference(detailRefValue: unknown): Promise<ConversationReferentChip> {
    const detailRef = boundedText(detailRefValue, "detailRef", 256);
    this.#prune();
    const grant = this.#detailGrants.get(detailRef);
    if (grant === undefined || grant.expiresAt <= this.#now()) {
      throw new Error("detail_ref_invalid_or_expired");
    }
    if (this.#referenceInFlight.has(detailRef)) throw new Error("detail_ref_in_flight");
    const referent = createPointableReferent(grant.outcome);
    const existing = this.#referents.find(
      (chip) => chip.entityId === referent.entity.id && chip.revision === referent.entity.revision,
    );
    if (existing !== undefined) {
      this.#detailGrants.delete(detailRef);
      return Object.freeze({ ...existing });
    }
    this.#referenceInFlight.add(detailRef);
    try {
      await this.rpc.request("thread/inject_items", {
        threadId: this.threadId,
        items: [createReferentInjectionItem(referent)],
      });
      const chip: ConversationReferentChip = Object.freeze({
        id: opaque("pref"),
        entityId: referent.entity.id,
        entityType: referent.entity.type,
        label: referent.entity.label,
        revision: referent.entity.revision,
        freshness: referent.freshness,
        observedAt: referent.observedAt,
      });
      this.#referents.push(chip);
      this.#detailGrants.delete(detailRef);
      return Object.freeze({ ...chip });
    } finally {
      this.#referenceInFlight.delete(detailRef);
    }
  }

  async sendMessage(
    value: unknown,
    onDelta: (delta: string) => void = () => undefined,
    signal?: AbortSignal,
  ): Promise<ConversationMessage> {
    const text = boundedText(value, "message", MAX_MESSAGE_CHARS);
    if (signal?.aborted) throw new Error("request_aborted");
    if (this.#busy) throw new Error("turn_already_in_progress");
    this.#busy = true;
    const createdAt = new Date().toISOString();
    this.#messages.push(Object.freeze({ id: opaque("msg"), role: "user", text, createdAt }));
    let activeTurnId: string | undefined;
    let aborted = false;
    let streamed = "";
    let resolveAbort: () => void = () => undefined;
    const abortPromise = new Promise<void>((resolvePromise) => { resolveAbort = resolvePromise; });
    const onAbort = (): void => {
      aborted = true;
      resolveAbort();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const removeListener = this.rpc.onNotification((method, params) => {
      if (method !== "item/agentMessage/delta") return;
      const delta = deltaFromNotification(params, this.threadId, activeTurnId);
      if (delta === undefined || delta.length === 0) return;
      streamed += delta;
      onDelta(delta);
    });
    try {
      const completion = this.rpc.waitForNotification<Record<string, unknown>>(
        "turn/completed",
        (params) => record(params) && params.threadId === this.threadId,
        180_000,
      );
      const started = await this.rpc.request("turn/start", {
        threadId: this.threadId,
        input: [{ type: "text", text, text_elements: [] }],
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly", access: { type: "fullAccess" } },
      });
      activeTurnId = turnId(started);
      if (aborted) {
        await this.rpc.request("turn/interrupt", { threadId: this.threadId, turnId: activeTurnId });
        throw new Error("request_aborted");
      }
      let completed: Record<string, unknown>;
      try {
        completed = await (signal === undefined
          ? completion
          : Promise.race([
            completion,
            abortPromise.then(() => { throw new Error("request_aborted"); }),
          ]));
      } catch (error) {
        if (aborted) {
          await this.rpc.request("turn/interrupt", { threadId: this.threadId, turnId: activeTurnId })
            .catch(() => undefined);
        }
        throw error;
      }
      if (!completedTurn(completed, this.threadId, activeTurnId)) {
        throw new Error("app_server_turn_completion_invalid");
      }
      const finalText = agentTextFromThread(
        await this.rpc.request("thread/read", { threadId: this.threadId, includeTurns: true }),
        this.threadId,
        activeTurnId,
      ) || streamed.trim();
      const message: ConversationMessage = Object.freeze({
        id: opaque("msg"),
        role: "assistant",
        text: finalText,
        createdAt: new Date().toISOString(),
      });
      this.#messages.push(message);
      return Object.freeze({ ...message });
    } catch (error) {
      this.#messages.pop();
      throw error;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      removeListener();
      this.#busy = false;
    }
  }

  async deleteThread(): Promise<void> {
    await this.rpc.request("thread/delete", { threadId: this.threadId });
  }

  #now(): number {
    const value = this.#clock();
    if (!Number.isFinite(value) || value < 0) throw new Error("conversation clock is invalid");
    return value;
  }

  #prune(): void {
    const now = this.#now();
    for (const [key, grant] of this.#candidateGrants) {
      if (grant.expiresAt <= now) this.#candidateGrants.delete(key);
    }
    for (const [key, grant] of this.#detailGrants) {
      if (grant.expiresAt <= now) this.#detailGrants.delete(key);
    }
  }

  #hasGrantCapacity(additional: number): boolean {
    this.#prune();
    return this.#candidateGrants.size + this.#detailGrants.size + additional <= this.#maxGrants;
  }
}

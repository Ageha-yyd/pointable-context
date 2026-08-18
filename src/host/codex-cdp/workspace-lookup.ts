import { createHash, randomBytes } from "node:crypto";
import {
  LocalWorkspaceAuthoritativeProvider,
  LocalWorkspaceContextIndex,
} from "../../adapters/local-workspace.js";
import type {
  CandidateMatch,
  ContextIndexPort,
  FactScalar,
  FactValue,
  HostContext,
  LookupOutcome,
  SelectionInput,
} from "../../contracts.js";
import { sameContextScope } from "../../context-scope.js";
import { LookupService } from "../../lookup-service.js";
import type { AuthoritativeProvider } from "../../contracts.js";
import type {
  PointableLookupCallback,
  PointableLookupCallbackRequest,
} from "./adapter.js";
import type {
  PointableCandidateView,
  PointableDetailView,
  PointableLookupPresentation,
} from "./protocol.js";
import {
  CodexTaskWorkspaceBindingPort,
  CodexTaskWorkspaceBindingRegistry,
  codexTaskThreadRef,
  type CodexTaskWorkspaceBindingEntry,
} from "./task-workspace-binding.js";

const DEFAULT_CANDIDATE_REF_TTL_MS = 60_000;
const DEFAULT_MAX_CANDIDATE_REFS = 256;

export interface WorkspaceLookupCallbackOptions {
  registry: CodexTaskWorkspaceBindingRegistry;
  index?: ContextIndexPort;
  provider?: AuthoritativeProvider;
  operationTimeoutMs?: number;
  candidateRefTtlMs?: number;
  maxCandidateRefs?: number;
  /** Test seam only. */
  clock?: () => number;
}

interface CandidateGrant {
  targetId: string;
  bindingGeneration: string;
  contextFingerprint: string;
  selectionDigest: string;
  selectionGeneration: number;
  entityId: string;
  scopeKey: string;
  bindingRevision: string;
  expiresAt: number;
}

function boundedPrintable(value: unknown, minimum: number, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function scopeKey(entry: CodexTaskWorkspaceBindingEntry): string {
  return `${entry.scope.kind}\u0000${entry.scope.namespace}\u0000${entry.scope.id}`;
}

function scalarText(value: FactScalar): string {
  return value === null ? "null" : String(value);
}

function factText(value: FactValue): string {
  return truncate(
    Array.isArray(value) ? value.map(scalarText).join(", ") : scalarText(value),
    1_024,
  );
}

function errorPresentation(
  code: string,
  message: string,
  retryable: boolean,
): PointableLookupPresentation {
  return { kind: "error", code, message, retryable };
}

function candidateView(candidate: CandidateMatch, candidateRef: string): PointableCandidateView {
  return {
    candidateRef,
    label: truncate(candidate.label, 256),
    entityType: truncate(candidate.entityType, 128),
    summary: truncate(candidate.summary, 1_024),
  };
}

function detailView(outcome: Extract<LookupOutcome, { kind: "detail" }>): PointableDetailView {
  const purpose = outcome.detail.facts["用途"];
  const summary = typeof purpose === "string"
    ? truncate(purpose, 1_024)
    : truncate(outcome.candidate.summary, 1_024);
  return {
    entityId: truncate(outcome.detail.entityId, 256),
    entityType: truncate(outcome.detail.entityType, 128),
    label: truncate(outcome.candidate.label, 256),
    summary,
    revision: outcome.detail.entityRevision,
    observedAt: outcome.detail.observedAt,
    freshness: outcome.detail.freshness,
    facts: Object.entries(outcome.detail.facts)
      .slice(0, 5)
      .map(([label, value]) => ({ label, value: factText(value) })),
    sources: outcome.detail.sourceRefs
      .slice(0, 5)
      .map((source) => ({
        label: truncate(`${source.sourceType} / ${source.sourceId}`, 512),
      })),
  };
}

function outcomeError(
  outcome: Exclude<LookupOutcome, { kind: "detail" | "candidates" }>,
): PointableLookupPresentation {
  if (outcome.kind === "no_match") {
    return errorPresentation("not_found", "所选文字中未找到已绑定工作区对象。", false);
  }
  if (outcome.kind === "overflow") {
    return errorPresentation(
      `lookup_${outcome.reason}`,
      "匹配对象过多，无法安全显示候选项。请缩小选区后重试。",
      false,
    );
  }
  if (outcome.kind === "unavailable") {
    return errorPresentation(
      outcome.reason,
      outcome.reason === "operation_timeout"
        ? "工作区查询超时，请重试。"
        : "工作区详情暂时不可用。",
      outcome.retryable,
    );
  }
  if (outcome.reason === "context_binding_missing") {
    return errorPresentation(
      outcome.reason,
      "当前 Codex 任务尚未显式绑定工作区。",
      false,
    );
  }
  const retryable =
    outcome.reason === "context_changed" ||
    outcome.reason === "context_binding_unavailable" ||
    outcome.reason === "request_aborted";
  return errorPresentation(
    outcome.reason,
    retryable
      ? "当前任务或工作区已变化，请重新选择后重试。"
      : "当前工作区无法安全完成该查询。",
    retryable,
  );
}

function validRequest(request: PointableLookupCallbackRequest): boolean {
  const task = request.host.task;
  return (
    (request.operation === "resolve" || request.operation === "choose") &&
    boundedPrintable(request.requestId, 8, 128) &&
    boundedPrintable(request.selection.text, 1, 512) &&
    request.selection.text === request.selection.text.trim() &&
    /^[0-9a-f]{64}$/u.test(request.selection.digest) &&
    sha256(request.selection.text) === request.selection.digest &&
    Number.isSafeInteger(request.selection.generation) &&
    request.selection.generation >= 1 &&
    (request.selection.surface === "assistant_message" ||
      request.selection.surface === "user_message") &&
    boundedPrintable(request.contextFingerprint, 1, 2_048) &&
    request.host.targetUrl === "app://-/index.html" &&
    task !== undefined &&
    request.host.revalidateTask !== undefined &&
    task.contextFingerprint === request.contextFingerprint &&
    task.routeRef === request.host.targetUrl &&
    (request.operation === "resolve"
      ? request.candidateRef === undefined
      : boundedPrintable(request.candidateRef, 8, 256))
  );
}

export function createWorkspaceLookupCallback(
  options: WorkspaceLookupCallbackOptions,
): PointableLookupCallback {
  const candidateRefTtlMs = options.candidateRefTtlMs ?? DEFAULT_CANDIDATE_REF_TTL_MS;
  const maxCandidateRefs = options.maxCandidateRefs ?? DEFAULT_MAX_CANDIDATE_REFS;
  if (
    !Number.isSafeInteger(candidateRefTtlMs) ||
    candidateRefTtlMs < 100 ||
    candidateRefTtlMs > 300_000
  ) {
    throw new RangeError("candidateRefTtlMs must be an integer from 100 to 300000");
  }
  if (
    !Number.isSafeInteger(maxCandidateRefs) ||
    maxCandidateRefs < 1 ||
    maxCandidateRefs > 4_096
  ) {
    throw new RangeError("maxCandidateRefs must be an integer from 1 to 4096");
  }
  const index = options.index ?? new LocalWorkspaceContextIndex();
  const provider = options.provider ?? new LocalWorkspaceAuthoritativeProvider();
  const clock = options.clock ?? Date.now;
  const grants = new Map<string, CandidateGrant>();

  const now = (): number => {
    const value = clock();
    if (!Number.isFinite(value) || value < 0) throw new Error("workspace lookup clock is invalid");
    return value;
  };
  const prune = (at: number): void => {
    for (const [candidateRef, grant] of grants) {
      if (grant.expiresAt <= at) grants.delete(candidateRef);
    }
  };

  const consumeCandidate = async (
    request: PointableLookupCallbackRequest,
  ): Promise<string | undefined> => {
    const candidateRef = request.candidateRef;
    if (candidateRef === undefined || request.host.task === undefined) return undefined;
    const checkedAt = now();
    prune(checkedAt);
    const grant = grants.get(candidateRef);
    const entry = await options.registry.find(request.host.task);
    if (
      grant === undefined ||
      entry === undefined ||
      grant.expiresAt <= checkedAt ||
      grant.targetId !== request.host.targetId ||
      grant.bindingGeneration !== request.host.bindingGeneration ||
      grant.contextFingerprint !== request.contextFingerprint ||
      grant.selectionDigest !== request.selection.digest ||
      grant.selectionGeneration !== request.selection.generation ||
      grant.bindingRevision !== entry.bindingRevision ||
      grant.scopeKey !== scopeKey(entry)
    ) {
      return undefined;
    }
    grants.delete(candidateRef);
    return grant.entityId;
  };

  const issueCandidates = async (
    request: PointableLookupCallbackRequest,
    candidates: CandidateMatch[],
  ): Promise<PointableCandidateView[] | undefined> => {
    if (request.host.task === undefined) return undefined;
    const entry = await options.registry.find(request.host.task);
    if (
      entry === undefined ||
      !candidates.every((candidate) => sameContextScope(candidate.scope, entry.scope))
    ) {
      return undefined;
    }
    const issuedAt = now();
    prune(issuedAt);
    if (grants.size + candidates.length > maxCandidateRefs) return undefined;
    return candidates.map((candidate) => {
      const candidateRef = `pcand:${randomBytes(32).toString("base64url")}`;
      grants.set(candidateRef, {
        targetId: request.host.targetId,
        bindingGeneration: request.host.bindingGeneration,
        contextFingerprint: request.contextFingerprint,
        selectionDigest: request.selection.digest,
        selectionGeneration: request.selection.generation,
        entityId: candidate.entityId,
        scopeKey: scopeKey(entry),
        bindingRevision: entry.bindingRevision,
        expiresAt: issuedAt + candidateRefTtlMs,
      });
      return candidateView(candidate, candidateRef);
    });
  };

  return async (request): Promise<PointableLookupPresentation> => {
    if (!validRequest(request) || request.host.task === undefined || request.host.revalidateTask === undefined) {
      return errorPresentation("host_context_unavailable", "当前 Codex 任务无法被宿主确认。", false);
    }
    if (request.signal.aborted) {
      return errorPresentation("request_aborted", "工作区查询已取消。", true);
    }
    const activeEntry = await options.registry.find(request.host.task);
    if (activeEntry === undefined) {
      return errorPresentation(
        "context_binding_missing",
        "当前 Codex 任务尚未显式绑定工作区。",
        false,
      );
    }
    const chosenEntityId = request.operation === "choose"
      ? await consumeCandidate(request)
      : undefined;
    if (request.operation === "choose" && chosenEntityId === undefined) {
      return errorPresentation("candidate_ref_invalid", "候选引用无效或已过期，请重新查询。", true);
    }
    const authority = {
      current: async (signal?: AbortSignal) => await request.host.revalidateTask?.(signal),
    };
    const binding = new CodexTaskWorkspaceBindingPort(
      options.registry,
      request.host.task,
      authority,
    );
    const service = new LookupService(binding, index, [provider], {
      ...(options.operationTimeoutMs === undefined
        ? {}
        : { operationTimeoutMs: options.operationTimeoutMs }),
    });
    const selection: SelectionInput = {
      text: request.selection.text,
      surface: request.selection.surface,
      selectionGeneration: request.selection.generation,
    };
    const hostContext: HostContext = {
      selectionGeneration: request.selection.generation,
      explicitScope: { ...activeEntry.scope },
      threadRef: codexTaskThreadRef(request.host.task),
      routeRef: request.host.task.routeRef,
      workspaceRoot: activeEntry.workspaceRoot,
    };
    const activation = service.issueActivation(selection, hostContext, chosenEntityId);
    if (activation.kind !== "issued") {
      return errorPresentation(
        activation.kind === "capacity_exceeded" ? "lookup_capacity" : "invalid_request",
        activation.kind === "capacity_exceeded"
          ? "工作区查询容量已满，请稍后重试。"
          : "工作区查询请求无效。",
        activation.kind === "capacity_exceeded",
      );
    }
    const outcome = await service.submitLookupIntent({
      ...activation.ticket,
      selection,
      hostContext,
      ...(chosenEntityId === undefined ? {} : { chosenEntityId }),
    }, request.signal);
    if (outcome.kind === "detail") return { kind: "detail", detail: detailView(outcome) };
    if (outcome.kind === "candidates") {
      const candidates = await issueCandidates(request, outcome.candidates);
      return candidates === undefined
        ? errorPresentation("candidate_ref_capacity", "候选引用暂时不可用，请重试。", true)
        : { kind: "candidates", candidates };
    }
    return outcomeError(outcome);
  };
}

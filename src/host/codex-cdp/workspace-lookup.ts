import { createHash, randomBytes } from "node:crypto";
import {
  LocalWorkspaceAuthoritativeProvider,
  LocalWorkspaceContextIndex,
  LocalWorkspaceRevisionProbe,
  type LocalWorkspaceRevisionProbeResult,
} from "../../adapters/local-workspace.js";
import type {
  CandidateMatch,
  ContextIndexPort,
  FactScalar,
  FactValue,
  HostContext,
  LookupOutcome,
  SelectionInput,
  TrustedContextBinding,
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
  PointableChangeView,
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
const DEFAULT_DETAIL_REF_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_DETAIL_REFS = 256;

export interface WorkspaceRevisionProbe {
  probe(request: {
    binding: TrustedContextBinding;
    entityId: string;
    entityType: string;
    signal?: AbortSignal;
  }): Promise<LocalWorkspaceRevisionProbeResult>;
}

export interface WorkspaceLookupCallbackOptions {
  registry: CodexTaskWorkspaceBindingRegistry;
  index?: ContextIndexPort;
  provider?: AuthoritativeProvider;
  operationTimeoutMs?: number;
  candidateRefTtlMs?: number;
  maxCandidateRefs?: number;
  revisionProbe?: WorkspaceRevisionProbe | false;
  detailRefTtlMs?: number;
  maxDetailRefs?: number;
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

interface DetailGrant {
  targetId: string;
  bindingGeneration: string;
  contextFingerprint: string;
  selectionDigest: string;
  selectionGeneration: number;
  entityId: string;
  entityType: string;
  scopeKey: string;
  bindingRevision: string;
  probeRevision: string;
  detail: PointableDetailView;
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

function detailView(
  outcome: Extract<LookupOutcome, { kind: "detail" }>,
  options: { detailRef?: string; changes?: PointableChangeView[] } = {},
): PointableDetailView {
  const purpose = outcome.detail.facts["用途"] ?? outcome.detail.facts["职责"];
  const scenarioSummary = outcome.detail.entityType === "verification"
    ? outcome.detail.facts["验证范围"]
    : outcome.detail.entityType === "configuration"
      ? outcome.detail.facts["配置用途"]
      : outcome.detail.entityType === "decision"
        ? outcome.detail.facts["决策"]
        : undefined;
  const change = outcome.detail.facts["本次变化"];
  const activeChange = typeof change === "string" &&
    /^(?:涉及：|modified\b|staged\b|untracked\b|conflicted\b)/u.test(change);
  const summaryValue = scenarioSummary ?? (activeChange ? change : purpose);
  const summary = typeof summaryValue === "string"
    ? truncate(summaryValue, 1_024)
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
    ...(options.detailRef === undefined ? {} : { detailRef: options.detailRef }),
    ...(options.changes === undefined ? {} : { changes: options.changes }),
  };
}

function detailChanges(
  before: PointableDetailView,
  after: PointableDetailView,
): PointableChangeView[] {
  const previous = new Map(before.facts.map((fact) => [fact.label, fact.value]));
  const changes: PointableChangeView[] = [];
  if (before.summary !== after.summary) {
    changes.push({ label: "摘要", before: before.summary, after: after.summary });
  }
  for (const fact of after.facts) {
    const oldValue = previous.get(fact.label);
    if (oldValue !== undefined && oldValue !== fact.value) {
      changes.push({ label: fact.label, before: oldValue, after: fact.value });
    }
    if (changes.length >= 3) break;
  }
  return changes.slice(0, 3);
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
    (request.operation === "resolve" ||
      request.operation === "choose" ||
      request.operation === "check" ||
      request.operation === "refresh") &&
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
      ? request.candidateRef === undefined && request.detailRef === undefined
      : request.operation === "choose"
        ? boundedPrintable(request.candidateRef, 8, 256) && request.detailRef === undefined
        : request.candidateRef === undefined && boundedPrintable(request.detailRef, 8, 256))
  );
}

export function createWorkspaceLookupCallback(
  options: WorkspaceLookupCallbackOptions,
): PointableLookupCallback {
  const candidateRefTtlMs = options.candidateRefTtlMs ?? DEFAULT_CANDIDATE_REF_TTL_MS;
  const maxCandidateRefs = options.maxCandidateRefs ?? DEFAULT_MAX_CANDIDATE_REFS;
  const detailRefTtlMs = options.detailRefTtlMs ?? DEFAULT_DETAIL_REF_TTL_MS;
  const maxDetailRefs = options.maxDetailRefs ?? DEFAULT_MAX_DETAIL_REFS;
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
  if (
    !Number.isSafeInteger(detailRefTtlMs) ||
    detailRefTtlMs < 1_000 ||
    detailRefTtlMs > 3_600_000
  ) {
    throw new RangeError("detailRefTtlMs must be an integer from 1000 to 3600000");
  }
  if (
    !Number.isSafeInteger(maxDetailRefs) ||
    maxDetailRefs < 1 ||
    maxDetailRefs > 4_096
  ) {
    throw new RangeError("maxDetailRefs must be an integer from 1 to 4096");
  }
  const index = options.index ?? new LocalWorkspaceContextIndex();
  const provider = options.provider ?? new LocalWorkspaceAuthoritativeProvider();
  const revisionProbe = options.revisionProbe === false
    ? undefined
    : options.revisionProbe ?? new LocalWorkspaceRevisionProbe();
  const clock = options.clock ?? Date.now;
  const candidateGrants = new Map<string, CandidateGrant>();
  const detailGrants = new Map<string, DetailGrant>();

  const now = (): number => {
    const value = clock();
    if (!Number.isFinite(value) || value < 0) throw new Error("workspace lookup clock is invalid");
    return value;
  };
  const prune = (at: number): void => {
    for (const [candidateRef, grant] of candidateGrants) {
      if (grant.expiresAt <= at) candidateGrants.delete(candidateRef);
    }
    for (const [detailRef, grant] of detailGrants) {
      if (grant.expiresAt <= at) detailGrants.delete(detailRef);
    }
  };

  const consumeCandidate = async (
    request: PointableLookupCallbackRequest,
  ): Promise<string | undefined> => {
    const candidateRef = request.candidateRef;
    if (candidateRef === undefined || request.host.task === undefined) return undefined;
    const checkedAt = now();
    prune(checkedAt);
    const grant = candidateGrants.get(candidateRef);
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
    candidateGrants.delete(candidateRef);
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
    if (candidateGrants.size + candidates.length > maxCandidateRefs) return undefined;
    return candidates.map((candidate) => {
      const candidateRef = `pcand:${randomBytes(32).toString("base64url")}`;
      candidateGrants.set(candidateRef, {
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

  const runtimeFor = (
    request: PointableLookupCallbackRequest,
    activeEntry: CodexTaskWorkspaceBindingEntry,
  ) => {
    if (request.host.task === undefined || request.host.revalidateTask === undefined) {
      throw new Error("host context unavailable");
    }
    const authority = {
      current: async (signal?: AbortSignal) => await request.host.revalidateTask?.(signal),
    };
    const binding = new CodexTaskWorkspaceBindingPort(
      options.registry,
      request.host.task,
      authority,
    );
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
    const service = new LookupService(binding, index, [provider], {
      ...(options.operationTimeoutMs === undefined
        ? {}
        : { operationTimeoutMs: options.operationTimeoutMs }),
    });
    return { binding, selection, hostContext, service };
  };

  const runLookup = async (
    request: PointableLookupCallbackRequest,
    activeEntry: CodexTaskWorkspaceBindingEntry,
    chosenEntityId?: string,
  ): Promise<
    | { kind: "outcome"; outcome: LookupOutcome; runtime: ReturnType<typeof runtimeFor> }
    | { kind: "error"; presentation: PointableLookupPresentation }
  > => {
    const runtime = runtimeFor(request, activeEntry);
    const activation = runtime.service.issueActivation(
      runtime.selection,
      runtime.hostContext,
      chosenEntityId,
    );
    if (activation.kind !== "issued") {
      return {
        kind: "error",
        presentation: errorPresentation(
          activation.kind === "capacity_exceeded" ? "lookup_capacity" : "invalid_request",
          activation.kind === "capacity_exceeded"
            ? "工作区查询容量已满，请稍后重试。"
            : "工作区查询请求无效。",
          activation.kind === "capacity_exceeded",
        ),
      };
    }
    const outcome = await runtime.service.submitLookupIntent({
      ...activation.ticket,
      selection: runtime.selection,
      hostContext: runtime.hostContext,
      ...(chosenEntityId === undefined ? {} : { chosenEntityId }),
    }, request.signal);
    return { kind: "outcome", outcome, runtime };
  };

  const probeWithFence = async (
    runtime: ReturnType<typeof runtimeFor>,
    entityId: string,
    entityType: string,
    signal: AbortSignal,
  ): Promise<LocalWorkspaceRevisionProbeResult | undefined> => {
    if (revisionProbe === undefined || signal.aborted) return undefined;
    const resolved = await runtime.binding.resolve(runtime.hostContext, signal);
    if (resolved.kind !== "trusted") return undefined;
    const probed = await revisionProbe.probe({
      binding: resolved,
      entityId,
      entityType,
      signal,
    });
    const revalidated = await runtime.binding.revalidate(resolved, signal);
    if (revalidated.kind !== "trusted") return undefined;
    return probed;
  };

  const issueDetail = async (
    request: PointableLookupCallbackRequest,
    activeEntry: CodexTaskWorkspaceBindingEntry,
    outcome: Extract<LookupOutcome, { kind: "detail" }>,
    runtime: ReturnType<typeof runtimeFor>,
  ): Promise<PointableDetailView> => {
    const detail = detailView(outcome);
    const issuedAt = now();
    prune(issuedAt);
    if (detailGrants.size >= maxDetailRefs) return detail;
    const probe = await probeWithFence(
      runtime,
      outcome.detail.entityId,
      outcome.detail.entityType,
      request.signal,
    );
    if (probe?.kind !== "current") return detail;
    const detailRef = `pdet:${randomBytes(32).toString("base64url")}`;
    detailGrants.set(detailRef, {
      targetId: request.host.targetId,
      bindingGeneration: request.host.bindingGeneration,
      contextFingerprint: request.contextFingerprint,
      selectionDigest: request.selection.digest,
      selectionGeneration: request.selection.generation,
      entityId: outcome.detail.entityId,
      entityType: outcome.detail.entityType,
      scopeKey: scopeKey(activeEntry),
      bindingRevision: activeEntry.bindingRevision,
      probeRevision: probe.revision,
      detail,
      expiresAt: issuedAt + detailRefTtlMs,
    });
    return { ...detail, detailRef };
  };

  const currentDetailGrant = async (
    request: PointableLookupCallbackRequest,
    activeEntry: CodexTaskWorkspaceBindingEntry,
  ): Promise<{ detailRef: string; grant: DetailGrant } | undefined> => {
    const detailRef = request.detailRef;
    if (detailRef === undefined) return undefined;
    const checkedAt = now();
    prune(checkedAt);
    const grant = detailGrants.get(detailRef);
    if (grant === undefined) return undefined;
    if (
      grant.expiresAt <= checkedAt ||
      grant.targetId !== request.host.targetId ||
      grant.bindingGeneration !== request.host.bindingGeneration ||
      grant.contextFingerprint !== request.contextFingerprint ||
      grant.selectionDigest !== request.selection.digest ||
      grant.selectionGeneration !== request.selection.generation ||
      grant.bindingRevision !== activeEntry.bindingRevision ||
      grant.scopeKey !== scopeKey(activeEntry)
    ) {
      detailGrants.delete(detailRef);
      return undefined;
    }
    return { detailRef, grant };
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
    if (request.operation === "check" || request.operation === "refresh") {
      const current = await currentDetailGrant(request, activeEntry);
      if (current === undefined) {
        return errorPresentation(
          "detail_ref_invalid",
          "详情刷新引用无效或已过期，请重新选择。",
          true,
        );
      }
      const runtime = runtimeFor(request, activeEntry);
      if (request.operation === "check") {
        const probe = await probeWithFence(
          runtime,
          current.grant.entityId,
          current.grant.entityType,
          request.signal,
        );
        if (probe === undefined) {
          return errorPresentation(
            "context_changed",
            "当前任务或工作区已变化，请重新选择后重试。",
            true,
          );
        }
        const state = probe.kind === "current"
          ? probe.revision === current.grant.probeRevision ? "unchanged" : "updated"
          : probe.kind === "not_found" ? "deleted" : "unavailable";
        if (state === "unchanged") {
          current.grant.expiresAt = now() + detailRefTtlMs;
        }
        return {
          kind: "revision",
          revision: {
            detailRef: current.detailRef,
            state,
            checkedAt: probe.observedAt,
          },
        };
      }
      const refreshed = await runLookup(request, activeEntry, current.grant.entityId);
      if (refreshed.kind === "error") return refreshed.presentation;
      if (refreshed.outcome.kind === "candidates") {
        return errorPresentation(
          "refresh_identity_ambiguous",
          "刷新时对象身份不再唯一，请重新选择。",
          false,
        );
      }
      if (refreshed.outcome.kind !== "detail") return outcomeError(refreshed.outcome);
      const nextDetail = detailView(refreshed.outcome);
      const probe = await probeWithFence(
        refreshed.runtime,
        refreshed.outcome.detail.entityId,
        refreshed.outcome.detail.entityType,
        request.signal,
      );
      if (probe?.kind !== "current") {
        return errorPresentation(
          "refresh_unavailable",
          "更新后的详情无法被当前 Provider 复验。",
          true,
        );
      }
      const changes = detailChanges(current.grant.detail, nextDetail);
      current.grant.probeRevision = probe.revision;
      current.grant.detail = nextDetail;
      current.grant.expiresAt = now() + detailRefTtlMs;
      return {
        kind: "detail",
        detail: { ...nextDetail, detailRef: current.detailRef, changes },
      };
    }

    const chosenEntityId = request.operation === "choose"
      ? await consumeCandidate(request)
      : undefined;
    if (request.operation === "choose" && chosenEntityId === undefined) {
      return errorPresentation("candidate_ref_invalid", "候选引用无效或已过期，请重新查询。", true);
    }
    const resolved = await runLookup(request, activeEntry, chosenEntityId);
    if (resolved.kind === "error") return resolved.presentation;
    const outcome = resolved.outcome;
    if (outcome.kind === "detail") {
      return {
        kind: "detail",
        detail: await issueDetail(request, activeEntry, outcome, resolved.runtime),
      };
    }
    if (outcome.kind === "candidates") {
      const candidates = await issueCandidates(request, outcome.candidates);
      return candidates === undefined
        ? errorPresentation("candidate_ref_capacity", "候选引用暂时不可用，请重试。", true)
        : { kind: "candidates", candidates };
    }
    return outcomeError(outcome);
  };
}

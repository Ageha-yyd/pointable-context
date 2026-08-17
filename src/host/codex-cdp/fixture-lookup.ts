import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import {
  FIXTURE_PROJECT_NAMESPACE,
  FixtureFileProjectBinding,
  JsonAuthoritativeProvider,
  JsonContextIndex,
} from "../../adapters/json-files.js";
import type {
  CandidateMatch,
  ContextScopeRef,
  FactScalar,
  FactValue,
  HostContext,
  LookupOutcome,
  SelectionInput,
} from "../../contracts.js";
import { copyContextScope } from "../../context-scope.js";
import { LookupService } from "../../lookup-service.js";
import type {
  PointableLookupCallback,
  PointableLookupCallbackRequest,
} from "./adapter.js";
import type {
  PointableCandidateView,
  PointableDetailView,
  PointableLookupPresentation,
} from "./protocol.js";

const DEFAULT_CANDIDATE_REF_TTL_MS = 60_000;
const DEFAULT_MAX_CANDIDATE_REFS = 256;
const CANDIDATE_REF_BYTES = 32;
const CANDIDATE_REF_PREFIX = "pcand:";

export interface FixtureLookupCallbackOptions {
  workspaceRoot: string;
  manifestPath: string;
  indexPath: string;
  detailsPath: string;
  explicitScope: ContextScopeRef;
  providerId?: string;
  operationTimeoutMs?: number;
  candidateRefTtlMs?: number;
  maxCandidateRefs?: number;
  /** Test seam only. Production callers should omit it. */
  clock?: () => number;
}

interface CandidateGrant {
  targetId: string;
  bindingGeneration: string;
  contextFingerprint: string;
  selectionDigest: string;
  selectionGeneration: number;
  entityId: string;
  expiresAt: number;
}

function boundedPrintable(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1))}…`;
}

function scalarText(value: FactScalar): string {
  return value === null ? "null" : String(value);
}

function factText(value: FactValue): string {
  const rendered = Array.isArray(value)
    ? value.map(scalarText).join(", ")
    : scalarText(value);
  return truncate(rendered, 1_024);
}

function sourceLabel(sourceType: string, sourceId: string): string {
  return truncate(`${sourceType} / ${sourceId}`, 512);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function errorPresentation(
  code: string,
  message: string,
  retryable: boolean,
): PointableLookupPresentation {
  return { kind: "error", code, message, retryable };
}

function validExplicitScope(scope: ContextScopeRef): boolean {
  return (
    scope.kind === "project" &&
    scope.namespace === FIXTURE_PROJECT_NAMESPACE &&
    boundedPrintable(scope.id, 1, 4_096)
  );
}

function validRequest(request: PointableLookupCallbackRequest): boolean {
  const selection = request.selection;
  const candidateConsistent = request.operation === "resolve"
    ? request.candidateRef === undefined
    : boundedPrintable(request.candidateRef, 8, 256);
  return (
    (request.operation === "resolve" || request.operation === "choose") &&
    boundedPrintable(request.requestId, 8, 128) &&
    boundedPrintable(selection.text, 1, 512) &&
    selection.text === selection.text.trim() &&
    /^[0-9a-f]{64}$/u.test(selection.digest) &&
    sha256(selection.text) === selection.digest &&
    Number.isSafeInteger(selection.generation) &&
    selection.generation >= 1 &&
    (selection.surface === "assistant_message" ||
      selection.surface === "user_message") &&
    boundedPrintable(request.contextFingerprint, 1, 2_048) &&
    boundedPrintable(request.requestedAt, 20, 64) &&
    Number.isFinite(Date.parse(request.requestedAt)) &&
    boundedPrintable(request.host.targetId, 1, 256) &&
    request.host.targetUrl === "app://-/index.html" &&
    boundedPrintable(request.host.bindingGeneration, 8, 256) &&
    candidateConsistent
  );
}

function candidateView(
  candidate: CandidateMatch,
  candidateRef: string,
): PointableCandidateView {
  return {
    candidateRef,
    label: truncate(candidate.label, 256),
    entityType: truncate(candidate.entityType, 128),
    summary: truncate(candidate.summary, 1_024),
  };
}

function detailView(outcome: Extract<LookupOutcome, { kind: "detail" }>): PointableDetailView {
  return {
    entityId: truncate(outcome.detail.entityId, 256),
    entityType: truncate(outcome.detail.entityType, 128),
    label: truncate(outcome.candidate.label, 256),
    summary: truncate(outcome.candidate.summary, 1_024),
    revision: outcome.detail.entityRevision,
    observedAt: outcome.detail.observedAt,
    freshness: outcome.detail.freshness,
    facts: Object.entries(outcome.detail.facts)
      .slice(0, 5)
      .map(([label, value]) => ({ label, value: factText(value) })),
    sources: outcome.detail.sourceRefs
      .slice(0, 5)
      .map((source) => ({
        label: sourceLabel(source.sourceType, source.sourceId),
      })),
  };
}

function outcomeError(outcome: Exclude<LookupOutcome, {
  kind: "detail" | "candidates";
}>): PointableLookupPresentation {
  if (outcome.kind === "no_match") {
    return errorPresentation("not_found", "所选文字中未找到上下文对象。", false);
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
        ? "上下文查询超时，请重试。"
        : "上下文详情暂时不可用。",
      outcome.retryable,
    );
  }
  const retryable =
    outcome.reason === "context_changed" ||
    outcome.reason === "context_binding_unavailable" ||
    outcome.reason === "request_aborted";
  return errorPresentation(
    outcome.reason,
    retryable
      ? "当前上下文已变化或暂时不可用，请重新选择后重试。"
      : "当前上下文无法安全完成该查询。",
    retryable,
  );
}

export function createFixtureLookupCallback(
  options: FixtureLookupCallbackOptions,
): PointableLookupCallback {
  if (!validExplicitScope(options.explicitScope)) {
    throw new TypeError(
      "fixture lookup requires a complete fixture project explicitScope",
    );
  }
  const candidateRefTtlMs = options.candidateRefTtlMs ??
    DEFAULT_CANDIDATE_REF_TTL_MS;
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

  const workspaceRoot = resolve(options.workspaceRoot);
  const explicitScope = copyContextScope(options.explicitScope);
  const binding = new FixtureFileProjectBinding(
    resolve(options.manifestPath),
    workspaceRoot,
  );
  const index = new JsonContextIndex(resolve(options.indexPath));
  const provider = new JsonAuthoritativeProvider(
    resolve(options.detailsPath),
    options.providerId ?? "json-fixture",
  );
  const service = new LookupService(binding, index, [provider], {
    ...(options.operationTimeoutMs === undefined
      ? {}
      : { operationTimeoutMs: options.operationTimeoutMs }),
  });
  const clock = options.clock ?? Date.now;
  const grants = new Map<string, CandidateGrant>();

  const now = (): number => {
    const value = clock();
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("fixture lookup clock returned an invalid time");
    }
    return value;
  };

  const prune = (at: number): void => {
    for (const [candidateRef, grant] of grants) {
      if (grant.expiresAt <= at) grants.delete(candidateRef);
    }
  };

  const issueCandidateRefs = (
    request: PointableLookupCallbackRequest,
    candidates: CandidateMatch[],
  ): PointableCandidateView[] | undefined => {
    const issuedAt = now();
    prune(issuedAt);
    if (grants.size + candidates.length > maxCandidateRefs) return undefined;

    const pending: Array<{
      candidateRef: string;
      candidate: CandidateMatch;
      grant: CandidateGrant;
    }> = [];
    for (const candidate of candidates) {
      let candidateRef: string | undefined;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const proposed = `${CANDIDATE_REF_PREFIX}${randomBytes(
          CANDIDATE_REF_BYTES,
        ).toString("base64url")}`;
        if (
          !grants.has(proposed) &&
          !pending.some((item) => item.candidateRef === proposed)
        ) {
          candidateRef = proposed;
          break;
        }
      }
      if (candidateRef === undefined) return undefined;
      pending.push({
        candidateRef,
        candidate,
        grant: {
          targetId: request.host.targetId,
          bindingGeneration: request.host.bindingGeneration,
          contextFingerprint: request.contextFingerprint,
          selectionDigest: request.selection.digest,
          selectionGeneration: request.selection.generation,
          entityId: candidate.entityId,
          expiresAt: issuedAt + candidateRefTtlMs,
        },
      });
    }
    for (const item of pending) grants.set(item.candidateRef, item.grant);
    return pending.map((item) => candidateView(item.candidate, item.candidateRef));
  };

  const consumeCandidateRef = (
    request: PointableLookupCallbackRequest,
  ): string | undefined => {
    const checkedAt = now();
    prune(checkedAt);
    const candidateRef = request.candidateRef;
    if (candidateRef === undefined) return undefined;
    const grant = grants.get(candidateRef);
    if (
      grant === undefined ||
      grant.expiresAt <= checkedAt ||
      grant.targetId !== request.host.targetId ||
      grant.bindingGeneration !== request.host.bindingGeneration ||
      grant.contextFingerprint !== request.contextFingerprint ||
      grant.selectionDigest !== request.selection.digest ||
      grant.selectionGeneration !== request.selection.generation
    ) {
      return undefined;
    }
    grants.delete(candidateRef);
    return grant.entityId;
  };

  return async (request): Promise<PointableLookupPresentation> => {
    if (!validRequest(request)) {
      return errorPresentation(
        "invalid_request",
        "上下文查询请求无效。",
        false,
      );
    }
    if (request.signal.aborted) {
      return errorPresentation("request_aborted", "上下文查询已取消。", true);
    }

    const chosenEntityId = request.operation === "choose"
      ? consumeCandidateRef(request)
      : undefined;
    if (request.operation === "choose" && chosenEntityId === undefined) {
      return errorPresentation(
        "candidate_ref_invalid",
        "候选引用无效或已过期，请重新查询。",
        true,
      );
    }

    const selection: SelectionInput = {
      text: request.selection.text,
      surface: request.selection.surface,
      selectionGeneration: request.selection.generation,
    };
    const hostContext: HostContext = {
      selectionGeneration: request.selection.generation,
      explicitScope,
      workspaceRoot,
    };
    const activation = service.issueActivation(
      selection,
      hostContext,
      chosenEntityId,
    );
    if (activation.kind !== "issued") {
      return errorPresentation(
        activation.kind === "capacity_exceeded"
          ? "lookup_capacity"
          : "invalid_request",
        activation.kind === "capacity_exceeded"
          ? "上下文查询容量已满，请稍后重试。"
          : "上下文查询请求无效。",
        activation.kind === "capacity_exceeded",
      );
    }
    const outcome = await service.submitLookupIntent({
      ...activation.ticket,
      selection,
      hostContext,
      ...(chosenEntityId === undefined ? {} : { chosenEntityId }),
    }, request.signal);

    if (outcome.kind === "detail") {
      return { kind: "detail", detail: detailView(outcome) };
    }
    if (outcome.kind === "candidates") {
      if (outcome.candidates.length < 2 || outcome.candidates.length > 3) {
        return errorPresentation(
          "invalid_candidate_set",
          "候选集合不符合显示约束。",
          false,
        );
      }
      const candidates = issueCandidateRefs(request, outcome.candidates);
      return candidates === undefined
        ? errorPresentation(
          "candidate_ref_capacity",
          "候选引用容量已满，请稍后重试。",
          true,
        )
        : { kind: "candidates", candidates };
    }
    return outcomeError(outcome);
  };
}

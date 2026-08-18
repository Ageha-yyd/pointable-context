import { createHash } from "node:crypto";

export const POINTABLE_PROTOCOL_VERSION = 1 as const;
export const MAX_SELECTION_CHARS = 512;
export const MAX_BINDING_PAYLOAD_CHARS = 4_096;

export type PointableSelectionSurface = "assistant_message" | "user_message";
export type PointableLookupOperation = "resolve" | "choose" | "check" | "refresh";

export interface PointableLookupIntentV1 {
  schemaVersion: typeof POINTABLE_PROTOCOL_VERSION;
  kind: "pointable.selection.lookup";
  operation: PointableLookupOperation;
  requestId: string;
  selectionGeneration: number;
  selectionText: string;
  selectionDigest: string;
  surface: PointableSelectionSurface;
  contextFingerprint: string;
  requestedAt: string;
  candidateRef?: string;
  detailRef?: string;
}

export interface PointableCandidateView {
  candidateRef: string;
  label: string;
  entityType: string;
  summary: string;
}

export interface PointableFactView {
  label: string;
  value: string;
}

export interface PointableSourceView {
  label: string;
}

export interface PointableChangeView {
  label: string;
  before: string;
  after: string;
}

export type PointablePresentationMode = "record" | "narrative" | "mental-model";

export interface PointableEvidenceView {
  excerpt: string;
  source: string;
}

export interface PointableComprehensionView {
  kind: "concept";
  meaning: string;
  context: string;
  boundary: string;
  sequence: string[];
  currentStep: number;
  evidence: PointableEvidenceView[];
}

export interface PointableDetailView {
  entityId: string;
  entityType: string;
  label: string;
  summary: string;
  revision: string;
  observedAt: string;
  freshness: "current" | "stale" | "partial" | "unknown";
  facts: PointableFactView[];
  sources: PointableSourceView[];
  humanSummary?: string;
  comprehension?: PointableComprehensionView;
  detailRef?: string;
  changes?: PointableChangeView[];
}

export interface PointableRevisionView {
  detailRef: string;
  state: "unchanged" | "updated" | "deleted" | "unavailable";
  checkedAt: string;
}

export type PointableLookupPresentation =
  | { kind: "candidates"; candidates: PointableCandidateView[] }
  | { kind: "detail"; detail: PointableDetailView }
  | { kind: "revision"; revision: PointableRevisionView }
  | {
      kind: "error";
      code: string;
      message: string;
      retryable: boolean;
    };

export interface PointableLookupResponseV1 {
  schemaVersion: typeof POINTABLE_PROTOCOL_VERSION;
  kind: "pointable.selection.result";
  requestId: string;
  selectionGeneration: number;
  selectionDigest: string;
  contextFingerprint: string;
  presentation: PointableLookupPresentation;
}

export class PointableProtocolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PointableProtocolError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function boundedString(
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

function requiredString(
  value: unknown,
  field: string,
  maximum: number,
): string {
  if (!boundedString(value, 1, maximum)) {
    throw new PointableProtocolError(
      "invalid_lookup_result",
      `${field} must be a bounded printable string`,
    );
  }
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function parsePointableLookupIntent(
  payload: string,
): PointableLookupIntentV1 {
  if (payload.length === 0 || payload.length > MAX_BINDING_PAYLOAD_CHARS) {
    throw new PointableProtocolError(
      "binding_payload_invalid",
      "binding payload is empty or exceeds its size limit",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new PointableProtocolError(
      "binding_payload_invalid",
      "binding payload is not valid JSON",
    );
  }
  if (!record(parsed)) {
    throw new PointableProtocolError(
      "binding_payload_invalid",
      "binding payload must be an object",
    );
  }
  if (!exactKeys(parsed, [
    "schemaVersion",
    "kind",
    "operation",
    "requestId",
    "selectionGeneration",
    "selectionText",
    "selectionDigest",
    "surface",
    "contextFingerprint",
    "requestedAt",
    "candidateRef",
    "detailRef",
  ])) {
    throw new PointableProtocolError(
      "binding_payload_invalid",
      "binding payload contains unsupported fields",
    );
  }
  if (
    parsed.schemaVersion !== POINTABLE_PROTOCOL_VERSION ||
    parsed.kind !== "pointable.selection.lookup" ||
    (parsed.operation !== "resolve" &&
      parsed.operation !== "choose" &&
      parsed.operation !== "check" &&
      parsed.operation !== "refresh") ||
    !boundedString(parsed.requestId, 8, 128) ||
    !/^[A-Za-z0-9:_-]+$/u.test(parsed.requestId) ||
    !Number.isSafeInteger(parsed.selectionGeneration) ||
    Number(parsed.selectionGeneration) < 1 ||
    !boundedString(parsed.selectionText, 1, MAX_SELECTION_CHARS) ||
    parsed.selectionText !== parsed.selectionText.trim() ||
    !boundedString(parsed.selectionDigest, 64, 64) ||
    !/^[0-9a-f]{64}$/u.test(parsed.selectionDigest) ||
    (parsed.surface !== "assistant_message" && parsed.surface !== "user_message") ||
    !boundedString(parsed.contextFingerprint, 1, 2_048) ||
    !boundedString(parsed.requestedAt, 20, 64) ||
    !Number.isFinite(Date.parse(parsed.requestedAt))
  ) {
    throw new PointableProtocolError(
      "binding_payload_invalid",
      "binding payload fields are invalid",
    );
  }
  if (sha256(parsed.selectionText) !== parsed.selectionDigest) {
    throw new PointableProtocolError(
      "selection_digest_mismatch",
      "selection digest does not match the submitted text",
    );
  }
  const candidateRef = parsed.candidateRef;
  const detailRef = parsed.detailRef;
  if (
    (parsed.operation === "resolve" &&
      (candidateRef !== undefined || detailRef !== undefined)) ||
    (parsed.operation === "choose" &&
      (!boundedString(candidateRef, 8, 256) || detailRef !== undefined)) ||
    ((parsed.operation === "check" || parsed.operation === "refresh") &&
      (candidateRef !== undefined || !boundedString(detailRef, 8, 256)))
  ) {
    throw new PointableProtocolError(
      "binding_payload_invalid",
      "candidateRef is inconsistent with the requested operation",
    );
  }

  const intent: PointableLookupIntentV1 = {
    schemaVersion: POINTABLE_PROTOCOL_VERSION,
    kind: "pointable.selection.lookup",
    operation: parsed.operation,
    requestId: parsed.requestId,
    selectionGeneration: Number(parsed.selectionGeneration),
    selectionText: parsed.selectionText,
    selectionDigest: parsed.selectionDigest,
    surface: parsed.surface,
    contextFingerprint: parsed.contextFingerprint,
    requestedAt: parsed.requestedAt,
  };
  if (typeof candidateRef === "string") intent.candidateRef = candidateRef;
  if (typeof detailRef === "string") intent.detailRef = detailRef;
  return intent;
}

function validateCandidate(value: unknown): PointableCandidateView {
  if (!record(value) || !exactKeys(value, [
    "candidateRef",
    "label",
    "entityType",
    "summary",
  ])) {
    throw new PointableProtocolError(
      "invalid_lookup_result",
      "candidate result is invalid",
    );
  }
  return {
    candidateRef: (() => {
      if (!boundedString(value.candidateRef, 8, 256)) {
        throw new PointableProtocolError(
          "invalid_lookup_result",
          "candidateRef must be a bounded printable string",
        );
      }
      return value.candidateRef;
    })(),
    label: requiredString(value.label, "candidate label", 256),
    entityType: requiredString(value.entityType, "candidate entityType", 128),
    summary: requiredString(value.summary, "candidate summary", 1_024),
  };
}

function validateDetail(value: unknown): PointableDetailView {
  if (!record(value) || !exactKeys(value, [
    "entityId",
    "entityType",
    "label",
    "summary",
    "revision",
    "observedAt",
    "freshness",
    "facts",
    "sources",
    "humanSummary",
    "comprehension",
    "detailRef",
    "changes",
  ])) {
    throw new PointableProtocolError(
      "invalid_lookup_result",
      "detail result is invalid",
    );
  }
  if (
    value.freshness !== "current" &&
    value.freshness !== "stale" &&
    value.freshness !== "partial" &&
    value.freshness !== "unknown"
  ) {
    throw new PointableProtocolError(
      "invalid_lookup_result",
      "detail freshness is invalid",
    );
  }
  if (
    !boundedString(value.observedAt, 20, 64) ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    !Array.isArray(value.facts) ||
    value.facts.length > 5 ||
    !Array.isArray(value.sources) ||
    value.sources.length > 5 ||
    (value.humanSummary !== undefined && !boundedString(value.humanSummary, 1, 1_024)) ||
    (value.detailRef !== undefined && !boundedString(value.detailRef, 8, 256)) ||
    (value.changes !== undefined &&
      (!Array.isArray(value.changes) || value.changes.length > 3))
  ) {
    throw new PointableProtocolError(
      "invalid_lookup_result",
      "detail metadata exceeds its contract",
    );
  }
  const facts = value.facts.map((fact) => {
    if (!record(fact) || !exactKeys(fact, ["label", "value"])) {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "detail fact is invalid",
      );
    }
    return {
      label: requiredString(fact.label, "fact label", 128),
      value: requiredString(fact.value, "fact value", 1_024),
    };
  });
  const sources = value.sources.map((source) => {
    if (!record(source) || !exactKeys(source, ["label"])) {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "detail source is invalid",
      );
    }
    return { label: requiredString(source.label, "source label", 512) };
  });
  let comprehension: PointableComprehensionView | undefined;
  if (value.comprehension !== undefined) {
    const view = value.comprehension;
    if (
      !record(view) ||
      !exactKeys(view, [
        "kind",
        "meaning",
        "context",
        "boundary",
        "sequence",
        "currentStep",
        "evidence",
      ]) ||
      view.kind !== "concept" ||
      !boundedString(view.meaning, 1, 1_024) ||
      !boundedString(view.context, 1, 1_024) ||
      !boundedString(view.boundary, 1, 1_024) ||
      !Array.isArray(view.sequence) ||
      view.sequence.length < 2 ||
      view.sequence.length > 4 ||
      !view.sequence.every((item) => boundedString(item, 1, 256)) ||
      !Number.isSafeInteger(view.currentStep) ||
      Number(view.currentStep) < 0 ||
      Number(view.currentStep) >= view.sequence.length ||
      !Array.isArray(view.evidence) ||
      view.evidence.length < 1 ||
      view.evidence.length > 3
    ) {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "detail comprehension view is invalid",
      );
    }
    const evidence = view.evidence.map((item) => {
      if (
        !record(item) ||
        !exactKeys(item, ["excerpt", "source"]) ||
        !boundedString(item.excerpt, 1, 1_024) ||
        !boundedString(item.source, 1, 512)
      ) {
        throw new PointableProtocolError(
          "invalid_lookup_result",
          "detail evidence is invalid",
        );
      }
      return { excerpt: item.excerpt, source: item.source };
    });
    comprehension = {
      kind: "concept",
      meaning: view.meaning,
      context: view.context,
      boundary: view.boundary,
      sequence: [...view.sequence],
      currentStep: Number(view.currentStep),
      evidence,
    };
  }
  const changes = value.changes === undefined
    ? undefined
    : value.changes.map((change) => {
        if (!record(change) || !exactKeys(change, ["label", "before", "after"])) {
          throw new PointableProtocolError(
            "invalid_lookup_result",
            "detail change is invalid",
          );
        }
        return {
          label: requiredString(change.label, "change label", 128),
          before: requiredString(change.before, "change before", 1_024),
          after: requiredString(change.after, "change after", 1_024),
        };
      });
  return {
    entityId: requiredString(value.entityId, "entityId", 256),
    entityType: requiredString(value.entityType, "entityType", 128),
    label: requiredString(value.label, "detail label", 256),
    summary: requiredString(value.summary, "detail summary", 1_024),
    revision: requiredString(value.revision, "detail revision", 512),
    observedAt: value.observedAt,
    freshness: value.freshness,
    facts,
    sources,
    ...(typeof value.humanSummary === "string" ? { humanSummary: value.humanSummary } : {}),
    ...(comprehension === undefined ? {} : { comprehension }),
    ...(typeof value.detailRef === "string" ? { detailRef: value.detailRef } : {}),
    ...(changes === undefined ? {} : { changes }),
  };
}

export function validatePointableLookupPresentation(
  value: unknown,
): PointableLookupPresentation {
  if (!record(value) || typeof value.kind !== "string") {
    throw new PointableProtocolError(
      "invalid_lookup_result",
      "lookup callback returned an invalid presentation",
    );
  }
  if (value.kind === "candidates") {
    if (
      !exactKeys(value, ["kind", "candidates"]) ||
      !Array.isArray(value.candidates) ||
      value.candidates.length < 1 ||
      value.candidates.length > 3
    ) {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "candidate result must contain one to three candidates",
      );
    }
    const candidates = value.candidates.map(validateCandidate);
    if (new Set(candidates.map((candidate) => candidate.candidateRef)).size !== candidates.length) {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "candidate references must be unique",
      );
    }
    return { kind: "candidates", candidates };
  }
  if (value.kind === "detail") {
    if (!exactKeys(value, ["kind", "detail"])) {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "detail result contains unsupported fields",
      );
    }
    return { kind: "detail", detail: validateDetail(value.detail) };
  }
  if (value.kind === "revision") {
    if (
      !exactKeys(value, ["kind", "revision"]) ||
      !record(value.revision) ||
      !exactKeys(value.revision, ["detailRef", "state", "checkedAt"]) ||
      !boundedString(value.revision.detailRef, 8, 256) ||
      (value.revision.state !== "unchanged" &&
        value.revision.state !== "updated" &&
        value.revision.state !== "deleted" &&
        value.revision.state !== "unavailable") ||
      !boundedString(value.revision.checkedAt, 20, 64) ||
      !Number.isFinite(Date.parse(value.revision.checkedAt))
    ) {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "revision result is invalid",
      );
    }
    return {
      kind: "revision",
      revision: {
        detailRef: value.revision.detailRef,
        state: value.revision.state,
        checkedAt: value.revision.checkedAt,
      },
    };
  }
  if (value.kind === "error") {
    if (
      !exactKeys(value, ["kind", "code", "message", "retryable"]) ||
      !boundedString(value.code, 1, 128) ||
      !/^[a-z0-9_:-]+$/u.test(value.code) ||
      !boundedString(value.message, 1, 1_024) ||
      typeof value.retryable !== "boolean"
    ) {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "error result is invalid",
      );
    }
    return {
      kind: "error",
      code: value.code,
      message: value.message,
      retryable: value.retryable,
    };
  }
  throw new PointableProtocolError(
    "invalid_lookup_result",
    "lookup callback returned an unsupported presentation kind",
  );
}

export function createPointableLookupResponse(
  intent: PointableLookupIntentV1,
  presentation: PointableLookupPresentation,
): PointableLookupResponseV1 {
  return {
    schemaVersion: POINTABLE_PROTOCOL_VERSION,
    kind: "pointable.selection.result",
    requestId: intent.requestId,
    selectionGeneration: intent.selectionGeneration,
    selectionDigest: intent.selectionDigest,
    contextFingerprint: intent.contextFingerprint,
    presentation,
  };
}

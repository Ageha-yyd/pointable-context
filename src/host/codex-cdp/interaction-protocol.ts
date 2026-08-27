export const POINTABLE_INTERACTION_EVENT_KIND =
  "pointable.interaction.event" as const;

export type PointableRendererInteractionEventType =
  | "entry_presented"
  | "selection_completed"
  | "quick_action_shown"
  | "card_closed"
  | "evidence_expanded"
  | "inactive_started"
  | "inactive_ended";

export interface PointableRendererInteractionEventV1 {
  schemaVersion: 1;
  kind: typeof POINTABLE_INTERACTION_EVENT_KIND;
  rendererSequence: number;
  eventType: PointableRendererInteractionEventType;
  contextFingerprint: string;
}

export class PointableInteractionProtocolError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PointableInteractionProtocolError";
  }
}

const EVENT_TYPES = new Set<PointableRendererInteractionEventType>([
  "entry_presented",
  "selection_completed",
  "quick_action_shown",
  "card_closed",
  "evidence_expanded",
  "inactive_started",
  "inactive_ended",
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === [...expected].sort().join("|");
}

export function pointableBindingPayloadKind(
  payload: string,
): "lookup" | "interaction" | undefined {
  if (payload.length < 2 || payload.length > 4_096) return undefined;
  try {
    const value: unknown = JSON.parse(payload);
    if (!record(value)) return undefined;
    if (value.kind === "pointable.selection.lookup") return "lookup";
    if (value.kind === POINTABLE_INTERACTION_EVENT_KIND) return "interaction";
    return undefined;
  } catch {
    return undefined;
  }
}

export function parsePointableRendererInteractionEvent(
  payload: string,
): PointableRendererInteractionEventV1 {
  if (payload.length < 2 || payload.length > 4_096) {
    throw new PointableInteractionProtocolError("pointable_interaction_payload_invalid");
  }
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new PointableInteractionProtocolError("pointable_interaction_payload_invalid");
  }
  if (
    !record(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "kind",
      "rendererSequence",
      "eventType",
      "contextFingerprint",
    ]) ||
    value.schemaVersion !== 1 ||
    value.kind !== POINTABLE_INTERACTION_EVENT_KIND ||
    !Number.isSafeInteger(value.rendererSequence) ||
    Number(value.rendererSequence) < 1 ||
    Number(value.rendererSequence) > Number.MAX_SAFE_INTEGER ||
    typeof value.eventType !== "string" ||
    !EVENT_TYPES.has(value.eventType as PointableRendererInteractionEventType) ||
    typeof value.contextFingerprint !== "string" ||
    value.contextFingerprint.length < 1 ||
    value.contextFingerprint.length > 2_048 ||
    /[\p{Cc}\p{Cf}]/u.test(value.contextFingerprint)
  ) {
    throw new PointableInteractionProtocolError("pointable_interaction_payload_invalid");
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: POINTABLE_INTERACTION_EVENT_KIND,
    rendererSequence: Number(value.rendererSequence),
    eventType: value.eventType as PointableRendererInteractionEventType,
    contextFingerprint: value.contextFingerprint,
  });
}

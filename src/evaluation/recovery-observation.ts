import { createHash } from "node:crypto";

export const RECOVERY_OBSERVATION_EVENT_KIND =
  "pointable.recovery-observation.event" as const;

export type RecoveryEpisodeTrigger =
  | "dense_turn"
  | "cross_task"
  | "state_drift";

export type RecoveryObservationEventType =
  | "episode_started"
  | "entry_presented"
  | "selection_completed"
  | "quick_action_shown"
  | "object_opened"
  | "card_closed"
  | "card_refreshed"
  | "evidence_expanded"
  | "workspace_left"
  | "workspace_returned"
  | "inactive_started"
  | "inactive_ended"
  | "chat_turn_sent"
  | "lookup_failed"
  | "episode_completed"
  | "episode_aborted";

export type RecoveryLookupFailureCode =
  | "no_match"
  | "ambiguous"
  | "stale"
  | "unavailable"
  | "type_mismatch";

export type RecoveryEpisodeOutcome =
  | "resumed_correctly"
  | "resumed_incorrectly";

export interface RecoveryObservationEvent {
  schemaVersion: 1;
  kind: typeof RECOVERY_OBSERVATION_EVENT_KIND;
  episodeId: string;
  trigger: RecoveryEpisodeTrigger;
  sequence: number;
  eventType: RecoveryObservationEventType;
  monotonicMs: number;
  objectDigest?: string;
  failureCode?: RecoveryLookupFailureCode;
  outcome?: RecoveryEpisodeOutcome;
}

export interface RecoveryEpisodeDefinition {
  episodeId: string;
  trigger: RecoveryEpisodeTrigger;
  expectedObjectDigest: string;
}

export interface RecoveryEpisodeMetrics {
  episodeId: string;
  trigger: RecoveryEpisodeTrigger;
  success: boolean;
  aborted: boolean;
  outcome: RecoveryEpisodeOutcome | null;
  totalElapsedMs: number;
  activeRecoveryMs: number;
  inactiveMs: number;
  timeToFirstExpectedObjectMs: number | null;
  chatTurnCount: number;
  interactionCount: number;
  selectionCount: number;
  quickActionCount: number;
  objectOpenCount: number;
  wrongObjectCount: number;
  cardRefreshCount: number;
  evidenceExpandCount: number;
  cardDwellMs: number;
  activeCardDwellMs: number;
  navigationCount: number;
  navigationTimeMs: number;
  activeNavigationTimeMs: number;
  lookupFailureCount: number;
  lookupFailures: Readonly<Record<RecoveryLookupFailureCode, number>>;
}

export class RecoveryObservationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RecoveryObservationError";
  }
}

const EVENT_TYPES = new Set<RecoveryObservationEventType>([
  "episode_started",
  "entry_presented",
  "selection_completed",
  "quick_action_shown",
  "object_opened",
  "card_closed",
  "card_refreshed",
  "evidence_expanded",
  "workspace_left",
  "workspace_returned",
  "inactive_started",
  "inactive_ended",
  "chat_turn_sent",
  "lookup_failed",
  "episode_completed",
  "episode_aborted",
]);

const TRIGGERS = new Set<RecoveryEpisodeTrigger>([
  "dense_turn",
  "cross_task",
  "state_drift",
]);

const FAILURE_CODES = new Set<RecoveryLookupFailureCode>([
  "no_match",
  "ambiguous",
  "stale",
  "unavailable",
  "type_mismatch",
]);

const OUTCOMES = new Set<RecoveryEpisodeOutcome>([
  "resumed_correctly",
  "resumed_incorrectly",
]);

const TERMINAL_EVENTS = new Set<RecoveryObservationEventType>([
  "episode_completed",
  "episode_aborted",
]);

const MAX_EPISODE_MS = 86_400_000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const accepted = new Set(allowed);
  return Object.keys(value).every((key) => accepted.has(key));
}

function episodeId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[a-z0-9][a-z0-9_-]{3,63}$/u.test(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function boundedMilliseconds(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > MAX_EPISODE_MS) {
    throw new RecoveryObservationError("recovery_observation_time_invalid");
  }
  return Math.round(value);
}

export function digestRecoveryObjectIdentity(identity: string): string {
  if (
    identity.length < 1 ||
    identity.length > 512 ||
    /[\p{Cc}\p{Cf}]/u.test(identity)
  ) {
    throw new RecoveryObservationError("recovery_observation_identity_invalid");
  }
  return createHash("sha256")
    .update(identity.normalize("NFKC"), "utf8")
    .digest("hex");
}

export function validateRecoveryEpisodeDefinition(
  value: RecoveryEpisodeDefinition,
): RecoveryEpisodeDefinition {
  if (
    !record(value) ||
    !exactKeys(value, ["episodeId", "trigger", "expectedObjectDigest"]) ||
    !episodeId(value.episodeId) ||
    typeof value.trigger !== "string" ||
    !TRIGGERS.has(value.trigger as RecoveryEpisodeTrigger) ||
    !digest(value.expectedObjectDigest)
  ) {
    throw new RecoveryObservationError("recovery_observation_definition_invalid");
  }
  return Object.freeze({
    episodeId: value.episodeId,
    trigger: value.trigger as RecoveryEpisodeTrigger,
    expectedObjectDigest: value.expectedObjectDigest,
  });
}

export function validateRecoveryObservationEvent(
  value: unknown,
  expectedEpisodeId: string,
): RecoveryObservationEvent {
  if (
    !record(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "kind",
      "episodeId",
      "trigger",
      "sequence",
      "eventType",
      "monotonicMs",
      "objectDigest",
      "failureCode",
      "outcome",
    ]) ||
    value.schemaVersion !== 1 ||
    value.kind !== RECOVERY_OBSERVATION_EVENT_KIND ||
    value.episodeId !== expectedEpisodeId ||
    !episodeId(value.episodeId) ||
    typeof value.trigger !== "string" ||
    !TRIGGERS.has(value.trigger as RecoveryEpisodeTrigger) ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 1 ||
    typeof value.eventType !== "string" ||
    !EVENT_TYPES.has(value.eventType as RecoveryObservationEventType) ||
    typeof value.monotonicMs !== "number" ||
    !Number.isFinite(value.monotonicMs) ||
    value.monotonicMs < 0 ||
    value.monotonicMs > MAX_EPISODE_MS ||
    (value.objectDigest !== undefined && !digest(value.objectDigest)) ||
    (value.failureCode !== undefined &&
      (typeof value.failureCode !== "string" ||
        !FAILURE_CODES.has(value.failureCode as RecoveryLookupFailureCode))) ||
    (value.outcome !== undefined &&
      (typeof value.outcome !== "string" ||
        !OUTCOMES.has(value.outcome as RecoveryEpisodeOutcome)))
  ) {
    throw new RecoveryObservationError("recovery_observation_event_invalid");
  }

  const eventType = value.eventType as RecoveryObservationEventType;
  const objectFieldValid = eventType === "object_opened"
    ? value.objectDigest !== undefined
    : value.objectDigest === undefined;
  const failureFieldValid = eventType === "lookup_failed"
    ? value.failureCode !== undefined
    : value.failureCode === undefined;
  const outcomeFieldValid = eventType === "episode_completed"
    ? value.outcome !== undefined
    : value.outcome === undefined;
  if (!objectFieldValid || !failureFieldValid || !outcomeFieldValid) {
    throw new RecoveryObservationError("recovery_observation_event_fields_invalid");
  }

  return Object.freeze({
    schemaVersion: 1,
    kind: RECOVERY_OBSERVATION_EVENT_KIND,
    episodeId: value.episodeId,
    trigger: value.trigger as RecoveryEpisodeTrigger,
    sequence: Number(value.sequence),
    eventType,
    monotonicMs: value.monotonicMs,
    ...(value.objectDigest === undefined
      ? {}
      : { objectDigest: value.objectDigest as string }),
    ...(value.failureCode === undefined
      ? {}
      : { failureCode: value.failureCode as RecoveryLookupFailureCode }),
    ...(value.outcome === undefined
      ? {}
      : { outcome: value.outcome as RecoveryEpisodeOutcome }),
  });
}

export function deriveRecoveryEpisodeMetrics(
  untrustedDefinition: RecoveryEpisodeDefinition,
  untrustedEvents: readonly RecoveryObservationEvent[],
): RecoveryEpisodeMetrics {
  const definition = validateRecoveryEpisodeDefinition(untrustedDefinition);
  const events = untrustedEvents.map((event) =>
    validateRecoveryObservationEvent(event, definition.episodeId)
  );
  if (
    events.length < 2 ||
    events[0]?.eventType !== "episode_started" ||
    events[0]?.monotonicMs !== 0
  ) {
    throw new RecoveryObservationError("recovery_observation_events_incomplete");
  }

  let priorTime = -1;
  let expectedSequence = 1;
  for (const event of events) {
    if (
      event.trigger !== definition.trigger ||
      event.sequence !== expectedSequence ||
      event.monotonicMs < priorTime
    ) {
      throw new RecoveryObservationError("recovery_observation_event_order_invalid");
    }
    expectedSequence += 1;
    priorTime = event.monotonicMs;
  }

  const terminalEvents = events.filter((event) => TERMINAL_EVENTS.has(event.eventType));
  const terminal = events.at(-1);
  if (
    terminalEvents.length !== 1 ||
    terminal === undefined ||
    !TERMINAL_EVENTS.has(terminal.eventType)
  ) {
    throw new RecoveryObservationError("recovery_observation_terminal_invalid");
  }

  let inactiveStartedAt: number | undefined;
  let inactiveMs = 0;
  let navigationStartedAt: number | undefined;
  let navigationTimeMs = 0;
  let cardOpenedAt: number | undefined;
  let cardDwellMs = 0;
  let activeCardDwellMs = 0;
  let activeNavigationTimeMs = 0;
  let previousTime = 0;
  for (const event of events) {
    const interval = event.monotonicMs - previousTime;
    if (inactiveStartedAt === undefined) {
      if (cardOpenedAt !== undefined) activeCardDwellMs += interval;
      if (navigationStartedAt !== undefined) activeNavigationTimeMs += interval;
    }
    previousTime = event.monotonicMs;
    if (event.eventType === "inactive_started") {
      if (inactiveStartedAt !== undefined) {
        throw new RecoveryObservationError("recovery_observation_inactive_invalid");
      }
      inactiveStartedAt = event.monotonicMs;
    } else if (event.eventType === "inactive_ended") {
      if (inactiveStartedAt === undefined) {
        throw new RecoveryObservationError("recovery_observation_inactive_invalid");
      }
      inactiveMs += event.monotonicMs - inactiveStartedAt;
      inactiveStartedAt = undefined;
    } else if (event.eventType === "workspace_left") {
      if (navigationStartedAt !== undefined) {
        throw new RecoveryObservationError("recovery_observation_navigation_invalid");
      }
      navigationStartedAt = event.monotonicMs;
    } else if (event.eventType === "workspace_returned") {
      if (navigationStartedAt === undefined) {
        throw new RecoveryObservationError("recovery_observation_navigation_invalid");
      }
      navigationTimeMs += event.monotonicMs - navigationStartedAt;
      navigationStartedAt = undefined;
    } else if (event.eventType === "object_opened") {
      if (cardOpenedAt !== undefined) {
        throw new RecoveryObservationError("recovery_observation_card_invalid");
      }
      cardOpenedAt = event.monotonicMs;
    } else if (event.eventType === "card_closed") {
      if (cardOpenedAt === undefined) {
        throw new RecoveryObservationError("recovery_observation_card_invalid");
      }
      cardDwellMs += event.monotonicMs - cardOpenedAt;
      cardOpenedAt = undefined;
    } else if (
      (event.eventType === "card_refreshed" || event.eventType === "evidence_expanded") &&
      cardOpenedAt === undefined
    ) {
      throw new RecoveryObservationError("recovery_observation_card_invalid");
    }
  }
  if (inactiveStartedAt !== undefined) inactiveMs += terminal.monotonicMs - inactiveStartedAt;
  if (navigationStartedAt !== undefined) {
    navigationTimeMs += terminal.monotonicMs - navigationStartedAt;
  }
  if (cardOpenedAt !== undefined) cardDwellMs += terminal.monotonicMs - cardOpenedAt;

  const objectOpens = events.filter((event) => event.eventType === "object_opened");
  const firstExpectedObject = objectOpens.find((event) =>
    event.objectDigest === definition.expectedObjectDigest
  );
  const failureCounts: Record<RecoveryLookupFailureCode, number> = {
    no_match: 0,
    ambiguous: 0,
    stale: 0,
    unavailable: 0,
    type_mismatch: 0,
  };
  for (const event of events) {
    if (event.eventType === "lookup_failed" && event.failureCode !== undefined) {
      failureCounts[event.failureCode] += 1;
    }
  }

  const totalElapsedMs = boundedMilliseconds(terminal.monotonicMs);
  const outcome = terminal.eventType === "episode_completed"
    ? terminal.outcome ?? null
    : null;
  const interactionTypes = new Set<RecoveryObservationEventType>([
    "selection_completed",
    "quick_action_shown",
    "object_opened",
    "card_refreshed",
    "evidence_expanded",
  ]);

  return Object.freeze({
    episodeId: definition.episodeId,
    trigger: definition.trigger,
    success: outcome === "resumed_correctly",
    aborted: terminal.eventType === "episode_aborted",
    outcome,
    totalElapsedMs,
    activeRecoveryMs: boundedMilliseconds(totalElapsedMs - inactiveMs),
    inactiveMs: boundedMilliseconds(inactiveMs),
    timeToFirstExpectedObjectMs: firstExpectedObject === undefined
      ? null
      : boundedMilliseconds(firstExpectedObject.monotonicMs),
    chatTurnCount: events.filter((event) => event.eventType === "chat_turn_sent").length,
    interactionCount: events.filter((event) => interactionTypes.has(event.eventType)).length,
    selectionCount: events.filter((event) => event.eventType === "selection_completed").length,
    quickActionCount: events.filter((event) => event.eventType === "quick_action_shown").length,
    objectOpenCount: objectOpens.length,
    wrongObjectCount: objectOpens.filter((event) =>
      event.objectDigest !== definition.expectedObjectDigest
    ).length,
    cardRefreshCount: events.filter((event) => event.eventType === "card_refreshed").length,
    evidenceExpandCount: events.filter((event) => event.eventType === "evidence_expanded").length,
    cardDwellMs: boundedMilliseconds(cardDwellMs),
    activeCardDwellMs: boundedMilliseconds(activeCardDwellMs),
    navigationCount: events.filter((event) => event.eventType === "workspace_left").length,
    navigationTimeMs: boundedMilliseconds(navigationTimeMs),
    activeNavigationTimeMs: boundedMilliseconds(activeNavigationTimeMs),
    lookupFailureCount: events.filter((event) => event.eventType === "lookup_failed").length,
    lookupFailures: Object.freeze({ ...failureCounts }),
  });
}

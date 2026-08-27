import {
  RECOVERY_OBSERVATION_EVENT_KIND,
  RecoveryObservationError,
  deriveRecoveryEpisodeMetrics,
  validateRecoveryEpisodeDefinition,
  type RecoveryEpisodeDefinition,
  type RecoveryEpisodeMetrics,
  type RecoveryEpisodeOutcome,
  type RecoveryLookupFailureCode,
  type RecoveryObservationEvent,
} from "./recovery-observation.js";

export const RECOVERY_INTERACTION_SIGNAL_KIND =
  "pointable.recovery-observation.signal" as const;

export type RecoveryInteractionSignalEventType = Exclude<
  RecoveryObservationEvent["eventType"],
  "episode_started" | "episode_completed" | "episode_aborted"
>;

export interface RecoveryInteractionSignal {
  schemaVersion: 1;
  kind: typeof RECOVERY_INTERACTION_SIGNAL_KIND;
  eventType: RecoveryInteractionSignalEventType;
  objectDigest?: string;
  failureCode?: RecoveryLookupFailureCode;
}

export interface RecoveryObservationAcceptance {
  accepted: boolean;
  reason: "recorded" | "inactive_scope";
  eventCount: number;
}

export interface RecoveryObservationResult {
  definition: RecoveryEpisodeDefinition;
  events: readonly RecoveryObservationEvent[];
  metrics: RecoveryEpisodeMetrics;
}

interface ActiveEpisode {
  definition: RecoveryEpisodeDefinition;
  startedAt: number;
  lastMonotonicMs: number;
  events: RecoveryObservationEvent[];
}

const SIGNAL_TYPES = new Set<RecoveryInteractionSignalEventType>([
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
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scopeKey(value: string): string {
  if (value.length < 1 || value.length > 2_048 || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new RecoveryObservationError("recovery_observation_scope_invalid");
  }
  return value;
}

function validateSignal(value: unknown): RecoveryInteractionSignal {
  if (!record(value)) {
    throw new RecoveryObservationError("recovery_observation_signal_invalid");
  }
  const keys = new Set([
    "schemaVersion",
    "kind",
    "eventType",
    "objectDigest",
    "failureCode",
  ]);
  if (
    Object.keys(value).some((key) => !keys.has(key)) ||
    value.schemaVersion !== 1 ||
    value.kind !== RECOVERY_INTERACTION_SIGNAL_KIND ||
    typeof value.eventType !== "string" ||
    !SIGNAL_TYPES.has(value.eventType as RecoveryInteractionSignalEventType) ||
    (value.objectDigest !== undefined &&
      (typeof value.objectDigest !== "string" ||
        !/^[a-f0-9]{64}$/u.test(value.objectDigest))) ||
    (value.failureCode !== undefined &&
      value.failureCode !== "no_match" &&
      value.failureCode !== "ambiguous" &&
      value.failureCode !== "stale" &&
      value.failureCode !== "unavailable" &&
      value.failureCode !== "type_mismatch")
  ) {
    throw new RecoveryObservationError("recovery_observation_signal_invalid");
  }
  const eventType = value.eventType as RecoveryInteractionSignalEventType;
  if (
    (eventType === "object_opened") !== (value.objectDigest !== undefined) ||
    (eventType === "lookup_failed") !== (value.failureCode !== undefined)
  ) {
    throw new RecoveryObservationError("recovery_observation_signal_fields_invalid");
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: RECOVERY_INTERACTION_SIGNAL_KIND,
    eventType,
    ...(value.objectDigest === undefined ? {} : { objectDigest: value.objectDigest }),
    ...(value.failureCode === undefined
      ? {}
      : { failureCode: value.failureCode as RecoveryLookupFailureCode }),
  });
}

export class RecoveryObservationAdapter {
  readonly #clock: () => number;
  readonly #episodes = new Map<string, ActiveEpisode>();

  constructor(clock: () => number = () => performance.now()) {
    this.#clock = clock;
  }

  begin(scope: string, definition: RecoveryEpisodeDefinition): RecoveryObservationEvent {
    const key = scopeKey(scope);
    if (this.#episodes.has(key)) {
      throw new RecoveryObservationError("recovery_observation_scope_active");
    }
    const checked = validateRecoveryEpisodeDefinition(definition);
    const startedAt = this.#clock();
    if (!Number.isFinite(startedAt)) {
      throw new RecoveryObservationError("recovery_observation_clock_invalid");
    }
    const event: RecoveryObservationEvent = Object.freeze({
      schemaVersion: 1,
      kind: RECOVERY_OBSERVATION_EVENT_KIND,
      episodeId: checked.episodeId,
      trigger: checked.trigger,
      sequence: 1,
      eventType: "episode_started",
      monotonicMs: 0,
    });
    this.#episodes.set(key, {
      definition: checked,
      startedAt,
      lastMonotonicMs: 0,
      events: [event],
    });
    return event;
  }

  record(scope: string, value: unknown): RecoveryObservationAcceptance {
    const key = scopeKey(scope);
    const active = this.#episodes.get(key);
    if (active === undefined) {
      return Object.freeze({ accepted: false, reason: "inactive_scope", eventCount: 0 });
    }
    const signal = validateSignal(value);
    const event = this.#event(active, signal.eventType, {
      ...(signal.objectDigest === undefined ? {} : { objectDigest: signal.objectDigest }),
      ...(signal.failureCode === undefined ? {} : { failureCode: signal.failureCode }),
    });
    const sentinel = this.#terminal(
      active,
      "episode_aborted",
      undefined,
      event.sequence + 1,
    );
    deriveRecoveryEpisodeMetrics(active.definition, [...active.events, event, sentinel]);
    active.events.push(event);
    active.lastMonotonicMs = event.monotonicMs;
    return Object.freeze({
      accepted: true,
      reason: "recorded",
      eventCount: active.events.length,
    });
  }

  complete(scope: string, outcome: RecoveryEpisodeOutcome): RecoveryObservationResult {
    if (outcome !== "resumed_correctly" && outcome !== "resumed_incorrectly") {
      throw new RecoveryObservationError("recovery_observation_outcome_invalid");
    }
    return this.#finish(scope, "episode_completed", outcome);
  }

  abort(scope: string): RecoveryObservationResult {
    return this.#finish(scope, "episode_aborted");
  }

  active(scope: string): boolean {
    return this.#episodes.has(scopeKey(scope));
  }

  eventCount(scope: string): number {
    return this.#episodes.get(scopeKey(scope))?.events.length ?? 0;
  }

  #finish(
    scope: string,
    eventType: "episode_completed" | "episode_aborted",
    outcome?: RecoveryEpisodeOutcome,
  ): RecoveryObservationResult {
    const key = scopeKey(scope);
    const active = this.#episodes.get(key);
    if (active === undefined) {
      throw new RecoveryObservationError("recovery_observation_scope_inactive");
    }
    const terminal = this.#terminal(active, eventType, outcome);
    const events = Object.freeze([...active.events, terminal]);
    const metrics = deriveRecoveryEpisodeMetrics(active.definition, events);
    this.#episodes.delete(key);
    return Object.freeze({ definition: active.definition, events, metrics });
  }

  #terminal(
    active: ActiveEpisode,
    eventType: "episode_completed" | "episode_aborted",
    outcome?: RecoveryEpisodeOutcome,
    sequence?: number,
  ): RecoveryObservationEvent {
    return this.#event(
      active,
      eventType,
      outcome === undefined ? {} : { outcome },
      sequence,
    );
  }

  #event(
    active: ActiveEpisode,
    eventType: RecoveryObservationEvent["eventType"],
    fields: Pick<RecoveryObservationEvent, "objectDigest" | "failureCode" | "outcome">,
    sequence = active.events.length + 1,
  ): RecoveryObservationEvent {
    const now = this.#clock();
    if (!Number.isFinite(now)) {
      throw new RecoveryObservationError("recovery_observation_clock_invalid");
    }
    const monotonicMs = Math.max(
      active.lastMonotonicMs,
      Math.round(now - active.startedAt),
    );
    return Object.freeze({
      schemaVersion: 1,
      kind: RECOVERY_OBSERVATION_EVENT_KIND,
      episodeId: active.definition.episodeId,
      trigger: active.definition.trigger,
      sequence,
      eventType,
      monotonicMs,
      ...(fields.objectDigest === undefined ? {} : { objectDigest: fields.objectDigest }),
      ...(fields.failureCode === undefined ? {} : { failureCode: fields.failureCode }),
      ...(fields.outcome === undefined ? {} : { outcome: fields.outcome }),
    });
  }
}

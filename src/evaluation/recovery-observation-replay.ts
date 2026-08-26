import {
  deriveRecoveryEpisodeMetrics,
  digestRecoveryObjectIdentity,
  RECOVERY_OBSERVATION_EVENT_KIND,
  type RecoveryEpisodeDefinition,
  type RecoveryEpisodeMetrics,
  type RecoveryObservationEvent,
  type RecoveryObservationEventType,
} from "./recovery-observation.js";

interface SyntheticRecoveryReplay {
  name: "cross_task_success" | "state_drift_refresh" | "ambiguous_lookup_abort";
  metrics: RecoveryEpisodeMetrics;
}

function event(
  definition: RecoveryEpisodeDefinition,
  sequence: number,
  eventType: RecoveryObservationEventType,
  monotonicMs: number,
  fields: Pick<RecoveryObservationEvent, "objectDigest" | "failureCode" | "outcome"> = {},
): RecoveryObservationEvent {
  return {
    schemaVersion: 1,
    kind: RECOVERY_OBSERVATION_EVENT_KIND,
    episodeId: definition.episodeId,
    trigger: definition.trigger,
    sequence,
    eventType,
    monotonicMs,
    ...(fields.objectDigest === undefined ? {} : { objectDigest: fields.objectDigest }),
    ...(fields.failureCode === undefined ? {} : { failureCode: fields.failureCode }),
    ...(fields.outcome === undefined ? {} : { outcome: fields.outcome }),
  };
}

export function runSyntheticRecoveryObservationReplays(): readonly SyntheticRecoveryReplay[] {
  const recoveryTaskDigest = digestRecoveryObjectIdentity("Long Task Recovery Dogfood");
  const crossTask: RecoveryEpisodeDefinition = {
    episodeId: "cross-task-001",
    trigger: "cross_task",
    expectedObjectDigest: recoveryTaskDigest,
  };
  const stateDrift: RecoveryEpisodeDefinition = {
    episodeId: "state-drift-001",
    trigger: "state_drift",
    expectedObjectDigest: recoveryTaskDigest,
  };
  const ambiguous: RecoveryEpisodeDefinition = {
    episodeId: "ambiguous-001",
    trigger: "dense_turn",
    expectedObjectDigest: recoveryTaskDigest,
  };

  return Object.freeze([
    Object.freeze({
      name: "cross_task_success" as const,
      metrics: deriveRecoveryEpisodeMetrics(crossTask, [
        event(crossTask, 1, "episode_started", 0),
        event(crossTask, 2, "entry_presented", 40),
        event(crossTask, 3, "selection_completed", 120),
        event(crossTask, 4, "quick_action_shown", 140),
        event(crossTask, 5, "object_opened", 200, { objectDigest: recoveryTaskDigest }),
        event(crossTask, 6, "card_closed", 700),
        event(crossTask, 7, "episode_completed", 1_000, { outcome: "resumed_correctly" }),
      ]),
    }),
    Object.freeze({
      name: "state_drift_refresh" as const,
      metrics: deriveRecoveryEpisodeMetrics(stateDrift, [
        event(stateDrift, 1, "episode_started", 0),
        event(stateDrift, 2, "entry_presented", 30),
        event(stateDrift, 3, "object_opened", 100, { objectDigest: recoveryTaskDigest }),
        event(stateDrift, 4, "card_refreshed", 300),
        event(stateDrift, 5, "evidence_expanded", 400),
        event(stateDrift, 6, "inactive_started", 450),
        event(stateDrift, 7, "inactive_ended", 1_450),
        event(stateDrift, 8, "card_closed", 1_600),
        event(stateDrift, 9, "episode_completed", 1_800, { outcome: "resumed_correctly" }),
      ]),
    }),
    Object.freeze({
      name: "ambiguous_lookup_abort" as const,
      metrics: deriveRecoveryEpisodeMetrics(ambiguous, [
        event(ambiguous, 1, "episode_started", 0),
        event(ambiguous, 2, "entry_presented", 20),
        event(ambiguous, 3, "selection_completed", 80),
        event(ambiguous, 4, "lookup_failed", 120, { failureCode: "ambiguous" }),
        event(ambiguous, 5, "chat_turn_sent", 300),
        event(ambiguous, 6, "episode_aborted", 500),
      ]),
    }),
  ]);
}

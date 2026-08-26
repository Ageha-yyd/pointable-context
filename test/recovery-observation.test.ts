import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveRecoveryEpisodeMetrics,
  digestRecoveryObjectIdentity,
  RECOVERY_OBSERVATION_EVENT_KIND,
  validateRecoveryObservationEvent,
  type RecoveryEpisodeDefinition,
  type RecoveryObservationEvent,
  type RecoveryObservationEventType,
} from "../src/evaluation/recovery-observation.js";
import { runSyntheticRecoveryObservationReplays } from
  "../src/evaluation/recovery-observation-replay.js";

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

test("cross-task recovery derives zero-turn objective metrics", () => {
  const expectedObjectDigest = digestRecoveryObjectIdentity("Long Task Recovery Dogfood");
  const definition: RecoveryEpisodeDefinition = {
    episodeId: "cross-task-test",
    trigger: "cross_task",
    expectedObjectDigest,
  };
  const result = deriveRecoveryEpisodeMetrics(definition, [
    event(definition, 1, "episode_started", 0),
    event(definition, 2, "entry_presented", 20),
    event(definition, 3, "selection_completed", 80),
    event(definition, 4, "quick_action_shown", 100),
    event(definition, 5, "object_opened", 150, { objectDigest: expectedObjectDigest }),
    event(definition, 6, "card_closed", 600),
    event(definition, 7, "episode_completed", 900, { outcome: "resumed_correctly" }),
  ]);
  assert.equal(result.success, true);
  assert.equal(result.activeRecoveryMs, 900);
  assert.equal(result.timeToFirstExpectedObjectMs, 150);
  assert.equal(result.chatTurnCount, 0);
  assert.equal(result.interactionCount, 3);
  assert.equal(result.wrongObjectCount, 0);
  assert.equal(result.cardDwellMs, 450);
  assert.equal(result.activeCardDwellMs, 450);
});

test("state-drift recovery subtracts inactivity and retains refresh effort", () => {
  const expectedObjectDigest = digestRecoveryObjectIdentity("Long Task Recovery Dogfood");
  const wrongDigest = digestRecoveryObjectIdentity("Retired Recovery Object");
  const definition: RecoveryEpisodeDefinition = {
    episodeId: "state-drift-test",
    trigger: "state_drift",
    expectedObjectDigest,
  };
  const result = deriveRecoveryEpisodeMetrics(definition, [
    event(definition, 1, "episode_started", 0),
    event(definition, 2, "object_opened", 100, { objectDigest: wrongDigest }),
    event(definition, 3, "card_closed", 200),
    event(definition, 4, "object_opened", 250, { objectDigest: expectedObjectDigest }),
    event(definition, 5, "card_refreshed", 300),
    event(definition, 6, "evidence_expanded", 350),
    event(definition, 7, "inactive_started", 400),
    event(definition, 8, "inactive_ended", 1_400),
    event(definition, 9, "workspace_left", 1_450),
    event(definition, 10, "workspace_returned", 1_650),
    event(definition, 11, "card_closed", 1_700),
    event(definition, 12, "episode_completed", 1_800, { outcome: "resumed_correctly" }),
  ]);
  assert.equal(result.totalElapsedMs, 1_800);
  assert.equal(result.inactiveMs, 1_000);
  assert.equal(result.activeRecoveryMs, 800);
  assert.equal(result.wrongObjectCount, 1);
  assert.equal(result.cardRefreshCount, 1);
  assert.equal(result.evidenceExpandCount, 1);
  assert.equal(result.navigationCount, 1);
  assert.equal(result.navigationTimeMs, 200);
  assert.equal(result.cardDwellMs, 1_550);
  assert.equal(result.activeCardDwellMs, 550);
  assert.equal(result.activeNavigationTimeMs, 200);
});

test("lookup failures and aborts stay explicit instead of fabricating success", () => {
  const definition: RecoveryEpisodeDefinition = {
    episodeId: "failure-test",
    trigger: "dense_turn",
    expectedObjectDigest: digestRecoveryObjectIdentity("Expected Object"),
  };
  const result = deriveRecoveryEpisodeMetrics(definition, [
    event(definition, 1, "episode_started", 0),
    event(definition, 2, "selection_completed", 50),
    event(definition, 3, "lookup_failed", 100, { failureCode: "ambiguous" }),
    event(definition, 4, "chat_turn_sent", 200),
    event(definition, 5, "episode_aborted", 300),
  ]);
  assert.equal(result.success, false);
  assert.equal(result.aborted, true);
  assert.equal(result.outcome, null);
  assert.equal(result.timeToFirstExpectedObjectMs, null);
  assert.equal(result.lookupFailureCount, 1);
  assert.equal(result.lookupFailures.ambiguous, 1);
  assert.equal(result.chatTurnCount, 1);
});

test("event validation rejects content, paths, and misplaced bounded fields", () => {
  const definition: RecoveryEpisodeDefinition = {
    episodeId: "privacy-test",
    trigger: "cross_task",
    expectedObjectDigest: digestRecoveryObjectIdentity("Expected Object"),
  };
  const base = event(definition, 1, "episode_started", 0);
  assert.throws(
    () => validateRecoveryObservationEvent({ ...base, chatText: "secret" }, definition.episodeId),
    /recovery_observation_event_invalid/u,
  );
  assert.throws(
    () => validateRecoveryObservationEvent({ ...base, workspacePath: "D:\\private" }, definition.episodeId),
    /recovery_observation_event_invalid/u,
  );
  assert.throws(
    () => validateRecoveryObservationEvent({
      ...base,
      objectDigest: definition.expectedObjectDigest,
    }, definition.episodeId),
    /recovery_observation_event_fields_invalid/u,
  );
});

test("state-machine validation rejects invalid order, card, and inactivity streams", () => {
  const definition: RecoveryEpisodeDefinition = {
    episodeId: "state-machine-test",
    trigger: "state_drift",
    expectedObjectDigest: digestRecoveryObjectIdentity("Expected Object"),
  };
  assert.throws(() => deriveRecoveryEpisodeMetrics(definition, [
    event(definition, 1, "episode_started", 0),
    event(definition, 3, "episode_aborted", 10),
  ]), /recovery_observation_event_order_invalid/u);
  assert.throws(() => deriveRecoveryEpisodeMetrics(definition, [
    event(definition, 1, "episode_started", 0),
    event(definition, 2, "card_refreshed", 5),
    event(definition, 3, "episode_aborted", 10),
  ]), /recovery_observation_card_invalid/u);
  assert.throws(() => deriveRecoveryEpisodeMetrics(definition, [
    event(definition, 1, "episode_started", 0),
    event(definition, 2, "inactive_ended", 5),
    event(definition, 3, "episode_aborted", 10),
  ]), /recovery_observation_inactive_invalid/u);
});

test("synthetic recovery replays cover success, drift, and failure without human claims", () => {
  const replays = runSyntheticRecoveryObservationReplays();
  assert.deepEqual(replays.map((replay) => replay.name), [
    "cross_task_success",
    "state_drift_refresh",
    "ambiguous_lookup_abort",
  ]);
  assert.equal(replays[0]?.metrics.success, true);
  assert.equal(replays[0]?.metrics.chatTurnCount, 0);
  assert.equal(replays[1]?.metrics.activeRecoveryMs, 800);
  assert.equal(replays[1]?.metrics.cardRefreshCount, 1);
  assert.equal(replays[1]?.metrics.activeCardDwellMs, 500);
  assert.equal(replays[2]?.metrics.success, false);
  assert.equal(replays[2]?.metrics.lookupFailures.ambiguous, 1);
});

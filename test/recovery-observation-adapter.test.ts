import assert from "node:assert/strict";
import test from "node:test";
import {
  RECOVERY_INTERACTION_SIGNAL_KIND,
  RecoveryObservationAdapter,
} from "../src/evaluation/recovery-observation-adapter.js";
import { RecoveryObservationHostBridge } from "../src/evaluation/recovery-observation-host.js";
import {
  RecoveryObservationError,
  digestRecoveryObjectIdentity,
} from "../src/evaluation/recovery-observation.js";
import {
  parsePointableRendererInteractionEvent,
  pointableBindingPayloadKind,
} from "../src/host/codex-cdp/interaction-protocol.js";

const expected = digestRecoveryObjectIdentity("task:recovery-observation");

function signal(
  eventType:
    | "entry_presented"
    | "selection_completed"
    | "quick_action_shown"
    | "object_opened"
    | "card_closed"
    | "card_refreshed"
    | "evidence_expanded"
    | "inactive_started"
    | "inactive_ended"
    | "lookup_failed",
  fields: Record<string, unknown> = {},
): unknown {
  return {
    schemaVersion: 1,
    kind: RECOVERY_INTERACTION_SIGNAL_KIND,
    eventType,
    ...fields,
  };
}

test("adapter turns bounded real interaction signals into recovery metrics", () => {
  let now = 1_000;
  const adapter = new RecoveryObservationAdapter(() => now);
  adapter.begin("task-scope", {
    episodeId: "adapter_episode_1",
    trigger: "cross_task",
    expectedObjectDigest: expected,
  });
  now = 1_020;
  adapter.record("task-scope", signal("selection_completed"));
  now = 1_025;
  adapter.record("task-scope", signal("quick_action_shown"));
  now = 1_050;
  adapter.record("task-scope", signal("object_opened", { objectDigest: expected }));
  now = 1_070;
  adapter.record("task-scope", signal("evidence_expanded"));
  now = 1_080;
  adapter.record("task-scope", signal("inactive_started"));
  now = 1_180;
  adapter.record("task-scope", signal("inactive_ended"));
  now = 1_220;
  adapter.record("task-scope", signal("card_closed"));
  now = 1_250;
  const result = adapter.complete("task-scope", "resumed_correctly");

  assert.equal(result.metrics.success, true);
  assert.equal(result.metrics.totalElapsedMs, 250);
  assert.equal(result.metrics.activeRecoveryMs, 150);
  assert.equal(result.metrics.timeToFirstExpectedObjectMs, 50);
  assert.equal(result.metrics.selectionCount, 1);
  assert.equal(result.metrics.quickActionCount, 1);
  assert.equal(result.metrics.objectOpenCount, 1);
  assert.equal(result.metrics.evidenceExpandCount, 1);
  assert.equal(result.metrics.cardDwellMs, 170);
  assert.equal(result.metrics.activeCardDwellMs, 70);
  assert.equal(adapter.active("task-scope"), false);
});

test("inactive scopes are ignored and simultaneous task scopes stay isolated", () => {
  let now = 0;
  const adapter = new RecoveryObservationAdapter(() => now);
  assert.deepEqual(
    adapter.record("missing", signal("selection_completed")),
    { accepted: false, reason: "inactive_scope", eventCount: 0 },
  );
  adapter.begin("first", {
    episodeId: "adapter_episode_2",
    trigger: "dense_turn",
    expectedObjectDigest: expected,
  });
  adapter.begin("second", {
    episodeId: "adapter_episode_3",
    trigger: "state_drift",
    expectedObjectDigest: expected,
  });
  now = 10;
  adapter.record("first", signal("selection_completed"));
  assert.equal(adapter.eventCount("first"), 2);
  assert.equal(adapter.eventCount("second"), 1);
  adapter.abort("first");
  adapter.abort("second");
});

test("adapter rejects content-bearing or invalid-state signals", () => {
  const adapter = new RecoveryObservationAdapter(() => 0);
  adapter.begin("task-scope", {
    episodeId: "adapter_episode_4",
    trigger: "dense_turn",
    expectedObjectDigest: expected,
  });
  assert.throws(
    () => adapter.record("task-scope", {
      ...signal("selection_completed") as object,
      selectionText: "private Chat text",
    }),
    (error: unknown) =>
      error instanceof RecoveryObservationError &&
      error.code === "recovery_observation_signal_invalid",
  );
  assert.throws(
    () => adapter.record("task-scope", signal("evidence_expanded")),
    (error: unknown) =>
      error instanceof RecoveryObservationError &&
      error.code === "recovery_observation_card_invalid",
  );
  adapter.abort("task-scope");
});

test("host bridge uses the task fingerprint only as an in-memory routing key", () => {
  let now = 50;
  const bridge = new RecoveryObservationHostBridge(
    new RecoveryObservationAdapter(() => now),
  );
  bridge.begin("private-task-fingerprint", {
    episodeId: "adapter_episode_5",
    trigger: "cross_task",
    expectedObjectDigest: expected,
  });
  now = 75;
  bridge.observe({
    scopeKey: "private-task-fingerprint",
    signal: signal("object_opened", { objectDigest: expected }) as never,
  });
  now = 100;
  const result = bridge.complete("private-task-fingerprint", "resumed_correctly");
  assert.equal(JSON.stringify(result).includes("private-task-fingerprint"), false);
  assert.equal(result.metrics.timeToFirstExpectedObjectMs, 25);
});

test("renderer interaction protocol is strict and distinguishes binding payloads", () => {
  const payload = JSON.stringify({
    schemaVersion: 1,
    kind: "pointable.interaction.event",
    rendererSequence: 3,
    eventType: "selection_completed",
    contextFingerprint: '{"threadId":"thread-1"}',
  });
  assert.equal(pointableBindingPayloadKind(payload), "interaction");
  assert.equal(parsePointableRendererInteractionEvent(payload).rendererSequence, 3);
  assert.equal(pointableBindingPayloadKind(JSON.stringify({
    kind: "pointable.selection.lookup",
  })), "lookup");
  assert.throws(() => parsePointableRendererInteractionEvent(JSON.stringify({
    ...JSON.parse(payload) as object,
    selectionText: "must not cross the observation protocol",
  })));
});

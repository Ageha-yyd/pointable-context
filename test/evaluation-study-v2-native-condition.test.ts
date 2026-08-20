import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import type {
  CodexCdpHostAdapterOptions,
  CodexCdpHostAdapterStatus,
  PointableLookupCallback,
} from "../src/host/codex-cdp/adapter.js";
import type { CodexHostTaskContext } from "../src/host/codex-cdp/host-context.js";
import { studyV2AssignmentForSlot } from "../src/evaluation/study-v2/contracts.js";
import { startStudyV2ConditionCompanion } from "../src/evaluation/study-v2/native-condition-companion.js";
import { loadStudyV2NativeTrialMaterial } from "../src/evaluation/study-v2/native-trial-pack.js";
import { startStudyV2ScriptedTrialSurface } from "../src/evaluation/study-v2/native-scripted-trial-surface.js";
import type { StudyV2NativeEvent } from "../src/evaluation/study-v2/native-trial-protocol.js";

const runningStatus: CodexCdpHostAdapterStatus = {
  state: "running",
  endpoint: "http://127.0.0.1:9223",
  targetCount: 1,
  targets: [],
};

class FakeConditionAdapter {
  stops = 0;
  constructor(
    readonly options: CodexCdpHostAdapterOptions,
    readonly tasks: readonly CodexHostTaskContext[],
  ) {}
  async refreshTargets(): Promise<CodexCdpHostAdapterStatus> { return runningStatus; }
  async activeTasks(): Promise<CodexHostTaskContext[]> { return [...this.tasks]; }
  async stop(): Promise<CodexCdpHostAdapterStatus> {
    this.stops += 1;
    return { ...runningStatus, state: "stopped", targetCount: 0 };
  }
}

function task(threadId: string): CodexHostTaskContext {
  const routeRef = "app://-/index.html";
  const hostId = "host-1";
  return {
    schemaVersion: 1,
    host: "codex-desktop",
    threadId,
    hostId,
    routeRef,
    contextFingerprint: JSON.stringify({ href: routeRef, threadId, hostId }),
  };
}

test("condition A creates no companion or native host attachment", async () => {
  const assignment = studyV2AssignmentForSlot(1).trials[0];
  assert.ok(assignment);
  assert.equal(assignment.condition, "A");
  const material = await loadStudyV2NativeTrialMaterial(resolve("."), assignment);
  let factoryCalls = 0;
  const handle = await startStudyV2ConditionCompanion({
    assignment,
    material,
    taskThreadId: "thread-study-A",
    packDigest: "a".repeat(64),
    observedAt: "2026-08-20T09:00:00.000Z",
  }, {
    createAdapter: () => {
      factoryCalls += 1;
      throw new Error("condition A must not create an adapter");
    },
  });
  assert.equal(factoryCalls, 0);
  assert.equal(handle.mounted, false);
  assert.equal(handle.quietContextReveal, false);
  await handle.stop();
});

test("condition B mounts only on the exact active scripted task and fences lookup to it", async () => {
  const assignment = studyV2AssignmentForSlot(7).trials[0];
  assert.ok(assignment);
  assert.equal(assignment.condition, "B");
  const material = await loadStudyV2NativeTrialMaterial(resolve("."), assignment);
  const active = task("thread-study-B");
  let adapter: FakeConditionAdapter | undefined;
  let lookup: PointableLookupCallback | undefined;
  const handle = await startStudyV2ConditionCompanion({
    assignment,
    material,
    taskThreadId: active.threadId,
    packDigest: "b".repeat(64),
    observedAt: "2026-08-20T09:00:00.000Z",
  }, {
    createAdapter: (options) => {
      lookup = options.lookup;
      adapter = new FakeConditionAdapter(options, [active]);
      return adapter;
    },
  });
  assert.equal(handle.mounted, true);
  assert.equal(handle.quietContextReveal, true);
  assert.equal(adapter?.options.presentationMode, "mental-model");

  const selectionText = material.entities[0]?.label ?? "";
  const baseRequest = {
    operation: "resolve" as const,
    requestId: "request-study-1",
    selection: {
      text: selectionText,
      digest: "c".repeat(64),
      generation: 1,
      surface: "assistant_message" as const,
    },
    contextFingerprint: active.contextFingerprint,
    requestedAt: "2026-08-20T09:00:01.000Z",
    host: {
      targetId: "main-1",
      targetUrl: "app://-/index.html",
      bindingGeneration: "binding-1",
      task: active,
      revalidateTask: async () => active,
    },
    signal: new AbortController().signal,
  };
  assert.ok(lookup);
  assert.equal((await lookup(baseRequest) as { kind: string }).kind, "detail");
  const wrong = task("thread-other");
  const rejected = await lookup({
    ...baseRequest,
    contextFingerprint: wrong.contextFingerprint,
    host: { ...baseRequest.host, task: wrong, revalidateTask: async () => wrong },
  }) as { kind: string; code?: string };
  assert.equal(rejected.kind, "error");
  assert.equal(rejected.code, "study_task_context_changed");

  await handle.stop();
  await handle.stop();
  assert.equal(adapter?.stops, 1);
});

test("condition B fails closed and cleans up when another Codex task is active", async () => {
  const assignment = studyV2AssignmentForSlot(7).trials[0];
  assert.ok(assignment);
  const material = await loadStudyV2NativeTrialMaterial(resolve("."), assignment);
  const adapter = new FakeConditionAdapter({ lookup: async () => ({ kind: "error" }) }, [task("thread-other")]);
  await assert.rejects(() => startStudyV2ConditionCompanion({
    assignment,
    material,
    taskThreadId: "thread-study-B",
    packDigest: "d".repeat(64),
    observedAt: "2026-08-20T09:00:00.000Z",
  }, { createAdapter: () => adapter }), /task_not_active/u);
  assert.equal(adapter.stops, 1);
});

test("scripted trial surface mounts answer control before the condition-B companion and cleans both", async () => {
  const assignment = studyV2AssignmentForSlot(7).trials[0];
  assert.ok(assignment);
  const material = await loadStudyV2NativeTrialMaterial(resolve("."), assignment);
  const order: string[] = [];
  let answerStops = 0;
  let companionStops = 0;
  const terminal: StudyV2NativeEvent = {
    schemaVersion: 2,
    kind: "pointable.study-v2.native-event",
    trialToken: "a".repeat(64),
    sequence: 2,
    eventType: "answer_submitted",
    monotonicMs: 500,
    outcomeCode: "RESUME-B",
  };
  const handle = await startStudyV2ScriptedTrialSurface({
    assignment,
    material,
    taskThreadId: "thread-study-B",
    packDigest: "e".repeat(64),
    observedAt: "2026-08-20T09:00:00.000Z",
  }, {
    createAnswerHost: (options) => {
      assert.equal(options.surfaceMode, "answer_control");
      assert.equal(options.expectedThreadId, "thread-study-B");
      return {
        async start(config) {
          order.push("answer-start");
          assert.equal(config.history, material.history);
        },
        async activate() { order.push("answer-activate"); },
        async waitForTerminal() { return terminal; },
        async stop() { answerStops += 1; },
      };
    },
    startCompanion: async () => {
      order.push("companion-start");
      return {
        schemaVersion: 1,
        condition: "B",
        taskThreadId: "thread-study-B",
        mounted: true,
        quietContextReveal: true,
        async stop() { companionStops += 1; },
      };
    },
  });
  assert.deepEqual(order, ["answer-start", "companion-start", "answer-activate"]);
  assert.equal(handle.answerControlMounted, true);
  assert.equal(handle.quietContextCompanionMounted, true);
  assert.equal((await handle.waitForTerminal()).outcomeCode, "RESUME-B");
  await handle.stop("completed");
  await handle.stop("completed");
  assert.equal(answerStops, 1);
  assert.equal(companionStops, 1);
});

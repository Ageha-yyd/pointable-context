import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import test from "node:test";
import { studyV2AssignmentForSlot } from "../src/evaluation/study-v2/contracts.js";
import type { StudyV2DoctorResult } from "../src/evaluation/study-v2/doctor.js";
import type { StudyV2ScriptedTaskRpc } from "../src/evaluation/study-v2/native-scripted-task.js";
import type { StudyV2ScriptedRuntimeHandle } from "../src/evaluation/study-v2/native-scripted-runtime.js";
import { runStudyV2NativeSession } from "../src/evaluation/study-v2/native-session-runner.js";
import { runStudyV2NativeTrial } from "../src/evaluation/study-v2/native-trial-runner.js";
import { runStudyV2NativeTraining } from "../src/evaluation/study-v2/native-training-runner.js";
import type { StudyV2NativeEvent } from "../src/evaluation/study-v2/native-trial-protocol.js";
import { validateStudyV2Pack } from "../src/evaluation/study-v2/pack.js";
import { STUDY_V2_SCORING_CONTRACT } from "../src/evaluation/study-v2/trial-metrics.js";

const repositoryRoot = resolve(".");

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class RunnerRpc implements StudyV2ScriptedTaskRpc {
  readonly calls: Array<{ method: string; params: unknown }> = [];
  readonly turns: unknown[] = [];
  #turnIndex = 0;
  #waiter?: { predicate: (value: unknown) => boolean; resolve(value: unknown): void };

  constructor(readonly replies: readonly string[]) {}

  async request<T = unknown>(method: string, params: unknown): Promise<T> {
    this.calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread-scripted-runner" } } as T;
    if (method === "thread/name/set" || method === "thread/delete") return {} as T;
    if (method === "turn/start") {
      const reply = this.replies[this.#turnIndex];
      if (reply === undefined || !record(params) || !Array.isArray(params.input) ||
        !record(params.input[0]) || typeof params.input[0].text !== "string") {
        throw new Error("fake_turn_invalid");
      }
      this.#turnIndex += 1;
      const id = `turn-${this.#turnIndex}`;
      this.turns.push({
        id,
        items: [
          { type: "userMessage", content: [{ type: "text", text: params.input[0].text }] },
          { type: "agentMessage", text: reply },
        ],
      });
      setImmediate(() => {
        const terminal = {
          threadId: "thread-scripted-runner",
          turn: { id, status: "completed" },
        };
        if (this.#waiter?.predicate(terminal) === true) this.#waiter.resolve(terminal);
      });
      return { turn: { id } } as T;
    }
    if (method === "thread/read") {
      return { thread: { id: "thread-scripted-runner", turns: this.turns } } as T;
    }
    throw new Error(`unexpected_method:${method}`);
  }

  waitForNotification<T = unknown>(
    method: string,
    predicate: (params: unknown) => boolean = () => true,
  ): Promise<T> {
    assert.equal(method, "turn/completed");
    return new Promise<T>((resolvePromise) => {
      this.#waiter = { predicate, resolve: (value) => resolvePromise(value as T) };
    });
  }
}

async function doctor(): Promise<StudyV2DoctorResult> {
  const pack = await validateStudyV2Pack(repositoryRoot);
  assert.ok(pack.packDigest);
  return {
    schemaVersion: 2,
    studyId: "pointable-context-study-v2",
    ready: true,
    platform: "win32",
    arch: "x64",
    nodeVersion: "25.9.0",
    codexPackageVersion: "26.814.5517.0",
    packDigest: pack.packDigest,
    gates: {
      windowsX64: true,
      nodeRuntime: true,
      packIntegrity: true,
      codexBuildQualified: true,
      codexLoopbackAvailable: true,
      githubCliAvailable: true,
    },
    issues: [],
    actions: [],
  };
}

function nativeEvent(
  sequence: number,
  eventType: StudyV2NativeEvent["eventType"],
  monotonicMs: number,
  outcomeCode?: string,
): StudyV2NativeEvent {
  return {
    schemaVersion: 2,
    kind: "pointable.study-v2.native-event",
    trialToken: "a".repeat(64),
    sequence,
    eventType,
    monotonicMs,
    ...(outcomeCode === undefined ? {} : { outcomeCode }),
  };
}

test("scripted runner creates native turns, waits for the exact task, records terminal events, and cleans up", async () => {
  const assignment = studyV2AssignmentForSlot(7).trials[0];
  assert.ok(assignment);
  assert.equal(assignment.condition, "B");
  let runtime: StudyV2ScriptedRuntimeHandle | undefined;
  let runtimeStops = 0;
  let surfaceAttempts = 0;
  let surfaceStops = 0;
  let sleeps = 0;
  const ready: string[] = [];
  const result = await runStudyV2NativeTrial({
    repositoryRoot,
    sessionId: "SESSION_RUNNER_01",
    assignment,
    activationTimeoutMs: 10_000,
  }, {
    doctor,
    startRuntime: async (options) => {
      const rpc = new RunnerRpc(options.responses.map((response) => response.outputText));
      runtime = {
        rpc,
        requestCount: () => options.responses.length,
        publishTask: async (task) => ({ ...task, threadId: "thread-published-runner" }),
        createRetainedReviewTask: async (task) => {
          await rpc.request("thread/delete", { threadId: task.threadId });
          return {
            schemaVersion: 1,
            threadId: "thread-retained-runner",
            title: task.title,
            exchangeCount: task.exchangeCount,
            nativeCodexTask: true,
            liveModelInvoked: false,
            runtimeEndpointOverrideCopied: false,
          };
        },
        stop: async () => { runtimeStops += 1; },
      };
      return runtime;
    },
    onTaskReady: ({ threadId, title }) => { ready.push(threadId, title); },
    monotonicNow: (() => {
      let value = 0;
      return () => value++;
    })(),
    sleep: async () => { sleeps += 1; },
    startSurface: async (options) => {
      surfaceAttempts += 1;
      if (surfaceAttempts === 1) throw new Error("study_v2_native_task_not_active");
      await options.onEvent?.(nativeEvent(1, "trial_shown", 0));
      return {
        schemaVersion: 1,
        assignment,
        taskThreadId: options.taskThreadId,
        answerControlMounted: true,
        quietContextCompanionMounted: true,
        waitForTerminal: async () => {
          const terminal = nativeEvent(2, "answer_submitted", 1_234, "RESUME-B");
          await options.onEvent?.(terminal);
          return terminal;
        },
        stop: async () => { surfaceStops += 1; },
      };
    },
  });
  assert.deepEqual(ready, ["thread-published-runner", `Pointable Study ${assignment.trialId} · RESUME-1`]);
  assert.equal(surfaceAttempts, 2);
  assert.equal(sleeps, 1);
  assert.equal(result.terminal, "answer_submitted");
  assert.equal(result.answerCode, "RESUME-B");
  assert.equal(result.elapsedMs, 1_234);
  assert.equal(result.taskRetention, "retained");
  assert.equal(result.retainedThreadId, "thread-retained-runner");
  assert.deepEqual(result.events.map((event) => event.eventType), ["trial_shown", "answer_submitted"]);
  assert.equal(surfaceStops, 1);
  assert.equal(runtimeStops, 1);
  const rpc = runtime?.rpc as RunnerRpc;
  assert.equal(rpc.calls.filter((call) => call.method === "turn/start").length, 5);
  assert.deepEqual(rpc.calls.filter((call) => call.method === "thread/delete"), [{
    method: "thread/delete",
    params: { threadId: "thread-published-runner" },
  }]);
});

test("unscored training uses native turns and Quiet Context Reveal, then deletes its task", async () => {
  let rpc: RunnerRpc | undefined;
  let runtimeStops = 0;
  let readyThread: string | undefined;
  const result = await runStudyV2NativeTraining({
    repositoryRoot,
    participantCode: "P042",
    slot: 4,
    language: "zh-CN",
  }, {
    doctor,
    startRuntime: async (options) => {
      rpc = new RunnerRpc(options.responses.map((response) => response.outputText));
      return {
        rpc,
        requestCount: () => options.responses.length,
        publishTask: async (task) => ({ ...task, threadId: "thread-published-training" }),
        createRetainedReviewTask: async () => { throw new Error("training_must_not_be_retained"); },
        stop: async () => { runtimeStops += 1; },
      };
    },
    onTaskReady: ({ threadId }) => { readyThread = threadId; },
    startSurface: async (options) => {
      assert.equal(options.assignment.scenarioId, "TRAIN-1");
      assert.equal(options.assignment.condition, "B");
      assert.equal(options.material.language, "zh-CN");
      return {
        schemaVersion: 1,
        assignment: options.assignment,
        taskThreadId: options.taskThreadId,
        answerControlMounted: true,
        quietContextCompanionMounted: true,
        waitForTerminal: async () => nativeEvent(1, "answer_submitted", 500, "TRAIN-A"),
        stop: async () => undefined,
      };
    },
  });
  assert.equal(readyThread, "thread-published-training");
  assert.equal(result.scenarioId, "TRAIN-1");
  assert.equal(result.trainingCompleted, true);
  assert.equal(result.liveModelInvoked, false);
  assert.equal(result.quietContextReveal, true);
  assert.equal(result.taskDeleted, true);
  assert.equal(runtimeStops, 1);
  assert.deepEqual(rpc?.calls.filter((call) => call.method === "thread/delete"), [{
    method: "thread/delete",
    params: { threadId: "thread-published-training" },
  }]);
});

test("scripted runner times out before mounting a surface and still deletes only its generated task", async () => {
  const assignment = studyV2AssignmentForSlot(1).trials[0];
  assert.ok(assignment);
  let rpc: RunnerRpc | undefined;
  let runtimeStops = 0;
  const times = [0, 10_001];
  await assert.rejects(() => runStudyV2NativeTrial({
    repositoryRoot,
    sessionId: "SESSION_RUNNER_02",
    assignment,
    activationTimeoutMs: 10_000,
  }, {
    doctor,
    startRuntime: async (options) => {
      rpc = new RunnerRpc(options.responses.map((response) => response.outputText));
      return {
        rpc,
        requestCount: () => options.responses.length,
        publishTask: async (task) => ({ ...task, threadId: "thread-published-timeout" }),
        createRetainedReviewTask: async () => { throw new Error("must_not_archive"); },
        stop: async () => { runtimeStops += 1; },
      };
    },
    monotonicNow: () => times.shift() ?? 10_001,
    sleep: async () => { throw new Error("sleep_must_not_run"); },
    startSurface: async () => { throw new Error("study_v2_native_task_not_active"); },
  }), /task_activation_timed_out/u);
  assert.equal(runtimeStops, 1);
  assert.deepEqual(rpc?.calls.filter((call) => call.method === "thread/delete"), [{
    method: "thread/delete",
    params: { threadId: "thread-published-timeout" },
  }]);
});

test("formal trial can explicitly delete an answered task after recording its terminal event", async () => {
  const assignment = studyV2AssignmentForSlot(1).trials[0];
  assert.ok(assignment);
  let rpc: RunnerRpc | undefined;
  const result = await runStudyV2NativeTrial({
    repositoryRoot,
    sessionId: "SESSION_RUNNER_03",
    assignment,
    retainCompletedTask: false,
  }, {
    doctor,
    startRuntime: async (options) => {
      rpc = new RunnerRpc(options.responses.map((response) => response.outputText));
      return {
        rpc,
        requestCount: () => options.responses.length,
        publishTask: async (task) => ({ ...task, threadId: "thread-published-formal" }),
        createRetainedReviewTask: async () => { throw new Error("must_not_archive"); },
        stop: async () => undefined,
      };
    },
    startSurface: async (options) => {
      await options.onEvent?.(nativeEvent(1, "trial_shown", 0));
      return {
        schemaVersion: 1,
        assignment,
        taskThreadId: options.taskThreadId,
        answerControlMounted: true,
        quietContextCompanionMounted: false,
        waitForTerminal: async () => {
          const terminal = nativeEvent(2, "answer_submitted", 900, "RESUME-A");
          await options.onEvent?.(terminal);
          return terminal;
        },
        stop: async () => undefined,
      };
    },
  });
  assert.equal(result.taskRetention, "deleted");
  assert.equal(result.retainedThreadId, undefined);
  assert.deepEqual(rpc?.calls.filter((call) => call.method === "thread/delete"), [{
    method: "thread/delete",
    params: { threadId: "thread-published-formal" },
  }]);
});

test("six-trial session uses the scripted native runner by default and checkpoints every terminal answer", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-native-scripted-session-"));
  const readyTrials: string[] = [];
  let runtimeStarts = 0;
  let runtimeStops = 0;
  let retainedReviewTasks = 0;
  try {
    const result = await runStudyV2NativeSession({
      repositoryRoot,
      stateDirectory: join(root, "state"),
      resultDirectory: join(root, "result"),
      participantCode: "P001",
      slot: 1,
      language: "en-US",
      sessionId: "0123456789abcdef0123456789abcdef",
      runnerVersion: "study-v2.1.0",
    }, {
      doctor,
      onTrialTaskReady: ({ trial }) => { readyTrials.push(trial.trialId); },
      trialDependencies: {
        startRuntime: async (options) => {
          runtimeStarts += 1;
          const rpc = new RunnerRpc(options.responses.map((response) => response.outputText));
          return {
            rpc,
            requestCount: () => options.responses.length,
            publishTask: async (task) => ({ ...task, threadId: `thread-published-${runtimeStarts}` }),
            createRetainedReviewTask: async (task) => {
              retainedReviewTasks += 1;
              await rpc.request("thread/delete", { threadId: task.threadId });
              return {
                schemaVersion: 1,
                threadId: `thread-retained-${runtimeStarts}`,
                title: task.title,
                exchangeCount: task.exchangeCount,
                nativeCodexTask: true,
                liveModelInvoked: false,
                runtimeEndpointOverrideCopied: false,
              };
            },
            stop: async () => { runtimeStops += 1; },
          };
        },
        startSurface: async (options) => {
          if (options.assignment.scenarioId === "TRAIN-1") {
            throw new Error("measured session cannot mount training material");
          }
          const scoring = STUDY_V2_SCORING_CONTRACT[options.assignment.scenarioId];
          await options.onEvent?.(nativeEvent(1, "trial_shown", 0));
          return {
            schemaVersion: 1,
            assignment: options.assignment,
            taskThreadId: options.taskThreadId,
            answerControlMounted: true,
            quietContextCompanionMounted: options.assignment.condition === "B",
            waitForTerminal: async () => {
              const terminal = nativeEvent(2, "answer_submitted", 800, scoring.correctAnswerCode);
              await options.onEvent?.(terminal);
              return terminal;
            },
            stop: async () => undefined,
          };
        },
      },
    });
    assert.equal("state" in result ? result.state : "completed", "awaiting_questionnaire");
    assert.equal(result.executedTrialCount, 6);
    assert.equal(result.resumedTrialCount, 0);
    assert.equal(runtimeStarts, 6);
    assert.equal(runtimeStops, 6);
    assert.equal(retainedReviewTasks, 1);
    assert.equal(readyTrials.length, 6);
    for (let order = 1; order <= 6; order += 1) {
      const checkpoint = JSON.parse(await readFile(
        join(root, "state", `run-${String(order).padStart(2, "0")}.json`),
        "utf8",
      )) as { run: { terminal: string; events: unknown[]; taskRetention: string } };
      assert.equal(checkpoint.run.terminal, "answer_submitted");
      assert.equal(checkpoint.run.events.length, 2);
      assert.equal(checkpoint.run.taskRetention, order === 6 ? "retained" : "deleted");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  materializeStudyV2ScriptedTask,
  type StudyV2ScriptedExchange,
  type StudyV2ScriptedTaskRpc,
} from "../src/evaluation/study-v2/native-scripted-task.js";
import { materializeStudyV2ScriptedTrialConversation } from "../src/evaluation/study-v2/native-scripted-trial.js";
import { studyV2AssignmentForSlot } from "../src/evaluation/study-v2/contracts.js";
import { loadStudyV2NativeTrialMaterial } from "../src/evaluation/study-v2/native-trial-pack.js";
import { resolve } from "node:path";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class ScriptedRpc implements StudyV2ScriptedTaskRpc {
  readonly calls: Array<{ method: string; params: unknown }> = [];
  readonly #exchanges: readonly StudyV2ScriptedExchange[];
  #turn = 0;
  #waiter?: { predicate: (value: unknown) => boolean; resolve(value: unknown): void };
  readonly turns: unknown[] = [];
  failRead = false;
  earlyCompletion = false;
  omitCompletionThreadId = false;

  constructor(exchanges: readonly StudyV2ScriptedExchange[]) {
    this.#exchanges = exchanges;
  }

  async request<T = unknown>(method: string, params: unknown): Promise<T> {
    this.calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread-native-1" } } as T;
    if (method === "thread/name/set" || method === "thread/delete") return {} as T;
    if (method === "turn/start") {
      const exchange = this.#exchanges[this.#turn];
      if (exchange === undefined || !record(params) || !Array.isArray(params.input)) {
        throw new Error("fake_turn_invalid");
      }
      this.#turn += 1;
      const id = `turn-${this.#turn}`;
      this.turns.push({
        id,
        items: [
          { type: "userMessage", content: [{ type: "text", text: exchange.user }] },
          { type: "agentMessage", text: exchange.assistant },
        ],
      });
      const notify = () => {
        const terminal = {
          ...(this.omitCompletionThreadId ? {} : { threadId: "thread-native-1" }),
          turn: { id, status: "completed" },
        };
        if (this.#waiter?.predicate(terminal) === true) this.#waiter.resolve(terminal);
      };
      if (this.earlyCompletion) queueMicrotask(notify);
      else setImmediate(notify);
      return { turn: { id } } as T;
    }
    if (method === "thread/read") {
      return {
        thread: {
          id: "thread-native-1",
          turns: this.failRead ? [] : this.turns,
        },
      } as T;
    }
    throw new Error(`unexpected_method:${method}`);
  }

  waitForNotification<T = unknown>(
    method: string,
    predicate: (params: unknown) => boolean = () => true,
  ): Promise<T> {
    assert.equal(method, "turn/completed");
    return new Promise<T>((resolve) => {
      this.#waiter = { predicate, resolve: (value) => resolve(value as T) };
    });
  }
}

const exchanges = Object.freeze([
  Object.freeze({ user: "请说明 Gate。", assistant: "Gate 需要当前证据。" }),
  Object.freeze({ user: "下一步是什么？", assistant: "下一步是运行受控试次。" }),
]);

test("materializes fixed replies as ordinary persistent Codex turns", async () => {
  const rpc = new ScriptedRpc(exchanges);
  const result = await materializeStudyV2ScriptedTask({
    rpc,
    workspaceRoot: "D:\\study",
    title: "Controlled native task",
    model: "gpt-4.1",
    exchanges,
  });
  assert.deepEqual(result, {
    schemaVersion: 1,
    threadId: "thread-native-1",
    title: "Controlled native task",
    turnIds: ["turn-1", "turn-2"],
    exchangeCount: 2,
    nativeTurns: true,
    liveModelInvoked: false,
    desktopRendering: "requires_desktop_inspection",
  });
  assert.equal(rpc.calls.filter((call) => call.method === "turn/start").length, 2);
  assert.equal(rpc.calls.some((call) => call.method === "thread/delete"), false);
});

test("does not lose turn completion when notification precedes turn-start response", async () => {
  const rpc = new ScriptedRpc(exchanges);
  rpc.earlyCompletion = true;
  rpc.omitCompletionThreadId = true;
  const result = await materializeStudyV2ScriptedTask({
    rpc,
    workspaceRoot: "D:\\study",
    title: "Controlled native task",
    model: "gpt-4.1",
    exchanges,
  });
  assert.deepEqual(result.turnIds, ["turn-1", "turn-2"]);
});

test("deletes only its created task when transcript verification fails", async () => {
  const rpc = new ScriptedRpc(exchanges);
  rpc.failRead = true;
  await assert.rejects(() => materializeStudyV2ScriptedTask({
    rpc,
    workspaceRoot: "D:\\study",
    title: "Controlled native task",
    model: "gpt-4.1",
    exchanges,
  }), /thread_read_invalid/u);
  assert.deepEqual(rpc.calls.filter((call) => call.method === "thread/delete"), [{
    method: "thread/delete",
    params: { threadId: "thread-native-1" },
  }]);
});

test("rejects unbounded scripted material before creating a task", async () => {
  const rpc = new ScriptedRpc(exchanges);
  await assert.rejects(() => materializeStudyV2ScriptedTask({
    rpc,
    workspaceRoot: "D:\\study",
    title: "Controlled native task",
    model: "gpt-4.1",
    exchanges: [],
  }), /exchanges must contain/u);
  assert.deepEqual(rpc.calls, []);
});

test("materializes one frozen study scenario into ordinary Codex turns without mounting study UI", async () => {
  const assignment = studyV2AssignmentForSlot(1).trials[0];
  assert.ok(assignment);
  const material = await loadStudyV2NativeTrialMaterial(resolve("."), assignment);
  const rpc = new ScriptedRpc(material.conversation.exchanges);
  const result = await materializeStudyV2ScriptedTrialConversation({
    rpc,
    repositoryRoot: resolve("."),
    assignment,
    model: "gpt-4.1",
  });
  assert.equal(result.assignment.scenarioId, "RESUME-1");
  assert.equal(result.task.exchangeCount, 5);
  assert.equal(result.task.liveModelInvoked, false);
  assert.equal(result.answerControlMounted, false);
  assert.equal(result.quietContextCompanionMounted, false);
  assert.match(result.packDigest, /^[a-f0-9]{64}$/u);
  assert.ok(result.answers.some((answer) => answer.code === "RESUME-B"));
  assert.ok(result.entityTerms.some((term) => term.objectCode === "MODULE:RELAY-CACHE-ENTRY"));
  assert.equal(rpc.calls.filter((call) => call.method === "turn/start").length, 5);
});

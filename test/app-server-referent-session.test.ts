import assert from "node:assert/strict";
import test from "node:test";
import type { AppServerRpc } from "../src/app-server/referent-session.js";
import {
  askAboutReferent,
  createReferentSession,
} from "../src/app-server/referent-session.js";
import type { ReferentInjectionItem } from "../src/app-server/referent.js";

const item: ReferentInjectionItem = {
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text: "referent" }],
};

class FakeRpc implements AppServerRpc {
  calls: Array<{ method: string; params: unknown }> = [];
  reads = 0;
  createTurnOnInjection = false;

  async request<T = unknown>(method: string, params: unknown): Promise<T> {
    this.calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread-1" } } as T;
    if (method === "thread/inject_items") return {} as T;
    if (method === "thread/read") {
      this.reads += 1;
      if (this.calls.some((call) => call.method === "turn/start")) {
        return {
          thread: {
            id: "thread-1",
            turns: [{
              id: "turn-1",
              items: [{ type: "agentMessage", text: "FILE:README.md|sha256:abc" }],
            }],
          },
        } as T;
      }
      return {
        thread: {
          id: "thread-1",
          turns: this.createTurnOnInjection && this.calls.some(
            (call) => call.method === "thread/inject_items",
          ) ? [{ id: "unexpected" }] : [],
        },
      } as T;
    }
    if (method === "turn/start") return { turn: { id: "turn-1" } } as T;
    throw new Error(`unexpected method: ${method}`);
  }

  async waitForNotification<T = unknown>(): Promise<T> {
    return { threadId: "thread-1", turn: { id: "turn-1" } } as T;
  }
}

test("referent injection stays on one ephemeral thread and creates no turn", async () => {
  const rpc = new FakeRpc();
  const result = await createReferentSession(rpc, "D:\\workspace", item);
  assert.deepEqual(result, {
    threadId: "thread-1",
    turnsBefore: 0,
    turnsAfter: 0,
  });
  assert.deepEqual(rpc.calls.map((call) => call.method), [
    "thread/start",
    "thread/inject_items",
    "thread/read",
  ]);
  const start = rpc.calls[0]?.params as Record<string, unknown>;
  assert.equal(start.ephemeral, true);
  assert.equal(start.sandbox, "read-only");
  const injection = rpc.calls[1]?.params as { threadId: string; items: unknown[] };
  assert.equal(injection.threadId, "thread-1");
  assert.deepEqual(injection.items, [item]);
});

test("persistent probe mode exposes the created thread for exact cleanup", async () => {
  const rpc = new FakeRpc();
  let started = "";
  await createReferentSession(rpc, "D:\\workspace", item, {
    ephemeral: false,
    onThreadStarted: (threadId) => {
      started = threadId;
    },
  });
  assert.equal(started, "thread-1");
  assert.equal((rpc.calls[0]?.params as Record<string, unknown>).ephemeral, false);
});

test("referent session rejects a host that turns injection into a user turn", async () => {
  const rpc = new FakeRpc();
  rpc.createTurnOnInjection = true;
  await assert.rejects(
    () => createReferentSession(rpc, "D:\\workspace", item),
    /referent_injection_created_turn/u,
  );
});

test("a later explicit question starts one turn on the same thread", async () => {
  const rpc = new FakeRpc();
  const response = await askAboutReferent(
    rpc,
    "thread-1",
    "Return the referent identity",
  );
  assert.equal(response.turnId, "turn-1");
  assert.equal(response.agentText, "FILE:README.md|sha256:abc");
  const start = rpc.calls.find((call) => call.method === "turn/start");
  assert.deepEqual((start?.params as { input: unknown[] }).input, [{
    type: "text",
    text: "Return the referent identity",
    text_elements: [],
  }]);
});

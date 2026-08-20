import assert from "node:assert/strict";
import test from "node:test";
import {
  createNativeConversationProbe,
  createScriptedConversationItems,
  type NativeConversationProbeRpc,
} from "../src/evaluation/study-v2/native-conversation-probe.js";

class FakeRpc implements NativeConversationProbeRpc {
  readonly calls: Array<{ method: string; params: unknown }> = [];
  turns: unknown[] = [];
  failInjection = false;

  async request<T = unknown>(method: string, params: unknown): Promise<T> {
    this.calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread-probe" } } as T;
    if (method === "thread/name/set") return {} as T;
    if (method === "thread/inject_items") {
      if (this.failInjection) throw new Error("injection failed");
      return {} as T;
    }
    if (method === "thread/read") {
      return { thread: { id: "thread-probe", turns: this.turns } } as T;
    }
    if (method === "thread/delete") return {} as T;
    throw new Error(`unexpected method: ${method}`);
  }
}

test("native conversation probe injects a persistent scripted task without invoking a model", async () => {
  const rpc = new FakeRpc();
  const result = await createNativeConversationProbe({
    rpc,
    cwd: "D:\\workspace",
    token: "a1b2c3d4",
  });
  assert.equal(result.threadId, "thread-probe");
  assert.equal(result.injectedItemCount, 4);
  assert.equal(result.turnCountAfterInjection, 0);
  assert.equal(result.injectionCreatedTurn, false);
  assert.equal(result.desktopRendering, "requires_desktop_inspection");
  assert.equal(result.modelInvoked, false);
  assert.deepEqual(rpc.calls.map((call) => call.method), [
    "thread/start",
    "thread/name/set",
    "thread/inject_items",
    "thread/read",
  ]);
  assert.equal(rpc.calls.some((call) => call.method === "turn/start"), false);
  const start = rpc.calls[0]?.params as Record<string, unknown>;
  assert.equal(start.ephemeral, false);
  assert.equal(start.sandbox, "read-only");
  const injection = rpc.calls[2]?.params as {
    threadId: string;
    items: Array<{ role: string; content: Array<{ type: string }> }>;
  };
  assert.equal(injection.threadId, "thread-probe");
  assert.deepEqual(injection.items.map((item) => item.role), [
    "user",
    "assistant",
    "user",
    "assistant",
  ]);
  assert.deepEqual(injection.items.map((item) => item.content[0]?.type), [
    "input_text",
    "output_text",
    "input_text",
    "output_text",
  ]);
});

test("native conversation probe distinguishes model history from visible turn history", async () => {
  const rpc = new FakeRpc();
  rpc.turns = [{
    id: "turn-scripted",
    items: [
      { type: "userMessage", content: [{ type: "text", text: "[PC-NATIVE-REPLAY:deadbeef:U1]" }] },
      { type: "agentMessage", text: "[PC-NATIVE-REPLAY:deadbeef:A1]" },
      { type: "userMessage", content: [{ type: "text", text: "[PC-NATIVE-REPLAY:deadbeef:U2]" }] },
      { type: "agentMessage", text: "[PC-NATIVE-REPLAY:deadbeef:A2]" },
    ],
  }];
  const result = await createNativeConversationProbe({
    rpc,
    cwd: "D:\\workspace",
    token: "deadbeef",
  });
  assert.equal(result.injectionCreatedTurn, true);
  assert.equal(result.desktopRendering, "visible_in_thread_history");
  assert.deepEqual(result.markersVisibleInTurns, result.markers);
});

test("native conversation probe deletes its exact task if setup fails", async () => {
  const rpc = new FakeRpc();
  rpc.failInjection = true;
  await assert.rejects(
    () => createNativeConversationProbe({
      rpc,
      cwd: "D:\\workspace",
      token: "cafebabe",
    }),
    /injection failed/u,
  );
  assert.deepEqual(rpc.calls.map((call) => call.method), [
    "thread/start",
    "thread/name/set",
    "thread/inject_items",
    "thread/delete",
  ]);
});

test("scripted conversation item validation rejects unbounded or markerless material", async () => {
  assert.throws(() => createScriptedConversationItems([
    { role: "user", text: "only one" },
  ]), /messages must contain/u);
  const rpc = new FakeRpc();
  await assert.rejects(
    () => createNativeConversationProbe({
      rpc,
      cwd: "D:\\workspace",
      token: "feedface",
      messages: [
        { role: "user", text: "no marker" },
        { role: "assistant", text: "still no marker" },
      ],
    }),
    /marker_missing/u,
  );
  assert.equal(rpc.calls.length, 0);
});

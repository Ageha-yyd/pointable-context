import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { startConversationHttpServer } from "../src/app-server/conversation-http.js";
import {
  PointableConversationService,
  type ConversationRpc,
} from "../src/app-server/conversation-service.js";

class HttpFakeRpc implements ConversationRpc {
  readonly listeners = new Set<(method: string, params: unknown) => void>();
  waiter: ((value: unknown) => void) | undefined;
  turns: unknown[] = [];

  async request<T = unknown>(method: string): Promise<T> {
    if (method === "thread/start") return { thread: { id: "thread-http" } } as T;
    if (method === "thread/inject_items") return {} as T;
    if (method === "turn/start") {
      queueMicrotask(() => {
        for (const listener of this.listeners) listener("item/agentMessage/delta", {
          threadId: "thread-http", turnId: "turn-http", delta: "流式回答",
        });
        this.turns = [{ id: "turn-http", items: [{ type: "agentMessage", text: "流式回答完成" }] }];
        this.waiter?.({ threadId: "thread-http", turn: { id: "turn-http", status: "completed" } });
      });
      return { turn: { id: "turn-http" } } as T;
    }
    if (method === "thread/read") return { thread: { id: "thread-http", turns: this.turns } } as T;
    if (method === "thread/delete") return {} as T;
    throw new Error(`unexpected method ${method}`);
  }

  waitForNotification<T = unknown>(): Promise<T> {
    return new Promise<T>((resolveWaiter) => { this.waiter = (value) => resolveWaiter(value as T); });
  }

  onNotification(listener: (method: string, params: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

test("loopback client serves a CSP UI and gates state, lookup, reference, and SSE turn APIs", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-http-"));
  await writeFile(join(root, "README.md"), "# HTTP fixture\n", "utf8");
  const rpc = new HttpFakeRpc();
  const service = await PointableConversationService.start({ rpc, workspaceRoot: root });
  const server = await startConversationHttpServer({
    service,
    assetsRoot: resolve("web"),
    deleteThreadOnStop: true,
  });
  try {
    const page = await fetch(server.origin);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'none'/u);
    assert.match(await page.text(), /App Server conversation client/u);

    const denied = await fetch(`${server.origin}/api/state`);
    assert.equal(denied.status, 404);

    const headers = { "X-Pointable-Token": server.token };
    const state = await fetch(`${server.origin}/api/state`, { headers });
    assert.equal(state.status, 200);
    assert.equal((await state.json() as { threadId: string }).threadId, "thread-http");

    const lookup = await fetch(`${server.origin}/api/lookup`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "README.md", surface: "user_message", generation: 1 }),
    });
    const lookupBody = await lookup.json() as { kind: string; detail: { detailRef: string } };
    assert.equal(lookupBody.kind, "detail");

    const reference = await fetch(`${server.origin}/api/reference`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ detailRef: lookupBody.detail.detailRef }),
    });
    assert.equal(reference.status, 200);

    const turn = await fetch(`${server.origin}/api/turn`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "解释这个引用" }),
    });
    const stream = await turn.text();
    assert.match(stream, /event: delta\ndata: \{"delta":"流式回答"\}/u);
    assert.match(stream, /event: done/u);
    assert.match(stream, /流式回答完成/u);

    const oversized = await fetch(`${server.origin}/api/lookup`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "x".repeat(17_000), surface: "user_message", generation: 2 }),
    });
    assert.equal(oversized.status, 400);
  } finally {
    await server.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("browser assets keep project data text-only and selection explicitly click-gated", async () => {
  const script = await (await import("node:fs/promises")).readFile(
    resolve("web", "conversation-client.js"),
    "utf8",
  );
  assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML/u);
  assert.match(script, /event\.isTrusted/u);
  assert.match(script, /selectionchange/u);
  assert.match(script, /\/api\/lookup/u);
  assert.match(script, /\/api\/reference/u);
  assert.match(script, /parseSseBlock/u);
  assert.match(script, /parsed\.event === "delta"/u);
});

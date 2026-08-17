import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ConversationRpc } from "../src/app-server/conversation-service.js";
import { PointableConversationService } from "../src/app-server/conversation-service.js";

interface Waiter {
  method: string;
  predicate(value: unknown): boolean;
  resolve(value: unknown): void;
}

class FakeConversationRpc implements ConversationRpc {
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly listeners = new Set<(method: string, params: unknown) => void>();
  readonly waiters: Waiter[] = [];
  readonly turns: Array<Record<string, unknown>> = [];
  deleted = false;

  async request<T = unknown>(method: string, params: unknown): Promise<T> {
    this.requests.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread-conversation-1" } } as T;
    if (method === "thread/inject_items") return {} as T;
    if (method === "thread/delete") {
      this.deleted = true;
      return {} as T;
    }
    if (method === "turn/start") {
      const id = `turn-${this.turns.length + 1}`;
      const response = { turn: { id, status: "inProgress", items: [] } };
      queueMicrotask(() => {
        this.emit("item/agentMessage/delta", {
          threadId: "thread-conversation-1",
          turnId: id,
          delta: "已读取引用",
        });
        this.turns.push({
          id,
          items: [{ type: "agentMessage", text: "已读取引用：README.md" }],
        });
        this.emit("turn/completed", {
          threadId: "thread-conversation-1",
          turn: { id, status: "completed", items: [] },
        });
      });
      return response as T;
    }
    if (method === "thread/read") {
      return { thread: { id: "thread-conversation-1", turns: this.turns } } as T;
    }
    throw new Error(`unexpected method: ${method}`);
  }

  waitForNotification<T = unknown>(
    method: string,
    predicate: (params: unknown) => boolean = () => true,
  ): Promise<T> {
    return new Promise<T>((resolve) => {
      this.waiters.push({ method, predicate, resolve: (value) => resolve(value as T) });
    });
  }

  onNotification(listener: (method: string, params: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(method: string, params: unknown): void {
    for (const listener of this.listeners) listener(method, params);
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index];
      if (waiter !== undefined && waiter.method === method && waiter.predicate(params)) {
        this.waiters.splice(index, 1);
        waiter.resolve(params);
      }
    }
  }
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pointable-conversation-"));
  await writeFile(join(root, "README.md"), "# Pointable\n\nStable context.\n", "utf8");
  await writeFile(join(root, "package.json"), "{\"name\":\"fixture\"}\n", "utf8");
  await mkdir(join(root, "a"));
  await mkdir(join(root, "b"));
  await writeFile(join(root, "a", "shared.md"), "alpha\n", "utf8");
  await writeFile(join(root, "b", "shared.md"), "beta\n", "utf8");
  return root;
}

test("same-surface service looks up, references without a turn, then streams one explicit turn", async () => {
  const root = await workspace();
  const rpc = new FakeConversationRpc();
  try {
    const service = await PointableConversationService.start({ rpc, workspaceRoot: root });
    assert.equal(service.state().threadId, "thread-conversation-1");
    assert.deepEqual(service.state().messages, []);

    const lookup = await service.lookup({
      text: "README.md",
      surface: "assistant_message",
      generation: 1,
    });
    assert.equal(lookup.kind, "detail");
    if (lookup.kind !== "detail") return;
    assert.equal(lookup.detail.entityId, "file:README.md");
    assert.equal(lookup.detail.freshness, "current");
    assert.equal(rpc.requests.filter((request) => request.method === "turn/start").length, 0);
    assert.equal(rpc.requests.filter((request) => request.method === "thread/inject_items").length, 0);

    const chip = await service.reference(lookup.detail.detailRef);
    assert.equal(chip.entityId, "file:README.md");
    assert.equal(service.state().referents.length, 1);
    assert.equal(rpc.requests.filter((request) => request.method === "thread/inject_items").length, 1);
    assert.equal(rpc.requests.filter((request) => request.method === "turn/start").length, 0);

    let streamed = "";
    const answer = await service.sendMessage("这个引用是什么？", (delta) => { streamed += delta; });
    assert.equal(streamed, "已读取引用");
    assert.equal(answer.text, "已读取引用：README.md");
    assert.deepEqual(service.state().messages.map((message) => message.role), ["user", "assistant"]);
    assert.equal(rpc.requests.filter((request) => request.method === "turn/start").length, 1);

    await service.deleteThread();
    assert.equal(rpc.deleted, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ambiguous file names require a bound opaque candidate choice", async () => {
  const root = await workspace();
  const rpc = new FakeConversationRpc();
  try {
    const service = await PointableConversationService.start({ rpc, workspaceRoot: root });
    const candidates = await service.lookup({
      text: "shared.md",
      surface: "user_message",
      generation: 1,
    });
    assert.equal(candidates.kind, "candidates");
    if (candidates.kind !== "candidates") return;
    assert.equal(candidates.candidates.length, 2);
    assert.match(candidates.candidates[0]?.candidateRef ?? "", /^pcand:[A-Za-z0-9_-]{43}$/u);

    const detail = await service.lookup({
      text: "shared.md",
      surface: "user_message",
      generation: 1,
      candidateRef: candidates.candidates[0]?.candidateRef,
    });
    assert.equal(detail.kind, "detail");
    assert.equal(rpc.requests.filter((request) => request.method === "turn/start").length, 0);

    const replay = await service.lookup({
      text: "shared.md",
      surface: "user_message",
      generation: 1,
      candidateRef: candidates.candidates[0]?.candidateRef,
    });
    assert.deepEqual(replay, {
      kind: "error",
      code: "candidate_ref_invalid",
      message: "候选引用无效或已过期。",
      retryable: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("newer selections supersede stale grants and detail references are one-shot", async () => {
  const root = await workspace();
  const rpc = new FakeConversationRpc();
  try {
    const service = await PointableConversationService.start({ rpc, workspaceRoot: root });
    const first = await service.lookup({ text: "README.md", surface: "user_message", generation: 1 });
    assert.equal(first.kind, "detail");
    await service.lookup({ text: "package.json", surface: "user_message", generation: 2 });
    if (first.kind !== "detail") return;
    await assert.rejects(() => service.reference(first.detail.detailRef), /detail_ref_invalid_or_expired/u);
    const stale = await service.lookup({ text: "README.md", surface: "user_message", generation: 1 });
    assert.equal(stale.kind, "error");
    if (stale.kind === "error") assert.equal(stale.code, "selection_superseded");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("abandoning a streamed request interrupts the active App Server turn", async () => {
  const root = await workspace();
  let interrupted = false;
  const listeners = new Set<(method: string, params: unknown) => void>();
  const rpc: ConversationRpc = {
    async request<T = unknown>(method: string): Promise<T> {
      if (method === "thread/start") return { thread: { id: "thread-abort" } } as T;
      if (method === "turn/start") return { turn: { id: "turn-abort" } } as T;
      if (method === "turn/interrupt") {
        interrupted = true;
        return {} as T;
      }
      throw new Error(`unexpected method: ${method}`);
    },
    waitForNotification<T = unknown>(): Promise<T> {
      return new Promise<T>(() => undefined);
    },
    onNotification(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  try {
    const service = await PointableConversationService.start({ rpc, workspaceRoot: root });
    const controller = new AbortController();
    const pending = service.sendMessage("长时间任务", () => undefined, controller.signal);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await assert.rejects(pending, /request_aborted/u);
    assert.equal(interrupted, true);
    assert.deepEqual(service.state().messages, []);
    assert.equal(service.state().status, "ready");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

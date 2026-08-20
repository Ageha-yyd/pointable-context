import assert from "node:assert/strict";
import test from "node:test";
import {
  StudyV2DesktopAppServerRpc,
} from "../src/evaluation/study-v2/desktop-app-server-rpc.js";
import {
  createStudyV2RetainedReviewTask,
  publishStudyV2ScriptedTask,
  studyV2PublishedThreadForkParams,
  studyV2RetainedThreadForkParams,
  studyV2ScriptedThreadStartParams,
} from "../src/evaluation/study-v2/native-scripted-runtime.js";
import type {
  CdpConnection,
  CdpEvent,
} from "../src/host/codex-cdp/transport.js";
import type { PointableFetch } from "../src/host/codex-cdp/targets.js";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function targetFetch(): PointableFetch {
  return async () => new Response(JSON.stringify([{
    id: "desktop-main",
    type: "page",
    title: "Codex",
    url: "app://-/index.html",
    webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/desktop-main",
  }]), { status: 200 });
}

function requestFromExpression(expression: string): {
  method: string;
  params: unknown;
} | undefined {
  const matched = /const request = (\{.*\});\n/u.exec(expression);
  if (matched?.[1] === undefined) return undefined;
  const value = JSON.parse(matched[1]) as unknown;
  if (!record(value) || typeof value.method !== "string") return undefined;
  return { method: value.method, params: value.params };
}

class DesktopCdp implements CdpConnection {
  readonly requests: Array<{ method: string; params: unknown }> = [];
  #listeners = new Set<(event: CdpEvent) => void | Promise<void>>();
  #closeListeners = new Set<(error: Error) => void | Promise<void>>();
  #closed = false;
  #readCount = 0;
  #turns: Array<Record<string, unknown>> = [];

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.#closed) throw new Error("fake_closed");
    if (method === "Page.getFrameTree") {
      return { frameTree: { frame: { id: "frame-main", url: "app://-/index.html" } } };
    }
    if (method === "Runtime.enable") {
      await this.emit({
        method: "Runtime.executionContextCreated",
        params: {
          context: { id: 77, auxData: { isDefault: true, frameId: "frame-main" } },
        },
      });
      return {};
    }
    if (method === "Runtime.evaluate") {
      const expression = String(params.expression);
      if (expression.includes("window.electronBridge?.sendMessageFromView")) {
        return this.runtimeValue({ bridge: true, windowType: "main" });
      }
      if (expression.includes("data-app-action-sidebar-thread-id")) {
        return this.runtimeValue(true);
      }
      const request = requestFromExpression(expression);
      if (request === undefined) throw new Error("fake_request_unreadable");
      this.requests.push(request);
      if (request.method === "thread/start") {
        return this.runtimeValue({
          ok: true,
          result: { thread: { id: "desktop-thread-1" }, modelProvider: "pointable" },
        });
      }
      if (request.method === "thread/fork") {
        return this.runtimeValue({
          ok: true,
          result: {
            thread: {
              id: "desktop-thread-fork-1",
              forkedFromId: "desktop-thread-1",
              modelProvider: "openai",
              turns: this.#turns,
            },
            modelProvider: "openai",
          },
        });
      }
      if (request.method === "thread/name/set" || request.method === "thread/delete") {
        return this.runtimeValue({ ok: true, result: {} });
      }
      if (request.method === "turn/start") {
        const id = `desktop-turn-${this.#turns.length + 1}`;
        this.#turns.push({ id, status: "inProgress", items: [] });
        return this.runtimeValue({ ok: true, result: { turn: { id } } });
      }
      if (request.method === "thread/read") {
        this.#readCount += 1;
        if (this.#readCount === 1) {
          return this.runtimeValue({
            ok: false,
            error: { code: "desktop_app_server_error", message: "rollout is empty" },
          });
        }
        if (this.#readCount >= 3) {
          this.#turns = this.#turns.map((turn) => ({ ...turn, status: "completed" }));
        }
        return this.runtimeValue({
          ok: true,
          result: { thread: { id: "desktop-thread-1", turns: this.#turns } },
        });
      }
    }
    return {};
  }

  onEvent(listener: (event: CdpEvent) => void | Promise<void>): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onClose(listener: (error: Error) => void | Promise<void>): () => void {
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }

  isClosed(): boolean {
    return this.#closed;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const listener of this.#closeListeners) void listener(new Error("fake_closed"));
    this.#closeListeners.clear();
  }

  private async emit(event: CdpEvent): Promise<void> {
    await Promise.all([...this.#listeners].map(async (listener) => listener(event)));
  }

  private runtimeValue(value: unknown): unknown {
    return { result: { value } };
  }
}

test("Desktop RPC creates and polls turns through the current Codex renderer bridge", async () => {
  const connection = new DesktopCdp();
  const rpc = await StudyV2DesktopAppServerRpc.connect({
    fetch: targetFetch(),
    connect: async () => connection,
    pollIntervalMs: 10,
    requestTimeoutMs: 1_000,
  });
  try {
    const started = await rpc.request<{ thread: { id: string } }>("thread/start", {
      cwd: "D:\\study",
      model: "gpt-4.1",
    });
    assert.equal(started.thread.id, "desktop-thread-1");
    const completion = rpc.waitForNotification<{ turn: { id: string; status: string } }>(
      "turn/completed",
      () => true,
      1_000,
    );
    const turn = await rpc.request<{ turn: { id: string } }>("turn/start", {
      threadId: "desktop-thread-1",
      input: [{ type: "text", text: "hello" }],
    });
    const terminal = await completion;
    assert.equal(terminal.turn.id, turn.turn.id);
    assert.equal(terminal.turn.status, "completed");
    assert.deepEqual(connection.requests.map((request) => request.method), [
      "thread/start",
      "turn/start",
      "thread/read",
      "thread/read",
      "thread/read",
    ]);
    await rpc.navigateToThread("desktop-thread-1");
    await assert.rejects(() => rpc.navigateToThread("bad thread id"), /navigation_thread_invalid/u);
    await assert.rejects(
      () => rpc.request("config/write", {}),
      /method_not_allowed/u,
    );
  } finally {
    await rpc.close();
  }
  await assert.rejects(
    () => rpc.request("thread/read", { threadId: "desktop-thread-1" }),
    /rpc_closed/u,
  );
});

test("scripted provider configuration is thread-scoped and loopback-only", () => {
  const params = studyV2ScriptedThreadStartParams({
    cwd: "D:\\study",
    model: "gpt-4.1",
    ephemeral: false,
  }, "http://127.0.0.1:49123", "gpt-4.1");
  assert.equal(params.modelProvider, "pointable");
  assert.equal(params.model, "gpt-4.1");
  assert.deepEqual(params.config, {
    "model_providers.pointable": {
      name: "Pointable scripted",
      base_url: "http://127.0.0.1:49123/v1",
      wire_api: "responses",
      requires_openai_auth: false,
      supports_websockets: false,
    },
    "features.plugins": false,
    "features.apps": false,
    model_supports_reasoning_summaries: false,
    model_context_window: 32_768,
  });
  assert.throws(
    () => studyV2ScriptedThreadStartParams({}, "https://example.com", "gpt-4.1"),
    /origin_invalid/u,
  );
  assert.throws(
    () => studyV2ScriptedThreadStartParams(
      { modelProvider: "openai" },
      "http://127.0.0.1:49123",
      "gpt-4.1",
    ),
    /override_conflict/u,
  );
});

test("Desktop RPC allowlists a persistent history-only thread fork", async () => {
  const connection = new DesktopCdp();
  const rpc = await StudyV2DesktopAppServerRpc.connect({
    fetch: targetFetch(),
    connect: async () => connection,
    requestTimeoutMs: 1_000,
  });
  try {
    const forked = await rpc.request<{
      thread: { id: string; forkedFromId: string; modelProvider: string };
      modelProvider: string;
    }>("thread/fork", {
      threadId: "desktop-thread-1",
      modelProvider: "openai",
      model: "gpt-5.6-sol",
      ephemeral: false,
    });
    assert.deepEqual(forked, {
      thread: {
        id: "desktop-thread-fork-1",
        forkedFromId: "desktop-thread-1",
        modelProvider: "openai",
        turns: [],
      },
      modelProvider: "openai",
    });
    assert.deepEqual(connection.requests, [{
      method: "thread/fork",
      params: {
        threadId: "desktop-thread-1",
        modelProvider: "openai",
        model: "gpt-5.6-sol",
        ephemeral: false,
      },
    }]);
  } finally {
    await rpc.close();
  }
});

test("retained review task forks the visible turns without copying the local endpoint override", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const source = {
    schemaVersion: 1 as const,
    threadId: "active-study-thread",
    title: "Completed study task",
    turnIds: ["turn-1"],
    exchangeCount: 1,
    nativeTurns: true as const,
    liveModelInvoked: false as const,
    desktopRendering: "requires_desktop_inspection" as const,
  };
  const rpc = {
    async request<T = unknown>(method: string, params: unknown): Promise<T> {
      calls.push({ method, params });
      if (method === "thread/fork") {
        return {
          modelProvider: "openai",
          thread: {
            id: "retained-review-thread",
            forkedFromId: source.threadId,
            modelProvider: "openai",
          },
        } as T;
      }
      if (method === "thread/read") {
        return {
          thread: {
            id: "retained-review-thread",
            modelProvider: "openai",
            turns: [{ id: "turn-1" }],
          },
        } as T;
      }
      return {} as T;
    },
    async waitForNotification<T = unknown>(): Promise<T> {
      throw new Error("not_used");
    },
  };
  const retained = await createStudyV2RetainedReviewTask(
    rpc,
    source,
  );
  assert.deepEqual(retained, {
    schemaVersion: 1,
    threadId: "retained-review-thread",
    title: source.title,
    exchangeCount: 1,
    nativeCodexTask: true,
    liveModelInvoked: false,
    runtimeEndpointOverrideCopied: false,
  });
  assert.deepEqual(calls.map((call) => call.method), [
    "thread/fork",
    "thread/name/set",
    "thread/read",
    "thread/delete",
  ]);
  const forked = calls[0]?.params as Record<string, unknown>;
  assert.deepEqual(forked, studyV2RetainedThreadForkParams(source.threadId));
  assert.equal(forked.modelProvider, "openai");
  assert.equal(forked.ephemeral, false);
  assert.deepEqual(forked.config, {
    "features.plugins": false,
    "features.apps": false,
  });
  assert.equal(JSON.stringify(forked).includes("openai_base_url"), false);
  assert.equal(JSON.stringify(forked).includes("model_providers"), false);
});

test("published task fork is normal-provider, loopback-locked, history-checked, then replaces its source", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const source = {
    schemaVersion: 1 as const,
    threadId: "source-thread",
    title: "Persistent study task",
    turnIds: ["turn-1", "turn-2"],
    exchangeCount: 2,
    nativeTurns: true as const,
    liveModelInvoked: false as const,
    desktopRendering: "requires_desktop_inspection" as const,
  };
  const rpc = {
    async request<T = unknown>(method: string, params: unknown): Promise<T> {
      calls.push({ method, params });
      if (method === "thread/fork") {
        return {
          modelProvider: "openai",
          thread: {
            id: "published-thread",
            forkedFromId: "source-thread",
            modelProvider: "openai",
          },
        } as T;
      }
      if (method === "thread/read") {
        return {
          thread: {
            id: "published-thread",
            modelProvider: "openai",
            turns: [{ id: "turn-1" }, { id: "turn-2" }],
          },
        } as T;
      }
      return {} as T;
    },
    async waitForNotification<T = unknown>(): Promise<T> {
      throw new Error("not_used");
    },
  };
  const published = await publishStudyV2ScriptedTask(
    rpc,
    source,
    "http://127.0.0.1:49123",
  );
  assert.equal(published.threadId, "published-thread");
  assert.deepEqual(calls, [
    {
      method: "thread/fork",
      params: studyV2PublishedThreadForkParams("source-thread", "http://127.0.0.1:49123"),
    },
    { method: "thread/name/set", params: { threadId: "published-thread", name: source.title } },
    { method: "thread/read", params: { threadId: "published-thread", includeTurns: true } },
    { method: "thread/delete", params: { threadId: "source-thread" } },
  ]);
  const fork = calls[0]?.params as Record<string, unknown>;
  assert.equal(fork.modelProvider, "openai");
  assert.equal(fork.ephemeral, false);
  assert.deepEqual(fork.config, {
    openai_base_url: "http://127.0.0.1:49123/v1",
    "features.plugins": false,
    "features.apps": false,
    model_supports_reasoning_summaries: false,
    model_context_window: 32_768,
  });
});

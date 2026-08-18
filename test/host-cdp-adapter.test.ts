import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  CodexCdpHostAdapter,
  type PointableLookupCallbackRequest,
} from "../src/host/codex-cdp/adapter.js";
import type {
  CdpConnection,
  CdpEvent,
} from "../src/host/codex-cdp/transport.js";
import type { PointableFetch } from "../src/host/codex-cdp/targets.js";

interface RecordedCommand {
  method: string;
  params: Record<string, unknown>;
}

class FakeCdpConnection implements CdpConnection {
  readonly commands: RecordedCommand[] = [];
  readonly ordering: string[] = [];
  readonly fenceResults: boolean[] = [];
  #listeners = new Set<(event: CdpEvent) => void | Promise<void>>();
  #closeListeners = new Set<(error: Error) => void | Promise<void>>();
  #closed = false;
  #bindingName = "";
  hostTaskResult: unknown = {
    schemaVersion: 1,
    host: "codex-desktop",
    threadId: "thread-1",
    hostId: "host-1",
    routeRef: "app://-/index.html",
    contextFingerprint:
      '{"href":"app://-/index.html","threadId":"thread-1","hostId":"host-1"}',
  };

  constructor(
    readonly contextId = 101,
    readonly lifecycleId = "lifecycle-test-1",
    readonly uninstallBarrier?: Promise<void>,
  ) {}

  async send(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    if (this.#closed) throw new Error("fake socket is closed");
    this.commands.push({ method, params });
    if (method === "Page.getFrameTree") {
      return {
        frameTree: {
          frame: { id: "main-frame-1", url: "app://-/index.html" },
        },
      };
    }
    if (method === "Runtime.enable") {
      await this.emit({
        method: "Runtime.executionContextCreated",
        params: {
          context: {
            id: this.contextId,
            auxData: { isDefault: true, frameId: "main-frame-1" },
          },
        },
      });
      return {};
    }
    if (method === "Runtime.addBinding") {
      this.#bindingName = String(params.name);
      return {};
    }
    if (method === "Runtime.evaluate") {
      const expression = String(params.expression);
      if (expression.includes("const install =")) {
        return this.#runtimeValue({
          installed: true,
          bindingName: this.#bindingName,
          lifecycleId: this.lifecycleId,
          state: "idle",
          selectionGeneration: 0,
          pendingRequestCount: 0,
          actionCount: 0,
          cardCount: 0,
        });
      }
      if (expression.includes(".verifyFence?.")) {
        this.ordering.push("verify");
        return this.#runtimeValue(this.fenceResults.shift() ?? true);
      }
      if (expression.includes("data-app-action-sidebar-thread-active")) {
        return this.#runtimeValue(this.hostTaskResult);
      }
      if (expression.includes(".receiveResult?.")) {
        this.ordering.push("deliver");
        return this.#runtimeValue({
          ok: true,
          requestId: "request-12345678",
          outcome: "applied",
        });
      }
      if (expression.includes(".uninstall?.")) {
        this.ordering.push("uninstall");
        await this.uninstallBarrier;
        return this.#runtimeValue(null);
      }
    }
    return {};
  }

  onEvent(listener: (event: CdpEvent) => void | Promise<void>): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onClose(listener: (error: Error) => void | Promise<void>): () => void {
    if (this.#closed) return () => undefined;
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }

  async emit(event: CdpEvent): Promise<void> {
    await Promise.all([...this.#listeners].map(async (listener) => listener(event)));
  }

  isClosed(): boolean {
    return this.#closed;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    const error = new Error("fake socket closed");
    for (const listener of this.#closeListeners) {
      void listener(error);
    }
    this.#closeListeners.clear();
  }

  #runtimeValue(value: unknown): unknown {
    return { result: { type: typeof value, value } };
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function targetFetch(): PointableFetch {
  return async (input) => {
    assert.equal(String(input), "http://127.0.0.1:9223/json/list");
    return new Response(JSON.stringify([{
      id: "main-1",
      type: "page",
      title: "Codex",
      url: "app://-/index.html",
      webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/main-1",
    }]), { status: 200 });
  };
}

function lookupPayload(
  bindingName: string,
  overrides: Record<string, unknown> = {},
  executionContextId = 101,
): CdpEvent {
  const selectionText = "GOV-1";
  return {
    method: "Runtime.bindingCalled",
    params: {
      name: bindingName,
      executionContextId,
      payload: JSON.stringify({
        schemaVersion: 1,
        kind: "pointable.selection.lookup",
        operation: "resolve",
        requestId: "request-12345678",
        selectionGeneration: 3,
        selectionText,
        selectionDigest: digest(selectionText),
        surface: "assistant_message",
        contextFingerprint:
          '{"href":"app://-/index.html","threadId":"thread-1","hostId":"host-1"}',
        requestedAt: "2026-08-17T08:10:00.000Z",
        ...overrides,
      }),
    },
  };
}

function detailPresentation(): unknown {
  return {
    kind: "detail",
    detail: {
      entityId: "WU:GOV-1",
      entityType: "work_unit",
      label: "GOV-1",
      summary: "建立 AEN harness 基础及入口约束",
      revision: "r18",
      observedAt: "2026-08-17T08:10:00.000Z",
      freshness: "stale",
      facts: [{ label: "状态", value: "completed" }],
      sources: [{ label: "fixture" }],
    },
  };
}

async function startedAdapter(
  connection: FakeCdpConnection,
  lookup: (request: Readonly<PointableLookupCallbackRequest>) => Promise<unknown>,
  limits: {
    lookupTimeoutMs?: number;
    maxConcurrentLookupsPerTarget?: number;
    presentationMode?: "record" | "narrative" | "mental-model";
  } = {},
): Promise<CodexCdpHostAdapter> {
  const adapter = new CodexCdpHostAdapter({
    lookup,
    fetch: targetFetch(),
    connect: async (websocket) => {
      assert.equal(websocket, "ws://127.0.0.1:9223/devtools/page/main-1");
      return connection;
    },
    ...limits,
  });
  const status = await adapter.start();
  assert.equal(status.state, "running");
  assert.equal(status.targetCount, 1);
  return adapter;
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("test condition timed out");
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

test("adapter installs a namespaced renderer and removes it cleanly", async () => {
  const connection = new FakeCdpConnection();
  const adapter = await startedAdapter(
    connection,
    async () => detailPresentation(),
    { presentationMode: "mental-model" },
  );
  assert.deepEqual(
    connection.commands.slice(0, 4).map((command) => command.method),
    ["Page.enable", "Page.getFrameTree", "Runtime.enable", "Runtime.addBinding"],
  );
  const install = connection.commands.find((command) =>
    command.method === "Runtime.evaluate" &&
    String(command.params.expression).includes("const install ="));
  assert.ok(install);
  assert.match(String(install.params.expression), /__pointableContextRenderer/u);
  assert.match(String(install.params.expression), /"presentationMode":"mental-model"/u);

  const bindingName = adapter.status().targets[0]?.bindingName;
  assert.match(bindingName ?? "", /^__pointableContextBinding_/u);
  assert.deepEqual(await adapter.activeTasks(), [{
    schemaVersion: 1,
    host: "codex-desktop",
    threadId: "thread-1",
    hostId: "host-1",
    routeRef: "app://-/index.html",
    contextFingerprint:
      '{"href":"app://-/index.html","threadId":"thread-1","hostId":"host-1"}',
  }]);
  const stopped = await adapter.stop();
  assert.equal(stopped.state, "stopped");
  assert.equal(stopped.targetCount, 0);
  assert.equal(connection.isClosed(), true);
  assert.ok(connection.commands.some((command) =>
    command.method === "Runtime.removeBinding" && command.params.name === bindingName));
  assert.ok(connection.ordering.includes("uninstall"));
});

test("adapter revalidates the renderer DOM fence before and after callback", async () => {
  const connection = new FakeCdpConnection();
  const callbackRequests: PointableLookupCallbackRequest[] = [];
  const adapter = await startedAdapter(connection, async (request) => {
    connection.ordering.push("callback");
    callbackRequests.push(request as PointableLookupCallbackRequest);
    return detailPresentation();
  });
  connection.fenceResults.push(true, true);
  const bindingName = adapter.status().targets[0]?.bindingName;
  assert.ok(bindingName);
  await connection.emit(lookupPayload(bindingName));

  assert.deepEqual(connection.ordering, ["verify", "callback", "verify", "deliver"]);
  assert.equal(callbackRequests.length, 1);
  assert.equal(callbackRequests[0]?.selection.text, "GOV-1");
  assert.equal(callbackRequests[0]?.host.targetId, "main-1");
  assert.deepEqual(callbackRequests[0]?.host.task, {
    schemaVersion: 1,
    host: "codex-desktop",
    threadId: "thread-1",
    hostId: "host-1",
    routeRef: "app://-/index.html",
    contextFingerprint:
      '{"href":"app://-/index.html","threadId":"thread-1","hostId":"host-1"}',
  });
  const delivery = [...connection.commands].reverse().find((command) =>
    command.method === "Runtime.evaluate" &&
    String(command.params.expression).includes(".receiveResult?."));
  assert.ok(delivery);
  const expression = String(delivery.params.expression);
  assert.match(expression, /request-12345678/u);
  assert.match(expression, new RegExp(digest("GOV-1"), "u"));
  assert.match(expression, /thread-1/u);
  assert.match(expression, /lifecycle-test-1/u);
  assert.equal(
    connection.commands
      .filter((command) => command.method === "Runtime.evaluate")
      .every((command) => command.params.contextId === 101),
    true,
  );
  await adapter.stop();
});

test("a failed pre-callback DOM fence suppresses lookup and delivery", async () => {
  const connection = new FakeCdpConnection();
  let callbackCount = 0;
  const adapter = await startedAdapter(connection, async () => {
    callbackCount += 1;
    return detailPresentation();
  });
  connection.fenceResults.push(false);
  const bindingName = adapter.status().targets[0]?.bindingName;
  assert.ok(bindingName);
  await connection.emit(lookupPayload(bindingName));
  assert.equal(callbackCount, 0);
  assert.deepEqual(connection.ordering, ["verify"]);
  await adapter.stop();
});

test("host task fingerprint drift suppresses lookup before provider work", async () => {
  const connection = new FakeCdpConnection();
  connection.hostTaskResult = {
    schemaVersion: 1,
    host: "codex-desktop",
    threadId: "thread-2",
    hostId: "host-1",
    routeRef: "app://-/index.html",
    contextFingerprint:
      '{"href":"app://-/index.html","threadId":"thread-2","hostId":"host-1"}',
  };
  let callbackCount = 0;
  const adapter = await startedAdapter(connection, async () => {
    callbackCount += 1;
    return detailPresentation();
  });
  connection.fenceResults.push(true);
  const bindingName = adapter.status().targets[0]?.bindingName;
  assert.ok(bindingName);
  await connection.emit(lookupPayload(bindingName));
  assert.equal(callbackCount, 0);
  assert.deepEqual(connection.ordering, ["verify"]);
  await adapter.stop();
});

test("context drift after callback suppresses stale delivery", async () => {
  const connection = new FakeCdpConnection();
  let callbackCount = 0;
  const adapter = await startedAdapter(connection, async () => {
    connection.ordering.push("callback");
    callbackCount += 1;
    return detailPresentation();
  });
  connection.fenceResults.push(true, false);
  const bindingName = adapter.status().targets[0]?.bindingName;
  assert.ok(bindingName);
  await connection.emit(lookupPayload(bindingName));
  assert.equal(callbackCount, 1);
  assert.deepEqual(connection.ordering, ["verify", "callback", "verify"]);
  assert.equal(connection.commands.some((command) =>
    command.method === "Runtime.evaluate" &&
    String(command.params.expression).includes(".receiveResult?.")), false);
  await adapter.stop();
});

test("invalid or wrong-binding payloads never reach lookup", async () => {
  const connection = new FakeCdpConnection();
  let callbackCount = 0;
  const adapter = await startedAdapter(connection, async () => {
    callbackCount += 1;
    return detailPresentation();
  });
  const bindingName = adapter.status().targets[0]?.bindingName;
  assert.ok(bindingName);
  await connection.emit({
    method: "Runtime.bindingCalled",
    params: { name: bindingName, payload: "not-json" },
  });
  await connection.emit({
    ...lookupPayload(bindingName),
    params: {
      ...lookupPayload(bindingName).params,
      name: "__anotherBinding",
    },
  });
  assert.equal(callbackCount, 0);
  assert.deepEqual(connection.ordering, []);
  await adapter.stop();
});

test("per-target reservation bounds work before any extra pre-fence call", async () => {
  const connection = new FakeCdpConnection();
  let callbackCount = 0;
  let releaseFirst: (() => void) | undefined;
  const firstResult = new Promise<unknown>((resolve) => {
    releaseFirst = () => resolve(detailPresentation());
  });
  const adapter = await startedAdapter(connection, async () => {
    connection.ordering.push("callback");
    callbackCount += 1;
    return firstResult;
  }, { maxConcurrentLookupsPerTarget: 1 });
  const bindingName = adapter.status().targets[0]?.bindingName;
  assert.ok(bindingName);
  connection.fenceResults.push(true, true, true);

  const first = connection.emit(lookupPayload(bindingName));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(callbackCount, 1);
  for (let index = 0; index < 100; index += 1) {
    await connection.emit(lookupPayload(bindingName, {
      requestId: `request-flood-${index}`,
      selectionGeneration: index + 4,
    }));
  }
  assert.equal(callbackCount, 1);
  assert.deepEqual(connection.ordering, ["verify", "callback"]);
  assert.equal(connection.commands.some((command) =>
    command.method === "Runtime.evaluate" &&
    String(command.params.expression).includes("lookup_capacity")), false);

  releaseFirst?.();
  await first;
  await adapter.stop();
});

test("wrong execution contexts cannot invoke lookup", async () => {
  const connection = new FakeCdpConnection();
  let callbackCount = 0;
  const adapter = await startedAdapter(connection, async () => {
    callbackCount += 1;
    return detailPresentation();
  });
  const bindingName = adapter.status().targets[0]?.bindingName;
  assert.ok(bindingName);
  await connection.emit(lookupPayload(bindingName, {}, 999));
  assert.equal(callbackCount, 0);
  assert.deepEqual(connection.ordering, []);
  await adapter.stop();
});

test("stop wins a start race even when connect ignores its AbortSignal", async () => {
  const lateConnection = new FakeCdpConnection();
  let releaseConnection: ((connection: CdpConnection) => void) | undefined;
  const adapter = new CodexCdpHostAdapter({
    lookup: async () => detailPresentation(),
    fetch: targetFetch(),
    connect: async () => await new Promise<CdpConnection>((resolve) => {
      releaseConnection = resolve;
    }),
  });
  const starting = adapter.start();
  await waitUntil(() => releaseConnection !== undefined);
  const stopped = await adapter.stop();
  assert.equal(stopped.state, "stopped");
  assert.equal(stopped.targetCount, 0);
  assert.deepEqual(await starting, stopped);
  assert.equal(lateConnection.commands.length, 0);

  releaseConnection?.(lateConnection);
  await waitUntil(() => lateConnection.isClosed());
  assert.equal(adapter.status().state, "stopped");
  assert.equal(adapter.status().targetCount, 0);
});

test("concurrent stop callers await the same teardown", async () => {
  let releaseUninstall: (() => void) | undefined;
  const uninstallBarrier = new Promise<void>((resolve) => {
    releaseUninstall = resolve;
  });
  const connection = new FakeCdpConnection(
    101,
    "lifecycle-concurrent-stop",
    uninstallBarrier,
  );
  const adapter = await startedAdapter(connection, async () => detailPresentation());
  const firstStop = adapter.stop();
  await waitUntil(() => connection.ordering.includes("uninstall"));
  const secondStop = adapter.stop();
  assert.equal(secondStop, firstStop);
  let secondSettled = false;
  void secondStop.then(() => {
    secondSettled = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(secondSettled, false);
  assert.equal(connection.isClosed(), false);

  releaseUninstall?.();
  const [firstStatus, secondStatus] = await Promise.all([firstStop, secondStop]);
  assert.deepEqual(secondStatus, firstStatus);
  assert.equal(connection.isClosed(), true);
});

test("unexpected websocket close reconnects and replaces a stale renderer", async () => {
  const first = new FakeCdpConnection(101, "lifecycle-first");
  const second = new FakeCdpConnection(202, "lifecycle-second");
  const connections = [first, second];
  let connectCount = 0;
  const adapter = new CodexCdpHostAdapter({
    lookup: async () => detailPresentation(),
    fetch: targetFetch(),
    connect: async () => {
      const connection = connections[connectCount];
      connectCount += 1;
      if (connection === undefined) throw new Error("unexpected reconnect");
      return connection;
    },
  });
  await adapter.start();
  first.close();
  await waitUntil(() =>
    adapter.status().targets[0]?.rendererLifecycleId === "lifecycle-second");
  assert.equal(connectCount, 2);
  assert.equal(adapter.status().targets[0]?.executionContextId, 202);
  const secondInstall = second.commands.find((command) =>
    command.method === "Runtime.evaluate" &&
    String(command.params.expression).includes("const install ="));
  assert.ok(secondInstall);
  assert.match(String(secondInstall.params.expression), /existingApi\.uninstall/u);
  await adapter.stop();
});

for (const invalidation of [
  {
    name: "execution context clear",
    event: { method: "Runtime.executionContextsCleared" } satisfies CdpEvent,
  },
  {
    name: "main-frame navigation",
    event: {
      method: "Page.frameNavigated",
      params: {
        frame: { id: "main-frame-1", url: "app://-/index.html" },
      },
    } satisfies CdpEvent,
  },
]) {
  test(`${invalidation.name} aborts the lifecycle and installs a fresh one`, async () => {
    const first = new FakeCdpConnection(101, "lifecycle-before");
    const second = new FakeCdpConnection(303, "lifecycle-after");
    const connections = [first, second];
    let connectCount = 0;
    const adapter = new CodexCdpHostAdapter({
      lookup: async () => detailPresentation(),
      fetch: targetFetch(),
      connect: async () => {
        const connection = connections[connectCount];
        connectCount += 1;
        if (connection === undefined) throw new Error("unexpected reconnect");
        return connection;
      },
    });
    await adapter.start();
    await first.emit(invalidation.event);
    await waitUntil(() =>
      adapter.status().targets[0]?.rendererLifecycleId === "lifecycle-after");
    assert.equal(connectCount, 2);
    assert.equal(first.isClosed(), true);
    assert.equal(adapter.status().targets[0]?.executionContextId, 303);
    await adapter.stop();
  });
}

test("lookup timeout aborts the callback signal and returns a retryable error", async () => {
  const connection = new FakeCdpConnection();
  let callbackSignal: AbortSignal | undefined;
  const adapter = await startedAdapter(connection, async (request) => {
    connection.ordering.push("callback");
    callbackSignal = request.signal;
    return await new Promise<unknown>((resolve) => {
      request.signal.addEventListener("abort", () => resolve(detailPresentation()), {
        once: true,
      });
    });
  }, { lookupTimeoutMs: 100 });
  const bindingName = adapter.status().targets[0]?.bindingName;
  assert.ok(bindingName);
  connection.fenceResults.push(true, true);
  await connection.emit(lookupPayload(bindingName));

  assert.equal(callbackSignal?.aborted, true);
  const timeoutDelivery = connection.commands.find((command) =>
    command.method === "Runtime.evaluate" &&
    String(command.params.expression).includes("lookup_timeout"));
  assert.ok(timeoutDelivery);
  assert.match(String(timeoutDelivery.params.expression), /查询超时，请重试/u);
  await adapter.stop();
});

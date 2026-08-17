import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWorkspaceCompanion } from "../src/host/codex-cdp/workspace-companion.js";
import { CodexTaskWorkspaceBindingRegistry } from "../src/host/codex-cdp/task-workspace-binding.js";
import type { CdpConnection, CdpEvent } from "../src/host/codex-cdp/transport.js";

class CompanionConnection implements CdpConnection {
  #events = new Set<(event: CdpEvent) => void | Promise<void>>();
  #closes = new Set<(error: Error) => void | Promise<void>>();
  #closed = false;
  #bindingName = "";

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === "Page.getFrameTree") {
      return { frameTree: { frame: { id: "main", url: "app://-/index.html" } } };
    }
    if (method === "Runtime.enable") {
      await this.emit({
        method: "Runtime.executionContextCreated",
        params: { context: { id: 1, auxData: { isDefault: true, frameId: "main" } } },
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
        return this.value({
          installed: true,
          bindingName: this.#bindingName,
          lifecycleId: "lifecycle-workspace",
          state: "idle",
        });
      }
      if (expression.includes("data-app-action-sidebar-thread-active")) {
        return this.value({
          schemaVersion: 1,
          host: "codex-desktop",
          threadId: "thread-1",
          hostId: "host-1",
          routeRef: "app://-/index.html",
          contextFingerprint:
            '{"href":"app://-/index.html","threadId":"thread-1","hostId":"host-1"}',
        });
      }
      return this.value(null);
    }
    return {};
  }

  onEvent(listener: (event: CdpEvent) => void | Promise<void>): () => void {
    this.#events.add(listener);
    return () => this.#events.delete(listener);
  }

  onClose(listener: (error: Error) => void | Promise<void>): () => void {
    this.#closes.add(listener);
    return () => this.#closes.delete(listener);
  }

  isClosed(): boolean {
    return this.#closed;
  }

  close(): void {
    this.#closed = true;
  }

  async emit(event: CdpEvent): Promise<void> {
    await Promise.all([...this.#events].map(async (listener) => listener(event)));
  }

  value(value: unknown): unknown {
    return { result: { value } };
  }
}

function targetResponse(): Response {
  return new Response(JSON.stringify([{
    id: "target-1",
    type: "page",
    title: "Codex",
    url: "app://-/index.html",
    webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/target-1",
  }]), { status: 200 });
}

test("workspace companion binds exactly one active Codex task to a live workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-workspace-companion-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const registry = new CodexTaskWorkspaceBindingRegistry(join(root, "bindings.json"));
  const connection = new CompanionConnection();
  const companion = createWorkspaceCompanion({
    registry,
    refreshIntervalMs: 60_000,
    fetch: async () => targetResponse(),
    connect: async () => connection,
  });
  try {
    assert.equal(companion.status().state, "idle");
    const started = await companion.start();
    assert.equal(started.state, "running");
    assert.equal(started.mode, "live-local-workspace");
    assert.equal(started.activeTaskCount, 1);
    assert.equal(started.activeBinding, undefined);
    const first = await companion.bindCurrentTask(workspace);
    assert.equal(first.replaced, false);
    const entry = first.binding;
    assert.equal(entry.threadId, "thread-1");
    assert.equal(entry.workspaceRoot, workspace);
    assert.deepEqual(await registry.find({ hostId: "host-1", threadId: "thread-1" }), entry);
    assert.deepEqual(companion.status().activeBinding, entry);
    const reboundResult = await companion.bindCurrentTask(workspace);
    assert.equal(reboundResult.replaced, true);
    const rebound = reboundResult.binding;
    assert.notEqual(rebound.bindingRevision, entry.bindingRevision);
    assert.deepEqual(companion.status().activeBinding, rebound);
    assert.deepEqual(await companion.unbindCurrentTask(), rebound);
    assert.equal(companion.status().activeBinding, undefined);
    assert.equal(await registry.find({ hostId: "host-1", threadId: "thread-1" }), undefined);
    assert.equal(await companion.unbindCurrentTask(), undefined);
  } finally {
    await companion.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace companion refuses binding when no active task is host-visible", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-workspace-companion-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const companion = createWorkspaceCompanion({
    registry: new CodexTaskWorkspaceBindingRegistry(join(root, "bindings.json")),
    refreshIntervalMs: 60_000,
    fetch: async () => new Response("[]", { status: 200 }),
  });
  try {
    await companion.start();
    await assert.rejects(
      () => companion.bindCurrentTask(workspace),
      /active_codex_task_unavailable/u,
    );
  } finally {
    await companion.stop();
    await rm(root, { recursive: true, force: true });
  }
});

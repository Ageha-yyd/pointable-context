import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CodexHostTaskContext } from "../src/host/codex-cdp/host-context.js";
import {
  CodexTaskWorkspaceBindingPort,
  CodexTaskWorkspaceBindingRegistry,
  codexTaskThreadRef,
  localWorkspaceScope,
  type CodexHostTaskAuthority,
} from "../src/host/codex-cdp/task-workspace-binding.js";

function task(threadId = "thread-1"): CodexHostTaskContext {
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

async function fixture(): Promise<{
  root: string;
  workspace: string;
  registry: CodexTaskWorkspaceBindingRegistry;
}> {
  const root = await mkdtemp(join(tmpdir(), "pointable-binding-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  return {
    root,
    workspace,
    registry: new CodexTaskWorkspaceBindingRegistry(join(root, "state", "bindings.json")),
  };
}

test("explicit task binding persists a canonical opaque workspace scope", async () => {
  const item = await fixture();
  try {
    const entry = await item.registry.bind(task(), item.workspace);
    assert.equal(entry.scope.kind, "workspace");
    assert.match(entry.scope.id, /^[a-f0-9]{64}$/u);
    assert.equal(entry.scope.id, localWorkspaceScope(entry.workspaceRoot).id);
    assert.match(entry.bindingRevision, /^[a-f0-9]{64}$/u);
    const stored = await item.registry.find(task());
    assert.deepEqual(stored, entry);
    assert.equal(JSON.stringify(stored).includes(item.registry.path), false);
    const wire = JSON.parse(await readFile(item.registry.path, "utf8")) as {
      entries: unknown[];
    };
    assert.equal(wire.entries.length, 1);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("explicit unbind removes only the selected task binding", async () => {
  const item = await fixture();
  try {
    const first = task("thread-1");
    const second = task("thread-2");
    const firstEntry = await item.registry.bind(first, item.workspace);
    await item.registry.bind(second, item.workspace);
    assert.deepEqual(await item.registry.unbind(first), firstEntry);
    assert.equal(await item.registry.find(first), undefined);
    assert.notEqual(await item.registry.find(second), undefined);
    assert.equal(await item.registry.unbind(first), undefined);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("binding port trusts only the live task tuple and an explicit registry entry", async () => {
  const item = await fixture();
  try {
    const active = task();
    await item.registry.bind(active, item.workspace);
    let current: CodexHostTaskContext | undefined = active;
    const authority: CodexHostTaskAuthority = {
      current: async () => current,
    };
    const port = new CodexTaskWorkspaceBindingPort(item.registry, active, authority);
    const context = {
      selectionGeneration: 7,
      explicitScope: localWorkspaceScope(item.workspace),
      threadRef: codexTaskThreadRef(active),
      routeRef: active.routeRef,
      workspaceRoot: item.workspace,
    };
    const resolved = await port.resolve(context);
    assert.equal(resolved.kind, "trusted");
    if (resolved.kind !== "trusted") return;
    assert.equal(resolved.evidence, "explicit_user");
    assert.equal(resolved.workspaceRoot, item.workspace);
    assert.equal((await port.revalidate(resolved)).kind, "trusted");

    current = task("thread-2");
    assert.equal((await port.revalidate(resolved)).kind, "context_changed");
    assert.equal((await port.resolve(context)).kind, "missing");
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("binding port rejects caller scope/root overrides and registry rebinding", async () => {
  const item = await fixture();
  try {
    const active = task();
    await item.registry.bind(active, item.workspace);
    const authority: CodexHostTaskAuthority = { current: async () => active };
    const port = new CodexTaskWorkspaceBindingPort(item.registry, active, authority);
    const base = {
      selectionGeneration: 1,
      explicitScope: localWorkspaceScope(item.workspace),
      threadRef: codexTaskThreadRef(active),
      routeRef: active.routeRef,
      workspaceRoot: item.workspace,
    };
    const first = await port.resolve(base);
    assert.equal(first.kind, "trusted");
    assert.equal((await port.resolve({
      ...base,
      explicitScope: { ...base.explicitScope, id: "0".repeat(64) },
    })).kind, "context_changed");
    assert.equal((await port.resolve({
      ...base,
      workspaceRoot: item.root,
    })).kind, "context_changed");

    await item.registry.bind(active, item.workspace);
    if (first.kind === "trusted") {
      assert.equal((await port.revalidate(first)).kind, "context_changed");
    }
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("malformed or duplicate registry state fails closed", async () => {
  const item = await fixture();
  try {
    await mkdir(join(item.root, "state"), { recursive: true });
    await writeFile(item.registry.path, '{"schemaVersion":1,"entries":[{}]}', "utf8");
    await assert.rejects(() => item.registry.find(task()), /entry 0 is invalid/u);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

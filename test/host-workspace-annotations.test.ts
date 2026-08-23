import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ContextIndexPort, IdentityRecord } from "../src/contracts.js";
import {
  buildWorkspaceAnnotationCatalog,
  createWorkspaceAnnotationProvider,
} from "../src/host/codex-cdp/workspace-annotations.js";
import type { CodexHostTaskContext } from "../src/host/codex-cdp/host-context.js";
import { validatePointableAnnotationCatalog } from "../src/host/codex-cdp/renderer.js";
import {
  CodexTaskWorkspaceBindingRegistry,
} from "../src/host/codex-cdp/task-workspace-binding.js";

function task(): CodexHostTaskContext {
  return {
    schemaVersion: 1,
    host: "codex-desktop",
    threadId: "thread-annotations",
    hostId: "host-annotations",
    routeRef: "app://-/index.html",
    contextFingerprint: JSON.stringify({
      href: "app://-/index.html",
      threadId: "thread-annotations",
      hostId: "host-annotations",
    }),
  };
}

function record(
  entityId: string,
  entityType: string,
  canonicalName: string,
  aliases: string[] = [],
  canonicalKey = `docs/${entityId}.md`,
): IdentityRecord {
  return {
    schemaVersion: "1.0",
    scope: { kind: "workspace", namespace: "test", id: "scope-1" },
    entityId,
    entityType,
    canonicalKey,
    canonicalName,
    aliases,
    summary: `${canonicalName} summary`,
    authorityRef: { provider: "test", locator: canonicalKey },
    indexRevision: "index-1",
    indexedAt: "2026-08-23T00:00:00.000Z",
    deleted: false,
  };
}

test("annotation catalog prioritizes mental-model objects and omits ambiguous terms", () => {
  const catalog = buildWorkspaceAnnotationCatalog([
    record("task:pilot", "task", "Pilot", ["pilot", "shared"]),
    record("module:runner", "module", "runner.ts", ["runner", "shared"], "src/runner.ts"),
    record("document:notes", "document", "notes.md", ["notes"], "docs/notes.md"),
  ], "binding-1", "fingerprint-1");
  assert.equal(catalog.contextFingerprint, "fingerprint-1");
  assert.equal(catalog.entries.some((entry) => entry.term === "shared"), false);
  assert.equal(catalog.entries[0]?.entityType, "task");
  assert.equal(catalog.entries.filter((entry) => entry.objectKey === catalog.entries[0]?.objectKey)
    .some((entry) => entry.term === "Pilot"), true);
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(Object.isFrozen(catalog.entries), true);
});

test("workspace annotation provider reads only the identity index and binds the catalog to the task", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-annotations-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const registry = new CodexTaskWorkspaceBindingRegistry(join(root, "bindings.json"));
  const activeTask = task();
  const entry = await registry.bind(activeTask, workspace);
  let listCalls = 0;
  const index: ContextIndexPort = {
    list: async (binding) => {
      listCalls += 1;
      return [{
        ...record("file:docs/tasks/pilot.md", "task", "Pilot", ["pilot"], "docs/tasks/pilot.md"),
        scope: { ...binding.scope },
        authorityRef: { provider: "local-filesystem", locator: "docs/tasks/pilot.md" },
      }];
    },
  };
  try {
    const provider = createWorkspaceAnnotationProvider({ registry, index });
    const catalog = validatePointableAnnotationCatalog(await provider({
      host: {
        targetId: "target-1",
        targetUrl: "app://-/index.html",
        bindingGeneration: "binding-generation-1",
        task: activeTask,
        revalidateTask: async () => activeTask,
      },
      signal: new AbortController().signal,
    }));
    assert.ok(catalog);
    assert.equal(listCalls, 1);
    assert.equal(catalog.contextFingerprint, activeTask.contextFingerprint);
    assert.equal(catalog.entries.some((annotation) => annotation.term === "Pilot"), true);
    assert.match(catalog.revision, /^[a-f0-9]{64}$/u);
    assert.equal(entry.workspaceRoot, workspace);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

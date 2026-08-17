import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PointableLookupCallbackRequest } from "../src/host/codex-cdp/adapter.js";
import type { CodexHostTaskContext } from "../src/host/codex-cdp/host-context.js";
import { validatePointableLookupPresentation } from "../src/host/codex-cdp/protocol.js";
import { createWorkspaceLookupCallback } from "../src/host/codex-cdp/workspace-lookup.js";
import { CodexTaskWorkspaceBindingRegistry } from "../src/host/codex-cdp/task-workspace-binding.js";

function task(): CodexHostTaskContext {
  const routeRef = "app://-/index.html";
  const threadId = "thread-1";
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

function request(
  activeTask: CodexHostTaskContext,
  text: string,
  overrides: Partial<PointableLookupCallbackRequest> = {},
): PointableLookupCallbackRequest {
  return {
    operation: "resolve",
    requestId: "request-workspace-1",
    selection: {
      text,
      digest: createHash("sha256").update(text, "utf8").digest("hex"),
      generation: 1,
      surface: "assistant_message",
    },
    contextFingerprint: activeTask.contextFingerprint,
    requestedAt: new Date().toISOString(),
    host: {
      targetId: "target-1",
      targetUrl: "app://-/index.html",
      bindingGeneration: "binding-generation-1",
      task: activeTask,
      revalidateTask: async () => activeTask,
    },
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function invoke(
  callback: ReturnType<typeof createWorkspaceLookupCallback>,
  value: PointableLookupCallbackRequest,
) {
  return validatePointableLookupPresentation(await callback(value));
}

async function fixture(): Promise<{
  root: string;
  workspace: string;
  registry: CodexTaskWorkspaceBindingRegistry;
}> {
  const root = await mkdtemp(join(tmpdir(), "pointable-workspace-lookup-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  return {
    root,
    workspace,
    registry: new CodexTaskWorkspaceBindingRegistry(join(root, "bindings.json")),
  };
}

test("workspace lookup returns current detail only after explicit task binding", async () => {
  const item = await fixture();
  try {
    await writeFile(join(item.workspace, "README.md"), "# Pointable\nLive workspace context.\n", "utf8");
    const activeTask = task();
    const callback = createWorkspaceLookupCallback({ registry: item.registry });
    const before = await invoke(callback, request(activeTask, "README.md"));
    assert.equal(before.kind, "error");
    if (before.kind === "error") assert.equal(before.code, "context_binding_missing");

    await item.registry.bind(activeTask, item.workspace);
    const after = await invoke(callback, request(activeTask, "README.md"));
    assert.equal(after.kind, "detail");
    if (after.kind === "detail") {
      assert.equal(after.detail.entityId, "file:README.md");
      assert.equal(after.detail.freshness, "current");
      assert.equal(after.detail.facts.some((fact) => fact.label === "preview"), true);
      assert.equal(after.detail.sources[0]?.label, "local_workspace_file / README.md");
    }
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("workspace candidate references are one-shot and bound to task plus registry revision", async () => {
  const item = await fixture();
  try {
    await mkdir(join(item.workspace, "one"));
    await mkdir(join(item.workspace, "two"));
    await writeFile(join(item.workspace, "one", "index.ts"), "export const one = 1;", "utf8");
    await writeFile(join(item.workspace, "two", "index.ts"), "export const two = 2;", "utf8");
    const activeTask = task();
    await item.registry.bind(activeTask, item.workspace);
    const callback = createWorkspaceLookupCallback({ registry: item.registry });
    const firstRequest = request(activeTask, "index.ts");
    const candidates = await invoke(callback, firstRequest);
    assert.equal(candidates.kind, "candidates");
    if (candidates.kind !== "candidates") return;
    const candidateRef = candidates.candidates[0]?.candidateRef;
    assert.ok(candidateRef);
    const choose = request(activeTask, "index.ts", {
      operation: "choose",
      candidateRef,
      requestId: "request-workspace-choose",
    });
    assert.equal((await invoke(callback, choose)).kind, "detail");
    const replay = await invoke(callback, { ...choose, requestId: "request-workspace-replay" });
    assert.equal(replay.kind, "error");
    if (replay.kind === "error") assert.equal(replay.code, "candidate_ref_invalid");

    const secondCandidates = await invoke(callback, request(activeTask, "index.ts", {
      requestId: "request-workspace-2",
    }));
    assert.equal(secondCandidates.kind, "candidates");
    if (secondCandidates.kind !== "candidates") return;
    const staleRef = secondCandidates.candidates[0]?.candidateRef;
    assert.ok(staleRef);
    await item.registry.bind(activeTask, item.workspace);
    const staleChoose = request(activeTask, "index.ts", {
      operation: "choose",
      candidateRef: staleRef,
      requestId: "request-workspace-stale",
    });
    const stale = await invoke(callback, staleChoose);
    assert.equal(stale.kind, "error");
    if (stale.kind === "error") assert.equal(stale.code, "candidate_ref_invalid");
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("workspace lookup fails when the host task revalidation drifts", async () => {
  const item = await fixture();
  try {
    await writeFile(join(item.workspace, "README.md"), "safe", "utf8");
    const activeTask = task();
    await item.registry.bind(activeTask, item.workspace);
    const callback = createWorkspaceLookupCallback({ registry: item.registry });
    const drifted = { ...activeTask, threadId: "thread-2" };
    const result = await invoke(callback, request(activeTask, "README.md", {
      host: {
        targetId: "target-1",
        targetUrl: "app://-/index.html",
        bindingGeneration: "binding-generation-1",
        task: activeTask,
        revalidateTask: async () => drifted,
      },
    }));
    assert.equal(result.kind, "error");
    if (result.kind === "error") assert.equal(result.code, "context_binding_missing");
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

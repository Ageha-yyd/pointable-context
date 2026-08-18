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
      assert.equal(after.detail.entityType, "document");
      assert.equal(after.detail.freshness, "current");
      assert.equal(after.detail.facts.some((fact) => fact.label === "用途"), true);
      assert.match(after.detail.summary, /Live workspace context/u);
      assert.equal(after.detail.sources[0]?.label, "local_workspace_file / README.md");
      assert.match(after.detail.detailRef ?? "", /^pdet:/u);
    }
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("workspace detail detects revision drift and refreshes in place with a finite diff", async () => {
  const item = await fixture();
  try {
    const path = join(item.workspace, "README.md");
    await writeFile(path, "# Pointable\nOld context summary.\n", "utf8");
    const activeTask = task();
    await item.registry.bind(activeTask, item.workspace);
    const callback = createWorkspaceLookupCallback({ registry: item.registry });
    const initial = await invoke(callback, request(activeTask, "README.md"));
    assert.equal(initial.kind, "detail");
    if (initial.kind !== "detail") return;
    const detailRef = initial.detail.detailRef;
    assert.ok(detailRef);

    const unchanged = await invoke(callback, request(activeTask, "README.md", {
      operation: "check",
      detailRef,
      requestId: "request-workspace-check-1",
    }));
    assert.equal(unchanged.kind, "revision");
    if (unchanged.kind === "revision") assert.equal(unchanged.revision.state, "unchanged");

    await writeFile(path, "# Pointable\nNew context summary with changed behavior.\n", "utf8");
    const updated = await invoke(callback, request(activeTask, "README.md", {
      operation: "check",
      detailRef,
      requestId: "request-workspace-check-2",
    }));
    assert.equal(updated.kind, "revision");
    if (updated.kind === "revision") assert.equal(updated.revision.state, "updated");

    const refreshed = await invoke(callback, request(activeTask, "README.md", {
      operation: "refresh",
      detailRef,
      requestId: "request-workspace-refresh",
    }));
    assert.equal(refreshed.kind, "detail");
    if (refreshed.kind !== "detail") return;
    assert.equal(refreshed.detail.detailRef, detailRef);
    assert.match(refreshed.detail.summary, /New context summary/u);
    assert.notEqual(refreshed.detail.revision, initial.detail.revision);
    assert.ok((refreshed.detail.changes?.length ?? 0) <= 3);
    assert.equal(refreshed.detail.changes?.[0]?.label, "摘要");

    const currentAgain = await invoke(callback, request(activeTask, "README.md", {
      operation: "check",
      detailRef,
      requestId: "request-workspace-check-3",
    }));
    assert.equal(currentAgain.kind, "revision");
    if (currentAgain.kind === "revision") {
      assert.equal(currentAgain.revision.state, "unchanged");
    }

    await rm(path);
    const deleted = await invoke(callback, request(activeTask, "README.md", {
      operation: "check",
      detailRef,
      requestId: "request-workspace-check-deleted",
    }));
    assert.equal(deleted.kind, "revision");
    if (deleted.kind === "revision") assert.equal(deleted.revision.state, "deleted");
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("workspace detail references fail closed across expiry, task rebinding, and capacity", async () => {
  const item = await fixture();
  try {
    await writeFile(join(item.workspace, "README.md"), "# Pointable\nBounded detail.\n", "utf8");
    await writeFile(join(item.workspace, "GUIDE.md"), "# Guide\nSecond detail.\n", "utf8");
    const activeTask = task();
    await item.registry.bind(activeTask, item.workspace);
    let currentTime = 1_000;
    const callback = createWorkspaceLookupCallback({
      registry: item.registry,
      detailRefTtlMs: 1_000,
      maxDetailRefs: 1,
      clock: () => currentTime,
    });

    const first = await invoke(callback, request(activeTask, "README.md"));
    assert.equal(first.kind, "detail");
    if (first.kind !== "detail") return;
    const detailRef = first.detail.detailRef;
    assert.ok(detailRef);

    const atCapacity = await invoke(callback, request(activeTask, "GUIDE.md", {
      requestId: "request-workspace-capacity",
    }));
    assert.equal(atCapacity.kind, "detail");
    if (atCapacity.kind === "detail") assert.equal(atCapacity.detail.detailRef, undefined);

    await item.registry.bind(activeTask, item.workspace);
    const afterRebind = await invoke(callback, request(activeTask, "README.md", {
      operation: "check",
      detailRef,
      requestId: "request-workspace-rebound-detail",
    }));
    assert.equal(afterRebind.kind, "error");
    if (afterRebind.kind === "error") assert.equal(afterRebind.code, "detail_ref_invalid");

    const replacement = await invoke(callback, request(activeTask, "README.md", {
      requestId: "request-workspace-replacement-detail",
    }));
    assert.equal(replacement.kind, "detail");
    if (replacement.kind !== "detail") return;
    const replacementRef = replacement.detail.detailRef;
    assert.ok(replacementRef);
    currentTime += 1_001;
    const expired = await invoke(callback, request(activeTask, "README.md", {
      operation: "check",
      detailRef: replacementRef,
      requestId: "request-workspace-expired-detail",
    }));
    assert.equal(expired.kind, "error");
    if (expired.kind === "error") assert.equal(expired.code, "detail_ref_invalid");
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("workspace lookup projects a source module into the five-field code card", async () => {
  const item = await fixture();
  try {
    await mkdir(join(item.workspace, "src"));
    await writeFile(
      join(item.workspace, "src", "module.ts"),
      "/** Provides deterministic module context. */\nexport const moduleValue = 1;\n",
      "utf8",
    );
    const activeTask = task();
    await item.registry.bind(activeTask, item.workspace);
    const callback = createWorkspaceLookupCallback({ registry: item.registry });
    const result = await invoke(callback, request(activeTask, "src/module.ts"));

    assert.equal(result.kind, "detail");
    if (result.kind !== "detail") return;
    assert.equal(result.detail.entityType, "module");
    assert.match(result.detail.summary, /Provides deterministic module context/u);
    assert.deepEqual(result.detail.facts.map((fact) => fact.label), [
      "职责",
      "公开入口",
      "本次变化",
      "依赖与影响",
      "路径",
    ]);
    assert.match(result.detail.facts[2]?.value ?? "", /Git 上下文不可用/u);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("workspace lookup uses scenario-specific summaries without inventing test results or config values", async () => {
  const item = await fixture();
  try {
    await mkdir(join(item.workspace, "test"));
    await mkdir(join(item.workspace, "docs", "adr"), { recursive: true });
    await writeFile(
      join(item.workspace, "test", "refresh.test.ts"),
      'test("refreshes after a trusted action", () => {});\n',
      "utf8",
    );
    await writeFile(
      join(item.workspace, "package.json"),
      JSON.stringify({ name: "hidden-name", scripts: { test: "hidden-command" }, private: true }),
      "utf8",
    );
    await writeFile(
      join(item.workspace, "docs", "adr", "ADR-007-refresh.md"),
      "# ADR-007\n## Status\nAccepted\n## Decision\nRefresh only after a trusted action.\n",
      "utf8",
    );
    const activeTask = task();
    await item.registry.bind(activeTask, item.workspace);
    const callback = createWorkspaceLookupCallback({ registry: item.registry });

    const verification = await invoke(callback, request(activeTask, "test/refresh.test.ts", {
      requestId: "request-workspace-verification",
    }));
    assert.equal(verification.kind, "detail");
    if (verification.kind === "detail") {
      assert.equal(verification.detail.entityType, "verification");
      assert.match(verification.detail.summary, /refreshes after a trusted action/u);
      assert.doesNotMatch(verification.detail.summary, /PASS|通过/u);
    }

    const configuration = await invoke(callback, request(activeTask, "package.json", {
      requestId: "request-workspace-configuration",
    }));
    assert.equal(configuration.kind, "detail");
    if (configuration.kind === "detail") {
      assert.equal(configuration.detail.entityType, "configuration");
      assert.match(configuration.detail.summary, /Node package/u);
      assert.doesNotMatch(JSON.stringify(configuration.detail), /hidden-name|hidden-command/u);
    }

    const decision = await invoke(callback, request(activeTask, "docs/adr/ADR-007-refresh.md", {
      requestId: "request-workspace-decision",
    }));
    assert.equal(decision.kind, "detail");
    if (decision.kind === "detail") {
      assert.equal(decision.detail.entityType, "decision");
      assert.equal(decision.detail.summary, "Refresh only after a trusted action.");
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

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { assignmentForSlot, validateStudyPack } from "../src/evaluation/study-pack.js";
import type { PointableLookupCallbackRequest } from "../src/host/codex-cdp/adapter.js";
import type { CodexHostTaskContext } from "../src/host/codex-cdp/host-context.js";
import { validatePointableLookupPresentation } from "../src/host/codex-cdp/protocol.js";
import { createWorkspaceLookupCallback } from "../src/host/codex-cdp/workspace-lookup.js";
import { CodexTaskWorkspaceBindingRegistry } from "../src/host/codex-cdp/task-workspace-binding.js";

function task(): CodexHostTaskContext {
  const routeRef = "app://-/index.html";
  const threadId = "evaluation-study-thread";
  const hostId = "evaluation-study-host";
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
  generation: number,
  overrides: Partial<PointableLookupCallbackRequest> = {},
): PointableLookupCallbackRequest {
  return {
    operation: "resolve",
    requestId: `study-request-${generation}`,
    selection: {
      text,
      digest: createHash("sha256").update(text, "utf8").digest("hex"),
      generation,
      surface: "assistant_message",
    },
    contextFingerprint: activeTask.contextFingerprint,
    requestedAt: new Date().toISOString(),
    host: {
      targetId: "study-target",
      targetUrl: "app://-/index.html",
      bindingGeneration: "study-binding-generation",
      task: activeTask,
      revalidateTask: async () => activeTask,
    },
    signal: new AbortController().signal,
    ...overrides,
  };
}

function prepare(destination: string, command: "prepare" | "mutate") {
  const args = command === "prepare"
    ? ["scripts/prepare-evaluation-workspace.mjs", "prepare", "--destination", destination]
    : ["scripts/prepare-evaluation-workspace.mjs", "mutate", "--workspace-root", destination];
  return spawnSync(process.execPath, args, { encoding: "utf8", windowsHide: true });
}

test("frozen study pack validates evidence, privacy fields, and a stable digest", async () => {
  const first = await validateStudyPack(resolve("."));
  const second = await validateStudyPack(resolve("."));
  assert.equal(first.valid, true, JSON.stringify(first.issues));
  assert.match(first.packDigest ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(second.packDigest, first.packDigest);
});

test("twelve frozen slots balance presentation, condition, and ordinal position", () => {
  const presentation = new Map<string, number>();
  const conditions = new Map<string, { A: number; B: number }>();
  const positions = new Map<string, number[]>();
  for (let slot = 1; slot <= 12; slot += 1) {
    const assignment = assignmentForSlot(slot);
    presentation.set(
      assignment.presentation.condition,
      (presentation.get(assignment.presentation.condition) ?? 0) + 1,
    );
    assert.equal(new Set(assignment.efficiency.map((item) => item.taskId)).size, 6);
    for (const item of assignment.efficiency) {
      const count = conditions.get(item.taskId) ?? { A: 0, B: 0 };
      count[item.condition] += 1;
      conditions.set(item.taskId, count);
      const byPosition = positions.get(item.taskId) ?? Array(6).fill(0) as number[];
      byPosition[item.order - 1] = (byPosition[item.order - 1] ?? 0) + 1;
      positions.set(item.taskId, byPosition);
    }
  }
  assert.deepEqual([...presentation.values()], [4, 4, 4]);
  assert.ok([...conditions.values()].every((count) => count.A === 6 && count.B === 6));
  assert.ok([...positions.values()].every((values) => values.every((count) => count === 2)));
});

test("workspace preparation is isolated, reproducible, and revision mutation is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-study-pack-"));
  const workspace = join(root, "workspace");
  try {
    const prepared = prepare(workspace, "prepare");
    assert.equal(prepared.status, 0, prepared.stderr);
    const response = JSON.parse(prepared.stdout) as { ok?: boolean; studyId?: string };
    assert.equal(response.ok, true);
    assert.equal(response.studyId, "pointable-context-study-v1");
    assert.match(await readFile(join(workspace, "README.md"), "utf8"), /trusted refresh action/u);
    const beforeStatus = spawnSync("git", ["status", "--porcelain"], {
      cwd: workspace,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(beforeStatus.status, 0);
    assert.equal(beforeStatus.stdout.trim(), "M README.md");

    const mutated = prepare(workspace, "mutate");
    assert.equal(mutated.status, 0, mutated.stderr);
    assert.match(await readFile(join(workspace, "src", "context-record-index.ts"), "utf8"), /recordIdentityKey/u);
    const repeated = prepare(workspace, "mutate");
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal((JSON.parse(repeated.stdout) as { alreadyApplied?: boolean }).alreadyApplied, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("frozen efficiency tasks resolve through the real workspace Provider and detect revision drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-study-provider-"));
  const workspace = join(root, "workspace");
  const prepared = prepare(workspace, "prepare");
  assert.equal(prepared.status, 0, prepared.stderr);
  const activeTask = task();
  const registry = new CodexTaskWorkspaceBindingRegistry(join(root, "bindings.json"));
  try {
    await registry.bind(activeTask, workspace);
    const callback = createWorkspaceLookupCallback({ registry });
    const scenarios = [
      ["README.md", "document"],
      ["src/context-record-index.ts", "module"],
      ["test/context-record-index.test.ts", "verification"],
      ["package.json", "configuration"],
      ["docs/adr/ADR-001-explicit-refresh.md", "decision"],
      ["pilot", "concept"],
    ] as const;
    let generation = 1;
    const details = new Map<string, ReturnType<typeof validatePointableLookupPresentation>>();
    for (const [selection, expectedType] of scenarios) {
      const presentation = validatePointableLookupPresentation(
        await callback(request(activeTask, selection, generation)),
      );
      generation += 1;
      assert.equal(presentation.kind, "detail", selection);
      if (presentation.kind === "detail") {
        assert.equal(presentation.detail.entityType, expectedType);
        details.set(selection, presentation);
      }
    }
    const serialized = JSON.stringify([...details.values()]);
    assert.match(serialized, /src\/consumer\.ts/u);
    assert.match(serialized, /context-record-index\.test\.ts/u);
    assert.match(serialized, /正式实验前的小规模可用性试跑/u);
    assert.doesNotMatch(serialized, /pointable-evaluation-relay-cache|node --test/u);
    assert.match(serialized, /未执行；该卡片只读取测试定义，不能据此判定 PASS\/FAIL/u);

    const moduleDetail = details.get("src/context-record-index.ts");
    assert.equal(moduleDetail?.kind, "detail");
    if (moduleDetail?.kind !== "detail") return;
    const detailRef = moduleDetail.detail.detailRef;
    assert.ok(detailRef);
    const mutated = prepare(workspace, "mutate");
    assert.equal(mutated.status, 0, mutated.stderr);
    const checkRequest = request(activeTask, "src/context-record-index.ts", 2, {
      operation: "check",
      requestId: "study-revision-check",
      detailRef,
    });
    const checked = validatePointableLookupPresentation(await callback(checkRequest));
    assert.equal(checked.kind, "revision");
    if (checked.kind === "revision") assert.equal(checked.revision.state, "updated");
    const refreshed = validatePointableLookupPresentation(await callback(request(
      activeTask,
      "src/context-record-index.ts",
      2,
      { operation: "refresh", requestId: "study-revision-refresh", detailRef },
    )));
    assert.equal(refreshed.kind, "detail");
    if (refreshed.kind === "detail") {
      assert.match(JSON.stringify(refreshed.detail.changes), /职责|公开入口/u);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

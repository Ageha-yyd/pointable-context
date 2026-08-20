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

function longTaskRecord(
  status: string,
  next: string,
  blocker: string,
  updatedAt: string,
): string {
  return `# Long Task

## 目标
让用户在多轮变化后仍能恢复当前工作状态。

## 当前状态
${status}

## 已完成
显式任务记录已经进入原生卡片。

## 下一步
${next}

## 阻塞
${blocker}

## 更新时间
${updatedAt}

## 证据
> EVIDENCE: long-task state

## 来源
evidence/state.txt:1
`;
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

test("task refresh prioritizes status, next action, and blocker without duplicate summary noise", async () => {
  const item = await fixture();
  try {
    await mkdir(join(item.workspace, "docs", "tasks"), { recursive: true });
    await mkdir(join(item.workspace, "evidence"), { recursive: true });
    const path = join(item.workspace, "docs", "tasks", "long-task.md");
    await writeFile(join(item.workspace, "evidence", "state.txt"), "EVIDENCE: long-task state\n", "utf8");
    await writeFile(
      path,
      longTaskRecord("索引覆盖已经接通。", "实现动态变化排序。", "无。", "2026-08-20T01:00:00+08:00"),
      "utf8",
    );
    const activeTask = task();
    await item.registry.bind(activeTask, item.workspace);
    const callback = createWorkspaceLookupCallback({ registry: item.registry });
    const initial = await invoke(callback, request(activeTask, "long-task"));
    assert.equal(initial.kind, "detail");
    if (initial.kind !== "detail") return;
    const detailRef = initial.detail.detailRef;
    assert.ok(detailRef);

    await writeFile(
      path,
      longTaskRecord(
        "动态刷新优先级已经接通。",
        "验证多个 Codex Desktop build。",
        "等待兼容性样本。",
        "2026-08-20T01:30:00+08:00",
      ),
      "utf8",
    );
    const updated = await invoke(callback, request(activeTask, "long-task", {
      operation: "check",
      detailRef,
      requestId: "request-task-check-updated",
    }));
    assert.equal(updated.kind, "revision");
    if (updated.kind === "revision") assert.equal(updated.revision.state, "updated");

    const refreshed = await invoke(callback, request(activeTask, "long-task", {
      operation: "refresh",
      detailRef,
      requestId: "request-task-refresh-priority",
    }));
    assert.equal(refreshed.kind, "detail");
    if (refreshed.kind !== "detail") return;
    assert.deepEqual(refreshed.detail.changes?.map((change) => change.label), [
      "当前状态", "下一步", "阻塞",
    ]);
    assert.ok(refreshed.detail.changes?.every((change) => change.label !== "摘要"));
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

test("workspace lookup projects one concept into narrative and mental-model views from the same facts", async () => {
  const item = await fixture();
  const evidence = "A pilot finds workflow defects but does not establish significance.";
  try {
    await mkdir(join(item.workspace, "docs", "concepts"), { recursive: true });
    await writeFile(join(item.workspace, "docs", "evaluation-protocol.md"), `${evidence}\n`, "utf8");
    await writeFile(join(item.workspace, "docs", "concepts", "pilot.md"), `# Pilot
## 它是什么意思
正式实验前的小规模可用性试跑。
## 为什么现在出现
技术链路已完成，人的理解效果尚未验证。
## 它不是什么
不能证明产品已经显著提升效率。
## 所处流程
- 原型完成
- 当前：Pilot
- 确定正式样本量
- 正式实验
## 证据
> ${evidence}
## 来源
docs/evaluation-protocol.md:1
`, "utf8");
    const activeTask = task();
    await item.registry.bind(activeTask, item.workspace);
    const result = await invoke(
      createWorkspaceLookupCallback({ registry: item.registry }),
      request(activeTask, "pilot", { requestId: "request-workspace-pilot" }),
    );
    assert.equal(result.kind, "detail");
    if (result.kind !== "detail") return;
    assert.equal(result.detail.entityType, "concept");
    assert.equal(result.detail.label, "Pilot");
    assert.equal(result.detail.summary, "正式实验前的小规模可用性试跑。");
    assert.match(result.detail.humanSummary ?? "", /人的理解效果尚未验证/u);
    assert.deepEqual(result.detail.comprehension, {
      kind: "concept",
      meaning: "正式实验前的小规模可用性试跑。",
      context: "技术链路已完成，人的理解效果尚未验证。",
      boundary: "不能证明产品已经显著提升效率。",
      sequence: ["原型完成", "Pilot", "确定正式样本量", "正式实验"],
      currentStep: 1,
      evidence: [{
        excerpt: evidence,
        source: "docs/evaluation-protocol.md:1",
      }],
    });
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test("workspace lookup projects explicit change and decision mental models", async () => {
  const item = await fixture();
  const changeEvidence = 'let presentationMode: PointablePresentationMode = "mental-model";';
  const decisionEvidence = "首个宿主是 Codex Desktop 当前 Chat Lane。";
  try {
    await mkdir(join(item.workspace, "docs", "changes"), { recursive: true });
    await mkdir(join(item.workspace, "docs", "decisions"), { recursive: true });
    await mkdir(join(item.workspace, "src", "host", "codex-cdp"), { recursive: true });
    await writeFile(join(item.workspace, "src", "host", "codex-cdp", "workspace-companion-cli.ts"), `${changeEvidence}\n`, "utf8");
    await writeFile(join(item.workspace, "docs", "PRD-inline-pointable-widgets.md"), `- ${decisionEvidence}\n`, "utf8");
    await writeFile(join(item.workspace, "docs", "changes", "presentation-default.md"), `# Presentation Default
## 原来怎样
普通启动使用记录式摘要。
## 现在怎样
普通启动使用 P-C 微型心智模型。
## 影响什么
用户首先看到定义、语境、流程和边界。
## 证据
> ${changeEvidence}
## 来源
src/host/codex-cdp/workspace-companion-cli.ts:1
`, "utf8");
    await writeFile(join(item.workspace, "docs", "decisions", "native-chat-lane.md"), `# Native Chat Lane
## 为什么需要决定
离开当前任务会增加切换成本。
## 选择了什么
首个产品宿主固定为 Codex Desktop 当前 Chat Lane。
## 后果是什么
无需打开浏览器，但每个 build 都要重新通过兼容门禁。
## 证据
> ${decisionEvidence}
## 来源
docs/PRD-inline-pointable-widgets.md:1
`, "utf8");
    const activeTask = task();
    await item.registry.bind(activeTask, item.workspace);
    const callback = createWorkspaceLookupCallback({ registry: item.registry });

    const change = await invoke(callback, request(activeTask, "presentation-default", {
      requestId: "request-workspace-change-model",
    }));
    assert.equal(change.kind, "detail");
    if (change.kind === "detail") {
      assert.equal(change.detail.label, "Presentation Default");
      assert.deepEqual(change.detail.comprehension, {
        kind: "change",
        before: "普通启动使用记录式摘要。",
        after: "普通启动使用 P-C 微型心智模型。",
        impact: "用户首先看到定义、语境、流程和边界。",
        evidence: [{
          excerpt: changeEvidence,
          source: "src/host/codex-cdp/workspace-companion-cli.ts:1",
        }],
      });
    }

    const decision = await invoke(callback, request(activeTask, "native-chat-lane", {
      requestId: "request-workspace-decision-model",
    }));
    assert.equal(decision.kind, "detail");
    if (decision.kind === "detail") {
      assert.equal(decision.detail.label, "Native Chat Lane");
      assert.deepEqual(decision.detail.comprehension, {
        kind: "decision",
        problem: "离开当前任务会增加切换成本。",
        choice: "首个产品宿主固定为 Codex Desktop 当前 Chat Lane。",
        consequence: "无需打开浏览器，但每个 build 都要重新通过兼容门禁。",
        evidence: [{
          excerpt: decisionEvidence,
          source: "docs/PRD-inline-pointable-widgets.md:1",
        }],
      });
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

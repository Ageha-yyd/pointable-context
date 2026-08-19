import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  contextTaskDocumentPath,
  contextVerificationDocumentPath,
  extractContextTaskArtifact,
  extractContextVerificationArtifact,
} from "../src/adapters/context-concept.js";
import type { PointableLookupCallbackRequest } from "../src/host/codex-cdp/adapter.js";
import type { CodexHostTaskContext } from "../src/host/codex-cdp/host-context.js";
import { validatePointableLookupPresentation } from "../src/host/codex-cdp/protocol.js";
import { createWorkspaceLookupCallback } from "../src/host/codex-cdp/workspace-lookup.js";
import { CodexTaskWorkspaceBindingRegistry } from "../src/host/codex-cdp/task-workspace-binding.js";

const taskEvidence = "The Task record is accepted only after its source line is verified.";
const verificationEvidence = "tests 12 passed; 0 failed";

function taskArtifact(): string {
  return `# Context Records

## 目标
让 Agent 的稳定工作结果可以在当前 Chat Lane 中被确定性点查。

## 当前状态
Task 与 Verification 的显式制品合同已经进入实现验证。

## 已完成
冻结目录、字段结构、证据复验和类型化投影已经接通。

## 下一步
在真实 Codex Chat Lane 中人工检查两类卡片是否足以理解当前状态。

## 阻塞
当前无实现阻塞；仍缺真人效率对照。

## 更新时间
2026-08-19T13:00:00+08:00

## 证据
> ${taskEvidence}

## 来源
evidence/task.txt:1
`;
}

function verificationArtifact(): string {
  return `# Card Refresh Verification

## 要证明什么
可信刷新会复用当前卡片并保持用户已经展开的阅读状态。

## 结果
自动回归通过，卡片 DOM、位置、滚动和 disclosure 状态保持不变。

## 尚未证明
尚未证明跨 Codex Desktop 版本兼容，也未证明用户理解速度显著提升。

## 验证方式
运行 TypeScript 检查、自动回归与真实浏览器交互验收。

## 验证修订
working-tree:test-snapshot

## 执行时间
2026-08-19T13:05:00+08:00

## 证据
> ${verificationEvidence}

## 来源
evidence/verification.txt:1
`;
}

function activeTask(): CodexHostTaskContext {
  const routeRef = "app://-/index.html";
  const threadId = "thread-work-results";
  const hostId = "host-work-results";
  return {
    schemaVersion: 1,
    host: "codex-desktop",
    threadId,
    hostId,
    routeRef,
    contextFingerprint: JSON.stringify({ href: routeRef, threadId, hostId }),
  };
}

function request(task: CodexHostTaskContext, text: string): PointableLookupCallbackRequest {
  return {
    operation: "resolve",
    requestId: `request-${text}`,
    selection: {
      text,
      digest: createHash("sha256").update(text, "utf8").digest("hex"),
      generation: 1,
      surface: "assistant_message",
    },
    contextFingerprint: task.contextFingerprint,
    requestedAt: new Date().toISOString(),
    host: {
      targetId: "target-work-results",
      targetUrl: "app://-/index.html",
      bindingGeneration: "binding-work-results",
      task,
      revalidateTask: async () => task,
    },
    signal: new AbortController().signal,
  };
}

test("task and verification records require frozen paths, complete fields, and explicit timestamps", () => {
  assert.equal(contextTaskDocumentPath("docs/tasks/context-records.md"), true);
  assert.equal(contextTaskDocumentPath("docs/context-records.md"), false);
  assert.equal(contextVerificationDocumentPath("docs/verifications/card-refresh.md"), true);
  assert.equal(contextVerificationDocumentPath("test/card-refresh.test.ts"), false);

  const task = extractContextTaskArtifact(taskArtifact());
  assert.equal(task?.status, "Task 与 Verification 的显式制品合同已经进入实现验证。");
  assert.equal(task?.updatedAt, "2026-08-19T05:00:00.000Z");
  const verification = extractContextVerificationArtifact(verificationArtifact());
  assert.match(verification?.gap ?? "", /尚未证明跨 Codex Desktop/u);
  assert.equal(verification?.executedAt, "2026-08-19T05:05:00.000Z");

  assert.equal(extractContextTaskArtifact("# Task\n\n## 当前状态\n完成"), undefined);
  assert.equal(extractContextVerificationArtifact(
    verificationArtifact().replace("2026-08-19T13:05:00+08:00", "今天"),
  ), undefined);
});

test("repository work-result samples keep exact evidence references", async () => {
  const samples = [
    {
      path: "docs/tasks/work-result-context.md",
      parse: extractContextTaskArtifact,
    },
    {
      path: "docs/verifications/task-verification-contract.md",
      parse: extractContextVerificationArtifact,
    },
  ] as const;
  for (const sample of samples) {
    const artifact = sample.parse(await readFile(sample.path, "utf8"));
    assert.ok(artifact, `${sample.path} must remain a valid explicit work-result record`);
    const sourceLine = (await readFile(artifact.evidence.sourcePath, "utf8"))
      .replace(/\r\n?/gu, "\n")
      .split("\n")[artifact.evidence.sourceLine - 1]
      ?.trim();
    assert.equal(sourceLine, artifact.evidence.excerpt);
  }
});

test("explicit work results become evidence-bound type-specific views without inferred verdicts", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-work-results-"));
  const workspace = join(root, "workspace");
  const registry = new CodexTaskWorkspaceBindingRegistry(join(root, "bindings.json"));
  try {
    await mkdir(join(workspace, "docs", "tasks"), { recursive: true });
    await mkdir(join(workspace, "docs", "verifications"), { recursive: true });
    await mkdir(join(workspace, "evidence"), { recursive: true });
    await writeFile(join(workspace, "evidence", "task.txt"), `${taskEvidence}\n`, "utf8");
    await writeFile(join(workspace, "evidence", "verification.txt"), `${verificationEvidence}\n`, "utf8");
    await writeFile(join(workspace, "docs", "tasks", "context-records.md"), taskArtifact(), "utf8");
    await writeFile(
      join(workspace, "docs", "verifications", "card-refresh-verification.md"),
      verificationArtifact(),
      "utf8",
    );

    const task = activeTask();
    await registry.bind(task, workspace);
    const callback = createWorkspaceLookupCallback({ registry });

    const taskResult = validatePointableLookupPresentation(
      await callback(request(task, "context-records")),
    );
    assert.equal(taskResult.kind, "detail");
    if (taskResult.kind === "detail") {
      assert.equal(taskResult.detail.entityType, "task");
      assert.equal(taskResult.detail.comprehension?.kind, "task");
      if (taskResult.detail.comprehension?.kind === "task") {
        assert.match(taskResult.detail.comprehension.next, /真实 Codex Chat Lane/u);
        assert.match(taskResult.detail.comprehension.blocker, /仍缺真人效率对照/u);
      }
    }

    const verificationResult = validatePointableLookupPresentation(
      await callback(request(task, "card-refresh-verification")),
    );
    assert.equal(verificationResult.kind, "detail");
    if (verificationResult.kind === "detail") {
      assert.equal(verificationResult.detail.entityType, "verification");
      assert.equal(verificationResult.detail.comprehension?.kind, "verification");
      if (verificationResult.detail.comprehension?.kind === "verification") {
        assert.match(verificationResult.detail.comprehension.result, /自动回归通过/u);
        assert.match(verificationResult.detail.comprehension.gap, /未证明用户理解速度/u);
      }
    }

    await writeFile(join(workspace, "evidence", "verification.txt"), "evidence drifted\n", "utf8");
    const drifted = validatePointableLookupPresentation(
      await callback(request(task, "card-refresh-verification")),
    );
    assert.equal(drifted.kind, "error");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

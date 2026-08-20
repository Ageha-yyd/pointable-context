import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { auditContextCoverage } from "../src/records/context-coverage.js";

const evidenceLine = "EVIDENCE: stable long-task milestone";

function taskRecord(): string {
  return `# Long Task

## 目标
让用户在延迟重返后恢复当前任务状态。

## 当前状态
结构覆盖审计已经接通。

## 已完成
声明的上下文对象可以被逐项验证。

## 下一步
继续验证动态变化和原生兼容性。

## 阻塞
无。

## 更新时间
2026-08-20T09:00:00+08:00

## 证据
> ${evidenceLine}

## 来源
evidence/milestone.txt:1
`;
}

function verificationRecord(): string {
  return `# Long Task Verification

## 要证明什么
显式声明的对象可以从工作区 Provider 读取。

## 结果
当前冻结样例中的四类对象都返回可验证详情。

## 尚未证明
没有证明真人在长任务中恢复上下文更快。

## 验证方式
运行只读结构覆盖审计。

## 验证修订
working-tree:coverage-test

## 执行时间
2026-08-20T09:05:00+08:00

## 证据
> ${evidenceLine}

## 来源
evidence/milestone.txt:1
`;
}

function decisionRecord(): string {
  return `# Native Context

## 为什么需要决定
长任务信息必须在当前 Chat Lane 中恢复。

## 选择了什么
使用选区触发的 P-C 微型心智模型。

## 后果是什么
普通 Chat 保持安静，详情只在可信点击后读取。

## 证据
> ${evidenceLine}

## 来源
evidence/milestone.txt:1
`;
}

interface ExpectedObject {
  id: string;
  kind: "module" | "decision" | "task" | "verification";
  key: string;
}

async function fixture(expected?: readonly ExpectedObject[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pointable-context-coverage-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "docs", "decisions"), { recursive: true });
  await mkdir(join(root, "docs", "tasks"), { recursive: true });
  await mkdir(join(root, "docs", "verifications"), { recursive: true });
  await mkdir(join(root, "evidence"), { recursive: true });
  await writeFile(
    join(root, "src", "context.ts"),
    "/** Restores bounded context for a long-running task. */\nexport const restore = true;\n",
    "utf8",
  );
  await writeFile(join(root, "docs", "decisions", "native-context.md"), decisionRecord(), "utf8");
  await writeFile(join(root, "docs", "tasks", "long-task.md"), taskRecord(), "utf8");
  await writeFile(
    join(root, "docs", "verifications", "long-task-check.md"),
    verificationRecord(),
    "utf8",
  );
  await writeFile(join(root, "evidence", "milestone.txt"), `${evidenceLine}\n`, "utf8");
  await writeFile(
    join(root, "docs", "context-coverage.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      taskId: "long-task-alpha",
      declaredAt: "2026-08-20T08:30:00+08:00",
      expected: expected ?? [
        { id: "context-module", kind: "module", key: "src/context.ts" },
        { id: "native-context", kind: "decision", key: "docs/decisions/native-context.md" },
        { id: "long-task", kind: "task", key: "docs/tasks/long-task.md" },
        {
          id: "long-task-check",
          kind: "verification",
          key: "docs/verifications/long-task-check.md",
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  return root;
}

test("coverage audit verifies declared Module, Decision, Task, and Verification objects", async () => {
  const root = await fixture();
  try {
    const result = await auditContextCoverage(root, {
      now: () => new Date("2026-08-20T02:00:00.000Z"),
    });
    assert.equal(result.valid, true, JSON.stringify(result.issues));
    assert.equal(result.checkedAt, "2026-08-20T02:00:00.000Z");
    assert.equal(result.taskId, "long-task-alpha");
    assert.deepEqual(result.objects.map((object) => object.status), [
      "available", "available", "available", "available",
    ]);
    assert.deepEqual(result.summary, {
      expected: 4,
      available: 4,
      missing: 0,
      typeMismatch: 0,
      invalid: 0,
      unavailable: 0,
      coverageRate: 1,
      omissionRate: 0,
      projectionFailureRate: 0,
      indexedByKind: { module: 1, decision: 1, task: 1, verification: 1 },
      recordCandidates: 2,
      validRecords: 2,
      redundantRecords: 0,
      redundancyRate: 0,
    });
    assert.ok(result.objects.every((object) => object.entityRevision !== undefined));
    assert.deepEqual(result.recordIssues, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("coverage audit separates omissions, type mismatches, and invalid projections", async () => {
  const root = await fixture([
    { id: "missing", kind: "module", key: "src/missing.ts" },
    { id: "wrong-type", kind: "decision", key: "src/context.ts" },
    { id: "invalid-decision", kind: "decision", key: "docs/decisions/invalid.md" },
  ]);
  try {
    await writeFile(join(root, "docs", "decisions", "invalid.md"), "# Invalid\n", "utf8");
    const result = await auditContextCoverage(root);
    assert.equal(result.valid, false);
    assert.deepEqual(result.objects.map((object) => object.status), [
      "missing", "type_mismatch", "invalid",
    ]);
    assert.equal(result.summary.coverageRate, 0);
    assert.equal(result.summary.omissionRate, 0.333333);
    assert.equal(result.summary.projectionFailureRate, 0.666667);
    assert.deepEqual(result.issues.map((issue) => issue.code), [
      "expected_object_missing",
      "expected_object_type_mismatch",
      "expected_object_invalid",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("coverage audit fails closed on malformed or duplicate expectation manifests", async () => {
  const root = await fixture();
  try {
    await writeFile(
      join(root, "docs", "context-coverage.json"),
      JSON.stringify({
        schemaVersion: 1,
        taskId: "long-task-alpha",
        declaredAt: "2026-08-20T08:30:00+08:00",
        expected: [
          { id: "same", kind: "module", key: "src/context.ts" },
          { id: "same", kind: "module", key: "src/other.ts" },
        ],
      }),
      "utf8",
    );
    const result = await auditContextCoverage(root);
    assert.equal(result.valid, false);
    assert.deepEqual(result.issues, [{ code: "manifest_invalid" }]);
    assert.equal(result.summary.expected, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("coverage CLI reports a distinct incomplete exit code without exposing file contents", async () => {
  const root = await fixture([
    { id: "missing", kind: "module", key: "src/missing.ts" },
  ]);
  try {
    const execution = spawnSync(process.execPath, [
      resolve("dist/src/records/coverage-cli.js"),
      "--workspace-root",
      root,
      "--json",
    ], { encoding: "utf8", windowsHide: true });
    assert.equal(execution.status, 2);
    assert.doesNotMatch(execution.stdout, /stable long-task milestone/u);
    const result = JSON.parse(execution.stdout) as {
      valid?: boolean;
      summary?: { omissionRate?: number };
    };
    assert.equal(result.valid, false);
    assert.equal(result.summary?.omissionRate, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

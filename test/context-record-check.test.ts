import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { checkContextRecords } from "../src/records/context-record-check.js";

const evidenceLine = "VERIFIED: explicit milestone evidence";

function taskRecord(sourcePath = "evidence/task.txt"): string {
  return `# Milestone Alpha

## 目标
保存一个后续会再次引用的稳定任务状态。

## 当前状态
产出策略已经冻结。

## 已完成
结构、时间和证据复验已经接通。

## 下一步
进入受控 pilot，而不是继续增加卡片类型。

## 阻塞
无。

## 更新时间
2026-08-19T15:00:00+08:00

## 证据
> ${evidenceLine}

## 来源
${sourcePath}:1
`;
}

function verificationRecord(sourcePath = "evidence/task.txt"): string {
  return `# Milestone Alpha Verification

## 要证明什么
记录检查器会拒绝结构或证据不可信的记录。

## 结果
有效样例通过，证据漂移样例被拒绝。

## 尚未证明
没有证明真实用户的信息获取效率已经提升。

## 验证方式
运行自动化合同测试。

## 验证修订
working-tree:record-check-test

## 执行时间
2026-08-19T15:05:00+08:00

## 证据
> ${evidenceLine}

## 来源
${sourcePath}:1
`;
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pointable-record-check-"));
  await mkdir(join(root, "docs", "tasks"), { recursive: true });
  await mkdir(join(root, "docs", "verifications"), { recursive: true });
  await mkdir(join(root, "evidence"), { recursive: true });
  await writeFile(join(root, "evidence", "task.txt"), `${evidenceLine}\n`, "utf8");
  return root;
}

test("record checker accepts bounded Task and Verification records with exact evidence", async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, "docs", "tasks", "milestone-alpha.md"), taskRecord(), "utf8");
    await writeFile(
      join(root, "docs", "verifications", "milestone-alpha-check.md"),
      verificationRecord(),
      "utf8",
    );
    const result = await checkContextRecords(root, {
      now: () => new Date("2026-08-19T08:00:00.000Z"),
    });
    assert.equal(result.valid, true);
    assert.equal(result.checkedAt, "2026-08-19T08:00:00.000Z");
    assert.deepEqual(result.records.map((record) => record.kind), ["task", "verification"]);
    assert.ok(result.records.every((record) => record.evidenceSource === "evidence/task.txt:1"));
    assert.deepEqual(result.issues, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("record checker fails closed on duplicate identity, invalid structure, and evidence drift", async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, "docs", "tasks", "shared.md"), taskRecord(), "utf8");
    await writeFile(join(root, "docs", "verifications", "shared.md"), verificationRecord(), "utf8");
    await writeFile(join(root, "docs", "tasks", "missing-fields.md"), "# Incomplete\n", "utf8");
    await writeFile(
      join(root, "docs", "tasks", "extra-section.md"),
      `${taskRecord()}\n## Owner\nNobody\n`,
      "utf8",
    );
    await writeFile(join(root, "docs", "verifications", "drift.md"), verificationRecord(), "utf8");
    await writeFile(join(root, "evidence", "task.txt"), "CHANGED\n", "utf8");

    const result = await checkContextRecords(root);
    assert.equal(result.valid, false);
    assert.equal(result.records.length, 0);
    assert.equal(result.issues.filter((issue) => issue.code === "duplicate_identity").length, 2);
    assert.ok(result.issues.some((issue) =>
      issue.code === "record_schema_invalid" && issue.path === "docs/tasks/missing-fields.md"));
    assert.ok(result.issues.some((issue) =>
      issue.code === "record_schema_invalid" && issue.path === "docs/tasks/extra-section.md"));
    assert.ok(result.issues.some((issue) =>
      issue.code === "record_evidence_invalid" && issue.path === "docs/verifications/drift.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("record checker rejects circular evidence sourced from another context record", async () => {
  const root = await fixture();
  try {
    await writeFile(
      join(root, "docs", "tasks", "source.md"),
      `${evidenceLine}\n`,
      "utf8",
    );
    await writeFile(
      join(root, "docs", "verifications", "circular.md"),
      verificationRecord("docs/tasks/source.md"),
      "utf8",
    );
    const result = await checkContextRecords(root);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((issue) =>
      issue.code === "record_evidence_invalid" && issue.path === "docs/verifications/circular.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository work-result records pass the read-only checker", async () => {
  const beforeTask = await readFile("docs/tasks/work-result-context.md", "utf8");
  const beforeVerification = await readFile(
    "docs/verifications/task-verification-contract.md",
    "utf8",
  );
  const result = await checkContextRecords(resolve("."));
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.records.length, 2);
  assert.equal(await readFile("docs/tasks/work-result-context.md", "utf8"), beforeTask);
  assert.equal(
    await readFile("docs/verifications/task-verification-contract.md", "utf8"),
    beforeVerification,
  );
});

test("record checker CLI reports JSON and uses a distinct invalid-record exit code", async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, "docs", "tasks", "invalid.md"), "# Invalid\n", "utf8");
    const execution = spawnSync(process.execPath, [
      resolve("dist/src/records/check-cli.js"),
      "--workspace-root",
      root,
      "--json",
    ], { encoding: "utf8", windowsHide: true });
    assert.equal(execution.status, 2);
    const result = JSON.parse(execution.stdout) as { valid?: boolean; issues?: { code?: string }[] };
    assert.equal(result.valid, false);
    assert.equal(result.issues?.[0]?.code, "record_schema_invalid");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

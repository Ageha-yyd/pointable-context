import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { checkContextMilestoneArtifacts } from "../src/records/context-artifact-check.js";

const evidenceLine = "EVIDENCE: stable milestone context";

function concept(source = "evidence/concept.txt", extra = ""): string {
  return `# Stable Concept

## 它是什么意思
一个后续任务仍会引用的稳定概念。

## 为什么现在出现
当前里程碑已经建立了可信证据。

## 它不是什么
它不是从普通 Chat 自动提取的标签。

## 所处流程
- 形成证据
- 当前：写入概念制品
- 后续按需点查

## 证据
> ${evidenceLine}

## 来源
${source}:1
${extra}`;
}

function change(source = "evidence/change.txt"): string {
  return `# Stable Change

## 原来怎样
稳定概念只能留在长 Chat 中。

## 现在怎样
明确里程碑可以写成证据绑定制品。

## 影响什么
后续任务可以通过确定性身份点查。

## 证据
> ${evidenceLine}

## 来源
${source}:1
`;
}

function decision(source = "evidence/decision.txt"): string {
  return `# Stable Decision

## 为什么需要决定
自动抽取会增加噪音和错误对象。

## 选择了什么
只允许显式 opt-in 的里程碑制品。

## 后果是什么
对象更少，但身份和证据可验证。

## 证据
> ${evidenceLine}

## 来源
${source}:1
`;
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pointable-artifact-check-"));
  await mkdir(join(root, "docs", "concepts"), { recursive: true });
  await mkdir(join(root, "docs", "changes"), { recursive: true });
  await mkdir(join(root, "docs", "decisions"), { recursive: true });
  await mkdir(join(root, "docs", "tasks"), { recursive: true });
  await mkdir(join(root, "evidence"), { recursive: true });
  await Promise.all([
    writeFile(join(root, "evidence", "concept.txt"), `${evidenceLine}\n`, "utf8"),
    writeFile(join(root, "evidence", "change.txt"), `${evidenceLine}\n`, "utf8"),
    writeFile(join(root, "evidence", "decision.txt"), `${evidenceLine}\n`, "utf8"),
  ]);
  return root;
}

test("artifact checker accepts strict Concept, Change, and Decision milestones", async () => {
  const root = await fixture();
  try {
    await Promise.all([
      writeFile(join(root, "docs", "concepts", "stable-concept.md"), concept(), "utf8"),
      writeFile(join(root, "docs", "changes", "stable-change.md"), change(), "utf8"),
      writeFile(join(root, "docs", "decisions", "stable-decision.md"), decision(), "utf8"),
    ]);
    const result = await checkContextMilestoneArtifacts(root, {
      now: () => new Date("2026-08-20T03:00:00.000Z"),
    });
    assert.equal(result.valid, true, JSON.stringify(result.issues));
    assert.equal(result.checkedAt, "2026-08-20T03:00:00.000Z");
    assert.equal(result.candidateCount, 3);
    assert.deepEqual(result.artifacts.map((artifact) => artifact.kind), [
      "concept", "change", "decision",
    ]);
    assert.ok(result.artifacts.every((artifact) => artifact.evidenceSource.startsWith("evidence/")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact checker rejects ambiguous identity, title drift, extra sections, and managed evidence", async () => {
  const root = await fixture();
  try {
    await Promise.all([
      writeFile(join(root, "docs", "concepts", "shared.md"), concept(), "utf8"),
      writeFile(join(root, "docs", "decisions", "shared.md"), decision(), "utf8"),
      writeFile(
        join(root, "docs", "changes", "title-mismatch.md"),
        change().replace("# Stable Change", "# Different Title"),
        "utf8",
      ),
      writeFile(
        join(root, "docs", "concepts", "extra-section.md"),
        concept("evidence/concept.txt", "\n## Owner\nNobody\n"),
        "utf8",
      ),
      writeFile(join(root, "docs", "tasks", "source.md"), `${evidenceLine}\n`, "utf8"),
      writeFile(
        join(root, "docs", "decisions", "managed-evidence.md"),
        decision("docs/tasks/source.md").replace("# Stable Decision", "# Managed Evidence"),
        "utf8",
      ),
    ]);
    const result = await checkContextMilestoneArtifacts(root);
    assert.equal(result.valid, false);
    assert.equal(result.issues.filter((issue) => issue.code === "duplicate_identity").length, 2);
    assert.ok(result.issues.some((issue) =>
      issue.code === "artifact_identity_mismatch" && issue.path === "docs/changes/title-mismatch.md"));
    assert.ok(result.issues.some((issue) =>
      issue.code === "artifact_schema_invalid" && issue.path === "docs/concepts/extra-section.md"));
    assert.ok(result.issues.some((issue) =>
      issue.code === "artifact_evidence_invalid" && issue.path === "docs/decisions/managed-evidence.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository milestone artifacts pass without being modified", async () => {
  const paths = [
    "docs/concepts/long-task-dogfood.md",
    "docs/concepts/pilot.md",
    "docs/changes/presentation-default.md",
    "docs/decisions/native-chat-lane.md",
    "docs/decisions/native-trial-fail-closed.md",
  ];
  const before = await Promise.all(paths.map((path) => readFile(path, "utf8")));
  const result = await checkContextMilestoneArtifacts(resolve("."));
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.candidateCount, 5);
  assert.equal(result.artifacts.length, 5);
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(path, "utf8"))), before);
});

test("artifact checker CLI reports a distinct invalid exit without exposing content", async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, "docs", "concepts", "invalid.md"), "# Invalid\n", "utf8");
    const execution = spawnSync(process.execPath, [
      resolve("dist/src/records/artifact-check-cli.js"),
      "--workspace-root",
      root,
      "--json",
    ], { encoding: "utf8", windowsHide: true });
    assert.equal(execution.status, 2);
    assert.doesNotMatch(execution.stdout, /stable milestone context/u);
    const result = JSON.parse(execution.stdout) as {
      valid?: boolean;
      issues?: { code?: string }[];
    };
    assert.equal(result.valid, false);
    assert.equal(result.issues?.[0]?.code, "artifact_schema_invalid");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

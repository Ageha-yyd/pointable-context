import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type { TrustedContextBinding } from "../src/contracts.js";
import {
  LocalWorkspaceAuthoritativeProvider,
  LocalWorkspaceContextIndex,
  LocalWorkspaceRevisionProbe,
} from "../src/adapters/local-workspace.js";
import { localWorkspaceScope } from "../src/host/codex-cdp/task-workspace-binding.js";
import { resolveSelection } from "../src/resolver.js";

const execFileAsync = promisify(execFile);

async function git(root: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: root, windowsHide: true, timeout: 5_000 });
}

async function workspaceFixture(): Promise<{
  root: string;
  binding: TrustedContextBinding;
}> {
  const root = await mkdtemp(join(tmpdir(), "pointable-workspace-"));
  const canonicalRoot = await realpath(root);
  return {
    root,
    binding: {
      kind: "trusted",
      scope: localWorkspaceScope(canonicalRoot),
      bindingRevision: "binding-1",
      evidence: "explicit_user",
      selectionGeneration: 1,
      threadRef: "codex-desktop:host-1:thread-1",
      routeRef: "app://-/index.html",
      workspaceRoot: canonicalRoot,
    },
  };
}

test("workspace index exposes bounded file identities and ignores build trees", async () => {
  const fixture = await workspaceFixture();
  try {
    await mkdir(join(fixture.root, "docs"));
    await mkdir(join(fixture.root, "node_modules"));
    await writeFile(join(fixture.root, "README.md"), "# Pointable Context\n", "utf8");
    await writeFile(join(fixture.root, "docs", "PRD-inline-widgets.md"), "# PRD\n", "utf8");
    await writeFile(join(fixture.root, "node_modules", "hidden.js"), "hidden", "utf8");

    const records = await new LocalWorkspaceContextIndex().list(fixture.binding);
    assert.deepEqual(
      records.map((record) => record.canonicalKey).sort(),
      ["README.md", "docs/PRD-inline-widgets.md"],
    );
    assert.equal(records.every((record) => record.authorityRef.provider === "local-filesystem"), true);
    const resolved = resolveSelection(
      fixture.binding.scope,
      "请查看 docs/PRD-inline-widgets.md",
      records,
    );
    assert.equal(resolved.kind, "unique");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("workspace provider performs a fresh bounded read and changes revision with content", async () => {
  const fixture = await workspaceFixture();
  try {
    const path = join(fixture.root, "README.md");
    await writeFile(path, "# First\nCurrent project notes.\n", "utf8");
    const [record] = await new LocalWorkspaceContextIndex().list(fixture.binding);
    assert.ok(record);
    const provider = new LocalWorkspaceAuthoritativeProvider();
    const read = async () => await provider.getDetail({
      binding: fixture.binding,
      entityId: record.entityId,
      entityType: record.entityType,
      authorityLocator: record.authorityRef.locator,
      revisionPolicy: "current-or-explicit-stale",
    });
    const first = await read();
    assert.equal(first.kind, "snapshot");
    if (first.kind !== "snapshot") return;
    assert.equal(first.snapshot.freshness, "current");
    assert.equal(first.verification.method, "live_read");
    assert.match(String(first.snapshot.facts["用途"]), /Current project notes/u);
    assert.equal(first.snapshot.facts["Git 状态"], "unavailable");

    await writeFile(path, "# Second\nUpdated notes.\n", "utf8");
    const second = await read();
    assert.equal(second.kind, "snapshot");
    if (second.kind === "snapshot") {
      assert.notEqual(second.snapshot.entityRevision, first.snapshot.entityRevision);
      assert.match(String(second.snapshot.facts["用途"]), /Updated notes/u);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("workspace revision probe detects source drift without projecting full detail", async () => {
  const fixture = await workspaceFixture();
  try {
    const path = join(fixture.root, "README.md");
    await writeFile(path, "first", "utf8");
    const probe = new LocalWorkspaceRevisionProbe();
    const first = await probe.probe({
      binding: fixture.binding,
      entityId: "file:README.md",
      entityType: "document",
    });
    assert.equal(first.kind, "current");
    await writeFile(path, "second revision", "utf8");
    const second = await probe.probe({
      binding: fixture.binding,
      entityId: "file:README.md",
      entityType: "document",
    });
    assert.equal(second.kind, "current");
    if (first.kind === "current" && second.kind === "current") {
      assert.notEqual(second.revision, first.revision);
      assert.match(second.revision, /^workspace-context-v2:[a-f0-9]{64}$/u);
    }
    await rm(path);
    assert.equal((await probe.probe({
      binding: fixture.binding,
      entityId: "file:README.md",
      entityType: "document",
    })).kind, "not_found");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("workspace revision probe detects Git-state-only drift without changing source stat", async () => {
  const fixture = await workspaceFixture();
  try {
    await git(fixture.root, "init", "--quiet");
    await git(fixture.root, "config", "user.email", "pointable@example.invalid");
    await git(fixture.root, "config", "user.name", "Pointable Test");
    const path = join(fixture.root, "README.md");
    await writeFile(path, "# Revision probe\n", "utf8");
    await git(fixture.root, "add", "--", "README.md");
    await git(fixture.root, "commit", "--quiet", "-m", "seed");
    await writeFile(path, "# Revision probe\n\nChanged.\n", "utf8");
    const beforeStage = await stat(path);
    const probe = new LocalWorkspaceRevisionProbe();
    const modified = await probe.probe({
      binding: fixture.binding,
      entityId: "file:README.md",
      entityType: "document",
    });
    await git(fixture.root, "add", "--", "README.md");
    const afterStage = await stat(path);
    const staged = await probe.probe({
      binding: fixture.binding,
      entityId: "file:README.md",
      entityType: "document",
    });
    assert.equal(modified.kind, "current");
    assert.equal(staged.kind, "current");
    assert.equal(afterStage.size, beforeStage.size);
    assert.equal(afterStage.mtimeMs, beforeStage.mtimeMs);
    if (modified.kind === "current" && staged.kind === "current") {
      assert.notEqual(staged.revision, modified.revision);
    }
    await git(fixture.root, "commit", "--quiet", "-m", "update readme");
    const committed = await probe.probe({
      binding: fixture.binding,
      entityId: "file:README.md",
      entityType: "document",
    });
    await git(fixture.root, "commit", "--amend", "--quiet", "-m", "rewrite readme metadata");
    const amended = await probe.probe({
      binding: fixture.binding,
      entityId: "file:README.md",
      entityType: "document",
    });
    assert.equal(committed.kind, "current");
    assert.equal(amended.kind, "current");
    if (committed.kind === "current" && amended.kind === "current") {
      assert.notEqual(amended.revision, committed.revision);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("workspace revision probe detects relation-only drift without changing the selected module", async () => {
  const fixture = await workspaceFixture();
  try {
    await git(fixture.root, "init", "--quiet");
    await git(fixture.root, "config", "user.email", "pointable@example.invalid");
    await git(fixture.root, "config", "user.name", "Pointable Test");
    await mkdir(join(fixture.root, "src"));
    const target = join(fixture.root, "src", "target-module.ts");
    const consumer = join(fixture.root, "src", "consumer.ts");
    await writeFile(target, "export const target = true;\n", "utf8");
    await writeFile(consumer, "export const consumer = true;\n", "utf8");
    await git(fixture.root, "add", "--", "src/target-module.ts", "src/consumer.ts");
    await git(fixture.root, "commit", "--quiet", "-m", "seed modules");
    const selectedBefore = await stat(target);
    const probe = new LocalWorkspaceRevisionProbe();
    const first = await probe.probe({
      binding: fixture.binding,
      entityId: "file:src/target-module.ts",
      entityType: "module",
    });
    await writeFile(
      consumer,
      'import { target } from "./target-module.js";\nexport const consumer = target;\n',
      "utf8",
    );
    const selectedAfter = await stat(target);
    const second = await probe.probe({
      binding: fixture.binding,
      entityId: "file:src/target-module.ts",
      entityType: "module",
    });
    assert.equal(first.kind, "current");
    assert.equal(second.kind, "current");
    assert.equal(selectedAfter.size, selectedBefore.size);
    assert.equal(selectedAfter.mtimeMs, selectedBefore.mtimeMs);
    if (first.kind === "current" && second.kind === "current") {
      assert.notEqual(second.revision, first.revision);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("workspace revision probe tracks explicit mental-model evidence source drift", async () => {
  const fixture = await workspaceFixture();
  try {
    await mkdir(join(fixture.root, "docs", "concepts"), { recursive: true });
    await mkdir(join(fixture.root, "src"));
    const artifact = join(fixture.root, "docs", "concepts", "refresh-contract.md");
    const source = join(fixture.root, "src", "contract.ts");
    await writeFile(source, "export const contract = 'v1';\n", "utf8");
    await writeFile(artifact, `# Refresh Contract

## 它是什么意思
打开卡片所绑定的动态事实指纹。

## 为什么现在出现
长任务中的证据可能继续变化。

## 它不是什么
它不是完整内容的后台重复读取。

## 所处流程
- 打开快照
- 当前：检查轻量指纹
- 显式刷新

## 证据
> export const contract = 'v1';

## 来源
src/contract.ts:1
`, "utf8");
    const artifactBefore = await stat(artifact);
    const probe = new LocalWorkspaceRevisionProbe();
    const first = await probe.probe({
      binding: fixture.binding,
      entityId: "file:docs/concepts/refresh-contract.md",
      entityType: "concept",
    });
    await writeFile(source, "export const contract = 'v2';\n", "utf8");
    const artifactAfter = await stat(artifact);
    const second = await probe.probe({
      binding: fixture.binding,
      entityId: "file:docs/concepts/refresh-contract.md",
      entityType: "concept",
    });
    assert.equal(first.kind, "current");
    assert.equal(second.kind, "current");
    assert.equal(artifactAfter.size, artifactBefore.size);
    assert.equal(artifactAfter.mtimeMs, artifactBefore.mtimeMs);
    if (first.kind === "current" && second.kind === "current") {
      assert.notEqual(second.revision, first.revision);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("workspace revision probe honors a pre-aborted request", async () => {
  const fixture = await workspaceFixture();
  try {
    await writeFile(join(fixture.root, "README.md"), "# Abort\n", "utf8");
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    assert.deepEqual(
      (await new LocalWorkspaceRevisionProbe().probe({
        binding: fixture.binding,
        entityId: "file:README.md",
        entityType: "document",
        signal: controller.signal,
      })).kind,
      "unavailable",
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("workspace scenario cards prioritize verification, configuration, and decision facts", async () => {
  const fixture = await workspaceFixture();
  try {
    await mkdir(join(fixture.root, "test"));
    await mkdir(join(fixture.root, "docs", "adr"), { recursive: true });
    await writeFile(
      join(fixture.root, "test", "refresh.test.ts"),
      'test("refreshes the same card", () => {});\n',
      "utf8",
    );
    await writeFile(
      join(fixture.root, "package.json"),
      JSON.stringify({ name: "never-display-this", scripts: { test: "secret-command" }, private: true }),
      "utf8",
    );
    await writeFile(
      join(fixture.root, "docs", "adr", "ADR-007-refresh.md"),
      "# ADR-007\n## Status\nAccepted\n## Context\nKeep the current reading snapshot.\n## Decision\nRefresh only after an explicit action.\n## Consequences\nNo silent replacement.\n",
      "utf8",
    );
    const records = await new LocalWorkspaceContextIndex().list(fixture.binding);
    const provider = new LocalWorkspaceAuthoritativeProvider();
    const read = async (key: string) => {
      const record = records.find((candidate) => candidate.canonicalKey === key);
      assert.ok(record);
      const result = await provider.getDetail({
        binding: fixture.binding,
        entityId: record.entityId,
        entityType: record.entityType,
        authorityLocator: record.authorityRef.locator,
        revisionPolicy: "current-or-explicit-stale",
      });
      assert.equal(result.kind, "snapshot");
      if (result.kind !== "snapshot") throw new Error("scenario detail unavailable");
      return result.snapshot;
    };

    const verification = await read("test/refresh.test.ts");
    assert.equal(verification.entityType, "verification");
    assert.match(String(verification.facts["验证范围"]), /refreshes the same card/u);
    assert.match(String(verification.facts["执行状态"]), /不能据此判定 PASS\/FAIL/u);

    const configuration = await read("package.json");
    assert.equal(configuration.entityType, "configuration");
    assert.match(String(configuration.facts["配置用途"]), /Node package/u);
    assert.match(String(configuration.facts["披露边界"]), /潜在密钥不进入卡片/u);
    assert.doesNotMatch(JSON.stringify(configuration.facts), /never-display-this|secret-command/u);

    const decision = await read("docs/adr/ADR-007-refresh.md");
    assert.equal(decision.entityType, "decision");
    assert.equal(decision.facts["状态"], "Accepted");
    assert.match(String(decision.facts["决策"]), /explicit action/u);
    assert.match(String(decision.facts["后果"]), /No silent replacement/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Markdown artifact detail exposes bounded purpose, changed sections, impact, and Git state", async () => {
  const fixture = await workspaceFixture();
  try {
    await git(fixture.root, "init", "--quiet");
    await git(fixture.root, "config", "user.email", "pointable@example.invalid");
    await git(fixture.root, "config", "user.name", "Pointable Test");
    await mkdir(join(fixture.root, "docs"));
    await writeFile(
      join(fixture.root, "README.md"),
      "# Pointable Context\n\nRestores development context without another Chat Turn.\n\n## Usage\n\nSelect a file name.\n",
      "utf8",
    );
    for (let index = 1; index <= 5; index += 1) {
      await writeFile(
        join(fixture.root, "docs", `reference-${index}.md`),
        `# Reference ${index}\n\nSee README.md for the product contract.\n`,
        "utf8",
      );
    }
    await git(fixture.root, "add", ".");
    await git(fixture.root, "commit", "--quiet", "-m", "seed documentation");
    await writeFile(
      join(fixture.root, "README.md"),
      "# Pointable Context\n\nRestores development context without another Chat Turn.\n\n## Usage\n\nSelect an exact file identity, then click 查看上下文.\n",
      "utf8",
    );

    const records = await new LocalWorkspaceContextIndex().list(fixture.binding);
    const record = records.find((candidate) => candidate.canonicalKey === "README.md");
    assert.ok(record);
    assert.equal(record.entityType, "document");
    const result = await new LocalWorkspaceAuthoritativeProvider().getDetail({
      binding: fixture.binding,
      entityId: record.entityId,
      entityType: record.entityType,
      authorityLocator: record.authorityRef.locator,
      revisionPolicy: "current-or-explicit-stale",
    });

    assert.equal(result.kind, "snapshot");
    if (result.kind !== "snapshot") return;
    assert.match(String(result.snapshot.facts["用途"]), /Restores development context/u);
    assert.match(String(result.snapshot.facts["本次变化"]), /Usage/u);
    assert.equal(result.snapshot.facts["Git 状态"], "modified");
    assert.equal(result.snapshot.facts["路径"], "README.md");
    const impact = result.snapshot.facts["影响范围"];
    assert.ok(Array.isArray(impact));
    assert.equal(impact.length, 3);
    assert.ok(impact.every((path) => typeof path === "string" && path.startsWith("docs/reference-")));
    assert.deepEqual(result.snapshot.sourceRefs.map((source) => source.sourceType), [
      "local_workspace_file",
      "local_git",
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Markdown Git enrichment treats option-like file names as data", async () => {
  const fixture = await workspaceFixture();
  try {
    await git(fixture.root, "init", "--quiet");
    await git(fixture.root, "config", "user.email", "pointable@example.invalid");
    await git(fixture.root, "config", "user.name", "Pointable Test");
    await writeFile(
      join(fixture.root, "--help.md"),
      "# Safe Path\n\nOption-like file names must never become Git options.\n",
      "utf8",
    );
    await git(fixture.root, "add", "--", "--help.md");
    await git(fixture.root, "commit", "--quiet", "-m", "add safe path fixture");
    const records = await new LocalWorkspaceContextIndex().list(fixture.binding);
    const record = records.find((candidate) => candidate.canonicalKey === "--help.md");
    assert.ok(record);
    const result = await new LocalWorkspaceAuthoritativeProvider().getDetail({
      binding: fixture.binding,
      entityId: record.entityId,
      entityType: record.entityType,
      authorityLocator: record.authorityRef.locator,
      revisionPolicy: "current-or-explicit-stale",
    });
    assert.equal(result.kind, "snapshot");
    if (result.kind === "snapshot") {
      assert.equal(result.snapshot.facts["Git 状态"], "clean");
      assert.match(String(result.snapshot.facts["用途"]), /Option-like file names/u);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("source module detail exposes responsibility, exports, changes, dependencies, and impact", async () => {
  const fixture = await workspaceFixture();
  try {
    await git(fixture.root, "init", "--quiet");
    await git(fixture.root, "config", "user.email", "pointable@example.invalid");
    await git(fixture.root, "config", "user.name", "Pointable Test");
    await mkdir(join(fixture.root, "src"));
    await mkdir(join(fixture.root, "test"));
    await writeFile(
      join(fixture.root, "src", "counter.ts"),
      `/** Maintains the bounded example counter used by the host. */
import { EventEmitter } from "node:events";

export function increment(value: number): number {
  return value + 1;
}

export const counterEvents = new EventEmitter();
`,
      "utf8",
    );
    await writeFile(
      join(fixture.root, "src", "consumer.ts"),
      `import { increment } from "./counter.js";\nexport const next = increment(1);\n`,
      "utf8",
    );
    await writeFile(
      join(fixture.root, "test", "counter.test.ts"),
      `import { increment } from "../src/counter.js";\nvoid increment(1);\n`,
      "utf8",
    );
    await git(fixture.root, "add", ".");
    await git(fixture.root, "commit", "--quiet", "-m", "seed source module");
    await writeFile(
      join(fixture.root, "src", "counter.ts"),
      `/** Maintains the bounded example counter used by the host. */
import { EventEmitter } from "node:events";

export function increment(value: number): number {
  return value + 2;
}

export const counterEvents = new EventEmitter();
`,
      "utf8",
    );

    const records = await new LocalWorkspaceContextIndex().list(fixture.binding);
    const record = records.find((candidate) => candidate.canonicalKey === "src/counter.ts");
    assert.ok(record);
    assert.equal(record.entityType, "module");
    const result = await new LocalWorkspaceAuthoritativeProvider().getDetail({
      binding: fixture.binding,
      entityId: record.entityId,
      entityType: record.entityType,
      authorityLocator: record.authorityRef.locator,
      revisionPolicy: "current-or-explicit-stale",
    });

    assert.equal(result.kind, "snapshot");
    if (result.kind !== "snapshot") return;
    assert.match(String(result.snapshot.facts["职责"]), /Maintains the bounded example counter/u);
    assert.deepEqual(result.snapshot.facts["公开入口"], ["increment", "counterEvents"]);
    assert.match(String(result.snapshot.facts["本次变化"]), /modified.*increment/u);
    assert.deepEqual(result.snapshot.facts["依赖与影响"], [
      "依赖: node:events",
      "测试: test/counter.test.ts",
      "引用: src/consumer.ts",
    ]);
    assert.equal(result.snapshot.facts["路径"], "src/counter.ts");
    assert.deepEqual(result.snapshot.sourceRefs.map((source) => source.sourceType), [
      "local_workspace_file",
      "local_git",
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("source module enrichment keeps option-like paths as Git data", async () => {
  const fixture = await workspaceFixture();
  try {
    await git(fixture.root, "init", "--quiet");
    await git(fixture.root, "config", "user.email", "pointable@example.invalid");
    await git(fixture.root, "config", "user.name", "Pointable Test");
    await writeFile(
      join(fixture.root, "--eval.ts"),
      "/** Option-like source paths remain inert data. */\nexport const safe = true;\n",
      "utf8",
    );
    await git(fixture.root, "add", "--", "--eval.ts");
    await git(fixture.root, "commit", "--quiet", "-m", "add safe source path");
    const records = await new LocalWorkspaceContextIndex().list(fixture.binding);
    const record = records.find((candidate) => candidate.canonicalKey === "--eval.ts");
    assert.ok(record);
    assert.equal(record.entityType, "module");
    const result = await new LocalWorkspaceAuthoritativeProvider().getDetail({
      binding: fixture.binding,
      entityId: record.entityId,
      entityType: record.entityType,
      authorityLocator: record.authorityRef.locator,
      revisionPolicy: "current-or-explicit-stale",
    });
    assert.equal(result.kind, "snapshot");
    if (result.kind === "snapshot") {
      assert.match(String(result.snapshot.facts["本次变化"]), /^clean/u);
      assert.match(String(result.snapshot.facts["职责"]), /Option-like source paths/u);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("workspace provider rejects traversal and authority tuple tampering", async () => {
  const fixture = await workspaceFixture();
  try {
    await writeFile(join(fixture.root, "README.md"), "safe", "utf8");
    const provider = new LocalWorkspaceAuthoritativeProvider();
    const base = {
      binding: fixture.binding,
      entityId: "file:../secret.txt",
      entityType: "file",
      authorityLocator: "../secret.txt",
      revisionPolicy: "current-or-explicit-stale" as const,
    };
    assert.deepEqual(await provider.getDetail(base), { kind: "not_found" });
    assert.deepEqual(await provider.getDetail({
      ...base,
      entityId: "file:README.md",
      authorityLocator: "README.md",
      entityType: "decision",
    }), { kind: "not_found" });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("workspace index fails closed instead of silently truncating", async () => {
  const fixture = await workspaceFixture();
  try {
    await writeFile(join(fixture.root, "one.md"), "one", "utf8");
    await writeFile(join(fixture.root, "two.md"), "two", "utf8");
    const index = new LocalWorkspaceContextIndex({ maxFiles: 1 });
    await assert.rejects(
      () => index.list(fixture.binding),
      /file count bound/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

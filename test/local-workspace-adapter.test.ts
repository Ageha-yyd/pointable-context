import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type { TrustedContextBinding } from "../src/contracts.js";
import {
  LocalWorkspaceAuthoritativeProvider,
  LocalWorkspaceContextIndex,
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

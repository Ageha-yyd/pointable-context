import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TrustedContextBinding } from "../src/contracts.js";
import {
  LocalWorkspaceAuthoritativeProvider,
  LocalWorkspaceContextIndex,
} from "../src/adapters/local-workspace.js";
import { localWorkspaceScope } from "../src/host/codex-cdp/task-workspace-binding.js";
import { resolveSelection } from "../src/resolver.js";

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
    assert.match(String(first.snapshot.facts.preview), /Current project notes/u);

    await writeFile(path, "# Second\nUpdated notes.\n", "utf8");
    const second = await read();
    assert.equal(second.kind, "snapshot");
    if (second.kind === "snapshot") {
      assert.notEqual(second.snapshot.entityRevision, first.snapshot.entityRevision);
      assert.match(String(second.snapshot.facts.preview), /Updated notes/u);
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

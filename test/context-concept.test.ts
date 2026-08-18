import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TrustedContextBinding } from "../src/contracts.js";
import {
  contextConceptDocumentPath,
  extractContextConceptArtifact,
} from "../src/adapters/context-concept.js";
import {
  LocalWorkspaceAuthoritativeProvider,
  LocalWorkspaceContextIndex,
} from "../src/adapters/local-workspace.js";
import { localWorkspaceScope } from "../src/host/codex-cdp/task-workspace-binding.js";
import { resolveSelection } from "../src/resolver.js";

const evidence = "A pilot may find workflow defects but must not be used to claim significance.";

function artifact(sourceLine = 1): string {
  return `# Pilot

## 它是什么意思
正式实验前的小规模可用性试跑。

## 为什么现在出现
技术链路已经可用，但人的理解效果尚未验证。

## 它不是什么
不能证明产品已经显著提升效率。

## 所处流程
- 原型完成
- 当前：Pilot
- 确定正式样本量

## 证据
> ${evidence}

## 来源
docs/evaluation-protocol.md:${sourceLine}
`;
}

test("concept artifacts require an explicit bounded mental-model structure", () => {
  assert.equal(contextConceptDocumentPath("docs/concepts/pilot.md"), true);
  assert.equal(contextConceptDocumentPath("docs/pilot.md"), false);
  const parsed = extractContextConceptArtifact(artifact());
  assert.ok(parsed);
  assert.equal(parsed.title, "Pilot");
  assert.equal(parsed.currentStep, 1);
  assert.deepEqual(parsed.sequence, ["原型完成", "Pilot", "确定正式样本量"]);
  assert.equal(parsed.evidence.sourcePath, "docs/evaluation-protocol.md");
  assert.equal(extractContextConceptArtifact("# Pilot\n\nUnstructured prose."), undefined);
});

test("workspace concept lookup verifies the declared evidence line before returning detail", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-concept-"));
  try {
    await mkdir(join(root, "docs", "concepts"), { recursive: true });
    await writeFile(join(root, "docs", "evaluation-protocol.md"), `- ${evidence}\n`, "utf8");
    await writeFile(join(root, "docs", "concepts", "pilot.md"), artifact(), "utf8");
    const canonicalRoot = await realpath(root);
    const binding: TrustedContextBinding = {
      kind: "trusted",
      scope: localWorkspaceScope(canonicalRoot),
      bindingRevision: "binding-1",
      evidence: "explicit_user",
      selectionGeneration: 1,
      threadRef: "codex-desktop:host-1:thread-1",
      routeRef: "app://-/index.html",
      workspaceRoot: canonicalRoot,
    };
    const records = await new LocalWorkspaceContextIndex().list(binding);
    const resolved = resolveSelection(binding.scope, "pilot", records);
    assert.equal(resolved.kind, "unique");
    if (resolved.kind !== "unique") return;
    assert.equal(resolved.candidate.record.entityType, "concept");
    assert.equal(resolved.candidate.record.canonicalName, "Pilot");
    const detail = await new LocalWorkspaceAuthoritativeProvider().getDetail({
      binding,
      entityId: resolved.candidate.record.entityId,
      entityType: resolved.candidate.record.entityType,
      authorityLocator: "docs/concepts/pilot.md",
      revisionPolicy: "current-or-explicit-stale",
    });
    assert.equal(detail.kind, "snapshot");
    if (detail.kind !== "snapshot") return;
    assert.equal(detail.snapshot.facts["它是什么意思"], "正式实验前的小规模可用性试跑。");
    assert.deepEqual(detail.snapshot.facts["所处流程"], [
      "原型完成",
      "当前：Pilot",
      "确定正式样本量",
    ]);
    assert.deepEqual(detail.snapshot.sourceRefs.map((item) => item.sourceType), [
      "local_workspace_file",
      "project_evidence",
    ]);

    await writeFile(join(root, "docs", "evaluation-protocol.md"), "evidence drifted\n", "utf8");
    assert.deepEqual(await new LocalWorkspaceAuthoritativeProvider().getDetail({
      binding,
      entityId: resolved.candidate.record.entityId,
      entityType: resolved.candidate.record.entityType,
      authorityLocator: "docs/concepts/pilot.md",
      revisionPolicy: "current-or-explicit-stale",
    }), { kind: "not_found" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

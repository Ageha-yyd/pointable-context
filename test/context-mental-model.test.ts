import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TrustedContextBinding } from "../src/contracts.js";
import {
  contextChangeDocumentPath,
  contextDecisionDocumentPath,
  extractContextChangeArtifact,
  extractContextConceptArtifact,
  extractContextDecisionArtifact,
} from "../src/adapters/context-concept.js";

function normalizedEvidenceLine(line: string): string {
  return line.replace(/^\s*(?:(?:[-*+>])|(?:\d+[.)]))\s+/u, "").trim();
}

test("repository mental-model samples keep exact evidence references", async () => {
  const samples = [
    {
      artifactPath: "docs/concepts/pilot.md",
      parse: extractContextConceptArtifact,
    },
    {
      artifactPath: "docs/changes/presentation-default.md",
      parse: extractContextChangeArtifact,
    },
    {
      artifactPath: "docs/decisions/native-chat-lane.md",
      parse: extractContextDecisionArtifact,
    },
  ] as const;

  for (const sample of samples) {
    const artifact = sample.parse(await readFile(sample.artifactPath, "utf8"));
    assert.ok(artifact, `${sample.artifactPath} must remain a valid explicit mental model`);
    const sourceLines = (await readFile(artifact.evidence.sourcePath, "utf8")).split(/\r?\n/u);
    const sourceLine = sourceLines[artifact.evidence.sourceLine - 1];
    assert.equal(
      normalizedEvidenceLine(sourceLine ?? ""),
      normalizedEvidenceLine(artifact.evidence.excerpt),
      `${sample.artifactPath} must quote its source line exactly`,
    );
  }
});
import {
  LocalWorkspaceAuthoritativeProvider,
  LocalWorkspaceContextIndex,
} from "../src/adapters/local-workspace.js";
import { localWorkspaceScope } from "../src/host/codex-cdp/task-workspace-binding.js";
import { resolveSelection } from "../src/resolver.js";

const changeEvidence = 'let presentationMode: PointablePresentationMode = "mental-model";';
const decisionEvidence = "首个宿主是 Codex Desktop 当前 Chat Lane。";

function changeArtifact(): string {
  return `# Presentation Default

## 原来怎样
普通启动使用记录式摘要，用户要自己拼接概念、阶段和边界。

## 现在怎样
普通启动默认使用 P-C 微型心智模型，P-A/P-B 只在显式研究条件中启用。

## 影响什么
首次打开概念卡时会直接看到定义、当前语境、流程位置和边界。

## 证据
> ${changeEvidence}

## 来源
src/host/codex-cdp/workspace-companion-cli.ts:1
`;
}

function decisionArtifact(): string {
  return `# Native Chat Lane

## 为什么需要决定
浏览器或外部 Dashboard 会增加离开当前任务和重新定位信息的切换成本。

## 选择了什么
首个产品宿主固定为 Codex Desktop 当前 Chat Lane，详情在选区附近原位呈现。

## 后果是什么
用户无需离开任务，但私有 Host Adapter 必须在每个 Desktop build 上重新通过兼容门禁。

## 证据
> ${decisionEvidence}

## 来源
docs/PRD-inline-pointable-widgets.md:1
`;
}

test("change and decision artifacts require explicit type-specific mental models", () => {
  assert.equal(contextChangeDocumentPath("docs/changes/presentation-default.md"), true);
  assert.equal(contextDecisionDocumentPath("docs/decisions/native-chat-lane.md"), true);
  assert.equal(contextChangeDocumentPath("docs/presentation-default.md"), false);
  assert.equal(contextDecisionDocumentPath("docs/adr/native-chat-lane.md"), false);
  assert.deepEqual(extractContextChangeArtifact(changeArtifact())?.before,
    "普通启动使用记录式摘要，用户要自己拼接概念、阶段和边界。");
  assert.deepEqual(extractContextDecisionArtifact(decisionArtifact())?.choice,
    "首个产品宿主固定为 Codex Desktop 当前 Chat Lane，详情在选区附近原位呈现。");
  assert.equal(extractContextChangeArtifact("# Change\n\nUnstructured"), undefined);
  assert.equal(extractContextDecisionArtifact("# Decision\n\nUnstructured"), undefined);
});

test("workspace lookup verifies change and decision evidence before projecting P-C facts", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-mental-model-"));
  try {
    await mkdir(join(root, "docs", "changes"), { recursive: true });
    await mkdir(join(root, "docs", "decisions"), { recursive: true });
    await mkdir(join(root, "src", "host", "codex-cdp"), { recursive: true });
    await writeFile(join(root, "src", "host", "codex-cdp", "workspace-companion-cli.ts"), `${changeEvidence}\n`, "utf8");
    await writeFile(join(root, "docs", "PRD-inline-pointable-widgets.md"), `- ${decisionEvidence}\n`, "utf8");
    await writeFile(join(root, "docs", "changes", "presentation-default.md"), changeArtifact(), "utf8");
    await writeFile(join(root, "docs", "decisions", "native-chat-lane.md"), decisionArtifact(), "utf8");
    const canonicalRoot = await realpath(root);
    const binding: TrustedContextBinding = {
      kind: "trusted",
      scope: localWorkspaceScope(canonicalRoot),
      bindingRevision: "binding-mental-model",
      evidence: "explicit_user",
      selectionGeneration: 1,
      threadRef: "codex-desktop:host-1:thread-1",
      routeRef: "app://-/index.html",
      workspaceRoot: canonicalRoot,
    };
    const records = await new LocalWorkspaceContextIndex().list(binding);
    const provider = new LocalWorkspaceAuthoritativeProvider();

    const change = resolveSelection(binding.scope, "presentation-default", records);
    assert.equal(change.kind, "unique");
    if (change.kind !== "unique") return;
    assert.equal(change.candidate.record.entityType, "change");
    assert.equal(change.candidate.record.canonicalName, "Presentation Default");
    const changeDetail = await provider.getDetail({
      binding,
      entityId: change.candidate.record.entityId,
      entityType: "change",
      authorityLocator: "docs/changes/presentation-default.md",
      revisionPolicy: "current-or-explicit-stale",
    });
    assert.equal(changeDetail.kind, "snapshot");
    if (changeDetail.kind === "snapshot") {
      assert.match(String(changeDetail.snapshot.facts["现在怎样"]), /P-C 微型心智模型/u);
      assert.deepEqual(changeDetail.snapshot.sourceRefs.map((item) => item.sourceType), [
        "local_workspace_file",
        "project_evidence",
      ]);
    }

    const decision = resolveSelection(binding.scope, "native-chat-lane", records);
    assert.equal(decision.kind, "unique");
    if (decision.kind !== "unique") return;
    assert.equal(decision.candidate.record.entityType, "decision");
    assert.equal(decision.candidate.record.canonicalName, "Native Chat Lane");
    const decisionDetail = await provider.getDetail({
      binding,
      entityId: decision.candidate.record.entityId,
      entityType: "decision",
      authorityLocator: "docs/decisions/native-chat-lane.md",
      revisionPolicy: "current-or-explicit-stale",
    });
    assert.equal(decisionDetail.kind, "snapshot");
    if (decisionDetail.kind === "snapshot") {
      assert.match(String(decisionDetail.snapshot.facts["选择了什么"]), /Codex Desktop/u);
    }

    await writeFile(join(root, "docs", "PRD-inline-pointable-widgets.md"), "evidence drifted\n", "utf8");
    assert.deepEqual(await provider.getDetail({
      binding,
      entityId: decision.candidate.record.entityId,
      entityType: "decision",
      authorityLocator: "docs/decisions/native-chat-lane.md",
      revisionPolicy: "current-or-explicit-stale",
    }), { kind: "not_found" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

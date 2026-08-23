import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  LocalWorkspaceAuthoritativeProvider,
  LocalWorkspaceContextIndex,
  LocalWorkspaceRevisionProbe,
} from "../src/adapters/local-workspace.js";
import type { PointableLookupCallbackRequest } from "../src/host/codex-cdp/adapter.js";
import type { CodexHostTaskContext } from "../src/host/codex-cdp/host-context.js";
import { validatePointableLookupPresentation } from "../src/host/codex-cdp/protocol.js";
import {
  ActiveTaskObjectAnnotationIndex,
  CompositeContextIndex,
  RoutedWorkspaceRevisionProbe,
  TaskObjectRegistry,
  TaskObjectWorkspaceContextIndex,
  parseTaskObjectInput,
} from "../src/host/codex-cdp/task-object-registry.js";
import {
  CodexTaskWorkspaceBindingPort,
  CodexTaskWorkspaceBindingRegistry,
  codexTaskThreadRef,
} from "../src/host/codex-cdp/task-workspace-binding.js";
import { createWorkspaceLookupCallback } from "../src/host/codex-cdp/workspace-lookup.js";

function task(threadId = "thread-objects"): CodexHostTaskContext {
  const routeRef = "app://-/index.html";
  const hostId = "host-objects";
  return {
    schemaVersion: 1,
    host: "codex-desktop",
    threadId,
    hostId,
    routeRef,
    contextFingerprint: JSON.stringify({ href: routeRef, threadId, hostId }),
  };
}

function conceptInput(context = "长任务开始产生只存在于当前任务中的新概念。") {
  return {
    schemaVersion: 1,
    objectKey: "DYNAMIC-OBJECT-LIFECYCLE",
    entityType: "concept",
    canonicalName: "Dynamic Object Lifecycle",
    aliases: ["动态 Object 生命周期"],
    summary: "任务内对象从出现、更新到替代和退役的有界生命周期。",
    mentalModel: {
      kind: "concept",
      meaning: "显式登记当前长任务中尚未固化到仓库的高价值对象。",
      context,
      boundary: "它不是对普通 Chat 文本的模型推断，也不是稳定项目事实。",
      sequence: ["对象出现", "当前：任务内登记与查询", "稳定后固化或退役"],
      evidence: "Companion 接收到当前任务上的显式登记动作。",
    },
  } as const;
}

function request(activeTask: CodexHostTaskContext, text: string, overrides = {}): PointableLookupCallbackRequest {
  return {
    operation: "resolve",
    requestId: `request-${createHash("sha256").update(text).digest("hex").slice(0, 8)}`,
    selection: {
      text,
      digest: createHash("sha256").update(text, "utf8").digest("hex"),
      generation: 1,
      surface: "assistant_message",
    },
    contextFingerprint: activeTask.contextFingerprint,
    requestedAt: new Date().toISOString(),
    host: {
      targetId: "target-objects",
      targetUrl: "app://-/index.html",
      bindingGeneration: "binding-objects",
      task: activeTask,
      revalidateTask: async () => activeTask,
    },
    signal: new AbortController().signal,
    ...overrides,
  } as PointableLookupCallbackRequest;
}

test("task object input is strict and type-specific", () => {
  const parsed = parseTaskObjectInput(conceptInput());
  assert.equal(parsed.entityType, "concept");
  assert.equal(parsed.mentalModel.kind, "concept");
  assert.throws(
    () => parseTaskObjectInput({ ...conceptInput(), extra: "hidden" }),
    /task object input is invalid/u,
  );
  assert.throws(
    () => parseTaskObjectInput({
      ...conceptInput(),
      mentalModel: { ...conceptInput().mentalModel, sequence: ["one", "two"] },
    }),
    /exactly one 当前 step/u,
  );
});

test("task objects are task-bound, partial, mutable, supersedable, and retireable", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-task-objects-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const bindingRegistry = new CodexTaskWorkspaceBindingRegistry(join(root, "bindings.json"));
  const objects = new TaskObjectRegistry(join(root, "task-objects.json"));
  const activeTask = task();
  const entry = await bindingRegistry.bind(activeTask, workspace);
  const bindingPort = new CodexTaskWorkspaceBindingPort(
    bindingRegistry,
    activeTask,
    { current: async () => activeTask },
  );
  const binding = await bindingPort.resolve({
    selectionGeneration: 1,
    explicitScope: entry.scope,
    threadRef: codexTaskThreadRef(activeTask),
    routeRef: activeTask.routeRef,
    workspaceRoot: workspace,
  });
  assert.equal(binding.kind, "trusted");
  if (binding.kind !== "trusted") return;
  try {
    const created = await objects.upsert(activeTask, entry, conceptInput());
    assert.equal(created.kind, "created");
    assert.equal(created.object.lifecycle, "active");
    const unchanged = await objects.upsert(activeTask, entry, conceptInput());
    assert.equal(unchanged.kind, "unchanged");
    assert.equal(unchanged.object.entityRevision, created.object.entityRevision);
    await assert.rejects(
      () => objects.upsert(activeTask, entry, {
        ...conceptInput(),
        canonicalName: "Renamed Dynamic Object",
      }),
      /identity changes require supersede/u,
    );

    const identities = await objects.list(binding);
    assert.equal(identities.length, 1);
    assert.equal(identities[0]?.canonicalKey, "DYNAMIC-OBJECT-LIFECYCLE");
    assert.equal(identities[0]?.authorityRef.provider, "agent-task-context");

    const detail = await objects.getDetail({
      binding,
      entityId: created.object.entityId,
      entityType: "concept",
      authorityLocator: created.object.entityId,
      revisionPolicy: "current-or-explicit-stale",
    });
    assert.equal(detail.kind, "snapshot");
    if (detail.kind === "snapshot") {
      assert.equal(detail.snapshot.freshness, "partial");
      assert.match(String(detail.snapshot.facts["信息边界"]), /任务内.*临时上下文/u);
      assert.deepEqual(detail.snapshot.sourceRefs, [{
        sourceType: "agent-task-context",
        sourceId: "DYNAMIC-OBJECT-LIFECYCLE",
      }]);
    }

    const updated = await objects.upsert(activeTask, entry, conceptInput("长任务已进入动态对象实现阶段。"));
    assert.equal(updated.kind, "updated");
    assert.notEqual(updated.object.entityRevision, created.object.entityRevision);
    const probe = await objects.probe({ binding, entityId: created.object.entityId, entityType: "concept" });
    assert.equal(probe.kind, "current");
    if (probe.kind === "current") assert.equal(probe.revision, updated.object.entityRevision);

    const replacement = {
      ...conceptInput(),
      objectKey: "DYNAMIC-OBJECT-LIFECYCLE-V2",
      canonicalName: "Dynamic Object Lifecycle v2",
      summary: "替代旧对象后的任务内生命周期。",
    };
    const superseded = await objects.supersede(
      activeTask,
      entry,
      "DYNAMIC-OBJECT-LIFECYCLE",
      replacement,
    );
    assert.equal(superseded.kind, "superseded");
    assert.equal(superseded.object.lifecycle, "superseded");
    assert.equal(superseded.object.replacedByObjectKey, "DYNAMIC-OBJECT-LIFECYCLE-V2");
    assert.equal(superseded.replacement?.lifecycle, "active");
    assert.deepEqual((await objects.list(binding)).map((item) => item.canonicalKey), [
      "DYNAMIC-OBJECT-LIFECYCLE",
      "DYNAMIC-OBJECT-LIFECYCLE-V2",
    ]);
    assert.deepEqual((await new ActiveTaskObjectAnnotationIndex(objects).list(binding))
      .map((item) => item.canonicalKey), ["DYNAMIC-OBJECT-LIFECYCLE-V2"]);
    const historical = await objects.getDetail({
      binding,
      entityId: superseded.object.entityId,
      entityType: "concept",
      authorityLocator: superseded.object.entityId,
      revisionPolicy: "current-or-explicit-stale",
    });
    assert.equal(historical.kind, "snapshot");
    if (historical.kind === "snapshot") {
      assert.equal(historical.snapshot.facts["生命周期"], "superseded");
      assert.equal(historical.snapshot.facts["替代对象"], "DYNAMIC-OBJECT-LIFECYCLE-V2");
    }

    const historicalLookup = createWorkspaceLookupCallback({
      registry: bindingRegistry,
      index: new CompositeContextIndex([new LocalWorkspaceContextIndex(), objects]),
      providers: [new LocalWorkspaceAuthoritativeProvider(), objects],
      revisionProbe: new RoutedWorkspaceRevisionProbe(objects, new LocalWorkspaceRevisionProbe()),
    });
    const historicalPresentation = validatePointableLookupPresentation(
      await historicalLookup(request(activeTask, "Dynamic Object Lifecycle")),
    );
    assert.equal(historicalPresentation.kind, "detail");
    if (historicalPresentation.kind === "detail") {
      assert.deepEqual(historicalPresentation.detail.terminalState, {
        kind: "superseded",
        replacementKey: "DYNAMIC-OBJECT-LIFECYCLE-V2",
      });
      assert.deepEqual(historicalPresentation.detail.facts.slice(0, 2), [
        { label: "生命周期", value: "superseded" },
        { label: "替代对象", value: "DYNAMIC-OBJECT-LIFECYCLE-V2" },
      ]);
    }

    const retired = await objects.retire(activeTask, entry, "DYNAMIC-OBJECT-LIFECYCLE-V2");
    assert.equal(retired.kind, "retired");
    assert.equal((await objects.list(binding)).length, 2);
    assert.equal((await objects.listActive(binding)).length, 0);
    const stableIdentity = {
      schemaVersion: "1.0" as const,
      scope: { ...binding.scope },
      entityId: "concept:stable-graduation",
      entityType: "concept",
      canonicalKey: "docs/concepts/dynamic-object-lifecycle-v2.md",
      canonicalName: "Dynamic Object Lifecycle v2",
      aliases: [],
      summary: "稳定仓库制品",
      authorityRef: { provider: "local-filesystem", locator: "docs/concepts/dynamic-object-lifecycle-v2.md" },
      indexRevision: "stable:r1",
      indexedAt: new Date().toISOString(),
      deleted: false,
    };
    const graduatedIndex = new TaskObjectWorkspaceContextIndex({
      list: async () => [stableIdentity],
    }, objects);
    const graduated = await graduatedIndex.list(binding);
    assert.equal(graduated.some((item) => item.entityId === retired.object.entityId), false);
    assert.equal(graduated.some((item) => item.entityId === stableIdentity.entityId), true);
    assert.equal(graduated.some((item) => item.entityId === superseded.object.entityId), true);
    await assert.rejects(
      () => objects.upsert(activeTask, entry, replacement),
      /cannot be reactivated/u,
    );

    const otherTask = task("thread-other");
    const otherEntry = await bindingRegistry.bind(otherTask, workspace);
    assert.deepEqual(await objects.listForTask(otherTask, otherEntry), []);
    const raw = JSON.parse(await readFile(objects.path, "utf8")) as { records: unknown[] };
    assert.equal(raw.records.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace lookup renders a task-local object and refreshes the same card after update", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-task-object-lookup-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const bindingRegistry = new CodexTaskWorkspaceBindingRegistry(join(root, "bindings.json"));
  const objects = new TaskObjectRegistry(join(root, "task-objects.json"));
  const activeTask = task();
  const entry = await bindingRegistry.bind(activeTask, workspace);
  await objects.upsert(activeTask, entry, conceptInput());
  const localIndex = new LocalWorkspaceContextIndex();
  const localProvider = new LocalWorkspaceAuthoritativeProvider();
  const callback = createWorkspaceLookupCallback({
    registry: bindingRegistry,
    index: new CompositeContextIndex([localIndex, objects]),
    providers: [localProvider, objects],
    revisionProbe: new RoutedWorkspaceRevisionProbe(objects, new LocalWorkspaceRevisionProbe()),
  });
  try {
    const initial = validatePointableLookupPresentation(
      await callback(request(activeTask, "Dynamic Object Lifecycle")),
    );
    assert.equal(initial.kind, "detail");
    if (initial.kind !== "detail") return;
    assert.equal(initial.detail.freshness, "partial");
    assert.equal(initial.detail.comprehension?.kind, "concept");
    assert.match(initial.detail.humanSummary ?? "", /长任务/u);
    assert.match(initial.detail.detailRef ?? "", /^pdet:/u);

    await objects.upsert(activeTask, entry, conceptInput("对象内容已随开发推进而更新。"));
    const checked = validatePointableLookupPresentation(await callback(request(
      activeTask,
      "Dynamic Object Lifecycle",
      { operation: "check", detailRef: initial.detail.detailRef, requestId: "check-task-object" },
    )));
    assert.equal(checked.kind, "revision");
    if (checked.kind === "revision") assert.equal(checked.revision.state, "updated");

    const refreshed = validatePointableLookupPresentation(await callback(request(
      activeTask,
      "Dynamic Object Lifecycle",
      { operation: "refresh", detailRef: initial.detail.detailRef, requestId: "refresh-task-object" },
    )));
    assert.equal(refreshed.kind, "detail");
    if (refreshed.kind === "detail") {
      assert.equal(refreshed.detail.detailRef, initial.detail.detailRef);
      assert.match(refreshed.detail.humanSummary ?? "", /随开发推进/u);
      assert.ok((refreshed.detail.changes?.length ?? 0) > 0);
    }

    await objects.retire(activeTask, entry, "DYNAMIC-OBJECT-LIFECYCLE");
    const terminalUpdate = validatePointableLookupPresentation(await callback(request(
      activeTask,
      "Dynamic Object Lifecycle",
      { operation: "check", detailRef: initial.detail.detailRef, requestId: "delete-task-object" },
    )));
    assert.equal(terminalUpdate.kind, "revision");
    if (terminalUpdate.kind === "revision") assert.equal(terminalUpdate.revision.state, "updated");
    const historical = validatePointableLookupPresentation(await callback(request(
      activeTask,
      "Dynamic Object Lifecycle",
      { operation: "refresh", detailRef: initial.detail.detailRef, requestId: "retired-task-object" },
    )));
    assert.equal(historical.kind, "detail");
    if (historical.kind === "detail") {
      assert.equal(historical.detail.facts.find((fact) => fact.label === "生命周期")?.value, "retired");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

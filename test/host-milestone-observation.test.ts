import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CodexHostTaskContext } from "../src/host/codex-cdp/host-context.js";
import {
  MilestoneObservationLedger,
  MILESTONE_OBSERVATION_MAX_EVENTS,
  milestoneObservationContextSha256,
} from "../src/host/codex-cdp/milestone-observation.js";
import { TaskObjectRegistry } from "../src/host/codex-cdp/task-object-registry.js";
import { CodexTaskWorkspaceBindingRegistry } from "../src/host/codex-cdp/task-workspace-binding.js";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function task(threadId: string): CodexHostTaskContext {
  const routeRef = "app://-/index.html";
  const hostId = "host-milestone-observation";
  return {
    schemaVersion: 1,
    host: "codex-desktop",
    threadId,
    hostId,
    routeRef,
    contextFingerprint: JSON.stringify({ href: routeRef, threadId, hostId }),
  };
}

function conceptInput() {
  return {
    schemaVersion: 1,
    objectKey: "OBSERVATION-CONCEPT",
    entityType: "concept",
    canonicalName: "Private Observation Concept",
    aliases: ["私有观察概念"],
    summary: "只用于验证里程碑观察，不应写入观察账本正文。",
    mentalModel: {
      kind: "concept",
      meaning: "验证任务内对象可用性。",
      context: "长任务经过多个稳定里程碑。",
      boundary: "不保存 Chat、文件正文或对象名称。",
      sequence: ["登记对象", "当前：观察", "聚合趋势"],
      evidence: "测试构造的当前任务 Registry。",
    },
  } as const;
}

async function observationInput(
  objects: TaskObjectRegistry,
  activeTask: CodexHostTaskContext,
  binding: Awaited<ReturnType<CodexTaskWorkspaceBindingRegistry["bind"]>>,
  milestoneKey: string,
) {
  const workspaceRecords: [] = [];
  const review = await objects.reviewCuration(activeTask, binding, workspaceRecords, {
    schemaVersion: 1,
    milestoneKey,
    needs: [
      {
        term: "Private Observation Concept",
        expectedEntityType: "concept",
        needKind: "resume",
      },
      { term: "Unrecorded Design Decision", expectedEntityType: "decision", needKind: "decision" },
    ],
  });
  return {
    task: activeTask,
    binding,
    review,
    audit: await objects.auditCuration(activeTask, binding, workspaceRecords),
    inventory: await objects.inventoryForTask(activeTask, binding),
  };
}

test("private milestone ledger stores only digests and bounded aggregate signals", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-milestone-observation-"));
  const workspace = join(root, "workspace");
  const privateState = join(root, "private-state");
  const ledgerPath = join(privateState, "milestones.json");
  await mkdir(workspace);
  const activeTask = task("thread-private-raw-data-must-not-persist");
  const bindings = new CodexTaskWorkspaceBindingRegistry(join(root, "bindings.json"));
  const binding = await bindings.bind(activeTask, workspace);
  const objects = new TaskObjectRegistry(join(root, "task-objects.json"));
  await objects.upsert(activeTask, binding, conceptInput());
  const ledger = new MilestoneObservationLedger(ledgerPath);
  try {
    const firstInput = await observationInput(objects, activeTask, binding, "PRIVATE-MILESTONE-ONE");
    const first = await ledger.record(firstInput);
    assert.match(first.eventSha256, /^[a-f0-9]{64}$/u);
    assert.equal(first.contextSha256, milestoneObservationContextSha256(activeTask, binding));
    assert.equal(first.review.available, 1);
    assert.equal(first.review.missing, 1);
    assert.equal(first.needs[0]?.source, "task_local");
    assert.equal(
      first.needs[0]?.termSha256,
      sha256("Private Observation Concept".normalize("NFKC").trim().toLocaleLowerCase("en-US")),
    );

    const persisted = await readFile(ledgerPath, "utf8");
    for (const forbidden of [
      "Private Observation Concept",
      "Unrecorded Design Decision",
      "PRIVATE-MILESTONE-ONE",
      "thread-private-raw-data-must-not-persist",
      workspace,
      "验证任务内对象可用性",
    ]) {
      assert.equal(persisted.includes(forbidden), false, `persisted raw value: ${forbidden}`);
    }
    assert.equal(persisted.includes("milestoneKey"), false);
    assert.equal(persisted.includes("term\""), false);

    const secondInput = await observationInput(objects, activeTask, binding, "PRIVATE-MILESTONE-TWO");
    await ledger.record(secondInput);
    const summary = await ledger.summary(activeTask, binding);
    assert.equal(summary.measurement, "private_milestone_observation");
    assert.equal(summary.eventCount, 2);
    assert.equal(summary.milestoneCount, 2);
    assert.equal(summary.available, 2);
    assert.equal(summary.missing, 2);
    assert.equal(summary.taskLocalAvailable, 2);
    assert.equal(summary.workspaceAvailable, 0);
    assert.equal(summary.recurringNeeds.length, 2);
    assert.ok(summary.recurringNeeds.every((item) => item.observations === 2));

    const anotherTask = task("thread-context-isolation");
    const anotherBinding = await bindings.bind(anotherTask, workspace);
    const isolated = await ledger.summary(anotherTask, anotherBinding);
    assert.equal(isolated.eventCount, 0);
    assert.equal(isolated.latestEventSha256, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("milestone ledger serializes concurrent events and validates the hash chain", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-milestone-chain-"));
  const workspace = join(root, "workspace");
  const ledgerPath = join(root, "private", "milestones.json");
  await mkdir(workspace);
  const activeTask = task("thread-chain");
  const bindings = new CodexTaskWorkspaceBindingRegistry(join(root, "bindings.json"));
  const binding = await bindings.bind(activeTask, workspace);
  const objects = new TaskObjectRegistry(join(root, "task-objects.json"));
  await objects.upsert(activeTask, binding, conceptInput());
  const ledger = new MilestoneObservationLedger(ledgerPath);
  try {
    const [firstInput, secondInput] = await Promise.all([
      observationInput(objects, activeTask, binding, "CHAIN-ONE"),
      observationInput(objects, activeTask, binding, "CHAIN-TWO"),
    ]);
    const [first, second] = await Promise.all([
      ledger.record(firstInput),
      ledger.record(secondInput),
    ]);
    assert.equal(first.previousEventSha256, null);
    assert.equal(second.previousEventSha256, first.eventSha256);

    const document = JSON.parse(await readFile(ledgerPath, "utf8")) as {
      events: Array<Record<string, unknown>>;
    };
    const secondEvent = document.events[1]!;
    secondEvent.previousEventSha256 = "f".repeat(64);
    const { eventSha256: _oldDigest, ...unsigned } = secondEvent;
    secondEvent.eventSha256 = sha256(JSON.stringify(unsigned));
    await writeFile(ledgerPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await assert.rejects(
      () => ledger.summary(activeTask, binding),
      /milestone_observation_chain_invalid/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("milestone ledger fails closed on tampering and workspace-visible storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-milestone-fail-closed-"));
  const workspace = join(root, "workspace");
  const ledgerPath = join(root, "private", "milestones.json");
  await mkdir(workspace);
  const activeTask = task("thread-fail-closed");
  const bindings = new CodexTaskWorkspaceBindingRegistry(join(root, "bindings.json"));
  const binding = await bindings.bind(activeTask, workspace);
  const objects = new TaskObjectRegistry(join(root, "task-objects.json"));
  await objects.upsert(activeTask, binding, conceptInput());
  const ledger = new MilestoneObservationLedger(ledgerPath);
  try {
    const input = await observationInput(objects, activeTask, binding, "TAMPER-ONE");
    await ledger.record(input);
    const document = JSON.parse(await readFile(ledgerPath, "utf8")) as {
      events: Array<{ curation: { registrySnapshotSha256: string } }>;
    };
    document.events[0]!.curation.registrySnapshotSha256 = "0".repeat(64);
    await writeFile(ledgerPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await assert.rejects(
      () => ledger.summary(activeTask, binding),
      /milestone_observation_digest_invalid/u,
    );

    const visibleLedger = new MilestoneObservationLedger(join(workspace, ".pointable", "ledger.json"));
    await assert.rejects(
      () => visibleLedger.record(input),
      /milestone_observation_ledger_must_be_private/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("milestone ledger enforces its event limit without dropping history", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-milestone-capacity-"));
  const workspace = join(root, "workspace");
  const ledgerPath = join(root, "private", "milestones.json");
  await mkdir(workspace);
  const activeTask = task("thread-capacity");
  const bindings = new CodexTaskWorkspaceBindingRegistry(join(root, "bindings.json"));
  const binding = await bindings.bind(activeTask, workspace);
  const objects = new TaskObjectRegistry(join(root, "task-objects.json"));
  await objects.upsert(activeTask, binding, conceptInput());
  const ledger = new MilestoneObservationLedger(ledgerPath);
  try {
    const input = await observationInput(objects, activeTask, binding, "CAPACITY-ONE");
    await ledger.record(input);
    const document = JSON.parse(await readFile(ledgerPath, "utf8")) as {
      events: Array<Record<string, unknown>>;
    };
    while (document.events.length < MILESTONE_OBSERVATION_MAX_EVENTS) {
      const previous = document.events.at(-1)!;
      const { eventSha256: previousDigest, ...base } = previous;
      const unsigned = {
        ...base,
        eventId: randomUUID(),
        previousEventSha256: previousDigest,
      };
      document.events.push({
        ...unsigned,
        eventSha256: sha256(JSON.stringify(unsigned)),
      });
    }
    await writeFile(ledgerPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    assert.equal((await ledger.summary(activeTask, binding)).eventCount, MILESTONE_OBSERVATION_MAX_EVENTS);
    await assert.rejects(
      () => ledger.record(input),
      /milestone_observation_ledger_full/u,
    );
    const after = JSON.parse(await readFile(ledgerPath, "utf8")) as { events: unknown[] };
    assert.equal(after.events.length, MILESTONE_OBSERVATION_MAX_EVENTS);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

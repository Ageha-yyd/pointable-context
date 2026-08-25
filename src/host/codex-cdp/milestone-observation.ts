import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { CodexHostTaskContext } from "./host-context.js";
import type { CodexTaskWorkspaceBindingEntry } from "./task-workspace-binding.js";
import { codexTaskThreadRef } from "./task-workspace-binding.js";
import type {
  TaskObjectCurationAudit,
  TaskObjectCurationNeedEntityType,
  TaskObjectCurationNeedKind,
  TaskObjectCurationNeedState,
  TaskObjectCurationReview,
  TaskObjectInventory,
} from "./task-object-registry.js";

export const MILESTONE_OBSERVATION_MAX_EVENTS = 512;
export const MILESTONE_OBSERVATION_MAX_BYTES = 4 * 1024 * 1024;
const MAX_RECURRING_NEEDS = 32;

export interface MilestoneObservationNeed {
  termSha256: string;
  expectedEntityType: TaskObjectCurationNeedEntityType;
  needKind: TaskObjectCurationNeedKind;
  state: TaskObjectCurationNeedState;
  matchCount: number;
  candidateTypes: readonly string[];
  source: "workspace" | "task_local" | null;
}

export interface MilestoneObservationReviewSummary {
  needCount: number;
  available: number;
  missing: number;
  ambiguous: number;
  typeMismatch: number;
  availabilityRate: number;
  omissionRate: number;
  resolutionFailureRate: number;
}

export interface MilestoneObservationCurationSummary {
  currentTaskRecords: number;
  activePartials: number;
  activeStableOverlaps: number;
  activeAmbiguousOverlaps: number;
  terminalUnmatched: number;
  terminalArchiveReady: number;
  terminalAmbiguous: number;
  stableOverlapRate: number;
  registrySnapshotSha256: string;
}

export interface MilestoneObservationCapacitySummary {
  active: number;
  terminal: number;
  currentTaskRecords: number;
  registryRecords: number;
  archivedRecords: number;
  warnings: readonly "active_soft_limit_reached"[];
}

export interface MilestoneObservationEvent {
  schemaVersion: 1;
  eventId: string;
  observedAt: string;
  milestoneSha256: string;
  contextSha256: string;
  bindingSha256: string;
  indexSnapshot: string;
  review: MilestoneObservationReviewSummary;
  needs: readonly MilestoneObservationNeed[];
  curation: MilestoneObservationCurationSummary;
  capacity: MilestoneObservationCapacitySummary;
  previousEventSha256: string | null;
  eventSha256: string;
}

export interface MilestoneObservationInput {
  task: CodexHostTaskContext;
  binding: CodexTaskWorkspaceBindingEntry;
  review: TaskObjectCurationReview;
  audit: TaskObjectCurationAudit;
  inventory: TaskObjectInventory;
}

export interface MilestoneRecurringNeedSummary {
  termSha256: string;
  observations: number;
  available: number;
  missing: number;
  ambiguous: number;
  typeMismatch: number;
}

export interface MilestoneObservationSummary {
  schemaVersion: 1;
  measurement: "private_milestone_observation";
  eventCount: number;
  milestoneCount: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  available: number;
  missing: number;
  ambiguous: number;
  typeMismatch: number;
  taskLocalAvailable: number;
  workspaceAvailable: number;
  latestCuration: MilestoneObservationCurationSummary | null;
  recurringNeeds: readonly MilestoneRecurringNeedSummary[];
  latestEventSha256: string | null;
}

interface MilestoneObservationDocument {
  schemaVersion: 1;
  events: MilestoneObservationEvent[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function rate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isIsoTime(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value));
}

const entityTypes = new Set<TaskObjectCurationNeedEntityType>([
  "concept",
  "change",
  "decision",
  "task",
  "verification",
  "module",
  "document",
  "configuration",
  "file",
]);
const needKinds = new Set<TaskObjectCurationNeedKind>([
  "understand",
  "resume",
  "handoff",
  "decision",
  "status",
  "verification",
]);
const needStates = new Set<TaskObjectCurationNeedState>([
  "available",
  "missing",
  "ambiguous",
  "type_mismatch",
]);

function parseNeed(value: unknown): MilestoneObservationNeed {
  if (
    !record(value) ||
    !exactKeys(value, [
      "termSha256",
      "expectedEntityType",
      "needKind",
      "state",
      "matchCount",
      "candidateTypes",
      "source",
    ]) ||
    !isSha256(value.termSha256) ||
    !entityTypes.has(value.expectedEntityType as TaskObjectCurationNeedEntityType) ||
    !needKinds.has(value.needKind as TaskObjectCurationNeedKind) ||
    !needStates.has(value.state as TaskObjectCurationNeedState) ||
    !integer(value.matchCount, 2_048) ||
    !Array.isArray(value.candidateTypes) ||
    value.candidateTypes.length > 9 ||
    !value.candidateTypes.every((item) => typeof item === "string" && item.length <= 32) ||
    (value.source !== null && value.source !== "workspace" && value.source !== "task_local")
  ) {
    throw new Error("milestone_observation_event_invalid");
  }
  return Object.freeze({
    termSha256: value.termSha256,
    expectedEntityType: value.expectedEntityType,
    needKind: value.needKind,
    state: value.state,
    matchCount: value.matchCount,
    candidateTypes: Object.freeze([...value.candidateTypes]),
    source: value.source,
  }) as MilestoneObservationNeed;
}

function parseReview(value: unknown): MilestoneObservationReviewSummary {
  const keys = [
    "needCount",
    "available",
    "missing",
    "ambiguous",
    "typeMismatch",
    "availabilityRate",
    "omissionRate",
    "resolutionFailureRate",
  ];
  if (
    !record(value) ||
    !exactKeys(value, keys) ||
    !integer(value.needCount, 32) ||
    !integer(value.available, 32) ||
    !integer(value.missing, 32) ||
    !integer(value.ambiguous, 32) ||
    !integer(value.typeMismatch, 32) ||
    !rate(value.availabilityRate) ||
    !rate(value.omissionRate) ||
    !rate(value.resolutionFailureRate) ||
    Number(value.available) + Number(value.missing) + Number(value.ambiguous) +
      Number(value.typeMismatch) !== Number(value.needCount)
  ) {
    throw new Error("milestone_observation_event_invalid");
  }
  return Object.freeze({ ...value }) as unknown as MilestoneObservationReviewSummary;
}

function parseCuration(value: unknown): MilestoneObservationCurationSummary {
  const countKeys = [
    "currentTaskRecords",
    "activePartials",
    "activeStableOverlaps",
    "activeAmbiguousOverlaps",
    "terminalUnmatched",
    "terminalArchiveReady",
    "terminalAmbiguous",
  ];
  if (
    !record(value) ||
    !exactKeys(value, [...countKeys, "stableOverlapRate", "registrySnapshotSha256"]) ||
    !countKeys.every((key) => integer(value[key], 1_024)) ||
    !rate(value.stableOverlapRate) ||
    !isSha256(value.registrySnapshotSha256)
  ) {
    throw new Error("milestone_observation_event_invalid");
  }
  return Object.freeze({ ...value }) as unknown as MilestoneObservationCurationSummary;
}

function parseCapacity(value: unknown): MilestoneObservationCapacitySummary {
  const keys = [
    "active",
    "terminal",
    "currentTaskRecords",
    "registryRecords",
    "archivedRecords",
    "warnings",
  ];
  if (
    !record(value) ||
    !exactKeys(value, keys) ||
    !integer(value.active, 256) ||
    !integer(value.terminal, 1_024) ||
    !integer(value.currentTaskRecords, 1_024) ||
    !integer(value.registryRecords, 1_024) ||
    !integer(value.archivedRecords, 8_192) ||
    Number(value.active) + Number(value.terminal) !== Number(value.currentTaskRecords) ||
    !Array.isArray(value.warnings) ||
    value.warnings.length > 1 ||
    !value.warnings.every((item) => item === "active_soft_limit_reached")
  ) {
    throw new Error("milestone_observation_event_invalid");
  }
  return Object.freeze({
    ...value,
    warnings: Object.freeze([...value.warnings]),
  }) as unknown as MilestoneObservationCapacitySummary;
}

function unsignedEvent(event: MilestoneObservationEvent): Omit<MilestoneObservationEvent, "eventSha256"> {
  return {
    schemaVersion: 1,
    eventId: event.eventId,
    observedAt: event.observedAt,
    milestoneSha256: event.milestoneSha256,
    contextSha256: event.contextSha256,
    bindingSha256: event.bindingSha256,
    indexSnapshot: event.indexSnapshot,
    review: event.review,
    needs: event.needs,
    curation: event.curation,
    capacity: event.capacity,
    previousEventSha256: event.previousEventSha256,
  };
}

function parseEvent(value: unknown): MilestoneObservationEvent {
  const keys = [
    "schemaVersion",
    "eventId",
    "observedAt",
    "milestoneSha256",
    "contextSha256",
    "bindingSha256",
    "indexSnapshot",
    "review",
    "needs",
    "curation",
    "capacity",
    "previousEventSha256",
    "eventSha256",
  ];
  if (
    !record(value) ||
    !exactKeys(value, keys) ||
    value.schemaVersion !== 1 ||
    typeof value.eventId !== "string" ||
    !/^[a-f0-9-]{36}$/u.test(value.eventId) ||
    !isIsoTime(value.observedAt) ||
    !isSha256(value.milestoneSha256) ||
    !isSha256(value.contextSha256) ||
    !isSha256(value.bindingSha256) ||
    typeof value.indexSnapshot !== "string" ||
    !/^context-index:[a-f0-9]{64}$/u.test(value.indexSnapshot) ||
    !Array.isArray(value.needs) ||
    value.needs.length < 1 ||
    value.needs.length > 32 ||
    (value.previousEventSha256 !== null && !isSha256(value.previousEventSha256)) ||
    !isSha256(value.eventSha256)
  ) {
    throw new Error("milestone_observation_event_invalid");
  }
  const event: MilestoneObservationEvent = Object.freeze({
    schemaVersion: 1,
    eventId: value.eventId,
    observedAt: value.observedAt,
    milestoneSha256: value.milestoneSha256,
    contextSha256: value.contextSha256,
    bindingSha256: value.bindingSha256,
    indexSnapshot: value.indexSnapshot,
    review: parseReview(value.review),
    needs: Object.freeze(value.needs.map(parseNeed)),
    curation: parseCuration(value.curation),
    capacity: parseCapacity(value.capacity),
    previousEventSha256: value.previousEventSha256,
    eventSha256: value.eventSha256,
  });
  if (event.needs.length !== event.review.needCount) {
    throw new Error("milestone_observation_event_invalid");
  }
  if (sha256(JSON.stringify(unsignedEvent(event))) !== event.eventSha256) {
    throw new Error("milestone_observation_digest_invalid");
  }
  return event;
}

function parseDocument(value: unknown): MilestoneObservationDocument {
  if (
    !record(value) ||
    !exactKeys(value, ["schemaVersion", "events"]) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.events) ||
    value.events.length > MILESTONE_OBSERVATION_MAX_EVENTS
  ) {
    throw new Error("milestone_observation_ledger_invalid");
  }
  const events = value.events.map(parseEvent);
  if (new Set(events.map((event) => event.eventId)).size !== events.length) {
    throw new Error("milestone_observation_ledger_invalid");
  }
  for (let index = 0; index < events.length; index += 1) {
    const expected = index === 0 ? null : events[index - 1]!.eventSha256;
    if (events[index]!.previousEventSha256 !== expected) {
      throw new Error("milestone_observation_chain_invalid");
    }
  }
  return { schemaVersion: 1, events };
}

export function milestoneObservationContextSha256(
  task: CodexHostTaskContext,
  binding: CodexTaskWorkspaceBindingEntry,
): string {
  return sha256(JSON.stringify({
    host: task.host,
    threadRef: codexTaskThreadRef(task),
    routeRef: task.routeRef,
    contextFingerprint: task.contextFingerprint,
    scope: binding.scope,
    workspaceRoot: binding.workspaceRoot,
    providerId: binding.providerId,
  }));
}

function registrySnapshotSha256(audit: TaskObjectCurationAudit): string {
  return sha256(JSON.stringify(audit.items.map((item) => ({
    objectKey: item.objectKey,
    entityType: item.entityType,
    lifecycle: item.lifecycle,
    state: item.state,
    stableMatchCount: item.stableMatchCount,
  })).sort((left, right) => left.objectKey.localeCompare(right.objectKey))));
}

function candidatePathIsInside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== "..");
}

export class MilestoneObservationLedger {
  readonly path: string;
  #mutation: Promise<void> = Promise.resolve();

  constructor(path: string) {
    if (!isAbsolute(path)) throw new TypeError("milestone observation path must be absolute");
    this.path = resolve(path);
  }

  async #privatePath(workspaceRoot: string): Promise<string> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const [workspace, parent] = await Promise.all([
      realpath(workspaceRoot),
      realpath(dirname(this.path)),
    ]);
    const candidate = resolve(parent, basename(this.path));
    if (candidatePathIsInside(workspace, candidate)) {
      throw new Error("milestone_observation_ledger_must_be_private");
    }
    const existing = await lstat(candidate).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (existing?.isSymbolicLink()) throw new Error("milestone_observation_ledger_symlink_rejected");
    return candidate;
  }

  async #read(path: string): Promise<MilestoneObservationDocument> {
    const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (info === undefined) return { schemaVersion: 1, events: [] };
    if (!info.isFile() || info.size > MILESTONE_OBSERVATION_MAX_BYTES) {
      throw new Error("milestone_observation_ledger_invalid");
    }
    try {
      return parseDocument(JSON.parse(await readFile(path, "utf8")) as unknown);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("milestone_observation_")) throw error;
      throw new Error("milestone_observation_ledger_invalid");
    }
  }

  async #write(path: string, document: MilestoneObservationDocument): Promise<void> {
    const body = `${JSON.stringify(document, null, 2)}\n`;
    if (Buffer.byteLength(body, "utf8") > MILESTONE_OBSERVATION_MAX_BYTES) {
      throw new Error("milestone_observation_ledger_full");
    }
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(body, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#mutation;
    let release!: () => void;
    this.#mutation = new Promise<void>((resolveMutation) => {
      release = resolveMutation;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async record(input: MilestoneObservationInput): Promise<MilestoneObservationEvent> {
    return await this.#exclusive(async () => {
      const path = await this.#privatePath(input.binding.workspaceRoot);
      const document = await this.#read(path);
      if (document.events.length >= MILESTONE_OBSERVATION_MAX_EVENTS) {
        throw new Error("milestone_observation_ledger_full");
      }
      const previousEventSha256 = document.events.at(-1)?.eventSha256 ?? null;
      const review: MilestoneObservationReviewSummary = Object.freeze({
        needCount: input.review.needCount,
        available: input.review.available,
        missing: input.review.missing,
        ambiguous: input.review.ambiguous,
        typeMismatch: input.review.typeMismatch,
        availabilityRate: input.review.availabilityRate,
        omissionRate: input.review.omissionRate,
        resolutionFailureRate: input.review.resolutionFailureRate,
      });
      const needs = input.review.items.map((item): MilestoneObservationNeed => Object.freeze({
        termSha256: sha256(item.term.normalize("NFKC").trim().toLocaleLowerCase("en-US")),
        expectedEntityType: item.expectedEntityType,
        needKind: item.needKind,
        state: item.state,
        matchCount: item.matchCount,
        candidateTypes: Object.freeze([...item.candidateTypes]),
        source: item.source ?? null,
      }));
      const curation: MilestoneObservationCurationSummary = Object.freeze({
        currentTaskRecords: input.audit.currentTaskRecords,
        activePartials: input.audit.activePartials,
        activeStableOverlaps: input.audit.activeStableOverlaps,
        activeAmbiguousOverlaps: input.audit.activeAmbiguousOverlaps,
        terminalUnmatched: input.audit.terminalUnmatched,
        terminalArchiveReady: input.audit.terminalArchiveReady,
        terminalAmbiguous: input.audit.terminalAmbiguous,
        stableOverlapRate: input.audit.stableOverlapRate,
        registrySnapshotSha256: registrySnapshotSha256(input.audit),
      });
      const capacity: MilestoneObservationCapacitySummary = Object.freeze({
        active: input.inventory.capacity.active,
        terminal: input.inventory.capacity.terminal,
        currentTaskRecords: input.inventory.capacity.currentTaskRecords,
        registryRecords: input.inventory.capacity.registryRecords,
        archivedRecords: input.inventory.capacity.archivedRecords,
        warnings: Object.freeze([...input.inventory.capacity.warnings]),
      });
      const unsigned = {
        schemaVersion: 1 as const,
        eventId: randomUUID(),
        observedAt: input.review.observedAt,
        milestoneSha256: sha256(input.review.milestoneKey),
        contextSha256: milestoneObservationContextSha256(input.task, input.binding),
        bindingSha256: sha256(input.binding.bindingRevision),
        indexSnapshot: input.review.indexSnapshot,
        review,
        needs: Object.freeze(needs),
        curation,
        capacity,
        previousEventSha256,
      };
      const event: MilestoneObservationEvent = Object.freeze({
        ...unsigned,
        eventSha256: sha256(JSON.stringify(unsigned)),
      });
      parseEvent(event);
      document.events.push(event);
      await this.#write(path, document);
      return event;
    });
  }

  async summary(
    task: CodexHostTaskContext,
    binding: CodexTaskWorkspaceBindingEntry,
  ): Promise<MilestoneObservationSummary> {
    return await this.#exclusive(async () => {
      const path = await this.#privatePath(binding.workspaceRoot);
      const contextSha256 = milestoneObservationContextSha256(task, binding);
      const events = (await this.#read(path)).events.filter(
        (event) => event.contextSha256 === contextSha256,
      );
      const recurring = new Map<string, MilestoneRecurringNeedSummary>();
      let available = 0;
      let missing = 0;
      let ambiguous = 0;
      let typeMismatch = 0;
      let taskLocalAvailable = 0;
      let workspaceAvailable = 0;
      for (const event of events) {
        available += event.review.available;
        missing += event.review.missing;
        ambiguous += event.review.ambiguous;
        typeMismatch += event.review.typeMismatch;
        for (const need of event.needs) {
          if (need.state === "available" && need.source === "task_local") taskLocalAvailable += 1;
          if (need.state === "available" && need.source === "workspace") workspaceAvailable += 1;
          const current = recurring.get(need.termSha256) ?? {
            termSha256: need.termSha256,
            observations: 0,
            available: 0,
            missing: 0,
            ambiguous: 0,
            typeMismatch: 0,
          };
          current.observations += 1;
          if (need.state === "available") current.available += 1;
          if (need.state === "missing") current.missing += 1;
          if (need.state === "ambiguous") current.ambiguous += 1;
          if (need.state === "type_mismatch") current.typeMismatch += 1;
          recurring.set(need.termSha256, current);
        }
      }
      const recurringNeeds = [...recurring.values()]
        .filter((item) => item.observations > 1)
        .sort((left, right) =>
          right.observations - left.observations || left.termSha256.localeCompare(right.termSha256))
        .slice(0, MAX_RECURRING_NEEDS)
        .map((item) => Object.freeze({ ...item }));
      const first = events[0];
      const latest = events.at(-1);
      return Object.freeze({
        schemaVersion: 1,
        measurement: "private_milestone_observation",
        eventCount: events.length,
        milestoneCount: new Set(events.map((event) => event.milestoneSha256)).size,
        firstObservedAt: first?.observedAt ?? null,
        lastObservedAt: latest?.observedAt ?? null,
        available,
        missing,
        ambiguous,
        typeMismatch,
        taskLocalAvailable,
        workspaceAvailable,
        latestCuration: latest?.curation ?? null,
        recurringNeeds: Object.freeze(recurringNeeds),
        latestEventSha256: latest?.eventSha256 ?? null,
      }) as MilestoneObservationSummary;
    });
  }
}

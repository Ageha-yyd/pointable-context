import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type {
  AuthorityResult,
  AuthoritativeProvider,
  ContextIndexPort,
  DetailSnapshot,
  FactValue,
  IdentityRecord,
  TrustedContextBinding,
} from "../../contracts.js";
import { sameContextScope } from "../../context-scope.js";
import { ContractError, validateContextIndexForRuntime } from "../../validation.js";
import type { CodexHostTaskContext } from "./host-context.js";
import {
  codexTaskThreadRef,
  type CodexTaskWorkspaceBindingEntry,
} from "./task-workspace-binding.js";
import type {
  WorkspaceRevisionProbe,
} from "./workspace-lookup.js";
import type { LocalWorkspaceRevisionProbeResult } from "../../adapters/local-workspace.js";

export const TASK_OBJECT_PROVIDER_ID = "agent-task-context";
export const TASK_OBJECT_ENTITY_PREFIX = "task-object:";

const REGISTRY_SCHEMA_VERSION = 1;
export const TASK_OBJECT_REGISTRY_MAX_BYTES = 1024 * 1024;
export const TASK_OBJECT_REGISTRY_MAX_RECORDS = 1_024;
export const TASK_OBJECT_ARCHIVE_MAX_BYTES = 16 * 1024 * 1024;
export const TASK_OBJECT_ARCHIVE_MAX_RECORDS = 8_192;
export const TASK_OBJECT_ACTIVE_SOFT_LIMIT = 64;
export const TASK_OBJECT_ACTIVE_HARD_LIMIT = 256;
const MAX_ALIASES = 8;

export type TaskObjectType =
  | "concept"
  | "change"
  | "decision"
  | "task"
  | "verification";

export type TaskObjectLifecycle = "active" | "superseded" | "retired";

export type TaskObjectMentalModel =
  | {
      kind: "concept";
      meaning: string;
      context: string;
      boundary: string;
      sequence: string[];
      evidence: string;
    }
  | {
      kind: "change";
      before: string;
      after: string;
      impact: string;
      evidence: string;
    }
  | {
      kind: "decision";
      problem: string;
      choice: string;
      consequence: string;
      evidence: string;
    }
  | {
      kind: "task";
      goal: string;
      status: string;
      completed: string;
      next: string;
      blocker: string;
      evidence: string;
    }
  | {
      kind: "verification";
      claim: string;
      result: string;
      gap: string;
      evidence: string;
    };

export interface TaskObjectInput {
  schemaVersion: 1;
  objectKey: string;
  entityType: TaskObjectType;
  canonicalName: string;
  aliases: string[];
  summary: string;
  mentalModel: TaskObjectMentalModel;
}

interface StoredTaskObject extends TaskObjectInput {
  scope: CodexTaskWorkspaceBindingEntry["scope"];
  threadRef: string;
  routeRef: string;
  workspaceRoot: string;
  bindingRevision: string;
  entityId: string;
  lifecycle: TaskObjectLifecycle;
  replacedByObjectKey?: string;
  createdAt: string;
  updatedAt: string;
  entityRevision: string;
}

interface RegistryDocument {
  schemaVersion: 1;
  records: StoredTaskObject[];
}

export interface TaskObjectSummary {
  objectKey: string;
  entityId: string;
  entityType: TaskObjectType;
  canonicalName: string;
  summary: string;
  lifecycle: TaskObjectLifecycle;
  replacedByObjectKey?: string;
  updatedAt: string;
  entityRevision: string;
}

export interface TaskObjectMutationResult {
  kind: "created" | "updated" | "unchanged" | "superseded" | "retired";
  object: TaskObjectSummary;
  replacement?: TaskObjectSummary;
}

export interface TaskObjectCapacityStatus {
  active: number;
  terminal: number;
  currentTaskRecords: number;
  registryRecords: number;
  archivedRecords: number;
  registryBytes: number;
  archivedBytes: number;
  activeSoftLimit: typeof TASK_OBJECT_ACTIVE_SOFT_LIMIT;
  activeHardLimit: typeof TASK_OBJECT_ACTIVE_HARD_LIMIT;
  registryRecordLimit: typeof TASK_OBJECT_REGISTRY_MAX_RECORDS;
  registryByteLimit: typeof TASK_OBJECT_REGISTRY_MAX_BYTES;
  archiveRecordLimit: typeof TASK_OBJECT_ARCHIVE_MAX_RECORDS;
  archiveByteLimit: typeof TASK_OBJECT_ARCHIVE_MAX_BYTES;
  warnings: Array<"active_soft_limit_reached">;
}

export interface TaskObjectInventory {
  objects: TaskObjectSummary[];
  capacity: TaskObjectCapacityStatus;
}

export type TaskObjectCurationState =
  | "active_partial"
  | "active_stable_overlap"
  | "active_ambiguous_overlap"
  | "terminal_unmatched"
  | "terminal_archive_ready"
  | "terminal_ambiguous";

export interface TaskObjectCurationItem {
  objectKey: string;
  entityType: TaskObjectType;
  canonicalName: string;
  lifecycle: TaskObjectLifecycle;
  state: TaskObjectCurationState;
  stableMatchCount: number;
}

export interface TaskObjectCurationAudit {
  currentTaskRecords: number;
  activePartials: number;
  activeStableOverlaps: number;
  activeAmbiguousOverlaps: number;
  terminalUnmatched: number;
  terminalArchiveReady: number;
  terminalAmbiguous: number;
  stableOverlapRate: number;
  omissionMeasurement: "explicit_milestone_review_required";
  items: TaskObjectCurationItem[];
}

export interface TaskObjectArchiveResult {
  kind: "archived" | "unchanged";
  archivedCount: number;
  archiveRevision: string;
}

function objectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Reflect.ownKeys(value).every((key) => typeof key === "string") &&
    Object.keys(value).sort().join("\u0000") === [...expected].sort().join("\u0000");
}

function boundedText(
  value: unknown,
  name: string,
  minimum = 1,
  maximum = 1_024,
): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    value !== value.trim() ||
    /[\p{Cc}\p{Cf}]/u.test(value)
  ) {
    throw new ContractError(`${name} is invalid`);
  }
  return value;
}

function timestamp(value: unknown, name: string): string {
  const parsed = boundedText(value, name, 20, 64);
  if (!Number.isFinite(Date.parse(parsed))) throw new ContractError(`${name} is invalid`);
  return parsed;
}

function objectKey(value: unknown): string {
  const parsed = boundedText(value, "objectKey", 2, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/u.test(parsed)) {
    throw new ContractError("objectKey is invalid");
  }
  return parsed;
}

function taskObjectType(value: unknown): TaskObjectType {
  if (
    value !== "concept" &&
    value !== "change" &&
    value !== "decision" &&
    value !== "task" &&
    value !== "verification"
  ) {
    throw new ContractError("entityType is invalid");
  }
  return value;
}

function aliases(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_ALIASES) {
    throw new ContractError("aliases are invalid");
  }
  const seen = new Set<string>();
  const output: string[] = [];
  for (const [index, item] of value.entries()) {
    const alias = boundedText(item, `aliases[${index}]`, 2, 256);
    const normalized = alias.normalize("NFKC").toLocaleLowerCase("en-US");
    if (seen.has(normalized)) throw new ContractError("aliases must be unique");
    seen.add(normalized);
    output.push(alias);
  }
  return output;
}

function mentalModel(value: unknown, entityType: TaskObjectType): TaskObjectMentalModel {
  if (!objectRecord(value) || value.kind !== entityType) {
    throw new ContractError("mentalModel kind does not match entityType");
  }
  const text = (key: string): string => boundedText(value[key], `mentalModel.${key}`);
  if (entityType === "concept") {
    if (!exactKeys(value, ["kind", "meaning", "context", "boundary", "sequence", "evidence"])) {
      throw new ContractError("concept mentalModel fields are invalid");
    }
    if (!Array.isArray(value.sequence) || value.sequence.length < 2 || value.sequence.length > 4) {
      throw new ContractError("mentalModel.sequence must contain 2 to 4 steps");
    }
    const sequence = value.sequence.map((item, index) =>
      boundedText(item, `mentalModel.sequence[${index}]`, 1, 256));
    if (sequence.filter((item) => /^当前[：:]\s*/u.test(item)).length !== 1) {
      throw new ContractError("mentalModel.sequence must mark exactly one 当前 step");
    }
    return {
      kind: "concept",
      meaning: text("meaning"),
      context: text("context"),
      boundary: text("boundary"),
      sequence,
      evidence: text("evidence"),
    };
  }
  if (entityType === "change") {
    if (!exactKeys(value, ["kind", "before", "after", "impact", "evidence"])) {
      throw new ContractError("change mentalModel fields are invalid");
    }
    return {
      kind: "change",
      before: text("before"),
      after: text("after"),
      impact: text("impact"),
      evidence: text("evidence"),
    };
  }
  if (entityType === "decision") {
    if (!exactKeys(value, ["kind", "problem", "choice", "consequence", "evidence"])) {
      throw new ContractError("decision mentalModel fields are invalid");
    }
    return {
      kind: "decision",
      problem: text("problem"),
      choice: text("choice"),
      consequence: text("consequence"),
      evidence: text("evidence"),
    };
  }
  if (entityType === "task") {
    if (!exactKeys(value, ["kind", "goal", "status", "completed", "next", "blocker", "evidence"])) {
      throw new ContractError("task mentalModel fields are invalid");
    }
    return {
      kind: "task",
      goal: text("goal"),
      status: text("status"),
      completed: text("completed"),
      next: text("next"),
      blocker: text("blocker"),
      evidence: text("evidence"),
    };
  }
  if (!exactKeys(value, ["kind", "claim", "result", "gap", "evidence"])) {
    throw new ContractError("verification mentalModel fields are invalid");
  }
  return {
    kind: "verification",
    claim: text("claim"),
    result: text("result"),
    gap: text("gap"),
    evidence: text("evidence"),
  };
}

export function parseTaskObjectInput(value: unknown): TaskObjectInput {
  if (
    !objectRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "objectKey",
      "entityType",
      "canonicalName",
      "aliases",
      "summary",
      "mentalModel",
    ]) ||
    value.schemaVersion !== 1
  ) {
    throw new ContractError("task object input is invalid");
  }
  const entityType = taskObjectType(value.entityType);
  const key = objectKey(value.objectKey);
  const name = boundedText(value.canonicalName, "canonicalName", 2, 256);
  const parsedAliases = aliases(value.aliases);
  const reserved = new Set(
    [key, name].map((item) => item.normalize("NFKC").toLocaleLowerCase("en-US")),
  );
  if (parsedAliases.some((item) => reserved.has(item.normalize("NFKC").toLocaleLowerCase("en-US")))) {
    throw new ContractError("aliases must not repeat objectKey or canonicalName");
  }
  return Object.freeze({
    schemaVersion: 1,
    objectKey: key,
    entityType,
    canonicalName: name,
    aliases: Object.freeze(parsedAliases),
    summary: boundedText(value.summary, "summary", 1, 1_024),
    mentalModel: Object.freeze(mentalModel(value.mentalModel, entityType)),
  }) as TaskObjectInput;
}

function scopeKey(scope: TrustedContextBinding["scope"]): string {
  return `${scope.kind}\u0000${scope.namespace}\u0000${scope.id}`;
}

function entityIdFor(binding: CodexTaskWorkspaceBindingEntry, task: CodexHostTaskContext, key: string): string {
  const digest = createHash("sha256")
    .update(scopeKey(binding.scope), "utf8")
    .update("\u0000", "utf8")
    .update(codexTaskThreadRef(task), "utf8")
    .update("\u0000", "utf8")
    .update(key, "utf8")
    .digest("hex");
  return `${TASK_OBJECT_ENTITY_PREFIX}${digest}`;
}

function revisionFor(input: TaskObjectInput, lifecycle: TaskObjectLifecycle, replacement?: string): string {
  return `task-object:${createHash("sha256")
    .update(JSON.stringify({ input, lifecycle, replacement: replacement ?? null }), "utf8")
    .digest("hex")}`;
}

function sameObjectIdentity(left: TaskObjectInput, right: TaskObjectInput): boolean {
  return (
    left.objectKey === right.objectKey &&
    left.entityType === right.entityType &&
    left.canonicalName === right.canonicalName &&
    left.aliases.length === right.aliases.length &&
    left.aliases.every((alias, index) => alias === right.aliases[index])
  );
}

function copyInput(input: TaskObjectInput): TaskObjectInput {
  return {
    ...input,
    aliases: [...input.aliases],
    mentalModel: {
      ...input.mentalModel,
      ...(input.mentalModel.kind === "concept"
        ? { sequence: [...input.mentalModel.sequence] }
        : {}),
    } as TaskObjectMentalModel,
  };
}

function copyStored(record: StoredTaskObject): StoredTaskObject {
  return {
    ...copyInput(record),
    scope: { ...record.scope },
    threadRef: record.threadRef,
    routeRef: record.routeRef,
    workspaceRoot: record.workspaceRoot,
    bindingRevision: record.bindingRevision,
    entityId: record.entityId,
    lifecycle: record.lifecycle,
    ...(record.replacedByObjectKey === undefined
      ? {}
      : { replacedByObjectKey: record.replacedByObjectKey }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    entityRevision: record.entityRevision,
  };
}

function summary(record: StoredTaskObject): TaskObjectSummary {
  return Object.freeze({
    objectKey: record.objectKey,
    entityId: record.entityId,
    entityType: record.entityType,
    canonicalName: record.canonicalName,
    summary: record.summary,
    lifecycle: record.lifecycle,
    ...(record.replacedByObjectKey === undefined
      ? {}
      : { replacedByObjectKey: record.replacedByObjectKey }),
    updatedAt: record.updatedAt,
    entityRevision: record.entityRevision,
  });
}

function parseStored(value: unknown, index: number): StoredTaskObject {
  if (!objectRecord(value)) throw new ContractError(`task object record ${index} is invalid`);
  const optionalReplacement = value.replacedByObjectKey === undefined
    ? []
    : ["replacedByObjectKey"];
  if (!exactKeys(value, [
    "schemaVersion", "objectKey", "entityType", "canonicalName", "aliases", "summary",
    "mentalModel", "scope", "threadRef", "routeRef", "workspaceRoot", "bindingRevision",
    "entityId", "lifecycle", "createdAt", "updatedAt", "entityRevision", ...optionalReplacement,
  ])) {
    throw new ContractError(`task object record ${index} fields are invalid`);
  }
  const input = parseTaskObjectInput({
    schemaVersion: value.schemaVersion,
    objectKey: value.objectKey,
    entityType: value.entityType,
    canonicalName: value.canonicalName,
    aliases: value.aliases,
    summary: value.summary,
    mentalModel: value.mentalModel,
  });
  if (
    !objectRecord(value.scope) ||
    !exactKeys(value.scope, ["kind", "namespace", "id"]) ||
    value.scope.kind !== "workspace" ||
    typeof value.scope.namespace !== "string" ||
    typeof value.scope.id !== "string" ||
    typeof value.workspaceRoot !== "string" ||
    !isAbsolute(value.workspaceRoot) ||
    typeof value.bindingRevision !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.bindingRevision) ||
    typeof value.entityId !== "string" ||
    !new RegExp(`^${TASK_OBJECT_ENTITY_PREFIX}[a-f0-9]{64}$`, "u").test(value.entityId) ||
    (value.lifecycle !== "active" && value.lifecycle !== "superseded" && value.lifecycle !== "retired") ||
    typeof value.entityRevision !== "string" ||
    !/^task-object:[a-f0-9]{64}$/u.test(value.entityRevision)
  ) {
    throw new ContractError(`task object record ${index} authority fields are invalid`);
  }
  const replacedByObjectKey = value.replacedByObjectKey === undefined
    ? undefined
    : objectKey(value.replacedByObjectKey);
  if ((value.lifecycle === "superseded") !== (replacedByObjectKey !== undefined)) {
    throw new ContractError(`task object record ${index} replacement is invalid`);
  }
  return {
    ...copyInput(input),
    scope: {
      kind: "workspace",
      namespace: boundedText(value.scope.namespace, `records[${index}].scope.namespace`, 1, 128),
      id: boundedText(value.scope.id, `records[${index}].scope.id`, 1, 256),
    },
    threadRef: boundedText(value.threadRef, `records[${index}].threadRef`, 1, 768),
    routeRef: boundedText(value.routeRef, `records[${index}].routeRef`, 1, 2_048),
    workspaceRoot: resolve(value.workspaceRoot),
    bindingRevision: value.bindingRevision,
    entityId: value.entityId,
    lifecycle: value.lifecycle,
    ...(replacedByObjectKey === undefined ? {} : { replacedByObjectKey }),
    createdAt: timestamp(value.createdAt, `records[${index}].createdAt`),
    updatedAt: timestamp(value.updatedAt, `records[${index}].updatedAt`),
    entityRevision: value.entityRevision,
  };
}

function parseRecordsDocument(
  value: unknown,
  maximumRecords: number,
  invalidMessage: string,
): RegistryDocument {
  if (
    !objectRecord(value) ||
    !exactKeys(value, ["schemaVersion", "records"]) ||
    value.schemaVersion !== REGISTRY_SCHEMA_VERSION ||
    !Array.isArray(value.records) ||
    value.records.length > maximumRecords
  ) {
    throw new ContractError(invalidMessage);
  }
  const records = value.records.map(parseStored);
  const identities = new Set<string>();
  for (const record of records) {
    const identity = `${record.threadRef}\u0000${record.bindingRevision}\u0000${record.objectKey}`;
    if (identities.has(identity)) throw new ContractError("task object registry has duplicate identities");
    identities.add(identity);
  }
  return { schemaVersion: 1, records };
}

function parseDocument(value: unknown): RegistryDocument {
  return parseRecordsDocument(
    value,
    TASK_OBJECT_REGISTRY_MAX_RECORDS,
    "task object registry is invalid",
  );
}

function parseArchiveDocument(value: unknown): RegistryDocument {
  return parseRecordsDocument(
    value,
    TASK_OBJECT_ARCHIVE_MAX_RECORDS,
    "task object archive is invalid",
  );
}

function serializedDocument(document: RegistryDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function documentBytes(document: RegistryDocument): number {
  return Buffer.byteLength(serializedDocument(document), "utf8");
}

function archiveRevision(records: readonly StoredTaskObject[]): string {
  return `task-object-archive:${createHash("sha256")
    .update(records.map((record) => `${record.entityId}:${record.entityRevision}`).sort().join("\n"), "utf8")
    .digest("hex")}`;
}

function normalizedIdentity(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function stableMatchesFor(
  record: StoredTaskObject,
  stableRecords: readonly IdentityRecord[],
): IdentityRecord[] {
  const name = normalizedIdentity(record.canonicalName);
  return stableRecords.filter((stable) =>
    !stable.deleted &&
    stable.authorityRef.provider !== TASK_OBJECT_PROVIDER_ID &&
    stable.entityType === record.entityType &&
    normalizedIdentity(stable.canonicalName) === name);
}

function matchesBinding(record: StoredTaskObject, binding: TrustedContextBinding): boolean {
  return (
    sameContextScope(record.scope, binding.scope) &&
    record.bindingRevision === binding.bindingRevision &&
    record.threadRef === binding.threadRef &&
    record.routeRef === binding.routeRef &&
    record.workspaceRoot === binding.workspaceRoot
  );
}

function matchesEntry(
  record: StoredTaskObject,
  task: CodexHostTaskContext,
  entry: CodexTaskWorkspaceBindingEntry,
): boolean {
  return (
    matchesTaskWorkspace(record, task, entry) &&
    record.bindingRevision === entry.bindingRevision
  );
}

function matchesTaskWorkspace(
  record: StoredTaskObject,
  task: CodexHostTaskContext,
  entry: CodexTaskWorkspaceBindingEntry,
): boolean {
  return (
    sameContextScope(record.scope, entry.scope) &&
    record.threadRef === codexTaskThreadRef(task) &&
    record.routeRef === task.routeRef &&
    record.workspaceRoot === entry.workspaceRoot
  );
}

function facts(record: StoredTaskObject): Record<string, FactValue> {
  const common: Record<string, FactValue> = {
    "生命周期": record.lifecycle,
    ...(record.replacedByObjectKey === undefined
      ? {}
      : { "替代对象": record.replacedByObjectKey }),
    "信息边界": "当前 Codex 任务内由 Agent 显式登记的临时上下文；尚未固化为仓库证据",
    "更新时间": record.updatedAt,
    "证据": record.mentalModel.evidence,
  };
  switch (record.mentalModel.kind) {
    case "concept":
      return {
        "它是什么意思": record.mentalModel.meaning,
        "为什么现在出现": record.mentalModel.context,
        "它不是什么": record.mentalModel.boundary,
        "所处流程": [...record.mentalModel.sequence],
        ...common,
      };
    case "change":
      return {
        "原来怎样": record.mentalModel.before,
        "现在怎样": record.mentalModel.after,
        "影响什么": record.mentalModel.impact,
        ...common,
      };
    case "decision":
      return {
        "为什么需要决定": record.mentalModel.problem,
        "选择了什么": record.mentalModel.choice,
        "后果是什么": record.mentalModel.consequence,
        ...common,
      };
    case "task":
      return {
        "目标": record.mentalModel.goal,
        "当前状态": record.mentalModel.status,
        "已完成": record.mentalModel.completed,
        "下一步": record.mentalModel.next,
        "阻塞": record.mentalModel.blocker,
        ...common,
      };
    case "verification":
      return {
        "要证明什么": record.mentalModel.claim,
        "结果": record.mentalModel.result,
        "尚未证明": record.mentalModel.gap,
        "执行时间": record.updatedAt,
        ...common,
      };
  }
}

export class TaskObjectRegistry implements ContextIndexPort, AuthoritativeProvider, WorkspaceRevisionProbe {
  readonly providerId = TASK_OBJECT_PROVIDER_ID;
  readonly path: string;
  readonly archivePath: string;
  #mutation: Promise<void> = Promise.resolve();

  constructor(path: string, archivePath?: string) {
    if (!isAbsolute(path)) throw new TypeError("task object registry path must be absolute");
    this.path = resolve(path);
    const defaultArchive = this.path.endsWith(".json")
      ? `${this.path.slice(0, -5)}.archive.json`
      : `${this.path}.archive.json`;
    const candidateArchive = archivePath ?? defaultArchive;
    if (!isAbsolute(candidateArchive)) {
      throw new TypeError("task object archive path must be absolute");
    }
    this.archivePath = resolve(candidateArchive);
    if (this.archivePath === this.path) {
      throw new TypeError("task object archive path must differ from registry path");
    }
  }

  ownsEntityId(entityId: string): boolean {
    return new RegExp(`^${TASK_OBJECT_ENTITY_PREFIX}[a-f0-9]{64}$`, "u").test(entityId);
  }

  async #read(): Promise<RegistryDocument> {
    try {
      const info = await stat(this.path);
      if (!info.isFile() || info.size > TASK_OBJECT_REGISTRY_MAX_BYTES) {
        throw new ContractError("task object registry file is invalid");
      }
      const content = await readFile(this.path, "utf8");
      return parseDocument(JSON.parse(content) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, records: [] };
      }
      if (error instanceof ContractError) throw error;
      throw new ContractError("task object registry JSON is malformed");
    }
  }

  async #readArchive(): Promise<RegistryDocument> {
    try {
      const info = await stat(this.archivePath);
      if (!info.isFile() || info.size > TASK_OBJECT_ARCHIVE_MAX_BYTES) {
        throw new ContractError("task object archive file is invalid");
      }
      const content = await readFile(this.archivePath, "utf8");
      return parseArchiveDocument(JSON.parse(content) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, records: [] };
      }
      if (error instanceof ContractError) throw error;
      throw new ContractError("task object archive JSON is malformed");
    }
  }

  async #writeDocument(
    path: string,
    document: RegistryDocument,
    maximumBytes: number,
    budgetMessage: string,
  ): Promise<void> {
    const body = serializedDocument(document);
    if (Buffer.byteLength(body, "utf8") > maximumBytes) {
      throw new ContractError(budgetMessage);
    }
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  }

  async #write(document: RegistryDocument): Promise<void> {
    await this.#writeDocument(
      this.path,
      document,
      TASK_OBJECT_REGISTRY_MAX_BYTES,
      "task object registry exceeds its byte budget",
    );
  }

  async #writeArchive(document: RegistryDocument): Promise<void> {
    await this.#writeDocument(
      this.archivePath,
      document,
      TASK_OBJECT_ARCHIVE_MAX_BYTES,
      "task object archive exceeds its byte budget",
    );
  }

  async #mutate<T>(operation: (document: RegistryDocument) => Promise<T>): Promise<T> {
    const previous = this.#mutation;
    let release!: () => void;
    this.#mutation = new Promise<void>((resolveMutation) => {
      release = resolveMutation;
    });
    await previous;
    try {
      return await operation(await this.#read());
    } finally {
      release();
    }
  }

  async upsert(
    task: CodexHostTaskContext,
    binding: CodexTaskWorkspaceBindingEntry,
    rawInput: unknown,
  ): Promise<TaskObjectMutationResult> {
    const input = parseTaskObjectInput(rawInput);
    return await this.#mutate(async (document) => {
      const index = document.records.findIndex((record) =>
        matchesEntry(record, task, binding) && record.objectKey === input.objectKey);
      const existing = index < 0 ? undefined : document.records[index];
      if (existing !== undefined && existing.lifecycle !== "active") {
        throw new ContractError("retired or superseded objectKey cannot be reactivated");
      }
      if (existing !== undefined && !sameObjectIdentity(existing, input)) {
        throw new ContractError("task object identity changes require supersede");
      }
      const nextRevision = revisionFor(input, "active");
      if (
        existing !== undefined &&
        existing.lifecycle === "active" &&
        existing.entityRevision === nextRevision
      ) {
        return { kind: "unchanged", object: summary(existing) };
      }
      const activeCount = document.records.filter((record) =>
        matchesEntry(record, task, binding) && record.lifecycle === "active" &&
        record.objectKey !== input.objectKey).length;
      if (activeCount >= TASK_OBJECT_ACTIVE_HARD_LIMIT) {
        throw new ContractError("active task object capacity is full");
      }
      const now = new Date().toISOString();
      const record: StoredTaskObject = {
        ...copyInput(input),
        scope: { ...binding.scope },
        threadRef: codexTaskThreadRef(task),
        routeRef: task.routeRef,
        workspaceRoot: binding.workspaceRoot,
        bindingRevision: binding.bindingRevision,
        entityId: existing?.entityId ?? entityIdFor(binding, task, input.objectKey),
        lifecycle: "active",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        entityRevision: nextRevision,
      };
      if (index < 0) {
        if (document.records.length >= TASK_OBJECT_REGISTRY_MAX_RECORDS) {
          throw new ContractError("task object registry is full");
        }
        document.records.push(record);
      } else {
        document.records[index] = record;
      }
      await this.#write(document);
      return { kind: existing === undefined ? "created" : "updated", object: summary(record) };
    });
  }

  async supersede(
    task: CodexHostTaskContext,
    binding: CodexTaskWorkspaceBindingEntry,
    replacedObjectKey: string,
    rawReplacement: unknown,
  ): Promise<TaskObjectMutationResult> {
    const replacedKey = objectKey(replacedObjectKey);
    const replacement = parseTaskObjectInput(rawReplacement);
    if (replacement.objectKey === replacedKey) {
      throw new ContractError("replacement objectKey must differ from the superseded object");
    }
    return await this.#mutate(async (document) => {
      const oldIndex = document.records.findIndex((record) =>
        matchesEntry(record, task, binding) &&
        record.objectKey === replacedKey &&
        record.lifecycle === "active");
      const old = oldIndex < 0 ? undefined : document.records[oldIndex];
      if (old === undefined) throw new ContractError("active task object to supersede was not found");
      const replacementIndex = document.records.findIndex((record) =>
        matchesEntry(record, task, binding) && record.objectKey === replacement.objectKey);
      const existingReplacement = replacementIndex < 0
        ? undefined
        : document.records[replacementIndex];
      if (existingReplacement !== undefined) {
        throw new ContractError("replacement objectKey has already been used");
      }
      if (replacementIndex < 0 && document.records.length >= TASK_OBJECT_REGISTRY_MAX_RECORDS) {
        throw new ContractError("task object registry is full");
      }
      const now = new Date().toISOString();
      const retiredOld: StoredTaskObject = {
        ...copyStored(old),
        lifecycle: "superseded",
        replacedByObjectKey: replacement.objectKey,
        updatedAt: now,
        entityRevision: revisionFor(old, "superseded", replacement.objectKey),
      };
      const next: StoredTaskObject = {
        ...copyInput(replacement),
        scope: { ...binding.scope },
        threadRef: codexTaskThreadRef(task),
        routeRef: task.routeRef,
        workspaceRoot: binding.workspaceRoot,
        bindingRevision: binding.bindingRevision,
        entityId: entityIdFor(binding, task, replacement.objectKey),
        lifecycle: "active",
        createdAt: now,
        updatedAt: now,
        entityRevision: revisionFor(replacement, "active"),
      };
      document.records[oldIndex] = retiredOld;
      document.records.push(next);
      await this.#write(document);
      return { kind: "superseded", object: summary(retiredOld), replacement: summary(next) };
    });
  }

  async retire(
    task: CodexHostTaskContext,
    binding: CodexTaskWorkspaceBindingEntry,
    rawObjectKey: string,
  ): Promise<TaskObjectMutationResult> {
    const key = objectKey(rawObjectKey);
    return await this.#mutate(async (document) => {
      const index = document.records.findIndex((record) =>
        matchesEntry(record, task, binding) &&
        record.objectKey === key &&
        record.lifecycle === "active");
      const current = index < 0 ? undefined : document.records[index];
      if (current === undefined) throw new ContractError("active task object to retire was not found");
      const retired: StoredTaskObject = {
        ...copyStored(current),
        lifecycle: "retired",
        updatedAt: new Date().toISOString(),
        entityRevision: revisionFor(current, "retired"),
      };
      document.records[index] = retired;
      await this.#write(document);
      return { kind: "retired", object: summary(retired) };
    });
  }

  #capacityStatus(
    document: RegistryDocument,
    archive: RegistryDocument,
    task: CodexHostTaskContext,
    binding: CodexTaskWorkspaceBindingEntry,
  ): TaskObjectCapacityStatus {
    const current = document.records.filter((record) => matchesEntry(record, task, binding));
    const active = current.filter((record) => record.lifecycle === "active").length;
    const warnings: TaskObjectCapacityStatus["warnings"] = active >= TASK_OBJECT_ACTIVE_SOFT_LIMIT
      ? ["active_soft_limit_reached"]
      : [];
    return Object.freeze({
      active,
      terminal: current.length - active,
      currentTaskRecords: current.length,
      registryRecords: document.records.length,
      archivedRecords: archive.records.length,
      registryBytes: documentBytes(document),
      archivedBytes: documentBytes(archive),
      activeSoftLimit: TASK_OBJECT_ACTIVE_SOFT_LIMIT,
      activeHardLimit: TASK_OBJECT_ACTIVE_HARD_LIMIT,
      registryRecordLimit: TASK_OBJECT_REGISTRY_MAX_RECORDS,
      registryByteLimit: TASK_OBJECT_REGISTRY_MAX_BYTES,
      archiveRecordLimit: TASK_OBJECT_ARCHIVE_MAX_RECORDS,
      archiveByteLimit: TASK_OBJECT_ARCHIVE_MAX_BYTES,
      warnings: Object.freeze([...warnings]),
    }) as TaskObjectCapacityStatus;
  }

  async inventoryForTask(
    task: CodexHostTaskContext,
    binding: CodexTaskWorkspaceBindingEntry,
  ): Promise<TaskObjectInventory> {
    const [document, archive] = await Promise.all([this.#read(), this.#readArchive()]);
    const objects = document.records
      .filter((record) => matchesEntry(record, task, binding))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(summary);
    return Object.freeze({
      objects: Object.freeze(objects),
      capacity: this.#capacityStatus(document, archive, task, binding),
    }) as TaskObjectInventory;
  }

  async capacityForTask(
    task: CodexHostTaskContext,
    binding: CodexTaskWorkspaceBindingEntry,
  ): Promise<TaskObjectCapacityStatus> {
    return (await this.inventoryForTask(task, binding)).capacity;
  }

  async auditCuration(
    task: CodexHostTaskContext,
    binding: CodexTaskWorkspaceBindingEntry,
    rawStableRecords: unknown,
  ): Promise<TaskObjectCurationAudit> {
    const stableRecords = validateContextIndexForRuntime(rawStableRecords, binding.scope);
    const current = (await this.#read()).records
      .filter((record) => matchesEntry(record, task, binding))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const items = current.map((record): TaskObjectCurationItem => {
      const stableMatchCount = stableMatchesFor(record, stableRecords).length;
      const state: TaskObjectCurationState = record.lifecycle === "active"
        ? stableMatchCount === 0
          ? "active_partial"
          : stableMatchCount === 1
            ? "active_stable_overlap"
            : "active_ambiguous_overlap"
        : stableMatchCount === 0
          ? "terminal_unmatched"
          : stableMatchCount === 1
            ? "terminal_archive_ready"
            : "terminal_ambiguous";
      return Object.freeze({
        objectKey: record.objectKey,
        entityType: record.entityType,
        canonicalName: record.canonicalName,
        lifecycle: record.lifecycle,
        state,
        stableMatchCount,
      });
    });
    const count = (state: TaskObjectCurationState): number =>
      items.filter((item) => item.state === state).length;
    const stableOverlaps = items.filter((item) => item.stableMatchCount > 0).length;
    return Object.freeze({
      currentTaskRecords: items.length,
      activePartials: count("active_partial"),
      activeStableOverlaps: count("active_stable_overlap"),
      activeAmbiguousOverlaps: count("active_ambiguous_overlap"),
      terminalUnmatched: count("terminal_unmatched"),
      terminalArchiveReady: count("terminal_archive_ready"),
      terminalAmbiguous: count("terminal_ambiguous"),
      stableOverlapRate: items.length === 0 ? 0 : stableOverlaps / items.length,
      omissionMeasurement: "explicit_milestone_review_required",
      items: Object.freeze(items),
    }) as TaskObjectCurationAudit;
  }

  /**
   * Rebind durable task objects to a fresh capability revision only when the
   * host-vouched task, route, canonical workspace root, and scope are all
   * unchanged. This makes an explicit same-workspace rebind or unbind/rebind
   * recoverable without weakening the current binding fence.
   */
  async adoptBinding(
    task: CodexHostTaskContext,
    binding: CodexTaskWorkspaceBindingEntry,
  ): Promise<number> {
    return await this.#mutate(async (document) => {
      const candidates = document.records.filter((record) =>
        matchesTaskWorkspace(record, task, binding) &&
        record.bindingRevision !== binding.bindingRevision);
      if (candidates.length === 0) return 0;
      const candidateIds = new Set(candidates.map((record) => record.entityId));
      document.records = document.records.map((record) =>
        candidateIds.has(record.entityId)
          ? { ...copyStored(record), bindingRevision: binding.bindingRevision }
          : record);
      await this.#write(document);
      return candidates.length;
    });
  }

  /**
   * Move only terminal task objects that have exactly one same-type/same-name
   * stable workspace identity into an audit-only archive. The archive is
   * written first; a crash can therefore leave a harmless duplicate but can
   * never delete the only historical copy.
   */
  async archiveGraduated(
    task: CodexHostTaskContext,
    binding: CodexTaskWorkspaceBindingEntry,
    rawStableRecords: unknown,
  ): Promise<TaskObjectArchiveResult> {
    const stableRecords = validateContextIndexForRuntime(rawStableRecords, binding.scope);
    return await this.#mutate(async (document) => {
      const eligible = document.records.filter((record) => {
        if (record.lifecycle === "active" || !matchesEntry(record, task, binding)) return false;
        return stableMatchesFor(record, stableRecords).length === 1;
      });
      const archive = await this.#readArchive();
      if (eligible.length === 0) {
        return Object.freeze({
          kind: "unchanged",
          archivedCount: 0,
          archiveRevision: archiveRevision(archive.records),
        });
      }

      const archivedByEntityId = new Map(
        archive.records.map((record) => [record.entityId, record] as const),
      );
      for (const record of eligible) {
        const existing = archivedByEntityId.get(record.entityId);
        if (existing !== undefined && existing.entityRevision !== record.entityRevision) {
          throw new ContractError("task object archive contains a conflicting revision");
        }
        if (existing === undefined) {
          const copied = copyStored(record);
          archive.records.push(copied);
          archivedByEntityId.set(copied.entityId, copied);
        }
      }
      if (archive.records.length > TASK_OBJECT_ARCHIVE_MAX_RECORDS) {
        throw new ContractError("task object archive is full");
      }

      await this.#writeArchive(archive);
      const eligibleIds = new Set(eligible.map((record) => record.entityId));
      document.records = document.records.filter((record) => !eligibleIds.has(record.entityId));
      await this.#write(document);
      return Object.freeze({
        kind: "archived",
        archivedCount: eligible.length,
        archiveRevision: archiveRevision(archive.records),
      });
    });
  }

  async listForTask(
    task: CodexHostTaskContext,
    binding: CodexTaskWorkspaceBindingEntry,
  ): Promise<TaskObjectSummary[]> {
    return (await this.inventoryForTask(task, binding)).objects;
  }

  async listActive(binding: TrustedContextBinding, signal?: AbortSignal): Promise<IdentityRecord[]> {
    if (signal?.aborted) throw signal.reason;
    const records = (await this.#read()).records
      .filter((record) => record.lifecycle === "active" && matchesBinding(record, binding));
    return this.#identityRecords(records, signal);
  }

  async listForLookup(
    binding: TrustedContextBinding,
    stableRecords: readonly IdentityRecord[],
    signal?: AbortSignal,
  ): Promise<IdentityRecord[]> {
    if (signal?.aborted) throw signal.reason;
    const records = (await this.#read()).records
      .filter((record) => matchesBinding(record, binding))
      .filter((record) => {
        if (record.lifecycle === "active") return true;
        const name = record.canonicalName.normalize("NFKC").toLocaleLowerCase("en-US");
        return !stableRecords.some((stable) =>
          !stable.deleted &&
          stable.entityType === record.entityType &&
          stable.canonicalName.normalize("NFKC").toLocaleLowerCase("en-US") === name);
      });
    return this.#identityRecords(records, signal);
  }

  async list(binding: TrustedContextBinding, signal?: AbortSignal): Promise<IdentityRecord[]> {
    if (signal?.aborted) throw signal.reason;
    const records = (await this.#read()).records
      .filter((record) => matchesBinding(record, binding));
    return this.#identityRecords(records, signal);
  }

  #identityRecords(
    records: readonly StoredTaskObject[],
    signal?: AbortSignal,
  ): IdentityRecord[] {
    if (signal?.aborted) throw signal.reason;
    const revision = `task-objects:${createHash("sha256")
      .update(records.map((record) => `${record.entityId}:${record.entityRevision}`).sort().join("\n"), "utf8")
      .digest("hex")}`;
    const indexedAt = new Date().toISOString();
    return records.map((record) => ({
      schemaVersion: "1.0",
      scope: { ...record.scope },
      entityId: record.entityId,
      entityType: record.entityType,
      canonicalKey: record.objectKey,
      canonicalName: record.canonicalName,
      aliases: [...record.aliases],
      summary: record.summary,
      authorityRef: { provider: TASK_OBJECT_PROVIDER_ID, locator: record.entityId },
      indexRevision: revision,
      indexedAt,
      deleted: false,
    }));
  }

  async getDetail(request: {
    binding: TrustedContextBinding;
    entityId: string;
    entityType: string;
    authorityLocator: string;
    revisionPolicy: "current-or-explicit-stale";
    signal?: AbortSignal;
  }): Promise<AuthorityResult> {
    if (request.signal?.aborted) return { kind: "unavailable", retryable: true };
    if (!this.ownsEntityId(request.entityId) || request.authorityLocator !== request.entityId) {
      return { kind: "not_found" };
    }
    const record = (await this.#read()).records.find((candidate) =>
      candidate.entityId === request.entityId &&
      candidate.entityType === request.entityType &&
      matchesBinding(candidate, request.binding));
    if (record === undefined) return { kind: "not_found" };
    const snapshot: DetailSnapshot = {
      scope: { ...record.scope },
      entityId: record.entityId,
      entityType: record.entityType,
      entityRevision: record.entityRevision,
      observedAt: new Date().toISOString(),
      freshness: "partial",
      facts: facts(record),
      relations: [],
      sourceRefs: [{ sourceType: TASK_OBJECT_PROVIDER_ID, sourceId: record.objectKey }],
    };
    return {
      kind: "snapshot",
      snapshot,
      verification: { verifiedAt: snapshot.observedAt, method: "live_read" },
    };
  }

  async probe(request: {
    binding: TrustedContextBinding;
    entityId: string;
    entityType: string;
    signal?: AbortSignal;
  }): Promise<LocalWorkspaceRevisionProbeResult> {
    const observedAt = new Date().toISOString();
    if (request.signal?.aborted) return { kind: "unavailable", observedAt, retryable: true };
    if (!this.ownsEntityId(request.entityId)) return { kind: "not_found", observedAt };
    const record = (await this.#read()).records.find((candidate) =>
      candidate.entityId === request.entityId &&
      candidate.entityType === request.entityType &&
      matchesBinding(candidate, request.binding));
    return record === undefined
      ? { kind: "not_found", observedAt }
      : { kind: "current", revision: record.entityRevision, observedAt };
  }
}

/**
 * Annotation catalogs should advertise only current task objects. Historical
 * superseded/retired identities stay in the lookup index so old Chat remains
 * understandable, but they do not compete for the bounded Top-3 quiet marks.
 */
export class ActiveTaskObjectAnnotationIndex implements ContextIndexPort {
  constructor(readonly registry: TaskObjectRegistry) {}

  async list(binding: TrustedContextBinding, signal?: AbortSignal): Promise<IdentityRecord[]> {
    return await this.registry.listActive(binding, signal);
  }
}

/**
 * Prefer a stable workspace artifact once a same-type/same-name task object
 * reaches a terminal state. Other terminal task objects stay queryable so old
 * Chat references retain historical context.
 */
export class TaskObjectWorkspaceContextIndex implements ContextIndexPort {
  constructor(
    readonly stableIndex: ContextIndexPort,
    readonly registry: TaskObjectRegistry,
  ) {}

  async list(binding: TrustedContextBinding, signal?: AbortSignal): Promise<IdentityRecord[]> {
    const stable = await this.stableIndex.list(binding, signal);
    if (signal?.aborted) throw signal.reason;
    const taskObjects = await this.registry.listForLookup(binding, stable, signal);
    return [...stable, ...taskObjects];
  }
}

export class CompositeContextIndex implements ContextIndexPort {
  constructor(readonly indexes: readonly ContextIndexPort[]) {
    if (indexes.length < 1 || indexes.length > 8) {
      throw new RangeError("CompositeContextIndex requires 1 to 8 indexes");
    }
  }

  async list(binding: TrustedContextBinding, signal?: AbortSignal): Promise<IdentityRecord[]> {
    const records: IdentityRecord[] = [];
    for (const index of this.indexes) {
      if (signal?.aborted) throw signal.reason;
      records.push(...await index.list(binding, signal));
    }
    return records;
  }
}

export class RoutedWorkspaceRevisionProbe implements WorkspaceRevisionProbe {
  constructor(
    readonly taskObjects: TaskObjectRegistry,
    readonly fallback: WorkspaceRevisionProbe,
  ) {}

  async probe(request: Parameters<WorkspaceRevisionProbe["probe"]>[0]): Promise<LocalWorkspaceRevisionProbeResult> {
    return this.taskObjects.ownsEntityId(request.entityId)
      ? await this.taskObjects.probe(request)
      : await this.fallback.probe(request);
  }
}

import { createHash } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { TrustedContextBinding } from "../contracts.js";
import {
  LocalWorkspaceAuthoritativeProvider,
  LocalWorkspaceContextIndex,
} from "../adapters/local-workspace.js";
import {
  LOCAL_WORKSPACE_PROVIDER_ID,
  localWorkspaceScope,
} from "../host/codex-cdp/task-workspace-binding.js";
import {
  checkContextRecords,
  type ContextRecordIssue,
} from "./context-record-check.js";

const DEFAULT_MANIFEST_PATH = "docs/context-coverage.json";
const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_EXPECTED_OBJECTS = 256;
const MAX_KEY_CHARS = 512;

export type ContextCoverageKind = "module" | "decision" | "task" | "verification";
export type ContextCoverageObjectStatus =
  | "available"
  | "missing"
  | "type_mismatch"
  | "invalid"
  | "unavailable";

export interface ContextCoverageExpectation {
  id: string;
  kind: ContextCoverageKind;
  key: string;
}

export interface ContextCoverageManifest {
  schemaVersion: 1;
  taskId: string;
  declaredAt: string;
  expected: readonly ContextCoverageExpectation[];
}

export interface ContextCoverageObjectResult extends ContextCoverageExpectation {
  status: ContextCoverageObjectStatus;
  entityId?: string;
  entityRevision?: string;
  freshness?: "current" | "stale" | "partial";
}

export type ContextCoverageIssueCode =
  | "workspace_unavailable"
  | "manifest_unavailable"
  | "manifest_invalid"
  | "index_unavailable"
  | "record_check_invalid"
  | "expected_object_missing"
  | "expected_object_type_mismatch"
  | "expected_object_invalid"
  | "expected_object_unavailable";

export interface ContextCoverageIssue {
  code: ContextCoverageIssueCode;
  objectId?: string;
  key?: string;
}

export interface ContextCoverageSummary {
  expected: number;
  available: number;
  missing: number;
  typeMismatch: number;
  invalid: number;
  unavailable: number;
  coverageRate: number;
  omissionRate: number;
  projectionFailureRate: number;
  indexedByKind: Readonly<Record<ContextCoverageKind, number>>;
  recordCandidates: number;
  validRecords: number;
  redundantRecords: number;
  redundancyRate: number;
}

export interface ContextCoverageResult {
  schemaVersion: 1;
  valid: boolean;
  checkedAt: string;
  workspaceRoot?: string;
  manifestPath?: string;
  taskId?: string;
  declaredAt?: string;
  summary: ContextCoverageSummary;
  objects: readonly ContextCoverageObjectResult[];
  recordIssues: readonly ContextRecordIssue[];
  issues: readonly ContextCoverageIssue[];
}

interface ParsedManifest {
  manifest: ContextCoverageManifest;
  digest: string;
}

function emptyCounts(): Record<ContextCoverageKind, number> {
  return { module: 0, decision: 0, task: 0, verification: 0 };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(6));
}

function summary(
  objects: readonly ContextCoverageObjectResult[],
  indexedByKind: Readonly<Record<ContextCoverageKind, number>>,
  recordCandidates: number,
  validRecords: number,
  redundantRecords: number,
): ContextCoverageSummary {
  const count = (status: ContextCoverageObjectStatus): number =>
    objects.filter((object) => object.status === status).length;
  const expected = objects.length;
  const available = count("available");
  const missing = count("missing");
  const typeMismatch = count("type_mismatch");
  const invalid = count("invalid");
  const unavailable = count("unavailable");
  return Object.freeze({
    expected,
    available,
    missing,
    typeMismatch,
    invalid,
    unavailable,
    coverageRate: ratio(available, expected),
    omissionRate: ratio(missing, expected),
    projectionFailureRate: ratio(typeMismatch + invalid + unavailable, expected),
    indexedByKind: Object.freeze({ ...indexedByKind }),
    recordCandidates,
    validRecords,
    redundantRecords,
    redundancyRate: ratio(redundantRecords, recordCandidates),
  });
}

function resultWithoutWorkspace(
  checkedAt: string,
  code: "workspace_unavailable" | "manifest_unavailable" | "manifest_invalid",
  workspaceRoot?: string,
  manifestPath?: string,
): ContextCoverageResult {
  return Object.freeze({
    schemaVersion: 1 as const,
    valid: false,
    checkedAt,
    ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
    ...(manifestPath === undefined ? {} : { manifestPath }),
    summary: summary([], emptyCounts(), 0, 0, 0),
    objects: Object.freeze([]),
    recordIssues: Object.freeze([]),
    issues: Object.freeze([{ code }]),
  });
}

function portableRelative(root: string, target: string): string | undefined {
  const value = relative(root, target);
  if (
    value === "" ||
    value === ".." ||
    value.startsWith(`..${sep}`) ||
    isAbsolute(value)
  ) {
    return undefined;
  }
  return value.split(sep).join("/");
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string")) return false;
  return Object.keys(value).sort().join("|") === [...expected].sort().join("|");
}

function stableIdentity(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
  ) {
    return undefined;
  }
  return value;
}

function portableKey(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_KEY_CHARS ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((part) => part.length === 0 || part === "." || part === "..") ||
    /[\p{Cc}\p{Cf}]/u.test(value)
  ) {
    return undefined;
  }
  return value;
}

function parseManifest(value: unknown): ContextCoverageManifest | undefined {
  if (
    !plainObject(value) ||
    !exactKeys(value, ["schemaVersion", "taskId", "declaredAt", "expected"]) ||
    value.schemaVersion !== 1 ||
    stableIdentity(value.taskId) === undefined ||
    typeof value.declaredAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value.declaredAt) ||
    !Number.isFinite(Date.parse(value.declaredAt)) ||
    !Array.isArray(value.expected) ||
    value.expected.length < 1 ||
    value.expected.length > MAX_EXPECTED_OBJECTS
  ) {
    return undefined;
  }
  const expected: ContextCoverageExpectation[] = [];
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const raw of value.expected) {
    if (!plainObject(raw) || !exactKeys(raw, ["id", "kind", "key"])) return undefined;
    const id = stableIdentity(raw.id);
    const key = portableKey(raw.key);
    if (
      id === undefined ||
      key === undefined ||
      (raw.kind !== "module" && raw.kind !== "decision" &&
        raw.kind !== "task" && raw.kind !== "verification") ||
      ids.has(id) ||
      keys.has(`${raw.kind}\u0000${key}`)
    ) {
      return undefined;
    }
    ids.add(id);
    keys.add(`${raw.kind}\u0000${key}`);
    expected.push(Object.freeze({ id, kind: raw.kind, key }));
  }
  const taskId = value.taskId as string;
  return Object.freeze({
    schemaVersion: 1 as const,
    taskId,
    declaredAt: value.declaredAt,
    expected: Object.freeze(expected),
  });
}

async function readManifest(root: string, manifestPath: string): Promise<ParsedManifest | undefined> {
  const key = portableKey(manifestPath);
  if (key === undefined) return undefined;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const canonical = await realpath(resolve(root, ...key.split("/")));
    if (portableRelative(root, canonical) !== key) return undefined;
    handle = await open(canonical, "r");
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_MANIFEST_BYTES) return undefined;
    const content = await handle.readFile();
    const after = await handle.stat();
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      before.ino !== after.ino
    ) {
      return undefined;
    }
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(content);
    if (decoded.includes("\u0000")) return undefined;
    const manifest = parseManifest(JSON.parse(decoded) as unknown);
    return manifest === undefined
      ? undefined
      : { manifest, digest: createHash("sha256").update(content).digest("hex") };
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function issueFor(object: ContextCoverageObjectResult): ContextCoverageIssue | undefined {
  const base = { objectId: object.id, key: object.key };
  switch (object.status) {
    case "available": return undefined;
    case "missing": return { code: "expected_object_missing", ...base };
    case "type_mismatch": return { code: "expected_object_type_mismatch", ...base };
    case "invalid": return { code: "expected_object_invalid", ...base };
    case "unavailable": return { code: "expected_object_unavailable", ...base };
  }
}

export async function auditContextCoverage(
  workspaceRoot: string,
  options: {
    manifestPath?: string;
    signal?: AbortSignal;
    now?: () => Date;
  } = {},
): Promise<ContextCoverageResult> {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  let root: string;
  try {
    root = await realpath(resolve(workspaceRoot));
    if (!(await stat(root)).isDirectory()) throw new Error("not a directory");
  } catch {
    return resultWithoutWorkspace(checkedAt, "workspace_unavailable");
  }
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const parsed = await readManifest(root, manifestPath);
  if (parsed === undefined) {
    const requested = portableKey(manifestPath);
    const target = requested === undefined ? undefined : resolve(root, ...requested.split("/"));
    let unavailable = true;
    if (target !== undefined) {
      try {
        unavailable = !(await stat(target)).isFile();
      } catch {
        unavailable = true;
      }
    }
    return resultWithoutWorkspace(
      checkedAt,
      unavailable ? "manifest_unavailable" : "manifest_invalid",
      root,
      requested,
    );
  }
  const binding: TrustedContextBinding = Object.freeze({
    kind: "trusted" as const,
    scope: localWorkspaceScope(root),
    bindingRevision: `coverage:${parsed.digest}`,
    evidence: "explicit_user" as const,
    selectionGeneration: 1,
    workspaceRoot: root,
  });
  const recordCheck = await checkContextRecords(root, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  let records;
  try {
    records = await new LocalWorkspaceContextIndex().list(binding, options.signal);
  } catch {
    const redundantRecords = new Set(
      recordCheck.issues
        .filter((issue) => issue.code === "duplicate_identity")
        .map((issue) => issue.path)
        .filter((path): path is string => path !== undefined),
    ).size;
    return Object.freeze({
      schemaVersion: 1 as const,
      valid: false,
      checkedAt,
      workspaceRoot: root,
      manifestPath,
      taskId: parsed.manifest.taskId,
      declaredAt: parsed.manifest.declaredAt,
      summary: summary(
        [],
        emptyCounts(),
        recordCheck.candidateCount,
        recordCheck.records.length,
        redundantRecords,
      ),
      objects: Object.freeze([]),
      recordIssues: Object.freeze([...recordCheck.issues]),
      issues: Object.freeze([{ code: "index_unavailable" as const }]),
    });
  }
  const indexedByKind = emptyCounts();
  for (const record of records) {
    if (record.entityType in indexedByKind) {
      indexedByKind[record.entityType as ContextCoverageKind] += 1;
    }
  }
  const provider = new LocalWorkspaceAuthoritativeProvider();
  if (provider.providerId !== LOCAL_WORKSPACE_PROVIDER_ID) {
    throw new Error("local workspace provider identity drifted");
  }
  const objects: ContextCoverageObjectResult[] = [];
  for (const expected of parsed.manifest.expected) {
    if (options.signal?.aborted) {
      objects.push(Object.freeze({ ...expected, status: "unavailable" }));
      continue;
    }
    const matchingKey = records.filter((record) => record.canonicalKey === expected.key);
    if (matchingKey.length === 0) {
      objects.push(Object.freeze({ ...expected, status: "missing" }));
      continue;
    }
    const record = matchingKey.find((candidate) => candidate.entityType === expected.kind);
    if (record === undefined) {
      objects.push(Object.freeze({ ...expected, status: "type_mismatch" }));
      continue;
    }
    const detail = await provider.getDetail({
      binding,
      entityId: record.entityId,
      entityType: record.entityType,
      authorityLocator: record.authorityRef.locator,
      revisionPolicy: "current-or-explicit-stale",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (detail.kind === "snapshot") {
      objects.push(Object.freeze({
        ...expected,
        status: "available",
        entityId: record.entityId,
        entityRevision: detail.snapshot.entityRevision,
        freshness: detail.snapshot.freshness,
      }));
    } else if (detail.kind === "not_found") {
      objects.push(Object.freeze({ ...expected, status: "invalid", entityId: record.entityId }));
    } else {
      objects.push(Object.freeze({ ...expected, status: "unavailable", entityId: record.entityId }));
    }
  }
  const redundantRecords = new Set(
    recordCheck.issues
      .filter((issue) => issue.code === "duplicate_identity")
      .map((issue) => issue.path)
      .filter((path): path is string => path !== undefined),
  ).size;
  const issues = objects.flatMap((object) => {
    const issue = issueFor(object);
    return issue === undefined ? [] : [issue];
  });
  if (!recordCheck.valid) issues.push({ code: "record_check_invalid" });
  return Object.freeze({
    schemaVersion: 1 as const,
    valid: issues.length === 0,
    checkedAt,
    workspaceRoot: root,
    manifestPath,
    taskId: parsed.manifest.taskId,
    declaredAt: parsed.manifest.declaredAt,
    summary: summary(
      objects,
      indexedByKind,
      recordCheck.candidateCount,
      recordCheck.records.length,
      redundantRecords,
    ),
    objects: Object.freeze(objects),
    recordIssues: Object.freeze([...recordCheck.issues]),
    issues: Object.freeze(issues),
  });
}

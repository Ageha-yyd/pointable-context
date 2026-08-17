import { Buffer } from "node:buffer";
import type {
  AuthorityVerification,
  ContextScopeRef,
  DetailSnapshot,
  FactScalar,
  FactValue,
  Freshness,
  IdentityRecord,
  SourceRef,
} from "./contracts.js";
import {
  copyContextScope,
  isContextScopeKind,
  sameContextScope,
} from "./context-scope.js";
import { DEFAULT_MAX_SELECTION_CHARS } from "./eligibility.js";
import { normalizeText } from "./normalize.js";

const MAX_STRING_LENGTH = 4_096;
const MAX_FACT_KEY_LENGTH = 128;
const MAX_FACT_STRING_LENGTH = 1_024;
const MAX_FACT_ARRAY_LENGTH = 10;
const MAX_FACT_FIELDS = 50;
const MAX_FACT_TEXT_BUDGET_BYTES = 16_384;
const MAX_RELATIONS = 100;
const MAX_SOURCES = 100;
const MAX_ALIAS_LENGTH = 512;
const MAX_RELATION_LENGTH = 512;
const MAX_SOURCE_TYPE_LENGTH = 128;
const MAX_SOURCE_ID_LENGTH = 512;
const MAX_REVISION_LENGTH = 512;
const MAX_IDENTITY_BUDGET_BYTES = 32_768;
const MAX_SNAPSHOT_BUDGET_BYTES = 65_536;
const CLOCK_SKEW_MS = 30_000;
const DANGEROUS_FACT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Whole-index limits are deliberately much tighter than the sum of the
 * per-record limits. A valid record repeated many times must not turn the
 * resolver into an unbounded records x aliases x selection scan.
 */
export const CONTEXT_INDEX_LIMITS = Object.freeze({
  records: 2_048,
  aliases: 4_096,
  utf8Bytes: 2 * 1024 * 1024,
  resolutionWorkUnits: 8 * 1024 * 1024,
});

export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}

export class IdentityMismatchError extends ContractError {
  constructor(message: string) {
    super(message);
    this.name = "IdentityMismatchError";
  }
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function contextScopeValue(value: unknown, path: string): ContextScopeRef {
  const scope = objectValue(value, path);
  if (!isContextScopeKind(scope.kind)) {
    throw new ContractError(`${path}.kind is unsupported`);
  }
  return {
    kind: scope.kind,
    namespace: semanticStringValue(scope.namespace, `${path}.namespace`),
    id: semanticStringValue(scope.id, `${path}.id`),
  };
}

function legacyProjectScope(
  rawLegacyScopeId: unknown,
  expectedScope: ContextScopeRef,
  path: string,
): ContextScopeRef {
  if (expectedScope.kind !== "project") {
    throw new ContractError(`${path} requires a project scope`);
  }
  const legacyScopeId = semanticStringValue(rawLegacyScopeId, path);
  if (legacyScopeId !== expectedScope.id) {
    throw new ContractError(`${path} does not match the trusted scope`);
  }
  return copyContextScope(expectedScope);
}

function stringValue(
  value: unknown,
  path: string,
  maximumLength = MAX_STRING_LENGTH,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ContractError(`${path} must be a non-empty string`);
  }
  if (value.length > maximumLength) {
    throw new ContractError(`${path} exceeds the string bound`);
  }
  if (hasUnpairedSurrogate(value)) {
    throw new ContractError(`${path} contains an unpaired surrogate`);
  }
  return value;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function semanticStringValue(
  value: unknown,
  path: string,
  maximumLength = MAX_STRING_LENGTH,
): string {
  const text = stringValue(value, path, maximumLength);
  if (text !== text.trim()) {
    throw new ContractError(`${path} must not contain surrounding whitespace`);
  }
  if (
    /[\p{Cc}\p{Bidi_Control}\p{Default_Ignorable_Code_Point}]/u.test(text)
  ) {
    throw new ContractError(`${path} contains invisible or control characters`);
  }
  return text;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new ContractError(`${path} must be a boolean`);
  }
  return value;
}

function stringArray(
  value: unknown,
  path: string,
  maximumValues = 100,
  maximumStringLength = MAX_STRING_LENGTH,
): string[] {
  if (!Array.isArray(value)) {
    throw new ContractError(`${path} must be an array`);
  }
  if (value.length > maximumValues) {
    throw new ContractError(`${path} has too many values`);
  }
  return value.map((item, index) =>
    stringValue(item, `${path}[${index}]`, maximumStringLength),
  );
}

function semanticStringArray(
  value: unknown,
  path: string,
  maximumValues = 100,
  maximumStringLength = MAX_STRING_LENGTH,
): string[] {
  if (!Array.isArray(value)) {
    throw new ContractError(`${path} must be an array`);
  }
  if (value.length > maximumValues) {
    throw new ContractError(`${path} has too many values`);
  }
  return value.map((item, index) =>
    semanticStringValue(item, `${path}[${index}]`, maximumStringLength),
  );
}

function assertUtf8Budget(value: unknown, maximumBytes: number, path: string): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > maximumBytes) {
    throw new ContractError(`${path} exceeds the aggregate UTF-8 bound`);
  }
}

function isoDate(value: unknown, path: string): string {
  const text = stringValue(value, path);
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/u.exec(
      text,
    );
  if (!match || Number.isNaN(Date.parse(text))) {
    throw new ContractError(`${path} must be an ISO 8601 timestamp with timezone`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (daysByMonth[month - 1] ?? 0) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    throw new ContractError(`${path} must be a valid ISO 8601 timestamp`);
  }
  return text;
}

function indexedDate(value: unknown, path: string, now = Date.now()): string {
  const text = isoDate(value, path);
  if (Date.parse(text) > now + CLOCK_SKEW_MS) {
    throw new ContractError(`${path} is in the future`);
  }
  return text;
}

function freshnessValue(value: unknown, path: string): Freshness {
  if (value !== "current" && value !== "stale" && value !== "partial") {
    throw new ContractError(`${path} is unsupported`);
  }
  return value;
}

function factScalar(value: unknown, path: string): FactScalar {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    if (value.length > MAX_FACT_STRING_LENGTH) {
      throw new ContractError(`${path} exceeds the fact string bound`);
    }
    if (hasUnpairedSurrogate(value)) {
      throw new ContractError(`${path} contains an unpaired surrogate`);
    }
    return value;
  }
  throw new ContractError(`${path} must be a bounded scalar`);
}

function factValue(value: unknown, path: string): FactValue {
  if (Array.isArray(value)) {
    if (value.length > MAX_FACT_ARRAY_LENGTH) {
      throw new ContractError(`${path} has too many values`);
    }
    return value.map((item, index) => factScalar(item, `${path}[${index}]`));
  }
  return factScalar(value, path);
}

function factTextCost(key: string, value: FactValue): number {
  const scalars = Array.isArray(value) ? value : [value];
  return (
    Buffer.byteLength(key, "utf8") +
    scalars.reduce<number>(
      (total, scalar) => total + Buffer.byteLength(String(scalar ?? ""), "utf8"),
      0,
    )
  );
}

function parseFacts(raw: unknown, path: string): Record<string, FactValue> {
  const rawFacts = objectValue(raw, path);
  const entries = Object.entries(rawFacts);
  if (entries.length > MAX_FACT_FIELDS) {
    throw new ContractError(`${path} has too many fields`);
  }

  const facts = Object.create(null) as Record<string, FactValue>;
  let textBudget = 0;
  for (const [key, item] of entries) {
    const normalizedKey = key.trim().toLowerCase();
    if (key.trim().length === 0) {
      throw new ContractError(`${path} keys must be non-empty`);
    }
    if (key.length > MAX_FACT_KEY_LENGTH) {
      throw new ContractError(`${path}.${key} exceeds the key bound`);
    }
    semanticStringValue(key, `${path}.${key}`, MAX_FACT_KEY_LENGTH);
    if (DANGEROUS_FACT_KEYS.has(normalizedKey)) {
      throw new ContractError(`${path}.${key} is a reserved key`);
    }
    const parsed = factValue(item, `${path}.${key}`);
    textBudget += factTextCost(key, parsed);
    if (textBudget > MAX_FACT_TEXT_BUDGET_BYTES) {
      throw new ContractError(`${path} exceeds the aggregate text bound`);
    }
    facts[key] = parsed;
  }
  return facts;
}

export function parseIdentityRecord(
  raw: unknown,
  expectedScope: ContextScopeRef,
): IdentityRecord {
  const value = objectValue(raw, "identity");
  const authority = objectValue(value.authority_ref, "identity.authority_ref");
  const schemaVersion = stringValue(value.schema_version, "identity.schema_version");
  if (schemaVersion !== "1.0") {
    throw new ContractError("identity.schema_version must be 1.0");
  }

  const record: IdentityRecord = {
    schemaVersion,
    scope: legacyProjectScope(
      value.project_id,
      expectedScope,
      "identity.project_id",
    ),
    entityId: semanticStringValue(value.entity_id, "identity.entity_id"),
    entityType: semanticStringValue(value.entity_type, "identity.entity_type"),
    canonicalName: semanticStringValue(value.canonical_name, "identity.canonical_name"),
    aliases: semanticStringArray(value.aliases ?? [], "identity.aliases", 100, MAX_ALIAS_LENGTH),
    summary: stringValue(value.summary, "identity.summary"),
    authorityRef: {
      provider: semanticStringValue(authority.provider, "identity.authority_ref.provider"),
      locator: semanticStringValue(authority.locator, "identity.authority_ref.locator"),
    },
    indexRevision: semanticStringValue(value.index_revision, "identity.index_revision", MAX_REVISION_LENGTH),
    indexedAt: indexedDate(value.indexed_at, "identity.indexed_at"),
    deleted: booleanValue(value.deleted ?? false, "identity.deleted"),
  };

  if (value.canonical_key !== undefined) {
    record.canonicalKey = semanticStringValue(value.canonical_key, "identity.canonical_key");
  }
  assertUtf8Budget(record, MAX_IDENTITY_BUDGET_BYTES, "identity");
  return record;
}

/** Validate the camelCase identity records returned by a ContextIndexPort. */
export function validateIdentityRecordForRuntime(raw: unknown): IdentityRecord {
  const value = objectValue(raw, "identity");
  const authority = objectValue(value.authorityRef, "identity.authorityRef");
  const schemaVersion = stringValue(value.schemaVersion, "identity.schemaVersion");
  if (schemaVersion !== "1.0") {
    throw new ContractError("identity.schemaVersion must be 1.0");
  }

  const record: IdentityRecord = {
    schemaVersion,
    scope: contextScopeValue(value.scope, "identity.scope"),
    entityId: semanticStringValue(value.entityId, "identity.entityId"),
    entityType: semanticStringValue(value.entityType, "identity.entityType"),
    canonicalName: semanticStringValue(value.canonicalName, "identity.canonicalName"),
    aliases: semanticStringArray(value.aliases ?? [], "identity.aliases", 100, MAX_ALIAS_LENGTH),
    summary: stringValue(value.summary, "identity.summary"),
    authorityRef: {
      provider: semanticStringValue(authority.provider, "identity.authorityRef.provider"),
      locator: semanticStringValue(authority.locator, "identity.authorityRef.locator"),
    },
    indexRevision: semanticStringValue(value.indexRevision, "identity.indexRevision", MAX_REVISION_LENGTH),
    indexedAt: indexedDate(value.indexedAt, "identity.indexedAt"),
    deleted: booleanValue(value.deleted, "identity.deleted"),
  };
  if (value.canonicalKey !== undefined) {
    record.canonicalKey = semanticStringValue(value.canonicalKey, "identity.canonicalKey");
  }
  assertUtf8Budget(record, MAX_IDENTITY_BUDGET_BYTES, "identity");
  return record;
}

interface ContextIndexBudgetState {
  aliases: number;
  utf8Bytes: number;
  resolutionWorkUnits: number;
}

function searchableIdentityTerms(record: IdentityRecord): string[] {
  const terms = [record.entityId, record.canonicalName, ...record.aliases];
  if (record.canonicalKey !== undefined) {
    terms.push(record.canonicalKey);
  }
  return terms;
}

function addContextIndexBudget(
  state: ContextIndexBudgetState,
  record: IdentityRecord,
  selection: string | undefined,
  normalizedSelection: string | undefined,
): void {
  state.aliases += record.aliases.length;
  if (state.aliases > CONTEXT_INDEX_LIMITS.aliases) {
    throw new ContractError("context index exceeds the aggregate alias bound");
  }

  // Serialize only the already validated copy, one record at a time. This
  // avoids constructing a second whole-index string just to enforce a budget.
  state.utf8Bytes += Buffer.byteLength(JSON.stringify(record), "utf8") + 1;
  if (state.utf8Bytes > CONTEXT_INDEX_LIMITS.utf8Bytes) {
    throw new ContractError("context index exceeds the aggregate UTF-8 bound");
  }

  if (selection === undefined || normalizedSelection === undefined) {
    return;
  }

  // In the no-match worst case every searchable term is tested once by its
  // exact layer and once by the normalized layer. Count both selection scans,
  // plus the actual (possibly NFKC-expanded) term sizes, before any RegExp is
  // constructed by the resolver.
  for (const term of searchableIdentityTerms(record)) {
    const normalizedTerm = normalizeText(term);
    state.resolutionWorkUnits +=
      selection.length +
      term.length +
      1 +
      normalizedSelection.length +
      normalizedTerm.length +
      1;
    if (
      state.resolutionWorkUnits >
      CONTEXT_INDEX_LIMITS.resolutionWorkUnits
    ) {
      throw new ContractError(
        "context index exceeds the resolution work bound",
      );
    }
  }
}

function validateContextIndex(
  rawRecords: unknown,
  expectedScope: ContextScopeRef,
  parser: (raw: unknown, expectedScope: ContextScopeRef) => IdentityRecord,
  selection?: string,
): IdentityRecord[] {
  if (!Array.isArray(rawRecords)) {
    throw new ContractError("context index records must be an array");
  }
  // This check deliberately precedes any record access. Even an array of
  // hostile getters is rejected in O(1) when its cardinality is out of bound.
  if (rawRecords.length > CONTEXT_INDEX_LIMITS.records) {
    throw new ContractError("context index exceeds the aggregate record bound");
  }
  if (selection !== undefined && selection.length > DEFAULT_MAX_SELECTION_CHARS) {
    throw new ContractError("selection exceeds the resolver input bound");
  }

  const normalizedSelection =
    selection === undefined ? undefined : normalizeText(selection);
  const state: ContextIndexBudgetState = {
    aliases: 0,
    // Account for the enclosing JSON array even though records are measured
    // incrementally below.
    utf8Bytes: 2,
    resolutionWorkUnits: 0,
  };
  const records: IdentityRecord[] = [];
  const entityIds = new Set<string>();
  const canonicalKeys = new Set<string>();

  for (let index = 0; index < rawRecords.length; index += 1) {
    const record = parser(rawRecords[index], expectedScope);
    if (!sameContextScope(record.scope, expectedScope)) {
      throw new ContractError("context index contains a cross-scope record");
    }

    const entityId = normalizeText(record.entityId);
    if (entityIds.has(entityId)) {
      throw new ContractError("context index contains a duplicate entity identity");
    }
    entityIds.add(entityId);

    if (record.canonicalKey !== undefined) {
      const canonicalKey = normalizeText(record.canonicalKey);
      if (canonicalKeys.has(canonicalKey)) {
        throw new ContractError("context index contains a duplicate canonical key");
      }
      canonicalKeys.add(canonicalKey);
    }

    addContextIndexBudget(state, record, selection, normalizedSelection);
    records.push(record);
  }
  return records;
}

/** Validate a snake_case collection read by a file/wire ContextIndex adapter. */
export function parseContextIndexRecords(
  rawRecords: unknown,
  expectedScope: ContextScopeRef,
): IdentityRecord[] {
  return validateContextIndex(rawRecords, expectedScope, parseIdentityRecord);
}

/**
 * Validate and copy the complete camelCase result of a ContextIndexPort while
 * enforcing whole-index budgets incrementally. When supplied, selection also
 * caps the exact + normalized resolver work before matching begins.
 */
export function validateContextIndexForRuntime(
  rawRecords: unknown,
  expectedScope: ContextScopeRef,
  selection?: string,
): IdentityRecord[] {
  return validateContextIndex(
    rawRecords,
    expectedScope,
    (raw) => validateIdentityRecordForRuntime(raw),
    selection,
  );
}

/**
 * Recheck resolver-facing budgets for callers that use resolveSelection
 * directly instead of going through LookupService.
 */
export function assertContextIndexResolutionBudget(
  records: IdentityRecord[],
  selection: string,
): void {
  if (records.length > CONTEXT_INDEX_LIMITS.records) {
    throw new ContractError("context index exceeds the aggregate record bound");
  }
  if (selection.length > DEFAULT_MAX_SELECTION_CHARS) {
    throw new ContractError("selection exceeds the resolver input bound");
  }

  const state: ContextIndexBudgetState = {
    aliases: 0,
    utf8Bytes: 2,
    resolutionWorkUnits: 0,
  };
  const normalizedSelection = normalizeText(selection);
  for (const record of records) {
    if (!Array.isArray(record.aliases)) {
      throw new ContractError("context index aliases must be an array");
    }
    addContextIndexBudget(state, record, selection, normalizedSelection);
  }
}

function parseSourceRef(
  raw: unknown,
  index: number,
  style: "wire" | "runtime",
): SourceRef {
  const path = style === "wire" ? `detail.source_refs[${index}]` : `detail.sourceRefs[${index}]`;
  const value = objectValue(raw, path);
  return {
    sourceType: semanticStringValue(
      style === "wire" ? value.source_type : value.sourceType,
      `${path}.${style === "wire" ? "source_type" : "sourceType"}`,
      MAX_SOURCE_TYPE_LENGTH,
    ),
    sourceId: semanticStringValue(
      style === "wire" ? value.source_id : value.sourceId,
      `${path}.${style === "wire" ? "source_id" : "sourceId"}`,
      MAX_SOURCE_ID_LENGTH,
    ),
  };
}

function parseSnapshot(
  raw: unknown,
  style: "wire" | "runtime",
  expectedScope?: ContextScopeRef,
): DetailSnapshot {
  const value = objectValue(raw, "detail");
  const field = (wire: string, runtime: string): unknown =>
    style === "wire" ? value[wire] : value[runtime];
  const sourceField = style === "wire" ? "source_refs" : "sourceRefs";
  const sourceRefs = field("source_refs", "sourceRefs");
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
    throw new ContractError(`detail.${sourceField} must contain at least one source`);
  }
  if (sourceRefs.length > MAX_SOURCES) {
    throw new ContractError(`detail.${sourceField} has too many sources`);
  }
  if (style === "wire" && expectedScope === undefined) {
    throw new ContractError("wire detail requires a trusted scope");
  }
  const scope =
    style === "wire"
      ? legacyProjectScope(
          field("project_id", "scope"),
          expectedScope!,
          "detail.project_id",
        )
      : contextScopeValue(field("project_id", "scope"), "detail.scope");

  const snapshot: DetailSnapshot = {
    scope,
    entityId: semanticStringValue(field("entity_id", "entityId"), `detail.${style === "wire" ? "entity_id" : "entityId"}`),
    entityType: semanticStringValue(field("entity_type", "entityType"), `detail.${style === "wire" ? "entity_type" : "entityType"}`),
    entityRevision: semanticStringValue(
      field("entity_revision", "entityRevision"),
      `detail.${style === "wire" ? "entity_revision" : "entityRevision"}`,
      MAX_REVISION_LENGTH,
    ),
    observedAt: isoDate(
      field("observed_at", "observedAt"),
      `detail.${style === "wire" ? "observed_at" : "observedAt"}`,
    ),
    freshness: freshnessValue(value.freshness, "detail.freshness"),
    facts: parseFacts(value.facts, "detail.facts"),
    relations: semanticStringArray(
      value.relations ?? [],
      "detail.relations",
      MAX_RELATIONS,
      MAX_RELATION_LENGTH,
    ),
    sourceRefs: sourceRefs.map((source, index) => parseSourceRef(source, index, style)),
  };
  assertUtf8Budget(snapshot, MAX_SNAPSHOT_BUDGET_BYTES, "detail");
  return snapshot;
}

/** Parse the snake_case data contract used by JSON/file adapters. */
export function parseDetailSnapshot(
  raw: unknown,
  expectedScope: ContextScopeRef,
): DetailSnapshot {
  return parseSnapshot(raw, "wire", expectedScope);
}

/**
 * Treat a provider result as untrusted at runtime even when its TypeScript type
 * claims DetailSnapshot. The returned value is a bounded, null-prototype copy.
 */
export function validateSnapshotForCandidate(
  rawSnapshot: unknown,
  expected: {
    scope: ContextScopeRef;
    entityId: string;
    entityType: string;
  },
  now = Date.now(),
): DetailSnapshot {
  const snapshot = parseSnapshot(rawSnapshot, "runtime");
  if (
    !sameContextScope(snapshot.scope, expected.scope) ||
    snapshot.entityId !== expected.entityId ||
    snapshot.entityType !== expected.entityType
  ) {
    throw new IdentityMismatchError(
      "authority identity does not match the selected candidate",
    );
  }

  const observedAt = Date.parse(snapshot.observedAt);
  if (observedAt > now + CLOCK_SKEW_MS) {
    throw new ContractError("authority snapshot observedAt is in the future");
  }
  return snapshot;
}

export function validateAuthorityVerification(
  rawVerification: unknown,
  snapshot: DetailSnapshot,
  requestStartedAt: number,
  now = Date.now(),
): AuthorityVerification {
  if (!Number.isFinite(requestStartedAt) || requestStartedAt > now + CLOCK_SKEW_MS) {
    throw new ContractError("authority request start time is invalid");
  }

  const value = objectValue(rawVerification, "authority.verification");
  const verifiedAt = isoDate(value.verifiedAt, "authority.verification.verifiedAt");
  const method = value.method;
  if (method !== "live_read" && method !== "revision_check" && method !== "fixture_read") {
    throw new ContractError("authority.verification.method is unsupported");
  }

  const verifiedAtMs = Date.parse(verifiedAt);
  if (
    verifiedAtMs < requestStartedAt - CLOCK_SKEW_MS ||
    verifiedAtMs > now + CLOCK_SKEW_MS
  ) {
    throw new ContractError("authority verification is outside the request window");
  }
  if (Date.parse(snapshot.observedAt) > verifiedAtMs + CLOCK_SKEW_MS) {
    throw new ContractError("authority snapshot was observed after verification");
  }
  let verifiedRevision: string | undefined;
  if (method === "revision_check") {
    verifiedRevision = semanticStringValue(
      value.verifiedRevision,
      "authority.verification.verifiedRevision",
      MAX_REVISION_LENGTH,
    );
    if (verifiedRevision !== snapshot.entityRevision) {
      throw new ContractError("authority verified revision does not match the snapshot");
    }
  }
  if (snapshot.freshness === "current") {
    if (method === "fixture_read") {
      throw new ContractError(
        "fixture reads cannot establish current freshness",
      );
    }
    if (now - requestStartedAt > CLOCK_SKEW_MS) {
      throw new ContractError("authority request took too long to establish current freshness");
    }
    if (verifiedAtMs < now - CLOCK_SKEW_MS) {
      throw new ContractError("current authority evidence is not recent enough");
    }
    if (
      method === "live_read" &&
      Date.parse(snapshot.observedAt) < Math.max(requestStartedAt, now) - CLOCK_SKEW_MS
    ) {
      throw new ContractError("current live-read snapshot is not recent enough");
    }
  }

  return method === "revision_check"
    ? { verifiedAt, method, verifiedRevision: verifiedRevision! }
    : { verifiedAt, method };
}

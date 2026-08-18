#!/usr/bin/env node

// src/host/codex-cdp/fixture-companion-cli.ts
import { randomBytes as randomBytes3, randomUUID as randomUUID3, timingSafeEqual as timingSafeEqual2 } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync
} from "node:fs";
import {
  mkdir,
  open,
  readFile as readFile2,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  dirname,
  isAbsolute as isAbsolute2,
  join,
  resolve as resolve3
} from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";

// src/adapters/json-files.ts
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

// src/context-scope.ts
var KINDS = /* @__PURE__ */ new Set([
  "thread",
  "workspace",
  "project",
  "collection",
  "external"
]);
function isContextScopeKind(value) {
  return typeof value === "string" && KINDS.has(value);
}
function sameContextScope(left, right) {
  return left.kind === right.kind && left.namespace === right.namespace && left.id === right.id;
}
function contextScopeTuple(scope) {
  return [scope.kind, scope.namespace, scope.id];
}
function copyContextScope(scope) {
  return Object.freeze({
    kind: scope.kind,
    namespace: scope.namespace,
    id: scope.id
  });
}

// src/validation.ts
import { Buffer as Buffer2 } from "node:buffer";

// src/eligibility.ts
var ALLOWED_SURFACES = /* @__PURE__ */ new Set([
  "assistant_message",
  "user_message"
]);
var DEFAULT_MAX_SELECTION_CHARS = 512;
function evaluateEligibility(input, maxChars = DEFAULT_MAX_SELECTION_CHARS) {
  if (!ALLOWED_SURFACES.has(input.surface)) {
    return { kind: "ineligible", reason: "unsupported_surface" };
  }
  if (!Number.isSafeInteger(input.selectionGeneration) || input.selectionGeneration < 0) {
    return { kind: "ineligible", reason: "invalid_generation" };
  }
  const text = input.text.trim();
  if (text.length === 0) {
    return { kind: "ineligible", reason: "empty_selection" };
  }
  if (text.length > maxChars) {
    return { kind: "ineligible", reason: "selection_too_long" };
  }
  return {
    kind: "eligible",
    selection: {
      text,
      surface: input.surface,
      selectionGeneration: input.selectionGeneration
    }
  };
}

// src/normalize.ts
function normalizeText(value) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
function literalPattern(value) {
  return value.trim().split(/\s+/u).map(escapeRegExp).join("\\s+");
}
function findBoundedLiteral(haystack, needle) {
  if (needle.trim().length === 0) {
    return void 0;
  }
  const pattern = literalPattern(needle);
  const expression = new RegExp(
    `(?<![\\p{L}\\p{N}_-])${pattern}(?![\\p{L}\\p{N}_-])`,
    "iu"
  );
  return expression.exec(haystack)?.[0];
}
function findLiteralPhrase(haystack, needle) {
  if (needle.trim().length === 0) {
    return void 0;
  }
  const pattern = literalPattern(needle);
  const containsCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
    needle
  );
  const source = containsCjk ? pattern : `(?<![\\p{L}\\p{N}_-])${pattern}(?![\\p{L}\\p{N}_-])`;
  return new RegExp(source, "iu").exec(haystack)?.[0];
}

// src/validation.ts
var MAX_STRING_LENGTH = 4096;
var MAX_FACT_KEY_LENGTH = 128;
var MAX_FACT_STRING_LENGTH = 1024;
var MAX_FACT_ARRAY_LENGTH = 10;
var MAX_FACT_FIELDS = 50;
var MAX_FACT_TEXT_BUDGET_BYTES = 16384;
var MAX_RELATIONS = 100;
var MAX_SOURCES = 100;
var MAX_ALIAS_LENGTH = 512;
var MAX_RELATION_LENGTH = 512;
var MAX_SOURCE_TYPE_LENGTH = 128;
var MAX_SOURCE_ID_LENGTH = 512;
var MAX_REVISION_LENGTH = 512;
var MAX_IDENTITY_BUDGET_BYTES = 32768;
var MAX_SNAPSHOT_BUDGET_BYTES = 65536;
var CLOCK_SKEW_MS = 3e4;
var DANGEROUS_FACT_KEYS = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
var CONTEXT_INDEX_LIMITS = Object.freeze({
  records: 2048,
  aliases: 4096,
  utf8Bytes: 2 * 1024 * 1024,
  resolutionWorkUnits: 8 * 1024 * 1024
});
var ContractError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ContractError";
  }
};
var IdentityMismatchError = class extends ContractError {
  constructor(message) {
    super(message);
    this.name = "IdentityMismatchError";
  }
};
function objectValue(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractError(`${path} must be an object`);
  }
  return value;
}
function contextScopeValue(value, path) {
  const scope = objectValue(value, path);
  if (!isContextScopeKind(scope.kind)) {
    throw new ContractError(`${path}.kind is unsupported`);
  }
  return {
    kind: scope.kind,
    namespace: semanticStringValue(scope.namespace, `${path}.namespace`),
    id: semanticStringValue(scope.id, `${path}.id`)
  };
}
function legacyProjectScope(rawLegacyScopeId, expectedScope, path) {
  if (expectedScope.kind !== "project") {
    throw new ContractError(`${path} requires a project scope`);
  }
  const legacyScopeId = semanticStringValue(rawLegacyScopeId, path);
  if (legacyScopeId !== expectedScope.id) {
    throw new ContractError(`${path} does not match the trusted scope`);
  }
  return copyContextScope(expectedScope);
}
function stringValue(value, path, maximumLength = MAX_STRING_LENGTH) {
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
function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 55296 && codeUnit <= 56319) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 56320 || next > 57343) return true;
      index += 1;
    } else if (codeUnit >= 56320 && codeUnit <= 57343) {
      return true;
    }
  }
  return false;
}
function semanticStringValue(value, path, maximumLength = MAX_STRING_LENGTH) {
  const text = stringValue(value, path, maximumLength);
  if (text !== text.trim()) {
    throw new ContractError(`${path} must not contain surrounding whitespace`);
  }
  if (/[\p{Cc}\p{Bidi_Control}\p{Default_Ignorable_Code_Point}]/u.test(text)) {
    throw new ContractError(`${path} contains invisible or control characters`);
  }
  return text;
}
function booleanValue(value, path) {
  if (typeof value !== "boolean") {
    throw new ContractError(`${path} must be a boolean`);
  }
  return value;
}
function semanticStringArray(value, path, maximumValues = 100, maximumStringLength = MAX_STRING_LENGTH) {
  if (!Array.isArray(value)) {
    throw new ContractError(`${path} must be an array`);
  }
  if (value.length > maximumValues) {
    throw new ContractError(`${path} has too many values`);
  }
  return value.map(
    (item, index) => semanticStringValue(item, `${path}[${index}]`, maximumStringLength)
  );
}
function assertUtf8Budget(value, maximumBytes, path) {
  const bytes = Buffer2.byteLength(JSON.stringify(value), "utf8");
  if (bytes > maximumBytes) {
    throw new ContractError(`${path} exceeds the aggregate UTF-8 bound`);
  }
}
function isoDate(value, path) {
  const text = stringValue(value, path);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/u.exec(
    text
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
  const offsetHour = match[7] === void 0 ? 0 : Number(match[7]);
  const offsetMinute = match[8] === void 0 ? 0 : Number(match[8]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > (daysByMonth[month - 1] ?? 0) || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    throw new ContractError(`${path} must be a valid ISO 8601 timestamp`);
  }
  return text;
}
function indexedDate(value, path, now = Date.now()) {
  const text = isoDate(value, path);
  if (Date.parse(text) > now + CLOCK_SKEW_MS) {
    throw new ContractError(`${path} is in the future`);
  }
  return text;
}
function freshnessValue(value, path) {
  if (value !== "current" && value !== "stale" && value !== "partial") {
    throw new ContractError(`${path} is unsupported`);
  }
  return value;
}
function factScalar(value, path) {
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
function factValue(value, path) {
  if (Array.isArray(value)) {
    if (value.length > MAX_FACT_ARRAY_LENGTH) {
      throw new ContractError(`${path} has too many values`);
    }
    return value.map((item, index) => factScalar(item, `${path}[${index}]`));
  }
  return factScalar(value, path);
}
function factTextCost(key, value) {
  const scalars = Array.isArray(value) ? value : [value];
  return Buffer2.byteLength(key, "utf8") + scalars.reduce(
    (total, scalar) => total + Buffer2.byteLength(String(scalar ?? ""), "utf8"),
    0
  );
}
function parseFacts(raw, path) {
  const rawFacts = objectValue(raw, path);
  const entries = Object.entries(rawFacts);
  if (entries.length > MAX_FACT_FIELDS) {
    throw new ContractError(`${path} has too many fields`);
  }
  const facts = /* @__PURE__ */ Object.create(null);
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
function parseIdentityRecord(raw, expectedScope) {
  const value = objectValue(raw, "identity");
  const authority = objectValue(value.authority_ref, "identity.authority_ref");
  const schemaVersion = stringValue(value.schema_version, "identity.schema_version");
  if (schemaVersion !== "1.0") {
    throw new ContractError("identity.schema_version must be 1.0");
  }
  const record7 = {
    schemaVersion,
    scope: legacyProjectScope(
      value.project_id,
      expectedScope,
      "identity.project_id"
    ),
    entityId: semanticStringValue(value.entity_id, "identity.entity_id"),
    entityType: semanticStringValue(value.entity_type, "identity.entity_type"),
    canonicalName: semanticStringValue(value.canonical_name, "identity.canonical_name"),
    aliases: semanticStringArray(value.aliases ?? [], "identity.aliases", 100, MAX_ALIAS_LENGTH),
    summary: stringValue(value.summary, "identity.summary"),
    authorityRef: {
      provider: semanticStringValue(authority.provider, "identity.authority_ref.provider"),
      locator: semanticStringValue(authority.locator, "identity.authority_ref.locator")
    },
    indexRevision: semanticStringValue(value.index_revision, "identity.index_revision", MAX_REVISION_LENGTH),
    indexedAt: indexedDate(value.indexed_at, "identity.indexed_at"),
    deleted: booleanValue(value.deleted ?? false, "identity.deleted")
  };
  if (value.canonical_key !== void 0) {
    record7.canonicalKey = semanticStringValue(value.canonical_key, "identity.canonical_key");
  }
  assertUtf8Budget(record7, MAX_IDENTITY_BUDGET_BYTES, "identity");
  return record7;
}
function validateIdentityRecordForRuntime(raw) {
  const value = objectValue(raw, "identity");
  const authority = objectValue(value.authorityRef, "identity.authorityRef");
  const schemaVersion = stringValue(value.schemaVersion, "identity.schemaVersion");
  if (schemaVersion !== "1.0") {
    throw new ContractError("identity.schemaVersion must be 1.0");
  }
  const record7 = {
    schemaVersion,
    scope: contextScopeValue(value.scope, "identity.scope"),
    entityId: semanticStringValue(value.entityId, "identity.entityId"),
    entityType: semanticStringValue(value.entityType, "identity.entityType"),
    canonicalName: semanticStringValue(value.canonicalName, "identity.canonicalName"),
    aliases: semanticStringArray(value.aliases ?? [], "identity.aliases", 100, MAX_ALIAS_LENGTH),
    summary: stringValue(value.summary, "identity.summary"),
    authorityRef: {
      provider: semanticStringValue(authority.provider, "identity.authorityRef.provider"),
      locator: semanticStringValue(authority.locator, "identity.authorityRef.locator")
    },
    indexRevision: semanticStringValue(value.indexRevision, "identity.indexRevision", MAX_REVISION_LENGTH),
    indexedAt: indexedDate(value.indexedAt, "identity.indexedAt"),
    deleted: booleanValue(value.deleted, "identity.deleted")
  };
  if (value.canonicalKey !== void 0) {
    record7.canonicalKey = semanticStringValue(value.canonicalKey, "identity.canonicalKey");
  }
  assertUtf8Budget(record7, MAX_IDENTITY_BUDGET_BYTES, "identity");
  return record7;
}
function searchableIdentityTerms(record7) {
  const terms = [record7.entityId, record7.canonicalName, ...record7.aliases];
  if (record7.canonicalKey !== void 0) {
    terms.push(record7.canonicalKey);
  }
  return terms;
}
function addContextIndexBudget(state, record7, selection, normalizedSelection) {
  state.aliases += record7.aliases.length;
  if (state.aliases > CONTEXT_INDEX_LIMITS.aliases) {
    throw new ContractError("context index exceeds the aggregate alias bound");
  }
  state.utf8Bytes += Buffer2.byteLength(JSON.stringify(record7), "utf8") + 1;
  if (state.utf8Bytes > CONTEXT_INDEX_LIMITS.utf8Bytes) {
    throw new ContractError("context index exceeds the aggregate UTF-8 bound");
  }
  if (selection === void 0 || normalizedSelection === void 0) {
    return;
  }
  for (const term of searchableIdentityTerms(record7)) {
    const normalizedTerm = normalizeText(term);
    state.resolutionWorkUnits += selection.length + term.length + 1 + normalizedSelection.length + normalizedTerm.length + 1;
    if (state.resolutionWorkUnits > CONTEXT_INDEX_LIMITS.resolutionWorkUnits) {
      throw new ContractError(
        "context index exceeds the resolution work bound"
      );
    }
  }
}
function validateContextIndex(rawRecords, expectedScope, parser, selection) {
  if (!Array.isArray(rawRecords)) {
    throw new ContractError("context index records must be an array");
  }
  if (rawRecords.length > CONTEXT_INDEX_LIMITS.records) {
    throw new ContractError("context index exceeds the aggregate record bound");
  }
  if (selection !== void 0 && selection.length > DEFAULT_MAX_SELECTION_CHARS) {
    throw new ContractError("selection exceeds the resolver input bound");
  }
  const normalizedSelection = selection === void 0 ? void 0 : normalizeText(selection);
  const state = {
    aliases: 0,
    // Account for the enclosing JSON array even though records are measured
    // incrementally below.
    utf8Bytes: 2,
    resolutionWorkUnits: 0
  };
  const records = [];
  const entityIds = /* @__PURE__ */ new Set();
  const canonicalKeys = /* @__PURE__ */ new Set();
  for (let index = 0; index < rawRecords.length; index += 1) {
    const record7 = parser(rawRecords[index], expectedScope);
    if (!sameContextScope(record7.scope, expectedScope)) {
      throw new ContractError("context index contains a cross-scope record");
    }
    const entityId = normalizeText(record7.entityId);
    if (entityIds.has(entityId)) {
      throw new ContractError("context index contains a duplicate entity identity");
    }
    entityIds.add(entityId);
    if (record7.canonicalKey !== void 0) {
      const canonicalKey = normalizeText(record7.canonicalKey);
      if (canonicalKeys.has(canonicalKey)) {
        throw new ContractError("context index contains a duplicate canonical key");
      }
      canonicalKeys.add(canonicalKey);
    }
    addContextIndexBudget(state, record7, selection, normalizedSelection);
    records.push(record7);
  }
  return records;
}
function parseContextIndexRecords(rawRecords, expectedScope) {
  return validateContextIndex(rawRecords, expectedScope, parseIdentityRecord);
}
function validateContextIndexForRuntime(rawRecords, expectedScope, selection) {
  return validateContextIndex(
    rawRecords,
    expectedScope,
    (raw) => validateIdentityRecordForRuntime(raw),
    selection
  );
}
function assertContextIndexResolutionBudget(records, selection) {
  if (records.length > CONTEXT_INDEX_LIMITS.records) {
    throw new ContractError("context index exceeds the aggregate record bound");
  }
  if (selection.length > DEFAULT_MAX_SELECTION_CHARS) {
    throw new ContractError("selection exceeds the resolver input bound");
  }
  const state = {
    aliases: 0,
    utf8Bytes: 2,
    resolutionWorkUnits: 0
  };
  const normalizedSelection = normalizeText(selection);
  for (const record7 of records) {
    if (!Array.isArray(record7.aliases)) {
      throw new ContractError("context index aliases must be an array");
    }
    addContextIndexBudget(state, record7, selection, normalizedSelection);
  }
}
function parseSourceRef(raw, index, style) {
  const path = style === "wire" ? `detail.source_refs[${index}]` : `detail.sourceRefs[${index}]`;
  const value = objectValue(raw, path);
  return {
    sourceType: semanticStringValue(
      style === "wire" ? value.source_type : value.sourceType,
      `${path}.${style === "wire" ? "source_type" : "sourceType"}`,
      MAX_SOURCE_TYPE_LENGTH
    ),
    sourceId: semanticStringValue(
      style === "wire" ? value.source_id : value.sourceId,
      `${path}.${style === "wire" ? "source_id" : "sourceId"}`,
      MAX_SOURCE_ID_LENGTH
    )
  };
}
function parseSnapshot(raw, style, expectedScope) {
  const value = objectValue(raw, "detail");
  const field = (wire, runtime) => style === "wire" ? value[wire] : value[runtime];
  const sourceField = style === "wire" ? "source_refs" : "sourceRefs";
  const sourceRefs = field("source_refs", "sourceRefs");
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
    throw new ContractError(`detail.${sourceField} must contain at least one source`);
  }
  if (sourceRefs.length > MAX_SOURCES) {
    throw new ContractError(`detail.${sourceField} has too many sources`);
  }
  if (style === "wire" && expectedScope === void 0) {
    throw new ContractError("wire detail requires a trusted scope");
  }
  const scope = style === "wire" ? legacyProjectScope(
    field("project_id", "scope"),
    expectedScope,
    "detail.project_id"
  ) : contextScopeValue(field("project_id", "scope"), "detail.scope");
  const snapshot = {
    scope,
    entityId: semanticStringValue(field("entity_id", "entityId"), `detail.${style === "wire" ? "entity_id" : "entityId"}`),
    entityType: semanticStringValue(field("entity_type", "entityType"), `detail.${style === "wire" ? "entity_type" : "entityType"}`),
    entityRevision: semanticStringValue(
      field("entity_revision", "entityRevision"),
      `detail.${style === "wire" ? "entity_revision" : "entityRevision"}`,
      MAX_REVISION_LENGTH
    ),
    observedAt: isoDate(
      field("observed_at", "observedAt"),
      `detail.${style === "wire" ? "observed_at" : "observedAt"}`
    ),
    freshness: freshnessValue(value.freshness, "detail.freshness"),
    facts: parseFacts(value.facts, "detail.facts"),
    relations: semanticStringArray(
      value.relations ?? [],
      "detail.relations",
      MAX_RELATIONS,
      MAX_RELATION_LENGTH
    ),
    sourceRefs: sourceRefs.map((source, index) => parseSourceRef(source, index, style))
  };
  assertUtf8Budget(snapshot, MAX_SNAPSHOT_BUDGET_BYTES, "detail");
  return snapshot;
}
function parseDetailSnapshot(raw, expectedScope) {
  return parseSnapshot(raw, "wire", expectedScope);
}
function validateSnapshotForCandidate(rawSnapshot, expected, now = Date.now()) {
  const snapshot = parseSnapshot(rawSnapshot, "runtime");
  if (!sameContextScope(snapshot.scope, expected.scope) || snapshot.entityId !== expected.entityId || snapshot.entityType !== expected.entityType) {
    throw new IdentityMismatchError(
      "authority identity does not match the selected candidate"
    );
  }
  const observedAt = Date.parse(snapshot.observedAt);
  if (observedAt > now + CLOCK_SKEW_MS) {
    throw new ContractError("authority snapshot observedAt is in the future");
  }
  return snapshot;
}
function validateAuthorityVerification(rawVerification, snapshot, requestStartedAt, now = Date.now()) {
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
  if (verifiedAtMs < requestStartedAt - CLOCK_SKEW_MS || verifiedAtMs > now + CLOCK_SKEW_MS) {
    throw new ContractError("authority verification is outside the request window");
  }
  if (Date.parse(snapshot.observedAt) > verifiedAtMs + CLOCK_SKEW_MS) {
    throw new ContractError("authority snapshot was observed after verification");
  }
  let verifiedRevision;
  if (method === "revision_check") {
    verifiedRevision = semanticStringValue(
      value.verifiedRevision,
      "authority.verification.verifiedRevision",
      MAX_REVISION_LENGTH
    );
    if (verifiedRevision !== snapshot.entityRevision) {
      throw new ContractError("authority verified revision does not match the snapshot");
    }
  }
  if (snapshot.freshness === "current") {
    if (method === "fixture_read") {
      throw new ContractError(
        "fixture reads cannot establish current freshness"
      );
    }
    if (now - requestStartedAt > CLOCK_SKEW_MS) {
      throw new ContractError("authority request took too long to establish current freshness");
    }
    if (verifiedAtMs < now - CLOCK_SKEW_MS) {
      throw new ContractError("current authority evidence is not recent enough");
    }
    if (method === "live_read" && Date.parse(snapshot.observedAt) < Math.max(requestStartedAt, now) - CLOCK_SKEW_MS) {
      throw new ContractError("current live-read snapshot is not recent enough");
    }
  }
  return method === "revision_check" ? { verifiedAt, method, verifiedRevision } : { verifiedAt, method };
}

// src/adapters/json-files.ts
var FIXTURE_PROJECT_NAMESPACE = "fixture-json-v1";
function fixtureProjectScope(projectId) {
  return {
    kind: "project",
    namespace: FIXTURE_PROJECT_NAMESPACE,
    id: projectId
  };
}
function fixtureProjectId(scope) {
  if (scope.kind !== "project" || scope.namespace !== FIXTURE_PROJECT_NAMESPACE) {
    throw new ContractError("fixture JSON requires its bound project scope");
  }
  return scope.id;
}
function asObject(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractError(`${path} must be an object`);
  }
  return value;
}
function asString(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ContractError(`${path} must be a non-empty string`);
  }
  return value;
}
var MAX_JSON_BYTES = 5 * 1024 * 1024;
async function loadJson(path) {
  const file = await stat(path);
  if (!file.isFile()) {
    throw new ContractError("JSON input must be a regular file");
  }
  if (file.size > MAX_JSON_BYTES) {
    throw new ContractError(`JSON input exceeds ${MAX_JSON_BYTES} bytes`);
  }
  const text = await readFile(path, "utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new ContractError("JSON input is malformed");
  }
}
async function loadProjectManifest(path) {
  const raw = asObject(await loadJson(path), "project_context");
  const schemaVersion = asString(raw.schema_version, "project_context.schema_version");
  if (schemaVersion !== "1.0") {
    throw new ContractError("project_context.schema_version must be 1.0");
  }
  return {
    schemaVersion,
    projectId: asString(raw.project_id, "project_context.project_id"),
    bindingRevision: asString(
      raw.binding_revision,
      "project_context.binding_revision"
    )
  };
}
function normalizedPath(path) {
  return process.platform === "win32" ? path.toLocaleLowerCase("en-US") : path;
}
function pathsEqual(left, right) {
  return normalizedPath(left) === normalizedPath(right);
}
function isDescendant(root, target) {
  const child = relative(root, target);
  return child.length > 0 && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}
async function canonicalDataPath(path, binding) {
  if (!binding.workspaceRoot) {
    throw new ContractError("fixture data requires a canonical workspace root");
  }
  const [canonicalRoot, canonicalFile] = await Promise.all([
    realpath(binding.workspaceRoot),
    realpath(path)
  ]);
  if (!isDescendant(canonicalRoot, canonicalFile)) {
    throw new ContractError("fixture data must remain inside the bound workspace root");
  }
  return canonicalFile;
}
var FixtureFileProjectBinding = class {
  manifestPath;
  workspaceRoot;
  constructor(manifestPath, workspaceRoot) {
    this.manifestPath = resolve(manifestPath);
    this.workspaceRoot = resolve(workspaceRoot);
  }
  async readState() {
    const [canonicalRoot, canonicalManifest] = await Promise.all([
      realpath(this.workspaceRoot),
      realpath(this.manifestPath)
    ]);
    const rootInfo = await stat(canonicalRoot);
    if (!rootInfo.isDirectory()) {
      throw new ContractError("fixture workspace root must be a directory");
    }
    if (!isDescendant(canonicalRoot, canonicalManifest)) {
      throw new ContractError(
        "fixture project manifest must be contained by the canonical workspace root"
      );
    }
    return {
      canonicalRoot,
      manifest: await loadProjectManifest(canonicalManifest)
    };
  }
  async resolve(context) {
    if (!context.explicitScope || !context.workspaceRoot) {
      return { kind: "missing" };
    }
    const state = await this.readState();
    const contextRoot = await realpath(context.workspaceRoot);
    if (!pathsEqual(contextRoot, state.canonicalRoot)) {
      return { kind: "context_changed" };
    }
    const manifestScope = fixtureProjectScope(state.manifest.projectId);
    if (!sameContextScope(context.explicitScope, manifestScope)) {
      return {
        kind: "ambiguous",
        scopes: [copyContextScope(manifestScope), copyContextScope(context.explicitScope)]
      };
    }
    return {
      kind: "trusted",
      scope: manifestScope,
      bindingRevision: state.manifest.bindingRevision,
      evidence: "fixture_manifest",
      selectionGeneration: context.selectionGeneration,
      workspaceRoot: state.canonicalRoot
    };
  }
  async revalidate(binding) {
    if (!binding.workspaceRoot) {
      return { kind: "context_changed" };
    }
    const state = await this.readState();
    const boundRoot = await realpath(binding.workspaceRoot);
    const manifestScope = fixtureProjectScope(state.manifest.projectId);
    if (!pathsEqual(boundRoot, state.canonicalRoot) || !sameContextScope(binding.scope, manifestScope) || binding.bindingRevision !== state.manifest.bindingRevision) {
      return { kind: "context_changed" };
    }
    return {
      kind: "trusted",
      scope: manifestScope,
      bindingRevision: state.manifest.bindingRevision,
      evidence: "fixture_manifest",
      selectionGeneration: binding.selectionGeneration,
      workspaceRoot: state.canonicalRoot
    };
  }
};
var JsonContextIndex = class {
  constructor(path) {
    this.path = path;
  }
  path;
  async list(binding) {
    const dataPath = await canonicalDataPath(this.path, binding);
    const raw = asObject(await loadJson(dataPath), "index");
    if (asString(raw.schema_version, "index.schema_version") !== "1.0") {
      throw new ContractError("index.schema_version must be 1.0");
    }
    const projectId = asString(raw.project_id, "index.project_id");
    if (projectId !== fixtureProjectId(binding.scope)) {
      throw new ContractError("index project does not match the trusted binding");
    }
    if (!Array.isArray(raw.records)) {
      throw new ContractError("index.records must be an array");
    }
    return parseContextIndexRecords(raw.records, binding.scope);
  }
};
var JsonAuthoritativeProvider = class {
  constructor(path, providerId = "json-fixture") {
    this.path = path;
    this.providerId = providerId;
  }
  path;
  providerId;
  async getDetail(request) {
    if (request.signal?.aborted) {
      return { kind: "unavailable", retryable: true };
    }
    if (request.revisionPolicy !== "current-or-explicit-stale") {
      throw new ContractError("unsupported authority revision policy");
    }
    const dataPath = await canonicalDataPath(this.path, request.binding);
    const raw = asObject(await loadJson(dataPath), "details");
    const providerId = asString(raw.provider_id, "details.provider_id");
    if (providerId !== this.providerId) {
      throw new ContractError("details provider_id does not match provider registration");
    }
    if (!Array.isArray(raw.snapshots)) {
      throw new ContractError("details.snapshots must be an array");
    }
    if (raw.snapshots.length > 1e4) {
      throw new ContractError("details.snapshots exceeds the P0 bound");
    }
    const snapshots = raw.snapshots.map((item, index) => {
      const value = asObject(item, `details.snapshots[${index}]`);
      const wireSnapshot = asObject(
        value.snapshot,
        `details.snapshots[${index}].snapshot`
      );
      const snapshotScope = fixtureProjectScope(
        asString(
          wireSnapshot.project_id,
          `details.snapshots[${index}].snapshot.project_id`
        )
      );
      return {
        locator: asString(
          value.authority_locator,
          `details.snapshots[${index}].authority_locator`
        ),
        snapshot: parseDetailSnapshot(value.snapshot, snapshotScope)
      };
    });
    if (request.signal?.aborted) {
      return { kind: "unavailable", retryable: true };
    }
    const matches = snapshots.filter(
      (item) => item.locator === request.authorityLocator && sameContextScope(item.snapshot.scope, request.binding.scope) && item.snapshot.entityId === request.entityId && item.snapshot.entityType === request.entityType
    );
    if (matches.length === 0) {
      return { kind: "not_found" };
    }
    if (matches.length > 1) {
      throw new ContractError("authority tuple is not unique in fixture data");
    }
    const stored = matches[0];
    if (!stored) {
      throw new ContractError("authority tuple resolution failed");
    }
    if (stored.snapshot.freshness === "current") {
      throw new ContractError(
        "fixture JSON cannot claim current freshness without live verification"
      );
    }
    return {
      kind: "snapshot",
      snapshot: stored.snapshot,
      verification: {
        verifiedAt: (/* @__PURE__ */ new Date()).toISOString(),
        method: "fixture_read"
      }
    };
  }
};

// src/host/codex-cdp/adapter.ts
import { randomUUID } from "node:crypto";

// src/host/codex-cdp/protocol.ts
import { createHash } from "node:crypto";
var POINTABLE_PROTOCOL_VERSION = 1;
var MAX_SELECTION_CHARS = 512;
var MAX_BINDING_PAYLOAD_CHARS = 4096;
var PointableProtocolError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "PointableProtocolError";
  }
  code;
};
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value, allowed) {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}
function boundedString(value, minimum, maximum) {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum && !/[\p{Cc}\p{Cf}]/u.test(value);
}
function requiredString(value, field, maximum) {
  if (!boundedString(value, 1, maximum)) {
    throw new PointableProtocolError(
      "invalid_lookup_result",
      `${field} must be a bounded printable string`
    );
  }
  return value;
}
function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function parsePointableLookupIntent(payload) {
  if (payload.length === 0 || payload.length > MAX_BINDING_PAYLOAD_CHARS) {
    throw new PointableProtocolError(
      "binding_payload_invalid",
      "binding payload is empty or exceeds its size limit"
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new PointableProtocolError(
      "binding_payload_invalid",
      "binding payload is not valid JSON"
    );
  }
  if (!record(parsed)) {
    throw new PointableProtocolError(
      "binding_payload_invalid",
      "binding payload must be an object"
    );
  }
  if (!exactKeys(parsed, [
    "schemaVersion",
    "kind",
    "operation",
    "requestId",
    "selectionGeneration",
    "selectionText",
    "selectionDigest",
    "surface",
    "contextFingerprint",
    "requestedAt",
    "candidateRef",
    "detailRef"
  ])) {
    throw new PointableProtocolError(
      "binding_payload_invalid",
      "binding payload contains unsupported fields"
    );
  }
  if (parsed.schemaVersion !== POINTABLE_PROTOCOL_VERSION || parsed.kind !== "pointable.selection.lookup" || parsed.operation !== "resolve" && parsed.operation !== "choose" && parsed.operation !== "check" && parsed.operation !== "refresh" || !boundedString(parsed.requestId, 8, 128) || !/^[A-Za-z0-9:_-]+$/u.test(parsed.requestId) || !Number.isSafeInteger(parsed.selectionGeneration) || Number(parsed.selectionGeneration) < 1 || !boundedString(parsed.selectionText, 1, MAX_SELECTION_CHARS) || parsed.selectionText !== parsed.selectionText.trim() || !boundedString(parsed.selectionDigest, 64, 64) || !/^[0-9a-f]{64}$/u.test(parsed.selectionDigest) || parsed.surface !== "assistant_message" && parsed.surface !== "user_message" || !boundedString(parsed.contextFingerprint, 1, 2048) || !boundedString(parsed.requestedAt, 20, 64) || !Number.isFinite(Date.parse(parsed.requestedAt))) {
    throw new PointableProtocolError(
      "binding_payload_invalid",
      "binding payload fields are invalid"
    );
  }
  if (sha256(parsed.selectionText) !== parsed.selectionDigest) {
    throw new PointableProtocolError(
      "selection_digest_mismatch",
      "selection digest does not match the submitted text"
    );
  }
  const candidateRef = parsed.candidateRef;
  const detailRef = parsed.detailRef;
  if (parsed.operation === "resolve" && (candidateRef !== void 0 || detailRef !== void 0) || parsed.operation === "choose" && (!boundedString(candidateRef, 8, 256) || detailRef !== void 0) || (parsed.operation === "check" || parsed.operation === "refresh") && (candidateRef !== void 0 || !boundedString(detailRef, 8, 256))) {
    throw new PointableProtocolError(
      "binding_payload_invalid",
      "candidateRef is inconsistent with the requested operation"
    );
  }
  const intent = {
    schemaVersion: POINTABLE_PROTOCOL_VERSION,
    kind: "pointable.selection.lookup",
    operation: parsed.operation,
    requestId: parsed.requestId,
    selectionGeneration: Number(parsed.selectionGeneration),
    selectionText: parsed.selectionText,
    selectionDigest: parsed.selectionDigest,
    surface: parsed.surface,
    contextFingerprint: parsed.contextFingerprint,
    requestedAt: parsed.requestedAt
  };
  if (typeof candidateRef === "string") intent.candidateRef = candidateRef;
  if (typeof detailRef === "string") intent.detailRef = detailRef;
  return intent;
}
function validateCandidate(value) {
  if (!record(value) || !exactKeys(value, [
    "candidateRef",
    "label",
    "entityType",
    "summary"
  ])) {
    throw new PointableProtocolError(
      "invalid_lookup_result",
      "candidate result is invalid"
    );
  }
  return {
    candidateRef: (() => {
      if (!boundedString(value.candidateRef, 8, 256)) {
        throw new PointableProtocolError(
          "invalid_lookup_result",
          "candidateRef must be a bounded printable string"
        );
      }
      return value.candidateRef;
    })(),
    label: requiredString(value.label, "candidate label", 256),
    entityType: requiredString(value.entityType, "candidate entityType", 128),
    summary: requiredString(value.summary, "candidate summary", 1024)
  };
}
function validateDetail(value) {
  if (!record(value) || !exactKeys(value, [
    "entityId",
    "entityType",
    "label",
    "summary",
    "revision",
    "observedAt",
    "freshness",
    "facts",
    "sources",
    "detailRef",
    "changes"
  ])) {
    throw new PointableProtocolError(
      "invalid_lookup_result",
      "detail result is invalid"
    );
  }
  if (value.freshness !== "current" && value.freshness !== "stale" && value.freshness !== "partial" && value.freshness !== "unknown") {
    throw new PointableProtocolError(
      "invalid_lookup_result",
      "detail freshness is invalid"
    );
  }
  if (!boundedString(value.observedAt, 20, 64) || !Number.isFinite(Date.parse(value.observedAt)) || !Array.isArray(value.facts) || value.facts.length > 5 || !Array.isArray(value.sources) || value.sources.length > 5 || value.detailRef !== void 0 && !boundedString(value.detailRef, 8, 256) || value.changes !== void 0 && (!Array.isArray(value.changes) || value.changes.length > 3)) {
    throw new PointableProtocolError(
      "invalid_lookup_result",
      "detail metadata exceeds its contract"
    );
  }
  const facts = value.facts.map((fact) => {
    if (!record(fact) || !exactKeys(fact, ["label", "value"])) {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "detail fact is invalid"
      );
    }
    return {
      label: requiredString(fact.label, "fact label", 128),
      value: requiredString(fact.value, "fact value", 1024)
    };
  });
  const sources = value.sources.map((source) => {
    if (!record(source) || !exactKeys(source, ["label"])) {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "detail source is invalid"
      );
    }
    return { label: requiredString(source.label, "source label", 512) };
  });
  const changes = value.changes === void 0 ? void 0 : value.changes.map((change) => {
    if (!record(change) || !exactKeys(change, ["label", "before", "after"])) {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "detail change is invalid"
      );
    }
    return {
      label: requiredString(change.label, "change label", 128),
      before: requiredString(change.before, "change before", 1024),
      after: requiredString(change.after, "change after", 1024)
    };
  });
  return {
    entityId: requiredString(value.entityId, "entityId", 256),
    entityType: requiredString(value.entityType, "entityType", 128),
    label: requiredString(value.label, "detail label", 256),
    summary: requiredString(value.summary, "detail summary", 1024),
    revision: requiredString(value.revision, "detail revision", 512),
    observedAt: value.observedAt,
    freshness: value.freshness,
    facts,
    sources,
    ...typeof value.detailRef === "string" ? { detailRef: value.detailRef } : {},
    ...changes === void 0 ? {} : { changes }
  };
}
function validatePointableLookupPresentation(value) {
  if (!record(value) || typeof value.kind !== "string") {
    throw new PointableProtocolError(
      "invalid_lookup_result",
      "lookup callback returned an invalid presentation"
    );
  }
  if (value.kind === "candidates") {
    if (!exactKeys(value, ["kind", "candidates"]) || !Array.isArray(value.candidates) || value.candidates.length < 1 || value.candidates.length > 3) {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "candidate result must contain one to three candidates"
      );
    }
    const candidates2 = value.candidates.map(validateCandidate);
    if (new Set(candidates2.map((candidate) => candidate.candidateRef)).size !== candidates2.length) {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "candidate references must be unique"
      );
    }
    return { kind: "candidates", candidates: candidates2 };
  }
  if (value.kind === "detail") {
    if (!exactKeys(value, ["kind", "detail"])) {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "detail result contains unsupported fields"
      );
    }
    return { kind: "detail", detail: validateDetail(value.detail) };
  }
  if (value.kind === "revision") {
    if (!exactKeys(value, ["kind", "revision"]) || !record(value.revision) || !exactKeys(value.revision, ["detailRef", "state", "checkedAt"]) || !boundedString(value.revision.detailRef, 8, 256) || value.revision.state !== "unchanged" && value.revision.state !== "updated" && value.revision.state !== "deleted" && value.revision.state !== "unavailable" || !boundedString(value.revision.checkedAt, 20, 64) || !Number.isFinite(Date.parse(value.revision.checkedAt))) {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "revision result is invalid"
      );
    }
    return {
      kind: "revision",
      revision: {
        detailRef: value.revision.detailRef,
        state: value.revision.state,
        checkedAt: value.revision.checkedAt
      }
    };
  }
  if (value.kind === "error") {
    if (!exactKeys(value, ["kind", "code", "message", "retryable"]) || !boundedString(value.code, 1, 128) || !/^[a-z0-9_:-]+$/u.test(value.code) || !boundedString(value.message, 1, 1024) || typeof value.retryable !== "boolean") {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "error result is invalid"
      );
    }
    return {
      kind: "error",
      code: value.code,
      message: value.message,
      retryable: value.retryable
    };
  }
  throw new PointableProtocolError(
    "invalid_lookup_result",
    "lookup callback returned an unsupported presentation kind"
  );
}
function createPointableLookupResponse(intent, presentation) {
  return {
    schemaVersion: POINTABLE_PROTOCOL_VERSION,
    kind: "pointable.selection.result",
    requestId: intent.requestId,
    selectionGeneration: intent.selectionGeneration,
    selectionDigest: intent.selectionDigest,
    contextFingerprint: intent.contextFingerprint,
    presentation
  };
}

// src/host/codex-cdp/renderer.ts
function evaluatePointableRendererEligibility(observation) {
  if (observation.rangeCount !== 1) {
    return { kind: "ineligible", reason: "not_single_range" };
  }
  if (observation.collapsed) {
    return { kind: "ineligible", reason: "collapsed" };
  }
  if (!observation.sameSurface || observation.surface !== "assistant_message" && observation.surface !== "user_message") {
    return { kind: "ineligible", reason: "unsupported_surface" };
  }
  const text = observation.text.trim();
  if (text.length === 0) return { kind: "ineligible", reason: "empty" };
  if (text.length > 512) return { kind: "ineligible", reason: "too_long" };
  if (!observation.connected) return { kind: "ineligible", reason: "detached" };
  if (!observation.visible || observation.rectWidth <= 0 || observation.rectHeight <= 0) {
    return { kind: "ineligible", reason: "not_visible" };
  }
  return { kind: "eligible", text, surface: observation.surface };
}
function validatePointableRendererResponse(value) {
  const isRecord = (candidate) => typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);
  const bounded = (candidate, minimum, maximum) => typeof candidate === "string" && candidate.length >= minimum && candidate.length <= maximum && !/[\p{Cc}\p{Cf}]/u.test(candidate);
  const exact = (candidate, keys) => {
    const allowed = new Set(keys);
    return Object.keys(candidate).every((key) => allowed.has(key));
  };
  const candidateView2 = (candidate) => isRecord(candidate) && exact(candidate, ["candidateRef", "label", "entityType", "summary"]) && bounded(candidate.candidateRef, 8, 256) && bounded(candidate.label, 1, 256) && bounded(candidate.entityType, 1, 128) && bounded(candidate.summary, 1, 1024);
  const factView = (candidate) => isRecord(candidate) && exact(candidate, ["label", "value"]) && bounded(candidate.label, 1, 128) && bounded(candidate.value, 1, 1024);
  const sourceView = (candidate) => isRecord(candidate) && exact(candidate, ["label"]) && bounded(candidate.label, 1, 512);
  const changeView = (candidate) => isRecord(candidate) && exact(candidate, ["label", "before", "after"]) && bounded(candidate.label, 1, 128) && bounded(candidate.before, 1, 1024) && bounded(candidate.after, 1, 1024);
  if (!isRecord(value) || !exact(value, [
    "schemaVersion",
    "kind",
    "requestId",
    "selectionGeneration",
    "selectionDigest",
    "contextFingerprint",
    "presentation"
  ]) || value.schemaVersion !== 1 || value.kind !== "pointable.selection.result" || !bounded(value.requestId, 8, 128) || !Number.isSafeInteger(value.selectionGeneration) || Number(value.selectionGeneration) < 1 || !bounded(value.selectionDigest, 64, 64) || !/^[0-9a-f]{64}$/u.test(value.selectionDigest) || !bounded(value.contextFingerprint, 1, 2048) || !isRecord(value.presentation)) {
    return void 0;
  }
  const presentation = value.presentation;
  if (presentation.kind === "candidates") {
    if (!exact(presentation, ["kind", "candidates"]) || !Array.isArray(presentation.candidates) || presentation.candidates.length < 1 || presentation.candidates.length > 3 || !presentation.candidates.every(candidateView2) || new Set(presentation.candidates.map((candidate) => candidate.candidateRef)).size !== presentation.candidates.length) {
      return void 0;
    }
  } else if (presentation.kind === "detail") {
    const detail = presentation.detail;
    if (!exact(presentation, ["kind", "detail"]) || !isRecord(detail) || !exact(detail, [
      "entityId",
      "entityType",
      "label",
      "summary",
      "revision",
      "observedAt",
      "freshness",
      "facts",
      "sources",
      "detailRef",
      "changes"
    ]) || !bounded(detail.entityId, 1, 256) || !bounded(detail.entityType, 1, 128) || !bounded(detail.label, 1, 256) || !bounded(detail.summary, 1, 1024) || !bounded(detail.revision, 1, 512) || !bounded(detail.observedAt, 20, 64) || !Number.isFinite(Date.parse(detail.observedAt)) || detail.freshness !== "current" && detail.freshness !== "stale" && detail.freshness !== "partial" && detail.freshness !== "unknown" || !Array.isArray(detail.facts) || detail.facts.length > 5 || !detail.facts.every(factView) || !Array.isArray(detail.sources) || detail.sources.length > 5 || !detail.sources.every(sourceView) || detail.detailRef !== void 0 && !bounded(detail.detailRef, 8, 256) || detail.changes !== void 0 && (!Array.isArray(detail.changes) || detail.changes.length > 3 || !detail.changes.every(changeView))) {
      return void 0;
    }
  } else if (presentation.kind === "revision") {
    const revision = presentation.revision;
    if (!exact(presentation, ["kind", "revision"]) || !isRecord(revision) || !exact(revision, ["detailRef", "state", "checkedAt"]) || !bounded(revision.detailRef, 8, 256) || revision.state !== "unchanged" && revision.state !== "updated" && revision.state !== "deleted" && revision.state !== "unavailable" || !bounded(revision.checkedAt, 20, 64) || !Number.isFinite(Date.parse(revision.checkedAt))) {
      return void 0;
    }
  } else if (presentation.kind === "error") {
    if (!exact(presentation, ["kind", "code", "message", "retryable"]) || !bounded(presentation.code, 1, 128) || !/^[a-z0-9_:-]+$/u.test(presentation.code) || !bounded(presentation.message, 1, 1024) || typeof presentation.retryable !== "boolean") {
      return void 0;
    }
  } else {
    return void 0;
  }
  return value;
}
function installPointableContextRenderer(config, evaluateEligibility2, validateResponse) {
  const namespace = "__pointableContextRenderer";
  const bindingNamePattern = /^__pointableContextBinding_[A-Za-z0-9_]{8,128}$/u;
  if (!bindingNamePattern.test(config.bindingName)) {
    throw new Error("pointable_renderer_binding_name_invalid");
  }
  const requestTimeoutMs = config.requestTimeoutMs ?? 5e3;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 100 || requestTimeoutMs > 3e4) {
    throw new Error("pointable_renderer_timeout_invalid");
  }
  const revisionCheckIntervalMs = config.revisionCheckIntervalMs ?? 5e3;
  if (!Number.isSafeInteger(revisionCheckIntervalMs) || revisionCheckIntervalMs < 100 || revisionCheckIntervalMs > 6e4) {
    throw new Error("pointable_renderer_revision_interval_invalid");
  }
  const actionLabel = typeof config.actionLabel === "string" && config.actionLabel.trim().length > 0 && config.actionLabel.length <= 64 ? config.actionLabel.trim() : "\u67E5\u770B\u4E0A\u4E0B\u6587";
  const existing = window[namespace];
  if (typeof existing === "object" && existing !== null && "status" in existing && typeof existing.status === "function") {
    const existingApi = existing;
    const existingStatus = existingApi.status();
    if (existingStatus.installed !== true || !bindingNamePattern.test(existingStatus.bindingName) || !/^[A-Za-z0-9:_-]{8,256}$/u.test(existingStatus.lifecycleId)) {
      throw new Error("pointable_renderer_namespace_occupied");
    }
    if (existingStatus.bindingName === config.bindingName) return existingStatus;
    if (typeof existingApi.uninstall !== "function") {
      throw new Error("pointable_renderer_namespace_occupied");
    }
    existingApi.uninstall();
    if (window[namespace] !== void 0) {
      throw new Error("pointable_renderer_stale_uninstall_failed");
    }
  }
  if (window[namespace] !== void 0) {
    throw new Error("pointable_renderer_namespace_occupied");
  }
  const lifecycleId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `pointable-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const actionIdBase = `pointable-context-selection-action-${lifecycleId}`;
  const cardIdBase = `pointable-context-quick-look-${lifecycleId}`;
  const stableRootCandidate = document.querySelector(
    "main[data-app-shell-main-surface]"
  );
  if (stableRootCandidate === null) {
    throw new Error("pointable_renderer_surface_missing");
  }
  const stableRoot = stableRootCandidate;
  const binding = window[config.bindingName];
  if (typeof binding !== "function") throw new Error("pointable_renderer_binding_missing");
  let state = "idle";
  let generation = 0;
  let candidate;
  let pending;
  let repositionFrame;
  let reconcileFrame;
  let outsideHandler;
  let restoreFocus;
  let actionElement;
  let cardElement;
  let revisionTimer;
  let uninstalled = false;
  const activeObserver = new MutationObserver(() => {
    if (candidate !== void 0) scheduleReconcile();
  });
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => reposition()) : void 0;
  const pointerUpHandler = (event) => {
    const ownedInteraction = event.composedPath().some((item) => item instanceof Element && item.getAttribute("data-pointable-context-owned") === lifecycleId);
    if (event.button === 0 && !ownedInteraction) {
      window.setTimeout(evaluateSelection, 0);
    }
  };
  const keyUpHandler = (event) => {
    if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
      window.setTimeout(evaluateSelection, 0);
    }
  };
  const keyDownHandler = (event) => {
    if (event.key === "Escape" && (candidate !== void 0 || ownedUiExists())) {
      event.preventDefault();
      cleanup(true, true);
      return;
    }
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === "k") {
      const action = connectedOwnedElement("action");
      if (action instanceof HTMLButtonElement) {
        event.preventDefault();
        if (event.isTrusted && candidate !== void 0) {
          void submitLookup("resolve", candidate.generation);
        }
      }
    }
  };
  const viewportHandler = () => reposition();
  const routeHandler = () => {
    reconcile();
  };
  const selectionHandler = () => {
    window.setTimeout(evaluateSelection, 0);
  };
  document.addEventListener("selectionchange", selectionHandler);
  document.addEventListener("pointerup", pointerUpHandler, true);
  document.addEventListener("keyup", keyUpHandler, true);
  document.addEventListener("keydown", keyDownHandler, true);
  window.addEventListener("scroll", viewportHandler, true);
  window.addEventListener("resize", viewportHandler);
  window.addEventListener("popstate", routeHandler);
  window.addEventListener("hashchange", routeHandler);
  window.visualViewport?.addEventListener("resize", viewportHandler);
  window.visualViewport?.addEventListener("scroll", viewportHandler);
  function ownedUiExists() {
    return connectedOwnedElement("action") !== null || connectedOwnedElement("card") !== null;
  }
  function ownedElement(role) {
    const element = role === "action" ? actionElement : cardElement;
    return element instanceof HTMLElement && element.getAttribute("data-pointable-context-owned") === lifecycleId ? element : null;
  }
  function connectedOwnedElement(role) {
    const element = ownedElement(role);
    return element?.isConnected === true ? element : null;
  }
  function removeOwned(role) {
    ownedElement(role)?.remove();
    if (role === "action") actionElement = void 0;
    else cardElement = void 0;
  }
  function availableOwnedId(base) {
    if (document.getElementById(base) === null) return base;
    for (let suffix = 1; suffix <= 32; suffix += 1) {
      const candidateId = `${base}-${suffix}`;
      if (document.getElementById(candidateId) === null) return candidateId;
    }
    throw new Error("pointable_renderer_id_capacity");
  }
  function readContextFingerprint() {
    const activeThread = document.querySelector(
      '[data-app-action-sidebar-thread-active="true"]'
    );
    return JSON.stringify({
      href: window.location.href,
      threadId: activeThread?.getAttribute("data-app-action-sidebar-thread-id") ?? null,
      hostId: activeThread?.getAttribute("data-app-action-sidebar-thread-host-id") ?? null
    });
  }
  function nodeElement(node) {
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  }
  const rejectedSelector = '[data-pointable-context-owned], nav, header, form, textarea, input, iframe, [contenteditable="true"], [data-testid="subagent-activity-inline-group"], [data-testid*="terminal" i], [data-testid*="diff" i], [data-testid*="browser" i], [class*="terminal" i], [class*="diff" i]';
  function rejectedSurface(element) {
    return element.closest(rejectedSelector) !== null;
  }
  function rangeCrossesRejectedSurface(range) {
    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_ELEMENT
    );
    let visited = 0;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      visited += 1;
      if (visited > 2048) return true;
      const element = node;
      try {
        if (element.matches(rejectedSelector) && range.intersectsNode(element)) {
          return true;
        }
      } catch {
        return true;
      }
    }
    return false;
  }
  function selectionSurface(start, end, range) {
    if (rejectedSurface(start) || rejectedSurface(end) || rangeCrossesRejectedSurface(range)) {
      return void 0;
    }
    const startRoot = start.closest("[data-selected-text-overlay-target]");
    const endRoot = end.closest("[data-selected-text-overlay-target]");
    if (startRoot === null || startRoot !== endRoot || !stableRoot.contains(startRoot)) {
      return void 0;
    }
    if (startRoot.closest('[data-user-message-bubble="true"]') !== null) {
      return { root: startRoot, surface: "user_message" };
    }
    if (startRoot.closest(
      "[data-response-annotation-target], [data-local-conversation-final-assistant]"
    ) !== null) {
      return { root: startRoot, surface: "assistant_message" };
    }
    return void 0;
  }
  function rootVisible(root) {
    if (!root.isConnected || root.closest("[hidden], [inert]") !== null) return false;
    const style = window.getComputedStyle(root);
    const rect = root.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }
  function evaluateSelection() {
    if (uninstalled) return;
    const selection = window.getSelection();
    if (selection === null || selection.rangeCount !== 1 || selection.isCollapsed) {
      if (state === "resolving" || connectedOwnedElement("card") !== null) return;
      cleanup(true, false);
      return;
    }
    const range = selection.getRangeAt(0);
    const start = nodeElement(range.startContainer);
    const end = nodeElement(range.endContainer);
    if (start === null || end === null) {
      cleanup(true, false);
      return;
    }
    const admitted = selectionSurface(start, end, range);
    const rect = range.getBoundingClientRect();
    const decision = evaluateEligibility2({
      rangeCount: selection.rangeCount,
      collapsed: selection.isCollapsed,
      text: selection.toString(),
      ...admitted === void 0 ? {} : { surface: admitted.surface },
      sameSurface: admitted !== void 0,
      connected: admitted?.root.isConnected === true,
      visible: admitted !== void 0 && rootVisible(admitted.root),
      rectWidth: rect.width,
      rectHeight: rect.height
    });
    if (decision.kind !== "eligible" || admitted === void 0) {
      cleanup(true, false);
      return;
    }
    const contextFingerprint = readContextFingerprint();
    if (candidate?.text === decision.text && candidate.surface === decision.surface && candidate.sourceRoot === admitted.root && candidate.contextFingerprint === contextFingerprint) {
      candidate.range = range.cloneRange();
      reposition();
      return;
    }
    cleanup(true, false);
    candidate = {
      generation: ++generation,
      text: decision.text,
      surface: decision.surface,
      range: range.cloneRange(),
      sourceRoot: admitted.root,
      contextFingerprint
    };
    activeObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "hidden",
        "inert",
        "data-app-action-sidebar-thread-active",
        "data-app-action-sidebar-thread-id",
        "data-app-action-sidebar-thread-host-id"
      ]
    });
    mountAction();
  }
  function mountAction() {
    if (candidate === void 0) return;
    removeOwned("action");
    removeOwned("card");
    state = "affordance";
    const action = document.createElement("button");
    action.id = availableOwnedId(actionIdBase);
    action.type = "button";
    action.textContent = actionLabel;
    action.setAttribute("aria-label", "\u67E5\u770B\u6240\u9009\u6587\u5B57\u4E2D\u7684\u4E0A\u4E0B\u6587");
    action.setAttribute("aria-keyshortcuts", "Alt+Shift+K");
    action.setAttribute("data-pointable-context-owned", lifecycleId);
    action.setAttribute("data-pointable-context-role", "action");
    Object.assign(action.style, {
      position: "fixed",
      zIndex: "2147483000",
      border: "1px solid rgba(45, 91, 255, .38)",
      borderRadius: "999px",
      background: "#ffffff",
      color: "#1746c7",
      padding: "7px 11px",
      boxShadow: "0 8px 24px rgba(15, 23, 42, .18)",
      font: "600 12px/1.2 system-ui, sans-serif",
      cursor: "pointer"
    });
    const expectedGeneration = candidate.generation;
    const preserveSelection = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
    };
    action.addEventListener("pointerdown", preserveSelection);
    action.addEventListener("mousedown", preserveSelection);
    action.addEventListener("pointerup", (event) => {
      if (event.button === 0) event.stopPropagation();
    });
    action.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      void submitLookup("resolve", expectedGeneration);
    });
    actionElement = action;
    document.body.append(action);
    installOutsideHandler();
    resizeObserver?.disconnect();
    resizeObserver?.observe(action);
    reposition();
  }
  function installOutsideHandler() {
    if (outsideHandler !== void 0) return;
    outsideHandler = (event) => {
      const target = event.target;
      const action = connectedOwnedElement("action");
      const card = connectedOwnedElement("card");
      if (target instanceof Node && (action?.contains(target) === true || card?.contains(target) === true)) {
        return;
      }
      cleanup(true, true);
    };
    window.addEventListener("pointerdown", outsideHandler, true);
  }
  async function digestText(value) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value)
    );
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  async function submitLookup(operation, expectedGeneration, reference) {
    const current = candidate;
    if (current === void 0 || current.generation !== expectedGeneration || current.range.toString().trim() !== current.text || readContextFingerprint() !== current.contextFingerprint || !candidateAnchorIsCurrent()) {
      cleanup(true, false);
      return;
    }
    if (operation === "resolve" && reference !== void 0 || operation === "choose" && (typeof reference !== "string" || reference.length < 8 || reference.length > 256) || (operation === "check" || operation === "refresh") && (typeof reference !== "string" || reference.length < 8 || reference.length > 256)) {
      if (operation === "check" || operation === "refresh") {
        showRevisionNotice("unavailable", reference);
      } else {
        mountError("\u5019\u9009\u5F15\u7528\u65E0\u6548\u3002", false);
      }
      return;
    }
    if (operation === "resolve" || operation === "choose") state = "resolving";
    try {
      const digest = await digestText(current.text);
      if (candidate?.generation !== expectedGeneration || current.range.toString().trim() !== current.text || readContextFingerprint() !== current.contextFingerprint || !candidateAnchorIsCurrent()) {
        cleanup(true, false);
        return;
      }
      if (pending !== void 0) window.clearTimeout(pending.timeout);
      const requestId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const timeout = window.setTimeout(() => {
        if (pending?.requestId !== requestId) return;
        pending = void 0;
        if (operation === "check" || operation === "refresh") {
          showRevisionNotice("unavailable", reference);
        } else {
          mountError("\u67E5\u8BE2\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5\u3002", true);
        }
      }, requestTimeoutMs);
      pending = {
        requestId,
        generation: current.generation,
        digest,
        contextFingerprint: current.contextFingerprint,
        operation,
        ...operation === "choose" && reference !== void 0 ? { candidateRef: reference } : {},
        ...(operation === "check" || operation === "refresh") && reference !== void 0 ? { detailRef: reference } : {},
        timeout
      };
      if (operation === "resolve" || operation === "choose") {
        mountLoading(operation === "choose" ? "\u6B63\u5728\u8BFB\u53D6\u4E0A\u4E0B\u6587\u8BE6\u60C5\u2026" : "\u6B63\u5728\u67E5\u627E\u4E0A\u4E0B\u6587\u5BF9\u8C61\u2026");
      } else if (operation === "refresh") {
        showRevisionNotice("refreshing", reference);
      }
      const payload = {
        schemaVersion: 1,
        kind: "pointable.selection.lookup",
        operation,
        requestId,
        selectionGeneration: current.generation,
        selectionText: current.text,
        selectionDigest: digest,
        surface: current.surface,
        contextFingerprint: current.contextFingerprint,
        requestedAt: (/* @__PURE__ */ new Date()).toISOString(),
        ...operation === "choose" && reference !== void 0 ? { candidateRef: reference } : {},
        ...(operation === "check" || operation === "refresh") && reference !== void 0 ? { detailRef: reference } : {}
      };
      binding(JSON.stringify(payload));
    } catch {
      if (pending !== void 0) window.clearTimeout(pending.timeout);
      pending = void 0;
      if (operation === "check" || operation === "refresh") {
        showRevisionNotice("unavailable", reference);
      } else {
        mountError("\u5BBF\u4E3B\u67E5\u8BE2\u901A\u9053\u4E0D\u53EF\u7528\u3002", true);
      }
    }
  }
  function createShell(titleText) {
    removeOwned("action");
    removeOwned("card");
    if (restoreFocus === void 0 && document.activeElement instanceof HTMLElement) {
      restoreFocus = document.activeElement;
    }
    const shell = document.createElement("section");
    shell.id = availableOwnedId(cardIdBase);
    shell.tabIndex = -1;
    shell.setAttribute("role", "dialog");
    shell.setAttribute("aria-modal", "false");
    shell.setAttribute("aria-labelledby", `${shell.id}-title`);
    shell.setAttribute("data-pointable-context-owned", lifecycleId);
    shell.setAttribute("data-pointable-context-role", "card");
    Object.assign(shell.style, {
      position: "fixed",
      zIndex: "2147482999",
      width: "min(380px, calc(100vw - 24px))",
      maxHeight: "min(480px, calc(100vh - 24px))",
      overflow: "auto",
      border: "1px solid rgba(45, 91, 255, .32)",
      borderRadius: "12px",
      background: "#ffffff",
      color: "#172033",
      boxShadow: "0 18px 48px rgba(15, 23, 42, .24)",
      font: "13px/1.45 system-ui, sans-serif"
    });
    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      padding: "10px 12px",
      borderBottom: "1px solid #e2e8f0"
    });
    const title = document.createElement("h2");
    title.id = `${shell.id}-title`;
    title.textContent = titleText;
    Object.assign(title.style, { margin: "0", font: "700 14px/1.3 system-ui" });
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "\u5173\u95ED";
    close.setAttribute("aria-label", "\u5173\u95ED\u4E0A\u4E0B\u6587\u8BE6\u60C5");
    Object.assign(close.style, {
      border: "1px solid #d7deea",
      borderRadius: "7px",
      background: "#ffffff",
      color: "#334155",
      padding: "4px 8px",
      cursor: "pointer",
      font: "600 12px/1.2 system-ui"
    });
    const dismissPointer = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
    };
    close.addEventListener("pointerdown", dismissPointer);
    close.addEventListener("mousedown", dismissPointer);
    close.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.getSelection()?.removeAllRanges();
      cleanup(true, true);
    });
    header.append(title, close);
    const body = document.createElement("div");
    Object.assign(body.style, { padding: "12px" });
    shell.append(header, body);
    cardElement = shell;
    document.body.append(shell);
    installOutsideHandler();
    resizeObserver?.disconnect();
    resizeObserver?.observe(shell);
    window.queueMicrotask(() => {
      if (shell.isConnected) shell.focus({ preventScroll: true });
    });
    reposition();
    return { shell, body };
  }
  function paragraph(text, muted = false) {
    const value = document.createElement("p");
    value.textContent = text;
    Object.assign(value.style, {
      margin: "0",
      color: muted ? "#64748b" : "#172033",
      overflowWrap: "anywhere"
    });
    return value;
  }
  function mountLoading(message) {
    state = "resolving";
    const { body } = createShell("\u4E0A\u4E0B\u6587\u8BE6\u60C5");
    const status2 = paragraph(message, true);
    status2.setAttribute("role", "status");
    status2.setAttribute("aria-live", "polite");
    body.append(status2);
  }
  function mountCandidates(candidates2) {
    state = "candidates";
    const currentGeneration = candidate?.generation;
    if (currentGeneration === void 0) return;
    const { body } = createShell("\u9009\u62E9\u4E0A\u4E0B\u6587\u5BF9\u8C61");
    const instruction = paragraph(`\u627E\u5230 ${candidates2.length} \u4E2A\u5339\u914D\u9879\uFF0C\u8BF7\u9009\u62E9\uFF1A`, true);
    instruction.id = `${cardElement?.id ?? cardIdBase}-candidate-instruction`;
    const group = document.createElement("div");
    group.setAttribute("role", "group");
    group.setAttribute("aria-labelledby", instruction.id);
    Object.assign(group.style, { display: "grid", gap: "8px", marginTop: "10px" });
    for (const item of candidates2) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `${item.label}\uFF0C${item.entityType}`);
      Object.assign(button.style, {
        display: "grid",
        gap: "3px",
        width: "100%",
        textAlign: "left",
        border: "1px solid #d7deea",
        borderRadius: "9px",
        background: "#ffffff",
        color: "#172033",
        padding: "9px 10px",
        cursor: "pointer"
      });
      const label = document.createElement("span");
      label.textContent = item.label;
      label.style.fontWeight = "700";
      const type = document.createElement("span");
      type.textContent = item.entityType;
      Object.assign(type.style, { color: "#52627a", fontSize: "12px" });
      const summary = document.createElement("span");
      summary.textContent = item.summary;
      Object.assign(summary.style, { color: "#52627a", fontSize: "12px" });
      button.append(label, type, summary);
      button.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        void submitLookup("choose", currentGeneration, item.candidateRef);
      });
      group.append(button);
    }
    body.append(instruction, group);
  }
  function metadataRow(labelText, valueText) {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "grid",
      gridTemplateColumns: "96px minmax(0, 1fr)",
      gap: "8px",
      padding: "3px 0"
    });
    const label = document.createElement("strong");
    label.textContent = labelText;
    label.style.color = "#52627a";
    const value = document.createElement("span");
    value.textContent = valueText;
    value.style.overflowWrap = "anywhere";
    row.append(label, value);
    return row;
  }
  function clearRevisionTimer() {
    if (revisionTimer !== void 0) window.clearTimeout(revisionTimer);
    revisionTimer = void 0;
  }
  function removeRevisionNotice() {
    connectedOwnedElement("card")?.querySelector('[data-pointable-context-role="revision-notice"]')?.remove();
  }
  function scheduleRevisionCheck(detailRef, expectedGeneration) {
    clearRevisionTimer();
    revisionTimer = window.setTimeout(() => {
      revisionTimer = void 0;
      if (state !== "detail" || candidate?.generation !== expectedGeneration || connectedOwnedElement("card") === null) {
        return;
      }
      if (pending !== void 0) {
        scheduleRevisionCheck(detailRef, expectedGeneration);
        return;
      }
      void submitLookup("check", expectedGeneration, detailRef);
    }, revisionCheckIntervalMs);
  }
  function showRevisionNotice(noticeState, detailRef) {
    clearRevisionTimer();
    const shell = connectedOwnedElement("card");
    if (shell === null) return;
    removeRevisionNotice();
    const notice = document.createElement("div");
    notice.setAttribute("data-pointable-context-role", "revision-notice");
    notice.setAttribute("role", "status");
    Object.assign(notice.style, {
      margin: "8px 12px 0",
      padding: "8px 10px",
      borderRadius: "8px",
      background: noticeState === "deleted" || noticeState === "unavailable" ? "#fff4e5" : "#eef4ff",
      color: noticeState === "deleted" || noticeState === "unavailable" ? "#8a4b00" : "#1746c7",
      fontSize: "12px"
    });
    const message = document.createElement("span");
    message.textContent = noticeState === "updated" ? "\u5185\u5BB9\u5DF2\u66F4\u65B0" : noticeState === "deleted" ? "\u5BF9\u8C61\u5DF2\u5220\u9664\uFF1B\u5F53\u524D\u663E\u793A\u7684\u662F\u65E7\u5FEB\u7167" : noticeState === "refreshing" ? "\u6B63\u5728\u5237\u65B0\u5F53\u524D\u8BE6\u60C5\u2026" : "\u6682\u65F6\u65E0\u6CD5\u786E\u8BA4\u6700\u65B0\u72B6\u6001\uFF1B\u5F53\u524D\u663E\u793A\u7684\u662F\u65E7\u5FEB\u7167";
    notice.append(message);
    if (noticeState === "updated" && detailRef !== void 0) {
      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.textContent = "\u5237\u65B0\u5185\u5BB9";
      refresh.setAttribute("data-pointable-context-role", "revision-refresh");
      Object.assign(refresh.style, {
        marginLeft: "8px",
        border: "0",
        background: "transparent",
        color: "#1746c7",
        padding: "1px 0",
        cursor: "pointer",
        fontWeight: "700"
      });
      const expectedGeneration = candidate?.generation;
      refresh.addEventListener("click", (event) => {
        if (!event.isTrusted || expectedGeneration === void 0) return;
        event.preventDefault();
        event.stopPropagation();
        void submitLookup("refresh", expectedGeneration, detailRef);
      });
      notice.append(refresh);
    }
    const header = shell.firstElementChild;
    if (header?.nextSibling === null) shell.append(notice);
    else shell.insertBefore(notice, header?.nextSibling ?? shell.firstChild);
    reposition();
  }
  function mountDetail(detail) {
    clearRevisionTimer();
    state = "detail";
    const { body } = createShell(detail.label);
    body.append(paragraph(detail.summary));
    if (detail.changes !== void 0 && detail.changes.length > 0) {
      const changeSummary = document.createElement("div");
      changeSummary.setAttribute("data-pointable-context-role", "revision-changes");
      Object.assign(changeSummary.style, {
        marginTop: "8px",
        padding: "8px 10px",
        borderRadius: "8px",
        background: "#eef4ff",
        color: "#1746c7",
        fontSize: "12px"
      });
      const heading = document.createElement("strong");
      heading.textContent = "\u672C\u6B21\u5237\u65B0";
      const list = document.createElement("ul");
      Object.assign(list.style, { margin: "4px 0 0", paddingLeft: "18px" });
      for (const change of detail.changes) {
        const item = document.createElement("li");
        item.textContent = `${change.label}\uFF1A${change.before} \u2192 ${change.after}`;
        list.append(item);
      }
      changeSummary.append(heading, list);
      body.append(changeSummary);
    }
    const compactState = document.createElement("div");
    compactState.textContent = `${detail.entityType} \xB7 ${detail.freshness}`;
    Object.assign(compactState.style, {
      marginTop: "6px",
      color: detail.freshness === "current" ? "#64748b" : "#a15c00",
      fontSize: "11px",
      overflowWrap: "anywhere"
    });
    body.append(compactState);
    const disclosure = document.createElement("div");
    disclosure.setAttribute("data-pointable-context-role", "detail-disclosure");
    Object.assign(disclosure.style, { marginTop: "8px" });
    const disclosureToggle = document.createElement("button");
    disclosureToggle.type = "button";
    disclosureToggle.textContent = "\u67E5\u770B\u8BE6\u60C5";
    disclosureToggle.setAttribute("aria-label", "\u5C55\u5F00\u4E0A\u4E0B\u6587\u8BE6\u60C5");
    disclosureToggle.setAttribute("aria-expanded", "false");
    disclosureToggle.setAttribute("data-pointable-context-role", "detail-toggle");
    Object.assign(disclosureToggle.style, {
      border: "0",
      background: "transparent",
      padding: "2px 0",
      width: "fit-content",
      color: "#52627a",
      cursor: "pointer",
      fontSize: "12px",
      fontWeight: "600",
      userSelect: "none"
    });
    const detailBody = document.createElement("div");
    detailBody.id = `${cardElement?.id ?? cardIdBase}-detail-body`;
    detailBody.hidden = true;
    detailBody.style.display = "none";
    detailBody.setAttribute("data-pointable-context-role", "detail-body");
    disclosureToggle.setAttribute("aria-controls", detailBody.id);
    const metadata = document.createElement("div");
    Object.assign(metadata.style, {
      marginTop: "10px",
      paddingTop: "8px",
      borderTop: "1px solid #e2e8f0"
    });
    metadata.append(
      metadataRow("\u7C7B\u578B", detail.entityType),
      metadataRow("\u5B9E\u4F53", detail.entityId),
      metadataRow("\u65B0\u9C9C\u5EA6", detail.freshness),
      metadataRow("\u4FEE\u8BA2\u7248", detail.revision),
      metadataRow("\u6570\u636E\u65F6\u95F4", detail.observedAt)
    );
    detailBody.append(metadata);
    if (detail.facts.length > 0) {
      const heading = document.createElement("h3");
      heading.textContent = "\u5173\u952E\u4E8B\u5B9E";
      Object.assign(heading.style, { margin: "12px 0 4px", fontSize: "13px" });
      const facts = document.createElement("div");
      for (const fact of detail.facts) facts.append(metadataRow(fact.label, fact.value));
      detailBody.append(heading, facts);
    }
    if (detail.sources.length > 0) {
      const heading = document.createElement("h3");
      heading.textContent = "\u6765\u6E90";
      Object.assign(heading.style, { margin: "12px 0 4px", fontSize: "13px" });
      const list = document.createElement("ul");
      Object.assign(list.style, { margin: "0", paddingLeft: "20px" });
      for (const source of detail.sources) {
        const item = document.createElement("li");
        item.textContent = source.label;
        list.append(item);
      }
      detailBody.append(heading, list);
    }
    disclosure.append(disclosureToggle, detailBody);
    disclosureToggle.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      event.preventDefault();
      event.stopPropagation();
      const expanded = disclosureToggle.getAttribute("aria-expanded") !== "true";
      disclosureToggle.setAttribute("aria-expanded", String(expanded));
      detailBody.hidden = !expanded;
      detailBody.style.display = expanded ? "block" : "none";
      disclosureToggle.textContent = expanded ? "\u6536\u8D77\u8BE6\u60C5" : "\u67E5\u770B\u8BE6\u60C5";
      disclosureToggle.setAttribute(
        "aria-label",
        expanded ? "\u6536\u8D77\u4E0A\u4E0B\u6587\u8BE6\u60C5" : "\u5C55\u5F00\u4E0A\u4E0B\u6587\u8BE6\u60C5"
      );
      reposition();
    });
    body.append(disclosure);
    if (detail.detailRef !== void 0 && candidate !== void 0) {
      scheduleRevisionCheck(detail.detailRef, candidate.generation);
    }
  }
  function mountError(message, retryable) {
    state = "error";
    const currentGeneration = candidate?.generation;
    const { body } = createShell("\u4E0A\u4E0B\u6587\u8BE6\u60C5\u4E0D\u53EF\u7528");
    const error = paragraph(message);
    error.setAttribute("role", "alert");
    error.style.color = "#a8241b";
    body.append(error);
    if (retryable && currentGeneration !== void 0) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "\u91CD\u8BD5";
      Object.assign(retry.style, {
        marginTop: "10px",
        border: "1px solid #d7deea",
        borderRadius: "7px",
        background: "#ffffff",
        color: "#1746c7",
        padding: "6px 10px",
        cursor: "pointer",
        fontWeight: "600"
      });
      retry.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        void submitLookup("resolve", currentGeneration);
      });
      body.append(retry);
    }
  }
  function receiveResult(value) {
    const response = validateResponse(value);
    if (response === void 0) {
      return {
        ok: false,
        outcome: "invalid_payload",
        code: "pointable_result_invalid"
      };
    }
    const request = pending;
    if (request === void 0 || response.requestId !== request.requestId || response.selectionGeneration !== request.generation || response.selectionDigest !== request.digest) {
      return {
        ok: false,
        requestId: response.requestId,
        outcome: "stale",
        code: "pointable_result_stale"
      };
    }
    if (response.contextFingerprint !== request.contextFingerprint || candidate?.generation !== request.generation || readContextFingerprint() !== request.contextFingerprint || !candidateAnchorIsCurrent()) {
      window.clearTimeout(request.timeout);
      pending = void 0;
      cleanup(true, false);
      return {
        ok: false,
        requestId: response.requestId,
        outcome: "context_changed",
        code: "pointable_context_changed"
      };
    }
    if (response.presentation.kind === "revision" && (request.operation !== "check" || response.presentation.revision.detailRef !== request.detailRef) || request.operation === "refresh" && response.presentation.kind === "detail" && response.presentation.detail.detailRef !== request.detailRef) {
      window.clearTimeout(request.timeout);
      pending = void 0;
      return {
        ok: false,
        requestId: response.requestId,
        outcome: "stale",
        code: "pointable_refresh_ref_mismatch"
      };
    }
    window.clearTimeout(request.timeout);
    pending = void 0;
    if (response.presentation.kind === "candidates") {
      mountCandidates(response.presentation.candidates);
    } else if (response.presentation.kind === "detail") {
      mountDetail(response.presentation.detail);
    } else if (response.presentation.kind === "revision") {
      const revision = response.presentation.revision;
      state = "detail";
      if (revision.state === "unchanged") {
        removeRevisionNotice();
        scheduleRevisionCheck(revision.detailRef, request.generation);
      } else {
        showRevisionNotice(revision.state, revision.detailRef);
      }
    } else if (request.operation === "check" || request.operation === "refresh") {
      state = "detail";
      showRevisionNotice("unavailable", request.detailRef);
    } else {
      mountError(response.presentation.message, response.presentation.retryable);
    }
    return { ok: true, requestId: response.requestId, outcome: "applied" };
  }
  function verifyFence(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const fence = value;
    const request = pending;
    return request !== void 0 && fence.requestId === request.requestId && fence.selectionGeneration === request.generation && fence.selectionDigest === request.digest && fence.contextFingerprint === request.contextFingerprint && candidate?.generation === request.generation && readContextFingerprint() === request.contextFingerprint && candidateAnchorIsCurrent();
  }
  function candidateAnchorIsCurrent() {
    const current = candidate;
    if (current === void 0 || !current.sourceRoot.isConnected || !current.range.commonAncestorContainer.isConnected || current.range.toString().trim() !== current.text || !rootVisible(current.sourceRoot)) {
      return false;
    }
    const start = nodeElement(current.range.startContainer);
    const end = nodeElement(current.range.endContainer);
    if (start === null || end === null) return false;
    const admitted = selectionSurface(start, end, current.range);
    return admitted !== void 0 && admitted.root === current.sourceRoot && admitted.surface === current.surface;
  }
  function scheduleReconcile() {
    if (reconcileFrame !== void 0) return;
    reconcileFrame = window.requestAnimationFrame(() => {
      reconcileFrame = void 0;
      reconcile();
    });
  }
  function reconcile() {
    if (candidate === void 0) return status();
    if (readContextFingerprint() !== candidate.contextFingerprint || !candidateAnchorIsCurrent()) {
      cleanup(true, false);
      return status();
    }
    reposition();
    return status();
  }
  function reposition() {
    if (repositionFrame !== void 0) return;
    repositionFrame = window.requestAnimationFrame(() => {
      repositionFrame = void 0;
      const current = candidate;
      const target = connectedOwnedElement("card") ?? connectedOwnedElement("action");
      if (current === void 0 || !(target instanceof HTMLElement)) return;
      if (readContextFingerprint() !== current.contextFingerprint || !candidateAnchorIsCurrent()) {
        cleanup(true, false);
        return;
      }
      const rect = current.range.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        cleanup(true, false);
        return;
      }
      const viewport = window.visualViewport;
      const offsetLeft = viewport?.offsetLeft ?? 0;
      const offsetTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const inset = 12;
      const actionTarget = target.getAttribute("data-pointable-context-role") === "action";
      const width = target.offsetWidth || (actionTarget ? 150 : 380);
      const height = target.offsetHeight || (actionTarget ? 34 : 320);
      const minimumLeft = offsetLeft + inset;
      const maximumLeft = Math.max(minimumLeft, offsetLeft + viewportWidth - width - inset);
      const desiredLeft = rect.left + rect.width / 2 - width / 2;
      target.style.left = `${Math.min(Math.max(minimumLeft, desiredLeft), maximumLeft)}px`;
      const minimumTop = offsetTop + inset;
      const maximumTop = Math.max(minimumTop, offsetTop + viewportHeight - height - inset);
      const above = rect.top - height - 8;
      const desiredTop = above >= minimumTop ? above : rect.bottom + 8;
      target.style.top = `${Math.min(Math.max(minimumTop, desiredTop), maximumTop)}px`;
    });
  }
  function cleanup(clearCandidate, restore) {
    clearRevisionTimer();
    removeOwned("action");
    removeOwned("card");
    resizeObserver?.disconnect();
    if (pending !== void 0) window.clearTimeout(pending.timeout);
    pending = void 0;
    if (repositionFrame !== void 0) window.cancelAnimationFrame(repositionFrame);
    repositionFrame = void 0;
    if (reconcileFrame !== void 0) window.cancelAnimationFrame(reconcileFrame);
    reconcileFrame = void 0;
    if (outsideHandler !== void 0) {
      window.removeEventListener("pointerdown", outsideHandler, true);
      outsideHandler = void 0;
    }
    if (clearCandidate) {
      candidate = void 0;
      activeObserver.disconnect();
      state = "idle";
    }
    if (restore && restoreFocus?.isConnected) {
      restoreFocus.focus({ preventScroll: true });
    }
    if (clearCandidate) restoreFocus = void 0;
  }
  function status() {
    return {
      installed: !uninstalled,
      bindingName: config.bindingName,
      lifecycleId,
      state,
      selectionGeneration: generation,
      pendingRequestCount: pending === void 0 ? 0 : 1,
      actionCount: connectedOwnedElement("action") === null ? 0 : 1,
      cardCount: connectedOwnedElement("card") === null ? 0 : 1
    };
  }
  function uninstall() {
    if (uninstalled) return status();
    cleanup(true, false);
    uninstalled = true;
    activeObserver.disconnect();
    resizeObserver?.disconnect();
    document.removeEventListener("selectionchange", selectionHandler);
    document.removeEventListener("pointerup", pointerUpHandler, true);
    document.removeEventListener("keyup", keyUpHandler, true);
    document.removeEventListener("keydown", keyDownHandler, true);
    window.removeEventListener("scroll", viewportHandler, true);
    window.removeEventListener("resize", viewportHandler);
    window.removeEventListener("popstate", routeHandler);
    window.removeEventListener("hashchange", routeHandler);
    window.visualViewport?.removeEventListener("resize", viewportHandler);
    window.visualViewport?.removeEventListener("scroll", viewportHandler);
    if (window[namespace] === api) delete window[namespace];
    return status();
  }
  const api = {
    status,
    verifyFence,
    receiveResult,
    reconcile,
    uninstall
  };
  window[namespace] = api;
  return status();
}
function createInstallPointableRendererExpression(config) {
  return `(() => {
    const evaluateEligibility = (${evaluatePointableRendererEligibility.toString()});
    const validateResponse = (${validatePointableRendererResponse.toString()});
    const install = (${installPointableContextRenderer.toString()});
    return install(${JSON.stringify(config)}, evaluateEligibility, validateResponse);
  })()`;
}
function createVerifyPointableRendererFenceExpression(fence, lifecycleId) {
  return `(() => {
    const renderer = window.__pointableContextRenderer;
    return renderer?.status?.().lifecycleId === ${JSON.stringify(lifecycleId)} &&
      renderer.verifyFence?.(${JSON.stringify(fence)}) === true;
  })()`;
}
function createDeliverPointableResultExpression(response, lifecycleId) {
  return `(() => {
    const renderer = window.__pointableContextRenderer;
    return renderer?.status?.().lifecycleId === ${JSON.stringify(lifecycleId)}
      ? renderer.receiveResult?.(${JSON.stringify(response)}) ?? null
      : null;
  })()`;
}
function createUninstallPointableRendererExpression(lifecycleId) {
  return `(() => {
    const renderer = window.__pointableContextRenderer;
    return renderer?.status?.().lifecycleId === ${JSON.stringify(lifecycleId)}
      ? renderer.uninstall?.() ?? null
      : null;
  })()`;
}

// src/host/codex-cdp/targets.ts
var CodexTargetDiscoveryError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "CodexTargetDiscoveryError";
  }
  code;
};
function loopbackHostname(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}
function normalizeCodexDebugEndpoint(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new CodexTargetDiscoveryError(
      "debug_endpoint_invalid",
      "Codex debug endpoint is not a valid URL"
    );
  }
  if (parsed.protocol !== "http:" || !loopbackHostname(parsed.hostname) || parsed.port.length === 0 || parsed.username.length > 0 || parsed.password.length > 0 || parsed.pathname !== "/" && parsed.pathname !== "" || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new CodexTargetDiscoveryError(
      "debug_endpoint_not_loopback",
      "Codex debug endpoint must be an explicit loopback HTTP origin"
    );
  }
  return new URL(parsed.origin);
}
function record2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function readBoundedResponseText(response, maximumBytes, signal) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maximumBytes) {
      throw new CodexTargetDiscoveryError(
        "target_list_too_large",
        "Codex target list exceeds its size limit"
      );
    }
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const aborted = () => {
    void reader.cancel(signal.reason).catch(() => void 0);
  };
  signal.addEventListener("abort", aborted, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel("pointable target list exceeded its byte limit");
        throw new CodexTargetDiscoveryError(
          "target_list_too_large",
          "Codex target list exceeds its size limit"
        );
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof CodexTargetDiscoveryError) throw error;
    throw new CodexTargetDiscoveryError(
      "target_list_invalid",
      "Codex target list is not valid UTF-8"
    );
  } finally {
    signal.removeEventListener("abort", aborted);
    reader.releaseLock();
  }
}
function awaitWithAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve4, reject) => {
    const aborted = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener("abort", aborted);
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve4(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}
function parseTarget(value, endpoint) {
  if (!record2(value) || value.type !== "page" || typeof value.id !== "string" || value.id.length < 1 || value.id.length > 256 || !/^[A-Za-z0-9:_-]+$/u.test(value.id) || typeof value.title !== "string" || value.title.length > 512 || value.url !== "app://-/index.html" || typeof value.webSocketDebuggerUrl !== "string") {
    return void 0;
  }
  let websocket;
  try {
    websocket = new URL(value.webSocketDebuggerUrl);
  } catch {
    return void 0;
  }
  if (websocket.protocol !== "ws:" || !loopbackHostname(websocket.hostname) || websocket.hostname.toLowerCase() !== endpoint.hostname.toLowerCase() || websocket.port !== endpoint.port || websocket.pathname !== `/devtools/page/${value.id}` || websocket.search.length > 0 || websocket.hash.length > 0) {
    return void 0;
  }
  return {
    id: value.id,
    type: "page",
    title: value.title,
    url: value.url,
    webSocketDebuggerUrl: websocket.toString()
  };
}
async function discoverCodexAppTargets(endpointValue = "http://127.0.0.1:9223", options = {}) {
  const endpoint = normalizeCodexDebugEndpoint(endpointValue);
  const timeoutMs = options.timeoutMs ?? 3e3;
  const maxResponseBytes = options.maxResponseBytes ?? 1048576;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 3e4) {
    throw new RangeError("timeoutMs must be an integer from 50 to 30000");
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > 4194304) {
    throw new RangeError("maxResponseBytes must be an integer from 1024 to 4194304");
  }
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("Codex target discovery timed out")),
    timeoutMs
  );
  try {
    const response = await awaitWithAbort(
      Promise.resolve().then(() => (options.fetch ?? globalThis.fetch)(
        new URL("/json/list", endpoint),
        {
          method: "GET",
          redirect: "error",
          signal: controller.signal,
          headers: { accept: "application/json" }
        }
      )),
      controller.signal
    );
    if (!response.ok) {
      throw new CodexTargetDiscoveryError(
        "target_list_unavailable",
        `Codex target list returned HTTP ${response.status}`
      );
    }
    if (response.url.length > 0 && new URL(response.url).origin !== endpoint.origin) {
      throw new CodexTargetDiscoveryError(
        "target_list_redirected",
        "Codex target discovery crossed its loopback origin"
      );
    }
    const text = await awaitWithAbort(
      readBoundedResponseText(response, maxResponseBytes, controller.signal),
      controller.signal
    );
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new CodexTargetDiscoveryError(
        "target_list_invalid",
        "Codex target list is not valid JSON"
      );
    }
    if (!Array.isArray(parsed) || parsed.length > 64) {
      throw new CodexTargetDiscoveryError(
        "target_list_invalid",
        "Codex target list is not a bounded array"
      );
    }
    const targets = parsed.flatMap((candidate) => {
      const target = parseTarget(candidate, endpoint);
      return target === void 0 ? [] : [target];
    });
    return [...new Map(targets.map((target) => [target.id, target])).values()];
  } catch (error) {
    if (error instanceof CodexTargetDiscoveryError) throw error;
    if (controller.signal.aborted) {
      throw new CodexTargetDiscoveryError(
        "target_discovery_aborted",
        "Codex target discovery was aborted or timed out"
      );
    }
    throw new CodexTargetDiscoveryError(
      "target_list_unavailable",
      "Codex target list is unavailable"
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

// src/host/codex-cdp/transport.ts
var CdpTransportError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "CdpTransportError";
  }
  code;
};
var MAX_CDP_MESSAGE_BYTES = 1048576;
function record3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function loopbackWebSocket(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "ws:" && (hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]") && url.username.length === 0 && url.password.length === 0;
  } catch {
    return false;
  }
}
async function connectCdpWebSocket(webSocketDebuggerUrl, signal) {
  if (!loopbackWebSocket(webSocketDebuggerUrl)) {
    throw new CdpTransportError(
      "cdp_websocket_not_loopback",
      "CDP websocket must use an explicit loopback ws URL"
    );
  }
  if (signal?.aborted) {
    throw new CdpTransportError("cdp_connect_aborted", "CDP connection was aborted");
  }
  let socket;
  try {
    socket = new WebSocket(webSocketDebuggerUrl);
  } catch {
    throw new CdpTransportError("cdp_connect_failed", "CDP websocket failed");
  }
  await new Promise((resolve4, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      socket.close();
      reject(new CdpTransportError("cdp_connect_timeout", "CDP websocket timed out"));
    }, 5e3);
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("open", opened);
      socket.removeEventListener("error", failed);
      signal?.removeEventListener("abort", aborted);
    };
    const opened = () => {
      cleanup();
      resolve4();
    };
    const failed = () => {
      cleanup();
      socket.close();
      reject(new CdpTransportError("cdp_connect_failed", "CDP websocket failed"));
    };
    const aborted = () => {
      cleanup();
      socket.close();
      reject(new CdpTransportError("cdp_connect_aborted", "CDP connection was aborted"));
    };
    socket.addEventListener("open", opened, { once: true });
    socket.addEventListener("error", failed, { once: true });
    signal?.addEventListener("abort", aborted, { once: true });
  });
  let sequence = 0;
  let closed = false;
  const pending = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  const closeListeners = /* @__PURE__ */ new Set();
  const failPending = (error) => {
    for (const command of pending.values()) {
      clearTimeout(command.timer);
      command.reject(error);
    }
    pending.clear();
  };
  const markClosed = (error = new CdpTransportError("cdp_closed", "CDP websocket closed")) => {
    if (closed) return;
    closed = true;
    failPending(error);
    listeners.clear();
    for (const listener of closeListeners) {
      Promise.resolve(listener(error)).catch(() => void 0);
    }
    closeListeners.clear();
  };
  const closeForProtocolError = (error, code) => {
    markClosed(error);
    try {
      socket.close(code, error.code);
    } catch {
      socket.close();
    }
  };
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      closeForProtocolError(
        new CdpTransportError(
          "cdp_message_invalid",
          "CDP websocket received a non-text message"
        ),
        1003
      );
      return;
    }
    if (event.data.length > MAX_CDP_MESSAGE_BYTES || new TextEncoder().encode(event.data).byteLength > MAX_CDP_MESSAGE_BYTES) {
      closeForProtocolError(
        new CdpTransportError(
          "cdp_message_too_large",
          "CDP websocket message exceeds its byte limit"
        ),
        1009
      );
      return;
    }
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!record3(message)) return;
    if (typeof message.id === "number") {
      const command = pending.get(message.id);
      if (command === void 0) return;
      pending.delete(message.id);
      clearTimeout(command.timer);
      if (record3(message.error)) {
        command.reject(
          new CdpTransportError(
            "cdp_command_failed",
            typeof message.error.message === "string" ? message.error.message : "CDP command failed"
          )
        );
      } else {
        command.resolve(message.result);
      }
      return;
    }
    if (typeof message.method !== "string") return;
    const cdpEvent = {
      method: message.method
    };
    if (record3(message.params)) cdpEvent.params = message.params;
    for (const listener of listeners) {
      Promise.resolve(listener(cdpEvent)).catch(() => void 0);
    }
  });
  socket.addEventListener("close", () => markClosed(), { once: true });
  return {
    send(method, params = {}, timeoutMs = 5e3) {
      if (closed || socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(
          new CdpTransportError("cdp_closed", "CDP websocket is not open")
        );
      }
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 3e4) {
        return Promise.reject(
          new RangeError("CDP command timeout must be from 10 to 30000 ms")
        );
      }
      const id = ++sequence;
      const serialized = JSON.stringify({ id, method, params });
      if (serialized.length > MAX_CDP_MESSAGE_BYTES || new TextEncoder().encode(serialized).byteLength > MAX_CDP_MESSAGE_BYTES) {
        const error = new CdpTransportError(
          "cdp_message_too_large",
          "CDP websocket message exceeds its byte limit"
        );
        closeForProtocolError(error, 1009);
        return Promise.reject(error);
      }
      return new Promise((resolve4, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new CdpTransportError(
              "cdp_command_timeout",
              `CDP command ${method} timed out`
            )
          );
        }, timeoutMs);
        pending.set(id, { resolve: resolve4, reject, timer });
        try {
          socket.send(serialized);
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(
            error instanceof Error ? error : new CdpTransportError("cdp_send_failed", "CDP send failed")
          );
        }
      });
    },
    onEvent(listener) {
      if (closed) return () => void 0;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onClose(listener) {
      if (closed) return () => void 0;
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    isClosed: () => closed,
    close() {
      if (closed) return;
      closed = true;
      failPending(new CdpTransportError("cdp_closed", "CDP websocket closed"));
      listeners.clear();
      const error = new CdpTransportError("cdp_closed", "CDP websocket closed");
      for (const listener of closeListeners) {
        Promise.resolve(listener(error)).catch(() => void 0);
      }
      closeListeners.clear();
      socket.close();
    }
  };
}

// src/host/codex-cdp/host-context.ts
var CodexHostContextError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "CodexHostContextError";
  }
};
function record4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundedIdentity(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 256 && /^[A-Za-z0-9:_-]+$/u.test(value);
}
function boundedRoute(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "app:" && parsed.hostname === "-" && parsed.pathname === "/index.html";
  } catch {
    return false;
  }
}
function createReadCodexHostTaskContextExpression() {
  return `(() => {
    const nodes = [...document.querySelectorAll(
      '[data-app-action-sidebar-thread-active="true"]'
    )].filter((node) => node instanceof HTMLElement && node.isConnected);
    if (nodes.length !== 1) return null;
    const active = nodes[0];
    const threadId = active.getAttribute('data-app-action-sidebar-thread-id');
    const hostId = active.getAttribute('data-app-action-sidebar-thread-host-id');
    if (typeof threadId !== 'string' || typeof hostId !== 'string') return null;
    const fingerprintValue = {
      href: window.location.href,
      threadId,
      hostId,
    };
    return {
      schemaVersion: 1,
      host: 'codex-desktop',
      threadId,
      hostId,
      routeRef: window.location.href,
      contextFingerprint: JSON.stringify(fingerprintValue),
    };
  })()`;
}
function parseCodexHostTaskContext(value, expectedFingerprint) {
  if (value === null || value === void 0) return void 0;
  if (!record4(value) || Reflect.ownKeys(value).some((key) => typeof key !== "string") || Object.keys(value).sort().join("|") !== "contextFingerprint|host|hostId|routeRef|schemaVersion|threadId" || value.schemaVersion !== 1 || value.host !== "codex-desktop" || !boundedIdentity(value.threadId) || !boundedIdentity(value.hostId) || !boundedRoute(value.routeRef) || typeof value.contextFingerprint !== "string" || value.contextFingerprint.length < 1 || value.contextFingerprint.length > 2048) {
    throw new CodexHostContextError("pointable_host_task_context_invalid");
  }
  const canonicalFingerprint = JSON.stringify({
    href: value.routeRef,
    threadId: value.threadId,
    hostId: value.hostId
  });
  if (value.contextFingerprint !== canonicalFingerprint || expectedFingerprint !== void 0 && value.contextFingerprint !== expectedFingerprint) {
    throw new CodexHostContextError("pointable_host_task_context_changed");
  }
  return Object.freeze({
    schemaVersion: 1,
    host: "codex-desktop",
    threadId: value.threadId,
    hostId: value.hostId,
    routeRef: value.routeRef,
    contextFingerprint: value.contextFingerprint
  });
}

// src/host/codex-cdp/adapter.ts
function record5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function runtimeValue(value) {
  if (!record5(value) || !record5(value.result) || value.exceptionDetails !== void 0) {
    return void 0;
  }
  return value.result.value;
}
function parseInstalledStatus(value, bindingName) {
  if (!record5(value) || value.installed !== true || value.bindingName !== bindingName || typeof value.lifecycleId !== "string" || !/^[A-Za-z0-9:_-]{8,256}$/u.test(value.lifecycleId) || typeof value.state !== "string") {
    throw new Error("pointable_renderer_install_unverified");
  }
  return value;
}
function parseMainFrameId(value, target) {
  if (!record5(value) || !record5(value.frameTree) || !record5(value.frameTree.frame) || typeof value.frameTree.frame.id !== "string" || value.frameTree.frame.id.length < 1 || value.frameTree.frame.id.length > 256 || value.frameTree.frame.url !== target.url) {
    throw new Error("pointable_main_frame_unverified");
  }
  return value.frameTree.frame.id;
}
function mainExecutionContext(event, mainFrameId) {
  if (event.method !== "Runtime.executionContextCreated" || !record5(event.params)) {
    return void 0;
  }
  const context = event.params.context;
  if (!record5(context) || !Number.isSafeInteger(context.id) || Number(context.id) < 1) {
    return void 0;
  }
  const auxiliary = context.auxData;
  if (!record5(auxiliary) || auxiliary.isDefault !== true || auxiliary.frameId !== mainFrameId) {
    return void 0;
  }
  return Number(context.id);
}
function lookupError(code, message, retryable) {
  return { kind: "error", code, message, retryable };
}
function boundedLookup(callback, timeoutMs, controller) {
  return new Promise((resolve4, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      controller.abort(new Error("pointable lookup timed out"));
      reject(new Error("pointable_lookup_timeout"));
    }, timeoutMs);
    Promise.resolve().then(() => callback(controller.signal)).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve4(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
function waitForMainContext(attachment, signal, timeoutMs = 2e3) {
  if (attachment.mainExecutionContextId !== void 0) {
    return Promise.resolve(attachment.mainExecutionContextId);
  }
  return new Promise((resolve4, reject) => {
    let settled = false;
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", aborted);
      attachment.contextWaiters.delete(finish);
    };
    const finish = (contextId) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve4(contextId);
    };
    const aborted = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("pointable_main_context_aborted"));
    };
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("pointable_main_context_timeout"));
    }, timeoutMs);
    attachment.contextWaiters.add(finish);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}
function connectWithAbort(connectionPromise, signal) {
  if (signal.aborted) {
    connectionPromise.then((connection) => connection.close(), () => void 0);
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve4, reject) => {
    let settled = false;
    const aborted = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", aborted);
      reject(signal.reason);
    };
    signal.addEventListener("abort", aborted, { once: true });
    connectionPromise.then(
      (connection) => {
        if (settled) {
          connection.close();
          return;
        }
        settled = true;
        signal.removeEventListener("abort", aborted);
        resolve4(connection);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", aborted);
        reject(error);
      }
    );
  });
}
var CodexCdpHostAdapter = class {
  #endpoint;
  #fetch;
  #connect;
  #lookup;
  #discoveryTimeoutMs;
  #lookupTimeoutMs;
  #maxConcurrentLookupsPerTarget;
  #actionLabel;
  #attachments = /* @__PURE__ */ new Map();
  #attaching = /* @__PURE__ */ new Set();
  #recoveries = /* @__PURE__ */ new Set();
  #recoveringTargets = /* @__PURE__ */ new Set();
  #stopController = new AbortController();
  #refreshPromise;
  #stopPromise;
  #state = "idle";
  constructor(options) {
    this.#endpoint = options.endpoint ?? "http://127.0.0.1:9223";
    this.#fetch = options.fetch;
    this.#connect = options.connect ?? connectCdpWebSocket;
    this.#lookup = options.lookup;
    this.#discoveryTimeoutMs = options.discoveryTimeoutMs ?? 3e3;
    this.#lookupTimeoutMs = options.lookupTimeoutMs ?? 5e3;
    this.#maxConcurrentLookupsPerTarget = options.maxConcurrentLookupsPerTarget ?? 8;
    this.#actionLabel = options.actionLabel;
    if (!Number.isSafeInteger(this.#lookupTimeoutMs) || this.#lookupTimeoutMs < 100 || this.#lookupTimeoutMs > 3e4) {
      throw new RangeError("lookupTimeoutMs must be an integer from 100 to 30000");
    }
    if (!Number.isSafeInteger(this.#maxConcurrentLookupsPerTarget) || this.#maxConcurrentLookupsPerTarget < 1 || this.#maxConcurrentLookupsPerTarget > 32) {
      throw new RangeError(
        "maxConcurrentLookupsPerTarget must be an integer from 1 to 32"
      );
    }
  }
  #isStopped() {
    return this.#state === "stopped";
  }
  async start(signal) {
    if (this.#isStopped()) {
      throw new Error("pointable_host_adapter_stopped");
    }
    this.#state = "running";
    try {
      return await this.refreshTargets(signal);
    } catch (error) {
      if (this.#isStopped()) return this.status();
      if (this.#attachments.size === 0) this.#state = "idle";
      throw error;
    }
  }
  refreshTargets(signal) {
    if (this.#isStopped()) {
      return Promise.reject(new Error("pointable_host_adapter_stopped"));
    }
    if (this.#refreshPromise !== void 0) return this.#refreshPromise;
    const combinedSignal = signal === void 0 ? this.#stopController.signal : AbortSignal.any([signal, this.#stopController.signal]);
    const refresh = this.#refreshTargets(combinedSignal).finally(() => {
      if (this.#refreshPromise === refresh) this.#refreshPromise = void 0;
    });
    this.#refreshPromise = refresh;
    return refresh;
  }
  async #refreshTargets(signal) {
    const targets = await discoverCodexAppTargets(this.#endpoint, {
      ...this.#fetch === void 0 ? {} : { fetch: this.#fetch },
      signal,
      timeoutMs: this.#discoveryTimeoutMs
    });
    if (this.#isStopped() || signal.aborted) return this.status();
    const targetIds = new Set(targets.map((target) => target.id));
    for (const [targetId, attachment] of this.#attachments) {
      if (this.#isStopped() || signal.aborted) return this.status();
      if (!targetIds.has(targetId) || attachment.connection.isClosed() || attachment.invalidated) {
        await this.#detach(attachment);
      }
    }
    for (const target of targets) {
      if (this.#isStopped() || signal.aborted) return this.status();
      if (this.#attachments.has(target.id) || [...this.#attaching].some((attachment) => attachment.target.id === target.id)) {
        continue;
      }
      await this.#attach(target, signal);
    }
    if (!this.#isStopped() && !signal.aborted) this.#state = "running";
    return this.status();
  }
  status() {
    return {
      state: this.#state,
      endpoint: this.#endpoint,
      targetCount: this.#attachments.size,
      targets: [...this.#attachments.values()].flatMap((attachment) => attachment.mainExecutionContextId === void 0 || attachment.rendererLifecycleId === void 0 ? [] : [{
        targetId: attachment.target.id,
        targetUrl: attachment.target.url,
        bindingName: attachment.bindingName,
        pendingLookups: attachment.inFlight.size,
        executionContextId: attachment.mainExecutionContextId,
        rendererLifecycleId: attachment.rendererLifecycleId
      }]).sort((left, right) => left.targetId.localeCompare(right.targetId))
    };
  }
  /**
   * Read unique active task tuples from qualified Codex main surfaces. This is
   * used only for an explicit local bind action; zero or multiple results must
   * be treated as unavailable/ambiguous by the caller.
   */
  async activeTasks(signal) {
    if (this.#isStopped() || signal?.aborted) return [];
    const byTask = /* @__PURE__ */ new Map();
    for (const attachment of this.#attachments.values()) {
      if (signal?.aborted) return [];
      const contextId = attachment.mainExecutionContextId;
      if (contextId === void 0 || attachment.connection.isClosed() || attachment.invalidated) {
        continue;
      }
      try {
        const evaluated = await attachment.connection.send("Runtime.evaluate", {
          expression: createReadCodexHostTaskContextExpression(),
          contextId,
          returnByValue: true,
          awaitPromise: true
        });
        const task = parseCodexHostTaskContext(runtimeValue(evaluated));
        if (task !== void 0) {
          byTask.set(`${task.hostId}\0${task.threadId}`, task);
        }
      } catch {
        return [];
      }
    }
    return [...byTask.values()];
  }
  stop() {
    if (this.#stopPromise !== void 0) return this.#stopPromise;
    if (this.#isStopped()) return Promise.resolve(this.status());
    this.#state = "stopped";
    this.#stopController.abort(new Error("pointable host stopped"));
    const stopping = (async () => {
      await this.#refreshPromise?.catch(() => void 0);
      await Promise.all(
        [.../* @__PURE__ */ new Set([...this.#attachments.values(), ...this.#attaching])].map((attachment) => this.#detach(attachment))
      );
      await Promise.all([...this.#recoveries].map((recovery) => recovery.catch(() => void 0)));
      await Promise.all(
        [.../* @__PURE__ */ new Set([...this.#attachments.values(), ...this.#attaching])].map((attachment) => this.#detach(attachment))
      );
      return this.status();
    })();
    this.#stopPromise = stopping;
    return stopping;
  }
  async #attach(target, signal) {
    if (this.#isStopped() || signal.aborted) return;
    const connection = await connectWithAbort(
      this.#connect(target.webSocketDebuggerUrl, signal),
      signal
    );
    const bindingGeneration = randomUUID();
    const bindingName = `__pointableContextBinding_${bindingGeneration.replaceAll("-", "_")}`;
    const attachment = {
      target,
      connection,
      unsubscribeEvent: () => void 0,
      unsubscribeClose: () => void 0,
      bindingName,
      bindingGeneration,
      bindingAdded: false,
      pending: /* @__PURE__ */ new Map(),
      inFlight: /* @__PURE__ */ new Set(),
      mainFrameId: "",
      contextWaiters: /* @__PURE__ */ new Set(),
      lifecycleController: new AbortController(),
      invalidated: false,
      detached: false
    };
    this.#attaching.add(attachment);
    attachment.unsubscribeEvent = connection.onEvent((event) => this.#onEvent(attachment, event));
    attachment.unsubscribeClose = connection.onClose(() => {
      this.#invalidateAttachment(attachment);
    });
    try {
      if (this.#isStopped() || signal.aborted) {
        await this.#detach(attachment);
        return;
      }
      await connection.send("Page.enable");
      if (this.#isStopped() || signal.aborted) {
        await this.#detach(attachment);
        return;
      }
      attachment.mainFrameId = parseMainFrameId(
        await connection.send("Page.getFrameTree"),
        target
      );
      await connection.send("Runtime.enable");
      const contextId = await waitForMainContext(
        attachment,
        AbortSignal.any([signal, attachment.lifecycleController.signal])
      );
      if (this.#isStopped() || signal.aborted || attachment.invalidated || connection.isClosed()) {
        await this.#detach(attachment);
        return;
      }
      attachment.mainExecutionContextId = contextId;
      await connection.send("Runtime.addBinding", { name: bindingName });
      attachment.bindingAdded = true;
      if (this.#isStopped() || signal.aborted || attachment.invalidated) {
        await this.#detach(attachment);
        return;
      }
      const rendererConfig = {
        bindingName,
        requestTimeoutMs: this.#lookupTimeoutMs,
        ...this.#actionLabel === void 0 ? {} : { actionLabel: this.#actionLabel }
      };
      const installed = await connection.send("Runtime.evaluate", {
        expression: createInstallPointableRendererExpression(rendererConfig),
        contextId,
        returnByValue: true,
        awaitPromise: true
      });
      const rendererStatus = parseInstalledStatus(
        runtimeValue(installed),
        bindingName
      );
      attachment.rendererLifecycleId = rendererStatus.lifecycleId;
      if (this.#isStopped() || signal.aborted || attachment.invalidated || connection.isClosed()) {
        await this.#detach(attachment);
        return;
      }
      if (this.#attachments.has(target.id)) {
        await this.#detach(attachment);
        return;
      }
      this.#attachments.set(target.id, attachment);
    } catch (error) {
      await this.#detach(attachment);
      if (this.#isStopped() || signal.aborted) return;
      throw error;
    } finally {
      this.#attaching.delete(attachment);
    }
  }
  async #onEvent(attachment, event) {
    if (attachment.detached) return;
    const contextId = mainExecutionContext(event, attachment.mainFrameId);
    if (contextId !== void 0) {
      if (attachment.mainExecutionContextId !== void 0 && attachment.mainExecutionContextId !== contextId) {
        this.#invalidateAttachment(attachment);
        return;
      }
      attachment.mainExecutionContextId = contextId;
      for (const waiter of attachment.contextWaiters) waiter(contextId);
      attachment.contextWaiters.clear();
      return;
    }
    if (event.method === "Runtime.executionContextsCleared") {
      this.#invalidateAttachment(attachment);
      return;
    }
    if (event.method === "Runtime.executionContextDestroyed" && record5(event.params) && event.params.executionContextId === attachment.mainExecutionContextId) {
      this.#invalidateAttachment(attachment);
      return;
    }
    if (event.method === "Page.frameNavigated" && record5(event.params) && record5(event.params.frame) && event.params.frame.id === attachment.mainFrameId && attachment.mainFrameId.length > 0) {
      this.#invalidateAttachment(attachment);
      return;
    }
    if (event.method !== "Runtime.bindingCalled" || !record5(event.params)) return;
    if (event.params.name !== attachment.bindingName || typeof event.params.payload !== "string" || event.params.executionContextId !== attachment.mainExecutionContextId || this.#attachments.get(attachment.target.id) !== attachment || attachment.rendererLifecycleId === void 0 || attachment.invalidated) {
      return;
    }
    let intent;
    try {
      intent = parsePointableLookupIntent(event.params.payload);
    } catch {
      return;
    }
    if (attachment.inFlight.has(intent.requestId) || attachment.inFlight.size >= this.#maxConcurrentLookupsPerTarget) {
      return;
    }
    attachment.inFlight.add(intent.requestId);
    let controller;
    try {
      if (!await this.#rendererFenceCurrent(attachment, intent)) return;
      const hostTask = await this.#readHostTaskContext(attachment, intent);
      if (hostTask === false) return;
      controller = new AbortController();
      attachment.pending.set(intent.requestId, {
        controller,
        digest: intent.selectionDigest,
        generation: intent.selectionGeneration
      });
      let presentation;
      try {
        const callbackResult = await boundedLookup(
          (lookupSignal) => this.#lookup({
            operation: intent.operation,
            requestId: intent.requestId,
            selection: {
              text: intent.selectionText,
              digest: intent.selectionDigest,
              generation: intent.selectionGeneration,
              surface: intent.surface
            },
            contextFingerprint: intent.contextFingerprint,
            requestedAt: intent.requestedAt,
            ...intent.candidateRef === void 0 ? {} : { candidateRef: intent.candidateRef },
            ...intent.detailRef === void 0 ? {} : { detailRef: intent.detailRef },
            host: {
              targetId: attachment.target.id,
              targetUrl: attachment.target.url,
              bindingGeneration: attachment.bindingGeneration,
              ...hostTask === void 0 ? {} : {
                task: hostTask,
                revalidateTask: async (signal) => {
                  if (signal?.aborted) return void 0;
                  const current = await this.#readHostTaskContext(attachment, intent);
                  return current === false ? void 0 : current;
                }
              }
            },
            signal: lookupSignal
          }),
          this.#lookupTimeoutMs,
          controller
        );
        presentation = validatePointableLookupPresentation(callbackResult);
      } catch (error) {
        if (error instanceof PointableProtocolError) {
          presentation = lookupError(
            "invalid_lookup_result",
            "\u67E5\u8BE2\u63D0\u4F9B\u65B9\u8FD4\u56DE\u4E86\u65E0\u6548\u7ED3\u679C\u3002",
            false
          );
        } else if (error instanceof Error && error.message === "pointable_lookup_timeout") {
          presentation = lookupError("lookup_timeout", "\u67E5\u8BE2\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5\u3002", true);
        } else if (controller.signal.aborted) {
          return;
        } else {
          presentation = lookupError(
            "lookup_failed",
            "\u4E0A\u4E0B\u6587\u8BE6\u60C5\u6682\u65F6\u4E0D\u53EF\u7528\u3002",
            true
          );
        }
      }
      const pending = attachment.pending.get(intent.requestId);
      if (pending === void 0 || pending.digest !== intent.selectionDigest || pending.generation !== intent.selectionGeneration || this.#attachments.get(attachment.target.id) !== attachment || attachment.connection.isClosed() || attachment.invalidated) {
        return;
      }
      if (!await this.#rendererFenceCurrent(attachment, intent)) return;
      await this.#deliver(attachment, intent, presentation);
    } finally {
      if (controller !== void 0) attachment.pending.delete(intent.requestId);
      attachment.inFlight.delete(intent.requestId);
    }
  }
  async #readHostTaskContext(attachment, intent) {
    const contextId = attachment.mainExecutionContextId;
    if (contextId === void 0 || this.#attachments.get(attachment.target.id) !== attachment || attachment.connection.isClosed() || attachment.invalidated) {
      return false;
    }
    try {
      const evaluated = await attachment.connection.send("Runtime.evaluate", {
        expression: createReadCodexHostTaskContextExpression(),
        contextId,
        returnByValue: true,
        awaitPromise: true
      });
      return parseCodexHostTaskContext(
        runtimeValue(evaluated),
        intent.contextFingerprint
      );
    } catch {
      return false;
    }
  }
  async #rendererFenceCurrent(attachment, intent) {
    const contextId = attachment.mainExecutionContextId;
    const lifecycleId = attachment.rendererLifecycleId;
    if (contextId === void 0 || lifecycleId === void 0 || this.#attachments.get(attachment.target.id) !== attachment || attachment.connection.isClosed() || attachment.invalidated) {
      return false;
    }
    try {
      const evaluated = await attachment.connection.send("Runtime.evaluate", {
        expression: createVerifyPointableRendererFenceExpression({
          requestId: intent.requestId,
          selectionGeneration: intent.selectionGeneration,
          selectionDigest: intent.selectionDigest,
          contextFingerprint: intent.contextFingerprint
        }, lifecycleId),
        contextId,
        returnByValue: true,
        awaitPromise: true
      });
      return runtimeValue(evaluated) === true;
    } catch {
      return false;
    }
  }
  async #deliver(attachment, intent, presentation) {
    const contextId = attachment.mainExecutionContextId;
    const lifecycleId = attachment.rendererLifecycleId;
    if (contextId === void 0 || lifecycleId === void 0 || this.#attachments.get(attachment.target.id) !== attachment || attachment.connection.isClosed() || attachment.invalidated) {
      return;
    }
    const response = createPointableLookupResponse(intent, presentation);
    await attachment.connection.send("Runtime.evaluate", {
      expression: createDeliverPointableResultExpression(response, lifecycleId),
      contextId,
      returnByValue: true,
      awaitPromise: true
    });
  }
  #invalidateAttachment(attachment) {
    if (attachment.invalidated || attachment.detached) return;
    attachment.invalidated = true;
    attachment.lifecycleController.abort(
      new Error("pointable renderer context invalidated")
    );
    for (const pending of attachment.pending.values()) {
      pending.controller.abort(new Error("pointable renderer context invalidated"));
    }
    attachment.pending.clear();
    attachment.inFlight.clear();
    if (this.#attachments.get(attachment.target.id) !== attachment || this.#isStopped() || this.#recoveringTargets.has(attachment.target.id)) {
      return;
    }
    this.#attachments.delete(attachment.target.id);
    this.#recoveringTargets.add(attachment.target.id);
    const recovery = (async () => {
      await this.#detach(attachment);
      if (!this.#isStopped()) {
        await this.refreshTargets().catch(() => void 0);
      }
    })().finally(() => {
      this.#recoveringTargets.delete(attachment.target.id);
      this.#recoveries.delete(recovery);
    });
    this.#recoveries.add(recovery);
  }
  #detach(attachment) {
    if (attachment.detachPromise !== void 0) return attachment.detachPromise;
    const detach = this.#performDetach(attachment);
    attachment.detachPromise = detach;
    return detach;
  }
  async #performDetach(attachment) {
    attachment.detached = true;
    attachment.invalidated = true;
    attachment.lifecycleController.abort(new Error("pointable host detached"));
    if (this.#attachments.get(attachment.target.id) === attachment) {
      this.#attachments.delete(attachment.target.id);
    }
    this.#attaching.delete(attachment);
    attachment.unsubscribeEvent();
    attachment.unsubscribeClose();
    attachment.contextWaiters.clear();
    for (const pending of attachment.pending.values()) {
      pending.controller.abort(new Error("pointable host detached"));
    }
    attachment.pending.clear();
    attachment.inFlight.clear();
    if (!attachment.connection.isClosed()) {
      if (attachment.rendererLifecycleId !== void 0 && attachment.mainExecutionContextId !== void 0) {
        await attachment.connection.send("Runtime.evaluate", {
          expression: createUninstallPointableRendererExpression(
            attachment.rendererLifecycleId
          ),
          contextId: attachment.mainExecutionContextId,
          returnByValue: true,
          awaitPromise: true
        }).catch(() => void 0);
      }
      if (attachment.bindingAdded) {
        await attachment.connection.send("Runtime.removeBinding", {
          name: attachment.bindingName
        }).catch(() => void 0);
      }
      attachment.connection.close();
    }
  }
};

// src/host/codex-cdp/fixture-lookup.ts
import { createHash as createHash2, randomBytes as randomBytes2 } from "node:crypto";
import { resolve as resolve2 } from "node:path";

// src/lookup-service.ts
import {
  createHmac,
  randomBytes,
  randomUUID as randomUUID2,
  timingSafeEqual
} from "node:crypto";
import { performance } from "node:perf_hooks";

// src/resolver.ts
function toCandidate(record7, attempt) {
  const match = {
    scope: copyContextScope(record7.scope),
    entityId: record7.entityId,
    entityType: record7.entityType,
    label: record7.canonicalName,
    summary: record7.summary,
    matchKind: attempt.kind,
    indexRevision: record7.indexRevision,
    indexedAt: record7.indexedAt,
    detailFreshness: "unknown"
  };
  return { match, record: record7 };
}
function deduplicateAndSort(candidates2) {
  const byEntity = /* @__PURE__ */ new Map();
  for (const candidate of candidates2) {
    byEntity.set(candidate.record.entityId, candidate);
  }
  return [...byEntity.values()].sort(
    (left, right) => left.record.entityId.localeCompare(right.record.entityId, "en")
  );
}
function exactIdMatch(selection, record7) {
  const keys = [record7.canonicalKey, record7.entityId].filter(
    (value) => Boolean(value)
  );
  for (const key of keys) {
    const matchedText = findBoundedLiteral(selection, key);
    if (matchedText) {
      return { kind: "exact_id", matchedText };
    }
  }
  return void 0;
}
function exactNameMatch(selection, record7) {
  const matchedText = findLiteralPhrase(selection, record7.canonicalName);
  return matchedText ? { kind: "exact_name", matchedText } : void 0;
}
function exactAliasMatch(selection, record7) {
  for (const alias of record7.aliases) {
    const matchedText = findLiteralPhrase(selection, alias);
    if (matchedText) {
      return { kind: "exact_alias", matchedText };
    }
  }
  return void 0;
}
function normalizedMatch(normalizedSelection, record7) {
  const values = [
    record7.canonicalKey,
    record7.entityId,
    record7.canonicalName,
    ...record7.aliases
  ].filter((value) => Boolean(value));
  for (const value of values) {
    const normalizedValue = normalizeText(value);
    const matchedText = findLiteralPhrase(normalizedSelection, normalizedValue);
    if (matchedText) {
      return { kind: "normalized_exact", matchedText: normalizedValue };
    }
  }
  return void 0;
}
function route(candidates2) {
  if (candidates2.length === 0) {
    return { kind: "no_match" };
  }
  if (candidates2.length === 1) {
    return { kind: "unique", candidate: candidates2[0] };
  }
  if (new Set(candidates2.map((candidate) => candidate.record.entityType)).size > 1) {
    return {
      kind: "overflow",
      candidateCount: candidates2.length,
      reason: "mixed_types"
    };
  }
  if (candidates2.every((candidate) => candidate.match.matchKind === "normalized_exact")) {
    return {
      kind: "overflow",
      candidateCount: candidates2.length,
      reason: "ambiguous_normalized"
    };
  }
  if (candidates2.length <= 3) {
    return { kind: "candidates", candidates: candidates2 };
  }
  return {
    kind: "overflow",
    candidateCount: candidates2.length,
    reason: "too_many"
  };
}
function resolveSelection(scope, selection, records) {
  assertContextIndexResolutionBudget(records, selection);
  const scoped = records.filter(
    (record7) => sameContextScope(record7.scope, scope) && !record7.deleted
  );
  const normalizedSelection = normalizeText(selection);
  const layers = [
    exactIdMatch,
    exactNameMatch,
    exactAliasMatch,
    (_selection, record7) => normalizedMatch(normalizedSelection, record7)
  ];
  for (const matchLayer of layers) {
    const candidates2 = deduplicateAndSort(
      scoped.flatMap((record7) => {
        const attempt = matchLayer(selection, record7);
        return attempt ? [toCandidate(record7, attempt)] : [];
      })
    );
    if (candidates2.length > 0) {
      return route(candidates2);
    }
  }
  return { kind: "no_match" };
}

// src/text-renderer.ts
import { Buffer as Buffer3 } from "node:buffer";
var MAX_OUTPUT_BYTES = 16384;
function exposeInvisibleCharacters(value) {
  let result = "";
  for (const character of String(value)) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 31 || codePoint >= 127 && codePoint <= 159 || codePoint === 8232 || codePoint === 8233) {
      result += " ";
    } else if (/[\p{Bidi_Control}\p{Default_Ignorable_Code_Point}]/u.test(character) || codePoint >= 55296 && codePoint <= 57343) {
      result += `\u27E6U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}\u27E7`;
    } else {
      result += character;
    }
  }
  return result;
}
function escapeEmphasisUnderscores(value) {
  return value.replace(/_+/gu, (run, offset, input) => {
    const before = [...input.slice(0, offset)].at(-1) ?? "";
    const after = [...input.slice(offset + run.length)][0] ?? "";
    const isWord = (character) => /[\p{L}\p{N}]/u.test(character);
    return isWord(before) && isWord(after) ? run : run.replace(/_/gu, "\\_");
  });
}
function truncateCharacters(value, maximumCharacters) {
  let result = "";
  let count = 0;
  for (const character of value) {
    if (count >= maximumCharacters) return `${result}\u2026`;
    result += character;
    count += 1;
  }
  return result;
}
function plain(value, maximumLength = 1024) {
  const sanitized = escapeEmphasisUnderscores(exposeInvisibleCharacters(value).replace(/\s+/gu, " ").replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/\\/gu, "\\\\").replace(/([`*\[\]{}()!~|>])/gu, "\\$1").replace(/\b(https?|ftp):\/\//giu, "$1\\://").replace(/\bwww\./giu, "www\\.").replace(/@/gu, "\\@").trim());
  return truncateCharacters(sanitized, maximumLength);
}
function factText(value) {
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => plain(item, 512)).join(", ");
  }
  return value === null ? "\u672A\u8BBE\u7F6E" : plain(value, 1024);
}
function truncateUtf8(value, maximumBytes) {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer3.byteLength(character, "utf8");
    if (bytes + characterBytes > maximumBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}
function boundedOutput(lines) {
  const text = lines.join("\n");
  if (Buffer3.byteLength(text, "utf8") <= MAX_OUTPUT_BYTES) return text;
  const suffix = "\n\u2026[\u8F93\u51FA\u5DF2\u622A\u65AD]";
  const available = MAX_OUTPUT_BYTES - Buffer3.byteLength(suffix, "utf8");
  return `${truncateUtf8(text, available)}${suffix}`;
}
function overflowAdvice(outcome) {
  switch (outcome.reason) {
    case "mixed_types":
      return "\u9009\u533A\u540C\u65F6\u547D\u4E2D\u4E0D\u540C\u7C7B\u578B\u5BF9\u8C61\uFF0C\u8BF7\u4E00\u6B21\u53EA\u9009\u62E9\u4E00\u79CD\u5BF9\u8C61\u3002";
    case "ambiguous_normalized":
      return "\u89C4\u8303\u5316\u540D\u79F0\u5B58\u5728\u6B67\u4E49\uFF0C\u8BF7\u9009\u62E9\u66F4\u7CBE\u786E\u7684\u5BF9\u8C61 Key \u6216\u5B8C\u6574\u540D\u79F0\u3002";
    case "too_many":
      return "\u5019\u9009\u8FC7\u591A\uFF0C\u672A\u5C55\u793A\u957F\u5217\u8868\u3002\u8BF7\u7F29\u5C0F\u9009\u533A\u6216\u4F7F\u7528\u4E0A\u4E0B\u6587\u641C\u7D22\u3002";
  }
}
function renderLookupOutcome(outcome) {
  switch (outcome.kind) {
    case "detail": {
      const detail = outcome.detail;
      const displayedSources = detail.sourceRefs.slice(0, 5);
      const remainingSources = detail.sourceRefs.length - displayedSources.length;
      const displayedFacts = Object.entries(detail.facts).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).slice(0, 5);
      const remainingFacts = Object.keys(detail.facts).length - displayedFacts.length;
      const lines = [
        `\u5BF9\u8C61: ${plain(outcome.candidate.label, 512)} (${plain(detail.entityId, 256)})`,
        `\u7C7B\u578B: ${plain(detail.entityType, 256)}`,
        `\u4E0A\u4E0B\u6587: ${plain(detail.scope.kind, 32)} \xB7 ${plain(detail.scope.namespace, 256)} \xB7 ${plain(detail.scope.id, 256)}`,
        `Freshness: ${plain(detail.freshness, 32)}`,
        `Revision: ${plain(detail.entityRevision, 512)}`,
        `Observed at: ${plain(detail.observedAt, 64)}`,
        `Verification: ${plain(outcome.verification.method, 32)}`,
        `Verified at: ${plain(outcome.verification.verifiedAt, 64)}`,
        ...outcome.verification.method === "revision_check" ? [`Verified revision: ${plain(outcome.verification.verifiedRevision, 512)}`] : [],
        `Sources: ${displayedSources.length}/${detail.sourceRefs.length}${remainingSources > 0 ? ` (+${remainingSources} more)` : ""}`,
        ...displayedSources.flatMap((source, index) => [
          `Source ${index + 1} type: ${plain(source.sourceType, 128)}`,
          `Source ${index + 1} id: ${plain(source.sourceId, 256)}`
        ]),
        `Facts: ${displayedFacts.length}/${Object.keys(detail.facts).length}${remainingFacts > 0 ? ` (+${remainingFacts} more)` : ""}`
      ];
      for (const [key, value] of displayedFacts) {
        lines.push(`Fact[${plain(key, 128)}]: ${factText(value)}`);
      }
      return boundedOutput(lines);
    }
    case "candidates": {
      const displayedCandidates = outcome.candidates.slice(0, 3);
      const remainingCandidates = outcome.candidates.length - displayedCandidates.length;
      return boundedOutput([
        `\u53D1\u73B0 ${outcome.candidates.length} \u4E2A\u4E0A\u4E0B\u6587\u5BF9\u8C61\uFF0C\u8BF7\u9009\u62E9\uFF1A`,
        ...displayedCandidates.flatMap((candidate, index) => [
          `${index + 1}. ${plain(candidate.label, 512)} \xB7 ${plain(candidate.entityType, 256)} \xB7 ${plain(candidate.scope.kind, 32)}:${plain(candidate.scope.namespace, 256)}:${plain(candidate.scope.id, 256)} \xB7 ${plain(candidate.matchKind, 64)}`,
          `   \u6458\u8981: ${plain(candidate.summary, 512)}`,
          `   \u8BE6\u60C5\u65B0\u9C9C\u5EA6: ${plain(candidate.detailFreshness, 32)} \xB7 \u7D22\u5F15\u4E8E ${plain(candidate.indexedAt, 64)} \xB7 \u7D22\u5F15\u7248\u672C ${plain(candidate.indexRevision, 128)}`
        ]),
        ...remainingCandidates > 0 ? [`\u5176\u4F59 ${remainingCandidates} \u4E2A\u5019\u9009\u672A\u5C55\u5F00\u3002`] : []
      ]);
    }
    case "no_match":
      return "\u5F53\u524D\u4E0A\u4E0B\u6587\u672A\u627E\u5230\u5339\u914D\u5BF9\u8C61\u3002\u8BF7\u7F29\u5C0F\u9009\u533A\u6216\u8BE2\u95EE Agent\u3002";
    case "overflow":
      return boundedOutput([
        `\u53D1\u73B0 ${outcome.candidateCount} \u4E2A\u5019\u9009\u3002`,
        overflowAdvice(outcome)
      ]);
    case "blocked":
      return `\u67E5\u8BE2\u5DF2\u963B\u6B62\uFF1A${plain(outcome.reason, 128)}\u3002`;
    case "unavailable":
      return `\u8BE6\u60C5\u4E0D\u53EF\u7528\uFF1A${plain(outcome.reason, 128)}${outcome.retryable ? "\uFF0C\u53EF\u4EE5\u91CD\u8BD5" : ""}\u3002`;
  }
}

// src/lookup-service.ts
function blocked(reason) {
  const outcome = { kind: "blocked", reason, fallbackText: "" };
  outcome.fallbackText = renderLookupOutcome(outcome);
  return outcome;
}
function noMatch() {
  const outcome = { kind: "no_match", fallbackText: "" };
  outcome.fallbackText = renderLookupOutcome(outcome);
  return outcome;
}
function candidates(matches) {
  const outcome = {
    kind: "candidates",
    candidates: matches,
    fallbackText: ""
  };
  outcome.fallbackText = renderLookupOutcome(outcome);
  return outcome;
}
function overflow(candidateCount, reason) {
  const outcome = {
    kind: "overflow",
    candidateCount,
    reason,
    fallbackText: ""
  };
  outcome.fallbackText = renderLookupOutcome(outcome);
  return outcome;
}
function unavailable(reason, retryable) {
  const outcome = {
    kind: "unavailable",
    reason,
    retryable,
    fallbackText: ""
  };
  outcome.fallbackText = renderLookupOutcome(outcome);
  return outcome;
}
var RequestAbortedError = class extends Error {
  constructor() {
    super("lookup request was aborted by its caller");
    this.name = "RequestAbortedError";
  }
};
var OperationTimeoutError = class extends Error {
  constructor(operation) {
    super(`${operation} exceeded its deadline`);
    this.operation = operation;
    this.name = "OperationTimeoutError";
  }
  operation;
};
function interruptionOutcome(error) {
  if (error instanceof RequestAbortedError) {
    return blocked("request_aborted");
  }
  if (error instanceof OperationTimeoutError) {
    return unavailable("operation_timeout", true);
  }
  return void 0;
}
function runBounded(operationName, operation, callerSignal, timeoutMs) {
  return new Promise((resolve4, reject) => {
    const controller = new AbortController();
    const deadlineAt = performance.now() + timeoutMs;
    let settled = false;
    let timer;
    const cleanup = () => {
      if (timer !== void 0) clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    };
    const settleSuccess = (value) => {
      if (settled) return;
      if (performance.now() >= deadlineAt) {
        abortAndFail(new OperationTimeoutError(operationName));
        return;
      }
      settled = true;
      cleanup();
      resolve4(value);
    };
    const settleFailure = (error) => {
      if (settled) return;
      if (performance.now() >= deadlineAt) {
        abortAndFail(new OperationTimeoutError(operationName));
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const abortAndFail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      controller.abort(error);
      reject(error);
    };
    function onCallerAbort() {
      abortAndFail(new RequestAbortedError());
    }
    if (callerSignal?.aborted) {
      abortAndFail(new RequestAbortedError());
      return;
    }
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    timer = setTimeout(
      () => abortAndFail(new OperationTimeoutError(operationName)),
      timeoutMs
    );
    queueMicrotask(() => {
      if (settled) return;
      try {
        operation(controller.signal).then(settleSuccess, settleFailure);
      } catch (error) {
        settleFailure(error);
      }
    });
  });
}
function bindingFailure(kind) {
  switch (kind) {
    case "missing":
      return blocked("context_binding_missing");
    case "ambiguous":
      return blocked("context_binding_ambiguous");
    case "context_changed":
      return blocked("context_changed");
  }
}
function sameBinding(left, right) {
  return sameContextScope(left.scope, right.scope) && left.bindingRevision === right.bindingRevision && left.evidence === right.evidence && left.selectionGeneration === right.selectionGeneration && left.threadRef === right.threadRef && left.routeRef === right.routeRef && left.workspaceRoot === right.workspaceRoot;
}
function boundedText(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 4096;
}
function optionalBoundedText(value) {
  return value === void 0 || boundedText(value);
}
function parseContextScope(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return void 0;
  }
  try {
    const raw = value;
    const kind = raw.kind;
    const namespace = raw.namespace;
    const id = raw.id;
    if (!isContextScopeKind(kind) || !boundedText(namespace) || !boundedText(id)) {
      return void 0;
    }
    return Object.freeze({ kind, namespace, id });
  } catch {
    return void 0;
  }
}
function parseBindingResult(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return void 0;
  }
  try {
    const raw = value;
    const kind = raw.kind;
    if (kind === "missing" || kind === "context_changed") {
      return Object.freeze({ kind });
    }
    if (kind === "ambiguous") {
      const rawScopes = raw.scopes;
      if (!Array.isArray(rawScopes)) return void 0;
      const length = rawScopes.length;
      if (length < 1 || length > 100) return void 0;
      const scopes = [];
      for (let index = 0; index < length; index += 1) {
        const scope2 = parseContextScope(rawScopes[index]);
        if (!scope2) return void 0;
        scopes.push(scope2);
      }
      return Object.freeze({ kind, scopes: Object.freeze(scopes) });
    }
    if (kind !== "trusted") return void 0;
    const scope = parseContextScope(raw.scope);
    const bindingRevision = raw.bindingRevision;
    const evidence = raw.evidence;
    const selectionGeneration = raw.selectionGeneration;
    const threadRef = raw.threadRef;
    const routeRef = raw.routeRef;
    const workspaceRoot = raw.workspaceRoot;
    if (!scope || !boundedText(bindingRevision) || evidence !== "verified_thread" && evidence !== "verified_workspace" && evidence !== "explicit_user" && evidence !== "fixture_manifest" || !Number.isSafeInteger(selectionGeneration) || Number(selectionGeneration) < 0 || !optionalBoundedText(threadRef) || !optionalBoundedText(routeRef) || !optionalBoundedText(workspaceRoot) || evidence === "verified_thread" && threadRef === void 0 || (evidence === "verified_workspace" || evidence === "fixture_manifest") && workspaceRoot === void 0) {
      return void 0;
    }
    const binding = {
      kind,
      scope,
      bindingRevision,
      evidence,
      selectionGeneration
    };
    if (threadRef !== void 0) binding.threadRef = threadRef;
    if (routeRef !== void 0) binding.routeRef = routeRef;
    if (workspaceRoot !== void 0) binding.workspaceRoot = workspaceRoot;
    return Object.freeze(binding);
  } catch {
    return void 0;
  }
}
function parseHostContext(value) {
  try {
    const selectionGeneration = value.selectionGeneration;
    const rawScope = value.explicitScope;
    const threadRef = value.threadRef;
    const routeRef = value.routeRef;
    const workspaceRoot = value.workspaceRoot;
    if (rawScope === void 0) return { kind: "missing_scope" };
    const explicitScope = parseContextScope(rawScope);
    if (!explicitScope || !Number.isSafeInteger(selectionGeneration) || selectionGeneration < 0 || !optionalBoundedText(threadRef) || !optionalBoundedText(routeRef) || !optionalBoundedText(workspaceRoot)) {
      return { kind: "invalid" };
    }
    const context = { selectionGeneration, explicitScope };
    if (threadRef !== void 0) context.threadRef = threadRef;
    if (routeRef !== void 0) context.routeRef = routeRef;
    if (workspaceRoot !== void 0) context.workspaceRoot = workspaceRoot;
    return { kind: "valid", context: Object.freeze(context) };
  } catch {
    return { kind: "invalid" };
  }
}
function isAuthorityResult(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value;
  if (candidate.kind === "not_found" || candidate.kind === "access_denied") {
    return true;
  }
  if (candidate.kind === "unavailable") {
    return typeof candidate.retryable === "boolean";
  }
  return candidate.kind === "snapshot" && typeof candidate.snapshot === "object" && candidate.snapshot !== null && typeof candidate.verification === "object" && candidate.verification !== null;
}
function bindingMatchesIntent(binding, selection, hostContext) {
  return binding.selectionGeneration === selection.selectionGeneration && binding.selectionGeneration === hostContext.selectionGeneration && sameContextScope(binding.scope, hostContext.explicitScope) && binding.threadRef === hostContext.threadRef && binding.routeRef === hostContext.routeRef && binding.workspaceRoot === hostContext.workspaceRoot && (binding.evidence !== "verified_thread" || binding.threadRef !== void 0) && (binding.evidence !== "verified_workspace" || binding.workspaceRoot !== void 0) && (binding.evidence !== "fixture_manifest" || binding.workspaceRoot !== void 0);
}
var LookupService = class {
  constructor(binding, index, providers, options = {}) {
    this.binding = binding;
    this.index = index;
    const operationTimeoutMs = options.operationTimeoutMs ?? 5e3;
    if (!Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 10 || operationTimeoutMs > 3e4) {
      throw new RangeError("operationTimeoutMs must be an integer from 10 to 30000");
    }
    this.#operationTimeoutMs = operationTimeoutMs;
    for (const provider of providers) {
      if (this.#providers.has(provider.providerId)) {
        throw new Error(`duplicate provider: ${provider.providerId}`);
      }
      this.#providers.set(provider.providerId, provider);
    }
  }
  binding;
  index;
  #providers = /* @__PURE__ */ new Map();
  #activations = /* @__PURE__ */ new Map();
  #activationSecret = randomBytes(32);
  #nonceTtlMs = 5 * 6e4;
  #maxActivations = 4096;
  #operationTimeoutMs;
  /**
   * Host-private activation boundary. Call only from the handler for a verified
   * explicit user action; never expose this method as a public data/MCP tool.
   * The returned ticket is service-minted and bound to the selection, context,
   * and optional candidate.
   */
  issueActivation(selection, hostContext, chosenEntityId) {
    const eligibility = evaluateEligibility(selection);
    if (eligibility.kind === "ineligible") {
      return eligibility;
    }
    const parsedHostContext = parseHostContext(hostContext);
    if (parsedHostContext.kind === "missing_scope") {
      return { kind: "ineligible", reason: "missing_scope" };
    }
    if (parsedHostContext.kind === "invalid") {
      return { kind: "ineligible", reason: "invalid_host_context" };
    }
    if (selection.selectionGeneration !== parsedHostContext.context.selectionGeneration) {
      return { kind: "ineligible", reason: "invalid_generation" };
    }
    const now = Date.now();
    this.#pruneActivations(now);
    if (this.#activations.size >= this.#maxActivations) {
      return { kind: "capacity_exceeded" };
    }
    const ticket = {
      activationNonce: `act:${randomUUID2()}`,
      activatedAt: now
    };
    this.#activations.set(ticket.activationNonce, {
      activatedAt: now,
      digest: this.#activationDigest(
        selection,
        parsedHostContext.context,
        chosenEntityId
      ),
      state: "pending"
    });
    return { kind: "issued", ticket };
  }
  async submitLookupIntent(intent, signal) {
    if (signal?.aborted) {
      return blocked("request_aborted");
    }
    const parsedHostContext = parseHostContext(intent.hostContext);
    if (parsedHostContext.kind !== "valid") {
      return blocked("invalid_activation");
    }
    const activationFailure = this.#consumeActivation(
      intent,
      parsedHostContext.context
    );
    if (activationFailure) {
      return activationFailure;
    }
    const eligibility = evaluateEligibility(intent.selection);
    if (eligibility.kind === "ineligible") {
      return blocked("invalid_activation");
    }
    let bindingResult;
    try {
      bindingResult = await runBounded(
        "binding.resolve",
        (operationSignal) => this.binding.resolve(parsedHostContext.context, operationSignal),
        signal,
        this.#operationTimeoutMs
      );
    } catch (error) {
      const interruption = interruptionOutcome(error);
      if (interruption) return interruption;
      return blocked("context_binding_unavailable");
    }
    const parsedBindingResult = parseBindingResult(bindingResult);
    if (!parsedBindingResult) {
      return blocked("context_binding_unavailable");
    }
    if (parsedBindingResult.kind !== "trusted") {
      return bindingFailure(parsedBindingResult.kind);
    }
    if (!bindingMatchesIntent(
      parsedBindingResult,
      intent.selection,
      parsedHostContext.context
    )) {
      return blocked("context_changed");
    }
    const trustedBinding = parsedBindingResult;
    let records;
    try {
      const rawRecords = await runBounded(
        "index.list",
        (operationSignal) => this.index.list(trustedBinding, operationSignal),
        signal,
        this.#operationTimeoutMs
      );
      records = validateContextIndexForRuntime(
        rawRecords,
        trustedBinding.scope,
        eligibility.selection.text
      );
    } catch (error) {
      const interruption = interruptionOutcome(error);
      if (interruption) return interruption;
      return error instanceof ContractError ? blocked("authority_contract_invalid") : unavailable("provider_unavailable", true);
    }
    const afterIndex = await this.#revalidate(trustedBinding, signal);
    if (afterIndex) return afterIndex;
    if (signal?.aborted) return blocked("request_aborted");
    const resolution = resolveSelection(
      trustedBinding.scope,
      eligibility.selection.text,
      records
    );
    switch (resolution.kind) {
      case "no_match":
        return intent.chosenEntityId ? blocked("invalid_candidate") : noMatch();
      case "overflow":
        return intent.chosenEntityId ? blocked("invalid_candidate") : overflow(resolution.candidateCount, resolution.reason);
      case "candidates": {
        if (!intent.chosenEntityId) {
          return candidates(resolution.candidates.map((candidate) => candidate.match));
        }
        const chosen = resolution.candidates.find(
          (candidate) => candidate.record.entityId === intent.chosenEntityId
        );
        return chosen ? this.#readDetail(trustedBinding, chosen, signal) : blocked("invalid_candidate");
      }
      case "unique":
        if (intent.chosenEntityId && intent.chosenEntityId !== resolution.candidate.record.entityId) {
          return blocked("invalid_candidate");
        }
        return this.#readDetail(trustedBinding, resolution.candidate, signal);
    }
  }
  #activationDigest(selection, hostContext, chosenEntityId) {
    const payload = JSON.stringify([
      selection.text,
      selection.surface,
      selection.selectionGeneration,
      hostContext.selectionGeneration,
      contextScopeTuple(hostContext.explicitScope),
      hostContext.threadRef ?? null,
      hostContext.routeRef ?? null,
      hostContext.workspaceRoot ?? null,
      chosenEntityId ?? null
    ]);
    return createHmac("sha256", this.#activationSecret).update(payload).digest();
  }
  #consumeActivation(intent, hostContext) {
    const now = Date.now();
    this.#pruneActivations(now);
    if (!/^[A-Za-z0-9:_-]{8,128}$/u.test(intent.activationNonce)) {
      return blocked("invalid_activation");
    }
    const record7 = this.#activations.get(intent.activationNonce);
    if (!record7 || record7.activatedAt !== intent.activatedAt) {
      return blocked("invalid_activation");
    }
    if (record7.state === "consumed") {
      return blocked("replayed_activation");
    }
    const presented = this.#activationDigest(
      intent.selection,
      hostContext,
      intent.chosenEntityId
    );
    if (presented.length !== record7.digest.length || !timingSafeEqual(presented, record7.digest)) {
      return blocked("invalid_activation");
    }
    record7.state = "consumed";
    return void 0;
  }
  #pruneActivations(now) {
    for (const [nonce, record7] of this.#activations) {
      if (now - record7.activatedAt > this.#nonceTtlMs) {
        this.#activations.delete(nonce);
      }
    }
  }
  async #revalidate(trustedBinding, callerSignal) {
    let revalidated;
    try {
      revalidated = await runBounded(
        "binding.revalidate",
        (operationSignal) => this.binding.revalidate(trustedBinding, operationSignal),
        callerSignal,
        this.#operationTimeoutMs
      );
    } catch (error) {
      const interruption = interruptionOutcome(error);
      if (interruption) return interruption;
      return blocked("context_binding_unavailable");
    }
    const parsedRevalidated = parseBindingResult(revalidated);
    if (!parsedRevalidated || parsedRevalidated.kind !== "trusted" || !sameBinding(trustedBinding, parsedRevalidated)) {
      return blocked("context_changed");
    }
    return void 0;
  }
  async #readDetail(trustedBinding, candidate, callerSignal) {
    if (callerSignal?.aborted) return blocked("request_aborted");
    const provider = this.#providers.get(candidate.record.authorityRef.provider);
    if (!provider) {
      return blocked("provider_unregistered");
    }
    const requestStartedAt = Date.now();
    let result;
    try {
      result = await runBounded(
        "provider.getDetail",
        (operationSignal) => provider.getDetail({
          binding: trustedBinding,
          entityId: candidate.record.entityId,
          entityType: candidate.record.entityType,
          authorityLocator: candidate.record.authorityRef.locator,
          revisionPolicy: "current-or-explicit-stale",
          signal: operationSignal
        }),
        callerSignal,
        this.#operationTimeoutMs
      );
    } catch (error) {
      const interruption = interruptionOutcome(error);
      if (interruption) return interruption;
      return error instanceof ContractError ? blocked("authority_contract_invalid") : unavailable("provider_unavailable", true);
    }
    const afterProvider = await this.#revalidate(trustedBinding, callerSignal);
    if (afterProvider) return afterProvider;
    if (callerSignal?.aborted) return blocked("request_aborted");
    if (!isAuthorityResult(result)) {
      return blocked("authority_contract_invalid");
    }
    if (result.kind === "not_found") {
      return unavailable("not_found", false);
    }
    if (result.kind === "access_denied") {
      return blocked("access_denied");
    }
    if (result.kind === "unavailable") {
      return unavailable("provider_unavailable", result.retryable);
    }
    let snapshot;
    let verification;
    try {
      snapshot = validateSnapshotForCandidate(result.snapshot, {
        scope: trustedBinding.scope,
        entityId: candidate.record.entityId,
        entityType: candidate.record.entityType
      });
      verification = validateAuthorityVerification(
        result.verification,
        snapshot,
        requestStartedAt
      );
    } catch (error) {
      return error instanceof IdentityMismatchError ? blocked("authority_identity_mismatch") : blocked("authority_contract_invalid");
    }
    const outcome = {
      kind: "detail",
      candidate: candidate.match,
      detail: snapshot,
      verification,
      fallbackText: ""
    };
    outcome.fallbackText = renderLookupOutcome(outcome);
    return outcome;
  }
};

// src/host/codex-cdp/fixture-lookup.ts
var DEFAULT_CANDIDATE_REF_TTL_MS = 6e4;
var DEFAULT_MAX_CANDIDATE_REFS = 256;
var CANDIDATE_REF_BYTES = 32;
var CANDIDATE_REF_PREFIX = "pcand:";
function boundedPrintable(value, minimum, maximum) {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum && !/[\p{Cc}\p{Cf}]/u.test(value);
}
function truncate(value, maximum) {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1))}\u2026`;
}
function scalarText(value) {
  return value === null ? "null" : String(value);
}
function factText2(value) {
  const rendered = Array.isArray(value) ? value.map(scalarText).join(", ") : scalarText(value);
  return truncate(rendered, 1024);
}
function sourceLabel(sourceType, sourceId) {
  return truncate(`${sourceType} / ${sourceId}`, 512);
}
function sha2562(value) {
  return createHash2("sha256").update(value, "utf8").digest("hex");
}
function errorPresentation(code, message, retryable) {
  return { kind: "error", code, message, retryable };
}
function validExplicitScope(scope) {
  return scope.kind === "project" && scope.namespace === FIXTURE_PROJECT_NAMESPACE && boundedPrintable(scope.id, 1, 4096);
}
function validRequest(request) {
  const selection = request.selection;
  const candidateConsistent = request.operation === "resolve" ? request.candidateRef === void 0 : boundedPrintable(request.candidateRef, 8, 256);
  return (request.operation === "resolve" || request.operation === "choose") && boundedPrintable(request.requestId, 8, 128) && boundedPrintable(selection.text, 1, 512) && selection.text === selection.text.trim() && /^[0-9a-f]{64}$/u.test(selection.digest) && sha2562(selection.text) === selection.digest && Number.isSafeInteger(selection.generation) && selection.generation >= 1 && (selection.surface === "assistant_message" || selection.surface === "user_message") && boundedPrintable(request.contextFingerprint, 1, 2048) && boundedPrintable(request.requestedAt, 20, 64) && Number.isFinite(Date.parse(request.requestedAt)) && boundedPrintable(request.host.targetId, 1, 256) && request.host.targetUrl === "app://-/index.html" && boundedPrintable(request.host.bindingGeneration, 8, 256) && candidateConsistent;
}
function candidateView(candidate, candidateRef) {
  return {
    candidateRef,
    label: truncate(candidate.label, 256),
    entityType: truncate(candidate.entityType, 128),
    summary: truncate(candidate.summary, 1024)
  };
}
function detailView(outcome) {
  return {
    entityId: truncate(outcome.detail.entityId, 256),
    entityType: truncate(outcome.detail.entityType, 128),
    label: truncate(outcome.candidate.label, 256),
    summary: truncate(outcome.candidate.summary, 1024),
    revision: outcome.detail.entityRevision,
    observedAt: outcome.detail.observedAt,
    freshness: outcome.detail.freshness,
    facts: Object.entries(outcome.detail.facts).slice(0, 5).map(([label, value]) => ({ label, value: factText2(value) })),
    sources: outcome.detail.sourceRefs.slice(0, 5).map((source) => ({
      label: sourceLabel(source.sourceType, source.sourceId)
    }))
  };
}
function outcomeError(outcome) {
  if (outcome.kind === "no_match") {
    return errorPresentation("not_found", "\u6240\u9009\u6587\u5B57\u4E2D\u672A\u627E\u5230\u4E0A\u4E0B\u6587\u5BF9\u8C61\u3002", false);
  }
  if (outcome.kind === "overflow") {
    return errorPresentation(
      `lookup_${outcome.reason}`,
      "\u5339\u914D\u5BF9\u8C61\u8FC7\u591A\uFF0C\u65E0\u6CD5\u5B89\u5168\u663E\u793A\u5019\u9009\u9879\u3002\u8BF7\u7F29\u5C0F\u9009\u533A\u540E\u91CD\u8BD5\u3002",
      false
    );
  }
  if (outcome.kind === "unavailable") {
    return errorPresentation(
      outcome.reason,
      outcome.reason === "operation_timeout" ? "\u4E0A\u4E0B\u6587\u67E5\u8BE2\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5\u3002" : "\u4E0A\u4E0B\u6587\u8BE6\u60C5\u6682\u65F6\u4E0D\u53EF\u7528\u3002",
      outcome.retryable
    );
  }
  const retryable = outcome.reason === "context_changed" || outcome.reason === "context_binding_unavailable" || outcome.reason === "request_aborted";
  return errorPresentation(
    outcome.reason,
    retryable ? "\u5F53\u524D\u4E0A\u4E0B\u6587\u5DF2\u53D8\u5316\u6216\u6682\u65F6\u4E0D\u53EF\u7528\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u540E\u91CD\u8BD5\u3002" : "\u5F53\u524D\u4E0A\u4E0B\u6587\u65E0\u6CD5\u5B89\u5168\u5B8C\u6210\u8BE5\u67E5\u8BE2\u3002",
    retryable
  );
}
function createFixtureLookupCallback(options) {
  if (!validExplicitScope(options.explicitScope)) {
    throw new TypeError(
      "fixture lookup requires a complete fixture project explicitScope"
    );
  }
  const candidateRefTtlMs = options.candidateRefTtlMs ?? DEFAULT_CANDIDATE_REF_TTL_MS;
  const maxCandidateRefs = options.maxCandidateRefs ?? DEFAULT_MAX_CANDIDATE_REFS;
  if (!Number.isSafeInteger(candidateRefTtlMs) || candidateRefTtlMs < 100 || candidateRefTtlMs > 3e5) {
    throw new RangeError("candidateRefTtlMs must be an integer from 100 to 300000");
  }
  if (!Number.isSafeInteger(maxCandidateRefs) || maxCandidateRefs < 1 || maxCandidateRefs > 4096) {
    throw new RangeError("maxCandidateRefs must be an integer from 1 to 4096");
  }
  const workspaceRoot = resolve2(options.workspaceRoot);
  const explicitScope = copyContextScope(options.explicitScope);
  const binding = new FixtureFileProjectBinding(
    resolve2(options.manifestPath),
    workspaceRoot
  );
  const index = new JsonContextIndex(resolve2(options.indexPath));
  const provider = new JsonAuthoritativeProvider(
    resolve2(options.detailsPath),
    options.providerId ?? "json-fixture"
  );
  const service = new LookupService(binding, index, [provider], {
    ...options.operationTimeoutMs === void 0 ? {} : { operationTimeoutMs: options.operationTimeoutMs }
  });
  const clock = options.clock ?? Date.now;
  const grants = /* @__PURE__ */ new Map();
  const now = () => {
    const value = clock();
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("fixture lookup clock returned an invalid time");
    }
    return value;
  };
  const prune = (at) => {
    for (const [candidateRef, grant] of grants) {
      if (grant.expiresAt <= at) grants.delete(candidateRef);
    }
  };
  const issueCandidateRefs = (request, candidates2) => {
    const issuedAt = now();
    prune(issuedAt);
    if (grants.size + candidates2.length > maxCandidateRefs) return void 0;
    const pending = [];
    for (const candidate of candidates2) {
      let candidateRef;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const proposed = `${CANDIDATE_REF_PREFIX}${randomBytes2(
          CANDIDATE_REF_BYTES
        ).toString("base64url")}`;
        if (!grants.has(proposed) && !pending.some((item) => item.candidateRef === proposed)) {
          candidateRef = proposed;
          break;
        }
      }
      if (candidateRef === void 0) return void 0;
      pending.push({
        candidateRef,
        candidate,
        grant: {
          targetId: request.host.targetId,
          bindingGeneration: request.host.bindingGeneration,
          contextFingerprint: request.contextFingerprint,
          selectionDigest: request.selection.digest,
          selectionGeneration: request.selection.generation,
          entityId: candidate.entityId,
          expiresAt: issuedAt + candidateRefTtlMs
        }
      });
    }
    for (const item of pending) grants.set(item.candidateRef, item.grant);
    return pending.map((item) => candidateView(item.candidate, item.candidateRef));
  };
  const consumeCandidateRef = (request) => {
    const checkedAt = now();
    prune(checkedAt);
    const candidateRef = request.candidateRef;
    if (candidateRef === void 0) return void 0;
    const grant = grants.get(candidateRef);
    if (grant === void 0 || grant.expiresAt <= checkedAt || grant.targetId !== request.host.targetId || grant.bindingGeneration !== request.host.bindingGeneration || grant.contextFingerprint !== request.contextFingerprint || grant.selectionDigest !== request.selection.digest || grant.selectionGeneration !== request.selection.generation) {
      return void 0;
    }
    grants.delete(candidateRef);
    return grant.entityId;
  };
  return async (request) => {
    if (!validRequest(request)) {
      return errorPresentation(
        "invalid_request",
        "\u4E0A\u4E0B\u6587\u67E5\u8BE2\u8BF7\u6C42\u65E0\u6548\u3002",
        false
      );
    }
    if (request.signal.aborted) {
      return errorPresentation("request_aborted", "\u4E0A\u4E0B\u6587\u67E5\u8BE2\u5DF2\u53D6\u6D88\u3002", true);
    }
    const chosenEntityId = request.operation === "choose" ? consumeCandidateRef(request) : void 0;
    if (request.operation === "choose" && chosenEntityId === void 0) {
      return errorPresentation(
        "candidate_ref_invalid",
        "\u5019\u9009\u5F15\u7528\u65E0\u6548\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u67E5\u8BE2\u3002",
        true
      );
    }
    const selection = {
      text: request.selection.text,
      surface: request.selection.surface,
      selectionGeneration: request.selection.generation
    };
    const hostContext = {
      selectionGeneration: request.selection.generation,
      explicitScope,
      workspaceRoot
    };
    const activation = service.issueActivation(
      selection,
      hostContext,
      chosenEntityId
    );
    if (activation.kind !== "issued") {
      return errorPresentation(
        activation.kind === "capacity_exceeded" ? "lookup_capacity" : "invalid_request",
        activation.kind === "capacity_exceeded" ? "\u4E0A\u4E0B\u6587\u67E5\u8BE2\u5BB9\u91CF\u5DF2\u6EE1\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002" : "\u4E0A\u4E0B\u6587\u67E5\u8BE2\u8BF7\u6C42\u65E0\u6548\u3002",
        activation.kind === "capacity_exceeded"
      );
    }
    const outcome = await service.submitLookupIntent({
      ...activation.ticket,
      selection,
      hostContext,
      ...chosenEntityId === void 0 ? {} : { chosenEntityId }
    }, request.signal);
    if (outcome.kind === "detail") {
      return { kind: "detail", detail: detailView(outcome) };
    }
    if (outcome.kind === "candidates") {
      if (outcome.candidates.length < 2 || outcome.candidates.length > 3) {
        return errorPresentation(
          "invalid_candidate_set",
          "\u5019\u9009\u96C6\u5408\u4E0D\u7B26\u5408\u663E\u793A\u7EA6\u675F\u3002",
          false
        );
      }
      const candidates2 = issueCandidateRefs(request, outcome.candidates);
      return candidates2 === void 0 ? errorPresentation(
        "candidate_ref_capacity",
        "\u5019\u9009\u5F15\u7528\u5BB9\u91CF\u5DF2\u6EE1\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002",
        true
      ) : { kind: "candidates", candidates: candidates2 };
    }
    return outcomeError(outcome);
  };
}

// src/host/codex-cdp/fixture-private-probe.ts
function adapterOptions(lookup, options) {
  return {
    lookup,
    ...options.endpoint === void 0 ? {} : { endpoint: options.endpoint },
    ...options.fetch === void 0 ? {} : { fetch: options.fetch },
    ...options.connect === void 0 ? {} : { connect: options.connect },
    ...options.discoveryTimeoutMs === void 0 ? {} : { discoveryTimeoutMs: options.discoveryTimeoutMs },
    ...options.lookupTimeoutMs === void 0 ? {} : { lookupTimeoutMs: options.lookupTimeoutMs },
    ...options.maxConcurrentLookupsPerTarget === void 0 ? {} : {
      maxConcurrentLookupsPerTarget: options.maxConcurrentLookupsPerTarget
    },
    ...options.actionLabel === void 0 ? {} : { actionLabel: options.actionLabel }
  };
}
function createFixturePrivateProbe(options) {
  const lookup = createFixtureLookupCallback(options);
  const adapter = new CodexCdpHostAdapter(adapterOptions(lookup, options));
  return Object.freeze({
    adapter,
    start: (signal) => adapter.start(signal),
    stop: () => adapter.stop(),
    status: () => adapter.status()
  });
}

// src/host/codex-cdp/fixture-companion.ts
var DEFAULT_REFRESH_INTERVAL_MS = 2e3;
var MIN_REFRESH_INTERVAL_MS = 100;
var MAX_REFRESH_INTERVAL_MS = 6e4;
function boundedRefreshInterval(value) {
  const candidate = value ?? DEFAULT_REFRESH_INTERVAL_MS;
  if (!Number.isSafeInteger(candidate) || candidate < MIN_REFRESH_INTERVAL_MS || candidate > MAX_REFRESH_INTERVAL_MS) {
    throw new RangeError(
      `refreshIntervalMs must be an integer from ${MIN_REFRESH_INTERVAL_MS} to ${MAX_REFRESH_INTERVAL_MS}`
    );
  }
  return candidate;
}
function publicError(error) {
  if (error instanceof Error && error.message.length > 0) {
    return error.message.slice(0, 512);
  }
  return "fixture companion refresh failed";
}
function immutableStatus(status) {
  return Object.freeze({
    ...status,
    adapter: Object.freeze({
      ...status.adapter,
      targets: Object.freeze(
        status.adapter.targets.map((target) => Object.freeze({ ...target }))
      )
    })
  });
}
function createFixtureCompanion(options) {
  const refreshIntervalMs = boundedRefreshInterval(options.refreshIntervalMs);
  const probe = createFixturePrivateProbe(options);
  let state = "idle";
  let startedAt;
  let lastRefreshAt;
  let refreshCount = 0;
  let lastError;
  let refreshPromise;
  let stopPromise;
  let refreshTimer;
  const status = () => immutableStatus({
    state,
    fixtureOnly: true,
    ...startedAt === void 0 ? {} : { startedAt },
    ...lastRefreshAt === void 0 ? {} : { lastRefreshAt },
    refreshCount,
    ...lastError === void 0 ? {} : { lastError },
    adapter: probe.status()
  });
  const schedule = () => {
    if (state !== "running") return;
    refreshTimer = setTimeout(() => {
      refreshTimer = void 0;
      void refresh().finally(schedule);
    }, refreshIntervalMs);
  };
  const refresh = () => {
    if (state === "stopping" || state === "stopped") {
      return Promise.resolve(status());
    }
    if (refreshPromise !== void 0) return refreshPromise;
    const operation = (async () => {
      try {
        if (probe.status().state === "idle") {
          await probe.start();
        } else {
          await probe.adapter.refreshTargets();
        }
        lastError = void 0;
      } catch (error) {
        lastError = publicError(error);
      } finally {
        refreshCount += 1;
        lastRefreshAt = (/* @__PURE__ */ new Date()).toISOString();
      }
      return status();
    })().finally(() => {
      if (refreshPromise === operation) refreshPromise = void 0;
    });
    refreshPromise = operation;
    return operation;
  };
  const start = async () => {
    if (state === "stopped" || state === "stopping") {
      throw new Error("fixture_companion_stopped");
    }
    if (state === "running") return status();
    state = "running";
    startedAt = (/* @__PURE__ */ new Date()).toISOString();
    await refresh();
    schedule();
    return status();
  };
  const stop = () => {
    if (stopPromise !== void 0) return stopPromise;
    if (state === "stopped") return Promise.resolve(status());
    state = "stopping";
    if (refreshTimer !== void 0) {
      clearTimeout(refreshTimer);
      refreshTimer = void 0;
    }
    const operation = (async () => {
      await refreshPromise?.catch(() => void 0);
      await probe.stop();
      state = "stopped";
      return status();
    })();
    stopPromise = operation;
    return operation;
  };
  return Object.freeze({ start, refresh, stop, status });
}

// src/host/codex-cdp/fixture-companion-cli.ts
var CONTROL_SCHEMA_VERSION = 1;
var CONTROL_TIMEOUT_MS = 2e3;
var START_TIMEOUT_MS = 8e3;
var MAX_CONTROL_BYTES = 64 * 1024;
function fail(message) {
  throw new Error(message);
}
function boundedInteger(value, name, minimum, maximum) {
  if (!/^\d+$/u.test(value)) fail(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(`${name} must be from ${minimum} to ${maximum}`);
  }
  return parsed;
}
function findPackageRoot(start) {
  let current = resolve3(start);
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "fixtures", "mini-project", "project-context.json"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return fail("pointable-context package root was not found");
}
function defaultStateDir() {
  const localBase = process.env.LOCALAPPDATA;
  return resolve3(
    localBase && isAbsolute2(localBase) ? localBase : homedir(),
    "PointableContext",
    "fixture-companion"
  );
}
function parseArguments(argv) {
  const command = argv[0];
  if (command !== "start" && command !== "status" && command !== "stop" && command !== "run") {
    return fail("usage: pointable-context-fixture-companion <start|status|stop> [options]");
  }
  const packageRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
  let stateDir = defaultStateDir();
  let endpoint = "http://127.0.0.1:9223";
  let fixtureRoot = join(packageRoot, "fixtures", "mini-project");
  let refreshIntervalMs = 2e3;
  let json = false;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === void 0) fail(`${argument} requires a value`);
    index += 1;
    if (argument === "--state-dir") {
      if (!isAbsolute2(value)) fail("--state-dir must be absolute");
      stateDir = resolve3(value);
    } else if (argument === "--endpoint") {
      endpoint = value;
    } else if (argument === "--fixture-root") {
      if (!isAbsolute2(value)) fail("--fixture-root must be absolute");
      fixtureRoot = resolve3(value);
    } else if (argument === "--refresh-ms") {
      refreshIntervalMs = boundedInteger(value, "--refresh-ms", 100, 6e4);
    } else {
      fail(`unknown option: ${argument}`);
    }
  }
  return { command, stateDir, endpoint, fixtureRoot, refreshIntervalMs, json };
}
function statePath(stateDir) {
  return join(stateDir, "state.json");
}
function lockPath(stateDir) {
  return join(stateDir, "runtime.lock");
}
function logPath(stateDir) {
  return join(stateDir, "companion.log");
}
function record6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseState(value) {
  if (!record6(value)) return fail("invalid companion state");
  const token = value.token;
  if (value.schemaVersion !== CONTROL_SCHEMA_VERSION || value.fixtureOnly !== true || !Number.isSafeInteger(value.pid) || Number(value.pid) <= 0 || !Number.isSafeInteger(value.port) || Number(value.port) < 1 || Number(value.port) > 65535 || typeof token !== "string" || !/^[a-f0-9]{64}$/u.test(token) || typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt))) {
    return fail("invalid companion state");
  }
  return {
    schemaVersion: CONTROL_SCHEMA_VERSION,
    fixtureOnly: true,
    pid: Number(value.pid),
    port: Number(value.port),
    token,
    startedAt: value.startedAt
  };
}
async function readState(stateDir) {
  try {
    const text = await readFile2(statePath(stateDir), "utf8");
    if (Buffer.byteLength(text, "utf8") > 16 * 1024) return void 0;
    return parseState(JSON.parse(text));
  } catch {
    return void 0;
  }
}
function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
async function readLockPid(stateDir) {
  try {
    const raw = (await readFile2(lockPath(stateDir), "utf8")).trim();
    if (!/^\d+$/u.test(raw)) return void 0;
    const pid = Number(raw);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : void 0;
  } catch {
    return void 0;
  }
}
async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID3()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}
`, {
    encoding: "utf8",
    mode: 384,
    flag: "wx"
  });
  await rename(temporary, path);
}
async function claimRuntimeLock(stateDir) {
  await mkdir(stateDir, { recursive: true, mode: 448 });
  try {
    const handle = await open(lockPath(stateDir), "wx", 384);
    try {
      await handle.writeFile(`${process.pid}
`, "utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error.code === "EEXIST") {
      fail("fixture companion runtime lock is already held");
    }
    throw error;
  }
}
async function removeOwnedFiles(stateDir, token) {
  if (token !== void 0) {
    const current = await readState(stateDir);
    if (current !== void 0 && current.token !== token) return;
  }
  await rm(statePath(stateDir), { force: true }).catch(() => void 0);
  const lockPid = await readLockPid(stateDir);
  if (lockPid === void 0 || lockPid === process.pid || !processIsAlive(lockPid)) {
    await rm(lockPath(stateDir), { force: true }).catch(() => void 0);
  }
}
function safeTokenEqual(left, right) {
  if (left === void 0 || left.length !== right.length) return false;
  return timingSafeEqual2(Buffer.from(left), Buffer.from(right));
}
function sendJson(response, statusCode, body, after) {
  const encoded = Buffer.from(JSON.stringify(body), "utf8");
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": encoded.byteLength,
    "cache-control": "no-store"
  });
  response.end(encoded, after);
}
async function controlRequest(state, method, path) {
  return await new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port: state.port,
      method,
      path,
      headers: {
        "x-pointable-control-token": state.token,
        connection: "close"
      },
      timeout: CONTROL_TIMEOUT_MS
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.byteLength;
        if (bytes > MAX_CONTROL_BYTES) {
          request.destroy(new Error("companion control response is too large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if ((response.statusCode ?? 500) >= 400 || !record6(parsed)) {
            rejectRequest(new Error("companion control request failed"));
            return;
          }
          resolveRequest(parsed);
        } catch (error) {
          rejectRequest(error);
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("companion control request timed out")));
    request.on("error", rejectRequest);
    request.end();
  });
}
async function liveStatus(stateDir) {
  const state = await readState(stateDir);
  if (state === void 0 || !processIsAlive(state.pid)) return void 0;
  try {
    return await controlRequest(state, "GET", "/status");
  } catch {
    return void 0;
  }
}
async function waitForLiveStatus(stateDir) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await liveStatus(stateDir);
    if (status !== void 0) return status;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return fail(`fixture companion did not become ready; see ${logPath(stateDir)}`);
}
function fixtureOptions(arguments_) {
  const fixtureRoot = arguments_.fixtureRoot;
  return {
    workspaceRoot: fixtureRoot,
    manifestPath: join(fixtureRoot, "project-context.json"),
    indexPath: join(fixtureRoot, "index.json"),
    detailsPath: join(fixtureRoot, "details.json"),
    explicitScope: fixtureProjectScope("PRJ-01"),
    endpoint: arguments_.endpoint,
    refreshIntervalMs: arguments_.refreshIntervalMs,
    actionLabel: "\u67E5\u770B\u4E0A\u4E0B\u6587\uFF08fixture\uFF09"
  };
}
async function runServer(arguments_) {
  await claimRuntimeLock(arguments_.stateDir);
  const token = randomBytes3(32).toString("hex");
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const companion = createFixtureCompanion(fixtureOptions(arguments_));
  let resolveShutdown;
  const shutdownRequested = new Promise((resolvePromise) => {
    resolveShutdown = resolvePromise;
  });
  let shutdownStarted = false;
  const requestShutdown = () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    resolveShutdown();
  };
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);
  process.once("SIGHUP", requestShutdown);
  const server = createServer({ maxHeaderSize: 8 * 1024 }, (request, response) => {
    const remote = request.socket.remoteAddress;
    const local = remote === "127.0.0.1" || remote === "::ffff:127.0.0.1";
    const suppliedToken = request.headers["x-pointable-control-token"];
    if (!local || typeof suppliedToken !== "string" || !safeTokenEqual(suppliedToken, token)) {
      sendJson(response, 403, { ok: false, error: "forbidden" });
      return;
    }
    if (request.method === "GET" && request.url === "/status") {
      sendJson(response, 200, {
        ok: true,
        pid: process.pid,
        fixtureOnly: true,
        companion: companion.status()
      });
      return;
    }
    if (request.method === "POST" && request.url === "/refresh") {
      void companion.refresh().then(
        (status) => sendJson(response, 200, { ok: true, fixtureOnly: true, companion: status }),
        () => sendJson(response, 503, { ok: false, error: "refresh_failed" })
      );
      return;
    }
    if (request.method === "POST" && request.url === "/stop") {
      sendJson(response, 202, { ok: true, fixtureOnly: true, stopping: true }, requestShutdown);
      return;
    }
    sendJson(response, 404, { ok: false, error: "not_found" });
  });
  try {
    await companion.start();
    server.listen({ host: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") fail("control server did not bind TCP");
    const state = {
      schemaVersion: CONTROL_SCHEMA_VERSION,
      fixtureOnly: true,
      pid: process.pid,
      port: address.port,
      token,
      startedAt
    };
    await writeJsonAtomic(statePath(arguments_.stateDir), state);
    process.stdout.write(`${JSON.stringify({ event: "fixture_companion_ready", pid: process.pid, fixtureOnly: true })}
`);
    await shutdownRequested;
  } finally {
    await companion.stop().catch(() => void 0);
    await new Promise((resolveClose) => server.close(() => resolveClose())).catch(() => void 0);
    await removeOwnedFiles(arguments_.stateDir, token);
  }
}
async function startDetached(arguments_) {
  const existing = await liveStatus(arguments_.stateDir);
  if (existing !== void 0) return { ...existing, alreadyRunning: true };
  const lockPid = await readLockPid(arguments_.stateDir);
  if (lockPid !== void 0 && processIsAlive(lockPid)) {
    return { ...await waitForLiveStatus(arguments_.stateDir), alreadyRunning: true };
  }
  await removeOwnedFiles(arguments_.stateDir);
  await mkdir(arguments_.stateDir, { recursive: true, mode: 448 });
  const logDescriptor = openSync(logPath(arguments_.stateDir), "a", 384);
  const entrypoint = fileURLToPath(import.meta.url);
  const childArguments = [
    entrypoint,
    "run",
    "--state-dir",
    arguments_.stateDir,
    "--endpoint",
    arguments_.endpoint,
    "--fixture-root",
    arguments_.fixtureRoot,
    "--refresh-ms",
    String(arguments_.refreshIntervalMs),
    "--json"
  ];
  try {
    const child = spawn(process.execPath, childArguments, {
      cwd: findPackageRoot(dirname(entrypoint)),
      detached: true,
      windowsHide: true,
      stdio: ["ignore", logDescriptor, logDescriptor]
    });
    await Promise.race([
      once(child, "spawn"),
      once(child, "error").then(([error]) => Promise.reject(error))
    ]);
    child.unref();
  } finally {
    closeSync(logDescriptor);
  }
  return { ...await waitForLiveStatus(arguments_.stateDir), alreadyRunning: false };
}
async function stopDetached(stateDir) {
  const state = await readState(stateDir);
  if (state === void 0 || !processIsAlive(state.pid)) {
    await removeOwnedFiles(stateDir);
    return { ok: true, fixtureOnly: true, stopped: true, wasRunning: false };
  }
  await controlRequest(state, "POST", "/stop");
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!processIsAlive(state.pid) && await readState(stateDir) === void 0) {
      return { ok: true, fixtureOnly: true, stopped: true, wasRunning: true };
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return fail("fixture companion did not stop cleanly");
}
function printResult(value, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}
`);
    return;
  }
  const companion = record6(value.companion) ? value.companion : void 0;
  const adapter = companion && record6(companion.adapter) ? companion.adapter : void 0;
  const state = typeof companion?.state === "string" ? companion.state : value.stopped === true ? "stopped" : "inactive";
  const targetCount = typeof adapter?.targetCount === "number" ? adapter.targetCount : 0;
  process.stdout.write(`Pointable Context fixture companion: ${state}; targets=${targetCount}; fixture-only=true
`);
}
async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.command === "run") {
    await runServer(arguments_);
    return;
  }
  if (arguments_.command === "start") {
    printResult(await startDetached(arguments_), arguments_.json);
    return;
  }
  if (arguments_.command === "stop") {
    printResult(await stopDetached(arguments_.stateDir), arguments_.json);
    return;
  }
  const status = await liveStatus(arguments_.stateDir);
  printResult(status ?? { ok: true, fixtureOnly: true, stopped: true }, arguments_.json);
}
try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}
`);
  process.exitCode = 1;
}

#!/usr/bin/env node

// src/host/codex-cdp/workspace-companion-cli.ts
import { randomBytes as randomBytes4, randomUUID as randomUUID4, timingSafeEqual as timingSafeEqual2 } from "node:crypto";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir as mkdir2, open as open2, readFile as readFile2, rename as rename2, rm, writeFile as writeFile2 } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname as dirname3, isAbsolute as isAbsolute3, join, resolve as resolve5 } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";

// src/host/codex-cdp/task-workspace-binding.ts
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

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
function validateIdentityRecordForRuntime(raw) {
  const value = objectValue(raw, "identity");
  const authority = objectValue(value.authorityRef, "identity.authorityRef");
  const schemaVersion = stringValue(value.schemaVersion, "identity.schemaVersion");
  if (schemaVersion !== "1.0") {
    throw new ContractError("identity.schemaVersion must be 1.0");
  }
  const record8 = {
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
    record8.canonicalKey = semanticStringValue(value.canonicalKey, "identity.canonicalKey");
  }
  assertUtf8Budget(record8, MAX_IDENTITY_BUDGET_BYTES, "identity");
  return record8;
}
function searchableIdentityTerms(record8) {
  const terms = [record8.entityId, record8.canonicalName, ...record8.aliases];
  if (record8.canonicalKey !== void 0) {
    terms.push(record8.canonicalKey);
  }
  return terms;
}
function addContextIndexBudget(state, record8, selection, normalizedSelection) {
  state.aliases += record8.aliases.length;
  if (state.aliases > CONTEXT_INDEX_LIMITS.aliases) {
    throw new ContractError("context index exceeds the aggregate alias bound");
  }
  state.utf8Bytes += Buffer2.byteLength(JSON.stringify(record8), "utf8") + 1;
  if (state.utf8Bytes > CONTEXT_INDEX_LIMITS.utf8Bytes) {
    throw new ContractError("context index exceeds the aggregate UTF-8 bound");
  }
  if (selection === void 0 || normalizedSelection === void 0) {
    return;
  }
  for (const term of searchableIdentityTerms(record8)) {
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
    const record8 = parser(rawRecords[index], expectedScope);
    if (!sameContextScope(record8.scope, expectedScope)) {
      throw new ContractError("context index contains a cross-scope record");
    }
    const entityId = normalizeText(record8.entityId);
    if (entityIds.has(entityId)) {
      throw new ContractError("context index contains a duplicate entity identity");
    }
    entityIds.add(entityId);
    if (record8.canonicalKey !== void 0) {
      const canonicalKey = normalizeText(record8.canonicalKey);
      if (canonicalKeys.has(canonicalKey)) {
        throw new ContractError("context index contains a duplicate canonical key");
      }
      canonicalKeys.add(canonicalKey);
    }
    addContextIndexBudget(state, record8, selection, normalizedSelection);
    records.push(record8);
  }
  return records;
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
  for (const record8 of records) {
    if (!Array.isArray(record8.aliases)) {
      throw new ContractError("context index aliases must be an array");
    }
    addContextIndexBudget(state, record8, selection, normalizedSelection);
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

// src/host/codex-cdp/task-workspace-binding.ts
var REGISTRY_SCHEMA_VERSION = 1;
var MAX_REGISTRY_BYTES = 1024 * 1024;
var MAX_REGISTRY_ENTRIES = 2048;
var LOCAL_WORKSPACE_NAMESPACE = "local-filesystem-v1";
var LOCAL_WORKSPACE_PROVIDER_ID = "local-filesystem";
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value, keys) {
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string")) return false;
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}
function identity(value, name) {
  if (typeof value !== "string" || value.length < 1 || value.length > 256 || !/^[A-Za-z0-9:_-]+$/u.test(value)) {
    throw new ContractError(`${name} is invalid`);
  }
  return value;
}
function normalizedPath(value) {
  return process.platform === "win32" ? value.toLocaleLowerCase("en-US") : value;
}
function pathsEqual(left, right) {
  return normalizedPath(left) === normalizedPath(right);
}
function taskKey(task) {
  return `${task.hostId}\0${task.threadId}`;
}
function codexTaskThreadRef(task) {
  return `codex-desktop:${task.hostId}:${task.threadId}`;
}
function localWorkspaceScope(canonicalRoot) {
  const id = createHash("sha256").update(`${LOCAL_WORKSPACE_NAMESPACE}\0${normalizedPath(canonicalRoot)}`, "utf8").digest("hex");
  return Object.freeze({
    kind: "workspace",
    namespace: LOCAL_WORKSPACE_NAMESPACE,
    id
  });
}
function copyEntry(entry) {
  return Object.freeze({
    ...entry,
    scope: Object.freeze({ ...entry.scope })
  });
}
function parseEntry(value, index) {
  if (!record(value) || !exactKeys(value, [
    "schemaVersion",
    "host",
    "threadId",
    "hostId",
    "scope",
    "workspaceRoot",
    "providerId",
    "bindingRevision",
    "boundAt"
  ]) || value.schemaVersion !== REGISTRY_SCHEMA_VERSION || value.host !== "codex-desktop" || !record(value.scope) || !exactKeys(value.scope, ["kind", "namespace", "id"]) || value.scope.kind !== "workspace" || value.scope.namespace !== LOCAL_WORKSPACE_NAMESPACE || typeof value.scope.id !== "string" || !/^[a-f0-9]{64}$/u.test(value.scope.id) || typeof value.workspaceRoot !== "string" || !isAbsolute(value.workspaceRoot) || value.workspaceRoot.length > 4096 || value.providerId !== LOCAL_WORKSPACE_PROVIDER_ID || typeof value.bindingRevision !== "string" || !/^[a-f0-9]{64}$/u.test(value.bindingRevision) || typeof value.boundAt !== "string" || !Number.isFinite(Date.parse(value.boundAt))) {
    throw new ContractError(`task workspace binding entry ${index} is invalid`);
  }
  return copyEntry({
    schemaVersion: 1,
    host: "codex-desktop",
    threadId: identity(value.threadId, `entries[${index}].threadId`),
    hostId: identity(value.hostId, `entries[${index}].hostId`),
    scope: {
      kind: "workspace",
      namespace: LOCAL_WORKSPACE_NAMESPACE,
      id: value.scope.id
    },
    workspaceRoot: resolve(value.workspaceRoot),
    providerId: LOCAL_WORKSPACE_PROVIDER_ID,
    bindingRevision: value.bindingRevision,
    boundAt: value.boundAt
  });
}
function parseDocument(value) {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "entries"]) || value.schemaVersion !== REGISTRY_SCHEMA_VERSION || !Array.isArray(value.entries) || value.entries.length > MAX_REGISTRY_ENTRIES) {
    throw new ContractError("task workspace binding registry is invalid");
  }
  const entries = value.entries.map(parseEntry);
  const keys = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    const key = taskKey(entry);
    if (keys.has(key)) {
      throw new ContractError("task workspace binding registry contains duplicate tasks");
    }
    keys.add(key);
  }
  return { schemaVersion: 1, entries };
}
var CodexTaskWorkspaceBindingRegistry = class {
  path;
  constructor(path) {
    if (!isAbsolute(path)) {
      throw new TypeError("task workspace binding registry path must be absolute");
    }
    this.path = resolve(path);
  }
  async #read() {
    let content;
    try {
      const info = await stat(this.path);
      if (!info.isFile() || info.size > MAX_REGISTRY_BYTES) {
        throw new ContractError("task workspace binding registry file is invalid");
      }
      content = await readFile(this.path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return { schemaVersion: 1, entries: [] };
      }
      throw error;
    }
    try {
      return parseDocument(JSON.parse(content));
    } catch (error) {
      if (error instanceof ContractError) throw error;
      throw new ContractError("task workspace binding registry JSON is malformed");
    }
  }
  async #write(document2) {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 448 });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    const body = `${JSON.stringify(document2, null, 2)}
`;
    if (Buffer.byteLength(body, "utf8") > MAX_REGISTRY_BYTES) {
      throw new ContractError("task workspace binding registry exceeds its byte budget");
    }
    await writeFile(temporary, body, { encoding: "utf8", mode: 384, flag: "wx" });
    await rename(temporary, this.path);
  }
  async bind(task, workspaceRoot) {
    if (!isAbsolute(workspaceRoot)) {
      throw new TypeError("workspace root must be absolute");
    }
    const canonicalRoot = await realpath(resolve(workspaceRoot));
    const rootInfo = await stat(canonicalRoot);
    if (!rootInfo.isDirectory()) {
      throw new ContractError("workspace root must be a directory");
    }
    const document2 = await this.#read();
    const entry = copyEntry({
      schemaVersion: 1,
      host: "codex-desktop",
      threadId: identity(task.threadId, "task.threadId"),
      hostId: identity(task.hostId, "task.hostId"),
      scope: localWorkspaceScope(canonicalRoot),
      workspaceRoot: canonicalRoot,
      providerId: LOCAL_WORKSPACE_PROVIDER_ID,
      bindingRevision: randomBytes(32).toString("hex"),
      boundAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    const key = taskKey(task);
    const entries = document2.entries.filter((candidate) => taskKey(candidate) !== key);
    if (entries.length >= MAX_REGISTRY_ENTRIES) {
      throw new ContractError("task workspace binding registry is full");
    }
    entries.push(entry);
    entries.sort((left, right) => taskKey(left).localeCompare(taskKey(right)));
    await this.#write({ schemaVersion: 1, entries });
    return copyEntry(entry);
  }
  async find(task) {
    const key = taskKey(task);
    const entry = (await this.#read()).entries.find((candidate) => taskKey(candidate) === key);
    return entry === void 0 ? void 0 : copyEntry(entry);
  }
  async unbind(task) {
    const document2 = await this.#read();
    const key = taskKey(task);
    const removed = document2.entries.find((candidate) => taskKey(candidate) === key);
    if (removed === void 0) return void 0;
    await this.#write({
      schemaVersion: 1,
      entries: document2.entries.filter((candidate) => taskKey(candidate) !== key)
    });
    return copyEntry(removed);
  }
};
function sameTask(left, right) {
  return left.host === right.host && left.hostId === right.hostId && left.threadId === right.threadId && left.routeRef === right.routeRef && left.contextFingerprint === right.contextFingerprint;
}
var CodexTaskWorkspaceBindingPort = class {
  constructor(registry, initialTask, authority) {
    this.registry = registry;
    this.initialTask = initialTask;
    this.authority = authority;
  }
  registry;
  initialTask;
  authority;
  async #currentEntry(signal) {
    if (signal?.aborted) return void 0;
    const current = await this.authority.current(signal);
    if (current === void 0 || !sameTask(current, this.initialTask)) return void 0;
    const entry = await this.registry.find(current);
    if (entry === void 0) return void 0;
    const canonicalRoot = await realpath(entry.workspaceRoot);
    if (signal?.aborted || !pathsEqual(canonicalRoot, entry.workspaceRoot) || !sameContextScope(entry.scope, localWorkspaceScope(canonicalRoot))) {
      return void 0;
    }
    return { task: current, entry };
  }
  async resolve(context, signal) {
    const current = await this.#currentEntry(signal);
    if (current === void 0) return { kind: "missing" };
    const expectedThreadRef = codexTaskThreadRef(current.task);
    if (context.threadRef !== expectedThreadRef || context.routeRef !== current.task.routeRef || context.selectionGeneration < 1 || context.explicitScope === void 0 || !sameContextScope(context.explicitScope, current.entry.scope) || context.workspaceRoot === void 0 || !pathsEqual(context.workspaceRoot, current.entry.workspaceRoot)) {
      return { kind: "context_changed" };
    }
    return this.#trusted(current.entry, current.task, context.selectionGeneration);
  }
  async revalidate(binding, signal) {
    const current = await this.#currentEntry(signal);
    if (current === void 0) return { kind: "context_changed" };
    const expectedThreadRef = codexTaskThreadRef(current.task);
    if (binding.evidence !== "explicit_user" || binding.threadRef !== expectedThreadRef || binding.routeRef !== current.task.routeRef || binding.workspaceRoot === void 0 || !pathsEqual(binding.workspaceRoot, current.entry.workspaceRoot) || binding.bindingRevision !== current.entry.bindingRevision || !sameContextScope(binding.scope, current.entry.scope)) {
      return { kind: "context_changed" };
    }
    return this.#trusted(current.entry, current.task, binding.selectionGeneration);
  }
  #trusted(entry, task, selectionGeneration) {
    return {
      kind: "trusted",
      scope: { ...entry.scope },
      bindingRevision: entry.bindingRevision,
      evidence: "explicit_user",
      selectionGeneration,
      threadRef: codexTaskThreadRef(task),
      routeRef: task.routeRef,
      workspaceRoot: entry.workspaceRoot
    };
  }
};

// src/host/codex-cdp/adapter.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// src/host/codex-cdp/protocol.ts
import { createHash as createHash2 } from "node:crypto";
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
function record2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys2(value, allowed) {
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
  return createHash2("sha256").update(value, "utf8").digest("hex");
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
  if (!record2(parsed)) {
    throw new PointableProtocolError(
      "binding_payload_invalid",
      "binding payload must be an object"
    );
  }
  if (!exactKeys2(parsed, [
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
  if (!record2(value) || !exactKeys2(value, [
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
function validateEvidence(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new PointableProtocolError(
      "invalid_lookup_result",
      "detail evidence is invalid"
    );
  }
  return value.map((item) => {
    if (!record2(item) || !exactKeys2(item, ["excerpt", "source"]) || !boundedString(item.excerpt, 1, 1024) || !boundedString(item.source, 1, 512)) {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "detail evidence is invalid"
      );
    }
    return { excerpt: item.excerpt, source: item.source };
  });
}
function validateDetail(value) {
  if (!record2(value) || !exactKeys2(value, [
    "entityId",
    "entityType",
    "label",
    "summary",
    "revision",
    "observedAt",
    "freshness",
    "facts",
    "sources",
    "humanSummary",
    "comprehension",
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
  if (!boundedString(value.observedAt, 20, 64) || !Number.isFinite(Date.parse(value.observedAt)) || !Array.isArray(value.facts) || value.facts.length > 5 || !Array.isArray(value.sources) || value.sources.length > 5 || value.humanSummary !== void 0 && !boundedString(value.humanSummary, 1, 1024) || value.detailRef !== void 0 && !boundedString(value.detailRef, 8, 256) || value.changes !== void 0 && (!Array.isArray(value.changes) || value.changes.length > 3)) {
    throw new PointableProtocolError(
      "invalid_lookup_result",
      "detail metadata exceeds its contract"
    );
  }
  const facts = value.facts.map((fact) => {
    if (!record2(fact) || !exactKeys2(fact, ["label", "value"])) {
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
    if (!record2(source) || !exactKeys2(source, ["label"])) {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "detail source is invalid"
      );
    }
    return { label: requiredString(source.label, "source label", 512) };
  });
  let comprehension;
  if (value.comprehension !== void 0) {
    const view = value.comprehension;
    if (!record2(view)) {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "detail comprehension view is invalid"
      );
    }
    if (view.kind === "concept") {
      if (!exactKeys2(view, [
        "kind",
        "meaning",
        "context",
        "boundary",
        "sequence",
        "currentStep",
        "evidence"
      ]) || !boundedString(view.meaning, 1, 1024) || !boundedString(view.context, 1, 1024) || !boundedString(view.boundary, 1, 1024) || !Array.isArray(view.sequence) || view.sequence.length < 2 || view.sequence.length > 4 || !view.sequence.every((item) => boundedString(item, 1, 256)) || !Number.isSafeInteger(view.currentStep) || Number(view.currentStep) < 0 || Number(view.currentStep) >= view.sequence.length) {
        throw new PointableProtocolError(
          "invalid_lookup_result",
          "detail comprehension view is invalid"
        );
      }
      comprehension = {
        kind: "concept",
        meaning: view.meaning,
        context: view.context,
        boundary: view.boundary,
        sequence: [...view.sequence],
        currentStep: Number(view.currentStep),
        evidence: validateEvidence(view.evidence)
      };
    } else if (view.kind === "change") {
      if (!exactKeys2(view, ["kind", "before", "after", "impact", "evidence"]) || !boundedString(view.before, 1, 1024) || !boundedString(view.after, 1, 1024) || !boundedString(view.impact, 1, 1024)) {
        throw new PointableProtocolError(
          "invalid_lookup_result",
          "detail comprehension view is invalid"
        );
      }
      comprehension = {
        kind: "change",
        before: view.before,
        after: view.after,
        impact: view.impact,
        evidence: validateEvidence(view.evidence)
      };
    } else if (view.kind === "decision") {
      if (!exactKeys2(view, ["kind", "problem", "choice", "consequence", "evidence"]) || !boundedString(view.problem, 1, 1024) || !boundedString(view.choice, 1, 1024) || !boundedString(view.consequence, 1, 1024)) {
        throw new PointableProtocolError(
          "invalid_lookup_result",
          "detail comprehension view is invalid"
        );
      }
      comprehension = {
        kind: "decision",
        problem: view.problem,
        choice: view.choice,
        consequence: view.consequence,
        evidence: validateEvidence(view.evidence)
      };
    } else if (view.kind === "task") {
      if (!exactKeys2(view, [
        "kind",
        "goal",
        "status",
        "completed",
        "next",
        "blocker",
        "updatedAt",
        "evidence"
      ]) || !boundedString(view.goal, 1, 1024) || !boundedString(view.status, 1, 1024) || !boundedString(view.completed, 1, 1024) || !boundedString(view.next, 1, 1024) || !boundedString(view.blocker, 1, 1024) || !boundedString(view.updatedAt, 20, 64) || !Number.isFinite(Date.parse(view.updatedAt))) {
        throw new PointableProtocolError(
          "invalid_lookup_result",
          "detail comprehension view is invalid"
        );
      }
      comprehension = {
        kind: "task",
        goal: view.goal,
        status: view.status,
        completed: view.completed,
        next: view.next,
        blocker: view.blocker,
        updatedAt: view.updatedAt,
        evidence: validateEvidence(view.evidence)
      };
    } else if (view.kind === "verification") {
      if (!exactKeys2(view, ["kind", "claim", "result", "gap", "executedAt", "evidence"]) || !boundedString(view.claim, 1, 1024) || !boundedString(view.result, 1, 1024) || !boundedString(view.gap, 1, 1024) || !boundedString(view.executedAt, 20, 64) || !Number.isFinite(Date.parse(view.executedAt))) {
        throw new PointableProtocolError(
          "invalid_lookup_result",
          "detail comprehension view is invalid"
        );
      }
      comprehension = {
        kind: "verification",
        claim: view.claim,
        result: view.result,
        gap: view.gap,
        executedAt: view.executedAt,
        evidence: validateEvidence(view.evidence)
      };
    } else {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "detail comprehension view is invalid"
      );
    }
  }
  const changes = value.changes === void 0 ? void 0 : value.changes.map((change) => {
    if (!record2(change) || !exactKeys2(change, ["label", "before", "after"])) {
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
    ...typeof value.humanSummary === "string" ? { humanSummary: value.humanSummary } : {},
    ...comprehension === void 0 ? {} : { comprehension },
    ...typeof value.detailRef === "string" ? { detailRef: value.detailRef } : {},
    ...changes === void 0 ? {} : { changes }
  };
}
function validatePointableLookupPresentation(value) {
  if (!record2(value) || typeof value.kind !== "string") {
    throw new PointableProtocolError(
      "invalid_lookup_result",
      "lookup callback returned an invalid presentation"
    );
  }
  if (value.kind === "candidates") {
    if (!exactKeys2(value, ["kind", "candidates"]) || !Array.isArray(value.candidates) || value.candidates.length < 1 || value.candidates.length > 3) {
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
    if (!exactKeys2(value, ["kind", "detail"])) {
      throw new PointableProtocolError(
        "invalid_lookup_result",
        "detail result contains unsupported fields"
      );
    }
    return { kind: "detail", detail: validateDetail(value.detail) };
  }
  if (value.kind === "revision") {
    if (!exactKeys2(value, ["kind", "revision"]) || !record2(value.revision) || !exactKeys2(value.revision, ["detailRef", "state", "checkedAt"]) || !boundedString(value.revision.detailRef, 8, 256) || value.revision.state !== "unchanged" && value.revision.state !== "updated" && value.revision.state !== "deleted" && value.revision.state !== "unavailable" || !boundedString(value.revision.checkedAt, 20, 64) || !Number.isFinite(Date.parse(value.revision.checkedAt))) {
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
    if (!exactKeys2(value, ["kind", "code", "message", "retryable"]) || !boundedString(value.code, 1, 128) || !/^[a-z0-9_:-]+$/u.test(value.code) || !boundedString(value.message, 1, 1024) || typeof value.retryable !== "boolean") {
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
  const evidenceView = (candidate) => isRecord(candidate) && exact(candidate, ["excerpt", "source"]) && bounded(candidate.excerpt, 1, 1024) && bounded(candidate.source, 1, 512);
  const comprehensionView = (candidate) => {
    if (!isRecord(candidate) || !Array.isArray(candidate.evidence) || candidate.evidence.length < 1 || candidate.evidence.length > 3 || !candidate.evidence.every(evidenceView)) {
      return false;
    }
    if (candidate.kind === "concept") {
      return exact(candidate, [
        "kind",
        "meaning",
        "context",
        "boundary",
        "sequence",
        "currentStep",
        "evidence"
      ]) && bounded(candidate.meaning, 1, 1024) && bounded(candidate.context, 1, 1024) && bounded(candidate.boundary, 1, 1024) && Array.isArray(candidate.sequence) && candidate.sequence.length >= 2 && candidate.sequence.length <= 4 && candidate.sequence.every((item) => bounded(item, 1, 256)) && Number.isSafeInteger(candidate.currentStep) && Number(candidate.currentStep) >= 0 && Number(candidate.currentStep) < candidate.sequence.length;
    }
    if (candidate.kind === "change") {
      return exact(candidate, ["kind", "before", "after", "impact", "evidence"]) && bounded(candidate.before, 1, 1024) && bounded(candidate.after, 1, 1024) && bounded(candidate.impact, 1, 1024);
    }
    if (candidate.kind === "decision") {
      return exact(candidate, ["kind", "problem", "choice", "consequence", "evidence"]) && bounded(candidate.problem, 1, 1024) && bounded(candidate.choice, 1, 1024) && bounded(candidate.consequence, 1, 1024);
    }
    if (candidate.kind === "task") {
      return exact(candidate, [
        "kind",
        "goal",
        "status",
        "completed",
        "next",
        "blocker",
        "updatedAt",
        "evidence"
      ]) && bounded(candidate.goal, 1, 1024) && bounded(candidate.status, 1, 1024) && bounded(candidate.completed, 1, 1024) && bounded(candidate.next, 1, 1024) && bounded(candidate.blocker, 1, 1024) && bounded(candidate.updatedAt, 20, 64) && Number.isFinite(Date.parse(candidate.updatedAt));
    }
    return candidate.kind === "verification" && exact(candidate, ["kind", "claim", "result", "gap", "executedAt", "evidence"]) && bounded(candidate.claim, 1, 1024) && bounded(candidate.result, 1, 1024) && bounded(candidate.gap, 1, 1024) && bounded(candidate.executedAt, 20, 64) && Number.isFinite(Date.parse(candidate.executedAt));
  };
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
      "humanSummary",
      "comprehension",
      "detailRef",
      "changes"
    ]) || !bounded(detail.entityId, 1, 256) || !bounded(detail.entityType, 1, 128) || !bounded(detail.label, 1, 256) || !bounded(detail.summary, 1, 1024) || !bounded(detail.revision, 1, 512) || !bounded(detail.observedAt, 20, 64) || !Number.isFinite(Date.parse(detail.observedAt)) || detail.freshness !== "current" && detail.freshness !== "stale" && detail.freshness !== "partial" && detail.freshness !== "unknown" || !Array.isArray(detail.facts) || detail.facts.length > 5 || !detail.facts.every(factView) || !Array.isArray(detail.sources) || detail.sources.length > 5 || !detail.sources.every(sourceView) || detail.humanSummary !== void 0 && !bounded(detail.humanSummary, 1, 1024) || detail.comprehension !== void 0 && !comprehensionView(detail.comprehension) || detail.detailRef !== void 0 && !bounded(detail.detailRef, 8, 256) || detail.changes !== void 0 && (!Array.isArray(detail.changes) || detail.changes.length > 3 || !detail.changes.every(changeView))) {
      return void 0;
    }
  } else if (presentation.kind === "revision") {
    const revision2 = presentation.revision;
    if (!exact(presentation, ["kind", "revision"]) || !isRecord(revision2) || !exact(revision2, ["detailRef", "state", "checkedAt"]) || !bounded(revision2.detailRef, 8, 256) || revision2.state !== "unchanged" && revision2.state !== "updated" && revision2.state !== "deleted" && revision2.state !== "unavailable" || !bounded(revision2.checkedAt, 20, 64) || !Number.isFinite(Date.parse(revision2.checkedAt))) {
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
  const presentationMode = config.presentationMode === "narrative" || config.presentationMode === "mental-model" || config.presentationMode === "record" ? config.presentationMode : "record";
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
  let holdCardPlacementUntil = 0;
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
      const composer = card !== null && target instanceof Element ? target.closest(
        'textarea, input, [contenteditable="true"], [role="textbox"]'
      ) : null;
      if (composer !== null && stableRoot.contains(composer)) {
        restoreFocus = composer;
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
  function createShell(titleText, reuseExisting = false) {
    const existing2 = reuseExisting ? connectedOwnedElement("card") : null;
    const preservedScrollTop = existing2?.scrollTop ?? 0;
    removeOwned("action");
    if (existing2 === null) removeOwned("card");
    if (restoreFocus === void 0 && document.activeElement instanceof HTMLElement) {
      restoreFocus = document.activeElement;
    }
    const shell = existing2 ?? document.createElement("section");
    if (existing2 === null) {
      shell.id = availableOwnedId(cardIdBase);
      shell.tabIndex = -1;
      shell.setAttribute("role", "dialog");
      shell.setAttribute("aria-modal", "false");
      shell.setAttribute("aria-labelledby", `${shell.id}-title`);
      shell.setAttribute("data-pointable-context-owned", lifecycleId);
      shell.setAttribute("data-pointable-context-role", "card");
      shell.setAttribute("data-pointable-context-presentation", presentationMode);
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
    } else {
      shell.replaceChildren();
      holdCardPlacementUntil = performance.now() + 250;
    }
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
    if (existing2 === null) document.body.append(shell);
    installOutsideHandler();
    if (existing2 === null) {
      resizeObserver?.disconnect();
      resizeObserver?.observe(shell);
      window.queueMicrotask(() => {
        if (shell.isConnected) shell.focus({ preventScroll: true });
      });
      reposition();
    } else {
      window.queueMicrotask(() => {
        if (shell.isConnected) {
          shell.scrollTop = preservedScrollTop;
          shell.focus({ preventScroll: true });
        }
      });
    }
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
  function mountComprehension(body, model, evidenceExpanded = false) {
    const surface = document.createElement("div");
    surface.setAttribute("data-pointable-context-role", "comprehension-model");
    surface.setAttribute("data-pointable-context-kind", model.kind);
    const modelBlock = (role, label, text, tone = "neutral") => {
      const block = document.createElement("div");
      block.setAttribute("data-pointable-context-role", role);
      Object.assign(block.style, {
        marginTop: "10px",
        padding: "8px 10px",
        borderLeft: tone === "primary" ? "3px solid #7798ff" : "3px solid #d7deea",
        borderRadius: "0 8px 8px 0",
        background: tone === "primary" ? "#edf2ff" : tone === "impact" ? "#fff7ed" : "#f8fafc",
        color: tone === "primary" ? "#1746c7" : tone === "impact" ? "#8a4b00" : "#334155"
      });
      const heading = document.createElement("strong");
      heading.textContent = label;
      Object.assign(heading.style, {
        display: "block",
        marginBottom: "3px",
        fontSize: "12px"
      });
      block.append(heading, paragraph(text, true));
      return block;
    };
    const arrow = () => {
      const node = document.createElement("div");
      node.textContent = "\u2193";
      node.setAttribute("aria-hidden", "true");
      Object.assign(node.style, {
        height: "16px",
        color: "#94a3b8",
        textAlign: "center",
        lineHeight: "16px"
      });
      return node;
    };
    if (model.kind === "concept") {
      surface.append(paragraph(model.meaning));
      surface.append(modelBlock(
        "comprehension-context",
        "\u4E3A\u4EC0\u4E48\u73B0\u5728\u51FA\u73B0",
        model.context,
        "primary"
      ));
      const flow = document.createElement("div");
      flow.setAttribute("data-pointable-context-role", "comprehension-flow");
      Object.assign(flow.style, { marginTop: "12px" });
      const flowLabel = document.createElement("strong");
      flowLabel.textContent = "\u4F60\u73B0\u5728\u4F4D\u4E8E\u8FD9\u91CC";
      Object.assign(flowLabel.style, {
        display: "block",
        marginBottom: "6px",
        color: "#334155",
        fontSize: "12px"
      });
      flow.append(flowLabel);
      for (let index = 0; index < model.sequence.length; index += 1) {
        const step = document.createElement("div");
        const current = index === model.currentStep;
        step.setAttribute("data-pointable-context-role", "comprehension-step");
        step.setAttribute("data-pointable-context-current", String(current));
        step.textContent = `${current ? "\u5F53\u524D \xB7 " : ""}${model.sequence[index] ?? ""}`;
        Object.assign(step.style, {
          padding: "6px 9px",
          border: current ? "1px solid #7798ff" : "1px solid #dce3ee",
          borderRadius: "8px",
          background: current ? "#edf2ff" : "#ffffff",
          color: current ? "#1746c7" : "#52627a",
          fontWeight: current ? "700" : "500",
          fontSize: "12px"
        });
        flow.append(step);
        if (index < model.sequence.length - 1) flow.append(arrow());
      }
      surface.append(flow);
      const boundary = modelBlock(
        "comprehension-boundary",
        "\u4E0D\u4F1A\u8BC1\u660E\uFF1A",
        model.boundary,
        "impact"
      );
      boundary.style.borderLeft = "3px solid #f2b86b";
      surface.append(boundary);
    } else if (model.kind === "change") {
      surface.append(
        modelBlock("comprehension-before", "\u539F\u6765", model.before),
        arrow(),
        modelBlock("comprehension-after", "\u73B0\u5728", model.after, "primary"),
        modelBlock("comprehension-impact", "\u8FD9\u4F1A\u5F71\u54CD", model.impact, "impact")
      );
    } else if (model.kind === "decision") {
      surface.append(
        modelBlock("comprehension-problem", "\u8981\u89E3\u51B3\u7684\u95EE\u9898", model.problem),
        arrow(),
        modelBlock("comprehension-choice", "\u9009\u62E9", model.choice, "primary"),
        modelBlock("comprehension-consequence", "\u7ED3\u679C\u4E0E\u4EE3\u4EF7", model.consequence, "impact")
      );
    } else if (model.kind === "task") {
      surface.append(
        paragraph(model.goal),
        modelBlock("comprehension-status", "\u5F53\u524D\u72B6\u6001", model.status, "primary"),
        modelBlock("comprehension-completed", "\u5DF2\u7ECF\u5B8C\u6210", model.completed),
        modelBlock("comprehension-next", "\u63A5\u4E0B\u6765", model.next, "primary"),
        modelBlock("comprehension-blocker", "\u963B\u585E", model.blocker, "impact")
      );
    } else {
      surface.append(
        paragraph(model.claim),
        modelBlock("comprehension-result", "\u9A8C\u8BC1\u7ED3\u679C", model.result, "primary"),
        modelBlock("comprehension-gap", "\u4ECD\u672A\u8BC1\u660E", model.gap, "impact")
      );
    }
    const evidenceDisclosure = document.createElement("div");
    evidenceDisclosure.setAttribute("data-pointable-context-role", "evidence-disclosure");
    Object.assign(evidenceDisclosure.style, { marginTop: "8px" });
    const evidenceToggle = document.createElement("button");
    evidenceToggle.type = "button";
    evidenceToggle.textContent = evidenceExpanded ? "\u6536\u8D77\u4F9D\u636E" : "\u4E3A\u4EC0\u4E48\u8FD9\u6837\u8BF4";
    evidenceToggle.setAttribute("aria-expanded", String(evidenceExpanded));
    evidenceToggle.setAttribute("data-pointable-context-role", "evidence-toggle");
    Object.assign(evidenceToggle.style, {
      border: "0",
      background: "transparent",
      color: "#52627a",
      cursor: "pointer",
      padding: "2px 0",
      fontSize: "12px",
      fontWeight: "600"
    });
    const evidenceBody = document.createElement("div");
    evidenceBody.id = `${cardElement?.id ?? cardIdBase}-evidence-body`;
    evidenceBody.hidden = !evidenceExpanded;
    evidenceBody.style.display = evidenceExpanded ? "block" : "none";
    evidenceBody.setAttribute("data-pointable-context-role", "evidence-body");
    evidenceToggle.setAttribute("aria-controls", evidenceBody.id);
    for (const item of model.evidence) {
      const quote = document.createElement("blockquote");
      quote.textContent = item.excerpt;
      Object.assign(quote.style, {
        margin: "8px 0 0",
        padding: "7px 9px",
        borderLeft: "3px solid #cbd5e1",
        color: "#475569",
        fontSize: "11px"
      });
      const source = paragraph(item.source, true);
      Object.assign(source.style, { marginTop: "4px", fontSize: "11px" });
      evidenceBody.append(quote, source);
    }
    evidenceToggle.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      event.preventDefault();
      event.stopPropagation();
      const expanded = evidenceToggle.getAttribute("aria-expanded") !== "true";
      evidenceToggle.setAttribute("aria-expanded", String(expanded));
      evidenceBody.hidden = !expanded;
      evidenceBody.style.display = expanded ? "block" : "none";
      evidenceToggle.textContent = expanded ? "\u6536\u8D77\u4F9D\u636E" : "\u4E3A\u4EC0\u4E48\u8FD9\u6837\u8BF4";
      reposition();
    });
    evidenceDisclosure.append(evidenceToggle, evidenceBody);
    surface.append(evidenceDisclosure);
    body.append(surface);
  }
  function mountDetail(detail, preserveUiState = false) {
    clearRevisionTimer();
    const previousCard = preserveUiState ? connectedOwnedElement("card") : null;
    const detailExpanded = previousCard?.querySelector('[data-pointable-context-role="detail-toggle"]')?.getAttribute("aria-expanded") === "true";
    const evidenceExpanded = previousCard?.querySelector('[data-pointable-context-role="evidence-toggle"]')?.getAttribute("aria-expanded") === "true";
    state = "detail";
    const { body } = createShell(detail.label, preserveUiState);
    if (presentationMode === "mental-model" && detail.comprehension !== void 0) {
      mountComprehension(body, detail.comprehension, evidenceExpanded);
    } else {
      const summary = presentationMode === "record" ? detail.summary : detail.humanSummary ?? detail.summary;
      body.append(paragraph(summary));
    }
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
    disclosureToggle.textContent = detailExpanded ? "\u6536\u8D77\u8BE6\u60C5" : "\u67E5\u770B\u8BE6\u60C5";
    disclosureToggle.setAttribute("aria-label", "\u5C55\u5F00\u4E0A\u4E0B\u6587\u8BE6\u60C5");
    disclosureToggle.setAttribute("aria-expanded", String(detailExpanded));
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
    detailBody.hidden = !detailExpanded;
    detailBody.style.display = detailExpanded ? "block" : "none";
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
      mountDetail(response.presentation.detail, request.operation === "refresh");
    } else if (response.presentation.kind === "revision") {
      const revision2 = response.presentation.revision;
      state = "detail";
      if (revision2.state === "unchanged") {
        removeRevisionNotice();
        scheduleRevisionCheck(revision2.detailRef, request.generation);
      } else {
        showRevisionNotice(revision2.state, revision2.detailRef);
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
      if (target.getAttribute("data-pointable-context-role") === "card" && performance.now() < holdCardPlacementUntil) {
        return;
      }
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
    holdCardPlacementUntil = 0;
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
function record3(value) {
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
  return new Promise((resolve6, reject) => {
    const aborted = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener("abort", aborted);
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve6(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}
function parseTarget(value, endpoint) {
  if (!record3(value) || value.type !== "page" || typeof value.id !== "string" || value.id.length < 1 || value.id.length > 256 || !/^[A-Za-z0-9:_-]+$/u.test(value.id) || typeof value.title !== "string" || value.title.length > 512 || value.url !== "app://-/index.html" || typeof value.webSocketDebuggerUrl !== "string") {
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
function record4(value) {
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
  await new Promise((resolve6, reject) => {
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
      resolve6();
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
    if (!record4(message)) return;
    if (typeof message.id === "number") {
      const command = pending.get(message.id);
      if (command === void 0) return;
      pending.delete(message.id);
      clearTimeout(command.timer);
      if (record4(message.error)) {
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
    if (record4(message.params)) cdpEvent.params = message.params;
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
      return new Promise((resolve6, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new CdpTransportError(
              "cdp_command_timeout",
              `CDP command ${method} timed out`
            )
          );
        }, timeoutMs);
        pending.set(id, { resolve: resolve6, reject, timer });
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
function record5(value) {
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
  if (!record5(value) || Reflect.ownKeys(value).some((key) => typeof key !== "string") || Object.keys(value).sort().join("|") !== "contextFingerprint|host|hostId|routeRef|schemaVersion|threadId" || value.schemaVersion !== 1 || value.host !== "codex-desktop" || !boundedIdentity(value.threadId) || !boundedIdentity(value.hostId) || !boundedRoute(value.routeRef) || typeof value.contextFingerprint !== "string" || value.contextFingerprint.length < 1 || value.contextFingerprint.length > 2048) {
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
function record6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function runtimeValue(value) {
  if (!record6(value) || !record6(value.result) || value.exceptionDetails !== void 0) {
    return void 0;
  }
  return value.result.value;
}
function parseInstalledStatus(value, bindingName) {
  if (!record6(value) || value.installed !== true || value.bindingName !== bindingName || typeof value.lifecycleId !== "string" || !/^[A-Za-z0-9:_-]{8,256}$/u.test(value.lifecycleId) || typeof value.state !== "string") {
    throw new Error("pointable_renderer_install_unverified");
  }
  return value;
}
function parseMainFrameId(value, target) {
  if (!record6(value) || !record6(value.frameTree) || !record6(value.frameTree.frame) || typeof value.frameTree.frame.id !== "string" || value.frameTree.frame.id.length < 1 || value.frameTree.frame.id.length > 256 || value.frameTree.frame.url !== target.url) {
    throw new Error("pointable_main_frame_unverified");
  }
  return value.frameTree.frame.id;
}
function mainExecutionContext(event, mainFrameId) {
  if (event.method !== "Runtime.executionContextCreated" || !record6(event.params)) {
    return void 0;
  }
  const context = event.params.context;
  if (!record6(context) || !Number.isSafeInteger(context.id) || Number(context.id) < 1) {
    return void 0;
  }
  const auxiliary = context.auxData;
  if (!record6(auxiliary) || auxiliary.isDefault !== true || auxiliary.frameId !== mainFrameId) {
    return void 0;
  }
  return Number(context.id);
}
function lookupError(code, message, retryable) {
  return { kind: "error", code, message, retryable };
}
function boundedLookup(callback, timeoutMs, controller) {
  return new Promise((resolve6, reject) => {
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
        resolve6(value);
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
  return new Promise((resolve6, reject) => {
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
      resolve6(contextId);
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
  return new Promise((resolve6, reject) => {
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
        resolve6(connection);
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
  #presentationMode;
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
    this.#presentationMode = options.presentationMode;
    if (this.#presentationMode !== void 0 && this.#presentationMode !== "record" && this.#presentationMode !== "narrative" && this.#presentationMode !== "mental-model") {
      throw new RangeError("presentationMode is invalid");
    }
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
    const bindingGeneration = randomUUID2();
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
        ...this.#actionLabel === void 0 ? {} : { actionLabel: this.#actionLabel },
        ...this.#presentationMode === void 0 ? {} : { presentationMode: this.#presentationMode }
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
    if (event.method === "Runtime.executionContextDestroyed" && record6(event.params) && event.params.executionContextId === attachment.mainExecutionContextId) {
      this.#invalidateAttachment(attachment);
      return;
    }
    if (event.method === "Page.frameNavigated" && record6(event.params) && record6(event.params.frame) && event.params.frame.id === attachment.mainFrameId && attachment.mainFrameId.length > 0) {
      this.#invalidateAttachment(attachment);
      return;
    }
    if (event.method !== "Runtime.bindingCalled" || !record6(event.params)) return;
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

// src/host/codex-cdp/workspace-lookup.ts
import { createHash as createHash7, randomBytes as randomBytes3 } from "node:crypto";

// src/adapters/local-workspace.ts
import { execFile as execFile3 } from "node:child_process";
import { createHash as createHash6 } from "node:crypto";
import { open, readdir, realpath as realpath2, stat as stat2 } from "node:fs/promises";
import {
  basename as basename3,
  dirname as dirname2,
  extname as extname3,
  isAbsolute as isAbsolute2,
  relative,
  resolve as resolve4,
  sep
} from "node:path";

// src/adapters/markdown-artifact.ts
import { execFile } from "node:child_process";
import { createHash as createHash3 } from "node:crypto";
import { resolve as resolve2 } from "node:path";
var GIT_TIMEOUT_MS = 750;
var MAX_GIT_OUTPUT_BYTES = 256 * 1024;
var MAX_PURPOSE_CHARS = 360;
var MAX_HEADING_CHARS = 160;
var MAX_IMPACT_FILES = 3;
function boundedText(value, maximum) {
  const compact2 = value.replace(/[\p{Cc}\p{Cf}]+/gu, " ").replace(/\s+/gu, " ").trim();
  if (compact2.length === 0) return void 0;
  return compact2.length <= maximum ? compact2 : `${compact2.slice(0, maximum - 1)}\u2026`;
}
function inlineMarkdown(value) {
  return boundedText(
    value.replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1").replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1").replace(/[`*_~]+/gu, "").replace(/\s+#+\s*$/u, ""),
    MAX_HEADING_CHARS
  );
}
function paragraphCandidate(line) {
  const trimmed = line.trim();
  return trimmed.length > 0 && !/^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~|<|!\[|\[!)/u.test(trimmed) && !/^[-:=]{3,}$/u.test(trimmed);
}
function extractMarkdownStructure(content) {
  const lines = content.replace(/\r\n?/gu, "\n").split("\n");
  const headings = [];
  let title;
  let purpose;
  let inFence = false;
  let inFrontmatter = lines[0]?.trim() === "---";
  let paragraph = [];
  const commitParagraph = () => {
    if (purpose !== void 0 || paragraph.length === 0) {
      paragraph = [];
      return;
    }
    purpose = boundedText(paragraph.join(" "), MAX_PURPOSE_CHARS);
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (inFrontmatter) {
      if (index > 0 && trimmed === "---") inFrontmatter = false;
      continue;
    }
    if (/^(?:```|~~~)/u.test(trimmed)) {
      commitParagraph();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = /^(#{1,6})[ \t]+(.+?)\s*$/u.exec(line);
    if (heading) {
      commitParagraph();
      const label = inlineMarkdown(heading[2] ?? "");
      if (label !== void 0) {
        headings.push({ line: index + 1, label });
        if (heading[1]?.length === 1 && title === void 0) title = label;
      }
      continue;
    }
    if (paragraphCandidate(line)) {
      paragraph.push(trimmed);
      continue;
    }
    commitParagraph();
  }
  commitParagraph();
  return Object.freeze({
    ...title === void 0 ? {} : { title },
    ...purpose === void 0 ? {} : { purpose },
    headings: Object.freeze(headings.map((heading) => Object.freeze({ ...heading })))
  });
}
function runGit(root, args, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("git operation aborted"));
  return new Promise((resolveResult, rejectResult) => {
    execFile("git", [...args], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      ...signal === void 0 ? {} : { signal }
    }, (error, stdout) => {
      if (signal?.aborted) {
        rejectResult(signal.reason ?? new Error("git operation aborted"));
        return;
      }
      const output = typeof stdout === "string" ? stdout : "";
      if (error === null) {
        resolveResult({ kind: "ok", stdout: output });
        return;
      }
      const code = error.code;
      resolveResult(code === 1 || code === "1" ? { kind: "no_match", stdout: output } : { kind: "unavailable", stdout: "" });
    });
  });
}
function samePath(left, right) {
  const normalize = (value) => {
    const absolute = resolve2(value);
    return process.platform === "win32" ? absolute.toLocaleLowerCase("en-US") : absolute;
  };
  return normalize(left) === normalize(right);
}
function gitStatus(value) {
  if (value.length === 0) return "clean";
  const code = value.slice(0, 2);
  if (code === "??") return "untracked";
  if (/U|AA|DD/u.test(code)) return "conflicted";
  const staged = code[0] !== " ";
  const modified = code[1] !== " ";
  if (staged && modified) return "staged_and_modified";
  if (staged) return "staged";
  return modified ? "modified" : "clean";
}
function changedSections(diff, structure, state) {
  if (state === "untracked") return ["\u65B0\u6587\u4EF6"];
  const result = [];
  const add = (label) => {
    if (label !== void 0 && !result.includes(label) && result.length < 3) result.push(label);
  };
  for (const line of diff.replace(/\r\n?/gu, "\n").split("\n")) {
    if (/^[+-]#{1,6}[ \t]/u.test(line) && !/^(?:\+\+\+|---)/u.test(line)) {
      const label = inlineMarkdown(line.replace(/^[+-]#{1,6}[ \t]+/u, ""));
      if (line.startsWith("+") || structure.headings.some((heading) => heading.label === label)) {
        add(label);
      }
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
    if (!hunk) continue;
    const currentLine = Number(hunk[1]);
    let section2;
    for (const heading of structure.headings) {
      if (heading.line > currentLine) break;
      section2 = heading.label;
    }
    add(section2 ?? structure.title ?? "\u6587\u6863\u5F00\u5934");
  }
  if (result.length === 0 && state !== "clean" && state !== "unavailable") {
    add(structure.title ?? "\u6587\u6863\u5F00\u5934");
  }
  return result;
}
function parseLastCommit(value) {
  const [hash, , subject] = value.trim().split("\0");
  const safeHash = typeof hash === "string" && /^[0-9a-f]{7,64}$/u.test(hash) ? hash.slice(0, 8) : void 0;
  const safeSubject = typeof subject === "string" ? boundedText(subject, 220) : void 0;
  return safeHash === void 0 || safeSubject === void 0 ? void 0 : `${safeHash} \xB7 ${safeSubject}`;
}
function parseImpactFiles(value, relativePath) {
  const results = [];
  for (const raw of value.split("\0")) {
    const path = boundedText(raw.replace(/\\/gu, "/"), 512);
    if (path === void 0 || path === relativePath || results.includes(path)) continue;
    results.push(path);
    if (results.length >= MAX_IMPACT_FILES) break;
  }
  return results;
}
async function extractMarkdownArtifactContext(options) {
  const structure = extractMarkdownStructure(options.content);
  const rootResult = await runGit(options.root, ["rev-parse", "--show-toplevel"], options.signal);
  if (rootResult.kind !== "ok" || !samePath(rootResult.stdout.trim(), options.root)) {
    const base2 = {
      ...structure.title === void 0 ? {} : { title: structure.title },
      ...structure.purpose === void 0 ? {} : { purpose: structure.purpose },
      gitAvailable: false,
      gitStatus: "unavailable",
      changedSections: Object.freeze([]),
      impactFiles: Object.freeze([])
    };
    return Object.freeze({
      ...base2,
      contextRevision: createHash3("sha256").update(JSON.stringify(base2), "utf8").digest("hex")
    });
  }
  const [statusResult, unstaged, staged, references, lastCommit] = await Promise.all([
    runGit(options.root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      options.relativePath
    ], options.signal),
    runGit(options.root, ["diff", "--no-ext-diff", "--unified=0", "--", options.relativePath], options.signal),
    runGit(options.root, ["diff", "--cached", "--no-ext-diff", "--unified=0", "--", options.relativePath], options.signal),
    runGit(options.root, [
      "grep",
      "-l",
      "-F",
      "-z",
      "-e",
      options.relativePath.split("/").at(-1) ?? options.relativePath,
      "--",
      "."
    ], options.signal),
    runGit(options.root, ["log", "-1", "--format=%H%x00%aI%x00%s", "--", options.relativePath], options.signal)
  ]);
  const state = statusResult.kind === "ok" ? gitStatus(statusResult.stdout) : "unavailable";
  const diff = `${unstaged.kind === "ok" ? unstaged.stdout : ""}
${staged.kind === "ok" ? staged.stdout : ""}`;
  const sections = changedSections(diff, structure, state);
  const impactFiles = references.kind === "ok" ? parseImpactFiles(references.stdout, options.relativePath) : [];
  const recentCommit = lastCommit.kind === "ok" ? parseLastCommit(lastCommit.stdout) : void 0;
  const changeSummary = sections.length > 0 ? `\u6D89\u53CA\uFF1A${sections.join("\u3001")}` : recentCommit;
  const base = {
    ...structure.title === void 0 ? {} : { title: structure.title },
    ...structure.purpose === void 0 ? {} : { purpose: structure.purpose },
    gitAvailable: state !== "unavailable",
    gitStatus: state,
    ...changeSummary === void 0 ? {} : { changeSummary },
    changedSections: Object.freeze([...sections]),
    impactFiles: Object.freeze([...impactFiles])
  };
  return Object.freeze({
    ...base,
    contextRevision: createHash3("sha256").update(JSON.stringify(base), "utf8").digest("hex")
  });
}

// src/adapters/context-concept.ts
import { createHash as createHash4 } from "node:crypto";
var MAX_FIELD_CHARS = 1024;
var MAX_SEQUENCE_ITEMS = 4;
var MAX_SOURCE_PATH_CHARS = 480;
function boundedText2(value, maximum = MAX_FIELD_CHARS) {
  const compact2 = value.replace(/[\p{Cc}\p{Cf}]+/gu, " ").replace(/\s+/gu, " ").trim();
  if (compact2.length === 0) return void 0;
  return compact2.length <= maximum ? compact2 : `${compact2.slice(0, maximum - 1)}\u2026`;
}
function sectionText(lines) {
  return boundedText2(
    lines.filter((line) => line.trim().length > 0).map((line) => line.replace(/^>\s?/u, "").trim()).join(" ")
  );
}
function sourceReference(value) {
  const compact2 = value.trim().replace(/\\/gu, "/");
  const match = /^([^:\r\n]{1,480}):(\d{1,6})$/u.exec(compact2);
  if (match === null) return void 0;
  const sourcePath = match[1];
  const sourceLine = Number(match[2]);
  if (sourcePath === void 0 || sourcePath.length > MAX_SOURCE_PATH_CHARS || sourcePath.startsWith("/") || sourcePath.split("/").includes("..") || !Number.isSafeInteger(sourceLine) || sourceLine < 1) {
    return void 0;
  }
  return { sourcePath, sourceLine };
}
function contextConceptDocumentPath(relativePath) {
  const portable2 = relativePath.replace(/\\/gu, "/");
  return /(?:^|\/)docs\/concepts\/[^/]+\.md$/iu.test(portable2);
}
function contextChangeDocumentPath(relativePath) {
  const portable2 = relativePath.replace(/\\/gu, "/");
  return /(?:^|\/)docs\/changes\/[^/]+\.md$/iu.test(portable2);
}
function contextDecisionDocumentPath(relativePath) {
  const portable2 = relativePath.replace(/\\/gu, "/");
  return /(?:^|\/)docs\/decisions\/[^/]+\.md$/iu.test(portable2);
}
function contextTaskDocumentPath(relativePath) {
  const portable2 = relativePath.replace(/\\/gu, "/");
  return /(?:^|\/)docs\/tasks\/[^/]+\.md$/iu.test(portable2);
}
function contextVerificationDocumentPath(relativePath) {
  const portable2 = relativePath.replace(/\\/gu, "/");
  return /(?:^|\/)docs\/verifications\/[^/]+\.md$/iu.test(portable2);
}
function documentSections(content) {
  const lines = content.replace(/\r\n?/gu, "\n").split("\n");
  const sections = /* @__PURE__ */ new Map();
  let title;
  let activeSection;
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(?:```|~~~)/u.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = /^(#{1,2})[ \t]+(.+?)\s*$/u.exec(line);
    if (heading !== null) {
      const label = boundedText2(heading[2] ?? "", 128);
      if (heading[1] === "#" && title === void 0) title = label;
      activeSection = heading[1] === "##" ? label : void 0;
      if (activeSection !== void 0 && !sections.has(activeSection)) {
        sections.set(activeSection, []);
      }
      continue;
    }
    if (activeSection !== void 0) sections.get(activeSection)?.push(line);
  }
  return { ...title === void 0 ? {} : { title }, sections };
}
function exactSectionOrder(content, expected) {
  const headings = [];
  let h1Count = 0;
  let inFence = false;
  for (const line of content.replace(/\r\n?/gu, "\n").split("\n")) {
    const trimmed = line.trim();
    if (/^(?:```|~~~)/u.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,2})[ \t]+(.+?)\s*$/u.exec(line);
    if (match?.[1] === "#") h1Count += 1;
    if (match?.[1] === "##") headings.push((match[2] ?? "").trim());
  }
  return h1Count === 1 && headings.length === expected.length && headings.every((heading, index) => heading === expected[index]);
}
function artifactEvidence(sections) {
  const excerpt = sectionText(sections.get("\u8BC1\u636E") ?? []);
  const source = sourceReference(sectionText(sections.get("\u6765\u6E90") ?? []) ?? "");
  return excerpt === void 0 || source === void 0 ? void 0 : Object.freeze({ excerpt, ...source });
}
function revision(base) {
  return Object.freeze({
    ...base,
    contextRevision: createHash4("sha256").update(JSON.stringify(base), "utf8").digest("hex")
  });
}
function isoTimestamp(value) {
  if (value === void 0 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) {
    return void 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : void 0;
}
function extractContextConceptArtifact(content) {
  const { title, sections } = documentSections(content);
  const meaning = sectionText(sections.get("\u5B83\u662F\u4EC0\u4E48\u610F\u601D") ?? []);
  const currentContext = sectionText(sections.get("\u4E3A\u4EC0\u4E48\u73B0\u5728\u51FA\u73B0") ?? []);
  const boundary = sectionText(sections.get("\u5B83\u4E0D\u662F\u4EC0\u4E48") ?? []);
  const evidence = artifactEvidence(sections);
  const flowLines = sections.get("\u6240\u5904\u6D41\u7A0B") ?? [];
  const sequence = [];
  let currentStep;
  for (const line of flowLines) {
    const match = /^[-*+]\s+(.+?)\s*$/u.exec(line.trim());
    if (match === null || sequence.length >= MAX_SEQUENCE_ITEMS) continue;
    const raw = match[1] ?? "";
    const current = /^当前[：:]\s*/u.test(raw);
    const value = boundedText2(raw.replace(/^当前[：:]\s*/u, ""), 256);
    if (value === void 0) continue;
    if (current && currentStep === void 0) currentStep = sequence.length;
    sequence.push(value);
  }
  if (title === void 0 || meaning === void 0 || currentContext === void 0 || boundary === void 0 || sequence.length < 2 || currentStep === void 0 || evidence === void 0) {
    return void 0;
  }
  const base = {
    title,
    meaning,
    currentContext,
    boundary,
    sequence: Object.freeze([...sequence]),
    currentStep,
    evidence
  };
  return revision(base);
}
function extractContextChangeArtifact(content) {
  const { title, sections } = documentSections(content);
  const before = sectionText(sections.get("\u539F\u6765\u600E\u6837") ?? []);
  const after = sectionText(sections.get("\u73B0\u5728\u600E\u6837") ?? []);
  const impact = sectionText(sections.get("\u5F71\u54CD\u4EC0\u4E48") ?? []);
  const evidence = artifactEvidence(sections);
  if (title === void 0 || before === void 0 || after === void 0 || impact === void 0 || evidence === void 0) {
    return void 0;
  }
  return revision({ title, before, after, impact, evidence });
}
function extractContextDecisionArtifact(content) {
  const { title, sections } = documentSections(content);
  const problem = sectionText(sections.get("\u4E3A\u4EC0\u4E48\u9700\u8981\u51B3\u5B9A") ?? []);
  const choice = sectionText(sections.get("\u9009\u62E9\u4E86\u4EC0\u4E48") ?? []);
  const consequence = sectionText(sections.get("\u540E\u679C\u662F\u4EC0\u4E48") ?? []);
  const evidence = artifactEvidence(sections);
  if (title === void 0 || problem === void 0 || choice === void 0 || consequence === void 0 || evidence === void 0) {
    return void 0;
  }
  return revision({ title, problem, choice, consequence, evidence });
}
function extractContextTaskArtifact(content) {
  if (!exactSectionOrder(content, [
    "\u76EE\u6807",
    "\u5F53\u524D\u72B6\u6001",
    "\u5DF2\u5B8C\u6210",
    "\u4E0B\u4E00\u6B65",
    "\u963B\u585E",
    "\u66F4\u65B0\u65F6\u95F4",
    "\u8BC1\u636E",
    "\u6765\u6E90"
  ])) return void 0;
  const { title, sections } = documentSections(content);
  const goal = sectionText(sections.get("\u76EE\u6807") ?? []);
  const status = sectionText(sections.get("\u5F53\u524D\u72B6\u6001") ?? []);
  const completed = sectionText(sections.get("\u5DF2\u5B8C\u6210") ?? []);
  const next = sectionText(sections.get("\u4E0B\u4E00\u6B65") ?? []);
  const blocker = sectionText(sections.get("\u963B\u585E") ?? []);
  const updatedAt = isoTimestamp(sectionText(sections.get("\u66F4\u65B0\u65F6\u95F4") ?? []));
  const evidence = artifactEvidence(sections);
  if (title === void 0 || goal === void 0 || status === void 0 || completed === void 0 || next === void 0 || blocker === void 0 || updatedAt === void 0 || evidence === void 0) {
    return void 0;
  }
  return revision({ title, goal, status, completed, next, blocker, updatedAt, evidence });
}
function extractContextVerificationArtifact(content) {
  if (!exactSectionOrder(content, [
    "\u8981\u8BC1\u660E\u4EC0\u4E48",
    "\u7ED3\u679C",
    "\u5C1A\u672A\u8BC1\u660E",
    "\u9A8C\u8BC1\u65B9\u5F0F",
    "\u9A8C\u8BC1\u4FEE\u8BA2",
    "\u6267\u884C\u65F6\u95F4",
    "\u8BC1\u636E",
    "\u6765\u6E90"
  ])) return void 0;
  const { title, sections } = documentSections(content);
  const claim = sectionText(sections.get("\u8981\u8BC1\u660E\u4EC0\u4E48") ?? []);
  const result = sectionText(sections.get("\u7ED3\u679C") ?? []);
  const gap = sectionText(sections.get("\u5C1A\u672A\u8BC1\u660E") ?? []);
  const method = sectionText(sections.get("\u9A8C\u8BC1\u65B9\u5F0F") ?? []);
  const verifiedRevision = sectionText(sections.get("\u9A8C\u8BC1\u4FEE\u8BA2") ?? []);
  const executedAt = isoTimestamp(sectionText(sections.get("\u6267\u884C\u65F6\u95F4") ?? []));
  const evidence = artifactEvidence(sections);
  if (title === void 0 || claim === void 0 || result === void 0 || gap === void 0 || method === void 0 || verifiedRevision === void 0 || executedAt === void 0 || evidence === void 0) {
    return void 0;
  }
  return revision({
    title,
    claim,
    result,
    gap,
    method,
    verifiedRevision,
    executedAt,
    evidence
  });
}

// src/adapters/source-module-artifact.ts
import { execFile as execFile2 } from "node:child_process";
import { createHash as createHash5 } from "node:crypto";
import { basename, extname, resolve as resolve3 } from "node:path";
var GIT_TIMEOUT_MS2 = 750;
var MAX_GIT_OUTPUT_BYTES2 = 256 * 1024;
var MAX_ROLE_CHARS = 360;
var MAX_SYMBOL_CHARS = 160;
var MAX_EXPORTS = 5;
var MAX_DEPENDENCIES = 12;
var MAX_IMPACT_FILES2 = 3;
var SOURCE_EXTENSIONS = /* @__PURE__ */ new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx"
]);
function sourceModulePath(relativePath) {
  return SOURCE_EXTENSIONS.has(extname(relativePath).toLocaleLowerCase("en-US"));
}
function boundedText3(value, maximum) {
  const compact2 = value.replace(/[\p{Cc}\p{Cf}]+/gu, " ").replace(/\s+/gu, " ").trim();
  if (compact2.length === 0) return void 0;
  return compact2.length <= maximum ? compact2 : `${compact2.slice(0, maximum - 1)}\u2026`;
}
function addBounded(target, value, maximum) {
  const safe = value === void 0 ? void 0 : boundedText3(value, MAX_SYMBOL_CHARS);
  if (safe !== void 0 && !target.includes(safe) && target.length < maximum) target.push(safe);
}
function maskCommentsAndStrings(content) {
  let state = "code";
  let escaped = false;
  let result = "";
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index] ?? "";
    const next = content[index + 1] ?? "";
    if (state === "code") {
      if (char === "/" && next === "/") {
        result += "  ";
        index += 1;
        state = "line";
      } else if (char === "/" && next === "*") {
        result += "  ";
        index += 1;
        state = "block";
      } else if (char === "'") {
        result += " ";
        state = "single";
      } else if (char === '"') {
        result += " ";
        state = "double";
      } else if (char === "`") {
        result += " ";
        state = "template";
      } else {
        result += char;
      }
      continue;
    }
    if (state === "line") {
      if (char === "\n") {
        result += "\n";
        state = "code";
      } else {
        result += " ";
      }
      continue;
    }
    if (state === "block") {
      if (char === "*" && next === "/") {
        result += "  ";
        index += 1;
        state = "code";
      } else {
        result += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (escaped) {
      result += char === "\n" ? "\n" : " ";
      escaped = false;
      continue;
    }
    if (char === "\\") {
      result += " ";
      escaped = true;
      continue;
    }
    const closes = state === "single" && char === "'" || state === "double" && char === '"' || state === "template" && char === "`";
    result += char === "\n" ? "\n" : " ";
    if (closes) state = "code";
  }
  return result;
}
function leadingRole(content) {
  const normalized = content.replace(/\r\n?/gu, "\n").replace(/^#![^\n]*(?:\n|$)/u, "");
  const block = /^\s*\/\*\*?([\s\S]*?)\*\//u.exec(normalized);
  const line = /^(?:\s*\/\/[^\n]*(?:\n|$))+/u.exec(normalized);
  const raw = block?.[1] ?? line?.[0];
  if (raw === void 0) return void 0;
  const prose = raw.split("\n").map((value) => value.replace(/^\s*(?:\/\/|\*)?\s?/u, "").trim()).filter(
    (value) => value.length > 0 && !/^(?:@|eslint|prettier|tslint|copyright|spdx-)/iu.test(value)
  ).join(" ");
  return boundedText3(prose, MAX_ROLE_CHARS);
}
function declarationName(value) {
  return /^(?:export\s+)?(?:declare\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/u.exec(value)?.[1] ?? /^(?:export\s+)?(?:declare\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)\b/u.exec(value)?.[1] ?? /^(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)\b/u.exec(value)?.[1] ?? /^(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/u.exec(value)?.[1] ?? /^(?:export\s+)?(?:declare\s+)?(?:enum|namespace)\s+([A-Za-z_$][\w$]*)\b/u.exec(value)?.[1] ?? /^(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/u.exec(value)?.[1];
}
function extractExports(masked) {
  const exports = [];
  const declaration = /^\s*export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|namespace|const|let|var)\s+([A-Za-z_$][\w$]*)/gmu;
  for (const match of masked.matchAll(declaration)) addBounded(exports, match[1], MAX_EXPORTS);
  if (/^\s*export\s+default\b/gmu.test(masked)) addBounded(exports, "default", MAX_EXPORTS);
  const lists = /^\s*export\s*\{([^}]*)\}/gmu;
  for (const match of masked.matchAll(lists)) {
    for (const item of (match[1] ?? "").split(",")) {
      const name = /(?:^|\s)as\s+([A-Za-z_$][\w$]*)\s*$/u.exec(item)?.[1] ?? /^\s*([A-Za-z_$][\w$]*)/u.exec(item)?.[1];
      addBounded(exports, name, MAX_EXPORTS);
    }
  }
  if (/^\s*module\.exports\s*=/gmu.test(masked)) addBounded(exports, "default", MAX_EXPORTS);
  const commonJs = /^\s*exports\.([A-Za-z_$][\w$]*)\s*=/gmu;
  for (const match of masked.matchAll(commonJs)) addBounded(exports, match[1], MAX_EXPORTS);
  return exports;
}
function extractDeclarations(masked) {
  const declarations = [];
  const lines = masked.split("\n");
  for (let index = 0; index < lines.length && declarations.length < 256; index += 1) {
    const name = boundedText3(declarationName(lines[index] ?? "") ?? "", MAX_SYMBOL_CHARS);
    if (name !== void 0 && declarations.length < 256) {
      declarations.push({ line: index + 1, name });
    }
  }
  return declarations;
}
function extractDependencies(content) {
  const dependencies = [];
  for (const line of content.replace(/\r\n?/gu, "\n").split("\n")) {
    if (/^\s*(?:\/\/|\/\*)/u.test(line)) continue;
    const specifier = /^\s*import(?:\s+type)?(?:\s+[\s\S]*?\s+from\s*)?\s*["']([^"']+)["']/u.exec(line)?.[1] ?? /^\s*export\s+[\s\S]*?\s+from\s*["']([^"']+)["']/u.exec(line)?.[1] ?? /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*require\(\s*["']([^"']+)["']\s*\)/u.exec(line)?.[1];
    addBounded(dependencies, specifier, MAX_DEPENDENCIES);
  }
  return dependencies;
}
function extractSourceModuleStructure(content, relativePath) {
  const masked = maskCommentsAndStrings(content);
  const exports = extractExports(masked);
  const dependencies = extractDependencies(content);
  const declarations = extractDeclarations(masked);
  const entry = /^(?:app|cli|index|main|mod|server)(?:\.[^.]+)+$/iu.test(basename(relativePath));
  const role = leadingRole(content) ?? boundedText3(
    exports.length > 0 ? `${entry ? "\u5165\u53E3\u6A21\u5757" : "\u6E90\u4EE3\u7801\u6A21\u5757"}\uFF1B\u516C\u5F00\u5BFC\u51FA ${exports.join("\u3001")}` : `${entry ? "\u5165\u53E3\u6A21\u5757" : "\u5185\u90E8\u6E90\u4EE3\u7801\u6A21\u5757"}\uFF1B\u672A\u68C0\u6D4B\u5230\u516C\u5F00\u5BFC\u51FA`,
    MAX_ROLE_CHARS
  ) ?? "\u6E90\u4EE3\u7801\u6A21\u5757";
  return Object.freeze({
    role,
    exports: Object.freeze([...exports]),
    dependencies: Object.freeze([...dependencies]),
    declarations: Object.freeze(declarations.map((value) => Object.freeze({ ...value })))
  });
}
function runGit2(root, args, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("git operation aborted"));
  return new Promise((resolveResult, rejectResult) => {
    execFile2("git", [...args], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: GIT_TIMEOUT_MS2,
      maxBuffer: MAX_GIT_OUTPUT_BYTES2,
      ...signal === void 0 ? {} : { signal }
    }, (error, stdout) => {
      if (signal?.aborted) {
        rejectResult(signal.reason ?? new Error("git operation aborted"));
        return;
      }
      const output = typeof stdout === "string" ? stdout : "";
      if (error === null) {
        resolveResult({ kind: "ok", stdout: output });
        return;
      }
      const code = error.code;
      resolveResult(code === 1 || code === "1" ? { kind: "no_match", stdout: output } : { kind: "unavailable", stdout: "" });
    });
  });
}
function samePath2(left, right) {
  const normalize = (value) => {
    const absolute = resolve3(value);
    return process.platform === "win32" ? absolute.toLocaleLowerCase("en-US") : absolute;
  };
  return normalize(left) === normalize(right);
}
function gitStatus2(value) {
  if (value.length === 0) return "clean";
  const code = value.slice(0, 2);
  if (code === "??") return "untracked";
  if (/U|AA|DD/u.test(code)) return "conflicted";
  const staged = code[0] !== " ";
  const modified = code[1] !== " ";
  if (staged && modified) return "staged_and_modified";
  if (staged) return "staged";
  return modified ? "modified" : "clean";
}
function changedSymbols(diff, structure) {
  const results = [];
  for (const line of diff.replace(/\r\n?/gu, "\n").split("\n")) {
    if (/^[+-](?:\+\+|--)/u.test(line)) continue;
    if (line.startsWith("+") || line.startsWith("-")) {
      addBounded(results, declarationName(line.slice(1)), 3);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
    if (hunk === null) continue;
    const currentLine = Number(hunk[1]);
    let nearest;
    for (const declaration of structure.declarations) {
      if (declaration.line > currentLine) break;
      nearest = declaration.name;
    }
    addBounded(results, nearest, 3);
  }
  return results;
}
function parseLastCommit2(value) {
  const [hash, , subject] = value.trim().split("\0");
  const safeHash = typeof hash === "string" && /^[0-9a-f]{7,64}$/u.test(hash) ? hash.slice(0, 8) : void 0;
  const safeSubject = typeof subject === "string" ? boundedText3(subject, 220) : void 0;
  return safeHash === void 0 || safeSubject === void 0 ? void 0 : `${safeHash} \xB7 ${safeSubject}`;
}
function testPath(value) {
  return /(?:^|\/)(?:__tests__|test|tests)(?:\/|$)|\.(?:spec|test)\.[^/]+$/iu.test(value);
}
function parseImpactFiles2(value, relativePath) {
  const tests = [];
  const importers = [];
  for (const raw of value.split("\0")) {
    const path = boundedText3(raw.replace(/\\/gu, "/"), 512);
    if (path === void 0 || path === relativePath || !sourceModulePath(path) || /^(?:dist|host|mcp|node_modules)\//u.test(path) || /\.min\.[^/]+$/iu.test(path) || tests.includes(path) || importers.includes(path)) continue;
    (testPath(path) ? tests : importers).push(path);
  }
  const stem = basename(relativePath, extname(relativePath)).toLocaleLowerCase("en-US");
  tests.sort((left, right) => {
    const leftOwn = basename(left).toLocaleLowerCase("en-US").includes(stem) ? 0 : 1;
    const rightOwn = basename(right).toLocaleLowerCase("en-US").includes(stem) ? 0 : 1;
    return leftOwn - rightOwn || left.localeCompare(right, "en");
  });
  importers.sort((left, right) => {
    const leftSource = left.startsWith("src/") ? 0 : 1;
    const rightSource = right.startsWith("src/") ? 0 : 1;
    return leftSource - rightSource || left.localeCompare(right, "en");
  });
  const selectedTests = tests.slice(0, Math.min(2, MAX_IMPACT_FILES2));
  const selectedImporters = importers.slice(0, MAX_IMPACT_FILES2 - selectedTests.length);
  return [
    ...selectedTests.map((path) => `\u6D4B\u8BD5: ${path}`),
    ...selectedImporters.map((path) => `\u5F15\u7528: ${path}`)
  ];
}
function statusLabel(status) {
  switch (status) {
    case "staged_and_modified":
      return "staged + modified";
    default:
      return status;
  }
}
async function extractSourceModuleArtifactContext(options) {
  const structure = extractSourceModuleStructure(options.content, options.relativePath);
  const rootResult = await runGit2(options.root, ["rev-parse", "--show-toplevel"], options.signal);
  if (rootResult.kind !== "ok" || !samePath2(rootResult.stdout.trim(), options.root)) {
    const base2 = {
      role: structure.role,
      exports: structure.exports,
      dependencies: structure.dependencies,
      gitAvailable: false,
      gitStatus: "unavailable",
      changeSummary: "Git \u4E0A\u4E0B\u6587\u4E0D\u53EF\u7528",
      changedSymbols: Object.freeze([]),
      impactFiles: Object.freeze([])
    };
    return Object.freeze({
      ...base2,
      contextRevision: createHash5("sha256").update(JSON.stringify(base2), "utf8").digest("hex")
    });
  }
  const stem = basename(options.relativePath, extname(options.relativePath));
  const [statusResult, unstaged, staged, references, lastCommit] = await Promise.all([
    runGit2(options.root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      options.relativePath
    ], options.signal),
    runGit2(options.root, ["diff", "--no-ext-diff", "--unified=0", "--", options.relativePath], options.signal),
    runGit2(options.root, ["diff", "--cached", "--no-ext-diff", "--unified=0", "--", options.relativePath], options.signal),
    runGit2(options.root, ["grep", "-l", "-F", "-z", "-e", stem, "--", "."], options.signal),
    runGit2(options.root, ["log", "-1", "--format=%H%x00%aI%x00%s", "--", options.relativePath], options.signal)
  ]);
  const state = statusResult.kind === "ok" ? gitStatus2(statusResult.stdout) : "unavailable";
  const diff = `${unstaged.kind === "ok" ? unstaged.stdout : ""}
${staged.kind === "ok" ? staged.stdout : ""}`;
  const symbols = changedSymbols(diff, structure);
  const recentCommit = lastCommit.kind === "ok" ? parseLastCommit2(lastCommit.stdout) : void 0;
  const changeSummary = state === "clean" ? `clean${recentCommit === void 0 ? "" : ` \xB7 \u6700\u8FD1 ${recentCommit}`}` : state === "unavailable" ? "Git \u4E0A\u4E0B\u6587\u4E0D\u53EF\u7528" : `${statusLabel(state)}${symbols.length === 0 ? "" : ` \xB7 \u6D89\u53CA\uFF1A${symbols.join("\u3001")}`}`;
  const impactFiles = references.kind === "ok" ? parseImpactFiles2(references.stdout, options.relativePath) : [];
  const base = {
    role: structure.role,
    exports: structure.exports,
    dependencies: structure.dependencies,
    gitAvailable: state !== "unavailable",
    gitStatus: state,
    changeSummary,
    changedSymbols: Object.freeze([...symbols]),
    impactFiles: Object.freeze([...impactFiles])
  };
  return Object.freeze({
    ...base,
    contextRevision: createHash5("sha256").update(JSON.stringify(base), "utf8").digest("hex")
  });
}

// src/adapters/workspace-scenario.ts
import { basename as basename2, extname as extname2 } from "node:path";
var SOURCE_EXTENSIONS2 = /* @__PURE__ */ new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs"
]);
function portable(value) {
  return value.replaceAll("\\", "/");
}
function compact(value, maximum = 500) {
  const result = value.replace(/[`*_>#]/gu, " ").replace(/\s+/gu, " ").trim();
  return result.length === 0 ? void 0 : result.slice(0, maximum);
}
function testSourcePath(relativePath) {
  const path = portable(relativePath).toLocaleLowerCase("en-US");
  if (!SOURCE_EXTENSIONS2.has(extname2(path))) return false;
  const name = basename2(path);
  return /(?:^|\/)(?:test|tests|__tests__)\//u.test(path) || /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u.test(name);
}
function decisionDocumentPath(relativePath) {
  const path = portable(relativePath).toLocaleLowerCase("en-US");
  const name = basename2(path);
  if (extname2(name) !== ".md" && extname2(name) !== ".mdx") return false;
  return /(?:^|\/)(?:adr|adrs|decision|decisions)\//u.test(path) || /^(?:adr|decision)[-_]\d+/u.test(name);
}
function jsonConfigurationPath(relativePath) {
  const path = portable(relativePath).toLocaleLowerCase("en-US");
  const name = basename2(path);
  if (extname2(name) !== ".json") return false;
  return name === "package.json" || name === "jsconfig.json" || name === ".mcp.json" || /^tsconfig(?:\.[a-z0-9_-]+)?\.json$/u.test(name) || /\.config\.json$/u.test(name) || /(?:^|\/)\.codex-plugin\/plugin\.json$/u.test(path);
}
function extractStaticTestDefinitionContext(content) {
  const titles = [];
  const pattern = /\b(?:it|test)\s*\(\s*(["'`])([^\r\n]{1,240}?)\1/gu;
  for (const match of content.matchAll(pattern)) {
    const title = compact(match[2] ?? "", 160);
    if (title !== void 0 && !titles.includes(title)) titles.push(title);
    if (titles.length >= 20) break;
  }
  const visible = titles.slice(0, 3);
  const summary = visible.length === 0 ? "\u672A\u63D0\u53D6\u5230\u9759\u6001 test/it \u6807\u9898\uFF1B\u8BE5\u5361\u7247\u4E0D\u6267\u884C\u6D4B\u8BD5" : `\u68C0\u6D4B\u5230 ${titles.length} \u4E2A\u9759\u6001 test/it \u6807\u9898\uFF1A${visible.join("\uFF1B")}${titles.length > 3 ? `\uFF1B\u53E6 ${titles.length - 3} \u9879` : ""}`;
  return { summary, titles: visible, titleCount: titles.length };
}
function configurationPurpose(relativePath) {
  const path = portable(relativePath);
  const name = basename2(path).toLocaleLowerCase("en-US");
  if (name === "package.json") return "Node package \u8FB9\u754C\u3001\u811A\u672C\u4E0E\u4F9D\u8D56\u58F0\u660E";
  if (name.startsWith("tsconfig")) return "TypeScript \u7F16\u8BD1\u8FB9\u754C\u4E0E\u9009\u9879\u58F0\u660E";
  if (name === "jsconfig.json") return "JavaScript \u5DE5\u7A0B\u8FB9\u754C\u4E0E\u7F16\u8F91\u5668\u9009\u9879\u58F0\u660E";
  if (name === ".mcp.json") return "MCP server \u6CE8\u518C\u4E0E\u542F\u52A8\u58F0\u660E";
  if (path.toLocaleLowerCase("en-US").endsWith("/.codex-plugin/plugin.json")) {
    return "Codex Plugin \u5143\u6570\u636E\u4E0E\u80FD\u529B\u58F0\u660E";
  }
  return "JSON \u914D\u7F6E\u8FB9\u754C";
}
function extractJsonConfigurationContext(relativePath, content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      purpose: configurationPurpose(relativePath),
      topLevelKeys: [],
      keyCount: 0,
      parsed: false
    };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      purpose: configurationPurpose(relativePath),
      topLevelKeys: [],
      keyCount: 0,
      parsed: false
    };
  }
  const keys = Object.keys(parsed).filter((key) => compact(key, 80) === key).slice(0, 100);
  return {
    purpose: configurationPurpose(relativePath),
    topLevelKeys: keys.slice(0, 5),
    keyCount: keys.length,
    parsed: true
  };
}
function section(content, accepted) {
  const lines = content.split(/\r?\n/u).slice(0, 2e3);
  let collecting = false;
  let fenced = false;
  const values = [];
  for (const line of lines) {
    const candidate = line.trimStart();
    if (/^```/u.test(candidate)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/u.exec(candidate);
    if (heading !== null) {
      const normalized = compact(heading[1] ?? "", 80)?.toLocaleLowerCase("en-US");
      if (collecting && !accepted.has(normalized ?? "")) break;
      collecting = accepted.has(normalized ?? "");
      continue;
    }
    if (!collecting) continue;
    const value = compact(line);
    if (value !== void 0) values.push(value);
    if (values.join(" ").length >= 500) break;
  }
  return compact(values.join(" "));
}
function extractDecisionDocumentContext(content) {
  const decision = section(content, /* @__PURE__ */ new Set(["decision", "\u51B3\u7B56", "\u51B3\u5B9A"]));
  const status = section(content, /* @__PURE__ */ new Set(["status", "\u72B6\u6001"]));
  const rationale = section(content, /* @__PURE__ */ new Set(["context", "rationale", "\u80CC\u666F", "\u539F\u56E0"]));
  const consequences = section(content, /* @__PURE__ */ new Set(["consequences", "consequence", "\u540E\u679C", "\u5F71\u54CD"]));
  return {
    ...decision === void 0 ? {} : { decision },
    ...status === void 0 ? {} : { status },
    ...rationale === void 0 ? {} : { rationale },
    ...consequences === void 0 ? {} : { consequences }
  };
}

// src/adapters/local-workspace.ts
var DEFAULT_MAX_FILES = 2048;
var DEFAULT_MAX_DEPTH = 12;
var MAX_RELATIVE_PATH_CHARS = 512;
var MAX_PREVIEW_FILE_BYTES = 1024 * 1024;
var REVISION_GIT_TIMEOUT_MS = 750;
var MAX_REVISION_GIT_OUTPUT_BYTES = 256 * 1024;
var DEFAULT_IGNORED_DIRECTORIES = /* @__PURE__ */ new Set([
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules"
]);
function boundedInteger(value, fallback, minimum, maximum, name) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return candidate;
}
function normalizedPath2(value) {
  return process.platform === "win32" ? value.toLocaleLowerCase("en-US") : value;
}
function pathsEqual2(left, right) {
  return normalizedPath2(left) === normalizedPath2(right);
}
function portablePath(value) {
  return value.split(sep).join("/");
}
function containedRelative(root, target) {
  const child = relative(root, target);
  if (child.length === 0 || child === ".." || child.startsWith(`..${sep}`) || isAbsolute2(child)) {
    return void 0;
  }
  return portablePath(child);
}
function fileEntityId(relativePath) {
  return `file:${relativePath}`;
}
function markdownDocument(relativePath) {
  const extension = extname3(relativePath).toLocaleLowerCase("en-US");
  return extension === ".md" || extension === ".mdx";
}
function workspaceEntityType(relativePath) {
  if (contextConceptDocumentPath(relativePath)) return "concept";
  if (contextChangeDocumentPath(relativePath)) return "change";
  if (contextDecisionDocumentPath(relativePath)) return "decision";
  if (contextTaskDocumentPath(relativePath)) return "task";
  if (contextVerificationDocumentPath(relativePath)) return "verification";
  if (decisionDocumentPath(relativePath)) return "decision";
  if (markdownDocument(relativePath)) return "document";
  if (testSourcePath(relativePath)) return "verification";
  if (sourceModulePath(relativePath)) return "module";
  if (jsonConfigurationPath(relativePath)) return "configuration";
  return "file";
}
function contextArtifactCanonicalName(relativePath) {
  const name = basename3(relativePath);
  const extension = extname3(name);
  const stem = extension.length === 0 ? name : name.slice(0, -extension.length);
  if (stem.length === 0) return name;
  return stem.split(/[-_]+/u).filter((word) => word.length > 0).map((word) => `${word[0]?.toLocaleUpperCase("en-US") ?? ""}${word.slice(1)}`).join(" ");
}
async function verifiedWorkspaceRoot(binding) {
  if (!binding.workspaceRoot || !isAbsolute2(binding.workspaceRoot)) {
    throw new ContractError("local workspace provider requires a bound workspace root");
  }
  const canonicalRoot = await realpath2(binding.workspaceRoot);
  const info = await stat2(canonicalRoot);
  if (!info.isDirectory()) {
    throw new ContractError("bound workspace root is not a directory");
  }
  if (!pathsEqual2(canonicalRoot, binding.workspaceRoot) || !sameContextScope(binding.scope, localWorkspaceScope(canonicalRoot))) {
    throw new ContractError("local workspace scope no longer matches its canonical root");
  }
  return canonicalRoot;
}
function safeAlias(value) {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.length <= 512 ? trimmed : void 0;
}
function fileAliases(relativePath) {
  const name = basename3(relativePath);
  const extension = extname3(name);
  const stem = extension.length === 0 ? name : name.slice(0, -extension.length);
  return [...new Set([
    safeAlias(stem)
  ].filter((value) => value !== void 0 && value !== name))];
}
async function scanWorkspace(root, maxFiles, maxDepth, ignoredDirectories, signal) {
  const files = [];
  const visit = async (directory, depth) => {
    if (signal?.aborted) throw signal.reason ?? new Error("workspace scan aborted");
    if (depth > maxDepth) {
      throw new ContractError("workspace index exceeds its directory depth bound");
    }
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      if (signal?.aborted) throw signal.reason ?? new Error("workspace scan aborted");
      if (entry.isSymbolicLink()) continue;
      const absolutePath = resolve4(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          await visit(absolutePath, depth + 1);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = containedRelative(root, absolutePath);
      if (relativePath === void 0 || relativePath.length > MAX_RELATIVE_PATH_CHARS) {
        throw new ContractError("workspace file path exceeds the representable bound");
      }
      const info = await stat2(absolutePath);
      files.push({
        absolutePath,
        relativePath,
        size: info.size,
        modifiedMs: info.mtimeMs
      });
      if (files.length > maxFiles) {
        throw new ContractError("workspace index exceeds its file count bound");
      }
    }
  };
  await visit(root, 0);
  return files;
}
function indexRevision(files) {
  const hash = createHash6("sha256");
  for (const file of files) {
    hash.update(file.relativePath, "utf8");
    hash.update("\0", "utf8");
    hash.update(String(file.size), "utf8");
    hash.update("\0", "utf8");
    hash.update(String(file.modifiedMs), "utf8");
    hash.update("\n", "utf8");
  }
  return `workspace:${hash.digest("hex")}`;
}
var LocalWorkspaceContextIndex = class {
  #maxFiles;
  #maxDepth;
  #ignoredDirectories;
  constructor(options = {}) {
    this.#maxFiles = boundedInteger(
      options.maxFiles,
      DEFAULT_MAX_FILES,
      1,
      DEFAULT_MAX_FILES,
      "maxFiles"
    );
    this.#maxDepth = boundedInteger(options.maxDepth, DEFAULT_MAX_DEPTH, 1, 64, "maxDepth");
    this.#ignoredDirectories = new Set(
      options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES
    );
  }
  async list(binding, signal) {
    const root = await verifiedWorkspaceRoot(binding);
    const files = await scanWorkspace(
      root,
      this.#maxFiles,
      this.#maxDepth,
      this.#ignoredDirectories,
      signal
    );
    const revision2 = indexRevision(files);
    const indexedAt = (/* @__PURE__ */ new Date()).toISOString();
    return files.map((file) => {
      const name = basename3(file.relativePath);
      const parent = portablePath(dirname2(file.relativePath));
      const entityType = workspaceEntityType(file.relativePath);
      const explicitMentalModel = entityType === "concept" || entityType === "task" || contextVerificationDocumentPath(file.relativePath) || contextChangeDocumentPath(file.relativePath) || contextDecisionDocumentPath(file.relativePath);
      const canonicalName = explicitMentalModel ? contextArtifactCanonicalName(file.relativePath) : name;
      return {
        schemaVersion: "1.0",
        scope: { ...binding.scope },
        entityId: fileEntityId(file.relativePath),
        entityType,
        canonicalKey: file.relativePath,
        canonicalName,
        aliases: fileAliases(file.relativePath).filter((alias) => alias !== canonicalName),
        summary: explicitMentalModel ? `Explicit ${entityType} mental model in ${parent}` : parent === "." ? "Workspace file" : `Workspace file in ${parent}`,
        authorityRef: {
          provider: LOCAL_WORKSPACE_PROVIDER_ID,
          locator: file.relativePath
        },
        indexRevision: revision2,
        indexedAt,
        deleted: false
      };
    });
  }
};
function contentPreview(content) {
  if (content.includes(0)) return void 0;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(content);
    const compact2 = decoded.replace(/\s+/gu, " ").trim();
    return compact2.length === 0 ? void 0 : compact2.slice(0, 800);
  } catch {
    return void 0;
  }
}
function utf8Content(content) {
  if (content.includes(0)) return void 0;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return void 0;
  }
}
function gitStatusLabel(status) {
  switch (status) {
    case "clean":
      return "clean";
    case "modified":
      return "modified";
    case "staged":
      return "staged";
    case "staged_and_modified":
      return "staged + modified";
    case "untracked":
      return "untracked";
    case "conflicted":
      return "conflicted";
    case "unavailable":
      return "unavailable";
  }
}
function stableFileStat(before, after) {
  return before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && before.ino === after.ino;
}
async function verifyContextArtifactEvidence(root, artifact, signal) {
  if (signal?.aborted) return void 0;
  let handle;
  try {
    const requested = resolve4(root, ...artifact.evidence.sourcePath.split("/"));
    const canonical = await realpath2(requested);
    if (containedRelative(root, canonical) !== artifact.evidence.sourcePath) return void 0;
    handle = await open(canonical, "r");
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_PREVIEW_FILE_BYTES) return void 0;
    const content = await handle.readFile();
    const decoded = utf8Content(content);
    const after = await handle.stat();
    if (decoded === void 0 || !stableFileStat(before, after) || signal?.aborted) {
      return void 0;
    }
    const sourceLine = decoded.replace(/\r\n?/gu, "\n").split("\n")[artifact.evidence.sourceLine - 1];
    const compact2 = sourceLine?.replace(/^\s*(?:(?:[-*+>])|(?:\d+[.)]))\s+/u, "").replace(/[\p{Cc}\p{Cf}]+/gu, " ").replace(/\s+/gu, " ").trim();
    if (compact2 !== artifact.evidence.excerpt) return void 0;
    return {
      sourceId: `${artifact.evidence.sourcePath}:${artifact.evidence.sourceLine}`,
      revision: createHash6("sha256").update(content).digest("hex")
    };
  } catch {
    return void 0;
  } finally {
    await handle?.close().catch(() => void 0);
  }
}
function runRevisionGit(root, args, signal) {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error("revision probe aborted"));
  }
  return new Promise((resolveResult, rejectResult) => {
    execFile3("git", [...args], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: REVISION_GIT_TIMEOUT_MS,
      maxBuffer: MAX_REVISION_GIT_OUTPUT_BYTES,
      ...signal === void 0 ? {} : { signal }
    }, (error, stdout) => {
      if (signal?.aborted) {
        rejectResult(signal.reason ?? new Error("revision probe aborted"));
        return;
      }
      const output = typeof stdout === "string" ? stdout : "";
      if (error === null) {
        resolveResult({ kind: "ok", stdout: output });
        return;
      }
      const code = error.code;
      resolveResult(code === 1 || code === "1" ? { kind: "no_match", stdout: output } : { kind: "unavailable", stdout: "" });
    });
  });
}
function revisionRelationPaths(value, locator, entityType) {
  const paths = [];
  for (const raw of value.split("\0")) {
    const path = raw.replace(/\\/gu, "/").trim();
    if (path.length < 1 || path.length > MAX_RELATIVE_PATH_CHARS || path === locator || path.startsWith("../") || /^(?:dist|host|mcp|node_modules)\//u.test(path) || (entityType === "module" || entityType === "verification") && !sourceModulePath(path) || paths.includes(path)) {
      continue;
    }
    paths.push(path);
  }
  return paths.sort((left, right) => left.localeCompare(right, "en"));
}
async function gitRevisionFingerprint(root, locator, entityType, signal) {
  try {
    const marker = await stat2(resolve4(root, ".git"));
    if (!marker.isDirectory() && !marker.isFile()) {
      return { kind: "current", fingerprint: "not-repository" };
    }
  } catch (error) {
    const code = error.code;
    return code === "ENOENT" || code === "ENOTDIR" ? { kind: "current", fingerprint: "not-repository" } : { kind: "unavailable" };
  }
  const rootResult = await runRevisionGit(root, ["rev-parse", "--show-toplevel"], signal);
  if (rootResult.kind !== "ok" || !pathsEqual2(resolve4(rootResult.stdout.trim()), resolve4(root))) {
    return { kind: "unavailable" };
  }
  const relationNeedle = entityType === "module" || entityType === "verification" ? basename3(locator, extname3(locator)) : basename3(locator);
  const [statusResult, relationsResult, lastCommitResult] = await Promise.all([
    runRevisionGit(root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      locator
    ], signal),
    runRevisionGit(root, [
      "grep",
      "-l",
      "-F",
      "-z",
      "-e",
      relationNeedle,
      "--",
      "."
    ], signal),
    runRevisionGit(root, [
      "log",
      "-1",
      "--format=%H%x00%s",
      "--",
      locator
    ], signal)
  ]);
  if (statusResult.kind !== "ok" || relationsResult.kind !== "ok" && relationsResult.kind !== "no_match" || lastCommitResult.kind !== "ok") {
    return { kind: "unavailable" };
  }
  const base = {
    status: statusResult.stdout,
    relations: revisionRelationPaths(relationsResult.stdout, locator, entityType),
    lastCommit: lastCommitResult.stdout
  };
  return {
    kind: "current",
    fingerprint: createHash6("sha256").update(JSON.stringify(base), "utf8").digest("hex")
  };
}
async function evidenceRevisionFingerprint(root, canonicalFile, locator, entityType, signal) {
  const explicitArtifact = entityType === "concept" || entityType === "change" || entityType === "task" || contextVerificationDocumentPath(locator) || contextDecisionDocumentPath(locator);
  if (!explicitArtifact) return "none";
  let handle;
  try {
    handle = await open(canonicalFile, "r");
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_PREVIEW_FILE_BYTES) return "artifact-unavailable";
    const content = await handle.readFile();
    const after = await handle.stat();
    if (!stableFileStat(before, after) || signal?.aborted) return "artifact-unavailable";
    const decoded = utf8Content(content);
    const artifact = decoded === void 0 ? void 0 : entityType === "concept" ? extractContextConceptArtifact(decoded) : entityType === "change" ? extractContextChangeArtifact(decoded) : entityType === "task" ? extractContextTaskArtifact(decoded) : contextVerificationDocumentPath(locator) ? extractContextVerificationArtifact(decoded) : extractContextDecisionArtifact(decoded);
    if (artifact === void 0) return "artifact-invalid";
    const sourcePath = resolve4(root, ...artifact.evidence.sourcePath.split("/"));
    const canonicalSource = await realpath2(sourcePath);
    if (containedRelative(root, canonicalSource) !== artifact.evidence.sourcePath) {
      return "evidence-outside-scope";
    }
    const sourceInfo = await stat2(canonicalSource);
    if (!sourceInfo.isFile()) return "evidence-not-file";
    return createHash6("sha256").update(JSON.stringify({
      path: artifact.evidence.sourcePath,
      size: sourceInfo.size,
      modifiedMs: sourceInfo.mtimeMs,
      changedMs: sourceInfo.ctimeMs,
      inode: sourceInfo.ino
    }), "utf8").digest("hex");
  } catch (error) {
    const code = error.code;
    return code === "ENOENT" || code === "ENOTDIR" ? "evidence-not-found" : "artifact-unavailable";
  } finally {
    await handle?.close().catch(() => void 0);
  }
}
var LocalWorkspaceRevisionProbe = class {
  async probe(request) {
    const observedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (request.signal?.aborted) {
      return { kind: "unavailable", observedAt, retryable: true };
    }
    if (request.entityType !== "file" && request.entityType !== "document" && request.entityType !== "module" && request.entityType !== "verification" && request.entityType !== "configuration" && request.entityType !== "decision" && request.entityType !== "concept" && request.entityType !== "change" && request.entityType !== "task") {
      return { kind: "not_found", observedAt };
    }
    if (!request.entityId.startsWith("file:")) {
      return { kind: "not_found", observedAt };
    }
    const locator = request.entityId.slice("file:".length);
    if (locator.length < 1 || locator.length > MAX_RELATIVE_PATH_CHARS || locator.includes("\\") || locator.startsWith("/") || locator.split("/").includes("..")) {
      return { kind: "not_found", observedAt };
    }
    if (workspaceEntityType(locator) !== request.entityType) {
      return { kind: "not_found", observedAt };
    }
    try {
      const root = await verifiedWorkspaceRoot(request.binding);
      const requestedPath = resolve4(root, ...locator.split("/"));
      const canonicalFile = await realpath2(requestedPath);
      if (containedRelative(root, canonicalFile) !== locator) {
        return { kind: "not_found", observedAt };
      }
      const info = await stat2(canonicalFile);
      if (!info.isFile() || request.signal?.aborted) {
        return { kind: "unavailable", observedAt, retryable: true };
      }
      const git = await gitRevisionFingerprint(
        root,
        locator,
        request.entityType,
        request.signal
      );
      if (git.kind !== "current" || request.signal?.aborted) {
        return { kind: "unavailable", observedAt, retryable: true };
      }
      const evidence = await evidenceRevisionFingerprint(
        root,
        canonicalFile,
        locator,
        request.entityType,
        request.signal
      );
      if (request.signal?.aborted) {
        return { kind: "unavailable", observedAt, retryable: true };
      }
      const revision2 = createHash6("sha256").update(JSON.stringify({
        schema: "workspace-context-revision-v2",
        path: locator,
        size: info.size,
        modifiedMs: info.mtimeMs,
        changedMs: info.ctimeMs,
        inode: info.ino,
        git: git.fingerprint,
        evidence
      }), "utf8").digest("hex");
      return {
        kind: "current",
        revision: `workspace-context-v2:${revision2}`,
        observedAt
      };
    } catch (error) {
      const code = error.code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return { kind: "not_found", observedAt };
      }
      if (error instanceof ContractError) throw error;
      return {
        kind: "unavailable",
        observedAt,
        retryable: code !== "EACCES" && code !== "EPERM"
      };
    }
  }
};
var LocalWorkspaceAuthoritativeProvider = class {
  providerId = LOCAL_WORKSPACE_PROVIDER_ID;
  async getDetail(request) {
    if (request.signal?.aborted) return { kind: "unavailable", retryable: true };
    if (request.entityType !== "file" && request.entityType !== "document" && request.entityType !== "module" && request.entityType !== "verification" && request.entityType !== "configuration" && request.entityType !== "decision" && request.entityType !== "concept" && request.entityType !== "change" && request.entityType !== "task") {
      return { kind: "not_found" };
    }
    if (request.authorityLocator.length < 1 || request.authorityLocator.length > MAX_RELATIVE_PATH_CHARS || request.authorityLocator.includes("\\") || request.authorityLocator.startsWith("/") || request.authorityLocator.split("/").includes("..") || request.entityId !== fileEntityId(request.authorityLocator) || workspaceEntityType(request.authorityLocator) !== request.entityType) {
      return { kind: "not_found" };
    }
    let handle;
    try {
      const root = await verifiedWorkspaceRoot(request.binding);
      const requestedPath = resolve4(root, ...request.authorityLocator.split("/"));
      const canonicalFile = await realpath2(requestedPath);
      const relativePath = containedRelative(root, canonicalFile);
      if (relativePath !== request.authorityLocator) return { kind: "not_found" };
      handle = await open(canonicalFile, "r");
      const before = await handle.stat();
      if (!before.isFile()) return { kind: "not_found" };
      let content;
      if (before.size <= MAX_PREVIEW_FILE_BYTES) {
        content = await handle.readFile();
      }
      const decoded = content === void 0 ? void 0 : utf8Content(content);
      const markdownContext = (request.entityType === "document" || request.entityType === "decision") && decoded !== void 0 ? await extractMarkdownArtifactContext({
        root,
        relativePath,
        content: decoded,
        ...request.signal === void 0 ? {} : { signal: request.signal }
      }) : void 0;
      const sourceModuleContext = (request.entityType === "module" || request.entityType === "verification" && !contextVerificationDocumentPath(relativePath)) && decoded !== void 0 ? await extractSourceModuleArtifactContext({
        root,
        relativePath,
        content: decoded,
        ...request.signal === void 0 ? {} : { signal: request.signal }
      }) : void 0;
      const conceptContext = request.entityType === "concept" && decoded !== void 0 ? extractContextConceptArtifact(decoded) : void 0;
      const changeContext = request.entityType === "change" && decoded !== void 0 ? extractContextChangeArtifact(decoded) : void 0;
      const explicitDecisionContext = request.entityType === "decision" && contextDecisionDocumentPath(relativePath) && decoded !== void 0 ? extractContextDecisionArtifact(decoded) : void 0;
      const taskContext = request.entityType === "task" && decoded !== void 0 ? extractContextTaskArtifact(decoded) : void 0;
      const explicitVerificationContext = request.entityType === "verification" && contextVerificationDocumentPath(relativePath) && decoded !== void 0 ? extractContextVerificationArtifact(decoded) : void 0;
      if (request.entityType === "concept" && conceptContext === void 0) {
        return { kind: "not_found" };
      }
      if (request.entityType === "change" && changeContext === void 0) {
        return { kind: "not_found" };
      }
      if (request.entityType === "decision" && contextDecisionDocumentPath(relativePath) && explicitDecisionContext === void 0) {
        return { kind: "not_found" };
      }
      if (request.entityType === "task" && taskContext === void 0) {
        return { kind: "not_found" };
      }
      if (request.entityType === "verification" && contextVerificationDocumentPath(relativePath) && explicitVerificationContext === void 0) {
        return { kind: "not_found" };
      }
      const after = await handle.stat();
      if (!stableFileStat(before, after) || request.signal?.aborted) {
        return { kind: "unavailable", retryable: true };
      }
      const statRevision = createHash6("sha256").update(JSON.stringify({
        path: relativePath,
        size: after.size,
        modifiedMs: after.mtimeMs,
        changedMs: after.ctimeMs,
        inode: after.ino
      }), "utf8").digest("hex");
      const contentHash = content === void 0 ? void 0 : createHash6("sha256").update(content).digest("hex");
      const mentalModelContext = conceptContext ?? changeContext ?? explicitDecisionContext ?? taskContext ?? explicitVerificationContext;
      const artifactEvidence2 = mentalModelContext === void 0 ? void 0 : await verifyContextArtifactEvidence(root, mentalModelContext, request.signal);
      if (mentalModelContext !== void 0 && artifactEvidence2 === void 0) {
        return { kind: "not_found" };
      }
      const detailRevision = createHash6("sha256").update(contentHash ?? statRevision, "utf8").update("\0", "utf8").update(
        markdownContext?.contextRevision ?? sourceModuleContext?.contextRevision ?? conceptContext?.contextRevision ?? changeContext?.contextRevision ?? explicitDecisionContext?.contextRevision ?? taskContext?.contextRevision ?? explicitVerificationContext?.contextRevision ?? "file-metadata-v1",
        "utf8"
      ).update(artifactEvidence2?.revision ?? "", "utf8").digest("hex");
      const extension = extname3(relativePath);
      const preview = content === void 0 ? void 0 : contentPreview(content);
      const observedAt = (/* @__PURE__ */ new Date()).toISOString();
      const testContext = request.entityType === "verification" && !contextVerificationDocumentPath(relativePath) && decoded !== void 0 ? extractStaticTestDefinitionContext(decoded) : void 0;
      const configurationContext = request.entityType === "configuration" && decoded !== void 0 ? extractJsonConfigurationContext(relativePath, decoded) : void 0;
      const decisionContext = request.entityType === "decision" && explicitDecisionContext === void 0 && decoded !== void 0 ? extractDecisionDocumentContext(decoded) : void 0;
      const markdownFacts = markdownContext === void 0 ? void 0 : {
        "\u7528\u9014": markdownContext.purpose ?? `${markdownContext.title ?? basename3(relativePath)} Markdown \u6587\u6863`,
        "\u672C\u6B21\u53D8\u5316": markdownContext.changeSummary ?? (markdownContext.gitAvailable ? "\u5F53\u524D\u5DE5\u4F5C\u6811\u672A\u68C0\u6D4B\u5230\u672A\u63D0\u4EA4\u53D8\u66F4" : "Git \u4E0A\u4E0B\u6587\u4E0D\u53EF\u7528"),
        "\u5F71\u54CD\u8303\u56F4": markdownContext.impactFiles.length > 0 ? [...markdownContext.impactFiles] : "\u672A\u53D1\u73B0\u5DF2\u8DDF\u8E2A\u5F15\u7528",
        "Git \u72B6\u6001": gitStatusLabel(markdownContext.gitStatus),
        "\u8DEF\u5F84": relativePath
      };
      const dependencyAndImpact = sourceModuleContext === void 0 ? [] : [
        ...[...sourceModuleContext.dependencies].sort((left, right) => {
          const leftLocal = left.startsWith(".") ? 0 : 1;
          const rightLocal = right.startsWith(".") ? 0 : 1;
          return leftLocal - rightLocal;
        }).slice(0, 2).map((value) => `\u4F9D\u8D56: ${value}`),
        ...sourceModuleContext.impactFiles
      ].slice(0, 5);
      const moduleFacts = sourceModuleContext === void 0 ? void 0 : {
        "\u804C\u8D23": sourceModuleContext.role,
        "\u516C\u5F00\u5165\u53E3": sourceModuleContext.exports.length > 0 ? [...sourceModuleContext.exports] : "\u672A\u68C0\u6D4B\u5230\u516C\u5F00\u5BFC\u51FA",
        "\u672C\u6B21\u53D8\u5316": sourceModuleContext.changeSummary,
        "\u4F9D\u8D56\u4E0E\u5F71\u54CD": dependencyAndImpact.length > 0 ? dependencyAndImpact : "\u672A\u53D1\u73B0\u6709\u754C\u7684\u76F4\u63A5\u4F9D\u8D56\u6216\u5F15\u7528",
        "\u8DEF\u5F84": relativePath
      };
      const verificationFacts = testContext === void 0 || sourceModuleContext === void 0 ? void 0 : {
        "\u9A8C\u8BC1\u8303\u56F4": testContext.summary,
        "\u6267\u884C\u72B6\u6001": "\u672A\u6267\u884C\uFF1B\u8BE5\u5361\u7247\u53EA\u8BFB\u53D6\u6D4B\u8BD5\u5B9A\u4E49\uFF0C\u4E0D\u80FD\u636E\u6B64\u5224\u5B9A PASS/FAIL",
        "\u672C\u6B21\u53D8\u5316": sourceModuleContext.changeSummary,
        "\u4F9D\u8D56\u4E0E\u5F71\u54CD": dependencyAndImpact.length > 0 ? dependencyAndImpact : "\u672A\u53D1\u73B0\u6709\u754C\u7684\u76F4\u63A5\u4F9D\u8D56\u6216\u5F15\u7528",
        "\u8DEF\u5F84": relativePath
      };
      const configurationFacts = configurationContext === void 0 ? void 0 : {
        "\u914D\u7F6E\u7528\u9014": configurationContext.purpose,
        "\u9876\u5C42\u952E": configurationContext.parsed ? configurationContext.topLevelKeys.length > 0 ? [
          ...configurationContext.topLevelKeys,
          ...configurationContext.keyCount > configurationContext.topLevelKeys.length ? [`\u53E6 ${configurationContext.keyCount - configurationContext.topLevelKeys.length} \u9879`] : []
        ] : "\u672A\u58F0\u660E\u9876\u5C42\u952E" : "JSON \u65E0\u6CD5\u5B89\u5168\u89E3\u6790",
        "\u62AB\u9732\u8FB9\u754C": "\u53EA\u663E\u793A\u952E\u540D\uFF1B\u914D\u7F6E\u503C\u548C\u6F5C\u5728\u5BC6\u94A5\u4E0D\u8FDB\u5165\u5361\u7247",
        "\u683C\u5F0F": "JSON",
        "\u8DEF\u5F84": relativePath
      };
      const decisionFacts = decisionContext === void 0 ? void 0 : {
        "\u51B3\u7B56": decisionContext.decision ?? markdownContext?.purpose ?? "\u672A\u63D0\u4F9B\u53EF\u63D0\u53D6\u7684 Decision \u6BB5\u843D",
        "\u72B6\u6001": decisionContext.status ?? "\u672A\u660E\u786E",
        "\u539F\u56E0": decisionContext.rationale ?? "\u672A\u63D0\u4F9B\u53EF\u63D0\u53D6\u7684 Context/Rationale \u6BB5\u843D",
        "\u540E\u679C": decisionContext.consequences ?? "\u672A\u63D0\u4F9B\u53EF\u63D0\u53D6\u7684 Consequences \u6BB5\u843D",
        "\u8DEF\u5F84": relativePath
      };
      const explicitDecisionFacts = explicitDecisionContext === void 0 ? void 0 : {
        "\u4E3A\u4EC0\u4E48\u9700\u8981\u51B3\u5B9A": explicitDecisionContext.problem,
        "\u9009\u62E9\u4E86\u4EC0\u4E48": explicitDecisionContext.choice,
        "\u540E\u679C\u662F\u4EC0\u4E48": explicitDecisionContext.consequence,
        "\u8BC1\u636E": explicitDecisionContext.evidence.excerpt
      };
      const changeFacts = changeContext === void 0 ? void 0 : {
        "\u539F\u6765\u600E\u6837": changeContext.before,
        "\u73B0\u5728\u600E\u6837": changeContext.after,
        "\u5F71\u54CD\u4EC0\u4E48": changeContext.impact,
        "\u8BC1\u636E": changeContext.evidence.excerpt
      };
      const conceptFacts = conceptContext === void 0 ? void 0 : {
        "\u5B83\u662F\u4EC0\u4E48\u610F\u601D": conceptContext.meaning,
        "\u4E3A\u4EC0\u4E48\u73B0\u5728\u51FA\u73B0": conceptContext.currentContext,
        "\u5B83\u4E0D\u662F\u4EC0\u4E48": conceptContext.boundary,
        "\u6240\u5904\u6D41\u7A0B": conceptContext.sequence.map((item, index) => index === conceptContext.currentStep ? `\u5F53\u524D\uFF1A${item}` : item),
        "\u8BC1\u636E": conceptContext.evidence.excerpt
      };
      const taskFacts = taskContext === void 0 ? void 0 : {
        "\u76EE\u6807": taskContext.goal,
        "\u5F53\u524D\u72B6\u6001": taskContext.status,
        "\u4E0B\u4E00\u6B65": taskContext.next,
        "\u963B\u585E": taskContext.blocker,
        "\u66F4\u65B0\u65F6\u95F4": taskContext.updatedAt,
        "\u5DF2\u5B8C\u6210": taskContext.completed,
        "\u8BC1\u636E": taskContext.evidence.excerpt
      };
      const explicitVerificationFacts = explicitVerificationContext === void 0 ? void 0 : {
        "\u8981\u8BC1\u660E\u4EC0\u4E48": explicitVerificationContext.claim,
        "\u7ED3\u679C": explicitVerificationContext.result,
        "\u5C1A\u672A\u8BC1\u660E": explicitVerificationContext.gap,
        "\u9A8C\u8BC1\u8BB0\u5F55": [
          `\u65B9\u5F0F: ${explicitVerificationContext.method}`,
          `\u4FEE\u8BA2: ${explicitVerificationContext.verifiedRevision}`,
          `\u65F6\u95F4: ${explicitVerificationContext.executedAt}`
        ],
        "\u8BC1\u636E": explicitVerificationContext.evidence.excerpt,
        "\u9A8C\u8BC1\u65B9\u5F0F": explicitVerificationContext.method,
        "\u9A8C\u8BC1\u4FEE\u8BA2": explicitVerificationContext.verifiedRevision,
        "\u6267\u884C\u65F6\u95F4": explicitVerificationContext.executedAt
      };
      return {
        kind: "snapshot",
        snapshot: {
          scope: { ...request.binding.scope },
          entityId: request.entityId,
          entityType: request.entityType,
          entityRevision: `sha256:${detailRevision}`,
          observedAt,
          freshness: "current",
          facts: conceptFacts ?? changeFacts ?? explicitDecisionFacts ?? taskFacts ?? explicitVerificationFacts ?? decisionFacts ?? verificationFacts ?? configurationFacts ?? markdownFacts ?? moduleFacts ?? {
            path: relativePath,
            name: basename3(relativePath),
            ...preview === void 0 ? {} : { preview },
            extension: extension.length === 0 ? null : extension,
            size_bytes: after.size,
            modified_at: after.mtime.toISOString(),
            ...contentHash === void 0 ? {} : { content_sha256: contentHash }
          },
          relations: [],
          sourceRefs: [
            {
              sourceType: "local_workspace_file",
              sourceId: relativePath
            },
            ...markdownContext?.gitAvailable === true ? [{ sourceType: "local_git", sourceId: relativePath }] : [],
            ...sourceModuleContext?.gitAvailable === true ? [{ sourceType: "local_git", sourceId: relativePath }] : [],
            ...artifactEvidence2 === void 0 ? [] : [{ sourceType: "project_evidence", sourceId: artifactEvidence2.sourceId }]
          ]
        },
        verification: {
          verifiedAt: observedAt,
          method: "live_read"
        }
      };
    } catch (error) {
      const code = error.code;
      if (code === "ENOENT" || code === "ENOTDIR") return { kind: "not_found" };
      if (code === "EACCES" || code === "EPERM") return { kind: "access_denied" };
      if (error instanceof ContractError) throw error;
      return { kind: "unavailable", retryable: true };
    } finally {
      await handle?.close().catch(() => void 0);
    }
  }
};

// src/lookup-service.ts
import {
  createHmac,
  randomBytes as randomBytes2,
  randomUUID as randomUUID3,
  timingSafeEqual
} from "node:crypto";
import { performance as performance2 } from "node:perf_hooks";

// src/resolver.ts
function toCandidate(record8, attempt) {
  const match = {
    scope: copyContextScope(record8.scope),
    entityId: record8.entityId,
    entityType: record8.entityType,
    label: record8.canonicalName,
    summary: record8.summary,
    matchKind: attempt.kind,
    indexRevision: record8.indexRevision,
    indexedAt: record8.indexedAt,
    detailFreshness: "unknown"
  };
  return { match, record: record8 };
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
function exactIdMatch(selection, record8) {
  const keys = [record8.canonicalKey, record8.entityId].filter(
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
function exactNameMatch(selection, record8) {
  const matchedText = findLiteralPhrase(selection, record8.canonicalName);
  return matchedText ? { kind: "exact_name", matchedText } : void 0;
}
function exactAliasMatch(selection, record8) {
  for (const alias of record8.aliases) {
    const matchedText = findLiteralPhrase(selection, alias);
    if (matchedText) {
      return { kind: "exact_alias", matchedText };
    }
  }
  return void 0;
}
function normalizedMatch(normalizedSelection, record8) {
  const values = [
    record8.canonicalKey,
    record8.entityId,
    record8.canonicalName,
    ...record8.aliases
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
    (record8) => sameContextScope(record8.scope, scope) && !record8.deleted
  );
  const normalizedSelection = normalizeText(selection);
  const layers = [
    exactIdMatch,
    exactNameMatch,
    exactAliasMatch,
    (_selection, record8) => normalizedMatch(normalizedSelection, record8)
  ];
  for (const matchLayer of layers) {
    const candidates2 = deduplicateAndSort(
      scoped.flatMap((record8) => {
        const attempt = matchLayer(selection, record8);
        return attempt ? [toCandidate(record8, attempt)] : [];
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
  return new Promise((resolve6, reject) => {
    const controller = new AbortController();
    const deadlineAt = performance2.now() + timeoutMs;
    let settled = false;
    let timer;
    const cleanup = () => {
      if (timer !== void 0) clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    };
    const settleSuccess = (value) => {
      if (settled) return;
      if (performance2.now() >= deadlineAt) {
        abortAndFail(new OperationTimeoutError(operationName));
        return;
      }
      settled = true;
      cleanup();
      resolve6(value);
    };
    const settleFailure = (error) => {
      if (settled) return;
      if (performance2.now() >= deadlineAt) {
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
function boundedText4(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 4096;
}
function optionalBoundedText(value) {
  return value === void 0 || boundedText4(value);
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
    if (!isContextScopeKind(kind) || !boundedText4(namespace) || !boundedText4(id)) {
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
    if (!scope || !boundedText4(bindingRevision) || evidence !== "verified_thread" && evidence !== "verified_workspace" && evidence !== "explicit_user" && evidence !== "fixture_manifest" || !Number.isSafeInteger(selectionGeneration) || Number(selectionGeneration) < 0 || !optionalBoundedText(threadRef) || !optionalBoundedText(routeRef) || !optionalBoundedText(workspaceRoot) || evidence === "verified_thread" && threadRef === void 0 || (evidence === "verified_workspace" || evidence === "fixture_manifest") && workspaceRoot === void 0) {
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
  #activationSecret = randomBytes2(32);
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
      activationNonce: `act:${randomUUID3()}`,
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
    const record8 = this.#activations.get(intent.activationNonce);
    if (!record8 || record8.activatedAt !== intent.activatedAt) {
      return blocked("invalid_activation");
    }
    if (record8.state === "consumed") {
      return blocked("replayed_activation");
    }
    const presented = this.#activationDigest(
      intent.selection,
      hostContext,
      intent.chosenEntityId
    );
    if (presented.length !== record8.digest.length || !timingSafeEqual(presented, record8.digest)) {
      return blocked("invalid_activation");
    }
    record8.state = "consumed";
    return void 0;
  }
  #pruneActivations(now) {
    for (const [nonce, record8] of this.#activations) {
      if (now - record8.activatedAt > this.#nonceTtlMs) {
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

// src/host/codex-cdp/workspace-lookup.ts
var DEFAULT_CANDIDATE_REF_TTL_MS = 6e4;
var DEFAULT_MAX_CANDIDATE_REFS = 256;
var DEFAULT_DETAIL_REF_TTL_MS = 10 * 6e4;
var DEFAULT_MAX_DETAIL_REFS = 256;
function boundedPrintable(value, minimum, maximum) {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum && !/[\p{Cc}\p{Cf}]/u.test(value);
}
function truncate(value, maximum) {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}\u2026`;
}
function sha2562(value) {
  return createHash7("sha256").update(value, "utf8").digest("hex");
}
function scopeKey(entry) {
  return `${entry.scope.kind}\0${entry.scope.namespace}\0${entry.scope.id}`;
}
function scalarText(value) {
  return value === null ? "null" : String(value);
}
function factText2(value) {
  return truncate(
    Array.isArray(value) ? value.map(scalarText).join(", ") : scalarText(value),
    1024
  );
}
function scalarFact(facts, key) {
  const value = facts[key];
  return typeof value === "string" ? truncate(value, 1024) : void 0;
}
function mentalModelComprehension(outcome) {
  const evidenceExcerpt = scalarFact(outcome.detail.facts, "\u8BC1\u636E");
  const source = outcome.detail.sourceRefs.find((item) => item.sourceType === "project_evidence");
  if (evidenceExcerpt === void 0 || source === void 0) {
    return void 0;
  }
  const evidence = [{
    excerpt: evidenceExcerpt,
    source: truncate(source.sourceId, 512)
  }];
  if (outcome.detail.entityType === "concept") {
    const meaning = scalarFact(outcome.detail.facts, "\u5B83\u662F\u4EC0\u4E48\u610F\u601D");
    const context = scalarFact(outcome.detail.facts, "\u4E3A\u4EC0\u4E48\u73B0\u5728\u51FA\u73B0");
    const boundary = scalarFact(outcome.detail.facts, "\u5B83\u4E0D\u662F\u4EC0\u4E48");
    const rawSequence = outcome.detail.facts["\u6240\u5904\u6D41\u7A0B"];
    if (meaning === void 0 || context === void 0 || boundary === void 0 || !Array.isArray(rawSequence)) {
      return void 0;
    }
    const normalizedSequence = rawSequence.filter((item) => typeof item === "string").slice(0, 4);
    const sequence = normalizedSequence.map((item) => truncate(item.replace(/^当前[：:]\s*/u, ""), 256));
    const currentStep = normalizedSequence.findIndex((item) => /^当前[：:]\s*/u.test(item));
    if (sequence.length < 2 || currentStep < 0 || currentStep >= sequence.length) {
      return void 0;
    }
    return { kind: "concept", meaning, context, boundary, sequence, currentStep, evidence };
  }
  if (outcome.detail.entityType === "change") {
    const before = scalarFact(outcome.detail.facts, "\u539F\u6765\u600E\u6837");
    const after = scalarFact(outcome.detail.facts, "\u73B0\u5728\u600E\u6837");
    const impact = scalarFact(outcome.detail.facts, "\u5F71\u54CD\u4EC0\u4E48");
    return before === void 0 || after === void 0 || impact === void 0 ? void 0 : { kind: "change", before, after, impact, evidence };
  }
  if (outcome.detail.entityType === "decision") {
    const problem = scalarFact(outcome.detail.facts, "\u4E3A\u4EC0\u4E48\u9700\u8981\u51B3\u5B9A");
    const choice = scalarFact(outcome.detail.facts, "\u9009\u62E9\u4E86\u4EC0\u4E48");
    const consequence = scalarFact(outcome.detail.facts, "\u540E\u679C\u662F\u4EC0\u4E48");
    return problem === void 0 || choice === void 0 || consequence === void 0 ? void 0 : { kind: "decision", problem, choice, consequence, evidence };
  }
  if (outcome.detail.entityType === "task") {
    const goal = scalarFact(outcome.detail.facts, "\u76EE\u6807");
    const status = scalarFact(outcome.detail.facts, "\u5F53\u524D\u72B6\u6001");
    const completed = scalarFact(outcome.detail.facts, "\u5DF2\u5B8C\u6210");
    const next = scalarFact(outcome.detail.facts, "\u4E0B\u4E00\u6B65");
    const blocker = scalarFact(outcome.detail.facts, "\u963B\u585E");
    const updatedAt = scalarFact(outcome.detail.facts, "\u66F4\u65B0\u65F6\u95F4");
    return goal === void 0 || status === void 0 || completed === void 0 || next === void 0 || blocker === void 0 || updatedAt === void 0 ? void 0 : { kind: "task", goal, status, completed, next, blocker, updatedAt, evidence };
  }
  if (outcome.detail.entityType === "verification") {
    const claim = scalarFact(outcome.detail.facts, "\u8981\u8BC1\u660E\u4EC0\u4E48");
    const result = scalarFact(outcome.detail.facts, "\u7ED3\u679C");
    const gap = scalarFact(outcome.detail.facts, "\u5C1A\u672A\u8BC1\u660E");
    const executedAt = scalarFact(outcome.detail.facts, "\u6267\u884C\u65F6\u95F4");
    return claim === void 0 || result === void 0 || gap === void 0 || executedAt === void 0 ? void 0 : { kind: "verification", claim, result, gap, executedAt, evidence };
  }
  return void 0;
}
function errorPresentation(code, message, retryable) {
  return { kind: "error", code, message, retryable };
}
function candidateView(candidate, candidateRef) {
  return {
    candidateRef,
    label: truncate(candidate.label, 256),
    entityType: truncate(candidate.entityType, 128),
    summary: truncate(candidate.summary, 1024)
  };
}
function detailView(outcome, options = {}) {
  const purpose = outcome.detail.facts["\u7528\u9014"] ?? outcome.detail.facts["\u804C\u8D23"];
  const scenarioSummary = outcome.detail.entityType === "verification" ? outcome.detail.facts["\u7ED3\u679C"] ?? outcome.detail.facts["\u9A8C\u8BC1\u8303\u56F4"] : outcome.detail.entityType === "configuration" ? outcome.detail.facts["\u914D\u7F6E\u7528\u9014"] : outcome.detail.entityType === "decision" ? outcome.detail.facts["\u9009\u62E9\u4E86\u4EC0\u4E48"] ?? outcome.detail.facts["\u51B3\u7B56"] : outcome.detail.entityType === "concept" ? outcome.detail.facts["\u5B83\u662F\u4EC0\u4E48\u610F\u601D"] : outcome.detail.entityType === "change" ? outcome.detail.facts["\u73B0\u5728\u600E\u6837"] : outcome.detail.entityType === "task" ? outcome.detail.facts["\u5F53\u524D\u72B6\u6001"] : void 0;
  const change = outcome.detail.facts["\u672C\u6B21\u53D8\u5316"];
  const activeChange = typeof change === "string" && /^(?:涉及：|modified\b|staged\b|untracked\b|conflicted\b)/u.test(change);
  const summaryValue = scenarioSummary ?? (activeChange ? change : purpose);
  const summary = typeof summaryValue === "string" ? truncate(summaryValue, 1024) : truncate(outcome.candidate.summary, 1024);
  const comprehension = mentalModelComprehension(outcome);
  const humanSummary = comprehension === void 0 ? void 0 : truncate(
    comprehension.kind === "concept" ? `${comprehension.meaning} ${comprehension.context}` : comprehension.kind === "change" ? `${comprehension.after} ${comprehension.impact}` : comprehension.kind === "decision" ? `${comprehension.choice} ${comprehension.consequence}` : comprehension.kind === "task" ? `${comprehension.status} \u4E0B\u4E00\u6B65\uFF1A${comprehension.next}` : `${comprehension.result} \u5C1A\u672A\u8BC1\u660E\uFF1A${comprehension.gap}`,
    1024
  );
  return {
    entityId: truncate(outcome.detail.entityId, 256),
    entityType: truncate(outcome.detail.entityType, 128),
    label: truncate(outcome.candidate.label, 256),
    summary,
    revision: outcome.detail.entityRevision,
    observedAt: outcome.detail.observedAt,
    freshness: outcome.detail.freshness,
    facts: Object.entries(outcome.detail.facts).slice(0, 5).map(([label, value]) => ({ label, value: factText2(value) })),
    sources: outcome.detail.sourceRefs.slice(0, 5).map((source) => ({
      label: truncate(`${source.sourceType} / ${source.sourceId}`, 512)
    })),
    ...humanSummary === void 0 ? {} : { humanSummary },
    ...comprehension === void 0 ? {} : { comprehension },
    ...options.detailRef === void 0 ? {} : { detailRef: options.detailRef },
    ...options.changes === void 0 ? {} : { changes: options.changes }
  };
}
function detailChanges(before, after) {
  const previous = new Map(before.facts.map((fact) => [fact.label, fact.value]));
  const changes = [];
  if (before.summary !== after.summary) {
    changes.push({ label: "\u6458\u8981", before: before.summary, after: after.summary });
  }
  for (const fact of after.facts) {
    const oldValue = previous.get(fact.label);
    if (oldValue !== void 0 && oldValue !== fact.value) {
      changes.push({ label: fact.label, before: oldValue, after: fact.value });
    }
    if (changes.length >= 3) break;
  }
  return changes.slice(0, 3);
}
function outcomeError(outcome) {
  if (outcome.kind === "no_match") {
    return errorPresentation("not_found", "\u6240\u9009\u6587\u5B57\u4E2D\u672A\u627E\u5230\u5DF2\u7ED1\u5B9A\u5DE5\u4F5C\u533A\u5BF9\u8C61\u3002", false);
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
      outcome.reason === "operation_timeout" ? "\u5DE5\u4F5C\u533A\u67E5\u8BE2\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5\u3002" : "\u5DE5\u4F5C\u533A\u8BE6\u60C5\u6682\u65F6\u4E0D\u53EF\u7528\u3002",
      outcome.retryable
    );
  }
  if (outcome.reason === "context_binding_missing") {
    return errorPresentation(
      outcome.reason,
      "\u5F53\u524D Codex \u4EFB\u52A1\u5C1A\u672A\u663E\u5F0F\u7ED1\u5B9A\u5DE5\u4F5C\u533A\u3002",
      false
    );
  }
  const retryable = outcome.reason === "context_changed" || outcome.reason === "context_binding_unavailable" || outcome.reason === "request_aborted";
  return errorPresentation(
    outcome.reason,
    retryable ? "\u5F53\u524D\u4EFB\u52A1\u6216\u5DE5\u4F5C\u533A\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u540E\u91CD\u8BD5\u3002" : "\u5F53\u524D\u5DE5\u4F5C\u533A\u65E0\u6CD5\u5B89\u5168\u5B8C\u6210\u8BE5\u67E5\u8BE2\u3002",
    retryable
  );
}
function validRequest(request) {
  const task = request.host.task;
  return (request.operation === "resolve" || request.operation === "choose" || request.operation === "check" || request.operation === "refresh") && boundedPrintable(request.requestId, 8, 128) && boundedPrintable(request.selection.text, 1, 512) && request.selection.text === request.selection.text.trim() && /^[0-9a-f]{64}$/u.test(request.selection.digest) && sha2562(request.selection.text) === request.selection.digest && Number.isSafeInteger(request.selection.generation) && request.selection.generation >= 1 && (request.selection.surface === "assistant_message" || request.selection.surface === "user_message") && boundedPrintable(request.contextFingerprint, 1, 2048) && request.host.targetUrl === "app://-/index.html" && task !== void 0 && request.host.revalidateTask !== void 0 && task.contextFingerprint === request.contextFingerprint && task.routeRef === request.host.targetUrl && (request.operation === "resolve" ? request.candidateRef === void 0 && request.detailRef === void 0 : request.operation === "choose" ? boundedPrintable(request.candidateRef, 8, 256) && request.detailRef === void 0 : request.candidateRef === void 0 && boundedPrintable(request.detailRef, 8, 256));
}
function createWorkspaceLookupCallback(options) {
  const candidateRefTtlMs = options.candidateRefTtlMs ?? DEFAULT_CANDIDATE_REF_TTL_MS;
  const maxCandidateRefs = options.maxCandidateRefs ?? DEFAULT_MAX_CANDIDATE_REFS;
  const detailRefTtlMs = options.detailRefTtlMs ?? DEFAULT_DETAIL_REF_TTL_MS;
  const maxDetailRefs = options.maxDetailRefs ?? DEFAULT_MAX_DETAIL_REFS;
  if (!Number.isSafeInteger(candidateRefTtlMs) || candidateRefTtlMs < 100 || candidateRefTtlMs > 3e5) {
    throw new RangeError("candidateRefTtlMs must be an integer from 100 to 300000");
  }
  if (!Number.isSafeInteger(maxCandidateRefs) || maxCandidateRefs < 1 || maxCandidateRefs > 4096) {
    throw new RangeError("maxCandidateRefs must be an integer from 1 to 4096");
  }
  if (!Number.isSafeInteger(detailRefTtlMs) || detailRefTtlMs < 1e3 || detailRefTtlMs > 36e5) {
    throw new RangeError("detailRefTtlMs must be an integer from 1000 to 3600000");
  }
  if (!Number.isSafeInteger(maxDetailRefs) || maxDetailRefs < 1 || maxDetailRefs > 4096) {
    throw new RangeError("maxDetailRefs must be an integer from 1 to 4096");
  }
  const index = options.index ?? new LocalWorkspaceContextIndex();
  const provider = options.provider ?? new LocalWorkspaceAuthoritativeProvider();
  const revisionProbe = options.revisionProbe === false ? void 0 : options.revisionProbe ?? new LocalWorkspaceRevisionProbe();
  const clock = options.clock ?? Date.now;
  const candidateGrants = /* @__PURE__ */ new Map();
  const detailGrants = /* @__PURE__ */ new Map();
  const now = () => {
    const value = clock();
    if (!Number.isFinite(value) || value < 0) throw new Error("workspace lookup clock is invalid");
    return value;
  };
  const prune = (at) => {
    for (const [candidateRef, grant] of candidateGrants) {
      if (grant.expiresAt <= at) candidateGrants.delete(candidateRef);
    }
    for (const [detailRef, grant] of detailGrants) {
      if (grant.expiresAt <= at) detailGrants.delete(detailRef);
    }
  };
  const consumeCandidate = async (request) => {
    const candidateRef = request.candidateRef;
    if (candidateRef === void 0 || request.host.task === void 0) return void 0;
    const checkedAt = now();
    prune(checkedAt);
    const grant = candidateGrants.get(candidateRef);
    const entry = await options.registry.find(request.host.task);
    if (grant === void 0 || entry === void 0 || grant.expiresAt <= checkedAt || grant.targetId !== request.host.targetId || grant.bindingGeneration !== request.host.bindingGeneration || grant.contextFingerprint !== request.contextFingerprint || grant.selectionDigest !== request.selection.digest || grant.selectionGeneration !== request.selection.generation || grant.bindingRevision !== entry.bindingRevision || grant.scopeKey !== scopeKey(entry)) {
      return void 0;
    }
    candidateGrants.delete(candidateRef);
    return grant.entityId;
  };
  const issueCandidates = async (request, candidates2) => {
    if (request.host.task === void 0) return void 0;
    const entry = await options.registry.find(request.host.task);
    if (entry === void 0 || !candidates2.every((candidate) => sameContextScope(candidate.scope, entry.scope))) {
      return void 0;
    }
    const issuedAt = now();
    prune(issuedAt);
    if (candidateGrants.size + candidates2.length > maxCandidateRefs) return void 0;
    return candidates2.map((candidate) => {
      const candidateRef = `pcand:${randomBytes3(32).toString("base64url")}`;
      candidateGrants.set(candidateRef, {
        targetId: request.host.targetId,
        bindingGeneration: request.host.bindingGeneration,
        contextFingerprint: request.contextFingerprint,
        selectionDigest: request.selection.digest,
        selectionGeneration: request.selection.generation,
        entityId: candidate.entityId,
        scopeKey: scopeKey(entry),
        bindingRevision: entry.bindingRevision,
        expiresAt: issuedAt + candidateRefTtlMs
      });
      return candidateView(candidate, candidateRef);
    });
  };
  const runtimeFor = (request, activeEntry) => {
    if (request.host.task === void 0 || request.host.revalidateTask === void 0) {
      throw new Error("host context unavailable");
    }
    const authority = {
      current: async (signal) => await request.host.revalidateTask?.(signal)
    };
    const binding = new CodexTaskWorkspaceBindingPort(
      options.registry,
      request.host.task,
      authority
    );
    const selection = {
      text: request.selection.text,
      surface: request.selection.surface,
      selectionGeneration: request.selection.generation
    };
    const hostContext = {
      selectionGeneration: request.selection.generation,
      explicitScope: { ...activeEntry.scope },
      threadRef: codexTaskThreadRef(request.host.task),
      routeRef: request.host.task.routeRef,
      workspaceRoot: activeEntry.workspaceRoot
    };
    const service = new LookupService(binding, index, [provider], {
      ...options.operationTimeoutMs === void 0 ? {} : { operationTimeoutMs: options.operationTimeoutMs }
    });
    return { binding, selection, hostContext, service };
  };
  const runLookup = async (request, activeEntry, chosenEntityId) => {
    const runtime = runtimeFor(request, activeEntry);
    const activation = runtime.service.issueActivation(
      runtime.selection,
      runtime.hostContext,
      chosenEntityId
    );
    if (activation.kind !== "issued") {
      return {
        kind: "error",
        presentation: errorPresentation(
          activation.kind === "capacity_exceeded" ? "lookup_capacity" : "invalid_request",
          activation.kind === "capacity_exceeded" ? "\u5DE5\u4F5C\u533A\u67E5\u8BE2\u5BB9\u91CF\u5DF2\u6EE1\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002" : "\u5DE5\u4F5C\u533A\u67E5\u8BE2\u8BF7\u6C42\u65E0\u6548\u3002",
          activation.kind === "capacity_exceeded"
        )
      };
    }
    const outcome = await runtime.service.submitLookupIntent({
      ...activation.ticket,
      selection: runtime.selection,
      hostContext: runtime.hostContext,
      ...chosenEntityId === void 0 ? {} : { chosenEntityId }
    }, request.signal);
    return { kind: "outcome", outcome, runtime };
  };
  const probeWithFence = async (runtime, entityId, entityType, signal) => {
    if (revisionProbe === void 0 || signal.aborted) return void 0;
    const resolved = await runtime.binding.resolve(runtime.hostContext, signal);
    if (resolved.kind !== "trusted") return void 0;
    const probed = await revisionProbe.probe({
      binding: resolved,
      entityId,
      entityType,
      signal
    });
    const revalidated = await runtime.binding.revalidate(resolved, signal);
    if (revalidated.kind !== "trusted") return void 0;
    return probed;
  };
  const issueDetail = async (request, activeEntry, outcome, runtime) => {
    const detail = detailView(outcome);
    const issuedAt = now();
    prune(issuedAt);
    if (detailGrants.size >= maxDetailRefs) return detail;
    const probe = await probeWithFence(
      runtime,
      outcome.detail.entityId,
      outcome.detail.entityType,
      request.signal
    );
    if (probe?.kind !== "current") return detail;
    const detailRef = `pdet:${randomBytes3(32).toString("base64url")}`;
    detailGrants.set(detailRef, {
      targetId: request.host.targetId,
      bindingGeneration: request.host.bindingGeneration,
      contextFingerprint: request.contextFingerprint,
      selectionDigest: request.selection.digest,
      selectionGeneration: request.selection.generation,
      entityId: outcome.detail.entityId,
      entityType: outcome.detail.entityType,
      scopeKey: scopeKey(activeEntry),
      bindingRevision: activeEntry.bindingRevision,
      probeRevision: probe.revision,
      detail,
      expiresAt: issuedAt + detailRefTtlMs
    });
    return { ...detail, detailRef };
  };
  const currentDetailGrant = async (request, activeEntry) => {
    const detailRef = request.detailRef;
    if (detailRef === void 0) return void 0;
    const checkedAt = now();
    prune(checkedAt);
    const grant = detailGrants.get(detailRef);
    if (grant === void 0) return void 0;
    if (grant.expiresAt <= checkedAt || grant.targetId !== request.host.targetId || grant.bindingGeneration !== request.host.bindingGeneration || grant.contextFingerprint !== request.contextFingerprint || grant.selectionDigest !== request.selection.digest || grant.selectionGeneration !== request.selection.generation || grant.bindingRevision !== activeEntry.bindingRevision || grant.scopeKey !== scopeKey(activeEntry)) {
      detailGrants.delete(detailRef);
      return void 0;
    }
    return { detailRef, grant };
  };
  return async (request) => {
    if (!validRequest(request) || request.host.task === void 0 || request.host.revalidateTask === void 0) {
      return errorPresentation("host_context_unavailable", "\u5F53\u524D Codex \u4EFB\u52A1\u65E0\u6CD5\u88AB\u5BBF\u4E3B\u786E\u8BA4\u3002", false);
    }
    if (request.signal.aborted) {
      return errorPresentation("request_aborted", "\u5DE5\u4F5C\u533A\u67E5\u8BE2\u5DF2\u53D6\u6D88\u3002", true);
    }
    const activeEntry = await options.registry.find(request.host.task);
    if (activeEntry === void 0) {
      return errorPresentation(
        "context_binding_missing",
        "\u5F53\u524D Codex \u4EFB\u52A1\u5C1A\u672A\u663E\u5F0F\u7ED1\u5B9A\u5DE5\u4F5C\u533A\u3002",
        false
      );
    }
    if (request.operation === "check" || request.operation === "refresh") {
      const current = await currentDetailGrant(request, activeEntry);
      if (current === void 0) {
        return errorPresentation(
          "detail_ref_invalid",
          "\u8BE6\u60C5\u5237\u65B0\u5F15\u7528\u65E0\u6548\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u3002",
          true
        );
      }
      const runtime = runtimeFor(request, activeEntry);
      if (request.operation === "check") {
        const probe2 = await probeWithFence(
          runtime,
          current.grant.entityId,
          current.grant.entityType,
          request.signal
        );
        if (probe2 === void 0) {
          return errorPresentation(
            "context_changed",
            "\u5F53\u524D\u4EFB\u52A1\u6216\u5DE5\u4F5C\u533A\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u540E\u91CD\u8BD5\u3002",
            true
          );
        }
        const state = probe2.kind === "current" ? probe2.revision === current.grant.probeRevision ? "unchanged" : "updated" : probe2.kind === "not_found" ? "deleted" : "unavailable";
        if (state === "unchanged") {
          current.grant.expiresAt = now() + detailRefTtlMs;
        }
        return {
          kind: "revision",
          revision: {
            detailRef: current.detailRef,
            state,
            checkedAt: probe2.observedAt
          }
        };
      }
      const refreshed = await runLookup(request, activeEntry, current.grant.entityId);
      if (refreshed.kind === "error") return refreshed.presentation;
      if (refreshed.outcome.kind === "candidates") {
        return errorPresentation(
          "refresh_identity_ambiguous",
          "\u5237\u65B0\u65F6\u5BF9\u8C61\u8EAB\u4EFD\u4E0D\u518D\u552F\u4E00\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u3002",
          false
        );
      }
      if (refreshed.outcome.kind !== "detail") return outcomeError(refreshed.outcome);
      const nextDetail = detailView(refreshed.outcome);
      const probe = await probeWithFence(
        refreshed.runtime,
        refreshed.outcome.detail.entityId,
        refreshed.outcome.detail.entityType,
        request.signal
      );
      if (probe?.kind !== "current") {
        return errorPresentation(
          "refresh_unavailable",
          "\u66F4\u65B0\u540E\u7684\u8BE6\u60C5\u65E0\u6CD5\u88AB\u5F53\u524D Provider \u590D\u9A8C\u3002",
          true
        );
      }
      const changes = detailChanges(current.grant.detail, nextDetail);
      current.grant.probeRevision = probe.revision;
      current.grant.detail = nextDetail;
      current.grant.expiresAt = now() + detailRefTtlMs;
      return {
        kind: "detail",
        detail: { ...nextDetail, detailRef: current.detailRef, changes }
      };
    }
    const chosenEntityId = request.operation === "choose" ? await consumeCandidate(request) : void 0;
    if (request.operation === "choose" && chosenEntityId === void 0) {
      return errorPresentation("candidate_ref_invalid", "\u5019\u9009\u5F15\u7528\u65E0\u6548\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u67E5\u8BE2\u3002", true);
    }
    const resolved = await runLookup(request, activeEntry, chosenEntityId);
    if (resolved.kind === "error") return resolved.presentation;
    const outcome = resolved.outcome;
    if (outcome.kind === "detail") {
      return {
        kind: "detail",
        detail: await issueDetail(request, activeEntry, outcome, resolved.runtime)
      };
    }
    if (outcome.kind === "candidates") {
      const candidates2 = await issueCandidates(request, outcome.candidates);
      return candidates2 === void 0 ? errorPresentation("candidate_ref_capacity", "\u5019\u9009\u5F15\u7528\u6682\u65F6\u4E0D\u53EF\u7528\uFF0C\u8BF7\u91CD\u8BD5\u3002", true) : { kind: "candidates", candidates: candidates2 };
    }
    return outcomeError(outcome);
  };
}

// src/host/codex-cdp/workspace-companion.ts
var DEFAULT_REFRESH_INTERVAL_MS = 2e3;
function refreshInterval(value) {
  const candidate = value ?? DEFAULT_REFRESH_INTERVAL_MS;
  if (!Number.isSafeInteger(candidate) || candidate < 100 || candidate > 6e4) {
    throw new RangeError("refreshIntervalMs must be an integer from 100 to 60000");
  }
  return candidate;
}
function publicError(error) {
  return error instanceof Error && error.message.length > 0 ? error.message.slice(0, 512) : "workspace companion refresh failed";
}
function publicErrorCode(error) {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && /^[a-z0-9_:-]{1,128}$/u.test(error.code)) {
    return error.code;
  }
  if (error instanceof Error && /^[a-z0-9_:-]{1,128}$/u.test(error.message)) {
    return error.message;
  }
  return "workspace_companion_refresh_failed";
}
function compatibilityStatus(input) {
  const result = (state, code2, gates) => ({
    contract: "private-codex-chat-lane-v1",
    state,
    code: code2,
    ...input.lastRefreshAt === void 0 ? {} : { checkedAt: input.lastRefreshAt },
    gates
  });
  const all = (gate) => ({
    exactMainTarget: gate,
    mainFrame: gate,
    mainExecutionContext: gate,
    rendererLifecycle: gate
  });
  if (input.state === "idle" || input.refreshCount === 0) {
    return result("unchecked", "not_checked", all("unchecked"));
  }
  if (input.state === "stopping" || input.state === "stopped") {
    return result("unavailable", "companion_stopped", all("unavailable"));
  }
  if (input.adapter.targetCount > 0 && input.adapter.targets.length === input.adapter.targetCount) {
    return result("qualified", "qualified_current_runtime", all("pass"));
  }
  const code = input.lastErrorCode;
  if (code === void 0) {
    return result("incompatible", "qualified_target_missing", {
      exactMainTarget: "fail",
      mainFrame: "unchecked",
      mainExecutionContext: "unchecked",
      rendererLifecycle: "unchecked"
    });
  }
  if (code === "pointable_main_frame_unverified") {
    return result("incompatible", code, {
      exactMainTarget: "pass",
      mainFrame: "fail",
      mainExecutionContext: "unchecked",
      rendererLifecycle: "unchecked"
    });
  }
  if (code.startsWith("pointable_main_context_")) {
    return result("incompatible", code, {
      exactMainTarget: "pass",
      mainFrame: "pass",
      mainExecutionContext: "fail",
      rendererLifecycle: "unchecked"
    });
  }
  if (code.startsWith("pointable_renderer_")) {
    return result("incompatible", code, {
      exactMainTarget: "pass",
      mainFrame: "pass",
      mainExecutionContext: "pass",
      rendererLifecycle: "fail"
    });
  }
  return result("unavailable", code, {
    exactMainTarget: "unavailable",
    mainFrame: "unavailable",
    mainExecutionContext: "unavailable",
    rendererLifecycle: "unavailable"
  });
}
function immutableStatus(status) {
  return Object.freeze({
    ...status,
    ...status.activeBinding === void 0 ? {} : {
      activeBinding: Object.freeze({
        ...status.activeBinding,
        scope: Object.freeze({ ...status.activeBinding.scope })
      })
    },
    adapter: Object.freeze({
      ...status.adapter,
      targets: Object.freeze(
        status.adapter.targets.map((target) => Object.freeze({ ...target }))
      )
    }),
    compatibility: Object.freeze({
      ...status.compatibility,
      gates: Object.freeze({ ...status.compatibility.gates })
    })
  });
}
function createWorkspaceCompanion(options) {
  const intervalMs = refreshInterval(options.refreshIntervalMs);
  const presentationMode = options.presentationMode ?? "record";
  const lookup = createWorkspaceLookupCallback({
    registry: options.registry,
    ...options.operationTimeoutMs === void 0 ? {} : { operationTimeoutMs: options.operationTimeoutMs }
  });
  const adapterOptions = {
    lookup,
    ...options.endpoint === void 0 ? {} : { endpoint: options.endpoint },
    ...options.fetch === void 0 ? {} : { fetch: options.fetch },
    ...options.connect === void 0 ? {} : { connect: options.connect },
    ...options.discoveryTimeoutMs === void 0 ? {} : { discoveryTimeoutMs: options.discoveryTimeoutMs },
    ...options.lookupTimeoutMs === void 0 ? {} : { lookupTimeoutMs: options.lookupTimeoutMs },
    ...options.maxConcurrentLookupsPerTarget === void 0 ? {} : { maxConcurrentLookupsPerTarget: options.maxConcurrentLookupsPerTarget },
    actionLabel: options.actionLabel ?? "\u67E5\u770B\u4E0A\u4E0B\u6587",
    presentationMode
  };
  const adapter = new CodexCdpHostAdapter(adapterOptions);
  let state = "idle";
  let startedAt;
  let lastRefreshAt;
  let refreshCount = 0;
  let activeTaskCount = 0;
  let activeBinding;
  let lastError;
  let lastErrorCode;
  let refreshPromise;
  let stopPromise;
  let timer;
  const status = () => {
    const adapterStatus = adapter.status();
    return immutableStatus({
      state,
      mode: "live-local-workspace",
      presentationMode,
      experimentalHostAdapter: true,
      ...startedAt === void 0 ? {} : { startedAt },
      ...lastRefreshAt === void 0 ? {} : { lastRefreshAt },
      refreshCount,
      activeTaskCount,
      ...activeBinding === void 0 ? {} : { activeBinding },
      ...lastError === void 0 ? {} : { lastError },
      ...lastErrorCode === void 0 ? {} : { lastErrorCode },
      compatibility: compatibilityStatus({
        state,
        refreshCount,
        ...lastRefreshAt === void 0 ? {} : { lastRefreshAt },
        ...lastErrorCode === void 0 ? {} : { lastErrorCode },
        adapter: adapterStatus
      }),
      adapter: adapterStatus
    });
  };
  const schedule = () => {
    if (state !== "running") return;
    timer = setTimeout(() => {
      timer = void 0;
      void refresh().finally(schedule);
    }, intervalMs);
  };
  const refresh = () => {
    if (state === "stopping" || state === "stopped") return Promise.resolve(status());
    if (refreshPromise !== void 0) return refreshPromise;
    const operation = (async () => {
      try {
        if (adapter.status().state === "idle") await adapter.start();
        else await adapter.refreshTargets();
        const tasks = await adapter.activeTasks();
        activeTaskCount = tasks.length;
        activeBinding = tasks.length === 1 ? await options.registry.find(tasks[0]) : void 0;
        lastError = void 0;
        lastErrorCode = void 0;
      } catch (error) {
        activeTaskCount = 0;
        activeBinding = void 0;
        lastError = publicError(error);
        lastErrorCode = publicErrorCode(error);
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
      throw new Error("workspace_companion_stopped");
    }
    if (state === "running") return status();
    state = "running";
    startedAt = (/* @__PURE__ */ new Date()).toISOString();
    await refresh();
    schedule();
    return status();
  };
  const bindCurrentTask = async (workspaceRoot) => {
    if (state !== "running") throw new Error("workspace_companion_not_running");
    const tasks = await adapter.activeTasks();
    activeTaskCount = tasks.length;
    if (tasks.length === 0) throw new Error("active_codex_task_unavailable");
    if (tasks.length !== 1) throw new Error("active_codex_task_ambiguous");
    const replaced = await options.registry.find(tasks[0]) !== void 0;
    const entry = await options.registry.bind(tasks[0], workspaceRoot);
    activeBinding = entry;
    return Object.freeze({ binding: entry, replaced });
  };
  const unbindCurrentTask = async () => {
    if (state !== "running") throw new Error("workspace_companion_not_running");
    const tasks = await adapter.activeTasks();
    activeTaskCount = tasks.length;
    if (tasks.length === 0) throw new Error("active_codex_task_unavailable");
    if (tasks.length !== 1) throw new Error("active_codex_task_ambiguous");
    const removed = await options.registry.unbind(tasks[0]);
    activeBinding = void 0;
    return removed;
  };
  const stop = () => {
    if (stopPromise !== void 0) return stopPromise;
    if (state === "stopped") return Promise.resolve(status());
    state = "stopping";
    if (timer !== void 0) {
      clearTimeout(timer);
      timer = void 0;
    }
    const operation = (async () => {
      await refreshPromise?.catch(() => void 0);
      await adapter.stop();
      activeTaskCount = 0;
      activeBinding = void 0;
      state = "stopped";
      return status();
    })();
    stopPromise = operation;
    return operation;
  };
  return Object.freeze({
    adapter,
    registry: options.registry,
    start,
    refresh,
    bindCurrentTask,
    unbindCurrentTask,
    stop,
    status
  });
}

// src/host/codex-cdp/workspace-companion-cli.ts
var CONTROL_SCHEMA_VERSION = 1;
var CONTROL_TIMEOUT_MS = 3e3;
var START_TIMEOUT_MS = 8e3;
var MAX_CONTROL_BYTES = 64 * 1024;
var MAX_REQUEST_BYTES = 8 * 1024;
function fail(message) {
  throw new Error(message);
}
function record7(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function packageRoot(start) {
  let current = resolve5(start);
  for (let depth = 0; depth < 10; depth += 1) {
    const developmentLayout = existsSync(join(current, "src"));
    const packagedLayout = existsSync(join(current, "host", "workspace-companion.mjs"));
    if (existsSync(join(current, "package.json")) && (developmentLayout || packagedLayout)) {
      return current;
    }
    const parent = dirname3(current);
    if (parent === current) break;
    current = parent;
  }
  return fail("pointable-context package root was not found");
}
function localStateRoot() {
  const local = process.env.LOCALAPPDATA;
  return resolve5(local && isAbsolute3(local) ? local : homedir(), "PointableContext");
}
function boundedInteger2(value, name) {
  if (!/^\d+$/u.test(value)) fail(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 100 || parsed > 6e4) {
    fail(`${name} must be from 100 to 60000`);
  }
  return parsed;
}
function parseArguments(argv) {
  const command = argv[0];
  if (command !== "start" && command !== "status" && command !== "bind" && command !== "unbind" && command !== "stop" && command !== "run") {
    return fail(
      "usage: pointable-context-workspace-companion <start|status|bind|unbind|stop> [options]"
    );
  }
  const stateRoot = localStateRoot();
  let stateDir = join(stateRoot, "workspace-companion");
  let registryPath = join(stateRoot, "task-workspace-bindings.json");
  let endpoint = "http://127.0.0.1:9223";
  let refreshIntervalMs = 2e3;
  let presentationMode = "mental-model";
  let workspaceRoot;
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
      if (!isAbsolute3(value)) fail("--state-dir must be absolute");
      stateDir = resolve5(value);
    } else if (argument === "--registry") {
      if (!isAbsolute3(value)) fail("--registry must be absolute");
      registryPath = resolve5(value);
    } else if (argument === "--endpoint") {
      endpoint = value;
    } else if (argument === "--refresh-ms") {
      refreshIntervalMs = boundedInteger2(value, "--refresh-ms");
    } else if (argument === "--presentation-mode") {
      if (value !== "record" && value !== "narrative" && value !== "mental-model") {
        fail("--presentation-mode must be record, narrative, or mental-model");
      }
      presentationMode = value;
    } else if (argument === "--workspace-root") {
      if (!isAbsolute3(value)) fail("--workspace-root must be absolute");
      workspaceRoot = resolve5(value);
    } else {
      fail(`unknown option: ${argument}`);
    }
  }
  if (command === "bind" && workspaceRoot === void 0) {
    fail("bind requires --workspace-root <absolute-path>");
  }
  return {
    command,
    stateDir,
    registryPath,
    endpoint,
    refreshIntervalMs,
    presentationMode,
    ...workspaceRoot === void 0 ? {} : { workspaceRoot },
    json
  };
}
var statePath = (directory) => join(directory, "state.json");
var lockPath = (directory) => join(directory, "runtime.lock");
var logPath = (directory) => join(directory, "companion.log");
function parseState(value) {
  if (!record7(value) || value.schemaVersion !== CONTROL_SCHEMA_VERSION || value.mode !== "live-local-workspace" || !Number.isSafeInteger(value.pid) || Number(value.pid) < 1 || !Number.isSafeInteger(value.port) || Number(value.port) < 1 || Number(value.port) > 65535 || typeof value.token !== "string" || !/^[a-f0-9]{64}$/u.test(value.token) || typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt))) {
    return fail("invalid workspace companion state");
  }
  return {
    schemaVersion: 1,
    mode: "live-local-workspace",
    pid: Number(value.pid),
    port: Number(value.port),
    token: value.token,
    startedAt: value.startedAt
  };
}
async function readState(directory) {
  try {
    const text = await readFile2(statePath(directory), "utf8");
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
async function readLockPid(directory) {
  try {
    const value = (await readFile2(lockPath(directory), "utf8")).trim();
    if (!/^\d+$/u.test(value)) return void 0;
    const pid = Number(value);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : void 0;
  } catch {
    return void 0;
  }
}
async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID4()}.tmp`;
  await writeFile2(temporary, `${JSON.stringify(value)}
`, {
    encoding: "utf8",
    mode: 384,
    flag: "wx"
  });
  await rename2(temporary, path);
}
async function claimLock(directory) {
  await mkdir2(directory, { recursive: true, mode: 448 });
  try {
    const handle = await open2(lockPath(directory), "wx", 384);
    try {
      await handle.writeFile(`${process.pid}
`, "utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error.code === "EEXIST") {
      fail("workspace companion runtime lock is already held");
    }
    throw error;
  }
}
async function removeOwnedState(directory, token) {
  if (token !== void 0) {
    const current = await readState(directory);
    if (current !== void 0 && current.token !== token) return;
  }
  await rm(statePath(directory), { force: true }).catch(() => void 0);
  const lockPid = await readLockPid(directory);
  if (lockPid === void 0 || lockPid === process.pid || !processIsAlive(lockPid)) {
    await rm(lockPath(directory), { force: true }).catch(() => void 0);
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
async function readRequestJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > MAX_REQUEST_BYTES) throw new Error("control request is too large");
    chunks.push(value);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!record7(parsed)) throw new Error("control request JSON is invalid");
  return parsed;
}
async function controlRequest(state, method, path, body) {
  const encoded = body === void 0 ? void 0 : Buffer.from(JSON.stringify(body), "utf8");
  return await new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port: state.port,
      method,
      path,
      headers: {
        "x-pointable-control-token": state.token,
        connection: "close",
        ...encoded === void 0 ? {} : {
          "content-type": "application/json",
          "content-length": encoded.byteLength
        }
      },
      timeout: CONTROL_TIMEOUT_MS
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.byteLength;
        if (bytes > MAX_CONTROL_BYTES) {
          request.destroy(new Error("control response is too large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!record7(parsed)) throw new Error("control response is invalid");
          if ((response.statusCode ?? 500) >= 400) {
            rejectRequest(new Error(
              typeof parsed.error === "string" ? parsed.error : "control request failed"
            ));
            return;
          }
          resolveRequest(parsed);
        } catch (error) {
          rejectRequest(error);
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("control request timed out")));
    request.on("error", rejectRequest);
    request.end(encoded);
  });
}
async function liveStatus(directory) {
  const state = await readState(directory);
  if (state === void 0 || !processIsAlive(state.pid)) return void 0;
  try {
    return await controlRequest(state, "GET", "/status");
  } catch {
    return void 0;
  }
}
async function waitForStatus(directory) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await liveStatus(directory);
    if (status !== void 0) return status;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return fail(`workspace companion did not become ready; see ${logPath(directory)}`);
}
async function runServer(arguments_) {
  await claimLock(arguments_.stateDir);
  const token = randomBytes4(32).toString("hex");
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const registry = new CodexTaskWorkspaceBindingRegistry(arguments_.registryPath);
  const companion = createWorkspaceCompanion({
    registry,
    endpoint: arguments_.endpoint,
    refreshIntervalMs: arguments_.refreshIntervalMs,
    presentationMode: arguments_.presentationMode
  });
  let resolveShutdown;
  const shutdown = new Promise((resolvePromise) => {
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
    const tokenHeader = request.headers["x-pointable-control-token"];
    if (remote !== "127.0.0.1" && remote !== "::ffff:127.0.0.1" || typeof tokenHeader !== "string" || !safeTokenEqual(tokenHeader, token)) {
      sendJson(response, 403, { ok: false, error: "forbidden" });
      return;
    }
    if (request.method === "GET" && request.url === "/status") {
      sendJson(response, 200, { ok: true, pid: process.pid, companion: companion.status() });
      return;
    }
    if (request.method === "POST" && request.url === "/refresh") {
      void companion.refresh().then(
        (status) => sendJson(response, 200, { ok: true, companion: status }),
        () => sendJson(response, 503, { ok: false, error: "refresh_failed" })
      );
      return;
    }
    if (request.method === "POST" && request.url === "/bind") {
      void readRequestJson(request).then(async (body) => {
        if (typeof body.workspaceRoot !== "string" || !isAbsolute3(body.workspaceRoot)) {
          throw new Error("workspace_root_invalid");
        }
        return await companion.bindCurrentTask(resolve5(body.workspaceRoot));
      }).then(
        (result) => sendJson(response, 200, { ok: true, ...result }),
        (error) => sendJson(response, 409, {
          ok: false,
          error: error instanceof Error ? error.message : "bind_failed"
        })
      );
      return;
    }
    if (request.method === "POST" && request.url === "/unbind") {
      void companion.unbindCurrentTask().then(
        (unbound) => sendJson(response, 200, {
          ok: true,
          unbound: unbound ?? null,
          wasBound: unbound !== void 0
        }),
        (error) => sendJson(response, 409, {
          ok: false,
          error: error instanceof Error ? error.message : "unbind_failed"
        })
      );
      return;
    }
    if (request.method === "POST" && request.url === "/stop") {
      sendJson(response, 202, { ok: true, stopping: true }, requestShutdown);
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
    await writeJsonAtomic(statePath(arguments_.stateDir), {
      schemaVersion: 1,
      mode: "live-local-workspace",
      pid: process.pid,
      port: address.port,
      token,
      startedAt
    });
    process.stdout.write(`${JSON.stringify({ event: "workspace_companion_ready", pid: process.pid })}
`);
    await shutdown;
  } finally {
    await companion.stop().catch(() => void 0);
    await new Promise((resolveClose) => server.close(() => resolveClose())).catch(() => void 0);
    await removeOwnedState(arguments_.stateDir, token);
  }
}
async function startDetached(arguments_) {
  const existing = await liveStatus(arguments_.stateDir);
  if (existing !== void 0) return { ...existing, alreadyRunning: true };
  const lockPid = await readLockPid(arguments_.stateDir);
  if (lockPid !== void 0 && processIsAlive(lockPid)) {
    return { ...await waitForStatus(arguments_.stateDir), alreadyRunning: true };
  }
  await removeOwnedState(arguments_.stateDir);
  await mkdir2(arguments_.stateDir, { recursive: true, mode: 448 });
  const logDescriptor = openSync(logPath(arguments_.stateDir), "a", 384);
  const entrypoint = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [
    entrypoint,
    "run",
    "--state-dir",
    arguments_.stateDir,
    "--registry",
    arguments_.registryPath,
    "--endpoint",
    arguments_.endpoint,
    "--refresh-ms",
    String(arguments_.refreshIntervalMs),
    "--presentation-mode",
    arguments_.presentationMode,
    "--json"
  ], {
    cwd: packageRoot(dirname3(entrypoint)),
    detached: true,
    windowsHide: true,
    stdio: ["ignore", logDescriptor, logDescriptor]
  });
  try {
    await Promise.race([
      once(child, "spawn"),
      once(child, "error").then(([error]) => Promise.reject(error))
    ]);
    child.unref();
  } finally {
    closeSync(logDescriptor);
  }
  return { ...await waitForStatus(arguments_.stateDir), alreadyRunning: false };
}
async function stopDetached(directory) {
  const state = await readState(directory);
  if (state === void 0 || !processIsAlive(state.pid)) {
    await removeOwnedState(directory);
    return { ok: true, stopped: true, wasRunning: false };
  }
  await controlRequest(state, "POST", "/stop");
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!processIsAlive(state.pid) && await readState(directory) === void 0) {
      return { ok: true, stopped: true, wasRunning: true };
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return fail("workspace companion did not stop cleanly");
}
function print(value, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}
`);
    return;
  }
  const binding = record7(value.binding) ? value.binding : void 0;
  if (binding !== void 0) {
    process.stdout.write(
      `${value.replaced === true ? "Rebound" : "Bound"} active Codex task ${String(binding.threadId)} to ${String(binding.workspaceRoot)}
`
    );
    return;
  }
  const unbound = record7(value.unbound) ? value.unbound : void 0;
  if (value.wasBound === true && unbound !== void 0) {
    process.stdout.write(
      `Unbound active Codex task ${String(unbound.threadId)} from ${String(unbound.workspaceRoot)}
`
    );
    return;
  }
  if (value.wasBound === false) {
    process.stdout.write("Active Codex task was not bound\n");
    return;
  }
  const companion = record7(value.companion) ? value.companion : void 0;
  const adapter = companion && record7(companion.adapter) ? companion.adapter : void 0;
  const state = typeof companion?.state === "string" ? companion.state : value.stopped === true ? "stopped" : "inactive";
  const targets = typeof adapter?.targetCount === "number" ? adapter.targetCount : 0;
  const tasks = typeof companion?.activeTaskCount === "number" ? companion.activeTaskCount : 0;
  const compatibility = companion && record7(companion.compatibility) ? companion.compatibility : void 0;
  const compatibilityState = typeof compatibility?.state === "string" ? compatibility.state : "unchecked";
  const compatibilityCode = typeof compatibility?.code === "string" ? compatibility.code : "not_checked";
  process.stdout.write(
    `Pointable Context workspace companion: ${state}; targets=${targets}; activeTasks=${tasks}; compatibility=${compatibilityState}(${compatibilityCode})
`
  );
}
async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.command === "run") {
    await runServer(arguments_);
    return;
  }
  if (arguments_.command === "start") {
    print(await startDetached(arguments_), arguments_.json);
    return;
  }
  if (arguments_.command === "stop") {
    print(await stopDetached(arguments_.stateDir), arguments_.json);
    return;
  }
  if (arguments_.command === "bind") {
    const state = await readState(arguments_.stateDir);
    if (state === void 0 || !processIsAlive(state.pid)) {
      fail("workspace companion is not running");
    }
    print(await controlRequest(state, "POST", "/bind", {
      workspaceRoot: arguments_.workspaceRoot
    }), arguments_.json);
    return;
  }
  if (arguments_.command === "unbind") {
    const state = await readState(arguments_.stateDir);
    if (state === void 0 || !processIsAlive(state.pid)) {
      fail("workspace companion is not running");
    }
    print(await controlRequest(state, "POST", "/unbind"), arguments_.json);
    return;
  }
  print(await liveStatus(arguments_.stateDir) ?? { ok: true, stopped: true }, arguments_.json);
}
try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}
`);
  process.exitCode = 1;
}

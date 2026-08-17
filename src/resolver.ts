import type {
  CandidateMatch,
  ContextScopeRef,
  IdentityRecord,
  MatchKind,
  ResolutionOutcome,
  ResolvedCandidate,
} from "./contracts.js";
import { copyContextScope, sameContextScope } from "./context-scope.js";
import {
  findBoundedLiteral,
  findLiteralPhrase,
  normalizeText,
} from "./normalize.js";
import { assertContextIndexResolutionBudget } from "./validation.js";

type MatchAttempt = { kind: MatchKind; matchedText: string } | undefined;

function toCandidate(
  record: IdentityRecord,
  attempt: NonNullable<MatchAttempt>,
): ResolvedCandidate {
  const match: CandidateMatch = {
    scope: copyContextScope(record.scope),
    entityId: record.entityId,
    entityType: record.entityType,
    label: record.canonicalName,
    summary: record.summary,
    matchKind: attempt.kind,
    indexRevision: record.indexRevision,
    indexedAt: record.indexedAt,
    detailFreshness: "unknown",
  };
  return { match, record };
}

function deduplicateAndSort(candidates: ResolvedCandidate[]): ResolvedCandidate[] {
  const byEntity = new Map<string, ResolvedCandidate>();
  for (const candidate of candidates) {
    byEntity.set(candidate.record.entityId, candidate);
  }

  return [...byEntity.values()].sort((left, right) =>
    left.record.entityId.localeCompare(right.record.entityId, "en"),
  );
}

function exactIdMatch(selection: string, record: IdentityRecord): MatchAttempt {
  const keys = [record.canonicalKey, record.entityId].filter(
    (value): value is string => Boolean(value),
  );
  for (const key of keys) {
    const matchedText = findBoundedLiteral(selection, key);
    if (matchedText) {
      return { kind: "exact_id", matchedText };
    }
  }
  return undefined;
}

function exactNameMatch(selection: string, record: IdentityRecord): MatchAttempt {
  const matchedText = findLiteralPhrase(selection, record.canonicalName);
  return matchedText ? { kind: "exact_name", matchedText } : undefined;
}

function exactAliasMatch(selection: string, record: IdentityRecord): MatchAttempt {
  for (const alias of record.aliases) {
    const matchedText = findLiteralPhrase(selection, alias);
    if (matchedText) {
      return { kind: "exact_alias", matchedText };
    }
  }
  return undefined;
}

function normalizedMatch(
  normalizedSelection: string,
  record: IdentityRecord,
): MatchAttempt {
  const values = [
    record.canonicalKey,
    record.entityId,
    record.canonicalName,
    ...record.aliases,
  ].filter((value): value is string => Boolean(value));

  for (const value of values) {
    const normalizedValue = normalizeText(value);
    const matchedText = findLiteralPhrase(normalizedSelection, normalizedValue);
    if (matchedText) {
      return { kind: "normalized_exact", matchedText: normalizedValue };
    }
  }
  return undefined;
}

function route(candidates: ResolvedCandidate[]): ResolutionOutcome {
  if (candidates.length === 0) {
    return { kind: "no_match" };
  }
  if (candidates.length === 1) {
    return { kind: "unique", candidate: candidates[0]! };
  }
  if (new Set(candidates.map((candidate) => candidate.record.entityType)).size > 1) {
    return {
      kind: "overflow",
      candidateCount: candidates.length,
      reason: "mixed_types",
    };
  }
  if (candidates.every((candidate) => candidate.match.matchKind === "normalized_exact")) {
    return {
      kind: "overflow",
      candidateCount: candidates.length,
      reason: "ambiguous_normalized",
    };
  }
  if (candidates.length <= 3) {
    return { kind: "candidates", candidates };
  }
  return {
    kind: "overflow",
    candidateCount: candidates.length,
    reason: "too_many",
  };
}

/**
 * Deterministic scope-local resolver. Lower-priority match layers are never
 * mixed into a higher-priority result set.
 */
export function resolveSelection(
  scope: ContextScopeRef,
  selection: string,
  records: IdentityRecord[],
): ResolutionOutcome {
  // Perform a cheap, deterministic preflight before constructing any dynamic
  // regular expression. LookupService already checks this while validating the
  // port result; this second gate protects direct resolver callers.
  assertContextIndexResolutionBudget(records, selection);

  const scoped = records.filter(
    (record) => sameContextScope(record.scope, scope) && !record.deleted,
  );
  const normalizedSelection = normalizeText(selection);
  const layers = [
    exactIdMatch,
    exactNameMatch,
    exactAliasMatch,
    (_selection: string, record: IdentityRecord) =>
      normalizedMatch(normalizedSelection, record),
  ] as const;

  for (const matchLayer of layers) {
    const candidates = deduplicateAndSort(
      scoped.flatMap((record) => {
        const attempt = matchLayer(selection, record);
        return attempt ? [toCandidate(record, attempt)] : [];
      }),
    );
    if (candidates.length > 0) {
      return route(candidates);
    }
  }

  return { kind: "no_match" };
}

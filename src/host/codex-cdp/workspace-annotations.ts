import { createHash } from "node:crypto";
import { LocalWorkspaceContextIndex } from "../../adapters/local-workspace.js";
import type { ContextIndexPort, IdentityRecord } from "../../contracts.js";
import { sameContextScope } from "../../context-scope.js";
import { validateContextIndexForRuntime } from "../../validation.js";
import type {
  PointableAnnotationCatalog,
  PointableObjectAnnotation,
} from "./renderer.js";
import type {
  PointableAnnotationProvider,
  PointableAnnotationProviderRequest,
} from "./adapter.js";
import {
  CodexTaskWorkspaceBindingPort,
  CodexTaskWorkspaceBindingRegistry,
  codexTaskThreadRef,
} from "./task-workspace-binding.js";

const DEFAULT_MAX_ANNOTATIONS = 256;

export interface WorkspaceAnnotationProviderOptions {
  registry: CodexTaskWorkspaceBindingRegistry;
  index?: ContextIndexPort;
  maxAnnotations?: number;
}

const TYPE_PRIORITY: Readonly<Record<string, number>> = Object.freeze({
  task: 95,
  decision: 92,
  change: 89,
  verification: 86,
  concept: 83,
  module: 72,
  document: 62,
  configuration: 54,
  file: 24,
});

function normalizedTerm(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function usableTerm(value: string): boolean {
  return (
    value === value.trim() &&
    value.length >= 3 &&
    value.length <= 256 &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function objectKey(record: IdentityRecord): string {
  return createHash("sha256")
    .update(record.scope.kind, "utf8")
    .update("\u0000", "utf8")
    .update(record.scope.namespace, "utf8")
    .update("\u0000", "utf8")
    .update(record.scope.id, "utf8")
    .update("\u0000", "utf8")
    .update(record.entityId, "utf8")
    .digest("hex");
}

function recordTerms(record: IdentityRecord): Array<{ term: string; bonus: number }> {
  const values: Array<{ term: string; bonus: number }> = [
    { term: record.canonicalName, bonus: 4 },
    ...(record.canonicalKey === undefined
      ? []
      : [{ term: record.canonicalKey, bonus: 2 }]),
    ...record.aliases.map((term) => ({ term, bonus: 0 })),
  ];
  const seen = new Set<string>();
  return values.filter(({ term }) => {
    if (!usableTerm(term)) return false;
    const normalized = normalizedTerm(term);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).slice(0, 4);
}

/**
 * Project a validated identity index into a bounded, detail-free annotation
 * catalog. Ambiguous names are omitted instead of being visually promised as
 * a single object. The existing selection path can still resolve them.
 */
export function buildWorkspaceAnnotationCatalog(
  records: readonly IdentityRecord[],
  bindingRevision: string,
  contextFingerprint: string,
  maxAnnotations = DEFAULT_MAX_ANNOTATIONS,
): PointableAnnotationCatalog {
  if (
    !Number.isSafeInteger(maxAnnotations) ||
    maxAnnotations < 1 ||
    maxAnnotations > DEFAULT_MAX_ANNOTATIONS
  ) {
    throw new RangeError("maxAnnotations must be an integer from 1 to 256");
  }
  const byTerm = new Map<
    string,
    Array<{ record: IdentityRecord; term: string; bonus: number }>
  >();
  for (const record of records) {
    if (record.deleted) continue;
    for (const term of recordTerms(record)) {
      const normalized = normalizedTerm(term.term);
      const bucket = byTerm.get(normalized) ?? [];
      bucket.push({ record, term: term.term, bonus: term.bonus });
      byTerm.set(normalized, bucket);
    }
  }

  const entries: PointableObjectAnnotation[] = [];
  for (const bucket of byTerm.values()) {
    const objectIds = new Set(bucket.map(({ record }) => record.entityId));
    if (objectIds.size !== 1) continue;
    const candidate = bucket[0];
    if (candidate === undefined) continue;
    const base = TYPE_PRIORITY[candidate.record.entityType] ?? 10;
    entries.push({
      objectKey: objectKey(candidate.record),
      term: candidate.term,
      entityType: candidate.record.entityType,
      priority: Math.min(100, base + candidate.bonus),
    });
  }
  entries.sort((left, right) =>
    right.priority - left.priority ||
    right.term.length - left.term.length ||
    left.term.localeCompare(right.term, "en"));
  const primary: PointableObjectAnnotation[] = [];
  const aliases: PointableObjectAnnotation[] = [];
  const primaryObjectKeys = new Set<string>();
  for (const entry of entries) {
    if (primaryObjectKeys.has(entry.objectKey)) {
      aliases.push(entry);
      continue;
    }
    primaryObjectKeys.add(entry.objectKey);
    primary.push(entry);
  }
  const bounded = [
    ...primary.slice(0, maxAnnotations),
    ...aliases,
  ].slice(0, maxAnnotations);
  const revision = createHash("sha256")
    .update(bindingRevision, "utf8")
    .update("\u0000", "utf8")
    .update(JSON.stringify(bounded), "utf8")
    .digest("hex");
  return Object.freeze({
    revision,
    contextFingerprint,
    entries: Object.freeze(bounded.map((entry) => Object.freeze({ ...entry }))),
  });
}

export function createWorkspaceAnnotationProvider(
  options: WorkspaceAnnotationProviderOptions,
): PointableAnnotationProvider {
  const index = options.index ?? new LocalWorkspaceContextIndex();
  const maxAnnotations = options.maxAnnotations ?? DEFAULT_MAX_ANNOTATIONS;
  return async (request: Readonly<PointableAnnotationProviderRequest>) => {
    if (request.signal.aborted) throw request.signal.reason;
    const entry = await options.registry.find(request.host.task);
    if (entry === undefined) {
      return {
        revision: "unbound",
        contextFingerprint: request.host.task.contextFingerprint,
        entries: [],
      };
    }
    const binding = new CodexTaskWorkspaceBindingPort(
      options.registry,
      request.host.task,
      { current: request.host.revalidateTask },
    );
    const hostContext = {
      selectionGeneration: 1,
      explicitScope: { ...entry.scope },
      threadRef: codexTaskThreadRef(request.host.task),
      routeRef: request.host.task.routeRef,
      workspaceRoot: entry.workspaceRoot,
    };
    const resolved = await binding.resolve(hostContext, request.signal);
    if (resolved.kind !== "trusted") {
      return {
        revision: "unavailable",
        contextFingerprint: request.host.task.contextFingerprint,
        entries: [],
      };
    }
    const rawRecords = await index.list(resolved, request.signal);
    const records = validateContextIndexForRuntime(rawRecords, resolved.scope);
    const revalidated = await binding.revalidate(resolved, request.signal);
    if (
      revalidated.kind !== "trusted" ||
      !sameContextScope(revalidated.scope, resolved.scope) ||
      revalidated.bindingRevision !== resolved.bindingRevision
    ) {
      return {
        revision: "context-changed",
        contextFingerprint: request.host.task.contextFingerprint,
        entries: [],
      };
    }
    return buildWorkspaceAnnotationCatalog(
      records,
      resolved.bindingRevision,
      request.host.task.contextFingerprint,
      maxAnnotations,
    );
  };
}

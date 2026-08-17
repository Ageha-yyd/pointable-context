import type {
  ContextScopeKind,
  ContextScopeRef,
  DetailSnapshot,
  IdentityRecord,
  TrustedContextBinding,
} from "../src/contracts.js";

export const PROJECT_SCOPE: ContextScopeRef = Object.freeze({
  kind: "project",
  namespace: "test-host",
  id: "PRJ-01",
});

export function contextScope(
  kind: ContextScopeKind,
  id: string,
  namespace = "test-host",
): ContextScopeRef {
  return { kind, namespace, id };
}

export function identity(
  entityId: string,
  canonicalKey: string,
  overrides: Partial<IdentityRecord> = {},
): IdentityRecord {
  return {
    schemaVersion: "1.0",
    scope: PROJECT_SCOPE,
    entityId,
    entityType: "work_unit",
    canonicalKey,
    canonicalName: `${canonicalKey} Name`,
    aliases: [],
    summary: `${canonicalKey} summary`,
    authorityRef: {
      provider: "stub",
      locator: `loc/${entityId}`,
    },
    indexRevision: "idx-1",
    indexedAt: "2026-08-17T00:00:00Z",
    deleted: false,
    ...overrides,
  };
}

export function snapshot(
  entityId = "WU:GOV-1",
  overrides: Partial<DetailSnapshot> = {},
): DetailSnapshot {
  return {
    scope: PROJECT_SCOPE,
    entityId,
    entityType: "work_unit",
    entityRevision: "r1",
    observedAt: new Date(Date.now() - 1_000).toISOString(),
    freshness: "current",
    facts: { status: "active" },
    relations: [],
    sourceRefs: [{ sourceType: "test", sourceId: "source-1" }],
    ...overrides,
  };
}

export function trustedBinding(
  overrides: Partial<TrustedContextBinding> = {},
): TrustedContextBinding {
  return {
    kind: "trusted",
    scope: PROJECT_SCOPE,
    bindingRevision: "binding-1",
    evidence: "explicit_user",
    selectionGeneration: 1,
    threadRef: "thread-1",
    routeRef: "chat",
    workspaceRoot: "D:/fixture",
    ...overrides,
  };
}

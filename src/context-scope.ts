import type { ContextScopeKind, ContextScopeRef } from "./contracts.js";

const KINDS = new Set<ContextScopeKind>([
  "thread",
  "workspace",
  "project",
  "collection",
  "external",
]);

export function isContextScopeKind(value: unknown): value is ContextScopeKind {
  return typeof value === "string" && KINDS.has(value as ContextScopeKind);
}

export function sameContextScope(
  left: ContextScopeRef,
  right: ContextScopeRef,
): boolean {
  return (
    left.kind === right.kind &&
    left.namespace === right.namespace &&
    left.id === right.id
  );
}

/** Canonical tuple used by activation/reference binding; never key by ID alone. */
export function contextScopeTuple(
  scope: ContextScopeRef,
): readonly [ContextScopeKind, string, string] {
  return [scope.kind, scope.namespace, scope.id];
}

export function copyContextScope(scope: ContextScopeRef): ContextScopeRef {
  return Object.freeze({
    kind: scope.kind,
    namespace: scope.namespace,
    id: scope.id,
  });
}

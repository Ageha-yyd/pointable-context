/**
 * Builds stable lookup identities and rejects duplicate normalized IDs before exposing candidates.
 */
export interface ContextRecordIdentity {
  id: string;
  type: "task" | "verification";
}

export function recordIdentityKey(path: string): string {
  return path.replace(/\.md$/u, "").toLocaleLowerCase("en-US");
}

export function indexContextRecordPaths(paths: readonly string[]): ContextRecordIdentity[] {
  const unique = new Map<string, ContextRecordIdentity>();
  for (const path of paths) {
    const id = recordIdentityKey(path);
    if (!unique.has(id)) {
      unique.set(id, {
        id,
        type: path.includes("/verifications/") ? "verification" : "task",
      });
    }
  }
  return [...unique.values()];
}

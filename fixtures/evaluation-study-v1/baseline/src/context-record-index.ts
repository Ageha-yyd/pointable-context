/**
 * Builds stable lookup identities for explicit context records without reading record details.
 */
export interface ContextRecordIdentity {
  id: string;
  type: "task" | "verification";
}

export function indexContextRecordPaths(paths: readonly string[]): ContextRecordIdentity[] {
  return paths.map((path) => ({
    id: path.replace(/\.md$/u, "").toLocaleLowerCase("en-US"),
    type: path.includes("/verifications/") ? "verification" : "task",
  }));
}

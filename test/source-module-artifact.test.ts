import assert from "node:assert/strict";
import test from "node:test";
import { extractSourceModuleStructure } from "../src/adapters/source-module-artifact.js";

test("source module structure extracts bounded role, exports, and direct dependencies", () => {
  const structure = extractSourceModuleStructure(`/**
 * Resolves a selected source module into deterministic development context.
 * @remarks This tag must not become user-facing prose.
 */
import { readFile } from "node:fs/promises";
import type { HostContext } from "./contracts.js";

const example = \`export function hiddenInsideTemplate() {}\`;
// export function hiddenInsideComment() {}
export async function resolveModule(): Promise<void> {}
export default class ModuleResolver {}
const helper = 1;
export { helper as publicHelper };
`, "src/module-resolver.ts");

  assert.equal(
    structure.role,
    "Resolves a selected source module into deterministic development context.",
  );
  assert.deepEqual(structure.exports, [
    "resolveModule",
    "ModuleResolver",
    "default",
    "publicHelper",
  ]);
  assert.deepEqual(structure.dependencies, ["node:fs/promises", "./contracts.js"]);
  assert.equal(structure.declarations.some((value) => value.name === "hiddenInsideTemplate"), false);
  assert.equal(structure.declarations.some((value) => value.name === "hiddenInsideComment"), false);
});

test("entry modules receive a deterministic fallback when no leading role exists", () => {
  const structure = extractSourceModuleStructure(
    "const start = () => undefined;\nexport { start };\n",
    "src/server.ts",
  );

  assert.equal(structure.role, "入口模块；公开导出 start");
  assert.deepEqual(structure.exports, ["start"]);
  assert.deepEqual(structure.dependencies, []);
});

test("source structure projection stays bounded for a declaration-heavy module", () => {
  const declarations = Array.from(
    { length: 10_000 },
    (_, index) => `export const exportedValue${index} = ${index};`,
  ).join("\n");
  const structure = extractSourceModuleStructure(
    `/** ${"bounded role ".repeat(80)} */\n${declarations}\n`,
    "src/generated.ts",
  );

  assert.equal(structure.exports.length, 5);
  assert.equal(structure.declarations.length, 256);
  assert.ok(structure.role.length <= 360);
});

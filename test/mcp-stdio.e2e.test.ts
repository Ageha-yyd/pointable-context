import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const entrypoint = resolve("dist/src/mcp/stdio.js");
const fixture = resolve("fixtures/mini-project");

const scenarios = [
  {
    name: "compiled TypeScript entrypoint",
    entrypoint,
    fixtureRoot: fixture,
  },
  {
    name: "bundled plugin entrypoint with cwd-relative fixture",
    entrypoint: "./mcp/server.mjs",
    fixtureRoot: "./fixtures/mini-project",
  },
] as const;

for (const scenario of scenarios) test(`official v2 client completes a real stdio round trip through the ${scenario.name}`, async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      scenario.entrypoint,
      "--fixture-root",
      scenario.fixtureRoot,
      "--project-id",
      "PRJ-01",
    ],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: unknown) => {
    stderr += String(chunk);
  });
  const client = new Client({ name: "pointable-context-stdio-test", version: "1" });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      ["read_project_entity", "resolve_project_entities"],
    );
    const result = await client.callTool({
      name: "resolve_project_entities",
      arguments: { selection: "ARCH-7" },
    });
    assert.equal(result.isError, false);
    assert.ok(result.structuredContent);
    assert.equal(
      (result.structuredContent as Record<string, unknown>).status,
      "unique",
    );
    assert.equal(result.content[0]?.type, "text");
  } finally {
    await client.close();
  }

  assert.match(stderr, /FIXTURE-ONLY probe/u);
  assert.doesNotMatch(stderr, /ARCH-7|PRJ-01|Selection Query Boundary/u);
});

import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  POINTABLE_ENTITY_WIDGET_MIME,
  POINTABLE_ENTITY_WIDGET_URI,
} from "../src/mcp/entity-widget.js";

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
      [
        "read_project_entity",
        "render_context_capsule",
        "resolve_project_entities",
      ],
    );
    const renderTool = tools.tools.find(
      (tool) => tool.name === "render_context_capsule",
    );
    assert.equal(
      (renderTool?._meta?.ui as Record<string, unknown>)?.resourceUri,
      POINTABLE_ENTITY_WIDGET_URI,
    );
    const resource = await client.readResource({ uri: POINTABLE_ENTITY_WIDGET_URI });
    assert.equal(resource.contents[0]?.mimeType, POINTABLE_ENTITY_WIDGET_MIME);
    assert.ok(resource.contents[0] && "text" in resource.contents[0]);
    assert.match(
      resource.contents[0] && "text" in resource.contents[0]
        ? resource.contents[0].text
        : "",
      /aria-expanded/u,
    );
    const html = resource.contents[0] && "text" in resource.contents[0]
      ? resource.contents[0].text
      : "";
    assert.doesNotMatch(html, /ui\/message|sendFollowUpMessage|<form\b/iu);
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
    const candidates = (
      result.structuredContent as Record<string, unknown>
    ).candidates as Array<Record<string, unknown>>;
    const rendered = await client.callTool({
      name: "render_context_capsule",
      arguments: { entity_ref: candidates[0]?.entity_ref },
    });
    assert.equal(rendered.isError, false);
    assert.equal(
      (rendered.structuredContent as Record<string, unknown>).status,
      "detail",
    );
  } finally {
    await client.close();
  }

  assert.match(stderr, /FIXTURE-ONLY probe/u);
  assert.doesNotMatch(stderr, /ARCH-7|PRJ-01|Selection Query Boundary/u);
});

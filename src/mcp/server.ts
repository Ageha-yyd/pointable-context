import type { CallToolResult } from "@modelcontextprotocol/server";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  FIXTURE_RUNTIME,
  FIXTURE_WARNING,
  type ReadStructuredContent,
  type ResolveStructuredContent,
  type ToolReply,
  FixtureProjectEntityToolService,
  readFailure,
  resolveFailure,
} from "./fixture-tool-service.js";

const errorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  })
  .nullable();

const candidateSchema = z.object({
  entity_ref: z.string(),
  projectId: z.string(),
  entityId: z.string(),
  entityType: z.string(),
  label: z.string(),
  summary: z.string(),
  matchKind: z.enum(["exact_id", "exact_name", "exact_alias", "normalized_exact"]),
  indexRevision: z.string(),
  indexedAt: z.string(),
  detailFreshness: z.literal("unknown"),
});

const resolveOutputSchema = z.object({
  ok: z.boolean(),
  runtime: z.literal(FIXTURE_RUNTIME),
  warning: z.string(),
  operation: z.literal("resolve_project_entities"),
  status: z.enum(["unique", "candidates", "no_match", "overflow", "error"]),
  projectId: z.string().nullable(),
  candidateCount: z.number().int().nonnegative(),
  candidates: z.array(candidateSchema).max(3),
  overflowReason: z
    .enum(["too_many", "mixed_types", "ambiguous_normalized"])
    .nullable(),
  error: errorSchema,
});

const factScalarSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
const verificationSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.enum(["live_read", "fixture_read"]),
    verifiedAt: z.string(),
  }),
  z.object({
    method: z.literal("revision_check"),
    verifiedAt: z.string(),
    verifiedRevision: z.string(),
  }),
]);
const readOutputSchema = z.object({
  ok: z.boolean(),
  runtime: z.literal(FIXTURE_RUNTIME),
  warning: z.string(),
  operation: z.literal("read_project_entity"),
  status: z.enum(["detail", "error"]),
  projectId: z.string().nullable(),
  entity: z
    .object({
      entityId: z.string(),
      entityType: z.string(),
      label: z.string(),
      summary: z.string(),
      entityRevision: z.string(),
      observedAt: z.string(),
      freshness: z.enum(["current", "stale", "partial"]),
      facts: z.record(z.string(), z.union([factScalarSchema, z.array(factScalarSchema)])),
      relations: z.array(z.string()),
      sources: z.array(
        z.object({ sourceType: z.string(), sourceId: z.string() }),
      ),
    })
    .nullable(),
  verification: verificationSchema.nullable(),
  error: errorSchema,
});

const resolveInputSchema = z
  .object({
    selection: z
      .string()
      .min(1)
      .max(512)
      .describe("Selected Chat Lane text to resolve within the pinned fixture project."),
  })
  .strict();

const readInputSchema = z
  .object({
    entity_ref: z
      .string()
      .min(1)
      .max(128)
      .describe("Opaque reference returned by resolve_project_entities."),
  })
  .strict();

function exactArguments(
  args: Record<string, unknown>,
  expectedKey: string,
): boolean {
  const keys = Object.keys(args);
  return keys.length === 1 && keys[0] === expectedKey;
}

function callToolResult(
  reply: ToolReply<ResolveStructuredContent | ReadStructuredContent>,
): CallToolResult {
  return {
    content: [{ type: "text", text: reply.text }],
    structuredContent: { ...reply.structuredContent },
    isError: reply.isError,
  };
}

export function createFixtureProbeMcpServer(
  service: FixtureProjectEntityToolService,
): McpServer {
  const server = new McpServer(
    { name: "pointable-context-fixture-probe", version: "0.1.0" },
    {
      instructions: [
        FIXTURE_WARNING,
        "This server is a headless development probe, not a production Codex project binding.",
        "Call resolve_project_entities first. Pass only its opaque entity_ref to read_project_entity.",
        "Never invent or pass authority locators, provider ids, project ids, or workspace roots.",
      ].join(" "),
    },
  );

  server.registerTool(
    "resolve_project_entities",
    {
      description:
        "Resolve selected text against the explicitly pinned local fixture index. Returns opaque entity_ref capabilities and never prefetches entity detail.",
      inputSchema: resolveInputSchema,
      outputSchema: resolveOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args, ctx) => {
      if (!exactArguments(args, "selection") || args.selection.length === 0) {
        return callToolResult(
          resolveFailure(
            "invalid_arguments",
            "只接受一个非空 selection 字段；项目路径与 ID 由 fixture 进程显式固定。",
          ),
        );
      }
      return callToolResult(
        await service.resolveProjectEntities(args.selection, ctx.mcpReq.signal),
      );
    },
  );

  server.registerTool(
    "read_project_entity",
    {
      description:
        "Read one entity via an opaque entity_ref previously returned by resolve_project_entities. The authority locator is re-derived server-side from the fresh fixture index and cannot be supplied by the caller.",
      inputSchema: readInputSchema,
      outputSchema: readOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args, ctx) => {
      if (!exactArguments(args, "entity_ref") || args.entity_ref.length === 0) {
        return callToolResult(
          readFailure(
            "invalid_arguments",
            "只接受 resolve_project_entities 返回的非空 entity_ref；不接受 locator、provider、projectId 或路径覆盖。",
          ),
        );
      }
      return callToolResult(
        await service.readProjectEntity(args.entity_ref, ctx.mcpReq.signal),
      );
    },
  );

  return server;
}

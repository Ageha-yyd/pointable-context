import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type {
  AuthoritativeProvider,
  AuthorityResult,
  ContextBindingPort,
  ContextIndexPort,
  TrustedContextBinding,
} from "../src/contracts.js";
import {
  FixtureFileProjectBinding,
  JsonAuthoritativeProvider,
  JsonContextIndex,
  fixtureProjectScope,
} from "../src/adapters/json-files.js";
import {
  FIXTURE_RUNTIME,
  FixtureProjectEntityToolService,
} from "../src/mcp/fixture-tool-service.js";
import { createFixtureProbeMcpServer } from "../src/mcp/server.js";

const fixture = resolve("fixtures/mini-project");

class CountingProvider implements AuthoritativeProvider {
  readonly providerId = "json-fixture";
  calls = 0;
  readonly locators: string[] = [];
  readonly signals: AbortSignal[] = [];

  constructor(
    readonly inner = new JsonAuthoritativeProvider(
      resolve(fixture, "details.json"),
    ),
  ) {}

  getDetail(request: Parameters<AuthoritativeProvider["getDetail"]>[0]) {
    this.calls += 1;
    this.locators.push(request.authorityLocator);
    if (request.signal) this.signals.push(request.signal);
    return this.inner.getDetail(request);
  }
}

function fixtureService(
  provider: AuthoritativeProvider,
  options: {
    clock?: () => number;
    referenceTtlMs?: number;
    maxReferences?: number;
    operationTimeoutMs?: number;
  } = {},
  root = fixture,
): FixtureProjectEntityToolService {
  return new FixtureProjectEntityToolService(
    {
      workspaceRoot: root,
      projectId: "PRJ-01",
      binding: new FixtureFileProjectBinding(
        resolve(root, "project-context.json"),
        root,
      ),
      index: new JsonContextIndex(resolve(root, "index.json")),
      providers: [provider],
    },
    options,
  );
}

function structured(result: { structuredContent?: unknown }): Record<string, unknown> {
  assert.ok(result.structuredContent);
  assert.equal(typeof result.structuredContent, "object");
  return result.structuredContent as Record<string, unknown>;
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0]?.type, "text");
  assert.equal(typeof result.content[0]?.text, "string");
  return result.content[0]!.text!;
}

test("MCP exposes only two headless read tools and resolve never prefetches detail", async () => {
  const provider = new CountingProvider();
  const server = createFixtureProbeMcpServer(fixtureService(provider));
  const client = new Client({ name: "pointable-context-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      ["read_project_entity", "resolve_project_entities"],
    );
    for (const tool of listed.tools) {
      assert.equal(tool.annotations?.readOnlyHint, true);
      assert.equal(tool.annotations?.destructiveHint, false);
      assert.equal(tool.annotations?.idempotentHint, false);
      assert.equal(tool.annotations?.openWorldHint, false);
      assert.equal(tool._meta, undefined);
      assert.equal(tool.icons, undefined);
    }
    const readTool = listed.tools.find((tool) => tool.name === "read_project_entity");
    const resolveTool = listed.tools.find(
      (tool) => tool.name === "resolve_project_entities",
    );
    assert.ok(readTool);
    assert.ok(resolveTool);
    assert.deepEqual(Object.keys(readTool.inputSchema.properties ?? {}), ["entity_ref"]);
    assert.deepEqual(readTool.inputSchema.required, ["entity_ref"]);
    assert.equal(readTool.inputSchema.additionalProperties, false);
    assert.deepEqual(resolveTool.inputSchema.required, ["selection"]);
    assert.equal(resolveTool.inputSchema.additionalProperties, false);

    const resolved = await client.callTool({
      name: "resolve_project_entities",
      arguments: { selection: "GOV-1" },
    });
    const resolvedContent = structured(resolved);
    assert.equal(resolved.isError, false);
    assert.equal(resolvedContent.runtime, FIXTURE_RUNTIME);
    assert.equal(resolvedContent.status, "unique");
    assert.equal(resolvedContent.projectId, "PRJ-01");
    assert.equal(provider.calls, 0, "resolve must not prefetch provider detail");
    assert.match(text(resolved), /FIXTURE-ONLY/u);
    assert.match(text(resolved), /尚未读取详情/u);

    const candidates = resolvedContent.candidates as Array<Record<string, unknown>>;
    assert.equal(candidates[0]?.projectId, "PRJ-01");
    assert.equal(candidates[0]?.scope, undefined);
    const entityRef = candidates[0]?.entity_ref;
    assert.equal(typeof entityRef, "string");
    assert.match(entityRef as string, /^fixture-entity-ref:[0-9a-f-]{36}$/u);

    const override = await client.callTool({
      name: "read_project_entity",
      arguments: {
        entity_ref: entityRef,
        locator: "decisions/arch-7",
        provider: "attacker",
        projectId: "OTHER",
      },
    });
    assert.equal(override.isError, true);
    assert.match(text(override), /invalid|unrecognized|argument/iu);
    assert.equal(provider.calls, 0);

    const forged = await client.callTool({
      name: "read_project_entity",
      arguments: { entity_ref: "fixture-entity-ref:00000000-0000-4000-8000-000000000000" },
    });
    assert.equal(forged.isError, true);
    assert.equal(
      (structured(forged).error as Record<string, unknown>).code,
      "invalid_entity_ref",
    );
    assert.equal(provider.calls, 0);

    const detail = await client.callTool({
      name: "read_project_entity",
      arguments: { entity_ref: entityRef },
    });
    const detailContent = structured(detail);
    assert.equal(detail.isError, false);
    assert.equal(detailContent.status, "detail");
    assert.equal(detailContent.projectId, "PRJ-01");
    assert.equal(detailContent.scope, undefined);
    assert.equal(provider.calls, 1);
    assert.deepEqual(provider.locators, ["work-units/gov-1"]);
    assert.equal(
      (detailContent.verification as Record<string, unknown>).method,
      "fixture_read",
    );
    const entity = detailContent.entity as Record<string, unknown>;
    assert.equal(entity.entityId, "WU:GOV-1");
    assert.equal((entity.facts as Record<string, unknown>).status, "completed");
    const detailText = text(detail);
    assert.match(detailText, /^Observed at:/mu);
    assert.match(detailText, /^Verification: fixture_read$/mu);
    assert.match(detailText, /^Sources: 1\/1$/mu);
    assert.match(detailText, /^Fact\[status\]: completed$/mu);
    assert.doesNotMatch(detailText, /work-units\/gov-1/u);
    assert.doesNotMatch(JSON.stringify(detailContent), /work-units\/gov-1/u);
  } finally {
    await client.close();
    await server.close();
  }
});

test("entity_ref fails closed when the freshly-read index revision changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-mcp-stale-ref-"));
  await cp(fixture, root, { recursive: true });
  const provider = new CountingProvider(
    new JsonAuthoritativeProvider(resolve(root, "details.json")),
  );
  const service = fixtureService(provider, {}, root);

  try {
    const resolved = await service.resolveProjectEntities("GOV-1");
    const entityRef = resolved.structuredContent.candidates[0]?.entity_ref;
    assert.ok(entityRef);

    const indexPath = resolve(root, "index.json");
    const index = JSON.parse(await readFile(indexPath, "utf8")) as {
      records: Array<{ entity_id: string; index_revision: string }>;
    };
    const gov = index.records.find((record) => record.entity_id === "WU:GOV-1");
    assert.ok(gov);
    gov.index_revision = "idx-43";
    await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

    const read = await service.readProjectEntity(entityRef);
    assert.equal(read.isError, true);
    assert.equal(read.structuredContent.error?.code, "stale_entity_ref");
    assert.equal(provider.calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("entity_ref rejects authority locator drift without calling a provider", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-mcp-authority-drift-"));
  await cp(fixture, root, { recursive: true });
  const provider = new CountingProvider(
    new JsonAuthoritativeProvider(resolve(root, "details.json")),
  );
  const service = fixtureService(provider, {}, root);

  try {
    const resolved = await service.resolveProjectEntities("GOV-1");
    const entityRef = resolved.structuredContent.candidates[0]?.entity_ref;
    assert.ok(entityRef);

    const indexPath = resolve(root, "index.json");
    const index = JSON.parse(await readFile(indexPath, "utf8")) as {
      records: Array<{
        entity_id: string;
        index_revision: string;
        authority_ref: { provider: string; locator: string };
      }>;
    };
    const gov = index.records.find((record) => record.entity_id === "WU:GOV-1");
    assert.ok(gov);
    const unchangedRevision = gov.index_revision;
    gov.authority_ref.locator = "work-units/attacker-controlled";
    assert.equal(gov.index_revision, unchangedRevision);
    await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

    const read = await service.readProjectEntity(entityRef);
    assert.equal(read.isError, true);
    assert.equal(read.structuredContent.error?.code, "stale_entity_ref");
    assert.equal(provider.calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("entity_ref fails closed when any trusted binding field changes", async () => {
  const root = await realpath(fixture);
  const initialBinding = staticBinding(root);
  let routeChanged = false;
  const binding: ContextBindingPort = {
    async resolve() {
      return initialBinding;
    },
    async revalidate() {
      return routeChanged
        ? { ...initialBinding, routeRef: "route-b" }
        : initialBinding;
    },
  };
  const provider = new CountingProvider();
  const service = new FixtureProjectEntityToolService({
    workspaceRoot: root,
    projectId: "PRJ-01",
    binding,
    index: new JsonContextIndex(resolve(root, "index.json")),
    providers: [provider],
  });

  const resolved = await service.resolveProjectEntities("GOV-1");
  const entityRef = resolved.structuredContent.candidates[0]?.entity_ref;
  assert.ok(entityRef);
  routeChanged = true;

  const read = await service.readProjectEntity(entityRef);
  assert.equal(read.isError, true);
  assert.equal(read.structuredContent.error?.code, "project_context_changed");
  assert.equal(provider.calls, 0);
});

test("entity_ref is bound to the complete scope tuple", async () => {
  const root = await realpath(fixture);
  const scopeDrifts = [
    { kind: "thread" as const, namespace: "fixture-json-v1", id: "PRJ-01" },
    { kind: "project" as const, namespace: "other-fixture", id: "PRJ-01" },
    { kind: "project" as const, namespace: "fixture-json-v1", id: "PRJ-02" },
  ];

  for (const driftedScope of scopeDrifts) {
    const initialBinding = staticBinding(root);
    let drifted = false;
    const binding: ContextBindingPort = {
      async resolve() {
        return initialBinding;
      },
      async revalidate() {
        return drifted ? { ...initialBinding, scope: driftedScope } : initialBinding;
      },
    };
    const provider = new CountingProvider();
    const service = new FixtureProjectEntityToolService({
      workspaceRoot: root,
      projectId: "PRJ-01",
      binding,
      index: new JsonContextIndex(resolve(root, "index.json")),
      providers: [provider],
    });

    const resolved = await service.resolveProjectEntities("GOV-1");
    const entityRef = resolved.structuredContent.candidates[0]?.entity_ref;
    assert.ok(entityRef);
    drifted = true;
    const read = await service.readProjectEntity(entityRef);
    assert.equal(read.isError, true);
    assert.equal(read.structuredContent.error?.code, "project_context_changed");
    assert.equal(provider.calls, 0);
  }
});

test("entity_ref capacity and TTL are fail-closed and testable", async () => {
  let now = Date.now();
  const provider = new CountingProvider();
  const service = fixtureService(provider, {
    clock: () => now,
    maxReferences: 1,
    referenceTtlMs: 10,
  });

  const first = await service.resolveProjectEntities("GOV-1");
  assert.equal(first.isError, false);
  const full = await service.resolveProjectEntities("GOV-1");
  assert.equal(full.isError, true);
  assert.equal(full.structuredContent.error?.code, "reference_capacity");

  now += 10;
  const afterExpiry = await service.resolveProjectEntities("GOV-1");
  assert.equal(afterExpiry.isError, false);
  assert.notEqual(
    afterExpiry.structuredContent.candidates[0]?.entity_ref,
    first.structuredContent.candidates[0]?.entity_ref,
  );
});

function staticBinding(root: string): TrustedContextBinding {
  return {
    kind: "trusted",
    scope: fixtureProjectScope("PRJ-01"),
    bindingRevision: "binding-test",
    evidence: "fixture_manifest",
    selectionGeneration: 0,
    workspaceRoot: root,
  };
}

test("fixture service pins a binding before comparing its scope", async () => {
  const root = await realpath(fixture);
  let scopeReads = 0;
  let indexCalls = 0;
  const adversarialBinding = {
    kind: "trusted" as const,
    get scope() {
      scopeReads += 1;
      return fixtureProjectScope(scopeReads === 1 ? "PRJ-01" : "PRJ-02");
    },
    bindingRevision: "binding-getter-test",
    evidence: "fixture_manifest" as const,
    selectionGeneration: 0,
    workspaceRoot: root,
  } as TrustedContextBinding;
  const binding: ContextBindingPort = {
    async resolve() {
      return adversarialBinding;
    },
    async revalidate() {
      return {
        kind: "trusted",
        scope: fixtureProjectScope("PRJ-01"),
        bindingRevision: "binding-getter-test",
        evidence: "fixture_manifest",
        selectionGeneration: 0,
        workspaceRoot: root,
      };
    },
  };
  const index: ContextIndexPort = {
    async list() {
      indexCalls += 1;
      return [];
    },
  };
  const service = new FixtureProjectEntityToolService({
    workspaceRoot: root,
    projectId: "PRJ-01",
    binding,
    index,
    providers: [new CountingProvider()],
  });

  const result = await service.resolveProjectEntities("GOV-1");
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.status, "no_match");
  assert.equal(result.structuredContent.projectId, "PRJ-01");
  assert.equal(scopeReads, 1);
  assert.equal(indexCalls, 1);
});

test("never-settling provider is timed out and receives an aborted operation signal", async () => {
  const root = await realpath(fixture);
  const bindingValue = staticBinding(root);
  const binding: ContextBindingPort = {
    async resolve() {
      return bindingValue;
    },
    async revalidate() {
      return bindingValue;
    },
  };
  const index: ContextIndexPort = {
    async list() {
      return new JsonContextIndex(resolve(root, "index.json")).list(bindingValue);
    },
  };
  let receivedSignal: AbortSignal | undefined;
  const provider: AuthoritativeProvider = {
    providerId: "json-fixture",
    getDetail(request): Promise<AuthorityResult> {
      receivedSignal = request.signal;
      return new Promise<AuthorityResult>(() => undefined);
    },
  };
  const service = new FixtureProjectEntityToolService(
    {
      workspaceRoot: root,
      projectId: "PRJ-01",
      binding,
      index,
      providers: [provider],
    },
    { operationTimeoutMs: 20 },
  );

  const resolved = await service.resolveProjectEntities("GOV-1");
  const entityRef = resolved.structuredContent.candidates[0]?.entity_ref;
  assert.ok(entityRef);
  const startedAt = Date.now();
  const read = await service.readProjectEntity(entityRef);
  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(read.structuredContent.error?.code, "operation_timeout");
  assert.equal(receivedSignal?.aborted, true);
});

test("MCP caller cancellation reaches an in-flight index operation", async () => {
  const root = await realpath(fixture);
  const bindingValue = staticBinding(root);
  let receivedSignal: AbortSignal | undefined;
  let indexStarted!: () => void;
  const started = new Promise<void>((resolveStarted) => {
    indexStarted = resolveStarted;
  });
  const binding: ContextBindingPort = {
    async resolve() {
      return bindingValue;
    },
    async revalidate() {
      return bindingValue;
    },
  };
  const index: ContextIndexPort = {
    list(_binding, signal) {
      receivedSignal = signal;
      indexStarted();
      return new Promise(() => undefined);
    },
  };
  const service = new FixtureProjectEntityToolService(
    {
      workspaceRoot: root,
      projectId: "PRJ-01",
      binding,
      index,
      providers: [],
    },
    { operationTimeoutMs: 30_000 },
  );
  const server = createFixtureProbeMcpServer(service);
  const client = new Client({ name: "pointable-context-abort-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const controller = new AbortController();
    const request = client.callTool(
      {
        name: "resolve_project_entities",
        arguments: { selection: "GOV-1" },
      },
      { signal: controller.signal, timeout: 2_000 },
    );
    await started;
    controller.abort();
    await assert.rejects(request, /abort/iu);
    await new Promise<void>((resolveTick) => setImmediate(resolveTick));
    assert.equal(receivedSignal?.aborted, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("pre-aborted resolve and read report request_aborted without authority access", async () => {
  const provider = new CountingProvider();
  const service = fixtureService(provider);
  const aborted = new AbortController();
  aborted.abort();

  const rejectedResolve = await service.resolveProjectEntities(
    "GOV-1",
    aborted.signal,
  );
  assert.equal(rejectedResolve.isError, true);
  assert.equal(rejectedResolve.structuredContent.error?.code, "request_aborted");
  assert.equal(provider.calls, 0);

  const resolved = await service.resolveProjectEntities("GOV-1");
  const entityRef = resolved.structuredContent.candidates[0]?.entity_ref;
  assert.ok(entityRef);
  const rejectedRead = await service.readProjectEntity(entityRef, aborted.signal);
  assert.equal(rejectedRead.isError, true);
  assert.equal(rejectedRead.structuredContent.error?.code, "request_aborted");
  assert.equal(provider.calls, 0);
});

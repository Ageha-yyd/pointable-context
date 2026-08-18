import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { fixtureProjectScope } from "../src/adapters/json-files.js";
import type { PointableLookupCallbackRequest } from "../src/host/codex-cdp/adapter.js";
import {
  createFixtureLookupCallback,
  type FixtureLookupCallbackOptions,
} from "../src/host/codex-cdp/fixture-lookup.js";
import { validatePointableLookupPresentation } from "../src/host/codex-cdp/protocol.js";

const fixtureRoot = resolve("fixtures/mini-project");

function options(
  overrides: Partial<FixtureLookupCallbackOptions> = {},
): FixtureLookupCallbackOptions {
  return {
    workspaceRoot: fixtureRoot,
    manifestPath: resolve(fixtureRoot, "project-context.json"),
    indexPath: resolve(fixtureRoot, "index.json"),
    detailsPath: resolve(fixtureRoot, "details.json"),
    explicitScope: fixtureProjectScope("PRJ-01"),
    ...overrides,
  };
}

interface RequestOverrides {
  operation?: PointableLookupCallbackRequest["operation"];
  requestId?: string;
  generation?: number;
  surface?: PointableLookupCallbackRequest["selection"]["surface"];
  contextFingerprint?: string;
  targetId?: string;
  bindingGeneration?: string;
  candidateRef?: string;
}

function request(
  text: string,
  overrides: RequestOverrides = {},
): PointableLookupCallbackRequest {
  const candidateRef = overrides.candidateRef;
  return {
    operation: overrides.operation ?? "resolve",
    requestId: overrides.requestId ?? "request-fixture-0001",
    selection: {
      text,
      digest: createHash("sha256").update(text, "utf8").digest("hex"),
      generation: overrides.generation ?? 7,
      surface: overrides.surface ?? "assistant_message",
    },
    contextFingerprint: overrides.contextFingerprint ??
      '{"href":"app://-/index.html","threadId":"thread-fixture-1"}',
    requestedAt: "2026-08-17T08:20:00.000Z",
    ...(candidateRef === undefined ? {} : { candidateRef }),
    host: {
      targetId: overrides.targetId ?? "main-fixture-1",
      targetUrl: "app://-/index.html",
      bindingGeneration: overrides.bindingGeneration ??
        "binding-generation-fixture-1",
    },
    signal: new AbortController().signal,
  };
}

async function lookup(
  callback: ReturnType<typeof createFixtureLookupCallback>,
  lookupRequest: PointableLookupCallbackRequest,
) {
  return validatePointableLookupPresentation(await callback(lookupRequest));
}

test("fixture lookup resolves unique ARCH-7 directly with bounded authority fields", async () => {
  const result = await lookup(createFixtureLookupCallback(options()), request("ARCH-7"));

  assert.equal(result.kind, "detail");
  if (result.kind !== "detail") return;
  assert.equal(result.detail.entityId, "DEC:ARCH-7");
  assert.equal(result.detail.entityType, "decision");
  assert.equal(result.detail.label, "Selection Query Boundary");
  assert.equal(result.detail.revision, "r5");
  assert.equal(result.detail.freshness, "stale");
  assert.ok(result.detail.facts.length <= 5);
  assert.ok(result.detail.sources.length <= 5);
  assert.deepEqual(result.detail.sources, [{ label: "decision_log / arch-7" }]);
});

test("ambiguous harness returns opaque references and a bound choice resolves detail once", async () => {
  const callback = createFixtureLookupCallback(options());
  const resolved = await lookup(callback, request("harness"));

  assert.equal(resolved.kind, "candidates");
  if (resolved.kind !== "candidates") return;
  assert.equal(resolved.candidates.length, 2);
  for (const candidate of resolved.candidates) {
    assert.match(candidate.candidateRef, /^pcand:[A-Za-z0-9_-]{43}$/u);
    assert.equal(candidate.candidateRef.includes("GOV-1"), false);
    assert.equal(candidate.candidateRef.includes("DEV-54A"), false);
  }
  assert.equal(
    new Set(resolved.candidates.map((candidate) => candidate.candidateRef)).size,
    2,
  );

  const selected = resolved.candidates.find(
    (candidate) => candidate.label === "AEN Harness Foundation",
  );
  assert.ok(selected);
  const chosenRequest = request("harness", {
    operation: "choose",
    requestId: "request-fixture-choose-1",
    candidateRef: selected.candidateRef,
  });
  const chosen = await lookup(callback, chosenRequest);
  assert.equal(chosen.kind, "detail");
  if (chosen.kind === "detail") {
    assert.equal(chosen.detail.entityId, "WU:GOV-1");
    assert.equal(chosen.detail.revision, "r18");
    assert.equal(chosen.detail.freshness, "stale");
  }

  const replay = await lookup(callback, {
    ...chosenRequest,
    requestId: "request-fixture-replay-1",
  });
  assert.deepEqual(replay, {
    kind: "error",
    code: "candidate_ref_invalid",
    message: "候选引用无效或已过期，请重新查询。",
    retryable: true,
  });
});

test("candidate references reject cross-context and cross-host choices without disclosing grants", async () => {
  const callback = createFixtureLookupCallback(options());
  const resolved = await lookup(callback, request("harness"));
  assert.equal(resolved.kind, "candidates");
  if (resolved.kind !== "candidates") return;
  const candidateRef = resolved.candidates[0]?.candidateRef;
  assert.ok(candidateRef);

  for (const mismatch of [
    { contextFingerprint: '{"href":"app://-/index.html","threadId":"other"}' },
    { targetId: "main-fixture-other" },
    { bindingGeneration: "binding-generation-fixture-other" },
    { generation: 8 },
  ]) {
    const rejected = await lookup(callback, request("harness", {
      operation: "choose",
      requestId: `request-mismatch-${Object.keys(mismatch)[0]}`,
      candidateRef,
      ...mismatch,
    }));
    assert.equal(rejected.kind, "error");
    if (rejected.kind === "error") {
      assert.equal(rejected.code, "candidate_ref_invalid");
    }
  }

  const valid = await lookup(callback, request("harness", {
    operation: "choose",
    requestId: "request-fixture-valid-after-mismatch",
    candidateRef,
  }));
  assert.equal(valid.kind, "detail");
});

test("candidate reference TTL and capacity fail closed", async () => {
  let clock = 1_000;
  const expiring = createFixtureLookupCallback(options({
    candidateRefTtlMs: 100,
    clock: () => clock,
  }));
  const resolved = await lookup(expiring, request("harness"));
  assert.equal(resolved.kind, "candidates");
  if (resolved.kind !== "candidates") return;
  const candidateRef = resolved.candidates[0]?.candidateRef;
  assert.ok(candidateRef);
  clock += 100;
  const expired = await lookup(expiring, request("harness", {
    operation: "choose",
    requestId: "request-fixture-expired",
    candidateRef,
  }));
  assert.equal(expired.kind, "error");
  if (expired.kind === "error") {
    assert.equal(expired.code, "candidate_ref_invalid");
  }

  const capacity = await lookup(
    createFixtureLookupCallback(options({ maxCandidateRefs: 1 })),
    request("harness"),
  );
  assert.deepEqual(capacity, {
    kind: "error",
    code: "candidate_ref_capacity",
    message: "候选引用容量已满，请稍后重试。",
    retryable: true,
  });
});

test("fixture host integration has only repository-local runtime imports", async () => {
  for (const path of [
    resolve("src/host/codex-cdp/fixture-lookup.ts"),
    resolve("src/host/codex-cdp/fixture-private-probe.ts"),
  ]) {
    const source = await readFile(path, "utf8");
    const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/gu)]
      .map((match) => match[1]);
    assert.ok(specifiers.length > 0);
    assert.equal(specifiers.some((specifier) => /dcpm|cwa/iu.test(specifier ?? "")), false);
    assert.equal(
      specifiers.every((specifier) =>
        specifier?.startsWith(".") || specifier?.startsWith("node:")),
      true,
    );
  }
});

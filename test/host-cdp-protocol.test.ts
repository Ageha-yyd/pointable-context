import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createPointableLookupResponse,
  parsePointableLookupIntent,
  PointableProtocolError,
  validatePointableLookupPresentation,
  type PointableLookupIntentV1,
} from "../src/host/codex-cdp/protocol.js";

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function intentValue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const selectionText = typeof overrides.selectionText === "string"
    ? overrides.selectionText
    : "GOV-1";
  return {
    schemaVersion: 1,
    kind: "pointable.selection.lookup",
    operation: "resolve",
    requestId: "request-12345678",
    selectionGeneration: 7,
    selectionText,
    selectionDigest: digest(selectionText),
    surface: "assistant_message",
    contextFingerprint: '{"href":"app://-/index.html"}',
    requestedAt: "2026-08-17T08:10:00.000Z",
    ...overrides,
  };
}

function parse(value: Record<string, unknown>): PointableLookupIntentV1 {
  return parsePointableLookupIntent(JSON.stringify(value));
}

test("binding intent accepts an exact, digest-bound resolve request", () => {
  const result = parse(intentValue());
  assert.equal(result.operation, "resolve");
  assert.equal(result.selectionText, "GOV-1");
  assert.equal(result.selectionDigest, digest("GOV-1"));
  assert.equal(result.selectionGeneration, 7);
  assert.equal(result.candidateRef, undefined);
});

test("choose intent requires one bounded candidate reference", () => {
  const result = parse(intentValue({
    operation: "choose",
    candidateRef: "candidate:gov-1",
  }));
  assert.equal(result.operation, "choose");
  assert.equal(result.candidateRef, "candidate:gov-1");

  for (const invalid of [
    intentValue({ operation: "choose" }),
    intentValue({ operation: "resolve", candidateRef: "candidate:gov-1" }),
    intentValue({ operation: "choose", candidateRef: "short" }),
  ]) {
    assert.throws(() => parse(invalid), PointableProtocolError);
  }
});

test("binding intent fails closed for tampering, extra fields, and size overflow", () => {
  assert.throws(
    () => parse(intentValue({ selectionDigest: "0".repeat(64) })),
    (error: unknown) =>
      error instanceof PointableProtocolError &&
      error.code === "selection_digest_mismatch",
  );
  assert.throws(
    () => parse(intentValue({ injected: true })),
    (error: unknown) =>
      error instanceof PointableProtocolError &&
      error.code === "binding_payload_invalid",
  );
  assert.throws(
    () => parsePointableLookupIntent("x".repeat(4_097)),
    (error: unknown) =>
      error instanceof PointableProtocolError &&
      error.code === "binding_payload_invalid",
  );
  const oversizedSelection = "x".repeat(513);
  assert.throws(() => parse(intentValue({
    selectionText: oversizedSelection,
    selectionDigest: digest(oversizedSelection),
  })), PointableProtocolError);
});

test("lookup callback presentations are bounded and copied into a fenced response", () => {
  const presentation = validatePointableLookupPresentation({
    kind: "detail",
    detail: {
      entityId: "WU:GOV-1",
      entityType: "work_unit",
      label: "GOV-1",
      summary: "建立 AEN harness 基础及入口约束",
      revision: "r18",
      observedAt: "2026-08-17T08:10:00.000Z",
      freshness: "stale",
      facts: [
        { label: "状态", value: "completed" },
        { label: "剩余工作", value: "deferred" },
      ],
      sources: [{ label: "query_model / wu_gov_1" }],
    },
  });
  const intent = parse(intentValue());
  assert.deepEqual(createPointableLookupResponse(intent, presentation), {
    schemaVersion: 1,
    kind: "pointable.selection.result",
    requestId: intent.requestId,
    selectionGeneration: 7,
    selectionDigest: intent.selectionDigest,
    contextFingerprint: intent.contextFingerprint,
    presentation,
  });
});

test("candidate and detail result budgets reject ambiguous or oversized output", () => {
  const candidate = {
    candidateRef: "candidate:gov-1",
    label: "GOV-1",
    entityType: "work_unit",
    summary: "summary",
  };
  assert.throws(
    () => validatePointableLookupPresentation({
      kind: "candidates",
      candidates: [candidate, candidate],
    }),
    /must be unique/u,
  );
  assert.throws(
    () => validatePointableLookupPresentation({
      kind: "candidates",
      candidates: [{ ...candidate, candidateRef: "short" }],
    }),
    /candidateRef/u,
  );
  assert.throws(
    () => validatePointableLookupPresentation({
      kind: "detail",
      detail: {
        entityId: "WU:GOV-1",
        entityType: "work_unit",
        label: "GOV-1",
        summary: "summary",
        revision: "r18",
        observedAt: "2026-08-17T08:10:00.000Z",
        freshness: "stale",
        facts: Array.from({ length: 6 }, (_, index) => ({
          label: `fact-${index}`,
          value: "value",
        })),
        sources: [],
      },
    }),
    /metadata exceeds/u,
  );
});

import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidateMatch,
  DetailSnapshot,
  LookupOutcome,
} from "../src/contracts.js";
import { renderLookupOutcome } from "../src/text-renderer.js";
import {
  ContractError,
  IdentityMismatchError,
  parseDetailSnapshot,
  validateAuthorityVerification,
  validateIdentityRecordForRuntime,
  validateSnapshotForCandidate,
} from "../src/validation.js";
import { contextScope, PROJECT_SCOPE, snapshot } from "./helpers.js";

const FIXED_NOW = Date.parse("2026-08-17T12:00:00.000Z");
const GOV_EXPECTED = Object.freeze({
  scope: PROJECT_SCOPE,
  entityId: "WU:GOV-1",
  entityType: "work_unit",
});

function wireDetail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project_id: "PRJ-01",
    entity_id: "WU:GOV-1",
    entity_type: "work_unit",
    entity_revision: "r1",
    observed_at: "2026-08-17T11:59:59.000Z",
    freshness: "current",
    facts: { status: "active" },
    relations: [],
    source_refs: [{ source_type: "test", source_id: "one" }],
    ...overrides,
  };
}

function candidate(overrides: Partial<CandidateMatch> = {}): CandidateMatch {
  return {
    scope: PROJECT_SCOPE,
    entityId: "WU:GOV-1",
    entityType: "work_unit",
    label: "GOV-1",
    summary: "Governance foundation",
    matchKind: "exact_id",
    indexRevision: "idx-1",
    indexedAt: "2026-08-17T00:00:00Z",
    detailFreshness: "unknown",
    ...overrides,
  };
}

function detailOutcome(
  detail: DetailSnapshot,
  candidateOverrides: Partial<CandidateMatch> = {},
): LookupOutcome {
  return {
    kind: "detail",
    candidate: candidate(candidateOverrides),
    detail,
    verification: {
      method: "live_read",
      verifiedAt: "2026-08-17T12:00:00.000Z",
    },
    fallbackText: "",
  };
}

test("detail parser rejects nested facts and requires an authority source", () => {
  assert.throws(
    () =>
      parseDetailSnapshot(
        wireDetail({ facts: { nested: { unsafe: true } } }),
        PROJECT_SCOPE,
      ),
    ContractError,
  );
  assert.throws(
    () => parseDetailSnapshot(wireDetail({ source_refs: [] }), PROJECT_SCOPE),
    /at least one source/u,
  );
});

test("runtime context-index identities are fully validated and copied", () => {
  const raw = {
    schemaVersion: "1.0",
    scope: PROJECT_SCOPE,
    entityId: "WU:GOV-1",
    entityType: "work_unit",
    canonicalKey: "GOV-1",
    canonicalName: "Governance foundation",
    aliases: ["foundation"],
    summary: "summary",
    authorityRef: { provider: "stub", locator: "wu/GOV-1" },
    indexRevision: "idx-1",
    indexedAt: "2026-08-17T00:00:00Z",
    deleted: false,
  };
  const parsed = validateIdentityRecordForRuntime(raw);
  assert.deepEqual(parsed, raw);
  assert.notEqual(parsed, raw);
  assert.notEqual(parsed.scope, raw.scope);
  assert.notEqual(parsed.authorityRef, raw.authorityRef);
  assert.notEqual(parsed.aliases, raw.aliases);

  assert.throws(
    () => validateIdentityRecordForRuntime({ ...raw, schemaVersion: "2.0" }),
    /schemaVersion/u,
  );
  assert.throws(
    () => validateIdentityRecordForRuntime({ ...raw, aliases: Array(101).fill("x") }),
    /too many values/u,
  );
  assert.throws(
    () => validateIdentityRecordForRuntime({ ...raw, authorityRef: { provider: "stub" } }),
    /locator/u,
  );
  assert.throws(
    () => validateIdentityRecordForRuntime({ ...raw, indexedAt: "2026-02-31T00:00:00Z" }),
    /valid ISO 8601 timestamp/u,
  );
  assert.throws(
    () => validateIdentityRecordForRuntime({ ...raw, indexedAt: "2999-01-01T00:00:00Z" }),
    /future/u,
  );
  assert.throws(
    () => validateIdentityRecordForRuntime({ ...raw, entityId: "WU:\u200BGOV-1" }),
    /invisible or control/u,
  );
  assert.throws(
    () =>
      validateIdentityRecordForRuntime({
        ...raw,
        aliases: Array(100).fill("😀".repeat(250)),
      }),
    /aggregate UTF-8 bound/u,
  );
});

test("facts are copied into a null-prototype record and reserved keys are rejected", () => {
  const parsed = parseDetailSnapshot(wireDetail(), PROJECT_SCOPE);
  assert.equal(Object.getPrototypeOf(parsed.facts), null);

  for (const dangerous of ["__proto__", "prototype", "constructor"]) {
    const facts = JSON.parse(`{"${dangerous}":"polluted"}`) as unknown;
    assert.throws(
      () => parseDetailSnapshot(wireDetail({ facts }), PROJECT_SCOPE),
      /reserved key/u,
    );
  }
  assert.equal(({} as { polluted?: unknown }).polluted, undefined);
});

test("fact key, scalar, array, field-count, and aggregate bounds are enforced", () => {
  assert.throws(
    () =>
      parseDetailSnapshot(
        wireDetail({ facts: { ["k".repeat(129)]: "x" } }),
        PROJECT_SCOPE,
      ),
    /key bound/u,
  );
  assert.throws(
    () =>
      parseDetailSnapshot(
        wireDetail({ facts: { note: "x".repeat(1_025) } }),
        PROJECT_SCOPE,
      ),
    /fact string bound/u,
  );
  assert.throws(
    () =>
      parseDetailSnapshot(
        wireDetail({ facts: { "sta\u200Btus": "x" } }),
        PROJECT_SCOPE,
      ),
    /invisible or control/u,
  );
  assert.throws(
    () =>
      parseDetailSnapshot(
        wireDetail({ facts: { note: "\uD800" } }),
        PROJECT_SCOPE,
      ),
    /unpaired surrogate/u,
  );
  assert.throws(
    () =>
      parseDetailSnapshot(
        wireDetail({ facts: { values: Array(11).fill("x") } }),
        PROJECT_SCOPE,
      ),
    /too many values/u,
  );
  assert.throws(
    () =>
      parseDetailSnapshot(
        wireDetail({
          facts: Object.fromEntries(
            Array.from({ length: 51 }, (_, index) => [`field-${index}`, "x"]),
          ),
        }),
        PROJECT_SCOPE,
      ),
    /too many fields/u,
  );
  assert.throws(
    () =>
      parseDetailSnapshot(
        wireDetail({
          facts: Object.fromEntries(
            Array.from({ length: 17 }, (_, index) => [`field-${index}`, "x".repeat(1_000)]),
          ),
        }),
        PROJECT_SCOPE,
      ),
    /aggregate text bound/u,
  );
});

test("provider snapshots receive full runtime validation and a safe copy", () => {
  const raw = snapshot("WU:GOV-1", {
    observedAt: "2026-08-17T11:59:59.000Z",
    facts: { status: "active" },
  });
  const parsed = validateSnapshotForCandidate(
    raw,
    GOV_EXPECTED,
    FIXED_NOW,
  );
  assert.notEqual(parsed, raw);
  assert.notEqual(parsed.facts, raw.facts);
  assert.equal(Object.getPrototypeOf(parsed.facts), null);

  assert.throws(
    () =>
      validateSnapshotForCandidate(
        { ...raw, freshness: "fresh-ish" },
        GOV_EXPECTED,
        FIXED_NOW,
      ),
    /freshness/u,
  );
  assert.throws(
    () =>
      validateSnapshotForCandidate(
        { ...raw, sourceRefs: [] },
        GOV_EXPECTED,
        FIXED_NOW,
      ),
    /at least one source/u,
  );
  assert.throws(
    () =>
      validateSnapshotForCandidate(
        { ...raw, facts: { nested: { unsafe: true } } },
        GOV_EXPECTED,
        FIXED_NOW,
      ),
    /bounded scalar/u,
  );
  assert.throws(
    () =>
      validateSnapshotForCandidate(
        { ...raw, entityRevision: "r".repeat(513) },
        GOV_EXPECTED,
        FIXED_NOW,
      ),
    /string bound/u,
  );
  assert.throws(
    () =>
      validateSnapshotForCandidate(
        {
          ...raw,
          relations: Array(100).fill("😀".repeat(250)),
        },
        GOV_EXPECTED,
        FIXED_NOW,
      ),
    /aggregate UTF-8 bound/u,
  );
});

test("provider snapshot identity and future observation are rejected", () => {
  const raw = snapshot("WU:OTHER", {
    observedAt: "2026-08-17T11:59:59.000Z",
  });
  assert.throws(
    () =>
      validateSnapshotForCandidate(
        raw,
        GOV_EXPECTED,
        FIXED_NOW,
      ),
    IdentityMismatchError,
  );
  assert.throws(
    () =>
      validateSnapshotForCandidate(
        { ...raw, entityId: "WU:GOV-1", observedAt: "2026-08-17T12:01:00.000Z" },
        GOV_EXPECTED,
        FIXED_NOW,
      ),
    /future/u,
  );
  assert.throws(
    () =>
      validateSnapshotForCandidate(
        { ...raw, entityId: "WU:GOV-1", observedAt: "2026-08-17 12:00:00" },
        GOV_EXPECTED,
        FIXED_NOW,
      ),
    /ISO 8601 timestamp/u,
  );
  assert.throws(
    () =>
      validateSnapshotForCandidate(
        { ...raw, entityId: "WU:GOV-1", observedAt: "2026-02-31T12:00:00Z" },
        GOV_EXPECTED,
        FIXED_NOW,
      ),
    /valid ISO 8601 timestamp/u,
  );
  assert.throws(
    () =>
      validateSnapshotForCandidate(
        {
          ...raw,
          entityId: "WU:GOV-1",
          sourceRefs: [{ sourceType: "test" }],
        },
        GOV_EXPECTED,
        FIXED_NOW,
      ),
    /sourceId/u,
  );

  for (const mismatchedScope of [
    contextScope("thread", PROJECT_SCOPE.id, PROJECT_SCOPE.namespace),
    contextScope(PROJECT_SCOPE.kind, PROJECT_SCOPE.id, "other-host"),
    contextScope(PROJECT_SCOPE.kind, "PRJ-02", PROJECT_SCOPE.namespace),
  ]) {
    assert.throws(
      () =>
        validateSnapshotForCandidate(
          {
            ...raw,
            scope: mismatchedScope,
            entityId: "WU:GOV-1",
          },
          GOV_EXPECTED,
          FIXED_NOW,
        ),
      IdentityMismatchError,
    );
  }
});

test("verification must be timely and only live authority can claim current", () => {
  const current = validateSnapshotForCandidate(
    snapshot("WU:GOV-1", { observedAt: "2026-08-17T11:59:59.000Z" }),
    GOV_EXPECTED,
    FIXED_NOW,
  );
  assert.deepEqual(
    validateAuthorityVerification(
      { verifiedAt: "2026-08-17T12:00:00.000Z", method: "live_read" },
      current,
      FIXED_NOW - 1_000,
      FIXED_NOW,
    ),
    { verifiedAt: "2026-08-17T12:00:00.000Z", method: "live_read" },
  );
  assert.throws(
    () =>
      validateAuthorityVerification(
        { verifiedAt: "2026-08-17T12:00:00.000Z", method: "fixture_read" },
        current,
        FIXED_NOW - 1_000,
        FIXED_NOW,
      ),
    /cannot establish current/u,
  );
  assert.throws(
    () =>
      validateAuthorityVerification(
        { verifiedAt: "2026-08-17T11:58:00.000Z", method: "revision_check" },
        current,
        FIXED_NOW - 1_000,
        FIXED_NOW,
      ),
    /request window/u,
  );
  assert.throws(
    () =>
      validateAuthorityVerification(
        { verifiedAt: "2026-08-17T12:00:00.000Z", method: "cache_guess" },
        current,
        FIXED_NOW - 1_000,
        FIXED_NOW,
      ),
    /unsupported/u,
  );

  const stale = { ...current, freshness: "stale" as const };
  assert.equal(
    validateAuthorityVerification(
      { verifiedAt: "2026-08-17T12:00:00.000Z", method: "fixture_read" },
      stale,
      FIXED_NOW - 1_000,
      FIXED_NOW,
    ).method,
    "fixture_read",
  );

  const oldCurrent = { ...current, observedAt: "2010-01-01T00:00:00Z" };
  assert.throws(
    () =>
      validateAuthorityVerification(
        { verifiedAt: "2026-08-17T12:00:00.000Z", method: "live_read" },
        oldCurrent,
        FIXED_NOW - 1_000,
        FIXED_NOW,
      ),
    /live-read snapshot is not recent/u,
  );
  assert.throws(
    () =>
      validateAuthorityVerification(
        { verifiedAt: "2026-08-17T12:00:00.000Z", method: "live_read" },
        current,
        FIXED_NOW - 60_000,
        FIXED_NOW,
      ),
    /request took too long/u,
  );

  assert.deepEqual(
    validateAuthorityVerification(
      {
        verifiedAt: "2026-08-17T12:00:00.000Z",
        method: "revision_check",
        verifiedRevision: "r1",
      },
      oldCurrent,
      FIXED_NOW - 1_000,
      FIXED_NOW,
    ),
    {
      verifiedAt: "2026-08-17T12:00:00.000Z",
      method: "revision_check",
      verifiedRevision: "r1",
    },
  );
  assert.throws(
    () =>
      validateAuthorityVerification(
        {
          verifiedAt: "2026-08-17T12:00:00.000Z",
          method: "revision_check",
          verifiedRevision: "r0",
        },
        oldCurrent,
        FIXED_NOW - 1_000,
        FIXED_NOW,
      ),
    /does not match/u,
  );
  assert.throws(
    () =>
      validateAuthorityVerification(
        { verifiedAt: "2026-08-17T12:00:00.000Z", method: "revision_check" },
        oldCurrent,
        FIXED_NOW - 1_000,
        FIXED_NOW,
      ),
    /verifiedRevision/u,
  );
});

test("plain fallback escapes markup and neutralizes metadata line injection", () => {
  const detail = snapshot("WU:GOV-1", {
    entityRevision: "r1\r\nFreshness: forged\u202E",
    observedAt: "2026-08-17T11:59:59.000Z",
    facts: {
      "note\nRevision": "<img src=x onerror=alert(1)>\u0085Sources: forged",
      Freshness: "forged",
      Revision: "forged",
      Sources: "forged",
    },
    sourceRefs: [
      { sourceType: "test\nFreshness: forged", sourceId: "<source>\u2066" },
    ],
  });
  const text = renderLookupOutcome(
    detailOutcome(detail, {
      label: "<script>alert(1)</script>\r\nRevision: forged",
    }),
  );

  assert.match(text, /&lt;script&gt;alert\\\(1\\\)&lt;\/script&gt;/u);
  assert.match(text, /&lt;img src=x onerror=alert\\\(1\\\)&gt;/u);
  assert.match(text, /\(WU:GOV-1\)$/mu);
  assert.match(text, /^Observed at: 2026-08-17T11:59:59\.000Z$/mu);
  assert.equal(text.match(/^Freshness:/gmu)?.length, 1);
  assert.equal(text.match(/^Revision:/gmu)?.length, 1);
  assert.equal(text.match(/^Sources:/gmu)?.length, 1);
  assert.match(text, /^Fact\[Freshness\]: forged$/mu);
  assert.match(text, /^Fact\[Revision\]: forged$/mu);
  assert.match(text, /^Fact\[Sources\]: forged$/mu);
  assert.doesNotMatch(text, /[\r\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u206F]/u);
});

test("Markdown links, images, autolinks, and default-ignorables stay inert", () => {
  const text = renderLookupOutcome(
    detailOutcome(
      snapshot("WU:GOV-1", {
        facts: {
          markdown:
            "![track](https://evil.invalid/pixel) [click](https://evil.invalid) www.evil.invalid user@example.invalid\u200B",
        },
        sourceRefs: [
          {
            sourceType: "repo, fake:one, trusted:two",
            sourceId: "[source](https://evil.invalid)",
          },
        ],
      }),
    ),
  );
  assert.doesNotMatch(text, /(?<!\\)!\[/u);
  assert.doesNotMatch(text, /(?<!\\)\[[^\n]+\]\(/u);
  assert.doesNotMatch(text, /\b(?:https?|ftp):\/\//u);
  assert.doesNotMatch(text, /\bwww\./u);
  assert.doesNotMatch(text, /(?<!\\)@/u);
  assert.doesNotMatch(text, /\u200B/u);
  assert.match(text, /⟦U\+200B⟧/u);
  assert.equal(text.match(/^Source \d+ type:/gmu)?.length, 1);
  assert.equal(text.match(/^Source \d+ id:/gmu)?.length, 1);
});

test("renderer exposes invisible distinctions instead of collapsing labels", () => {
  const text = renderLookupOutcome(
    detailOutcome(
      snapshot("WU:GOV-1", {
        facts: { status: "one", "sta\u200Btus": "two" },
      }),
    ),
  );
  assert.match(text, /^Fact\[status\]: one$/mu);
  assert.match(text, /^Fact\[sta⟦U\+200B⟧tus\]: two$/mu);
});

test("detail metadata precedes facts and facts render in deterministic key order", () => {
  const text = renderLookupOutcome(
    detailOutcome(
      snapshot("WU:GOV-1", {
        facts: { zeta: "last", alpha: "first", middle: "middle" },
      }),
    ),
  );
  assert.ok(text.indexOf("Sources:") < text.indexOf("Fact[alpha]:"));
  assert.match(text, /^Verification: live_read$/mu);
  assert.match(text, /^Verified at: 2026-08-17T12:00:00.000Z$/mu);
  assert.match(text, /^Facts: 3\/3$/mu);
  assert.ok(text.indexOf("Fact[alpha]:") < text.indexOf("Fact[middle]:"));
  assert.ok(text.indexOf("Fact[middle]:") < text.indexOf("Fact[zeta]:"));
});

test("source projection is bounded without truncating core authority metadata", () => {
  const text = renderLookupOutcome(
    detailOutcome(
      snapshot("WU:GOV-1", {
        sourceRefs: Array.from({ length: 21 }, (_, index) => ({
          sourceType: `source-${index}-${"t".repeat(500)}`,
          sourceId: `id-${index}-${"x".repeat(2_000)}`,
        })),
        facts: Object.fromEntries(
          Array.from({ length: 20 }, (_, index) => [`fact-${index}`, "v".repeat(2_000)]),
        ),
      }),
    ),
  );
  assert.match(text, /^Freshness: current$/mu);
  assert.match(text, /^Revision: r1$/mu);
  assert.match(text, /^Observed at:/mu);
  assert.match(text, /^Sources: 5\/21 \(\+16 more\)$/mu);
  assert.match(text, /^Facts: 5\/20 \(\+15 more\)$/mu);
  assert.equal(text.match(/source-/gu)?.length, 5);
  assert.doesNotMatch(text, /输出已截断/u);
});

test("candidate fallback includes summaries and index/detail freshness metadata", () => {
  const text = renderLookupOutcome({
    kind: "candidates",
    candidates: [candidate()],
    fallbackText: "",
  });
  assert.match(text, /摘要: Governance foundation/u);
  assert.match(text, /详情新鲜度: unknown/u);
  assert.match(text, /索引于 2026-08-17T00:00:00Z/u);
  assert.match(text, /索引版本 idx-1/u);
});

test("overflow fallback explains each routing reason", () => {
  const expectations = {
    mixed_types: /不同类型/u,
    ambiguous_normalized: /存在歧义/u,
    too_many: /候选过多/u,
  } as const;
  for (const [reason, pattern] of Object.entries(expectations)) {
    const text = renderLookupOutcome({
      kind: "overflow",
      candidateCount: 8,
      reason: reason as keyof typeof expectations,
      fallbackText: "",
    });
    assert.match(text, pattern);
  }
});

test("fallback output has a hard total bound", () => {
  const text = renderLookupOutcome({
    kind: "candidates",
    candidates: Array.from({ length: 100 }, (_, index) =>
      candidate({
        entityId: `WU:${index}`,
        label: "😀".repeat(2_000),
        summary: "😀".repeat(2_000),
        entityType: "😀".repeat(1_000),
        scope: contextScope(
          "external",
          "😀".repeat(1_000),
          "😀".repeat(1_000),
        ),
        indexRevision: "😀".repeat(1_000),
      }),
    ),
    fallbackText: "",
  });
  assert.ok(Buffer.byteLength(text, "utf8") <= 16_384);
  assert.match(text, /…\[输出已截断\]$/u);
  assert.doesNotMatch(text, /\uFFFD/u);
});

test("candidate rendering projects at most three records before formatting", () => {
  const text = renderLookupOutcome({
    kind: "candidates",
    candidates: Array.from({ length: 100 }, (_, index) =>
      candidate({ label: `candidate-${index}` }),
    ),
    fallbackText: "",
  });
  assert.match(text, /candidate-0/u);
  assert.match(text, /candidate-2/u);
  assert.doesNotMatch(text, /candidate-3/u);
  assert.match(text, /其余 97 个候选未展开/u);
});

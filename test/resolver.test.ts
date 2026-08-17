import assert from "node:assert/strict";
import test from "node:test";
import { resolveSelection } from "../src/resolver.js";
import { contextScope, identity, PROJECT_SCOPE } from "./helpers.js";

test("unique canonical key routes directly", () => {
  const result = resolveSelection(PROJECT_SCOPE, "请查看 GOV-1", [
    identity("WU:GOV-1", "GOV-1"),
  ]);
  assert.equal(result.kind, "unique");
  if (result.kind === "unique") {
    assert.equal(result.candidate.match.matchKind, "exact_id");
  }
});

test("identifier boundary prevents GOV-1 from matching GOV-10", () => {
  assert.deepEqual(
    resolveSelection(PROJECT_SCOPE, "GOV-10", [identity("WU:GOV-1", "GOV-1")]),
    { kind: "no_match" },
  );
});

test("canonical name and scope-local alias are deterministic", () => {
  const record = identity("WU:GOV-1", "GOV-1", {
    canonicalName: "AEN Harness Foundation",
    aliases: ["foundation harness"],
  });
  const byName = resolveSelection(PROJECT_SCOPE, "AEN Harness Foundation", [record]);
  const byAlias = resolveSelection(PROJECT_SCOPE, "foundation harness", [record]);
  assert.equal(byName.kind, "unique");
  assert.equal(byAlias.kind, "unique");
  if (byName.kind === "unique") assert.equal(byName.candidate.match.matchKind, "exact_name");
  if (byAlias.kind === "unique") assert.equal(byAlias.candidate.match.matchKind, "exact_alias");
});

test("NFKC normalized key resolves only in the normalized layer", () => {
  const result = resolveSelection(PROJECT_SCOPE, "ＧＯＶ－１", [
    identity("WU:GOV-1", "GOV-1"),
  ]);
  assert.equal(result.kind, "unique");
  if (result.kind === "unique") {
    assert.equal(result.candidate.match.matchKind, "normalized_exact");
  }
});

test("higher-priority exact ID suppresses lower-priority alias noise", () => {
  const result = resolveSelection(PROJECT_SCOPE, "GOV-1 harness", [
    identity("WU:GOV-1", "GOV-1", { aliases: ["harness"] }),
    identity("WU:DEV-2", "DEV-2", { aliases: ["harness"] }),
  ]);
  assert.equal(result.kind, "unique");
  if (result.kind === "unique") assert.equal(result.candidate.record.entityId, "WU:GOV-1");
});

test("two and three candidates return a compact candidate set", () => {
  const two = resolveSelection(PROJECT_SCOPE, "harness", [
    identity("WU:A", "A-1", { aliases: ["harness"] }),
    identity("WU:B", "B-1", { aliases: ["harness"] }),
  ]);
  assert.equal(two.kind, "candidates");
  if (two.kind === "candidates") assert.equal(two.candidates.length, 2);

  const three = resolveSelection(PROJECT_SCOPE, "harness", [
    identity("WU:A", "A-1", { aliases: ["harness"] }),
    identity("WU:B", "B-1", { aliases: ["harness"] }),
    identity("WU:C", "C-1", { aliases: ["harness"] }),
  ]);
  assert.equal(three.kind, "candidates");
  if (three.kind === "candidates") assert.equal(three.candidates.length, 3);
});

test("more than three candidates returns only a bounded overflow", () => {
  const records = ["A", "B", "C", "D"].map((key) =>
    identity(`WU:${key}`, `${key}-1`, { aliases: ["shared"] }),
  );
  assert.deepEqual(resolveSelection(PROJECT_SCOPE, "shared", records), {
    kind: "overflow",
    candidateCount: 4,
    reason: "too_many",
  });
});

test("mixed entity types never produce an underspecified candidate menu", () => {
  const result = resolveSelection(PROJECT_SCOPE, "shared", [
    identity("WU:A", "A-1", { aliases: ["shared"], entityType: "work_unit" }),
    identity("DOC:A", "D-1", { aliases: ["shared"], entityType: "document" }),
  ]);
  assert.deepEqual(result, {
    kind: "overflow",
    candidateCount: 2,
    reason: "mixed_types",
  });
});

test("multiple normalized matches abstain instead of presenting weak candidates", () => {
  const result = resolveSelection(PROJECT_SCOPE, "ＦＯＯ", [
    identity("WU:A", "A-1", { aliases: ["foo"] }),
    identity("WU:B", "B-1", { aliases: ["foo"] }),
  ]);
  assert.deepEqual(result, {
    kind: "overflow",
    candidateCount: 2,
    reason: "ambiguous_normalized",
  });
});

test("CJK canonical names can appear inside ordinary Chinese text", () => {
  const result = resolveSelection(PROJECT_SCOPE, "请查看基础架构任务的状态", [
    identity("WU:GOV-1", "GOV-1", { canonicalName: "基础架构任务" }),
  ]);
  assert.equal(result.kind, "unique");
  if (result.kind === "unique") {
    assert.equal(result.candidate.match.matchKind, "exact_name");
  }
});

test("records are scoped to the complete trusted scope and deleted records are ignored", () => {
  const result = resolveSelection(PROJECT_SCOPE, "GOV-1", [
    identity("WU:OTHER", "GOV-1", {
      scope: contextScope("project", "PRJ-02"),
    }),
    identity("WU:DELETED", "GOV-1", { deleted: true }),
  ]);
  assert.deepEqual(result, { kind: "no_match" });
});

test("equal local IDs from another scope kind or namespace never collide", () => {
  const sameId = "PRJ-01";
  const records = [
    identity("THREAD:GOV-1", "GOV-1", {
      scope: contextScope("thread", sameId),
    }),
    identity("OTHER:GOV-1", "GOV-1", {
      scope: contextScope("project", sameId, "other-host"),
    }),
  ];

  assert.deepEqual(resolveSelection(PROJECT_SCOPE, "GOV-1", records), {
    kind: "no_match",
  });
});

test("resolver supports every declared context scope kind", () => {
  for (const kind of [
    "thread",
    "workspace",
    "project",
    "collection",
    "external",
  ] as const) {
    const scope = contextScope(kind, `${kind}-01`);
    const result = resolveSelection(scope, "GOV-1", [
      identity(`${kind}:GOV-1`, "GOV-1", { scope }),
    ]);
    assert.equal(result.kind, "unique");
    if (result.kind === "unique") {
      assert.deepEqual(result.candidate.match.scope, scope);
    }
  }
});

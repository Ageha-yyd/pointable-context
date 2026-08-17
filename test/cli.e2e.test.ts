import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const cli = resolve("dist/src/cli.js");
const fixture = resolve("fixtures/mini-project");

function run(args: string[], input: string) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    input,
  });
}

test("eligible command needs no project fixture", () => {
  const result = run([
    "eligible",
    "--stdin",
    "--surface",
    "assistant_message",
    "--json",
  ], "GOV-1");
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output, {
    kind: "eligible",
    surface: "assistant_message",
    selectionGeneration: 1,
    textLength: 5,
  });
  assert.doesNotMatch(result.stdout, /GOV-1/u);
});

test("unique fixture lookup returns verified text fallback", () => {
  const result = run([
    "lookup",
    "--project-dir",
    fixture,
    "--stdin",
  ], "查看 GOV-1");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /AEN Harness Foundation/u);
  assert.match(result.stdout, /Freshness: stale/u);
  assert.match(result.stdout, /^Sources: 1\/1$/mu);
  assert.match(result.stdout, /^Source 1 type: query_model$/mu);
  assert.match(result.stdout, /^Source 1 id: wu_gov_1$/mu);
});

test("ambiguous alias returns candidates without detail snapshot", () => {
  const result = run([
    "lookup",
    "--project-dir",
    fixture,
    "--stdin",
    "--json",
  ], "harness");
  assert.equal(result.status, 4, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.kind, "candidates");
  assert.equal(output.candidates.length, 2);
  assert.ok(
    output.candidates.every(
      (candidate: { projectId: string; scope?: unknown }) =>
        candidate.projectId === "PRJ-01" && candidate.scope === undefined,
    ),
  );
  assert.ok(output.candidates.every((candidate: { detailFreshness: string }) => candidate.detailFreshness === "unknown"));
  assert.equal("detail" in output, false);
});

test("candidate choice reads exactly that candidate", () => {
  const result = run([
    "lookup",
    "--project-dir",
    fixture,
    "--stdin",
    "--choose",
    "WU:DEV-54A",
    "--json",
  ], "harness");
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.kind, "detail");
  assert.equal(output.candidate.projectId, "PRJ-01");
  assert.equal(output.candidate.scope, undefined);
  assert.equal(output.detail.projectId, "PRJ-01");
  assert.equal(output.detail.scope, undefined);
  assert.equal(output.detail.entityId, "WU:DEV-54A");
  assert.equal(output.detail.freshness, "partial");
});

test("no match and overflow use distinct non-zero exit codes", () => {
  const noMatch = run([
    "lookup",
    "--project-dir",
    fixture,
    "--stdin",
    "--json",
  ], "not-a-project-entity");
  assert.equal(noMatch.status, 5, noMatch.stderr);
  assert.equal(JSON.parse(noMatch.stdout).kind, "no_match");

  const overflow = run([
    "lookup",
    "--project-dir",
    fixture,
    "--stdin",
    "--json",
  ], "GOV-1 ARCH-7");
  assert.equal(overflow.status, 6, overflow.stderr);
  assert.equal(JSON.parse(overflow.stdout).kind, "overflow");
});

test("argv selection is rejected unless the caller opts into exposure", () => {
  const rejected = run([
    "eligible",
    "--text",
    "GOV-1",
    "--json",
  ], "");
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /process list/u);

  const allowed = run([
    "eligible",
    "--text",
    "GOV-1",
    "--allow-argv-text",
    "--json",
  ], "");
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.doesNotMatch(allowed.stdout, /GOV-1/u);
});

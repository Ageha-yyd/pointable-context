import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("evaluation assets separate component latency from human efficiency claims", async () => {
  const [protocol, benchmark, baselineText] = await Promise.all([
    readFile(resolve("docs/evaluation-protocol.md"), "utf8"),
    readFile(resolve("scripts/workspace-lookup-benchmark.mjs"), "utf8"),
    readFile(resolve("docs/evaluation-baseline-2026-08-18.json"), "utf8"),
  ]);
  const baseline = JSON.parse(baselineText) as {
    kind?: string;
    targetMet?: boolean;
    modelCalls?: number;
    chatTurnsCreated?: number;
    caveat?: string;
  };

  assert.match(protocol, /Fast component code is not evidence that users understand the project faster/u);
  assert.match(protocol, /same task transcript and project state/u);
  assert.match(protocol, /time_to_verified_fact_ms/u);
  assert.match(protocol, /Score fact units, not clicks or card opens/u);
  assert.match(protocol, /must not be used to claim significance/u);
  assert.match(benchmark, /kind: "technical_latency_only"/u);
  assert.match(benchmark, /This is component latency, not human time_to_verified_fact/u);
  assert.doesNotMatch(benchmark, /turn\/start|ui\/message|sendFollowUpMessage/u);
  assert.equal(baseline.kind, "technical_latency_only");
  assert.equal(baseline.targetMet, true);
  assert.equal(baseline.modelCalls, 0);
  assert.equal(baseline.chatTurnsCreated, 0);
  assert.match(baseline.caveat ?? "", /not human time_to_verified_fact/u);
});

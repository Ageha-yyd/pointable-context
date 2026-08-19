import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("evaluation assets separate component latency and presentation pilot from human efficiency claims", async () => {
  const [protocol, concept, benchmark, baselineText, v2BaselineText, pilotTemplate] = await Promise.all([
    readFile(resolve("docs/evaluation-protocol.md"), "utf8"),
    readFile(resolve("docs/concepts/pilot.md"), "utf8"),
    readFile(resolve("scripts/workspace-lookup-benchmark.mjs"), "utf8"),
    readFile(resolve("docs/evaluation-baseline-2026-08-18.json"), "utf8"),
    readFile(resolve("docs/evaluation-baseline-2026-08-19-revision-v2.json"), "utf8"),
    readFile(resolve("docs/presentation-pilot-log.template.csv"), "utf8"),
  ]);
  const baseline = JSON.parse(baselineText) as {
    kind?: string;
    targetMet?: boolean;
    modelCalls?: number;
    chatTurnsCreated?: number;
    caveat?: string;
  };
  const v2Baseline = JSON.parse(v2BaselineText) as {
    kind?: string;
    workspaceMode?: string;
    revisionContract?: string;
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
  assert.match(protocol, /P-A\/P-B\/P-C/u);
  assert.match(protocol, /preferred P-C and judged P-A and P-B similarly/u);
  assert.match(protocol, /not a usability result, an efficiency effect/u);
  assert.match(protocol, /What can it not prove/u);
  const sourceLine = /docs\/evaluation-protocol\.md:(\d+)/u.exec(concept);
  const evidence = /## 证据\s+>\s*(.+)/u.exec(concept);
  assert.notEqual(sourceLine, null);
  assert.notEqual(evidence, null);
  const declaredEvidence = protocol
    .replace(/\r\n?/gu, "\n")
    .split("\n")[Number(sourceLine?.[1]) - 1]
    ?.replace(/^\s*(?:[-*+>])\s+/u, "")
    .trim();
  assert.equal(declaredEvidence, evidence?.[1]?.trim());
  assert.match(pilotTemplate, /time_to_correct_understanding_ms/u);
  assert.match(pilotTemplate, /meaning_correct,why_now_correct,boundary_correct,flow_correct/u);
  assert.match(benchmark, /kind: "technical_latency_only"/u);
  assert.match(benchmark, /workspaceMode: "git"/u);
  assert.match(benchmark, /revisionContract: "workspace-context-v2"/u);
  assert.match(benchmark, /This is component latency, not human time_to_verified_fact/u);
  assert.doesNotMatch(benchmark, /turn\/start|ui\/message|sendFollowUpMessage/u);
  assert.equal(baseline.kind, "technical_latency_only");
  assert.equal(baseline.targetMet, true);
  assert.equal(baseline.modelCalls, 0);
  assert.equal(baseline.chatTurnsCreated, 0);
  assert.match(baseline.caveat ?? "", /not human time_to_verified_fact/u);
  assert.equal(v2Baseline.kind, "technical_latency_only");
  assert.equal(v2Baseline.workspaceMode, "git");
  assert.equal(v2Baseline.revisionContract, "workspace-context-v2");
  assert.equal(v2Baseline.targetMet, true);
  assert.equal(v2Baseline.modelCalls, 0);
  assert.equal(v2Baseline.chatTurnsCreated, 0);
  assert.match(v2Baseline.caveat ?? "", /not human time_to_verified_fact/u);
});

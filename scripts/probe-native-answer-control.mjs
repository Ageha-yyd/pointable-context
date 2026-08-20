#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { StudyV2NativeTrialHost } from "../dist/src/evaluation/study-v2/native-trial-host.js";
import { loadStudyV2NativeTrialMaterial } from "../dist/src/evaluation/study-v2/native-trial-pack.js";

const repositoryRoot = resolve(process.argv[2] ?? process.cwd());
const assignment = Object.freeze({
  order: 1,
  trialId: "MANUAL-ANSWER-CONTROL",
  scenarioId: "RESUME-1",
  condition: "A",
});
const material = await loadStudyV2NativeTrialMaterial(repositoryRoot, assignment);
const events = [];
const startedAt = performance.now();
const host = new StudyV2NativeTrialHost({
  surfaceMode: "answer_control",
  onEvent(event) {
    events.push({
      eventType: event.eventType,
      monotonicMs: event.monotonicMs,
      ...(event.outcomeCode === undefined ? {} : { outcomeCode: event.outcomeCode }),
    });
  },
});
try {
  await host.start({
    trialId: assignment.trialId,
    scenarioId: assignment.scenarioId,
    condition: assignment.condition,
    history: material.history,
    taskPrompt: material.taskPrompt,
    answers: material.answers,
    entityTerms: material.entityTerms,
    timeoutMs: 300_000,
  });
  await host.activate();
  process.stdout.write(`${JSON.stringify({
    mounted: true,
    surfaceMode: "answer_control",
    expected: "one collapsed Submit answer pill beside the current Chat Lane",
  })}\n`);
  const terminal = await host.waitForTerminal();
  const reason = terminal.eventType === "answer_submitted"
    ? "completed"
    : terminal.eventType === "trial_timed_out" ? "timed_out" : "aborted";
  await host.stop(reason);
  process.stdout.write(`${JSON.stringify({
    completed: true,
    terminal: terminal.eventType,
    outcomeCode: terminal.outcomeCode ?? null,
    elapsedMs: Math.round(performance.now() - startedAt),
    events,
  })}\n`);
} finally {
  await host.stop().catch(() => undefined);
}

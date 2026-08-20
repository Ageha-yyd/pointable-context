import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  studyV2AssignmentForSlot,
  type StudyV2Event,
  type StudyV2TrialAssignment,
} from "../src/evaluation/study-v2/contracts.js";
import { writeStudyV2NativeSessionResult } from "../src/evaluation/study-v2/native-session-results.js";
import { runStudyV2NativeSession } from "../src/evaluation/study-v2/native-session-runner.js";
import type { StudyV2NativeTrialRunResult } from "../src/evaluation/study-v2/native-trial-runner.js";
import { validateStudyV2Pack } from "../src/evaluation/study-v2/pack.js";
import {
  deriveStudyV2TrialResult,
  STUDY_V2_SCORING_CONTRACT,
} from "../src/evaluation/study-v2/trial-metrics.js";

const repositoryRoot = resolve(".");
const sessionId = "0123456789abcdef0123456789abcdef";

function event(
  trial: StudyV2TrialAssignment,
  sequence: number,
  eventType: StudyV2Event["eventType"],
  monotonicMs: number,
  fields: Pick<StudyV2Event, "objectCode" | "outcomeCode"> = {},
): StudyV2Event {
  return {
    schemaVersion: 2,
    sessionId,
    sequence,
    trialId: trial.trialId,
    scenarioId: trial.scenarioId,
    condition: trial.condition,
    eventType,
    monotonicMs,
    ...(fields.objectCode === undefined ? {} : { objectCode: fields.objectCode }),
    ...(fields.outcomeCode === undefined ? {} : { outcomeCode: fields.outcomeCode }),
  };
}

function run(
  trial: StudyV2TrialAssignment,
  packDigest: string,
): StudyV2NativeTrialRunResult {
  const scoring = STUDY_V2_SCORING_CONTRACT[trial.scenarioId];
  const events = trial.condition === "B"
    ? [
      event(trial, 1, "trial_shown", 0),
      event(trial, 2, "selection_completed", 100, { objectCode: scoring.correctObjectCode }),
      event(trial, 3, "quick_action_shown", 110, { objectCode: scoring.correctObjectCode }),
      event(trial, 4, "card_opened", 120, { objectCode: scoring.correctObjectCode }),
      event(trial, 5, "evidence_expanded", 160, { objectCode: scoring.correctObjectCode }),
      event(trial, 6, "card_closed", 500, { objectCode: scoring.correctObjectCode }),
      event(trial, 7, "answer_submitted", 1_000, { outcomeCode: scoring.correctAnswerCode }),
    ]
    : [
      event(trial, 1, "trial_shown", 0),
      event(trial, 2, "workspace_left", 100),
      event(trial, 3, "object_opened", 200, { objectCode: scoring.correctObjectCode }),
      event(trial, 4, "workspace_returned", 400),
      event(trial, 5, "answer_submitted", 1_000, { outcomeCode: scoring.correctAnswerCode }),
    ];
  return {
    schemaVersion: 2,
    sessionId,
    trial,
    packDigest,
    terminal: "answer_submitted",
    answerCode: scoring.correctAnswerCode,
    elapsedMs: 1_250,
    events,
    taskRetention: "deleted",
  };
}

test("trial metrics derive objective timing and interaction counts from bounded native events", () => {
  const trial = studyV2AssignmentForSlot(1).trials.find((candidate) => candidate.condition === "B");
  assert.ok(trial);
  const result = deriveStudyV2TrialResult(trial, run(trial, "a".repeat(64)).events);
  assert.equal(result.success, true);
  assert.equal(result.taskCompletionMs, 1_000);
  assert.equal(result.timeToFirstCorrectObjectMs, 120);
  assert.equal(result.cardOpenCount, 1);
  assert.equal(result.cardDwellMs, 380);
  assert.equal(result.navigationCount, 0);
  assert.equal(result.patchAttemptCount, 0);
});

test("timeouts and aborts produce an explicit no-answer result instead of a fabricated choice", () => {
  const trial = studyV2AssignmentForSlot(1).trials[0];
  assert.ok(trial);
  for (const terminal of ["trial_timed_out", "trial_aborted"] as const) {
    const result = deriveStudyV2TrialResult(trial, [
      event(trial, 1, "trial_shown", 0),
      event(trial, 2, terminal, 30_000),
    ]);
    assert.equal(result.answerCode, "NO_ANSWER");
    assert.equal(result.success, false);
    assert.equal(result.timedOut, terminal === "trial_timed_out");
    assert.equal(result.aborted, terminal === "trial_aborted");
  }
});

test("six native runs become one atomically written and strictly validated result directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-study-v2-session-"));
  const output = join(root, "result");
  try {
    const pack = await validateStudyV2Pack(repositoryRoot);
    assert.equal(pack.valid, true, JSON.stringify(pack.issues));
    assert.ok(pack.packDigest);
    const assignment = studyV2AssignmentForSlot(1);
    const written = await writeStudyV2NativeSessionResult({
      repositoryRoot,
      resultDirectory: output,
      participantCode: "P001",
      slot: 1,
      language: "en-US" as const,
      sessionId,
      createdAt: "2026-08-20T05:00:00.000Z",
      completedAt: "2026-08-20T05:30:00.000Z",
      codexBuild: "26.814.5517.0",
      runnerVersion: "study-v2.1.0",
      runs: assignment.trials.map((trial) => run(trial, pack.packDigest ?? "")),
      questionnaire: {
        mentalDemand: 4,
        effort: 4,
        frustration: 2,
        confidence: 6,
        informationSufficiency: 6,
      },
    });
    assert.equal(written.validation.valid, true, JSON.stringify(written.validation.issues));
    assert.equal(written.trialCount, 6);
    assert.ok(written.eventCount > 12);
    const eventLines = (await readFile(join(output, "events.ndjson"), "utf8")).trim().split("\n");
    const events = eventLines.map((line) => JSON.parse(line) as StudyV2Event);
    assert.deepEqual(events.map((candidate) => candidate.sequence),
      Array.from({ length: events.length }, (_, index) => index + 1));
    assert.equal(events.filter((candidate) => candidate.monotonicMs === 0).length, 6);
    const trials = await readFile(join(output, "trials.csv"), "utf8");
    assert.match(trials, /,1000,true,false,false,/u);
    assert.doesNotMatch(trials, /D:\\|C:\\|ordinary_chat|raw_selected_text/iu);
    assert.equal(JSON.parse(await readFile(join(output, "manifest.json"), "utf8")).language, "en-US");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("session result writing rejects forged terminal metadata and extra questionnaire fields before publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-study-v2-session-reject-"));
  try {
    const pack = await validateStudyV2Pack(repositoryRoot);
    assert.ok(pack.packDigest);
    const packDigest = pack.packDigest;
    const assignment = studyV2AssignmentForSlot(1);
    const runs = assignment.trials.map((trial) => run(trial, packDigest));
    const base = {
      repositoryRoot,
      participantCode: "P001",
      slot: 1,
      language: "en-US",
      sessionId,
      createdAt: "2026-08-20T05:00:00.000Z",
      completedAt: "2026-08-20T05:30:00.000Z",
      codexBuild: "26.814.5517.0",
      runnerVersion: "study-v2.1.0",
      questionnaire: {
        mentalDemand: 4,
        effort: 4,
        frustration: 2,
        confidence: 6,
        informationSufficiency: 6,
      },
    } as const;
    await assert.rejects(writeStudyV2NativeSessionResult({
      ...base,
      resultDirectory: join(root, "forged-terminal"),
      runs: runs.map((candidate, index) => index === 0
        ? { ...candidate, answerCode: "RESUME-A" }
        : candidate),
    }), /study_v2_native_run_terminal_mismatch/u);
    await assert.rejects(writeStudyV2NativeSessionResult({
      ...base,
      resultDirectory: join(root, "extra-questionnaire"),
      runs,
      questionnaire: { ...base.questionnaire, freeText: "must not be collected" } as never,
    }), /study_v2_questionnaire_invalid/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native session orchestration resumes only completed checkpoints and publishes after all six trials", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-study-v2-orchestrator-"));
  const stateDirectory = join(root, "state");
  const resultDirectory = join(root, "result");
  try {
    const pack = await validateStudyV2Pack(repositoryRoot);
    assert.ok(pack.packDigest);
    const packDigest = pack.packDigest;
    const doctor = async () => ({
      schemaVersion: 2 as const,
      studyId: "pointable-context-study-v2" as const,
      ready: true,
      platform: "win32",
      arch: "x64",
      nodeVersion: "25.9.0",
      codexPackageVersion: "26.814.5517.0",
      packDigest,
      gates: {
        windowsX64: true,
        nodeRuntime: true,
        packIntegrity: true,
        codexBuildQualified: true,
        codexLoopbackAvailable: true,
        githubCliAvailable: true,
      },
      issues: [],
      actions: [],
    });
    let firstAttemptCalls = 0;
    const base = {
      repositoryRoot,
      stateDirectory,
      resultDirectory,
      participantCode: "P001",
      slot: 1,
      language: "en-US" as const,
      sessionId,
      runnerVersion: "study-v2.1.0",
    };
    await assert.rejects(runStudyV2NativeSession(base, {
      doctor,
      now: () => new Date("2026-08-20T05:00:00.000Z"),
      runTrial: async (options) => {
        firstAttemptCalls += 1;
        if (firstAttemptCalls === 3) throw new Error("simulated_process_failure");
        return run(options.assignment, packDigest);
      },
      collectQuestionnaire: async () => { throw new Error("questionnaire_must_not_run"); },
    }), /simulated_process_failure/u);
    assert.equal(firstAttemptCalls, 3);
    assert.equal(JSON.parse(await readFile(join(stateDirectory, "run-02.json"), "utf8")).order, 2);
    await assert.rejects(runStudyV2NativeSession({ ...base, language: "zh-CN" }, {
      doctor,
      runTrial: async (options) => run(options.assignment, packDigest),
    }), /study_v2_checkpoint_context_mismatch/u);

    let resumedCalls = 0;
    const resumedRetention: boolean[] = [];
    const awaiting = await runStudyV2NativeSession(base, {
      doctor,
      now: () => new Date("2026-08-20T05:30:00.000Z"),
      runTrial: async (options) => {
        resumedCalls += 1;
        resumedRetention.push(options.retainCompletedTask ?? true);
        return run(options.assignment, packDigest);
      },
    });
    assert.equal("state" in awaiting ? awaiting.state : "completed", "awaiting_questionnaire");
    assert.equal(awaiting.resumedTrialCount, 2);
    assert.equal(awaiting.executedTrialCount, 4);
    assert.equal(resumedCalls, 4);
    assert.deepEqual(resumedRetention, [false, false, false, true]);

    const completed = await runStudyV2NativeSession(base, {
      doctor,
      now: () => new Date("2026-08-20T05:30:00.000Z"),
      runTrial: async (options) => run(options.assignment, packDigest),
      collectQuestionnaire: async () => ({
        mentalDemand: 4,
        effort: 4,
        frustration: 2,
        confidence: 6,
        informationSufficiency: 6,
      }),
    });
    assert.ok("output" in completed);
    assert.equal(completed.resumedTrialCount, 6);
    assert.equal(completed.executedTrialCount, 0);
    assert.equal(completed.output.validation.valid, true);
    assert.equal(JSON.parse(await readFile(join(stateDirectory, "completed.json"), "utf8")).trialCount, 6);
    await assert.rejects(runStudyV2NativeSession(base, {
      doctor,
      runTrial: async (options) => run(options.assignment, packDigest),
      collectQuestionnaire: async () => ({
        mentalDemand: 4,
        effort: 4,
        frustration: 2,
        confidence: 6,
        informationSufficiency: 6,
      }),
    }), /study_v2_session_already_completed/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalization cannot execute missing trials or collect questionnaire data", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-study-v2-finalize-only-"));
  try {
    const pack = await validateStudyV2Pack(repositoryRoot);
    assert.ok(pack.packDigest);
    const packDigest = pack.packDigest;
    let runCalls = 0;
    let questionnaireCalls = 0;
    await assert.rejects(runStudyV2NativeSession({
      repositoryRoot,
      stateDirectory: join(root, "state"),
      resultDirectory: join(root, "result"),
      participantCode: "P001",
      slot: 1,
      language: "en-US",
      sessionId,
      runnerVersion: "study-v2.1.0",
      finalizeOnly: true,
    }, {
      doctor: async () => ({
        schemaVersion: 2,
        studyId: "pointable-context-study-v2",
        ready: true,
        platform: "win32",
        arch: "x64",
        nodeVersion: "25.9.0",
        codexPackageVersion: "26.814.5517.0",
        packDigest,
        gates: {
          windowsX64: true,
          nodeRuntime: true,
          packIntegrity: true,
          codexBuildQualified: true,
          codexLoopbackAvailable: true,
          githubCliAvailable: true,
        },
        issues: [],
        actions: [],
      }),
      runTrial: async (options) => {
        runCalls += 1;
        return run(options.assignment, packDigest);
      },
      collectQuestionnaire: async () => {
        questionnaireCalls += 1;
        return {
          mentalDemand: 4,
          effort: 4,
          frustration: 2,
          confidence: 6,
          informationSufficiency: 6,
        };
      },
    }), /study_v2_session_trials_incomplete/u);
    assert.equal(runCalls, 0);
    assert.equal(questionnaireCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bundled CLI exposes native questionnaire finalization without rating arguments", () => {
  const execution = spawnSync(process.execPath, [
    resolve("dist/src/evaluation/study-v2/cli.js"),
    "finalize-native-session",
    "--repository-root", repositoryRoot,
    "--state-dir", resolve(".tmp-study-state"),
    "--participant-code", "P001",
    "--session-id", sessionId,
    "--slot", "1",
    "--json",
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(execution.status, 64);
  assert.equal(JSON.parse(execution.stderr).code, "native_session_arguments_required");
  assert.match(execution.stderr, /run-native-session/u);
  assert.match(execution.stderr, /finalize-native-session/u);
  assert.doesNotMatch(execution.stderr, /--mental-demand|--information-sufficiency/u);
});

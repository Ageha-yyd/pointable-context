import { randomBytes } from "node:crypto";
import { mkdir, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  STUDY_V2_ID,
  studyV2AssignmentForSlot,
  type StudyV2Event,
  type StudyV2Questionnaire,
  type StudyV2SessionManifest,
  type StudyV2TrialResult,
} from "./contracts.js";
import type { StudyV2NativeTrialRunResult } from "./native-trial-runner.js";
import { parseStudyV2Language, type StudyV2Language } from "./language.js";
import { validateStudyV2Pack } from "./pack.js";
import {
  validateStudyV2ResultDirectory,
  writeStudyV2ResultDirectory,
  type StudyV2ResultValidation,
} from "./results.js";
import { deriveStudyV2TrialResult } from "./trial-metrics.js";

const PARTICIPANT_PATTERN = /^P[0-9]{3}$/u;
const SESSION_PATTERN = /^[a-f0-9]{32}$/u;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,95}$/u;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export interface StudyV2NativeSessionResultOptions {
  repositoryRoot: string;
  resultDirectory: string;
  participantCode: string;
  slot: number;
  language: StudyV2Language;
  sessionId: string;
  createdAt: string;
  completedAt: string;
  codexBuild: string;
  runnerVersion: string;
  runs: readonly StudyV2NativeTrialRunResult[];
  questionnaire: Omit<StudyV2Questionnaire, "schemaVersion" | "sessionId">;
}

export interface StudyV2NativeSessionResultWrite {
  schemaVersion: 2;
  studyId: typeof STUDY_V2_ID;
  resultDirectory: string;
  eventCount: number;
  trialCount: number;
  validation: StudyV2ResultValidation;
}

function rating(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= 7;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function normalizedEvents(
  sessionId: string,
  runs: readonly StudyV2NativeTrialRunResult[],
): readonly StudyV2Event[] {
  const events: StudyV2Event[] = [];
  for (const run of runs) {
    let localSequence = run.events[0]?.sequence ?? 1;
    for (const event of run.events) {
      if (event.sequence !== localSequence) throw new Error("study_v2_native_event_sequence_invalid");
      localSequence += 1;
      events.push(Object.freeze({
        ...event,
        sessionId,
        sequence: events.length + 1,
      }));
    }
  }
  return Object.freeze(events);
}

export async function writeStudyV2NativeSessionResult(
  options: StudyV2NativeSessionResultOptions,
): Promise<StudyV2NativeSessionResultWrite> {
  if (!PARTICIPANT_PATTERN.test(options.participantCode)) {
    throw new Error("study_v2_participant_code_invalid");
  }
  const language = parseStudyV2Language(options.language);
  if (!SESSION_PATTERN.test(options.sessionId)) throw new Error("study_v2_session_id_invalid");
  if (!ISO_PATTERN.test(options.createdAt) || !ISO_PATTERN.test(options.completedAt) ||
    options.completedAt < options.createdAt) {
    throw new Error("study_v2_session_time_invalid");
  }
  if (!VERSION_PATTERN.test(options.codexBuild) || !VERSION_PATTERN.test(options.runnerVersion)) {
    throw new Error("study_v2_environment_version_invalid");
  }
  if (!exactKeys(options.questionnaire, [
    "mentalDemand", "effort", "frustration", "confidence", "informationSufficiency",
  ]) || !Object.values(options.questionnaire).every(rating)) {
    throw new Error("study_v2_questionnaire_invalid");
  }
  const assignment = studyV2AssignmentForSlot(options.slot);
  if (options.runs.length !== assignment.trials.length) {
    throw new Error("study_v2_native_runs_incomplete");
  }
  const pack = await validateStudyV2Pack(resolve(options.repositoryRoot));
  if (!pack.valid || pack.packDigest === undefined) throw new Error("study_v2_pack_invalid");
  for (let index = 0; index < assignment.trials.length; index += 1) {
    const expected = assignment.trials[index];
    const run = options.runs[index];
    if (
      expected === undefined || run === undefined ||
      run.sessionId !== options.sessionId ||
      run.packDigest !== pack.packDigest ||
      JSON.stringify(run.trial) !== JSON.stringify(expected)
    ) {
      throw new Error("study_v2_native_run_assignment_invalid");
    }
  }
  const events = normalizedEvents(options.sessionId, options.runs);
  const trials: readonly StudyV2TrialResult[] = Object.freeze(assignment.trials.map((trial, index) => {
    const run = options.runs[index];
    if (run === undefined) throw new Error("study_v2_native_runs_incomplete");
    const derived = deriveStudyV2TrialResult(
      trial,
      events.filter((event) => event.trialId === trial.trialId),
    );
    const expectedTerminal = derived.timedOut
      ? "trial_timed_out"
      : derived.aborted
        ? "trial_aborted"
        : "answer_submitted";
    if (
      run.terminal !== expectedTerminal ||
      (expectedTerminal === "answer_submitted" && run.answerCode !== derived.answerCode) ||
      (expectedTerminal !== "answer_submitted" && run.answerCode !== undefined)
    ) {
      throw new Error("study_v2_native_run_terminal_mismatch");
    }
    return derived;
  }));
  const manifest: StudyV2SessionManifest = Object.freeze({
    schemaVersion: 2,
    studyId: STUDY_V2_ID,
    sessionId: options.sessionId,
    participantCode: options.participantCode,
    slot: options.slot,
    language,
    packDigest: pack.packDigest,
    createdAt: options.createdAt,
    completedAt: options.completedAt,
    environment: Object.freeze({
      platform: "win32",
      arch: "x64",
      codexBuild: options.codexBuild,
      runnerVersion: options.runnerVersion,
    }),
    trials: assignment.trials,
  });
  const questionnaire: StudyV2Questionnaire = Object.freeze({
    schemaVersion: 2,
    sessionId: options.sessionId,
    ...options.questionnaire,
  });

  const output = resolve(options.resultDirectory);
  if (!isAbsolute(output) || basename(output).length > 128) {
    throw new Error("study_v2_result_directory_invalid");
  }
  const parent = await realpath(dirname(output));
  await stat(parent);
  const staging = join(parent, `.pointable-study-v2-${randomBytes(12).toString("hex")}`);
  await mkdir(staging, { mode: 0o700 });
  try {
    await writeStudyV2ResultDirectory({ directory: staging, manifest, events, trials, questionnaire });
    const validation = await validateStudyV2ResultDirectory(staging);
    if (!validation.valid) {
      throw new Error(`study_v2_result_validation_failed:${validation.issues.map((issue) => issue.code).join(",")}`);
    }
    await rename(staging, output);
    return Object.freeze({
      schemaVersion: 2,
      studyId: STUDY_V2_ID,
      resultDirectory: output,
      eventCount: events.length,
      trialCount: trials.length,
      validation,
    });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

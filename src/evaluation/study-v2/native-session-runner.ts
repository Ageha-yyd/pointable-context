import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  STUDY_V2_ID,
  studyV2AssignmentForSlot,
  type StudyV2Questionnaire,
} from "./contracts.js";
import { runStudyV2Doctor, type StudyV2DoctorResult } from "./doctor.js";
import {
  writeStudyV2NativeSessionResult,
  type StudyV2NativeSessionResultWrite,
} from "./native-session-results.js";
import {
  runStudyV2NativeTrial,
  type StudyV2NativeTrialDependencies,
  type StudyV2NativeTrialRunResult,
} from "./native-trial-runner.js";
import { validateStudyV2Pack } from "./pack.js";
import { parseStudyV2Language, type StudyV2Language } from "./language.js";

interface SessionCheckpoint {
  schemaVersion: 1;
  studyId: typeof STUDY_V2_ID;
  sessionId: string;
  participantCode: string;
  slot: number;
  language: StudyV2Language;
  packDigest: string;
  createdAt: string;
  codexBuild: string;
  runnerVersion: string;
}

interface RunCheckpoint {
  schemaVersion: 1;
  order: number;
  runSha256: string;
  run: StudyV2NativeTrialRunResult;
}

export interface StudyV2NativeSessionRunOptions {
  repositoryRoot: string;
  stateDirectory: string;
  resultDirectory: string;
  participantCode: string;
  slot: number;
  language: StudyV2Language;
  sessionId: string;
  runnerVersion: string;
  endpoint?: string;
  finalizeOnly?: boolean;
}

export interface StudyV2NativeSessionRunnerDependencies {
  doctor?: (repositoryRoot: string) => Promise<StudyV2DoctorResult>;
  runTrial?: typeof runStudyV2NativeTrial;
  trialDependencies?: Omit<StudyV2NativeTrialDependencies, "doctor" | "onTaskReady">;
  onTrialTaskReady?: (context: {
    trial: ReturnType<typeof studyV2AssignmentForSlot>["trials"][number];
    threadId: string;
    title: string;
  }) => void | Promise<void>;
  collectQuestionnaire?: (context: {
    sessionId: string;
    completedTrialCount: 6;
  }) => Promise<Omit<StudyV2Questionnaire, "schemaVersion" | "sessionId">>;
  now?: () => Date;
}

export interface StudyV2NativeSessionRunResult {
  schemaVersion: 2;
  studyId: typeof STUDY_V2_ID;
  resumedTrialCount: number;
  executedTrialCount: number;
  output: StudyV2NativeSessionResultWrite;
}

export interface StudyV2NativeSessionAwaitingQuestionnaire {
  schemaVersion: 2;
  studyId: typeof STUDY_V2_ID;
  state: "awaiting_questionnaire";
  sessionId: string;
  resumedTrialCount: number;
  executedTrialCount: number;
  completedTrialCount: 6;
}

const SESSION_PATTERN = /^[a-f0-9]{32}$/u;
const PARTICIPANT_PATTERN = /^P[0-9]{3}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,95}$/u;
const MAX_CHECKPOINT_BYTES = 2 * 1024 * 1024;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function runDigest(run: unknown): string {
  return createHash("sha256").update(JSON.stringify(run)).digest("hex");
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_CHECKPOINT_BYTES) throw new Error("study_v2_checkpoint_invalid");
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (object(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function requireNewResultDestination(path: string): Promise<void> {
  try {
    await stat(resolve(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("study_v2_result_directory_exists");
}

async function writeJsonExclusive(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomBytes(12).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: "wx", mode: 0o600 });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function parseSessionCheckpoint(raw: unknown): SessionCheckpoint {
  if (
    !object(raw) ||
    !exactKeys(raw, [
      "schemaVersion", "studyId", "sessionId", "participantCode", "slot", "packDigest",
      "language", "createdAt", "codexBuild", "runnerVersion",
    ]) ||
    raw.schemaVersion !== 1 || raw.studyId !== STUDY_V2_ID ||
    typeof raw.sessionId !== "string" || !SESSION_PATTERN.test(raw.sessionId) ||
    typeof raw.participantCode !== "string" || !PARTICIPANT_PATTERN.test(raw.participantCode) ||
    !Number.isSafeInteger(raw.slot) || (raw.slot as number) < 1 || (raw.slot as number) > 12 ||
    (raw.language !== "zh-CN" && raw.language !== "en-US") ||
    typeof raw.packDigest !== "string" || !DIGEST_PATTERN.test(raw.packDigest) ||
    typeof raw.createdAt !== "string" || !Number.isFinite(Date.parse(raw.createdAt)) ||
    typeof raw.codexBuild !== "string" || !VERSION_PATTERN.test(raw.codexBuild) ||
    typeof raw.runnerVersion !== "string" || !VERSION_PATTERN.test(raw.runnerVersion)
  ) throw new Error("study_v2_checkpoint_invalid");
  return raw as unknown as SessionCheckpoint;
}

function parseRunCheckpoint(raw: unknown, order: number): StudyV2NativeTrialRunResult {
  if (
    !object(raw) || !exactKeys(raw, ["schemaVersion", "order", "runSha256", "run"]) ||
    raw.schemaVersion !== 1 || raw.order !== order ||
    typeof raw.runSha256 !== "string" || !DIGEST_PATTERN.test(raw.runSha256) ||
    !object(raw.run) || runDigest(raw.run) !== raw.runSha256
  ) throw new Error("study_v2_run_checkpoint_invalid");
  return raw.run as unknown as StudyV2NativeTrialRunResult;
}

export async function runStudyV2NativeSession(
  options: StudyV2NativeSessionRunOptions,
  dependencies: StudyV2NativeSessionRunnerDependencies,
): Promise<StudyV2NativeSessionRunResult | StudyV2NativeSessionAwaitingQuestionnaire> {
  if (!SESSION_PATTERN.test(options.sessionId) || !PARTICIPANT_PATTERN.test(options.participantCode) ||
    !VERSION_PATTERN.test(options.runnerVersion)) {
    throw new Error("study_v2_session_identity_invalid");
  }
  const language = parseStudyV2Language(options.language);
  const repositoryRoot = resolve(options.repositoryRoot);
  const stateDirectory = resolve(options.stateDirectory);
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  if (await readJson(join(stateDirectory, "completed.json")) !== undefined) {
    throw new Error("study_v2_session_already_completed");
  }
  const pack = await validateStudyV2Pack(repositoryRoot);
  if (!pack.valid || pack.packDigest === undefined) throw new Error("study_v2_pack_invalid");
  const doctor = await (dependencies.doctor ?? runStudyV2Doctor)(repositoryRoot);
  if (!doctor.ready || doctor.codexPackageVersion === undefined) {
    throw new Error(`study_v2_native_environment_not_ready:${doctor.issues.join(",")}`);
  }
  const assignment = studyV2AssignmentForSlot(options.slot);
  const now = dependencies.now ?? (() => new Date());
  const sessionPath = join(stateDirectory, "session.json");
  const existing = await readJson(sessionPath);
  const checkpoint = existing === undefined
    ? Object.freeze({
      schemaVersion: 1 as const,
      studyId: STUDY_V2_ID,
      sessionId: options.sessionId,
      participantCode: options.participantCode,
      slot: options.slot,
      language,
      packDigest: pack.packDigest,
      createdAt: now().toISOString(),
      codexBuild: doctor.codexPackageVersion,
      runnerVersion: options.runnerVersion,
    })
    : parseSessionCheckpoint(existing);
  if (existing === undefined) await writeJsonExclusive(sessionPath, checkpoint);
  if (
    checkpoint.sessionId !== options.sessionId || checkpoint.participantCode !== options.participantCode ||
    checkpoint.slot !== options.slot || checkpoint.packDigest !== pack.packDigest ||
    checkpoint.language !== language ||
    checkpoint.codexBuild !== doctor.codexPackageVersion ||
    checkpoint.runnerVersion !== options.runnerVersion
  ) throw new Error("study_v2_checkpoint_context_mismatch");

  const runs: StudyV2NativeTrialRunResult[] = [];
  let observedGap = false;
  for (let order = 1; order <= 6; order += 1) {
    const raw = await readJson(join(stateDirectory, `run-${String(order).padStart(2, "0")}.json`));
    if (raw === undefined) {
      observedGap = true;
      continue;
    }
    if (observedGap) throw new Error("study_v2_run_checkpoint_gap");
    const run = parseRunCheckpoint(raw, order);
    const expected = assignment.trials[order - 1];
    if (
      expected === undefined || JSON.stringify(run.trial) !== JSON.stringify(expected) ||
      run.sessionId !== options.sessionId || run.packDigest !== pack.packDigest
    ) {
      throw new Error("study_v2_run_checkpoint_assignment_mismatch");
    }
    runs.push(run);
  }
  const resumedTrialCount = runs.length;
  if (options.finalizeOnly === true && runs.length !== assignment.trials.length) {
    throw new Error("study_v2_session_trials_incomplete");
  }
  const runTrial = dependencies.runTrial ?? ((trialOptions) => runStudyV2NativeTrial(trialOptions, {
    ...dependencies.trialDependencies,
    ...(dependencies.doctor === undefined ? {} : { doctor: dependencies.doctor }),
    ...(dependencies.onTrialTaskReady === undefined
      ? {}
      : { onTaskReady: dependencies.onTrialTaskReady }),
  }));
  for (let index = runs.length; index < assignment.trials.length; index += 1) {
    const trial = assignment.trials[index];
    if (trial === undefined) throw new Error("study_v2_assignment_incomplete");
    const run = await runTrial({
      repositoryRoot,
      sessionId: options.sessionId,
      assignment: trial,
      language,
      retainCompletedTask: index === assignment.trials.length - 1,
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    });
    const path = join(stateDirectory, `run-${String(index + 1).padStart(2, "0")}.json`);
    await writeJsonExclusive(path, Object.freeze({
      schemaVersion: 1,
      order: index + 1,
      runSha256: runDigest(run),
      run,
    } satisfies RunCheckpoint));
    runs.push(run);
  }

  if (dependencies.collectQuestionnaire === undefined) {
    return Object.freeze({
      schemaVersion: 2,
      studyId: STUDY_V2_ID,
      state: "awaiting_questionnaire",
      sessionId: options.sessionId,
      resumedTrialCount,
      executedTrialCount: runs.length - resumedTrialCount,
      completedTrialCount: 6,
    });
  }
  await requireNewResultDestination(options.resultDirectory);
  const questionnaire = await dependencies.collectQuestionnaire({
    sessionId: options.sessionId,
    completedTrialCount: 6,
  });
  const output = await writeStudyV2NativeSessionResult({
    repositoryRoot,
    resultDirectory: options.resultDirectory,
    participantCode: options.participantCode,
    slot: options.slot,
    language,
    sessionId: options.sessionId,
    createdAt: checkpoint.createdAt,
    completedAt: now().toISOString(),
    codexBuild: checkpoint.codexBuild,
    runnerVersion: options.runnerVersion,
    runs,
    questionnaire,
  });
  await writeJsonExclusive(join(stateDirectory, "completed.json"), Object.freeze({
    schemaVersion: 1,
    studyId: STUDY_V2_ID,
    sessionId: options.sessionId,
    resultValidation: output.validation.valid,
    eventCount: output.eventCount,
    trialCount: output.trialCount,
  }));
  return Object.freeze({
    schemaVersion: 2,
    studyId: STUDY_V2_ID,
    resumedTrialCount,
    executedTrialCount: runs.length - resumedTrialCount,
    output,
  });
}

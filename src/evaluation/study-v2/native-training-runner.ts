import { performance } from "node:perf_hooks";
import {
  studyV2AssignmentForSlot,
  type StudyV2SurfaceAssignment,
} from "./contracts.js";
import { runStudyV2Doctor, type StudyV2DoctorResult } from "./doctor.js";
import { parseStudyV2Language, type StudyV2Language } from "./language.js";
import {
  startStudyV2ScriptedRuntime,
  type StudyV2ScriptedRuntimeHandle,
} from "./native-scripted-runtime.js";
import { materializeStudyV2ScriptedTrialConversation } from "./native-scripted-trial.js";
import {
  startStudyV2ScriptedTrialSurface,
  type StudyV2ScriptedTrialSurfaceHandle,
} from "./native-scripted-trial-surface.js";
import { loadStudyV2NativeTrialMaterial } from "./native-trial-pack.js";
import { validateStudyV2Pack } from "./pack.js";

export interface StudyV2NativeTrainingOptions {
  repositoryRoot: string;
  participantCode: string;
  slot: number;
  language: StudyV2Language;
  endpoint?: string;
  timeoutMs?: number;
  activationTimeoutMs?: number;
}

export interface StudyV2NativeTrainingResult {
  schemaVersion: 1;
  participantCode: string;
  slot: number;
  language: StudyV2Language;
  scenarioId: "TRAIN-1";
  packDigest: string;
  codexPackageVersion: string;
  nativeCodexSurface: true;
  quietContextReveal: true;
  liveModelInvoked: false;
  terminal: "answer_submitted" | "trial_timed_out" | "trial_aborted";
  trainingCompleted: boolean;
  taskDeleted: true;
}

export interface StudyV2NativeTrainingDependencies {
  doctor?: (repositoryRoot: string) => Promise<StudyV2DoctorResult>;
  startRuntime?: typeof startStudyV2ScriptedRuntime;
  startSurface?: typeof startStudyV2ScriptedTrialSurface;
  onTaskReady?: (context: {
    trial: StudyV2SurfaceAssignment;
    threadId: string;
    title: string;
    purpose: "training";
  }) => void | Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
  monotonicNow?: () => number;
}

function participantCode(value: string): string {
  if (!/^P[0-9]{3}$/u.test(value)) throw new Error("study_v2_participant_code_invalid");
  return value;
}

export async function runStudyV2NativeTraining(
  options: StudyV2NativeTrainingOptions,
  dependencies: StudyV2NativeTrainingDependencies = {},
): Promise<StudyV2NativeTrainingResult> {
  const code = participantCode(options.participantCode);
  studyV2AssignmentForSlot(options.slot);
  const language = parseStudyV2Language(options.language);
  const pack = await validateStudyV2Pack(options.repositoryRoot);
  if (!pack.valid || pack.packDigest === undefined) throw new Error("study_v2_pack_invalid");
  const doctor = await (dependencies.doctor ?? runStudyV2Doctor)(options.repositoryRoot);
  if (!doctor.ready || doctor.codexPackageVersion === undefined) {
    throw new Error(`study_v2_native_environment_not_ready:${doctor.issues.join(",")}`);
  }
  const timeoutMs = options.timeoutMs ?? 300_000;
  const activationTimeoutMs = options.activationTimeoutMs ?? 180_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 900_000) {
    throw new Error("study_v2_native_timeout_invalid");
  }
  if (!Number.isSafeInteger(activationTimeoutMs) || activationTimeoutMs < 10_000 || activationTimeoutMs > 900_000) {
    throw new Error("study_v2_native_activation_timeout_invalid");
  }
  const assignment: StudyV2SurfaceAssignment = Object.freeze({
    order: 0,
    trialId: `TRAIN-${code}`,
    scenarioId: "TRAIN-1",
    condition: "B",
  });
  const material = await loadStudyV2NativeTrialMaterial(options.repositoryRoot, assignment, language);
  const startRuntime = dependencies.startRuntime ?? startStudyV2ScriptedRuntime;
  const startSurface = dependencies.startSurface ?? startStudyV2ScriptedTrialSurface;
  const sleep = dependencies.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
  let runtime: StudyV2ScriptedRuntimeHandle | undefined;
  let surface: StudyV2ScriptedTrialSurfaceHandle | undefined;
  let surfaceStopped = false;
  let taskThreadId: string | undefined;
  let terminal: StudyV2NativeTrainingResult["terminal"] | undefined;
  let primaryError: unknown;
  try {
    runtime = await startRuntime({
      workspaceRoot: material.workspaceRoot,
      model: "gpt-4.1",
      responses: material.conversation.exchanges.map((exchange) => ({ outputText: exchange.assistant })),
      taskActivationTimeoutMs: activationTimeoutMs,
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    });
    const scripted = await materializeStudyV2ScriptedTrialConversation({
      rpc: runtime.rpc,
      repositoryRoot: options.repositoryRoot,
      assignment,
      language,
      model: "gpt-4.1",
      title: language === "zh-CN" ? "Pointable Context 不计分训练" : "Pointable Context unscored training",
    });
    taskThreadId = scripted.task.threadId;
    const publishedTask = await runtime.publishTask(scripted.task);
    taskThreadId = publishedTask.threadId;
    if (runtime.requestCount() !== material.conversation.exchanges.length) {
      throw new Error("study_v2_scripted_provider_request_mismatch");
    }
    await dependencies.onTaskReady?.({
      trial: assignment,
      threadId: taskThreadId,
      title: publishedTask.title,
      purpose: "training",
    });
    const activationStartedAt = monotonicNow();
    while (surface === undefined) {
      try {
        surface = await startSurface({
          assignment,
          material,
          taskThreadId,
          packDigest: pack.packDigest,
          observedAt: new Date().toISOString(),
          timeoutMs,
          ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
        });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "study_v2_native_task_not_active") throw error;
        if (monotonicNow() - activationStartedAt >= activationTimeoutMs) {
          throw new Error("study_v2_native_task_activation_timed_out");
        }
        await sleep(500);
      }
    }
    const event = await surface.waitForTerminal();
    terminal = event.eventType === "answer_submitted" || event.eventType === "trial_timed_out" ||
      event.eventType === "trial_aborted" ? event.eventType : undefined;
    if (terminal === undefined) throw new Error("study_v2_native_terminal_invalid");
    await surface.stop(terminal === "answer_submitted" ? "completed" : terminal === "trial_timed_out" ? "timed_out" : "aborted");
    surfaceStopped = true;
  } catch (error) {
    primaryError = error;
  }
  const cleanupErrors: unknown[] = [];
  if (surface !== undefined && !surfaceStopped) {
    await surface.stop().catch((error: unknown) => cleanupErrors.push(error));
  }
  if (runtime !== undefined && taskThreadId !== undefined) {
    await runtime.rpc.request("thread/delete", { threadId: taskThreadId })
      .catch((error: unknown) => cleanupErrors.push(error));
  }
  if (runtime !== undefined) await runtime.stop().catch((error: unknown) => cleanupErrors.push(error));
  if (primaryError !== undefined) throw primaryError;
  if (cleanupErrors.length > 0) throw new Error("study_v2_training_cleanup_failed");
  if (terminal === undefined) throw new Error("study_v2_training_result_missing");
  return Object.freeze({
    schemaVersion: 1,
    participantCode: code,
    slot: options.slot,
    language,
    scenarioId: "TRAIN-1" as const,
    packDigest: pack.packDigest,
    codexPackageVersion: doctor.codexPackageVersion,
    nativeCodexSurface: true as const,
    quietContextReveal: true as const,
    liveModelInvoked: false as const,
    terminal,
    trainingCompleted: terminal === "answer_submitted",
    taskDeleted: true as const,
  });
}

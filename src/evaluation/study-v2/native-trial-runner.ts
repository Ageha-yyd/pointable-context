import { performance } from "node:perf_hooks";
import type { StudyV2Event, StudyV2TrialAssignment } from "./contracts.js";
import { parseStudyV2Language, type StudyV2Language } from "./language.js";
import { runStudyV2Doctor, type StudyV2DoctorResult } from "./doctor.js";
import { materializeStudyV2ScriptedTrialConversation } from "./native-scripted-trial.js";
import {
  startStudyV2ScriptedRuntime,
  type StudyV2ScriptedRuntimeHandle,
} from "./native-scripted-runtime.js";
import {
  startStudyV2ScriptedTrialSurface,
  type StudyV2ScriptedTrialSurfaceHandle,
} from "./native-scripted-trial-surface.js";
import { validateStudyV2Pack } from "./pack.js";
import { loadStudyV2NativeTrialMaterial } from "./native-trial-pack.js";

export interface StudyV2NativeTrialRunOptions {
  repositoryRoot: string;
  sessionId: string;
  assignment: StudyV2TrialAssignment;
  language?: StudyV2Language;
  endpoint?: string;
  timeoutMs?: number;
  activationTimeoutMs?: number;
  retainCompletedTask?: boolean;
}

export interface StudyV2NativeTrialRunResult {
  schemaVersion: 2;
  sessionId: string;
  trial: StudyV2TrialAssignment;
  packDigest: string;
  terminal: "answer_submitted" | "trial_timed_out" | "trial_aborted";
  answerCode?: string;
  elapsedMs: number;
  events: readonly StudyV2Event[];
  taskRetention: "retained" | "deleted";
  retainedThreadId?: string;
}

export interface StudyV2NativeTrialDependencies {
  doctor?: (repositoryRoot: string) => Promise<StudyV2DoctorResult>;
  startRuntime?: typeof startStudyV2ScriptedRuntime;
  startSurface?: typeof startStudyV2ScriptedTrialSurface;
  onTaskReady?: (context: {
    trial: StudyV2TrialAssignment;
    threadId: string;
    title: string;
  }) => void | Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
  monotonicNow?: () => number;
}

function validSessionId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,64}$/u.test(value);
}

export async function planStudyV2NativeTrial(
  options: Pick<StudyV2NativeTrialRunOptions, "repositoryRoot" | "sessionId" | "assignment" | "language" | "timeoutMs">,
  dependencies: StudyV2NativeTrialDependencies = {},
): Promise<{
  schemaVersion: 2;
  ready: boolean;
  sessionId: string;
  trial: StudyV2TrialAssignment;
  packDigest: string;
  liveModel: false;
  nativeCodexSurface: true;
  quietContextReveal: boolean;
  language: StudyV2Language;
  answerCount: number;
  entityCount: number;
  codexBuildQualified: boolean;
  codexPackageVersion?: string;
  issues: readonly string[];
}> {
  if (!validSessionId(options.sessionId)) throw new Error("study_v2_session_id_invalid");
  const language = parseStudyV2Language(options.language ?? "en-US");
  const pack = await validateStudyV2Pack(options.repositoryRoot);
  if (!pack.valid) throw new Error(`study_v2_pack_invalid:${pack.issues.join(",")}`);
  if (pack.packDigest === undefined) throw new Error("study_v2_pack_digest_missing");
  const material = await loadStudyV2NativeTrialMaterial(options.repositoryRoot, options.assignment, language);
  const doctor = await (dependencies.doctor ?? runStudyV2Doctor)(options.repositoryRoot);
  const timeoutMs = options.timeoutMs ?? 300_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 900_000) {
    throw new Error("study_v2_native_timeout_invalid");
  }
  return Object.freeze({
    schemaVersion: 2,
    ready: doctor.ready,
    sessionId: options.sessionId,
    trial: Object.freeze({ ...options.assignment }),
    packDigest: pack.packDigest,
    liveModel: false,
    nativeCodexSurface: true,
    quietContextReveal: options.assignment.condition === "B",
    language,
    answerCount: material.answers.length,
    entityCount: material.entities.length,
    codexBuildQualified: doctor.gates.codexBuildQualified,
    ...(doctor.codexPackageVersion === undefined ? {} : { codexPackageVersion: doctor.codexPackageVersion }),
    issues: Object.freeze([...doctor.issues]),
  });
}

export async function runStudyV2NativeTrial(
  options: StudyV2NativeTrialRunOptions,
  dependencies: StudyV2NativeTrialDependencies = {},
): Promise<StudyV2NativeTrialRunResult> {
  const plan = await planStudyV2NativeTrial(options, dependencies);
  if (!plan.ready) {
    throw new Error(`study_v2_native_environment_not_ready:${plan.issues.join(",")}`);
  }
  const material = await loadStudyV2NativeTrialMaterial(options.repositoryRoot, options.assignment, plan.language);
  const timeoutMs = options.timeoutMs ?? 300_000;
  const retainCompletedTask = options.retainCompletedTask ?? true;
  const activationTimeoutMs = options.activationTimeoutMs ?? 180_000;
  if (!Number.isSafeInteger(activationTimeoutMs) || activationTimeoutMs < 10_000 || activationTimeoutMs > 900_000) {
    throw new Error("study_v2_native_activation_timeout_invalid");
  }
  const events: StudyV2Event[] = [];
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
  let result: StudyV2NativeTrialRunResult | undefined;
  let primaryError: unknown;
  try {
    runtime = await startRuntime({
      workspaceRoot: material.workspaceRoot,
      model: "gpt-4.1",
      responses: material.conversation.exchanges.map((exchange) => ({ outputText: exchange.assistant })),
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    });
    const scripted = await materializeStudyV2ScriptedTrialConversation({
      rpc: runtime.rpc,
      repositoryRoot: options.repositoryRoot,
      assignment: options.assignment,
      model: "gpt-4.1",
    });
    taskThreadId = scripted.task.threadId;
    const publishedTask = await runtime.publishTask(scripted.task);
    taskThreadId = publishedTask.threadId;
    if (runtime.requestCount() !== material.conversation.exchanges.length) {
      throw new Error("study_v2_scripted_provider_request_mismatch");
    }
    await dependencies.onTaskReady?.({
      trial: Object.freeze({ ...options.assignment }),
      threadId: taskThreadId,
      title: publishedTask.title,
    });
    const activationStartedAt = monotonicNow();
    while (surface === undefined) {
      try {
        surface = await startSurface({
          assignment: options.assignment,
          material,
          taskThreadId,
          packDigest: plan.packDigest,
          observedAt: new Date().toISOString(),
          timeoutMs,
          ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
          onEvent(event) {
            events.push(Object.freeze({
              schemaVersion: 2,
              sessionId: options.sessionId,
              sequence: events.length + 1,
              trialId: options.assignment.trialId,
              scenarioId: options.assignment.scenarioId,
              condition: options.assignment.condition,
              eventType: event.eventType,
              monotonicMs: event.monotonicMs,
              ...(event.objectCode === undefined ? {} : { objectCode: event.objectCode }),
              ...(event.outcomeCode === undefined ? {} : { outcomeCode: event.outcomeCode }),
            }));
          },
        });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "study_v2_native_task_not_active") throw error;
        if (monotonicNow() - activationStartedAt >= activationTimeoutMs) {
          throw new Error("study_v2_native_task_activation_timed_out");
        }
        await sleep(500);
      }
    }
    const terminal = await surface.waitForTerminal();
    const terminalType = terminal.eventType === "answer_submitted" ||
      terminal.eventType === "trial_timed_out" || terminal.eventType === "trial_aborted"
      ? terminal.eventType
      : undefined;
    if (terminalType === undefined) throw new Error("study_v2_native_terminal_invalid");
    const reason = terminalType === "answer_submitted"
      ? "completed"
      : terminalType === "trial_timed_out"
        ? "timed_out"
        : "aborted";
    await surface.stop(reason);
    surfaceStopped = true;
    let retainedThreadId: string | undefined;
    if (terminalType === "answer_submitted" && retainCompletedTask) {
      const retained = await runtime.createRetainedReviewTask(publishedTask);
      taskThreadId = retained.threadId;
      retainedThreadId = retained.threadId;
    }
    const first = events[0];
    const last = events.at(-1);
    if (first?.eventType !== "trial_shown" || last?.eventType !== terminalType ||
      last.monotonicMs !== terminal.monotonicMs || last.outcomeCode !== terminal.outcomeCode) {
      throw new Error("study_v2_native_event_stream_invalid");
    }
    result = Object.freeze({
      schemaVersion: 2,
      sessionId: options.sessionId,
      trial: Object.freeze({ ...options.assignment }),
      packDigest: plan.packDigest,
      terminal: terminalType,
      ...(terminal.outcomeCode === undefined ? {} : { answerCode: terminal.outcomeCode }),
      elapsedMs: terminal.monotonicMs,
      events: Object.freeze(events),
      taskRetention: terminalType === "answer_submitted" && retainCompletedTask ? "retained" : "deleted",
      ...(retainedThreadId === undefined ? {} : { retainedThreadId }),
    });
  } catch (error) {
    primaryError = error;
  }
  const cleanupErrors: unknown[] = [];
  if (surface !== undefined && !surfaceStopped) {
    await surface.stop().catch((error: unknown) => cleanupErrors.push(error));
  }
  const deleteTask = taskThreadId !== undefined && (
    primaryError !== undefined || result?.terminal !== "answer_submitted" || !retainCompletedTask
  );
  if (runtime !== undefined && taskThreadId !== undefined && deleteTask) {
    await runtime.rpc.request("thread/delete", { threadId: taskThreadId })
      .catch((error: unknown) => cleanupErrors.push(error));
  }
  if (runtime !== undefined) {
    await runtime.stop().catch((error: unknown) => cleanupErrors.push(error));
  }
  if (primaryError !== undefined) throw primaryError;
  if (cleanupErrors.length > 0) throw new Error("study_v2_scripted_cleanup_failed");
  if (result === undefined) throw new Error("study_v2_native_result_missing");
  return result;
}

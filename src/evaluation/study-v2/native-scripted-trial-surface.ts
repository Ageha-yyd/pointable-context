import type { StudyV2SurfaceAssignment } from "./contracts.js";
import {
  startStudyV2ConditionCompanion,
  type StudyV2ConditionCompanionHandle,
  type StartStudyV2ConditionCompanionOptions,
} from "./native-condition-companion.js";
import {
  StudyV2NativeTrialHost,
  type StudyV2NativeTrialHostOptions,
} from "./native-trial-host.js";
import type { StudyV2NativeEvent } from "./native-trial-protocol.js";
import type { StudyV2NativeTrialMaterial } from "./native-trial-pack.js";

interface StudyV2AnswerControlHost {
  start(config: Parameters<StudyV2NativeTrialHost["start"]>[0], signal?: AbortSignal): Promise<unknown>;
  activate(): Promise<unknown>;
  waitForTerminal(signal?: AbortSignal): Promise<StudyV2NativeEvent>;
  stop(reason?: "aborted" | "completed" | "timed_out"): Promise<unknown>;
}

export interface StartStudyV2ScriptedTrialSurfaceOptions {
  assignment: StudyV2SurfaceAssignment;
  material: StudyV2NativeTrialMaterial;
  taskThreadId: string;
  packDigest: string;
  observedAt: string;
  endpoint?: string;
  timeoutMs?: number;
  onEvent?: (event: StudyV2NativeEvent) => void | Promise<void>;
}

export interface StudyV2ScriptedTrialSurfaceHandle {
  schemaVersion: 1;
  assignment: StudyV2SurfaceAssignment;
  taskThreadId: string;
  answerControlMounted: true;
  quietContextCompanionMounted: boolean;
  waitForTerminal(signal?: AbortSignal): Promise<StudyV2NativeEvent>;
  stop(reason?: "aborted" | "completed" | "timed_out"): Promise<void>;
}

export interface StudyV2ScriptedTrialSurfaceDependencies {
  createAnswerHost?: (options: StudyV2NativeTrialHostOptions) => StudyV2AnswerControlHost;
  startCompanion?: (
    options: StartStudyV2ConditionCompanionOptions,
  ) => Promise<StudyV2ConditionCompanionHandle>;
}

export async function startStudyV2ScriptedTrialSurface(
  options: StartStudyV2ScriptedTrialSurfaceOptions,
  dependencies: StudyV2ScriptedTrialSurfaceDependencies = {},
): Promise<StudyV2ScriptedTrialSurfaceHandle> {
  if (options.material.assignment.scenarioId !== options.assignment.scenarioId ||
    options.material.assignment.condition !== options.assignment.condition) {
    throw new Error("study_v2_scripted_surface_material_mismatch");
  }
  const timeoutMs = options.timeoutMs ?? 300_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 900_000) {
    throw new Error("study_v2_native_timeout_invalid");
  }
  const createAnswerHost = dependencies.createAnswerHost ?? ((hostOptions) => new StudyV2NativeTrialHost(hostOptions));
  const answerHost = createAnswerHost({
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    surfaceMode: "answer_control",
    expectedThreadId: options.taskThreadId,
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
  });
  let companion: StudyV2ConditionCompanionHandle | undefined;
  let stopped = false;
  try {
    await answerHost.start({
      trialId: options.assignment.trialId,
      scenarioId: options.assignment.scenarioId,
      condition: options.assignment.condition,
      language: options.material.language,
      history: options.material.history,
      taskPrompt: options.material.taskPrompt,
      answers: options.material.answers,
      entityTerms: options.material.entityTerms,
      timeoutMs,
    });
    companion = await (dependencies.startCompanion ?? startStudyV2ConditionCompanion)({
      assignment: options.assignment,
      material: options.material,
      taskThreadId: options.taskThreadId,
      packDigest: options.packDigest,
      observedAt: options.observedAt,
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    });
    await answerHost.activate();
    return Object.freeze({
      schemaVersion: 1 as const,
      assignment: Object.freeze({ ...options.assignment }),
      taskThreadId: options.taskThreadId,
      answerControlMounted: true as const,
      quietContextCompanionMounted: companion.mounted,
      waitForTerminal: async (signal?: AbortSignal) => await answerHost.waitForTerminal(signal),
      stop: async (reason: "aborted" | "completed" | "timed_out" = "aborted"): Promise<void> => {
        if (stopped) return;
        stopped = true;
        await Promise.allSettled([answerHost.stop(reason), companion?.stop() ?? Promise.resolve()]);
      },
    });
  } catch (error) {
    stopped = true;
    await Promise.allSettled([answerHost.stop("aborted"), companion?.stop() ?? Promise.resolve()]);
    throw error;
  }
}

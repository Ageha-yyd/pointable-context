import {
  CodexCdpHostAdapter,
  type CodexCdpHostAdapterOptions,
  type CodexCdpHostAdapterStatus,
  type PointableLookupCallback,
} from "../../host/codex-cdp/adapter.js";
import type { CodexHostTaskContext } from "../../host/codex-cdp/host-context.js";
import type { PointableLookupPresentation } from "../../host/codex-cdp/protocol.js";
import type { StudyV2SurfaceAssignment } from "./contracts.js";
import { createStudyV2NativeLookup } from "./native-trial-lookup.js";
import type { StudyV2NativeTrialMaterial } from "./native-trial-pack.js";

interface StudyV2ConditionAdapter {
  refreshTargets(): Promise<CodexCdpHostAdapterStatus>;
  activeTasks(signal?: AbortSignal): Promise<CodexHostTaskContext[]>;
  stop(): Promise<CodexCdpHostAdapterStatus>;
}

export interface StartStudyV2ConditionCompanionOptions {
  assignment: StudyV2SurfaceAssignment;
  material: StudyV2NativeTrialMaterial;
  taskThreadId: string;
  packDigest: string;
  observedAt: string;
  endpoint?: string;
}

export interface StudyV2ConditionCompanionHandle {
  schemaVersion: 1;
  condition: "A" | "B";
  taskThreadId: string;
  mounted: boolean;
  quietContextReveal: boolean;
  stop(): Promise<void>;
}

export interface StudyV2ConditionCompanionDependencies {
  createAdapter?: (options: CodexCdpHostAdapterOptions) => StudyV2ConditionAdapter;
}

function taskIdentity(value: string): string {
  if (!/^[A-Za-z0-9:_-]{1,256}$/u.test(value)) {
    throw new Error("study_v2_native_task_identity_invalid");
  }
  return value;
}

function digest(value: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error("study_v2_pack_digest_invalid");
  return value;
}

function timestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error("study_v2_observed_at_invalid");
  return value;
}

function taskError(language: "zh-CN" | "en-US"): PointableLookupPresentation {
  return {
    kind: "error",
    code: "study_task_context_changed",
    message: language === "zh-CN"
      ? "当前打开的 Codex 任务不是本试次任务。"
      : "The active Codex task is not the task for this trial.",
    retryable: false,
  };
}

function bindLookupToTask(
  lookup: PointableLookupCallback,
  taskThreadId: string,
  language: "zh-CN" | "en-US",
): PointableLookupCallback {
  return async (request) => {
    if (request.host.task?.threadId !== taskThreadId || request.host.revalidateTask === undefined) {
      return taskError(language);
    }
    const current = await request.host.revalidateTask(request.signal);
    if (current?.threadId !== taskThreadId || current.contextFingerprint !== request.contextFingerprint) {
      return taskError(language);
    }
    return lookup(request);
  };
}

export async function startStudyV2ConditionCompanion(
  options: StartStudyV2ConditionCompanionOptions,
  dependencies: StudyV2ConditionCompanionDependencies = {},
): Promise<StudyV2ConditionCompanionHandle> {
  const taskThreadId = taskIdentity(options.taskThreadId);
  const packDigest = digest(options.packDigest);
  const observedAt = timestamp(options.observedAt);
  if (options.material.assignment.scenarioId !== options.assignment.scenarioId ||
    options.material.assignment.condition !== options.assignment.condition) {
    throw new Error("study_v2_condition_material_mismatch");
  }
  if (options.assignment.condition === "A") {
    return Object.freeze({
      schemaVersion: 1 as const,
      condition: "A" as const,
      taskThreadId,
      mounted: false,
      quietContextReveal: false,
      async stop(): Promise<void> {},
    });
  }

  const baseLookup = createStudyV2NativeLookup(options.material, { revision: packDigest, observedAt });
  const createAdapter = dependencies.createAdapter ?? ((adapterOptions) => new CodexCdpHostAdapter(adapterOptions));
  const adapter = createAdapter({
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    lookup: bindLookupToTask(baseLookup, taskThreadId, options.material.language),
    actionLabel: options.material.language === "zh-CN" ? "查看任务上下文" : "View task context",
    presentationMode: "mental-model",
  });
  let stopped = false;
  try {
    const status = await adapter.refreshTargets();
    if (status.targetCount !== 1) throw new Error("study_v2_native_pointable_host_unavailable");
    const activeTasks = await adapter.activeTasks();
    if (activeTasks.length !== 1 || activeTasks[0]?.threadId !== taskThreadId) {
      throw new Error("study_v2_native_task_not_active");
    }
    return Object.freeze({
      schemaVersion: 1 as const,
      condition: "B" as const,
      taskThreadId,
      mounted: true,
      quietContextReveal: true,
      async stop(): Promise<void> {
        if (stopped) return;
        stopped = true;
        await adapter.stop();
      },
    });
  } catch (error) {
    stopped = true;
    await adapter.stop().catch(() => undefined);
    throw error;
  }
}

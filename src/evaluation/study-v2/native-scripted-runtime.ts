import { StudyV2DesktopAppServerRpc } from "./desktop-app-server-rpc.js";
import type {
  StudyV2ScriptedTaskResult,
  StudyV2ScriptedTaskRpc,
} from "./native-scripted-task.js";
import {
  startScriptedResponsesProvider,
  type ScriptedResponseStep,
} from "./scripted-responses-provider.js";

export interface StudyV2ScriptedRuntimeHandle {
  rpc: StudyV2ScriptedTaskRpc;
  requestCount(): number;
  activateTask?(threadId: string): Promise<void>;
  publishTask(task: StudyV2ScriptedTaskResult): Promise<StudyV2ScriptedTaskResult>;
  createRetainedReviewTask(task: StudyV2ScriptedTaskResult): Promise<StudyV2RetainedReviewTask>;
  stop(): Promise<void>;
}

export interface StudyV2RetainedReviewTask {
  schemaVersion: 1;
  threadId: string;
  title: string;
  exchangeCount: number;
  nativeCodexTask: true;
  liveModelInvoked: false;
  runtimeEndpointOverrideCopied: false;
}

export interface StartStudyV2ScriptedRuntimeOptions {
  workspaceRoot: string;
  model: string;
  responses: readonly ScriptedResponseStep[];
  requestTimeoutMs?: number;
  endpoint?: string;
}

function boundedModel(value: string): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) {
    throw new Error("study_v2_scripted_model_invalid");
  }
  return value;
}

function validatedLoopbackOrigin(origin: string): string {
  const parsed = new URL(origin);
  if (
    parsed.protocol !== "http:" ||
    (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "::1" && parsed.hostname !== "[::1]") ||
    parsed.port.length === 0 ||
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error("study_v2_scripted_provider_origin_invalid");
  }
  return parsed.origin;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function studyV2ScriptedThreadStartParams(
  params: unknown,
  providerOrigin: string,
  model: string,
): Record<string, unknown> {
  if (!record(params)) throw new Error("study_v2_scripted_thread_start_params_invalid");
  if (params.config !== undefined || params.modelProvider !== undefined) {
    throw new Error("study_v2_scripted_thread_start_override_conflict");
  }
  const origin = validatedLoopbackOrigin(providerOrigin);
  return {
    ...params,
    model,
    modelProvider: "pointable",
    config: {
      "model_providers.pointable": {
        name: "Pointable scripted",
        base_url: `${origin}/v1`,
        wire_api: "responses",
        requires_openai_auth: false,
        supports_websockets: false,
      },
      "features.plugins": false,
      "features.apps": false,
      model_supports_reasoning_summaries: false,
      model_context_window: 32_768,
    },
  };
}

export function studyV2PublishedThreadForkParams(
  sourceThreadId: string,
  providerOrigin: string,
): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]{1,256}$/u.test(sourceThreadId)) {
    throw new Error("study_v2_scripted_source_thread_invalid");
  }
  const origin = validatedLoopbackOrigin(providerOrigin);
  return {
    threadId: sourceThreadId,
    model: "gpt-5.6-sol",
    modelProvider: "openai",
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: false,
    config: {
      openai_base_url: `${origin}/v1`,
      "features.plugins": false,
      "features.apps": false,
      model_supports_reasoning_summaries: false,
      model_context_window: 32_768,
    },
  };
}

function publishedThreadId(value: unknown, sourceThreadId: string): string {
  if (
    !record(value) || value.modelProvider !== "openai" || !record(value.thread) ||
    typeof value.thread.id !== "string" || value.thread.id === sourceThreadId ||
    value.thread.forkedFromId !== sourceThreadId || value.thread.modelProvider !== "openai"
  ) {
    throw new Error("study_v2_published_thread_invalid");
  }
  return value.thread.id;
}

function publishedHistoryMatches(value: unknown, task: StudyV2ScriptedTaskResult): boolean {
  if (
    !record(value) || !record(value.thread) || value.thread.modelProvider !== "openai" ||
    !Array.isArray(value.thread.turns) || value.thread.turns.length !== task.exchangeCount
  ) {
    return false;
  }
  const ids = new Set(value.thread.turns.flatMap((turn) =>
    record(turn) && typeof turn.id === "string" ? [turn.id] : []
  ));
  return task.turnIds.every((id) => ids.has(id));
}

export function studyV2RetainedThreadForkParams(sourceThreadId: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]{1,256}$/u.test(sourceThreadId)) {
    throw new Error("study_v2_retained_source_thread_invalid");
  }
  return {
    threadId: sourceThreadId,
    model: "gpt-5.6-sol",
    modelProvider: "openai",
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: false,
    config: {
      "features.plugins": false,
      "features.apps": false,
    },
  };
}

function retainedThreadId(value: unknown, sourceThreadId: string): string {
  if (
    !record(value) || value.modelProvider !== "openai" || !record(value.thread) ||
    typeof value.thread.id !== "string" || value.thread.id === sourceThreadId ||
    value.thread.forkedFromId !== sourceThreadId || value.thread.modelProvider !== "openai"
  ) {
    throw new Error("study_v2_retained_thread_invalid");
  }
  return value.thread.id;
}

export async function createStudyV2RetainedReviewTask(
  rpc: StudyV2ScriptedTaskRpc,
  task: StudyV2ScriptedTaskResult,
  activate?: (threadId: string) => Promise<void>,
): Promise<StudyV2RetainedReviewTask> {
  let reviewThreadId: string | undefined;
  try {
    reviewThreadId = retainedThreadId(await rpc.request(
      "thread/fork",
      studyV2RetainedThreadForkParams(task.threadId),
    ), task.threadId);
    await rpc.request("thread/name/set", { threadId: reviewThreadId, name: task.title });
    const read = await rpc.request("thread/read", { threadId: reviewThreadId, includeTurns: true });
    if (!publishedHistoryMatches(read, task)) {
      throw new Error("study_v2_retained_history_mismatch");
    }
    await activate?.(reviewThreadId);
    await rpc.request("thread/delete", { threadId: task.threadId });
    return Object.freeze({
      schemaVersion: 1,
      threadId: reviewThreadId,
      title: task.title,
      exchangeCount: task.exchangeCount,
      nativeCodexTask: true,
      liveModelInvoked: false,
      runtimeEndpointOverrideCopied: false,
    });
  } catch (error) {
    if (reviewThreadId !== undefined) {
      await rpc.request("thread/delete", { threadId: reviewThreadId }).catch(() => undefined);
    }
    throw error;
  }
}

export async function publishStudyV2ScriptedTask(
  rpc: StudyV2ScriptedTaskRpc,
  task: StudyV2ScriptedTaskResult,
  providerOrigin: string,
): Promise<StudyV2ScriptedTaskResult> {
  let forkThreadId: string | undefined;
  try {
    forkThreadId = publishedThreadId(await rpc.request("thread/fork",
      studyV2PublishedThreadForkParams(task.threadId, providerOrigin)), task.threadId);
    await rpc.request("thread/name/set", { threadId: forkThreadId, name: task.title });
    const read = await rpc.request("thread/read", { threadId: forkThreadId, includeTurns: true });
    if (!publishedHistoryMatches(read, task)) {
      throw new Error("study_v2_published_history_mismatch");
    }
    await rpc.request("thread/delete", { threadId: task.threadId });
    return Object.freeze({ ...task, threadId: forkThreadId });
  } catch (error) {
    if (forkThreadId !== undefined) {
      await rpc.request("thread/delete", { threadId: forkThreadId }).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Launch a private loopback Responses provider, then bind it to a thread made
 * by the App Server already owned by the current Codex Desktop. The provider
 * contains the complete frozen assistant script, so this runtime never calls a
 * live model or the public OpenAI API. No global Codex configuration is
 * changed; provider configuration is scoped to thread/start.
 */
export async function startStudyV2ScriptedRuntime(
  options: StartStudyV2ScriptedRuntimeOptions,
): Promise<StudyV2ScriptedRuntimeHandle> {
  const model = boundedModel(options.model);
  const provider = await startScriptedResponsesProvider(options.responses);
  let desktop: StudyV2DesktopAppServerRpc | undefined;
  try {
    desktop = await StudyV2DesktopAppServerRpc.connect({
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
      requestTimeoutMs: options.requestTimeoutMs ?? 25_000,
    });
    const rpc: StudyV2ScriptedTaskRpc = {
      request<T = unknown>(method: string, params: unknown): Promise<T> {
        return desktop!.request<T>(
          method,
          method === "thread/start"
            ? studyV2ScriptedThreadStartParams(params, provider.origin, model)
            : params,
        );
      },
      waitForNotification<T = unknown>(
        method: string,
        predicate?: (params: unknown) => boolean,
        timeoutMs?: number,
      ): Promise<T> {
        return desktop!.waitForNotification<T>(method, predicate, timeoutMs);
      },
    };
    let stopped = false;
    return Object.freeze({
      rpc,
      requestCount: () => provider.requests.length,
      activateTask: async (threadId: string): Promise<void> => await desktop!.navigateToThread(threadId),
      publishTask: async (task: StudyV2ScriptedTaskResult): Promise<StudyV2ScriptedTaskResult> =>
        await publishStudyV2ScriptedTask(rpc, task, provider.origin),
      createRetainedReviewTask: async (
        task: StudyV2ScriptedTaskResult,
      ): Promise<StudyV2RetainedReviewTask> =>
        await createStudyV2RetainedReviewTask(
          rpc,
          task,
          async (threadId) => await desktop!.navigateToThread(threadId),
        ),
      stop: async (): Promise<void> => {
        if (stopped) return;
        stopped = true;
        const settled = await Promise.allSettled([
          desktop?.close() ?? Promise.resolve(),
          provider.stop(),
        ]);
        if (settled.some((item) => item.status === "rejected")) {
          throw new Error("study_v2_scripted_runtime_cleanup_failed");
        }
      },
    });
  } catch (error) {
    await Promise.allSettled([desktop?.close() ?? Promise.resolve(), provider.stop()]);
    throw error;
  }
}

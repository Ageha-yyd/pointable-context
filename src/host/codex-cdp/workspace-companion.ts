import {
  CodexCdpHostAdapter,
  type CodexCdpHostAdapterOptions,
  type CodexCdpHostAdapterStatus,
} from "./adapter.js";
import type { PointableFetch } from "./targets.js";
import type { CdpConnectionFactory } from "./transport.js";
import {
  CodexTaskWorkspaceBindingRegistry,
  type CodexTaskWorkspaceBindingEntry,
} from "./task-workspace-binding.js";
import { createWorkspaceLookupCallback } from "./workspace-lookup.js";

const DEFAULT_REFRESH_INTERVAL_MS = 2_000;

export interface WorkspaceCompanionOptions {
  registry: CodexTaskWorkspaceBindingRegistry;
  endpoint?: string;
  fetch?: PointableFetch;
  connect?: CdpConnectionFactory;
  discoveryTimeoutMs?: number;
  lookupTimeoutMs?: number;
  operationTimeoutMs?: number;
  maxConcurrentLookupsPerTarget?: number;
  refreshIntervalMs?: number;
  actionLabel?: string;
}

export interface WorkspaceCompanionStatus {
  state: "idle" | "running" | "stopping" | "stopped";
  mode: "live-local-workspace";
  experimentalHostAdapter: true;
  startedAt?: string;
  lastRefreshAt?: string;
  refreshCount: number;
  activeTaskCount: number;
  activeBinding?: CodexTaskWorkspaceBindingEntry;
  lastError?: string;
  adapter: CodexCdpHostAdapterStatus;
}

export interface WorkspaceBindingResult {
  binding: CodexTaskWorkspaceBindingEntry;
  replaced: boolean;
}

export interface WorkspaceCompanion {
  readonly adapter: CodexCdpHostAdapter;
  readonly registry: CodexTaskWorkspaceBindingRegistry;
  start(): Promise<WorkspaceCompanionStatus>;
  refresh(): Promise<WorkspaceCompanionStatus>;
  bindCurrentTask(workspaceRoot: string): Promise<WorkspaceBindingResult>;
  unbindCurrentTask(): Promise<CodexTaskWorkspaceBindingEntry | undefined>;
  stop(): Promise<WorkspaceCompanionStatus>;
  status(): WorkspaceCompanionStatus;
}

function refreshInterval(value: number | undefined): number {
  const candidate = value ?? DEFAULT_REFRESH_INTERVAL_MS;
  if (!Number.isSafeInteger(candidate) || candidate < 100 || candidate > 60_000) {
    throw new RangeError("refreshIntervalMs must be an integer from 100 to 60000");
  }
  return candidate;
}

function publicError(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message.slice(0, 512)
    : "workspace companion refresh failed";
}

function immutableStatus(status: WorkspaceCompanionStatus): WorkspaceCompanionStatus {
  return Object.freeze({
    ...status,
    ...(status.activeBinding === undefined
      ? {}
      : {
          activeBinding: Object.freeze({
            ...status.activeBinding,
            scope: Object.freeze({ ...status.activeBinding.scope }),
          }),
        }),
    adapter: Object.freeze({
      ...status.adapter,
      targets: Object.freeze(
        status.adapter.targets.map((target) => Object.freeze({ ...target })),
      ),
    }),
  }) as WorkspaceCompanionStatus;
}

export function createWorkspaceCompanion(
  options: WorkspaceCompanionOptions,
): WorkspaceCompanion {
  const intervalMs = refreshInterval(options.refreshIntervalMs);
  const lookup = createWorkspaceLookupCallback({
    registry: options.registry,
    ...(options.operationTimeoutMs === undefined
      ? {}
      : { operationTimeoutMs: options.operationTimeoutMs }),
  });
  const adapterOptions: CodexCdpHostAdapterOptions = {
    lookup,
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.connect === undefined ? {} : { connect: options.connect }),
    ...(options.discoveryTimeoutMs === undefined
      ? {}
      : { discoveryTimeoutMs: options.discoveryTimeoutMs }),
    ...(options.lookupTimeoutMs === undefined
      ? {}
      : { lookupTimeoutMs: options.lookupTimeoutMs }),
    ...(options.maxConcurrentLookupsPerTarget === undefined
      ? {}
      : { maxConcurrentLookupsPerTarget: options.maxConcurrentLookupsPerTarget }),
    actionLabel: options.actionLabel ?? "查看工作区上下文",
  };
  const adapter = new CodexCdpHostAdapter(adapterOptions);
  let state: WorkspaceCompanionStatus["state"] = "idle";
  let startedAt: string | undefined;
  let lastRefreshAt: string | undefined;
  let refreshCount = 0;
  let activeTaskCount = 0;
  let activeBinding: CodexTaskWorkspaceBindingEntry | undefined;
  let lastError: string | undefined;
  let refreshPromise: Promise<WorkspaceCompanionStatus> | undefined;
  let stopPromise: Promise<WorkspaceCompanionStatus> | undefined;
  let timer: NodeJS.Timeout | undefined;

  const status = (): WorkspaceCompanionStatus => immutableStatus({
    state,
    mode: "live-local-workspace",
    experimentalHostAdapter: true,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(lastRefreshAt === undefined ? {} : { lastRefreshAt }),
    refreshCount,
    activeTaskCount,
    ...(activeBinding === undefined ? {} : { activeBinding }),
    ...(lastError === undefined ? {} : { lastError }),
    adapter: adapter.status(),
  });

  const schedule = (): void => {
    if (state !== "running") return;
    timer = setTimeout(() => {
      timer = undefined;
      void refresh().finally(schedule);
    }, intervalMs);
  };

  const refresh = (): Promise<WorkspaceCompanionStatus> => {
    if (state === "stopping" || state === "stopped") return Promise.resolve(status());
    if (refreshPromise !== undefined) return refreshPromise;
    const operation = (async (): Promise<WorkspaceCompanionStatus> => {
      try {
        if (adapter.status().state === "idle") await adapter.start();
        else await adapter.refreshTargets();
        const tasks = await adapter.activeTasks();
        activeTaskCount = tasks.length;
        activeBinding = tasks.length === 1
          ? await options.registry.find(tasks[0]!)
          : undefined;
        lastError = undefined;
      } catch (error) {
        activeTaskCount = 0;
        activeBinding = undefined;
        lastError = publicError(error);
      } finally {
        refreshCount += 1;
        lastRefreshAt = new Date().toISOString();
      }
      return status();
    })().finally(() => {
      if (refreshPromise === operation) refreshPromise = undefined;
    });
    refreshPromise = operation;
    return operation;
  };

  const start = async (): Promise<WorkspaceCompanionStatus> => {
    if (state === "stopped" || state === "stopping") {
      throw new Error("workspace_companion_stopped");
    }
    if (state === "running") return status();
    state = "running";
    startedAt = new Date().toISOString();
    await refresh();
    schedule();
    return status();
  };

  const bindCurrentTask = async (
    workspaceRoot: string,
  ): Promise<WorkspaceBindingResult> => {
    if (state !== "running") throw new Error("workspace_companion_not_running");
    const tasks = await adapter.activeTasks();
    activeTaskCount = tasks.length;
    if (tasks.length === 0) throw new Error("active_codex_task_unavailable");
    if (tasks.length !== 1) throw new Error("active_codex_task_ambiguous");
    const replaced = (await options.registry.find(tasks[0]!)) !== undefined;
    const entry = await options.registry.bind(tasks[0]!, workspaceRoot);
    activeBinding = entry;
    return Object.freeze({ binding: entry, replaced });
  };

  const unbindCurrentTask = async (): Promise<
    CodexTaskWorkspaceBindingEntry | undefined
  > => {
    if (state !== "running") throw new Error("workspace_companion_not_running");
    const tasks = await adapter.activeTasks();
    activeTaskCount = tasks.length;
    if (tasks.length === 0) throw new Error("active_codex_task_unavailable");
    if (tasks.length !== 1) throw new Error("active_codex_task_ambiguous");
    const removed = await options.registry.unbind(tasks[0]!);
    activeBinding = undefined;
    return removed;
  };

  const stop = (): Promise<WorkspaceCompanionStatus> => {
    if (stopPromise !== undefined) return stopPromise;
    if (state === "stopped") return Promise.resolve(status());
    state = "stopping";
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    const operation = (async (): Promise<WorkspaceCompanionStatus> => {
      await refreshPromise?.catch(() => undefined);
      await adapter.stop();
      activeTaskCount = 0;
      activeBinding = undefined;
      state = "stopped";
      return status();
    })();
    stopPromise = operation;
    return operation;
  };

  return Object.freeze({
    adapter,
    registry: options.registry,
    start,
    refresh,
    bindCurrentTask,
    unbindCurrentTask,
    stop,
    status,
  });
}

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

export type CodexDesktopCompatibilityGate =
  | "pass"
  | "fail"
  | "unavailable"
  | "unchecked";

export interface CodexDesktopCompatibilityStatus {
  contract: "private-codex-chat-lane-v1";
  state: "unchecked" | "qualified" | "unavailable" | "incompatible";
  code: string;
  checkedAt?: string;
  gates: {
    exactMainTarget: CodexDesktopCompatibilityGate;
    mainFrame: CodexDesktopCompatibilityGate;
    mainExecutionContext: CodexDesktopCompatibilityGate;
    rendererLifecycle: CodexDesktopCompatibilityGate;
  };
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
  lastErrorCode?: string;
  compatibility: CodexDesktopCompatibilityStatus;
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

function publicErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z0-9_:-]{1,128}$/u.test(error.code)
  ) {
    return error.code;
  }
  if (
    error instanceof Error &&
    /^[a-z0-9_:-]{1,128}$/u.test(error.message)
  ) {
    return error.message;
  }
  return "workspace_companion_refresh_failed";
}

function compatibilityStatus(input: {
  state: WorkspaceCompanionStatus["state"];
  refreshCount: number;
  lastRefreshAt?: string;
  lastErrorCode?: string;
  adapter: CodexCdpHostAdapterStatus;
}): CodexDesktopCompatibilityStatus {
  const result = (
    state: CodexDesktopCompatibilityStatus["state"],
    code: string,
    gates: CodexDesktopCompatibilityStatus["gates"],
  ): CodexDesktopCompatibilityStatus => ({
    contract: "private-codex-chat-lane-v1",
    state,
    code,
    ...(input.lastRefreshAt === undefined
      ? {}
      : { checkedAt: input.lastRefreshAt }),
    gates,
  });
  const all = (gate: CodexDesktopCompatibilityGate) => ({
    exactMainTarget: gate,
    mainFrame: gate,
    mainExecutionContext: gate,
    rendererLifecycle: gate,
  });

  if (input.state === "idle" || input.refreshCount === 0) {
    return result("unchecked", "not_checked", all("unchecked"));
  }
  if (input.state === "stopping" || input.state === "stopped") {
    return result("unavailable", "companion_stopped", all("unavailable"));
  }
  if (
    input.adapter.targetCount > 0 &&
    input.adapter.targets.length === input.adapter.targetCount
  ) {
    return result("qualified", "qualified_current_runtime", all("pass"));
  }

  const code = input.lastErrorCode;
  if (code === undefined) {
    return result("incompatible", "qualified_target_missing", {
      exactMainTarget: "fail",
      mainFrame: "unchecked",
      mainExecutionContext: "unchecked",
      rendererLifecycle: "unchecked",
    });
  }
  if (code === "pointable_main_frame_unverified") {
    return result("incompatible", code, {
      exactMainTarget: "pass",
      mainFrame: "fail",
      mainExecutionContext: "unchecked",
      rendererLifecycle: "unchecked",
    });
  }
  if (code.startsWith("pointable_main_context_")) {
    return result("incompatible", code, {
      exactMainTarget: "pass",
      mainFrame: "pass",
      mainExecutionContext: "fail",
      rendererLifecycle: "unchecked",
    });
  }
  if (code.startsWith("pointable_renderer_")) {
    return result("incompatible", code, {
      exactMainTarget: "pass",
      mainFrame: "pass",
      mainExecutionContext: "pass",
      rendererLifecycle: "fail",
    });
  }
  return result("unavailable", code, {
    exactMainTarget: "unavailable",
    mainFrame: "unavailable",
    mainExecutionContext: "unavailable",
    rendererLifecycle: "unavailable",
  });
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
    compatibility: Object.freeze({
      ...status.compatibility,
      gates: Object.freeze({ ...status.compatibility.gates }),
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
    actionLabel: options.actionLabel ?? "查看上下文",
  };
  const adapter = new CodexCdpHostAdapter(adapterOptions);
  let state: WorkspaceCompanionStatus["state"] = "idle";
  let startedAt: string | undefined;
  let lastRefreshAt: string | undefined;
  let refreshCount = 0;
  let activeTaskCount = 0;
  let activeBinding: CodexTaskWorkspaceBindingEntry | undefined;
  let lastError: string | undefined;
  let lastErrorCode: string | undefined;
  let refreshPromise: Promise<WorkspaceCompanionStatus> | undefined;
  let stopPromise: Promise<WorkspaceCompanionStatus> | undefined;
  let timer: NodeJS.Timeout | undefined;

  const status = (): WorkspaceCompanionStatus => {
    const adapterStatus = adapter.status();
    return immutableStatus({
      state,
      mode: "live-local-workspace",
      experimentalHostAdapter: true,
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(lastRefreshAt === undefined ? {} : { lastRefreshAt }),
      refreshCount,
      activeTaskCount,
      ...(activeBinding === undefined ? {} : { activeBinding }),
      ...(lastError === undefined ? {} : { lastError }),
      ...(lastErrorCode === undefined ? {} : { lastErrorCode }),
      compatibility: compatibilityStatus({
        state,
        refreshCount,
        ...(lastRefreshAt === undefined ? {} : { lastRefreshAt }),
        ...(lastErrorCode === undefined ? {} : { lastErrorCode }),
        adapter: adapterStatus,
      }),
      adapter: adapterStatus,
    });
  };

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
        lastErrorCode = undefined;
      } catch (error) {
        activeTaskCount = 0;
        activeBinding = undefined;
        lastError = publicError(error);
        lastErrorCode = publicErrorCode(error);
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

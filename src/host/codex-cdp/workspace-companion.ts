import {
  CodexCdpHostAdapter,
  type CodexCdpHostAdapterOptions,
  type CodexCdpHostAdapterStatus,
} from "./adapter.js";
import type { PointableFetch } from "./targets.js";
import type { CdpConnectionFactory } from "./transport.js";
import type { PointablePresentationMode } from "./protocol.js";
import {
  LocalWorkspaceAuthoritativeProvider,
  LocalWorkspaceContextIndex,
  LocalWorkspaceRevisionProbe,
} from "../../adapters/local-workspace.js";
import { checkContextMilestoneArtifacts } from "../../records/context-artifact-check.js";
import { checkContextRecords } from "../../records/context-record-check.js";
import {
  CodexTaskWorkspaceBindingPort,
  CodexTaskWorkspaceBindingRegistry,
  codexTaskThreadRef,
  type CodexTaskWorkspaceBindingEntry,
} from "./task-workspace-binding.js";
import { createWorkspaceLookupCallback } from "./workspace-lookup.js";
import { createWorkspaceAnnotationProvider } from "./workspace-annotations.js";
import {
  MilestoneObservationLedger,
  type MilestoneObservationRecordResult,
  type MilestoneObservationSummary,
} from "./milestone-observation.js";
import {
  ActiveTaskObjectAnnotationIndex,
  CompositeContextIndex,
  RoutedWorkspaceRevisionProbe,
  TaskObjectWorkspaceContextIndex,
  TaskObjectRegistry,
  type TaskObjectArchiveResult,
  type TaskObjectCurationAudit,
  type TaskObjectCurationReview,
  type TaskObjectInventory,
  type TaskObjectMutationResult,
  type TaskObjectSummary,
} from "./task-object-registry.js";
import {
  RecoveryObservationHostBridge,
  type RecoveryObservationHostStatus,
} from "../../evaluation/recovery-observation-host.js";
import type {
  RecoveryEpisodeDefinition,
  RecoveryEpisodeOutcome,
} from "../../evaluation/recovery-observation.js";
import type { RecoveryObservationResult } from "../../evaluation/recovery-observation-adapter.js";

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
  presentationMode?: PointablePresentationMode;
  annotationRefreshIntervalMs?: number;
  taskObjectRegistry?: TaskObjectRegistry;
  milestoneObservationLedger?: MilestoneObservationLedger;
  recoveryObservationBridge?: RecoveryObservationHostBridge;
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
  presentationMode: PointablePresentationMode;
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
  upsertCurrentTaskObject(input: unknown): Promise<TaskObjectMutationResult>;
  supersedeCurrentTaskObject(
    replacedObjectKey: string,
    replacement: unknown,
  ): Promise<TaskObjectMutationResult>;
  retireCurrentTaskObject(objectKey: string): Promise<TaskObjectMutationResult>;
  listCurrentTaskObjects(): Promise<TaskObjectSummary[]>;
  inventoryCurrentTaskObjects(): Promise<TaskObjectInventory>;
  auditCurrentTaskObjects(): Promise<TaskObjectCurationAudit>;
  reviewCurrentTaskObjectNeeds(input: unknown): Promise<TaskObjectCurationReview>;
  observeCurrentTaskMilestone(input: unknown): Promise<MilestoneObservationRecordResult>;
  summarizeCurrentTaskMilestones(): Promise<MilestoneObservationSummary>;
  archiveGraduatedCurrentTaskObjects(): Promise<TaskObjectArchiveResult>;
  beginCurrentTaskRecoveryObservation(
    definition: RecoveryEpisodeDefinition,
  ): Promise<RecoveryObservationHostStatus>;
  completeCurrentTaskRecoveryObservation(
    outcome: RecoveryEpisodeOutcome,
  ): Promise<RecoveryObservationResult>;
  abortCurrentTaskRecoveryObservation(): Promise<RecoveryObservationResult>;
  currentTaskRecoveryObservationStatus(): Promise<RecoveryObservationHostStatus>;
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
  const presentationMode = options.presentationMode ?? "record";
  const localIndex = new LocalWorkspaceContextIndex();
  const localProvider = new LocalWorkspaceAuthoritativeProvider();
  const localRevisionProbe = new LocalWorkspaceRevisionProbe();
  const workspaceIndex = options.taskObjectRegistry === undefined
    ? localIndex
    : new TaskObjectWorkspaceContextIndex(localIndex, options.taskObjectRegistry);
  const annotationIndex = options.taskObjectRegistry === undefined
    ? localIndex
    : new CompositeContextIndex([
        localIndex,
        new ActiveTaskObjectAnnotationIndex(options.taskObjectRegistry),
      ]);
  const lookup = createWorkspaceLookupCallback({
    registry: options.registry,
    index: workspaceIndex,
    ...(options.taskObjectRegistry === undefined
      ? { provider: localProvider, revisionProbe: localRevisionProbe }
      : {
          providers: [localProvider, options.taskObjectRegistry],
          revisionProbe: new RoutedWorkspaceRevisionProbe(
            options.taskObjectRegistry,
            localRevisionProbe,
          ),
        }),
    ...(options.operationTimeoutMs === undefined
      ? {}
      : { operationTimeoutMs: options.operationTimeoutMs }),
  });
  const annotationProvider = createWorkspaceAnnotationProvider({
    registry: options.registry,
    index: annotationIndex,
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
    presentationMode,
    annotationProvider,
    ...(options.recoveryObservationBridge === undefined
      ? {}
      : {
          interactionObserver: (request) => {
            options.recoveryObservationBridge!.observe(request);
          },
        }),
    ...(options.annotationRefreshIntervalMs === undefined
      ? {}
      : { annotationRefreshIntervalMs: options.annotationRefreshIntervalMs }),
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
      presentationMode,
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
    await options.taskObjectRegistry?.adoptBinding(tasks[0]!, entry);
    activeBinding = entry;
    await adapter.refreshAnnotations(undefined, true);
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
    await adapter.refreshAnnotations(undefined, true);
    return removed;
  };

  const currentTaskBinding = async () => {
    if (state !== "running") throw new Error("workspace_companion_not_running");
    if (options.taskObjectRegistry === undefined) {
      throw new Error("task_object_registry_unavailable");
    }
    const tasks = await adapter.activeTasks();
    activeTaskCount = tasks.length;
    if (tasks.length === 0) throw new Error("active_codex_task_unavailable");
    if (tasks.length !== 1) throw new Error("active_codex_task_ambiguous");
    const binding = await options.registry.find(tasks[0]!);
    if (binding === undefined) throw new Error("context_binding_missing");
    await options.taskObjectRegistry.adoptBinding(tasks[0]!, binding);
    activeBinding = binding;
    return { task: tasks[0]!, binding, registry: options.taskObjectRegistry };
  };

  const refreshObjectAnnotations = async (): Promise<void> => {
    await adapter.refreshAnnotations(undefined, true);
  };

  const currentRecoveryTask = async () => {
    if (state !== "running") throw new Error("workspace_companion_not_running");
    if (options.recoveryObservationBridge === undefined) {
      throw new Error("recovery_observation_bridge_unavailable");
    }
    const tasks = await adapter.activeTasks();
    activeTaskCount = tasks.length;
    if (tasks.length === 0) throw new Error("active_codex_task_unavailable");
    if (tasks.length !== 1) throw new Error("active_codex_task_ambiguous");
    const binding = await options.registry.find(tasks[0]!);
    if (binding === undefined) throw new Error("context_binding_missing");
    activeBinding = binding;
    return tasks[0]!;
  };

  const beginCurrentTaskRecoveryObservation = async (
    definition: RecoveryEpisodeDefinition,
  ): Promise<RecoveryObservationHostStatus> => {
    const task = await currentRecoveryTask();
    options.recoveryObservationBridge!.begin(task.contextFingerprint, definition);
    return options.recoveryObservationBridge!.status(task.contextFingerprint);
  };

  const completeCurrentTaskRecoveryObservation = async (
    outcome: RecoveryEpisodeOutcome,
  ): Promise<RecoveryObservationResult> => {
    const task = await currentRecoveryTask();
    return options.recoveryObservationBridge!.complete(task.contextFingerprint, outcome);
  };

  const abortCurrentTaskRecoveryObservation = async (): Promise<RecoveryObservationResult> => {
    const task = await currentRecoveryTask();
    return options.recoveryObservationBridge!.abort(task.contextFingerprint);
  };

  const currentTaskRecoveryObservationStatus = async (): Promise<
    RecoveryObservationHostStatus
  > => {
    const task = await currentRecoveryTask();
    return options.recoveryObservationBridge!.status(task.contextFingerprint);
  };

  const trustedBindingFor = async (
    current: Awaited<ReturnType<typeof currentTaskBinding>>,
  ) => {
    const port = new CodexTaskWorkspaceBindingPort(
      options.registry,
      current.task,
      { current: async () => current.task },
    );
    const resolved = await port.resolve({
      selectionGeneration: 1,
      explicitScope: current.binding.scope,
      threadRef: codexTaskThreadRef(current.task),
      routeRef: current.task.routeRef,
      workspaceRoot: current.binding.workspaceRoot,
    });
    if (resolved.kind !== "trusted") throw new Error("context_binding_changed");
    return resolved;
  };

  const upsertCurrentTaskObject = async (input: unknown): Promise<TaskObjectMutationResult> => {
    const current = await currentTaskBinding();
    const result = await current.registry.upsert(current.task, current.binding, input);
    await refreshObjectAnnotations();
    return result;
  };

  const supersedeCurrentTaskObject = async (
    replacedObjectKey: string,
    replacement: unknown,
  ): Promise<TaskObjectMutationResult> => {
    const current = await currentTaskBinding();
    const result = await current.registry.supersede(
      current.task,
      current.binding,
      replacedObjectKey,
      replacement,
    );
    await refreshObjectAnnotations();
    return result;
  };

  const retireCurrentTaskObject = async (
    objectKey: string,
  ): Promise<TaskObjectMutationResult> => {
    const current = await currentTaskBinding();
    const result = await current.registry.retire(current.task, current.binding, objectKey);
    await refreshObjectAnnotations();
    return result;
  };

  const listCurrentTaskObjects = async (): Promise<TaskObjectSummary[]> => {
    const current = await currentTaskBinding();
    return await current.registry.listForTask(current.task, current.binding);
  };

  const inventoryCurrentTaskObjects = async (): Promise<TaskObjectInventory> => {
    const current = await currentTaskBinding();
    return await current.registry.inventoryForTask(current.task, current.binding);
  };

  const checkedStableRecords = async (
    current: Awaited<ReturnType<typeof currentTaskBinding>>,
  ) => {
    const trusted = await trustedBindingFor(current);
    const [indexed, artifacts, records] = await Promise.all([
      localIndex.list(trusted),
      checkContextMilestoneArtifacts(current.binding.workspaceRoot),
      checkContextRecords(current.binding.workspaceRoot),
    ]);
    const checkedPaths = new Set([
      ...(artifacts.valid ? artifacts.artifacts.map((artifact) => artifact.path) : []),
      ...(records.valid ? records.records.map((record) => record.path) : []),
    ].map((path) => `file:${path}`));
    return indexed.filter((record) => checkedPaths.has(record.entityId));
  };

  const auditCurrentTaskObjects = async (): Promise<TaskObjectCurationAudit> => {
    const current = await currentTaskBinding();
    return await current.registry.auditCuration(
      current.task,
      current.binding,
      await checkedStableRecords(current),
    );
  };

  const reviewCurrentTaskObjectNeeds = async (
    input: unknown,
  ): Promise<TaskObjectCurationReview> => {
    const current = await currentTaskBinding();
    const trusted = await trustedBindingFor(current);
    return await current.registry.reviewCuration(
      current.task,
      current.binding,
      await localIndex.list(trusted),
      input,
    );
  };

  const sameObservationContext = (
    left: Awaited<ReturnType<typeof currentTaskBinding>>,
    right: Awaited<ReturnType<typeof currentTaskBinding>>,
  ): boolean => (
    codexTaskThreadRef(left.task) === codexTaskThreadRef(right.task) &&
    left.task.routeRef === right.task.routeRef &&
    left.task.contextFingerprint === right.task.contextFingerprint &&
    left.binding.bindingRevision === right.binding.bindingRevision &&
    left.binding.workspaceRoot === right.binding.workspaceRoot &&
    left.binding.scope.kind === right.binding.scope.kind &&
    left.binding.scope.namespace === right.binding.scope.namespace &&
    left.binding.scope.id === right.binding.scope.id
  );

  const observeCurrentTaskMilestone = async (
    input: unknown,
  ): Promise<MilestoneObservationRecordResult> => {
    if (options.milestoneObservationLedger === undefined) {
      throw new Error("milestone_observation_ledger_unavailable");
    }
    const current = await currentTaskBinding();
    const trusted = await trustedBindingFor(current);
    const workspaceRecords = await localIndex.list(trusted);
    // Resolve the stable-record input before starting the concurrent jobs. If
    // reviewCuration rejects synchronously while another argument is still
    // being awaited, recent Node runtimes can treat that temporarily detached
    // rejection as fatal before Promise.all gets a chance to observe it.
    const stableRecords = await checkedStableRecords(current);
    const [review, audit, inventory] = await Promise.all([
      current.registry.reviewCuration(
        current.task,
        current.binding,
        workspaceRecords,
        input,
      ),
      current.registry.auditCuration(
        current.task,
        current.binding,
        stableRecords,
      ),
      current.registry.inventoryForTask(current.task, current.binding),
    ]);
    const revalidated = await currentTaskBinding();
    if (!sameObservationContext(current, revalidated)) {
      throw new Error("milestone_observation_context_changed");
    }
    return await options.milestoneObservationLedger.record({
      task: current.task,
      binding: current.binding,
      review,
      audit,
      inventory,
    });
  };

  const summarizeCurrentTaskMilestones = async (): Promise<MilestoneObservationSummary> => {
    if (options.milestoneObservationLedger === undefined) {
      throw new Error("milestone_observation_ledger_unavailable");
    }
    const current = await currentTaskBinding();
    return await options.milestoneObservationLedger.summary(current.task, current.binding);
  };

  const archiveGraduatedCurrentTaskObjects = async (): Promise<TaskObjectArchiveResult> => {
    const current = await currentTaskBinding();
    const result = await current.registry.archiveGraduated(
      current.task,
      current.binding,
      await checkedStableRecords(current),
    );
    if (result.archivedCount > 0) await refreshObjectAnnotations();
    return result;
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
    upsertCurrentTaskObject,
    supersedeCurrentTaskObject,
    retireCurrentTaskObject,
    listCurrentTaskObjects,
    inventoryCurrentTaskObjects,
    auditCurrentTaskObjects,
    reviewCurrentTaskObjectNeeds,
    observeCurrentTaskMilestone,
    summarizeCurrentTaskMilestones,
    archiveGraduatedCurrentTaskObjects,
    beginCurrentTaskRecoveryObservation,
    completeCurrentTaskRecoveryObservation,
    abortCurrentTaskRecoveryObservation,
    currentTaskRecoveryObservationStatus,
    stop,
    status,
  });
}

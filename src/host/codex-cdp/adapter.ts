import { randomUUID } from "node:crypto";
import {
  createPointableLookupResponse,
  parsePointableLookupIntent,
  PointableProtocolError,
  validatePointableLookupPresentation,
  type PointableLookupIntentV1,
  type PointableLookupPresentation,
  type PointablePresentationMode,
} from "./protocol.js";
import {
  createDeliverPointableResultExpression,
  createInstallPointableRendererExpression,
  createUninstallPointableRendererExpression,
  createVerifyPointableRendererFenceExpression,
  type PointableRendererStatus,
} from "./renderer.js";
import {
  discoverCodexAppTargets,
  type CodexCdpTarget,
  type PointableFetch,
} from "./targets.js";
import {
  connectCdpWebSocket,
  type CdpConnection,
  type CdpConnectionFactory,
  type CdpEvent,
} from "./transport.js";
import {
  createReadCodexHostTaskContextExpression,
  parseCodexHostTaskContext,
  type CodexHostTaskContext,
} from "./host-context.js";

export interface PointableLookupCallbackRequest {
  operation: PointableLookupIntentV1["operation"];
  requestId: string;
  selection: {
    text: string;
    digest: string;
    generation: number;
    surface: PointableLookupIntentV1["surface"];
  };
  contextFingerprint: string;
  requestedAt: string;
  candidateRef?: string;
  detailRef?: string;
  host: {
    targetId: string;
    targetUrl: string;
    bindingGeneration: string;
    /** Present only when the qualified main surface exposes one active task. */
    task?: CodexHostTaskContext;
    /** Re-read the same task fence in the qualified main execution context. */
    revalidateTask?: (signal?: AbortSignal) => Promise<CodexHostTaskContext | undefined>;
  };
  signal: AbortSignal;
}

export type PointableLookupCallback = (
  request: Readonly<PointableLookupCallbackRequest>,
) => Promise<unknown>;

export interface CodexCdpHostAdapterOptions {
  lookup: PointableLookupCallback;
  endpoint?: string;
  fetch?: PointableFetch;
  connect?: CdpConnectionFactory;
  discoveryTimeoutMs?: number;
  lookupTimeoutMs?: number;
  maxConcurrentLookupsPerTarget?: number;
  actionLabel?: string;
  presentationMode?: PointablePresentationMode;
}

export interface CodexCdpHostAdapterStatus {
  state: "idle" | "running" | "stopped";
  endpoint: string;
  targetCount: number;
  targets: Array<{
    targetId: string;
    targetUrl: string;
    bindingName: string;
    pendingLookups: number;
    executionContextId: number;
    rendererLifecycleId: string;
  }>;
}

interface PendingLookup {
  controller: AbortController;
  digest: string;
  generation: number;
}

interface TargetAttachment {
  target: CodexCdpTarget;
  connection: CdpConnection;
  unsubscribeEvent: () => void;
  unsubscribeClose: () => void;
  bindingName: string;
  bindingGeneration: string;
  bindingAdded: boolean;
  pending: Map<string, PendingLookup>;
  inFlight: Set<string>;
  mainFrameId: string;
  mainExecutionContextId?: number;
  contextWaiters: Set<(contextId: number) => void>;
  rendererLifecycleId?: string;
  lifecycleController: AbortController;
  invalidated: boolean;
  detached: boolean;
  detachPromise?: Promise<void>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runtimeValue(value: unknown): unknown {
  if (
    !record(value) ||
    !record(value.result) ||
    value.exceptionDetails !== undefined
  ) {
    return undefined;
  }
  return value.result.value;
}

function parseInstalledStatus(
  value: unknown,
  bindingName: string,
): PointableRendererStatus {
  if (
    !record(value) ||
    value.installed !== true ||
    value.bindingName !== bindingName ||
    typeof value.lifecycleId !== "string" ||
    !/^[A-Za-z0-9:_-]{8,256}$/u.test(value.lifecycleId) ||
    typeof value.state !== "string"
  ) {
    throw new Error("pointable_renderer_install_unverified");
  }
  return value as unknown as PointableRendererStatus;
}

function parseMainFrameId(value: unknown, target: CodexCdpTarget): string {
  if (
    !record(value) ||
    !record(value.frameTree) ||
    !record(value.frameTree.frame) ||
    typeof value.frameTree.frame.id !== "string" ||
    value.frameTree.frame.id.length < 1 ||
    value.frameTree.frame.id.length > 256 ||
    value.frameTree.frame.url !== target.url
  ) {
    throw new Error("pointable_main_frame_unverified");
  }
  return value.frameTree.frame.id;
}

function mainExecutionContext(
  event: CdpEvent,
  mainFrameId: string,
): number | undefined {
  if (event.method !== "Runtime.executionContextCreated" || !record(event.params)) {
    return undefined;
  }
  const context = event.params.context;
  if (!record(context) || !Number.isSafeInteger(context.id) || Number(context.id) < 1) {
    return undefined;
  }
  const auxiliary = context.auxData;
  if (
    !record(auxiliary) ||
    auxiliary.isDefault !== true ||
    auxiliary.frameId !== mainFrameId
  ) {
    return undefined;
  }
  return Number(context.id);
}

function lookupError(
  code: string,
  message: string,
  retryable: boolean,
): PointableLookupPresentation {
  return { kind: "error", code, message, retryable };
}

function boundedLookup<T>(
  callback: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  controller: AbortController,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      controller.abort(new Error("pointable lookup timed out"));
      reject(new Error("pointable_lookup_timeout"));
    }, timeoutMs);
    Promise.resolve()
      .then(() => callback(controller.signal))
      .then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}

function waitForMainContext(
  attachment: TargetAttachment,
  signal: AbortSignal,
  timeoutMs = 2_000,
): Promise<number> {
  if (attachment.mainExecutionContextId !== undefined) {
    return Promise.resolve(attachment.mainExecutionContextId);
  }
  return new Promise<number>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", aborted);
      attachment.contextWaiters.delete(finish);
    };
    const finish = (contextId: number): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(contextId);
    };
    const aborted = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("pointable_main_context_aborted"));
    };
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("pointable_main_context_timeout"));
    }, timeoutMs);
    attachment.contextWaiters.add(finish);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

function connectWithAbort(
  connectionPromise: Promise<CdpConnection>,
  signal: AbortSignal,
): Promise<CdpConnection> {
  if (signal.aborted) {
    connectionPromise.then((connection) => connection.close(), () => undefined);
    return Promise.reject(signal.reason);
  }
  return new Promise<CdpConnection>((resolve, reject) => {
    let settled = false;
    const aborted = (): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", aborted);
      reject(signal.reason);
    };
    signal.addEventListener("abort", aborted, { once: true });
    connectionPromise.then(
      (connection) => {
        if (settled) {
          connection.close();
          return;
        }
        settled = true;
        signal.removeEventListener("abort", aborted);
        resolve(connection);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}

export class CodexCdpHostAdapter {
  readonly #endpoint: string;
  readonly #fetch: PointableFetch | undefined;
  readonly #connect: CdpConnectionFactory;
  readonly #lookup: PointableLookupCallback;
  readonly #discoveryTimeoutMs: number;
  readonly #lookupTimeoutMs: number;
  readonly #maxConcurrentLookupsPerTarget: number;
  readonly #actionLabel: string | undefined;
  readonly #presentationMode: PointablePresentationMode | undefined;
  readonly #attachments = new Map<string, TargetAttachment>();
  readonly #attaching = new Set<TargetAttachment>();
  readonly #recoveries = new Set<Promise<void>>();
  readonly #recoveringTargets = new Set<string>();
  readonly #stopController = new AbortController();
  #refreshPromise: Promise<CodexCdpHostAdapterStatus> | undefined;
  #stopPromise: Promise<CodexCdpHostAdapterStatus> | undefined;
  #state: CodexCdpHostAdapterStatus["state"] = "idle";

  constructor(options: CodexCdpHostAdapterOptions) {
    this.#endpoint = options.endpoint ?? "http://127.0.0.1:9223";
    this.#fetch = options.fetch;
    this.#connect = options.connect ?? connectCdpWebSocket;
    this.#lookup = options.lookup;
    this.#discoveryTimeoutMs = options.discoveryTimeoutMs ?? 3_000;
    this.#lookupTimeoutMs = options.lookupTimeoutMs ?? 5_000;
    this.#maxConcurrentLookupsPerTarget =
      options.maxConcurrentLookupsPerTarget ?? 8;
    this.#actionLabel = options.actionLabel;
    this.#presentationMode = options.presentationMode;
    if (
      this.#presentationMode !== undefined &&
      this.#presentationMode !== "record" &&
      this.#presentationMode !== "narrative" &&
      this.#presentationMode !== "mental-model"
    ) {
      throw new RangeError("presentationMode is invalid");
    }
    if (
      !Number.isSafeInteger(this.#lookupTimeoutMs) ||
      this.#lookupTimeoutMs < 100 ||
      this.#lookupTimeoutMs > 30_000
    ) {
      throw new RangeError("lookupTimeoutMs must be an integer from 100 to 30000");
    }
    if (
      !Number.isSafeInteger(this.#maxConcurrentLookupsPerTarget) ||
      this.#maxConcurrentLookupsPerTarget < 1 ||
      this.#maxConcurrentLookupsPerTarget > 32
    ) {
      throw new RangeError(
        "maxConcurrentLookupsPerTarget must be an integer from 1 to 32",
      );
    }
  }

  #isStopped(): boolean {
    return this.#state === "stopped";
  }

  async start(signal?: AbortSignal): Promise<CodexCdpHostAdapterStatus> {
    if (this.#isStopped()) {
      throw new Error("pointable_host_adapter_stopped");
    }
    this.#state = "running";
    try {
      return await this.refreshTargets(signal);
    } catch (error) {
      if (this.#isStopped()) return this.status();
      if (this.#attachments.size === 0) this.#state = "idle";
      throw error;
    }
  }

  refreshTargets(signal?: AbortSignal): Promise<CodexCdpHostAdapterStatus> {
    if (this.#isStopped()) {
      return Promise.reject(new Error("pointable_host_adapter_stopped"));
    }
    if (this.#refreshPromise !== undefined) return this.#refreshPromise;
    const combinedSignal = signal === undefined
      ? this.#stopController.signal
      : AbortSignal.any([signal, this.#stopController.signal]);
    const refresh = this.#refreshTargets(combinedSignal).finally(() => {
      if (this.#refreshPromise === refresh) this.#refreshPromise = undefined;
    });
    this.#refreshPromise = refresh;
    return refresh;
  }

  async #refreshTargets(signal: AbortSignal): Promise<CodexCdpHostAdapterStatus> {
    const targets = await discoverCodexAppTargets(this.#endpoint, {
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
      signal,
      timeoutMs: this.#discoveryTimeoutMs,
    });
    if (this.#isStopped() || signal.aborted) return this.status();
    const targetIds = new Set(targets.map((target) => target.id));
    for (const [targetId, attachment] of this.#attachments) {
      if (this.#isStopped() || signal.aborted) return this.status();
      if (
        !targetIds.has(targetId) ||
        attachment.connection.isClosed() ||
        attachment.invalidated
      ) {
        await this.#detach(attachment);
      }
    }
    for (const target of targets) {
      if (this.#isStopped() || signal.aborted) return this.status();
      if (
        this.#attachments.has(target.id) ||
        [...this.#attaching].some((attachment) => attachment.target.id === target.id)
      ) {
        continue;
      }
      await this.#attach(target, signal);
    }
    if (!this.#isStopped() && !signal.aborted) this.#state = "running";
    return this.status();
  }

  status(): CodexCdpHostAdapterStatus {
    return {
      state: this.#state,
      endpoint: this.#endpoint,
      targetCount: this.#attachments.size,
      targets: [...this.#attachments.values()]
        .flatMap((attachment) =>
          attachment.mainExecutionContextId === undefined ||
          attachment.rendererLifecycleId === undefined
            ? []
            : [{
              targetId: attachment.target.id,
              targetUrl: attachment.target.url,
              bindingName: attachment.bindingName,
              pendingLookups: attachment.inFlight.size,
              executionContextId: attachment.mainExecutionContextId,
              rendererLifecycleId: attachment.rendererLifecycleId,
            }])
        .sort((left, right) => left.targetId.localeCompare(right.targetId)),
    };
  }

  /**
   * Read unique active task tuples from qualified Codex main surfaces. This is
   * used only for an explicit local bind action; zero or multiple results must
   * be treated as unavailable/ambiguous by the caller.
   */
  async activeTasks(signal?: AbortSignal): Promise<CodexHostTaskContext[]> {
    if (this.#isStopped() || signal?.aborted) return [];
    const byTask = new Map<string, CodexHostTaskContext>();
    for (const attachment of this.#attachments.values()) {
      if (signal?.aborted) return [];
      const contextId = attachment.mainExecutionContextId;
      if (
        contextId === undefined ||
        attachment.connection.isClosed() ||
        attachment.invalidated
      ) {
        continue;
      }
      try {
        const evaluated = await attachment.connection.send("Runtime.evaluate", {
          expression: createReadCodexHostTaskContextExpression(),
          contextId,
          returnByValue: true,
          awaitPromise: true,
        });
        const task = parseCodexHostTaskContext(runtimeValue(evaluated));
        if (task !== undefined) {
          byTask.set(`${task.hostId}\u0000${task.threadId}`, task);
        }
      } catch {
        // One invalid or closing target cannot authorize a bind.
        return [];
      }
    }
    return [...byTask.values()];
  }

  stop(): Promise<CodexCdpHostAdapterStatus> {
    if (this.#stopPromise !== undefined) return this.#stopPromise;
    if (this.#isStopped()) return Promise.resolve(this.status());
    this.#state = "stopped";
    this.#stopController.abort(new Error("pointable host stopped"));
    const stopping = (async (): Promise<CodexCdpHostAdapterStatus> => {
      await this.#refreshPromise?.catch(() => undefined);
      await Promise.all(
        [...new Set([...this.#attachments.values(), ...this.#attaching])]
          .map((attachment) => this.#detach(attachment)),
      );
      await Promise.all([...this.#recoveries].map((recovery) =>
        recovery.catch(() => undefined)));
      await Promise.all(
        [...new Set([...this.#attachments.values(), ...this.#attaching])]
          .map((attachment) => this.#detach(attachment)),
      );
      return this.status();
    })();
    this.#stopPromise = stopping;
    return stopping;
  }

  async #attach(target: CodexCdpTarget, signal: AbortSignal): Promise<void> {
    if (this.#isStopped() || signal.aborted) return;
    const connection = await connectWithAbort(
      this.#connect(target.webSocketDebuggerUrl, signal),
      signal,
    );
    const bindingGeneration = randomUUID();
    const bindingName = `__pointableContextBinding_${bindingGeneration.replaceAll("-", "_")}`;
    const attachment: TargetAttachment = {
      target,
      connection,
      unsubscribeEvent: () => undefined,
      unsubscribeClose: () => undefined,
      bindingName,
      bindingGeneration,
      bindingAdded: false,
      pending: new Map(),
      inFlight: new Set(),
      mainFrameId: "",
      contextWaiters: new Set(),
      lifecycleController: new AbortController(),
      invalidated: false,
      detached: false,
    };
    this.#attaching.add(attachment);
    attachment.unsubscribeEvent = connection.onEvent((event) =>
      this.#onEvent(attachment, event));
    attachment.unsubscribeClose = connection.onClose(() => {
      this.#invalidateAttachment(attachment);
    });
    try {
      if (this.#isStopped() || signal.aborted) {
        await this.#detach(attachment);
        return;
      }
      await connection.send("Page.enable");
      if (this.#isStopped() || signal.aborted) {
        await this.#detach(attachment);
        return;
      }
      attachment.mainFrameId = parseMainFrameId(
        await connection.send("Page.getFrameTree"),
        target,
      );
      await connection.send("Runtime.enable");
      const contextId = await waitForMainContext(
        attachment,
        AbortSignal.any([signal, attachment.lifecycleController.signal]),
      );
      if (
        this.#isStopped() ||
        signal.aborted ||
        attachment.invalidated ||
        connection.isClosed()
      ) {
        await this.#detach(attachment);
        return;
      }
      attachment.mainExecutionContextId = contextId;
      await connection.send("Runtime.addBinding", { name: bindingName });
      attachment.bindingAdded = true;
      if (this.#isStopped() || signal.aborted || attachment.invalidated) {
        await this.#detach(attachment);
        return;
      }
      const rendererConfig = {
        bindingName,
        requestTimeoutMs: this.#lookupTimeoutMs,
        ...(this.#actionLabel === undefined
          ? {}
          : { actionLabel: this.#actionLabel }),
        ...(this.#presentationMode === undefined
          ? {}
          : { presentationMode: this.#presentationMode }),
      };
      const installed = await connection.send("Runtime.evaluate", {
        expression: createInstallPointableRendererExpression(rendererConfig),
        contextId,
        returnByValue: true,
        awaitPromise: true,
      });
      const rendererStatus = parseInstalledStatus(
        runtimeValue(installed),
        bindingName,
      );
      attachment.rendererLifecycleId = rendererStatus.lifecycleId;
      if (
        this.#isStopped() ||
        signal.aborted ||
        attachment.invalidated ||
        connection.isClosed()
      ) {
        await this.#detach(attachment);
        return;
      }
      if (this.#attachments.has(target.id)) {
        await this.#detach(attachment);
        return;
      }
      this.#attachments.set(target.id, attachment);
    } catch (error) {
      await this.#detach(attachment);
      if (this.#isStopped() || signal.aborted) return;
      throw error;
    } finally {
      this.#attaching.delete(attachment);
    }
  }

  async #onEvent(attachment: TargetAttachment, event: CdpEvent): Promise<void> {
    if (attachment.detached) return;
    const contextId = mainExecutionContext(event, attachment.mainFrameId);
    if (contextId !== undefined) {
      if (
        attachment.mainExecutionContextId !== undefined &&
        attachment.mainExecutionContextId !== contextId
      ) {
        this.#invalidateAttachment(attachment);
        return;
      }
      attachment.mainExecutionContextId = contextId;
      for (const waiter of attachment.contextWaiters) waiter(contextId);
      attachment.contextWaiters.clear();
      return;
    }
    if (event.method === "Runtime.executionContextsCleared") {
      this.#invalidateAttachment(attachment);
      return;
    }
    if (
      event.method === "Runtime.executionContextDestroyed" &&
      record(event.params) &&
      event.params.executionContextId === attachment.mainExecutionContextId
    ) {
      this.#invalidateAttachment(attachment);
      return;
    }
    if (
      event.method === "Page.frameNavigated" &&
      record(event.params) &&
      record(event.params.frame) &&
      event.params.frame.id === attachment.mainFrameId &&
      attachment.mainFrameId.length > 0
    ) {
      this.#invalidateAttachment(attachment);
      return;
    }
    if (event.method !== "Runtime.bindingCalled" || !record(event.params)) return;
    if (
      event.params.name !== attachment.bindingName ||
      typeof event.params.payload !== "string" ||
      event.params.executionContextId !== attachment.mainExecutionContextId ||
      this.#attachments.get(attachment.target.id) !== attachment ||
      attachment.rendererLifecycleId === undefined ||
      attachment.invalidated
    ) {
      return;
    }
    let intent: PointableLookupIntentV1;
    try {
      intent = parsePointableLookupIntent(event.params.payload);
    } catch {
      return;
    }
    if (
      attachment.inFlight.has(intent.requestId) ||
      attachment.inFlight.size >= this.#maxConcurrentLookupsPerTarget
    ) {
      return;
    }
    attachment.inFlight.add(intent.requestId);
    let controller: AbortController | undefined;
    try {
      if (!(await this.#rendererFenceCurrent(attachment, intent))) return;
      const hostTask = await this.#readHostTaskContext(attachment, intent);
      if (hostTask === false) return;
      controller = new AbortController();
      attachment.pending.set(intent.requestId, {
        controller,
        digest: intent.selectionDigest,
        generation: intent.selectionGeneration,
      });
      let presentation: PointableLookupPresentation;
      try {
        const callbackResult = await boundedLookup(
          (lookupSignal) => this.#lookup({
            operation: intent.operation,
            requestId: intent.requestId,
            selection: {
              text: intent.selectionText,
              digest: intent.selectionDigest,
              generation: intent.selectionGeneration,
              surface: intent.surface,
            },
            contextFingerprint: intent.contextFingerprint,
            requestedAt: intent.requestedAt,
            ...(intent.candidateRef === undefined
              ? {}
              : { candidateRef: intent.candidateRef }),
            ...(intent.detailRef === undefined
              ? {}
              : { detailRef: intent.detailRef }),
            host: {
              targetId: attachment.target.id,
              targetUrl: attachment.target.url,
              bindingGeneration: attachment.bindingGeneration,
              ...(hostTask === undefined
                ? {}
                : {
                  task: hostTask,
                  revalidateTask: async (signal?: AbortSignal) => {
                    if (signal?.aborted) return undefined;
                    const current = await this.#readHostTaskContext(attachment, intent);
                    return current === false ? undefined : current;
                  },
                }),
            },
            signal: lookupSignal,
          }),
          this.#lookupTimeoutMs,
          controller,
        );
        presentation = validatePointableLookupPresentation(callbackResult);
      } catch (error) {
        if (error instanceof PointableProtocolError) {
          presentation = lookupError(
            "invalid_lookup_result",
            "查询提供方返回了无效结果。",
            false,
          );
        } else if (
          error instanceof Error &&
          error.message === "pointable_lookup_timeout"
        ) {
          presentation = lookupError("lookup_timeout", "查询超时，请重试。", true);
        } else if (controller.signal.aborted) {
          return;
        } else {
          presentation = lookupError(
            "lookup_failed",
            "上下文详情暂时不可用。",
            true,
          );
        }
      }
      const pending = attachment.pending.get(intent.requestId);
      if (
        pending === undefined ||
        pending.digest !== intent.selectionDigest ||
        pending.generation !== intent.selectionGeneration ||
        this.#attachments.get(attachment.target.id) !== attachment ||
        attachment.connection.isClosed() ||
        attachment.invalidated
      ) {
        return;
      }
      if (!(await this.#rendererFenceCurrent(attachment, intent))) return;
      await this.#deliver(attachment, intent, presentation);
    } finally {
      if (controller !== undefined) attachment.pending.delete(intent.requestId);
      attachment.inFlight.delete(intent.requestId);
    }
  }

  async #readHostTaskContext(
    attachment: TargetAttachment,
    intent: PointableLookupIntentV1,
  ): Promise<CodexHostTaskContext | undefined | false> {
    const contextId = attachment.mainExecutionContextId;
    if (
      contextId === undefined ||
      this.#attachments.get(attachment.target.id) !== attachment ||
      attachment.connection.isClosed() ||
      attachment.invalidated
    ) {
      return false;
    }
    try {
      const evaluated = await attachment.connection.send("Runtime.evaluate", {
        expression: createReadCodexHostTaskContextExpression(),
        contextId,
        returnByValue: true,
        awaitPromise: true,
      });
      return parseCodexHostTaskContext(
        runtimeValue(evaluated),
        intent.contextFingerprint,
      );
    } catch {
      return false;
    }
  }

  async #rendererFenceCurrent(
    attachment: TargetAttachment,
    intent: PointableLookupIntentV1,
  ): Promise<boolean> {
    const contextId = attachment.mainExecutionContextId;
    const lifecycleId = attachment.rendererLifecycleId;
    if (
      contextId === undefined ||
      lifecycleId === undefined ||
      this.#attachments.get(attachment.target.id) !== attachment ||
      attachment.connection.isClosed() ||
      attachment.invalidated
    ) {
      return false;
    }
    try {
      const evaluated = await attachment.connection.send("Runtime.evaluate", {
        expression: createVerifyPointableRendererFenceExpression({
          requestId: intent.requestId,
          selectionGeneration: intent.selectionGeneration,
          selectionDigest: intent.selectionDigest,
          contextFingerprint: intent.contextFingerprint,
        }, lifecycleId),
        contextId,
        returnByValue: true,
        awaitPromise: true,
      });
      return runtimeValue(evaluated) === true;
    } catch {
      return false;
    }
  }

  async #deliver(
    attachment: TargetAttachment,
    intent: PointableLookupIntentV1,
    presentation: PointableLookupPresentation,
  ): Promise<void> {
    const contextId = attachment.mainExecutionContextId;
    const lifecycleId = attachment.rendererLifecycleId;
    if (
      contextId === undefined ||
      lifecycleId === undefined ||
      this.#attachments.get(attachment.target.id) !== attachment ||
      attachment.connection.isClosed() ||
      attachment.invalidated
    ) {
      return;
    }
    const response = createPointableLookupResponse(intent, presentation);
    await attachment.connection.send("Runtime.evaluate", {
      expression: createDeliverPointableResultExpression(response, lifecycleId),
      contextId,
      returnByValue: true,
      awaitPromise: true,
    });
  }

  #invalidateAttachment(attachment: TargetAttachment): void {
    if (attachment.invalidated || attachment.detached) return;
    attachment.invalidated = true;
    attachment.lifecycleController.abort(
      new Error("pointable renderer context invalidated"),
    );
    for (const pending of attachment.pending.values()) {
      pending.controller.abort(new Error("pointable renderer context invalidated"));
    }
    attachment.pending.clear();
    attachment.inFlight.clear();
    if (
      this.#attachments.get(attachment.target.id) !== attachment ||
      this.#isStopped() ||
      this.#recoveringTargets.has(attachment.target.id)
    ) {
      return;
    }
    this.#attachments.delete(attachment.target.id);
    this.#recoveringTargets.add(attachment.target.id);
    const recovery = (async (): Promise<void> => {
      await this.#detach(attachment);
      if (!this.#isStopped()) {
        await this.refreshTargets().catch(() => undefined);
      }
    })().finally(() => {
      this.#recoveringTargets.delete(attachment.target.id);
      this.#recoveries.delete(recovery);
    });
    this.#recoveries.add(recovery);
  }

  #detach(attachment: TargetAttachment): Promise<void> {
    if (attachment.detachPromise !== undefined) return attachment.detachPromise;
    const detach = this.#performDetach(attachment);
    attachment.detachPromise = detach;
    return detach;
  }

  async #performDetach(attachment: TargetAttachment): Promise<void> {
    attachment.detached = true;
    attachment.invalidated = true;
    attachment.lifecycleController.abort(new Error("pointable host detached"));
    if (this.#attachments.get(attachment.target.id) === attachment) {
      this.#attachments.delete(attachment.target.id);
    }
    this.#attaching.delete(attachment);
    attachment.unsubscribeEvent();
    attachment.unsubscribeClose();
    attachment.contextWaiters.clear();
    for (const pending of attachment.pending.values()) {
      pending.controller.abort(new Error("pointable host detached"));
    }
    attachment.pending.clear();
    attachment.inFlight.clear();
    if (!attachment.connection.isClosed()) {
      if (
        attachment.rendererLifecycleId !== undefined &&
        attachment.mainExecutionContextId !== undefined
      ) {
        await attachment.connection.send("Runtime.evaluate", {
          expression: createUninstallPointableRendererExpression(
            attachment.rendererLifecycleId,
          ),
          contextId: attachment.mainExecutionContextId,
          returnByValue: true,
          awaitPromise: true,
        }).catch(() => undefined);
      }
      if (attachment.bindingAdded) {
        await attachment.connection.send("Runtime.removeBinding", {
          name: attachment.bindingName,
        }).catch(() => undefined);
      }
      attachment.connection.close();
    }
  }
}

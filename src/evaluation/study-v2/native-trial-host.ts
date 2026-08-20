import { randomBytes, randomUUID } from "node:crypto";
import {
  discoverCodexAppTargets,
  type PointableFetch,
} from "../../host/codex-cdp/targets.js";
import {
  connectCdpWebSocket,
  type CdpConnection,
  type CdpConnectionFactory,
  type CdpEvent,
} from "../../host/codex-cdp/transport.js";
import {
  createActivateStudyV2NativeTrialExpression,
  createInstallStudyV2NativeTrialExpression,
  createUninstallStudyV2NativeTrialExpression,
  type StudyV2NativeRendererStatus,
} from "./native-trial-renderer.js";
import {
  createActivateStudyV2NativeAnswerControlExpression,
  createInstallStudyV2NativeAnswerControlExpression,
  createUninstallStudyV2NativeAnswerControlExpression,
} from "./native-answer-control-renderer.js";
import {
  parseStudyV2NativeEvent,
  type StudyV2NativeEvent,
  type StudyV2NativeTrialSurfaceConfig,
} from "./native-trial-protocol.js";
import {
  createReadCodexHostTaskContextExpression,
  parseCodexHostTaskContext,
} from "../../host/codex-cdp/host-context.js";

export interface StudyV2NativeTrialHostOptions {
  endpoint?: string;
  fetch?: PointableFetch;
  connect?: CdpConnectionFactory;
  discoveryTimeoutMs?: number;
  onEvent?: (event: StudyV2NativeEvent) => void | Promise<void>;
  surfaceMode?: "legacy_overlay" | "answer_control";
  expectedThreadId?: string;
}

export interface StudyV2NativeTrialHostStatus {
  state: "idle" | "running" | "stopped";
  endpoint: string;
  targetId?: string;
  executionContextId?: number;
  bindingName?: string;
  trialId?: string;
  surfaceMode: "legacy_overlay" | "answer_control";
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runtimeValue(value: unknown): unknown {
  if (!record(value) || !record(value.result) || value.exceptionDetails !== undefined) {
    return undefined;
  }
  return value.result.value;
}

function frameIdFrom(value: unknown, expectedUrl: string): string {
  if (
    !record(value) || !record(value.frameTree) || !record(value.frameTree.frame) ||
    typeof value.frameTree.frame.id !== "string" || value.frameTree.frame.url !== expectedUrl
  ) {
    throw new Error("study_v2_native_main_frame_invalid");
  }
  return value.frameTree.frame.id;
}

function defaultContextId(event: CdpEvent, frameId: string): number | undefined {
  if (event.method !== "Runtime.executionContextCreated" || !record(event.params)) return undefined;
  const context = event.params.context;
  if (!record(context) || !Number.isSafeInteger(context.id) || Number(context.id) < 1) return undefined;
  const auxiliary = context.auxData;
  if (!record(auxiliary) || auxiliary.isDefault !== true || auxiliary.frameId !== frameId) return undefined;
  return Number(context.id);
}

function rendererStatus(value: unknown, config: StudyV2NativeTrialSurfaceConfig): StudyV2NativeRendererStatus {
  if (
    !record(value) || value.installed !== true || value.trialToken !== config.trialToken ||
    value.trialId !== config.trialId || value.state !== "armed"
  ) {
    throw new Error("study_v2_native_install_unverified");
  }
  return value as unknown as StudyV2NativeRendererStatus;
}

export class StudyV2NativeTrialHost {
  readonly #endpoint: string;
  readonly #fetch: PointableFetch | undefined;
  readonly #connect: CdpConnectionFactory;
  readonly #discoveryTimeoutMs: number;
  readonly #onEvent: ((event: StudyV2NativeEvent) => void | Promise<void>) | undefined;
  readonly #surfaceMode: "legacy_overlay" | "answer_control";
  readonly #expectedThreadId: string | undefined;
  #state: StudyV2NativeTrialHostStatus["state"] = "idle";
  #connection?: CdpConnection;
  #unsubscribeEvent?: () => void;
  #unsubscribeClose?: () => void;
  #targetId?: string;
  #mainFrameId?: string;
  #contextId?: number;
  #bindingName?: string;
  #bindingAdded = false;
  #activated = false;
  #config?: StudyV2NativeTrialSurfaceConfig;
  #lastSequence = 0;
  #terminal?: StudyV2NativeEvent;
  #terminalResolve?: (event: StudyV2NativeEvent) => void;
  #terminalReject?: (error: Error) => void;
  #terminalPromise?: Promise<StudyV2NativeEvent>;
  #stopPromise?: Promise<StudyV2NativeTrialHostStatus>;

  constructor(options: StudyV2NativeTrialHostOptions = {}) {
    this.#endpoint = options.endpoint ?? "http://127.0.0.1:9223";
    this.#fetch = options.fetch;
    this.#connect = options.connect ?? connectCdpWebSocket;
    this.#discoveryTimeoutMs = options.discoveryTimeoutMs ?? 2_000;
    this.#onEvent = options.onEvent;
    this.#surfaceMode = options.surfaceMode ?? "legacy_overlay";
    if (options.expectedThreadId !== undefined && !/^[A-Za-z0-9:_-]{1,256}$/u.test(options.expectedThreadId)) {
      throw new Error("study_v2_native_task_identity_invalid");
    }
    this.#expectedThreadId = options.expectedThreadId;
  }

  status(): StudyV2NativeTrialHostStatus {
    return {
      state: this.#state,
      endpoint: this.#endpoint,
      surfaceMode: this.#surfaceMode,
      ...(this.#targetId === undefined ? {} : { targetId: this.#targetId }),
      ...(this.#contextId === undefined ? {} : { executionContextId: this.#contextId }),
      ...(this.#bindingName === undefined ? {} : { bindingName: this.#bindingName }),
      ...(this.#config === undefined ? {} : { trialId: this.#config.trialId }),
    };
  }

  async start(
    baseConfig: Omit<StudyV2NativeTrialSurfaceConfig, "bindingName" | "trialToken">,
    signal?: AbortSignal,
  ): Promise<StudyV2NativeTrialHostStatus> {
    if (this.#state !== "idle") throw new Error("study_v2_native_host_already_started");
    if (signal?.aborted) throw new Error("study_v2_native_start_aborted");
    const targets = await discoverCodexAppTargets(this.#endpoint, {
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
      timeoutMs: this.#discoveryTimeoutMs,
      ...(signal === undefined ? {} : { signal }),
    });
    if (targets.length !== 1) throw new Error("study_v2_native_requires_one_codex_target");
    const target = targets[0];
    if (target === undefined) throw new Error("study_v2_native_requires_one_codex_target");
    const bindingName = `__pointableStudyBinding_${randomUUID().replaceAll("-", "_")}`;
    const config: StudyV2NativeTrialSurfaceConfig = {
      ...baseConfig,
      bindingName,
      trialToken: randomBytes(32).toString("hex"),
    };
    const connection = await this.#connect(target.webSocketDebuggerUrl, signal);
    this.#connection = connection;
    this.#targetId = target.id;
    this.#bindingName = bindingName;
    this.#config = config;
    this.#terminalPromise = new Promise<StudyV2NativeEvent>((resolve, reject) => {
      this.#terminalResolve = resolve;
      this.#terminalReject = reject;
    });
    // The transport may close between start and the caller attaching
    // waitForTerminal(). Keep the original promise rejectable for that caller,
    // but attach an immediate observer so an expected startup cleanup cannot
    // become a process-level unhandled rejection.
    void this.#terminalPromise.catch(() => undefined);
    this.#unsubscribeEvent = connection.onEvent((event) => this.#handleEvent(event));
    this.#unsubscribeClose = connection.onClose(() => {
      if (this.#state !== "stopped" && this.#terminal === undefined) {
        this.#terminalReject?.(new Error("study_v2_native_transport_closed"));
      }
    });
    try {
      await connection.send("Page.enable");
      this.#mainFrameId = frameIdFrom(await connection.send("Page.getFrameTree"), target.url);
      const contextPromise = this.#waitForMainContext(signal);
      await connection.send("Runtime.enable");
      this.#contextId = await contextPromise;
      if (!(await this.#expectedTaskIsCurrent())) {
        throw new Error("study_v2_native_task_not_active");
      }
      if (this.#surfaceMode === "legacy_overlay") {
        const pointableStatus = runtimeValue(await connection.send("Runtime.evaluate", {
          expression: "window.__pointableContextRenderer?.status?.() ?? null",
          contextId: this.#contextId,
          returnByValue: true,
          awaitPromise: true,
        }));
        if (record(pointableStatus) && pointableStatus.installed === true) {
          throw new Error("study_v2_native_existing_pointable_companion");
        }
      }
      await connection.send("Runtime.addBinding", { name: bindingName });
      this.#bindingAdded = true;
      const installed = await connection.send("Runtime.evaluate", {
        expression: this.#surfaceMode === "answer_control"
          ? createInstallStudyV2NativeAnswerControlExpression(config)
          : createInstallStudyV2NativeTrialExpression(config),
        contextId: this.#contextId,
        returnByValue: true,
        awaitPromise: true,
      });
      rendererStatus(runtimeValue(installed), config);
      this.#state = "running";
      return this.status();
    } catch (error) {
      await this.stop("aborted");
      throw error;
    }
  }

  async activate(): Promise<StudyV2NativeTrialHostStatus> {
    if (
      this.#state !== "running" || this.#connection === undefined ||
      this.#connection.isClosed() || this.#contextId === undefined || this.#config === undefined
    ) {
      throw new Error("study_v2_native_host_not_ready");
    }
    if (this.#activated) return this.status();
    this.#activated = true;
    try {
      const activated = await this.#connection.send("Runtime.evaluate", {
        expression: this.#surfaceMode === "answer_control"
          ? createActivateStudyV2NativeAnswerControlExpression(this.#config.trialToken)
          : createActivateStudyV2NativeTrialExpression(this.#config.trialToken),
        contextId: this.#contextId,
        returnByValue: true,
        awaitPromise: true,
      });
      const value = runtimeValue(activated);
      if (!record(value) || value.installed !== true || value.state !== "running" ||
        value.trialToken !== this.#config.trialToken) {
        throw new Error("study_v2_native_activation_unverified");
      }
      return this.status();
    } catch (error) {
      this.#activated = false;
      throw error;
    }
  }

  async waitForTerminal(signal?: AbortSignal): Promise<StudyV2NativeEvent> {
    if (this.#terminal !== undefined) return this.#terminal;
    const terminal = this.#terminalPromise;
    if (terminal === undefined) throw new Error("study_v2_native_host_not_started");
    if (signal === undefined) return terminal;
    if (signal.aborted) throw new Error("study_v2_native_wait_aborted");
    return await new Promise<StudyV2NativeEvent>((resolve, reject) => {
      const abort = (): void => reject(new Error("study_v2_native_wait_aborted"));
      signal.addEventListener("abort", abort, { once: true });
      terminal.then(
        (value) => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
    });
  }

  stop(
    reason: "aborted" | "completed" | "timed_out" = "aborted",
  ): Promise<StudyV2NativeTrialHostStatus> {
    if (this.#stopPromise !== undefined) return this.#stopPromise;
    const stopping = this.#performStop(reason);
    this.#stopPromise = stopping;
    return stopping;
  }

  async #performStop(
    reason: "aborted" | "completed" | "timed_out",
  ): Promise<StudyV2NativeTrialHostStatus> {
    this.#state = "stopped";
    this.#unsubscribeEvent?.();
    this.#unsubscribeClose?.();
    const connection = this.#connection;
    if (connection !== undefined && !connection.isClosed()) {
      if (this.#config !== undefined && this.#contextId !== undefined) {
        await connection.send("Runtime.evaluate", {
          expression: this.#surfaceMode === "answer_control"
            ? createUninstallStudyV2NativeAnswerControlExpression(this.#config.trialToken, reason)
            : createUninstallStudyV2NativeTrialExpression(this.#config.trialToken, reason),
          contextId: this.#contextId,
          returnByValue: true,
          awaitPromise: true,
        }).catch(() => undefined);
      }
      if (this.#bindingAdded && this.#bindingName !== undefined) {
        await connection.send("Runtime.removeBinding", { name: this.#bindingName }).catch(() => undefined);
      }
      connection.close();
    }
    return this.status();
  }

  #waitForMainContext(signal?: AbortSignal): Promise<number> {
    if (this.#contextId !== undefined) return Promise.resolve(this.#contextId);
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("study_v2_native_main_context_timeout"));
      }, 2_000);
      const cleanup = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.#contextWaiter = undefined;
      };
      const abort = (): void => {
        cleanup();
        reject(new Error("study_v2_native_start_aborted"));
      };
      this.#contextWaiter = (contextId) => {
        cleanup();
        resolve(contextId);
      };
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  #contextWaiter: ((contextId: number) => void) | undefined;

  async #handleEvent(event: CdpEvent): Promise<void> {
    const mainFrameId = this.#mainFrameId;
    if (mainFrameId !== undefined) {
      const contextId = defaultContextId(event, mainFrameId);
      if (contextId !== undefined) {
        if (this.#contextId !== undefined && this.#contextId !== contextId) {
          this.#terminalReject?.(new Error("study_v2_native_context_changed"));
          return;
        }
        this.#contextId = contextId;
        this.#contextWaiter?.(contextId);
        return;
      }
    }
    if (
      event.method === "Runtime.executionContextsCleared" ||
      (event.method === "Runtime.executionContextDestroyed" &&
        event.params?.executionContextId === this.#contextId) ||
      (event.method === "Page.frameNavigated" && record(event.params) &&
        record(event.params.frame) && event.params.frame.id === this.#mainFrameId)
    ) {
      if (this.#terminal === undefined) this.#terminalReject?.(new Error("study_v2_native_context_changed"));
      return;
    }
    if (
      event.method !== "Runtime.bindingCalled" || !record(event.params) ||
      event.params.name !== this.#bindingName ||
      event.params.executionContextId !== this.#contextId ||
      typeof event.params.payload !== "string" || this.#config === undefined || !this.#activated
    ) {
      return;
    }
    if (!(await this.#expectedTaskIsCurrent())) return;
    let parsed: StudyV2NativeEvent;
    try {
      parsed = parseStudyV2NativeEvent(event.params.payload, this.#config.trialToken);
    } catch {
      return;
    }
    if (parsed.sequence !== this.#lastSequence + 1) return;
    this.#lastSequence = parsed.sequence;
    await this.#onEvent?.(parsed);
    if (
      parsed.eventType === "answer_submitted" ||
      parsed.eventType === "trial_timed_out" ||
      parsed.eventType === "trial_aborted"
    ) {
      this.#terminal = parsed;
      this.#terminalResolve?.(parsed);
    }
  }

  async #expectedTaskIsCurrent(): Promise<boolean> {
    const expected = this.#expectedThreadId;
    if (expected === undefined) return true;
    const connection = this.#connection;
    const contextId = this.#contextId;
    if (connection === undefined || connection.isClosed() || contextId === undefined) return false;
    try {
      const evaluated = await connection.send("Runtime.evaluate", {
        expression: createReadCodexHostTaskContextExpression(),
        contextId,
        returnByValue: true,
        awaitPromise: true,
      });
      const current = parseCodexHostTaskContext(runtimeValue(evaluated));
      return current !== undefined && (
        current.threadId === expected || current.threadId === `${current.hostId}:${expected}`
      );
    } catch {
      return false;
    }
  }
}

import { randomBytes, randomUUID } from "node:crypto";
import { discoverCodexAppTargets, type PointableFetch } from "../../host/codex-cdp/targets.js";
import {
  connectCdpWebSocket,
  type CdpConnection,
  type CdpConnectionFactory,
  type CdpEvent,
} from "../../host/codex-cdp/transport.js";
import {
  createActivateStudyV2NativeQuestionnaireExpression,
  createInstallStudyV2NativeQuestionnaireExpression,
  createUninstallStudyV2NativeQuestionnaireExpression,
  type StudyV2NativeQuestionnaireRendererStatus,
} from "./native-questionnaire-renderer.js";
import {
  parseStudyV2NativeQuestionnaireEvent,
  type StudyV2NativeQuestionnaireEvent,
  type StudyV2NativeQuestionnaireSurfaceConfig,
} from "./native-questionnaire-protocol.js";

export interface StudyV2NativeQuestionnaireHostOptions {
  endpoint?: string;
  fetch?: PointableFetch;
  connect?: CdpConnectionFactory;
  discoveryTimeoutMs?: number;
}

export interface StudyV2NativeQuestionnaireHostStatus {
  state: "idle" | "running" | "stopped";
  endpoint: string;
  targetId?: string;
  executionContextId?: number;
  bindingName?: string;
  sessionId?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runtimeValue(value: unknown): unknown {
  if (!record(value) || !record(value.result) || value.exceptionDetails !== undefined) return undefined;
  return value.result.value;
}

function frameIdFrom(value: unknown, expectedUrl: string): string {
  if (!record(value) || !record(value.frameTree) || !record(value.frameTree.frame) ||
    typeof value.frameTree.frame.id !== "string" || value.frameTree.frame.url !== expectedUrl) {
    throw new Error("study_v2_questionnaire_main_frame_invalid");
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

function installedStatus(
  value: unknown,
  config: StudyV2NativeQuestionnaireSurfaceConfig,
): StudyV2NativeQuestionnaireRendererStatus {
  if (!record(value) || value.installed !== true || value.sessionToken !== config.sessionToken ||
    value.sessionId !== config.sessionId || value.state !== "armed") {
    throw new Error("study_v2_questionnaire_install_unverified");
  }
  return value as unknown as StudyV2NativeQuestionnaireRendererStatus;
}

export class StudyV2NativeQuestionnaireHost {
  readonly #endpoint: string;
  readonly #fetch: PointableFetch | undefined;
  readonly #connect: CdpConnectionFactory;
  readonly #discoveryTimeoutMs: number;
  #state: StudyV2NativeQuestionnaireHostStatus["state"] = "idle";
  #connection?: CdpConnection;
  #unsubscribeEvent?: () => void;
  #unsubscribeClose?: () => void;
  #targetId?: string;
  #mainFrameId?: string;
  #contextId?: number;
  #contextWaiter: ((contextId: number) => void) | undefined;
  #bindingName?: string;
  #bindingAdded = false;
  #activated = false;
  #config?: StudyV2NativeQuestionnaireSurfaceConfig;
  #terminal?: StudyV2NativeQuestionnaireEvent;
  #terminalResolve?: (event: StudyV2NativeQuestionnaireEvent) => void;
  #terminalReject?: (error: Error) => void;
  #terminalPromise?: Promise<StudyV2NativeQuestionnaireEvent>;
  #stopPromise?: Promise<StudyV2NativeQuestionnaireHostStatus>;

  constructor(options: StudyV2NativeQuestionnaireHostOptions = {}) {
    this.#endpoint = options.endpoint ?? "http://127.0.0.1:9223";
    this.#fetch = options.fetch;
    this.#connect = options.connect ?? connectCdpWebSocket;
    this.#discoveryTimeoutMs = options.discoveryTimeoutMs ?? 2_000;
  }

  status(): StudyV2NativeQuestionnaireHostStatus {
    return {
      state: this.#state,
      endpoint: this.#endpoint,
      ...(this.#targetId === undefined ? {} : { targetId: this.#targetId }),
      ...(this.#contextId === undefined ? {} : { executionContextId: this.#contextId }),
      ...(this.#bindingName === undefined ? {} : { bindingName: this.#bindingName }),
      ...(this.#config === undefined ? {} : { sessionId: this.#config.sessionId }),
    };
  }

  async start(
    baseConfig: Pick<StudyV2NativeQuestionnaireSurfaceConfig, "sessionId" | "language" | "timeoutMs">,
    signal?: AbortSignal,
  ): Promise<StudyV2NativeQuestionnaireHostStatus> {
    if (this.#state !== "idle") throw new Error("study_v2_questionnaire_host_already_started");
    if (signal?.aborted) throw new Error("study_v2_questionnaire_start_aborted");
    const targets = await discoverCodexAppTargets(this.#endpoint, {
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
      timeoutMs: this.#discoveryTimeoutMs,
      ...(signal === undefined ? {} : { signal }),
    });
    if (targets.length !== 1) throw new Error("study_v2_questionnaire_requires_one_codex_target");
    const target = targets[0];
    if (target === undefined) throw new Error("study_v2_questionnaire_requires_one_codex_target");
    const bindingName = `__pointableStudyQuestionnaireBinding_${randomUUID().replaceAll("-", "_")}`;
    const config: StudyV2NativeQuestionnaireSurfaceConfig = {
      ...baseConfig,
      bindingName,
      sessionToken: randomBytes(32).toString("hex"),
    };
    const connection = await this.#connect(target.webSocketDebuggerUrl, signal);
    this.#connection = connection;
    this.#targetId = target.id;
    this.#bindingName = bindingName;
    this.#config = config;
    this.#terminalPromise = new Promise((resolve, reject) => {
      this.#terminalResolve = resolve;
      this.#terminalReject = reject;
    });
    this.#unsubscribeEvent = connection.onEvent((event) => this.#handleEvent(event));
    this.#unsubscribeClose = connection.onClose(() => {
      if (this.#terminal === undefined) this.#terminalReject?.(new Error("study_v2_questionnaire_transport_closed"));
    });
    try {
      await connection.send("Page.enable");
      this.#mainFrameId = frameIdFrom(await connection.send("Page.getFrameTree"), target.url);
      const contextPromise = this.#waitForMainContext(signal);
      await connection.send("Runtime.enable");
      this.#contextId = await contextPromise;
      await connection.send("Runtime.addBinding", { name: bindingName });
      this.#bindingAdded = true;
      const installed = await connection.send("Runtime.evaluate", {
        expression: createInstallStudyV2NativeQuestionnaireExpression(config),
        contextId: this.#contextId,
        returnByValue: true,
        awaitPromise: true,
      });
      installedStatus(runtimeValue(installed), config);
      this.#state = "running";
      return this.status();
    } catch (error) {
      await this.stop("aborted");
      throw error;
    }
  }

  async activate(): Promise<StudyV2NativeQuestionnaireHostStatus> {
    if (this.#state !== "running" || this.#connection === undefined || this.#connection.isClosed() ||
      this.#contextId === undefined || this.#config === undefined) {
      throw new Error("study_v2_questionnaire_host_not_ready");
    }
    if (this.#activated) return this.status();
    const activated = await this.#connection.send("Runtime.evaluate", {
      expression: createActivateStudyV2NativeQuestionnaireExpression(this.#config.sessionToken),
      contextId: this.#contextId,
      returnByValue: true,
      awaitPromise: true,
    });
    const value = runtimeValue(activated);
    if (!record(value) || value.installed !== true || value.state !== "running" ||
      value.sessionToken !== this.#config.sessionToken) {
      throw new Error("study_v2_questionnaire_activation_unverified");
    }
    this.#activated = true;
    return this.status();
  }

  async waitForTerminal(signal?: AbortSignal): Promise<StudyV2NativeQuestionnaireEvent> {
    if (this.#terminal !== undefined) return this.#terminal;
    const terminal = this.#terminalPromise;
    if (terminal === undefined) throw new Error("study_v2_questionnaire_host_not_started");
    if (signal === undefined) return terminal;
    if (signal.aborted) throw new Error("study_v2_questionnaire_wait_aborted");
    return await new Promise((resolve, reject) => {
      const abort = (): void => reject(new Error("study_v2_questionnaire_wait_aborted"));
      signal.addEventListener("abort", abort, { once: true });
      terminal.then(
        (value) => { signal.removeEventListener("abort", abort); resolve(value); },
        (error: unknown) => { signal.removeEventListener("abort", abort); reject(error); },
      );
    });
  }

  stop(
    reason: "aborted" | "completed" | "timed_out" = "aborted",
  ): Promise<StudyV2NativeQuestionnaireHostStatus> {
    if (this.#stopPromise !== undefined) return this.#stopPromise;
    this.#stopPromise = this.#performStop(reason);
    return this.#stopPromise;
  }

  async #performStop(
    reason: "aborted" | "completed" | "timed_out",
  ): Promise<StudyV2NativeQuestionnaireHostStatus> {
    this.#state = "stopped";
    const connection = this.#connection;
    if (connection !== undefined && !connection.isClosed()) {
      if (this.#config !== undefined && this.#contextId !== undefined) {
        await connection.send("Runtime.evaluate", {
          expression: createUninstallStudyV2NativeQuestionnaireExpression(this.#config.sessionToken, reason),
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
    this.#unsubscribeEvent?.();
    this.#unsubscribeClose?.();
    return this.status();
  }

  #waitForMainContext(signal?: AbortSignal): Promise<number> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error("study_v2_questionnaire_main_context_timeout")); }, 2_000);
      const cleanup = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.#contextWaiter = undefined;
      };
      const abort = (): void => { cleanup(); reject(new Error("study_v2_questionnaire_start_aborted")); };
      this.#contextWaiter = (contextId) => { cleanup(); resolve(contextId); };
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  async #handleEvent(event: CdpEvent): Promise<void> {
    const mainFrameId = this.#mainFrameId;
    if (mainFrameId !== undefined) {
      const contextId = defaultContextId(event, mainFrameId);
      if (contextId !== undefined) {
        if (this.#contextId !== undefined && this.#contextId !== contextId) {
          this.#terminalReject?.(new Error("study_v2_questionnaire_context_changed"));
          return;
        }
        this.#contextId = contextId;
        this.#contextWaiter?.(contextId);
        return;
      }
    }
    if (event.method === "Runtime.executionContextsCleared" ||
      (event.method === "Runtime.executionContextDestroyed" && event.params?.executionContextId === this.#contextId) ||
      (event.method === "Page.frameNavigated" && record(event.params) && record(event.params.frame) &&
        event.params.frame.id === this.#mainFrameId)) {
      if (this.#terminal === undefined) this.#terminalReject?.(new Error("study_v2_questionnaire_context_changed"));
      return;
    }
    if (event.method !== "Runtime.bindingCalled" || !record(event.params) ||
      event.params.name !== this.#bindingName || event.params.executionContextId !== this.#contextId ||
      typeof event.params.payload !== "string" || this.#config === undefined || !this.#activated ||
      this.#terminal !== undefined) return;
    let parsed: StudyV2NativeQuestionnaireEvent;
    try {
      parsed = parseStudyV2NativeQuestionnaireEvent(event.params.payload, this.#config.sessionToken);
    } catch {
      return;
    }
    this.#terminal = parsed;
    this.#terminalResolve?.(parsed);
  }
}

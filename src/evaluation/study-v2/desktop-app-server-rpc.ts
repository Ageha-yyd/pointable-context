import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
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
import type { StudyV2ScriptedTaskRpc } from "./native-scripted-task.js";
import {
  createReadCodexHostTaskContextExpression,
  parseCodexHostTaskContext,
} from "../../host/codex-cdp/host-context.js";

const ALLOWED_METHODS = new Set([
  "thread/start",
  "thread/fork",
  "thread/name/set",
  "turn/start",
  "thread/read",
  "thread/delete",
]);
const MAX_PARAMS_BYTES = 262_144;
const MAX_RESULT_BYTES = 1_048_576;

export interface StudyV2DesktopAppServerRpcOptions {
  endpoint?: string;
  fetch?: PointableFetch;
  connect?: CdpConnectionFactory;
  discoveryTimeoutMs?: number;
  requestTimeoutMs?: number;
  pollIntervalMs?: number;
}

interface PendingCompletion {
  predicate: (params: unknown) => boolean;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  started: boolean;
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
    throw new Error("study_v2_desktop_main_frame_invalid");
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

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function boundedRequestTimeout(value = 25_000): number {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 28_000) {
    throw new RangeError("requestTimeoutMs must be from 1000 to 28000");
  }
  return value;
}

function boundedPollInterval(value = 50): number {
  if (!Number.isSafeInteger(value) || value < 10 || value > 1_000) {
    throw new RangeError("pollIntervalMs must be from 10 to 1000");
  }
  return value;
}

function appServerRequestExpression(
  requestId: string,
  method: string,
  params: unknown,
  timeoutMs: number,
): string {
  const request = JSON.stringify({ id: requestId, method, params });
  const hostId = JSON.stringify("local");
  return `(() => {
    const request = ${request};
    const hostId = ${hostId};
    const bridge = window.electronBridge;
    if (!bridge || typeof bridge.sendMessageFromView !== "function") {
      return { ok: false, error: { code: "desktop_bridge_missing", message: "Desktop App Server bridge is unavailable" } };
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(value);
      };
      const onMessage = (event) => {
        const data = event.data;
        if (!data || data.type !== "mcp-response" || data.hostId !== hostId) return;
        const message = data.message;
        if (!message || message.id !== request.id) return;
        if (message.error !== undefined) {
          finish({ ok: false, error: message.error });
        } else {
          finish({ ok: true, result: message.result });
        }
      };
      const timer = setTimeout(() => finish({
        ok: false,
        error: { code: "desktop_request_timeout", message: "Desktop App Server request timed out" },
      }), ${timeoutMs});
      window.addEventListener("message", onMessage);
      try {
        bridge.sendMessageFromView({
          type: "mcp-request",
          hostId,
          request,
          source: "pointable-context-study-v2",
        });
      } catch (error) {
        finish({
          ok: false,
          error: {
            code: "desktop_request_failed",
            message: error instanceof Error ? error.message : "Desktop App Server request failed",
          },
        });
      }
    });
  })()`;
}

function threadNavigationExpression(threadId: string): string {
  const target = JSON.stringify(`local:${threadId}`);
  return `(() => {
    const target = ${target};
    const findRow = () => [...document.querySelectorAll("[data-app-action-sidebar-thread-id]")]
      .find((element) => element.getAttribute("data-app-action-sidebar-thread-id") === target);
    const row = findRow();
    if (!(row instanceof HTMLElement)) return false;
    row.click();
    const deadline = performance.now() + 3000;
    return new Promise((resolve) => {
      const verify = () => {
        const current = findRow();
        if (current instanceof HTMLElement && (
          current.getAttribute("data-app-action-sidebar-thread-active") === "true" ||
          current.getAttribute("data-app-action-sidebar-thread-selected") === "true"
        )) {
          resolve(true);
          return;
        }
        if (performance.now() >= deadline) {
          resolve(false);
          return;
        }
        requestAnimationFrame(verify);
      };
      verify();
    });
  })()`;
}

function appServerError(value: unknown): Error {
  if (!record(value)) return new Error("study_v2_desktop_app_server_error");
  const code = typeof value.code === "string" ? value.code : "desktop_app_server_error";
  const message = typeof value.message === "string" ? value.message : "Desktop App Server request failed";
  return new Error(`study_v2_${code}:${message}`);
}

function threadAndTurnFromStart(params: unknown, result: unknown): {
  threadId: string;
  turnId: string;
} | undefined {
  if (
    !record(params) || typeof params.threadId !== "string" ||
    !record(result) || !record(result.turn) || typeof result.turn.id !== "string"
  ) {
    return undefined;
  }
  return { threadId: params.threadId, turnId: result.turn.id };
}

function turnStatusFromRead(value: unknown, expectedTurnId: string): string | undefined {
  if (!record(value) || !record(value.thread) || !Array.isArray(value.thread.turns)) return undefined;
  for (const turn of value.thread.turns) {
    if (record(turn) && turn.id === expectedTurnId && typeof turn.status === "string") {
      return turn.status;
    }
  }
  return undefined;
}

export class StudyV2DesktopAppServerRpc implements StudyV2ScriptedTaskRpc {
  readonly #connection: CdpConnection;
  readonly #contextId: number;
  readonly #requestTimeoutMs: number;
  readonly #pollIntervalMs: number;
  #closed = false;
  #pendingCompletion: PendingCompletion | undefined;
  #unsubscribeClose: (() => void) | undefined;

  private constructor(
    connection: CdpConnection,
    contextId: number,
    requestTimeoutMs: number,
    pollIntervalMs: number,
  ) {
    this.#connection = connection;
    this.#contextId = contextId;
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#pollIntervalMs = pollIntervalMs;
    this.#unsubscribeClose = connection.onClose(() => {
      this.#closed = true;
      this.#rejectCompletion(new Error("study_v2_desktop_transport_closed"));
    });
  }

  static async connect(
    options: StudyV2DesktopAppServerRpcOptions = {},
    signal?: AbortSignal,
  ): Promise<StudyV2DesktopAppServerRpc> {
    const endpoint = options.endpoint ?? "http://127.0.0.1:9223";
    const requestTimeoutMs = boundedRequestTimeout(options.requestTimeoutMs);
    const pollIntervalMs = boundedPollInterval(options.pollIntervalMs);
    const targets = await discoverCodexAppTargets(endpoint, {
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      timeoutMs: options.discoveryTimeoutMs ?? 2_000,
      ...(signal === undefined ? {} : { signal }),
    });
    if (targets.length !== 1) throw new Error("study_v2_desktop_requires_one_codex_target");
    const target = targets[0];
    if (target === undefined) throw new Error("study_v2_desktop_requires_one_codex_target");
    const connection = await (options.connect ?? connectCdpWebSocket)(target.webSocketDebuggerUrl, signal);
    let unsubscribeEvent: (() => void) | undefined;
    try {
      await connection.send("Page.enable");
      const frameId = frameIdFrom(await connection.send("Page.getFrameTree"), target.url);
      const contextId = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("study_v2_desktop_main_context_timeout"));
        }, 2_000);
        const abort = (): void => {
          cleanup();
          reject(new Error("study_v2_desktop_connect_aborted"));
        };
        const cleanup = (): void => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          unsubscribeEvent?.();
        };
        unsubscribeEvent = connection.onEvent((event) => {
          const id = defaultContextId(event, frameId);
          if (id === undefined) return;
          cleanup();
          resolve(id);
        });
        signal?.addEventListener("abort", abort, { once: true });
        void connection.send("Runtime.enable").catch((error: unknown) => {
          cleanup();
          reject(error);
        });
      });
      const capability = runtimeValue(await connection.send("Runtime.evaluate", {
        expression: `({
          bridge: typeof window.electronBridge?.sendMessageFromView === "function",
          windowType: typeof window.codexWindowType === "string" ? window.codexWindowType : null,
        })`,
        contextId,
        returnByValue: true,
        awaitPromise: true,
      }));
      if (!record(capability) || capability.bridge !== true) {
        throw new Error("study_v2_desktop_bridge_unavailable");
      }
      return new StudyV2DesktopAppServerRpc(
        connection,
        contextId,
        requestTimeoutMs,
        pollIntervalMs,
      );
    } catch (error) {
      unsubscribeEvent?.();
      connection.close();
      throw error;
    }
  }

  async request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (!ALLOWED_METHODS.has(method)) throw new Error("study_v2_desktop_method_not_allowed");
    let result: unknown;
    try {
      result = await this.#rawRequest(method, params);
    } catch (error) {
      if (method === "turn/start") {
        this.#rejectCompletion(
          error instanceof Error ? error : new Error("study_v2_desktop_turn_start_failed"),
        );
      }
      throw error;
    }
    if (method === "turn/start") {
      const identity = threadAndTurnFromStart(params, result);
      const completion = this.#pendingCompletion;
      if (identity === undefined || completion === undefined || completion.started) {
        this.#rejectCompletion(new Error("study_v2_desktop_turn_completion_unbound"));
        throw new Error("study_v2_desktop_turn_completion_unbound");
      }
      completion.started = true;
      void this.#pollTurn(identity.threadId, identity.turnId, completion);
    }
    return result as T;
  }

  waitForNotification<T = unknown>(
    method: string,
    predicate: (params: unknown) => boolean = () => true,
    timeoutMs = 30_000,
  ): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("study_v2_desktop_rpc_closed"));
    if (method !== "turn/completed") {
      return Promise.reject(new Error("study_v2_desktop_notification_not_allowed"));
    }
    if (this.#pendingCompletion !== undefined) {
      return Promise.reject(new Error("study_v2_desktop_completion_already_pending"));
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
      return Promise.reject(new RangeError("notification timeout must be from 1000 to 120000"));
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#pendingCompletion?.timer !== timer) return;
        this.#pendingCompletion = undefined;
        reject(new Error("study_v2_desktop_turn_completion_timeout"));
      }, timeoutMs);
      this.#pendingCompletion = {
        predicate,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
        started: false,
      };
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#unsubscribeClose?.();
    this.#unsubscribeClose = undefined;
    this.#rejectCompletion(new Error("study_v2_desktop_rpc_closed"));
    this.#connection.close();
  }

  async navigateToThread(threadId: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,256}$/u.test(threadId)) {
      throw new Error("study_v2_desktop_navigation_thread_invalid");
    }
    if (this.#closed || this.#connection.isClosed()) {
      throw new Error("study_v2_desktop_rpc_closed");
    }
    const evaluated = await this.#connection.send("Runtime.evaluate", {
      expression: threadNavigationExpression(threadId),
      contextId: this.#contextId,
      returnByValue: true,
      awaitPromise: true,
    }, 4_000);
    if (runtimeValue(evaluated) !== true) {
      throw new Error("study_v2_desktop_navigation_unverified");
    }
  }

  async waitForThreadActive(threadId: string, timeoutMs = 180_000): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,256}$/u.test(threadId)) {
      throw new Error("study_v2_desktop_navigation_thread_invalid");
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 900_000) {
      throw new Error("study_v2_desktop_activation_timeout_invalid");
    }
    const startedAt = performance.now();
    while (true) {
      if (this.#closed || this.#connection.isClosed()) {
        throw new Error("study_v2_desktop_rpc_closed");
      }
      try {
        const evaluated = await this.#connection.send("Runtime.evaluate", {
          expression: createReadCodexHostTaskContextExpression(),
          contextId: this.#contextId,
          returnByValue: true,
          awaitPromise: true,
        }, 4_000);
        const current = parseCodexHostTaskContext(runtimeValue(evaluated));
        if (current !== undefined && (
          current.threadId === threadId || current.threadId === `${current.hostId}:${threadId}`
        )) return;
      } catch {
        // A navigation transition may temporarily have no single qualified task tuple.
      }
      if (performance.now() - startedAt >= timeoutMs) {
        throw new Error("study_v2_desktop_task_activation_timed_out");
      }
      await new Promise<void>((resolve) => setTimeout(resolve, this.#pollIntervalMs));
    }
  }

  async #rawRequest(method: string, params: unknown): Promise<unknown> {
    if (this.#closed || this.#connection.isClosed()) {
      throw new Error("study_v2_desktop_rpc_closed");
    }
    if (utf8Bytes(params) > MAX_PARAMS_BYTES) throw new Error("study_v2_desktop_params_too_large");
    const requestId = `pointable-study-${randomUUID()}`;
    const evaluated = await this.#connection.send("Runtime.evaluate", {
      expression: appServerRequestExpression(requestId, method, params, this.#requestTimeoutMs),
      contextId: this.#contextId,
      returnByValue: true,
      awaitPromise: true,
    }, this.#requestTimeoutMs + 1_000);
    const envelope = runtimeValue(evaluated);
    if (!record(envelope) || typeof envelope.ok !== "boolean") {
      throw new Error("study_v2_desktop_response_invalid");
    }
    if (envelope.ok !== true) throw appServerError(envelope.error);
    if (utf8Bytes(envelope.result) > MAX_RESULT_BYTES) {
      throw new Error("study_v2_desktop_result_too_large");
    }
    return envelope.result;
  }

  async #pollTurn(
    threadId: string,
    turnId: string,
    completion: PendingCompletion,
  ): Promise<void> {
    while (!this.#closed && this.#pendingCompletion === completion) {
      try {
        const read = await this.#rawRequest("thread/read", { threadId, includeTurns: true });
        const status = turnStatusFromRead(read, turnId);
        if (status === "completed") {
          const terminal = { threadId, turn: { id: turnId, status } };
          if (completion.predicate(terminal)) this.#resolveCompletion(completion, terminal);
          else this.#rejectCompletion(new Error("study_v2_desktop_turn_completion_invalid"));
          return;
        }
        if (status === "failed" || status === "interrupted" || status === "cancelled") {
          this.#rejectCompletion(new Error(`study_v2_desktop_turn_${status}`));
          return;
        }
      } catch {
        // A persistent task can briefly exist before its initial rollout has
        // enough bytes for thread/read. The notification deadline remains the
        // authority: retry bounded reads until it expires instead of turning a
        // storage visibility race into a failed trial.
      }
      await new Promise<void>((resolve) => setTimeout(resolve, this.#pollIntervalMs));
    }
  }

  #resolveCompletion(completion: PendingCompletion, value: unknown): void {
    if (this.#pendingCompletion !== completion) return;
    clearTimeout(completion.timer);
    this.#pendingCompletion = undefined;
    completion.resolve(value);
  }

  #rejectCompletion(error: Error): void {
    const completion = this.#pendingCompletion;
    if (completion === undefined) return;
    clearTimeout(completion.timer);
    this.#pendingCompletion = undefined;
    completion.reject(error);
  }
}

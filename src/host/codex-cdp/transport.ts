export interface CdpEvent {
  method: string;
  params?: Record<string, unknown>;
}

export interface CdpConnection {
  send(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<unknown>;
  onEvent(listener: (event: CdpEvent) => void | Promise<void>): () => void;
  onClose(listener: (error: Error) => void | Promise<void>): () => void;
  isClosed(): boolean;
  close(): void;
}

export type CdpConnectionFactory = (
  webSocketDebuggerUrl: string,
  signal?: AbortSignal,
) => Promise<CdpConnection>;

export class CdpTransportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CdpTransportError";
  }
}

interface PendingCommand {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const MAX_CDP_MESSAGE_BYTES = 1_048_576;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loopbackWebSocket(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "ws:" &&
      (hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]") &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

export async function connectCdpWebSocket(
  webSocketDebuggerUrl: string,
  signal?: AbortSignal,
): Promise<CdpConnection> {
  if (!loopbackWebSocket(webSocketDebuggerUrl)) {
    throw new CdpTransportError(
      "cdp_websocket_not_loopback",
      "CDP websocket must use an explicit loopback ws URL",
    );
  }
  if (signal?.aborted) {
    throw new CdpTransportError("cdp_connect_aborted", "CDP connection was aborted");
  }

  let socket: WebSocket;
  try {
    socket = new WebSocket(webSocketDebuggerUrl);
  } catch {
    throw new CdpTransportError("cdp_connect_failed", "CDP websocket failed");
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      socket.close();
      reject(new CdpTransportError("cdp_connect_timeout", "CDP websocket timed out"));
    }, 5_000);
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.removeEventListener("open", opened);
      socket.removeEventListener("error", failed);
      signal?.removeEventListener("abort", aborted);
    };
    const opened = (): void => {
      cleanup();
      resolve();
    };
    const failed = (): void => {
      cleanup();
      socket.close();
      reject(new CdpTransportError("cdp_connect_failed", "CDP websocket failed"));
    };
    const aborted = (): void => {
      cleanup();
      socket.close();
      reject(new CdpTransportError("cdp_connect_aborted", "CDP connection was aborted"));
    };
    socket.addEventListener("open", opened, { once: true });
    socket.addEventListener("error", failed, { once: true });
    signal?.addEventListener("abort", aborted, { once: true });
  });

  let sequence = 0;
  let closed = false;
  const pending = new Map<number, PendingCommand>();
  const listeners = new Set<(event: CdpEvent) => void | Promise<void>>();
  const closeListeners = new Set<(error: Error) => void | Promise<void>>();

  const failPending = (error: Error): void => {
    for (const command of pending.values()) {
      clearTimeout(command.timer);
      command.reject(error);
    }
    pending.clear();
  };

  const markClosed = (
    error = new CdpTransportError("cdp_closed", "CDP websocket closed"),
  ): void => {
    if (closed) return;
    closed = true;
    failPending(error);
    listeners.clear();
    for (const listener of closeListeners) {
      Promise.resolve(listener(error)).catch(() => undefined);
    }
    closeListeners.clear();
  };

  const closeForProtocolError = (error: CdpTransportError, code: number): void => {
    markClosed(error);
    try {
      socket.close(code, error.code);
    } catch {
      socket.close();
    }
  };

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      closeForProtocolError(
        new CdpTransportError(
          "cdp_message_invalid",
          "CDP websocket received a non-text message",
        ),
        1003,
      );
      return;
    }
    if (
      event.data.length > MAX_CDP_MESSAGE_BYTES ||
      new TextEncoder().encode(event.data).byteLength > MAX_CDP_MESSAGE_BYTES
    ) {
      closeForProtocolError(
        new CdpTransportError(
          "cdp_message_too_large",
          "CDP websocket message exceeds its byte limit",
        ),
        1009,
      );
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!record(message)) return;
    if (typeof message.id === "number") {
      const command = pending.get(message.id);
      if (command === undefined) return;
      pending.delete(message.id);
      clearTimeout(command.timer);
      if (record(message.error)) {
        command.reject(
          new CdpTransportError(
            "cdp_command_failed",
            typeof message.error.message === "string"
              ? message.error.message
              : "CDP command failed",
          ),
        );
      } else {
        command.resolve(message.result);
      }
      return;
    }
    if (typeof message.method !== "string") return;
    const cdpEvent: CdpEvent = {
      method: message.method,
    };
    if (record(message.params)) cdpEvent.params = message.params;
    for (const listener of listeners) {
      Promise.resolve(listener(cdpEvent)).catch(() => undefined);
    }
  });

  socket.addEventListener("close", () => markClosed(), { once: true });

  return {
    send(method, params = {}, timeoutMs = 5_000) {
      if (closed || socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(
          new CdpTransportError("cdp_closed", "CDP websocket is not open"),
        );
      }
      if (
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 10 ||
        timeoutMs > 30_000
      ) {
        return Promise.reject(
          new RangeError("CDP command timeout must be from 10 to 30000 ms"),
        );
      }
      const id = ++sequence;
      const serialized = JSON.stringify({ id, method, params });
      if (
        serialized.length > MAX_CDP_MESSAGE_BYTES ||
        new TextEncoder().encode(serialized).byteLength > MAX_CDP_MESSAGE_BYTES
      ) {
        const error = new CdpTransportError(
          "cdp_message_too_large",
          "CDP websocket message exceeds its byte limit",
        );
        closeForProtocolError(error, 1009);
        return Promise.reject(error);
      }
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new CdpTransportError(
              "cdp_command_timeout",
              `CDP command ${method} timed out`,
            ),
          );
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try {
          socket.send(serialized);
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(
            error instanceof Error
              ? error
              : new CdpTransportError("cdp_send_failed", "CDP send failed"),
          );
        }
      });
    },
    onEvent(listener) {
      if (closed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onClose(listener) {
      if (closed) return () => undefined;
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    isClosed: () => closed,
    close() {
      if (closed) return;
      closed = true;
      failPending(new CdpTransportError("cdp_closed", "CDP websocket closed"));
      listeners.clear();
      const error = new CdpTransportError("cdp_closed", "CDP websocket closed");
      for (const listener of closeListeners) {
        Promise.resolve(listener(error)).catch(() => undefined);
      }
      closeListeners.clear();
      socket.close();
    },
  };
}

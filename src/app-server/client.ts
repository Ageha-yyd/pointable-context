import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";

const MAX_LINE_BYTES = 4 * 1024 * 1024;

export class AppServerProtocolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AppServerProtocolError";
  }
}

export interface AppServerClientOptions {
  cwd: string;
  command?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
}

interface PendingRequest {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface NotificationWaiter {
  method: string;
  predicate(value: unknown): boolean;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultLaunch(): { command: string; args: string[] } {
  if (process.platform !== "win32") {
    return { command: "codex", args: ["app-server"] };
  }
  const appData = process.env.APPDATA;
  const script = appData === undefined
    ? undefined
    : join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
  if (script === undefined || !existsSync(script)) {
    throw new AppServerProtocolError(
      "codex_command_missing",
      "Codex CLI app-server entrypoint was not found",
    );
  }
  return { command: process.execPath, args: [script, "app-server"] };
}

export class CodexAppServerClient {
  #nextId = 1;
  #closed = false;
  #stderr = "";
  #pending = new Map<number, PendingRequest>();
  #waiters = new Set<NotificationWaiter>();
  #listeners = new Set<(method: string, params: unknown) => void>();

  private constructor(
    readonly child: ChildProcessWithoutNullStreams,
    readonly requestTimeoutMs: number,
  ) {
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.#receive(line));
    child.stderr.on("data", (chunk: Buffer) => {
      if (this.#stderr.length < 32_768) this.#stderr += chunk.toString("utf8");
    });
    child.once("exit", (code, signal) => {
      this.#failAll(new AppServerProtocolError(
        "app_server_exited",
        `Codex app-server exited (${String(code ?? signal ?? "unknown")})`,
      ));
    });
  }

  static async launch(options: AppServerClientOptions): Promise<CodexAppServerClient> {
    const timeout = options.requestTimeoutMs ?? 20_000;
    if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 300_000) {
      throw new RangeError("requestTimeoutMs must be from 100 to 300000");
    }
    const fallback = options.command === undefined ? defaultLaunch() : undefined;
    const command = options.command ?? fallback!.command;
    const args = options.args ?? fallback!.args;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    await Promise.race([
      once(child, "spawn"),
      once(child, "error").then(([error]) => Promise.reject(error)),
    ]);
    return new CodexAppServerClient(child, timeout);
  }

  async initialize(): Promise<unknown> {
    const result = await this.request("initialize", {
      clientInfo: {
        name: "pointable_context_app_host",
        title: "Pointable Context App Host",
        version: "0.1.0",
      },
      capabilities: null,
    });
    this.notify("initialized", {});
    return result;
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.#closed) {
      return Promise.reject(new AppServerProtocolError("client_closed", "client is closed"));
    }
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new AppServerProtocolError(
          "request_timeout",
          `${method} timed out after ${this.requestTimeoutMs}ms`,
        ));
      }, this.requestTimeoutMs);
      this.#pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.#write({ method, id, params });
    });
  }

  notify(method: string, params: unknown): void {
    if (this.#closed) throw new AppServerProtocolError("client_closed", "client is closed");
    this.#write({ method, params });
  }

  onNotification(listener: (method: string, params: unknown) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  waitForNotification<T = unknown>(
    method: string,
    predicate: (params: unknown) => boolean = () => true,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const waiter: NotificationWaiter = {
        method,
        predicate,
        resolve: (value) => resolve(value as T),
        reject,
        timer: setTimeout(() => {
          this.#waiters.delete(waiter);
          reject(new AppServerProtocolError(
            "notification_timeout",
            `${method} notification timed out after ${timeoutMs}ms`,
          ));
        }, timeoutMs),
      };
      this.#waiters.add(waiter);
    });
  }

  stderr(): string {
    return this.#stderr;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#failAll(new AppServerProtocolError("client_closed", "client closed"));
    this.child.stdin.end();
    if (this.child.exitCode !== null) return;
    const exited = once(this.child, "exit").then(() => undefined);
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, 2_000));
    await Promise.race([exited, deadline]);
    if (this.child.exitCode === null) this.child.kill();
  }

  #write(message: unknown): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #receive(line: string): void {
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
      this.#failAll(new AppServerProtocolError("message_too_large", "app-server message too large"));
      this.child.kill();
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      this.#failAll(new AppServerProtocolError("invalid_json", "app-server returned invalid JSON"));
      this.child.kill();
      return;
    }
    if (!record(message)) return;
    if (message.id !== undefined && typeof message.method !== "string") {
      const id = Number(message.id);
      const pending = this.#pending.get(id);
      if (pending === undefined) return;
      this.#pending.delete(id);
      clearTimeout(pending.timer);
      if (record(message.error)) {
        pending.reject(new AppServerProtocolError(
          "rpc_error",
          `${pending.method} failed: ${String(message.error.message ?? "unknown error")}`,
        ));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.id !== undefined && typeof message.method === "string") {
      this.#write({
        id: message.id,
        error: { code: -32601, message: "Pointable Context client request unsupported" },
      });
      return;
    }
    if (typeof message.method !== "string") return;
    for (const listener of this.#listeners) listener(message.method, message.params);
    for (const waiter of [...this.#waiters]) {
      if (waiter.method !== message.method || !waiter.predicate(message.params)) continue;
      this.#waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(message.params);
    }
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    for (const waiter of this.#waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.#waiters.clear();
  }
}

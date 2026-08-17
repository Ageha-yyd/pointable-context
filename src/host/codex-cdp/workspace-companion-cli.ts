#!/usr/bin/env node
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { CodexTaskWorkspaceBindingRegistry } from "./task-workspace-binding.js";
import {
  createWorkspaceCompanion,
  type WorkspaceCompanion,
} from "./workspace-companion.js";

const CONTROL_SCHEMA_VERSION = 1;
const CONTROL_TIMEOUT_MS = 3_000;
const START_TIMEOUT_MS = 8_000;
const MAX_CONTROL_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = 8 * 1024;

interface ControlState {
  schemaVersion: 1;
  mode: "live-local-workspace";
  pid: number;
  port: number;
  token: string;
  startedAt: string;
}

interface ParsedArguments {
  command: "start" | "status" | "bind" | "unbind" | "stop" | "run";
  stateDir: string;
  registryPath: string;
  endpoint: string;
  refreshIntervalMs: number;
  workspaceRoot?: string;
  json: boolean;
}

function fail(message: string): never {
  throw new Error(message);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function packageRoot(start: string): string {
  let current = resolve(start);
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "src"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return fail("pointable-context package root was not found");
}

function localStateRoot(): string {
  const local = process.env.LOCALAPPDATA;
  return resolve(local && isAbsolute(local) ? local : homedir(), "PointableContext");
}

function boundedInteger(value: string, name: string): number {
  if (!/^\d+$/u.test(value)) fail(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 100 || parsed > 60_000) {
    fail(`${name} must be from 100 to 60000`);
  }
  return parsed;
}

function parseArguments(argv: string[]): ParsedArguments {
  const command = argv[0];
  if (
    command !== "start" &&
    command !== "status" &&
    command !== "bind" &&
    command !== "unbind" &&
    command !== "stop" &&
    command !== "run"
  ) {
    return fail(
      "usage: pointable-context-workspace-companion <start|status|bind|unbind|stop> [options]",
    );
  }
  const stateRoot = localStateRoot();
  let stateDir = join(stateRoot, "workspace-companion");
  let registryPath = join(stateRoot, "task-workspace-bindings.json");
  let endpoint = "http://127.0.0.1:9223";
  let refreshIntervalMs = 2_000;
  let workspaceRoot: string | undefined;
  let json = false;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) fail(`${argument} requires a value`);
    index += 1;
    if (argument === "--state-dir") {
      if (!isAbsolute(value)) fail("--state-dir must be absolute");
      stateDir = resolve(value);
    } else if (argument === "--registry") {
      if (!isAbsolute(value)) fail("--registry must be absolute");
      registryPath = resolve(value);
    } else if (argument === "--endpoint") {
      endpoint = value;
    } else if (argument === "--refresh-ms") {
      refreshIntervalMs = boundedInteger(value, "--refresh-ms");
    } else if (argument === "--workspace-root") {
      if (!isAbsolute(value)) fail("--workspace-root must be absolute");
      workspaceRoot = resolve(value);
    } else {
      fail(`unknown option: ${argument}`);
    }
  }
  if (command === "bind" && workspaceRoot === undefined) {
    fail("bind requires --workspace-root <absolute-path>");
  }
  return {
    command,
    stateDir,
    registryPath,
    endpoint,
    refreshIntervalMs,
    ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
    json,
  };
}

const statePath = (directory: string): string => join(directory, "state.json");
const lockPath = (directory: string): string => join(directory, "runtime.lock");
const logPath = (directory: string): string => join(directory, "companion.log");

function parseState(value: unknown): ControlState {
  if (
    !record(value) ||
    value.schemaVersion !== CONTROL_SCHEMA_VERSION ||
    value.mode !== "live-local-workspace" ||
    !Number.isSafeInteger(value.pid) ||
    Number(value.pid) < 1 ||
    !Number.isSafeInteger(value.port) ||
    Number(value.port) < 1 ||
    Number(value.port) > 65_535 ||
    typeof value.token !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.token) ||
    typeof value.startedAt !== "string" ||
    !Number.isFinite(Date.parse(value.startedAt))
  ) {
    return fail("invalid workspace companion state");
  }
  return {
    schemaVersion: 1,
    mode: "live-local-workspace",
    pid: Number(value.pid),
    port: Number(value.port),
    token: value.token,
    startedAt: value.startedAt,
  };
}

async function readState(directory: string): Promise<ControlState | undefined> {
  try {
    const text = await readFile(statePath(directory), "utf8");
    if (Buffer.byteLength(text, "utf8") > 16 * 1024) return undefined;
    return parseState(JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readLockPid(directory: string): Promise<number | undefined> {
  try {
    const value = (await readFile(lockPath(directory), "utf8")).trim();
    if (!/^\d+$/u.test(value)) return undefined;
    const pid = Number(value);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, path);
}

async function claimLock(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const handle = await open(lockPath(directory), "wx", 0o600);
    try {
      await handle.writeFile(`${process.pid}\n`, "utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      fail("workspace companion runtime lock is already held");
    }
    throw error;
  }
}

async function removeOwnedState(directory: string, token?: string): Promise<void> {
  if (token !== undefined) {
    const current = await readState(directory);
    if (current !== undefined && current.token !== token) return;
  }
  await rm(statePath(directory), { force: true }).catch(() => undefined);
  const lockPid = await readLockPid(directory);
  if (lockPid === undefined || lockPid === process.pid || !processIsAlive(lockPid)) {
    await rm(lockPath(directory), { force: true }).catch(() => undefined);
  }
}

function safeTokenEqual(left: string | undefined, right: string): boolean {
  if (left === undefined || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function sendJson(
  response: import("node:http").ServerResponse,
  statusCode: number,
  body: unknown,
  after?: () => void,
): void {
  const encoded = Buffer.from(JSON.stringify(body), "utf8");
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": encoded.byteLength,
    "cache-control": "no-store",
  });
  response.end(encoded, after);
}

async function readRequestJson(
  request: import("node:http").IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > MAX_REQUEST_BYTES) throw new Error("control request is too large");
    chunks.push(value);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!record(parsed)) throw new Error("control request JSON is invalid");
  return parsed;
}

async function controlRequest(
  state: ControlState,
  method: "GET" | "POST",
  path: "/status" | "/refresh" | "/bind" | "/unbind" | "/stop",
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const encoded = body === undefined ? undefined : Buffer.from(JSON.stringify(body), "utf8");
  return await new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port: state.port,
      method,
      path,
      headers: {
        "x-pointable-control-token": state.token,
        connection: "close",
        ...(encoded === undefined
          ? {}
          : {
            "content-type": "application/json",
            "content-length": encoded.byteLength,
          }),
      },
      timeout: CONTROL_TIMEOUT_MS,
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > MAX_CONTROL_BYTES) {
          request.destroy(new Error("control response is too large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        try {
          const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!record(parsed)) throw new Error("control response is invalid");
          if ((response.statusCode ?? 500) >= 400) {
            rejectRequest(new Error(
              typeof parsed.error === "string" ? parsed.error : "control request failed",
            ));
            return;
          }
          resolveRequest(parsed);
        } catch (error) {
          rejectRequest(error);
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("control request timed out")));
    request.on("error", rejectRequest);
    request.end(encoded);
  });
}

async function liveStatus(directory: string): Promise<Record<string, unknown> | undefined> {
  const state = await readState(directory);
  if (state === undefined || !processIsAlive(state.pid)) return undefined;
  try {
    return await controlRequest(state, "GET", "/status");
  } catch {
    return undefined;
  }
}

async function waitForStatus(directory: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await liveStatus(directory);
    if (status !== undefined) return status;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return fail(`workspace companion did not become ready; see ${logPath(directory)}`);
}

async function runServer(arguments_: ParsedArguments): Promise<void> {
  await claimLock(arguments_.stateDir);
  const token = randomBytes(32).toString("hex");
  const startedAt = new Date().toISOString();
  const registry = new CodexTaskWorkspaceBindingRegistry(arguments_.registryPath);
  const companion: WorkspaceCompanion = createWorkspaceCompanion({
    registry,
    endpoint: arguments_.endpoint,
    refreshIntervalMs: arguments_.refreshIntervalMs,
  });
  let resolveShutdown!: () => void;
  const shutdown = new Promise<void>((resolvePromise) => {
    resolveShutdown = resolvePromise;
  });
  let shutdownStarted = false;
  const requestShutdown = (): void => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    resolveShutdown();
  };
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);
  process.once("SIGHUP", requestShutdown);

  const server = createServer({ maxHeaderSize: 8 * 1024 }, (request, response) => {
    const remote = request.socket.remoteAddress;
    const tokenHeader = request.headers["x-pointable-control-token"];
    if (
      (remote !== "127.0.0.1" && remote !== "::ffff:127.0.0.1") ||
      typeof tokenHeader !== "string" ||
      !safeTokenEqual(tokenHeader, token)
    ) {
      sendJson(response, 403, { ok: false, error: "forbidden" });
      return;
    }
    if (request.method === "GET" && request.url === "/status") {
      sendJson(response, 200, { ok: true, pid: process.pid, companion: companion.status() });
      return;
    }
    if (request.method === "POST" && request.url === "/refresh") {
      void companion.refresh().then(
        (status) => sendJson(response, 200, { ok: true, companion: status }),
        () => sendJson(response, 503, { ok: false, error: "refresh_failed" }),
      );
      return;
    }
    if (request.method === "POST" && request.url === "/bind") {
      void readRequestJson(request).then(async (body) => {
        if (typeof body.workspaceRoot !== "string" || !isAbsolute(body.workspaceRoot)) {
          throw new Error("workspace_root_invalid");
        }
        return await companion.bindCurrentTask(resolve(body.workspaceRoot));
      }).then(
        (result) => sendJson(response, 200, { ok: true, ...result }),
        (error: unknown) => sendJson(response, 409, {
          ok: false,
          error: error instanceof Error ? error.message : "bind_failed",
        }),
      );
      return;
    }
    if (request.method === "POST" && request.url === "/unbind") {
      void companion.unbindCurrentTask().then(
        (unbound) => sendJson(response, 200, {
          ok: true,
          unbound: unbound ?? null,
          wasBound: unbound !== undefined,
        }),
        (error: unknown) => sendJson(response, 409, {
          ok: false,
          error: error instanceof Error ? error.message : "unbind_failed",
        }),
      );
      return;
    }
    if (request.method === "POST" && request.url === "/stop") {
      sendJson(response, 202, { ok: true, stopping: true }, requestShutdown);
      return;
    }
    sendJson(response, 404, { ok: false, error: "not_found" });
  });

  try {
    await companion.start();
    server.listen({ host: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") fail("control server did not bind TCP");
    await writeJsonAtomic(statePath(arguments_.stateDir), {
      schemaVersion: 1,
      mode: "live-local-workspace",
      pid: process.pid,
      port: address.port,
      token,
      startedAt,
    } satisfies ControlState);
    process.stdout.write(`${JSON.stringify({ event: "workspace_companion_ready", pid: process.pid })}\n`);
    await shutdown;
  } finally {
    await companion.stop().catch(() => undefined);
    await new Promise<void>((resolveClose) => server.close(() => resolveClose())).catch(() => undefined);
    await removeOwnedState(arguments_.stateDir, token);
  }
}

async function startDetached(arguments_: ParsedArguments): Promise<Record<string, unknown>> {
  const existing = await liveStatus(arguments_.stateDir);
  if (existing !== undefined) return { ...existing, alreadyRunning: true };
  const lockPid = await readLockPid(arguments_.stateDir);
  if (lockPid !== undefined && processIsAlive(lockPid)) {
    return { ...(await waitForStatus(arguments_.stateDir)), alreadyRunning: true };
  }
  await removeOwnedState(arguments_.stateDir);
  await mkdir(arguments_.stateDir, { recursive: true, mode: 0o700 });
  const logDescriptor = openSync(logPath(arguments_.stateDir), "a", 0o600);
  const entrypoint = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [
    entrypoint,
    "run",
    "--state-dir",
    arguments_.stateDir,
    "--registry",
    arguments_.registryPath,
    "--endpoint",
    arguments_.endpoint,
    "--refresh-ms",
    String(arguments_.refreshIntervalMs),
    "--json",
  ], {
    cwd: packageRoot(dirname(entrypoint)),
    detached: true,
    windowsHide: true,
    stdio: ["ignore", logDescriptor, logDescriptor],
  });
  try {
    await Promise.race([
      once(child, "spawn"),
      once(child, "error").then(([error]) => Promise.reject(error)),
    ]);
    child.unref();
  } finally {
    closeSync(logDescriptor);
  }
  return { ...(await waitForStatus(arguments_.stateDir)), alreadyRunning: false };
}

async function stopDetached(directory: string): Promise<Record<string, unknown>> {
  const state = await readState(directory);
  if (state === undefined || !processIsAlive(state.pid)) {
    await removeOwnedState(directory);
    return { ok: true, stopped: true, wasRunning: false };
  }
  await controlRequest(state, "POST", "/stop");
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!processIsAlive(state.pid) && (await readState(directory)) === undefined) {
      return { ok: true, stopped: true, wasRunning: true };
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return fail("workspace companion did not stop cleanly");
}

function print(value: Record<string, unknown>, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  const binding = record(value.binding) ? value.binding : undefined;
  if (binding !== undefined) {
    process.stdout.write(
      `${value.replaced === true ? "Rebound" : "Bound"} active Codex task ${String(binding.threadId)} to ${String(binding.workspaceRoot)}\n`,
    );
    return;
  }
  const unbound = record(value.unbound) ? value.unbound : undefined;
  if (value.wasBound === true && unbound !== undefined) {
    process.stdout.write(
      `Unbound active Codex task ${String(unbound.threadId)} from ${String(unbound.workspaceRoot)}\n`,
    );
    return;
  }
  if (value.wasBound === false) {
    process.stdout.write("Active Codex task was not bound\n");
    return;
  }
  const companion = record(value.companion) ? value.companion : undefined;
  const adapter = companion && record(companion.adapter) ? companion.adapter : undefined;
  const state = typeof companion?.state === "string"
    ? companion.state
    : value.stopped === true
      ? "stopped"
      : "inactive";
  const targets = typeof adapter?.targetCount === "number" ? adapter.targetCount : 0;
  const tasks = typeof companion?.activeTaskCount === "number" ? companion.activeTaskCount : 0;
  process.stdout.write(
    `Pointable Context workspace companion: ${state}; targets=${targets}; activeTasks=${tasks}\n`,
  );
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.command === "run") {
    await runServer(arguments_);
    return;
  }
  if (arguments_.command === "start") {
    print(await startDetached(arguments_), arguments_.json);
    return;
  }
  if (arguments_.command === "stop") {
    print(await stopDetached(arguments_.stateDir), arguments_.json);
    return;
  }
  if (arguments_.command === "bind") {
    const state = await readState(arguments_.stateDir);
    if (state === undefined || !processIsAlive(state.pid)) {
      fail("workspace companion is not running");
    }
    print(await controlRequest(state, "POST", "/bind", {
      workspaceRoot: arguments_.workspaceRoot,
    }), arguments_.json);
    return;
  }
  if (arguments_.command === "unbind") {
    const state = await readState(arguments_.stateDir);
    if (state === undefined || !processIsAlive(state.pid)) {
      fail("workspace companion is not running");
    }
    print(await controlRequest(state, "POST", "/unbind"), arguments_.json);
    return;
  }
  print((await liveStatus(arguments_.stateDir)) ?? { ok: true, stopped: true }, arguments_.json);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

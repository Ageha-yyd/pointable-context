#!/usr/bin/env node
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
} from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fixtureProjectScope } from "../../adapters/json-files.js";
import {
  createFixtureCompanion,
  type FixtureCompanion,
  type FixtureCompanionStatus,
} from "./fixture-companion.js";

const CONTROL_SCHEMA_VERSION = 1;
const CONTROL_TIMEOUT_MS = 2_000;
const START_TIMEOUT_MS = 8_000;
const MAX_CONTROL_BYTES = 64 * 1024;

interface ControlState {
  schemaVersion: typeof CONTROL_SCHEMA_VERSION;
  fixtureOnly: true;
  pid: number;
  port: number;
  token: string;
  startedAt: string;
}

interface ParsedArguments {
  command: "start" | "status" | "stop" | "run";
  stateDir: string;
  endpoint: string;
  fixtureRoot: string;
  refreshIntervalMs: number;
  json: boolean;
}

function fail(message: string): never {
  throw new Error(message);
}

function boundedInteger(value: string, name: string, minimum: number, maximum: number): number {
  if (!/^\d+$/u.test(value)) fail(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(`${name} must be from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function findPackageRoot(start: string): string {
  let current = resolve(start);
  for (let depth = 0; depth < 10; depth += 1) {
    if (
      existsSync(join(current, "package.json")) &&
      existsSync(join(current, "fixtures", "mini-project", "project-context.json"))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return fail("pointable-context package root was not found");
}

function defaultStateDir(): string {
  const localBase = process.env.LOCALAPPDATA;
  return resolve(
    localBase && isAbsolute(localBase) ? localBase : homedir(),
    "PointableContext",
    "fixture-companion",
  );
}

function parseArguments(argv: string[]): ParsedArguments {
  const command = argv[0];
  if (command !== "start" && command !== "status" && command !== "stop" && command !== "run") {
    return fail("usage: pointable-context-fixture-companion <start|status|stop> [options]");
  }
  const packageRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
  let stateDir = defaultStateDir();
  let endpoint = "http://127.0.0.1:9223";
  let fixtureRoot = join(packageRoot, "fixtures", "mini-project");
  let refreshIntervalMs = 2_000;
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
    } else if (argument === "--endpoint") {
      endpoint = value;
    } else if (argument === "--fixture-root") {
      if (!isAbsolute(value)) fail("--fixture-root must be absolute");
      fixtureRoot = resolve(value);
    } else if (argument === "--refresh-ms") {
      refreshIntervalMs = boundedInteger(value, "--refresh-ms", 100, 60_000);
    } else {
      fail(`unknown option: ${argument}`);
    }
  }
  return { command, stateDir, endpoint, fixtureRoot, refreshIntervalMs, json };
}

function statePath(stateDir: string): string {
  return join(stateDir, "state.json");
}

function lockPath(stateDir: string): string {
  return join(stateDir, "runtime.lock");
}

function logPath(stateDir: string): string {
  return join(stateDir, "companion.log");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseState(value: unknown): ControlState {
  if (!record(value)) return fail("invalid companion state");
  const token = value.token;
  if (
    value.schemaVersion !== CONTROL_SCHEMA_VERSION ||
    value.fixtureOnly !== true ||
    !Number.isSafeInteger(value.pid) ||
    Number(value.pid) <= 0 ||
    !Number.isSafeInteger(value.port) ||
    Number(value.port) < 1 ||
    Number(value.port) > 65_535 ||
    typeof token !== "string" ||
    !/^[a-f0-9]{64}$/u.test(token) ||
    typeof value.startedAt !== "string" ||
    !Number.isFinite(Date.parse(value.startedAt))
  ) {
    return fail("invalid companion state");
  }
  return {
    schemaVersion: CONTROL_SCHEMA_VERSION,
    fixtureOnly: true,
    pid: Number(value.pid),
    port: Number(value.port),
    token,
    startedAt: value.startedAt,
  };
}

async function readState(stateDir: string): Promise<ControlState | undefined> {
  try {
    const text = await readFile(statePath(stateDir), "utf8");
    if (Buffer.byteLength(text, "utf8") > 16 * 1024) return undefined;
    return parseState(JSON.parse(text));
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

async function readLockPid(stateDir: string): Promise<number | undefined> {
  try {
    const raw = (await readFile(lockPath(stateDir), "utf8")).trim();
    if (!/^\d+$/u.test(raw)) return undefined;
    const pid = Number(raw);
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

async function claimRuntimeLock(stateDir: string): Promise<void> {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  try {
    const handle = await open(lockPath(stateDir), "wx", 0o600);
    try {
      await handle.writeFile(`${process.pid}\n`, "utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      fail("fixture companion runtime lock is already held");
    }
    throw error;
  }
}

async function removeOwnedFiles(stateDir: string, token?: string): Promise<void> {
  if (token !== undefined) {
    const current = await readState(stateDir);
    if (current !== undefined && current.token !== token) return;
  }
  await rm(statePath(stateDir), { force: true }).catch(() => undefined);
  const lockPid = await readLockPid(stateDir);
  if (lockPid === undefined || lockPid === process.pid || !processIsAlive(lockPid)) {
    await rm(lockPath(stateDir), { force: true }).catch(() => undefined);
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

async function controlRequest(
  state: ControlState,
  method: "GET" | "POST",
  path: "/status" | "/refresh" | "/stop",
): Promise<Record<string, unknown>> {
  return await new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port: state.port,
      method,
      path,
      headers: {
        "x-pointable-control-token": state.token,
        connection: "close",
      },
      timeout: CONTROL_TIMEOUT_MS,
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > MAX_CONTROL_BYTES) {
          request.destroy(new Error("companion control response is too large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        try {
          const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if ((response.statusCode ?? 500) >= 400 || !record(parsed)) {
            rejectRequest(new Error("companion control request failed"));
            return;
          }
          resolveRequest(parsed);
        } catch (error) {
          rejectRequest(error);
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("companion control request timed out")));
    request.on("error", rejectRequest);
    request.end();
  });
}

async function liveStatus(stateDir: string): Promise<Record<string, unknown> | undefined> {
  const state = await readState(stateDir);
  if (state === undefined || !processIsAlive(state.pid)) return undefined;
  try {
    return await controlRequest(state, "GET", "/status");
  } catch {
    return undefined;
  }
}

async function waitForLiveStatus(stateDir: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await liveStatus(stateDir);
    if (status !== undefined) return status;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return fail(`fixture companion did not become ready; see ${logPath(stateDir)}`);
}

function fixtureOptions(arguments_: ParsedArguments) {
  const fixtureRoot = arguments_.fixtureRoot;
  return {
    workspaceRoot: fixtureRoot,
    manifestPath: join(fixtureRoot, "project-context.json"),
    indexPath: join(fixtureRoot, "index.json"),
    detailsPath: join(fixtureRoot, "details.json"),
    explicitScope: fixtureProjectScope("PRJ-01"),
    endpoint: arguments_.endpoint,
    refreshIntervalMs: arguments_.refreshIntervalMs,
    actionLabel: "查看上下文（fixture）",
  } as const;
}

async function runServer(arguments_: ParsedArguments): Promise<void> {
  await claimRuntimeLock(arguments_.stateDir);
  const token = randomBytes(32).toString("hex");
  const startedAt = new Date().toISOString();
  const companion: FixtureCompanion = createFixtureCompanion(fixtureOptions(arguments_));
  let resolveShutdown!: () => void;
  const shutdownRequested = new Promise<void>((resolvePromise) => {
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
    const local = remote === "127.0.0.1" || remote === "::ffff:127.0.0.1";
    const suppliedToken = request.headers["x-pointable-control-token"];
    if (
      !local ||
      typeof suppliedToken !== "string" ||
      !safeTokenEqual(suppliedToken, token)
    ) {
      sendJson(response, 403, { ok: false, error: "forbidden" });
      return;
    }
    if (request.method === "GET" && request.url === "/status") {
      sendJson(response, 200, {
        ok: true,
        pid: process.pid,
        fixtureOnly: true,
        companion: companion.status(),
      });
      return;
    }
    if (request.method === "POST" && request.url === "/refresh") {
      void companion.refresh().then(
        (status) => sendJson(response, 200, { ok: true, fixtureOnly: true, companion: status }),
        () => sendJson(response, 503, { ok: false, error: "refresh_failed" }),
      );
      return;
    }
    if (request.method === "POST" && request.url === "/stop") {
      sendJson(response, 202, { ok: true, fixtureOnly: true, stopping: true }, requestShutdown);
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
    const state: ControlState = {
      schemaVersion: CONTROL_SCHEMA_VERSION,
      fixtureOnly: true,
      pid: process.pid,
      port: address.port,
      token,
      startedAt,
    };
    await writeJsonAtomic(statePath(arguments_.stateDir), state);
    process.stdout.write(`${JSON.stringify({ event: "fixture_companion_ready", pid: process.pid, fixtureOnly: true })}\n`);
    await shutdownRequested;
  } finally {
    await companion.stop().catch(() => undefined);
    await new Promise<void>((resolveClose) => server.close(() => resolveClose())).catch(() => undefined);
    await removeOwnedFiles(arguments_.stateDir, token);
  }
}

async function startDetached(arguments_: ParsedArguments): Promise<Record<string, unknown>> {
  const existing = await liveStatus(arguments_.stateDir);
  if (existing !== undefined) return { ...existing, alreadyRunning: true };

  const lockPid = await readLockPid(arguments_.stateDir);
  if (lockPid !== undefined && processIsAlive(lockPid)) {
    return { ...(await waitForLiveStatus(arguments_.stateDir)), alreadyRunning: true };
  }
  await removeOwnedFiles(arguments_.stateDir);
  await mkdir(arguments_.stateDir, { recursive: true, mode: 0o700 });
  const logDescriptor = openSync(logPath(arguments_.stateDir), "a", 0o600);
  const entrypoint = fileURLToPath(import.meta.url);
  const childArguments = [
    entrypoint,
    "run",
    "--state-dir",
    arguments_.stateDir,
    "--endpoint",
    arguments_.endpoint,
    "--fixture-root",
    arguments_.fixtureRoot,
    "--refresh-ms",
    String(arguments_.refreshIntervalMs),
    "--json",
  ];
  try {
    const child = spawn(process.execPath, childArguments, {
      cwd: findPackageRoot(dirname(entrypoint)),
      detached: true,
      windowsHide: true,
      stdio: ["ignore", logDescriptor, logDescriptor],
    });
    await Promise.race([
      once(child, "spawn"),
      once(child, "error").then(([error]) => Promise.reject(error)),
    ]);
    child.unref();
  } finally {
    closeSync(logDescriptor);
  }
  return { ...(await waitForLiveStatus(arguments_.stateDir)), alreadyRunning: false };
}

async function stopDetached(stateDir: string): Promise<Record<string, unknown>> {
  const state = await readState(stateDir);
  if (state === undefined || !processIsAlive(state.pid)) {
    await removeOwnedFiles(stateDir);
    return { ok: true, fixtureOnly: true, stopped: true, wasRunning: false };
  }
  await controlRequest(state, "POST", "/stop");
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!processIsAlive(state.pid) && (await readState(stateDir)) === undefined) {
      return { ok: true, fixtureOnly: true, stopped: true, wasRunning: true };
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return fail("fixture companion did not stop cleanly");
}

function printResult(value: Record<string, unknown>, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  const companion = record(value.companion) ? value.companion : undefined;
  const adapter = companion && record(companion.adapter) ? companion.adapter : undefined;
  const state = typeof companion?.state === "string"
    ? companion.state
    : value.stopped === true
      ? "stopped"
      : "inactive";
  const targetCount = typeof adapter?.targetCount === "number" ? adapter.targetCount : 0;
  process.stdout.write(`Pointable Context fixture companion: ${state}; targets=${targetCount}; fixture-only=true\n`);
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.command === "run") {
    await runServer(arguments_);
    return;
  }
  if (arguments_.command === "start") {
    printResult(await startDetached(arguments_), arguments_.json);
    return;
  }
  if (arguments_.command === "stop") {
    printResult(await stopDetached(arguments_.stateDir), arguments_.json);
    return;
  }
  const status = await liveStatus(arguments_.stateDir);
  printResult(status ?? { ok: true, fixtureOnly: true, stopped: true }, arguments_.json);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

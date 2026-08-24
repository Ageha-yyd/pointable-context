import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  link,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { checkContextRecords } from "./context-record-check.js";

const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_TEXT_CHARS = 1_024;
const MAX_COMMAND_CHARS = 512;
const MAX_ARGUMENT_CHARS = 2_048;
const MAX_ARGUMENTS = 64;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 30 * 60 * 1_000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024;
const GIT_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;

export type TestExecutionOutcome =
  | "passed"
  | "failed"
  | "timed_out"
  | "aborted"
  | "output_limit_exceeded";

export interface TestExecutionRequest {
  schemaVersion: 1;
  verificationId: string;
  title: string;
  claim: string;
  gap: string;
  command: {
    file: string;
    args: readonly string[];
  };
  timeoutMs: number;
}

export interface TestExecutionSnapshot {
  head: string;
  statusSha256: string;
  clean: boolean;
  revision: string;
}

export interface TestExecutionEvent {
  schemaVersion: 1;
  runId: string;
  verificationId: string;
  workspaceId: string;
  startedAt: string;
  finishedAt: string;
  outcome: TestExecutionOutcome;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  revisionDrift: boolean;
  before: TestExecutionSnapshot;
  after: TestExecutionSnapshot;
  commandSha256: string;
  stdoutSha256: string;
  stdoutBytes: number;
  stderrSha256: string;
  stderrBytes: number;
  eventSha256: string;
}

export interface TestExecutionResult {
  event: TestExecutionEvent;
  privateEventPath: string;
  evidencePath: string;
  verificationPath: string;
  recordValid: true;
}

export class TestExecutionError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = "TestExecutionError";
    this.code = code;
  }
}

interface RunOptions {
  signal?: AbortSignal;
  now?: () => Date;
  runId?: string;
  stateRoot?: string;
  maxOutputBytes?: number;
  writeStdout?: (chunk: Buffer) => void;
  writeStderr?: (chunk: Buffer) => void;
}

interface ProcessObservation {
  outcome: TestExecutionOutcome;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdoutSha256: string;
  stdoutBytes: number;
  stderrSha256: string;
  stderrBytes: number;
}

function objectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function boundedText(value: unknown, name: string, maximum = MAX_TEXT_CHARS): string {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new TestExecutionError("request_invalid", `${name} is invalid`);
  }
  const compact = value.replace(/\s+/gu, " ").trim();
  if (compact.length < 1 || compact.length > maximum) {
    throw new TestExecutionError("request_invalid", `${name} is invalid`);
  }
  return compact;
}

function verificationId(value: unknown): string {
  const parsed = boundedText(value, "verificationId", 80);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(parsed)) {
    throw new TestExecutionError("request_invalid", "verificationId is invalid");
  }
  return parsed;
}

function title(value: unknown): string {
  const parsed = boundedText(value, "title", 128);
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._()/-]*$/u.test(parsed)) {
    throw new TestExecutionError("request_invalid", "title is invalid");
  }
  return parsed;
}

function commandPart(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new TestExecutionError("request_invalid", `${name} is invalid`);
  }
  if (/[\u0000\r\n]/u.test(value)) {
    throw new TestExecutionError("request_invalid", `${name} is invalid`);
  }
  return value;
}

export function parseTestExecutionRequest(value: unknown): TestExecutionRequest {
  if (
    !objectRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "verificationId",
      "title",
      "claim",
      "gap",
      "command",
      "timeoutMs",
    ]) ||
    value.schemaVersion !== 1 ||
    !objectRecord(value.command) ||
    !exactKeys(value.command, ["file", "args"]) ||
    !Array.isArray(value.command.args) ||
    value.command.args.length > MAX_ARGUMENTS ||
    !Number.isSafeInteger(value.timeoutMs) ||
    (value.timeoutMs as number) < MIN_TIMEOUT_MS ||
    (value.timeoutMs as number) > MAX_TIMEOUT_MS
  ) {
    throw new TestExecutionError("request_invalid", "test execution request is invalid");
  }
  const args = value.command.args.map((argument, index) =>
    commandPart(argument, `command.args[${index}]`, MAX_ARGUMENT_CHARS));
  return Object.freeze({
    schemaVersion: 1 as const,
    verificationId: verificationId(value.verificationId),
    title: title(value.title),
    claim: boundedText(value.claim, "claim"),
    gap: boundedText(value.gap, "gap"),
    command: Object.freeze({
      file: commandPart(value.command.file, "command.file", MAX_COMMAND_CHARS),
      args: Object.freeze(args),
    }),
    timeoutMs: value.timeoutMs as number,
  });
}

export async function readTestExecutionRequest(path: string): Promise<TestExecutionRequest> {
  if (!isAbsolute(path)) throw new TestExecutionError("request_invalid", "request path must be absolute");
  const info = await stat(path).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.size > MAX_REQUEST_BYTES) {
    throw new TestExecutionError("request_invalid", "request file is invalid or too large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new TestExecutionError("request_invalid", "request JSON is invalid");
  }
  return parseTestExecutionRequest(parsed);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function portableRelative(root: string, target: string): string | undefined {
  const value = relative(root, target);
  if (value === "" || value === ".." || value.startsWith(`..${sep}`)) return undefined;
  return value.split(sep).join("/");
}

async function captureProcess(
  file: string,
  args: readonly string[],
  cwd: string,
  limitBytes: number,
  timeoutMs: number,
): Promise<Buffer> {
  return await new Promise<Buffer>((resolvePromise, rejectPromise) => {
    const child = spawn(file, [...args], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      rejectPromise(new TestExecutionError("git_snapshot_unavailable"));
    }, timeoutMs);
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      rejectPromise(error instanceof TestExecutionError
        ? error
        : new TestExecutionError("git_snapshot_unavailable"));
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > limitBytes) {
        fail(new TestExecutionError("git_snapshot_unavailable"));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > limitBytes) fail(new TestExecutionError("git_snapshot_unavailable"));
    });
    child.once("error", fail);
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        rejectPromise(new TestExecutionError("git_snapshot_unavailable"));
        return;
      }
      resolvePromise(Buffer.concat(chunks));
    });
  });
}

async function gitSnapshot(root: string): Promise<TestExecutionSnapshot> {
  const headOutput = await captureProcess(
    "git",
    ["rev-parse", "--verify", "HEAD"],
    root,
    GIT_OUTPUT_LIMIT_BYTES,
    5_000,
  );
  const head = headOutput.toString("utf8").trim();
  if (!/^[a-f0-9]{40,64}$/u.test(head)) {
    throw new TestExecutionError("git_snapshot_unavailable");
  }
  const status = await captureProcess(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    root,
    GIT_OUTPUT_LIMIT_BYTES,
    5_000,
  );
  const statusSha256 = sha256(status);
  return Object.freeze({
    head,
    statusSha256,
    clean: status.byteLength === 0,
    revision: `git:${head}+status:${statusSha256}`,
  });
}

async function terminate(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolvePromise) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", () => {
        child.kill();
        resolvePromise();
      });
      killer.once("close", () => resolvePromise());
    });
    return;
  }
  child.kill("SIGTERM");
}

async function observeProcess(
  root: string,
  request: TestExecutionRequest,
  options: RunOptions,
): Promise<ProcessObservation> {
  if (options.signal?.aborted) throw new TestExecutionError("request_aborted");
  const outputLimit = options.maxOutputBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
  if (!Number.isSafeInteger(outputLimit) || outputLimit < 1_024 || outputLimit > 64 * 1024 * 1024) {
    throw new TestExecutionError("runner_configuration_invalid");
  }
  return await new Promise<ProcessObservation>((resolvePromise, rejectPromise) => {
    const stdoutHash = createHash("sha256");
    const stderrHash = createHash("sha256");
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let termination: "timed_out" | "aborted" | "output_limit_exceeded" | undefined;
    let settled = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(request.command.file, [...request.command.args], {
        cwd: root,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      rejectPromise(new TestExecutionError("command_start_failed"));
      return;
    }
    const requestTermination = (reason: typeof termination): void => {
      if (termination !== undefined || settled) return;
      termination = reason;
      void terminate(child);
    };
    const timer = setTimeout(() => requestTermination("timed_out"), request.timeoutMs);
    const abort = (): void => requestTermination("aborted");
    options.signal?.addEventListener("abort", abort, { once: true });
    const cleanup = (): void => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    };
    const handle = (
      kind: "stdout" | "stderr",
      raw: Buffer | string,
    ): void => {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (kind === "stdout") {
        stdoutBytes += chunk.byteLength;
        stdoutHash.update(chunk);
        options.writeStdout?.(chunk);
      } else {
        stderrBytes += chunk.byteLength;
        stderrHash.update(chunk);
        options.writeStderr?.(chunk);
      }
      if (stdoutBytes + stderrBytes > outputLimit) requestTermination("output_limit_exceeded");
    };
    child.stdout?.on("data", (chunk: Buffer | string) => handle("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer | string) => handle("stderr", chunk));
    child.once("error", () => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(new TestExecutionError("command_start_failed"));
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      const outcome: TestExecutionOutcome = termination ?? (code === 0 ? "passed" : "failed");
      resolvePromise(Object.freeze({
        outcome,
        exitCode: code,
        signal,
        timedOut: termination === "timed_out",
        stdoutSha256: stdoutHash.digest("hex"),
        stdoutBytes,
        stderrSha256: stderrHash.digest("hex"),
        stderrBytes,
      }));
    });
  });
}

function defaultStateRoot(): string {
  const local = process.env.LOCALAPPDATA;
  const base = local && isAbsolute(local) ? local : homedir();
  return resolve(base, "PointableContext", "test-executions");
}

async function ensureTargetAbsent(path: string): Promise<void> {
  try {
    await access(path, constants.F_OK);
  } catch {
    return;
  }
  throw new TestExecutionError("verification_already_exists");
}

async function atomicCreate(path: string, content: string): Promise<void> {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  const temporary = join(parent, `.${basename(path)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, path);
    await rm(temporary, { force: true });
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function prepareWorkspaceTarget(
  root: string,
  relativePath: string,
): Promise<string> {
  const requested = join(root, ...relativePath.split("/"));
  const requestedParent = dirname(requested);
  await mkdir(requestedParent, { recursive: true });
  const canonicalParent = await realpath(requestedParent);
  const expectedParent = relativePath.split("/").slice(0, -1).join("/");
  if (portableRelative(root, canonicalParent) !== expectedParent) {
    throw new TestExecutionError("workspace_output_unavailable");
  }
  return join(canonicalParent, basename(relativePath));
}

function commandDigest(request: TestExecutionRequest): string {
  return sha256(JSON.stringify({ file: request.command.file, args: request.command.args }));
}

function resultText(event: TestExecutionEvent): string {
  if (event.revisionDrift) {
    return "inconclusive。命令执行期间工作区修订发生漂移，不能把结果绑定为单一快照。";
  }
  if (event.outcome === "passed" && !event.revisionDrift) {
    return "PASS。受限 runner 实际启动声明命令，进程以 exit 0 结束，并绑定了 stdout/stderr 摘要。";
  }
  if (event.outcome === "failed") {
    return `FAIL。受限 runner 实际启动声明命令，进程以 exit ${event.exitCode ?? "unknown"} 结束。`;
  }
  return `inconclusive。受限 runner 观察到 ${event.outcome}，没有将其解释为测试 PASS。`;
}

function evidenceLine(event: TestExecutionEvent): string {
  return [
    "TEST_EXECUTION_EVENT v1",
    `run=${event.runId}`,
    `outcome=${event.outcome}`,
    `exit=${event.exitCode ?? "null"}`,
    `revision=${event.before.revision}`,
    `started=${event.startedAt}`,
    `finished=${event.finishedAt}`,
    `command_sha256=${event.commandSha256}`,
    `stdout_sha256=${event.stdoutSha256}`,
    `stderr_sha256=${event.stderrSha256}`,
    `drift=${event.revisionDrift}`,
    `event_sha256=${event.eventSha256}`,
  ].join("; ");
}

function verificationMarkdown(
  request: TestExecutionRequest,
  event: TestExecutionEvent,
  sourcePath: string,
  evidence: string,
): string {
  const revision = event.revisionDrift
    ? `${event.before.revision} -> ${event.after.revision}`
    : event.before.revision;
  const fixedGap = event.revisionDrift
    ? "该事件不能证明单一修订上的结果。"
    : "该事件只证明这一次声明命令及其进程终态，不证明未执行测试、原生 UI、人效或跨宿主兼容性。";
  return `# ${request.title}

## 要证明什么

${request.claim}

## 结果

${resultText(event)}

## 尚未证明

${request.gap} ${fixedGap}

## 验证方式

Pointable Context Test Execution Runner 以 shell=false 启动进程，观察真实退出状态，并绑定命令、stdout、stderr 与前后 Git 快照的 SHA-256。

## 验证修订

${revision}

## 执行时间

${event.finishedAt}

## 证据

> ${evidence}

## 来源

${sourcePath}:1
`;
}

export async function runTestExecution(
  workspaceRoot: string,
  rawRequest: unknown,
  options: RunOptions = {},
): Promise<TestExecutionResult> {
  const request = parseTestExecutionRequest(rawRequest);
  let root: string;
  try {
    root = await realpath(resolve(workspaceRoot));
    if (!(await stat(root)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new TestExecutionError("workspace_unavailable");
  }
  const evidenceRelative = `docs/evidence/test-executions/${request.verificationId}.txt`;
  const verificationRelative = `docs/verifications/${request.verificationId}.md`;
  const evidencePath = await prepareWorkspaceTarget(root, evidenceRelative);
  const verificationPath = await prepareWorkspaceTarget(root, verificationRelative);
  await ensureTargetAbsent(evidencePath);
  await ensureTargetAbsent(verificationPath);

  const before = await gitSnapshot(root);
  const startedAt = (options.now ?? (() => new Date()))().toISOString();
  const observation = await observeProcess(root, request, options);
  const finishedAt = (options.now ?? (() => new Date()))().toISOString();
  const after = await gitSnapshot(root);
  const revisionDrift = before.revision !== after.revision;
  const runId = options.runId ?? randomUUID();
  if (!/^[a-f0-9-]{16,64}$/u.test(runId)) throw new TestExecutionError("runner_configuration_invalid");
  const unsigned = {
    schemaVersion: 1 as const,
    runId,
    verificationId: request.verificationId,
    workspaceId: sha256(root),
    startedAt,
    finishedAt,
    outcome: observation.outcome,
    exitCode: observation.exitCode,
    signal: observation.signal,
    timedOut: observation.timedOut,
    revisionDrift,
    before,
    after,
    commandSha256: commandDigest(request),
    stdoutSha256: observation.stdoutSha256,
    stdoutBytes: observation.stdoutBytes,
    stderrSha256: observation.stderrSha256,
    stderrBytes: observation.stderrBytes,
  };
  const event: TestExecutionEvent = Object.freeze({
    ...unsigned,
    eventSha256: sha256(JSON.stringify(unsigned)),
  });

  const stateRoot = resolve(options.stateRoot ?? defaultStateRoot());
  await mkdir(stateRoot, { recursive: true });
  const canonicalStateRoot = await realpath(stateRoot);
  const workspaceState = join(canonicalStateRoot, event.workspaceId);
  await mkdir(workspaceState, { recursive: true });
  const canonicalWorkspaceState = await realpath(workspaceState);
  if (portableRelative(canonicalStateRoot, canonicalWorkspaceState) !== event.workspaceId) {
    throw new TestExecutionError("event_store_unavailable");
  }
  const privateEventPath = join(canonicalWorkspaceState, `${event.runId}.json`);
  await ensureTargetAbsent(privateEventPath);
  await atomicCreate(privateEventPath, `${JSON.stringify({ event }, null, 2)}\n`);

  const evidence = evidenceLine(event);
  await atomicCreate(evidencePath, `${evidence}\n`);
  try {
    await atomicCreate(
      verificationPath,
      verificationMarkdown(request, event, evidenceRelative, evidence),
    );
    const check = await checkContextRecords(root);
    if (!check.valid || !check.records.some((record) => record.path === verificationRelative)) {
      throw new TestExecutionError("record_gate_failed");
    }
  } catch (error) {
    await rm(verificationPath, { force: true }).catch(() => undefined);
    await rm(evidencePath, { force: true }).catch(() => undefined);
    throw error;
  }

  return Object.freeze({
    event,
    privateEventPath,
    evidencePath: evidenceRelative,
    verificationPath: verificationRelative,
    recordValid: true as const,
  });
}

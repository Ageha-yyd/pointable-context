import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type {
  ContextBindingPort,
  ContextBindingResult,
  ContextScopeRef,
  HostContext,
  TrustedContextBinding,
} from "../../contracts.js";
import { sameContextScope } from "../../context-scope.js";
import { ContractError } from "../../validation.js";
import type { CodexHostTaskContext } from "./host-context.js";

const REGISTRY_SCHEMA_VERSION = 1;
const MAX_REGISTRY_BYTES = 1024 * 1024;
const MAX_REGISTRY_ENTRIES = 2_048;
export const LOCAL_WORKSPACE_NAMESPACE = "local-filesystem-v1";
export const LOCAL_WORKSPACE_PROVIDER_ID = "local-filesystem";

export interface CodexTaskWorkspaceBindingEntry {
  schemaVersion: 1;
  host: "codex-desktop";
  threadId: string;
  hostId: string;
  scope: ContextScopeRef;
  workspaceRoot: string;
  providerId: typeof LOCAL_WORKSPACE_PROVIDER_ID;
  bindingRevision: string;
  boundAt: string;
}

interface RegistryDocument {
  schemaVersion: 1;
  entries: CodexTaskWorkspaceBindingEntry[];
}

export interface CodexHostTaskAuthority {
  current(signal?: AbortSignal): Promise<CodexHostTaskContext | undefined>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string")) return false;
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function identity(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256 ||
    !/^[A-Za-z0-9:_-]+$/u.test(value)
  ) {
    throw new ContractError(`${name} is invalid`);
  }
  return value;
}

function normalizedPath(value: string): string {
  return process.platform === "win32" ? value.toLocaleLowerCase("en-US") : value;
}

function pathsEqual(left: string, right: string): boolean {
  return normalizedPath(left) === normalizedPath(right);
}

function taskKey(task: Pick<CodexHostTaskContext, "hostId" | "threadId">): string {
  return `${task.hostId}\u0000${task.threadId}`;
}

export function codexTaskThreadRef(
  task: Pick<CodexHostTaskContext, "hostId" | "threadId">,
): string {
  return `codex-desktop:${task.hostId}:${task.threadId}`;
}

export function localWorkspaceScope(canonicalRoot: string): ContextScopeRef {
  const id = createHash("sha256")
    .update(`${LOCAL_WORKSPACE_NAMESPACE}\u0000${normalizedPath(canonicalRoot)}`, "utf8")
    .digest("hex");
  return Object.freeze({
    kind: "workspace",
    namespace: LOCAL_WORKSPACE_NAMESPACE,
    id,
  });
}

function copyEntry(entry: CodexTaskWorkspaceBindingEntry): CodexTaskWorkspaceBindingEntry {
  return Object.freeze({
    ...entry,
    scope: Object.freeze({ ...entry.scope }),
  });
}

function parseEntry(value: unknown, index: number): CodexTaskWorkspaceBindingEntry {
  if (
    !record(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "host",
      "threadId",
      "hostId",
      "scope",
      "workspaceRoot",
      "providerId",
      "bindingRevision",
      "boundAt",
    ]) ||
    value.schemaVersion !== REGISTRY_SCHEMA_VERSION ||
    value.host !== "codex-desktop" ||
    !record(value.scope) ||
    !exactKeys(value.scope, ["kind", "namespace", "id"]) ||
    value.scope.kind !== "workspace" ||
    value.scope.namespace !== LOCAL_WORKSPACE_NAMESPACE ||
    typeof value.scope.id !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.scope.id) ||
    typeof value.workspaceRoot !== "string" ||
    !isAbsolute(value.workspaceRoot) ||
    value.workspaceRoot.length > 4_096 ||
    value.providerId !== LOCAL_WORKSPACE_PROVIDER_ID ||
    typeof value.bindingRevision !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.bindingRevision) ||
    typeof value.boundAt !== "string" ||
    !Number.isFinite(Date.parse(value.boundAt))
  ) {
    throw new ContractError(`task workspace binding entry ${index} is invalid`);
  }
  return copyEntry({
    schemaVersion: 1,
    host: "codex-desktop",
    threadId: identity(value.threadId, `entries[${index}].threadId`),
    hostId: identity(value.hostId, `entries[${index}].hostId`),
    scope: {
      kind: "workspace",
      namespace: LOCAL_WORKSPACE_NAMESPACE,
      id: value.scope.id,
    },
    workspaceRoot: resolve(value.workspaceRoot),
    providerId: LOCAL_WORKSPACE_PROVIDER_ID,
    bindingRevision: value.bindingRevision,
    boundAt: value.boundAt,
  });
}

function parseDocument(value: unknown): RegistryDocument {
  if (
    !record(value) ||
    !exactKeys(value, ["schemaVersion", "entries"]) ||
    value.schemaVersion !== REGISTRY_SCHEMA_VERSION ||
    !Array.isArray(value.entries) ||
    value.entries.length > MAX_REGISTRY_ENTRIES
  ) {
    throw new ContractError("task workspace binding registry is invalid");
  }
  const entries = value.entries.map(parseEntry);
  const keys = new Set<string>();
  for (const entry of entries) {
    const key = taskKey(entry);
    if (keys.has(key)) {
      throw new ContractError("task workspace binding registry contains duplicate tasks");
    }
    keys.add(key);
  }
  return { schemaVersion: 1, entries };
}

export class CodexTaskWorkspaceBindingRegistry {
  readonly path: string;

  constructor(path: string) {
    if (!isAbsolute(path)) {
      throw new TypeError("task workspace binding registry path must be absolute");
    }
    this.path = resolve(path);
  }

  async #read(): Promise<RegistryDocument> {
    let content: string;
    try {
      const info = await stat(this.path);
      if (!info.isFile() || info.size > MAX_REGISTRY_BYTES) {
        throw new ContractError("task workspace binding registry file is invalid");
      }
      content = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, entries: [] };
      }
      throw error;
    }
    try {
      return parseDocument(JSON.parse(content) as unknown);
    } catch (error) {
      if (error instanceof ContractError) throw error;
      throw new ContractError("task workspace binding registry JSON is malformed");
    }
  }

  async #write(document: RegistryDocument): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    const body = `${JSON.stringify(document, null, 2)}\n`;
    if (Buffer.byteLength(body, "utf8") > MAX_REGISTRY_BYTES) {
      throw new ContractError("task workspace binding registry exceeds its byte budget");
    }
    await writeFile(temporary, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, this.path);
  }

  async bind(
    task: CodexHostTaskContext,
    workspaceRoot: string,
  ): Promise<CodexTaskWorkspaceBindingEntry> {
    if (!isAbsolute(workspaceRoot)) {
      throw new TypeError("workspace root must be absolute");
    }
    const canonicalRoot = await realpath(resolve(workspaceRoot));
    const rootInfo = await stat(canonicalRoot);
    if (!rootInfo.isDirectory()) {
      throw new ContractError("workspace root must be a directory");
    }
    const document = await this.#read();
    const entry = copyEntry({
      schemaVersion: 1,
      host: "codex-desktop",
      threadId: identity(task.threadId, "task.threadId"),
      hostId: identity(task.hostId, "task.hostId"),
      scope: localWorkspaceScope(canonicalRoot),
      workspaceRoot: canonicalRoot,
      providerId: LOCAL_WORKSPACE_PROVIDER_ID,
      bindingRevision: randomBytes(32).toString("hex"),
      boundAt: new Date().toISOString(),
    });
    const key = taskKey(task);
    const entries = document.entries.filter((candidate) => taskKey(candidate) !== key);
    if (entries.length >= MAX_REGISTRY_ENTRIES) {
      throw new ContractError("task workspace binding registry is full");
    }
    entries.push(entry);
    entries.sort((left, right) => taskKey(left).localeCompare(taskKey(right)));
    await this.#write({ schemaVersion: 1, entries });
    return copyEntry(entry);
  }

  async find(
    task: Pick<CodexHostTaskContext, "hostId" | "threadId">,
  ): Promise<CodexTaskWorkspaceBindingEntry | undefined> {
    const key = taskKey(task);
    const entry = (await this.#read()).entries.find((candidate) => taskKey(candidate) === key);
    return entry === undefined ? undefined : copyEntry(entry);
  }

  async unbind(
    task: Pick<CodexHostTaskContext, "hostId" | "threadId">,
  ): Promise<CodexTaskWorkspaceBindingEntry | undefined> {
    const document = await this.#read();
    const key = taskKey(task);
    const removed = document.entries.find((candidate) => taskKey(candidate) === key);
    if (removed === undefined) return undefined;
    await this.#write({
      schemaVersion: 1,
      entries: document.entries.filter((candidate) => taskKey(candidate) !== key),
    });
    return copyEntry(removed);
  }
}

function sameTask(left: CodexHostTaskContext, right: CodexHostTaskContext): boolean {
  return (
    left.host === right.host &&
    left.hostId === right.hostId &&
    left.threadId === right.threadId &&
    left.routeRef === right.routeRef &&
    left.contextFingerprint === right.contextFingerprint
  );
}

export class CodexTaskWorkspaceBindingPort implements ContextBindingPort {
  constructor(
    readonly registry: CodexTaskWorkspaceBindingRegistry,
    readonly initialTask: CodexHostTaskContext,
    readonly authority: CodexHostTaskAuthority,
  ) {}

  async #currentEntry(signal?: AbortSignal): Promise<
    { task: CodexHostTaskContext; entry: CodexTaskWorkspaceBindingEntry } | undefined
  > {
    if (signal?.aborted) return undefined;
    const current = await this.authority.current(signal);
    if (current === undefined || !sameTask(current, this.initialTask)) return undefined;
    const entry = await this.registry.find(current);
    if (entry === undefined) return undefined;
    const canonicalRoot = await realpath(entry.workspaceRoot);
    if (
      signal?.aborted ||
      !pathsEqual(canonicalRoot, entry.workspaceRoot) ||
      !sameContextScope(entry.scope, localWorkspaceScope(canonicalRoot))
    ) {
      return undefined;
    }
    return { task: current, entry };
  }

  async resolve(context: HostContext, signal?: AbortSignal): Promise<ContextBindingResult> {
    const current = await this.#currentEntry(signal);
    if (current === undefined) return { kind: "missing" };
    const expectedThreadRef = codexTaskThreadRef(current.task);
    if (
      context.threadRef !== expectedThreadRef ||
      context.routeRef !== current.task.routeRef ||
      context.selectionGeneration < 1 ||
      context.explicitScope === undefined ||
      !sameContextScope(context.explicitScope, current.entry.scope) ||
      context.workspaceRoot === undefined ||
      !pathsEqual(context.workspaceRoot, current.entry.workspaceRoot)
    ) {
      return { kind: "context_changed" };
    }
    return this.#trusted(current.entry, current.task, context.selectionGeneration);
  }

  async revalidate(
    binding: TrustedContextBinding,
    signal?: AbortSignal,
  ): Promise<ContextBindingResult> {
    const current = await this.#currentEntry(signal);
    if (current === undefined) return { kind: "context_changed" };
    const expectedThreadRef = codexTaskThreadRef(current.task);
    if (
      binding.evidence !== "explicit_user" ||
      binding.threadRef !== expectedThreadRef ||
      binding.routeRef !== current.task.routeRef ||
      binding.workspaceRoot === undefined ||
      !pathsEqual(binding.workspaceRoot, current.entry.workspaceRoot) ||
      binding.bindingRevision !== current.entry.bindingRevision ||
      !sameContextScope(binding.scope, current.entry.scope)
    ) {
      return { kind: "context_changed" };
    }
    return this.#trusted(current.entry, current.task, binding.selectionGeneration);
  }

  #trusted(
    entry: CodexTaskWorkspaceBindingEntry,
    task: CodexHostTaskContext,
    selectionGeneration: number,
  ): TrustedContextBinding {
    return {
      kind: "trusted",
      scope: { ...entry.scope },
      bindingRevision: entry.bindingRevision,
      evidence: "explicit_user",
      selectionGeneration,
      threadRef: codexTaskThreadRef(task),
      routeRef: task.routeRef,
      workspaceRoot: entry.workspaceRoot,
    };
  }
}

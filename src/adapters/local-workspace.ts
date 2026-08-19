import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { open, readdir, realpath, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import type {
  AuthorityResult,
  AuthoritativeProvider,
  ContextIndexPort,
  IdentityRecord,
  TrustedContextBinding,
} from "../contracts.js";
import { sameContextScope } from "../context-scope.js";
import { ContractError } from "../validation.js";
import {
  LOCAL_WORKSPACE_PROVIDER_ID,
  localWorkspaceScope,
} from "../host/codex-cdp/task-workspace-binding.js";
import {
  extractMarkdownArtifactContext,
  type MarkdownArtifactContext,
} from "./markdown-artifact.js";
import {
  contextChangeDocumentPath,
  contextConceptDocumentPath,
  contextDecisionDocumentPath,
  contextTaskDocumentPath,
  contextVerificationDocumentPath,
  extractContextChangeArtifact,
  extractContextConceptArtifact,
  extractContextDecisionArtifact,
  extractContextTaskArtifact,
  extractContextVerificationArtifact,
  type ContextArtifactEvidence,
  type ContextChangeArtifact,
  type ContextConceptArtifact,
  type ContextDecisionArtifact,
  type ContextTaskArtifact,
  type ContextVerificationArtifact,
} from "./context-concept.js";
import {
  extractSourceModuleArtifactContext,
  sourceModulePath,
  type SourceModuleArtifactContext,
} from "./source-module-artifact.js";
import {
  decisionDocumentPath,
  extractDecisionDocumentContext,
  extractJsonConfigurationContext,
  extractStaticTestDefinitionContext,
  jsonConfigurationPath,
  testSourcePath,
} from "./workspace-scenario.js";

const DEFAULT_MAX_FILES = 2_048;
const DEFAULT_MAX_DEPTH = 12;
const MAX_RELATIVE_PATH_CHARS = 512;
const MAX_PREVIEW_FILE_BYTES = 1024 * 1024;
const REVISION_GIT_TIMEOUT_MS = 750;
const MAX_REVISION_GIT_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

export interface LocalWorkspaceIndexOptions {
  maxFiles?: number;
  maxDepth?: number;
  ignoredDirectories?: Iterable<string>;
}

interface IndexedFile {
  absolutePath: string;
  relativePath: string;
  size: number;
  modifiedMs: number;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return candidate;
}

function normalizedPath(value: string): string {
  return process.platform === "win32" ? value.toLocaleLowerCase("en-US") : value;
}

function pathsEqual(left: string, right: string): boolean {
  return normalizedPath(left) === normalizedPath(right);
}

function portablePath(value: string): string {
  return value.split(sep).join("/");
}

function containedRelative(root: string, target: string): string | undefined {
  const child = relative(root, target);
  if (
    child.length === 0 ||
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    isAbsolute(child)
  ) {
    return undefined;
  }
  return portablePath(child);
}

function fileEntityId(relativePath: string): string {
  return `file:${relativePath}`;
}

function markdownDocument(relativePath: string): boolean {
  const extension = extname(relativePath).toLocaleLowerCase("en-US");
  return extension === ".md" || extension === ".mdx";
}

function workspaceEntityType(relativePath: string): string {
  if (contextConceptDocumentPath(relativePath)) return "concept";
  if (contextChangeDocumentPath(relativePath)) return "change";
  if (contextDecisionDocumentPath(relativePath)) return "decision";
  if (contextTaskDocumentPath(relativePath)) return "task";
  if (contextVerificationDocumentPath(relativePath)) return "verification";
  if (decisionDocumentPath(relativePath)) return "decision";
  if (markdownDocument(relativePath)) return "document";
  if (testSourcePath(relativePath)) return "verification";
  if (sourceModulePath(relativePath)) return "module";
  if (jsonConfigurationPath(relativePath)) return "configuration";
  return "file";
}

function contextArtifactCanonicalName(relativePath: string): string {
  const name = basename(relativePath);
  const extension = extname(name);
  const stem = extension.length === 0 ? name : name.slice(0, -extension.length);
  if (stem.length === 0) return name;
  return stem
    .split(/[-_]+/u)
    .filter((word) => word.length > 0)
    .map((word) => `${word[0]?.toLocaleUpperCase("en-US") ?? ""}${word.slice(1)}`)
    .join(" ");
}

async function verifiedWorkspaceRoot(binding: TrustedContextBinding): Promise<string> {
  if (!binding.workspaceRoot || !isAbsolute(binding.workspaceRoot)) {
    throw new ContractError("local workspace provider requires a bound workspace root");
  }
  const canonicalRoot = await realpath(binding.workspaceRoot);
  const info = await stat(canonicalRoot);
  if (!info.isDirectory()) {
    throw new ContractError("bound workspace root is not a directory");
  }
  if (
    !pathsEqual(canonicalRoot, binding.workspaceRoot) ||
    !sameContextScope(binding.scope, localWorkspaceScope(canonicalRoot))
  ) {
    throw new ContractError("local workspace scope no longer matches its canonical root");
  }
  return canonicalRoot;
}

function safeAlias(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.length <= 512 ? trimmed : undefined;
}

function fileAliases(relativePath: string): string[] {
  const name = basename(relativePath);
  const extension = extname(name);
  const stem = extension.length === 0 ? name : name.slice(0, -extension.length);
  return [...new Set([
    safeAlias(stem),
  ].filter((value): value is string => value !== undefined && value !== name))];
}

async function scanWorkspace(
  root: string,
  maxFiles: number,
  maxDepth: number,
  ignoredDirectories: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<IndexedFile[]> {
  const files: IndexedFile[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (signal?.aborted) throw signal.reason ?? new Error("workspace scan aborted");
    if (depth > maxDepth) {
      throw new ContractError("workspace index exceeds its directory depth bound");
    }
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      if (signal?.aborted) throw signal.reason ?? new Error("workspace scan aborted");
      if (entry.isSymbolicLink()) continue;
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          await visit(absolutePath, depth + 1);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = containedRelative(root, absolutePath);
      if (relativePath === undefined || relativePath.length > MAX_RELATIVE_PATH_CHARS) {
        throw new ContractError("workspace file path exceeds the representable bound");
      }
      const info = await stat(absolutePath);
      files.push({
        absolutePath,
        relativePath,
        size: info.size,
        modifiedMs: info.mtimeMs,
      });
      if (files.length > maxFiles) {
        throw new ContractError("workspace index exceeds its file count bound");
      }
    }
  };
  await visit(root, 0);
  return files;
}

function indexRevision(files: readonly IndexedFile[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath, "utf8");
    hash.update("\u0000", "utf8");
    hash.update(String(file.size), "utf8");
    hash.update("\u0000", "utf8");
    hash.update(String(file.modifiedMs), "utf8");
    hash.update("\n", "utf8");
  }
  return `workspace:${hash.digest("hex")}`;
}

export class LocalWorkspaceContextIndex implements ContextIndexPort {
  readonly #maxFiles: number;
  readonly #maxDepth: number;
  readonly #ignoredDirectories: ReadonlySet<string>;

  constructor(options: LocalWorkspaceIndexOptions = {}) {
    this.#maxFiles = boundedInteger(
      options.maxFiles,
      DEFAULT_MAX_FILES,
      1,
      DEFAULT_MAX_FILES,
      "maxFiles",
    );
    this.#maxDepth = boundedInteger(options.maxDepth, DEFAULT_MAX_DEPTH, 1, 64, "maxDepth");
    this.#ignoredDirectories = new Set(
      options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES,
    );
  }

  async list(binding: TrustedContextBinding, signal?: AbortSignal): Promise<IdentityRecord[]> {
    const root = await verifiedWorkspaceRoot(binding);
    const files = await scanWorkspace(
      root,
      this.#maxFiles,
      this.#maxDepth,
      this.#ignoredDirectories,
      signal,
    );
    const revision = indexRevision(files);
    const indexedAt = new Date().toISOString();
    return files.map((file) => {
      const name = basename(file.relativePath);
      const parent = portablePath(dirname(file.relativePath));
      const entityType = workspaceEntityType(file.relativePath);
      const explicitMentalModel = entityType === "concept" || entityType === "task" ||
        contextVerificationDocumentPath(file.relativePath) ||
        contextChangeDocumentPath(file.relativePath) ||
        contextDecisionDocumentPath(file.relativePath);
      const canonicalName = explicitMentalModel
        ? contextArtifactCanonicalName(file.relativePath)
        : name;
      return {
        schemaVersion: "1.0",
        scope: { ...binding.scope },
        entityId: fileEntityId(file.relativePath),
        entityType,
        canonicalKey: file.relativePath,
        canonicalName,
        aliases: fileAliases(file.relativePath)
          .filter((alias) => alias !== canonicalName),
        summary: explicitMentalModel
          ? `Explicit ${entityType} mental model in ${parent}`
          : parent === "." ? "Workspace file" : `Workspace file in ${parent}`,
        authorityRef: {
          provider: LOCAL_WORKSPACE_PROVIDER_ID,
          locator: file.relativePath,
        },
        indexRevision: revision,
        indexedAt,
        deleted: false,
      };
    });
  }
}

function contentPreview(content: Buffer): string | undefined {
  if (content.includes(0)) return undefined;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(content);
    const compact = decoded.replace(/\s+/gu, " ").trim();
    return compact.length === 0 ? undefined : compact.slice(0, 800);
  } catch {
    return undefined;
  }
}

function utf8Content(content: Buffer): string | undefined {
  if (content.includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return undefined;
  }
}

function gitStatusLabel(
  status: MarkdownArtifactContext["gitStatus"] | SourceModuleArtifactContext["gitStatus"],
): string {
  switch (status) {
    case "clean": return "clean";
    case "modified": return "modified";
    case "staged": return "staged";
    case "staged_and_modified": return "staged + modified";
    case "untracked": return "untracked";
    case "conflicted": return "conflicted";
    case "unavailable": return "unavailable";
  }
}

function stableFileStat(
  before: Stats,
  after: Stats,
): boolean {
  return (
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs &&
    before.ino === after.ino
  );
}

export async function verifyContextArtifactEvidence(
  root: string,
  artifact: { evidence: ContextArtifactEvidence },
  signal?: AbortSignal,
): Promise<{ sourceId: string; revision: string } | undefined> {
  if (signal?.aborted) return undefined;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const requested = resolve(root, ...artifact.evidence.sourcePath.split("/"));
    const canonical = await realpath(requested);
    if (containedRelative(root, canonical) !== artifact.evidence.sourcePath) return undefined;
    handle = await open(canonical, "r");
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_PREVIEW_FILE_BYTES) return undefined;
    const content = await handle.readFile();
    const decoded = utf8Content(content);
    const after = await handle.stat();
    if (decoded === undefined || !stableFileStat(before, after) || signal?.aborted) {
      return undefined;
    }
    const sourceLine = decoded
      .replace(/\r\n?/gu, "\n")
      .split("\n")[artifact.evidence.sourceLine - 1];
    const compact = sourceLine
      ?.replace(/^\s*(?:(?:[-*+>])|(?:\d+[.)]))\s+/u, "")
      .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    if (compact !== artifact.evidence.excerpt) return undefined;
    return {
      sourceId: `${artifact.evidence.sourcePath}:${artifact.evidence.sourceLine}`,
      revision: createHash("sha256").update(content).digest("hex"),
    };
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export type LocalWorkspaceRevisionProbeResult =
  | { kind: "current"; revision: string; observedAt: string }
  | { kind: "not_found"; observedAt: string }
  | { kind: "unavailable"; observedAt: string; retryable: boolean };

interface RevisionGitResult {
  kind: "ok" | "no_match" | "unavailable";
  stdout: string;
}

function runRevisionGit(
  root: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<RevisionGitResult> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error("revision probe aborted"));
  }
  return new Promise((resolveResult, rejectResult) => {
    execFile("git", [...args], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: REVISION_GIT_TIMEOUT_MS,
      maxBuffer: MAX_REVISION_GIT_OUTPUT_BYTES,
      ...(signal === undefined ? {} : { signal }),
    }, (error, stdout) => {
      if (signal?.aborted) {
        rejectResult(signal.reason ?? new Error("revision probe aborted"));
        return;
      }
      const output = typeof stdout === "string" ? stdout : "";
      if (error === null) {
        resolveResult({ kind: "ok", stdout: output });
        return;
      }
      const code = (error as { code?: unknown }).code;
      resolveResult(code === 1 || code === "1"
        ? { kind: "no_match", stdout: output }
        : { kind: "unavailable", stdout: "" });
    });
  });
}

function revisionRelationPaths(
  value: string,
  locator: string,
  entityType: string,
): string[] {
  const paths: string[] = [];
  for (const raw of value.split("\u0000")) {
    const path = raw.replace(/\\/gu, "/").trim();
    if (
      path.length < 1 ||
      path.length > MAX_RELATIVE_PATH_CHARS ||
      path === locator ||
      path.startsWith("../") ||
      /^(?:dist|host|mcp|node_modules)\//u.test(path) ||
      ((entityType === "module" || entityType === "verification") && !sourceModulePath(path)) ||
      paths.includes(path)
    ) {
      continue;
    }
    paths.push(path);
  }
  return paths.sort((left, right) => left.localeCompare(right, "en"));
}

async function gitRevisionFingerprint(
  root: string,
  locator: string,
  entityType: string,
  signal?: AbortSignal,
): Promise<{ kind: "current"; fingerprint: string } | { kind: "unavailable" }> {
  try {
    const marker = await stat(resolve(root, ".git"));
    if (!marker.isDirectory() && !marker.isFile()) {
      return { kind: "current", fingerprint: "not-repository" };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR"
      ? { kind: "current", fingerprint: "not-repository" }
      : { kind: "unavailable" };
  }
  const rootResult = await runRevisionGit(root, ["rev-parse", "--show-toplevel"], signal);
  if (
    rootResult.kind !== "ok" ||
    !pathsEqual(resolve(rootResult.stdout.trim()), resolve(root))
  ) {
    return { kind: "unavailable" };
  }
  const relationNeedle = entityType === "module" || entityType === "verification"
    ? basename(locator, extname(locator))
    : basename(locator);
  const [statusResult, relationsResult, lastCommitResult] = await Promise.all([
    runRevisionGit(root, [
      "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", locator,
    ], signal),
    runRevisionGit(root, [
      "grep", "-l", "-F", "-z", "-e", relationNeedle, "--", ".",
    ], signal),
    runRevisionGit(root, [
      "log", "-1", "--format=%H%x00%s", "--", locator,
    ], signal),
  ]);
  if (
    statusResult.kind !== "ok" ||
    (relationsResult.kind !== "ok" && relationsResult.kind !== "no_match") ||
    lastCommitResult.kind !== "ok"
  ) {
    return { kind: "unavailable" };
  }
  const base = {
    status: statusResult.stdout,
    relations: revisionRelationPaths(relationsResult.stdout, locator, entityType),
    lastCommit: lastCommitResult.stdout,
  };
  return {
    kind: "current",
    fingerprint: createHash("sha256").update(JSON.stringify(base), "utf8").digest("hex"),
  };
}

async function evidenceRevisionFingerprint(
  root: string,
  canonicalFile: string,
  locator: string,
  entityType: string,
  signal?: AbortSignal,
): Promise<string> {
  const explicitArtifact = entityType === "concept" || entityType === "change" ||
    entityType === "task" || contextVerificationDocumentPath(locator) ||
    contextDecisionDocumentPath(locator);
  if (!explicitArtifact) return "none";
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(canonicalFile, "r");
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_PREVIEW_FILE_BYTES) return "artifact-unavailable";
    const content = await handle.readFile();
    const after = await handle.stat();
    if (!stableFileStat(before, after) || signal?.aborted) return "artifact-unavailable";
    const decoded = utf8Content(content);
    const artifact = decoded === undefined
      ? undefined
      : entityType === "concept"
        ? extractContextConceptArtifact(decoded)
        : entityType === "change"
          ? extractContextChangeArtifact(decoded)
          : entityType === "task"
            ? extractContextTaskArtifact(decoded)
            : contextVerificationDocumentPath(locator)
              ? extractContextVerificationArtifact(decoded)
              : extractContextDecisionArtifact(decoded);
    if (artifact === undefined) return "artifact-invalid";
    const sourcePath = resolve(root, ...artifact.evidence.sourcePath.split("/"));
    const canonicalSource = await realpath(sourcePath);
    if (containedRelative(root, canonicalSource) !== artifact.evidence.sourcePath) {
      return "evidence-outside-scope";
    }
    const sourceInfo = await stat(canonicalSource);
    if (!sourceInfo.isFile()) return "evidence-not-file";
    return createHash("sha256")
      .update(JSON.stringify({
        path: artifact.evidence.sourcePath,
        size: sourceInfo.size,
        modifiedMs: sourceInfo.mtimeMs,
        changedMs: sourceInfo.ctimeMs,
        inode: sourceInfo.ino,
      }), "utf8")
      .digest("hex");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR"
      ? "evidence-not-found"
      : "artifact-unavailable";
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export class LocalWorkspaceRevisionProbe {
  async probe(request: {
    binding: TrustedContextBinding;
    entityId: string;
    entityType: string;
    signal?: AbortSignal;
  }): Promise<LocalWorkspaceRevisionProbeResult> {
    const observedAt = new Date().toISOString();
    if (request.signal?.aborted) {
      return { kind: "unavailable", observedAt, retryable: true };
    }
    if (
      request.entityType !== "file" &&
      request.entityType !== "document" &&
      request.entityType !== "module" &&
      request.entityType !== "verification" &&
      request.entityType !== "configuration" &&
      request.entityType !== "decision" &&
      request.entityType !== "concept" &&
      request.entityType !== "change" &&
      request.entityType !== "task"
    ) {
      return { kind: "not_found", observedAt };
    }
    if (!request.entityId.startsWith("file:")) {
      return { kind: "not_found", observedAt };
    }
    const locator = request.entityId.slice("file:".length);
    if (
      locator.length < 1 ||
      locator.length > MAX_RELATIVE_PATH_CHARS ||
      locator.includes("\\") ||
      locator.startsWith("/") ||
      locator.split("/").includes("..")
    ) {
      return { kind: "not_found", observedAt };
    }
    if (workspaceEntityType(locator) !== request.entityType) {
      return { kind: "not_found", observedAt };
    }
    try {
      const root = await verifiedWorkspaceRoot(request.binding);
      const requestedPath = resolve(root, ...locator.split("/"));
      const canonicalFile = await realpath(requestedPath);
      if (containedRelative(root, canonicalFile) !== locator) {
        return { kind: "not_found", observedAt };
      }
      const info = await stat(canonicalFile);
      if (!info.isFile() || request.signal?.aborted) {
        return { kind: "unavailable", observedAt, retryable: true };
      }
      const git = await gitRevisionFingerprint(
        root,
        locator,
        request.entityType,
        request.signal,
      );
      if (git.kind !== "current" || request.signal?.aborted) {
        return { kind: "unavailable", observedAt, retryable: true };
      }
      const evidence = await evidenceRevisionFingerprint(
        root,
        canonicalFile,
        locator,
        request.entityType,
        request.signal,
      );
      if (request.signal?.aborted) {
        return { kind: "unavailable", observedAt, retryable: true };
      }
      const revision = createHash("sha256")
        .update(JSON.stringify({
          schema: "workspace-context-revision-v2",
          path: locator,
          size: info.size,
          modifiedMs: info.mtimeMs,
          changedMs: info.ctimeMs,
          inode: info.ino,
          git: git.fingerprint,
          evidence,
        }), "utf8")
        .digest("hex");
      return {
        kind: "current",
        revision: `workspace-context-v2:${revision}`,
        observedAt,
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return { kind: "not_found", observedAt };
      }
      if (error instanceof ContractError) throw error;
      return {
        kind: "unavailable",
        observedAt,
        retryable: code !== "EACCES" && code !== "EPERM",
      };
    }
  }
}

export class LocalWorkspaceAuthoritativeProvider implements AuthoritativeProvider {
  readonly providerId = LOCAL_WORKSPACE_PROVIDER_ID;

  async getDetail(request: {
    binding: TrustedContextBinding;
    entityId: string;
    entityType: string;
    authorityLocator: string;
    revisionPolicy: "current-or-explicit-stale";
    signal?: AbortSignal;
  }): Promise<AuthorityResult> {
    if (request.signal?.aborted) return { kind: "unavailable", retryable: true };
    if (
      request.entityType !== "file" &&
      request.entityType !== "document" &&
      request.entityType !== "module" &&
      request.entityType !== "verification" &&
      request.entityType !== "configuration" &&
      request.entityType !== "decision" &&
      request.entityType !== "concept" &&
      request.entityType !== "change" &&
      request.entityType !== "task"
    ) {
      return { kind: "not_found" };
    }
    if (
      request.authorityLocator.length < 1 ||
      request.authorityLocator.length > MAX_RELATIVE_PATH_CHARS ||
      request.authorityLocator.includes("\\") ||
      request.authorityLocator.startsWith("/") ||
      request.authorityLocator.split("/").includes("..") ||
      request.entityId !== fileEntityId(request.authorityLocator) ||
      workspaceEntityType(request.authorityLocator) !== request.entityType
    ) {
      return { kind: "not_found" };
    }
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const root = await verifiedWorkspaceRoot(request.binding);
      const requestedPath = resolve(root, ...request.authorityLocator.split("/"));
      const canonicalFile = await realpath(requestedPath);
      const relativePath = containedRelative(root, canonicalFile);
      if (relativePath !== request.authorityLocator) return { kind: "not_found" };
      handle = await open(canonicalFile, "r");
      const before = await handle.stat();
      if (!before.isFile()) return { kind: "not_found" };
      let content: Buffer | undefined;
      if (before.size <= MAX_PREVIEW_FILE_BYTES) {
        content = await handle.readFile();
      }
      const decoded = content === undefined ? undefined : utf8Content(content);
      const markdownContext =
        (request.entityType === "document" || request.entityType === "decision") &&
          decoded !== undefined
          ? await extractMarkdownArtifactContext({
              root,
              relativePath,
              content: decoded,
              ...(request.signal === undefined ? {} : { signal: request.signal }),
            })
          : undefined;
      const sourceModuleContext =
        (request.entityType === "module" ||
          (request.entityType === "verification" &&
            !contextVerificationDocumentPath(relativePath))) &&
          decoded !== undefined
          ? await extractSourceModuleArtifactContext({
              root,
              relativePath,
              content: decoded,
              ...(request.signal === undefined ? {} : { signal: request.signal }),
            })
          : undefined;
      const conceptContext = request.entityType === "concept" && decoded !== undefined
        ? extractContextConceptArtifact(decoded)
        : undefined;
      const changeContext: ContextChangeArtifact | undefined =
        request.entityType === "change" && decoded !== undefined
          ? extractContextChangeArtifact(decoded)
          : undefined;
      const explicitDecisionContext: ContextDecisionArtifact | undefined =
        request.entityType === "decision" &&
          contextDecisionDocumentPath(relativePath) &&
          decoded !== undefined
          ? extractContextDecisionArtifact(decoded)
          : undefined;
      const taskContext: ContextTaskArtifact | undefined =
        request.entityType === "task" && decoded !== undefined
          ? extractContextTaskArtifact(decoded)
          : undefined;
      const explicitVerificationContext: ContextVerificationArtifact | undefined =
        request.entityType === "verification" &&
          contextVerificationDocumentPath(relativePath) &&
          decoded !== undefined
          ? extractContextVerificationArtifact(decoded)
          : undefined;
      if (request.entityType === "concept" && conceptContext === undefined) {
        return { kind: "not_found" };
      }
      if (request.entityType === "change" && changeContext === undefined) {
        return { kind: "not_found" };
      }
      if (
        request.entityType === "decision" &&
        contextDecisionDocumentPath(relativePath) &&
        explicitDecisionContext === undefined
      ) {
        return { kind: "not_found" };
      }
      if (request.entityType === "task" && taskContext === undefined) {
        return { kind: "not_found" };
      }
      if (
        request.entityType === "verification" &&
        contextVerificationDocumentPath(relativePath) &&
        explicitVerificationContext === undefined
      ) {
        return { kind: "not_found" };
      }
      const after = await handle.stat();
      if (!stableFileStat(before, after) || request.signal?.aborted) {
        return { kind: "unavailable", retryable: true };
      }
      const statRevision = createHash("sha256")
        .update(JSON.stringify({
          path: relativePath,
          size: after.size,
          modifiedMs: after.mtimeMs,
          changedMs: after.ctimeMs,
          inode: after.ino,
        }), "utf8")
        .digest("hex");
      const contentHash = content === undefined
        ? undefined
        : createHash("sha256").update(content).digest("hex");
      const mentalModelContext = conceptContext ?? changeContext ?? explicitDecisionContext ??
        taskContext ?? explicitVerificationContext;
      const artifactEvidence = mentalModelContext === undefined
        ? undefined
        : await verifyContextArtifactEvidence(root, mentalModelContext, request.signal);
      if (mentalModelContext !== undefined && artifactEvidence === undefined) {
        return { kind: "not_found" };
      }
      const detailRevision = createHash("sha256")
        .update(contentHash ?? statRevision, "utf8")
        .update("\u0000", "utf8")
        .update(
          markdownContext?.contextRevision ??
            sourceModuleContext?.contextRevision ??
            conceptContext?.contextRevision ??
            changeContext?.contextRevision ??
            explicitDecisionContext?.contextRevision ??
            taskContext?.contextRevision ??
            explicitVerificationContext?.contextRevision ??
            "file-metadata-v1",
          "utf8",
        )
        .update(artifactEvidence?.revision ?? "", "utf8")
        .digest("hex");
      const extension = extname(relativePath);
      const preview = content === undefined ? undefined : contentPreview(content);
      const observedAt = new Date().toISOString();
      const testContext = request.entityType === "verification" &&
        !contextVerificationDocumentPath(relativePath) && decoded !== undefined
        ? extractStaticTestDefinitionContext(decoded)
        : undefined;
      const configurationContext = request.entityType === "configuration" && decoded !== undefined
        ? extractJsonConfigurationContext(relativePath, decoded)
        : undefined;
      const decisionContext = request.entityType === "decision" &&
        explicitDecisionContext === undefined &&
        decoded !== undefined
        ? extractDecisionDocumentContext(decoded)
        : undefined;
      const markdownFacts = markdownContext === undefined
        ? undefined
        : {
            "用途": markdownContext.purpose ??
              `${markdownContext.title ?? basename(relativePath)} Markdown 文档`,
            "本次变化": markdownContext.changeSummary ??
              (markdownContext.gitAvailable
                ? "当前工作树未检测到未提交变更"
                : "Git 上下文不可用"),
            "影响范围": markdownContext.impactFiles.length > 0
              ? [...markdownContext.impactFiles]
              : "未发现已跟踪引用",
            "Git 状态": gitStatusLabel(markdownContext.gitStatus),
            "路径": relativePath,
          };
      const dependencyAndImpact = sourceModuleContext === undefined
        ? []
        : [
            ...[...sourceModuleContext.dependencies]
              .sort((left, right) => {
                const leftLocal = left.startsWith(".") ? 0 : 1;
                const rightLocal = right.startsWith(".") ? 0 : 1;
                return leftLocal - rightLocal;
              })
              .slice(0, 2)
              .map((value) => `依赖: ${value}`),
            ...sourceModuleContext.impactFiles,
          ].slice(0, 5);
      const moduleFacts = sourceModuleContext === undefined
        ? undefined
        : {
            "职责": sourceModuleContext.role,
            "公开入口": sourceModuleContext.exports.length > 0
              ? [...sourceModuleContext.exports]
              : "未检测到公开导出",
            "本次变化": sourceModuleContext.changeSummary,
            "依赖与影响": dependencyAndImpact.length > 0
              ? dependencyAndImpact
              : "未发现有界的直接依赖或引用",
            "路径": relativePath,
          };
      const verificationFacts = testContext === undefined || sourceModuleContext === undefined
        ? undefined
        : {
            "验证范围": testContext.summary,
            "执行状态": "未执行；该卡片只读取测试定义，不能据此判定 PASS/FAIL",
            "本次变化": sourceModuleContext.changeSummary,
            "依赖与影响": dependencyAndImpact.length > 0
              ? dependencyAndImpact
              : "未发现有界的直接依赖或引用",
            "路径": relativePath,
          };
      const configurationFacts = configurationContext === undefined
        ? undefined
        : {
            "配置用途": configurationContext.purpose,
            "顶层键": configurationContext.parsed
              ? configurationContext.topLevelKeys.length > 0
                ? [
                    ...configurationContext.topLevelKeys,
                    ...(configurationContext.keyCount > configurationContext.topLevelKeys.length
                      ? [`另 ${configurationContext.keyCount - configurationContext.topLevelKeys.length} 项`]
                      : []),
                  ]
                : "未声明顶层键"
              : "JSON 无法安全解析",
            "披露边界": "只显示键名；配置值和潜在密钥不进入卡片",
            "格式": "JSON",
            "路径": relativePath,
          };
      const decisionFacts = decisionContext === undefined
        ? undefined
        : {
            "决策": decisionContext.decision ?? markdownContext?.purpose ?? "未提供可提取的 Decision 段落",
            "状态": decisionContext.status ?? "未明确",
            "原因": decisionContext.rationale ?? "未提供可提取的 Context/Rationale 段落",
            "后果": decisionContext.consequences ?? "未提供可提取的 Consequences 段落",
            "路径": relativePath,
          };
      const explicitDecisionFacts = explicitDecisionContext === undefined
        ? undefined
        : {
            "为什么需要决定": explicitDecisionContext.problem,
            "选择了什么": explicitDecisionContext.choice,
            "后果是什么": explicitDecisionContext.consequence,
            "证据": explicitDecisionContext.evidence.excerpt,
          };
      const changeFacts = changeContext === undefined
        ? undefined
        : {
            "原来怎样": changeContext.before,
            "现在怎样": changeContext.after,
            "影响什么": changeContext.impact,
            "证据": changeContext.evidence.excerpt,
          };
      const conceptFacts = conceptContext === undefined
        ? undefined
        : {
            "它是什么意思": conceptContext.meaning,
            "为什么现在出现": conceptContext.currentContext,
            "它不是什么": conceptContext.boundary,
            "所处流程": conceptContext.sequence.map((item, index) =>
              index === conceptContext.currentStep ? `当前：${item}` : item),
            "证据": conceptContext.evidence.excerpt,
          };
      const taskFacts = taskContext === undefined
        ? undefined
        : {
            "目标": taskContext.goal,
            "当前状态": taskContext.status,
            "下一步": taskContext.next,
            "阻塞": taskContext.blocker,
            "更新时间": taskContext.updatedAt,
            "已完成": taskContext.completed,
            "证据": taskContext.evidence.excerpt,
          };
      const explicitVerificationFacts = explicitVerificationContext === undefined
        ? undefined
        : {
            "要证明什么": explicitVerificationContext.claim,
            "结果": explicitVerificationContext.result,
            "尚未证明": explicitVerificationContext.gap,
            "验证记录": [
              `方式: ${explicitVerificationContext.method}`,
              `修订: ${explicitVerificationContext.verifiedRevision}`,
              `时间: ${explicitVerificationContext.executedAt}`,
            ],
            "证据": explicitVerificationContext.evidence.excerpt,
            "验证方式": explicitVerificationContext.method,
            "验证修订": explicitVerificationContext.verifiedRevision,
            "执行时间": explicitVerificationContext.executedAt,
          };
      return {
        kind: "snapshot",
        snapshot: {
          scope: { ...request.binding.scope },
          entityId: request.entityId,
          entityType: request.entityType,
          entityRevision: `sha256:${detailRevision}`,
          observedAt,
          freshness: "current",
          facts: conceptFacts ?? changeFacts ?? explicitDecisionFacts ?? taskFacts ??
            explicitVerificationFacts ?? decisionFacts ?? verificationFacts ??
            configurationFacts ?? markdownFacts ?? moduleFacts ?? {
              path: relativePath,
              name: basename(relativePath),
              ...(preview === undefined ? {} : { preview }),
              extension: extension.length === 0 ? null : extension,
              size_bytes: after.size,
              modified_at: after.mtime.toISOString(),
              ...(contentHash === undefined ? {} : { content_sha256: contentHash }),
            },
          relations: [],
          sourceRefs: [
            {
              sourceType: "local_workspace_file",
              sourceId: relativePath,
            },
            ...(markdownContext?.gitAvailable === true
              ? [{ sourceType: "local_git", sourceId: relativePath }]
              : []),
            ...(sourceModuleContext?.gitAvailable === true
              ? [{ sourceType: "local_git", sourceId: relativePath }]
              : []),
            ...(artifactEvidence === undefined
              ? []
              : [{ sourceType: "project_evidence", sourceId: artifactEvidence.sourceId }]),
          ],
        },
        verification: {
          verifiedAt: observedAt,
          method: "live_read",
        },
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return { kind: "not_found" };
      if (code === "EACCES" || code === "EPERM") return { kind: "access_denied" };
      if (error instanceof ContractError) throw error;
      return { kind: "unavailable", retryable: true };
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}

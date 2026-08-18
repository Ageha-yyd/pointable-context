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
  if (decisionDocumentPath(relativePath)) return "decision";
  if (markdownDocument(relativePath)) return "document";
  if (testSourcePath(relativePath)) return "verification";
  if (sourceModulePath(relativePath)) return "module";
  if (jsonConfigurationPath(relativePath)) return "configuration";
  return "file";
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
      return {
        schemaVersion: "1.0",
        scope: { ...binding.scope },
        entityId: fileEntityId(file.relativePath),
        entityType: workspaceEntityType(file.relativePath),
        canonicalKey: file.relativePath,
        canonicalName: name,
        aliases: fileAliases(file.relativePath),
        summary: parent === "." ? "Workspace file" : `Workspace file in ${parent}`,
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

export type LocalWorkspaceRevisionProbeResult =
  | { kind: "current"; revision: string; observedAt: string }
  | { kind: "not_found"; observedAt: string }
  | { kind: "unavailable"; observedAt: string; retryable: boolean };

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
      request.entityType !== "decision"
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
      const revision = createHash("sha256")
        .update(JSON.stringify({
          path: locator,
          size: info.size,
          modifiedMs: info.mtimeMs,
          changedMs: info.ctimeMs,
          inode: info.ino,
        }), "utf8")
        .digest("hex");
      return {
        kind: "current",
        revision: `workspace-file-stat:${revision}`,
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
      request.entityType !== "decision"
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
        (request.entityType === "module" || request.entityType === "verification") &&
          decoded !== undefined
          ? await extractSourceModuleArtifactContext({
              root,
              relativePath,
              content: decoded,
              ...(request.signal === undefined ? {} : { signal: request.signal }),
            })
          : undefined;
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
      const detailRevision = createHash("sha256")
        .update(contentHash ?? statRevision, "utf8")
        .update("\u0000", "utf8")
        .update(
          markdownContext?.contextRevision ??
            sourceModuleContext?.contextRevision ??
            "file-metadata-v1",
          "utf8",
        )
        .digest("hex");
      const extension = extname(relativePath);
      const preview = content === undefined ? undefined : contentPreview(content);
      const observedAt = new Date().toISOString();
      const testContext = request.entityType === "verification" && decoded !== undefined
        ? extractStaticTestDefinitionContext(decoded)
        : undefined;
      const configurationContext = request.entityType === "configuration" && decoded !== undefined
        ? extractJsonConfigurationContext(relativePath, decoded)
        : undefined;
      const decisionContext = request.entityType === "decision" && decoded !== undefined
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
      return {
        kind: "snapshot",
        snapshot: {
          scope: { ...request.binding.scope },
          entityId: request.entityId,
          entityType: request.entityType,
          entityRevision: `sha256:${detailRevision}`,
          observedAt,
          freshness: "current",
          facts: decisionFacts ?? verificationFacts ?? configurationFacts ?? markdownFacts ?? moduleFacts ?? {
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

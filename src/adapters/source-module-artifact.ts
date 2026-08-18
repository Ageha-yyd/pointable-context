import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, extname, resolve } from "node:path";

const GIT_TIMEOUT_MS = 750;
const MAX_GIT_OUTPUT_BYTES = 256 * 1024;
const MAX_ROLE_CHARS = 360;
const MAX_SYMBOL_CHARS = 160;
const MAX_EXPORTS = 5;
const MAX_DEPENDENCIES = 12;
const MAX_IMPACT_FILES = 3;

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

interface GitResult {
  kind: "ok" | "no_match" | "unavailable";
  stdout: string;
}

export type SourceModuleGitStatus =
  | "clean"
  | "modified"
  | "staged"
  | "staged_and_modified"
  | "untracked"
  | "conflicted"
  | "unavailable";

export interface SourceModuleStructure {
  role: string;
  exports: readonly string[];
  dependencies: readonly string[];
  declarations: ReadonlyArray<{ line: number; name: string }>;
}

export interface SourceModuleArtifactContext {
  role: string;
  exports: readonly string[];
  dependencies: readonly string[];
  gitAvailable: boolean;
  gitStatus: SourceModuleGitStatus;
  changeSummary: string;
  changedSymbols: readonly string[];
  impactFiles: readonly string[];
  contextRevision: string;
}

export function sourceModulePath(relativePath: string): boolean {
  return SOURCE_EXTENSIONS.has(extname(relativePath).toLocaleLowerCase("en-US"));
}

function boundedText(value: string, maximum: number): string | undefined {
  const compact = value
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (compact.length === 0) return undefined;
  return compact.length <= maximum ? compact : `${compact.slice(0, maximum - 1)}…`;
}

function addBounded(target: string[], value: string | undefined, maximum: number): void {
  const safe = value === undefined ? undefined : boundedText(value, MAX_SYMBOL_CHARS);
  if (safe !== undefined && !target.includes(safe) && target.length < maximum) target.push(safe);
}

function maskCommentsAndStrings(content: string): string {
  let state: "code" | "line" | "block" | "single" | "double" | "template" = "code";
  let escaped = false;
  let result = "";
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index] ?? "";
    const next = content[index + 1] ?? "";
    if (state === "code") {
      if (char === "/" && next === "/") {
        result += "  ";
        index += 1;
        state = "line";
      } else if (char === "/" && next === "*") {
        result += "  ";
        index += 1;
        state = "block";
      } else if (char === "'") {
        result += " ";
        state = "single";
      } else if (char === '"') {
        result += " ";
        state = "double";
      } else if (char === "`") {
        result += " ";
        state = "template";
      } else {
        result += char;
      }
      continue;
    }
    if (state === "line") {
      if (char === "\n") {
        result += "\n";
        state = "code";
      } else {
        result += " ";
      }
      continue;
    }
    if (state === "block") {
      if (char === "*" && next === "/") {
        result += "  ";
        index += 1;
        state = "code";
      } else {
        result += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (escaped) {
      result += char === "\n" ? "\n" : " ";
      escaped = false;
      continue;
    }
    if (char === "\\") {
      result += " ";
      escaped = true;
      continue;
    }
    const closes =
      (state === "single" && char === "'") ||
      (state === "double" && char === '"') ||
      (state === "template" && char === "`");
    result += char === "\n" ? "\n" : " ";
    if (closes) state = "code";
  }
  return result;
}

function leadingRole(content: string): string | undefined {
  const normalized = content.replace(/\r\n?/gu, "\n").replace(/^#![^\n]*(?:\n|$)/u, "");
  const block = /^\s*\/\*\*?([\s\S]*?)\*\//u.exec(normalized);
  const line = /^(?:\s*\/\/[^\n]*(?:\n|$))+/u.exec(normalized);
  const raw = block?.[1] ?? line?.[0];
  if (raw === undefined) return undefined;
  const prose = raw
    .split("\n")
    .map((value) => value.replace(/^\s*(?:\/\/|\*)?\s?/u, "").trim())
    .filter((value) =>
      value.length > 0 &&
      !/^(?:@|eslint|prettier|tslint|copyright|spdx-)/iu.test(value),
    )
    .join(" ");
  return boundedText(prose, MAX_ROLE_CHARS);
}

function declarationName(value: string): string | undefined {
  return (
    /^(?:export\s+)?(?:declare\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/u.exec(value)?.[1] ??
    /^(?:export\s+)?(?:declare\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)\b/u.exec(value)?.[1] ??
    /^(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)\b/u.exec(value)?.[1] ??
    /^(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/u.exec(value)?.[1] ??
    /^(?:export\s+)?(?:declare\s+)?(?:enum|namespace)\s+([A-Za-z_$][\w$]*)\b/u.exec(value)?.[1] ??
    /^(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/u.exec(value)?.[1]
  );
}

function extractExports(masked: string): string[] {
  const exports: string[] = [];
  const declaration = /^\s*export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|namespace|const|let|var)\s+([A-Za-z_$][\w$]*)/gmu;
  for (const match of masked.matchAll(declaration)) addBounded(exports, match[1], MAX_EXPORTS);
  if (/^\s*export\s+default\b/gmu.test(masked)) addBounded(exports, "default", MAX_EXPORTS);
  const lists = /^\s*export\s*\{([^}]*)\}/gmu;
  for (const match of masked.matchAll(lists)) {
    for (const item of (match[1] ?? "").split(",")) {
      const name = /(?:^|\s)as\s+([A-Za-z_$][\w$]*)\s*$/u.exec(item)?.[1] ??
        /^\s*([A-Za-z_$][\w$]*)/u.exec(item)?.[1];
      addBounded(exports, name, MAX_EXPORTS);
    }
  }
  if (/^\s*module\.exports\s*=/gmu.test(masked)) addBounded(exports, "default", MAX_EXPORTS);
  const commonJs = /^\s*exports\.([A-Za-z_$][\w$]*)\s*=/gmu;
  for (const match of masked.matchAll(commonJs)) addBounded(exports, match[1], MAX_EXPORTS);
  return exports;
}

function extractDeclarations(masked: string): Array<{ line: number; name: string }> {
  const declarations: Array<{ line: number; name: string }> = [];
  const lines = masked.split("\n");
  for (let index = 0; index < lines.length && declarations.length < 256; index += 1) {
    const name = boundedText(declarationName(lines[index] ?? "") ?? "", MAX_SYMBOL_CHARS);
    if (name !== undefined && declarations.length < 256) {
      declarations.push({ line: index + 1, name });
    }
  }
  return declarations;
}

function extractDependencies(content: string): string[] {
  const dependencies: string[] = [];
  for (const line of content.replace(/\r\n?/gu, "\n").split("\n")) {
    if (/^\s*(?:\/\/|\/\*)/u.test(line)) continue;
    const specifier =
      /^\s*import(?:\s+type)?(?:\s+[\s\S]*?\s+from\s*)?\s*["']([^"']+)["']/u.exec(line)?.[1] ??
      /^\s*export\s+[\s\S]*?\s+from\s*["']([^"']+)["']/u.exec(line)?.[1] ??
      /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*require\(\s*["']([^"']+)["']\s*\)/u.exec(line)?.[1];
    addBounded(dependencies, specifier, MAX_DEPENDENCIES);
  }
  return dependencies;
}

export function extractSourceModuleStructure(
  content: string,
  relativePath: string,
): SourceModuleStructure {
  const masked = maskCommentsAndStrings(content);
  const exports = extractExports(masked);
  const dependencies = extractDependencies(content);
  const declarations = extractDeclarations(masked);
  const entry = /^(?:app|cli|index|main|mod|server)(?:\.[^.]+)+$/iu.test(basename(relativePath));
  const role = leadingRole(content) ?? boundedText(
    exports.length > 0
      ? `${entry ? "入口模块" : "源代码模块"}；公开导出 ${exports.join("、")}`
      : `${entry ? "入口模块" : "内部源代码模块"}；未检测到公开导出`,
    MAX_ROLE_CHARS,
  ) ?? "源代码模块";
  return Object.freeze({
    role,
    exports: Object.freeze([...exports]),
    dependencies: Object.freeze([...dependencies]),
    declarations: Object.freeze(declarations.map((value) => Object.freeze({ ...value }))),
  });
}

function runGit(root: string, args: readonly string[], signal?: AbortSignal): Promise<GitResult> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("git operation aborted"));
  return new Promise((resolveResult, rejectResult) => {
    execFile("git", [...args], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      ...(signal === undefined ? {} : { signal }),
    }, (error, stdout) => {
      if (signal?.aborted) {
        rejectResult(signal.reason ?? new Error("git operation aborted"));
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

function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const absolute = resolve(value);
    return process.platform === "win32" ? absolute.toLocaleLowerCase("en-US") : absolute;
  };
  return normalize(left) === normalize(right);
}

function gitStatus(value: string): SourceModuleGitStatus {
  if (value.length === 0) return "clean";
  const code = value.slice(0, 2);
  if (code === "??") return "untracked";
  if (/U|AA|DD/u.test(code)) return "conflicted";
  const staged = code[0] !== " ";
  const modified = code[1] !== " ";
  if (staged && modified) return "staged_and_modified";
  if (staged) return "staged";
  return modified ? "modified" : "clean";
}

function changedSymbols(diff: string, structure: SourceModuleStructure): string[] {
  const results: string[] = [];
  for (const line of diff.replace(/\r\n?/gu, "\n").split("\n")) {
    if (/^[+-](?:\+\+|--)/u.test(line)) continue;
    if (line.startsWith("+") || line.startsWith("-")) {
      addBounded(results, declarationName(line.slice(1)), 3);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
    if (hunk === null) continue;
    const currentLine = Number(hunk[1]);
    let nearest: string | undefined;
    for (const declaration of structure.declarations) {
      if (declaration.line > currentLine) break;
      nearest = declaration.name;
    }
    addBounded(results, nearest, 3);
  }
  return results;
}

function parseLastCommit(value: string): string | undefined {
  const [hash, , subject] = value.trim().split("\u0000");
  const safeHash = typeof hash === "string" && /^[0-9a-f]{7,64}$/u.test(hash)
    ? hash.slice(0, 8)
    : undefined;
  const safeSubject = typeof subject === "string" ? boundedText(subject, 220) : undefined;
  return safeHash === undefined || safeSubject === undefined
    ? undefined
    : `${safeHash} · ${safeSubject}`;
}

function testPath(value: string): boolean {
  return /(?:^|\/)(?:__tests__|test|tests)(?:\/|$)|\.(?:spec|test)\.[^/]+$/iu.test(value);
}

function parseImpactFiles(value: string, relativePath: string): string[] {
  const tests: string[] = [];
  const importers: string[] = [];
  for (const raw of value.split("\u0000")) {
    const path = boundedText(raw.replace(/\\/gu, "/"), 512);
    if (
      path === undefined ||
      path === relativePath ||
      !sourceModulePath(path) ||
      /^(?:dist|host|mcp|node_modules)\//u.test(path) ||
      /\.min\.[^/]+$/iu.test(path) ||
      tests.includes(path) ||
      importers.includes(path)
    ) continue;
    (testPath(path) ? tests : importers).push(path);
  }
  const stem = basename(relativePath, extname(relativePath)).toLocaleLowerCase("en-US");
  tests.sort((left, right) => {
    const leftOwn = basename(left).toLocaleLowerCase("en-US").includes(stem) ? 0 : 1;
    const rightOwn = basename(right).toLocaleLowerCase("en-US").includes(stem) ? 0 : 1;
    return leftOwn - rightOwn || left.localeCompare(right, "en");
  });
  importers.sort((left, right) => {
    const leftSource = left.startsWith("src/") ? 0 : 1;
    const rightSource = right.startsWith("src/") ? 0 : 1;
    return leftSource - rightSource || left.localeCompare(right, "en");
  });
  const selectedTests = tests.slice(0, Math.min(2, MAX_IMPACT_FILES));
  const selectedImporters = importers.slice(0, MAX_IMPACT_FILES - selectedTests.length);
  return [
    ...selectedTests.map((path) => `测试: ${path}`),
    ...selectedImporters.map((path) => `引用: ${path}`),
  ];
}

function statusLabel(status: SourceModuleGitStatus): string {
  switch (status) {
    case "staged_and_modified": return "staged + modified";
    default: return status;
  }
}

export async function extractSourceModuleArtifactContext(options: {
  root: string;
  relativePath: string;
  content: string;
  signal?: AbortSignal;
}): Promise<SourceModuleArtifactContext> {
  const structure = extractSourceModuleStructure(options.content, options.relativePath);
  const rootResult = await runGit(options.root, ["rev-parse", "--show-toplevel"], options.signal);
  if (rootResult.kind !== "ok" || !samePath(rootResult.stdout.trim(), options.root)) {
    const base = {
      role: structure.role,
      exports: structure.exports,
      dependencies: structure.dependencies,
      gitAvailable: false,
      gitStatus: "unavailable" as const,
      changeSummary: "Git 上下文不可用",
      changedSymbols: Object.freeze([]) as readonly string[],
      impactFiles: Object.freeze([]) as readonly string[],
    };
    return Object.freeze({
      ...base,
      contextRevision: createHash("sha256").update(JSON.stringify(base), "utf8").digest("hex"),
    });
  }

  const stem = basename(options.relativePath, extname(options.relativePath));
  const [statusResult, unstaged, staged, references, lastCommit] = await Promise.all([
    runGit(options.root, [
      "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", options.relativePath,
    ], options.signal),
    runGit(options.root, ["diff", "--no-ext-diff", "--unified=0", "--", options.relativePath], options.signal),
    runGit(options.root, ["diff", "--cached", "--no-ext-diff", "--unified=0", "--", options.relativePath], options.signal),
    runGit(options.root, ["grep", "-l", "-F", "-z", "-e", stem, "--", "."], options.signal),
    runGit(options.root, ["log", "-1", "--format=%H%x00%aI%x00%s", "--", options.relativePath], options.signal),
  ]);
  const state = statusResult.kind === "ok" ? gitStatus(statusResult.stdout) : "unavailable";
  const diff = `${unstaged.kind === "ok" ? unstaged.stdout : ""}\n${staged.kind === "ok" ? staged.stdout : ""}`;
  const symbols = changedSymbols(diff, structure);
  const recentCommit = lastCommit.kind === "ok" ? parseLastCommit(lastCommit.stdout) : undefined;
  const changeSummary = state === "clean"
    ? `clean${recentCommit === undefined ? "" : ` · 最近 ${recentCommit}`}`
    : state === "unavailable"
      ? "Git 上下文不可用"
      : `${statusLabel(state)}${symbols.length === 0 ? "" : ` · 涉及：${symbols.join("、")}`}`;
  const impactFiles = references.kind === "ok"
    ? parseImpactFiles(references.stdout, options.relativePath)
    : [];
  const base = {
    role: structure.role,
    exports: structure.exports,
    dependencies: structure.dependencies,
    gitAvailable: state !== "unavailable",
    gitStatus: state,
    changeSummary,
    changedSymbols: Object.freeze([...symbols]),
    impactFiles: Object.freeze([...impactFiles]),
  };
  return Object.freeze({
    ...base,
    contextRevision: createHash("sha256").update(JSON.stringify(base), "utf8").digest("hex"),
  });
}

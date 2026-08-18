import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const GIT_TIMEOUT_MS = 750;
const MAX_GIT_OUTPUT_BYTES = 256 * 1024;
const MAX_PURPOSE_CHARS = 360;
const MAX_HEADING_CHARS = 160;
const MAX_IMPACT_FILES = 3;

interface GitResult {
  kind: "ok" | "no_match" | "unavailable";
  stdout: string;
}

export interface MarkdownStructure {
  title?: string;
  purpose?: string;
  headings: ReadonlyArray<{ line: number; label: string }>;
}

export interface MarkdownArtifactContext {
  title?: string;
  purpose?: string;
  gitAvailable: boolean;
  gitStatus: "clean" | "modified" | "staged" | "staged_and_modified" | "untracked" | "conflicted" | "unavailable";
  changeSummary?: string;
  changedSections: readonly string[];
  impactFiles: readonly string[];
  contextRevision: string;
}

function boundedText(value: string, maximum: number): string | undefined {
  const compact = value
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (compact.length === 0) return undefined;
  return compact.length <= maximum ? compact : `${compact.slice(0, maximum - 1)}…`;
}

function inlineMarkdown(value: string): string | undefined {
  return boundedText(
    value
      .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
      .replace(/[`*_~]+/gu, "")
      .replace(/\s+#+\s*$/u, ""),
    MAX_HEADING_CHARS,
  );
}

function paragraphCandidate(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length > 0 &&
    !/^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~|<|!\[|\[!)/u.test(trimmed) &&
    !/^[-:=]{3,}$/u.test(trimmed)
  );
}

export function extractMarkdownStructure(content: string): MarkdownStructure {
  const lines = content.replace(/\r\n?/gu, "\n").split("\n");
  const headings: Array<{ line: number; label: string }> = [];
  let title: string | undefined;
  let purpose: string | undefined;
  let inFence = false;
  let inFrontmatter = lines[0]?.trim() === "---";
  let paragraph: string[] = [];

  const commitParagraph = (): void => {
    if (purpose !== undefined || paragraph.length === 0) {
      paragraph = [];
      return;
    }
    purpose = boundedText(paragraph.join(" "), MAX_PURPOSE_CHARS);
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (inFrontmatter) {
      if (index > 0 && trimmed === "---") inFrontmatter = false;
      continue;
    }
    if (/^(?:```|~~~)/u.test(trimmed)) {
      commitParagraph();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = /^(#{1,6})[ \t]+(.+?)\s*$/u.exec(line);
    if (heading) {
      commitParagraph();
      const label = inlineMarkdown(heading[2] ?? "");
      if (label !== undefined) {
        headings.push({ line: index + 1, label });
        if (heading[1]?.length === 1 && title === undefined) title = label;
      }
      continue;
    }
    if (paragraphCandidate(line)) {
      paragraph.push(trimmed);
      continue;
    }
    commitParagraph();
  }
  commitParagraph();
  return Object.freeze({
    ...(title === undefined ? {} : { title }),
    ...(purpose === undefined ? {} : { purpose }),
    headings: Object.freeze(headings.map((heading) => Object.freeze({ ...heading }))),
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

function gitStatus(value: string): MarkdownArtifactContext["gitStatus"] {
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

function changedSections(
  diff: string,
  structure: MarkdownStructure,
  state: MarkdownArtifactContext["gitStatus"],
): string[] {
  if (state === "untracked") return ["新文件"];
  const result: string[] = [];
  const add = (label: string | undefined): void => {
    if (label !== undefined && !result.includes(label) && result.length < 3) result.push(label);
  };
  for (const line of diff.replace(/\r\n?/gu, "\n").split("\n")) {
    if (/^[+-]#{1,6}[ \t]/u.test(line) && !/^(?:\+\+\+|---)/u.test(line)) {
      const label = inlineMarkdown(line.replace(/^[+-]#{1,6}[ \t]+/u, ""));
      if (
        line.startsWith("+") ||
        structure.headings.some((heading) => heading.label === label)
      ) {
        add(label);
      }
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
    if (!hunk) continue;
    const currentLine = Number(hunk[1]);
    let section: string | undefined;
    for (const heading of structure.headings) {
      if (heading.line > currentLine) break;
      section = heading.label;
    }
    add(section ?? structure.title ?? "文档开头");
  }
  if (result.length === 0 && state !== "clean" && state !== "unavailable") {
    add(structure.title ?? "文档开头");
  }
  return result;
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

function parseImpactFiles(value: string, relativePath: string): string[] {
  const results: string[] = [];
  for (const raw of value.split("\u0000")) {
    const path = boundedText(raw.replace(/\\/gu, "/"), 512);
    if (path === undefined || path === relativePath || results.includes(path)) continue;
    results.push(path);
    if (results.length >= MAX_IMPACT_FILES) break;
  }
  return results;
}

export async function extractMarkdownArtifactContext(options: {
  root: string;
  relativePath: string;
  content: string;
  signal?: AbortSignal;
}): Promise<MarkdownArtifactContext> {
  const structure = extractMarkdownStructure(options.content);
  const rootResult = await runGit(options.root, ["rev-parse", "--show-toplevel"], options.signal);
  if (rootResult.kind !== "ok" || !samePath(rootResult.stdout.trim(), options.root)) {
    const base = {
      ...(structure.title === undefined ? {} : { title: structure.title }),
      ...(structure.purpose === undefined ? {} : { purpose: structure.purpose }),
      gitAvailable: false,
      gitStatus: "unavailable" as const,
      changedSections: Object.freeze([]) as readonly string[],
      impactFiles: Object.freeze([]) as readonly string[],
    };
    return Object.freeze({
      ...base,
      contextRevision: createHash("sha256").update(JSON.stringify(base), "utf8").digest("hex"),
    });
  }

  const [statusResult, unstaged, staged, references, lastCommit] = await Promise.all([
    runGit(options.root, [
      "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", options.relativePath,
    ], options.signal),
    runGit(options.root, ["diff", "--no-ext-diff", "--unified=0", "--", options.relativePath], options.signal),
    runGit(options.root, ["diff", "--cached", "--no-ext-diff", "--unified=0", "--", options.relativePath], options.signal),
    runGit(options.root, [
      "grep", "-l", "-F", "-z", "-e", options.relativePath.split("/").at(-1) ?? options.relativePath, "--", ".",
    ], options.signal),
    runGit(options.root, ["log", "-1", "--format=%H%x00%aI%x00%s", "--", options.relativePath], options.signal),
  ]);
  const state = statusResult.kind === "ok" ? gitStatus(statusResult.stdout) : "unavailable";
  const diff = `${unstaged.kind === "ok" ? unstaged.stdout : ""}\n${staged.kind === "ok" ? staged.stdout : ""}`;
  const sections = changedSections(diff, structure, state);
  const impactFiles = references.kind === "ok"
    ? parseImpactFiles(references.stdout, options.relativePath)
    : [];
  const recentCommit = lastCommit.kind === "ok" ? parseLastCommit(lastCommit.stdout) : undefined;
  const changeSummary = sections.length > 0
    ? `涉及：${sections.join("、")}`
    : recentCommit;
  const base = {
    ...(structure.title === undefined ? {} : { title: structure.title }),
    ...(structure.purpose === undefined ? {} : { purpose: structure.purpose }),
    gitAvailable: state !== "unavailable",
    gitStatus: state,
    ...(changeSummary === undefined ? {} : { changeSummary }),
    changedSections: Object.freeze([...sections]),
    impactFiles: Object.freeze([...impactFiles]),
  };
  return Object.freeze({
    ...base,
    contextRevision: createHash("sha256").update(JSON.stringify(base), "utf8").digest("hex"),
  });
}

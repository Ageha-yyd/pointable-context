import { createHash } from "node:crypto";

const MAX_FIELD_CHARS = 1_024;
const MAX_SEQUENCE_ITEMS = 4;
const MAX_SOURCE_PATH_CHARS = 480;

export interface ContextArtifactEvidence {
  excerpt: string;
  sourcePath: string;
  sourceLine: number;
}

export type ContextConceptEvidence = ContextArtifactEvidence;

export interface ContextConceptArtifact {
  title: string;
  meaning: string;
  currentContext: string;
  boundary: string;
  sequence: readonly string[];
  currentStep?: number;
  evidence: ContextConceptEvidence;
  contextRevision: string;
}

export interface ContextChangeArtifact {
  title: string;
  before: string;
  after: string;
  impact: string;
  evidence: ContextArtifactEvidence;
  contextRevision: string;
}

export interface ContextDecisionArtifact {
  title: string;
  problem: string;
  choice: string;
  consequence: string;
  evidence: ContextArtifactEvidence;
  contextRevision: string;
}

export interface ContextTaskArtifact {
  title: string;
  goal: string;
  status: string;
  completed: string;
  next: string;
  blocker: string;
  updatedAt: string;
  evidence: ContextArtifactEvidence;
  contextRevision: string;
}

export interface ContextVerificationArtifact {
  title: string;
  claim: string;
  result: string;
  gap: string;
  method: string;
  verifiedRevision: string;
  executedAt: string;
  evidence: ContextArtifactEvidence;
  contextRevision: string;
}

function boundedText(value: string, maximum = MAX_FIELD_CHARS): string | undefined {
  const compact = value
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (compact.length === 0) return undefined;
  return compact.length <= maximum ? compact : `${compact.slice(0, maximum - 1)}…`;
}

function sectionText(lines: readonly string[]): string | undefined {
  return boundedText(
    lines
      .filter((line) => line.trim().length > 0)
      .map((line) => line.replace(/^>\s?/u, "").trim())
      .join(" "),
  );
}

function sourceReference(value: string): Pick<ContextArtifactEvidence, "sourcePath" | "sourceLine"> | undefined {
  const compact = value.trim().replace(/\\/gu, "/");
  const match = /^([^:\r\n]{1,480}):(\d{1,6})$/u.exec(compact);
  if (match === null) return undefined;
  const sourcePath = match[1];
  const sourceLine = Number(match[2]);
  if (
    sourcePath === undefined ||
    sourcePath.length > MAX_SOURCE_PATH_CHARS ||
    sourcePath.startsWith("/") ||
    sourcePath.split("/").includes("..") ||
    !Number.isSafeInteger(sourceLine) ||
    sourceLine < 1
  ) {
    return undefined;
  }
  return { sourcePath, sourceLine };
}

export function contextConceptDocumentPath(relativePath: string): boolean {
  const portable = relativePath.replace(/\\/gu, "/");
  return /(?:^|\/)docs\/concepts\/[^/]+\.md$/iu.test(portable);
}

export function contextChangeDocumentPath(relativePath: string): boolean {
  const portable = relativePath.replace(/\\/gu, "/");
  return /(?:^|\/)docs\/changes\/[^/]+\.md$/iu.test(portable);
}

export function contextDecisionDocumentPath(relativePath: string): boolean {
  const portable = relativePath.replace(/\\/gu, "/");
  return /(?:^|\/)docs\/decisions\/[^/]+\.md$/iu.test(portable);
}

export function contextTaskDocumentPath(relativePath: string): boolean {
  const portable = relativePath.replace(/\\/gu, "/");
  return /(?:^|\/)docs\/tasks\/[^/]+\.md$/iu.test(portable);
}

export function contextVerificationDocumentPath(relativePath: string): boolean {
  const portable = relativePath.replace(/\\/gu, "/");
  return /(?:^|\/)docs\/verifications\/[^/]+\.md$/iu.test(portable);
}

function documentSections(content: string): {
  title?: string;
  sections: ReadonlyMap<string, readonly string[]>;
} {
  const lines = content.replace(/\r\n?/gu, "\n").split("\n");
  const sections = new Map<string, string[]>();
  let title: string | undefined;
  let activeSection: string | undefined;
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(?:```|~~~)/u.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = /^(#{1,2})[ \t]+(.+?)\s*$/u.exec(line);
    if (heading !== null) {
      const label = boundedText(heading[2] ?? "", 128);
      if (heading[1] === "#" && title === undefined) title = label;
      activeSection = heading[1] === "##" ? label : undefined;
      if (activeSection !== undefined && !sections.has(activeSection)) {
        sections.set(activeSection, []);
      }
      continue;
    }
    if (activeSection !== undefined) sections.get(activeSection)?.push(line);
  }
  return { ...(title === undefined ? {} : { title }), sections };
}

function artifactEvidence(
  sections: ReadonlyMap<string, readonly string[]>,
): ContextArtifactEvidence | undefined {
  const excerpt = sectionText(sections.get("证据") ?? []);
  const source = sourceReference(sectionText(sections.get("来源") ?? []) ?? "");
  return excerpt === undefined || source === undefined
    ? undefined
    : Object.freeze({ excerpt, ...source });
}

function revision<T extends object>(base: T): T & { contextRevision: string } {
  return Object.freeze({
    ...base,
    contextRevision: createHash("sha256")
      .update(JSON.stringify(base), "utf8")
      .digest("hex"),
  });
}

function isoTimestamp(value: string | undefined): string | undefined {
  if (
    value === undefined ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
  ) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

/**
 * Parses an author-supplied, explicitly structured concept artifact. It does
 * not infer concepts from prose and deliberately recognizes only the frozen
 * headings below.
 */
export function extractContextConceptArtifact(
  content: string,
): ContextConceptArtifact | undefined {
  const { title, sections } = documentSections(content);

  const meaning = sectionText(sections.get("它是什么意思") ?? []);
  const currentContext = sectionText(sections.get("为什么现在出现") ?? []);
  const boundary = sectionText(sections.get("它不是什么") ?? []);
  const evidence = artifactEvidence(sections);
  const flowLines = sections.get("所处流程") ?? [];
  const sequence: string[] = [];
  let currentStep: number | undefined;
  for (const line of flowLines) {
    const match = /^[-*+]\s+(.+?)\s*$/u.exec(line.trim());
    if (match === null || sequence.length >= MAX_SEQUENCE_ITEMS) continue;
    const raw = match[1] ?? "";
    const current = /^当前[：:]\s*/u.test(raw);
    const value = boundedText(raw.replace(/^当前[：:]\s*/u, ""), 256);
    if (value === undefined) continue;
    if (current && currentStep === undefined) currentStep = sequence.length;
    sequence.push(value);
  }

  if (
    title === undefined ||
    meaning === undefined ||
    currentContext === undefined ||
    boundary === undefined ||
    sequence.length < 2 ||
    currentStep === undefined ||
    evidence === undefined
  ) {
    return undefined;
  }
  const base = {
    title,
    meaning,
    currentContext,
    boundary,
    sequence: Object.freeze([...sequence]),
    currentStep,
    evidence,
  };
  return revision(base);
}

export function extractContextChangeArtifact(
  content: string,
): ContextChangeArtifact | undefined {
  const { title, sections } = documentSections(content);
  const before = sectionText(sections.get("原来怎样") ?? []);
  const after = sectionText(sections.get("现在怎样") ?? []);
  const impact = sectionText(sections.get("影响什么") ?? []);
  const evidence = artifactEvidence(sections);
  if (
    title === undefined ||
    before === undefined ||
    after === undefined ||
    impact === undefined ||
    evidence === undefined
  ) {
    return undefined;
  }
  return revision({ title, before, after, impact, evidence });
}

export function extractContextDecisionArtifact(
  content: string,
): ContextDecisionArtifact | undefined {
  const { title, sections } = documentSections(content);
  const problem = sectionText(sections.get("为什么需要决定") ?? []);
  const choice = sectionText(sections.get("选择了什么") ?? []);
  const consequence = sectionText(sections.get("后果是什么") ?? []);
  const evidence = artifactEvidence(sections);
  if (
    title === undefined ||
    problem === undefined ||
    choice === undefined ||
    consequence === undefined ||
    evidence === undefined
  ) {
    return undefined;
  }
  return revision({ title, problem, choice, consequence, evidence });
}


/**
 * Parses an explicit Agent-authored task record. Status remains author data:
 * this parser never infers completion from files, commits, or test presence.
 */
export function extractContextTaskArtifact(
  content: string,
): ContextTaskArtifact | undefined {
  const { title, sections } = documentSections(content);
  const goal = sectionText(sections.get("目标") ?? []);
  const status = sectionText(sections.get("当前状态") ?? []);
  const completed = sectionText(sections.get("已完成") ?? []);
  const next = sectionText(sections.get("下一步") ?? []);
  const blocker = sectionText(sections.get("阻塞") ?? []);
  const updatedAt = isoTimestamp(sectionText(sections.get("更新时间") ?? []));
  const evidence = artifactEvidence(sections);
  if (
    title === undefined ||
    goal === undefined ||
    status === undefined ||
    completed === undefined ||
    next === undefined ||
    blocker === undefined ||
    updatedAt === undefined ||
    evidence === undefined
  ) {
    return undefined;
  }
  return revision({ title, goal, status, completed, next, blocker, updatedAt, evidence });
}

/**
 * Parses an explicit verification-result record. The result is never derived
 * from a test filename or source definition and must state its remaining gap.
 */
export function extractContextVerificationArtifact(
  content: string,
): ContextVerificationArtifact | undefined {
  const { title, sections } = documentSections(content);
  const claim = sectionText(sections.get("要证明什么") ?? []);
  const result = sectionText(sections.get("结果") ?? []);
  const gap = sectionText(sections.get("尚未证明") ?? []);
  const method = sectionText(sections.get("验证方式") ?? []);
  const verifiedRevision = sectionText(sections.get("验证修订") ?? []);
  const executedAt = isoTimestamp(sectionText(sections.get("执行时间") ?? []));
  const evidence = artifactEvidence(sections);
  if (
    title === undefined ||
    claim === undefined ||
    result === undefined ||
    gap === undefined ||
    method === undefined ||
    verifiedRevision === undefined ||
    executedAt === undefined ||
    evidence === undefined
  ) {
    return undefined;
  }
  return revision({
    title, claim, result, gap, method, verifiedRevision, executedAt, evidence,
  });
}

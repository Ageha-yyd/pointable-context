import { createHash } from "node:crypto";

const MAX_FIELD_CHARS = 1_024;
const MAX_SEQUENCE_ITEMS = 4;
const MAX_SOURCE_PATH_CHARS = 480;

export interface ContextConceptEvidence {
  excerpt: string;
  sourcePath: string;
  sourceLine: number;
}

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

function sourceReference(value: string): Pick<ContextConceptEvidence, "sourcePath" | "sourceLine"> | undefined {
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

/**
 * Parses an author-supplied, explicitly structured concept artifact. It does
 * not infer concepts from prose and deliberately recognizes only the frozen
 * headings below.
 */
export function extractContextConceptArtifact(
  content: string,
): ContextConceptArtifact | undefined {
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

  const meaning = sectionText(sections.get("它是什么意思") ?? []);
  const currentContext = sectionText(sections.get("为什么现在出现") ?? []);
  const boundary = sectionText(sections.get("它不是什么") ?? []);
  const evidenceExcerpt = sectionText(sections.get("证据") ?? []);
  const source = sourceReference(sectionText(sections.get("来源") ?? []) ?? "");
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
    evidenceExcerpt === undefined ||
    source === undefined
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
    evidence: Object.freeze({ excerpt: evidenceExcerpt, ...source }),
  };
  return Object.freeze({
    ...base,
    contextRevision: createHash("sha256")
      .update(JSON.stringify(base), "utf8")
      .digest("hex"),
  });
}

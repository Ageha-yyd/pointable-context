import { basename, extname, join, relative, resolve, sep } from "node:path";
import { open, readdir, realpath, stat } from "node:fs/promises";
import {
  extractContextChangeArtifact,
  extractContextConceptArtifact,
  extractContextDecisionArtifact,
  type ContextArtifactEvidence,
} from "../adapters/context-concept.js";
import { verifyContextArtifactEvidence } from "../adapters/local-workspace.js";

const ARTIFACT_DIRECTORIES = Object.freeze([
  { kind: "concept", path: "docs/concepts" },
  { kind: "change", path: "docs/changes" },
  { kind: "decision", path: "docs/decisions" },
] as const);
const MANAGED_CONTEXT_PREFIXES = Object.freeze([
  "docs/concepts/",
  "docs/changes/",
  "docs/decisions/",
  "docs/tasks/",
  "docs/verifications/",
] as const);
const MAX_ARTIFACTS = 256;
const MAX_ARTIFACT_BYTES = 128 * 1024;

export type ContextMilestoneArtifactKind = "concept" | "change" | "decision";
export type ContextArtifactIssueCode =
  | "workspace_unavailable"
  | "artifact_directory_unavailable"
  | "artifact_capacity_exceeded"
  | "artifact_file_unavailable"
  | "artifact_file_too_large"
  | "artifact_encoding_invalid"
  | "artifact_schema_invalid"
  | "artifact_identity_mismatch"
  | "artifact_evidence_invalid"
  | "duplicate_identity";

export interface CheckedContextArtifact {
  kind: ContextMilestoneArtifactKind;
  path: string;
  identity: string;
  title: string;
  evidenceSource: string;
  evidenceRevision: string;
}

export interface ContextArtifactIssue {
  code: ContextArtifactIssueCode;
  path?: string;
  identity?: string;
}

export interface ContextArtifactCheckResult {
  schemaVersion: 1;
  valid: boolean;
  workspaceRoot?: string;
  checkedAt: string;
  candidateCount: number;
  artifacts: readonly CheckedContextArtifact[];
  issues: readonly ContextArtifactIssue[];
}

interface ArtifactCandidate {
  kind: ContextMilestoneArtifactKind;
  absolutePath: string;
  relativePath: string;
  identity: string;
}

interface ParsedArtifact {
  title: string;
  evidence: ContextArtifactEvidence;
}

const EXACT_SECTIONS = Object.freeze({
  concept: Object.freeze([
    "它是什么意思",
    "为什么现在出现",
    "它不是什么",
    "所处流程",
    "证据",
    "来源",
  ]),
  change: Object.freeze(["原来怎样", "现在怎样", "影响什么", "证据", "来源"]),
  decision: Object.freeze([
    "为什么需要决定",
    "选择了什么",
    "后果是什么",
    "证据",
    "来源",
  ]),
} satisfies Record<ContextMilestoneArtifactKind, readonly string[]>);

function portableRelative(root: string, target: string): string | undefined {
  const value = relative(root, target);
  if (value === "" || value === ".." || value.startsWith(`..${sep}`)) return undefined;
  return value.split(sep).join("/");
}

function safeIdentity(path: string): string | undefined {
  const stem = basename(path, extname(path)).normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (stem.length === 0 || stem.length > 128 || /[\p{Cc}\p{Cf}]/u.test(stem)) return undefined;
  return stem;
}

function titleIdentity(title: string): string | undefined {
  const value = title
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\s_]+/gu, "-")
    .replace(/-+/gu, "-");
  if (value.length === 0 || value.length > 128 || /[\p{Cc}\p{Cf}]/u.test(value)) return undefined;
  return value;
}

function decodeUtf8(content: Buffer): string | undefined {
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(content);
  return decoded.includes("\u0000") ? undefined : decoded;
}

async function collectCandidates(
  root: string,
  issues: ContextArtifactIssue[],
): Promise<ArtifactCandidate[]> {
  const candidates: ArtifactCandidate[] = [];
  for (const directory of ARTIFACT_DIRECTORIES) {
    const requested = resolve(root, ...directory.path.split("/"));
    let entries;
    try {
      const canonical = await realpath(requested);
      if (portableRelative(root, canonical) !== directory.path || !(await stat(canonical)).isDirectory()) {
        issues.push({ code: "artifact_directory_unavailable", path: directory.path });
        continue;
      }
      entries = await readdir(canonical, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      issues.push({ code: "artifact_directory_unavailable", path: directory.path });
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || extname(entry.name).toLocaleLowerCase("en-US") !== ".md") continue;
      if (candidates.length >= MAX_ARTIFACTS) {
        issues.push({ code: "artifact_capacity_exceeded" });
        return candidates;
      }
      const identity = safeIdentity(entry.name);
      const relativePath = `${directory.path}/${entry.name}`;
      if (identity === undefined) {
        issues.push({ code: "artifact_schema_invalid", path: relativePath });
        continue;
      }
      candidates.push({
        kind: directory.kind,
        absolutePath: join(root, ...relativePath.split("/")),
        relativePath,
        identity,
      });
    }
  }
  return candidates;
}

async function readStableArtifact(
  root: string,
  candidate: ArtifactCandidate,
): Promise<{ content?: string; issue?: ContextArtifactIssue }> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const canonical = await realpath(candidate.absolutePath);
    if (portableRelative(root, canonical) !== candidate.relativePath) {
      return { issue: { code: "artifact_file_unavailable", path: candidate.relativePath } };
    }
    handle = await open(canonical, "r");
    const before = await handle.stat();
    if (!before.isFile()) {
      return { issue: { code: "artifact_file_unavailable", path: candidate.relativePath } };
    }
    if (before.size > MAX_ARTIFACT_BYTES) {
      return { issue: { code: "artifact_file_too_large", path: candidate.relativePath } };
    }
    const raw = await handle.readFile();
    const after = await handle.stat();
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      before.ino !== after.ino
    ) {
      return { issue: { code: "artifact_file_unavailable", path: candidate.relativePath } };
    }
    const content = decodeUtf8(raw);
    return content === undefined
      ? { issue: { code: "artifact_encoding_invalid", path: candidate.relativePath } }
      : { content };
  } catch {
    return { issue: { code: "artifact_file_unavailable", path: candidate.relativePath } };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parseArtifact(candidate: ArtifactCandidate, content: string): ParsedArtifact | undefined {
  const headings = [...content.matchAll(/^##[ \t]+(.+?)[ \t]*$/gmu)].map(
    (match) => match[1]?.trim() ?? "",
  );
  const expected = EXACT_SECTIONS[candidate.kind];
  if (
    headings.length !== expected.length ||
    headings.some((heading, index) => heading !== expected[index])
  ) {
    return undefined;
  }
  if (candidate.kind === "concept") return extractContextConceptArtifact(content);
  if (candidate.kind === "change") return extractContextChangeArtifact(content);
  return extractContextDecisionArtifact(content);
}

function managedEvidenceSource(path: string): boolean {
  const source = path.replace(/\\/gu, "/");
  return MANAGED_CONTEXT_PREFIXES.some((prefix) => source.startsWith(prefix));
}

export async function checkContextMilestoneArtifacts(
  workspaceRoot: string,
  options: { signal?: AbortSignal; now?: () => Date } = {},
): Promise<ContextArtifactCheckResult> {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const issues: ContextArtifactIssue[] = [];
  const artifacts: CheckedContextArtifact[] = [];
  let root: string;
  try {
    root = await realpath(resolve(workspaceRoot));
    if (!(await stat(root)).isDirectory()) throw new Error("not a directory");
  } catch {
    return Object.freeze({
      schemaVersion: 1 as const,
      valid: false,
      checkedAt,
      candidateCount: 0,
      artifacts: Object.freeze([]),
      issues: Object.freeze([{ code: "workspace_unavailable" as const }]),
    });
  }

  const candidates = await collectCandidates(root, issues);
  const identities = new Map<string, ArtifactCandidate[]>();
  for (const candidate of candidates) {
    const group = identities.get(candidate.identity) ?? [];
    group.push(candidate);
    identities.set(candidate.identity, group);
  }
  const duplicateIdentities = new Set<string>();
  for (const [identity, group] of identities) {
    if (group.length < 2) continue;
    duplicateIdentities.add(identity);
    for (const candidate of group) {
      issues.push({ code: "duplicate_identity", path: candidate.relativePath, identity });
    }
  }

  for (const candidate of candidates) {
    if (options.signal?.aborted || duplicateIdentities.has(candidate.identity)) continue;
    const read = await readStableArtifact(root, candidate);
    if (read.issue !== undefined) {
      issues.push(read.issue);
      continue;
    }
    const artifact = parseArtifact(candidate, read.content ?? "");
    if (artifact === undefined) {
      issues.push({ code: "artifact_schema_invalid", path: candidate.relativePath });
      continue;
    }
    if (titleIdentity(artifact.title) !== candidate.identity) {
      issues.push({
        code: "artifact_identity_mismatch",
        path: candidate.relativePath,
        identity: candidate.identity,
      });
      continue;
    }
    if (managedEvidenceSource(artifact.evidence.sourcePath)) {
      issues.push({ code: "artifact_evidence_invalid", path: candidate.relativePath });
      continue;
    }
    const evidence = await verifyContextArtifactEvidence(root, artifact, options.signal);
    if (evidence === undefined) {
      issues.push({ code: "artifact_evidence_invalid", path: candidate.relativePath });
      continue;
    }
    artifacts.push(Object.freeze({
      kind: candidate.kind,
      path: candidate.relativePath,
      identity: candidate.identity,
      title: artifact.title,
      evidenceSource: evidence.sourceId,
      evidenceRevision: evidence.revision,
    }));
  }

  return Object.freeze({
    schemaVersion: 1 as const,
    valid: issues.length === 0 && !options.signal?.aborted,
    workspaceRoot: root,
    checkedAt,
    candidateCount: candidates.length,
    artifacts: Object.freeze(artifacts),
    issues: Object.freeze(issues),
  });
}

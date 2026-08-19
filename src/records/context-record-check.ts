import { basename, extname, join, relative, resolve, sep } from "node:path";
import { open, readdir, realpath, stat } from "node:fs/promises";
import {
  extractContextTaskArtifact,
  extractContextVerificationArtifact,
  type ContextTaskArtifact,
  type ContextVerificationArtifact,
} from "../adapters/context-concept.js";
import { verifyContextArtifactEvidence } from "../adapters/local-workspace.js";

const RECORD_DIRECTORIES = Object.freeze([
  { kind: "task", path: "docs/tasks" },
  { kind: "verification", path: "docs/verifications" },
] as const);
const MAX_RECORDS = 256;
const MAX_RECORD_BYTES = 128 * 1024;

export type ContextRecordKind = "task" | "verification";
export type ContextRecordIssueCode =
  | "workspace_unavailable"
  | "record_directory_unavailable"
  | "record_capacity_exceeded"
  | "record_file_unavailable"
  | "record_file_too_large"
  | "record_encoding_invalid"
  | "record_schema_invalid"
  | "record_evidence_invalid"
  | "duplicate_identity";

export interface CheckedContextRecord {
  kind: ContextRecordKind;
  path: string;
  identity: string;
  title: string;
  evidenceSource: string;
  evidenceRevision: string;
}

export interface ContextRecordIssue {
  code: ContextRecordIssueCode;
  path?: string;
  identity?: string;
}

export interface ContextRecordCheckResult {
  schemaVersion: 1;
  valid: boolean;
  workspaceRoot?: string;
  checkedAt: string;
  records: readonly CheckedContextRecord[];
  issues: readonly ContextRecordIssue[];
}

interface RecordCandidate {
  kind: ContextRecordKind;
  absolutePath: string;
  relativePath: string;
  identity: string;
}

type ParsedRecord = ContextTaskArtifact | ContextVerificationArtifact;

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

function decodeUtf8(content: Buffer): string | undefined {
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(content);
  return decoded.includes("\u0000") ? undefined : decoded;
}

async function collectCandidates(
  root: string,
  issues: ContextRecordIssue[],
): Promise<RecordCandidate[]> {
  const candidates: RecordCandidate[] = [];
  for (const directory of RECORD_DIRECTORIES) {
    const requested = resolve(root, ...directory.path.split("/"));
    let entries;
    try {
      const canonical = await realpath(requested);
      if (portableRelative(root, canonical) !== directory.path) {
        issues.push({ code: "record_directory_unavailable", path: directory.path });
        continue;
      }
      const info = await stat(canonical);
      if (!info.isDirectory()) {
        issues.push({ code: "record_directory_unavailable", path: directory.path });
        continue;
      }
      entries = await readdir(canonical, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      issues.push({ code: "record_directory_unavailable", path: directory.path });
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || extname(entry.name).toLocaleLowerCase("en-US") !== ".md") continue;
      if (candidates.length >= MAX_RECORDS) {
        issues.push({ code: "record_capacity_exceeded" });
        return candidates;
      }
      const identity = safeIdentity(entry.name);
      const relativePath = `${directory.path}/${entry.name}`;
      if (identity === undefined) {
        issues.push({ code: "record_schema_invalid", path: relativePath });
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

async function readStableRecord(
  root: string,
  candidate: RecordCandidate,
): Promise<{ content?: string; issue?: ContextRecordIssue }> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const canonical = await realpath(candidate.absolutePath);
    if (portableRelative(root, canonical) !== candidate.relativePath) {
      return { issue: { code: "record_file_unavailable", path: candidate.relativePath } };
    }
    handle = await open(canonical, "r");
    const before = await handle.stat();
    if (!before.isFile()) {
      return { issue: { code: "record_file_unavailable", path: candidate.relativePath } };
    }
    if (before.size > MAX_RECORD_BYTES) {
      return { issue: { code: "record_file_too_large", path: candidate.relativePath } };
    }
    const raw = await handle.readFile();
    const after = await handle.stat();
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      before.ino !== after.ino
    ) {
      return { issue: { code: "record_file_unavailable", path: candidate.relativePath } };
    }
    const content = decodeUtf8(raw);
    return content === undefined
      ? { issue: { code: "record_encoding_invalid", path: candidate.relativePath } }
      : { content };
  } catch {
    return { issue: { code: "record_file_unavailable", path: candidate.relativePath } };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parseRecord(candidate: RecordCandidate, content: string): ParsedRecord | undefined {
  return candidate.kind === "task"
    ? extractContextTaskArtifact(content)
    : extractContextVerificationArtifact(content);
}

export async function checkContextRecords(
  workspaceRoot: string,
  options: { signal?: AbortSignal; now?: () => Date } = {},
): Promise<ContextRecordCheckResult> {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const issues: ContextRecordIssue[] = [];
  const records: CheckedContextRecord[] = [];
  let root: string;
  try {
    root = await realpath(resolve(workspaceRoot));
    if (!(await stat(root)).isDirectory()) throw new Error("not a directory");
  } catch {
    return Object.freeze({
      schemaVersion: 1 as const,
      valid: false,
      checkedAt,
      records: Object.freeze([]),
      issues: Object.freeze([{ code: "workspace_unavailable" as const }]),
    });
  }

  const candidates = await collectCandidates(root, issues);
  const identities = new Map<string, RecordCandidate[]>();
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
      issues.push({
        code: "duplicate_identity",
        path: candidate.relativePath,
        identity,
      });
    }
  }

  for (const candidate of candidates) {
    if (options.signal?.aborted || duplicateIdentities.has(candidate.identity)) continue;
    const read = await readStableRecord(root, candidate);
    if (read.issue !== undefined) {
      issues.push(read.issue);
      continue;
    }
    const artifact = parseRecord(candidate, read.content ?? "");
    if (artifact === undefined) {
      issues.push({ code: "record_schema_invalid", path: candidate.relativePath });
      continue;
    }
    const sourcePath = artifact.evidence.sourcePath.replace(/\\/gu, "/");
    if (
      sourcePath.startsWith("docs/tasks/") ||
      sourcePath.startsWith("docs/verifications/")
    ) {
      issues.push({ code: "record_evidence_invalid", path: candidate.relativePath });
      continue;
    }
    const evidence = await verifyContextArtifactEvidence(root, artifact, options.signal);
    if (evidence === undefined) {
      issues.push({ code: "record_evidence_invalid", path: candidate.relativePath });
      continue;
    }
    records.push(Object.freeze({
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
    records: Object.freeze(records),
    issues: Object.freeze(issues),
  });
}

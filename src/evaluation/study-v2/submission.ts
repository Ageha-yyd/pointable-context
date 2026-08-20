import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { STUDY_V2_ID } from "./contracts.js";

const execFileAsync = promisify(execFile);
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u;
const ENVELOPE_PATTERN = /^submission-[a-f0-9]{8,32}\.pcstudy$/u;
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,100}$/u;
const MAX_ENVELOPE_BYTES = 6 * 1024 * 1024;

type JsonObject = Record<string, unknown>;

export interface StudyV2GitHubSubmissionPlan {
  schemaVersion: 1;
  studyId: typeof STUDY_V2_ID;
  repository: string;
  baseBranch: string;
  envelopeName: string;
  envelopeSha256: string;
  destinationPath: string;
  accountIdentityVisible: true;
  uploadsPlaintext: false;
}

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

async function verifiedEnvelope(path: string): Promise<{ path: string; name: string; digest: string }> {
  const canonical = await realpath(resolve(path));
  const info = await stat(canonical);
  const name = basename(canonical);
  if (!info.isFile() || info.size < 256 || info.size > MAX_ENVELOPE_BYTES || !ENVELOPE_PATTERN.test(name)) {
    throw new Error("encrypted_submission_envelope_invalid");
  }
  const bytes = await readFile(canonical);
  const envelope = object(JSON.parse(bytes.toString("utf8")));
  if (
    envelope === undefined || envelope.schemaVersion !== 1 ||
    envelope.kind !== "pointable-context-study-result" || envelope.studyId !== STUDY_V2_ID ||
    envelope.cipher !== "AES-256-GCM" || envelope.keyWrap !== "RSA-OAEP-SHA256" ||
    typeof envelope.ciphertext !== "string" || envelope.ciphertext.length < 128
  ) {
    throw new Error("encrypted_submission_envelope_invalid");
  }
  return { path: canonical, name, digest: createHash("sha256").update(bytes).digest("hex") };
}

export async function planStudyV2GitHubSubmission(options: {
  envelopePath: string;
  repository: string;
  baseBranch?: string;
}): Promise<StudyV2GitHubSubmissionPlan> {
  if (!REPOSITORY_PATTERN.test(options.repository)) throw new Error("github_repository_invalid");
  const baseBranch = options.baseBranch ?? "main";
  if (!BRANCH_PATTERN.test(baseBranch) || baseBranch.includes("..") || baseBranch.startsWith("/")) {
    throw new Error("github_base_branch_invalid");
  }
  const envelope = await verifiedEnvelope(options.envelopePath);
  return Object.freeze({
    schemaVersion: 1 as const,
    studyId: STUDY_V2_ID,
    repository: options.repository,
    baseBranch,
    envelopeName: envelope.name,
    envelopeSha256: envelope.digest,
    destinationPath: `submissions/v2/${envelope.name}`,
    accountIdentityVisible: true as const,
    uploadsPlaintext: false as const,
  });
}

function inside(parent: string, target: string): boolean {
  const value = relative(parent, target);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !value.startsWith(".."));
}

async function command(commandName: string, args: readonly string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync(commandName, [...args], {
    ...(cwd === undefined ? {} : { cwd }),
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 256 * 1024,
  });
  return stdout.trim();
}

export async function submitStudyV2EnvelopeToGitHub(options: {
  envelopePath: string;
  repository: string;
  baseBranch?: string;
  confirmed: boolean;
}): Promise<{ plan: StudyV2GitHubSubmissionPlan; pullRequestUrl: string }> {
  if (!options.confirmed) throw new Error("explicit_submission_confirmation_required");
  const plan = await planStudyV2GitHubSubmission(options);
  await command("gh", ["auth", "status"]);
  const login = await command("gh", ["api", "user", "--jq", ".login"]);
  if (!/^[A-Za-z0-9-]{1,39}$/u.test(login)) throw new Error("github_identity_unavailable");
  const tempBase = await realpath(tmpdir());
  const temporary = await mkdtemp(join(tempBase, "pointable-study-v2-submit-"));
  if (!inside(tempBase, temporary)) throw new Error("temporary_submission_root_invalid");
  const checkout = join(temporary, "submission-repository");
  const token = plan.envelopeName.slice("submission-".length, -".pcstudy".length);
  const branch = `study-v2-submission-${token}`;
  try {
    await command("gh", [
      "repo", "fork", plan.repository, "--clone", "--default-branch-only", "--", checkout,
    ], temporary);
    await command("git", ["checkout", "-b", branch], checkout);
    const destination = join(checkout, ...plan.destinationPath.split("/"));
    await mkdir(join(checkout, "submissions", "v2"), { recursive: true });
    await cp(await realpath(resolve(options.envelopePath)), destination, { errorOnExist: true });
    await command("git", ["add", "--", plan.destinationPath], checkout);
    await command("git", ["commit", "-m", `Add encrypted study-v2 submission ${token}`], checkout);
    await command("git", ["push", "--set-upstream", "origin", branch], checkout);
    const url = await command("gh", [
      "pr", "create",
      "--repo", plan.repository,
      "--base", plan.baseBranch,
      "--head", `${login}:${branch}`,
      "--title", `Encrypted study-v2 submission ${token}`,
      "--body", `Encrypted Pointable Context study-v2 result. SHA-256: ${plan.envelopeSha256}. No plaintext study data is included.`,
    ], checkout);
    if (!/^https:\/\/github\.com\//u.test(url)) throw new Error("github_pull_request_unverified");
    return { plan, pullRequestUrl: url };
  } finally {
    if (inside(tempBase, temporary)) await rm(temporary, { recursive: true, force: true });
  }
}

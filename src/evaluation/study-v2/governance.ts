import { createHash, createPublicKey } from "node:crypto";
import { STUDY_V2_ID } from "./contracts.js";

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,99}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u;
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,100}$/u;
const CONTACT_PATTERN = /^(?:mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/u;

type JsonObject = Record<string, unknown>;

export interface StudyV2PilotGovernanceValidation {
  schemaVersion: 1;
  studyId: typeof STUDY_V2_ID;
  valid: boolean;
  status?: "approved_for_pilot_data_collection";
  releaseCommit?: string;
  publicKeySha256?: string;
  issues: readonly string[];
}

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function exactKeys(value: JsonObject, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function date(value: unknown): number | undefined {
  if (typeof value !== "string" || value.length < 20 || value.length > 40) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : undefined;
}

function bounded(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

export function validateStudyV2PilotGovernance(options: {
  governance: unknown;
  researcherPublicKeyPem: string;
  expectedReleaseCommit: string;
}): StudyV2PilotGovernanceValidation {
  const issues: string[] = [];
  const governance = object(options.governance);
  let publicKeySha256: string | undefined;
  try {
    const publicKey = createPublicKey(options.researcherPublicKeyPem);
    if (publicKey.asymmetricKeyType !== "rsa" || (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
      issues.push("pilot_public_key_invalid");
    } else {
      publicKeySha256 = createHash("sha256")
        .update(publicKey.export({ type: "spki", format: "der" }))
        .digest("hex");
    }
  } catch {
    issues.push("pilot_public_key_invalid");
  }
  if (!COMMIT_PATTERN.test(options.expectedReleaseCommit)) issues.push("pilot_release_commit_invalid");
  if (governance === undefined || !exactKeys(governance, [
    "schemaVersion", "studyId", "status", "releaseCommit", "releaseTag", "organizerContact",
    "ethicsReview", "recruitment", "dataGovernance", "submission", "organizerSignOffAt",
  ])) {
    issues.push("pilot_governance_shape_invalid");
  } else {
    if (
      governance.schemaVersion !== 1 || governance.studyId !== STUDY_V2_ID ||
      governance.status !== "approved_for_pilot_data_collection"
    ) issues.push("pilot_governance_identity_invalid");
    if (
      typeof governance.releaseCommit !== "string" || !COMMIT_PATTERN.test(governance.releaseCommit) ||
      governance.releaseCommit !== options.expectedReleaseCommit
    ) issues.push("pilot_governance_commit_mismatch");
    if (typeof governance.releaseTag !== "string" || !TAG_PATTERN.test(governance.releaseTag)) {
      issues.push("pilot_governance_tag_invalid");
    }
    if (typeof governance.organizerContact !== "string" || !CONTACT_PATTERN.test(governance.organizerContact)) {
      issues.push("pilot_governance_contact_invalid");
    }
    const ethics = object(governance.ethicsReview);
    const ethicsDecidedAt = date(ethics?.decidedAt);
    if (
      ethics === undefined || !exactKeys(ethics, ["determination", "reference", "decidedAt"]) ||
      (ethics.determination !== "approved" && ethics.determination !== "not_required") ||
      !bounded(ethics.reference, 3, 256) || ethicsDecidedAt === undefined
    ) issues.push("pilot_governance_ethics_invalid");
    const recruitment = object(governance.recruitment);
    const opensAt = date(recruitment?.opensAt);
    const closesAt = date(recruitment?.closesAt);
    if (
      recruitment === undefined || !exactKeys(recruitment, ["opensAt", "closesAt", "targetCompletedParticipants"]) ||
      opensAt === undefined || closesAt === undefined || opensAt >= closesAt ||
      !Number.isInteger(recruitment.targetCompletedParticipants) ||
      (recruitment.targetCompletedParticipants as number) < 2 ||
      (recruitment.targetCompletedParticipants as number) > 999
    ) issues.push("pilot_governance_recruitment_invalid");
    const data = object(governance.dataGovernance);
    const deletionUntil = date(data?.deletionRequestUntil);
    const freezeAt = date(data?.freezeAt);
    const retentionEndsAt = date(data?.retentionEndsAt);
    if (
      data === undefined || !exactKeys(data, ["deletionRequestUntil", "freezeAt", "retentionEndsAt"]) ||
      deletionUntil === undefined || freezeAt === undefined || retentionEndsAt === undefined ||
      deletionUntil > freezeAt || freezeAt >= retentionEndsAt ||
      (closesAt !== undefined && deletionUntil < closesAt)
    ) issues.push("pilot_governance_data_window_invalid");
    const submission = object(governance.submission);
    if (
      submission === undefined || !exactKeys(submission, [
        "repository", "baseBranch", "publicKeySha256", "githubAccountIdentityVisible",
      ]) || typeof submission.repository !== "string" || !REPOSITORY_PATTERN.test(submission.repository) ||
      typeof submission.baseBranch !== "string" || !BRANCH_PATTERN.test(submission.baseBranch) ||
      submission.baseBranch.includes("..") || submission.baseBranch.startsWith("/") ||
      typeof submission.publicKeySha256 !== "string" || !DIGEST_PATTERN.test(submission.publicKeySha256) ||
      publicKeySha256 === undefined || submission.publicKeySha256 !== publicKeySha256 ||
      submission.githubAccountIdentityVisible !== true
    ) issues.push("pilot_governance_submission_invalid");
    const signOffAt = date(governance.organizerSignOffAt);
    if (
      signOffAt === undefined || (opensAt !== undefined && signOffAt > opensAt) ||
      (ethicsDecidedAt !== undefined && signOffAt < ethicsDecidedAt)
    ) {
      issues.push("pilot_governance_signoff_invalid");
    }
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    studyId: STUDY_V2_ID,
    valid: issues.length === 0,
    ...(governance?.status === "approved_for_pilot_data_collection"
      ? { status: governance.status as "approved_for_pilot_data_collection" }
      : {}),
    ...(typeof governance?.releaseCommit === "string" ? { releaseCommit: governance.releaseCommit } : {}),
    ...(publicKeySha256 === undefined ? {} : { publicKeySha256 }),
    issues: Object.freeze(issues),
  });
}

import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  STUDY_V2_EVENT_TYPES,
  STUDY_V2_ID,
  STUDY_V2_SCENARIOS,
  studyV2AssignmentForSlot,
} from "./contracts.js";
import { isStudyV2Language } from "./language.js";
import type {
  StudyV2Event,
  StudyV2Questionnaire,
  StudyV2SessionManifest,
  StudyV2TrialResult,
} from "./contracts.js";
import { deriveStudyV2TrialResult } from "./trial-metrics.js";

const RESULT_FILES = Object.freeze([
  "manifest.json",
  "events.ndjson",
  "trials.csv",
  "questionnaire.json",
  "integrity.json",
]);
const MAX_RESULT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_RESULT_TOTAL_BYTES = 5 * 1024 * 1024;
const SESSION_PATTERN = /^[a-f0-9]{32}$/u;
const PARTICIPANT_PATTERN = /^P[0-9]{3}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9._:/-]{0,95}$/u;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,95}$/u;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

const TRIAL_HEADER = [
  "trial_id",
  "scenario_id",
  "condition",
  "task_completion_ms",
  "success",
  "timed_out",
  "aborted",
  "time_to_first_correct_object_ms",
  "scripted_followup_requests",
  "navigation_count",
  "navigation_time_ms",
  "wrong_object_count",
  "card_open_count",
  "card_dwell_ms",
  "patch_attempt_count",
  "answer_code",
].join(",");

type JsonObject = Record<string, unknown>;

export interface StudyV2ResultIssue {
  code: string;
  path?: string;
  line?: number;
}

export interface StudyV2ResultValidation {
  schemaVersion: 2;
  studyId: typeof STUDY_V2_ID;
  valid: boolean;
  sessionId?: string;
  participantCode?: string;
  language?: "zh-CN" | "en-US";
  eventCount?: number;
  trialCount?: number;
  issues: readonly StudyV2ResultIssue[];
}

export interface StudyV2ResultPreview {
  schemaVersion: 2;
  studyId: typeof STUDY_V2_ID;
  valid: boolean;
  sessionId?: string;
  participantCode?: string;
  language?: "zh-CN" | "en-US";
  eventCount: number;
  trialCount: number;
  includedFiles: readonly string[];
  excludedData: readonly string[];
  issues: readonly StudyV2ResultIssue[];
}

interface ResultArchive {
  schemaVersion: 2;
  studyId: typeof STUDY_V2_ID;
  files: Readonly<Record<string, string>>;
}

export interface EncryptedStudyV2Envelope {
  schemaVersion: 1;
  kind: "pointable-context-study-result";
  studyId: typeof STUDY_V2_ID;
  cipher: "AES-256-GCM";
  keyWrap: "RSA-OAEP-SHA256";
  encryptedKey: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  plaintextSha256: string;
}

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function exactKeys(value: JsonObject, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function finiteNumber(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function boolText(value: string): boolean {
  return value === "true" || value === "false";
}

function contained(root: string, target: string): boolean {
  const value = relative(root, target);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

async function canonicalResultRoot(resultDirectory: string): Promise<string> {
  const root = await realpath(resolve(resultDirectory));
  if (!(await stat(root)).isDirectory()) throw new Error("result directory is unavailable");
  return root;
}

async function readResultFile(root: string, name: string): Promise<Buffer> {
  if (!RESULT_FILES.includes(name)) throw new Error("unexpected result file");
  const target = await realpath(join(root, name));
  if (!contained(root, target)) throw new Error("result file escapes result directory");
  const info = await stat(target);
  if (!info.isFile() || info.size > MAX_RESULT_FILE_BYTES) throw new Error("result file is unavailable or oversized");
  return readFile(target);
}

function parseManifest(raw: unknown, issues: StudyV2ResultIssue[]): StudyV2SessionManifest | undefined {
  const value = object(raw);
  if (
    value === undefined ||
    !exactKeys(value, [
      "schemaVersion", "studyId", "sessionId", "participantCode", "slot", "packDigest",
      "language", "createdAt", "completedAt", "environment", "trials",
    ]) ||
    value.schemaVersion !== 2 ||
    value.studyId !== STUDY_V2_ID ||
    typeof value.sessionId !== "string" || !SESSION_PATTERN.test(value.sessionId) ||
    typeof value.participantCode !== "string" || !PARTICIPANT_PATTERN.test(value.participantCode) ||
    !integer(value.slot, 1, 12) ||
    !isStudyV2Language(value.language) ||
    typeof value.packDigest !== "string" || !DIGEST_PATTERN.test(value.packDigest) ||
    typeof value.createdAt !== "string" || !ISO_PATTERN.test(value.createdAt) ||
    typeof value.completedAt !== "string" || !ISO_PATTERN.test(value.completedAt)
  ) {
    issues.push({ code: "result_manifest_invalid", path: "manifest.json" });
    return undefined;
  }
  const environment = object(value.environment);
  if (
    environment === undefined ||
    !exactKeys(environment, ["platform", "arch", "codexBuild", "runnerVersion"]) ||
    environment.platform !== "win32" || environment.arch !== "x64" ||
    typeof environment.codexBuild !== "string" || !VERSION_PATTERN.test(environment.codexBuild) ||
    typeof environment.runnerVersion !== "string" || !VERSION_PATTERN.test(environment.runnerVersion)
  ) {
    issues.push({ code: "result_environment_invalid", path: "manifest.json" });
    return undefined;
  }
  const expected = studyV2AssignmentForSlot(value.slot);
  if (JSON.stringify(value.trials) !== JSON.stringify(expected.trials)) {
    issues.push({ code: "result_assignment_invalid", path: "manifest.json" });
    return undefined;
  }
  return {
    schemaVersion: 2,
    studyId: STUDY_V2_ID,
    sessionId: value.sessionId,
    participantCode: value.participantCode,
    slot: value.slot,
    language: value.language,
    packDigest: value.packDigest,
    createdAt: value.createdAt,
    completedAt: value.completedAt,
    environment: {
      platform: "win32",
      arch: "x64",
      codexBuild: environment.codexBuild as string,
      runnerVersion: environment.runnerVersion as string,
    },
    trials: expected.trials,
  };
}

function parseEvent(
  raw: unknown,
  line: number,
  manifest: StudyV2SessionManifest,
  issues: StudyV2ResultIssue[],
): StudyV2Event | undefined {
  const value = object(raw);
  const keys = value === undefined ? [] : Object.keys(value);
  const allowed = [
    "schemaVersion", "sessionId", "sequence", "trialId", "scenarioId", "condition",
    "eventType", "monotonicMs", "objectCode", "outcomeCode",
  ];
  if (
    value === undefined ||
    keys.some((key) => !allowed.includes(key)) ||
    value.schemaVersion !== 2 ||
    value.sessionId !== manifest.sessionId ||
    !integer(value.sequence, 1, 100_000) ||
    typeof value.trialId !== "string" || !CODE_PATTERN.test(value.trialId) ||
    !STUDY_V2_SCENARIOS.includes(value.scenarioId as never) ||
    (value.condition !== "A" && value.condition !== "B") ||
    !STUDY_V2_EVENT_TYPES.includes(value.eventType as never) ||
    !finiteNumber(value.monotonicMs, 0, 86_400_000) ||
    (value.objectCode !== undefined && (typeof value.objectCode !== "string" || !CODE_PATTERN.test(value.objectCode))) ||
    (value.outcomeCode !== undefined && (typeof value.outcomeCode !== "string" || !CODE_PATTERN.test(value.outcomeCode)))
  ) {
    issues.push({ code: "result_event_invalid", path: "events.ndjson", line });
    return undefined;
  }
  const trial = manifest.trials.find((candidate) => candidate.trialId === value.trialId);
  if (trial === undefined || trial.scenarioId !== value.scenarioId || trial.condition !== value.condition) {
    issues.push({ code: "result_event_assignment_mismatch", path: "events.ndjson", line });
    return undefined;
  }
  return value as unknown as StudyV2Event;
}

function parseTrials(
  text: string,
  manifest: StudyV2SessionManifest,
  issues: StudyV2ResultIssue[],
): StudyV2TrialResult[] {
  const lines = text.replace(/\r\n?/gu, "\n").trimEnd().split("\n");
  if (lines[0] !== TRIAL_HEADER || lines.length !== 7) {
    issues.push({ code: "result_trials_shape_invalid", path: "trials.csv" });
    return [];
  }
  const results: StudyV2TrialResult[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const fields = (lines[index] ?? "").split(",");
    const assignment = manifest.trials[index - 1];
    if (fields.length !== 16 || assignment === undefined) {
      issues.push({ code: "result_trial_invalid", path: "trials.csv", line: index + 1 });
      continue;
    }
    const [
      trialId, scenarioId, condition, taskCompletion, success, timedOut, aborted,
      timeToObject, followups, navigationCount, navigationTime, wrongObjects,
      cardOpens, cardDwell, patchAttempts, answerCode,
    ] = fields;
    const numbers = [taskCompletion, followups, navigationCount, navigationTime, wrongObjects, cardOpens, cardDwell, patchAttempts];
    if (
      trialId !== assignment.trialId || scenarioId !== assignment.scenarioId || condition !== assignment.condition ||
      numbers.some((number) => !/^\d{1,8}$/u.test(number ?? "")) ||
      (timeToObject !== "" && !/^\d{1,8}$/u.test(timeToObject ?? "")) ||
      !boolText(success ?? "") || !boolText(timedOut ?? "") || !boolText(aborted ?? "") ||
      typeof answerCode !== "string" || !CODE_PATTERN.test(answerCode)
    ) {
      issues.push({ code: "result_trial_invalid", path: "trials.csv", line: index + 1 });
      continue;
    }
    const parsed: StudyV2TrialResult = {
      trialId,
      scenarioId: assignment.scenarioId,
      condition: assignment.condition,
      taskCompletionMs: Number(taskCompletion),
      success: success === "true",
      timedOut: timedOut === "true",
      aborted: aborted === "true",
      timeToFirstCorrectObjectMs: timeToObject === "" ? null : Number(timeToObject),
      scriptedFollowupRequests: Number(followups),
      navigationCount: Number(navigationCount),
      navigationTimeMs: Number(navigationTime),
      wrongObjectCount: Number(wrongObjects),
      cardOpenCount: Number(cardOpens),
      cardDwellMs: Number(cardDwell),
      patchAttemptCount: Number(patchAttempts),
      answerCode,
    };
    const expectedAnswerPattern = new RegExp(`^${assignment.scenarioId.split("-")[0]}-[ABC]$`, "u");
    if (
      parsed.taskCompletionMs > 300_000 ||
      parsed.timedOut && parsed.aborted ||
      parsed.success && (parsed.timedOut || parsed.aborted) ||
      parsed.timeToFirstCorrectObjectMs !== null && parsed.timeToFirstCorrectObjectMs > parsed.taskCompletionMs ||
      parsed.navigationTimeMs > parsed.taskCompletionMs || parsed.cardDwellMs > parsed.taskCompletionMs ||
      [
        parsed.scriptedFollowupRequests, parsed.navigationCount, parsed.wrongObjectCount,
        parsed.cardOpenCount, parsed.patchAttemptCount,
      ].some((count) => count > 1_000) ||
      parsed.condition === "A" && (parsed.cardOpenCount !== 0 || parsed.cardDwellMs !== 0) ||
      (parsed.timedOut || parsed.aborted
        ? parsed.answerCode !== "NO_ANSWER"
        : !expectedAnswerPattern.test(parsed.answerCode))
    ) {
      issues.push({ code: "result_trial_invariant_invalid", path: "trials.csv", line: index + 1 });
      continue;
    }
    results.push(parsed);
  }
  return results;
}

function validateEventCompleteness(
  events: readonly StudyV2Event[],
  manifest: StudyV2SessionManifest,
  issues: StudyV2ResultIssue[],
): void {
  const terminal = new Set(["answer_submitted", "trial_timed_out", "trial_aborted"]);
  const cardEvents = new Set(["quick_action_shown", "card_opened", "card_closed", "card_refreshed", "evidence_expanded"]);
  for (const trial of manifest.trials) {
    const matching = events.filter((event) => event.trialId === trial.trialId);
    if (
      matching.length < 2 ||
      matching[0]?.eventType !== "trial_shown" ||
      matching.filter((event) => terminal.has(event.eventType)).length !== 1 ||
      !terminal.has(matching.at(-1)?.eventType ?? "")
    ) {
      issues.push({ code: "result_trial_events_incomplete", path: "events.ndjson" });
    }
    if (trial.condition === "A" && matching.some((event) => cardEvents.has(event.eventType))) {
      issues.push({ code: "result_condition_A_card_event", path: "events.ndjson" });
    }
  }
}

function parseQuestionnaire(
  raw: unknown,
  manifest: StudyV2SessionManifest,
  issues: StudyV2ResultIssue[],
): StudyV2Questionnaire | undefined {
  const value = object(raw);
  if (
    value === undefined ||
    !exactKeys(value, [
      "schemaVersion", "sessionId", "mentalDemand", "effort", "frustration",
      "confidence", "informationSufficiency",
    ]) ||
    value.schemaVersion !== 2 || value.sessionId !== manifest.sessionId ||
    !integer(value.mentalDemand, 1, 7) || !integer(value.effort, 1, 7) ||
    !integer(value.frustration, 1, 7) || !integer(value.confidence, 1, 7) ||
    !integer(value.informationSufficiency, 1, 7)
  ) {
    issues.push({ code: "result_questionnaire_invalid", path: "questionnaire.json" });
    return undefined;
  }
  return value as unknown as StudyV2Questionnaire;
}

async function verifyIntegrity(root: string, issues: StudyV2ResultIssue[]): Promise<void> {
  let integrity: JsonObject | undefined;
  try {
    integrity = object(JSON.parse((await readResultFile(root, "integrity.json")).toString("utf8")));
  } catch {
    issues.push({ code: "result_integrity_invalid", path: "integrity.json" });
    return;
  }
  const expectedNames = RESULT_FILES.filter((name) => name !== "integrity.json");
  if (
    integrity === undefined ||
    integrity.schemaVersion !== 1 ||
    integrity.algorithm !== "sha256" ||
    !exactKeys(integrity, ["schemaVersion", "algorithm", "files"]) ||
    object(integrity.files) === undefined ||
    !exactKeys(object(integrity.files) ?? {}, expectedNames)
  ) {
    issues.push({ code: "result_integrity_invalid", path: "integrity.json" });
    return;
  }
  const files = object(integrity.files) ?? {};
  for (const name of expectedNames) {
    const actual = createHash("sha256").update(await readResultFile(root, name)).digest("hex");
    if (files[name] !== actual) issues.push({ code: "result_integrity_mismatch", path: name });
  }
}

export async function validateStudyV2ResultDirectory(
  resultDirectory: string,
): Promise<StudyV2ResultValidation> {
  const issues: StudyV2ResultIssue[] = [];
  let root: string;
  try {
    root = await canonicalResultRoot(resultDirectory);
  } catch {
    return Object.freeze({
      schemaVersion: 2 as const,
      studyId: STUDY_V2_ID,
      valid: false,
      issues: Object.freeze([{ code: "result_directory_unavailable" }]),
    });
  }
  let manifest: StudyV2SessionManifest | undefined;
  let eventCount = 0;
  let trialCount = 0;
  try {
    manifest = parseManifest(JSON.parse((await readResultFile(root, "manifest.json")).toString("utf8")), issues);
    if (manifest !== undefined) {
      const lines = (await readResultFile(root, "events.ndjson")).toString("utf8")
        .replace(/\r\n?/gu, "\n").trimEnd().split("\n");
      const parsedEvents: StudyV2Event[] = [];
      let parsedTrials: StudyV2TrialResult[] = [];
      if (lines.length === 1 && lines[0] === "") {
        issues.push({ code: "result_events_empty", path: "events.ndjson" });
      } else {
        let priorSequence = 0;
        let priorMonotonic = -1;
        let priorTrialId = "";
        let priorTrialOrder = -1;
        for (let index = 0; index < lines.length; index += 1) {
          try {
            const event = parseEvent(JSON.parse(lines[index] ?? ""), index + 1, manifest, issues);
            if (event !== undefined) {
              eventCount += 1;
              parsedEvents.push(event);
              const trialOrder = manifest.trials.findIndex((trial) => trial.trialId === event.trialId);
              if (event.trialId !== priorTrialId) {
                if (trialOrder !== priorTrialOrder + 1) {
                  issues.push({ code: "result_event_trial_order_invalid", path: "events.ndjson", line: index + 1 });
                }
                priorTrialId = event.trialId;
                priorTrialOrder = trialOrder;
                priorMonotonic = -1;
              }
              if (event.sequence !== priorSequence + 1 || event.monotonicMs < priorMonotonic) {
                issues.push({ code: "result_event_order_invalid", path: "events.ndjson", line: index + 1 });
              }
              priorSequence = event.sequence;
              priorMonotonic = event.monotonicMs;
            }
          } catch {
            issues.push({ code: "result_event_invalid", path: "events.ndjson", line: index + 1 });
          }
        }
        validateEventCompleteness(parsedEvents, manifest, issues);
      }
      parsedTrials = parseTrials((await readResultFile(root, "trials.csv")).toString("utf8"), manifest, issues);
      trialCount = parsedTrials.length;
      if (trialCount !== 6) issues.push({ code: "result_trials_incomplete", path: "trials.csv" });
      for (const parsedTrial of parsedTrials) {
        const assignment = manifest.trials.find((trial) => trial.trialId === parsedTrial.trialId);
        if (assignment === undefined) continue;
        try {
          const derived = deriveStudyV2TrialResult(
            assignment,
            parsedEvents.filter((event) => event.trialId === assignment.trialId),
          );
          if (JSON.stringify(derived) !== JSON.stringify(parsedTrial)) {
            issues.push({ code: "result_trial_metrics_mismatch", path: "trials.csv" });
          }
        } catch {
          issues.push({ code: "result_trial_metrics_invalid", path: "trials.csv" });
        }
      }
      parseQuestionnaire(
        JSON.parse((await readResultFile(root, "questionnaire.json")).toString("utf8")),
        manifest,
        issues,
      );
      await verifyIntegrity(root, issues);
    }
  } catch {
    issues.push({ code: "result_material_unavailable" });
  }
  return Object.freeze({
    schemaVersion: 2 as const,
    studyId: STUDY_V2_ID,
    valid: issues.length === 0,
    ...(manifest === undefined ? {} : {
      sessionId: manifest.sessionId,
      participantCode: manifest.participantCode,
      language: manifest.language,
      eventCount,
      trialCount,
    }),
    issues: Object.freeze(issues),
  });
}

export async function previewStudyV2ResultDirectory(resultDirectory: string): Promise<StudyV2ResultPreview> {
  const validation = await validateStudyV2ResultDirectory(resultDirectory);
  return Object.freeze({
    schemaVersion: 2 as const,
    studyId: STUDY_V2_ID,
    valid: validation.valid,
    ...(validation.sessionId === undefined ? {} : { sessionId: validation.sessionId }),
    ...(validation.participantCode === undefined ? {} : { participantCode: validation.participantCode }),
    ...(validation.language === undefined ? {} : { language: validation.language }),
    eventCount: validation.eventCount ?? 0,
    trialCount: validation.trialCount ?? 0,
    includedFiles: RESULT_FILES,
    excludedData: Object.freeze([
      "raw_selected_text",
      "ordinary_chat_content",
      "file_contents",
      "configuration_values",
      "participant_name",
      "participant_email",
      "absolute_paths",
    ]),
    issues: validation.issues,
  });
}

async function resultArchive(root: string): Promise<{ bytes: Buffer; digest: string }> {
  const files: Record<string, string> = Object.create(null) as Record<string, string>;
  let total = 0;
  for (const name of RESULT_FILES) {
    const bytes = await readResultFile(root, name);
    total += bytes.length;
    if (total > MAX_RESULT_TOTAL_BYTES) throw new Error("result archive exceeds total size limit");
    files[name] = bytes.toString("utf8");
  }
  const archive: ResultArchive = { schemaVersion: 2, studyId: STUDY_V2_ID, files };
  const bytes = Buffer.from(JSON.stringify(archive), "utf8");
  return { bytes, digest: createHash("sha256").update(bytes).digest("hex") };
}

export async function encryptStudyV2ResultDirectory(options: {
  resultDirectory: string;
  researcherPublicKeyPem: string;
  outputPath: string;
}): Promise<{ outputPath: string; envelopeSha256: string; plaintextSha256: string }> {
  const validation = await validateStudyV2ResultDirectory(options.resultDirectory);
  if (!validation.valid) throw new Error("study-v2 result directory failed validation");
  const root = await canonicalResultRoot(options.resultDirectory);
  const publicKey = createPublicKey(options.researcherPublicKeyPem);
  if (publicKey.asymmetricKeyType !== "rsa" || (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
    throw new Error("researcher public key must be RSA with at least 2048 bits");
  }
  const { bytes, digest } = await resultArchive(root);
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const envelope: EncryptedStudyV2Envelope = {
    schemaVersion: 1,
    kind: "pointable-context-study-result",
    studyId: STUDY_V2_ID,
    cipher: "AES-256-GCM",
    keyWrap: "RSA-OAEP-SHA256",
    encryptedKey: publicEncrypt({
      key: publicKey,
      oaepHash: "sha256",
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    }, key).toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    plaintextSha256: digest,
  };
  const output = resolve(options.outputPath);
  if (basename(output).length > 180) throw new Error("encrypted result filename is too long");
  await stat(dirname(output));
  const encoded = Buffer.from(`${JSON.stringify(envelope)}\n`, "utf8");
  await writeFile(output, encoded, { flag: "wx", mode: 0o600 });
  return {
    outputPath: output,
    envelopeSha256: createHash("sha256").update(encoded).digest("hex"),
    plaintextSha256: digest,
  };
}

export function decryptStudyV2EnvelopeForResearcher(
  envelopeText: string,
  researcherPrivateKeyPem: string,
): ResultArchive {
  const parsed = object(JSON.parse(envelopeText));
  if (
    parsed === undefined ||
    !exactKeys(parsed, [
      "schemaVersion", "kind", "studyId", "cipher", "keyWrap", "encryptedKey",
      "iv", "authTag", "ciphertext", "plaintextSha256",
    ]) ||
    parsed.schemaVersion !== 1 || parsed.kind !== "pointable-context-study-result" ||
    parsed.studyId !== STUDY_V2_ID || parsed.cipher !== "AES-256-GCM" ||
    parsed.keyWrap !== "RSA-OAEP-SHA256" ||
    typeof parsed.encryptedKey !== "string" || typeof parsed.iv !== "string" ||
    typeof parsed.authTag !== "string" || typeof parsed.ciphertext !== "string" ||
    typeof parsed.plaintextSha256 !== "string" || !DIGEST_PATTERN.test(parsed.plaintextSha256)
  ) {
    throw new Error("encrypted study-v2 envelope is invalid");
  }
  const key = privateDecrypt({
    key: researcherPrivateKeyPem,
    oaepHash: "sha256",
    padding: constants.RSA_PKCS1_OAEP_PADDING,
  }, Buffer.from(parsed.encryptedKey, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, "base64")),
    decipher.final(),
  ]);
  if (createHash("sha256").update(plaintext).digest("hex") !== parsed.plaintextSha256) {
    throw new Error("encrypted study-v2 envelope digest mismatch");
  }
  const archive = object(JSON.parse(plaintext.toString("utf8")));
  if (
    archive === undefined || archive.schemaVersion !== 2 || archive.studyId !== STUDY_V2_ID ||
    object(archive.files) === undefined || !exactKeys(object(archive.files) ?? {}, RESULT_FILES)
  ) {
    throw new Error("decrypted study-v2 archive is invalid");
  }
  return archive as unknown as ResultArchive;
}

export async function writeStudyV2ResultDirectory(options: {
  directory: string;
  manifest: StudyV2SessionManifest;
  events: readonly StudyV2Event[];
  trials: readonly StudyV2TrialResult[];
  questionnaire: StudyV2Questionnaire;
}): Promise<void> {
  const root = resolve(options.directory);
  if (options.trials.length !== 6) throw new Error("study-v2 result requires six trials");
  const files: Record<string, Buffer> = Object.create(null) as Record<string, Buffer>;
  files["manifest.json"] = Buffer.from(`${JSON.stringify(options.manifest, null, 2)}\n`, "utf8");
  files["events.ndjson"] = Buffer.from(`${options.events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  const rows = options.trials.map((trial) => [
    trial.trialId,
    trial.scenarioId,
    trial.condition,
    trial.taskCompletionMs,
    trial.success,
    trial.timedOut,
    trial.aborted,
    trial.timeToFirstCorrectObjectMs ?? "",
    trial.scriptedFollowupRequests,
    trial.navigationCount,
    trial.navigationTimeMs,
    trial.wrongObjectCount,
    trial.cardOpenCount,
    trial.cardDwellMs,
    trial.patchAttemptCount,
    trial.answerCode,
  ].join(","));
  files["trials.csv"] = Buffer.from(`${TRIAL_HEADER}\n${rows.join("\n")}\n`, "utf8");
  files["questionnaire.json"] = Buffer.from(`${JSON.stringify(options.questionnaire, null, 2)}\n`, "utf8");
  const digests: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [name, bytes] of Object.entries(files)) {
    digests[name] = createHash("sha256").update(bytes).digest("hex");
    await writeFile(join(root, name), bytes, { flag: "wx", mode: 0o600 });
  }
  await writeFile(join(root, "integrity.json"), `${JSON.stringify({
    schemaVersion: 1,
    algorithm: "sha256",
    files: digests,
  }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

export const writeStudyV2ResultFixture = writeStudyV2ResultDirectory;

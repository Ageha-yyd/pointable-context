import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const STUDY_ID = "pointable-context-study-v1";
const SCENARIO_IDS = Object.freeze(["DOC-1", "MOD-1", "TST-1", "CFG-1", "ADR-1", "REV-1"]);
const PRESENTATION_CONDITIONS = Object.freeze(["P-A", "P-B", "P-C"]);
const MAX_MATERIAL_BYTES = 512 * 1024;
const MANIFEST_PATH = "docs/evaluation/study-v1/manifest.json";
const ANSWER_KEY_PATH = "docs/evaluation/study-v1/answer-key.json";
const MATERIAL_PATHS = Object.freeze([
  MANIFEST_PATH,
  ANSWER_KEY_PATH,
  "docs/evaluation/study-v1/participant-transcript.md",
  "docs/evaluation/study-v1/presentation-log.template.csv",
  "docs/evaluation/study-v1/efficiency-log.template.csv",
  "docs/evaluation/study-v1/README.md",
  "scripts/prepare-evaluation-workspace.mjs",
  "dist/src/evaluation/study-pack.js",
  "dist/src/evaluation/study-cli.js",
  "fixtures/evaluation-study-v1/baseline/README.md",
  "fixtures/evaluation-study-v1/active/README.md",
  "fixtures/evaluation-study-v1/baseline/src/context-record-index.ts",
  "fixtures/evaluation-study-v1/baseline/src/consumer.ts",
  "fixtures/evaluation-study-v1/baseline/test/context-record-index.test.ts",
  "fixtures/evaluation-study-v1/baseline/package.json",
  "fixtures/evaluation-study-v1/baseline/docs/adr/ADR-001-explicit-refresh.md",
  "fixtures/evaluation-study-v1/baseline/docs/concepts/pilot.md",
  "fixtures/evaluation-study-v1/baseline/docs/evaluation-protocol.md",
  "fixtures/evaluation-study-v1/baseline/docs/study-boundaries.md",
  "fixtures/evaluation-study-v1/revision/src/context-record-index.ts",
]);

export type EfficiencyCondition = "A" | "B";
export type PresentationCondition = "P-A" | "P-B" | "P-C";

export interface EfficiencyAssignment {
  order: number;
  taskId: string;
  condition: EfficiencyCondition;
}

export interface StudyAssignment {
  schemaVersion: 1;
  studyId: string;
  slot: number;
  presentation: { object: "pilot"; condition: PresentationCondition };
  efficiency: readonly EfficiencyAssignment[];
}

export interface StudyPackIssue {
  code: string;
  path?: string;
}

export interface StudyPackValidation {
  schemaVersion: 1;
  studyId: string;
  valid: boolean;
  packDigest?: string;
  issues: readonly StudyPackIssue[];
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
  return [...value];
}

function contained(root: string, target: string): boolean {
  const value = relative(root, target);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

async function readBounded(root: string, path: string): Promise<Buffer> {
  const target = resolve(root, ...path.replace(/\\/gu, "/").split("/"));
  const canonical = await realpath(target);
  if (!contained(root, canonical)) throw new Error("material escapes repository root");
  const info = await stat(canonical);
  if (!info.isFile() || info.size > MAX_MATERIAL_BYTES) throw new Error("material is unavailable or oversized");
  return readFile(canonical);
}

async function json(root: string, path: string): Promise<JsonObject> {
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBounded(root, path)));
  const parsed = object(value);
  if (parsed === undefined) throw new Error("JSON root must be an object");
  return parsed;
}

export function assignmentForSlot(slot: number): StudyAssignment {
  if (!Number.isSafeInteger(slot) || slot < 1 || slot > 12) {
    throw new RangeError("study slot must be an integer from 1 through 12");
  }
  const zero = slot - 1;
  const row = zero % SCENARIO_IDS.length;
  const phase = Math.floor(zero / SCENARIO_IDS.length);
  const efficiency = SCENARIO_IDS.map((_, position): EfficiencyAssignment => ({
    order: position + 1,
    taskId: SCENARIO_IDS[(row + position) % SCENARIO_IDS.length] ?? "",
    condition: (position + phase) % 2 === 0 ? "A" : "B",
  }));
  return Object.freeze({
    schemaVersion: 1 as const,
    studyId: STUDY_ID,
    slot,
    presentation: Object.freeze({
      object: "pilot" as const,
      condition: PRESENTATION_CONDITIONS[zero % PRESENTATION_CONDITIONS.length] as PresentationCondition,
    }),
    efficiency: Object.freeze(efficiency.map((item) => Object.freeze(item))),
  });
}

function validateSchedule(issues: StudyPackIssue[]): void {
  const presentation = new Map(PRESENTATION_CONDITIONS.map((condition) => [condition, 0]));
  const byScenario = new Map(SCENARIO_IDS.map((scenario) => [scenario, { A: 0, B: 0 }]));
  const byPosition = new Map(SCENARIO_IDS.map((scenario) => [scenario, Array(6).fill(0) as number[]]));
  for (let slot = 1; slot <= 12; slot += 1) {
    const assignment = assignmentForSlot(slot);
    presentation.set(
      assignment.presentation.condition,
      (presentation.get(assignment.presentation.condition) ?? 0) + 1,
    );
    const seen = new Set<string>();
    for (const item of assignment.efficiency) {
      if (seen.has(item.taskId)) issues.push({ code: "assignment_duplicate_task" });
      seen.add(item.taskId);
      const counts = byScenario.get(item.taskId);
      if (counts === undefined) {
        issues.push({ code: "assignment_unknown_task" });
        continue;
      }
      counts[item.condition] += 1;
      const positions = byPosition.get(item.taskId);
      if (positions !== undefined) positions[item.order - 1] = (positions[item.order - 1] ?? 0) + 1;
    }
  }
  if ([...presentation.values()].some((count) => count !== 4)) {
    issues.push({ code: "presentation_assignment_unbalanced" });
  }
  for (const scenario of SCENARIO_IDS) {
    const counts = byScenario.get(scenario);
    if (counts?.A !== 6 || counts.B !== 6) issues.push({ code: "condition_assignment_unbalanced" });
    if (byPosition.get(scenario)?.some((count) => count !== 2)) {
      issues.push({ code: "order_assignment_unbalanced" });
    }
  }
}

function validateManifest(manifest: JsonObject, issues: StudyPackIssue[]): void {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.studyId !== STUDY_ID ||
    manifest.status !== "frozen_materials_not_run" ||
    typeof manifest.claimBoundary !== "string" ||
    !manifest.claimBoundary.includes("cannot establish")
  ) {
    issues.push({ code: "manifest_identity_invalid", path: MANIFEST_PATH });
  }
  const presentation = object(manifest.presentationPilot);
  const efficiency = object(manifest.efficiencyPilot);
  const privacy = object(manifest.privacy);
  const presentationConditions = Array.isArray(presentation?.conditions)
    ? presentation.conditions.map((value) => object(value)?.id)
    : [];
  const scenarios = Array.isArray(efficiency?.scenarios)
    ? efficiency.scenarios.map((value) => object(value)?.id)
    : [];
  const efficiencyConditions = Array.isArray(efficiency?.conditions)
    ? efficiency.conditions.map((value) => {
      const parsed = object(value);
      return [parsed?.id, parsed?.quietReveal];
    })
    : [];
  if (
    presentation?.participantSlots !== 12 ||
    JSON.stringify(presentationConditions) !== JSON.stringify(PRESENTATION_CONDITIONS)
  ) {
    issues.push({ code: "presentation_manifest_invalid", path: MANIFEST_PATH });
  }
  if (
    efficiency?.participantSlots !== 12 ||
    efficiency.taskTimeoutMs !== 300000 ||
    JSON.stringify(scenarios) !== JSON.stringify(SCENARIO_IDS) ||
    JSON.stringify(efficiencyConditions) !== JSON.stringify([["A", false], ["B", true]])
  ) {
    issues.push({ code: "efficiency_manifest_invalid", path: MANIFEST_PATH });
  }
  const forbidden = strings(privacy?.forbiddenLogFields) ?? [];
  for (const field of [
    "raw_selected_text", "file_contents", "configuration_values", "ordinary_chat_content",
    "participant_name", "participant_email",
  ]) {
    if (!forbidden.includes(field)) issues.push({ code: "privacy_contract_incomplete" });
  }
}

function evidencePath(root: string, evidence: JsonObject): string | undefined {
  const path = typeof evidence.path === "string" ? evidence.path : undefined;
  if (path === undefined) return undefined;
  switch (evidence.phase) {
    case "repository": return resolve(root, ...path.split("/"));
    case "baseline": return resolve(root, "fixtures", "evaluation-study-v1", "baseline", ...path.split("/"));
    case "active": return resolve(root, "fixtures", "evaluation-study-v1", "active", ...path.split("/"));
    case "revision": return resolve(root, "fixtures", "evaluation-study-v1", "revision", ...path.split("/"));
    default: return undefined;
  }
}

async function validateEvidence(
  root: string,
  evidence: JsonObject,
  issues: StudyPackIssue[],
): Promise<void> {
  const target = evidencePath(root, evidence);
  const line = evidence.line;
  const excerpt = evidence.excerpt;
  if (
    target === undefined ||
    !Number.isSafeInteger(line) ||
    (line as number) < 1 ||
    typeof excerpt !== "string" ||
    excerpt.length === 0 ||
    !contained(root, target)
  ) {
    issues.push({ code: "answer_evidence_invalid" });
    return;
  }
  try {
    const canonical = await realpath(target);
    const info = await stat(canonical);
    if (!contained(root, canonical) || !info.isFile() || info.size > MAX_MATERIAL_BYTES) {
      issues.push({ code: "answer_evidence_unavailable", path: relative(root, target) });
      return;
    }
    const content = await readFile(canonical, "utf8");
    const actual = content.replace(/\r\n?/gu, "\n").split("\n")[(line as number) - 1];
    if (actual !== excerpt) issues.push({ code: "answer_evidence_drift", path: relative(root, target) });
  } catch {
    issues.push({ code: "answer_evidence_unavailable", path: relative(root, target) });
  }
}

async function validateAnswerKey(
  root: string,
  answerKey: JsonObject,
  issues: StudyPackIssue[],
): Promise<void> {
  if (answerKey.schemaVersion !== 1 || answerKey.studyId !== STUDY_ID) {
    issues.push({ code: "answer_key_identity_invalid", path: ANSWER_KEY_PATH });
    return;
  }
  const presentation = object(answerKey.presentation);
  const efficiency = object(answerKey.efficiency);
  const presentationUnits = Array.isArray(presentation?.units) ? presentation.units : [];
  const efficiencyTasks = Array.isArray(efficiency?.tasks) ? efficiency.tasks : [];
  if (presentationUnits.length !== 4) issues.push({ code: "presentation_answer_units_invalid" });
  const taskIds = efficiencyTasks.map((value) => object(value)?.id);
  if (JSON.stringify(taskIds) !== JSON.stringify(SCENARIO_IDS)) {
    issues.push({ code: "efficiency_answer_tasks_invalid" });
  }
  const allTasks = [...presentationUnits, ...efficiencyTasks.flatMap((task) => {
    const units = object(task)?.units;
    return Array.isArray(units) ? units : [];
  })];
  for (const unit of allTasks) {
    const parsed = object(unit);
    if (
      typeof parsed?.id !== "string" ||
      typeof parsed.criterion !== "string" ||
      parsed.criterion.length === 0 ||
      (object(parsed.evidence) === undefined && !Array.isArray(parsed.evidence))
    ) {
      issues.push({ code: "answer_unit_invalid" });
      continue;
    }
    const evidence = Array.isArray(parsed.evidence) ? parsed.evidence : [parsed.evidence];
    if (evidence.length < 1 || evidence.length > 6) {
      issues.push({ code: "answer_evidence_count_invalid" });
      continue;
    }
    for (const value of evidence) {
      const parsedEvidence = object(value);
      if (parsedEvidence === undefined) {
        issues.push({ code: "answer_evidence_invalid" });
        continue;
      }
      await validateEvidence(root, parsedEvidence, issues);
    }
  }
}

async function validateLogTemplate(
  root: string,
  path: string,
  required: readonly string[],
  forbidden: readonly string[],
  issues: StudyPackIssue[],
): Promise<void> {
  try {
    const header = (await readBounded(root, path)).toString("utf8").trim();
    const fields = header.split(",");
    if (required.some((field) => !fields.includes(field))) {
      issues.push({ code: "log_template_incomplete", path });
    }
    if (forbidden.some((field) => fields.includes(field))) {
      issues.push({ code: "log_template_privacy_violation", path });
    }
  } catch {
    issues.push({ code: "log_template_unavailable", path });
  }
}

async function packDigest(root: string): Promise<string> {
  const hash = createHash("sha256");
  for (const path of MATERIAL_PATHS) {
    hash.update(path, "utf8");
    hash.update("\u0000", "utf8");
    hash.update(await readBounded(root, path));
    hash.update("\n", "utf8");
  }
  return hash.digest("hex");
}

export async function validateStudyPack(repositoryRoot: string): Promise<StudyPackValidation> {
  const issues: StudyPackIssue[] = [];
  let root: string;
  try {
    root = await realpath(resolve(repositoryRoot));
    if (!(await stat(root)).isDirectory()) throw new Error("not a directory");
  } catch {
    return Object.freeze({
      schemaVersion: 1 as const,
      studyId: STUDY_ID,
      valid: false,
      issues: Object.freeze([{ code: "repository_unavailable" }]),
    });
  }
  try {
    const [manifest, answerKey] = await Promise.all([
      json(root, MANIFEST_PATH),
      json(root, ANSWER_KEY_PATH),
    ]);
    validateManifest(manifest, issues);
    await validateAnswerKey(root, answerKey, issues);
    validateSchedule(issues);
    const forbidden = strings(object(manifest.privacy)?.forbiddenLogFields) ?? [];
    await Promise.all([
      validateLogTemplate(root, MATERIAL_PATHS[3] ?? "", [
        "participant_id", "slot", "pack_digest", "condition", "time_to_verified_fact_ms", "aborted",
        "timed_out", "error_code",
      ], forbidden, issues),
      validateLogTemplate(root, MATERIAL_PATHS[4] ?? "", [
        "participant_id", "slot", "pack_digest", "task_order", "task_id", "condition",
        "time_to_verified_fact_ms", "answer_accuracy", "chat_turns", "lane_leave",
        "wrong_entity", "card_sufficient", "aborted", "timed_out", "error_code",
      ], forbidden, issues),
    ]);
    const digest = await packDigest(root);
    return Object.freeze({
      schemaVersion: 1 as const,
      studyId: STUDY_ID,
      valid: issues.length === 0,
      packDigest: digest,
      issues: Object.freeze(issues),
    });
  } catch {
    issues.push({ code: "study_material_unavailable" });
    return Object.freeze({
      schemaVersion: 1 as const,
      studyId: STUDY_ID,
      valid: false,
      issues: Object.freeze(issues),
    });
  }
}

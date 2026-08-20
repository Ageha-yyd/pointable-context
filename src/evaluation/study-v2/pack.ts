import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  STUDY_V2_ID,
  STUDY_V2_SCENARIOS,
  validateStudyV2Schedule,
} from "./contracts.js";
import { STUDY_V2_LANGUAGES, type StudyV2Language } from "./language.js";
import {
  parseStudyV2FrozenConversation,
  parseStudyV2ScenarioEntities,
  parseStudyV2Transcript,
  validateStudyV2ScenarioConsistency,
} from "./scenario-material.js";
import { STUDY_V2_SCORING_CONTRACT } from "./trial-metrics.js";

const MANIFEST_PATH = "docs/evaluation/study-v2/manifest.json";
const MAX_MATERIAL_BYTES = 1024 * 1024;
const MAX_MATERIALS = 128;

type JsonObject = Record<string, unknown>;

function localizedPaths(base: string, language: StudyV2Language): {
  transcriptPath: string;
  conversationPath: string;
  entitiesPath: string;
  workspacePath: string;
} {
  const suffix = language === "en-US" ? "" : ".zh-CN";
  return {
    transcriptPath: `${base}/transcript${suffix}.md`,
    conversationPath: `${base}/conversation${suffix}.json`,
    entitiesPath: `${base}/entities${suffix}.json`,
    workspacePath: `${base}/workspace${suffix}`,
  };
}

export interface StudyV2PackIssue {
  code: string;
  path?: string;
}

export interface StudyV2PackValidation {
  schemaVersion: 2;
  studyId: typeof STUDY_V2_ID;
  valid: boolean;
  packDigest?: string;
  issues: readonly StudyV2PackIssue[];
}

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function contained(root: string, target: string): boolean {
  const value = relative(root, target);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

async function readBounded(root: string, path: string): Promise<Buffer> {
  if (
    path.length < 1 ||
    path.length > 240 ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("invalid study-v2 material path");
  }
  const target = resolve(root, ...path.split("/"));
  const canonical = await realpath(target);
  if (!contained(root, canonical)) throw new Error("study-v2 material escapes repository root");
  const info = await stat(canonical);
  if (!info.isFile() || info.size > MAX_MATERIAL_BYTES) {
    throw new Error("study-v2 material is unavailable or oversized");
  }
  return readFile(canonical);
}

function validateManifest(manifest: JsonObject, issues: StudyV2PackIssue[]): string[] {
  if (
    manifest.schemaVersion !== 2 ||
    manifest.studyId !== STUDY_V2_ID ||
    manifest.status !== "pilot_candidate_materials_not_run" ||
    manifest.liveModelDuringTrials !== false ||
    manifest.presentationModel !== "P-C" ||
    manifest.participantSlots !== 12 ||
    manifest.trainingScenarioId !== "TRAIN-1" ||
    JSON.stringify(manifest.languages) !== JSON.stringify(STUDY_V2_LANGUAGES) ||
    manifest.defaultLanguage !== "zh-CN"
  ) {
    issues.push({ code: "manifest_identity_invalid", path: MANIFEST_PATH });
  }
  const conditionObjects = Array.isArray(manifest.conditions) ? manifest.conditions.map(object) : [];
  const conditionIds = conditionObjects.map((condition) => condition?.id);
  if (JSON.stringify(conditionIds) !== JSON.stringify(["A", "B"])) {
    issues.push({ code: "manifest_conditions_invalid", path: MANIFEST_PATH });
  }
  if (
    conditionObjects[0]?.quietContextReveal !== false ||
    conditionObjects[1]?.quietContextReveal !== true ||
    conditionObjects.some((condition) => condition?.liveModel !== false)
  ) {
    issues.push({ code: "manifest_condition_contract_invalid", path: MANIFEST_PATH });
  }
  const scenarios = Array.isArray(manifest.scenarios) ? manifest.scenarios.map(object) : [];
  if (JSON.stringify(scenarios.map((scenario) => scenario?.id)) !== JSON.stringify(STUDY_V2_SCENARIOS)) {
    issues.push({ code: "manifest_scenarios_invalid", path: MANIFEST_PATH });
  }
  const training = object(manifest.training);
  const trainingLocalizations = object(training?.localizations);
  if (training?.id !== "TRAIN-1" || STUDY_V2_LANGUAGES.some((language) => {
    const localized = object(trainingLocalizations?.[language]);
    const expected = localizedPaths("fixtures/evaluation-study-v2/TRAIN-1", language);
    return localized === undefined || localized.transcriptPath !== expected.transcriptPath ||
      localized.conversationPath !== expected.conversationPath ||
      localized.entitiesPath !== expected.entitiesPath || localized.workspacePath !== expected.workspacePath ||
      typeof localized.taskPrompt !== "string" || localized.taskPrompt.length < 20;
  })) {
    issues.push({ code: "manifest_training_contract_invalid", path: MANIFEST_PATH });
  }
  for (const [index, scenario] of scenarios.entries()) {
    const scenarioId = STUDY_V2_SCENARIOS[index];
    const base = `fixtures/evaluation-study-v2/${scenarioId}`;
    const localizations = object(scenario?.localizations);
    if (typeof scenario?.projectId !== "string" || STUDY_V2_LANGUAGES.some((language) => {
      const localized = object(localizations?.[language]);
      const expected = localizedPaths(base, language);
      return localized === undefined || localized.transcriptPath !== expected.transcriptPath ||
        localized.conversationPath !== expected.conversationPath ||
        localized.entitiesPath !== expected.entitiesPath || localized.workspacePath !== expected.workspacePath ||
        typeof localized.taskPrompt !== "string" || localized.taskPrompt.length < 20;
    })) {
      issues.push({ code: "manifest_scenario_contract_invalid", path: MANIFEST_PATH });
    }
  }
  const privacy = object(manifest.privacy);
  const forbidden = Array.isArray(privacy?.forbiddenFields) ? privacy.forbiddenFields : [];
  for (const field of [
    "raw_selected_text",
    "ordinary_chat_content",
    "file_contents",
    "configuration_values",
    "participant_name",
    "participant_email",
  ]) {
    if (!forbidden.includes(field)) issues.push({ code: "manifest_privacy_contract_incomplete" });
  }
  const materials = Array.isArray(manifest.materials) && manifest.materials.every((item) => typeof item === "string")
    ? manifest.materials as string[]
    : [];
  if (
    materials.length < 10 ||
    materials.length > MAX_MATERIALS ||
    new Set(materials).size !== materials.length ||
    materials.includes(MANIFEST_PATH)
  ) {
    issues.push({ code: "manifest_materials_invalid", path: MANIFEST_PATH });
  }
  for (const scenarioId of ["TRAIN-1", ...STUDY_V2_SCENARIOS]) {
    const base = `fixtures/evaluation-study-v2/${scenarioId}`;
    for (const language of STUDY_V2_LANGUAGES) {
      const paths = localizedPaths(base, language);
      for (const path of [
        paths.transcriptPath,
        paths.conversationPath,
        paths.entitiesPath,
        `${paths.workspacePath}/PROJECT_STATE.md`,
      ]) {
        if (!materials.includes(path)) {
          issues.push({ code: "manifest_scenario_material_missing", path });
        }
      }
    }
  }
  return materials;
}

function decoded(buffer: Buffer): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
}

function canonicalDigestText(buffer: Buffer): string {
  return decoded(buffer).replace(/\r\n?/gu, "\n");
}

async function validateScenarioMaterials(
  root: string,
  issues: StudyV2PackIssue[],
): Promise<void> {
  for (const scenarioId of ["TRAIN-1", ...STUDY_V2_SCENARIOS] as const) {
    const base = `fixtures/evaluation-study-v2/${scenarioId}`;
    for (const language of STUDY_V2_LANGUAGES) {
      const paths = localizedPaths(base, language);
      try {
        const transcript = parseStudyV2Transcript(decoded(await readBounded(root, paths.transcriptPath)));
        const conversation = parseStudyV2FrozenConversation(
          JSON.parse(decoded(await readBounded(root, paths.conversationPath))) as unknown,
          scenarioId,
        );
        const entities = parseStudyV2ScenarioEntities(
          JSON.parse(decoded(await readBounded(root, paths.entitiesPath))) as unknown,
        );
        const scoring = scenarioId === "TRAIN-1"
          ? { correctAnswerCode: "TRAIN-A", correctObjectCode: "CONCEPT:ORIENTATION-GATE" }
          : STUDY_V2_SCORING_CONTRACT[scenarioId];
        validateStudyV2ScenarioConsistency({
          scenarioId,
          transcript,
          conversation,
          entities,
          correctAnswerCode: scoring.correctAnswerCode,
          correctObjectCode: scoring.correctObjectCode,
        });
      } catch (error) {
        issues.push({
          code: error instanceof Error && /^study_v2_[a-z0-9_]+$/u.test(error.message)
            ? error.message
            : "study_v2_scenario_material_invalid",
          path: `${base}:${language}`,
        });
      }
    }
  }
}

async function calculateDigest(root: string, paths: readonly string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const path of [MANIFEST_PATH, ...paths].sort()) {
    hash.update(path, "utf8");
    hash.update("\0", "utf8");
    hash.update(canonicalDigestText(await readBounded(root, path)), "utf8");
    hash.update("\n", "utf8");
  }
  return hash.digest("hex");
}

export async function validateStudyV2Pack(repositoryRoot: string): Promise<StudyV2PackValidation> {
  const issues: StudyV2PackIssue[] = [];
  let root: string;
  try {
    root = await realpath(resolve(repositoryRoot));
    if (!(await stat(root)).isDirectory()) throw new Error("not a directory");
  } catch {
    return Object.freeze({
      schemaVersion: 2 as const,
      studyId: STUDY_V2_ID,
      valid: false,
      issues: Object.freeze([{ code: "repository_unavailable" }]),
    });
  }
  try {
    const manifestValue: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(await readBounded(root, MANIFEST_PATH)),
    );
    const manifest = object(manifestValue);
    if (manifest === undefined) throw new Error("manifest root is not an object");
    const materials = validateManifest(manifest, issues);
    for (const code of validateStudyV2Schedule()) issues.push({ code });
    for (const path of materials) {
      try {
        await readBounded(root, path);
      } catch {
        issues.push({ code: "study_material_unavailable", path });
      }
    }
    await validateScenarioMaterials(root, issues);
    const packDigest = issues.length === 0 ? await calculateDigest(root, materials) : undefined;
    return Object.freeze({
      schemaVersion: 2 as const,
      studyId: STUDY_V2_ID,
      valid: issues.length === 0,
      ...(packDigest === undefined ? {} : { packDigest }),
      issues: Object.freeze(issues),
    });
  } catch {
    issues.push({ code: "study_material_unavailable", path: MANIFEST_PATH });
    return Object.freeze({
      schemaVersion: 2 as const,
      studyId: STUDY_V2_ID,
      valid: false,
      issues: Object.freeze(issues),
    });
  }
}

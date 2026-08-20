import { readFile, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { StudyV2TrialAssignment } from "./contracts.js";
import { parseStudyV2Language, type StudyV2Language } from "./language.js";
import {
  parseStudyV2FrozenConversation,
  parseStudyV2ScenarioEntities,
  parseStudyV2Transcript,
  validateStudyV2ScenarioConsistency,
  type StudyV2FrozenConversation,
  type StudyV2ScenarioEntity,
} from "./scenario-material.js";
import { STUDY_V2_SCORING_CONTRACT } from "./trial-metrics.js";
import type {
  StudyV2NativeAnswer,
  StudyV2NativeEntityTerm,
} from "./native-trial-protocol.js";

export type { StudyV2ScenarioEntity } from "./scenario-material.js";

export interface StudyV2NativeTrialMaterial {
  assignment: StudyV2TrialAssignment;
  language: StudyV2Language;
  workspaceRoot: string;
  history: string;
  conversation: StudyV2FrozenConversation;
  taskPrompt: string;
  answers: readonly StudyV2NativeAnswer[];
  entityTerms: readonly StudyV2NativeEntityTerm[];
  entities: readonly StudyV2ScenarioEntity[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function printable(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" &&
    value.length >= minimum && value.length <= maximum &&
    !/[\p{Cc}\p{Cf}]/u.test(value);
}

function inside(root: string, candidate: string): boolean {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate === root || candidate.startsWith(prefix);
}

export async function loadStudyV2NativeTrialMaterial(
  repositoryRoot: string,
  assignment: StudyV2TrialAssignment,
  requestedLanguage: StudyV2Language = "en-US",
): Promise<StudyV2NativeTrialMaterial> {
  const language = parseStudyV2Language(requestedLanguage);
  const root = await realpath(resolve(repositoryRoot));
  const scenarioRoot = resolve(root, "fixtures", "evaluation-study-v2", assignment.scenarioId);
  if (!inside(root, scenarioRoot)) throw new Error("study_v2_scenario_path_invalid");
  const manifestRaw = JSON.parse(await readFile(join(root, "docs", "evaluation", "study-v2", "manifest.json"), "utf8")) as unknown;
  if (!record(manifestRaw) || !Array.isArray(manifestRaw.scenarios)) {
    throw new Error("study_v2_manifest_invalid");
  }
  const scenario = manifestRaw.scenarios.find((entry) => record(entry) && entry.id === assignment.scenarioId);
  const expectedBase = `fixtures/evaluation-study-v2/${assignment.scenarioId}`;
  const scenarioRecord = record(scenario) ? scenario : undefined;
  const localizations = scenarioRecord !== undefined && record(scenarioRecord.localizations)
    ? scenarioRecord.localizations
    : undefined;
  const localized = localizations !== undefined && record(localizations[language])
    ? localizations[language]
    : undefined;
  const suffix = language === "en-US" ? "" : ".zh-CN";
  if (scenarioRecord === undefined || localized === undefined || !printable(localized.taskPrompt, 1, 2_048) ||
    localized.transcriptPath !== `${expectedBase}/transcript${suffix}.md` ||
    localized.conversationPath !== `${expectedBase}/conversation${suffix}.json` ||
    localized.entitiesPath !== `${expectedBase}/entities${suffix}.json` ||
    localized.workspacePath !== `${expectedBase}/workspace${suffix}`) {
    throw new Error("study_v2_manifest_invalid");
  }
  const workspaceRoot = await realpath(join(scenarioRoot, `workspace${suffix}`));
  if (!inside(root, workspaceRoot)) throw new Error("study_v2_scenario_path_invalid");
  const transcript = parseStudyV2Transcript(await readFile(join(scenarioRoot, `transcript${suffix}.md`), "utf8"));
  const conversation = parseStudyV2FrozenConversation(
    JSON.parse(await readFile(join(scenarioRoot, `conversation${suffix}.json`), "utf8")) as unknown,
    assignment.scenarioId,
  );
  const entities = parseStudyV2ScenarioEntities(
    JSON.parse(await readFile(join(scenarioRoot, `entities${suffix}.json`), "utf8")) as unknown,
  );
  const scoring = STUDY_V2_SCORING_CONTRACT[assignment.scenarioId];
  validateStudyV2ScenarioConsistency({
    scenarioId: assignment.scenarioId,
    transcript,
    conversation,
    entities,
    correctAnswerCode: scoring.correctAnswerCode,
    correctObjectCode: scoring.correctObjectCode,
  });
  const entityTerms: StudyV2NativeEntityTerm[] = [];
  for (const entity of entities) {
    entityTerms.push({ term: entity.label, objectCode: entity.id });
    entityTerms.push({ term: entity.id, objectCode: entity.id });
  }
  return Object.freeze({
    assignment: Object.freeze({ ...assignment }),
    language,
    workspaceRoot,
    history: transcript.history,
    conversation,
    taskPrompt: localized.taskPrompt,
    answers: transcript.answers,
    entityTerms: Object.freeze(entityTerms.map((term) => Object.freeze(term))),
    entities,
  });
}

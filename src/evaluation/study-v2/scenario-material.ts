import type { StudyV2ScriptedExchange } from "./native-scripted-task.js";
import type { StudyV2NativeAnswer } from "./native-trial-protocol.js";

const MAX_TRANSCRIPT_CHARS = 24_000;
const MAX_EXCHANGES = 8;
const MAX_MESSAGE_CHARS = 8_000;
const MAX_ENTITY_REFERENCES = 16;

export interface StudyV2ScenarioEntity {
  id: string;
  label: string;
  type: string;
  meaning: string;
  whyNow: string;
  flow: readonly string[];
  boundary: string;
  evidence: string;
}

export interface StudyV2FrozenConversation {
  schemaVersion: 1;
  scenarioId: string;
  exchanges: readonly Readonly<StudyV2ScriptedExchange>[];
  referencedEntityIds: readonly string[];
}

export interface StudyV2ParsedTranscript {
  history: string;
  answers: readonly StudyV2NativeAnswer[];
}

export interface StudyV2ScenarioConsistencyOptions {
  scenarioId: string;
  transcript: StudyV2ParsedTranscript;
  conversation: StudyV2FrozenConversation;
  entities: readonly StudyV2ScenarioEntity[];
  correctAnswerCode: string;
  correctObjectCode: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return JSON.stringify(actual) === JSON.stringify([...expected].sort());
}

function printable(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" &&
    value.length >= minimum && value.length <= maximum &&
    !/[\p{Cc}\p{Cf}]/u.test(value);
}

function identifier(value: unknown): value is string {
  return printable(value, 3, 128) && /^[A-Za-z0-9:_-]+$/u.test(value);
}

export function parseStudyV2ScenarioEntities(value: unknown): readonly StudyV2ScenarioEntity[] {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "entities"]) ||
    value.schemaVersion !== 1 || !Array.isArray(value.entities) ||
    value.entities.length < 1 || value.entities.length > MAX_ENTITY_REFERENCES) {
    throw new Error("study_v2_entities_invalid");
  }
  const identities = new Set<string>();
  return Object.freeze(value.entities.map((raw): StudyV2ScenarioEntity => {
    if (
      !record(raw) ||
      !exactKeys(raw, ["id", "label", "type", "meaning", "whyNow", "flow", "boundary", "evidence"]) ||
      !identifier(raw.id) ||
      !printable(raw.label, 2, 256) ||
      !printable(raw.type, 2, 64) ||
      !printable(raw.meaning, 1, 1_024) ||
      !printable(raw.whyNow, 1, 1_024) ||
      !Array.isArray(raw.flow) ||
      raw.flow.length < 2 ||
      raw.flow.length > 8 ||
      raw.flow.some((step) => !printable(step, 1, 256)) ||
      !printable(raw.boundary, 1, 1_024) ||
      !printable(raw.evidence, 3, 512) ||
      identities.has(raw.id)
    ) {
      throw new Error("study_v2_entities_invalid");
    }
    identities.add(raw.id);
    return Object.freeze({
      id: raw.id,
      label: raw.label,
      type: raw.type,
      meaning: raw.meaning,
      whyNow: raw.whyNow,
      flow: Object.freeze([...(raw.flow as string[])]),
      boundary: raw.boundary,
      evidence: raw.evidence,
    });
  }));
}

export function parseStudyV2FrozenConversation(
  value: unknown,
  expectedScenarioId: string,
): StudyV2FrozenConversation {
  if (
    !record(value) ||
    !exactKeys(value, ["schemaVersion", "scenarioId", "exchanges", "referencedEntityIds"]) ||
    value.schemaVersion !== 1 ||
    value.scenarioId !== expectedScenarioId ||
    !Array.isArray(value.exchanges) ||
    value.exchanges.length < 2 ||
    value.exchanges.length > MAX_EXCHANGES ||
    !Array.isArray(value.referencedEntityIds) ||
    value.referencedEntityIds.length < 1 ||
    value.referencedEntityIds.length > MAX_ENTITY_REFERENCES
  ) {
    throw new Error("study_v2_conversation_invalid");
  }
  const exchanges = value.exchanges.map((raw): Readonly<StudyV2ScriptedExchange> => {
    if (!record(raw) || !exactKeys(raw, ["user", "assistant"]) ||
      !printable(raw.user, 1, MAX_MESSAGE_CHARS) ||
      !printable(raw.assistant, 1, MAX_MESSAGE_CHARS)) {
      throw new Error("study_v2_conversation_invalid");
    }
    return Object.freeze({ user: raw.user, assistant: raw.assistant });
  });
  const references = value.referencedEntityIds;
  if (references.some((item) => !identifier(item)) || new Set(references).size !== references.length) {
    throw new Error("study_v2_conversation_invalid");
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    scenarioId: expectedScenarioId,
    exchanges: Object.freeze(exchanges),
    referencedEntityIds: Object.freeze([...(references as string[])]),
  });
}

export function parseStudyV2Transcript(transcript: string): StudyV2ParsedTranscript {
  if (transcript.length < 1 || transcript.length > MAX_TRANSCRIPT_CHARS) {
    throw new Error("study_v2_transcript_invalid");
  }
  const taskMarkers = [transcript.indexOf("\nTask:"), transcript.indexOf("\n任务：")]
    .filter((index) => index >= 1);
  const taskMarker = Math.min(...taskMarkers);
  if (!Number.isFinite(taskMarker)) throw new Error("study_v2_transcript_invalid");
  const history = transcript.slice(0, taskMarker).trim();
  const answerPattern = /^-\s+`?([A-Z0-9]+-[A-Z])`?:\s+(.+)$/gmu;
  const answers: StudyV2NativeAnswer[] = [];
  for (const match of transcript.matchAll(answerPattern)) {
    const code = match[1];
    const label = match[2]?.trim();
    if (code === undefined || label === undefined || !printable(label, 1, 1_024)) continue;
    answers.push(Object.freeze({ code, label }));
  }
  if (answers.length < 2 || answers.length > 5 ||
    new Set(answers.map((answer) => answer.code)).size !== answers.length) {
    throw new Error("study_v2_transcript_invalid");
  }
  return Object.freeze({ history, answers: Object.freeze(answers) });
}

export function validateStudyV2ScenarioConsistency(
  options: StudyV2ScenarioConsistencyOptions,
): void {
  if (options.conversation.scenarioId !== options.scenarioId) {
    throw new Error("study_v2_scenario_identity_mismatch");
  }
  const answers = new Set(options.transcript.answers.map((answer) => answer.code));
  if (!answers.has(options.correctAnswerCode)) {
    throw new Error("study_v2_answer_key_mismatch");
  }
  const entities = new Map(options.entities.map((entity) => [entity.id, entity]));
  if (!entities.has(options.correctObjectCode)) {
    throw new Error("study_v2_answer_object_mismatch");
  }
  const references = new Set(options.conversation.referencedEntityIds);
  if (!references.has(options.correctObjectCode) || references.size !== entities.size ||
    [...entities.keys()].some((id) => !references.has(id))) {
    throw new Error("study_v2_conversation_entity_mismatch");
  }
  const assistantText = options.conversation.exchanges.map((exchange) => exchange.assistant).join("\n");
  for (const entityId of references) {
    const entity = entities.get(entityId);
    if (entity === undefined ||
      (!assistantText.includes(entity.id) && !assistantText.includes(entity.label))) {
      throw new Error("study_v2_conversation_term_missing");
    }
  }
}

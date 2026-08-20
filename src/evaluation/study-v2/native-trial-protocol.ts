import type {
  StudyV2Condition,
  StudyV2EventType,
  StudyV2ScenarioId,
} from "./contracts.js";
import { isStudyV2Language, type StudyV2Language } from "./language.js";

export const STUDY_V2_NATIVE_EVENT_KIND = "pointable.study-v2.native-event" as const;
export const MAX_STUDY_V2_NATIVE_PAYLOAD_CHARS = 2_048;

export interface StudyV2NativeAnswer {
  code: string;
  label: string;
}

export interface StudyV2NativeEntityTerm {
  term: string;
  objectCode: string;
}

export interface StudyV2NativeTrialSurfaceConfig {
  bindingName: string;
  trialToken: string;
  trialId: string;
  scenarioId: StudyV2ScenarioId;
  condition: StudyV2Condition;
  language: StudyV2Language;
  history: string;
  taskPrompt: string;
  answers: readonly StudyV2NativeAnswer[];
  entityTerms: readonly StudyV2NativeEntityTerm[];
  timeoutMs: number;
}

export interface StudyV2NativeEvent {
  schemaVersion: 2;
  kind: typeof STUDY_V2_NATIVE_EVENT_KIND;
  trialToken: string;
  sequence: number;
  eventType: StudyV2EventType;
  monotonicMs: number;
  objectCode?: string;
  outcomeCode?: string;
}

export class StudyV2NativeProtocolError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "StudyV2NativeProtocolError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function printable(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    !/[\p{Cc}\p{Cf}]/u.test(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const accepted = new Set(allowed);
  return Object.keys(value).every((key) => accepted.has(key));
}

const NATIVE_EVENT_TYPES = new Set<StudyV2EventType>([
  "trial_shown",
  "selection_completed",
  "quick_action_shown",
  "card_opened",
  "card_closed",
  "card_refreshed",
  "evidence_expanded",
  "workspace_left",
  "workspace_returned",
  "object_opened",
  "scripted_followup_requested",
  "answer_submitted",
  "trial_timed_out",
  "trial_aborted",
]);

export function validateStudyV2NativeSurfaceConfig(
  value: StudyV2NativeTrialSurfaceConfig,
): StudyV2NativeTrialSurfaceConfig {
  if (!/^__pointableStudyBinding_[A-Za-z0-9_]{16,128}$/u.test(value.bindingName)) {
    throw new StudyV2NativeProtocolError("native_binding_invalid");
  }
  if (!/^[a-f0-9]{64}$/u.test(value.trialToken)) {
    throw new StudyV2NativeProtocolError("native_trial_token_invalid");
  }
  if (!printable(value.trialId, 4, 64) || !/^[A-Za-z0-9_-]+$/u.test(value.trialId)) {
    throw new StudyV2NativeProtocolError("native_trial_id_invalid");
  }
  if (!printable(value.scenarioId, 4, 32) || (value.condition !== "A" && value.condition !== "B")) {
    throw new StudyV2NativeProtocolError("native_trial_assignment_invalid");
  }
  if (!isStudyV2Language(value.language)) {
    throw new StudyV2NativeProtocolError("native_trial_language_invalid");
  }
  if (typeof value.history !== "string" || value.history.length < 1 || value.history.length > 24_000) {
    throw new StudyV2NativeProtocolError("native_trial_history_invalid");
  }
  if (!printable(value.taskPrompt, 1, 2_048)) {
    throw new StudyV2NativeProtocolError("native_trial_prompt_invalid");
  }
  if (value.answers.length < 2 || value.answers.length > 5) {
    throw new StudyV2NativeProtocolError("native_trial_answers_invalid");
  }
  const answerCodes = new Set<string>();
  for (const answer of value.answers) {
    if (
      !printable(answer.code, 3, 32) ||
      !/^[A-Z0-9]+-[A-Z]$/u.test(answer.code) ||
      !printable(answer.label, 1, 1_024) ||
      answerCodes.has(answer.code)
    ) {
      throw new StudyV2NativeProtocolError("native_trial_answers_invalid");
    }
    answerCodes.add(answer.code);
  }
  if (value.entityTerms.length < 1 || value.entityTerms.length > 16) {
    throw new StudyV2NativeProtocolError("native_trial_terms_invalid");
  }
  const normalizedTerms = new Set<string>();
  for (const entity of value.entityTerms) {
    const normalized = entity.term.normalize("NFKC").trim().toLocaleLowerCase("en-US");
    if (
      !printable(entity.term, 2, 256) ||
      !printable(entity.objectCode, 3, 128) ||
      !/^[A-Za-z0-9:_-]+$/u.test(entity.objectCode) ||
      normalizedTerms.has(normalized)
    ) {
      throw new StudyV2NativeProtocolError("native_trial_terms_invalid");
    }
    normalizedTerms.add(normalized);
  }
  if (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 30_000 || value.timeoutMs > 900_000) {
    throw new StudyV2NativeProtocolError("native_trial_timeout_invalid");
  }
  return Object.freeze({
    ...value,
    answers: Object.freeze(value.answers.map((answer) => Object.freeze({ ...answer }))),
    entityTerms: Object.freeze(value.entityTerms.map((term) => Object.freeze({ ...term }))),
  });
}

export function parseStudyV2NativeEvent(
  payload: string,
  expectedTrialToken: string,
): StudyV2NativeEvent {
  if (payload.length < 1 || payload.length > MAX_STUDY_V2_NATIVE_PAYLOAD_CHARS) {
    throw new StudyV2NativeProtocolError("native_event_payload_invalid");
  }
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new StudyV2NativeProtocolError("native_event_payload_invalid");
  }
  if (
    !record(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "kind",
      "trialToken",
      "sequence",
      "eventType",
      "monotonicMs",
      "objectCode",
      "outcomeCode",
    ]) ||
    value.schemaVersion !== 2 ||
    value.kind !== STUDY_V2_NATIVE_EVENT_KIND ||
    value.trialToken !== expectedTrialToken ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 1 ||
    typeof value.eventType !== "string" ||
    !NATIVE_EVENT_TYPES.has(value.eventType as StudyV2EventType) ||
    typeof value.monotonicMs !== "number" ||
    !Number.isFinite(value.monotonicMs) ||
    value.monotonicMs < 0 ||
    (value.objectCode !== undefined &&
      (!printable(value.objectCode, 3, 128) || !/^[A-Za-z0-9:_-]+$/u.test(value.objectCode))) ||
    (value.outcomeCode !== undefined &&
      (!printable(value.outcomeCode, 1, 64) || !/^[A-Za-z0-9:_-]+$/u.test(value.outcomeCode)))
  ) {
    throw new StudyV2NativeProtocolError("native_event_payload_invalid");
  }
  return Object.freeze({
    schemaVersion: 2,
    kind: STUDY_V2_NATIVE_EVENT_KIND,
    trialToken: expectedTrialToken,
    sequence: Number(value.sequence),
    eventType: value.eventType as StudyV2EventType,
    monotonicMs: value.monotonicMs,
    ...(value.objectCode === undefined ? {} : { objectCode: value.objectCode as string }),
    ...(value.outcomeCode === undefined ? {} : { outcomeCode: value.outcomeCode as string }),
  });
}

import type { StudyV2Questionnaire } from "./contracts.js";
import { isStudyV2Language, type StudyV2Language } from "./language.js";

export const STUDY_V2_NATIVE_QUESTIONNAIRE_KIND =
  "pointable.study-v2.native-questionnaire" as const;
export const STUDY_V2_QUESTIONNAIRE_FIELDS = Object.freeze([
  "mentalDemand",
  "effort",
  "frustration",
  "confidence",
  "informationSufficiency",
] as const);

export type StudyV2QuestionnaireField = typeof STUDY_V2_QUESTIONNAIRE_FIELDS[number];
export type StudyV2NativeQuestionnaireEventType =
  | "questionnaire_submitted"
  | "questionnaire_aborted"
  | "questionnaire_timed_out";

export interface StudyV2NativeQuestionnaireSurfaceConfig {
  bindingName: string;
  sessionToken: string;
  sessionId: string;
  language: StudyV2Language;
  timeoutMs: number;
}

export interface StudyV2NativeQuestionnaireEvent {
  schemaVersion: 2;
  kind: typeof STUDY_V2_NATIVE_QUESTIONNAIRE_KIND;
  sessionToken: string;
  sequence: 1;
  eventType: StudyV2NativeQuestionnaireEventType;
  monotonicMs: number;
  mentalDemand?: number;
  effort?: number;
  frustration?: number;
  confidence?: number;
  informationSufficiency?: number;
}

export class StudyV2NativeQuestionnaireProtocolError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "StudyV2NativeQuestionnaireProtocolError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const accepted = new Set(allowed);
  return Object.keys(value).every((key) => accepted.has(key));
}

function rating(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 7;
}

export function validateStudyV2NativeQuestionnaireSurfaceConfig(
  value: StudyV2NativeQuestionnaireSurfaceConfig,
): StudyV2NativeQuestionnaireSurfaceConfig {
  if (!/^__pointableStudyQuestionnaireBinding_[A-Za-z0-9_]{16,128}$/u.test(value.bindingName)) {
    throw new StudyV2NativeQuestionnaireProtocolError("native_questionnaire_binding_invalid");
  }
  if (!/^[a-f0-9]{64}$/u.test(value.sessionToken)) {
    throw new StudyV2NativeQuestionnaireProtocolError("native_questionnaire_token_invalid");
  }
  if (!/^[a-f0-9]{32}$/u.test(value.sessionId)) {
    throw new StudyV2NativeQuestionnaireProtocolError("native_questionnaire_session_invalid");
  }
  if (!isStudyV2Language(value.language)) {
    throw new StudyV2NativeQuestionnaireProtocolError("native_questionnaire_language_invalid");
  }
  if (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 30_000 || value.timeoutMs > 1_800_000) {
    throw new StudyV2NativeQuestionnaireProtocolError("native_questionnaire_timeout_invalid");
  }
  return Object.freeze({ ...value });
}

export function parseStudyV2NativeQuestionnaireEvent(
  payload: string,
  expectedSessionToken: string,
): StudyV2NativeQuestionnaireEvent {
  if (payload.length < 1 || payload.length > 2_048) {
    throw new StudyV2NativeQuestionnaireProtocolError("native_questionnaire_payload_invalid");
  }
  let value: unknown;
  try {
    value = JSON.parse(payload) as unknown;
  } catch {
    throw new StudyV2NativeQuestionnaireProtocolError("native_questionnaire_payload_invalid");
  }
  if (
    !record(value) ||
    !exactKeys(value, [
      "schemaVersion", "kind", "sessionToken", "sequence", "eventType", "monotonicMs",
      ...STUDY_V2_QUESTIONNAIRE_FIELDS,
    ]) ||
    value.schemaVersion !== 2 || value.kind !== STUDY_V2_NATIVE_QUESTIONNAIRE_KIND ||
    value.sessionToken !== expectedSessionToken || value.sequence !== 1 ||
    (value.eventType !== "questionnaire_submitted" &&
      value.eventType !== "questionnaire_aborted" && value.eventType !== "questionnaire_timed_out") ||
    typeof value.monotonicMs !== "number" || !Number.isFinite(value.monotonicMs) || value.monotonicMs < 0
  ) {
    throw new StudyV2NativeQuestionnaireProtocolError("native_questionnaire_payload_invalid");
  }
  const hasRatings = STUDY_V2_QUESTIONNAIRE_FIELDS.every((field) => rating(value[field]));
  const hasAnyRating = STUDY_V2_QUESTIONNAIRE_FIELDS.some((field) => value[field] !== undefined);
  if ((value.eventType === "questionnaire_submitted" && !hasRatings) ||
    (value.eventType !== "questionnaire_submitted" && hasAnyRating)) {
    throw new StudyV2NativeQuestionnaireProtocolError("native_questionnaire_payload_invalid");
  }
  return Object.freeze({
    schemaVersion: 2,
    kind: STUDY_V2_NATIVE_QUESTIONNAIRE_KIND,
    sessionToken: expectedSessionToken,
    sequence: 1,
    eventType: value.eventType,
    monotonicMs: value.monotonicMs,
    ...(value.eventType !== "questionnaire_submitted" ? {} : Object.fromEntries(
      STUDY_V2_QUESTIONNAIRE_FIELDS.map((field) => [field, Number(value[field])]),
    )),
  }) as StudyV2NativeQuestionnaireEvent;
}

export function questionnaireFromNativeEvent(
  event: StudyV2NativeQuestionnaireEvent,
  sessionId: string,
): StudyV2Questionnaire {
  if (event.eventType !== "questionnaire_submitted" ||
    !STUDY_V2_QUESTIONNAIRE_FIELDS.every((field) => rating(event[field]))) {
    throw new StudyV2NativeQuestionnaireProtocolError("native_questionnaire_not_submitted");
  }
  return Object.freeze({
    schemaVersion: 2,
    sessionId,
    mentalDemand: event.mentalDemand!,
    effort: event.effort!,
    frustration: event.frustration!,
    confidence: event.confidence!,
    informationSufficiency: event.informationSufficiency!,
  });
}

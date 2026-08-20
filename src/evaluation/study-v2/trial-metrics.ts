import type {
  StudyV2Event,
  StudyV2ScenarioId,
  StudyV2TrialAssignment,
  StudyV2TrialResult,
} from "./contracts.js";

interface StudyV2ScoringRule {
  correctAnswerCode: string;
  correctObjectCode: string;
}

export const STUDY_V2_SCORING_CONTRACT = Object.freeze({
  "RESUME-1": Object.freeze({
    correctAnswerCode: "RESUME-B",
    correctObjectCode: "MODULE:RELAY-CACHE-ENTRY",
  }),
  "HANDOFF-1": Object.freeze({
    correctAnswerCode: "HANDOFF-C",
    correctObjectCode: "GATE:HANDOFF",
  }),
  "CONCEPT-1": Object.freeze({
    correctAnswerCode: "CONCEPT-A",
    correctObjectCode: "CONCEPT:AUTHORITY-FENCE",
  }),
  "DECISION-1": Object.freeze({
    correctAnswerCode: "DECISION-B",
    correctObjectCode: "DECISION:EXPLICIT-REFRESH",
  }),
  "STALE-1": Object.freeze({
    correctAnswerCode: "STALE-C",
    correctObjectCode: "STATE:OBSERVED-SNAPSHOT",
  }),
  "VERIFY-1": Object.freeze({
    correctAnswerCode: "VERIFY-A",
    correctObjectCode: "VERIFICATION:DEFINITION-ONLY",
  }),
} satisfies Readonly<Record<StudyV2ScenarioId, StudyV2ScoringRule>>);

const TERMINAL_EVENTS = new Set(["answer_submitted", "trial_timed_out", "trial_aborted"]);

function roundedMilliseconds(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 86_400_000) {
    throw new Error("study_v2_metric_time_invalid");
  }
  return Math.round(value);
}

export function deriveStudyV2TrialResult(
  assignment: StudyV2TrialAssignment,
  events: readonly StudyV2Event[],
): StudyV2TrialResult {
  if (events.length < 2 || events[0]?.eventType !== "trial_shown") {
    throw new Error("study_v2_trial_events_incomplete");
  }
  let priorTime = -1;
  let expectedSequence = events[0]?.sequence ?? 0;
  for (const event of events) {
    if (
      event.trialId !== assignment.trialId ||
      event.scenarioId !== assignment.scenarioId ||
      event.condition !== assignment.condition ||
      event.sequence !== expectedSequence ||
      event.monotonicMs < priorTime
    ) {
      throw new Error("study_v2_trial_event_order_invalid");
    }
    expectedSequence += 1;
    priorTime = event.monotonicMs;
  }
  const terminalEvents = events.filter((event) => TERMINAL_EVENTS.has(event.eventType));
  const terminal = events.at(-1);
  if (terminalEvents.length !== 1 || terminal === undefined || !TERMINAL_EVENTS.has(terminal.eventType)) {
    throw new Error("study_v2_trial_terminal_invalid");
  }

  const scoring = STUDY_V2_SCORING_CONTRACT[assignment.scenarioId];
  const objectOpens = events.filter((event) =>
    event.eventType === "card_opened" || event.eventType === "object_opened"
  );
  if (objectOpens.some((event) => event.objectCode === undefined)) {
    throw new Error("study_v2_object_open_identity_missing");
  }
  const firstCorrectObject = objectOpens.find((event) => event.objectCode === scoring.correctObjectCode);
  const cardOpenCount = events.filter((event) => event.eventType === "card_opened").length;
  const scriptedFollowupRequests = events.filter((event) =>
    event.eventType === "scripted_followup_requested"
  ).length;
  const navigationCount = events.filter((event) => event.eventType === "workspace_left").length;
  const wrongObjectCount = objectOpens.filter((event) => event.objectCode !== scoring.correctObjectCode).length;

  let navigationStartedAt: number | undefined;
  let navigationTime = 0;
  let cardOpenedAt: number | undefined;
  let cardDwell = 0;
  for (const event of events) {
    if (event.eventType === "workspace_left") {
      if (navigationStartedAt !== undefined) throw new Error("study_v2_navigation_event_invalid");
      navigationStartedAt = event.monotonicMs;
    } else if (event.eventType === "workspace_returned") {
      if (navigationStartedAt === undefined) throw new Error("study_v2_navigation_event_invalid");
      navigationTime += event.monotonicMs - navigationStartedAt;
      navigationStartedAt = undefined;
    } else if (event.eventType === "card_opened") {
      if (cardOpenedAt !== undefined) throw new Error("study_v2_card_event_invalid");
      cardOpenedAt = event.monotonicMs;
    } else if (event.eventType === "card_closed") {
      if (cardOpenedAt === undefined) throw new Error("study_v2_card_event_invalid");
      cardDwell += event.monotonicMs - cardOpenedAt;
      cardOpenedAt = undefined;
    }
  }
  if (navigationStartedAt !== undefined) navigationTime += terminal.monotonicMs - navigationStartedAt;
  if (cardOpenedAt !== undefined) cardDwell += terminal.monotonicMs - cardOpenedAt;

  const timedOut = terminal.eventType === "trial_timed_out";
  const aborted = terminal.eventType === "trial_aborted";
  const answerCode = terminal.eventType === "answer_submitted"
    ? terminal.outcomeCode
    : "NO_ANSWER";
  if (answerCode === undefined) throw new Error("study_v2_answer_code_missing");

  return Object.freeze({
    trialId: assignment.trialId,
    scenarioId: assignment.scenarioId,
    condition: assignment.condition,
    taskCompletionMs: roundedMilliseconds(terminal.monotonicMs),
    success: terminal.eventType === "answer_submitted" && answerCode === scoring.correctAnswerCode,
    timedOut,
    aborted,
    timeToFirstCorrectObjectMs: firstCorrectObject === undefined
      ? null
      : roundedMilliseconds(firstCorrectObject.monotonicMs),
    scriptedFollowupRequests,
    navigationCount,
    navigationTimeMs: roundedMilliseconds(navigationTime),
    wrongObjectCount,
    cardOpenCount,
    cardDwellMs: roundedMilliseconds(cardDwell),
    patchAttemptCount: 0,
    answerCode,
  });
}

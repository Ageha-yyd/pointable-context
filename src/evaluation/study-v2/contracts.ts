export const STUDY_V2_ID = "pointable-context-study-v2";
export const STUDY_V2_SCENARIOS = Object.freeze([
  "RESUME-1",
  "HANDOFF-1",
  "CONCEPT-1",
  "DECISION-1",
  "STALE-1",
  "VERIFY-1",
] as const);

export const STUDY_V2_EVENT_TYPES = Object.freeze([
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
] as const);

export type StudyV2Condition = "A" | "B";
export type StudyV2ScenarioId = typeof STUDY_V2_SCENARIOS[number];
export type StudyV2SurfaceScenarioId = StudyV2ScenarioId | "TRAIN-1";
export type StudyV2EventType = typeof STUDY_V2_EVENT_TYPES[number];
export type { StudyV2Language } from "./language.js";
import type { StudyV2Language } from "./language.js";

export interface StudyV2SurfaceAssignment {
  order: number;
  trialId: string;
  scenarioId: StudyV2SurfaceScenarioId;
  condition: StudyV2Condition;
}

export interface StudyV2TrialAssignment extends StudyV2SurfaceAssignment {
  scenarioId: StudyV2ScenarioId;
}

export interface StudyV2Assignment {
  schemaVersion: 2;
  studyId: typeof STUDY_V2_ID;
  slot: number;
  trainingScenarioId: "TRAIN-1";
  trials: readonly StudyV2TrialAssignment[];
}

export interface StudyV2Environment {
  platform: "win32";
  arch: "x64";
  codexBuild: string;
  runnerVersion: string;
}

export interface StudyV2SessionManifest {
  schemaVersion: 2;
  studyId: typeof STUDY_V2_ID;
  sessionId: string;
  participantCode: string;
  slot: number;
  language: StudyV2Language;
  packDigest: string;
  createdAt: string;
  completedAt: string;
  environment: StudyV2Environment;
  trials: readonly StudyV2TrialAssignment[];
}

export interface StudyV2Event {
  schemaVersion: 2;
  sessionId: string;
  sequence: number;
  trialId: string;
  scenarioId: StudyV2ScenarioId;
  condition: StudyV2Condition;
  eventType: StudyV2EventType;
  monotonicMs: number;
  objectCode?: string;
  outcomeCode?: string;
}

export interface StudyV2TrialResult {
  trialId: string;
  scenarioId: StudyV2ScenarioId;
  condition: StudyV2Condition;
  taskCompletionMs: number;
  success: boolean;
  timedOut: boolean;
  aborted: boolean;
  timeToFirstCorrectObjectMs: number | null;
  scriptedFollowupRequests: number;
  navigationCount: number;
  navigationTimeMs: number;
  wrongObjectCount: number;
  cardOpenCount: number;
  cardDwellMs: number;
  patchAttemptCount: number;
  answerCode: string;
}

export interface StudyV2Questionnaire {
  schemaVersion: 2;
  sessionId: string;
  mentalDemand: number;
  effort: number;
  frustration: number;
  confidence: number;
  informationSufficiency: number;
}

function conditionFor(position: number, phase: number): StudyV2Condition {
  return (position + phase) % 2 === 0 ? "A" : "B";
}

export function studyV2AssignmentForSlot(slot: number): StudyV2Assignment {
  if (!Number.isSafeInteger(slot) || slot < 1 || slot > 12) {
    throw new RangeError("study-v2 slot must be an integer from 1 through 12");
  }
  const zero = slot - 1;
  const row = zero % STUDY_V2_SCENARIOS.length;
  const phase = Math.floor(zero / STUDY_V2_SCENARIOS.length);
  const trials = STUDY_V2_SCENARIOS.map((_, position): StudyV2TrialAssignment => {
    const scenarioId = STUDY_V2_SCENARIOS[(row + position) % STUDY_V2_SCENARIOS.length];
    if (scenarioId === undefined) throw new Error("study-v2 assignment invariant failed");
    return Object.freeze({
      order: position + 1,
      trialId: `S${String(slot).padStart(2, "0")}-T${position + 1}`,
      scenarioId,
      condition: conditionFor(position, phase),
    });
  });
  return Object.freeze({
    schemaVersion: 2 as const,
    studyId: STUDY_V2_ID,
    slot,
    trainingScenarioId: "TRAIN-1" as const,
    trials: Object.freeze(trials),
  });
}

export function validateStudyV2Schedule(): readonly string[] {
  const issues: string[] = [];
  const conditionCounts = new Map<StudyV2ScenarioId, { A: number; B: number }>(
    STUDY_V2_SCENARIOS.map((scenario) => [scenario, { A: 0, B: 0 }]),
  );
  const ordinalCounts = new Map<StudyV2ScenarioId, number[]>(
    STUDY_V2_SCENARIOS.map((scenario) => [scenario, Array(6).fill(0) as number[]]),
  );
  for (let slot = 1; slot <= 12; slot += 1) {
    const assignment = studyV2AssignmentForSlot(slot);
    if (new Set(assignment.trials.map((trial) => trial.scenarioId)).size !== 6) {
      issues.push("assignment_duplicate_scenario");
    }
    if (assignment.trials.filter((trial) => trial.condition === "A").length !== 3) {
      issues.push("assignment_condition_A_unbalanced");
    }
    if (assignment.trials.filter((trial) => trial.condition === "B").length !== 3) {
      issues.push("assignment_condition_B_unbalanced");
    }
    for (const trial of assignment.trials) {
      const conditions = conditionCounts.get(trial.scenarioId);
      const ordinals = ordinalCounts.get(trial.scenarioId);
      if (conditions === undefined || ordinals === undefined) {
        issues.push("assignment_unknown_scenario");
        continue;
      }
      conditions[trial.condition] += 1;
      ordinals[trial.order - 1] = (ordinals[trial.order - 1] ?? 0) + 1;
    }
  }
  for (const scenario of STUDY_V2_SCENARIOS) {
    const conditions = conditionCounts.get(scenario);
    const ordinals = ordinalCounts.get(scenario);
    if (conditions?.A !== 6 || conditions.B !== 6) issues.push("scenario_condition_unbalanced");
    if (ordinals?.some((count) => count !== 2)) issues.push("scenario_ordinal_unbalanced");
  }
  return Object.freeze([...new Set(issues)]);
}

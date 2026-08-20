import type { StudyV2SurfaceAssignment } from "./contracts.js";
import type { StudyV2Language } from "./language.js";
import {
  materializeStudyV2ScriptedTask,
  type StudyV2ScriptedTaskResult,
  type StudyV2ScriptedTaskRpc,
} from "./native-scripted-task.js";
import { loadStudyV2NativeTrialMaterial } from "./native-trial-pack.js";
import type { StudyV2NativeAnswer, StudyV2NativeEntityTerm } from "./native-trial-protocol.js";
import { validateStudyV2Pack } from "./pack.js";

export interface MaterializeStudyV2ScriptedTrialConversationOptions {
  rpc: StudyV2ScriptedTaskRpc;
  repositoryRoot: string;
  assignment: StudyV2SurfaceAssignment;
  language?: StudyV2Language;
  model: string;
  workspaceRoot?: string;
  title?: string;
  notificationTimeoutMs?: number;
}

export interface StudyV2ScriptedTrialConversationResult {
  schemaVersion: 1;
  assignment: StudyV2SurfaceAssignment;
  packDigest: string;
  task: StudyV2ScriptedTaskResult;
  taskPrompt: string;
  answers: readonly StudyV2NativeAnswer[];
  entityTerms: readonly StudyV2NativeEntityTerm[];
  answerControlMounted: false;
  quietContextCompanionMounted: false;
}

export async function materializeStudyV2ScriptedTrialConversation(
  options: MaterializeStudyV2ScriptedTrialConversationOptions,
): Promise<StudyV2ScriptedTrialConversationResult> {
  const pack = await validateStudyV2Pack(options.repositoryRoot);
  if (!pack.valid || pack.packDigest === undefined) {
    throw new Error(`study_v2_pack_invalid:${pack.issues.map((issue) => issue.code).join(",")}`);
  }
  const material = await loadStudyV2NativeTrialMaterial(
    options.repositoryRoot,
    options.assignment,
    options.language,
  );
  const task = await materializeStudyV2ScriptedTask({
    rpc: options.rpc,
    workspaceRoot: options.workspaceRoot ?? material.workspaceRoot,
    title: options.title ?? `Pointable Study ${options.assignment.trialId} · ${options.assignment.scenarioId}`,
    model: options.model,
    exchanges: material.conversation.exchanges,
    serviceName: "pointable_context_study_v2_scripted_trial",
    ...(options.notificationTimeoutMs === undefined
      ? {}
      : { notificationTimeoutMs: options.notificationTimeoutMs }),
  });
  return Object.freeze({
    schemaVersion: 1 as const,
    assignment: Object.freeze({ ...options.assignment }),
    packDigest: pack.packDigest,
    task,
    taskPrompt: material.taskPrompt,
    answers: material.answers,
    entityTerms: material.entityTerms,
    answerControlMounted: false as const,
    quietContextCompanionMounted: false as const,
  });
}

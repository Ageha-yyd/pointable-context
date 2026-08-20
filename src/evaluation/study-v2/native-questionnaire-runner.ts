import type { StudyV2Questionnaire } from "./contracts.js";
import { parseStudyV2Language, type StudyV2Language } from "./language.js";
import { StudyV2NativeQuestionnaireHost } from "./native-questionnaire-host.js";
import { questionnaireFromNativeEvent } from "./native-questionnaire-protocol.js";

export interface StudyV2NativeQuestionnaireRunOptions {
  sessionId: string;
  language: StudyV2Language;
  endpoint?: string;
  timeoutMs?: number;
}

export interface StudyV2NativeQuestionnaireRunnerDependencies {
  createHost?: () => StudyV2NativeQuestionnaireHost;
}

export async function runStudyV2NativeQuestionnaire(
  options: StudyV2NativeQuestionnaireRunOptions,
  dependencies: StudyV2NativeQuestionnaireRunnerDependencies = {},
): Promise<Omit<StudyV2Questionnaire, "schemaVersion" | "sessionId">> {
  if (!/^[a-f0-9]{32}$/u.test(options.sessionId)) throw new Error("study_v2_questionnaire_session_invalid");
  const language = parseStudyV2Language(options.language);
  const timeoutMs = options.timeoutMs ?? 900_000;
  const host = dependencies.createHost?.() ?? new StudyV2NativeQuestionnaireHost({
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
  });
  try {
    await host.start({ sessionId: options.sessionId, language, timeoutMs });
    await host.activate();
    const terminal = await host.waitForTerminal();
    if (terminal.eventType === "questionnaire_aborted") {
      throw new Error("study_v2_questionnaire_deferred");
    }
    if (terminal.eventType === "questionnaire_timed_out") {
      throw new Error("study_v2_questionnaire_timed_out");
    }
    const questionnaire = questionnaireFromNativeEvent(terminal, options.sessionId);
    await host.stop("completed");
    return Object.freeze({
      mentalDemand: questionnaire.mentalDemand,
      effort: questionnaire.effort,
      frustration: questionnaire.frustration,
      confidence: questionnaire.confidence,
      informationSufficiency: questionnaire.informationSufficiency,
    });
  } finally {
    await host.stop().catch(() => undefined);
  }
}

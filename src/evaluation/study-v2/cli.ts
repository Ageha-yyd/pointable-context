#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { studyV2AssignmentForSlot } from "./contracts.js";
import { runStudyV2Doctor } from "./doctor.js";
import { validateStudyV2Pack } from "./pack.js";
import {
  encryptStudyV2ResultDirectory,
  previewStudyV2ResultDirectory,
  validateStudyV2ResultDirectory,
} from "./results.js";
import {
  planStudyV2GitHubSubmission,
  submitStudyV2EnvelopeToGitHub,
} from "./submission.js";
import {
  planStudyV2NativeTrial,
  runStudyV2NativeTrial,
} from "./native-trial-runner.js";
import { runStudyV2NativeSession } from "./native-session-runner.js";
import { runStudyV2NativeQuestionnaire } from "./native-questionnaire-runner.js";
import { runStudyV2NativeTraining } from "./native-training-runner.js";
import { parseStudyV2Language, type StudyV2Language } from "./language.js";

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

function reportTaskReady(language: StudyV2Language, context: {
  trial: { trialId: string; scenarioId: string; condition: string };
  threadId: string;
  title: string;
}): void {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    state: "awaiting_native_task",
    trialId: context.trial.trialId,
    scenarioId: context.trial.scenarioId,
    condition: context.trial.condition,
    threadId: context.threadId,
    title: context.title,
    action: language === "zh-CN"
      ? "请在 Codex Desktop 中打开此任务；只有精确任务被激活后试次才开始计时。"
      : "Open this task in Codex Desktop; the trial begins only after the exact task is active.",
  })}\n`);
}

function usage(): string {
  return [
    "Usage:",
    "  pointable-context-study-v2 validate-pack --repository-root <path> --json",
    "  pointable-context-study-v2 doctor --repository-root <path> --json",
    "  pointable-context-study-v2 assignment --slot <1-12> --json",
    "  pointable-context-study-v2 validate-result --result-dir <path> --json",
    "  pointable-context-study-v2 preview-result --result-dir <path> --json",
    "  pointable-context-study-v2 pack-result --result-dir <path> --public-key <pem> --output <new-file> --json",
    "  pointable-context-study-v2 submit --github --envelope <file> --repository <owner/repo> [--base main] [--dry-run|--confirm-submit] --json",
    "  pointable-context-study-v2 run-native-training --repository-root <path> --participant-code <P000> --slot <1-12> --language <zh-CN|en-US> [--endpoint http://127.0.0.1:9223] --json",
    "  pointable-context-study-v2 plan-native-trial --repository-root <path> --session-id <id> --slot <1-12> --order <1-6> --language <zh-CN|en-US> --json",
    "  pointable-context-study-v2 run-native-trial --repository-root <path> --session-id <id> --slot <1-12> --order <1-6> --language <zh-CN|en-US> [--endpoint http://127.0.0.1:9223] --json",
    "  pointable-context-study-v2 run-native-session --repository-root <path> --state-dir <path> --result-dir <new-path> --participant-code <P000> --session-id <32-hex> --slot <1-12> --language <zh-CN|en-US> [--endpoint http://127.0.0.1:9223] --json",
    "  pointable-context-study-v2 finalize-native-session --repository-root <path> --state-dir <path> --result-dir <new-path> --participant-code <P000> --session-id <32-hex> --slot <1-12> --language <zh-CN|en-US> [--endpoint http://127.0.0.1:9223] --json",
  ].join("\n");
}

function nativeTrainingArguments(argv: readonly string[]): {
  repositoryRoot: string;
  participantCode: string;
  slot: number;
  language: StudyV2Language;
  endpoint?: string;
} {
  const repositoryRoot = option(argv, "--repository-root");
  const participantCode = option(argv, "--participant-code");
  if (repositoryRoot === undefined || participantCode === undefined) {
    throw new Error("native_training_arguments_required");
  }
  const slot = Number(option(argv, "--slot"));
  const language = parseStudyV2Language(option(argv, "--language"));
  const endpoint = option(argv, "--endpoint");
  return {
    repositoryRoot: resolve(repositoryRoot),
    participantCode,
    slot,
    language,
    ...(endpoint === undefined ? {} : { endpoint }),
  };
}

function nativeSessionArguments(argv: readonly string[]): {
  repositoryRoot: string;
  stateDirectory: string;
  resultDirectory: string;
  participantCode: string;
  sessionId: string;
  slot: number;
  language: StudyV2Language;
  runnerVersion: "study-v2.2.0";
  endpoint?: string;
} {
  const repositoryRoot = option(argv, "--repository-root");
  const stateDirectory = option(argv, "--state-dir");
  const resultDirectory = option(argv, "--result-dir");
  const participantCode = option(argv, "--participant-code");
  const sessionId = option(argv, "--session-id");
  const slot = Number(option(argv, "--slot"));
  if (
    repositoryRoot === undefined || stateDirectory === undefined || resultDirectory === undefined ||
    participantCode === undefined || sessionId === undefined
  ) throw new Error("native_session_arguments_required");
  const language = parseStudyV2Language(option(argv, "--language"));
  const endpoint = option(argv, "--endpoint");
  return {
    repositoryRoot: resolve(repositoryRoot),
    stateDirectory: resolve(stateDirectory),
    resultDirectory: resolve(resultDirectory),
    participantCode,
    sessionId,
    slot,
    language,
    runnerVersion: "study-v2.2.0",
    ...(endpoint === undefined ? {} : { endpoint }),
  };
}

function nativeTrialArguments(argv: readonly string[]): {
  repositoryRoot: string;
  sessionId: string;
  assignment: ReturnType<typeof studyV2AssignmentForSlot>["trials"][number];
  language: StudyV2Language;
  endpoint?: string;
} {
  const repositoryRoot = option(argv, "--repository-root");
  const sessionId = option(argv, "--session-id");
  const slot = Number(option(argv, "--slot"));
  const order = Number(option(argv, "--order"));
  if (repositoryRoot === undefined || sessionId === undefined) {
    throw new Error("native_trial_arguments_required");
  }
  const language = parseStudyV2Language(option(argv, "--language"));
  const assignment = studyV2AssignmentForSlot(slot).trials.find((trial) => trial.order === order);
  if (assignment === undefined) throw new Error("native_trial_order_invalid");
  const endpoint = option(argv, "--endpoint");
  return {
    repositoryRoot: resolve(repositoryRoot),
    sessionId,
    assignment,
    language,
    ...(endpoint === undefined ? {} : { endpoint }),
  };
}

const argv = process.argv.slice(2);
const command = argv[0];
const json = argv.includes("--json");

try {
  if (!json) throw new Error("json_output_required");
  if (command === "validate-pack" || command === "doctor") {
    const root = option(argv, "--repository-root");
    if (root === undefined) throw new Error("repository_root_required");
    const result = command === "doctor"
      ? await runStudyV2Doctor(resolve(root))
      : await validateStudyV2Pack(resolve(root));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = ("ready" in result ? result.ready : result.valid) ? 0 : 2;
  } else if (command === "assignment") {
    const result = studyV2AssignmentForSlot(Number(option(argv, "--slot")));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (command === "validate-result" || command === "preview-result") {
    const directory = option(argv, "--result-dir");
    if (directory === undefined) throw new Error("result_dir_required");
    const result = command === "validate-result"
      ? await validateStudyV2ResultDirectory(resolve(directory))
      : await previewStudyV2ResultDirectory(resolve(directory));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.valid ? 0 : 2;
  } else if (command === "pack-result") {
    const directory = option(argv, "--result-dir");
    const keyPath = option(argv, "--public-key");
    const output = option(argv, "--output");
    if (directory === undefined || keyPath === undefined || output === undefined) {
      throw new Error("pack_result_arguments_required");
    }
    const result = await encryptStudyV2ResultDirectory({
      resultDirectory: resolve(directory),
      researcherPublicKeyPem: await readFile(resolve(keyPath), "utf8"),
      outputPath: resolve(output),
    });
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  } else if (command === "submit" && argv.includes("--github")) {
    const envelopePath = option(argv, "--envelope");
    const repository = option(argv, "--repository");
    const baseBranch = option(argv, "--base") ?? "main";
    if (envelopePath === undefined || repository === undefined) throw new Error("submission_arguments_required");
    if (argv.includes("--dry-run")) {
      process.stdout.write(`${JSON.stringify(await planStudyV2GitHubSubmission({
        envelopePath: resolve(envelopePath), repository, baseBranch,
      }))}\n`);
    } else if (argv.includes("--confirm-submit")) {
      process.stdout.write(`${JSON.stringify(await submitStudyV2EnvelopeToGitHub({
        envelopePath: resolve(envelopePath), repository, baseBranch, confirmed: true,
      }))}\n`);
    } else {
      throw new Error("explicit_submission_confirmation_required");
    }
  } else if (command === "run-native-training") {
    const training = nativeTrainingArguments(argv);
    const result = await runStudyV2NativeTraining(training, {
      onTaskReady: (context) => reportTaskReady(training.language, context),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.trainingCompleted) process.exitCode = 2;
  } else if (command === "plan-native-trial" || command === "run-native-trial") {
    const native = nativeTrialArguments(argv);
    const result = command === "plan-native-trial"
      ? await planStudyV2NativeTrial(native)
      : await runStudyV2NativeTrial(native, { onTaskReady: (context) => reportTaskReady(native.language, context) });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if ("ready" in result && !result.ready) process.exitCode = 2;
  } else if (command === "run-native-session" || command === "finalize-native-session") {
    const session = nativeSessionArguments(argv);
    const result = await runStudyV2NativeSession({
      ...session,
      ...(command === "finalize-native-session" ? { finalizeOnly: true } : {}),
    }, {
      onTrialTaskReady: (context) => reportTaskReady(session.language, context),
      ...(command !== "finalize-native-session" ? {} : {
        collectQuestionnaire: async () => runStudyV2NativeQuestionnaire({
          sessionId: session.sessionId,
          language: session.language,
          ...(session.endpoint === undefined ? {} : { endpoint: session.endpoint }),
        }),
      }),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    throw new Error("unsupported_command");
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error instanceof Error ? error.message : "study_v2_error",
    usage: usage(),
  })}\n`);
  process.exitCode = 64;
}

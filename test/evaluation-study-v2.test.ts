import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  STUDY_V2_ID,
  studyV2AssignmentForSlot,
  validateStudyV2Schedule,
} from "../src/evaluation/study-v2/contracts.js";
import { validateStudyV2Pack } from "../src/evaluation/study-v2/pack.js";
import {
  decryptStudyV2EnvelopeForResearcher,
  encryptStudyV2ResultDirectory,
  previewStudyV2ResultDirectory,
  validateStudyV2ResultDirectory,
  writeStudyV2ResultFixture,
} from "../src/evaluation/study-v2/results.js";
import { planStudyV2GitHubSubmission } from "../src/evaluation/study-v2/submission.js";
import type {
  StudyV2Event,
  StudyV2Questionnaire,
  StudyV2SessionManifest,
  StudyV2TrialResult,
} from "../src/evaluation/study-v2/contracts.js";
import {
  deriveStudyV2TrialResult,
  STUDY_V2_SCORING_CONTRACT,
} from "../src/evaluation/study-v2/trial-metrics.js";

async function copyStudyV2Pack(destination: string): Promise<void> {
  const source = resolve(".");
  const manifestPath = "docs/evaluation/study-v2/manifest.json";
  const manifest = JSON.parse(await readFile(join(source, manifestPath), "utf8")) as {
    materials: string[];
  };
  for (const path of [manifestPath, ...manifest.materials]) {
    const target = join(destination, ...path.split("/"));
    await mkdir(join(target, ".."), { recursive: true });
    await copyFile(join(source, ...path.split("/")), target);
  }
}

function resultData(slot = 1): {
  manifest: StudyV2SessionManifest;
  events: StudyV2Event[];
  trials: StudyV2TrialResult[];
  questionnaire: StudyV2Questionnaire;
} {
  const assignment = studyV2AssignmentForSlot(slot);
  const sessionId = "0123456789abcdef0123456789abcdef";
  const manifest: StudyV2SessionManifest = {
    schemaVersion: 2,
    studyId: STUDY_V2_ID,
    sessionId,
    participantCode: `P${String(slot).padStart(3, "0")}`,
    slot,
    language: "en-US",
    packDigest: "a".repeat(64),
    createdAt: "2026-08-20T01:00:00.000Z",
    completedAt: "2026-08-20T01:30:00.000Z",
    environment: {
      platform: "win32",
      arch: "x64",
      codexBuild: "26.810.7004.0",
      runnerVersion: "study-v2.0.0",
    },
    trials: assignment.trials,
  };
  const events: StudyV2Event[] = [];
  for (const [index, trial] of assignment.trials.entries()) {
    events.push({
      schemaVersion: 2,
      sessionId,
      sequence: events.length + 1,
      trialId: trial.trialId,
      scenarioId: trial.scenarioId,
      condition: trial.condition,
      eventType: "trial_shown",
      monotonicMs: 0,
    });
    events.push({
      schemaVersion: 2,
      sessionId,
      sequence: events.length + 1,
      trialId: trial.trialId,
      scenarioId: trial.scenarioId,
      condition: trial.condition,
      eventType: "answer_submitted",
      monotonicMs: 20_000 + index,
      outcomeCode: STUDY_V2_SCORING_CONTRACT[trial.scenarioId].correctAnswerCode,
    });
  }
  const trials = assignment.trials.map((trial): StudyV2TrialResult =>
    deriveStudyV2TrialResult(trial, events.filter((event) => event.trialId === trial.trialId))
  );
  const questionnaire: StudyV2Questionnaire = {
    schemaVersion: 2,
    sessionId,
    mentalDemand: 4,
    effort: 4,
    frustration: 2,
    confidence: 6,
    informationSufficiency: 6,
  };
  return { manifest, events, trials, questionnaire };
}

test("study-v2 pack is separate, counterbalanced, privacy-bounded, and digest-stable", async () => {
  assert.deepEqual(validateStudyV2Schedule(), []);
  for (let slot = 1; slot <= 12; slot += 1) {
    const assignment = studyV2AssignmentForSlot(slot);
    assert.equal(assignment.trials.filter((trial) => trial.condition === "A").length, 3);
    assert.equal(assignment.trials.filter((trial) => trial.condition === "B").length, 3);
    assert.equal(new Set(assignment.trials.map((trial) => trial.scenarioId)).size, 6);
  }
  const first = await validateStudyV2Pack(resolve("."));
  const second = await validateStudyV2Pack(resolve("."));
  assert.equal(first.valid, true, JSON.stringify(first.issues));
  assert.match(first.packDigest ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(second.packDigest, first.packDigest);
});

test("study-v2 pack digest is stable across Git line-ending conversion", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-study-v2-crlf-"));
  try {
    await copyStudyV2Pack(root);
    const manifestPath = "docs/evaluation/study-v2/manifest.json";
    const manifest = JSON.parse(await readFile(join(root, ...manifestPath.split("/")), "utf8")) as {
      materials: string[];
    };
    for (const path of [manifestPath, ...manifest.materials]) {
      const target = join(root, ...path.split("/"));
      const text = await readFile(target, "utf8");
      await writeFile(target, text.replace(/\r\n?/gu, "\n").replace(/\n/gu, "\r\n"), "utf8");
    }
    const source = await validateStudyV2Pack(resolve("."));
    const converted = await validateStudyV2Pack(root);
    assert.equal(converted.valid, true, JSON.stringify(converted.issues));
    assert.equal(converted.packDigest, source.packDigest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("study-v2 pack rejects scripted answer, object, and selectable-term drift", async () => {
  const cases = [
    {
      expected: "study_v2_answer_key_mismatch",
      mutate: (transcript: string, conversation: string) => ({
        transcript: transcript.replace("`RESUME-B`", "`RESUME-X`"),
        conversation,
      }),
    },
    {
      expected: "study_v2_conversation_entity_mismatch",
      mutate: (transcript: string, conversation: string) => ({
        transcript,
        conversation: conversation.replace("MODULE:RELAY-CACHE-ENTRY", "MODULE:UNKNOWN-ENTRY"),
      }),
    },
    {
      expected: "study_v2_conversation_term_missing",
      mutate: (transcript: string, conversation: string) => ({
        transcript,
        conversation: conversation.replace("relay-cache public entry", "supported consumer boundary"),
      }),
    },
  ];
  for (const item of cases) {
    const root = await mkdtemp(join(tmpdir(), "pointable-study-v2-pack-"));
    try {
      await copyStudyV2Pack(root);
      const transcriptPath = join(root, "fixtures", "evaluation-study-v2", "RESUME-1", "transcript.md");
      const conversationPath = join(root, "fixtures", "evaluation-study-v2", "RESUME-1", "conversation.json");
      const mutated = item.mutate(
        await readFile(transcriptPath, "utf8"),
        await readFile(conversationPath, "utf8"),
      );
      await writeFile(transcriptPath, mutated.transcript, "utf8");
      await writeFile(conversationPath, mutated.conversation, "utf8");
      const validation = await validateStudyV2Pack(root);
      assert.equal(validation.valid, false);
      assert.ok(validation.issues.some((issue) => issue.code === item.expected), JSON.stringify(validation.issues));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("study-v2 workspace preparation copies one frozen scenario without exposing card entities", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-study-v2-workspace-"));
  const destination = join(root, "workspace");
  try {
    const prepared = spawnSync(process.execPath, [
      "scripts/prepare-study-v2-workspace.mjs",
      "prepare",
      "--scenario",
      "RESUME-1",
      "--language",
      "en-US",
      "--destination",
      destination,
    ], { cwd: resolve("."), encoding: "utf8", windowsHide: true });
    assert.equal(prepared.status, 0, prepared.stderr);
    const result = JSON.parse(prepared.stdout) as { scenarioId?: string; transcriptDigest?: string };
    assert.equal(result.scenarioId, "RESUME-1");
    assert.match(result.transcriptDigest ?? "", /^[a-f0-9]{64}$/u);
    assert.match(await readFile(join(destination, "FROZEN_CHAT.md"), "utf8"), /public relay-cache entry/u);
    assert.equal(await readFile(join(destination, "answer.txt"), "utf8"), "UNANSWERED\n");
    await assert.rejects(readFile(join(destination, "entities.json"), "utf8"));
    const status = spawnSync("git", ["status", "--porcelain"], {
      cwd: destination,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(status.status, 0);
    assert.equal(status.stdout, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("study-v2 results reject unknown content, preview bounded fields, and verify integrity", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-study-v2-result-"));
  try {
    await writeStudyV2ResultFixture({ directory: root, ...resultData() });
    const validation = await validateStudyV2ResultDirectory(root);
    assert.equal(validation.valid, true, JSON.stringify(validation.issues));
    assert.equal(validation.eventCount, 12);
    assert.equal(validation.trialCount, 6);
    const preview = await previewStudyV2ResultDirectory(root);
    assert.equal(preview.valid, true);
    assert.deepEqual(preview.includedFiles, [
      "manifest.json", "events.ndjson", "trials.csv", "questionnaire.json", "integrity.json",
    ]);
    assert.ok(preview.excludedData.includes("ordinary_chat_content"));
    const eventPath = join(root, "events.ndjson");
    const first = (await readFile(eventPath, "utf8")).split("\n")[0] ?? "";
    await writeFile(eventPath, `${first.slice(0, -1)},"raw_selected_text":"secret"}\n`, "utf8");
    const tampered = await validateStudyV2ResultDirectory(root);
    assert.equal(tampered.valid, false);
    assert.ok(tampered.issues.some((issue) => issue.code === "result_event_invalid"));
    assert.ok(tampered.issues.some((issue) => issue.code === "result_integrity_mismatch"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("study-v2 result encryption hides participant data and round-trips for the researcher", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-study-v2-encryption-"));
  const resultDirectory = join(root, "result");
  const output = join(root, "submission-8f31a2c7.pcstudy");
  await mkdir(resultDirectory);
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  try {
    await writeStudyV2ResultFixture({ directory: resultDirectory, ...resultData() });
    const packed = await encryptStudyV2ResultDirectory({
      resultDirectory,
      researcherPublicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      outputPath: output,
    });
    assert.match(packed.envelopeSha256, /^[a-f0-9]{64}$/u);
    const encrypted = await readFile(output, "utf8");
    assert.doesNotMatch(encrypted, /P001|0123456789abcdef/u);
    const plan = await planStudyV2GitHubSubmission({
      envelopePath: output,
      repository: "example/pointable-context-study-submissions",
    });
    assert.equal(plan.destinationPath, "submissions/v2/submission-8f31a2c7.pcstudy");
    assert.equal(plan.accountIdentityVisible, true);
    assert.equal(plan.uploadsPlaintext, false);
    const archive = decryptStudyV2EnvelopeForResearcher(
      encrypted,
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
    assert.match(archive.files["manifest.json"] ?? "", /pointable-context-study-v2/u);
    assert.match(archive.files["trials.csv"] ?? "", /scripted_followup_requests/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

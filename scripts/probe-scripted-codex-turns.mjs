#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { CodexAppServerClient } from "../dist/src/app-server/client.js";
import { materializeStudyV2ScriptedTask } from "../dist/src/evaluation/study-v2/native-scripted-task.js";
import { startScriptedResponsesProvider } from "../dist/src/evaluation/study-v2/scripted-responses-provider.js";

function codexScript() {
  const appData = process.env.APPDATA;
  const script = appData === undefined
    ? undefined
    : join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
  if (script === undefined || !existsSync(script)) throw new Error("codex script missing");
  return script;
}

const workspaceRoot = resolve(process.argv[2] ?? process.cwd());
const token = Math.random().toString(16).slice(2, 14).padEnd(12, "0");
const script = [
  {
    user: `[PC-SCRIPTED-TURN:${token}:U1] 请检查当前兼容性 Gate。`,
    assistant: `[PC-SCRIPTED-TURN:${token}:A1] 已检查：navigation recovery 尚未通过，因此当前不能开始参与者招募。`,
  },
  {
    user: `[PC-SCRIPTED-TURN:${token}:U2] Gate 通过后下一步做什么？`,
    assistant: `[PC-SCRIPTED-TURN:${token}:A2] 运行受控原生会话试次，并记录恢复正确项目理解所需的时间与额外 Chat Turn。`,
  },
];
const provider = await startScriptedResponsesProvider(
  script.map((step) => ({ outputText: step.assistant })),
);
const args = [
  codexScript(),
  "-c", 'model_provider="openai"',
  "-c", 'model="gpt-4.1"',
  "-c", `openai_base_url="${provider.origin}/v1"`,
  "-c", "model_supports_reasoning_summaries=false",
  "-c", "model_context_window=32768",
  "app-server",
];
const client = await CodexAppServerClient.launch({
  cwd: workspaceRoot,
  command: process.execPath,
  args,
  requestTimeoutMs: 30_000,
});
let createdThreadId;
let completedSuccessfully = false;
const notificationMethods = [];
try {
  const initialized = await client.initialize();
  client.onNotification((method) => {
    if (notificationMethods.length < 128) notificationMethods.push(method);
  });
  const materialized = await materializeStudyV2ScriptedTask({
    rpc: client,
    workspaceRoot,
    title: `Pointable Scripted Native Turns ${token}`,
    model: "gpt-4.1",
    exchanges: script,
    serviceName: "pointable_context_scripted_turn_probe",
  });
  createdThreadId = materialized.threadId;
  const markers = script.flatMap((step) => [step.user.match(/\[[^\]]+\]/u)?.[0], step.assistant.match(/\[[^\]]+\]/u)?.[0]])
    .filter((marker) => typeof marker === "string");
  const markerVisibility = Object.fromEntries(markers.map((marker) => [marker, true]));
  completedSuccessfully = true;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    codexUserAgent: initialized?.userAgent ?? null,
    threadId: createdThreadId,
    title: materialized.title,
    modelProvider: "openai",
    model: "gpt-4.1",
    modelNetwork: "loopback_scripted_responses",
    liveOpenAIModelInvoked: false,
    turnCount: materialized.exchangeCount,
    turnIds: materialized.turnIds,
    markerVisibility,
    providerRequests: provider.requests,
    nextStep: {
      action: "open_thread_in_codex_desktop",
      expected: "two ordinary user turns and two ordinary assistant replies are visible and selectable",
      cleanup: `node scripts/probe-native-conversation-replay.mjs delete --thread ${createdThreadId}`,
    },
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write(`provider requests: ${JSON.stringify(provider.requests)}\n`);
  process.stderr.write(`notification methods: ${JSON.stringify(notificationMethods)}\n`);
  const stderr = client.stderr().trim();
  if (stderr.length > 0) process.stderr.write(`app-server stderr:\n${stderr}\n`);
  process.exitCode = 1;
} finally {
  if (!completedSuccessfully && createdThreadId !== undefined) {
    await client.request("thread/delete", { threadId: createdThreadId }).catch(() => undefined);
  }
  await client.close();
  await provider.stop();
}

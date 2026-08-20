#!/usr/bin/env node
import { resolve } from "node:path";
import { CodexAppServerClient } from "../dist/src/app-server/client.js";
import { createNativeConversationProbe } from "../dist/src/evaluation/study-v2/native-conversation-probe.js";

function usage() {
  return [
    "Usage:",
    "  node scripts/probe-native-conversation-replay.mjs create [--workspace-root <path>]",
    "  node scripts/probe-native-conversation-replay.mjs inspect --thread <thread-id>",
    "  node scripts/probe-native-conversation-replay.mjs delete --thread <thread-id>",
  ].join("\n");
}

function parse(argv) {
  const command = argv[0] ?? "create";
  if (!new Set(["create", "inspect", "delete"]).has(command)) {
    throw new Error(`unknown command: ${command}\n${usage()}`);
  }
  let workspaceRoot = process.cwd();
  let threadId;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--workspace-root") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("--workspace-root requires a path");
      workspaceRoot = resolve(value);
      index += 1;
      continue;
    }
    if (argument === "--thread") {
      const value = argv[index + 1];
      if (value === undefined || !/^[A-Za-z0-9_-]{8,256}$/u.test(value)) {
        throw new Error("--thread requires a bounded thread id");
      }
      threadId = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${String(argument)}\n${usage()}`);
  }
  if (command !== "create" && threadId === undefined) {
    throw new Error(`--thread is required for ${command}`);
  }
  return { command, workspaceRoot, threadId };
}

const options = parse(process.argv.slice(2));
const client = await CodexAppServerClient.launch({
  cwd: options.workspaceRoot,
  requestTimeoutMs: 30_000,
});
let failed = false;
try {
  const initialized = await client.initialize();
  if (options.command === "create") {
    const result = await createNativeConversationProbe({
      rpc: client,
      cwd: options.workspaceRoot,
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      operation: "create",
      codexUserAgent:
        initialized && typeof initialized === "object" && "userAgent" in initialized
          ? initialized.userAgent
          : null,
      ...result,
      nextStep: {
        action: "open_thread_in_codex_desktop",
        expected: "all four markers appear as ordinary selectable Chat Lane messages",
        cleanup: `node scripts/probe-native-conversation-replay.mjs delete --thread ${result.threadId}`,
      },
    }, null, 2)}\n`);
  } else if (options.command === "inspect") {
    const read = await client.request("thread/read", {
      threadId: options.threadId,
      includeTurns: true,
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      operation: "inspect",
      threadId: options.threadId,
      thread: read,
    }, null, 2)}\n`);
  } else {
    await client.request("thread/delete", { threadId: options.threadId });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      operation: "delete",
      threadId: options.threadId,
    }, null, 2)}\n`);
  }
} catch (error) {
  failed = true;
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  const stderr = client.stderr().trim();
  if (stderr.length > 0) process.stderr.write(`app-server stderr:\n${stderr}\n`);
} finally {
  await client.close();
}
if (failed) process.exitCode = 1;

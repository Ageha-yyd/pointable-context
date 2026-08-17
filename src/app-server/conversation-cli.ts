#!/usr/bin/env node
import { resolve } from "node:path";
import { CodexAppServerClient } from "./client.js";
import { startConversationHttpServer } from "./conversation-http.js";
import { PointableConversationService } from "./conversation-service.js";

interface CliOptions {
  workspaceRoot: string;
  port: number;
  deleteThreadOnExit: boolean;
}

function parseArguments(arguments_: string[]): CliOptions {
  let workspaceRoot = process.cwd();
  let port = 0;
  let deleteThreadOnExit = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--workspace-root") {
      const value = arguments_[index + 1];
      if (value === undefined) throw new Error("--workspace-root requires a path");
      workspaceRoot = resolve(value);
      index += 1;
      continue;
    }
    if (argument === "--port") {
      const value = arguments_[index + 1];
      if (value === undefined || !/^\d{1,5}$/u.test(value)) {
        throw new Error("--port requires an integer");
      }
      port = Number(value);
      if (port < 0 || port > 65_535) throw new Error("--port is outside 0..65535");
      index += 1;
      continue;
    }
    if (argument === "--delete-thread-on-exit") {
      deleteThreadOnExit = true;
      continue;
    }
    throw new Error(`unknown argument: ${String(argument)}`);
  }
  return { workspaceRoot, port, deleteThreadOnExit };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const client = await CodexAppServerClient.launch({
    cwd: options.workspaceRoot,
    requestTimeoutMs: 30_000,
  });
  await client.initialize();
  let server: Awaited<ReturnType<typeof startConversationHttpServer>> | undefined;
  try {
    const service = await PointableConversationService.start({
      rpc: client,
      workspaceRoot: options.workspaceRoot,
    });
    server = await startConversationHttpServer({
      service,
      port: options.port,
      deleteThreadOnStop: options.deleteThreadOnExit,
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      url: server.url,
      threadId: service.threadId,
      workspaceName: service.state().workspaceName,
      deleteThreadOnExit: options.deleteThreadOnExit,
    }, null, 2)}\n`);
    let closing = false;
    const shutdown = async (): Promise<void> => {
      if (closing) return;
      closing = true;
      try {
        await server?.stop();
      } finally {
        await client.close();
      }
    };
    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
  } catch (error) {
    await server?.stop().catch(() => undefined);
    await client.close();
    throw error;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "conversation_client_failed";
  process.stderr.write(`Pointable Context conversation client failed: ${message}\n`);
  process.exitCode = 1;
});

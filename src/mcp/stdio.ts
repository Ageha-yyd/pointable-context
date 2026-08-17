#!/usr/bin/env node
import { isAbsolute, resolve } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  FIXTURE_WARNING,
  createLocalFixtureToolService,
} from "./fixture-tool-service.js";
import { createFixtureProbeMcpServer } from "./server.js";

interface FixtureArguments {
  fixtureRoot: string;
  projectId: string;
}

function parseArguments(argv: string[]): FixtureArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      (key !== "--fixture-root" && key !== "--project-id") ||
      value === undefined ||
      value.length === 0
    ) {
      throw new Error(
        "usage: pointable-context-mcp-fixture --fixture-root <absolute-or-cwd-relative-path> --project-id <id>",
      );
    }
    if (values.has(key)) throw new Error(`duplicate argument: ${key}`);
    values.set(key, value);
  }
  const fixtureRoot = values.get("--fixture-root");
  const projectId = values.get("--project-id");
  if (!fixtureRoot || !projectId) {
    throw new Error(
      "--fixture-root and --project-id are required",
    );
  }
  return {
    fixtureRoot: isAbsolute(fixtureRoot)
      ? fixtureRoot
      : resolve(process.cwd(), fixtureRoot),
    projectId,
  };
}

function main(): void {
  const options = parseArguments(process.argv.slice(2));
  const handle = serveStdio(
    () =>
      createFixtureProbeMcpServer(
        createLocalFixtureToolService({
          workspaceRoot: options.fixtureRoot,
          projectId: options.projectId,
        }),
      ),
    {
      onerror(error) {
        console.error(`pointable-context fixture MCP error: ${error.message}`);
      },
    },
  );

  console.error(FIXTURE_WARNING);
  let closing = false;
  const close = (): void => {
    if (closing) return;
    closing = true;
    void handle.close().finally(() => {
      process.exitCode = 0;
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

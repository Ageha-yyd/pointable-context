#!/usr/bin/env node
import { isAbsolute, resolve } from "node:path";
import {
  readTestExecutionRequest,
  runTestExecution,
  TestExecutionError,
} from "./test-execution.js";

interface Arguments {
  workspaceRoot: string;
  requestFile: string;
  json: boolean;
}

function parseArguments(argv: readonly string[]): Arguments | undefined {
  let workspaceRoot: string | undefined;
  let requestFile: string | undefined;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      json = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) return undefined;
    index += 1;
    if (argument === "--workspace-root" && workspaceRoot === undefined) {
      workspaceRoot = resolve(value);
      continue;
    }
    if (argument === "--request-file" && requestFile === undefined && isAbsolute(value)) {
      requestFile = resolve(value);
      continue;
    }
    return undefined;
  }
  return workspaceRoot === undefined || requestFile === undefined
    ? undefined
    : { workspaceRoot, requestFile, json };
}

function usage(): string {
  return "Usage: pointable-context-test-execution --workspace-root <path> --request-file <absolute-json> [--json]";
}

const parsed = parseArguments(process.argv.slice(2));
if (parsed === undefined) {
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 64;
} else {
  try {
    const request = await readTestExecutionRequest(parsed.requestFile);
    const result = await runTestExecution(parsed.workspaceRoot, request, {
      writeStdout: (chunk) => process.stderr.write(chunk),
      writeStderr: (chunk) => process.stderr.write(chunk),
    });
    if (parsed.json) {
      process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
    } else {
      process.stdout.write(
        `Pointable Context test execution: ${result.event.outcome}; ${result.verificationPath}\n`,
      );
    }
    process.exitCode = result.event.revisionDrift
      ? 11
      : result.event.outcome === "passed"
        ? 0
        : result.event.outcome === "failed"
          ? 10
          : 11;
  } catch (error) {
    const code = error instanceof TestExecutionError ? error.code : "test_execution_failed";
    if (parsed.json) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: code })}\n`);
    } else {
      process.stderr.write(`Pointable Context test execution failed: ${code}\n`);
    }
    process.exitCode = code === "request_invalid" ? 64 : 70;
  }
}

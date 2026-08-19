#!/usr/bin/env node
import { resolve } from "node:path";
import { checkContextRecords } from "./context-record-check.js";

interface Arguments {
  workspaceRoot?: string;
  json: boolean;
}

function parseArguments(argv: readonly string[]): Arguments | undefined {
  const parsed: Arguments = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") {
      parsed.json = true;
      continue;
    }
    if (value === "--workspace-root" && parsed.workspaceRoot === undefined) {
      const root = argv[index + 1];
      if (root === undefined || root.startsWith("--")) return undefined;
      parsed.workspaceRoot = resolve(root);
      index += 1;
      continue;
    }
    return undefined;
  }
  return parsed.workspaceRoot === undefined ? undefined : parsed;
}

function usage(): string {
  return "Usage: pointable-context-record-check --workspace-root <path> [--json]";
}

const parsed = parseArguments(process.argv.slice(2));
if (parsed === undefined) {
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 64;
} else {
  const result = await checkContextRecords(parsed.workspaceRoot ?? "");
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (result.valid) {
    process.stdout.write(`Pointable Context records valid: ${result.records.length}\n`);
  } else {
    process.stdout.write(`Pointable Context records invalid: ${result.issues.length}\n`);
    for (const issue of result.issues) {
      process.stdout.write(`- ${issue.code}${issue.path === undefined ? "" : `: ${issue.path}`}\n`);
    }
  }
  process.exitCode = result.valid ? 0 : 2;
}

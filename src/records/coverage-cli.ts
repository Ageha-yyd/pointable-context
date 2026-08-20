#!/usr/bin/env node
import { resolve } from "node:path";
import { auditContextCoverage } from "./context-coverage.js";

interface Arguments {
  workspaceRoot?: string;
  manifestPath?: string;
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
    if (value === "--manifest" && parsed.manifestPath === undefined) {
      const path = argv[index + 1];
      if (path === undefined || path.startsWith("--")) return undefined;
      parsed.manifestPath = path;
      index += 1;
      continue;
    }
    return undefined;
  }
  return parsed.workspaceRoot === undefined ? undefined : parsed;
}

function usage(): string {
  return "Usage: pointable-context-coverage --workspace-root <path> [--manifest <workspace-relative-path>] [--json]";
}

const parsed = parseArguments(process.argv.slice(2));
if (parsed === undefined) {
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 64;
} else {
  const result = await auditContextCoverage(parsed.workspaceRoot ?? "", {
    ...(parsed.manifestPath === undefined ? {} : { manifestPath: parsed.manifestPath }),
  });
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    const status = result.valid ? "valid" : "incomplete";
    process.stdout.write(
      `Pointable Context coverage ${status}: ${result.summary.available}/${result.summary.expected} available\n`,
    );
    process.stdout.write(
      `coverage=${result.summary.coverageRate} omission=${result.summary.omissionRate} projection_failure=${result.summary.projectionFailureRate} redundancy=${result.summary.redundancyRate}\n`,
    );
    for (const issue of result.issues) {
      process.stdout.write(
        `- ${issue.code}${issue.key === undefined ? "" : `: ${issue.key}`}\n`,
      );
    }
  }
  process.exitCode = result.valid ? 0 : 2;
}

#!/usr/bin/env node
import { resolve } from "node:path";
import { auditCodexBuildQualification } from "./codex-build-qualification.js";

interface Arguments {
  workspaceRoot?: string;
  recordPath?: string;
  rendererBundlePath?: string;
  expectedHostPackageVersion?: string;
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
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) return undefined;
    if (value === "--workspace-root" && parsed.workspaceRoot === undefined) parsed.workspaceRoot = resolve(next);
    else if (value === "--record" && parsed.recordPath === undefined) parsed.recordPath = next;
    else if (value === "--renderer-bundle" && parsed.rendererBundlePath === undefined) parsed.rendererBundlePath = next;
    else if (value === "--host-version" && parsed.expectedHostPackageVersion === undefined) parsed.expectedHostPackageVersion = next;
    else return undefined;
    index += 1;
  }
  return parsed.workspaceRoot === undefined ? undefined : parsed;
}

function usage(): string {
  return "Usage: pointable-context-compatibility --workspace-root <path> [--record <path>] [--renderer-bundle <path>] [--host-version <version>] [--json]";
}

const parsed = parseArguments(process.argv.slice(2));
if (parsed === undefined) {
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 64;
} else {
  const result = await auditCodexBuildQualification(parsed.workspaceRoot ?? "", {
    ...(parsed.recordPath === undefined ? {} : { recordPath: parsed.recordPath }),
    ...(parsed.rendererBundlePath === undefined ? {} : { rendererBundlePath: parsed.rendererBundlePath }),
    ...(parsed.expectedHostPackageVersion === undefined ? {} : {
      expectedHostPackageVersion: parsed.expectedHostPackageVersion,
    }),
  });
  if (parsed.json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    process.stdout.write(`Codex Desktop compatibility: ${result.qualification}\n`);
    process.stdout.write(
      `automatic=${result.automaticQualified ? "qualified" : "not-qualified"} manual=${result.manual.passed}/${result.manual.total} passed, ${result.manual.pending} pending\n`,
    );
  }
  process.exitCode = result.qualification === "qualified" ? 0 :
    result.qualification === "manual_pending" ? 2 : 3;
}

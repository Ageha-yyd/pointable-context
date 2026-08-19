#!/usr/bin/env node
import { resolve } from "node:path";
import { assignmentForSlot, validateStudyPack } from "./study-pack.js";

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

const argv = process.argv.slice(2);
const command = argv[0];
const repository = option(argv, "--repository-root");
const json = argv.includes("--json");

if (
  (command !== "validate" && command !== "assignment") ||
  repository === undefined ||
  !json
) {
  process.stderr.write(
    "Usage: pointable-context-study <validate|assignment> --repository-root <path> [--slot 1] --json\n",
  );
  process.exitCode = 64;
} else if (command === "validate") {
  const result = await validateStudyPack(resolve(repository));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.valid ? 0 : 2;
} else {
  const slot = Number(option(argv, "--slot"));
  try {
    const validation = await validateStudyPack(resolve(repository));
    if (!validation.valid) {
      process.stdout.write(`${JSON.stringify(validation)}\n`);
      process.exitCode = 2;
    } else {
      process.stdout.write(`${JSON.stringify({
        ...assignmentForSlot(slot),
        packDigest: validation.packDigest,
      })}\n`);
    }
  } catch {
    process.stderr.write("Invalid study slot; expected an integer from 1 through 12.\n");
    process.exitCode = 64;
  }
}

#!/usr/bin/env node
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");
const fixtureRoot = join(packageRoot, "fixtures", "evaluation-study-v2");
const studyId = "pointable-context-study-v2";
const scenarios = new Set(["TRAIN-1", "RESUME-1", "HANDOFF-1", "CONCEPT-1", "DECISION-1", "STALE-1", "VERIFY-1"]);

function usage() {
  return "Usage: node scripts/prepare-study-v2-workspace.mjs prepare --scenario <id> --language <zh-CN|en-US> --destination <absolute-new-path>";
}

function argumentsFor(argv) {
  if (argv[0] !== "prepare") return undefined;
  const scenarioIndex = argv.indexOf("--scenario");
  const destinationIndex = argv.indexOf("--destination");
  const languageIndex = argv.indexOf("--language");
  const scenarioId = argv[scenarioIndex + 1];
  const destination = argv[destinationIndex + 1];
  const language = argv[languageIndex + 1];
  if (
    scenarioIndex < 0 || destinationIndex < 0 || languageIndex < 0 || argv.length !== 7 ||
    !scenarios.has(scenarioId) || (language !== "zh-CN" && language !== "en-US") || !isAbsolute(destination)
  ) return undefined;
  return { scenarioId, language, destination: resolve(destination) };
}

function inside(parent, target) {
  const value = relative(parent, target);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

async function git(root, ...args) {
  await execFileAsync("git", args, {
    cwd: root,
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 256 * 1024,
  });
}

async function prepare({ scenarioId, language, destination }) {
  if (inside(packageRoot, destination) || inside(destination, packageRoot)) {
    throw new Error("study workspace must remain outside the downloaded package");
  }
  try {
    const existing = await stat(destination);
    if (!existing.isDirectory() || (await readdir(destination)).length !== 0) {
      throw new Error("destination must be new or empty");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "destination must be new or empty") throw error;
    if (error?.code !== "ENOENT") throw error;
    await mkdir(destination, { recursive: true });
  }
  const source = join(fixtureRoot, scenarioId);
  const canonicalSource = await realpath(source);
  if (!inside(fixtureRoot, canonicalSource)) throw new Error("scenario escapes the frozen fixture root");
  const suffix = language === "zh-CN" ? ".zh-CN" : "";
  await cp(join(canonicalSource, `workspace${suffix}`), destination, { recursive: true, errorOnExist: true });
  await cp(join(canonicalSource, `transcript${suffix}.md`), join(destination, "FROZEN_CHAT.md"), { errorOnExist: true });
  await writeFile(join(destination, "answer.txt"), "UNANSWERED\n", { flag: "wx" });
  await writeFile(join(destination, ".pointable-study.json"), `${JSON.stringify({
    schemaVersion: 2,
    studyId,
    scenarioId,
    language,
  }, null, 2)}\n`, { flag: "wx" });
  await git(destination, "init", "--quiet");
  await git(destination, "config", "user.email", "pointable-study@example.invalid");
  await git(destination, "config", "user.name", "Pointable Context Study");
  await git(destination, "add", "--", ".");
  await git(destination, "commit", "--quiet", "-m", `seed frozen ${scenarioId} workspace`);
  const transcriptDigest = (await import("node:crypto")).createHash("sha256")
    .update(await readFile(join(destination, "FROZEN_CHAT.md"))).digest("hex");
  return {
    ok: true,
    studyId,
    scenarioId,
    language,
    workspaceRoot: await realpath(destination),
    transcriptDigest,
  };
}

const parsed = argumentsFor(process.argv.slice(2));
if (parsed === undefined) {
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 64;
} else {
  try {
    process.stdout.write(`${JSON.stringify(await prepare(parsed))}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: "study_v2_workspace_error",
      message: error instanceof Error ? error.message : "unknown error",
    })}\n`);
    process.exitCode = 2;
  }
}

#!/usr/bin/env node
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const fixtureRoot = join(repositoryRoot, "fixtures", "evaluation-study-v1");
const studyId = "pointable-context-study-v1";

function usage() {
  return [
    "Usage:",
    "  node scripts/prepare-evaluation-workspace.mjs prepare --destination <absolute-path>",
    "  node scripts/prepare-evaluation-workspace.mjs mutate --workspace-root <absolute-path>",
  ].join("\n");
}

function parseArguments(argv) {
  if (argv.length !== 3) return undefined;
  const [command, flag, value] = argv;
  if (command === "prepare" && flag === "--destination" && isAbsolute(value ?? "")) {
    return { command, path: resolve(value) };
  }
  if (command === "mutate" && flag === "--workspace-root" && isAbsolute(value ?? "")) {
    return { command, path: resolve(value) };
  }
  return undefined;
}

function inside(parent, target) {
  const value = relative(parent, target);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

async function copyDirectoryContents(source, destination) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) {
      await mkdir(to, { recursive: true });
      await copyDirectoryContents(from, to);
    } else if (entry.isFile()) {
      await cp(from, to, { force: true, errorOnExist: false });
    } else {
      throw new Error("study fixture contains an unsupported filesystem entry");
    }
  }
}

async function git(root, ...args) {
  await execFileAsync("git", args, {
    cwd: root,
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 512 * 1024,
  });
}

async function prepare(destination) {
  if (inside(repositoryRoot, destination) || inside(destination, repositoryRoot)) {
    throw new Error("study workspace must be outside the product repository");
  }
  try {
    const existing = await stat(destination);
    if (!existing.isDirectory() || (await readdir(destination)).length > 0) {
      throw new Error("destination must be new or empty");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "destination must be new or empty") throw error;
    if (error?.code !== "ENOENT") throw error;
    await mkdir(destination, { recursive: true });
  }

  await copyDirectoryContents(join(fixtureRoot, "baseline"), destination);
  await writeFile(join(destination, ".pointable-study.json"), `${JSON.stringify({
    schemaVersion: 1,
    studyId,
  }, null, 2)}\n`, "utf8");
  await git(destination, "init", "--quiet");
  await git(destination, "config", "user.email", "pointable-study@example.invalid");
  await git(destination, "config", "user.name", "Pointable Context Study");
  await git(destination, "add", "--", ".");
  await git(destination, "commit", "--quiet", "-m", "seed frozen study workspace");
  await copyDirectoryContents(join(fixtureRoot, "active"), destination);
  return { ok: true, command: "prepare", studyId, workspaceRoot: await realpath(destination) };
}

async function verifiedStudyWorkspace(workspaceRoot) {
  const root = await realpath(workspaceRoot);
  if (inside(repositoryRoot, root) || inside(root, repositoryRoot)) {
    throw new Error("study workspace must be outside the product repository");
  }
  const marker = JSON.parse(await readFile(join(root, ".pointable-study.json"), "utf8"));
  if (marker?.schemaVersion !== 1 || marker?.studyId !== studyId) {
    throw new Error("workspace is not a frozen Pointable Context study workspace");
  }
  return root;
}

async function mutate(workspaceRoot) {
  const root = await verifiedStudyWorkspace(workspaceRoot);
  const relativePath = join("src", "context-record-index.ts");
  const source = join(fixtureRoot, "revision", relativePath);
  const destination = join(root, relativePath);
  const expected = await readFile(source);
  const current = await readFile(destination);
  if (current.equals(expected)) {
    return { ok: true, command: "mutate", studyId, workspaceRoot: root, alreadyApplied: true };
  }
  await cp(source, destination, { force: true, errorOnExist: false });
  return { ok: true, command: "mutate", studyId, workspaceRoot: root, alreadyApplied: false };
}

const parsed = parseArguments(process.argv.slice(2));
if (parsed === undefined) {
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 64;
} else {
  try {
    const result = parsed.command === "prepare"
      ? await prepare(parsed.path)
      : await mutate(parsed.path);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: "study_workspace_error",
      message: error instanceof Error ? error.message : "unknown error",
    })}\n`);
    process.exitCode = 2;
  }
}

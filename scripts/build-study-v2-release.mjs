#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { validateStudyV2Pack } from "../dist/src/evaluation/study-v2/pack.js";

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

function usage() {
  return "Usage: node scripts/build-study-v2-release.mjs --destination <absolute-new-directory> [--zip <absolute-new-zip>]";
}

function parse(argv) {
  if (argv[0] === "--") argv = argv.slice(1);
  const destinationIndex = argv.indexOf("--destination");
  const zipIndex = argv.indexOf("--zip");
  const destination = argv[destinationIndex + 1];
  const zip = zipIndex < 0 ? undefined : argv[zipIndex + 1];
  const expected = zip === undefined ? 2 : 4;
  if (
    destinationIndex < 0 || argv.length !== expected || !isAbsolute(destination) ||
    (zip !== undefined && (!isAbsolute(zip) || !zip.toLowerCase().endsWith(".zip")))
  ) return undefined;
  return { destination: resolve(destination), ...(zip === undefined ? {} : { zip: resolve(zip) }) };
}

function contained(root, target) {
  const value = relative(root, target);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

async function ensureNewDirectory(path) {
  try {
    await stat(path);
    throw new Error("release destination already exists");
  } catch (error) {
    if (error instanceof Error && error.message === "release destination already exists") throw error;
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(path, { recursive: false });
}

async function copyFile(source, destination) {
  const input = resolve(repositoryRoot, source);
  if (!contained(repositoryRoot, input)) throw new Error("release source escapes repository");
  await mkdir(dirname(destination), { recursive: true });
  await cp(input, destination, { recursive: true, errorOnExist: true });
}

async function filesBelow(root, current = root) {
  const result = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(root, path));
    else if (entry.isFile()) result.push(path);
    else throw new Error("release contains unsupported filesystem entry");
  }
  return result;
}

async function build({ destination, zip }) {
  const pack = await validateStudyV2Pack(repositoryRoot);
  if (!pack.valid || pack.packDigest === undefined) {
    throw new Error(`study-v2 pack is invalid: ${JSON.stringify(pack.issues)}`);
  }
  await ensureNewDirectory(destination);
  const sources = [
    ["study-dist/pointable-study.mjs", "bin/pointable-study.mjs"],
    ["docs/evaluation/study-v2", "docs/evaluation/study-v2"],
    ["docs/compatibility", "docs/compatibility"],
    ["docs/evidence/codex-compatibility-26.810.7004.0.txt", "docs/evidence/codex-compatibility-26.810.7004.0.txt"],
    ["docs/evidence/codex-compatibility-26.814.5517.0.txt", "docs/evidence/codex-compatibility-26.814.5517.0.txt"],
    ["docs/evidence/codex-compatibility-26.814.5517.0-manual.txt", "docs/evidence/codex-compatibility-26.814.5517.0-manual.txt"],
    ["docs/evidence/study-v2-native-questionnaire-acceptance-2026-08-20.txt", "docs/evidence/study-v2-native-questionnaire-acceptance-2026-08-20.txt"],
    ["fixtures/evaluation-study-v2", "fixtures/evaluation-study-v2"],
    ["scripts/prepare-study-v2-workspace.mjs", "scripts/prepare-study-v2-workspace.mjs"],
    ["scripts/launch-study-codex.mjs", "scripts/launch-study-codex.mjs"],
    ["START-STUDY-SETUP.cmd", "START-STUDY-SETUP.cmd"],
    ["SETUP-EXPERIMENT.cmd", "SETUP-EXPERIMENT.cmd"],
    [".agents", ".agents"],
    [".codex-plugin", "plugin/.codex-plugin"],
    [".mcp.json", "plugin/.mcp.json"],
    ["skills", "plugin/skills"],
    ["mcp/server.mjs", "plugin/mcp/server.mjs"],
    ["host/workspace-companion.mjs", "plugin/host/workspace-companion.mjs"],
    ["host/workspace-companion.mjs", "host/workspace-companion.mjs"],
  ];
  for (const [source, target] of sources) await copyFile(source, join(destination, target));
  const releaseMarketplacePath = join(destination, ".agents", "plugins", "marketplace.json");
  const releaseMarketplace = JSON.parse(await readFile(releaseMarketplacePath, "utf8"));
  if (releaseMarketplace?.plugins?.[0]?.name !== "pointable-context" ||
    releaseMarketplace.plugins[0]?.source?.path !== ".") {
    throw new Error("study marketplace source contract is invalid");
  }
  releaseMarketplace.plugins[0].source.path = "./plugin";
  await writeFile(releaseMarketplacePath, `${JSON.stringify(releaseMarketplace, null, 2)}\n`);
  const files = await filesBelow(destination);
  const hashes = {};
  for (const file of files.sort()) {
    const name = relative(destination, file).split(sep).join("/");
    hashes[name] = createHash("sha256").update(await readFile(file)).digest("hex");
  }
  const releaseManifest = {
    schemaVersion: 1,
    studyId: "pointable-context-study-v2",
    status: "prototype_not_for_data_collection",
    packDigest: pack.packDigest,
    generatedAt: new Date().toISOString(),
    runtime: "Node.js 24 or newer; single-file Windows executable not yet qualified",
    files: hashes,
  };
  await writeFile(join(destination, "release-manifest.json"), `${JSON.stringify(releaseManifest, null, 2)}\n`, { flag: "wx" });
  await writeFile(join(destination, "checksums.txt"), `${Object.entries(hashes)
    .map(([name, digest]) => `${digest}  ${name}`).join("\n")}\n`, { flag: "wx" });
  if (zip !== undefined) {
    try {
      await stat(zip);
      throw new Error("release zip already exists");
    } catch (error) {
      if (error instanceof Error && error.message === "release zip already exists") throw error;
      if (error?.code !== "ENOENT") throw error;
    }
    await execFileAsync("tar.exe", ["-a", "-c", "-f", zip, "-C", dirname(destination), join(".", destination.split(sep).at(-1) ?? "")], {
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 256 * 1024,
    });
  }
  return { ok: true, destination, ...(zip === undefined ? {} : { zip }), packDigest: pack.packDigest };
}

const parsed = parse(process.argv.slice(2));
if (parsed === undefined) {
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 64;
} else {
  try {
    process.stdout.write(`${JSON.stringify(await build(parsed))}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: "study_v2_release_error",
      message: error instanceof Error ? error.message : "unknown error",
    })}\n`);
    process.exitCode = 2;
  }
}

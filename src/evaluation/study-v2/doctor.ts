import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { auditCodexBuildQualification } from "../../compatibility/codex-build-qualification.js";
import {
  discoverCodexAppTargets,
  type PointableFetch,
} from "../../host/codex-cdp/targets.js";
import { STUDY_V2_ID } from "./contracts.js";
import { validateStudyV2Pack } from "./pack.js";

const execFileAsync = promisify(execFile);

export interface StudyV2DoctorResult {
  schemaVersion: 2;
  studyId: typeof STUDY_V2_ID;
  ready: boolean;
  platform: string;
  arch: string;
  nodeVersion: string;
  codexPackageVersion?: string;
  packDigest?: string;
  gates: {
    windowsX64: boolean;
    nodeRuntime: boolean;
    packIntegrity: boolean;
    codexBuildQualified: boolean;
    codexLoopbackAvailable: boolean;
    githubCliAvailable: boolean;
  };
  issues: readonly string[];
  actions: readonly StudyV2DoctorAction[];
}

export interface StudyV2DoctorAction {
  issue: string;
  owner: "participant" | "organizer";
  action: string;
}

export interface StudyV2DoctorOptions {
  endpoint?: string;
  fetch?: PointableFetch;
}

export function studyV2DoctorActions(issues: readonly string[]): readonly StudyV2DoctorAction[] {
  const actions: StudyV2DoctorAction[] = [];
  const add = (issue: string, owner: StudyV2DoctorAction["owner"], action: string): void => {
    if (issues.includes(issue)) actions.push(Object.freeze({ issue, owner, action }));
  };
  add("unsupported_platform", "participant", "Use the organizer-qualified Windows x64 environment.");
  add("node_24_or_newer_required", "participant", "Install Node.js 24 or newer, then rerun START-STUDY-SETUP.cmd.");
  add("study_pack_invalid", "participant", "Delete this copy and redownload the organizer's exact release; do not repair study files locally.");
  add("codex_package_unavailable", "participant", "Install the organizer-qualified Codex Desktop package.");
  add("codex_loopback_unavailable", "participant", "Fully exit Codex, then run START-STUDY-SETUP.cmd before opening the setup task.");
  add("codex_build_not_qualified", "organizer", "Qualify this exact Codex package and renderer digest; an older build record cannot be reused.");
  add("github_cli_unavailable_for_submission", "participant", "Install GitHub CLI before submission or use the organizer's non-GitHub intake route; local practice may continue.");
  return Object.freeze(actions);
}

async function commandAvailable(command: string, args: readonly string[]): Promise<boolean> {
  try {
    await execFileAsync(command, [...args], {
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

async function installedCodexPackageVersion(): Promise<string | undefined> {
  if (process.platform !== "win32") return undefined;
  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$p=Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1; if($null -ne $p){$p.Version.ToString()}",
    ], {
      windowsHide: true,
      timeout: 8_000,
      maxBuffer: 64 * 1024,
    });
    const value = stdout.trim();
    return /^\d+(?:\.\d+){3}$/u.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function runStudyV2Doctor(
  repositoryRoot: string,
  options: StudyV2DoctorOptions = {},
): Promise<StudyV2DoctorResult> {
  const issues: string[] = [];
  const windowsX64 = process.platform === "win32" && process.arch === "x64";
  if (!windowsX64) issues.push("unsupported_platform");
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  const nodeRuntime = Number.isSafeInteger(major) && major >= 24;
  if (!nodeRuntime) issues.push("node_24_or_newer_required");
  const pack = await validateStudyV2Pack(repositoryRoot);
  if (!pack.valid) issues.push("study_pack_invalid");
  const codexPackageVersion = await installedCodexPackageVersion();
  if (codexPackageVersion === undefined) issues.push("codex_package_unavailable");
  const qualification = codexPackageVersion === undefined
    ? undefined
    : await auditCodexBuildQualification(repositoryRoot, {
      expectedHostPackageVersion: codexPackageVersion,
      rendererBundlePath: "host/workspace-companion.mjs",
    });
  const codexBuildQualified = qualification?.qualification === "qualified";
  if (!codexBuildQualified) issues.push("codex_build_not_qualified");
  let codexLoopbackAvailable = false;
  try {
    const targets = await discoverCodexAppTargets(options.endpoint ?? "http://127.0.0.1:9223", {
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      timeoutMs: 1_500,
    });
    codexLoopbackAvailable = targets.length === 1;
  } catch {
    codexLoopbackAvailable = false;
  }
  if (!codexLoopbackAvailable) issues.push("codex_loopback_unavailable");
  const githubCliAvailable = await commandAvailable("gh", ["--version"]);
  if (!githubCliAvailable) issues.push("github_cli_unavailable_for_submission");
  const actions = studyV2DoctorActions(issues);
  return Object.freeze({
    schemaVersion: 2 as const,
    studyId: STUDY_V2_ID,
    ready: windowsX64 && nodeRuntime && pack.valid && codexBuildQualified && codexLoopbackAvailable,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    ...(codexPackageVersion === undefined ? {} : { codexPackageVersion }),
    ...(pack.packDigest === undefined ? {} : { packDigest: pack.packDigest }),
    gates: Object.freeze({
      windowsX64,
      nodeRuntime,
      packIntegrity: pack.valid,
      codexBuildQualified,
      codexLoopbackAvailable,
      githubCliAvailable,
    }),
    issues: Object.freeze(issues),
    actions,
  });
}

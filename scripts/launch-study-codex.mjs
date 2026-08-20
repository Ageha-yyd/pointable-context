#!/usr/bin/env node
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const endpoint = "http://127.0.0.1:9223";

function emit(result, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = exitCode;
}

async function exactTargetAvailable() {
  try {
    const response = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return false;
    const targets = await response.json();
    return Array.isArray(targets) && targets.filter((target) =>
      target?.type === "page" && target?.url === "app://-/index.html" &&
      typeof target?.webSocketDebuggerUrl === "string" &&
      target.webSocketDebuggerUrl.startsWith("ws://127.0.0.1:9223/")
    ).length === 1;
  } catch {
    return false;
  }
}

async function packageInfo() {
  const command = [
    "$p=Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1;",
    "if($null -eq $p){exit 3};",
    "[pscustomobject]@{version=$p.Version.ToString();installLocation=$p.InstallLocation}|ConvertTo-Json -Compress",
  ].join("");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command", command,
  ], { windowsHide: true, timeout: 8_000, maxBuffer: 64 * 1024 });
  return JSON.parse(stdout);
}

async function primaryCodexRunning() {
  const command = [
    "$p=Get-CimInstance Win32_Process -Filter \"Name='ChatGPT.exe'\" | ",
    "Where-Object {$_.CommandLine -notmatch '--type='};",
    "if(@($p).Count -gt 0){'true'}else{'false'}",
  ].join("");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command", command,
  ], { windowsHide: true, timeout: 8_000, maxBuffer: 64 * 1024 });
  return stdout.trim() === "true";
}

async function waitForTarget() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if (await exactTargetAvailable()) return true;
    } catch {
      // Codex is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

if (process.platform !== "win32" || process.arch !== "x64") {
  emit({ ok: false, code: "unsupported_platform", required: "Windows x64" }, 2);
} else {
  try {
    if (await exactTargetAvailable()) {
      const info = await packageInfo();
      emit({ ok: true, code: "codex_study_host_ready", codexPackageVersion: info.version, endpoint });
    } else if (await primaryCodexRunning()) {
      emit({
        ok: false,
        code: "codex_restart_required",
        action: "Fully exit Codex, then double-click START-STUDY-SETUP.cmd again.",
      }, 2);
    } else {
      const info = await packageInfo();
      const executable = join(info.installLocation, "app", "ChatGPT.exe");
      spawn(executable, [
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=9223",
      ], { detached: true, stdio: "ignore", windowsHide: false }).unref();
      if (!(await waitForTarget())) {
        emit({ ok: false, code: "codex_loopback_start_timeout", endpoint }, 2);
      } else {
        emit({ ok: true, code: "codex_study_host_started", codexPackageVersion: info.version, endpoint });
      }
    }
  } catch (error) {
    emit({
      ok: false,
      code: "codex_study_host_setup_failed",
      message: error instanceof Error ? error.message : "unknown error",
    }, 2);
  }
}

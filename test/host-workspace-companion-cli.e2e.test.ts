import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const entrypoint = resolve("dist/src/host/codex-cdp/workspace-companion-cli.js");

async function runCli(
  command: "start" | "status" | "stop",
  stateDir: string,
  registry: string,
  endpoint: string,
): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync(process.execPath, [
    entrypoint,
    command,
    "--state-dir",
    stateDir,
    "--registry",
    registry,
    "--endpoint",
    endpoint,
    "--refresh-ms",
    "100",
    "--json",
  ], { cwd: process.cwd(), timeout: 15_000, windowsHide: true });
  return JSON.parse(stdout) as Record<string, unknown>;
}

test("detached workspace companion supports lifecycle without guessing an active task", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-workspace-cli-"));
  const stateDir = join(root, "state");
  const registry = join(root, "bindings.json");
  const debugServer = createServer((request, response) => {
    if (request.url !== "/json/list") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end("[]");
  });
  debugServer.listen({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolveListen) => debugServer.once("listening", resolveListen));
  const address = debugServer.address();
  if (address === null || typeof address === "string") throw new Error("test server unavailable");
  const endpoint = `http://127.0.0.1:${address.port}`;
  try {
    const started = await runCli("start", stateDir, registry, endpoint);
    assert.equal(started.ok, true);
    assert.equal(started.alreadyRunning, false);
    const status = await runCli("status", stateDir, registry, endpoint);
    const companion = status.companion as Record<string, unknown>;
    assert.equal(companion.state, "running");
    assert.equal(companion.mode, "live-local-workspace");
    assert.equal(companion.activeTaskCount, 0);
    const stopped = await runCli("stop", stateDir, registry, endpoint);
    assert.equal(stopped.stopped, true);
    assert.equal(stopped.wasRunning, true);
    await assert.rejects(readFile(join(stateDir, "state.json"), "utf8"));
  } finally {
    await runCli("stop", stateDir, registry, endpoint).catch(() => undefined);
    await new Promise<void>((resolveClose) => debugServer.close(() => resolveClose()));
    await rm(root, { recursive: true, force: true });
  }
});

test("bundled workspace companion starts from an installed layout without source files", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-workspace-package-"));
  const host = join(root, "host");
  const stateDir = join(root, "state");
  const registry = join(root, "bindings.json");
  await mkdir(host, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "pointable-context-installed-layout",
    type: "module",
  }), "utf8");
  await copyFile(
    resolve("host/workspace-companion.mjs"),
    join(host, "workspace-companion.mjs"),
  );

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      join(host, "workspace-companion.mjs"),
      "status",
      "--state-dir",
      stateDir,
      "--registry",
      registry,
      "--json",
    ], { cwd: root, timeout: 15_000, windowsHide: true });
    const status = JSON.parse(stdout) as Record<string, unknown>;
    assert.equal(status.ok, true);
    assert.equal(status.stopped, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

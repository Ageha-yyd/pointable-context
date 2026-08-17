import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const entrypoint = resolve("dist/src/host/codex-cdp/fixture-companion-cli.js");
const fixtureRoot = resolve("fixtures/mini-project");

async function runCli(
  command: "start" | "status" | "stop",
  stateDir: string,
  endpoint: string,
): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync(process.execPath, [
    entrypoint,
    command,
    "--state-dir",
    stateDir,
    "--endpoint",
    endpoint,
    "--fixture-root",
    fixtureRoot,
    "--refresh-ms",
    "100",
    "--json",
  ], {
    cwd: process.cwd(),
    timeout: 15_000,
    windowsHide: true,
  });
  return JSON.parse(stdout) as Record<string, unknown>;
}

test("detached fixture companion supports start, status, idempotent start, and graceful stop", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pointable-companion-"));
  let discoveryCalls = 0;
  const debugServer = createServer((request, response) => {
    if (request.url !== "/json/list") {
      response.writeHead(404).end();
      return;
    }
    discoveryCalls += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end("[]");
  });
  debugServer.listen({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolveListen) => debugServer.once("listening", resolveListen));
  const address = debugServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("debug test server did not bind TCP");
  }
  const endpoint = `http://127.0.0.1:${address.port}`;

  try {
    const started = await runCli("start", stateDir, endpoint);
    assert.equal(started.ok, true);
    assert.equal(started.fixtureOnly, true);
    assert.equal(started.alreadyRunning, false);
    assert.ok(discoveryCalls >= 1);

    const status = await runCli("status", stateDir, endpoint);
    const companion = status.companion as Record<string, unknown>;
    const adapter = companion.adapter as Record<string, unknown>;
    assert.equal(companion.state, "running");
    assert.equal(adapter.targetCount, 0);

    const secondStart = await runCli("start", stateDir, endpoint);
    assert.equal(secondStart.alreadyRunning, true);

    const stopped = await runCli("stop", stateDir, endpoint);
    assert.equal(stopped.stopped, true);
    assert.equal(stopped.wasRunning, true);
    const inactive = await runCli("status", stateDir, endpoint);
    assert.equal(inactive.stopped, true);
    await assert.rejects(readFile(join(stateDir, "state.json"), "utf8"));
  } finally {
    await runCli("stop", stateDir, endpoint).catch(() => undefined);
    await new Promise<void>((resolveClose) => debugServer.close(() => resolveClose()));
    await rm(stateDir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { WebSocketServer } from "ws";

const execFileAsync = promisify(execFile);
const entrypoint = resolve("dist/src/host/codex-cdp/workspace-companion-cli.js");

async function runCli(
  command:
    | "start"
    | "status"
    | "stop"
    | "bind"
    | "object-list"
    | "object-audit"
    | "object-review"
    | "object-archive"
    | "milestone-observe"
    | "milestone-summary",
  stateDir: string,
  registry: string,
  endpoint: string,
  extra: string[] = [],
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
    ...extra,
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
    assert.equal(companion.presentationMode, "mental-model");
    assert.equal(companion.activeTaskCount, 0);
    const compatibility = companion.compatibility as Record<string, unknown>;
    assert.equal(compatibility.state, "incompatible");
    assert.equal(compatibility.code, "qualified_target_missing");
    await assert.rejects(
      () => runCli("object-list", stateDir, registry, endpoint),
      /active_codex_task_unavailable/u,
    );
    await assert.rejects(
      () => runCli("object-audit", stateDir, registry, endpoint),
      /active_codex_task_unavailable/u,
    );
    const reviewFile = join(root, "review.json");
    await writeFile(reviewFile, JSON.stringify({
      schemaVersion: 1,
      milestoneKey: "CLI-REVIEW-1",
      needs: [{ term: "Pilot", expectedEntityType: "concept", needKind: "understand" }],
    }), "utf8");
    await assert.rejects(
      () => runCli("object-review", stateDir, registry, endpoint, ["--review-file", reviewFile]),
      /active_codex_task_unavailable/u,
    );
    await assert.rejects(
      () => runCli("milestone-observe", stateDir, registry, endpoint, ["--review-file", reviewFile]),
      /active_codex_task_unavailable/u,
    );
    await assert.rejects(
      () => runCli("milestone-summary", stateDir, registry, endpoint),
      /active_codex_task_unavailable/u,
    );
    await assert.rejects(
      () => runCli("object-archive", stateDir, registry, endpoint),
      /active_codex_task_unavailable/u,
    );
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

test("detached workspace companion survives an invalid milestone review", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-workspace-invalid-review-"));
  const workspace = join(root, "workspace");
  const stateDir = join(root, "state");
  const registry = join(root, "bindings.json");
  await mkdir(workspace);
  await writeFile(join(workspace, "README.md"), "# Replay workspace\n", "utf8");

  let webSocketUrl = "";
  let bindingName = "";
  const seenMethods: string[] = [];
  const seenExpressions: string[] = [];
  const debugServer = createServer((request, response) => {
    if (request.url !== "/json/list") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify([{
      id: "desktop-main",
      type: "page",
      title: "Codex",
      url: "app://-/index.html",
      webSocketDebuggerUrl: webSocketUrl,
    }]));
  });
  const webSockets = new WebSocketServer({ server: debugServer });
  webSockets.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as {
        id: number;
        method: string;
        params?: Record<string, unknown>;
      };
      seenMethods.push(message.method);
      let result: Record<string, unknown> = {};
      if (message.method === "Page.getFrameTree") {
        result = { frameTree: { frame: { id: "main", url: "app://-/index.html" } } };
      } else if (message.method === "Runtime.addBinding") {
        bindingName = String(message.params?.name ?? "");
      } else if (message.method === "Runtime.evaluate") {
        const expression = String(message.params?.expression ?? "");
        seenExpressions.push(expression.slice(0, 240));
        const value = expression.includes("evaluatePointableRendererEligibility")
          ? {
              installed: true,
              bindingName,
              lifecycleId: "lifecycle-e2e",
              state: "idle",
            }
          : expression.includes("data-app-action-sidebar-thread-active")
            ? {
                schemaVersion: 1,
                host: "codex-desktop",
                threadId: "thread-e2e",
                hostId: "host-e2e",
                routeRef: "app://-/index.html",
                contextFingerprint:
                  '{"href":"app://-/index.html","threadId":"thread-e2e","hostId":"host-e2e"}',
              }
            : null;
        result = { result: { value } };
      }
      if (message.method === "Runtime.enable") {
        socket.send(JSON.stringify({
          method: "Runtime.executionContextCreated",
          params: { context: { id: 1, auxData: { isDefault: true, frameId: "main" } } },
        }));
      }
      socket.send(JSON.stringify({ id: message.id, result }));
    });
  });
  debugServer.listen({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolveListen) => debugServer.once("listening", resolveListen));
  const address = debugServer.address();
  if (address === null || typeof address === "string") throw new Error("test server unavailable");
  const endpoint = `http://127.0.0.1:${address.port}`;
  webSocketUrl = `ws://127.0.0.1:${address.port}/devtools/page/desktop-main`;

  const invalidReview = join(root, "invalid-review.json");
  const compatibilityReview = join(root, "compatibility-review.json");
  await writeFile(invalidReview, JSON.stringify({
    schemaVersion: 1,
    milestoneKey: "INVALID-1",
    needs: [{ term: "README.md", expectedEntityType: "document", needKind: "unsupported" }],
  }), "utf8");
  await writeFile(compatibilityReview, JSON.stringify({
    schemaVersion: 1,
    milestoneKey: "COMPATIBILITY-1",
    needs: [{ term: "README.md", expectedEntityType: "document", needKind: "understanding" }],
  }), "utf8");

  try {
    const started = await runCli("start", stateDir, registry, endpoint);
    assert.equal(
      ((started.companion as Record<string, unknown>).activeTaskCount),
      1,
      `CDP methods: ${seenMethods.join(",")}; expressions=${JSON.stringify(seenExpressions)}; status=${JSON.stringify(started)}`,
    );
    await runCli("bind", stateDir, registry, endpoint, ["--workspace-root", workspace]);
    await assert.rejects(
      () => runCli("milestone-observe", stateDir, registry, endpoint, [
        "--review-file",
        invalidReview,
      ]),
      /needKind is invalid/u,
    );
    const afterInvalid = await runCli("status", stateDir, registry, endpoint);
    assert.equal((afterInvalid.companion as Record<string, unknown>).state, "running");
    const observed = await runCli("milestone-observe", stateDir, registry, endpoint, [
      "--review-file",
      compatibilityReview,
    ]);
    const event = observed.event as Record<string, unknown>;
    const needs = event.needs as Array<Record<string, unknown>>;
    assert.equal(needs[0]?.needKind, "understand");
    assert.equal((await runCli("status", stateDir, registry, endpoint)).ok, true);
  } finally {
    await runCli("stop", stateDir, registry, endpoint).catch(() => undefined);
    await new Promise<void>((resolveClose) => webSockets.close(() => resolveClose()));
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

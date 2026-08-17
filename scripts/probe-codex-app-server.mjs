#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const codexCommand =
  process.env.POINTABLE_CODEX_COMMAND ??
  (process.platform === "win32"
    ? "C:\\Users\\UIA\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js"
    : "codex");
const projectCwd = new URL("..", import.meta.url).pathname;
const marketplacePath =
  process.env.POINTABLE_MARKETPLACE_PATH ??
  "C:\\Users\\UIA\\.agents\\plugins\\marketplace.json";
const requestTimeoutMs = 20_000;
const widgetResourceUri = "ui://pointable-context/entity-detail-v1.html";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const launch =
  process.platform === "win32"
    ? {
        command: process.execPath,
        args: [codexCommand, "app-server"],
      }
    : { command: codexCommand, args: ["app-server"] };
const child = spawn(launch.command, launch.args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
const lines = createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;
let stderr = "";

child.stderr.on("data", (chunk) => {
  if (stderr.length < 32_768) stderr += String(chunk);
});

lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined || message.method !== undefined) return;
  const waiter = pending.get(String(message.id));
  if (!waiter) return;
  pending.delete(String(message.id));
  clearTimeout(waiter.timer);
  if (message.error) {
    waiter.reject(
      new Error(
        `${waiter.method} failed: ${message.error.message ?? JSON.stringify(message.error)}`,
      ),
    );
    return;
  }
  waiter.resolve(message.result);
});

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(String(id));
      reject(new Error(`${method} timed out after ${requestTimeoutMs}ms`));
    }, requestTimeoutMs);
    pending.set(String(id), { method, resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
  });
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ method, params })}\n`);
}

async function waitForPointableServer(threadId) {
  const deadline = Date.now() + requestTimeoutMs;
  while (Date.now() < deadline) {
    const inventory = await request("mcpServerStatus/list", {
      cursor: null,
      limit: 100,
      detail: "toolsAndAuthOnly",
      threadId,
    });
    const status = inventory.data?.find(
      (candidate) => candidate.name === "pointable-context",
    );
    const toolNames = Object.keys(status?.tools ?? {}).sort();
    if (
      status?.serverInfo &&
      toolNames.includes("resolve_project_entities") &&
      toolNames.includes("read_project_entity") &&
      toolNames.includes("render_project_entity_widget")
    ) {
      return { status, toolNames };
    }
    await delay(200);
  }
  throw new Error("pointable-context MCP server did not become ready");
}

async function main() {
  const initialized = await request("initialize", {
    clientInfo: {
      name: "pointable_context_runtime_probe",
      title: "Pointable Context Runtime Probe",
      version: "0.1.0",
    },
    capabilities: null,
  });
  notify("initialized", {});

  const pluginRead = await request("plugin/read", {
    marketplacePath,
    pluginName: "pointable-context",
  });
  assert(
    pluginRead.plugin?.summary?.installed === true,
    "plugin/read did not report pointable-context as installed",
  );
  assert(
    pluginRead.plugin?.mcpServers?.includes("pointable-context"),
    "plugin/read did not attribute pointable-context MCP to the plugin",
  );

  const threadStarted = await request("thread/start", {
    cwd: decodeURIComponent(projectCwd).replace(/^\/(.:\/)/u, "$1"),
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
    serviceName: "pointable_context_runtime_probe",
  });
  const threadId = threadStarted.thread?.id;
  assert(typeof threadId === "string" && threadId.length > 0, "thread/start failed");

  const { status, toolNames } = await waitForPointableServer(threadId);
  assert(
    status.serverInfo.name === "pointable-context-fixture-probe",
    "unexpected MCP server identity",
  );
  assert(
    JSON.stringify(status.tools?.render_project_entity_widget ?? {}).includes(
      widgetResourceUri,
    ),
    "render tool did not advertise its MCP App resource",
  );

  const resolved = await request("mcpServer/tool/call", {
    threadId,
    server: "pointable-context",
    tool: "resolve_project_entities",
    arguments: { selection: "GOV-1" },
  });
  assert(resolved.isError !== true, "resolve_project_entities returned an error");
  assert(resolved.structuredContent?.runtime === "fixture_probe", "runtime marker missing");
  assert(resolved.structuredContent?.status === "unique", "GOV-1 was not unique");
  assert(resolved._meta === undefined, "headless resolve unexpectedly returned UI metadata");
  const entityRef = resolved.structuredContent?.candidates?.[0]?.entity_ref;
  assert(typeof entityRef === "string" && entityRef.length > 0, "entity_ref missing");

  const detail = await request("mcpServer/tool/call", {
    threadId,
    server: "pointable-context",
    tool: "read_project_entity",
    arguments: { entity_ref: entityRef },
  });
  assert(detail.isError !== true, "read_project_entity returned an error");
  assert(detail.structuredContent?.status === "detail", "detail status missing");
  assert(
    detail.structuredContent?.verification?.method === "fixture_read",
    "fixture verification marker missing",
  );
  assert(detail.structuredContent?.entity?.entityId === "WU:GOV-1", "wrong entity read");
  assert(detail._meta === undefined, "headless detail unexpectedly returned UI metadata");
  const text = detail.content?.find((item) => item.type === "text")?.text ?? "";
  assert(text.includes("FIXTURE-ONLY"), "model-readable fixture warning missing");
  assert(text.includes("Verification: fixture_read"), "verification text missing");

  const rendered = await request("mcpServer/tool/call", {
    threadId,
    server: "pointable-context",
    tool: "render_project_entity_widget",
    arguments: { entity_ref: entityRef },
  });
  assert(rendered.isError !== true, "render_project_entity_widget returned an error");
  assert(rendered.structuredContent?.status === "detail", "render detail status missing");
  assert(
    rendered.structuredContent?.entity?.entityId === "WU:GOV-1",
    "render tool returned the wrong entity",
  );
  const renderedText =
    rendered.content?.find((item) => item.type === "text")?.text ?? "";
  assert(renderedText.includes("FIXTURE-ONLY"), "render text fallback warning missing");

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        codexUserAgent: initialized.userAgent ?? null,
        pluginId: pluginRead.plugin.summary.id,
        pluginVersion: pluginRead.plugin.summary.localVersion,
        server: status.name,
        serverInfo: status.serverInfo,
        tools: toolNames,
        resolveStatus: resolved.structuredContent.status,
        detailEntityId: detail.structuredContent.entity.entityId,
        renderEntityId: rendered.structuredContent.entity.entityId,
        verification: detail.structuredContent.verification,
        fixtureWarningPresent: true,
        dataToolUiMetadataPresent: false,
        renderToolUiResource: widgetResourceUri,
        renderTextFallbackPresent: true,
      },
      null,
      2,
    )}\n`,
  );
}

let failed = false;
try {
  await main();
} catch (error) {
  failed = true;
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  if (stderr.trim()) process.stderr.write(`app-server stderr:\n${stderr.trim()}\n`);
} finally {
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error("app-server probe closed"));
  }
  pending.clear();
  child.stdin.end();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  await Promise.race([exited, delay(2_000)]);
  if (child.exitCode === null) child.kill();
}

if (failed) process.exitCode = 1;

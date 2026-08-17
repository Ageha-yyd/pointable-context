import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectCdpWebSocket } from "../dist/src/host/codex-cdp/index.js";
import { POINTABLE_ENTITY_WIDGET_HTML } from "../dist/src/mcp/entity-widget.js";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profile = await mkdtemp(join(tmpdir(), "pointable-widget-edge-"));
const pageServer = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end("<!doctype html><html><body></body></html>");
});
pageServer.listen({ host: "127.0.0.1", port: 0 });
await new Promise((resolveListen) => pageServer.once("listening", resolveListen));
const address = pageServer.address();
if (address === null || typeof address === "string") {
  throw new Error("widget acceptance server did not bind TCP");
}

const child = spawn(edgePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  `http://127.0.0.1:${address.port}/`,
], { stdio: "ignore", windowsHide: true });

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function debuggerPort() {
  const path = join(profile, "DevToolsActivePort");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const port = Number((await readFile(path, "utf8")).split(/\r?\n/u)[0]);
      if (Number.isSafeInteger(port) && port > 0 && port <= 65_535) return port;
    } catch {
      // Edge has not published the endpoint yet.
    }
    await delay(50);
  }
  throw new Error("headless Edge did not publish DevToolsActivePort");
}

function runtimeValue(response) {
  if (response?.exceptionDetails !== undefined || response?.result === undefined) {
    throw new Error(`Runtime.evaluate failed: ${JSON.stringify(response?.exceptionDetails ?? response)}`);
  }
  return response.result.value;
}

async function evaluate(connection, expression) {
  return runtimeValue(await connection.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }));
}

async function waitFor(connection, expression, timeoutMs = 7_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(connection, expression);
    if (value) return value;
    await delay(25);
  }
  throw new Error("widget browser acceptance timed out");
}

const toolResult = {
  ok: true,
  runtime: "fixture_probe",
  warning: "FIXTURE-ONLY probe: bundled demo data, not live project authority.",
  operation: "read_project_entity",
  status: "detail",
  projectId: "PRJ-01",
  entity: {
    entityId: "WU:GOV-1",
    entityType: "work_unit",
    label: "GOV-1",
    summary: "建立 AEN harness 基础及入口约束",
    entityRevision: "r18",
    observedAt: "2026-08-17T08:10:00Z",
    freshness: "stale",
    facts: { status: "completed", remaining: "deferred" },
    relations: [],
    sources: [{ sourceType: "query_model", sourceId: "wu_gov_1" }],
  },
  verification: { method: "fixture_read", verifiedAt: "2026-08-17T08:10:01Z" },
  error: null,
};

let connection;
try {
  const port = await debuggerPort();
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((target) => target.type === "page");
  if (page?.webSocketDebuggerUrl === undefined) throw new Error("headless page target missing");
  connection = await connectCdpWebSocket(page.webSocketDebuggerUrl);
  await connection.send("Runtime.enable");

  await evaluate(connection, `(() => {
    const iframe = document.createElement('iframe');
    iframe.id = 'widget';
    iframe.style.width = '720px';
    iframe.style.height = '620px';
    iframe.style.border = '0';
    window.__widgetMessages = [];
    window.addEventListener('message', (event) => {
      if (event.source !== iframe.contentWindow) return;
      const message = event.data;
      if (!message || message.jsonrpc !== '2.0') return;
      window.__widgetMessages.push(JSON.parse(JSON.stringify(message)));
      if (message.method === 'ui/initialize' && message.id !== undefined) {
        iframe.contentWindow.postMessage({
          jsonrpc: '2.0', id: message.id, result: {
            protocolVersion: '2026-01-26',
            hostInfo: { name: 'pointable-headless-host', version: '1' },
            hostCapabilities: { message: {}, updateModelContext: {} },
            hostContext: { theme: 'dark', displayMode: 'inline', platform: 'desktop' }
          }
        }, '*');
      }
      if (message.method === 'ui/notifications/initialized') {
        iframe.contentWindow.postMessage({
          jsonrpc: '2.0', method: 'ui/notifications/tool-result',
          params: { structuredContent: ${JSON.stringify(toolResult)} }
        }, '*');
      }
      if ((message.method === 'ui/update-model-context' || message.method === 'ui/message') && message.id !== undefined) {
        iframe.contentWindow.postMessage({ jsonrpc: '2.0', id: message.id, result: {} }, '*');
      }
    });
    document.body.style.margin = '0';
    document.body.append(iframe);
    iframe.srcdoc = ${JSON.stringify(POINTABLE_ENTITY_WIDGET_HTML)};
    return true;
  })()`);

  const control = await waitFor(connection, `(() => {
    const frame = document.getElementById('widget');
    const doc = frame?.contentDocument;
    const heading = doc?.querySelector('h1');
    const input = doc?.querySelector('input[name="question"]');
    const button = doc?.querySelector('button[type="submit"]');
    if (!heading || heading.textContent !== 'GOV-1' || !input || !button) return null;
    input.focus();
    const frameRect = frame.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return {
      x: frameRect.left + buttonRect.left + buttonRect.width / 2,
      y: frameRect.top + buttonRect.top + buttonRect.height / 2,
    };
  })()`);
  await connection.send("Input.insertText", { text: "为什么是 stale？" });
  await connection.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: control.x, y: control.y, button: "left", clickCount: 1,
  });
  await connection.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: control.x, y: control.y, button: "left", clickCount: 1,
  });

  const evidence = await waitFor(connection, `(() => {
    const messages = window.__widgetMessages ?? [];
    const context = messages.find((message) => message.method === 'ui/update-model-context');
    const followup = messages.find((message) => message.method === 'ui/message');
    if (!context || !followup) return null;
    const status = document.getElementById('widget')?.contentDocument?.querySelector('.status')?.textContent ?? '';
    if (status !== '已发送到当前任务。') return null;
    return { context: context.params, followup: followup.params, status };
  })()`);

  const followupText = evidence.followup?.content?.text ?? "";
  if (
    evidence.followup?.role !== "user" ||
    !followupText.includes("WU:GOV-1") ||
    !followupText.includes("r18") ||
    !followupText.includes("为什么是 stale？") ||
    !followupText.includes("FIXTURE-ONLY") ||
    evidence.context?.structuredContent?.entityId !== "WU:GOV-1" ||
    evidence.context?.structuredContent?.revision !== "r18"
  ) {
    throw new Error(`widget bridge evidence mismatch: ${JSON.stringify(evidence)}`);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    browser: "Microsoft Edge headless",
    renderedEntity: "WU:GOV-1",
    trustedSubmit: true,
    modelContextBound: true,
    sameConversationMessageRequested: true,
    fixtureWarningPreserved: true,
  }, null, 2)}\n`);
} finally {
  if (connection) connection.close();
  if (child.exitCode === null) {
    const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
    child.kill();
    await Promise.race([exited, delay(3_000)]);
  }
  await new Promise((resolveClose) => pageServer.close(resolveClose));
  await delay(100);
  await rm(profile, { recursive: true, force: true });
}

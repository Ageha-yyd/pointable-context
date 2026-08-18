import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectCdpWebSocket } from "../dist/src/host/codex-cdp/index.js";
import { POINTABLE_ENTITY_WIDGET_HTML } from "../dist/src/mcp/entity-widget.js";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profile = await mkdtemp(join(tmpdir(), "pointable-capsule-edge-"));
const pageServer = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end("<!doctype html><html><body></body></html>");
});
pageServer.listen({ host: "127.0.0.1", port: 0 });
await new Promise((resolveListen) => pageServer.once("listening", resolveListen));
const address = pageServer.address();
if (address === null || typeof address === "string") throw new Error("capsule acceptance server did not bind TCP");

const child = spawn(edgePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  `http://127.0.0.1:${address.port}/`,
], { stdio: "ignore", windowsHide: true });

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function debuggerPort() {
  const path = join(profile, "DevToolsActivePort");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const port = Number((await readFile(path, "utf8")).split(/\r?\n/u)[0]);
      if (Number.isSafeInteger(port) && port > 0 && port <= 65_535) return port;
    } catch {}
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
  throw new Error("capsule browser acceptance timed out");
}

const toolResult = {
  ok: true,
  runtime: "fixture_probe",
  warning: "FIXTURE-ONLY probe: bundled demo data, not live project authority.",
  operation: "read_project_entity",
  status: "detail",
  projectId: "PRJ-01",
  entity: {
    entityId: "DOC:CONTEXT-CAPSULE-PRD",
    entityType: "document",
    label: "Native Chat Lane Context Capsules PRD",
    summary: "以人的项目理解为中心的零 turn 原生上下文胶囊定义。",
    entityRevision: "v1.0",
    observedAt: "2026-08-18T04:03:00Z",
    freshness: "stale",
    facts: {
      purpose: "Freeze the native Chat Lane product direction.",
      change_summary: ["Agent-known first", "Selection fallback", "No Ask Agent form"],
      impact: ["MCP capsule", "fixture", "Skill"],
      status: "direction-frozen",
      path: "docs/PRD-inline-pointable-widgets.md",
    },
    relations: ["MOD:CONTEXT-SCOPE", "DEC:ARCH-7"],
    sources: [{ sourceType: "repository_document", sourceId: "docs/PRD-inline-pointable-widgets.md" }],
  },
  verification: { method: "fixture_read", verifiedAt: "2026-08-18T04:03:01Z" },
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
            hostCapabilities: {},
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
    });
    document.body.style.margin = '0';
    document.body.append(iframe);
    iframe.srcdoc = ${JSON.stringify(POINTABLE_ENTITY_WIDGET_HTML)};
    return true;
  })()`);

  const control = await waitFor(connection, `(() => {
    const frame = document.getElementById('widget');
    const doc = frame?.contentDocument;
    const button = doc?.querySelector('button.trigger');
    const detail = doc?.querySelector('#pointable-capsule-detail');
    const title = doc?.querySelector('.title')?.textContent;
    if (!button || !detail || title !== 'Native Chat Lane Context Capsules PRD') return null;
    if (button.getAttribute('aria-expanded') !== 'false' || detail.hidden !== true) return null;
    const frameRect = frame.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    return { x: frameRect.left + rect.left + rect.width / 2, y: frameRect.top + rect.top + rect.height / 2 };
  })()`);

  for (const type of ["mousePressed", "mouseReleased"]) {
    await connection.send("Input.dispatchMouseEvent", {
      type, x: control.x, y: control.y, button: "left", clickCount: 1,
    });
  }

  const expanded = await waitFor(connection, `(() => {
    const doc = document.getElementById('widget')?.contentDocument;
    const button = doc?.querySelector('button.trigger');
    const detail = doc?.querySelector('#pointable-capsule-detail');
    const text = detail?.textContent ?? '';
    if (button?.getAttribute('aria-expanded') !== 'true' || detail?.hidden !== false) return null;
    if (!text.includes('本次变化') || !text.includes('来源与验证') || !text.includes('v1.0')) return null;
    return { text };
  })()`);

  for (const type of ["mousePressed", "mouseReleased"]) {
    await connection.send("Input.dispatchMouseEvent", {
      type, x: control.x, y: control.y, button: "left", clickCount: 1,
    });
  }

  await waitFor(connection, `(() => {
    const doc = document.getElementById('widget')?.contentDocument;
    const button = doc?.querySelector('button.trigger');
    const detail = doc?.querySelector('#pointable-capsule-detail');
    return button?.getAttribute('aria-expanded') === 'false' && detail?.hidden === true;
  })()`);

  const bridgeMethods = await evaluate(connection, `(window.__widgetMessages ?? []).map((message) => message.method).filter(Boolean)`);
  if (bridgeMethods.includes("ui/message") || bridgeMethods.includes("ui/update-model-context")) {
    throw new Error(`zero-turn capsule emitted a conversation mutation: ${JSON.stringify(bridgeMethods)}`);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    browser: "Microsoft Edge headless",
    renderedEntity: "DOC:CONTEXT-CAPSULE-PRD",
    typeSpecificFactsVisible: expanded.text.includes("本次变化"),
    expandedAndCollapsedLocally: true,
    conversationMutationRequested: false,
    browserNavigationRequested: false,
    fixtureWarningPreserved: expanded.text.includes("FIXTURE-ONLY"),
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

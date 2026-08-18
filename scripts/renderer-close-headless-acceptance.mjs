import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  connectCdpWebSocket,
  createDeliverPointableResultExpression,
  createInstallPointableRendererExpression,
  createPointableLookupResponse,
  createUninstallPointableRendererExpression,
  parsePointableLookupIntent,
} from "../dist/src/host/codex-cdp/index.js";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profile = await mkdtemp(join(tmpdir(), "pointable-edge-"));
const pageServer = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end("<!doctype html><html><body></body></html>");
});
pageServer.listen({ host: "127.0.0.1", port: 0 });
await new Promise((resolveListen) => pageServer.once("listening", resolveListen));
const pageAddress = pageServer.address();
if (pageAddress === null || typeof pageAddress === "string") {
  throw new Error("headless acceptance page server did not bind TCP");
}
const pageUrl = `http://127.0.0.1:${pageAddress.port}/`;
const child = spawn(edgePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  pageUrl,
], {
  stdio: "ignore",
  windowsHide: true,
});

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function debuggerPort() {
  const path = join(profile, "DevToolsActivePort");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const line = (await readFile(path, "utf8")).split(/\r?\n/u)[0];
      const port = Number(line);
      if (Number.isSafeInteger(port) && port > 0 && port <= 65_535) return port;
    } catch {
      // Edge has not published the endpoint yet.
    }
    await sleep(50);
  }
  throw new Error("headless Edge did not publish DevToolsActivePort");
}

function runtimeValue(response) {
  if (response?.exceptionDetails !== undefined || response?.result === undefined) {
    throw new Error(`headless Runtime.evaluate failed: ${JSON.stringify(response?.exceptionDetails ?? response)}`);
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

async function waitFor(connection, expression, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(connection, expression);
    if (value) return value;
    await sleep(20);
  }
  throw new Error("headless renderer acceptance timed out");
}

let connection;
let lifecycleId;
try {
  const port = await debuggerPort();
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((target) => target.type === "page");
  if (page?.webSocketDebuggerUrl === undefined) throw new Error("headless page target missing");
  connection = await connectCdpWebSocket(page.webSocketDebuggerUrl);
  await connection.send("Runtime.enable");
  await evaluate(connection, `(() => {
    document.body.innerHTML = '';
    document.body.style.margin = '0';
    const sidebar = document.createElement('button');
    sidebar.setAttribute('data-app-action-sidebar-thread-active', 'true');
    sidebar.setAttribute('data-app-action-sidebar-thread-id', 'headless-thread');
    sidebar.setAttribute('data-app-action-sidebar-thread-host-id', 'headless-host');
    const main = document.createElement('main');
    main.setAttribute('data-app-shell-main-surface', '');
    Object.assign(main.style, { minHeight: '600px', padding: '120px' });
    const message = document.createElement('article');
    message.setAttribute('data-response-annotation-target', '');
    const overlay = document.createElement('div');
    overlay.setAttribute('data-selected-text-overlay-target', '');
    const text = document.createElement('span');
    text.id = 'fixture-text';
    text.textContent = 'GOV-1';
    Object.assign(text.style, { font: '20px sans-serif' });
    overlay.append(text);
    message.append(overlay);
    main.append(message);
    document.body.append(sidebar, main);
    return true;
  })()`);
  const bindingName = `__pointableContextBinding_${randomUUID().replaceAll("-", "_")}`;
  await connection.send("Runtime.addBinding", { name: bindingName });
  const installed = await evaluate(
    connection,
    createInstallPointableRendererExpression({
      bindingName,
      requestTimeoutMs: 5_000,
      actionLabel: "查看上下文（fixture）",
    }),
  );
  lifecycleId = installed.lifecycleId;
  if (installed.installed !== true || typeof lifecycleId !== "string") {
    throw new Error("headless renderer did not install");
  }

  const drag = await evaluate(connection, `(() => {
    const node = document.getElementById('fixture-text').firstChild;
    const first = document.createRange();
    first.setStart(node, 0); first.setEnd(node, 1);
    const last = document.createRange();
    last.setStart(node, 4); last.setEnd(node, 5);
    const a = first.getBoundingClientRect();
    const b = last.getBoundingClientRect();
    return { startX: a.left + 1, startY: a.top + a.height / 2, endX: b.right - 1, endY: b.top + b.height / 2 };
  })()`);
  await connection.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: drag.startX, y: drag.startY, button: "left", clickCount: 1,
  });
  await connection.send("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: drag.endX, y: drag.endY, button: "left", buttons: 1,
  });
  await connection.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: drag.endX, y: drag.endY, button: "left", clickCount: 1,
  });
  const action = await waitFor(connection, `(() => {
    const button = document.querySelector('[data-pointable-context-role="action"]');
    if (!(button instanceof HTMLElement) || window.getSelection()?.toString() !== 'GOV-1') return null;
    const rect = button.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.left < 8 || rect.top < 8) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await evaluate(connection, `(() => {
    window.__pointableHeadlessEvents = [];
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click', 'selectionchange']) {
      document.addEventListener(type, (event) => {
        window.__pointableHeadlessEvents.push({
          type,
          trusted: event.isTrusted,
          role: event.target?.getAttribute?.('data-pointable-context-role') ?? null,
          selection: window.getSelection()?.toString() ?? '',
        });
      }, true);
    }
    return true;
  })()`);
  const intentPromise = new Promise((resolveIntent, rejectIntent) => {
    const timeout = setTimeout(() => rejectIntent(new Error("renderer did not invoke binding")), 5_000);
    const unsubscribe = connection.onEvent((event) => {
      if (
        event.method !== "Runtime.bindingCalled" ||
        event.params?.name !== bindingName
      ) return;
      clearTimeout(timeout);
      unsubscribe();
      resolveIntent(parsePointableLookupIntent(event.params.payload, bindingName));
    });
  });
  await connection.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: action.x, y: action.y, button: "left", clickCount: 1,
  });
  await connection.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: action.x, y: action.y, button: "left", clickCount: 1,
  });
  const intent = await Promise.race([
    intentPromise,
    sleep(750).then(async () => {
      const diagnostic = await evaluate(connection, `(() => ({
        status: window.__pointableContextRenderer?.status?.(),
        selection: window.getSelection()?.toString() ?? '',
        events: window.__pointableHeadlessEvents,
      }))()`);
      throw new Error(`renderer did not invoke binding: ${JSON.stringify(diagnostic)}`);
    }),
  ]);
  const response = createPointableLookupResponse(intent, {
    kind: "detail",
    detail: {
      entityId: "WU:GOV-1",
      entityType: "work_unit",
      label: "AEN Harness Foundation",
      summary: "Headless close acceptance detail.",
      revision: "r18",
      observedAt: "2026-08-17T08:10:00Z",
      freshness: "stale",
      facts: [{ label: "status", value: "completed" }],
      sources: [{ label: "headless acceptance" }],
    },
  });
  const delivered = await evaluate(
    connection,
    createDeliverPointableResultExpression(response, lifecycleId),
  );
  if (delivered?.outcome !== "applied") throw new Error("detail was not applied");
  const collapsed = await evaluate(connection, `(() => {
    const disclosure = document.querySelector('[data-pointable-context-role="detail-disclosure"]');
    const toggle = document.querySelector('[data-pointable-context-role="detail-toggle"]');
    const body = document.querySelector('[data-pointable-context-role="detail-body"]');
    if (!(disclosure instanceof HTMLElement) || !(toggle instanceof HTMLButtonElement) || !(body instanceof HTMLElement)) return null;
    const rect = toggle.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    return {
      expanded: toggle.getAttribute('aria-expanded'),
      bodyHeight: bodyRect.height,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  })()`);
  if (collapsed === null || collapsed.expanded !== 'false' || collapsed.bodyHeight !== 0) {
    throw new Error(`detail disclosure was not initially collapsed: ${JSON.stringify(collapsed)}`);
  }
  await connection.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: collapsed.x, y: collapsed.y, button: "left", clickCount: 1,
  });
  await connection.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: collapsed.x, y: collapsed.y, button: "left", clickCount: 1,
  });
  const expanded = await waitFor(connection, `(() => {
    const disclosure = document.querySelector('[data-pointable-context-role="detail-disclosure"]');
    const body = document.querySelector('[data-pointable-context-role="detail-body"]');
    const toggle = document.querySelector('[data-pointable-context-role="detail-toggle"]');
    return disclosure instanceof HTMLElement && toggle instanceof HTMLButtonElement && body instanceof HTMLElement && toggle.getAttribute('aria-expanded') === 'true' && body.getBoundingClientRect().height > 0;
  })()`);
  if (expanded !== true) throw new Error("trusted disclosure did not expand in place");
  const close = await waitFor(connection, `(() => {
    const button = document.querySelector('button[aria-label="关闭上下文详情"]');
    if (!(button instanceof HTMLElement)) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await connection.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: close.x, y: close.y, button: "left", clickCount: 1,
  });
  await connection.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: close.x, y: close.y, button: "left", clickCount: 1,
  });
  await sleep(250);
  const dismissed = await evaluate(connection, `(() => ({
    selection: window.getSelection()?.toString() ?? '',
    actionCount: document.querySelectorAll('[data-pointable-context-role="action"]').length,
    cardCount: document.querySelectorAll('[data-pointable-context-role="card"]').length,
    state: window.__pointableContextRenderer?.status?.().state,
  }))()`);
  if (
    dismissed.selection !== "" ||
    dismissed.actionCount !== 0 ||
    dismissed.cardCount !== 0 ||
    dismissed.state !== "idle"
  ) {
    throw new Error(`close did not dismiss terminally: ${JSON.stringify(dismissed)}`);
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    browser: "Microsoft Edge headless",
    selectedText: intent.selectionText,
    trustedActionProducedDetail: true,
    detailInitiallyCollapsed: true,
    trustedDisclosureExpandedInPlace: true,
    closeClearedSelection: true,
    closePreventedRemountAfterMs: 250,
  }, null, 2)}\n`);
} finally {
  if (connection !== undefined) {
    if (typeof lifecycleId === "string") {
      await evaluate(
        connection,
        createUninstallPointableRendererExpression(lifecycleId),
      ).catch(() => undefined);
    }
    connection.close();
  }
  child.kill();
  await Promise.race([onceExit(child), sleep(2_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
  await new Promise((resolveClose) => pageServer.close(resolveClose));
  if (profile.startsWith(tmpdir())) {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function onceExit(processHandle) {
  if (processHandle.exitCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => processHandle.once("exit", resolveExit));
}

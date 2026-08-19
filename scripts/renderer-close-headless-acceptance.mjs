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

function waitForBindingIntent(connection, bindingName, expectedOperation, timeoutMs = 5_000) {
  return new Promise((resolveIntent, rejectIntent) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      rejectIntent(new Error(`renderer did not invoke ${expectedOperation} binding`));
    }, timeoutMs);
    const unsubscribe = connection.onEvent((event) => {
      if (
        event.method !== "Runtime.bindingCalled" ||
        event.params?.name !== bindingName
      ) return;
      const intent = parsePointableLookupIntent(event.params.payload, bindingName);
      if (intent.operation !== expectedOperation) return;
      clearTimeout(timeout);
      unsubscribe();
      resolveIntent(intent);
    });
  });
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
    text.textContent = 'pilot';
    Object.assign(text.style, { font: '20px sans-serif' });
    overlay.append(text);
    message.append(overlay);
    const composer = document.createElement('textarea');
    composer.id = 'fixture-composer';
    composer.setAttribute('aria-label', 'Reply');
    Object.assign(composer.style, {
      position: 'fixed', right: '16px', bottom: '16px',
      width: '240px', height: '64px', zIndex: '10',
    });
    main.append(message, composer);
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
      revisionCheckIntervalMs: 500,
      actionLabel: "查看上下文（fixture）",
      presentationMode: "mental-model",
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
  for (let step = 1; step <= 8; step += 1) {
    const progress = step / 8;
    await connection.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: drag.startX + (drag.endX - drag.startX) * progress,
      y: drag.startY + (drag.endY - drag.startY) * progress,
      button: "left",
      buttons: 1,
    });
  }
  await connection.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: drag.endX, y: drag.endY, button: "left", clickCount: 1,
  });
  const action = await waitFor(connection, `(() => {
    const button = document.querySelector('[data-pointable-context-role="action"]');
    if (!(button instanceof HTMLElement) || window.getSelection()?.toString() !== 'pilot') return null;
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
  const detailRef = `pdet:${Buffer.alloc(32, 7).toString("base64url")}`;
  const revisionIntentPromise = waitForBindingIntent(connection, bindingName, "check");
  const response = createPointableLookupResponse(intent, {
    kind: "detail",
    detail: {
      entityId: "file:docs/concepts/pilot.md",
      entityType: "concept",
      label: "Pilot",
      summary: "Headless close acceptance detail.",
      humanSummary: "Pilot is a small usability run before the formal study.",
      revision: "r18",
      observedAt: "2026-08-17T08:10:00Z",
      freshness: "stale",
      facts: [{ label: "status", value: "completed" }],
      sources: [{ label: "headless acceptance" }],
      comprehension: {
        kind: "concept",
        meaning: "Pilot is a small usability run before the formal study.",
        context: "The technical path is ready, but human understanding is not yet verified.",
        boundary: "It cannot establish a significant efficiency improvement.",
        sequence: ["Prototype ready", "Pilot", "Formal study"],
        currentStep: 1,
        evidence: [{
          excerpt: "A pilot may find workflow defects but must not claim significance.",
          source: "docs/evaluation-protocol.md:73",
        }],
      },
      detailRef,
    },
  });
  const delivered = await evaluate(
    connection,
    createDeliverPointableResultExpression(response, lifecycleId),
  );
  if (delivered?.outcome !== "applied") throw new Error("detail was not applied");

  const composer = await evaluate(connection, `(() => {
    const editor = document.getElementById('fixture-composer');
    if (!(editor instanceof HTMLTextAreaElement)) return null;
    const rect = editor.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (composer === null) throw new Error("headless composer missing");
  await connection.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: composer.x, y: composer.y, button: "left", clickCount: 1,
  });
  await connection.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: composer.x, y: composer.y, button: "left", clickCount: 1,
  });
  await waitFor(connection, `(() => {
    const editor = document.getElementById('fixture-composer');
    const card = document.querySelector('[data-pointable-context-role="card"]');
    return document.activeElement === editor && card instanceof HTMLElement;
  })()`);
  await sleep(700);
  const composerPersistence = await evaluate(connection, `(() => ({
    activeElement: document.activeElement?.id ?? '',
    selection: window.getSelection()?.toString() ?? '',
    cardCount: document.querySelectorAll('[data-pointable-context-role="card"]').length,
    status: window.__pointableContextRenderer?.status?.(),
  }))()`);
  if (
    composerPersistence.activeElement !== "fixture-composer" ||
    composerPersistence.cardCount !== 1 ||
    composerPersistence.status?.state !== "detail"
  ) {
    throw new Error(`composer did not preserve the live card: ${JSON.stringify(composerPersistence)}`);
  }

  const evidenceToggle = await waitFor(connection, `(() => {
    const card = document.querySelector('[data-pointable-context-role="card"]');
    const flow = document.querySelector('[data-pointable-context-role="comprehension-flow"]');
    const current = document.querySelector('[data-pointable-context-role="comprehension-step"][data-pointable-context-current="true"]');
    const boundary = document.querySelector('[data-pointable-context-role="comprehension-boundary"]');
    const toggle = document.querySelector('[data-pointable-context-role="evidence-toggle"]');
    const evidence = document.querySelector('[data-pointable-context-role="evidence-body"]');
    if (!(card instanceof HTMLElement) || card.dataset.pointableContextPresentation !== 'mental-model') return null;
    if (!(flow instanceof HTMLElement) || !(current instanceof HTMLElement) || current.textContent !== '当前 · Pilot') return null;
    if (!(boundary instanceof HTMLElement) || !boundary.textContent.includes('不会证明')) return null;
    if (!(toggle instanceof HTMLButtonElement) || !(evidence instanceof HTMLElement) || evidence.getBoundingClientRect().height !== 0) return null;
    const rect = toggle.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await connection.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: evidenceToggle.x, y: evidenceToggle.y, button: "left", clickCount: 1,
  });
  await connection.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: evidenceToggle.x, y: evidenceToggle.y, button: "left", clickCount: 1,
  });
  await waitFor(connection, `(() => {
    const toggle = document.querySelector('[data-pointable-context-role="evidence-toggle"]');
    const evidence = document.querySelector('[data-pointable-context-role="evidence-body"]');
    return toggle instanceof HTMLButtonElement && evidence instanceof HTMLElement && toggle.getAttribute('aria-expanded') === 'true' && evidence.textContent.includes('docs/evaluation-protocol.md:73') && evidence.getBoundingClientRect().height > 0;
  })()`);

  const revisionIntent = await revisionIntentPromise;
  if (revisionIntent.detailRef !== detailRef) {
    throw new Error("revision check did not preserve the opaque detail reference");
  }
  const revisionDelivered = await evaluate(
    connection,
    createDeliverPointableResultExpression(createPointableLookupResponse(revisionIntent, {
      kind: "revision",
      revision: {
        detailRef,
        state: "updated",
        checkedAt: "2026-08-18T01:00:00Z",
      },
    }), lifecycleId),
  );
  if (revisionDelivered?.outcome !== "applied") {
    throw new Error("revision notice was not applied");
  }
  await evaluate(connection, `new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
  })`);
  const detailToggleBeforeRefresh = await waitFor(connection, `(() => {
    const toggle = document.querySelector('[data-pointable-context-role="detail-toggle"]');
    if (!(toggle instanceof HTMLButtonElement)) return null;
    toggle.scrollIntoView({ block: 'nearest' });
    const rect = toggle.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await connection.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: detailToggleBeforeRefresh.x, y: detailToggleBeforeRefresh.y,
    button: "left", clickCount: 1,
  });
  await connection.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: detailToggleBeforeRefresh.x, y: detailToggleBeforeRefresh.y,
    button: "left", clickCount: 1,
  });
  await waitFor(connection, `(() => {
    const toggle = document.querySelector('[data-pointable-context-role="detail-toggle"]');
    const body = document.querySelector('[data-pointable-context-role="detail-body"]');
    return toggle instanceof HTMLButtonElement && body instanceof HTMLElement &&
      toggle.getAttribute('aria-expanded') === 'true' && body.getBoundingClientRect().height > 0;
  })()`);
  const refresh = await waitFor(connection, `(() => {
    const notice = document.querySelector('[data-pointable-context-role="revision-notice"]');
    if (!(notice instanceof HTMLElement) || !notice.textContent.includes('内容已更新')) return null;
    const button = Array.from(notice.querySelectorAll('button')).find((node) => node.textContent === '刷新内容');
    if (!(button instanceof HTMLButtonElement)) return null;
    button.scrollIntoView({ block: 'nearest' });
    const card = document.querySelector('[data-pointable-context-role="card"]');
    if (!(card instanceof HTMLElement)) return null;
    window.__pointableHeadlessRefreshCard = card;
    window.__pointableHeadlessRefreshPosition = { left: card.style.left, top: card.style.top };
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  const refreshIntentPromise = waitForBindingIntent(connection, bindingName, "refresh");
  await connection.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: refresh.x, y: refresh.y, button: "left", clickCount: 1,
  });
  await connection.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: refresh.x, y: refresh.y, button: "left", clickCount: 1,
  });
  const refreshIntent = await refreshIntentPromise;
  if (refreshIntent.detailRef !== detailRef) {
    throw new Error("refresh did not preserve the opaque detail reference");
  }
  const refreshDelivered = await evaluate(
    connection,
    createDeliverPointableResultExpression(createPointableLookupResponse(refreshIntent, {
      kind: "detail",
      detail: {
        entityId: "file:docs/concepts/pilot.md",
        entityType: "concept",
        label: "Pilot",
        summary: "Headless refreshed detail.",
        humanSummary: "Headless refreshed detail with a human-oriented explanation.",
        revision: "r19",
        observedAt: "2026-08-18T01:00:01Z",
        freshness: "current",
        facts: [{ label: "status", value: "completed" }],
        sources: [{ label: "headless acceptance" }],
        comprehension: {
          kind: "concept",
          meaning: "Headless refreshed detail.",
          context: "The refreshed current context remains in the same card.",
          boundary: "It still cannot establish a significant efficiency improvement.",
          sequence: ["Prototype ready", "Pilot", "Formal study"],
          currentStep: 1,
          evidence: [{
            excerpt: "A pilot may find workflow defects but must not claim significance.",
            source: "docs/evaluation-protocol.md:73",
          }],
        },
        detailRef,
        changes: [{
          label: "摘要",
          before: "Headless close acceptance detail.",
          after: "Headless refreshed detail.",
        }],
      },
    }), lifecycleId),
  );
  if (refreshDelivered?.outcome !== "applied") {
    throw new Error("refreshed detail was not applied");
  }
  await waitFor(connection, `(() => {
    const card = document.querySelector('[data-pointable-context-role="card"]');
    return card instanceof HTMLElement && card.textContent.includes('Headless refreshed detail.') && card.textContent.includes('本次刷新');
  })()`);
  await evaluate(connection, `new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
  })`);
  const preserved = await evaluate(connection, `(() => {
    const card = document.querySelector('[data-pointable-context-role="card"]');
    const disclosure = document.querySelector('[data-pointable-context-role="detail-disclosure"]');
    const toggle = document.querySelector('[data-pointable-context-role="detail-toggle"]');
    const body = document.querySelector('[data-pointable-context-role="detail-body"]');
    const evidenceToggle = document.querySelector('[data-pointable-context-role="evidence-toggle"]');
    const evidenceBody = document.querySelector('[data-pointable-context-role="evidence-body"]');
    if (!(card instanceof HTMLElement) || !(disclosure instanceof HTMLElement) ||
        !(toggle instanceof HTMLButtonElement) || !(body instanceof HTMLElement) ||
        !(evidenceToggle instanceof HTMLButtonElement) || !(evidenceBody instanceof HTMLElement)) return null;
    return {
      sameNode: card === window.__pointableHeadlessRefreshCard,
      samePosition: card.style.left === window.__pointableHeadlessRefreshPosition?.left &&
        card.style.top === window.__pointableHeadlessRefreshPosition?.top,
      detailExpanded: toggle.getAttribute('aria-expanded'),
      detailBodyHeight: body.getBoundingClientRect().height,
      evidenceExpanded: evidenceToggle.getAttribute('aria-expanded'),
      evidenceBodyHeight: evidenceBody.getBoundingClientRect().height,
    };
  })()`);
  if (
    preserved === null || preserved.sameNode !== true || preserved.samePosition !== true ||
    preserved.detailExpanded !== 'true' || preserved.detailBodyHeight <= 0 ||
    preserved.evidenceExpanded !== 'true' || preserved.evidenceBodyHeight <= 0
  ) {
    throw new Error(`refresh did not preserve the live card UI state: ${JSON.stringify(preserved)}`);
  }
  // Disclosure changes the card height and schedules one reposition frame.
  // Wait until that frame and the following paint boundary before sampling the
  // close button, otherwise the button can move between mousePressed/released.
  await evaluate(connection, `new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
  })`);
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
    composerFocusPreservedCard: true,
    mentalModelRenderedInLane: true,
    evidenceExpandedInPlace: true,
    backgroundRevisionDetected: true,
    trustedRefreshUpdatedInPlace: true,
    refreshPreservedCardUiState: true,
    refreshAddedChatTurns: 0,
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

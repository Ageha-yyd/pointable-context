import { resolve } from "node:path";
import {
  connectCdpWebSocket,
  discoverCodexAppTargets,
  startFixturePrivateProbe,
} from "../dist/src/host/codex-cdp/index.js";
import { fixtureProjectScope } from "../dist/src/adapters/json-files.js";

const probeText = "ARCH-7 — Selection Query Boundary";
const fixtureRoot = resolve(process.cwd(), "fixtures/mini-project");

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function runtimeValue(response) {
  if (response?.exceptionDetails !== undefined || response?.result === undefined) {
    throw new Error("CDP Runtime.evaluate failed");
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

async function waitFor(connection, expression, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(connection, expression);
    if (value) return value;
    await sleep(50);
  }
  throw new Error("private fixture probe timed out waiting for the renderer");
}

const fixtureOptions = {
  workspaceRoot: fixtureRoot,
  manifestPath: resolve(fixtureRoot, "project-context.json"),
  indexPath: resolve(fixtureRoot, "index.json"),
  detailsPath: resolve(fixtureRoot, "details.json"),
  explicitScope: fixtureProjectScope("PRJ-01"),
  actionLabel: "查询上下文（fixture）",
};

let probe;
let connection;
let targetId;
let result;
try {
  probe = await startFixturePrivateProbe(fixtureOptions);
  targetId = probe.status().targets.at(0)?.targetId;
  if (targetId === undefined) throw new Error("no eligible Codex Chat Lane target");
  const target = (await discoverCodexAppTargets()).find((item) => item.id === targetId);
  if (target === undefined) throw new Error("attached Codex target disappeared");
  connection = await connectCdpWebSocket(target.webSocketDebuggerUrl);

  const before = await evaluate(connection, `(() => ({
    turns: document.querySelectorAll('[data-user-message-bubble="true"], [data-response-annotation-target]').length,
    selected: document.body.innerText.includes(${JSON.stringify(probeText)})
  }))()`);
  if (before?.selected !== true) throw new Error("probe text is not visible in a Chat Lane message");

  const selected = await evaluate(connection, `(() => {
    const text = ${JSON.stringify(probeText)};
    const roots = [...document.querySelectorAll('[data-user-message-bubble="true"], [data-response-annotation-target]')];
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const index = node.nodeValue.indexOf(text);
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + text.length);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        // CDP creates the Range directly; notify the renderer exactly as a
        // browser selection update would. This event remains local and cannot
        // invoke the lookup—the next step still requires a trusted mouse click.
        document.dispatchEvent(new Event("selectionchange"));
        const rect = range.getBoundingClientRect();
        return {
          ok: rect.width > 0 && rect.height > 0,
          root: root.tagName,
          rootClass: root.className,
        };
      }
    }
    return { ok: false };
  })()`);
  if (selected?.ok !== true) throw new Error("could not create a visible single-message selection");

  const action = await waitFor(connection, `(() => {
    const button = [...document.querySelectorAll('button[data-pointable-context-role="action"]')]
      .find((element) => element.textContent === "查询上下文（fixture）");
    if (!(button instanceof HTMLElement)) return null;
    const rect = button.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.left < 10 || rect.top < 10) return null;
    const renderer = window.__pointableContextRenderer?.status?.();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      pending: renderer?.pendingRequestCount,
      cards: renderer?.cardCount,
      state: renderer?.state,
    };
  })()`);
  if (action.pending !== 0 || action.cards !== 0 || action.state !== "affordance") {
    throw new Error("selection caused lookup before the explicit click");
  }

  await connection.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: action.x,
    y: action.y,
    button: "left",
    clickCount: 1,
  });
  await connection.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: action.x,
    y: action.y,
    button: "left",
    clickCount: 1,
  });

  const detail = await waitFor(connection, `(() => {
    const card = document.querySelector('[data-pointable-context-role="card"]');
    if (!(card instanceof HTMLElement)) return null;
    const text = card.innerText || "";
    return text.includes("DEC:ARCH-7") && text.includes("r4") && text.includes("stale")
      ? { text: text.slice(0, 2_000) }
      : null;
  })()`);
  const after = await evaluate(connection, `document.querySelectorAll('[data-user-message-bubble="true"], [data-response-annotation-target]').length`);
  const close = await waitFor(connection, `(() => {
    const button = document.querySelector('button[aria-label="关闭上下文详情"]');
    if (!(button instanceof HTMLElement)) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await connection.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: close.x,
    y: close.y,
    button: "left",
    clickCount: 1,
  });
  await connection.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: close.x,
    y: close.y,
    button: "left",
    clickCount: 1,
  });
  const closed = await waitFor(connection, `document.querySelector('[data-pointable-context-role="card"]') === null`);

  result = {
    ok: true,
    fixtureOnly: true,
    selectionWasInert: true,
    trustedClickProducedDetail: true,
    detailText: detail.text,
    chatTurnCountUnchanged: before.turns === after,
    closeControlClosedCard: closed === true,
  };
} finally {
  connection?.close();
  if (probe !== undefined) await probe.stop();
}

const cleanupTarget = (await discoverCodexAppTargets())
  .find((item) => item.id === targetId);
if (cleanupTarget === undefined) throw new Error("Codex target disappeared before cleanup verification");
const cleanupConnection = await connectCdpWebSocket(cleanupTarget.webSocketDebuggerUrl);
try {
  const rendererRemoved = await evaluate(
    cleanupConnection,
    `window.__pointableContextRenderer === undefined && document.querySelector('[data-pointable-context-owned]') === null`,
  );
  if (rendererRemoved !== true) throw new Error("private probe cleanup left renderer state in the Chat Lane");
  console.log(JSON.stringify({ ...result, adapterStopRemovedRenderer: true }));
} finally {
  cleanupConnection.close();
}

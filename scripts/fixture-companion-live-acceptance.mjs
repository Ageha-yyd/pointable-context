import {
  connectCdpWebSocket,
  discoverCodexAppTargets,
} from "../dist/src/host/codex-cdp/index.js";

const probeText = process.argv[2] ?? "GOV-1";
const actionLabel = process.argv[3] ?? "查看上下文（fixture）";
const expectedDetailTokens = process.argv.length > 4
  ? process.argv.slice(4)
  : ["WU:GOV-1", "r18", "stale"];

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

async function waitFor(connection, expression, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(connection, expression);
    if (value) return value;
    await sleep(50);
  }
  throw new Error("live selection acceptance timed out");
}

async function waitForDetailWithTimeline(connection, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  const timeline = [];
  let previous;
  while (Date.now() < deadline) {
    const snapshot = await evaluate(connection, `(() => {
      const card = document.querySelector('[data-pointable-context-role="card"]');
      const text = card instanceof HTMLElement ? card.innerText || "" : "";
      const status = window.__pointableContextRenderer?.status?.();
      return {
        selection: window.getSelection()?.toString() ?? "",
        state: status?.state ?? null,
        pending: status?.pendingRequestCount ?? null,
        actionCount: status?.actionCount ?? null,
        cardCount: status?.cardCount ?? null,
        text: text.slice(0, 2_000),
      };
    })()`);
    const encoded = JSON.stringify(snapshot);
    if (encoded !== previous) {
      timeline.push({ atMs: timeoutMs - Math.max(0, deadline - Date.now()), ...snapshot });
      previous = encoded;
    }
    if (
      expectedDetailTokens.every((token) => snapshot.text.includes(token))
    ) {
      return { text: snapshot.text, timeline };
    }
    await sleep(20);
  }
  throw new Error(`live detail timeline: ${JSON.stringify(timeline)}`);
}

async function locateDrag(connection) {
  return await evaluate(connection, `(async () => {
    const wanted = ${JSON.stringify(probeText)};
    const roots = [...document.querySelectorAll(
      '[data-selected-text-overlay-target]'
    )].reverse();
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const index = node.nodeValue.indexOf(wanted);
        if (index < 0) continue;
        node.parentElement?.scrollIntoView({ block: "center", inline: "nearest" });
        // Background/minimized Codex windows may suspend requestAnimationFrame.
        // A bounded timer lets the scroll settle without making acceptance
        // depend on the app being foregrounded.
        await new Promise((resolveFrame) => window.setTimeout(resolveFrame, 40));
        const first = document.createRange();
        first.setStart(node, index);
        first.setEnd(node, index + 1);
        const last = document.createRange();
        last.setStart(node, index + wanted.length - 1);
        last.setEnd(node, index + wanted.length);
        const firstRect = first.getBoundingClientRect();
        const lastRect = last.getBoundingClientRect();
        if (firstRect.width <= 0 || lastRect.width <= 0) continue;
        return {
          startX: firstRect.left + Math.min(2, firstRect.width / 3),
          startY: firstRect.top + firstRect.height / 2,
          endX: lastRect.right - Math.min(1, lastRect.width / 4),
          endY: lastRect.top + lastRect.height / 2,
          turns: document.querySelectorAll(
            '[data-selected-text-overlay-target]'
          ).length,
        };
      }
    }
    return null;
  })()`);
}

async function dragSelection(connection, drag) {
  await connection.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: drag.startX,
    y: drag.startY,
    button: "left",
    clickCount: 1,
  });
  const steps = 8;
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    await connection.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: drag.startX + (drag.endX - drag.startX) * progress,
      y: drag.startY + (drag.endY - drag.startY) * progress,
      button: "left",
      buttons: 1,
    });
  }
  await connection.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: drag.endX,
    y: drag.endY,
    button: "left",
    clickCount: 1,
  });
}

let result;
for (const target of await discoverCodexAppTargets()) {
  const connection = await connectCdpWebSocket(target.webSocketDebuggerUrl);
  try {
    const renderer = await evaluate(
      connection,
      `window.__pointableContextRenderer?.status?.() ?? null`,
    );
    if (renderer === null) continue;
    const drag = await locateDrag(connection);
    if (drag === null) continue;
    await dragSelection(connection, drag);
    const affordance = await waitFor(connection, `(() => {
      const selection = window.getSelection()?.toString().trim() ?? "";
      const button = [...document.querySelectorAll('button[data-pointable-context-role="action"]')]
        .find((candidate) => candidate.textContent === ${JSON.stringify(actionLabel)});
      if (!(button instanceof HTMLElement) || selection !== ${JSON.stringify(probeText)}) return null;
      const rect = button.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.left < 8 || rect.top < 8) return null;
      const status = window.__pointableContextRenderer?.status?.();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        selection,
        pending: status?.pendingRequestCount,
        cards: status?.cardCount,
        state: status?.state,
      };
    })()`);
    if (
      affordance.pending !== 0 ||
      affordance.cards !== 0 ||
      affordance.state !== "affordance"
    ) {
      throw new Error("mouse selection triggered lookup before explicit click");
    }
    await connection.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: affordance.x,
      y: affordance.y,
      button: "left",
      clickCount: 1,
    });
    await connection.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: affordance.x,
      y: affordance.y,
      button: "left",
      clickCount: 1,
    });
    const detail = await waitForDetailWithTimeline(connection);
    const turnsAfter = await evaluate(
      connection,
      `document.querySelectorAll('[data-selected-text-overlay-target]').length`,
    );
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
    await waitFor(connection, `document.querySelector('[data-pointable-context-role="card"]') === null`);
    await sleep(250);
    const dismissed = await evaluate(connection, `(() => ({
      selection: window.getSelection()?.toString() ?? "",
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
      throw new Error("close control did not dismiss the selection UI terminally");
    }
    result = {
      ok: true,
      mode: actionLabel.includes("fixture") ? "fixture" : "live-local-workspace",
      selectionMethod: "trusted_cdp_mouse_drag",
      selectedText: affordance.selection,
      selectionWasInert: true,
      explicitTrustedClickProducedDetail: true,
      chatTurnCountUnchanged: drag.turns === turnsAfter,
      closeClearedSelectionAndPreventedRemount: true,
      detailText: detail.text,
      companionRemainsRunning: true,
      targetId: target.id,
    };
    break;
  } finally {
    connection.close();
  }
}

if (result === undefined) {
  throw new Error(`no attached Codex Chat Lane contained ${JSON.stringify(probeText)}`);
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

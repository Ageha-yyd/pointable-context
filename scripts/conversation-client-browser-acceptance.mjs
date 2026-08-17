import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectCdpWebSocket } from "../dist/src/host/codex-cdp/transport.js";
import { PointableConversationService } from "../dist/src/app-server/conversation-service.js";
import { startConversationHttpServer } from "../dist/src/app-server/conversation-http.js";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const screenshotPath = join(tmpdir(), "pointable-conversation-client-acceptance.png");

class FakeRpc {
  listeners = new Set();
  waiters = [];
  turns = [];
  injectCalls = 0;
  turnCalls = 0;

  async request(method) {
    if (method === "thread/start") return { thread: { id: "thread-browser-acceptance" } };
    if (method === "thread/inject_items") { this.injectCalls += 1; return {}; }
    if (method === "thread/delete") return {};
    if (method === "thread/read") return { thread: { id: "thread-browser-acceptance", turns: this.turns } };
    if (method === "turn/start") {
      this.turnCalls += 1;
      const id = `turn-${this.turnCalls}`;
      queueMicrotask(() => {
        const text = "你可以选中 README.md 或 package.json 查看当前工作区详情。";
        for (const listener of this.listeners) listener("item/agentMessage/delta", {
          threadId: "thread-browser-acceptance", turnId: id, delta: text,
        });
        this.turns.push({ id, items: [{ type: "agentMessage", text }] });
        for (const waiter of [...this.waiters]) {
          const params = { threadId: "thread-browser-acceptance", turn: { id, status: "completed" } };
          if (waiter.method === "turn/completed" && waiter.predicate(params)) {
            this.waiters.splice(this.waiters.indexOf(waiter), 1);
            waiter.resolve(params);
          }
        }
      });
      return { turn: { id } };
    }
    throw new Error(`unexpected fake method: ${method}`);
  }

  waitForNotification(method, predicate = () => true) {
    return new Promise((resolve) => this.waiters.push({ method, predicate, resolve }));
  }

  onNotification(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function debuggerPort(profile) {
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

async function waitFor(connection, expression, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(connection, expression);
    if (value) return value;
    await sleep(30);
  }
  throw new Error(`browser acceptance timed out: ${expression.slice(0, 80)}`);
}

async function click(connection, rect) {
  await connection.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1,
  });
  await connection.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1,
  });
}

const rpc = new FakeRpc();
const service = await PointableConversationService.start({ rpc, workspaceRoot: process.cwd() });
await service.sendMessage("请告诉我可以查看哪些文件。");
const server = await startConversationHttpServer({ service, deleteThreadOnStop: true });
const profile = await mkdtemp(join(tmpdir(), "pointable-conversation-edge-"));
const child = spawn(edgePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--window-size=1440,1000",
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  server.url,
], { stdio: "ignore", windowsHide: true });

let connection;
try {
  const port = await debuggerPort(profile);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((target) => target.type === "page");
  if (!page?.webSocketDebuggerUrl) throw new Error("headless page target missing");
  connection = await connectCdpWebSocket(page.webSocketDebuggerUrl);
  await connection.send("Runtime.enable");
  await connection.send("Page.enable");
  await waitFor(connection, `document.querySelectorAll('.message-row').length === 2`);
  const actionRect = await evaluate(connection, `(() => {
    const content = [...document.querySelectorAll('.message-content')].find((node) => node.textContent.includes('README.md'));
    if (!content || !content.firstChild) return null;
    const text = content.firstChild;
    const start = text.textContent.indexOf('README.md');
    const range = document.createRange();
    range.setStart(text, start); range.setEnd(text, start + 'README.md'.length);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    return true;
  })()`);
  if (!actionRect) throw new Error("selection setup failed");
  const action = await waitFor(connection, `(() => {
    const button = document.getElementById('selection-action');
    if (!button || button.hidden) return null;
    const rect = button.getBoundingClientRect();
    return rect.width > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  })()`);
  await click(connection, action);
  const reference = await waitFor(connection, `(() => {
    const dialog = document.getElementById('detail-popover');
    const button = dialog?.querySelector('.reference-button');
    if (!dialog || dialog.hidden || !button || !dialog.textContent.includes('README.md') || !dialog.textContent.includes('current')) return null;
    const rect = button.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : null;
  })()`);
  await click(connection, reference);
  await waitFor(connection, `document.querySelectorAll('.reference-chip').length === 1 && document.getElementById('reference-tray').hidden === false`);
  const screenshot = await connection.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  const close = await evaluate(connection, `(() => {
    const button = document.getElementById('detail-close');
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await click(connection, close);
  await waitFor(connection, `document.getElementById('detail-popover').hidden === true`);
  if (rpc.injectCalls !== 1 || rpc.turnCalls !== 1) {
    throw new Error(`unexpected calls: inject=${rpc.injectCalls} turn=${rpc.turnCalls}`);
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    messages: 2,
    detailVisible: true,
    referentChips: 1,
    closeWorked: true,
    turnCallsBeforeAndAfterLookup: 1,
    injectCalls: rpc.injectCalls,
    screenshotPath,
  }, null, 2)}\n`);
} finally {
  if (connection) {
    try { connection.close(); } catch { /* best-effort browser cleanup */ }
  }
  child.kill();
  if (child.exitCode === null) {
    await Promise.race([once(child, "exit"), sleep(2_000)]).catch(() => undefined);
  }
  await server.stop().catch(() => undefined);
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}

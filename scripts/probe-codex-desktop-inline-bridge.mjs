import { connectCdpWebSocket } from "../dist/src/host/codex-cdp/transport.js";

const endpoint = process.argv[2] ?? "http://127.0.0.1:9223";
const base = new URL(endpoint);
if (
  base.protocol !== "http:" ||
  (base.hostname !== "127.0.0.1" && base.hostname !== "::1" && base.hostname !== "[::1]")
) {
  throw new Error("probe endpoint must be an explicit loopback HTTP URL");
}

const response = await fetch(new URL("/json/list", base), {
  redirect: "error",
  signal: AbortSignal.timeout(2_000),
});
if (!response.ok) throw new Error("Codex CDP target discovery failed");
const targets = await response.json();
if (!Array.isArray(targets)) throw new Error("Codex CDP target list is invalid");

const matching = targets.filter(
  (target) =>
    target?.type === "page" &&
    target?.url === "app://-/index.html" &&
    typeof target?.webSocketDebuggerUrl === "string" &&
    target.webSocketDebuggerUrl.endsWith(`/devtools/page/${target.id}`),
);
if (matching.length !== 1) {
  throw new Error(`expected one main Codex target, found ${matching.length}`);
}

const connection = await connectCdpWebSocket(matching[0].webSocketDebuggerUrl);
try {
  const expression = `(() => {
    const bridge = globalThis.openai;
    const bridgeKeys = bridge && (typeof bridge === "object" || typeof bridge === "function")
      ? Object.getOwnPropertyNames(bridge).slice(0, 100)
      : [];
    const bridgeTypes = Object.fromEntries(bridgeKeys.map((key) => [key, typeof bridge[key]]));
    const relatedGlobals = Object.getOwnPropertyNames(globalThis)
      .filter((key) => /openai|codex|chat|mcp|message|bridge/iu.test(key))
      .slice(0, 100)
      .map((key) => ({ key, type: typeof globalThis[key] }));
    const electronBridge = globalThis.electronBridge;
    const electronBridgeKeys = electronBridge && typeof electronBridge === "object"
      ? Object.getOwnPropertyNames(electronBridge).slice(0, 100)
      : [];
    const electronBridgeTypes = Object.fromEntries(
      electronBridgeKeys.map((key) => [key, typeof electronBridge[key]]),
    );
    const electronBridgePrototypeKeys = electronBridge && typeof electronBridge === "object"
      ? Object.getOwnPropertyNames(Object.getPrototypeOf(electronBridge) ?? {}).slice(0, 100)
      : [];
    return {
      href: location.href,
      bridgeType: typeof bridge,
      bridgeKeys,
      bridgeTypes,
      sendFollowUpMessageType: typeof bridge?.sendFollowUpMessage,
      updateModelContextType: typeof bridge?.updateModelContext,
      callToolType: typeof bridge?.callTool,
      electronBridgeType: typeof electronBridge,
      electronBridgeKeys,
      electronBridgeTypes,
      electronBridgePrototypeKeys,
      relatedGlobals,
      iframeCount: document.querySelectorAll("iframe").length,
      dialogCount: document.querySelectorAll('[role="dialog"]').length,
    };
  })()`;
  const result = await connection.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  const value = result?.result?.value;
  if (value === undefined) throw new Error("Codex bridge probe returned no value");
  process.stdout.write(`${JSON.stringify({ ok: true, targetId: matching[0].id, ...value }, null, 2)}\n`);
} finally {
  connection.close();
}

import { CodexCdpHostAdapter } from "../dist/src/host/codex-cdp/index.js";

const endpoint = process.argv[2] ?? "http://127.0.0.1:9223";
const delayMs = 3_000;
const lifetimeMs = 15 * 60_000;

const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

const adapter = new CodexCdpHostAdapter({
  endpoint,
  actionLabel: "查看上下文（stale probe）",
  presentationMode: "record",
  lookupTimeoutMs: 8_000,
  lookup: async (request) => {
    const text = request.selection.text.trim();
    if (text === "stale-alpha") await sleep(delayMs);
    return {
      kind: "detail",
      detail: {
        entityId: `manual-probe:${text}`,
        entityType: "verification",
        label: text,
        summary: "受控 stale-response 人工资格探针；不代表工作区事实。",
        revision: "manual-probe-r1",
        observedAt: new Date().toISOString(),
        freshness: "stale",
        facts: [{ label: "用途", value: "仅验证旧响应不会覆盖新选区" }],
        sources: [{ label: "manual-qualification-probe" }],
      },
    };
  },
});

let stopping;
const stop = async (reason) => {
  if (stopping !== undefined) return await stopping;
  stopping = (async () => {
    await adapter.stop();
    process.stdout.write(`${JSON.stringify({ event: "stale_probe_stopped", reason })}\n`);
  })();
  return await stopping;
};

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void stop(signal).finally(() => process.exit(0));
  });
}

const status = await adapter.start();
process.stdout.write(`${JSON.stringify({
  event: "stale_probe_ready",
  targetCount: status.targetCount,
  delayMs,
  lifetimeMs,
})}\n`);

setTimeout(() => {
  void stop("lifetime_expired").finally(() => process.exit(0));
}, lifetimeMs).unref();

await new Promise(() => undefined);

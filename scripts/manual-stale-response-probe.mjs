import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { CodexCdpHostAdapter } from "../dist/src/host/codex-cdp/index.js";

const endpoint = process.argv[2] ?? "http://127.0.0.1:9223";
const delayMs = 3_000;
const lifetimeMs = 15 * 60_000;

const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

async function runningWorkspaceCompanionPid() {
  const local = process.env.LOCALAPPDATA;
  const stateRoot = resolve(local && isAbsolute(local) ? local : homedir(), "PointableContext");
  try {
    const raw = await readFile(join(stateRoot, "workspace-companion", "state.json"), "utf8");
    if (Buffer.byteLength(raw, "utf8") > 16 * 1024) return undefined;
    const state = JSON.parse(raw);
    const pid = Number(state?.pid);
    if (!Number.isSafeInteger(pid) || pid < 1) return undefined;
    try {
      process.kill(pid, 0);
      return pid;
    } catch (error) {
      return error?.code === "EPERM" ? pid : undefined;
    }
  } catch {
    return undefined;
  }
}

const companionPid = await runningWorkspaceCompanionPid();
if (companionPid !== undefined) {
  process.stderr.write(`${JSON.stringify({
    event: "stale_probe_refused",
    code: "exclusive_renderer_in_use",
    companionPid,
    remedy: "Stop the workspace companion before this probe, then restart it after the probe exits.",
  })}\n`);
  process.exit(2);
}

const adapter = new CodexCdpHostAdapter({
  endpoint,
  actionLabel: "查看上下文（stale probe）",
  presentationMode: "record",
  lookupTimeoutMs: 8_000,
  lookup: async (request) => {
    const text = request.selection.text.trim();
    if (text !== "stale-alpha" && text !== "stale-beta") {
      return {
        kind: "error",
        code: "manual_probe_text_out_of_scope",
        message: "This probe accepts only stale-alpha or stale-beta.",
        retryable: false,
      };
    }
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

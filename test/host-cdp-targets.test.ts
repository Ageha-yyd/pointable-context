import assert from "node:assert/strict";
import test from "node:test";
import {
  CodexTargetDiscoveryError,
  discoverCodexAppTargets,
  normalizeCodexDebugEndpoint,
  type PointableFetch,
} from "../src/host/codex-cdp/targets.js";

function responseWithUrl(body: string, url = "http://127.0.0.1:9223/json/list"): Response {
  const response = new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function jsonFetch(value: unknown, url?: string): PointableFetch {
  return async () => responseWithUrl(JSON.stringify(value), url);
}

test("debug endpoint accepts only an explicit numeric loopback HTTP origin", () => {
  assert.equal(
    normalizeCodexDebugEndpoint("http://127.0.0.1:9223").href,
    "http://127.0.0.1:9223/",
  );
  assert.equal(
    normalizeCodexDebugEndpoint("http://[::1]:9223").href,
    "http://[::1]:9223/",
  );
  for (const invalid of [
    "http://localhost:9223",
    "http://127.0.0.1",
    "https://127.0.0.1:9223",
    "http://192.168.1.20:9223",
    "http://user:secret@127.0.0.1:9223",
    "http://127.0.0.1:9223/json/list",
  ]) {
    assert.throws(
      () => normalizeCodexDebugEndpoint(invalid),
      CodexTargetDiscoveryError,
      invalid,
    );
  }
});

test("target discovery gates exact app pages and same-target loopback websockets", async () => {
  const targets = await discoverCodexAppTargets("http://127.0.0.1:9223", {
    fetch: jsonFetch([
      {
        id: "main-1",
        type: "page",
        title: "Codex",
        url: "app://-/index.html",
        webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/main-1",
      },
      {
        id: "overlay-1",
        type: "page",
        title: "Avatar overlay",
        url: "app://-/avatar-overlay.html",
        webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/overlay-1",
      },
      {
        id: "web-1",
        type: "page",
        title: "Untrusted web page",
        url: "https://example.test/",
        webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/web-1",
      },
      {
        id: "swapped-1",
        type: "page",
        title: "Swapped target",
        url: "app://-/index.html",
        webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/main-1",
      },
      {
        id: "remote-1",
        type: "page",
        title: "Remote socket",
        url: "app://-/index.html",
        webSocketDebuggerUrl: "ws://192.168.1.20:9223/devtools/page/remote-1",
      },
    ]),
  });
  assert.deepEqual(targets, [{
    id: "main-1",
    type: "page",
    title: "Codex",
    url: "app://-/index.html",
    webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/main-1",
  }]);
});

test("target discovery rejects cross-origin metadata, invalid JSON, and oversized lists", async () => {
  await assert.rejects(
    discoverCodexAppTargets("http://127.0.0.1:9223", {
      fetch: jsonFetch([], "http://127.0.0.1:9555/json/list"),
    }),
    (error: unknown) =>
      error instanceof CodexTargetDiscoveryError &&
      error.code === "target_list_redirected",
  );
  await assert.rejects(
    discoverCodexAppTargets("http://127.0.0.1:9223", {
      fetch: async () => responseWithUrl("not-json"),
    }),
    (error: unknown) =>
      error instanceof CodexTargetDiscoveryError &&
      error.code === "target_list_invalid",
  );
  await assert.rejects(
    discoverCodexAppTargets("http://127.0.0.1:9223", {
      fetch: async () => responseWithUrl(JSON.stringify({ value: "x".repeat(2_000) })),
      maxResponseBytes: 1_024,
    }),
    (error: unknown) =>
      error instanceof CodexTargetDiscoveryError &&
      error.code === "target_list_too_large",
  );
});

test("discovery propagates caller cancellation through a fail-closed error", async () => {
  const controller = new AbortController();
  const fetch: PointableFetch = async (_input, init) =>
    await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
        once: true,
      });
    });
  const pending = discoverCodexAppTargets("http://127.0.0.1:9223", {
    fetch,
    signal: controller.signal,
    timeoutMs: 1_000,
  });
  controller.abort(new Error("test cancellation"));
  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof CodexTargetDiscoveryError &&
      error.code === "target_discovery_aborted",
  );
});

test("discovery timeout does not trust fetch or response bodies to honor AbortSignal", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    discoverCodexAppTargets("http://127.0.0.1:9223", {
      fetch: async () => await new Promise<Response>(() => undefined),
      timeoutMs: 50,
    }),
    (error: unknown) =>
      error instanceof CodexTargetDiscoveryError &&
      error.code === "target_discovery_aborted",
  );
  assert.ok(Date.now() - startedAt < 500);

  const stalledBody = new ReadableStream<Uint8Array>({
    start(): void {
      // Intentionally never enqueue or close.
    },
  });
  await assert.rejects(
    discoverCodexAppTargets("http://127.0.0.1:9223", {
      fetch: async () => new Response(stalledBody, { status: 200 }),
      timeoutMs: 50,
    }),
    (error: unknown) =>
      error instanceof CodexTargetDiscoveryError &&
      error.code === "target_discovery_aborted",
  );
});

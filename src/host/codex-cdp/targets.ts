export interface CodexCdpTarget {
  id: string;
  type: "page";
  title: string;
  url: "app://-/index.html";
  webSocketDebuggerUrl: string;
}

export type PointableFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface DiscoverCodexTargetsOptions {
  fetch?: PointableFetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export class CodexTargetDiscoveryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CodexTargetDiscoveryError";
  }
}

function loopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

export function normalizeCodexDebugEndpoint(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CodexTargetDiscoveryError(
      "debug_endpoint_invalid",
      "Codex debug endpoint is not a valid URL",
    );
  }
  if (
    parsed.protocol !== "http:" ||
    !loopbackHostname(parsed.hostname) ||
    parsed.port.length === 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new CodexTargetDiscoveryError(
      "debug_endpoint_not_loopback",
      "Codex debug endpoint must be an explicit loopback HTTP origin",
    );
  }
  return new URL(parsed.origin);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBoundedResponseText(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maximumBytes) {
      throw new CodexTargetDiscoveryError(
        "target_list_too_large",
        "Codex target list exceeds its size limit",
      );
    }
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const aborted = (): void => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", aborted, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel("pointable target list exceeded its byte limit");
        throw new CodexTargetDiscoveryError(
          "target_list_too_large",
          "Codex target list exceeds its size limit",
        );
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof CodexTargetDiscoveryError) throw error;
    throw new CodexTargetDiscoveryError(
      "target_list_invalid",
      "Codex target list is not valid UTF-8",
    );
  } finally {
    signal.removeEventListener("abort", aborted);
    reader.releaseLock();
  }
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = (): void => signal.removeEventListener("abort", aborted);
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function parseTarget(
  value: unknown,
  endpoint: URL,
): CodexCdpTarget | undefined {
  if (
    !record(value) ||
    value.type !== "page" ||
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 256 ||
    !/^[A-Za-z0-9:_-]+$/u.test(value.id) ||
    typeof value.title !== "string" ||
    value.title.length > 512 ||
    value.url !== "app://-/index.html" ||
    typeof value.webSocketDebuggerUrl !== "string"
  ) {
    return undefined;
  }
  let websocket: URL;
  try {
    websocket = new URL(value.webSocketDebuggerUrl);
  } catch {
    return undefined;
  }
  if (
    websocket.protocol !== "ws:" ||
    !loopbackHostname(websocket.hostname) ||
    websocket.hostname.toLowerCase() !== endpoint.hostname.toLowerCase() ||
    websocket.port !== endpoint.port ||
    websocket.pathname !== `/devtools/page/${value.id}` ||
    websocket.search.length > 0 ||
    websocket.hash.length > 0
  ) {
    return undefined;
  }
  return {
    id: value.id,
    type: "page",
    title: value.title,
    url: value.url,
    webSocketDebuggerUrl: websocket.toString(),
  };
}

export async function discoverCodexAppTargets(
  endpointValue = "http://127.0.0.1:9223",
  options: DiscoverCodexTargetsOptions = {},
): Promise<CodexCdpTarget[]> {
  const endpoint = normalizeCodexDebugEndpoint(endpointValue);
  const timeoutMs = options.timeoutMs ?? 3_000;
  const maxResponseBytes = options.maxResponseBytes ?? 1_048_576;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 30_000) {
    throw new RangeError("timeoutMs must be an integer from 50 to 30000");
  }
  if (
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes < 1_024 ||
    maxResponseBytes > 4_194_304
  ) {
    throw new RangeError("maxResponseBytes must be an integer from 1024 to 4194304");
  }

  const controller = new AbortController();
  const abort = (): void => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("Codex target discovery timed out")),
    timeoutMs,
  );
  try {
    const response = await awaitWithAbort(
      Promise.resolve().then(() => (options.fetch ?? globalThis.fetch)(
        new URL("/json/list", endpoint),
        {
          method: "GET",
          redirect: "error",
          signal: controller.signal,
          headers: { accept: "application/json" },
        },
      )),
      controller.signal,
    );
    if (!response.ok) {
      throw new CodexTargetDiscoveryError(
        "target_list_unavailable",
        `Codex target list returned HTTP ${response.status}`,
      );
    }
    if (response.url.length > 0 && new URL(response.url).origin !== endpoint.origin) {
      throw new CodexTargetDiscoveryError(
        "target_list_redirected",
        "Codex target discovery crossed its loopback origin",
      );
    }
    const text = await awaitWithAbort(
      readBoundedResponseText(response, maxResponseBytes, controller.signal),
      controller.signal,
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new CodexTargetDiscoveryError(
        "target_list_invalid",
        "Codex target list is not valid JSON",
      );
    }
    if (!Array.isArray(parsed) || parsed.length > 64) {
      throw new CodexTargetDiscoveryError(
        "target_list_invalid",
        "Codex target list is not a bounded array",
      );
    }
    const targets = parsed.flatMap((candidate) => {
      const target = parseTarget(candidate, endpoint);
      return target === undefined ? [] : [target];
    });
    return [...new Map(targets.map((target) => [target.id, target])).values()];
  } catch (error) {
    if (error instanceof CodexTargetDiscoveryError) throw error;
    if (controller.signal.aborted) {
      throw new CodexTargetDiscoveryError(
        "target_discovery_aborted",
        "Codex target discovery was aborted or timed out",
      );
    }
    throw new CodexTargetDiscoveryError(
      "target_list_unavailable",
      "Codex target list is unavailable",
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

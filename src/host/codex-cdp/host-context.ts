export interface CodexHostTaskContext {
  schemaVersion: 1;
  host: "codex-desktop";
  threadId: string;
  hostId: string;
  routeRef: string;
  contextFingerprint: string;
}

export class CodexHostContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexHostContextError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 256 &&
    /^[A-Za-z0-9:_-]+$/u.test(value)
  );
}

function boundedRoute(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 2_048) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "app:" &&
      parsed.hostname === "-" &&
      parsed.pathname === "/index.html"
    );
  } catch {
    return false;
  }
}

/**
 * Read the active Codex task tuple in the already-qualified main execution
 * context. This is private Codex Desktop host evidence, not a portable DOM or
 * App Server contract.
 */
export function createReadCodexHostTaskContextExpression(): string {
  return `(() => {
    const nodes = [...document.querySelectorAll(
      '[data-app-action-sidebar-thread-active="true"]'
    )].filter((node) => node instanceof HTMLElement && node.isConnected);
    if (nodes.length !== 1) return null;
    const active = nodes[0];
    const threadId = active.getAttribute('data-app-action-sidebar-thread-id');
    const hostId = active.getAttribute('data-app-action-sidebar-thread-host-id');
    if (typeof threadId !== 'string' || typeof hostId !== 'string') return null;
    const fingerprintValue = {
      href: window.location.href,
      threadId,
      hostId,
    };
    return {
      schemaVersion: 1,
      host: 'codex-desktop',
      threadId,
      hostId,
      routeRef: window.location.href,
      contextFingerprint: JSON.stringify(fingerprintValue),
    };
  })()`;
}

/**
 * Validate and copy the page result before it reaches a lookup callback.
 * `undefined` means the qualified surface has no single active task tuple.
 */
export function parseCodexHostTaskContext(
  value: unknown,
  expectedFingerprint?: string,
): CodexHostTaskContext | undefined {
  if (value === null || value === undefined) return undefined;
  if (
    !record(value) ||
    Reflect.ownKeys(value).some((key) => typeof key !== "string") ||
    Object.keys(value).sort().join("|") !==
      "contextFingerprint|host|hostId|routeRef|schemaVersion|threadId" ||
    value.schemaVersion !== 1 ||
    value.host !== "codex-desktop" ||
    !boundedIdentity(value.threadId) ||
    !boundedIdentity(value.hostId) ||
    !boundedRoute(value.routeRef) ||
    typeof value.contextFingerprint !== "string" ||
    value.contextFingerprint.length < 1 ||
    value.contextFingerprint.length > 2_048
  ) {
    throw new CodexHostContextError("pointable_host_task_context_invalid");
  }
  const canonicalFingerprint = JSON.stringify({
    href: value.routeRef,
    threadId: value.threadId,
    hostId: value.hostId,
  });
  if (
    value.contextFingerprint !== canonicalFingerprint ||
    (expectedFingerprint !== undefined &&
      value.contextFingerprint !== expectedFingerprint)
  ) {
    throw new CodexHostContextError("pointable_host_task_context_changed");
  }
  return Object.freeze({
    schemaVersion: 1,
    host: "codex-desktop",
    threadId: value.threadId,
    hostId: value.hostId,
    routeRef: value.routeRef,
    contextFingerprint: value.contextFingerprint,
  });
}

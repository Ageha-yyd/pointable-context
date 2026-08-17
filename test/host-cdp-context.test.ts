import assert from "node:assert/strict";
import test from "node:test";
import {
  CodexHostContextError,
  createReadCodexHostTaskContextExpression,
  parseCodexHostTaskContext,
} from "../src/host/codex-cdp/host-context.js";

const fingerprint =
  '{"href":"app://-/index.html","threadId":"thread-1","hostId":"host-1"}';

function validContext(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    host: "codex-desktop",
    threadId: "thread-1",
    hostId: "host-1",
    routeRef: "app://-/index.html",
    contextFingerprint: fingerprint,
  };
}

test("host context expression reads only one active Codex task tuple", () => {
  const expression = createReadCodexHostTaskContextExpression();
  assert.match(expression, /data-app-action-sidebar-thread-active/u);
  assert.match(expression, /nodes\.length !== 1/u);
  assert.match(expression, /data-app-action-sidebar-thread-host-id/u);
  assert.doesNotMatch(expression, /process\.|require\(|fetch\(/u);
});

test("host context parser returns a validated immutable copy", () => {
  const raw = validContext();
  const parsed = parseCodexHostTaskContext(raw, fingerprint);
  assert.ok(parsed);
  raw.threadId = "thread-evil";
  assert.equal(parsed.threadId, "thread-1");
  assert.equal(Object.isFrozen(parsed), true);
});

test("host context parser treats no active task as unavailable", () => {
  assert.equal(parseCodexHostTaskContext(null, fingerprint), undefined);
});

test("host context parser rejects drift, extra fields, and non-Codex routes", () => {
  assert.throws(
    () => parseCodexHostTaskContext(validContext(), fingerprint.replace("thread-1", "thread-2")),
    CodexHostContextError,
  );
  assert.throws(
    () => parseCodexHostTaskContext({ ...validContext(), extra: true }, fingerprint),
    CodexHostContextError,
  );
  assert.throws(
    () => parseCodexHostTaskContext({
      ...validContext(),
      routeRef: "https://example.com/",
    }, fingerprint),
    CodexHostContextError,
  );
});

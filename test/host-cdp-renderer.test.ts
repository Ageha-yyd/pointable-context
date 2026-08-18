import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeliverPointableResultExpression,
  createInstallPointableRendererExpression,
  createUninstallPointableRendererExpression,
  createVerifyPointableRendererFenceExpression,
  evaluatePointableRendererEligibility,
  validatePointableRendererResponse,
} from "../src/host/codex-cdp/renderer.js";
import type { PointableLookupResponseV1 } from "../src/host/codex-cdp/protocol.js";

const digest = "1".repeat(64);

function validResponse(): PointableLookupResponseV1 {
  return {
    schemaVersion: 1,
    kind: "pointable.selection.result",
    requestId: "request-12345678",
    selectionGeneration: 2,
    selectionDigest: digest,
    contextFingerprint: '{"href":"app://-/index.html"}',
    presentation: {
      kind: "error",
      code: "not_found",
      message: "未找到上下文对象。",
      retryable: false,
    },
  };
}

test("renderer eligibility is local, single-range, message-only, and bounded", () => {
  assert.deepEqual(evaluatePointableRendererEligibility({
    rangeCount: 1,
    collapsed: false,
    text: "  GOV-1  ",
    surface: "assistant_message",
    sameSurface: true,
    connected: true,
    visible: true,
    rectWidth: 40,
    rectHeight: 18,
  }), {
    kind: "eligible",
    text: "GOV-1",
    surface: "assistant_message",
  });

  const baseline = {
    rangeCount: 1,
    collapsed: false,
    text: "GOV-1",
    surface: "user_message" as const,
    sameSurface: true,
    connected: true,
    visible: true,
    rectWidth: 40,
    rectHeight: 18,
  };
  assert.equal(evaluatePointableRendererEligibility({
    ...baseline,
    rangeCount: 2,
  }).kind, "ineligible");
  assert.equal(evaluatePointableRendererEligibility({
    ...baseline,
    text: "x".repeat(513),
  }).kind, "ineligible");
  assert.equal(evaluatePointableRendererEligibility({
    ...baseline,
    sameSurface: false,
  }).kind, "ineligible");
  assert.equal(evaluatePointableRendererEligibility({
    ...baseline,
    connected: false,
  }).kind, "ineligible");
  assert.equal(evaluatePointableRendererEligibility({
    ...baseline,
    visible: false,
  }).kind, "ineligible");
});

test("renderer response validator accepts bounded text-only views and rejects fence drift", () => {
  const response = validResponse();
  assert.deepEqual(validatePointableRendererResponse(response), response);
  assert.equal(validatePointableRendererResponse({
    ...response,
    selectionDigest: "not-a-digest",
  }), undefined);
  const revision = {
    ...response,
    presentation: {
      kind: "revision",
      revision: {
        detailRef: "pdet:opaque-reference",
        state: "updated",
        checkedAt: "2026-08-18T09:50:00.000Z",
      },
    },
  };
  assert.deepEqual(validatePointableRendererResponse(revision), revision);
  assert.equal(validatePointableRendererResponse({
    ...response,
    presentation: {
      kind: "error",
      code: "not_found",
      message: "x".repeat(1_025),
      retryable: false,
    },
  }), undefined);
  assert.equal(validatePointableRendererResponse({
    ...response,
    unexpected: true,
  }), undefined);
});

test("install expression is namespaced, generic, click-gated, text-only, and cleanup-capable", () => {
  const expression = createInstallPointableRendererExpression({
    bindingName: "__pointableContextBinding_test_12345678",
  });
  assert.match(expression, /__pointableContextRenderer/u);
  assert.match(expression, /main\[data-app-shell-main-surface\]/u);
  assert.match(expression, /data-user-message-bubble/u);
  assert.match(expression, /data-response-annotation-target/u);
  assert.match(expression, /selectionchange/u);
  assert.match(expression, /pointerdown/u);
  assert.match(expression, /Escape/u);
  assert.match(expression, /MutationObserver/u);
  assert.match(expression, /event\.isTrusted/u);
  assert.match(expression, /addEventListener\("mousedown", preserveSelection\)/u);
  assert.match(expression, /ownedInteraction/u);
  assert.match(expression, /removeAllRanges\(\)/u);
  assert.match(expression, /addEventListener\("mousedown", dismissPointer\)/u);
  assert.match(expression, /state === "resolving"/u);
  assert.match(expression, /detailBody\.hidden = true/u);
  assert.match(expression, /detailBody\.style\.display = "none"/u);
  assert.match(expression, /data-pointable-context-role", "detail-disclosure"/u);
  assert.match(expression, /disclosureToggle\.textContent = "查看详情"/u);
  assert.match(expression, /expanded \? "收起详情" : "查看详情"/u);
  assert.match(expression, /内容已更新/u);
  assert.match(expression, /刷新内容/u);
  assert.match(expression, /scheduleRevisionCheck/u);
  assert.match(expression, /operation === "check"/u);
  assert.match(expression, /operation === "refresh"/u);
  assert.match(expression, /data-pointable-context-role", "revision-changes"/u);
  assert.match(expression, /Commit the explicit trusted activation synchronously/u);
  assert.match(expression, /range\.toString\(\)\.trim\(\)/u);
  assert.match(expression, /range\.intersectsNode/u);
  assert.match(expression, /visited > 2_048/u);
  assert.match(expression, /data-pointable-context-owned/u);
  assert.match(expression, /=== lifecycleId/u);
  assert.match(expression, /availableOwnedId/u);
  assert.match(expression, /actionElement = action/u);
  assert.match(expression, /cardElement = shell/u);
  assert.doesNotMatch(expression, /function ownedElement\(id/u);
  assert.match(expression, /existingApi\.uninstall/u);
  assert.match(expression, /data-app-action-sidebar-thread-host-id/u);
  assert.match(expression, /let reconcileFrame/u);
  assert.match(expression, /readContextFingerprint\(\) !== current\.contextFingerprint/u);
  assert.match(expression, /removeEventListener/u);
  assert.match(expression, /textContent/u);
  assert.doesNotMatch(expression, /innerHTML|insertAdjacentHTML|srcdoc/u);
  assert.doesNotMatch(expression, /项目/u);

  const submitStart = expression.indexOf("async function submitLookup");
  const bindingCall = expression.indexOf("binding(JSON.stringify(payload))");
  assert.ok(submitStart > 0);
  assert.ok(bindingCall > submitStart, "binding payload must only be emitted by submitLookup");
});

test("host expressions address only the renderer namespace and preserve all fence fields", () => {
  const response = validResponse();
  const delivery = createDeliverPointableResultExpression(
    response,
    "lifecycle-test-1",
  );
  assert.match(delivery, /window\.__pointableContextRenderer/u);
  assert.match(delivery, /receiveResult/u);
  assert.match(delivery, /request-12345678/u);
  assert.match(delivery, new RegExp(digest, "u"));

  const fence = createVerifyPointableRendererFenceExpression({
    requestId: response.requestId,
    selectionGeneration: response.selectionGeneration,
    selectionDigest: response.selectionDigest,
    contextFingerprint: response.contextFingerprint,
  }, "lifecycle-test-1");
  assert.match(fence, /window\.__pointableContextRenderer/u);
  assert.match(fence, /verifyFence/u);
  assert.match(fence, /request-12345678/u);
  assert.match(fence, new RegExp(digest, "u"));
  assert.match(fence, /contextFingerprint/u);
  const uninstall = createUninstallPointableRendererExpression(
    "lifecycle-test-1",
  );
  assert.match(uninstall, /lifecycle-test-1/u);
  assert.match(uninstall, /uninstall/u);
});

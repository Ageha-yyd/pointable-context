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
  for (const comprehension of [
    {
      kind: "change" as const,
      before: "Record was the default.",
      after: "P-C is the default.",
      impact: "Concept cards foreground a mental model.",
      evidence: [{ excerpt: "mental-model", source: "source:1" }],
    },
    {
      kind: "decision" as const,
      problem: "Browser switching adds cost.",
      choice: "Use the native Chat Lane.",
      consequence: "Qualify the private host per build.",
      evidence: [{ excerpt: "Codex Desktop", source: "source:2" }],
    },
    {
      kind: "task" as const,
      goal: "Expose explicit work results.",
      status: "Ready for native-lane validation.",
      completed: "The deterministic data path is connected.",
      next: "Inspect the native task card.",
      blocker: "Human efficiency is not yet measured.",
      updatedAt: "2026-08-19T05:00:00.000Z",
      evidence: [{ excerpt: "Task evidence", source: "source:3" }],
    },
    {
      kind: "verification" as const,
      claim: "Refresh preserves the card's reading state.",
      result: "The bounded acceptance passed.",
      gap: "Cross-version behavior remains unproven.",
      executedAt: "2026-08-19T05:05:00.000Z",
      evidence: [{ excerpt: "Verification evidence", source: "source:4" }],
    },
  ]) {
    const detail: PointableLookupResponseV1 = {
      ...response,
      presentation: {
        kind: "detail",
        detail: {
          entityId: "file:mental-model",
          entityType: comprehension.kind,
          label: "Mental model",
          summary: "Summary",
          revision: "r1",
          observedAt: "2026-08-19T08:00:00.000Z",
          freshness: "current",
          facts: [],
          sources: [],
          comprehension,
        },
      },
    };
    assert.deepEqual(validatePointableRendererResponse(detail), detail);
  }
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
  assert.match(expression, /card !== null && target instanceof Element/u);
  assert.match(expression, /\[contenteditable="true"\]/u);
  assert.match(expression, /stableRoot\.contains\(composer\)/u);
  assert.match(expression, /restoreFocus = composer/u);
  assert.match(expression, /reuseExisting \? connectedOwnedElement\("card"\) : null/u);
  assert.match(expression, /shell\.replaceChildren\(\)/u);
  assert.match(expression, /request\.operation === "refresh"/u);
  assert.match(expression, /detailExpanded/u);
  assert.match(expression, /evidenceExpanded/u);
  assert.match(expression, /holdCardPlacementUntil/u);
  assert.match(expression, /state === "resolving"/u);
  assert.match(expression, /detailBody\.hidden = !detailExpanded/u);
  assert.match(expression, /detailExpanded \? "block" : "none"/u);
  assert.match(expression, /data-pointable-context-role", "detail-disclosure"/u);
  assert.match(expression, /detailExpanded \? "收起详情" : "查看详情"/u);
  assert.match(expression, /expanded \? "收起详情" : "查看详情"/u);
  assert.match(expression, /内容已更新/u);
  assert.match(expression, /刷新内容/u);
  assert.match(expression, /scheduleRevisionCheck/u);
  assert.match(expression, /operation === "check"/u);
  assert.match(expression, /operation === "refresh"/u);
  assert.match(expression, /data-pointable-context-role", "revision-changes"/u);
  assert.match(expression, /data-pointable-context-role", "comprehension-model"/u);
  assert.match(expression, /data-pointable-context-role", "comprehension-flow"/u);
  assert.match(expression, /modelBlock\("comprehension-boundary"/u);
  assert.match(expression, /modelBlock\("comprehension-before"/u);
  assert.match(expression, /modelBlock\("comprehension-after"/u);
  assert.match(expression, /modelBlock\("comprehension-impact"/u);
  assert.match(expression, /modelBlock\("comprehension-problem"/u);
  assert.match(expression, /modelBlock\("comprehension-choice"/u);
  assert.match(expression, /modelBlock\("comprehension-consequence"/u);
  assert.match(expression, /modelBlock\("comprehension-status"/u);
  assert.match(expression, /modelBlock\("comprehension-completed"/u);
  assert.match(expression, /modelBlock\("comprehension-next"/u);
  assert.match(expression, /modelBlock\("comprehension-blocker"/u);
  assert.match(expression, /modelBlock\("comprehension-result"/u);
  assert.match(expression, /modelBlock\("comprehension-gap"/u);
  assert.match(expression, /data-pointable-context-role", "evidence-toggle"/u);
  assert.match(expression, /为什么现在出现/u);
  assert.match(expression, /你现在位于这里/u);
  assert.match(expression, /不会证明：/u);
  assert.match(expression, /原来/u);
  assert.match(expression, /现在/u);
  assert.match(expression, /这会影响/u);
  assert.match(expression, /要解决的问题/u);
  assert.match(expression, /结果与代价/u);
  assert.match(expression, /为什么这样说/u);
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

test("renderer accepts one fixed presentation condition per installation", () => {
  for (const presentationMode of ["record", "narrative", "mental-model"] as const) {
    const expression = createInstallPointableRendererExpression({
      bindingName: "__pointableContextBinding_test_12345678",
      presentationMode,
    });
    assert.match(expression, new RegExp(`"presentationMode":"${presentationMode}"`, "u"));
  }
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

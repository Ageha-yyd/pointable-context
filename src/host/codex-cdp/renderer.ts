import type {
  PointableComprehensionView,
  PointableDetailView,
  PointableLookupResponseV1,
  PointablePresentationMode,
  PointableSelectionSurface,
} from "./protocol.js";

export interface RendererEligibilityObservation {
  rangeCount: number;
  collapsed: boolean;
  text: string;
  surface?: PointableSelectionSurface;
  sameSurface: boolean;
  connected: boolean;
  visible: boolean;
  rectWidth: number;
  rectHeight: number;
}

export type RendererEligibilityDecision =
  | {
      kind: "eligible";
      text: string;
      surface: PointableSelectionSurface;
    }
  | {
      kind: "ineligible";
      reason:
        | "not_single_range"
        | "collapsed"
        | "unsupported_surface"
        | "empty"
        | "too_long"
        | "detached"
        | "not_visible";
    };

export interface PointableRendererConfig {
  bindingName: string;
  requestTimeoutMs?: number;
  revisionCheckIntervalMs?: number;
  actionLabel?: string;
  presentationMode?: PointablePresentationMode;
}

export interface PointableRendererStatus {
  installed: boolean;
  bindingName: string;
  lifecycleId: string;
  state: "idle" | "affordance" | "resolving" | "candidates" | "detail" | "error";
  selectionGeneration: number;
  pendingRequestCount: number;
  actionCount: number;
  cardCount: number;
}

export type PointableRendererAck =
  | { ok: true; requestId: string; outcome: "applied" }
  | {
      ok: false;
      requestId?: string;
      outcome: "invalid_payload" | "stale" | "context_changed";
      code: string;
    };

export type PointableRendererFence = Pick<
  PointableLookupResponseV1,
  | "requestId"
  | "selectionGeneration"
  | "selectionDigest"
  | "contextFingerprint"
>;

export function evaluatePointableRendererEligibility(
  observation: RendererEligibilityObservation,
): RendererEligibilityDecision {
  if (observation.rangeCount !== 1) {
    return { kind: "ineligible", reason: "not_single_range" };
  }
  if (observation.collapsed) {
    return { kind: "ineligible", reason: "collapsed" };
  }
  if (
    !observation.sameSurface ||
    (observation.surface !== "assistant_message" &&
      observation.surface !== "user_message")
  ) {
    return { kind: "ineligible", reason: "unsupported_surface" };
  }
  const text = observation.text.trim();
  if (text.length === 0) return { kind: "ineligible", reason: "empty" };
  if (text.length > 512) return { kind: "ineligible", reason: "too_long" };
  if (!observation.connected) return { kind: "ineligible", reason: "detached" };
  if (
    !observation.visible ||
    observation.rectWidth <= 0 ||
    observation.rectHeight <= 0
  ) {
    return { kind: "ineligible", reason: "not_visible" };
  }
  return { kind: "eligible", text, surface: observation.surface };
}

/**
 * Deliberately self-contained so its source can be embedded in the qualified
 * renderer expression without importing host code into the page.
 */
export function validatePointableRendererResponse(
  value: unknown,
): PointableLookupResponseV1 | undefined {
  const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
    typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);
  const bounded = (candidate: unknown, minimum: number, maximum: number): candidate is string =>
    typeof candidate === "string" &&
    candidate.length >= minimum &&
    candidate.length <= maximum &&
    !/[\p{Cc}\p{Cf}]/u.test(candidate);
  const exact = (candidate: Record<string, unknown>, keys: string[]): boolean => {
    const allowed = new Set(keys);
    return Object.keys(candidate).every((key) => allowed.has(key));
  };
  const candidateView = (candidate: unknown): boolean =>
    isRecord(candidate) &&
    exact(candidate, ["candidateRef", "label", "entityType", "summary"]) &&
    bounded(candidate.candidateRef, 8, 256) &&
    bounded(candidate.label, 1, 256) &&
    bounded(candidate.entityType, 1, 128) &&
    bounded(candidate.summary, 1, 1_024);
  const factView = (candidate: unknown): boolean =>
    isRecord(candidate) &&
    exact(candidate, ["label", "value"]) &&
    bounded(candidate.label, 1, 128) &&
    bounded(candidate.value, 1, 1_024);
  const sourceView = (candidate: unknown): boolean =>
    isRecord(candidate) &&
    exact(candidate, ["label"]) &&
    bounded(candidate.label, 1, 512);
  const changeView = (candidate: unknown): boolean =>
    isRecord(candidate) &&
    exact(candidate, ["label", "before", "after"]) &&
    bounded(candidate.label, 1, 128) &&
    bounded(candidate.before, 1, 1_024) &&
    bounded(candidate.after, 1, 1_024);
  const evidenceView = (candidate: unknown): boolean =>
    isRecord(candidate) &&
    exact(candidate, ["excerpt", "source"]) &&
    bounded(candidate.excerpt, 1, 1_024) &&
    bounded(candidate.source, 1, 512);
  const comprehensionView = (candidate: unknown): boolean => {
    if (
      !isRecord(candidate) ||
      !Array.isArray(candidate.evidence) ||
      candidate.evidence.length < 1 ||
      candidate.evidence.length > 3 ||
      !candidate.evidence.every(evidenceView)
    ) {
      return false;
    }
    if (candidate.kind === "concept") {
      return exact(candidate, [
        "kind",
        "meaning",
        "context",
        "boundary",
        "sequence",
        "currentStep",
        "evidence",
      ]) &&
        bounded(candidate.meaning, 1, 1_024) &&
        bounded(candidate.context, 1, 1_024) &&
        bounded(candidate.boundary, 1, 1_024) &&
        Array.isArray(candidate.sequence) &&
        candidate.sequence.length >= 2 &&
        candidate.sequence.length <= 4 &&
        candidate.sequence.every((item) => bounded(item, 1, 256)) &&
        Number.isSafeInteger(candidate.currentStep) &&
        Number(candidate.currentStep) >= 0 &&
        Number(candidate.currentStep) < candidate.sequence.length;
    }
    if (candidate.kind === "change") {
      return exact(candidate, ["kind", "before", "after", "impact", "evidence"]) &&
        bounded(candidate.before, 1, 1_024) &&
        bounded(candidate.after, 1, 1_024) &&
        bounded(candidate.impact, 1, 1_024);
    }
    return candidate.kind === "decision" &&
      exact(candidate, ["kind", "problem", "choice", "consequence", "evidence"]) &&
      bounded(candidate.problem, 1, 1_024) &&
      bounded(candidate.choice, 1, 1_024) &&
      bounded(candidate.consequence, 1, 1_024);
  };

  if (
    !isRecord(value) ||
    !exact(value, [
      "schemaVersion",
      "kind",
      "requestId",
      "selectionGeneration",
      "selectionDigest",
      "contextFingerprint",
      "presentation",
    ]) ||
    value.schemaVersion !== 1 ||
    value.kind !== "pointable.selection.result" ||
    !bounded(value.requestId, 8, 128) ||
    !Number.isSafeInteger(value.selectionGeneration) ||
    Number(value.selectionGeneration) < 1 ||
    !bounded(value.selectionDigest, 64, 64) ||
    !/^[0-9a-f]{64}$/u.test(value.selectionDigest) ||
    !bounded(value.contextFingerprint, 1, 2_048) ||
    !isRecord(value.presentation)
  ) {
    return undefined;
  }
  const presentation = value.presentation;
  if (presentation.kind === "candidates") {
    if (
      !exact(presentation, ["kind", "candidates"]) ||
      !Array.isArray(presentation.candidates) ||
      presentation.candidates.length < 1 ||
      presentation.candidates.length > 3 ||
      !presentation.candidates.every(candidateView) ||
      new Set(presentation.candidates.map((candidate) =>
        (candidate as Record<string, unknown>).candidateRef)).size !==
        presentation.candidates.length
    ) {
      return undefined;
    }
  } else if (presentation.kind === "detail") {
    const detail = presentation.detail;
    if (
      !exact(presentation, ["kind", "detail"]) ||
      !isRecord(detail) ||
      !exact(detail, [
        "entityId",
        "entityType",
        "label",
        "summary",
        "revision",
        "observedAt",
        "freshness",
        "facts",
        "sources",
        "humanSummary",
        "comprehension",
        "detailRef",
        "changes",
      ]) ||
      !bounded(detail.entityId, 1, 256) ||
      !bounded(detail.entityType, 1, 128) ||
      !bounded(detail.label, 1, 256) ||
      !bounded(detail.summary, 1, 1_024) ||
      !bounded(detail.revision, 1, 512) ||
      !bounded(detail.observedAt, 20, 64) ||
      !Number.isFinite(Date.parse(detail.observedAt)) ||
      (detail.freshness !== "current" &&
        detail.freshness !== "stale" &&
        detail.freshness !== "partial" &&
        detail.freshness !== "unknown") ||
      !Array.isArray(detail.facts) ||
      detail.facts.length > 5 ||
      !detail.facts.every(factView) ||
      !Array.isArray(detail.sources) ||
      detail.sources.length > 5 ||
      !detail.sources.every(sourceView) ||
      (detail.humanSummary !== undefined && !bounded(detail.humanSummary, 1, 1_024)) ||
      (detail.comprehension !== undefined && !comprehensionView(detail.comprehension)) ||
      (detail.detailRef !== undefined && !bounded(detail.detailRef, 8, 256)) ||
      (detail.changes !== undefined &&
        (!Array.isArray(detail.changes) ||
          detail.changes.length > 3 ||
          !detail.changes.every(changeView)))
    ) {
      return undefined;
    }
  } else if (presentation.kind === "revision") {
    const revision = presentation.revision;
    if (
      !exact(presentation, ["kind", "revision"]) ||
      !isRecord(revision) ||
      !exact(revision, ["detailRef", "state", "checkedAt"]) ||
      !bounded(revision.detailRef, 8, 256) ||
      (revision.state !== "unchanged" &&
        revision.state !== "updated" &&
        revision.state !== "deleted" &&
        revision.state !== "unavailable") ||
      !bounded(revision.checkedAt, 20, 64) ||
      !Number.isFinite(Date.parse(revision.checkedAt))
    ) {
      return undefined;
    }
  } else if (presentation.kind === "error") {
    if (
      !exact(presentation, ["kind", "code", "message", "retryable"]) ||
      !bounded(presentation.code, 1, 128) ||
      !/^[a-z0-9_:-]+$/u.test(presentation.code) ||
      !bounded(presentation.message, 1, 1_024) ||
      typeof presentation.retryable !== "boolean"
    ) {
      return undefined;
    }
  } else {
    return undefined;
  }
  return value as unknown as PointableLookupResponseV1;
}

interface PointableRendererApi {
  status(): PointableRendererStatus;
  verifyFence(value: unknown): boolean;
  receiveResult(value: unknown): PointableRendererAck;
  reconcile(): PointableRendererStatus;
  uninstall(): PointableRendererStatus;
}

declare global {
  interface Window {
    __pointableContextRenderer?: PointableRendererApi;
    [key: string]: unknown;
  }
}

/**
 * Browser-side installer. Keep runtime helpers inside this function: the Host
 * serializes it into a CDP Runtime.evaluate expression.
 */
export function installPointableContextRenderer(
  config: PointableRendererConfig,
  evaluateEligibility: (
    observation: RendererEligibilityObservation,
  ) => RendererEligibilityDecision,
  validateResponse: (value: unknown) => PointableLookupResponseV1 | undefined,
): PointableRendererStatus {
  const namespace = "__pointableContextRenderer";
  const bindingNamePattern = /^__pointableContextBinding_[A-Za-z0-9_]{8,128}$/u;
  if (!bindingNamePattern.test(config.bindingName)) {
    throw new Error("pointable_renderer_binding_name_invalid");
  }
  const requestTimeoutMs = config.requestTimeoutMs ?? 5_000;
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 100 ||
    requestTimeoutMs > 30_000
  ) {
    throw new Error("pointable_renderer_timeout_invalid");
  }
  const revisionCheckIntervalMs = config.revisionCheckIntervalMs ?? 5_000;
  if (
    !Number.isSafeInteger(revisionCheckIntervalMs) ||
    revisionCheckIntervalMs < 100 ||
    revisionCheckIntervalMs > 60_000
  ) {
    throw new Error("pointable_renderer_revision_interval_invalid");
  }
  const actionLabel = typeof config.actionLabel === "string" &&
    config.actionLabel.trim().length > 0 &&
    config.actionLabel.length <= 64
    ? config.actionLabel.trim()
    : "查看上下文";
  const presentationMode: PointablePresentationMode =
    config.presentationMode === "narrative" ||
    config.presentationMode === "mental-model" ||
    config.presentationMode === "record"
      ? config.presentationMode
      : "record";
  const existing = window[namespace];
  if (
    typeof existing === "object" &&
    existing !== null &&
    "status" in existing &&
    typeof existing.status === "function"
  ) {
    const existingApi = existing as PointableRendererApi;
    const existingStatus = existingApi.status();
    if (
      existingStatus.installed !== true ||
      !bindingNamePattern.test(existingStatus.bindingName) ||
      !/^[A-Za-z0-9:_-]{8,256}$/u.test(existingStatus.lifecycleId)
    ) {
      throw new Error("pointable_renderer_namespace_occupied");
    }
    if (existingStatus.bindingName === config.bindingName) return existingStatus;
    if (typeof existingApi.uninstall !== "function") {
      throw new Error("pointable_renderer_namespace_occupied");
    }
    existingApi.uninstall();
    if (window[namespace] !== undefined) {
      throw new Error("pointable_renderer_stale_uninstall_failed");
    }
  }
  if (window[namespace] !== undefined) {
    throw new Error("pointable_renderer_namespace_occupied");
  }

  const lifecycleId = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `pointable-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const actionIdBase = `pointable-context-selection-action-${lifecycleId}`;
  const cardIdBase = `pointable-context-quick-look-${lifecycleId}`;

  const stableRootCandidate = document.querySelector<HTMLElement>(
    "main[data-app-shell-main-surface]",
  );
  if (stableRootCandidate === null) {
    throw new Error("pointable_renderer_surface_missing");
  }
  const stableRoot: HTMLElement = stableRootCandidate;
  const binding = window[config.bindingName];
  if (typeof binding !== "function") throw new Error("pointable_renderer_binding_missing");

  type CandidateState = {
    generation: number;
    text: string;
    surface: PointableSelectionSurface;
    range: Range;
    sourceRoot: Element;
    contextFingerprint: string;
  };
  type PendingState = {
    requestId: string;
    generation: number;
    digest: string;
    contextFingerprint: string;
    operation: "resolve" | "choose" | "check" | "refresh";
    candidateRef?: string;
    detailRef?: string;
    timeout: number;
  };

  let state: PointableRendererStatus["state"] = "idle";
  let generation = 0;
  let candidate: CandidateState | undefined;
  let pending: PendingState | undefined;
  let repositionFrame: number | undefined;
  let reconcileFrame: number | undefined;
  let outsideHandler: ((event: PointerEvent) => void) | undefined;
  let restoreFocus: HTMLElement | undefined;
  let actionElement: HTMLButtonElement | undefined;
  let cardElement: HTMLElement | undefined;
  let revisionTimer: number | undefined;
  let holdCardPlacementUntil = 0;
  let uninstalled = false;
  const activeObserver = new MutationObserver(() => {
    if (candidate !== undefined) scheduleReconcile();
  });
  const resizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => reposition())
    : undefined;

  const pointerUpHandler = (event: PointerEvent): void => {
    const ownedInteraction = event.composedPath().some((item) =>
      item instanceof Element &&
      item.getAttribute("data-pointable-context-owned") === lifecycleId);
    if (event.button === 0 && !ownedInteraction) {
      window.setTimeout(evaluateSelection, 0);
    }
  };
  const keyUpHandler = (event: KeyboardEvent): void => {
    if (
      event.key.startsWith("Arrow") ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      window.setTimeout(evaluateSelection, 0);
    }
  };
  const keyDownHandler = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && (candidate !== undefined || ownedUiExists())) {
      event.preventDefault();
      cleanup(true, true);
      return;
    }
    if (
      event.altKey &&
      event.shiftKey &&
      event.key.toLowerCase() === "k"
    ) {
      const action = connectedOwnedElement("action");
      if (action instanceof HTMLButtonElement) {
        event.preventDefault();
        if (event.isTrusted && candidate !== undefined) {
          void submitLookup("resolve", candidate.generation);
        }
      }
    }
  };
  const viewportHandler = (): void => reposition();
  const routeHandler = (): void => {
    reconcile();
  };
  const selectionHandler = (): void => {
    window.setTimeout(evaluateSelection, 0);
  };

  document.addEventListener("selectionchange", selectionHandler);
  document.addEventListener("pointerup", pointerUpHandler, true);
  document.addEventListener("keyup", keyUpHandler, true);
  document.addEventListener("keydown", keyDownHandler, true);
  window.addEventListener("scroll", viewportHandler, true);
  window.addEventListener("resize", viewportHandler);
  window.addEventListener("popstate", routeHandler);
  window.addEventListener("hashchange", routeHandler);
  window.visualViewport?.addEventListener("resize", viewportHandler);
  window.visualViewport?.addEventListener("scroll", viewportHandler);

  function ownedUiExists(): boolean {
    return (
      connectedOwnedElement("action") !== null ||
      connectedOwnedElement("card") !== null
    );
  }

  function ownedElement(role: "action" | "card"): HTMLElement | null {
    const element = role === "action" ? actionElement : cardElement;
    return element instanceof HTMLElement &&
      element.getAttribute("data-pointable-context-owned") === lifecycleId
      ? element
      : null;
  }

  function connectedOwnedElement(role: "action" | "card"): HTMLElement | null {
    const element = ownedElement(role);
    return element?.isConnected === true ? element : null;
  }

  function removeOwned(role: "action" | "card"): void {
    ownedElement(role)?.remove();
    if (role === "action") actionElement = undefined;
    else cardElement = undefined;
  }

  function availableOwnedId(base: string): string {
    if (document.getElementById(base) === null) return base;
    for (let suffix = 1; suffix <= 32; suffix += 1) {
      const candidateId = `${base}-${suffix}`;
      if (document.getElementById(candidateId) === null) return candidateId;
    }
    throw new Error("pointable_renderer_id_capacity");
  }

  function readContextFingerprint(): string {
    const activeThread = document.querySelector<HTMLElement>(
      '[data-app-action-sidebar-thread-active="true"]',
    );
    return JSON.stringify({
      href: window.location.href,
      threadId: activeThread?.getAttribute("data-app-action-sidebar-thread-id") ?? null,
      hostId: activeThread?.getAttribute("data-app-action-sidebar-thread-host-id") ?? null,
    });
  }

  function nodeElement(node: Node): Element | null {
    return node.nodeType === Node.ELEMENT_NODE
      ? node as Element
      : node.parentElement;
  }

  const rejectedSelector =
    '[data-pointable-context-owned], nav, header, form, textarea, input, iframe, ' +
      '[contenteditable="true"], [data-testid="subagent-activity-inline-group"], ' +
      '[data-testid*="terminal" i], [data-testid*="diff" i], ' +
      '[data-testid*="browser" i], [class*="terminal" i], [class*="diff" i]';

  function rejectedSurface(element: Element): boolean {
    return element.closest(rejectedSelector) !== null;
  }

  function rangeCrossesRejectedSurface(range: Range): boolean {
    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_ELEMENT,
    );
    let visited = 0;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      visited += 1;
      if (visited > 2_048) return true;
      const element = node as Element;
      try {
        if (element.matches(rejectedSelector) && range.intersectsNode(element)) {
          return true;
        }
      } catch {
        return true;
      }
    }
    return false;
  }

  function selectionSurface(
    start: Element,
    end: Element,
    range: Range,
  ): { root: Element; surface: PointableSelectionSurface } | undefined {
    if (
      rejectedSurface(start) ||
      rejectedSurface(end) ||
      rangeCrossesRejectedSurface(range)
    ) {
      return undefined;
    }
    const startRoot = start.closest("[data-selected-text-overlay-target]");
    const endRoot = end.closest("[data-selected-text-overlay-target]");
    if (
      startRoot === null ||
      startRoot !== endRoot ||
      !stableRoot.contains(startRoot)
    ) {
      return undefined;
    }
    if (startRoot.closest('[data-user-message-bubble="true"]') !== null) {
      return { root: startRoot, surface: "user_message" };
    }
    if (
      startRoot.closest(
        "[data-response-annotation-target], [data-local-conversation-final-assistant]",
      ) !== null
    ) {
      return { root: startRoot, surface: "assistant_message" };
    }
    return undefined;
  }

  function rootVisible(root: Element): boolean {
    if (!root.isConnected || root.closest("[hidden], [inert]") !== null) return false;
    const style = window.getComputedStyle(root);
    const rect = root.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function evaluateSelection(): void {
    if (uninstalled) return;
    const selection = window.getSelection();
    if (selection === null || selection.rangeCount !== 1 || selection.isCollapsed) {
      if (state === "resolving" || connectedOwnedElement("card") !== null) return;
      cleanup(true, false);
      return;
    }
    const range = selection.getRangeAt(0);
    const start = nodeElement(range.startContainer);
    const end = nodeElement(range.endContainer);
    if (start === null || end === null) {
      cleanup(true, false);
      return;
    }
    const admitted = selectionSurface(start, end, range);
    const rect = range.getBoundingClientRect();
    const decision = evaluateEligibility({
      rangeCount: selection.rangeCount,
      collapsed: selection.isCollapsed,
      text: selection.toString(),
      ...(admitted === undefined ? {} : { surface: admitted.surface }),
      sameSurface: admitted !== undefined,
      connected: admitted?.root.isConnected === true,
      visible: admitted !== undefined && rootVisible(admitted.root),
      rectWidth: rect.width,
      rectHeight: rect.height,
    });
    if (decision.kind !== "eligible" || admitted === undefined) {
      cleanup(true, false);
      return;
    }
    const contextFingerprint = readContextFingerprint();
    if (
      candidate?.text === decision.text &&
      candidate.surface === decision.surface &&
      candidate.sourceRoot === admitted.root &&
      candidate.contextFingerprint === contextFingerprint
    ) {
      candidate.range = range.cloneRange();
      reposition();
      return;
    }
    cleanup(true, false);
    candidate = {
      generation: ++generation,
      text: decision.text,
      surface: decision.surface,
      range: range.cloneRange(),
      sourceRoot: admitted.root,
      contextFingerprint,
    };
    activeObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "hidden",
        "inert",
        "data-app-action-sidebar-thread-active",
        "data-app-action-sidebar-thread-id",
        "data-app-action-sidebar-thread-host-id",
      ],
    });
    mountAction();
  }

  function mountAction(): void {
    if (candidate === undefined) return;
    removeOwned("action");
    removeOwned("card");
    state = "affordance";
    const action = document.createElement("button");
    action.id = availableOwnedId(actionIdBase);
    action.type = "button";
    action.textContent = actionLabel;
    action.setAttribute("aria-label", "查看所选文字中的上下文");
    action.setAttribute("aria-keyshortcuts", "Alt+Shift+K");
    action.setAttribute("data-pointable-context-owned", lifecycleId);
    action.setAttribute("data-pointable-context-role", "action");
    Object.assign(action.style, {
      position: "fixed",
      zIndex: "2147483000",
      border: "1px solid rgba(45, 91, 255, .38)",
      borderRadius: "999px",
      background: "#ffffff",
      color: "#1746c7",
      padding: "7px 11px",
      boxShadow: "0 8px 24px rgba(15, 23, 42, .18)",
      font: "600 12px/1.2 system-ui, sans-serif",
      cursor: "pointer",
    });
    const expectedGeneration = candidate.generation;
    const preserveSelection = (event: PointerEvent | MouseEvent): void => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
    };
    action.addEventListener("pointerdown", preserveSelection);
    // Chromium's native text selection can be collapsed by the compatibility
    // mousedown even when pointerdown was cancelled through CDP. Preserve the
    // explicit selection until the trusted click has been fenced and sent.
    action.addEventListener("mousedown", preserveSelection);
    action.addEventListener("pointerup", (event) => {
      if (event.button === 0) event.stopPropagation();
    });
    action.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      void submitLookup("resolve", expectedGeneration);
    });
    actionElement = action;
    document.body.append(action);
    installOutsideHandler();
    resizeObserver?.disconnect();
    resizeObserver?.observe(action);
    reposition();
  }

  function installOutsideHandler(): void {
    if (outsideHandler !== undefined) return;
    outsideHandler = (event) => {
      const target = event.target;
      const action = connectedOwnedElement("action");
      const card = connectedOwnedElement("card");
      if (
        target instanceof Node &&
        (action?.contains(target) === true || card?.contains(target) === true)
      ) {
        return;
      }
      const composer = card !== null && target instanceof Element
        ? target.closest<HTMLElement>(
            'textarea, input, [contenteditable="true"], [role="textbox"]',
          )
        : null;
      if (composer !== null && stableRoot.contains(composer)) {
        restoreFocus = composer;
        return;
      }
      cleanup(true, true);
    };
    window.addEventListener("pointerdown", outsideHandler, true);
  }

  async function digestText(value: string): Promise<string> {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  async function submitLookup(
    operation: "resolve" | "choose" | "check" | "refresh",
    expectedGeneration: number,
    reference?: string,
  ): Promise<void> {
    const current = candidate;
    if (
      current === undefined ||
      current.generation !== expectedGeneration ||
      current.range.toString().trim() !== current.text ||
      readContextFingerprint() !== current.contextFingerprint ||
      !candidateAnchorIsCurrent()
    ) {
      cleanup(true, false);
      return;
    }
    if (
      (operation === "resolve" && reference !== undefined) ||
      (operation === "choose" &&
        (typeof reference !== "string" ||
          reference.length < 8 ||
          reference.length > 256)) ||
      ((operation === "check" || operation === "refresh") &&
        (typeof reference !== "string" ||
          reference.length < 8 ||
          reference.length > 256))
    ) {
      if (operation === "check" || operation === "refresh") {
        showRevisionNotice("unavailable", reference);
      } else {
        mountError("候选引用无效。", false);
      }
      return;
    }
    // Commit the explicit trusted activation synchronously. Chromium may
    // collapse the native Selection before the asynchronous digest finishes;
    // the cloned Range and context fences remain the authority after click.
    if (operation === "resolve" || operation === "choose") state = "resolving";
    try {
      const digest = await digestText(current.text);
      if (
        candidate?.generation !== expectedGeneration ||
        current.range.toString().trim() !== current.text ||
        readContextFingerprint() !== current.contextFingerprint ||
        !candidateAnchorIsCurrent()
      ) {
        cleanup(true, false);
        return;
      }
      if (pending !== undefined) window.clearTimeout(pending.timeout);
      const requestId = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const timeout = window.setTimeout(() => {
        if (pending?.requestId !== requestId) return;
        pending = undefined;
        if (operation === "check" || operation === "refresh") {
          showRevisionNotice("unavailable", reference);
        } else {
          mountError("查询超时，请重试。", true);
        }
      }, requestTimeoutMs);
      pending = {
        requestId,
        generation: current.generation,
        digest,
        contextFingerprint: current.contextFingerprint,
        operation,
        ...(operation === "choose" && reference !== undefined
          ? { candidateRef: reference }
          : {}),
        ...((operation === "check" || operation === "refresh") && reference !== undefined
          ? { detailRef: reference }
          : {}),
        timeout,
      };
      if (operation === "resolve" || operation === "choose") {
        mountLoading(operation === "choose" ? "正在读取上下文详情…" : "正在查找上下文对象…");
      } else if (operation === "refresh") {
        showRevisionNotice("refreshing", reference);
      }
      const payload = {
        schemaVersion: 1,
        kind: "pointable.selection.lookup",
        operation,
        requestId,
        selectionGeneration: current.generation,
        selectionText: current.text,
        selectionDigest: digest,
        surface: current.surface,
        contextFingerprint: current.contextFingerprint,
        requestedAt: new Date().toISOString(),
        ...(operation === "choose" && reference !== undefined
          ? { candidateRef: reference }
          : {}),
        ...((operation === "check" || operation === "refresh") && reference !== undefined
          ? { detailRef: reference }
          : {}),
      };
      (binding as (payload: string) => void)(JSON.stringify(payload));
    } catch {
      if (pending !== undefined) window.clearTimeout(pending.timeout);
      pending = undefined;
      if (operation === "check" || operation === "refresh") {
        showRevisionNotice("unavailable", reference);
      } else {
        mountError("宿主查询通道不可用。", true);
      }
    }
  }

  function createShell(
    titleText: string,
    reuseExisting = false,
  ): { shell: HTMLElement; body: HTMLElement } {
    const existing = reuseExisting ? connectedOwnedElement("card") : null;
    const preservedScrollTop = existing?.scrollTop ?? 0;
    removeOwned("action");
    if (existing === null) removeOwned("card");
    if (restoreFocus === undefined && document.activeElement instanceof HTMLElement) {
      restoreFocus = document.activeElement;
    }
    const shell = existing ?? document.createElement("section");
    if (existing === null) {
      shell.id = availableOwnedId(cardIdBase);
      shell.tabIndex = -1;
      shell.setAttribute("role", "dialog");
      shell.setAttribute("aria-modal", "false");
      shell.setAttribute("aria-labelledby", `${shell.id}-title`);
      shell.setAttribute("data-pointable-context-owned", lifecycleId);
      shell.setAttribute("data-pointable-context-role", "card");
      shell.setAttribute("data-pointable-context-presentation", presentationMode);
      Object.assign(shell.style, {
        position: "fixed",
        zIndex: "2147482999",
        width: "min(380px, calc(100vw - 24px))",
        maxHeight: "min(480px, calc(100vh - 24px))",
        overflow: "auto",
        border: "1px solid rgba(45, 91, 255, .32)",
        borderRadius: "12px",
        background: "#ffffff",
        color: "#172033",
        boxShadow: "0 18px 48px rgba(15, 23, 42, .24)",
        font: "13px/1.45 system-ui, sans-serif",
      });
    } else {
      shell.replaceChildren();
      holdCardPlacementUntil = performance.now() + 250;
    }
    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      padding: "10px 12px",
      borderBottom: "1px solid #e2e8f0",
    });
    const title = document.createElement("h2");
    title.id = `${shell.id}-title`;
    title.textContent = titleText;
    Object.assign(title.style, { margin: "0", font: "700 14px/1.3 system-ui" });
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "关闭";
    close.setAttribute("aria-label", "关闭上下文详情");
    Object.assign(close.style, {
      border: "1px solid #d7deea",
      borderRadius: "7px",
      background: "#ffffff",
      color: "#334155",
      padding: "4px 8px",
      cursor: "pointer",
      font: "600 12px/1.2 system-ui",
    });
    const dismissPointer = (event: PointerEvent | MouseEvent): void => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
    };
    close.addEventListener("pointerdown", dismissPointer);
    close.addEventListener("mousedown", dismissPointer);
    close.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      // Closing is a terminal action for this selection. Merely removing the
      // card leaves Chromium's native Range alive, allowing a queued
      // selectionchange/reconcile pass to recreate the affordance.
      window.getSelection()?.removeAllRanges();
      cleanup(true, true);
    });
    header.append(title, close);
    const body = document.createElement("div");
    Object.assign(body.style, { padding: "12px" });
    shell.append(header, body);
    cardElement = shell;
    if (existing === null) document.body.append(shell);
    installOutsideHandler();
    if (existing === null) {
      resizeObserver?.disconnect();
      resizeObserver?.observe(shell);
      window.queueMicrotask(() => {
        if (shell.isConnected) shell.focus({ preventScroll: true });
      });
      reposition();
    } else {
      window.queueMicrotask(() => {
        if (shell.isConnected) {
          shell.scrollTop = preservedScrollTop;
          shell.focus({ preventScroll: true });
        }
      });
    }
    return { shell, body };
  }

  function paragraph(text: string, muted = false): HTMLParagraphElement {
    const value = document.createElement("p");
    value.textContent = text;
    Object.assign(value.style, {
      margin: "0",
      color: muted ? "#64748b" : "#172033",
      overflowWrap: "anywhere",
    });
    return value;
  }

  function mountLoading(message: string): void {
    state = "resolving";
    const { body } = createShell("上下文详情");
    const status = paragraph(message, true);
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    body.append(status);
  }

  function mountCandidates(
    candidates: Array<{
      candidateRef: string;
      label: string;
      entityType: string;
      summary: string;
    }>,
  ): void {
    state = "candidates";
    const currentGeneration = candidate?.generation;
    if (currentGeneration === undefined) return;
    const { body } = createShell("选择上下文对象");
    const instruction = paragraph(`找到 ${candidates.length} 个匹配项，请选择：`, true);
    instruction.id = `${cardElement?.id ?? cardIdBase}-candidate-instruction`;
    const group = document.createElement("div");
    group.setAttribute("role", "group");
    group.setAttribute("aria-labelledby", instruction.id);
    Object.assign(group.style, { display: "grid", gap: "8px", marginTop: "10px" });
    for (const item of candidates) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `${item.label}，${item.entityType}`);
      Object.assign(button.style, {
        display: "grid",
        gap: "3px",
        width: "100%",
        textAlign: "left",
        border: "1px solid #d7deea",
        borderRadius: "9px",
        background: "#ffffff",
        color: "#172033",
        padding: "9px 10px",
        cursor: "pointer",
      });
      const label = document.createElement("span");
      label.textContent = item.label;
      label.style.fontWeight = "700";
      const type = document.createElement("span");
      type.textContent = item.entityType;
      Object.assign(type.style, { color: "#52627a", fontSize: "12px" });
      const summary = document.createElement("span");
      summary.textContent = item.summary;
      Object.assign(summary.style, { color: "#52627a", fontSize: "12px" });
      button.append(label, type, summary);
      button.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        void submitLookup("choose", currentGeneration, item.candidateRef);
      });
      group.append(button);
    }
    body.append(instruction, group);
  }

  function metadataRow(labelText: string, valueText: string): HTMLElement {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "grid",
      gridTemplateColumns: "96px minmax(0, 1fr)",
      gap: "8px",
      padding: "3px 0",
    });
    const label = document.createElement("strong");
    label.textContent = labelText;
    label.style.color = "#52627a";
    const value = document.createElement("span");
    value.textContent = valueText;
    value.style.overflowWrap = "anywhere";
    row.append(label, value);
    return row;
  }

  function clearRevisionTimer(): void {
    if (revisionTimer !== undefined) window.clearTimeout(revisionTimer);
    revisionTimer = undefined;
  }

  function removeRevisionNotice(): void {
    connectedOwnedElement("card")
      ?.querySelector('[data-pointable-context-role="revision-notice"]')
      ?.remove();
  }

  function scheduleRevisionCheck(detailRef: string, expectedGeneration: number): void {
    clearRevisionTimer();
    revisionTimer = window.setTimeout(() => {
      revisionTimer = undefined;
      if (
        state !== "detail" ||
        candidate?.generation !== expectedGeneration ||
        connectedOwnedElement("card") === null
      ) {
        return;
      }
      if (pending !== undefined) {
        scheduleRevisionCheck(detailRef, expectedGeneration);
        return;
      }
      void submitLookup("check", expectedGeneration, detailRef);
    }, revisionCheckIntervalMs);
  }

  function showRevisionNotice(
    noticeState: "updated" | "deleted" | "unavailable" | "refreshing",
    detailRef: string | undefined,
  ): void {
    clearRevisionTimer();
    const shell = connectedOwnedElement("card");
    if (shell === null) return;
    removeRevisionNotice();
    const notice = document.createElement("div");
    notice.setAttribute("data-pointable-context-role", "revision-notice");
    notice.setAttribute("role", "status");
    Object.assign(notice.style, {
      margin: "8px 12px 0",
      padding: "8px 10px",
      borderRadius: "8px",
      background: noticeState === "deleted" || noticeState === "unavailable"
        ? "#fff4e5"
        : "#eef4ff",
      color: noticeState === "deleted" || noticeState === "unavailable"
        ? "#8a4b00"
        : "#1746c7",
      fontSize: "12px",
    });
    const message = document.createElement("span");
    message.textContent = noticeState === "updated"
      ? "内容已更新"
      : noticeState === "deleted"
        ? "对象已删除；当前显示的是旧快照"
        : noticeState === "refreshing"
          ? "正在刷新当前详情…"
          : "暂时无法确认最新状态；当前显示的是旧快照";
    notice.append(message);
    if (noticeState === "updated" && detailRef !== undefined) {
      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.textContent = "刷新内容";
      refresh.setAttribute("data-pointable-context-role", "revision-refresh");
      Object.assign(refresh.style, {
        marginLeft: "8px",
        border: "0",
        background: "transparent",
        color: "#1746c7",
        padding: "1px 0",
        cursor: "pointer",
        fontWeight: "700",
      });
      const expectedGeneration = candidate?.generation;
      refresh.addEventListener("click", (event) => {
        if (!event.isTrusted || expectedGeneration === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        void submitLookup("refresh", expectedGeneration, detailRef);
      });
      notice.append(refresh);
    }
    const header = shell.firstElementChild;
    if (header?.nextSibling === null) shell.append(notice);
    else shell.insertBefore(notice, header?.nextSibling ?? shell.firstChild);
    reposition();
  }

  function mountComprehension(
    body: HTMLElement,
    model: PointableComprehensionView,
    evidenceExpanded = false,
  ): void {
    const surface = document.createElement("div");
    surface.setAttribute("data-pointable-context-role", "comprehension-model");
    surface.setAttribute("data-pointable-context-kind", model.kind);
    const modelBlock = (
      role: string,
      label: string,
      text: string,
      tone: "neutral" | "primary" | "impact" = "neutral",
    ): HTMLElement => {
      const block = document.createElement("div");
      block.setAttribute("data-pointable-context-role", role);
      Object.assign(block.style, {
        marginTop: "10px",
        padding: "8px 10px",
        borderLeft: tone === "primary" ? "3px solid #7798ff" : "3px solid #d7deea",
        borderRadius: "0 8px 8px 0",
        background: tone === "primary" ? "#edf2ff" : tone === "impact" ? "#fff7ed" : "#f8fafc",
        color: tone === "primary" ? "#1746c7" : tone === "impact" ? "#8a4b00" : "#334155",
      });
      const heading = document.createElement("strong");
      heading.textContent = label;
      Object.assign(heading.style, {
        display: "block",
        marginBottom: "3px",
        fontSize: "12px",
      });
      block.append(heading, paragraph(text, true));
      return block;
    };
    const arrow = (): HTMLElement => {
      const node = document.createElement("div");
      node.textContent = "↓";
      node.setAttribute("aria-hidden", "true");
      Object.assign(node.style, {
        height: "16px",
        color: "#94a3b8",
        textAlign: "center",
        lineHeight: "16px",
      });
      return node;
    };

    if (model.kind === "concept") {
      surface.append(paragraph(model.meaning));
      surface.append(modelBlock(
        "comprehension-context",
        "为什么现在出现",
        model.context,
        "primary",
      ));

      const flow = document.createElement("div");
      flow.setAttribute("data-pointable-context-role", "comprehension-flow");
      Object.assign(flow.style, { marginTop: "12px" });
      const flowLabel = document.createElement("strong");
      flowLabel.textContent = "你现在位于这里";
      Object.assign(flowLabel.style, {
        display: "block",
        marginBottom: "6px",
        color: "#334155",
        fontSize: "12px",
      });
      flow.append(flowLabel);
      for (let index = 0; index < model.sequence.length; index += 1) {
        const step = document.createElement("div");
        const current = index === model.currentStep;
        step.setAttribute("data-pointable-context-role", "comprehension-step");
        step.setAttribute("data-pointable-context-current", String(current));
        step.textContent = `${current ? "当前 · " : ""}${model.sequence[index] ?? ""}`;
        Object.assign(step.style, {
          padding: "6px 9px",
          border: current ? "1px solid #7798ff" : "1px solid #dce3ee",
          borderRadius: "8px",
          background: current ? "#edf2ff" : "#ffffff",
          color: current ? "#1746c7" : "#52627a",
          fontWeight: current ? "700" : "500",
          fontSize: "12px",
        });
        flow.append(step);
        if (index < model.sequence.length - 1) flow.append(arrow());
      }
      surface.append(flow);

      const boundary = modelBlock(
        "comprehension-boundary",
        "不会证明：",
        model.boundary,
        "impact",
      );
      boundary.style.borderLeft = "3px solid #f2b86b";
      surface.append(boundary);
    } else if (model.kind === "change") {
      surface.append(
        modelBlock("comprehension-before", "原来", model.before),
        arrow(),
        modelBlock("comprehension-after", "现在", model.after, "primary"),
        modelBlock("comprehension-impact", "这会影响", model.impact, "impact"),
      );
    } else {
      surface.append(
        modelBlock("comprehension-problem", "要解决的问题", model.problem),
        arrow(),
        modelBlock("comprehension-choice", "选择", model.choice, "primary"),
        modelBlock("comprehension-consequence", "结果与代价", model.consequence, "impact"),
      );
    }

    const evidenceDisclosure = document.createElement("div");
    evidenceDisclosure.setAttribute("data-pointable-context-role", "evidence-disclosure");
    Object.assign(evidenceDisclosure.style, { marginTop: "8px" });
    const evidenceToggle = document.createElement("button");
    evidenceToggle.type = "button";
    evidenceToggle.textContent = evidenceExpanded ? "收起依据" : "为什么这样说";
    evidenceToggle.setAttribute("aria-expanded", String(evidenceExpanded));
    evidenceToggle.setAttribute("data-pointable-context-role", "evidence-toggle");
    Object.assign(evidenceToggle.style, {
      border: "0",
      background: "transparent",
      color: "#52627a",
      cursor: "pointer",
      padding: "2px 0",
      fontSize: "12px",
      fontWeight: "600",
    });
    const evidenceBody = document.createElement("div");
    evidenceBody.id = `${cardElement?.id ?? cardIdBase}-evidence-body`;
    evidenceBody.hidden = !evidenceExpanded;
    evidenceBody.style.display = evidenceExpanded ? "block" : "none";
    evidenceBody.setAttribute("data-pointable-context-role", "evidence-body");
    evidenceToggle.setAttribute("aria-controls", evidenceBody.id);
    for (const item of model.evidence) {
      const quote = document.createElement("blockquote");
      quote.textContent = item.excerpt;
      Object.assign(quote.style, {
        margin: "8px 0 0",
        padding: "7px 9px",
        borderLeft: "3px solid #cbd5e1",
        color: "#475569",
        fontSize: "11px",
      });
      const source = paragraph(item.source, true);
      Object.assign(source.style, { marginTop: "4px", fontSize: "11px" });
      evidenceBody.append(quote, source);
    }
    evidenceToggle.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      event.preventDefault();
      event.stopPropagation();
      const expanded = evidenceToggle.getAttribute("aria-expanded") !== "true";
      evidenceToggle.setAttribute("aria-expanded", String(expanded));
      evidenceBody.hidden = !expanded;
      evidenceBody.style.display = expanded ? "block" : "none";
      evidenceToggle.textContent = expanded ? "收起依据" : "为什么这样说";
      reposition();
    });
    evidenceDisclosure.append(evidenceToggle, evidenceBody);
    surface.append(evidenceDisclosure);
    body.append(surface);
  }

  function mountDetail(detail: PointableDetailView, preserveUiState = false): void {
    clearRevisionTimer();
    const previousCard = preserveUiState ? connectedOwnedElement("card") : null;
    const detailExpanded = previousCard
      ?.querySelector('[data-pointable-context-role="detail-toggle"]')
      ?.getAttribute("aria-expanded") === "true";
    const evidenceExpanded = previousCard
      ?.querySelector('[data-pointable-context-role="evidence-toggle"]')
      ?.getAttribute("aria-expanded") === "true";
    state = "detail";
    const { body } = createShell(detail.label, preserveUiState);
    if (presentationMode === "mental-model" && detail.comprehension !== undefined) {
      mountComprehension(body, detail.comprehension, evidenceExpanded);
    } else {
      const summary = presentationMode === "record"
        ? detail.summary
        : detail.humanSummary ?? detail.summary;
      body.append(paragraph(summary));
    }
    if (detail.changes !== undefined && detail.changes.length > 0) {
      const changeSummary = document.createElement("div");
      changeSummary.setAttribute("data-pointable-context-role", "revision-changes");
      Object.assign(changeSummary.style, {
        marginTop: "8px",
        padding: "8px 10px",
        borderRadius: "8px",
        background: "#eef4ff",
        color: "#1746c7",
        fontSize: "12px",
      });
      const heading = document.createElement("strong");
      heading.textContent = "本次刷新";
      const list = document.createElement("ul");
      Object.assign(list.style, { margin: "4px 0 0", paddingLeft: "18px" });
      for (const change of detail.changes) {
        const item = document.createElement("li");
        item.textContent = `${change.label}：${change.before} → ${change.after}`;
        list.append(item);
      }
      changeSummary.append(heading, list);
      body.append(changeSummary);
    }
    const compactState = document.createElement("div");
    compactState.textContent = `${detail.entityType} · ${detail.freshness}`;
    Object.assign(compactState.style, {
      marginTop: "6px",
      color: detail.freshness === "current" ? "#64748b" : "#a15c00",
      fontSize: "11px",
      overflowWrap: "anywhere",
    });
    body.append(compactState);

    const disclosure = document.createElement("div");
    disclosure.setAttribute("data-pointable-context-role", "detail-disclosure");
    Object.assign(disclosure.style, { marginTop: "8px" });
    const disclosureToggle = document.createElement("button");
    disclosureToggle.type = "button";
    disclosureToggle.textContent = detailExpanded ? "收起详情" : "查看详情";
    disclosureToggle.setAttribute("aria-label", "展开上下文详情");
    disclosureToggle.setAttribute("aria-expanded", String(detailExpanded));
    disclosureToggle.setAttribute("data-pointable-context-role", "detail-toggle");
    Object.assign(disclosureToggle.style, {
      border: "0",
      background: "transparent",
      padding: "2px 0",
      width: "fit-content",
      color: "#52627a",
      cursor: "pointer",
      fontSize: "12px",
      fontWeight: "600",
      userSelect: "none",
    });
    const detailBody = document.createElement("div");
    detailBody.id = `${cardElement?.id ?? cardIdBase}-detail-body`;
    detailBody.hidden = !detailExpanded;
    detailBody.style.display = detailExpanded ? "block" : "none";
    detailBody.setAttribute("data-pointable-context-role", "detail-body");
    disclosureToggle.setAttribute("aria-controls", detailBody.id);
    const metadata = document.createElement("div");
    Object.assign(metadata.style, {
      marginTop: "10px",
      paddingTop: "8px",
      borderTop: "1px solid #e2e8f0",
    });
    metadata.append(
      metadataRow("类型", detail.entityType),
      metadataRow("实体", detail.entityId),
      metadataRow("新鲜度", detail.freshness),
      metadataRow("修订版", detail.revision),
      metadataRow("数据时间", detail.observedAt),
    );
    detailBody.append(metadata);
    if (detail.facts.length > 0) {
      const heading = document.createElement("h3");
      heading.textContent = "关键事实";
      Object.assign(heading.style, { margin: "12px 0 4px", fontSize: "13px" });
      const facts = document.createElement("div");
      for (const fact of detail.facts) facts.append(metadataRow(fact.label, fact.value));
      detailBody.append(heading, facts);
    }
    if (detail.sources.length > 0) {
      const heading = document.createElement("h3");
      heading.textContent = "来源";
      Object.assign(heading.style, { margin: "12px 0 4px", fontSize: "13px" });
      const list = document.createElement("ul");
      Object.assign(list.style, { margin: "0", paddingLeft: "20px" });
      for (const source of detail.sources) {
        const item = document.createElement("li");
        item.textContent = source.label;
        list.append(item);
      }
      detailBody.append(heading, list);
    }
    disclosure.append(disclosureToggle, detailBody);
    disclosureToggle.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      event.preventDefault();
      event.stopPropagation();
      const expanded = disclosureToggle.getAttribute("aria-expanded") !== "true";
      disclosureToggle.setAttribute("aria-expanded", String(expanded));
      detailBody.hidden = !expanded;
      detailBody.style.display = expanded ? "block" : "none";
      disclosureToggle.textContent = expanded ? "收起详情" : "查看详情";
      disclosureToggle.setAttribute(
        "aria-label",
        expanded ? "收起上下文详情" : "展开上下文详情",
      );
      reposition();
    });
    body.append(disclosure);
    if (detail.detailRef !== undefined && candidate !== undefined) {
      scheduleRevisionCheck(detail.detailRef, candidate.generation);
    }
  }

  function mountError(message: string, retryable: boolean): void {
    state = "error";
    const currentGeneration = candidate?.generation;
    const { body } = createShell("上下文详情不可用");
    const error = paragraph(message);
    error.setAttribute("role", "alert");
    error.style.color = "#a8241b";
    body.append(error);
    if (retryable && currentGeneration !== undefined) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "重试";
      Object.assign(retry.style, {
        marginTop: "10px",
        border: "1px solid #d7deea",
        borderRadius: "7px",
        background: "#ffffff",
        color: "#1746c7",
        padding: "6px 10px",
        cursor: "pointer",
        fontWeight: "600",
      });
      retry.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        void submitLookup("resolve", currentGeneration);
      });
      body.append(retry);
    }
  }

  function receiveResult(value: unknown): PointableRendererAck {
    const response = validateResponse(value);
    if (response === undefined) {
      return {
        ok: false,
        outcome: "invalid_payload",
        code: "pointable_result_invalid",
      };
    }
    const request = pending;
    if (
      request === undefined ||
      response.requestId !== request.requestId ||
      response.selectionGeneration !== request.generation ||
      response.selectionDigest !== request.digest
    ) {
      return {
        ok: false,
        requestId: response.requestId,
        outcome: "stale",
        code: "pointable_result_stale",
      };
    }
    if (
      response.contextFingerprint !== request.contextFingerprint ||
      candidate?.generation !== request.generation ||
      readContextFingerprint() !== request.contextFingerprint ||
      !candidateAnchorIsCurrent()
    ) {
      window.clearTimeout(request.timeout);
      pending = undefined;
      cleanup(true, false);
      return {
        ok: false,
        requestId: response.requestId,
        outcome: "context_changed",
        code: "pointable_context_changed",
      };
    }
    if (
      (response.presentation.kind === "revision" &&
        (request.operation !== "check" ||
          response.presentation.revision.detailRef !== request.detailRef)) ||
      (request.operation === "refresh" &&
        response.presentation.kind === "detail" &&
        response.presentation.detail.detailRef !== request.detailRef)
    ) {
      window.clearTimeout(request.timeout);
      pending = undefined;
      return {
        ok: false,
        requestId: response.requestId,
        outcome: "stale",
        code: "pointable_refresh_ref_mismatch",
      };
    }
    window.clearTimeout(request.timeout);
    pending = undefined;
    if (response.presentation.kind === "candidates") {
      mountCandidates(response.presentation.candidates);
    } else if (response.presentation.kind === "detail") {
      mountDetail(response.presentation.detail, request.operation === "refresh");
    } else if (response.presentation.kind === "revision") {
      const revision = response.presentation.revision;
      state = "detail";
      if (revision.state === "unchanged") {
        removeRevisionNotice();
        scheduleRevisionCheck(revision.detailRef, request.generation);
      } else {
        showRevisionNotice(revision.state, revision.detailRef);
      }
    } else if (request.operation === "check" || request.operation === "refresh") {
      state = "detail";
      showRevisionNotice("unavailable", request.detailRef);
    } else {
      mountError(response.presentation.message, response.presentation.retryable);
    }
    return { ok: true, requestId: response.requestId, outcome: "applied" };
  }

  function verifyFence(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const fence = value as Record<string, unknown>;
    const request = pending;
    return (
      request !== undefined &&
      fence.requestId === request.requestId &&
      fence.selectionGeneration === request.generation &&
      fence.selectionDigest === request.digest &&
      fence.contextFingerprint === request.contextFingerprint &&
      candidate?.generation === request.generation &&
      readContextFingerprint() === request.contextFingerprint &&
      candidateAnchorIsCurrent()
    );
  }

  function candidateAnchorIsCurrent(): boolean {
    const current = candidate;
    if (
      current === undefined ||
      !current.sourceRoot.isConnected ||
      !current.range.commonAncestorContainer.isConnected ||
      current.range.toString().trim() !== current.text ||
      !rootVisible(current.sourceRoot)
    ) {
      return false;
    }
    const start = nodeElement(current.range.startContainer);
    const end = nodeElement(current.range.endContainer);
    if (start === null || end === null) return false;
    const admitted = selectionSurface(start, end, current.range);
    return (
      admitted !== undefined &&
      admitted.root === current.sourceRoot &&
      admitted.surface === current.surface
    );
  }

  function scheduleReconcile(): void {
    if (reconcileFrame !== undefined) return;
    reconcileFrame = window.requestAnimationFrame(() => {
      reconcileFrame = undefined;
      reconcile();
    });
  }

  function reconcile(): PointableRendererStatus {
    if (candidate === undefined) return status();
    if (
      readContextFingerprint() !== candidate.contextFingerprint ||
      !candidateAnchorIsCurrent()
    ) {
      cleanup(true, false);
      return status();
    }
    reposition();
    return status();
  }

  function reposition(): void {
    if (repositionFrame !== undefined) return;
    repositionFrame = window.requestAnimationFrame(() => {
      repositionFrame = undefined;
      const current = candidate;
      const target = connectedOwnedElement("card") ?? connectedOwnedElement("action");
      if (current === undefined || !(target instanceof HTMLElement)) return;
      if (
        target.getAttribute("data-pointable-context-role") === "card" &&
        performance.now() < holdCardPlacementUntil
      ) {
        return;
      }
      if (
        readContextFingerprint() !== current.contextFingerprint ||
        !candidateAnchorIsCurrent()
      ) {
        cleanup(true, false);
        return;
      }
      const rect = current.range.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        cleanup(true, false);
        return;
      }
      const viewport = window.visualViewport;
      const offsetLeft = viewport?.offsetLeft ?? 0;
      const offsetTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const inset = 12;
      const actionTarget = target.getAttribute("data-pointable-context-role") === "action";
      const width = target.offsetWidth || (actionTarget ? 150 : 380);
      const height = target.offsetHeight || (actionTarget ? 34 : 320);
      const minimumLeft = offsetLeft + inset;
      const maximumLeft = Math.max(minimumLeft, offsetLeft + viewportWidth - width - inset);
      const desiredLeft = rect.left + rect.width / 2 - width / 2;
      target.style.left = `${Math.min(Math.max(minimumLeft, desiredLeft), maximumLeft)}px`;
      const minimumTop = offsetTop + inset;
      const maximumTop = Math.max(minimumTop, offsetTop + viewportHeight - height - inset);
      const above = rect.top - height - 8;
      const desiredTop = above >= minimumTop ? above : rect.bottom + 8;
      target.style.top = `${Math.min(Math.max(minimumTop, desiredTop), maximumTop)}px`;
    });
  }

  function cleanup(clearCandidate: boolean, restore: boolean): void {
    clearRevisionTimer();
    holdCardPlacementUntil = 0;
    removeOwned("action");
    removeOwned("card");
    resizeObserver?.disconnect();
    if (pending !== undefined) window.clearTimeout(pending.timeout);
    pending = undefined;
    if (repositionFrame !== undefined) window.cancelAnimationFrame(repositionFrame);
    repositionFrame = undefined;
    if (reconcileFrame !== undefined) window.cancelAnimationFrame(reconcileFrame);
    reconcileFrame = undefined;
    if (outsideHandler !== undefined) {
      window.removeEventListener("pointerdown", outsideHandler, true);
      outsideHandler = undefined;
    }
    if (clearCandidate) {
      candidate = undefined;
      activeObserver.disconnect();
      state = "idle";
    }
    if (restore && restoreFocus?.isConnected) {
      restoreFocus.focus({ preventScroll: true });
    }
    if (clearCandidate) restoreFocus = undefined;
  }

  function status(): PointableRendererStatus {
    return {
      installed: !uninstalled,
      bindingName: config.bindingName,
      lifecycleId,
      state,
      selectionGeneration: generation,
      pendingRequestCount: pending === undefined ? 0 : 1,
      actionCount: connectedOwnedElement("action") === null ? 0 : 1,
      cardCount: connectedOwnedElement("card") === null ? 0 : 1,
    };
  }

  function uninstall(): PointableRendererStatus {
    if (uninstalled) return status();
    cleanup(true, false);
    uninstalled = true;
    activeObserver.disconnect();
    resizeObserver?.disconnect();
    document.removeEventListener("selectionchange", selectionHandler);
    document.removeEventListener("pointerup", pointerUpHandler, true);
    document.removeEventListener("keyup", keyUpHandler, true);
    document.removeEventListener("keydown", keyDownHandler, true);
    window.removeEventListener("scroll", viewportHandler, true);
    window.removeEventListener("resize", viewportHandler);
    window.removeEventListener("popstate", routeHandler);
    window.removeEventListener("hashchange", routeHandler);
    window.visualViewport?.removeEventListener("resize", viewportHandler);
    window.visualViewport?.removeEventListener("scroll", viewportHandler);
    if (window[namespace] === api) delete window[namespace];
    return status();
  }

  const api: PointableRendererApi = {
    status,
    verifyFence,
    receiveResult,
    reconcile,
    uninstall,
  };
  window[namespace] = api;
  return status();
}

export function createInstallPointableRendererExpression(
  config: PointableRendererConfig,
): string {
  return `(() => {
    const evaluateEligibility = (${evaluatePointableRendererEligibility.toString()});
    const validateResponse = (${validatePointableRendererResponse.toString()});
    const install = (${installPointableContextRenderer.toString()});
    return install(${JSON.stringify(config)}, evaluateEligibility, validateResponse);
  })()`;
}

export function createPointableRendererStatusExpression(): string {
  return "window.__pointableContextRenderer?.status?.() ?? null";
}

export function createVerifyPointableRendererFenceExpression(
  fence: PointableRendererFence,
  lifecycleId: string,
): string {
  return `(() => {
    const renderer = window.__pointableContextRenderer;
    return renderer?.status?.().lifecycleId === ${JSON.stringify(lifecycleId)} &&
      renderer.verifyFence?.(${JSON.stringify(fence)}) === true;
  })()`;
}

export function createDeliverPointableResultExpression(
  response: PointableLookupResponseV1,
  lifecycleId: string,
): string {
  return `(() => {
    const renderer = window.__pointableContextRenderer;
    return renderer?.status?.().lifecycleId === ${JSON.stringify(lifecycleId)}
      ? renderer.receiveResult?.(${JSON.stringify(response)}) ?? null
      : null;
  })()`;
}

export function createUninstallPointableRendererExpression(
  lifecycleId: string,
): string {
  return `(() => {
    const renderer = window.__pointableContextRenderer;
    return renderer?.status?.().lifecycleId === ${JSON.stringify(lifecycleId)}
      ? renderer.uninstall?.() ?? null
      : null;
  })()`;
}

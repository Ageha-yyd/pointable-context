import type {
  PointableLookupResponseV1,
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
  actionLabel?: string;
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
      !detail.sources.every(sourceView)
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
  const actionLabel = typeof config.actionLabel === "string" &&
    config.actionLabel.trim().length > 0 &&
    config.actionLabel.length <= 64
    ? config.actionLabel.trim()
    : "查看上下文";
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
    operation: "resolve" | "choose";
    candidateRef?: string;
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
    operation: "resolve" | "choose",
    expectedGeneration: number,
    candidateRef?: string,
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
      (operation === "resolve" && candidateRef !== undefined) ||
      (operation === "choose" &&
        (typeof candidateRef !== "string" ||
          candidateRef.length < 8 ||
          candidateRef.length > 256))
    ) {
      mountError("候选引用无效。", false);
      return;
    }
    // Commit the explicit trusted activation synchronously. Chromium may
    // collapse the native Selection before the asynchronous digest finishes;
    // the cloned Range and context fences remain the authority after click.
    state = "resolving";
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
        mountError("查询超时，请重试。", true);
      }, requestTimeoutMs);
      pending = {
        requestId,
        generation: current.generation,
        digest,
        contextFingerprint: current.contextFingerprint,
        operation,
        ...(candidateRef === undefined ? {} : { candidateRef }),
        timeout,
      };
      mountLoading(operation === "choose" ? "正在读取上下文详情…" : "正在查找上下文对象…");
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
        ...(candidateRef === undefined ? {} : { candidateRef }),
      };
      (binding as (payload: string) => void)(JSON.stringify(payload));
    } catch {
      if (pending !== undefined) window.clearTimeout(pending.timeout);
      pending = undefined;
      mountError("宿主查询通道不可用。", true);
    }
  }

  function createShell(titleText: string): { shell: HTMLElement; body: HTMLElement } {
    removeOwned("action");
    removeOwned("card");
    if (restoreFocus === undefined && document.activeElement instanceof HTMLElement) {
      restoreFocus = document.activeElement;
    }
    const shell = document.createElement("section");
    shell.id = availableOwnedId(cardIdBase);
    shell.tabIndex = -1;
    shell.setAttribute("role", "dialog");
    shell.setAttribute("aria-modal", "false");
    shell.setAttribute("aria-labelledby", `${shell.id}-title`);
    shell.setAttribute("data-pointable-context-owned", lifecycleId);
    shell.setAttribute("data-pointable-context-role", "card");
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
    document.body.append(shell);
    installOutsideHandler();
    resizeObserver?.disconnect();
    resizeObserver?.observe(shell);
    window.queueMicrotask(() => {
      if (shell.isConnected) shell.focus({ preventScroll: true });
    });
    reposition();
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

  function mountDetail(detail: {
    entityId: string;
    entityType: string;
    label: string;
    summary: string;
    revision: string;
    observedAt: string;
    freshness: "current" | "stale" | "partial" | "unknown";
    facts: Array<{ label: string; value: string }>;
    sources: Array<{ label: string }>;
  }): void {
    state = "detail";
    const { body } = createShell(detail.label);
    body.append(paragraph(detail.summary));
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
    body.append(metadata);
    if (detail.facts.length > 0) {
      const heading = document.createElement("h3");
      heading.textContent = "关键事实";
      Object.assign(heading.style, { margin: "12px 0 4px", fontSize: "13px" });
      const facts = document.createElement("div");
      for (const fact of detail.facts) facts.append(metadataRow(fact.label, fact.value));
      body.append(heading, facts);
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
      body.append(heading, list);
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
    window.clearTimeout(request.timeout);
    pending = undefined;
    if (response.presentation.kind === "candidates") {
      mountCandidates(response.presentation.candidates);
    } else if (response.presentation.kind === "detail") {
      mountDetail(response.presentation.detail);
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

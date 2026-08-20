import {
  STUDY_V2_NATIVE_EVENT_KIND,
  validateStudyV2NativeSurfaceConfig,
  type StudyV2NativeTrialSurfaceConfig,
} from "./native-trial-protocol.js";

export interface StudyV2NativeRendererStatus {
  installed: boolean;
  trialToken: string;
  trialId: string;
  state: "armed" | "running" | "completed" | "aborted" | "timed_out";
}

function installStudyV2NativeTrial(
  untrustedConfig: StudyV2NativeTrialSurfaceConfig,
): StudyV2NativeRendererStatus {
  const config = untrustedConfig;
  const zh = config.language === "zh-CN";
  const rootCandidate = document.querySelector<HTMLElement>("main[data-app-shell-main-surface]");
  if (rootCandidate === null) throw new Error("study_v2_native_surface_missing");
  const root = rootCandidate;
  const globalKey = "__pointableStudyV2Native";
  const globalRecord = globalThis as typeof globalThis & {
    __pointableStudyV2Native?: {
      status(): StudyV2NativeRendererStatus;
      activate(): StudyV2NativeRendererStatus;
      stop(reason?: "aborted" | "completed" | "timed_out"): StudyV2NativeRendererStatus;
    };
  };
  const previous = globalRecord.__pointableStudyV2Native;
  if (previous !== undefined) {
    const status = previous.status();
    if (status.trialToken === config.trialToken && status.trialId === config.trialId) {
      return status;
    }
    throw new Error("study_v2_native_trial_already_active");
  }
  const binding = (globalThis as unknown as Record<string, unknown>)[config.bindingName];
  if (typeof binding !== "function") throw new Error("study_v2_native_binding_missing");

  let state: StudyV2NativeRendererStatus["state"] = "armed";
  let sequence = 0;
  let currentObjectCode: string | undefined;
  let lastActionKey = "";
  let openCard = false;
  let startedAt = 0;
  const terms = new Map(
    config.entityTerms.map((entry) => [
      entry.term.normalize("NFKC").trim().toLocaleLowerCase("en-US"),
      entry.objectCode,
    ]),
  );

  const emit = (
    eventType: string,
    fields: { objectCode?: string; outcomeCode?: string } = {},
  ): void => {
    if (state !== "running" && eventType !== "answer_submitted" &&
      eventType !== "trial_aborted" && eventType !== "trial_timed_out") return;
    const payload = {
      schemaVersion: 2,
      kind: "pointable.study-v2.native-event",
      trialToken: config.trialToken,
      sequence: ++sequence,
      eventType,
      monotonicMs: Math.max(0, performance.now() - startedAt),
      ...fields,
    };
    try {
      (binding as (payload: string) => void)(JSON.stringify(payload));
    } catch {
      // A closing host cannot authorize a retry or expose trial content.
    }
  };

  const host = document.createElement("section");
  host.setAttribute("data-pointable-study-v2", config.trialToken);
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-label", zh ? "Pointable Context 受控研究任务" : "Pointable Context controlled study task");
  host.setAttribute("aria-busy", "true");
  Object.assign(host.style, {
    position: "fixed",
    top: "64px",
    right: "20px",
    bottom: "20px",
    zIndex: "2147483600",
    width: "min(620px, calc(100vw - 40px))",
    display: "block",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: "#e8edf7",
    pointerEvents: "none",
    visibility: "hidden",
  });

  const panel = document.createElement("div");
  Object.assign(panel.style, {
    width: "100%",
    maxHeight: "calc(100vh - 84px)",
    overflow: "auto",
    border: "1px solid rgba(146, 168, 204, 0.36)",
    borderRadius: "16px",
    background: "#161a22",
    boxShadow: "0 24px 80px rgba(0,0,0,.46)",
    pointerEvents: "auto",
  });

  const header = document.createElement("header");
  Object.assign(header.style, {
    position: "sticky",
    top: "0",
    zIndex: "2",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "16px",
    padding: "16px 20px",
    borderBottom: "1px solid rgba(146, 168, 204, 0.22)",
    background: "#161a22",
  });
  const title = document.createElement("div");
  const eyebrow = document.createElement("div");
  eyebrow.textContent = `${zh ? "受控开发任务" : "Controlled development task"} · ${config.trialId}`;
  Object.assign(eyebrow.style, { fontSize: "12px", color: "#8fa9d8", letterSpacing: ".06em" });
  const heading = document.createElement("h1");
  heading.textContent = zh ? "恢复当前项目理解并做出一个决定" : "Recover the current project state and make one decision";
  Object.assign(heading.style, { margin: "4px 0 0", fontSize: "18px", fontWeight: "650" });
  title.append(eyebrow, heading);
  const abort = document.createElement("button");
  abort.type = "button";
  abort.textContent = zh ? "退出试次" : "Exit trial";
  Object.assign(abort.style, {
    border: "1px solid rgba(146, 168, 204, 0.35)",
    borderRadius: "8px",
    background: "transparent",
    color: "#dbe5f6",
    padding: "7px 11px",
    cursor: "pointer",
  });
  header.append(title, abort);

  const content = document.createElement("div");
  Object.assign(content.style, { padding: "20px", display: "grid", gap: "18px" });
  const guidance = document.createElement("p");
  guidance.textContent = zh
    ? "阅读冻结的开发历史，然后提交一个答案。不要使用其他 Agent、搜索或外部项目。"
    : "Read the frozen development history, then submit one answer. Do not use another Agent, search, or an external project.";
  Object.assign(guidance.style, { margin: "0", color: "#b7c2d5", fontSize: "14px" });

  const historySurface = document.createElement("article");
  historySurface.setAttribute("data-selected-text-overlay-target", "true");
  historySurface.setAttribute("data-response-annotation-target", "true");
  historySurface.setAttribute("aria-label", zh ? "冻结的 Agent 开发历史" : "Frozen Agent development history");
  Object.assign(historySurface.style, {
    border: "1px solid rgba(146, 168, 204, 0.22)",
    borderRadius: "12px",
    background: "#11151c",
    padding: "18px",
    whiteSpace: "pre-wrap",
    lineHeight: "1.65",
    userSelect: "text",
  });
  const historyHeading = document.createElement("h2");
  historyHeading.textContent = zh ? "冻结的 Agent 开发历史" : "Frozen Agent development history";
  Object.assign(historyHeading.style, { margin: "0 0 12px", fontSize: "15px", color: "#c9d7ee" });
  const historyText = document.createElement("div");
  historyText.textContent = config.history;
  historySurface.append(historyHeading, historyText);

  const task = document.createElement("section");
  Object.assign(task.style, { borderTop: "1px solid rgba(146, 168, 204, 0.22)", paddingTop: "18px" });
  const taskHeading = document.createElement("h2");
  taskHeading.textContent = zh ? "当前任务" : "Current task";
  Object.assign(taskHeading.style, { margin: "0 0 8px", fontSize: "15px" });
  const taskPrompt = document.createElement("p");
  taskPrompt.textContent = config.taskPrompt;
  Object.assign(taskPrompt.style, { margin: "0 0 14px", lineHeight: "1.55" });
  const answers = document.createElement("div");
  Object.assign(answers.style, { display: "grid", gap: "8px" });
  for (const answer of config.answers) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("data-pointable-study-answer", answer.code);
    button.textContent = `${answer.code} · ${answer.label}`;
    Object.assign(button.style, {
      width: "100%",
      textAlign: "left",
      border: "1px solid rgba(146, 168, 204, 0.3)",
      borderRadius: "10px",
      background: "#1b2230",
      color: "#e9effa",
      padding: "11px 13px",
      cursor: "pointer",
      lineHeight: "1.4",
    });
    button.addEventListener("click", (event) => {
      if (!event.isTrusted || state !== "running") return;
      state = "completed";
      for (const candidate of answers.querySelectorAll<HTMLButtonElement>("button")) {
        candidate.disabled = true;
      }
      button.style.borderColor = "#6aa7ff";
      emit("answer_submitted", { outcomeCode: answer.code });
      host.style.visibility = "hidden";
      host.style.pointerEvents = "none";
      setTimeout(() => globalRecord.__pointableStudyV2Native?.stop("completed"), 120);
    });
    answers.append(button);
  }
  task.append(taskHeading, taskPrompt, answers);
  content.append(guidance, historySurface, task);
  panel.append(header, content);
  host.append(panel);
  root.append(host);

  const selectionCompleted = (event: Event): void => {
    if (!event.isTrusted || state !== "running") return;
    queueMicrotask(() => {
      const selection = globalThis.getSelection();
      if (selection === null || selection.rangeCount !== 1 || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      const start = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer as Element
        : range.startContainer.parentElement;
      const end = range.endContainer.nodeType === Node.ELEMENT_NODE
        ? range.endContainer as Element
        : range.endContainer.parentElement;
      if (start === null || end === null || !historySurface.contains(start) || !historySurface.contains(end)) return;
      const text = range.toString().normalize("NFKC").trim().toLocaleLowerCase("en-US");
      if (text.length < 1 || text.length > 512) return;
      currentObjectCode = terms.get(text);
      lastActionKey = "";
      emit("selection_completed", currentObjectCode === undefined ? {} : { objectCode: currentObjectCode });
    });
  };
  document.addEventListener("pointerup", selectionCompleted, true);
  document.addEventListener("keyup", selectionCompleted, true);

  const cardObserver = new MutationObserver((records) => {
    if (state !== "running") return;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        const action = node.matches('[data-pointable-context-role="action"]')
          ? node
          : node.querySelector('[data-pointable-context-role="action"]');
        if (action !== null && currentObjectCode !== undefined) {
          const key = `${currentObjectCode}:${sequence}`;
          if (key !== lastActionKey) {
            lastActionKey = key;
            emit("quick_action_shown", { objectCode: currentObjectCode });
          }
        }
        const card = node.matches('[data-pointable-context-role="card"]')
          ? node
          : node.querySelector('[data-pointable-context-role="card"]');
        if (card !== null && currentObjectCode !== undefined && !openCard) {
          openCard = true;
          emit("card_opened", { objectCode: currentObjectCode });
        }
      }
      for (const node of record.removedNodes) {
        if (!(node instanceof Element)) continue;
        const removedCard = node.matches('[data-pointable-context-role="card"]') ||
          node.querySelector('[data-pointable-context-role="card"]') !== null;
        if (removedCard && openCard) {
          openCard = false;
          emit("card_closed", currentObjectCode === undefined ? {} : { objectCode: currentObjectCode });
        }
      }
    }
  });
  cardObserver.observe(document.body, { childList: true, subtree: true });

  const evidenceClick = (event: Event): void => {
    if (!event.isTrusted || state !== "running") return;
    const target = event.target;
    if (target instanceof Element &&
      target.closest('[data-pointable-context-role="evidence-toggle"]') !== null) {
      emit("evidence_expanded", currentObjectCode === undefined ? {} : { objectCode: currentObjectCode });
    }
  };
  document.addEventListener("click", evidenceClick, true);

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let escapeAbort: ((event: KeyboardEvent) => void) | undefined;

  const activate = (): StudyV2NativeRendererStatus => {
    if (state !== "armed") return status();
    state = "running";
    startedAt = performance.now();
    host.removeAttribute("aria-busy");
    host.style.visibility = "visible";
    timeout = setTimeout(() => {
      if (state !== "running") return;
      state = "timed_out";
      emit("trial_timed_out");
      host.style.visibility = "hidden";
      host.style.pointerEvents = "none";
      setTimeout(() => globalRecord.__pointableStudyV2Native?.stop("timed_out"), 120);
    }, config.timeoutMs);
    emit("trial_shown");
    return status();
  };

  const stop = (
    reason: "aborted" | "completed" | "timed_out" = "aborted",
  ): StudyV2NativeRendererStatus => {
    const wasRunning = state === "running";
    state = reason;
    if (timeout !== undefined) clearTimeout(timeout);
    timeout = undefined;
    if (wasRunning && reason === "aborted") emit("trial_aborted");
    const cleanup = (): void => {
      cardObserver.disconnect();
      document.removeEventListener("pointerup", selectionCompleted, true);
      document.removeEventListener("keyup", selectionCompleted, true);
      document.removeEventListener("click", evidenceClick, true);
      if (escapeAbort !== undefined) document.removeEventListener("keydown", escapeAbort, true);
      host.remove();
      delete globalRecord.__pointableStudyV2Native;
    };
    if (wasRunning && reason === "aborted") {
      host.style.visibility = "hidden";
      host.style.pointerEvents = "none";
      setTimeout(cleanup, 120);
    } else {
      cleanup();
    }
    return { installed: false, trialToken: config.trialToken, trialId: config.trialId, state };
  };
  escapeAbort = (event: KeyboardEvent): void => {
    if (!event.isTrusted || event.key !== "Escape" || state !== "running") return;
    event.preventDefault();
    globalRecord.__pointableStudyV2Native?.stop("aborted");
  };
  document.addEventListener("keydown", escapeAbort, true);
  abort.addEventListener("click", (event) => {
    if (!event.isTrusted || state !== "running") return;
    stop("aborted");
  });
  const status = (): StudyV2NativeRendererStatus => ({
    installed: host.isConnected,
    trialToken: config.trialToken,
    trialId: config.trialId,
    state,
  });
  globalRecord.__pointableStudyV2Native = { status, activate, stop };
  return status();
}

export function createInstallStudyV2NativeTrialExpression(
  untrustedConfig: StudyV2NativeTrialSurfaceConfig,
): string {
  const config = validateStudyV2NativeSurfaceConfig(untrustedConfig);
  return `(${installStudyV2NativeTrial.toString()})(${JSON.stringify(config)})`;
}

export function createUninstallStudyV2NativeTrialExpression(
  trialToken: string,
  reason: "aborted" | "completed" | "timed_out" = "aborted",
): string {
  if (!/^[a-f0-9]{64}$/u.test(trialToken)) {
    throw new Error("native_trial_token_invalid");
  }
  return `(() => { const value = globalThis.__pointableStudyV2Native; if (value === undefined) return { installed: false }; const status = value.status(); if (status.trialToken !== ${JSON.stringify(trialToken)}) return { installed: false }; return value.stop(${JSON.stringify(reason)}); })()`;
}

export function createActivateStudyV2NativeTrialExpression(trialToken: string): string {
  if (!/^[a-f0-9]{64}$/u.test(trialToken)) {
    throw new Error("native_trial_token_invalid");
  }
  return `(() => { const value = globalThis.__pointableStudyV2Native; if (value === undefined) return { installed: false }; const status = value.status(); if (status.trialToken !== ${JSON.stringify(trialToken)}) return { installed: false }; return value.activate(); })()`;
}

export function nativeTrialRendererEventKind(): string {
  return STUDY_V2_NATIVE_EVENT_KIND;
}

import {
  validateStudyV2NativeSurfaceConfig,
  type StudyV2NativeTrialSurfaceConfig,
} from "./native-trial-protocol.js";
import type { StudyV2NativeRendererStatus } from "./native-trial-renderer.js";

function installStudyV2NativeAnswerControl(
  untrustedConfig: StudyV2NativeTrialSurfaceConfig,
): StudyV2NativeRendererStatus {
  const config = untrustedConfig;
  const zh = config.language === "zh-CN";
  const root = document.querySelector<HTMLElement>("main[data-app-shell-main-surface]");
  if (root === null) throw new Error("study_v2_native_surface_missing");
  const globalRecord = globalThis as typeof globalThis & {
    __pointableStudyV2NativeAnswer?: {
      status(): StudyV2NativeRendererStatus;
      activate(): StudyV2NativeRendererStatus;
      stop(reason?: "aborted" | "completed" | "timed_out"): StudyV2NativeRendererStatus;
    };
  };
  const previous = globalRecord.__pointableStudyV2NativeAnswer;
  if (previous !== undefined) {
    const existing = previous.status();
    if (existing.trialToken === config.trialToken && existing.trialId === config.trialId) return existing;
    throw new Error("study_v2_native_answer_control_already_active");
  }
  const binding = (globalThis as unknown as Record<string, unknown>)[config.bindingName];
  if (typeof binding !== "function") throw new Error("study_v2_native_binding_missing");

  let state: StudyV2NativeRendererStatus["state"] = "armed";
  let sequence = 0;
  let startedAt = 0;
  let currentObjectCode: string | undefined;
  let cardOpen = false;
  let leftWorkspace = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const terms = new Map(config.entityTerms.map((entry) => [
    entry.term.normalize("NFKC").trim().toLocaleLowerCase("en-US"),
    entry.objectCode,
  ]));

  const emit = (
    eventType: string,
    fields: { objectCode?: string; outcomeCode?: string } = {},
  ): void => {
    if (state !== "running" && eventType !== "answer_submitted" &&
      eventType !== "trial_aborted" && eventType !== "trial_timed_out") return;
    try {
      (binding as (payload: string) => void)(JSON.stringify({
        schemaVersion: 2,
        kind: "pointable.study-v2.native-event",
        trialToken: config.trialToken,
        sequence: ++sequence,
        eventType,
        monotonicMs: Math.max(0, performance.now() - startedAt),
        ...fields,
      }));
    } catch {
      // A closing host cannot authorize a retry or expose trial content.
    }
  };

  const shell = document.createElement("section");
  shell.setAttribute("data-pointable-study-v2-answer-control", config.trialToken);
  shell.setAttribute("aria-label", zh ? "本轮研究答题控制" : "Current trial answer control");
  Object.assign(shell.style, {
    position: "fixed",
    right: "18px",
    bottom: "82px",
    zIndex: "2147483590",
    width: "min(390px, calc(100vw - 36px))",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: "#e8edf7",
    pointerEvents: "none",
    visibility: "hidden",
  });

  const resume = document.createElement("button");
  resume.type = "button";
  resume.textContent = zh ? "提交本轮答案" : "Submit trial answer";
  resume.setAttribute("aria-expanded", "false");
  Object.assign(resume.style, {
    display: "block",
    marginLeft: "auto",
    border: "1px solid rgba(133, 165, 220, .52)",
    borderRadius: "999px",
    background: "#202838",
    color: "#eef4ff",
    boxShadow: "0 8px 28px rgba(0,0,0,.34)",
    padding: "9px 14px",
    cursor: "pointer",
    pointerEvents: "auto",
  });

  const panel = document.createElement("div");
  panel.hidden = true;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", zh ? "本轮答案选项" : "Current trial answer options");
  Object.assign(panel.style, {
    marginTop: "8px",
    maxHeight: "min(48vh, 430px)",
    overflow: "auto",
    border: "1px solid rgba(133, 165, 220, .38)",
    borderRadius: "14px",
    background: "#171c25",
    boxShadow: "0 18px 60px rgba(0,0,0,.42)",
    padding: "14px",
    pointerEvents: "auto",
  });
  const header = document.createElement("div");
  Object.assign(header.style, { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" });
  const heading = document.createElement("strong");
  heading.textContent = `${zh ? "本轮任务" : "Current trial"} · ${config.trialId}`;
  const collapse = document.createElement("button");
  collapse.type = "button";
  collapse.textContent = zh ? "收起" : "Collapse";
  Object.assign(collapse.style, {
    border: "0", background: "transparent", color: "#aebbd0", cursor: "pointer", padding: "4px",
  });
  header.append(heading, collapse);
  const prompt = document.createElement("p");
  prompt.textContent = config.taskPrompt;
  Object.assign(prompt.style, { margin: "12px 0", lineHeight: "1.5", fontSize: "14px" });
  const answers = document.createElement("div");
  Object.assign(answers.style, { display: "grid", gap: "7px" });
  for (const answer of config.answers) {
    const answerButton = document.createElement("button");
    answerButton.type = "button";
    answerButton.setAttribute("data-pointable-study-answer", answer.code);
    answerButton.textContent = `${answer.code} · ${answer.label}`;
    Object.assign(answerButton.style, {
      width: "100%",
      border: "1px solid rgba(133, 165, 220, .3)",
      borderRadius: "9px",
      background: "#202838",
      color: "#eef4ff",
      padding: "9px 11px",
      textAlign: "left",
      lineHeight: "1.4",
      cursor: "pointer",
    });
    answerButton.addEventListener("click", (event) => {
      if (!event.isTrusted || state !== "running") return;
      state = "completed";
      for (const candidate of answers.querySelectorAll<HTMLButtonElement>("button")) candidate.disabled = true;
      emit("answer_submitted", { outcomeCode: answer.code });
      shell.style.visibility = "hidden";
      shell.style.pointerEvents = "none";
      setTimeout(() => globalRecord.__pointableStudyV2NativeAnswer?.stop("completed"), 80);
    });
    answers.append(answerButton);
  }
  const abort = document.createElement("button");
  abort.type = "button";
  abort.textContent = zh ? "退出本轮" : "Exit trial";
  Object.assign(abort.style, {
    marginTop: "10px", border: "0", background: "transparent", color: "#aebbd0", cursor: "pointer", padding: "4px 0",
  });
  panel.append(header, prompt, answers, abort);
  shell.append(resume, panel);
  root.append(shell);

  const showPanel = (expanded: boolean): void => {
    panel.hidden = !expanded;
    panel.style.display = expanded ? "block" : "none";
    resume.hidden = expanded;
    resume.style.display = expanded ? "none" : "block";
    resume.setAttribute("aria-expanded", String(expanded));
  };
  resume.addEventListener("click", (event) => {
    if (!event.isTrusted || state !== "running") return;
    showPanel(true);
  });
  collapse.addEventListener("click", (event) => {
    if (!event.isTrusted || state !== "running") return;
    showPanel(false);
  });

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
      const startSurface = start?.closest("[data-selected-text-overlay-target]");
      const endSurface = end?.closest("[data-selected-text-overlay-target]");
      if (startSurface === null || startSurface === undefined || startSurface !== endSurface || shell.contains(startSurface)) return;
      const text = range.toString().normalize("NFKC").trim().toLocaleLowerCase("en-US");
      if (text.length < 1 || text.length > 512) return;
      currentObjectCode = terms.get(text);
      emit("selection_completed", currentObjectCode === undefined ? {} : { objectCode: currentObjectCode });
    });
  };
  document.addEventListener("pointerup", selectionCompleted, true);
  document.addEventListener("keyup", selectionCompleted, true);

  const cardObserver = new MutationObserver((records) => {
    if (state !== "running") return;
    for (const mutation of records) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        const action = node.matches('[data-pointable-context-role="action"]')
          ? node : node.querySelector('[data-pointable-context-role="action"]');
        if (action !== null) emit("quick_action_shown", currentObjectCode === undefined ? {} : { objectCode: currentObjectCode });
        const card = node.matches('[data-pointable-context-role="card"]')
          ? node : node.querySelector('[data-pointable-context-role="card"]');
        if (card !== null && !cardOpen) {
          cardOpen = true;
          emit("card_opened", currentObjectCode === undefined ? {} : { objectCode: currentObjectCode });
        }
      }
      for (const node of mutation.removedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('[data-pointable-context-role="card"]') ||
          node.querySelector('[data-pointable-context-role="card"]') !== null) {
          if (cardOpen) emit("card_closed", currentObjectCode === undefined ? {} : { objectCode: currentObjectCode });
          cardOpen = false;
        }
      }
    }
  });
  cardObserver.observe(document.body, { childList: true, subtree: true });

  const pointableClick = (event: Event): void => {
    if (!event.isTrusted || state !== "running" || !(event.target instanceof Element)) return;
    if (event.target.closest('[data-pointable-context-role="evidence-toggle"]') !== null) {
      emit("evidence_expanded", currentObjectCode === undefined ? {} : { objectCode: currentObjectCode });
    }
    if (event.target.closest('[data-pointable-context-role="revision-refresh"]') !== null) {
      emit("card_refreshed", currentObjectCode === undefined ? {} : { objectCode: currentObjectCode });
    }
  };
  document.addEventListener("click", pointableClick, true);

  const leave = (): void => {
    if (state !== "running" || leftWorkspace) return;
    leftWorkspace = true;
    emit("workspace_left");
  };
  const returnToWorkspace = (): void => {
    if (state !== "running" || !leftWorkspace) return;
    leftWorkspace = false;
    emit("workspace_returned");
  };
  globalThis.addEventListener("blur", leave);
  globalThis.addEventListener("focus", returnToWorkspace);

  let escapeAbort: ((event: KeyboardEvent) => void) | undefined;
  const status = (): StudyV2NativeRendererStatus => ({
    installed: shell.isConnected,
    trialToken: config.trialToken,
    trialId: config.trialId,
    state,
  });
  const stop = (reason: "aborted" | "completed" | "timed_out" = "aborted"): StudyV2NativeRendererStatus => {
    const wasRunning = state === "running";
    state = reason;
    if (timeout !== undefined) clearTimeout(timeout);
    timeout = undefined;
    if (wasRunning && reason === "aborted") emit("trial_aborted");
    cardObserver.disconnect();
    document.removeEventListener("pointerup", selectionCompleted, true);
    document.removeEventListener("keyup", selectionCompleted, true);
    document.removeEventListener("click", pointableClick, true);
    globalThis.removeEventListener("blur", leave);
    globalThis.removeEventListener("focus", returnToWorkspace);
    if (escapeAbort !== undefined) document.removeEventListener("keydown", escapeAbort, true);
    shell.remove();
    delete globalRecord.__pointableStudyV2NativeAnswer;
    return { installed: false, trialToken: config.trialToken, trialId: config.trialId, state };
  };
  const activate = (): StudyV2NativeRendererStatus => {
    if (state !== "armed") return status();
    state = "running";
    startedAt = performance.now();
    shell.style.visibility = "visible";
    timeout = setTimeout(() => {
      if (state !== "running") return;
      state = "timed_out";
      emit("trial_timed_out");
      globalRecord.__pointableStudyV2NativeAnswer?.stop("timed_out");
    }, config.timeoutMs);
    emit("trial_shown");
    return status();
  };
  escapeAbort = (event: KeyboardEvent): void => {
    if (!event.isTrusted || event.key !== "Escape" || state !== "running" || panel.hidden) return;
    event.preventDefault();
    showPanel(false);
  };
  document.addEventListener("keydown", escapeAbort, true);
  abort.addEventListener("click", (event) => {
    if (!event.isTrusted || state !== "running") return;
    stop("aborted");
  });
  globalRecord.__pointableStudyV2NativeAnswer = { status, activate, stop };
  return status();
}

export function createInstallStudyV2NativeAnswerControlExpression(
  untrustedConfig: StudyV2NativeTrialSurfaceConfig,
): string {
  const config = validateStudyV2NativeSurfaceConfig(untrustedConfig);
  return `(${installStudyV2NativeAnswerControl.toString()})(${JSON.stringify(config)})`;
}

export function createActivateStudyV2NativeAnswerControlExpression(trialToken: string): string {
  if (!/^[a-f0-9]{64}$/u.test(trialToken)) throw new Error("native_trial_token_invalid");
  return `(() => { const value = globalThis.__pointableStudyV2NativeAnswer; if (value === undefined) return { installed: false }; const status = value.status(); if (status.trialToken !== ${JSON.stringify(trialToken)}) return { installed: false }; return value.activate(); })()`;
}

export function createUninstallStudyV2NativeAnswerControlExpression(
  trialToken: string,
  reason: "aborted" | "completed" | "timed_out" = "aborted",
): string {
  if (!/^[a-f0-9]{64}$/u.test(trialToken)) throw new Error("native_trial_token_invalid");
  return `(() => { const value = globalThis.__pointableStudyV2NativeAnswer; if (value === undefined) return { installed: false }; const status = value.status(); if (status.trialToken !== ${JSON.stringify(trialToken)}) return { installed: false }; return value.stop(${JSON.stringify(reason)}); })()`;
}

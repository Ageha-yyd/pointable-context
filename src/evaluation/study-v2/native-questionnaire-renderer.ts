import {
  validateStudyV2NativeQuestionnaireSurfaceConfig,
  type StudyV2NativeQuestionnaireSurfaceConfig,
  type StudyV2QuestionnaireField,
} from "./native-questionnaire-protocol.js";

export interface StudyV2NativeQuestionnaireRendererStatus {
  installed: boolean;
  sessionToken: string;
  sessionId: string;
  state: "armed" | "running" | "completed" | "aborted" | "timed_out";
}

function installStudyV2NativeQuestionnaire(
  untrustedConfig: StudyV2NativeQuestionnaireSurfaceConfig,
): StudyV2NativeQuestionnaireRendererStatus {
  const config = untrustedConfig;
  const zh = config.language === "zh-CN";
  const fields = [
    "mentalDemand",
    "effort",
    "frustration",
    "confidence",
    "informationSufficiency",
  ] as const;
  const root = document.querySelector<HTMLElement>("main[data-app-shell-main-surface]");
  if (root === null) throw new Error("study_v2_native_surface_missing");
  const globalRecord = globalThis as typeof globalThis & {
    __pointableStudyV2Questionnaire?: {
      status(): StudyV2NativeQuestionnaireRendererStatus;
      activate(): StudyV2NativeQuestionnaireRendererStatus;
      stop(reason?: "aborted" | "completed" | "timed_out"): StudyV2NativeQuestionnaireRendererStatus;
    };
  };
  const previous = globalRecord.__pointableStudyV2Questionnaire;
  if (previous !== undefined) {
    const prior = previous.status();
    if (prior.sessionToken === config.sessionToken && prior.sessionId === config.sessionId) return prior;
    throw new Error("study_v2_native_questionnaire_already_active");
  }
  if ((globalThis as typeof globalThis & { __pointableStudyV2Native?: unknown })
    .__pointableStudyV2Native !== undefined) {
    throw new Error("study_v2_native_trial_still_active");
  }
  const binding = (globalThis as unknown as Record<string, unknown>)[config.bindingName];
  if (typeof binding !== "function") throw new Error("study_v2_native_questionnaire_binding_missing");

  let state: StudyV2NativeQuestionnaireRendererStatus["state"] = "armed";
  let startedAt = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const answers = new Map<StudyV2QuestionnaireField, number>();

  const emit = (
    eventType: "questionnaire_submitted" | "questionnaire_aborted" | "questionnaire_timed_out",
    includeRatings = false,
  ): void => {
    const payload: Record<string, unknown> = {
      schemaVersion: 2,
      kind: "pointable.study-v2.native-questionnaire",
      sessionToken: config.sessionToken,
      sequence: 1,
      eventType,
      monotonicMs: Math.max(0, performance.now() - startedAt),
    };
    if (includeRatings) {
      for (const field of fields) payload[field] = answers.get(field);
    }
    try {
      (binding as (payload: string) => void)(JSON.stringify(payload));
    } catch {
      // A closing Host cannot authorize a retry or expose questionnaire state.
    }
  };

  const overlay = document.createElement("section");
  overlay.setAttribute("data-pointable-study-v2-questionnaire", config.sessionToken);
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", zh ? "Pointable Context 试次后问卷" : "Pointable Context post-trial questionnaire");
  overlay.setAttribute("aria-busy", "true");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "56px 20px 20px 20px",
    zIndex: "2147483600",
    display: "grid",
    placeItems: "center",
    background: "rgba(8, 10, 14, 0.72)",
    backdropFilter: "blur(3px)",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: "#e8edf7",
    pointerEvents: "none",
    visibility: "hidden",
  });
  const panel = document.createElement("div");
  Object.assign(panel.style, {
    width: "min(760px, calc(100vw - 64px))",
    maxHeight: "calc(100vh - 108px)",
    overflow: "auto",
    border: "1px solid rgba(146, 168, 204, 0.36)",
    borderRadius: "16px",
    background: "#161a22",
    boxShadow: "0 24px 80px rgba(0,0,0,.46)",
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
  eyebrow.textContent = zh ? "六个试次已完成" : "Six trials completed";
  Object.assign(eyebrow.style, { fontSize: "12px", color: "#8fa9d8", letterSpacing: ".06em" });
  const heading = document.createElement("h1");
  heading.textContent = zh ? "请评价刚才的整体体验" : "Rate your overall experience";
  heading.tabIndex = -1;
  Object.assign(heading.style, { margin: "4px 0 0", fontSize: "18px", fontWeight: "650" });
  title.append(eyebrow, heading);
  const later = document.createElement("button");
  later.type = "button";
  later.textContent = zh ? "稍后完成" : "Complete later";
  Object.assign(later.style, {
    border: "1px solid rgba(146, 168, 204, 0.35)",
    borderRadius: "8px",
    background: "transparent",
    color: "#dbe5f6",
    padding: "7px 11px",
    cursor: "pointer",
  });
  header.append(title, later);

  const content = document.createElement("div");
  Object.assign(content.style, { padding: "20px", display: "grid", gap: "18px" });
  const intro = document.createElement("p");
  intro.textContent = zh
    ? "每项选择 1–7。答案只写入本地研究结果，不发送为 Chat 消息，也不调用模型。"
    : "Choose 1–7 for each item. Ratings are written only to the local study result; they are not sent as Chat messages and do not invoke a model.";
  Object.assign(intro.style, { margin: "0", color: "#b7c2d5", fontSize: "14px", lineHeight: "1.5" });
  content.append(intro);
  const labels: Readonly<Record<StudyV2QuestionnaireField, { title: string; low: string; high: string }>> = zh ? {
    mentalDemand: { title: "理解任务需要多大的脑力负担？", low: "很低", high: "很高" },
    effort: { title: "为完成任务付出了多少努力？", low: "很少", high: "很多" },
    frustration: { title: "完成任务时有多挫败或烦躁？", low: "完全没有", high: "非常强" },
    confidence: { title: "你对自己答案的把握有多大？", low: "很低", high: "很高" },
    informationSufficiency: { title: "现有信息是否足以支持判断？", low: "远远不足", high: "完全足够" },
  } : {
    mentalDemand: { title: "How mentally demanding was it to understand the tasks?", low: "very low", high: "very high" },
    effort: { title: "How much effort did you expend to complete the tasks?", low: "very little", high: "very much" },
    frustration: { title: "How frustrated or irritated did you feel?", low: "not at all", high: "extremely" },
    confidence: { title: "How confident are you in your answers?", low: "very low", high: "very high" },
    informationSufficiency: { title: "Was the available information sufficient for your decisions?", low: "far from sufficient", high: "fully sufficient" },
  };
  const submit = document.createElement("button");
  submit.type = "button";
  submit.textContent = zh ? "提交评价" : "Submit ratings";
  submit.disabled = true;

  const refreshSubmit = (): void => {
    submit.disabled = answers.size !== fields.length || state !== "running";
    submit.style.opacity = submit.disabled ? ".5" : "1";
    submit.style.cursor = submit.disabled ? "not-allowed" : "pointer";
  };
  for (const field of fields) {
    const group = document.createElement("fieldset");
    group.setAttribute("data-pointable-study-question", field);
    Object.assign(group.style, {
      margin: "0",
      padding: "14px",
      border: "1px solid rgba(146, 168, 204, 0.22)",
      borderRadius: "12px",
    });
    const legend = document.createElement("legend");
    legend.textContent = labels[field].title;
    Object.assign(legend.style, { padding: "0 6px", fontSize: "14px", fontWeight: "600" });
    const scale = document.createElement("div");
    scale.setAttribute("role", "radiogroup");
    scale.setAttribute("aria-label", labels[field].title);
    Object.assign(scale.style, { display: "grid", gridTemplateColumns: "repeat(7, minmax(38px, 1fr))", gap: "7px" });
    for (let value = 1; value <= 7; value += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(value);
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", "false");
      button.setAttribute("data-rating", String(value));
      Object.assign(button.style, {
        minHeight: "38px",
        border: "1px solid rgba(146, 168, 204, 0.3)",
        borderRadius: "8px",
        background: "#1b2230",
        color: "#e9effa",
        cursor: "pointer",
      });
      button.addEventListener("click", (event) => {
        if (!event.isTrusted || state !== "running") return;
        answers.set(field, value);
        for (const candidate of scale.querySelectorAll<HTMLButtonElement>("button")) {
          const selected = candidate === button;
          candidate.setAttribute("aria-checked", selected ? "true" : "false");
          candidate.style.borderColor = selected ? "#6aa7ff" : "rgba(146, 168, 204, 0.3)";
          candidate.style.background = selected ? "#20385c" : "#1b2230";
        }
        refreshSubmit();
      });
      scale.append(button);
    }
    const endpoints = document.createElement("div");
    Object.assign(endpoints.style, { display: "flex", justifyContent: "space-between", marginTop: "7px", color: "#8f9bb0", fontSize: "12px" });
    const low = document.createElement("span");
    low.textContent = `1 · ${labels[field].low}`;
    const high = document.createElement("span");
    high.textContent = `7 · ${labels[field].high}`;
    endpoints.append(low, high);
    group.append(legend, scale, endpoints);
    content.append(group);
  }
  Object.assign(submit.style, {
    width: "100%",
    border: "1px solid #6aa7ff",
    borderRadius: "10px",
    background: "#245ea8",
    color: "#fff",
    padding: "11px 14px",
    fontWeight: "650",
  });
  refreshSubmit();
  content.append(submit);
  panel.append(header, content);
  overlay.append(panel);
  const resume = document.createElement("button");
  resume.type = "button";
  resume.hidden = true;
  resume.textContent = zh ? "继续填写研究问卷" : "Resume study questionnaire";
  resume.setAttribute("data-pointable-study-v2-questionnaire-resume", config.sessionToken);
  Object.assign(resume.style, {
    position: "fixed",
    right: "24px",
    bottom: "24px",
    zIndex: "2147483600",
    border: "1px solid #6aa7ff",
    borderRadius: "999px",
    background: "#1b3150",
    color: "#fff",
    padding: "10px 14px",
    boxShadow: "0 10px 34px rgba(0,0,0,.42)",
    cursor: "pointer",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontWeight: "600",
  });
  root.append(overlay, resume);

  const collapse = (): void => {
    if (state !== "running") return;
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.pointerEvents = "none";
    overlay.style.visibility = "hidden";
    resume.hidden = false;
    resume.focus({ preventScroll: true });
  };
  const restore = (): void => {
    if (state !== "running") return;
    resume.hidden = true;
    overlay.removeAttribute("aria-hidden");
    overlay.style.pointerEvents = "auto";
    overlay.style.visibility = "visible";
    heading.focus({ preventScroll: true });
  };

  const status = (): StudyV2NativeQuestionnaireRendererStatus => ({
    installed: overlay.isConnected,
    sessionToken: config.sessionToken,
    sessionId: config.sessionId,
    state,
  });
  const stop = (
    reason: "aborted" | "completed" | "timed_out" = "aborted",
  ): StudyV2NativeQuestionnaireRendererStatus => {
    const wasRunning = state === "running";
    state = reason;
    if (timeout !== undefined) clearTimeout(timeout);
    timeout = undefined;
    overlay.remove();
    resume.remove();
    delete globalRecord.__pointableStudyV2Questionnaire;
    if (wasRunning && reason === "aborted") emit("questionnaire_aborted");
    return { installed: false, sessionToken: config.sessionToken, sessionId: config.sessionId, state };
  };
  const activate = (): StudyV2NativeQuestionnaireRendererStatus => {
    if (state !== "armed") return status();
    state = "running";
    startedAt = performance.now();
    overlay.removeAttribute("aria-busy");
    overlay.style.pointerEvents = "auto";
    overlay.style.visibility = "visible";
    timeout = setTimeout(() => {
      if (state !== "running") return;
      state = "timed_out";
      emit("questionnaire_timed_out");
    }, config.timeoutMs);
    return status();
  };
  later.addEventListener("click", (event) => {
    if (!event.isTrusted || state !== "running") return;
    collapse();
  });
  resume.addEventListener("click", (event) => {
    if (!event.isTrusted || state !== "running") return;
    restore();
  });
  submit.addEventListener("click", (event) => {
    if (!event.isTrusted || state !== "running" || answers.size !== fields.length) return;
    state = "completed";
    submit.disabled = true;
    emit("questionnaire_submitted", true);
  });
  globalRecord.__pointableStudyV2Questionnaire = { status, activate, stop };
  return status();
}

export function createInstallStudyV2NativeQuestionnaireExpression(
  untrustedConfig: StudyV2NativeQuestionnaireSurfaceConfig,
): string {
  const config = validateStudyV2NativeQuestionnaireSurfaceConfig(untrustedConfig);
  return `(${installStudyV2NativeQuestionnaire.toString()})(${JSON.stringify(config)})`;
}

export function createActivateStudyV2NativeQuestionnaireExpression(sessionToken: string): string {
  if (!/^[a-f0-9]{64}$/u.test(sessionToken)) throw new Error("native_questionnaire_token_invalid");
  return `(() => { const value = globalThis.__pointableStudyV2Questionnaire; if (value === undefined) return { installed: false }; const status = value.status(); if (status.sessionToken !== ${JSON.stringify(sessionToken)}) return { installed: false }; return value.activate(); })()`;
}

export function createUninstallStudyV2NativeQuestionnaireExpression(
  sessionToken: string,
  reason: "aborted" | "completed" | "timed_out" = "aborted",
): string {
  if (!/^[a-f0-9]{64}$/u.test(sessionToken)) throw new Error("native_questionnaire_token_invalid");
  return `(() => { const value = globalThis.__pointableStudyV2Questionnaire; if (value === undefined) return { installed: false }; const status = value.status(); if (status.sessionToken !== ${JSON.stringify(sessionToken)}) return { installed: false }; return value.stop(${JSON.stringify(reason)}); })()`;
}

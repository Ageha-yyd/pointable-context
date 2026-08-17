(() => {
  "use strict";

  const hash = new URLSearchParams(location.hash.slice(1));
  const token = hash.get("token") || "";
  const lane = document.getElementById("chat-lane");
  const messages = document.getElementById("messages");
  const emptyState = document.getElementById("empty-state");
  const workspaceLabel = document.getElementById("workspace-label");
  const threadLabel = document.getElementById("thread-label");
  const composerForm = document.getElementById("composer-form");
  const composerInput = document.getElementById("composer-input");
  const sendButton = document.getElementById("send-button");
  const referenceTray = document.getElementById("reference-tray");
  const referenceChips = document.getElementById("reference-chips");
  const selectionAction = document.getElementById("selection-action");
  const detailPopover = document.getElementById("detail-popover");
  const detailBody = document.getElementById("detail-body");
  const detailClose = document.getElementById("detail-close");
  const toast = document.getElementById("toast");

  let busy = false;
  let generation = 0;
  let activeSelection = null;
  let detailAnchor = null;
  let toastTimer = null;

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
  }

  function request(path, options = {}) {
    return fetch(path, {
      ...options,
      headers: {
        "X-Pointable-Token": token,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
  }

  async function jsonRequest(path, body) {
    const response = await request(path, {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "request_failed");
    return value;
  }

  function shortId(value) {
    return value.length <= 14 ? value : `${value.slice(0, 7)}…${value.slice(-5)}`;
  }

  function messageElement(message, streaming = false) {
    const row = document.createElement("article");
    row.className = `message-row ${message.role}`;
    row.dataset.messageId = message.id;
    row.dataset.surface = message.role === "assistant" ? "assistant_message" : "user_message";
    const label = document.createElement("div");
    label.className = "message-label";
    label.textContent = message.role === "assistant" ? "Agent" : "You";
    const content = document.createElement("div");
    content.className = `message-content${streaming ? " streaming" : ""}`;
    content.textContent = message.text;
    row.append(label, content);
    return { row, content };
  }

  function renderMessages(state) {
    messages.replaceChildren();
    emptyState.hidden = state.messages.length > 0;
    for (const message of state.messages) messages.append(messageElement(message).row);
  }

  function renderReferents(referents) {
    referenceChips.replaceChildren();
    referenceTray.hidden = referents.length === 0;
    for (const referent of referents) {
      const chip = document.createElement("div");
      chip.className = "reference-chip";
      chip.title = `${referent.entityId}\n${referent.observedAt}`;
      const label = document.createElement("strong");
      label.textContent = referent.label;
      const revision = document.createElement("span");
      revision.textContent = ` · ${shortId(referent.revision)} · ${referent.freshness}`;
      chip.append(label, revision);
      referenceChips.append(chip);
    }
  }

  function renderState(state) {
    workspaceLabel.textContent = state.workspaceName;
    threadLabel.textContent = `Task ${shortId(state.threadId)}`;
    renderMessages(state);
    renderReferents(state.referents);
    busy = state.status === "busy";
    sendButton.disabled = busy;
    composerInput.disabled = busy;
  }

  function scrollToBottom() {
    document.getElementById("stream-anchor").scrollIntoView({ block: "end", behavior: "smooth" });
  }

  function closeSelectionAction() {
    selectionAction.hidden = true;
    activeSelection = null;
  }

  function closeDetail() {
    detailPopover.hidden = true;
    detailBody.replaceChildren();
    detailAnchor = null;
  }

  function positionFloating(element, rect, preferredWidth) {
    const margin = 10;
    const width = Math.min(preferredWidth, innerWidth - margin * 2);
    const height = element.offsetHeight || 48;
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(margin, Math.min(left, innerWidth - width - margin));
    let top = rect.top - height - 10;
    if (top < margin) top = Math.min(rect.bottom + 10, innerHeight - height - margin);
    element.style.left = `${Math.round(left)}px`;
    element.style.top = `${Math.max(margin, Math.round(top))}px`;
    element.style.width = `${Math.round(width)}px`;
  }

  function selectionInsideOneMessage(selection) {
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const end = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
    const startMessage = start && start.closest ? start.closest(".message-row") : null;
    const endMessage = end && end.closest ? end.closest(".message-row") : null;
    if (!startMessage || startMessage !== endMessage || !messages.contains(startMessage)) return null;
    const text = selection.toString().trim();
    if (!text || text.length > 512 || /[\u0000-\u001f\u007f]/u.test(text)) return null;
    const rect = range.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return { text, rect, surface: startMessage.dataset.surface };
  }

  function reconcileSelection() {
    if (!detailPopover.hidden) return;
    const candidate = selectionInsideOneMessage(getSelection());
    if (!candidate) {
      closeSelectionAction();
      return;
    }
    generation += 1;
    activeSelection = { ...candidate, generation };
    selectionAction.hidden = false;
    requestAnimationFrame(() => positionFloating(selectionAction, candidate.rect, 132));
  }

  function title(text) {
    const element = document.createElement("h2");
    element.id = "detail-title";
    element.className = "detail-title";
    element.textContent = text;
    return element;
  }

  function detailMeta(values) {
    const container = document.createElement("div");
    container.className = "detail-meta";
    for (const value of values) {
      const pill = document.createElement("span");
      pill.className = `detail-pill${value === "current" || value === "stale" ? ` ${value}` : ""}`;
      pill.textContent = value;
      container.append(pill);
    }
    return container;
  }

  function section(label) {
    const container = document.createElement("section");
    container.className = "detail-section";
    const heading = document.createElement("div");
    heading.className = "detail-section-title";
    heading.textContent = label;
    container.append(heading);
    return container;
  }

  function showError(result) {
    detailBody.replaceChildren();
    const error = document.createElement("div");
    error.className = "detail-error";
    const strong = document.createElement("strong");
    strong.textContent = "暂时无法显示详情";
    const text = document.createElement("span");
    text.textContent = result.message || "查询失败，请重新选择。";
    error.append(strong, text);
    detailBody.append(error);
  }

  function showCandidates(result, selection) {
    detailBody.replaceChildren(title("选择要查看的对象"));
    const summary = document.createElement("p");
    summary.className = "detail-summary";
    summary.textContent = `“${selection.text}”匹配到 ${result.candidates.length} 个对象。`;
    const list = document.createElement("div");
    list.className = "candidate-list";
    for (const candidate of result.candidates) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "candidate-button";
      const name = document.createElement("span");
      name.className = "candidate-name";
      name.textContent = `${candidate.label} · ${candidate.entityType}`;
      const description = document.createElement("span");
      description.className = "candidate-description";
      description.textContent = candidate.summary;
      button.append(name, description);
      button.addEventListener("click", async (event) => {
        if (!event.isTrusted) return;
        button.disabled = true;
        try {
          const next = await jsonRequest("/api/lookup", {
            text: selection.text,
            surface: selection.surface,
            generation: selection.generation,
            candidateRef: candidate.candidateRef,
          });
          renderLookup(next, selection);
        } catch {
          showError({ message: "候选引用已过期，请重新选择。" });
        }
      });
      list.append(button);
    }
    detailBody.append(summary, list);
  }

  function showDetail(result) {
    const detail = result.detail;
    detailBody.replaceChildren(title(detail.label));
    const summary = document.createElement("p");
    summary.className = "detail-summary";
    summary.textContent = detail.summary;
    detailBody.append(summary, detailMeta([
      detail.entityType,
      detail.freshness,
      shortId(detail.revision),
      detail.verification,
    ]));
    if (detail.facts.length) {
      const facts = section("当前事实");
      const grid = document.createElement("div");
      grid.className = "fact-grid";
      for (const fact of detail.facts) {
        const label = document.createElement("div");
        label.className = "fact-label";
        label.textContent = fact.label;
        const value = document.createElement("div");
        value.className = "fact-value";
        value.textContent = fact.value;
        grid.append(label, value);
      }
      facts.append(grid);
      detailBody.append(facts);
    }
    if (detail.sources.length) {
      const sources = section("来源与时间");
      const list = document.createElement("ul");
      list.className = "source-list";
      for (const source of detail.sources) {
        const item = document.createElement("li");
        item.textContent = source.label;
        list.append(item);
      }
      const time = document.createElement("li");
      time.textContent = `observed at ${detail.observedAt}`;
      list.append(time);
      sources.append(list);
      detailBody.append(sources);
    }
    const reference = document.createElement("button");
    reference.type = "button";
    reference.className = "reference-button";
    reference.textContent = "引用到当前任务";
    reference.addEventListener("click", async (event) => {
      if (!event.isTrusted) return;
      reference.disabled = true;
      reference.textContent = "正在引用…";
      try {
        const value = await jsonRequest("/api/reference", { detailRef: detail.detailRef });
        const state = await jsonRequest("/api/state");
        renderReferents(state.referents);
        reference.textContent = "已引用到当前任务";
        showToast(`已引用 ${value.referent.label}；没有新增 turn`);
      } catch {
        reference.disabled = false;
        reference.textContent = "引用失败，重试";
        showToast("引用失败；详情仍可查看");
      }
    });
    detailBody.append(reference);
  }

  function renderLookup(result, selection) {
    detailPopover.hidden = false;
    detailAnchor = selection.rect;
    if (result.kind === "detail") showDetail(result);
    else if (result.kind === "candidates") showCandidates(result, selection);
    else showError(result);
    requestAnimationFrame(() => positionFloating(detailPopover, detailAnchor, 430));
  }

  async function lookupSelection(selection) {
    detailPopover.hidden = false;
    detailBody.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "detail-error";
    loading.textContent = "正在读取当前工作区详情…";
    detailBody.append(loading);
    detailAnchor = selection.rect;
    requestAnimationFrame(() => positionFloating(detailPopover, detailAnchor, 430));
    try {
      renderLookup(await jsonRequest("/api/lookup", {
        text: selection.text,
        surface: selection.surface,
        generation: selection.generation,
      }), selection);
    } catch {
      showError({ message: "工作区查询失败，请重新选择。" });
    }
  }

  function parseSseBlock(block) {
    let event = "message";
    const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (!data.length) return null;
    return { event, value: JSON.parse(data.join("\n")) };
  }

  async function sendMessage(text) {
    busy = true;
    sendButton.disabled = true;
    composerInput.disabled = true;
    closeSelectionAction();
    closeDetail();
    emptyState.hidden = true;
    const localUser = messageElement({ id: `local-${Date.now()}`, role: "user", text });
    const localAgent = messageElement({ id: `stream-${Date.now()}`, role: "assistant", text: "" }, true);
    messages.append(localUser.row, localAgent.row);
    scrollToBottom();
    try {
      const response = await request("/api/turn", { method: "POST", body: JSON.stringify({ text }) });
      if (!response.ok || !response.body) throw new Error("turn_failed");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let doneState = null;
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const parsed = parseSseBlock(block);
          if (parsed && parsed.event === "delta") {
            localAgent.content.textContent += parsed.value.delta;
            scrollToBottom();
          } else if (parsed && parsed.event === "done") {
            doneState = parsed.value.state;
          } else if (parsed && parsed.event === "error") {
            throw new Error(parsed.value.error || "turn_failed");
          }
          boundary = buffer.indexOf("\n\n");
        }
        if (chunk.done) break;
      }
      if (!doneState) throw new Error("turn_completion_missing");
      renderState(doneState);
      scrollToBottom();
    } catch {
      const state = await jsonRequest("/api/state").catch(() => null);
      if (state) renderState(state);
      showToast("本轮未完成，请重新发送");
    } finally {
      busy = false;
      sendButton.disabled = false;
      composerInput.disabled = false;
      composerInput.focus();
    }
  }

  selectionAction.addEventListener("mousedown", (event) => event.preventDefault());
  selectionAction.addEventListener("click", (event) => {
    if (!event.isTrusted || !activeSelection) return;
    const selection = activeSelection;
    selectionAction.hidden = true;
    void lookupSelection(selection);
  });

  detailClose.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    closeDetail();
    getSelection()?.removeAllRanges();
  });

  document.addEventListener("selectionchange", () => requestAnimationFrame(reconcileSelection));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSelectionAction();
      closeDetail();
      getSelection()?.removeAllRanges();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !busy) {
      composerForm.requestSubmit();
    }
  });
  addEventListener("scroll", () => {
    if (!selectionAction.hidden) closeSelectionAction();
    if (!detailPopover.hidden && detailAnchor) positionFloating(detailPopover, detailAnchor, 430);
  }, { passive: true });
  addEventListener("resize", () => {
    if (!selectionAction.hidden && activeSelection) positionFloating(selectionAction, activeSelection.rect, 132);
    if (!detailPopover.hidden && detailAnchor) positionFloating(detailPopover, detailAnchor, 430);
  });

  composerInput.addEventListener("input", () => {
    composerInput.style.height = "auto";
    composerInput.style.height = `${Math.min(composerInput.scrollHeight, 150)}px`;
  });
  composerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = composerInput.value.trim();
    if (!text || busy) return;
    composerInput.value = "";
    composerInput.style.height = "auto";
    void sendMessage(text);
  });

  if (!token) {
    workspaceLabel.textContent = "缺少本地访问令牌";
    composerInput.disabled = true;
    sendButton.disabled = true;
    showToast("请使用启动命令输出的完整 URL");
    return;
  }

  jsonRequest("/api/state")
    .then(renderState)
    .catch(() => {
      workspaceLabel.textContent = "连接失败";
      composerInput.disabled = true;
      sendButton.disabled = true;
      showToast("无法连接本地 Pointable Context 服务");
    });
})();

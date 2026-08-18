export const POINTABLE_ENTITY_WIDGET_URI =
  "ui://pointable-context/context-capsule-v2.html";

export const POINTABLE_ENTITY_WIDGET_MIME = "text/html;profile=mcp-app";

/**
 * Self-contained, zero-turn Context Capsule. Business data arrives only in the
 * tool result. Expanding or collapsing the capsule is local UI state: it never
 * sends a message, invokes a model, opens a browser, or changes the task.
 */
export const POINTABLE_ENTITY_WIDGET_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Pointable Context Capsule</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: var(--font-sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      --pc-bg: var(--color-background-primary, light-dark(#ffffff, #171717));
      --pc-subtle: var(--color-background-secondary, light-dark(#f6f7f9, #222326));
      --pc-text: var(--color-text-primary, light-dark(#172033, #f3f4f6));
      --pc-muted: var(--color-text-secondary, light-dark(#64748b, #a6adbb));
      --pc-border: var(--color-border-primary, light-dark(#dbe2ea, #3b3f47));
      --pc-accent: var(--color-text-link, light-dark(#175cd3, #8ab4ff));
      --pc-accent-bg: light-dark(#eef5ff, #182b48);
      --pc-warn: light-dark(#8a4b08, #ffd08a);
      --pc-warn-bg: light-dark(#fff7e8, #3a2a13);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: transparent; color: var(--pc-text); }
    body { min-width: 0; }
    .capsule { overflow: hidden; background: var(--pc-bg); border: 1px solid var(--pc-border); border-radius: 14px; }
    .trigger { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; width: 100%; padding: 11px 12px; color: inherit; background: transparent; border: 0; text-align: left; cursor: pointer; }
    .trigger:hover { background: var(--pc-subtle); }
    .trigger:focus-visible { outline: 2px solid var(--pc-accent); outline-offset: -2px; }
    .kind { align-self: start; padding: 4px 7px; color: var(--pc-accent); background: var(--pc-accent-bg); border-radius: 999px; font-size: 10px; font-weight: 800; letter-spacing: .04em; white-space: nowrap; }
    .identity { min-width: 0; }
    .title { display: block; font-size: 14px; font-weight: 750; line-height: 1.35; overflow-wrap: anywhere; }
    .summary { display: block; margin-top: 3px; color: var(--pc-muted); font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
    .chevron { align-self: center; color: var(--pc-muted); font-size: 15px; transition: transform .15s ease; }
    .trigger[aria-expanded="true"] .chevron { transform: rotate(180deg); }
    .detail { padding: 0 12px 12px; border-top: 1px solid var(--pc-border); }
    .detail[hidden] { display: none; }
    .trust { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; margin: 11px 0; }
    .trust-cell { min-width: 0; padding: 8px 9px; background: var(--pc-subtle); border-radius: 8px; }
    .trust-label { display: block; margin-bottom: 2px; color: var(--pc-muted); font-size: 10px; }
    .trust-value { display: block; font-size: 11px; line-height: 1.35; overflow-wrap: anywhere; }
    .fact-list { display: grid; grid-template-columns: minmax(90px, .7fr) minmax(0, 1.5fr); gap: 7px 12px; margin: 0; font-size: 12px; }
    .fact-list dt { color: var(--pc-muted); overflow-wrap: anywhere; }
    .fact-list dd { margin: 0; line-height: 1.45; overflow-wrap: anywhere; }
    details { margin-top: 11px; padding-top: 9px; border-top: 1px solid var(--pc-border); }
    summary { color: var(--pc-accent); font-size: 11px; font-weight: 700; cursor: pointer; }
    details .fact-list { margin-top: 9px; }
    .source { margin: 8px 0 0; color: var(--pc-muted); font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
    .warning { margin: 10px 0 0; padding: 7px 9px; color: var(--pc-warn); background: var(--pc-warn-bg); border-radius: 8px; font-size: 10px; line-height: 1.4; }
    .empty { padding: 16px 12px; color: var(--pc-muted); text-align: center; font-size: 12px; }
    @media (max-width: 430px) {
      .trigger { grid-template-columns: minmax(0, 1fr) auto; }
      .kind { grid-column: 1 / -1; justify-self: start; }
      .trust { grid-template-columns: 1fr; }
      .fact-list { grid-template-columns: 1fr; gap: 2px; }
      .fact-list dd { margin-bottom: 7px; }
    }
  </style>
</head>
<body>
  <main id="app" class="capsule" aria-live="polite"><div class="empty">正在读取上下文胶囊…</div></main>
  <script>
  (() => {
    "use strict";
    const PROTOCOL_VERSION = "2026-01-26";
    const pending = new Map();
    let nextId = 1;
    let initialized = false;
    let lastSize = "";

    const labels = {
      purpose: "用途",
      change_summary: "本次变化",
      impact: "影响范围",
      status: "当前状态",
      key_sections: "关键部分",
      related_modules: "相关模块",
      path: "位置",
      definition: "定义",
      responsibility: "责任",
      introduced_because: "引入原因",
      replaces: "替代对象",
      interfaces: "接口",
      dependencies: "依赖",
      maturity: "成熟度",
      risk: "风险",
      decision: "决策",
      rationale: "原因",
      consequence: "影响",
      rejected_alternatives: "未采用方案",
      constraints: "约束",
      goal: "目标",
      completed: "已完成",
      current_state: "当前状态",
      next_step: "下一步",
      blocker: "阻塞",
      owner: "负责人",
      evidence: "证据",
      remaining: "剩余工作",
      related_sessions: "相关会话",
      technical_status: "技术状态",
      formal_gate: "正式门禁",
      evidence_rows: "证据条目",
      model_before_click: "点击前调用模型"
    };

    const profiles = {
      artifact: { name: "文件 / 文档", primary: ["purpose", "change_summary", "impact", "status"] },
      document: { name: "文件 / 文档", primary: ["purpose", "change_summary", "impact", "status"] },
      file: { name: "文件 / 文档", primary: ["purpose", "change_summary", "impact", "status"] },
      module: { name: "模块 / 概念", primary: ["definition", "responsibility", "introduced_because", "maturity"] },
      concept: { name: "模块 / 概念", primary: ["definition", "responsibility", "introduced_because", "maturity"] },
      decision: { name: "决策", primary: ["decision", "rationale", "consequence", "status"] },
      task: { name: "任务状态", primary: ["goal", "completed", "current_state", "next_step"] },
      task_state: { name: "任务状态", primary: ["goal", "completed", "current_state", "next_step"] },
      work_unit: { name: "任务状态", primary: ["status", "remaining", "owner", "related_sessions"] },
      verification: { name: "验证证据", primary: ["status", "evidence", "impact", "risk"] }
    };

    function isObject(value) {
      return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function text(value, max) {
      if (typeof value === "string") return value.slice(0, max);
      if (typeof value === "number" || typeof value === "boolean") return String(value).slice(0, max);
      if (value === null) return "未指定";
      return "—";
    }

    function displayValue(value) {
      return Array.isArray(value)
        ? value.slice(0, 5).map((item) => text(item, 140)).join(" · ")
        : text(value, 320);
    }

    function request(method, params, timeoutMs) {
      const id = nextId++;
      window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pending.delete(id);
          reject(new Error("bridge_timeout"));
        }, timeoutMs || 5000);
        pending.set(id, {
          resolve(value) { window.clearTimeout(timer); resolve(value); },
          reject(error) { window.clearTimeout(timer); reject(error); }
        });
      });
    }

    function notify(method, params) {
      window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
    }

    function respond(id, result) {
      window.parent.postMessage({ jsonrpc: "2.0", id, result }, "*");
    }

    function node(tag, className, value) {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (value !== undefined) element.textContent = value;
      return element;
    }

    function appendFacts(container, entries) {
      for (const [key, value] of entries) {
        container.append(
          node("dt", "", labels[key] || key.replaceAll("_", " ")),
          node("dd", "", displayValue(value))
        );
      }
    }

    function render(raw) {
      const root = document.getElementById("app");
      root.replaceChildren();
      if (!isObject(raw) || raw.status !== "detail" || !isObject(raw.entity)) {
        root.append(node("div", "empty", "上下文胶囊暂时不可用；请使用文本结果。"));
        reportSize();
        return;
      }

      const entity = raw.entity;
      const type = text(entity.entityType, 80);
      const profile = profiles[type] || { name: "上下文对象", primary: [] };
      const facts = isObject(entity.facts) ? Object.entries(entity.facts).slice(0, 16) : [];
      const primaryKeys = new Set(profile.primary);
      const selected = [];
      for (const key of profile.primary) {
        const match = facts.find((entry) => entry[0] === key);
        if (match && selected.length < 7) selected.push(match);
      }
      for (const entry of facts) {
        if (selected.length >= 4 || primaryKeys.has(entry[0])) continue;
        selected.push(entry);
      }
      const selectedKeys = new Set(selected.map((entry) => entry[0]));
      const additional = facts.filter((entry) => !selectedKeys.has(entry[0]));

      const trigger = node("button", "trigger");
      trigger.type = "button";
      trigger.setAttribute("aria-expanded", "false");
      trigger.setAttribute("aria-controls", "pointable-capsule-detail");
      trigger.append(node("span", "kind", profile.name));
      const identity = node("span", "identity");
      identity.append(
        node("span", "title", text(entity.label, 200)),
        node("span", "summary", text(entity.summary, 500))
      );
      trigger.append(identity, node("span", "chevron", "⌄"));

      const detail = node("section", "detail");
      detail.id = "pointable-capsule-detail";
      detail.hidden = true;

      const trust = node("div", "trust");
      for (const item of [
        ["修订", entity.entityRevision],
        ["数据时间", entity.observedAt],
        ["新鲜度", entity.freshness]
      ]) {
        const cell = node("div", "trust-cell");
        cell.append(node("span", "trust-label", item[0]), node("span", "trust-value", text(item[1], 160)));
        trust.append(cell);
      }
      detail.append(trust);

      if (selected.length) {
        const list = node("dl", "fact-list");
        appendFacts(list, selected);
        detail.append(list);
      }

      const relations = Array.isArray(entity.relations) ? entity.relations.slice(0, 8) : [];
      if (additional.length || relations.length) {
        const more = node("details");
        more.append(node("summary", "", "更多影响与关系"));
        const list = node("dl", "fact-list");
        appendFacts(list, additional);
        if (relations.length) {
          list.append(node("dt", "", "相关对象"), node("dd", "", relations.map((item) => text(item, 120)).join(" · ")));
        }
        more.append(list);
        detail.append(more);
      }

      const sources = Array.isArray(entity.sources) ? entity.sources.slice(0, 5) : [];
      const verification = isObject(raw.verification) ? raw.verification : {};
      const evidence = node("details");
      evidence.append(node("summary", "", "来源与验证"));
      evidence.append(node("p", "source", "对象：" + text(entity.entityId, 160) + " · 范围：" + text(raw.projectId, 100)));
      evidence.append(node("p", "source", "验证：" + text(verification.method, 80) + " · " + text(verification.verifiedAt, 100)));
      if (sources.length) {
        evidence.append(node("p", "source", "来源：" + sources.map((source) => {
          if (!isObject(source)) return "—";
          return text(source.sourceType, 80) + " / " + text(source.sourceId, 120);
        }).join("；")));
      }
      detail.append(evidence);

      if (raw.warning) detail.append(node("p", "warning", text(raw.warning, 500)));
      root.append(trigger, detail);

      trigger.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        const expanded = trigger.getAttribute("aria-expanded") === "true";
        trigger.setAttribute("aria-expanded", String(!expanded));
        detail.hidden = expanded;
        reportSize();
      });
      reportSize();
    }

    function reportSize() {
      if (!initialized) return;
      window.requestAnimationFrame(() => {
        const width = Math.ceil(document.documentElement.scrollWidth);
        const height = Math.ceil(document.documentElement.scrollHeight);
        const key = width + "x" + height;
        if (key === lastSize || width < 1 || height < 1) return;
        lastSize = key;
        notify("ui/notifications/size-changed", { width, height });
      });
    }

    window.addEventListener("message", (event) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!isObject(message) || message.jsonrpc !== "2.0") return;
      if (message.id !== undefined && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) entry.reject(message.error);
        else entry.resolve(message.result);
        return;
      }
      if (message.method === "ui/notifications/tool-result") {
        render(isObject(message.params) ? message.params.structuredContent : null);
        return;
      }
      if (message.method === "ui/resource-teardown" && message.id !== undefined) respond(message.id, {});
    }, { passive: true });

    async function initialize() {
      try {
        await request("ui/initialize", {
          appInfo: { name: "pointable-context-capsule", version: "1.0.0" },
          appCapabilities: { availableDisplayModes: ["inline"] },
          protocolVersion: PROTOCOL_VERSION
        }, 5000);
        initialized = true;
        notify("ui/notifications/initialized", {});
        if (window.ResizeObserver) new ResizeObserver(reportSize).observe(document.body);
      } catch (_) {}
      const bridge = window.openai;
      if (bridge && bridge.toolOutput) render(bridge.toolOutput);
      reportSize();
    }

    initialize();
  })();
  </script>
</body>
</html>`;

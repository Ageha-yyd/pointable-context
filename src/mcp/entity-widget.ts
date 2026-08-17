export const POINTABLE_ENTITY_WIDGET_URI =
  "ui://pointable-context/entity-detail-v1.html";

export const POINTABLE_ENTITY_WIDGET_MIME = "text/html;profile=mcp-app";

/**
 * Self-contained MCP App used by the render-only tool. Business data always
 * arrives in the tool result; the document contains no baked entity state and
 * makes no network requests.
 */
export const POINTABLE_ENTITY_WIDGET_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Pointable Context</title>
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
      --pc-warn: light-dark(#8a4b08, #ffd08a);
      --pc-warn-bg: light-dark(#fff7e8, #3a2a13);
      --pc-danger: light-dark(#9f1c20, #ff9ca0);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: transparent; color: var(--pc-text); }
    body { min-width: 0; }
    .card { padding: 14px; background: var(--pc-bg); border: 1px solid var(--pc-border); border-radius: 14px; }
    .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .eyebrow { margin: 0 0 5px; color: var(--pc-accent); font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 0; font-size: 17px; line-height: 1.3; overflow-wrap: anywhere; }
    .summary { margin: 7px 0 0; color: var(--pc-muted); font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
    .badge { flex: 0 0 auto; padding: 4px 8px; border: 1px solid var(--pc-border); border-radius: 999px; color: var(--pc-muted); font-size: 11px; font-weight: 700; }
    .badge.stale, .badge.partial { color: var(--pc-warn); background: var(--pc-warn-bg); }
    .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 12px 0; }
    .cell { min-width: 0; padding: 9px 10px; background: var(--pc-subtle); border-radius: 9px; }
    .label { display: block; margin-bottom: 3px; color: var(--pc-muted); font-size: 11px; }
    .value { display: block; font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
    .section { margin-top: 12px; }
    .section h2 { margin: 0 0 7px; color: var(--pc-muted); font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    dl { display: grid; grid-template-columns: minmax(92px, .75fr) minmax(0, 1.5fr); gap: 6px 12px; margin: 0; font-size: 12px; }
    dt { color: var(--pc-muted); overflow-wrap: anywhere; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .source { margin: 0; color: var(--pc-muted); font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
    .fixture { margin: 12px 0 0; padding: 8px 10px; color: var(--pc-warn); background: var(--pc-warn-bg); border-radius: 9px; font-size: 11px; line-height: 1.4; }
    form { display: flex; gap: 7px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--pc-border); }
    input { min-width: 0; flex: 1 1 auto; padding: 8px 10px; color: var(--pc-text); background: var(--pc-bg); border: 1px solid var(--pc-border); border-radius: 9px; font: inherit; font-size: 12px; }
    button { flex: 0 0 auto; padding: 8px 11px; color: white; background: #175cd3; border: 0; border-radius: 9px; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
    button:disabled { cursor: wait; opacity: .65; }
    input:focus-visible, button:focus-visible { outline: 2px solid var(--pc-accent); outline-offset: 2px; }
    .status { min-height: 17px; margin: 6px 0 0; color: var(--pc-muted); font-size: 11px; }
    .status.error { color: var(--pc-danger); }
    .empty { padding: 20px 12px; color: var(--pc-muted); text-align: center; font-size: 12px; }
    @media (max-width: 430px) { .meta { grid-template-columns: 1fr; } form { flex-direction: column; } button { width: 100%; } }
  </style>
</head>
<body>
  <main id="app" class="card" aria-live="polite"><div class="empty">正在读取上下文对象…</div></main>
  <script>
  (() => {
    "use strict";
    const PROTOCOL_VERSION = "2026-01-26";
    const pending = new Map();
    let nextId = 1;
    let current = null;
    let initialized = false;
    let lastSize = "";

    function isObject(value) {
      return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function text(value, max) {
      if (typeof value === "string") return value.slice(0, max);
      if (typeof value === "number" || typeof value === "boolean") return String(value).slice(0, max);
      if (value === null) return "null";
      return "—";
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

    function addMeta(container, label, value) {
      const cell = node("div", "cell");
      cell.append(node("span", "label", label), node("span", "value", value));
      container.append(cell);
    }

    function render(raw) {
      const root = document.getElementById("app");
      root.replaceChildren();
      if (!isObject(raw) || raw.status !== "detail" || !isObject(raw.entity)) {
        root.append(node("div", "empty", "上下文详情暂时不可用；请使用文本结果。"));
        current = null;
        reportSize();
        return;
      }

      const entity = raw.entity;
      const verification = isObject(raw.verification) ? raw.verification : {};
      current = {
        entityId: text(entity.entityId, 160),
        entityType: text(entity.entityType, 80),
        label: text(entity.label, 200),
        summary: text(entity.summary, 500),
        revision: text(entity.entityRevision, 160),
        observedAt: text(entity.observedAt, 80),
        freshness: text(entity.freshness, 20),
        projectId: text(raw.projectId, 100)
      };

      const header = node("div", "top");
      const heading = node("div");
      heading.append(node("p", "eyebrow", current.entityType + " · " + current.entityId));
      heading.append(node("h1", "", current.label));
      heading.append(node("p", "summary", current.summary));
      const badge = node("span", "badge " + current.freshness, current.freshness);
      header.append(heading, badge);
      root.append(header);

      const meta = node("div", "meta");
      addMeta(meta, "修订", current.revision);
      addMeta(meta, "数据时间", current.observedAt);
      addMeta(meta, "范围", current.projectId);
      addMeta(meta, "验证", text(verification.method, 60));
      root.append(meta);

      const facts = isObject(entity.facts) ? Object.entries(entity.facts).slice(0, 5) : [];
      if (facts.length) {
        const section = node("section", "section");
        section.append(node("h2", "", "关键事实"));
        const list = node("dl");
        for (const pair of facts) {
          const value = Array.isArray(pair[1])
            ? pair[1].slice(0, 5).map((item) => text(item, 120)).join(" · ")
            : text(pair[1], 240);
          list.append(node("dt", "", text(pair[0], 100)), node("dd", "", value));
        }
        section.append(list);
        root.append(section);
      }

      const sources = Array.isArray(entity.sources) ? entity.sources.slice(0, 5) : [];
      if (sources.length) {
        const section = node("section", "section");
        section.append(node("h2", "", "来源"));
        section.append(node("p", "source", sources.map((source) => {
          if (!isObject(source)) return "—";
          return text(source.sourceType, 80) + " / " + text(source.sourceId, 120);
        }).join("；")));
        root.append(section);
      }

      root.append(node("p", "fixture", text(raw.warning, 500)));
      const form = node("form");
      form.setAttribute("aria-label", "就此对象询问 Agent");
      const input = node("input");
      input.type = "text";
      input.name = "question";
      input.maxLength = 300;
      input.placeholder = "例如：这个状态意味着什么？";
      input.setAttribute("aria-label", "关于此对象的问题");
      const submit = node("button", "", "问 Agent");
      submit.type = "submit";
      const status = node("p", "status");
      form.append(input, submit);
      root.append(form, status);

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!event.isTrusted || !current || submit.disabled) return;
        const question = input.value.trim().slice(0, 300) || "请解释这个对象的当前状态、依据和需要注意的事项。";
        const referent = "Pointable Context 对象 " + current.entityId +
          "（类型 " + current.entityType + "，修订 " + current.revision +
          "，数据时间 " + current.observedAt + "，freshness " + current.freshness + "）";
        const prompt = "请基于刚才原位 Widget 展示的 " + referent + " 回答：" + question +
          " 这是 FIXTURE-ONLY 演示数据，不要把它表述为当前项目的实时权威状态。";
        submit.disabled = true;
        status.className = "status";
        status.textContent = "正在回到当前任务…";
        try {
          try {
            await request("ui/update-model-context", {
              content: [{ type: "text", text: referent }],
              structuredContent: {
                entityId: current.entityId,
                entityType: current.entityType,
                revision: current.revision,
                observedAt: current.observedAt,
                freshness: current.freshness,
                fixtureOnly: true
              }
            }, 3000);
          } catch (_) {
            // The full referent is also carried in ui/message, so context update is optional.
          }
          await request("ui/message", {
            role: "user",
            content: { type: "text", text: prompt }
          }, 7000);
          status.textContent = "已发送到当前任务。";
          input.value = "";
        } catch (error) {
          const bridge = window.openai;
          const timedOut = error instanceof Error && error.message === "bridge_timeout";
          if (!timedOut && bridge && typeof bridge.sendFollowUpMessage === "function") {
            try {
              await bridge.sendFollowUpMessage({ prompt, context: referent, title: "询问上下文对象" });
              status.textContent = "已发送到当前任务。";
              input.value = "";
              return;
            } catch (_) {}
          }
          status.className = "status error";
          status.textContent = "当前宿主未确认消息回流；请在对话框中继续询问。";
        } finally {
          submit.disabled = false;
        }
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
      if (message.method === "ui/resource-teardown" && message.id !== undefined) {
        respond(message.id, {});
      }
    }, { passive: true });

    async function initialize() {
      try {
        await request("ui/initialize", {
          appInfo: { name: "pointable-context-entity-widget", version: "0.1.0" },
          appCapabilities: { availableDisplayModes: ["inline"] },
          protocolVersion: PROTOCOL_VERSION
        }, 5000);
        initialized = true;
        notify("ui/notifications/initialized", {});
        if (window.ResizeObserver) new ResizeObserver(reportSize).observe(document.body);
      } catch (_) {
        // Compatibility data below still keeps the text-only fallback useful.
      }
      const bridge = window.openai;
      if (bridge && bridge.toolOutput) render(bridge.toolOutput);
      reportSize();
    }

    initialize();
  })();
  </script>
</body>
</html>`;

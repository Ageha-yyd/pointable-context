import { randomBytes } from "node:crypto";

const MAX_TITLE_CHARS = 120;
const MAX_MESSAGE_CHARS = 8_000;
const MAX_MESSAGES = 24;

export interface NativeConversationProbeRpc {
  request<T = unknown>(method: string, params: unknown): Promise<T>;
}

export interface ScriptedConversationMessage {
  role: "user" | "assistant";
  text: string;
}

export interface NativeConversationProbeOptions {
  rpc: NativeConversationProbeRpc;
  cwd: string;
  title?: string;
  messages?: readonly ScriptedConversationMessage[];
  token?: string;
}

export interface NativeConversationProbeResult {
  schemaVersion: 1;
  threadId: string;
  title: string;
  token: string;
  markers: readonly string[];
  injectedItemCount: number;
  turnCountAfterInjection: number;
  markersVisibleInTurns: readonly string[];
  modelInvoked: false;
  injectionCreatedTurn: boolean;
  desktopRendering: "visible_in_thread_history" | "requires_desktop_inspection";
}

interface ResponsesMessageItem {
  type: "message";
  role: "user" | "assistant";
  content: Array<
    | { type: "input_text"; text: string }
    | { type: "output_text"; text: string }
  >;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bounded(value: string, name: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maximum) {
    throw new RangeError(`${name} must contain from 1 to ${maximum} characters`);
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(normalized)) {
    throw new TypeError(`${name} contains unsupported control characters`);
  }
  return normalized;
}

function probeToken(value?: string): string {
  const token = value ?? randomBytes(8).toString("hex");
  if (!/^[a-z0-9]{8,32}$/u.test(token)) throw new Error("native_replay_probe_token_invalid");
  return token;
}

function defaultMessages(token: string): readonly ScriptedConversationMessage[] {
  return Object.freeze([
    Object.freeze({
      role: "user" as const,
      text: `[PC-NATIVE-REPLAY:${token}:U1] 请继续兼容性工作，并说明当前发布阻塞。`,
    }),
    Object.freeze({
      role: "assistant" as const,
      text: [
        `[PC-NATIVE-REPLAY:${token}:A1] 已完成宿主兼容性检查。`,
        "当前阻塞是 navigation recovery 尚未通过；在该 Gate 关闭前不能开始参与者招募。",
      ].join("\n"),
    }),
    Object.freeze({
      role: "user" as const,
      text: `[PC-NATIVE-REPLAY:${token}:U2] navigation recovery 通过后，下一步是什么？`,
    }),
    Object.freeze({
      role: "assistant" as const,
      text: [
        `[PC-NATIVE-REPLAY:${token}:A2] 下一步是运行受控原生会话试次。`,
        "这是一条研究探针消息，不代表真实项目状态，也不调用模型。",
      ].join("\n"),
    }),
  ]);
}

export function createScriptedConversationItems(
  messages: readonly ScriptedConversationMessage[],
): readonly ResponsesMessageItem[] {
  if (messages.length < 2 || messages.length > MAX_MESSAGES) {
    throw new RangeError(`messages must contain from 2 to ${MAX_MESSAGES} items`);
  }
  return Object.freeze(messages.map((message, index) => {
    if (message.role !== "user" && message.role !== "assistant") {
      throw new TypeError(`message ${index + 1} has an unsupported role`);
    }
    const text = bounded(message.text, `message ${index + 1}`, MAX_MESSAGE_CHARS);
    return Object.freeze({
      type: "message" as const,
      role: message.role,
      content: Object.freeze([
        Object.freeze(message.role === "user"
          ? { type: "input_text" as const, text }
          : { type: "output_text" as const, text }),
      ]) as ResponsesMessageItem["content"],
    });
  }));
}

function threadIdFrom(value: unknown): string {
  if (!record(value) || !record(value.thread) || typeof value.thread.id !== "string") {
    throw new Error("native_replay_probe_thread_invalid");
  }
  return bounded(value.thread.id, "thread id", 256);
}

function turnsFrom(value: unknown, expectedThreadId: string): readonly unknown[] {
  if (
    !record(value) ||
    !record(value.thread) ||
    value.thread.id !== expectedThreadId ||
    !Array.isArray(value.thread.turns)
  ) {
    throw new Error("native_replay_probe_thread_read_invalid");
  }
  return value.thread.turns;
}

function collectStrings(value: unknown, output: string[], depth = 0): void {
  if (depth > 8) return;
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output, depth + 1);
    return;
  }
  if (!record(value)) return;
  for (const item of Object.values(value)) collectStrings(item, output, depth + 1);
}

export async function createNativeConversationProbe(
  options: NativeConversationProbeOptions,
): Promise<NativeConversationProbeResult> {
  const cwd = bounded(options.cwd, "cwd", 4_096);
  const token = probeToken(options.token);
  const title = bounded(
    options.title ?? `Pointable Context Native Replay Probe ${token}`,
    "title",
    MAX_TITLE_CHARS,
  );
  const messages = options.messages ?? defaultMessages(token);
  const items = createScriptedConversationItems(messages);
  const markers = Object.freeze(messages.flatMap((message) =>
    message.text.match(/\[PC-NATIVE-REPLAY:[a-z0-9]+:[AU]\d+\]/gu) ?? []
  ));
  if (markers.length !== messages.length) {
    throw new Error("native_replay_probe_marker_missing");
  }

  let createdThreadId: string | undefined;
  try {
    const started = await options.rpc.request("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: false,
      serviceName: "pointable_context_native_replay_probe",
    });
    createdThreadId = threadIdFrom(started);
    await options.rpc.request("thread/name/set", {
      threadId: createdThreadId,
      name: title,
    });
    await options.rpc.request("thread/inject_items", {
      threadId: createdThreadId,
      items,
    });
    const read = await options.rpc.request("thread/read", {
      threadId: createdThreadId,
      includeTurns: true,
    });
    const turns = turnsFrom(read, createdThreadId);
    const turnStrings: string[] = [];
    collectStrings(turns, turnStrings);
    const visibleMarkers = Object.freeze(markers.filter((marker) =>
      turnStrings.some((value) => value.includes(marker))
    ));
    return Object.freeze({
      schemaVersion: 1,
      threadId: createdThreadId,
      title,
      token,
      markers,
      injectedItemCount: items.length,
      turnCountAfterInjection: turns.length,
      markersVisibleInTurns: visibleMarkers,
      modelInvoked: false,
      injectionCreatedTurn: turns.length > 0,
      desktopRendering: visibleMarkers.length === markers.length
        ? "visible_in_thread_history"
        : "requires_desktop_inspection",
    });
  } catch (error) {
    if (createdThreadId !== undefined) {
      await options.rpc.request("thread/delete", { threadId: createdThreadId }).catch(() => undefined);
    }
    throw error;
  }
}

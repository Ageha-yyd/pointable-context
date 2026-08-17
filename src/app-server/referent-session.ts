import type { ReferentInjectionItem } from "./referent.js";

export interface AppServerRpc {
  request<T = unknown>(method: string, params: unknown): Promise<T>;
  waitForNotification<T = unknown>(
    method: string,
    predicate?: (params: unknown) => boolean,
    timeoutMs?: number,
  ): Promise<T>;
}

export interface ReferentSessionResult {
  threadId: string;
  turnsBefore: number;
  turnsAfter: number;
}

export interface ReferentSessionOptions {
  ephemeral?: boolean;
  onThreadStarted?(threadId: string): void;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function threadId(value: unknown): string {
  if (!record(value) || !record(value.thread) || typeof value.thread.id !== "string") {
    throw new Error("app_server_thread_invalid");
  }
  return value.thread.id;
}

function turns(value: unknown, expectedThreadId: string): unknown[] {
  if (
    !record(value) ||
    !record(value.thread) ||
    value.thread.id !== expectedThreadId ||
    !Array.isArray(value.thread.turns)
  ) {
    throw new Error("app_server_thread_read_invalid");
  }
  return value.thread.turns;
}

export async function createReferentSession(
  rpc: AppServerRpc,
  cwd: string,
  item: ReferentInjectionItem,
  options: ReferentSessionOptions = {},
): Promise<ReferentSessionResult> {
  const started = await rpc.request("thread/start", {
    cwd,
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: options.ephemeral ?? true,
    serviceName: "pointable_context_referent_probe",
  });
  const id = threadId(started);
  options.onThreadStarted?.(id);
  await rpc.request("thread/inject_items", {
    threadId: id,
    items: [item],
  });
  const after = turns(await rpc.request("thread/read", {
    threadId: id,
    includeTurns: true,
  }), id);
  if (after.length !== 0) {
    throw new Error("referent_injection_created_turn");
  }
  return Object.freeze({
    threadId: id,
    turnsBefore: 0,
    turnsAfter: after.length,
  });
}

export async function askAboutReferent(
  rpc: AppServerRpc,
  threadId: string,
  prompt: string,
): Promise<{ turnId: string; agentText: string }> {
  const completion = rpc.waitForNotification<Record<string, unknown>>(
    "turn/completed",
    (params) => record(params) && params.threadId === threadId,
    120_000,
  );
  const started = await rpc.request<Record<string, unknown>>("turn/start", {
    threadId,
    input: [{ type: "text", text: prompt, text_elements: [] }],
    approvalPolicy: "never",
    sandboxPolicy: { type: "readOnly", access: { type: "fullAccess" } },
  });
  if (!record(started.turn) || typeof started.turn.id !== "string") {
    throw new Error("app_server_turn_invalid");
  }
  const turnId = started.turn.id;
  const completed = await completion;
  if (!record(completed.turn) || completed.turn.id !== turnId) {
    throw new Error("app_server_turn_completion_invalid");
  }
  const read = await rpc.request<Record<string, unknown>>("thread/read", {
    threadId,
    includeTurns: true,
  });
  if (!record(read.thread) || !Array.isArray(read.thread.turns)) {
    throw new Error("app_server_thread_read_invalid");
  }
  const turn = read.thread.turns.find(
    (candidate) => record(candidate) && candidate.id === turnId,
  );
  if (!record(turn) || !Array.isArray(turn.items)) {
    throw new Error("app_server_turn_missing");
  }
  const agentText = turn.items
    .filter((item) => record(item) && item.type === "agentMessage" && typeof item.text === "string")
    .map((item) => String((item as Record<string, unknown>).text))
    .join("\n")
    .trim();
  return Object.freeze({ turnId, agentText });
}

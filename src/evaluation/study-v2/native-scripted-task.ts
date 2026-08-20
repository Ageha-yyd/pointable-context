const MAX_TITLE_CHARS = 120;
const MAX_MESSAGE_CHARS = 8_000;
const MAX_EXCHANGES = 24;

export interface StudyV2ScriptedExchange {
  user: string;
  assistant: string;
}

export interface StudyV2ScriptedTaskRpc {
  request<T = unknown>(method: string, params: unknown): Promise<T>;
  waitForNotification<T = unknown>(
    method: string,
    predicate?: (params: unknown) => boolean,
    timeoutMs?: number,
  ): Promise<T>;
}

export interface MaterializeStudyV2ScriptedTaskOptions {
  rpc: StudyV2ScriptedTaskRpc;
  workspaceRoot: string;
  title: string;
  model: string;
  exchanges: readonly StudyV2ScriptedExchange[];
  serviceName?: string;
  notificationTimeoutMs?: number;
}

export interface StudyV2ScriptedTaskResult {
  schemaVersion: 1;
  threadId: string;
  title: string;
  turnIds: readonly string[];
  exchangeCount: number;
  nativeTurns: true;
  liveModelInvoked: false;
  desktopRendering: "requires_desktop_inspection";
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bounded(value: string, name: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maximum) {
    throw new RangeError(`${name} must contain from 1 to ${maximum} characters`);
  }
  if (/\p{Cc}|\p{Cf}/u.test(normalized)) {
    throw new TypeError(`${name} contains unsupported control characters`);
  }
  return normalized;
}

function safeServiceName(value?: string): string {
  const name = value ?? "pointable_context_scripted_study_task";
  if (!/^[A-Za-z0-9_.-]{3,96}$/u.test(name)) {
    throw new Error("study_v2_scripted_service_name_invalid");
  }
  return name;
}

function threadIdFrom(value: unknown): string {
  if (!record(value) || !record(value.thread) || typeof value.thread.id !== "string") {
    throw new Error("study_v2_scripted_thread_invalid");
  }
  return bounded(value.thread.id, "thread id", 256);
}

function turnIdFrom(value: unknown): string {
  if (!record(value) || !record(value.turn) || typeof value.turn.id !== "string") {
    throw new Error("study_v2_scripted_turn_invalid");
  }
  return bounded(value.turn.id, "turn id", 256);
}

function completedTurn(value: unknown, expectedThreadId: string, expectedTurnId: string): boolean {
  return record(value) &&
    (value.threadId === undefined || value.threadId === expectedThreadId) && record(value.turn) &&
    value.turn.id === expectedTurnId && value.turn.status === "completed";
}

function collectStrings(value: unknown, output: string[], depth = 0): void {
  if (depth > 10) return;
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

function validatedExchanges(
  values: readonly StudyV2ScriptedExchange[],
): readonly Readonly<StudyV2ScriptedExchange>[] {
  if (values.length < 1 || values.length > MAX_EXCHANGES) {
    throw new RangeError(`exchanges must contain from 1 to ${MAX_EXCHANGES} items`);
  }
  return Object.freeze(values.map((exchange, index) => Object.freeze({
    user: bounded(exchange.user, `exchange ${index + 1} user`, MAX_MESSAGE_CHARS),
    assistant: bounded(exchange.assistant, `exchange ${index + 1} assistant`, MAX_MESSAGE_CHARS),
  })));
}

export async function materializeStudyV2ScriptedTask(
  options: MaterializeStudyV2ScriptedTaskOptions,
): Promise<StudyV2ScriptedTaskResult> {
  const workspaceRoot = bounded(options.workspaceRoot, "workspace root", 4_096);
  const title = bounded(options.title, "title", MAX_TITLE_CHARS);
  const model = bounded(options.model, "model", 128);
  const exchanges = validatedExchanges(options.exchanges);
  const serviceName = safeServiceName(options.serviceName);
  const timeoutMs = options.notificationTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new RangeError("notificationTimeoutMs must be from 1000 to 120000");
  }

  let createdThreadId: string | undefined;
  try {
    createdThreadId = threadIdFrom(await options.rpc.request("thread/start", {
      cwd: workspaceRoot,
      model,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: false,
      serviceName,
    }));
    await options.rpc.request("thread/name/set", {
      threadId: createdThreadId,
      name: title,
    });
    const turnIds: string[] = [];
    for (const exchange of exchanges) {
      const completion = options.rpc.waitForNotification(
        "turn/completed",
        (value) => record(value) && record(value.turn) &&
          (value.threadId === undefined || value.threadId === createdThreadId),
        timeoutMs,
      );
      const expectedTurnId = turnIdFrom(await options.rpc.request("turn/start", {
        threadId: createdThreadId,
        input: [{ type: "text", text: exchange.user, text_elements: [] }],
        model,
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly", access: { type: "fullAccess" } },
      }));
      const terminal = await completion;
      if (!completedTurn(terminal, createdThreadId, expectedTurnId)) {
        throw new Error("study_v2_scripted_turn_completion_invalid");
      }
      turnIds.push(expectedTurnId);
    }
    const read = await options.rpc.request("thread/read", {
      threadId: createdThreadId,
      includeTurns: true,
    });
    if (!record(read) || !record(read.thread) || read.thread.id !== createdThreadId ||
      !Array.isArray(read.thread.turns) || read.thread.turns.length !== exchanges.length) {
      throw new Error("study_v2_scripted_thread_read_invalid");
    }
    const strings: string[] = [];
    collectStrings(read.thread.turns, strings);
    for (const exchange of exchanges) {
      if (!strings.some((value) => value.includes(exchange.user)) ||
        !strings.some((value) => value.includes(exchange.assistant))) {
        throw new Error("study_v2_scripted_transcript_mismatch");
      }
    }
    return Object.freeze({
      schemaVersion: 1,
      threadId: createdThreadId,
      title,
      turnIds: Object.freeze(turnIds),
      exchangeCount: exchanges.length,
      nativeTurns: true,
      liveModelInvoked: false,
      desktopRendering: "requires_desktop_inspection",
    });
  } catch (error) {
    if (createdThreadId !== undefined) {
      await options.rpc.request("thread/delete", { threadId: createdThreadId }).catch(() => undefined);
    }
    throw error;
  }
}

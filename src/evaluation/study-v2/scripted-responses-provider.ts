import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { WebSocket, WebSocketServer, type RawData } from "ws";

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_SCRIPT_STEPS = 64;
const MAX_OUTPUT_CHARS = 24_000;

export interface ScriptedResponseStep {
  outputText: string;
}

export interface ScriptedResponsesProviderRequest {
  ordinal: number;
  model: string;
  stream: boolean;
  transport: "http_sse" | "websocket";
}

export interface ScriptedResponsesProviderHandle {
  origin: string;
  requests: readonly ScriptedResponsesProviderRequest[];
  stop(): Promise<void>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedOutput(value: string, index: number): string {
  if (
    value.length < 1 ||
    value.length > MAX_OUTPUT_CHARS ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value)
  ) {
    throw new Error(`scripted_response_${index + 1}_invalid`);
  }
  return value;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REQUEST_BYTES) throw new Error("scripted_provider_request_too_large");
    chunks.push(buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("scripted_provider_request_invalid");
  }
  if (!record(value)) throw new Error("scripted_provider_request_invalid");
  return value;
}

function responseEnvelope(
  responseId: string,
  messageId: string,
  model: string,
  outputText: string,
  status: "in_progress" | "completed",
): Record<string, unknown> {
  const completed = status === "completed";
  return {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1_000),
    status,
    background: false,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model,
    output: completed ? [{
      id: messageId,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{
        type: "output_text",
        text: outputText,
        annotations: [],
        logprobs: [],
      }],
    }] : [],
    parallel_tool_calls: true,
    previous_response_id: null,
    prompt_cache_key: null,
    reasoning: { effort: null, summary: null },
    safety_identifier: null,
    service_tier: "default",
    store: true,
    temperature: 1,
    text: { format: { type: "text" }, verbosity: "medium" },
    tool_choice: "auto",
    tools: [],
    top_logprobs: 0,
    top_p: 1,
    truncation: "disabled",
    usage: completed ? {
      input_tokens: 1,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 1,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 2,
    } : null,
    user: null,
    metadata: {},
  };
}

function writeEvent(
  response: ServerResponse,
  event: Record<string, unknown>,
): void {
  response.write(`event: ${String(event.type)}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function scriptedResponseEvents(
  model: string,
  outputText: string,
  streamId?: string,
): readonly Record<string, unknown>[] {
  const responseId = `resp_${randomUUID().replaceAll("-", "")}`;
  const messageId = `msg_${randomUUID().replaceAll("-", "")}`;
  let sequence = 0;
  const next = <T extends Record<string, unknown>>(event: T): T & { sequence_number: number } => ({
    ...event,
    ...(streamId === undefined ? {} : { stream_id: streamId }),
    sequence_number: sequence++,
  });
  const message = {
    id: messageId,
    type: "message",
    status: "in_progress",
    role: "assistant",
    content: [],
  };
  const completedMessage = {
    ...message,
    status: "completed",
    content: [{ type: "output_text", text: outputText, annotations: [], logprobs: [] }],
  };
  const emptyPart = { type: "output_text", text: "", annotations: [], logprobs: [] };
  const completedPart = { type: "output_text", text: outputText, annotations: [], logprobs: [] };

  return Object.freeze([
    next({
      type: "response.created",
      response: responseEnvelope(responseId, messageId, model, outputText, "in_progress"),
    }),
    next({
      type: "response.in_progress",
      response: responseEnvelope(responseId, messageId, model, outputText, "in_progress"),
    }),
    next({
      type: "response.output_item.added",
      response_id: responseId,
      output_index: 0,
      item: message,
    }),
    next({
      type: "response.content_part.added",
      response_id: responseId,
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      part: emptyPart,
    }),
    next({
      type: "response.output_text.delta",
      response_id: responseId,
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      delta: outputText,
      logprobs: [],
      obfuscation: "",
    }),
    next({
      type: "response.output_text.done",
      response_id: responseId,
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      text: outputText,
      logprobs: [],
    }),
    next({
      type: "response.content_part.done",
      response_id: responseId,
      item_id: messageId,
      output_index: 0,
      content_index: 0,
      part: completedPart,
    }),
    next({
      type: "response.output_item.done",
      response_id: responseId,
      output_index: 0,
      item: completedMessage,
    }),
    next({
      type: "response.completed",
      response: responseEnvelope(responseId, messageId, model, outputText, "completed"),
    }),
  ]);
}

function streamScriptedResponse(
  response: ServerResponse,
  model: string,
  outputText: string,
): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Content-Type-Options": "nosniff",
  });
  for (const event of scriptedResponseEvents(model, outputText)) writeEvent(response, event);
  response.end();
}

function parseWebSocketJson(data: RawData): Record<string, unknown> {
  const buffer = Array.isArray(data)
    ? Buffer.concat(data)
    : data instanceof ArrayBuffer
      ? Buffer.from(data)
      : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (buffer.byteLength > MAX_REQUEST_BYTES) throw new Error("scripted_provider_request_too_large");
  let value: unknown;
  try {
    value = JSON.parse(buffer.toString("utf8")) as unknown;
  } catch {
    throw new Error("scripted_provider_request_invalid");
  }
  if (!record(value)) throw new Error("scripted_provider_request_invalid");
  return value;
}

function sendWebSocketError(socket: WebSocket, message: string, streamId?: string): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({
    type: "error",
    ...(streamId === undefined ? {} : { stream_id: streamId }),
    error: { type: "invalid_request_error", code: "scripted_provider_error", message },
  }));
}

function scriptedModelCatalog(): Record<string, unknown> {
  return {
    models: [{
      slug: "gpt-4.1",
      display_name: "Pointable scripted gpt-4.1",
      description: "Loopback-only frozen study response model",
      default_reasoning_level: null,
      supported_reasoning_levels: [],
      shell_type: "shell_command",
      visibility: "list",
      supported_in_api: true,
      priority: 1,
      availability_nux: null,
      upgrade: null,
      base_instructions: "Return the frozen scripted response supplied by the study provider.",
      support_verbosity: false,
      default_verbosity: null,
      apply_patch_tool_type: null,
      truncation_policy: { mode: "bytes", limit: 10_000 },
      supports_parallel_tool_calls: false,
      context_window: 32_768,
      max_context_window: 32_768,
      experimental_supported_tools: [],
      input_modalities: ["text"],
    }],
  };
}

export async function startScriptedResponsesProvider(
  untrustedSteps: readonly ScriptedResponseStep[],
): Promise<ScriptedResponsesProviderHandle> {
  if (untrustedSteps.length < 1 || untrustedSteps.length > MAX_SCRIPT_STEPS) {
    throw new RangeError(`script steps must contain from 1 to ${MAX_SCRIPT_STEPS} items`);
  }
  const steps = Object.freeze(untrustedSteps.map((step, index) => Object.freeze({
    outputText: boundedOutput(step.outputText, index),
  })));
  const requests: ScriptedResponsesProviderRequest[] = [];
  let cursor = 0;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/v1/models") {
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(JSON.stringify(scriptedModelCatalog()));
        return;
      }
      if (request.method !== "POST" || url.pathname !== "/v1/responses") {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "scripted endpoint not found" } }));
        return;
      }
      const body = await readJson(request);
      const model = typeof body.model === "string" ? body.model : "pointable-scripted";
      if (body.stream !== true) throw new Error("scripted_provider_requires_streaming");
      const step = steps[cursor];
      if (step === undefined) {
        response.writeHead(409, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "scripted response queue exhausted" } }));
        return;
      }
      cursor += 1;
      requests.push(Object.freeze({ ordinal: cursor, model, stream: true, transport: "http_sse" }));
      streamScriptedResponse(response, model, step.outputText);
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        error: { message: error instanceof Error ? error.message : "scripted provider error" },
      }));
    }
  });
  const webSockets = new WebSocketServer({ noServer: true, maxPayload: MAX_REQUEST_BYTES });
  server.on("upgrade", (request, socket, head) => {
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://127.0.0.1");
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== "/v1/responses") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSockets.emit("connection", webSocket, request);
    });
  });
  webSockets.on("connection", (socket) => {
    socket.on("message", (raw) => {
      let streamId: string | undefined;
      try {
        const body = parseWebSocketJson(raw);
        streamId = typeof body.stream_id === "string" ? body.stream_id : undefined;
        if (body.type !== "response.create") throw new Error("scripted_provider_requires_response_create");
        if (streamId !== undefined && !/^[A-Za-z0-9_.-]{1,256}$/u.test(streamId)) {
          throw new Error("scripted_provider_stream_id_invalid");
        }
        if (body.generate === false) throw new Error("scripted_provider_warmup_unsupported");
        const model = typeof body.model === "string" ? body.model : "pointable-scripted";
        const step = steps[cursor];
        if (step === undefined) throw new Error("scripted response queue exhausted");
        cursor += 1;
        requests.push(Object.freeze({
          ordinal: cursor,
          model,
          stream: true,
          transport: "websocket",
        }));
        for (const event of scriptedResponseEvents(model, step.outputText, streamId)) {
          if (socket.readyState !== WebSocket.OPEN) break;
          socket.send(JSON.stringify(event));
        }
      } catch (error) {
        sendWebSocketError(
          socket,
          error instanceof Error ? error.message : "scripted provider error",
          streamId,
        );
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("scripted_provider_address_invalid");
  }
  let stopped = false;
  return Object.freeze({
    origin: `http://127.0.0.1:${address.port}`,
    get requests() {
      return Object.freeze([...requests]);
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      for (const socket of webSockets.clients) socket.close(1001, "scripted provider stopping");
      webSockets.close();
      server.close();
      await Promise.all([once(server, "close"), once(webSockets, "close")]);
    },
  });
}

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { once } from "node:events";
import type { PointableConversationService } from "./conversation-service.js";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_ASSET_BYTES = 512 * 1024;

interface Assets {
  html: Buffer;
  css: Buffer;
  js: Buffer;
}

export interface ConversationHttpServerOptions {
  service: PointableConversationService;
  host?: "127.0.0.1";
  port?: number;
  assetsRoot?: string;
  deleteThreadOnStop?: boolean;
}

export interface ConversationHttpServerHandle {
  origin: string;
  url: string;
  token: string;
  stop(): Promise<void>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function boundedAsset(path: string): Promise<Buffer> {
  const value = await readFile(path);
  if (value.length < 1 || value.length > MAX_ASSET_BYTES) {
    throw new Error(`conversation asset is outside its byte budget: ${path}`);
  }
  return value;
}

async function loadAssets(root?: string): Promise<Assets> {
  const assetsRoot = root ?? fileURLToPath(new URL("../../../web/", import.meta.url));
  const [html, css, js] = await Promise.all([
    boundedAsset(join(assetsRoot, "conversation-client.html")),
    boundedAsset(join(assetsRoot, "conversation-client.css")),
    boundedAsset(join(assetsRoot, "conversation-client.js")),
  ]);
  return { html, css, js };
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  securityHeaders(response);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(value)}\n`);
}

function sendAsset(response: ServerResponse, type: string, value: Buffer): void {
  securityHeaders(response);
  response.statusCode = 200;
  response.setHeader("Content-Type", type);
  response.setHeader("Content-Length", String(value.length));
  response.end(value);
}

function errorCode(error: unknown): string {
  if (error instanceof Error && /^[a-z0-9_:-]{1,128}$/u.test(error.message)) return error.message;
  if (error instanceof RangeError) return "request_out_of_range";
  if (error instanceof TypeError) return "request_invalid";
  return "operation_failed";
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const type = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (type !== "application/json") throw new TypeError("content_type_invalid");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > MAX_BODY_BYTES) throw new RangeError("request_body_too_large");
    chunks.push(value);
  }
  if (size < 2) throw new TypeError("request_body_invalid");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new TypeError("request_body_invalid");
  }
  if (!record(parsed)) throw new TypeError("request_body_invalid");
  return parsed;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string")) return false;
  return Object.keys(value).every((key) => allowed.includes(key));
}

function authorized(request: IncomingMessage, token: string, origin: string): boolean {
  const supplied = request.headers["x-pointable-token"];
  if (supplied !== token) return false;
  const requestOrigin = request.headers.origin;
  return requestOrigin === undefined || requestOrigin === origin;
}

function sse(response: ServerResponse, event: string, value: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
}

export async function startConversationHttpServer(
  options: ConversationHttpServerOptions,
): Promise<ConversationHttpServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError("port must be an integer from 0 to 65535");
  }
  const assets = await loadAssets(options.assetsRoot);
  const token = randomBytes(32).toString("base64url");
  let origin = "";
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", origin || `http://${host}`);
      if (request.method === "GET" && url.pathname === "/") {
        sendAsset(response, "text/html; charset=utf-8", assets.html);
        return;
      }
      if (request.method === "GET" && url.pathname === "/conversation-client.css") {
        sendAsset(response, "text/css; charset=utf-8", assets.css);
        return;
      }
      if (request.method === "GET" && url.pathname === "/conversation-client.js") {
        sendAsset(response, "text/javascript; charset=utf-8", assets.js);
        return;
      }
      if (request.method === "GET" && url.pathname === "/favicon.ico") {
        securityHeaders(response);
        response.statusCode = 204;
        response.end();
        return;
      }
      if (!url.pathname.startsWith("/api/") || !authorized(request, token, origin)) {
        sendJson(response, 404, { error: "not_found" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        sendJson(response, 200, options.service.state());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/lookup") {
        const body = await readJson(request);
        if (!exactKeys(body, ["text", "surface", "generation", "candidateRef"])) {
          throw new TypeError("request_fields_invalid");
        }
        const controller = new AbortController();
        request.once("aborted", () => controller.abort());
        const result = await options.service.lookup({
          text: body.text,
          surface: body.surface,
          generation: body.generation,
          signal: controller.signal,
          ...(body.candidateRef === undefined ? {} : { candidateRef: body.candidateRef }),
        });
        sendJson(response, 200, result);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/reference") {
        const body = await readJson(request);
        if (!exactKeys(body, ["detailRef"]) || body.detailRef === undefined) {
          throw new TypeError("request_fields_invalid");
        }
        sendJson(response, 200, { referent: await options.service.reference(body.detailRef) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/turn") {
        const body = await readJson(request);
        if (!exactKeys(body, ["text"]) || body.text === undefined) {
          throw new TypeError("request_fields_invalid");
        }
        securityHeaders(response);
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        response.setHeader("Connection", "keep-alive");
        response.flushHeaders();
        const controller = new AbortController();
        response.once("close", () => {
          if (!response.writableEnded) controller.abort();
        });
        try {
          const message = await options.service.sendMessage(body.text, (delta) => {
            sse(response, "delta", { delta });
          }, controller.signal);
          sse(response, "done", { message, state: options.service.state() });
        } catch (error) {
          sse(response, "error", { error: errorCode(error) });
        }
        response.end();
        return;
      }
      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      sendJson(response, 400, { error: errorCode(error) });
    }
  });
  server.maxHeadersCount = 64;
  server.requestTimeout = 190_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.listen(port, host);
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("conversation_server_address_invalid");
  }
  origin = `http://${host}:${address.port}`;
  let stopped = false;
  return Object.freeze({
    origin,
    url: `${origin}/#token=${encodeURIComponent(token)}`,
    token,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error === undefined ? resolveClose() : rejectClose(error));
        server.closeIdleConnections();
      });
      if (options.deleteThreadOnStop === true) await options.service.deleteThread();
    },
  });
}

#!/usr/bin/env node
import { CodexAppServerClient } from "../dist/src/app-server/client.js";
import { startConversationHttpServer } from "../dist/src/app-server/conversation-http.js";
import { PointableConversationService } from "../dist/src/app-server/conversation-service.js";

const client = await CodexAppServerClient.launch({ cwd: process.cwd(), requestTimeoutMs: 30_000 });
let server;
let threadId;
try {
  const initialized = await client.initialize();
  const service = await PointableConversationService.start({
    rpc: client,
    workspaceRoot: process.cwd(),
    serviceName: "pointable_context_conversation_probe",
  });
  threadId = service.threadId;
  server = await startConversationHttpServer({
    service,
    deleteThreadOnStop: true,
  });
  const headers = {
    "X-Pointable-Token": server.token,
    "Content-Type": "application/json",
  };
  const lookupResponse = await fetch(`${server.origin}/api/lookup`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      text: "README.md",
      surface: "assistant_message",
      generation: 1,
    }),
  });
  const lookup = await lookupResponse.json();
  if (!lookupResponse.ok || lookup.kind !== "detail") {
    throw new Error(`lookup_failed:${JSON.stringify(lookup)}`);
  }
  const referenceResponse = await fetch(`${server.origin}/api/reference`, {
    method: "POST",
    headers,
    body: JSON.stringify({ detailRef: lookup.detail.detailRef }),
  });
  const reference = await referenceResponse.json();
  if (!referenceResponse.ok || !reference.referent) {
    throw new Error(`reference_failed:${JSON.stringify(reference)}`);
  }
  const afterReference = await client.request("thread/read", {
    threadId,
    includeTurns: true,
  });
  const turnsAfterReference = afterReference?.thread?.turns;
  if (!Array.isArray(turnsAfterReference) || turnsAfterReference.length !== 0) {
    throw new Error("reference_created_a_turn");
  }
  const expected = `${lookup.detail.entityId}|${lookup.detail.revision}`;
  const turnResponse = await fetch(`${server.origin}/api/turn`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      text: "只输出最近引用对象的稳定 entity ID 与 revision，用 | 连接，不要添加其他文字。",
    }),
  });
  const stream = await turnResponse.text();
  if (!turnResponse.ok) throw new Error(`turn_failed:${stream}`);
  const events = stream
    .split("\n\n")
    .map((block) => {
      const event = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
      const data = block.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
      return event && data ? { event, value: JSON.parse(data) } : undefined;
    })
    .filter(Boolean);
  const done = events.find((event) => event.event === "done");
  if (!done) throw new Error("turn_completion_missing");
  const actual = done.value.message.text.trim();
  const matched = actual === expected;
  if (!matched) throw new Error(`model_referent_mismatch:${actual}`);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    codexUserAgent: initialized?.userAgent ?? null,
    threadId,
    lookupEntityId: lookup.detail.entityId,
    lookupRevision: lookup.detail.revision,
    turnsAfterReference,
    referenceCreatedTurn: false,
    streamedDeltaEvents: events.filter((event) => event.event === "delta").length,
    expected,
    actual,
    matched,
    deletedAfterProbe: true,
  }, null, 2)}\n`);
} finally {
  if (server) {
    await server.stop().catch(async () => {
      if (threadId) await client.request("thread/delete", { threadId }).catch(() => undefined);
    });
  } else if (threadId) {
    await client.request("thread/delete", { threadId }).catch(() => undefined);
  }
  await client.close();
}

import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { startScriptedResponsesProvider } from "../src/evaluation/study-v2/scripted-responses-provider.js";

test("scripted Responses provider emits one bounded SSE completion per queued step", async () => {
  const provider = await startScriptedResponsesProvider([
    { outputText: "预制回复一" },
    { outputText: "预制回复二" },
  ]);
  try {
    const first = await fetch(`${provider.origin}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "pointable-scripted",
        stream: true,
        input: [{ role: "user", content: "raw prompt must not be retained" }],
      }),
    });
    assert.equal(first.status, 200);
    assert.match(first.headers.get("content-type") ?? "", /text\/event-stream/u);
    const stream = await first.text();
    assert.match(stream, /response\.created/u);
    assert.match(stream, /response\.output_text\.delta/u);
    assert.match(stream, /预制回复一/u);
    assert.match(stream, /response\.completed/u);
    assert.deepEqual(provider.requests, [{
      ordinal: 1,
      model: "pointable-scripted",
      stream: true,
      transport: "http_sse",
    }]);
    assert.doesNotMatch(JSON.stringify(provider.requests), /raw prompt/u);

    const second = await fetch(`${provider.origin}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "pointable-scripted", stream: true, input: [] }),
    });
    assert.equal(second.status, 200);
    assert.match(await second.text(), /预制回复二/u);

    const exhausted = await fetch(`${provider.origin}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "pointable-scripted", stream: true, input: [] }),
    });
    assert.equal(exhausted.status, 409);
  } finally {
    await provider.stop();
  }
});

test("scripted Responses provider supports the native Codex WebSocket transport", async () => {
  const provider = await startScriptedResponsesProvider([{ outputText: "原生受控回复" }]);
  const socket = new WebSocket(`${provider.origin.replace(/^http/u, "ws")}/v1/responses`);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const received: Record<string, unknown>[] = [];
    const completed = new Promise<void>((resolve, reject) => {
      socket.on("message", (raw) => {
        try {
          const event = JSON.parse(raw.toString()) as Record<string, unknown>;
          received.push(event);
          if (event.type === "response.completed") resolve();
        } catch (error) {
          reject(error);
        }
      });
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({
      type: "response.create",
      stream_id: "native-probe",
      model: "gpt-4.1",
      input: [{ role: "user", content: "must not be retained" }],
    }));
    await completed;
    assert.equal(received[0]?.type, "response.created");
    assert.ok(received.every((event) => event.stream_id === "native-probe"));
    assert.match(JSON.stringify(received), /原生受控回复/u);
    assert.deepEqual(provider.requests, [{
      ordinal: 1,
      model: "gpt-4.1",
      stream: true,
      transport: "websocket",
    }]);
    assert.doesNotMatch(JSON.stringify(provider.requests), /must not be retained/u);
  } finally {
    socket.close();
    await provider.stop();
  }
});

test("scripted Responses provider rejects unsupported surfaces and invalid scripts", async () => {
  await assert.rejects(() => startScriptedResponsesProvider([]), /script steps/u);
  const provider = await startScriptedResponsesProvider([{ outputText: "ok" }]);
  try {
    const response = await fetch(`${provider.origin}/v1/models`);
    assert.equal(response.status, 200);
    const catalog = await response.json() as { models?: Array<{ slug?: string; base_instructions?: string }> };
    assert.equal(catalog.models?.[0]?.slug, "gpt-4.1");
    assert.ok((catalog.models?.[0]?.base_instructions?.length ?? 0) > 0);
    const unsupported = await fetch(`${provider.origin}/v1/unsupported`);
    assert.equal(unsupported.status, 404);
    assert.deepEqual(provider.requests, []);
  } finally {
    await provider.stop();
  }
});

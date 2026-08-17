import assert from "node:assert/strict";
import test from "node:test";
import {
  CdpTransportError,
  connectCdpWebSocket,
} from "../src/host/codex-cdp/transport.js";

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static latest: FakeWebSocket | undefined;
  static failNextConnection = false;

  readonly url: string;
  readonly sent: string[] = [];
  readyState = FakeWebSocket.CONNECTING;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeWebSocket.latest = this;
    queueMicrotask(() => {
      if (FakeWebSocket.failNextConnection) {
        FakeWebSocket.failNextConnection = false;
        this.dispatchEvent(new Event("error"));
        return;
      }
      this.readyState = FakeWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(_code?: number, _reason?: string): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  emitMessage(value: unknown): void {
    this.emitRaw(JSON.stringify(value));
  }

  emitRaw(data: string): void {
    const event = new Event("message") as Event & { data: string };
    Object.defineProperty(event, "data", { value: data });
    this.dispatchEvent(event);
  }
}

test("transport rejects remote sockets and pre-aborted connection attempts", async () => {
  await assert.rejects(
    connectCdpWebSocket("ws://192.168.1.20:9223/devtools/page/main-1"),
    (error: unknown) =>
      error instanceof CdpTransportError &&
      error.code === "cdp_websocket_not_loopback",
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    connectCdpWebSocket(
      "ws://127.0.0.1:9223/devtools/page/main-1",
      controller.signal,
    ),
    (error: unknown) =>
      error instanceof CdpTransportError && error.code === "cdp_connect_aborted",
  );
});

test("transport correlates CDP commands, emits events, and closes pending work", async () => {
  const original = globalThis.WebSocket;
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: FakeWebSocket as unknown as typeof WebSocket,
  });
  try {
    const connection = await connectCdpWebSocket(
      "ws://127.0.0.1:9223/devtools/page/main-1",
    );
    const socket = FakeWebSocket.latest;
    assert.ok(socket);

    const command = connection.send("Runtime.enable", {}, 1_000);
    assert.equal(socket.sent.length, 1);
    const sent = JSON.parse(socket.sent[0] ?? "null") as {
      id: number;
      method: string;
    };
    assert.equal(sent.method, "Runtime.enable");
    socket.emitMessage({ id: sent.id, result: { enabled: true } });
    assert.deepEqual(await command, { enabled: true });

    const eventReceived = new Promise<CdpEventSnapshot>((resolve) => {
      connection.onEvent((event) => {
        resolve({ method: event.method, name: event.params?.name });
      });
    });
    socket.emitMessage({
      method: "Runtime.bindingCalled",
      params: { name: "__pointableContextBinding_test" },
    });
    assert.deepEqual(await eventReceived, {
      method: "Runtime.bindingCalled",
      name: "__pointableContextBinding_test",
    });

    const pending = connection.send("Runtime.evaluate", {}, 1_000);
    connection.close();
    await assert.rejects(
      pending,
      (error: unknown) =>
        error instanceof CdpTransportError && error.code === "cdp_closed",
    );
    assert.equal(connection.isClosed(), true);

    const inbound = await connectCdpWebSocket(
      "ws://127.0.0.1:9223/devtools/page/main-2",
    );
    const inboundSocket = FakeWebSocket.latest;
    assert.ok(inboundSocket);
    const inboundPending = inbound.send("Runtime.enable", {}, 1_000);
    inboundSocket.emitRaw("x".repeat(1_048_577));
    await assert.rejects(
      inboundPending,
      (error: unknown) =>
        error instanceof CdpTransportError &&
        error.code === "cdp_message_too_large",
    );
    assert.equal(inbound.isClosed(), true);

    const outbound = await connectCdpWebSocket(
      "ws://127.0.0.1:9223/devtools/page/main-3",
    );
    await assert.rejects(
      outbound.send("Runtime.evaluate", {
        expression: "x".repeat(1_048_577),
      }),
      (error: unknown) =>
        error instanceof CdpTransportError &&
        error.code === "cdp_message_too_large",
    );
    assert.equal(outbound.isClosed(), true);

    FakeWebSocket.failNextConnection = true;
    await assert.rejects(
      connectCdpWebSocket("ws://127.0.0.1:9223/devtools/page/main-4"),
      (error: unknown) =>
        error instanceof CdpTransportError && error.code === "cdp_connect_failed",
    );
    assert.equal(FakeWebSocket.latest?.readyState, FakeWebSocket.CLOSED);
  } finally {
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: original,
    });
  }
});

interface CdpEventSnapshot {
  method: string;
  name: unknown;
}

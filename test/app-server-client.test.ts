import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexAppServerClient } from "../src/app-server/client.js";

test("stdio client initializes, correlates requests, and receives notifications", async () => {
  const root = await mkdtemp(join(tmpdir(), "pointable-app-client-"));
  const server = join(root, "fake-server.mjs");
  await writeFile(server, `
    import { createInterface } from "node:readline";
    const lines = createInterface({ input: process.stdin });
    lines.on("line", (line) => {
      const message = JSON.parse(line);
      if (message.method === "initialize") {
        process.stdout.write(JSON.stringify({ id: message.id, result: { userAgent: "fake" } }) + "\\n");
      } else if (message.method === "echo") {
        process.stdout.write(JSON.stringify({ id: message.id, result: message.params }) + "\\n");
        process.stdout.write(JSON.stringify({ method: "probe/ready", params: { ok: true } }) + "\\n");
      }
    });
  `, "utf8");
  const client = await CodexAppServerClient.launch({
    cwd: root,
    command: process.execPath,
    args: [server],
    requestTimeoutMs: 2_000,
  });
  try {
    assert.deepEqual(await client.initialize(), { userAgent: "fake" });
    const notification = client.waitForNotification<{ ok: boolean }>("probe/ready");
    assert.deepEqual(await client.request("echo", { value: 7 }), { value: 7 });
    assert.deepEqual(await notification, { ok: true });
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

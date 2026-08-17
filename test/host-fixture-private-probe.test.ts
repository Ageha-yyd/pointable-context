import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { fixtureProjectScope } from "../src/adapters/json-files.js";
import {
  createFixturePrivateProbe,
  startFixturePrivateProbe,
  type FixturePrivateProbeOptions,
} from "../src/host/codex-cdp/fixture-private-probe.js";

const fixtureRoot = resolve("fixtures/mini-project");

function fixtureOptions(): FixturePrivateProbeOptions {
  return {
    workspaceRoot: fixtureRoot,
    manifestPath: resolve(fixtureRoot, "project-context.json"),
    indexPath: resolve(fixtureRoot, "index.json"),
    detailsPath: resolve(fixtureRoot, "details.json"),
    explicitScope: fixtureProjectScope("PRJ-01"),
  };
}

function emptyTargetResponse(): Response {
  const response = new Response("[]", {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  Object.defineProperty(response, "url", {
    value: "http://127.0.0.1:9223/json/list",
  });
  return response;
}

test("creating a fixture private probe is inert", () => {
  let fetchCalls = 0;
  let connectCalls = 0;
  const probe = createFixturePrivateProbe({
    ...fixtureOptions(),
    fetch: async () => {
      fetchCalls += 1;
      return emptyTargetResponse();
    },
    connect: async () => {
      connectCalls += 1;
      throw new Error("inert probe must not connect");
    },
  });

  assert.equal(probe.status().state, "idle");
  assert.equal(fetchCalls, 0);
  assert.equal(connectCalls, 0);
});

test("explicit private start entry delegates discovery without default wiring", async () => {
  let fetchCalls = 0;
  let connectCalls = 0;
  const probe = await startFixturePrivateProbe({
    ...fixtureOptions(),
    fetch: async () => {
      fetchCalls += 1;
      return emptyTargetResponse();
    },
    connect: async () => {
      connectCalls += 1;
      throw new Error("empty target discovery must not connect");
    },
  });

  assert.equal(probe.status().state, "running");
  assert.equal(probe.status().targetCount, 0);
  assert.equal(fetchCalls, 1);
  assert.equal(connectCalls, 0);
  const stopped = await probe.stop();
  assert.equal(stopped.state, "stopped");
});

test("private start entry cleans up before propagating discovery failure", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    startFixturePrivateProbe({
      ...fixtureOptions(),
      fetch: async () => {
        fetchCalls += 1;
        throw new Error("fixture discovery failed");
      },
    }),
    /Codex target list is unavailable/u,
  );
  assert.equal(fetchCalls, 1);
});

import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { fixtureProjectScope } from "../src/adapters/json-files.js";
import {
  createFixtureCompanion,
  type FixtureCompanionOptions,
} from "../src/host/codex-cdp/fixture-companion.js";

const fixtureRoot = resolve("fixtures/mini-project");

function options(): FixtureCompanionOptions {
  return {
    workspaceRoot: fixtureRoot,
    manifestPath: resolve(fixtureRoot, "project-context.json"),
    indexPath: resolve(fixtureRoot, "index.json"),
    detailsPath: resolve(fixtureRoot, "details.json"),
    explicitScope: fixtureProjectScope("PRJ-01"),
    refreshIntervalMs: 100,
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

test("fixture companion is inert until start and then refreshes targets", async () => {
  let fetchCalls = 0;
  const companion = createFixtureCompanion({
    ...options(),
    fetch: async () => {
      fetchCalls += 1;
      return emptyTargetResponse();
    },
  });

  assert.equal(companion.status().state, "idle");
  assert.equal(fetchCalls, 0);
  const started = await companion.start();
  assert.equal(started.state, "running");
  assert.equal(started.fixtureOnly, true);
  assert.equal(started.refreshCount, 1);
  assert.equal(fetchCalls, 1);

  await delay(240);
  const refreshed = companion.status();
  assert.ok(refreshed.refreshCount >= 3);
  assert.ok(fetchCalls >= 3);

  const stopped = await companion.stop();
  const callsAtStop = fetchCalls;
  assert.equal(stopped.state, "stopped");
  await delay(150);
  assert.equal(fetchCalls, callsAtStop);
});

test("temporary discovery failure stays visible and a later refresh recovers", async () => {
  let fetchCalls = 0;
  const companion = createFixtureCompanion({
    ...options(),
    fetch: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) throw new Error("temporary CDP outage");
      return emptyTargetResponse();
    },
  });

  const started = await companion.start();
  assert.match(started.lastError ?? "", /Codex target list is unavailable/u);
  await delay(140);
  const recovered = companion.status();
  assert.equal(recovered.lastError, undefined);
  assert.ok(recovered.refreshCount >= 2);
  await companion.stop();
});

test("fixture companion validates its refresh cadence", () => {
  assert.throws(
    () => createFixtureCompanion({ ...options(), refreshIntervalMs: 99 }),
    /refreshIntervalMs/u,
  );
  assert.throws(
    () => createFixtureCompanion({ ...options(), refreshIntervalMs: 60_001 }),
    /refreshIntervalMs/u,
  );
});

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createWorkspaceLookupCallback } from "../dist/src/host/codex-cdp/workspace-lookup.js";
import { CodexTaskWorkspaceBindingRegistry } from "../dist/src/host/codex-cdp/task-workspace-binding.js";
import { validatePointableLookupPresentation } from "../dist/src/host/codex-cdp/protocol.js";

const requestedRuns = Number(process.env.POINTABLE_BENCH_RUNS ?? "20");
if (!Number.isSafeInteger(requestedRuns) || requestedRuns < 5 || requestedRuns > 100) {
  throw new Error("POINTABLE_BENCH_RUNS must be an integer from 5 to 100");
}

function task() {
  const routeRef = "app://-/index.html";
  const threadId = "benchmark-thread";
  const hostId = "benchmark-host";
  return {
    schemaVersion: 1,
    host: "codex-desktop",
    threadId,
    hostId,
    routeRef,
    contextFingerprint: JSON.stringify({ href: routeRef, threadId, hostId }),
  };
}

function request(activeTask, text, generation, overrides = {}) {
  return {
    operation: "resolve",
    requestId: `benchmark-${generation}`,
    selection: {
      text,
      digest: createHash("sha256").update(text, "utf8").digest("hex"),
      generation,
      surface: "assistant_message",
    },
    contextFingerprint: activeTask.contextFingerprint,
    requestedAt: new Date().toISOString(),
    host: {
      targetId: "benchmark-target",
      targetUrl: "app://-/index.html",
      bindingGeneration: "benchmark-binding",
      task: activeTask,
      revalidateTask: async () => activeTask,
    },
    signal: new AbortController().signal,
    ...overrides,
  };
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function summary(values) {
  return {
    runs: values.length,
    medianMs: Number(percentile(values, 0.5).toFixed(2)),
    p95Ms: Number(percentile(values, 0.95).toFixed(2)),
    minMs: Number(Math.min(...values).toFixed(2)),
    maxMs: Number(Math.max(...values).toFixed(2)),
  };
}

async function invoke(callback, value) {
  const started = performance.now();
  const presentation = validatePointableLookupPresentation(await callback(value));
  return { presentation, elapsedMs: performance.now() - started };
}

const root = await mkdtemp(join(tmpdir(), "pointable-benchmark-"));
try {
  const workspace = join(root, "workspace");
  await mkdir(join(workspace, "docs", "adr"), { recursive: true });
  await mkdir(join(workspace, "src"));
  await mkdir(join(workspace, "test"));
  await writeFile(join(workspace, "README.md"), "# Benchmark\nExplains the benchmark workspace.\n", "utf8");
  await writeFile(join(workspace, "src", "cache.ts"), "/** Maintains a bounded cache. */\nexport const cacheSize = 3;\n", "utf8");
  await writeFile(join(workspace, "test", "cache.test.ts"), 'test("evicts the oldest entry", () => {});\n', "utf8");
  await writeFile(join(workspace, "package.json"), JSON.stringify({ name: "benchmark", private: true, scripts: { test: "node --test" } }), "utf8");
  await writeFile(join(workspace, "docs", "adr", "ADR-001-refresh.md"), "# ADR-001\n## Status\nAccepted\n## Decision\nRefresh only after a trusted action.\n", "utf8");

  const registry = new CodexTaskWorkspaceBindingRegistry(join(root, "bindings.json"));
  const activeTask = task();
  await registry.bind(activeTask, workspace);
  const callback = createWorkspaceLookupCallback({ registry });
  const scenarios = [
    ["document", "README.md"],
    ["module", "src/cache.ts"],
    ["verification_source", "test/cache.test.ts"],
    ["configuration", "package.json"],
    ["decision", "docs/adr/ADR-001-refresh.md"],
  ];
  const results = {};
  let generation = 1;
  for (const [name, selectedText] of scenarios) {
    const values = [];
    for (let run = 0; run < requestedRuns; run += 1) {
      const result = await invoke(callback, request(activeTask, selectedText, generation));
      generation += 1;
      if (result.presentation.kind !== "detail") {
        throw new Error(`${name} did not resolve to detail`);
      }
      values.push(result.elapsedMs);
    }
    results[name] = summary(values);
  }

  const selectedText = "README.md";
  const initialRequest = request(activeTask, selectedText, generation);
  generation += 1;
  const initial = await invoke(callback, initialRequest);
  if (initial.presentation.kind !== "detail" || initial.presentation.detail.detailRef === undefined) {
    throw new Error("revision benchmark did not receive a detail reference");
  }
  const detailRef = initial.presentation.detail.detailRef;
  const checkValues = [];
  for (let run = 0; run < requestedRuns; run += 1) {
    const checked = await invoke(callback, request(activeTask, selectedText, initialRequest.selection.generation, {
      operation: "check",
      detailRef,
      requestId: `benchmark-check-${run}`,
      selection: initialRequest.selection,
    }));
    if (checked.presentation.kind !== "revision" || checked.presentation.revision.state !== "unchanged") {
      throw new Error("unchanged revision benchmark failed");
    }
    checkValues.push(checked.elapsedMs);
  }
  results.revision_check_unchanged = summary(checkValues);

  await writeFile(join(workspace, "README.md"), "# Benchmark\nUpdated benchmark workspace context.\n", "utf8");
  const changed = await invoke(callback, request(activeTask, selectedText, initialRequest.selection.generation, {
    operation: "check",
    detailRef,
    requestId: "benchmark-check-updated",
    selection: initialRequest.selection,
  }));
  if (changed.presentation.kind !== "revision" || changed.presentation.revision.state !== "updated") {
    throw new Error("updated revision benchmark failed");
  }
  const refreshed = await invoke(callback, request(activeTask, selectedText, initialRequest.selection.generation, {
    operation: "refresh",
    detailRef,
    requestId: "benchmark-refresh",
    selection: initialRequest.selection,
  }));
  if (refreshed.presentation.kind !== "detail") throw new Error("refresh benchmark failed");

  const exactDetailMedians = Object.entries(results)
    .filter(([name]) => name !== "revision_check_unchanged")
    .map(([, value]) => value.medianMs);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "technical_latency_only",
    machineTime: new Date().toISOString(),
    runsPerExactScenario: requestedRuns,
    target: { exactDetailMedianMs: 500 },
    targetMet: exactDetailMedians.every((value) => value < 500),
    results,
    changedRevisionCheckMs: Number(changed.elapsedMs.toFixed(2)),
    explicitRefreshMs: Number(refreshed.elapsedMs.toFixed(2)),
    refreshDiffCount: refreshed.presentation.detail.changes?.length ?? 0,
    modelCalls: 0,
    chatTurnsCreated: 0,
    caveat: "This is component latency, not human time_to_verified_fact.",
  }, null, 2)}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}

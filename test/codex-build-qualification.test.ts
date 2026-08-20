import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  auditCodexBuildQualification,
  CODEX_MANUAL_COMPATIBILITY_CHECKS,
} from "../src/compatibility/codex-build-qualification.js";

async function fixture(results: "pending" | "pass" | "fail" = "pending") {
  const root = await mkdtemp(join(tmpdir(), "pointable-compat-"));
  await mkdir(join(root, "docs", "compatibility"), { recursive: true });
  await mkdir(join(root, "docs", "evidence"), { recursive: true });
  await mkdir(join(root, "host"), { recursive: true });
  const bundle = Buffer.from("renderer-bundle");
  await writeFile(join(root, "host", "workspace-companion.mjs"), bundle);
  const evidence = CODEX_MANUAL_COMPATIBILITY_CHECKS.map((id) => `${id}=accepted`).join("\n");
  await writeFile(join(root, "docs", "evidence", "manual.txt"), `${evidence}\n`);
  const record = {
    schemaVersion: 1,
    contract: "private-codex-chat-lane-v1",
    host: {
      packageName: "OpenAI.Codex",
      packageVersion: "26.810.7004.0",
      executableVersion: "151.0.7922.137",
      architecture: "x64",
      capturedAt: "2026-08-20T01:00:00+08:00",
    },
    implementation: {
      productVersion: "v2.10",
      rendererBundleSha256: createHash("sha256").update(bundle).digest("hex"),
    },
    automatic: {
      checkedAt: "2026-08-19T17:00:00.000Z",
      state: "qualified",
      code: "qualified_current_runtime",
      gates: {
        exactMainTarget: "pass",
        mainFrame: "pass",
        mainExecutionContext: "pass",
        rendererLifecycle: "pass",
      },
    },
    manualChecks: CODEX_MANUAL_COMPATIBILITY_CHECKS.map((id, index) => results === "pending"
      ? { id, result: "pending" }
      : {
          id,
          result: results,
          observedAt: "2026-08-20T01:01:00+08:00",
          evidenceSource: `docs/evidence/manual.txt:${index + 1}`,
          evidenceExcerpt: `${id}=accepted`,
        }),
  };
  await writeFile(
    join(root, "docs", "compatibility", "codex-desktop-current.json"),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return { root, record };
}

test("automatic qualification remains separate from pending manual interaction gates", async () => {
  const { root } = await fixture();
  const result = await auditCodexBuildQualification(root, {
    rendererBundlePath: "host/workspace-companion.mjs",
    expectedHostPackageVersion: "26.810.7004.0",
  });
  assert.equal(result.valid, true);
  assert.equal(result.automaticQualified, true);
  assert.equal(result.qualification, "manual_pending");
  assert.deepEqual(result.manual, { passed: 0, failed: 0, pending: 10, total: 10 });
});

test("one exact build is qualified only after every evidenced manual gate passes", async () => {
  const { root } = await fixture("pass");
  const result = await auditCodexBuildQualification(root, {
    rendererBundlePath: "host/workspace-companion.mjs",
    expectedHostPackageVersion: "26.810.7004.0",
  });
  assert.equal(result.qualification, "qualified");
  assert.equal(result.manual.passed, 10);
  assert.equal(result.issues.length, 0);
});

test("host version, renderer digest, failed checks, and evidence drift fail closed", async () => {
  const { root } = await fixture("fail");
  await writeFile(join(root, "host", "workspace-companion.mjs"), "changed");
  const result = await auditCodexBuildQualification(root, {
    rendererBundlePath: "host/workspace-companion.mjs",
    expectedHostPackageVersion: "different-build",
  });
  assert.equal(result.qualification, "environment_mismatch");
  assert.ok(result.issues.some((issue) => issue.code === "host_build_mismatch"));
  assert.ok(result.issues.some((issue) => issue.code === "bundle_digest_mismatch"));
  assert.ok(result.issues.some((issue) => issue.code === "manual_failed"));
});

test("malformed or extra compatibility claims are rejected", async () => {
  const { root, record } = await fixture();
  const invalid = { ...record, extra: true };
  await writeFile(
    join(root, "docs", "compatibility", "codex-desktop-current.json"),
    `${JSON.stringify(invalid)}\n`,
  );
  const result = await auditCodexBuildQualification(root);
  assert.equal(result.valid, false);
  assert.equal(result.qualification, "invalid");
  assert.equal(result.issues[0]?.code, "record_invalid");
});

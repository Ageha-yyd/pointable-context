import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { checkContextRecords } from "../src/records/context-record-check.js";
import {
  parseTestExecutionRequest,
  runTestExecution,
  TestExecutionError,
} from "../src/records/test-execution.js";

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pointable-test-execution-"));
  await mkdir(join(root, "docs", "verifications"), { recursive: true });
  await writeFile(join(root, "tracked.txt"), "baseline\n", "utf8");
  git(root, "init");
  git(root, "config", "user.name", "Pointable Test");
  git(root, "config", "user.email", "pointable@example.invalid");
  git(root, "add", ".");
  git(root, "commit", "-m", "baseline");
  return root;
}

function request(
  verificationId: string,
  script: string,
  timeoutMs = 5_000,
) {
  return {
    schemaVersion: 1,
    verificationId,
    title: verificationId.split("-").map((part) =>
      `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" "),
    claim: "受限 runner 会实际执行声明命令并绑定进程终态。",
    gap: "不证明真人效率或原生 UI 兼容性。",
    command: {
      file: process.execPath,
      args: ["-e", script],
    },
    timeoutMs,
  } as const;
}

test("test execution request is strict and shell-free", () => {
  const parsed = parseTestExecutionRequest(request("runner-contract", "process.exit(0)"));
  assert.equal(parsed.command.file, process.execPath);
  assert.throws(
    () => parseTestExecutionRequest({ ...request("runner-contract", "process.exit(0)"), extra: true }),
    (error: unknown) => error instanceof TestExecutionError && error.code === "request_invalid",
  );
  assert.throws(
    () => parseTestExecutionRequest({
      ...request("Runner Contract", "process.exit(0)"),
      verificationId: "Runner Contract",
    }),
    /verificationId is invalid/u,
  );
  assert.throws(
    () => parseTestExecutionRequest({
      ...request("runner-contract", "process.exit(0)"),
      command: { file: "node\nmalicious", args: [] },
    }),
    /command.file is invalid/u,
  );
});

test("successful execution atomically creates a revision-bound Verification record", async () => {
  const root = await workspace();
  const stateRoot = join(root, "..", `state-${Date.now()}`);
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  try {
    const result = await runTestExecution(
      root,
      request(
        "runner-success",
        "process.stdout.write('private stdout'); process.stderr.write('private stderr')",
      ),
      {
        stateRoot,
        runId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        writeStdout: (chunk) => stdout.push(chunk),
        writeStderr: (chunk) => stderr.push(chunk),
      },
    );
    assert.equal(result.event.outcome, "passed");
    assert.equal(result.event.exitCode, 0);
    assert.equal(result.event.revisionDrift, false);
    assert.equal(result.recordValid, true);
    assert.equal(Buffer.concat(stdout).toString("utf8"), "private stdout");
    assert.equal(Buffer.concat(stderr).toString("utf8"), "private stderr");
    const verification = await readFile(join(root, result.verificationPath), "utf8");
    const evidence = await readFile(join(root, result.evidencePath), "utf8");
    assert.match(verification, /PASS。受限 runner 实际启动声明命令/u);
    assert.match(verification, /git:[a-f0-9]{40}\+status:[a-f0-9]{64}/u);
    assert.doesNotMatch(verification, /private stdout|private stderr/u);
    assert.match(evidence, /outcome=passed; exit=0/u);
    assert.doesNotMatch(evidence, /private stdout|private stderr/u);
    const privateEvent = await readFile(result.privateEventPath, "utf8");
    assert.doesNotMatch(privateEvent, /private stdout|private stderr/u);
    const check = await checkContextRecords(root);
    assert.equal(check.valid, true, JSON.stringify(check.issues));
    assert.ok(check.records.some((record) => record.path === result.verificationPath));

    await assert.rejects(
      runTestExecution(root, request("runner-success", "process.exit(99)"), { stateRoot }),
      (error: unknown) =>
        error instanceof TestExecutionError && error.code === "verification_already_exists",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("failed and revision-drifting commands remain explicit observed outcomes", async () => {
  const failedRoot = await workspace();
  const driftRoot = await workspace();
  const stateRoot = join(tmpdir(), `pointable-test-execution-state-${Date.now()}`);
  try {
    const failed = await runTestExecution(
      failedRoot,
      request("runner-failure", "process.exit(7)"),
      { stateRoot },
    );
    assert.equal(failed.event.outcome, "failed");
    assert.equal(failed.event.exitCode, 7);
    assert.match(
      await readFile(join(failedRoot, failed.verificationPath), "utf8"),
      /FAIL。受限 runner 实际启动声明命令，进程以 exit 7 结束/u,
    );

    const drift = await runTestExecution(
      driftRoot,
      request(
        "runner-drift",
        "require('node:fs').writeFileSync('tracked.txt', 'changed\\n')",
      ),
      { stateRoot },
    );
    assert.equal(drift.event.outcome, "passed");
    assert.equal(drift.event.revisionDrift, true);
    assert.match(
      await readFile(join(driftRoot, drift.verificationPath), "utf8"),
      /inconclusive。命令执行期间工作区修订发生漂移/u,
    );
  } finally {
    await rm(failedRoot, { recursive: true, force: true });
    await rm(driftRoot, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("workspace output directories cannot escape through a symbolic link", async () => {
  const root = await workspace();
  const outside = await mkdtemp(join(tmpdir(), "pointable-test-execution-outside-"));
  const stateRoot = join(tmpdir(), `pointable-test-execution-state-${Date.now()}`);
  try {
    await mkdir(join(root, "docs", "evidence"), { recursive: true });
    await symlink(
      outside,
      join(root, "docs", "evidence", "test-executions"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      runTestExecution(root, request("runner-escape", "process.exit(0)"), { stateRoot }),
      (error: unknown) =>
        error instanceof TestExecutionError && error.code === "workspace_output_unavailable",
    );
    await assert.rejects(readFile(join(outside, "runner-escape.txt"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("timeout and output overflow are retained as inconclusive rather than PASS", async () => {
  const timeoutRoot = await workspace();
  const overflowRoot = await workspace();
  const stateRoot = join(tmpdir(), `pointable-test-execution-state-${Date.now()}`);
  try {
    const timedOut = await runTestExecution(
      timeoutRoot,
      request("runner-timeout", "setTimeout(() => undefined, 30_000)", 100),
      { stateRoot },
    );
    assert.equal(timedOut.event.outcome, "timed_out");
    assert.equal(timedOut.event.timedOut, true);
    assert.match(
      await readFile(join(timeoutRoot, timedOut.verificationPath), "utf8"),
      /inconclusive。受限 runner 观察到 timed_out/u,
    );

    const overflow = await runTestExecution(
      overflowRoot,
      request("runner-overflow", "process.stdout.write('x'.repeat(4096))"),
      { stateRoot, maxOutputBytes: 1_024 },
    );
    assert.equal(overflow.event.outcome, "output_limit_exceeded");
    assert.ok(overflow.event.stdoutBytes > 1_024);
    assert.match(
      await readFile(join(overflowRoot, overflow.verificationPath), "utf8"),
      /inconclusive。受限 runner 观察到 output_limit_exceeded/u,
    );
  } finally {
    await rm(timeoutRoot, { recursive: true, force: true });
    await rm(overflowRoot, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("CLI keeps child output off JSON stdout and reports the generated record", async () => {
  const root = await workspace();
  const requestPath = join(tmpdir(), `pointable-test-execution-${Date.now()}.json`);
  try {
    await writeFile(
      requestPath,
      JSON.stringify(request("runner-cli", "process.stdout.write('child output')")),
      "utf8",
    );
    const result = spawnSync(process.execPath, [
      resolve("dist/src/records/test-execution-cli.js"),
      "--workspace-root",
      root,
      "--request-file",
      requestPath,
      "--json",
    ], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout) as {
      ok?: boolean;
      event?: { outcome?: string };
      verificationPath?: string;
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.event?.outcome, "passed");
    assert.equal(parsed.verificationPath, "docs/verifications/runner-cli.md");
    assert.match(result.stderr, /child output/u);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(requestPath, { force: true });
  }
});

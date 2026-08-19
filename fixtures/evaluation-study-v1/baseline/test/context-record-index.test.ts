import assert from "node:assert/strict";
import test from "node:test";
import { indexContextRecordPaths } from "../src/context-record-index.js";

test("rejects duplicate normalized identities", () => {
  const records = indexContextRecordPaths(["docs/tasks/Release.md", "docs/tasks/release.md"]);
  assert.equal(new Set(records.map((record) => record.id)).size, 1);
});

test("keeps Task and Verification types distinct", () => {
  const records = indexContextRecordPaths([
    "docs/tasks/release.md",
    "docs/verifications/release.md",
  ]);
  assert.deepEqual(records.map((record) => record.type), ["task", "verification"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { IdentityRecord } from "../src/contracts.js";
import { resolveSelection } from "../src/resolver.js";
import {
  CONTEXT_INDEX_LIMITS,
  validateContextIndexForRuntime,
} from "../src/validation.js";
import { identity, PROJECT_SCOPE } from "./helpers.js";

function identities(
  count: number,
  aliasesFor: (index: number) => string[] = () => [],
  summaryFor: (index: number) => string = (index) => `summary ${index}`,
): IdentityRecord[] {
  return Array.from({ length: count }, (_, index) =>
    identity(`WU:BUDGET-${index}`, `BUDGET-${index}`, {
      aliases: aliasesFor(index),
      summary: summaryFor(index),
    }),
  );
}

test("context index accepts the exact record-count boundary", () => {
  const records = identities(CONTEXT_INDEX_LIMITS.records);
  const validated = validateContextIndexForRuntime(
    records,
    PROJECT_SCOPE,
    "no matching term",
  );
  assert.equal(validated.length, CONTEXT_INDEX_LIMITS.records);
});

test("hostile 10k index fails on cardinality before touching a record", () => {
  let propertyReads = 0;
  const poison = new Proxy(
    {},
    {
      get() {
        propertyReads += 1;
        throw new Error("record must not be read");
      },
    },
  );
  const records = Array(10_000).fill(poison);

  assert.throws(
    () => validateContextIndexForRuntime(records, PROJECT_SCOPE, "anything"),
    /aggregate record bound/u,
  );
  assert.equal(propertyReads, 0);
});

test("aggregate alias budget accepts its boundary and rejects the next alias", () => {
  const atBoundary = identities(41, (index) =>
    Array(index < 40 ? 100 : 96).fill(`alias-${index}`),
  );
  assert.equal(
    atBoundary.reduce((total, record) => total + record.aliases.length, 0),
    CONTEXT_INDEX_LIMITS.aliases,
  );
  assert.equal(
    validateContextIndexForRuntime(atBoundary, PROJECT_SCOPE).length,
    atBoundary.length,
  );

  const overBoundary = [
    ...atBoundary,
    identity("WU:BUDGET-OVER", "BUDGET-OVER", { aliases: ["one-too-many"] }),
  ];
  assert.throws(
    () => validateContextIndexForRuntime(overBoundary, PROJECT_SCOPE),
    /aggregate alias bound/u,
  );
});

test("aggregate UTF-8 budget rejects many individually valid records", () => {
  const records = identities(520, () => [], () => "界".repeat(1_300));
  assert.throws(
    () => validateContextIndexForRuntime(records, PROJECT_SCOPE),
    /aggregate UTF-8 bound/u,
  );
});

test("actual selection work is rejected before dynamic resolver matching", () => {
  const records = identities(
    CONTEXT_INDEX_LIMITS.records,
    (index) => [`alias-${index}`],
  );
  const maximumSelection = "z".repeat(512);

  assert.throws(
    () =>
      validateContextIndexForRuntime(
        records,
        PROJECT_SCOPE,
        maximumSelection,
      ),
    /resolution work bound/u,
  );
  assert.throws(
    () => resolveSelection(PROJECT_SCOPE, maximumSelection, records),
    /resolution work bound/u,
  );
});

test("direct resolver rejects overlong input before scanning records", () => {
  assert.throws(
    () => resolveSelection(PROJECT_SCOPE, "x".repeat(513), identities(1)),
    /resolver input bound/u,
  );
});

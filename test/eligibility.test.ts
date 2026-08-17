import assert from "node:assert/strict";
import test from "node:test";
import { evaluateEligibility } from "../src/eligibility.js";

test("eligible selection is trimmed and remains purely local", () => {
  const result = evaluateEligibility({
    text: "  GOV-1  ",
    surface: "assistant_message",
    selectionGeneration: 4,
  });
  assert.deepEqual(result, {
    kind: "eligible",
    selection: {
      text: "GOV-1",
      surface: "assistant_message",
      selectionGeneration: 4,
    },
  });
});

test("user message text is eligible", () => {
  assert.equal(
    evaluateEligibility({
      text: "ARCH-7",
      surface: "user_message",
      selectionGeneration: 0,
    }).kind,
    "eligible",
  );
});

for (const surface of [
  "composer",
  "navigation",
  "terminal",
  "diff",
  "browser",
  "iframe",
  "detached",
] as const) {
  test(`surface ${surface} is ineligible`, () => {
    assert.deepEqual(
      evaluateEligibility({ text: "GOV-1", surface, selectionGeneration: 1 }),
      { kind: "ineligible", reason: "unsupported_surface" },
    );
  });
}

test("empty, oversized, and invalid-generation selections fail closed", () => {
  assert.equal(
    evaluateEligibility({
      text: "   ",
      surface: "assistant_message",
      selectionGeneration: 1,
    }).kind,
    "ineligible",
  );
  assert.deepEqual(
    evaluateEligibility({
      text: "x".repeat(513),
      surface: "assistant_message",
      selectionGeneration: 1,
    }),
    { kind: "ineligible", reason: "selection_too_long" },
  );
  assert.deepEqual(
    evaluateEligibility({
      text: "GOV-1",
      surface: "assistant_message",
      selectionGeneration: -1,
    }),
    { kind: "ineligible", reason: "invalid_generation" },
  );
});

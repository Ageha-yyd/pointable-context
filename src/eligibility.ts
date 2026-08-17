import type {
  EligibilityResult,
  SelectionInput,
  SourceSurface,
} from "./contracts.js";

const ALLOWED_SURFACES = new Set<SourceSurface>([
  "assistant_message",
  "user_message",
]);

export const DEFAULT_MAX_SELECTION_CHARS = 512;

/**
 * Pure, pre-click eligibility. This function has no project, network, model,
 * provider, or telemetry dependency by construction.
 */
export function evaluateEligibility(
  input: SelectionInput,
  maxChars = DEFAULT_MAX_SELECTION_CHARS,
): EligibilityResult {
  if (!ALLOWED_SURFACES.has(input.surface)) {
    return { kind: "ineligible", reason: "unsupported_surface" };
  }

  if (!Number.isSafeInteger(input.selectionGeneration) || input.selectionGeneration < 0) {
    return { kind: "ineligible", reason: "invalid_generation" };
  }

  const text = input.text.trim();
  if (text.length === 0) {
    return { kind: "ineligible", reason: "empty_selection" };
  }

  if (text.length > maxChars) {
    return { kind: "ineligible", reason: "selection_too_long" };
  }

  return {
    kind: "eligible",
    selection: {
      text,
      surface: input.surface,
      selectionGeneration: input.selectionGeneration,
    },
  };
}

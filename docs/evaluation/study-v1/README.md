# Pointable Context study pack v1

Status: frozen materials, not yet run. This directory is a facilitator pack, not evidence that Pointable Context improves efficiency.

## Studies

1. Presentation pilot: 12 anonymous slots, four each for P-A/P-B/P-C. Every participant sees only `pilot` in one fixed presentation condition and answers four comprehension units.
2. Efficiency pilot: 12 anonymous slots. Every participant receives all six scenarios in a cyclic Latin-square order; the second six slots repeat the order with the A/B phase inverted. A is ordinary linear Chat, B adds Quiet Context Reveal.

Condition labels and the answer key remain hidden from participants. The prepared workspace includes the participant-facing `pilot` artifact and study boundaries, but never the facilitator answer key. Both efficiency conditions use the same frozen transcript and a fresh workspace produced from the same fixture. A participant must never receive the same task in both conditions.

## Prepare one efficiency workspace

Choose a new or empty destination outside the product repository:

```powershell
node scripts/prepare-evaluation-workspace.mjs prepare --destination 'D:\absolute\study-workspace'
```

The command copies the baseline, creates one local Git commit, then applies the frozen active README change. For `REV-1`, open the initial detail first and then run:

```powershell
node scripts/prepare-evaluation-workspace.mjs mutate --workspace-root 'D:\absolute\study-workspace'
```

Never reuse a participant workspace. Do not run either command against a real project.

## Assignment and timing

Use the bundled assignment command with a slot from 1 through 12. Do not choose a condition after observing participant performance.

Start timing only when the question and frozen transcript are both visible. Stop only when the participant submits a final answer. A card click is not completion. At 300,000 ms, mark the task timed out and retain the row. Record no-match, stale, wrong-entity and aborted trials instead of discarding them.

Condition A may use ordinary Codex Chat and normal navigation. Condition B may additionally use the native selection-triggered card. Do not coach either path and do not expose expected card fields.

## Privacy and interpretation

Use an anonymous study slot, not a name or email. Do not log raw selected text, file contents, configuration values, or ordinary Chat content. Free-text notes must describe study-flow defects, not copy participant content.

The 8–12 person run is non-inferential. It can reveal confusing wording, broken flow, floor/ceiling effects and variance. It cannot support a “significant improvement” claim. Formal sample size and analysis are decided only after this pilot is closed without changing its frozen answer key.

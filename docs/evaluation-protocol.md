# Pointable Context evaluation protocol

Status: pre-study protocol, 2026-08-18. This document defines measurement; it does not claim a proven efficiency improvement.

## 1. Separate the two questions

Pointable Context must pass two different gates:

1. **Technical latency:** after a trusted action, how long do deterministic resolution, Provider read, revision check, and same-card refresh take? This can be benchmarked without a model or participant.
2. **Human outcome:** how long does a person need to confirm the correct fact, with what accuracy, how many new Chat Turns, and how often do they leave the Chat Lane? Only a controlled participant task can answer this.

Fast component code is not evidence that users understand the project faster. The automated benchmark must therefore report `technical_latency_only` and must never be presented as `time_to_verified_fact`.

## 2. Hypothesis

For bounded fact lookup in a long, information-dense software-development task, selection-triggered Quiet Context Reveal will reduce median `time_to_verified_fact` and `chat_turns_to_fact` relative to a linear-Chat-only condition, without reducing answer accuracy or increasing wrong-entity selection.

This hypothesis does not cover open-ended explanation, synthesis, design judgment, multi-object comparison, or editing.

## 3. Conditions

- **A — linear Chat:** the participant sees the same task transcript and project state, but no Pointable Context affordance. They may ask Codex or navigate using the ordinary product.
- **B — Quiet Context Reveal:** the same transcript and project state additionally support deterministic selection → action → summary-first card. The card contains no facts unavailable to condition A's project/model context.

Use a within-subject, counterbalanced order. Randomize scenario order and assign A/B with a Latin-square schedule so practice and fatigue do not systematically favor one condition.

### 3.1 Presentation pilot before the efficiency study

Before comparing Quiet Context Reveal with linear Chat, run a smaller presentation-only pilot. Its purpose is to find comprehension and study-flow defects, not to claim an efficiency effect.

All three pilot conditions use the same native Chat Lane trigger, the same selected object, the same authoritative facts, the same source excerpt, and zero added Chat Turns. Only the card projection changes:

- **P-A — record:** one conventional summary plus collapsed facts and metadata;
- **P-B — narrative:** a human-oriented explanation that combines meaning with the reason the object matters now;
- **P-C — micro mental model:** meaning, current context, a short process with the current step highlighted, a visible boundary, and a collapsed `为什么这样说` evidence disclosure.

Counterbalance P-A/P-B/P-C. Do not let a participant switch conditions within one task. The first frozen object is `pilot`, backed by `docs/concepts/pilot.md` and the verified evidence line in this protocol.

The participant must answer, in their own words:

1. What is a pilot?
2. Why is it required at the current project stage?
3. What can it not prove?
4. What happens immediately before and after it?

End timing only after the answer is submitted. Score the four answer units separately. Record evidence opening and evidence correctness, but do not require the evidence disclosure for the first three answers. Use [presentation-pilot-log.template.csv](presentation-pilot-log.template.csv); do not record raw selected text or unrelated Chat content.

A pilot of roughly 8–12 participants can expose unclear wording, wrong visual priority, hidden evidence, overflow, or task-instruction defects and provide a variance estimate. It cannot establish significance or replace the later linear-Chat efficiency comparison.

## 4. Scenarios and correct-answer units

| Scenario | Question answered | Correct-answer unit | Product boundary |
|---|---|---|---|
| Changed document | What changed and what is the document for? | purpose + changed section/current Git state | literal references are not semantic impact |
| Source module | What is this module responsible for and who imports/tests it? | responsibility + bounded callers/tests | not a runtime call graph |
| Test source | What behavior does this file define? | detected static test title(s) + `not executed` | must not answer PASS/FAIL |
| JSON configuration | What configuration boundary is this? | purpose + expected top-level key name(s) | values and secrets stay hidden |
| ADR | What decision was accepted and why? | explicit Decision + Context/Consequence | path-qualified explicit sections only |
| Revision drift | Did the open detail change, and what changed? | updated notice + one correct finite diff | no silent snapshot replacement |

Each task must have a frozen answer key derived from the same repository revision used in both conditions. Score fact units, not clicks or card opens.

## 5. Primary and secondary measures

Primary:

- `time_to_verified_fact_ms`: task shown → participant submits the correct fact answer;
- `answer_accuracy`: correct fact units / required fact units.

Secondary:

- `chat_turns_to_fact`;
- `lane_leave` (left current Chat Lane before answer);
- `wrong_entity_opened`;
- `card_sufficient` (participant answered without opening full content or asking Chat);
- `selection_interference` during a separate copy/highlight control task;
- subjective confidence and workload, collected only after the answer.

The system may record timings and interaction counts only in an explicit, local study session. Do not log raw selected text, file contents, configuration values, or ordinary non-study use.

## 6. Event boundaries

- Start time: the task question and relevant transcript are both visible.
- End time: the participant submits a final answer, not when they click a card.
- Chat Turn: one new user message submitted to Codex after task start.
- Lane leave: focus or navigation moves to a file, browser, terminal, Dashboard, or another task for the purpose of answering.
- Wrong entity: any opened card/file does not match the answer-key identity.

Record aborted and timed-out tasks. Do not silently discard errors, stale results, or no-match trials.

## 7. Analysis rules

- Report median and p90 time by condition and scenario; show paired participant differences.
- Report accuracy, wrong-entity, stale/error, and selection-interference rates beside time.
- The directional product target is at least 30% lower median exact-lookup time with no material accuracy loss. Treat this as a target, not a statistical conclusion.
- Define the formal sample size only after a non-inferential usability pilot estimates variance. A pilot of roughly 8–12 participants may find workflow defects but must not be used to claim significance.
- Separate exact point lookup from open-ended explanation in every chart and conclusion.

## 8. Automated technical benchmark

Run:

```powershell
pnpm run benchmark:workspace
```

The benchmark creates an isolated temporary workspace, measures document/module/test/config/ADR exact detail, measures unchanged revision probes, then changes one file and measures update detection plus explicit refresh. It invokes no model and creates no Chat Turn. Its JSON output includes the explicit caveat that the result is component latency only.

The PRD target for local exact detail is median below 500 ms on the qualified machine. A result above that threshold is a technical performance warning, not a user-study result.

The first recorded qualified-machine snapshot is [evaluation-baseline-2026-08-18.json](evaluation-baseline-2026-08-18.json). Its five exact-detail medians ranged from 3.22 ms to 40.71 ms, unchanged revision check median was 1.74 ms, and explicit refresh took 43.47 ms. These values passed the component target for that isolated workspace only; they do not establish a human-efficiency effect.

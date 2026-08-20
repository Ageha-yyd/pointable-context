# Pointable Context evaluation protocol

Status: native controlled-conversation runner integrated, 2026-08-20. Study pack v1 remains frozen and has not been run. Short-task presentation and efficiency pilots are not the current product gate. The default runner now creates fixed multi-turn exchanges as ordinary Codex Desktop messages, waits for the exact task, mounts a lightweight answer control, adds Quiet Context Reveal only in B, and connects terminal events to the existing checkpoint/result pipeline without a live model. Real A/B end-to-end validation, clean-machine deployment, and research governance remain incomplete. This document does not claim a proven efficiency improvement.

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

The transcript must be a sequence of ordinary Codex user/assistant Turns in both conditions. Do not render the history inside a full-page or side-panel simulation and do not use `thread/inject_items` as a presentation shortcut: injected items may enter model history without becoming visible Chat Lane Turns. The research runner may use a loopback scripted Responses provider so every participant receives the same Agent replies, but it must not call a live model or retain prompts.

### 3.1 Deferred presentation comparison

P-A/P-B/P-C were prepared as a smaller presentation-only comparison whose purpose is to find comprehension and study-flow defects, not to claim an efficiency effect. The product now adopts P-C as its default without making a causal claim, so this comparison is deferred rather than used as the next development gate.

All three pilot conditions use the same native Chat Lane trigger, the same selected object, the same authoritative facts, the same source excerpt, and zero added Chat Turns. Only the card projection changes:

- **P-A — record:** one conventional summary plus collapsed facts and metadata;
- **P-B — narrative:** a human-oriented explanation that combines meaning with the reason the object matters now;
- **P-C — micro mental model:** meaning, current context, a short process with the current step highlighted, a visible boundary, and a collapsed `为什么这样说` evidence disclosure.

Counterbalance P-A/P-B/P-C. Do not let a participant switch conditions within one task. The frozen v1 presentation pilot is between-subject: 12 anonymous slots assign four participants to each condition, and each participant sees `pilot` exactly once. The object is backed by `docs/concepts/pilot.md` and the verified evidence line in this protocol.

The participant must answer, in their own words:

1. What is a pilot?
2. Why is it required at the current project stage?
3. What can it not prove?
4. What happens immediately before and after it?

End timing only after the answer is submitted. Score the four answer units separately. Record evidence opening and evidence correctness, but do not require the evidence disclosure for the first three answers. Use the frozen [study-v1 presentation log](evaluation/study-v1/presentation-log.template.csv); do not record raw selected text or unrelated Chat content.

A pilot of roughly 8–12 participants can expose unclear wording, wrong visual priority, hidden evidence, overflow, or task-instruction defects and provide a variance estimate. It cannot establish significance or replace the later linear-Chat efficiency comparison.

### 3.2 Product-roadmap decision on 2026-08-20

- Use P-C (`mental-model`) as the only ordinary product presentation. Keep P-A/P-B as dormant research baselines.
- Do not recruit participants for the frozen short-task pack during the current implementation phase.
- Preserve study pack v1 and its digest as an audit artifact; do not reinterpret an unrun pack as evidence.
- Prioritize real long-running development tasks where working memory has decayed and project state has changed.
- If the product contract or research question changes, create and freeze a new study-pack version rather than editing or reusing v1 data rows.

### 3.3 Controlled native conversation architecture

Each measured scenario is authored as:

1. an isolated project snapshot;
2. a bounded sequence of fixed user prompts and fixed Agent replies that represent a realistic development history;
3. a current task question with a finite answer key;
4. the same deterministic Pointable Context objects used only in condition B;
5. a non-obscuring answer/exit control and a white-listed event recorder.

The runner creates a persistent Codex task through a dedicated App Server and sends each fixed exchange as a real `turn/start`. A private loopback custom model provider returns the next scripted Agent reply over bounded HTTP/SSE; WebSocket remains a tested compatibility transport but is disabled in the default isolated runner. The participant opens the exact generated task in Codex Desktop and reads/selects ordinary Chat Lane text. Timing begins only after that task is active. At terminal answer, exit, or timeout, the runner deletes only its generated task and stops its private provider/App Server.

The A/B difference is therefore interface access, not conversation content. Condition A loads no Pointable Context companion. Condition B loads the same qualified Quiet Context Reveal host against the same transcript and workspace. The experiment control must not cover the Chat Lane, imitate Agent messages, or supply extra facts. Pre-scripted history is excluded from `chat_turns_to_fact`; only participant-created user Turns after `trial_shown` count.

The current technical evidence establishes both the earlier two-exchange Desktop visibility probe and the v2.20 default-runner integration. A real App Server/custom-provider probe completed one persistent turn with one loopback request and exact task deletion; automated tests cover six-trial checkpoints, A/B condition isolation, exact-task activation, timeout cleanup, and the lightweight terminal path. The answer control passed a current-build formative walkthrough. None of this establishes end-to-end study readiness or a human-efficiency effect. The full-overlay native trial renderer is retained only for component qualification, training, and failure diagnosis.

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

### 4.1 Frozen study pack v1

The executable facilitator pack is [docs/evaluation/study-v1](evaluation/study-v1/README.md). It contains:

- a hidden exact-evidence answer key for the four presentation units and six efficiency scenarios;
- one frozen participant transcript;
- an isolated workspace fixture plus deterministic `prepare` and `mutate` commands;
- a 12-slot cyclic Latin-square assignment, repeated with the A/B phase inverted;
- local CSV schemas that bind every row to the validated `pack_digest` and omit raw selections, file content, configuration values, ordinary Chat content, names, and email addresses.

Generate the slot before observing performance. Each efficiency participant completes every scenario once, with three A and three B tasks. Across 12 slots, every scenario appears in each ordinal position twice and in each condition six times. Never reuse a participant workspace.

Before any session, run `pnpm run study:validate`. A non-zero result or changed pack digest blocks data collection until the materials are deliberately re-frozen as a new version. Validation proves internal integrity only; it does not make the pack usable or establish a product effect.

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
- Pre-scripted Turn: a frozen user/assistant exchange created before `trial_shown`; it is part of the controlled stimulus and never counts as participant Chat effort.
- Lane leave: focus or navigation moves to a file, browser, terminal, Dashboard, or another task for the purpose of answering.
- Wrong entity: any opened card/file does not match the answer-key identity.

Record aborted and timed-out tasks. Do not silently discard errors, stale results, or no-match trials.

## 7. Analysis rules

- Report median and p90 time by condition and scenario; show paired participant differences.
- Report accuracy, wrong-entity, stale/error, and selection-interference rates beside time.
- The directional product target is at least 30% lower median exact-lookup time with no material accuracy loss. Treat this as a target, not a statistical conclusion.
- Define the formal sample size only after a non-inferential usability pilot estimates variance. A pilot of roughly 8–12 participants may find workflow defects but must not be used to claim significance.

One formative owner walkthrough on 2026-08-19 preferred P-C and judged P-A and P-B similarly. A 2026-08-20 roadmap decision therefore fixed `mental-model` as the product default and deferred the three-way comparison. This is not a usability result or an efficiency effect. Keep P-A and P-B only as dormant study baselines.

- Separate exact point lookup from open-ended explanation in every chart and conclusion.

## 8. Automated technical benchmark

Run:

```powershell
pnpm run benchmark:workspace
```

The benchmark creates an isolated temporary Git workspace, measures document/module/test/config/ADR exact detail, measures unchanged revision v2 probes (file stat + selected-file Git state/commit + bounded literal-relation membership), then changes one file and measures update detection plus explicit refresh. It invokes no model and creates no Chat Turn. Its JSON output identifies `workspace-context-v2` and includes the explicit caveat that the result is component latency only.

The PRD target for local exact detail is median below 500 ms on the qualified machine. A result above that threshold is a technical performance warning, not a user-study result.

The first recorded qualified-machine snapshot is [evaluation-baseline-2026-08-18.json](evaluation-baseline-2026-08-18.json). It predates revision v2 and used a non-Git temporary workspace, so its 1.74 ms unchanged revision figure must not be used as a Git-v2 latency claim. The first Git-v2 snapshot is [evaluation-baseline-2026-08-19-revision-v2.json](evaluation-baseline-2026-08-19-revision-v2.json): unchanged revision median/p95 were 81.23/94.55 ms, changed detection was 93.47 ms, and explicit refresh was 195.99 ms. All component values remain machine-local and do not establish a human-efficiency effect.

## 9. Long-horizon validation when product coverage is ready

The eventual efficiency study should target the product's actual problem rather than immediate recall in a short scripted task. Candidate tasks should include:

1. delayed return to a task after at least one intervening work session;
2. resuming a project after files, modules, decisions, tasks, and verification state have changed;
3. handing an Agent-developed task to a person who did not observe every preceding Chat Turn;
4. locating a concept introduced earlier but needed for a current decision;
5. detecting that a previously opened object is stale, updated, deleted, or no longer authoritative.

The primary measure becomes `time_to_reconstruct_actionable_context`: from the resumption/handoff question becoming visible until the participant submits the correct current interpretation or next action. Continue to record fact accuracy, Chat Turns, lane leaves, wrong entities, stale decisions, card sufficiency, and workload. Add `delay_since_last_exposure`, `intervening_changes`, `handoff_role`, and `context_reconstruction_units`, but never log ordinary Chat content or raw project files.

Do not start this study until object coverage, revision semantics, Codex Desktop compatibility, and the opt-in record-production policy are stable enough that missing infrastructure is not mistaken for a presentation failure.

A 24–72 hour interruption is useful for ecological validity but is not mandatory for every first-phase trial. A single dense scripted Agent run can already test reconstruction after information accumulation, provided the participant must recover current state rather than recall the immediately preceding sentence. Use both strata later: `dense_same_session` for lower-cost controlled iteration and `delayed_return` for the stronger long-horizon claim; analyze them separately.

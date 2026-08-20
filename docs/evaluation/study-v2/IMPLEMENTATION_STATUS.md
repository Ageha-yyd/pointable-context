# Study v2 implementation status

Status: native controlled-conversation runner integrated; participant data collection is not enabled.

## Implemented and verified

- Six frozen development scenarios plus one unscored training scenario.
- A fixed 12-slot schedule with three A and three B trials per participant.
- No-live-model trial contract and scripted-follow-up accounting.
- Isolated Git workspace preparation for one assigned scenario at a time.
- Strict, bounded event, trial, questionnaire, environment, and integrity schemas.
- Automatic task-time, navigation, reveal, refresh, abandonment, and scripted-follow-up event fields.
- Participant-visible result preview that excludes raw selections, Chat content, file content, names, emails, configuration values, and absolute paths.
- AES-256-GCM result encryption with RSA-OAEP-SHA256 key wrapping.
- A GitHub submission command that accepts only the encrypted envelope, requires a separate confirmation, and creates a pull request through the participant's existing GitHub CLI identity.
- A setup-only Codex Skill that validates the package, runs the qualified-host doctor, prepares only `TRAIN-1`, and stops at `STUDY READY`.
- A reproducible prototype release builder with a release manifest and file checksums.
- A deterministic legacy native-Codex trial renderer that loads frozen trial material, mounts an armed qualification surface, and records bounded monotonic interaction events without invoking a model. It is retained for component qualification, training, and diagnostics, not as the effectiveness-study surface.
- An exact-build preflight gate. A trial now fails before mounting when the installed Codex package has not completed the native compatibility qualification.
- A strict native-result pipeline. It normalizes six trial streams into one session sequence, derives correctness and objective timing/navigation/card metrics from trial-relative monotonic events, rejects forged terminal metadata or forbidden questionnaire fields, cross-checks CSV rows against events, and publishes only after staging-directory validation succeeds.
- A resumable six-trial session runner. Each completed run is stored as an append-only digest checkpoint bound to participant, slot, session, pack, runner, and exact Codex build. Restart resumes only a continuous validated prefix; after six trials the runner returns `awaiting_questionnaire`, and a separate five-rating finalization produces the result plus a completion receipt. Finalization fails before trial execution or questionnaire collection when any of the six checkpoints is missing.
- A native Codex Chat Lane questionnaire. It collects only the five bounded 1–7 ratings, enables submission only when every field is selected, sends no Chat message, invokes no model, accepts no free text, and can be deferred without publishing a partial result.
- A loopback scripted Responses provider with HTTP/SSE and WebSocket transports, plus a reusable task materializer that creates ordinary persistent Codex turns and deletes only its own task after a failed setup.
- Five-turn frozen development conversations for `TRAIN-1` and all six measured scenarios in both `zh-CN` and `en-US`. Language is selected before training, bound into the resumable session checkpoint and final result manifest, and cannot change within a session. Both languages share answer keys, object IDs, assignment, and scoring rules. Pack validation binds every localized conversation to its correct answer, correct object, complete entity references, and an exact selectable label or ID in assistant output.
- The default single-trial and six-trial runners now compose that materializer with a private loopback custom model provider, a dedicated App Server, exact generated-task activation, the lightweight answer control, condition-B Quiet Context Reveal, append-only checkpoints, and the existing result pipeline. Condition A never mounts the companion. Trial timing begins only after the exact generated task is active, and terminal cleanup deletes only that task and stops the private runtime.
- The first five completed measured tasks are deleted after checkpointing, while the sixth is migrated to a clean retained review task without the scripted provider override. That retained task is activated before the old runtime task is deleted, and submitting the questionnaire does not delete it. Task restoration after switching away and back is a release regression gate.

## Current native-interaction status

The first live A-condition dogfood exposed a failed manual gate: the trial surface was visible but did not respond. This was not accepted as a visual-only success. After the v2.14 renderer change, the exact `OpenAI.Codex 26.814.5517.0` / executable `151.0.7922.137` / renderer digest `d00e4620…2855` combination was requalified from scratch: all four automatic Host gates and all ten evidence-bound native interaction gates pass.

The qualified-host doctor is now ready on the current development machine, so the runner no longer fails with `codex_build_not_qualified` for this exact package and renderer. Any host-version, executable, renderer-digest, or evidence drift still fails closed; this result does not qualify another Codex build or a clean machine.

The v2.16 native questionnaire received bounded formative acceptance on this build: incomplete submission stayed disabled, all five ratings enabled submission, submit closed without a Chat turn, and “稍后完成” now collapses to a visible “继续填写研究问卷” affordance that restores the existing form state. This does not replace the ten card-interaction gates or a clean-machine rehearsal.

The prior full-overlay trial experience was rejected as too far from actual Agent development. A v2.18 technical probe therefore created two fixed user/assistant exchanges through ordinary `turn/start` calls and a loopback Responses WebSocket provider. Codex Desktop rendered all four messages in the native Chat Lane, each on its own selectable surface, with no live model call. A negative control showed that `thread/inject_items` can enter history without producing visible turns. The positive path is now the required study architecture; the old overlay cannot be used to claim ecological validity.

The v2.20 main runner no longer uses that overlay. Its isolated custom provider exposes the bounded local model catalog required by the current Codex runtime, disables authentication, WebSocket prewarming, plugins, and apps, and records no prompt content. A real App Server probe completed one persistent scripted turn with exactly one loopback provider request and then deleted the generated task. The lightweight answer control also passed a current-build formative walkthrough: it did not cover the primary Chat content, collapse preserved a visible entry, and selecting an answer after reopening cleaned the control. This is component/runtime evidence, not a completed A/B trial.

The repository TypeScript check, complete product regression suite, study pack validator, Skill validator, plugin validator, release build, and release-root doctor must all pass before a prototype is shared.

## Required before participant recruitment

1. Review and freeze the bilingual five-turn scripts as study content; implementation and pack consistency gates do not replace participant validation.
2. Repeat both A and B end to end against the qualified build; visible but inert cards, missing native turns, wrong task activation, or covered Chat content are failures.
3. Complete a clean Windows-machine rehearsal from the exact ZIP, including install, `TRAIN-1`, all six trials, preview, encryption, restart recovery, and uninstall.
4. Exercise the real GitHub fork, branch, push, and pull-request path with a test participant account.
5. Freeze organizer/release/governance parameters and obtain the applicable research/ethics approval before recruiting external participants.

No implementation or technical test in this repository establishes the product's human-efficiency claim. The primary future outcome remains time-to-correct-context under a controlled long-task reconstruction goal, with correctness, navigation, reveal use, scripted follow-up requests, and subjective workload as secondary measures.

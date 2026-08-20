# Study v2 data dictionary

## Primary outcomes

- `task_completion_ms`: trial shown until final answer submission.
- `success`: whether the submitted answer matches the frozen scoring contract.

## Secondary outcomes

- `time_to_first_correct_object_ms`: first opening of the answer-key object; null when never opened.
- `scripted_followup_requests`: frozen extra-explanation requests. This is not a model Chat Turn.
- `navigation_count` and `navigation_time_ms`: leaving the study Chat Lane to inspect the controlled workspace.
- `wrong_object_count`: opening an object outside the frozen answer-key identity.
- `card_open_count` and `card_dwell_ms`: bounded card interactions in condition B.
- `patch_attempt_count`: submissions before the accepted one-line endpoint.

## Workload and comprehension

The post-session questionnaire contains five integer ratings from 1 through 7: mental demand, effort, frustration, confidence, and information sufficiency. It contains no free text.

## Event log

Every event has a session-global sequence number, trial-relative monotonic time measured from that trial's `trial_shown`, assigned trial/scenario/condition, one event type, and optional bounded object/outcome codes. Monotonic time may restart at zero for the next trial; global sequence establishes cross-trial order. Unknown fields are invalid. Raw selected text, transcript content, file content, configuration values, free-form notes, names, emails, and absolute paths are never accepted.

The result writer derives timing and counts from these events. `task_completion_ms` is the terminal event time; object, navigation, and card measures come from balanced event pairs; timeout/abort uses `NO_ANSWER`. A CSV row that disagrees with its event stream is invalid. Researcher-entered stopwatch values are not accepted as the primary measure.

Crash recovery stores only the same bounded run envelope and event codes, plus participant code, slot, session ID, pack digest, runner version, Codex build, and cryptographic checkpoint digest. It does not add raw text or paths to the final result. A gap, modified checkpoint, or context mismatch fails closed.
The session manifest also records `language` as exactly `zh-CN` or `en-US`. It is a participant-selected presentation condition fixed before TRAIN-1; no free-form locale, translation text, or raw Chat is collected.

## Interpretation boundary

Condition A/B differences in this controlled no-model pack may support claims about retrieval time, navigation, wrong-object access, and scripted follow-up demand. They cannot directly establish reduction in real Agent Chat Turns.

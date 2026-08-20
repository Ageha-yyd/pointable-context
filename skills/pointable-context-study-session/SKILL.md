---
name: pointable-context-study-session
description: Coordinate an explicitly assigned Pointable Context formative-study session in native Codex tasks after setup is complete. Use only when the user explicitly asks to begin or resume the six-round formative session from an assigned friend pack. Mechanically keep the frozen runner alive and open each emitted threadId with native Codex task navigation. Never inspect sealed materials, answer a trial, call a live model inside a trial, change the assignment, or submit results.
---

# Pointable Context formative session coordinator

1. Work only in the participant's assigned friend-pack folder. Require `FORMATIVE-ASSIGNMENT.json`, `tools/formative-friend.mjs`, and the embedded `experiment` directory.
2. Read only the outer assignment metadata needed to confirm `formativeOnly: true`, `excludedFromFormalSample: true`, participant code, slot, language, release tag, and pack digest. Do not open scenario transcripts, entities, scoring contracts, answer keys, or facilitator material.
3. Require that setup and TRAIN-1 have already completed. This skill must not install, repair, or silently replace the experiment package.
4. Start `node tools/formative-friend.mjs run` from the friend-pack root in a long-lived terminal session. Do not use the double-click wrapper because its final `pause` is intended for humans.
5. While the process runs, handle only newline-delimited control messages whose state is `awaiting_native_task`:
   - keep the runner alive;
   - take the exact emitted `threadId`;
   - call the Codex Desktop native task-navigation tool for that task;
   - do not wait for, search, or click a sidebar row;
   - do not create, fork, rename, answer, or send a message to the task.
6. The participant independently reads the native scripted conversation and submits the in-task answer control. After each terminal event, poll the same runner session for the next control message and repeat.
7. A `purpose: retained_review` event is also opened by native task ID. It is the history-only retained copy of the final scripted task, not another trial.
8. Stop only when the runner reports that all six rounds and the questionnaire are complete, or when it returns a fixed technical error. Preserve checkpoints on failure so a later explicit request can resume.
9. Report completion or the exact fixed error only. Do not preview, encrypt, upload, or submit results; those require the participant's separate explicit confirmation.

This coordinator is a transport controller, not a study assistant. It may read only `threadId`, title, and purpose from runner control messages solely to navigate. Trial ID, scenario ID, and condition are intentionally not exposed in this handoff. It must not inspect task content through APIs, infer an answer, or reduce the participant's independent interaction.

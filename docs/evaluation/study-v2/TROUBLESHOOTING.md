# Study v2 environment troubleshooting

The setup path fails closed so that a visible but inert trial can never be mistaken for collected evidence. Start with `START-STUDY-SETUP.cmd`; it checks Node, reuses an already qualified loopback Host, launches Codex with the loopback-only endpoint when Codex is closed, and refuses to terminate a running Codex process.

| Symptom | Diagnosis | Safe action | Boundary |
|---|---|---|---|
| `codex_restart_required` | Codex is already running without the study endpoint. A second launch cannot repair the existing process. | Fully exit Codex and run `START-STUDY-SETUP.cmd` again. | The launcher never kills Codex or silently interrupts a task. |
| `codex_loopback_unavailable` | `127.0.0.1:9223` has no exact `app://-/index.html` target. | Relaunch through the one-click entry, then rerun `doctor`. | A visible page is not Host readiness. |
| `codex_build_not_qualified` | The installed package or renderer digest differs from the evidence-bound qualification record, or manual gates remain pending. | Stop and ask the organizer to qualify that exact combination. | Never copy a qualification from an older build. |
| Trial shell is visible but inert | The trial Host disconnected or the build/endpoint changed after mounting. | Abandon the trial, preserve no timing result, relaunch, and repeat qualification before another attempt. | Visual presence alone is a failed manual gate. |
| `study_pack_invalid` or checksum mismatch | The download is incomplete, modified, or not the organizer's frozen release. | Delete that copy and redownload the exact release. | Do not repair sealed materials locally. |
| `node_24_or_newer_required` | The runtime is missing or too old. | Install Node.js 24 or newer and rerun the one-click entry. | The launcher does not modify the system runtime. |
| Participant code or slot is missing | Setup lacks the organizer's pre-assignment. | Stop and request both values. | Never choose a slot after observing performance. |
| `study_v2_language_invalid` | The language is missing or is not exactly `zh-CN` or `en-US`. | Choose one supported language before TRAIN-1 and rerun setup. | Do not infer locale from the operating system. |
| `study_v2_checkpoint_context_mismatch` | Participant code, slot, language, pack, runner, or Codex build differs from the existing session checkpoint. | Stop and resume with the exact original values, or ask the organizer whether the session must be discarded. | Never edit a checkpoint to continue. |
| Final task shows recovery failure after questionnaire | The measured task was deleted or retained with an unsafe runtime override. | Stop collection and report the runner version; do not accept the result. | The qualified runner must migrate and activate a clean retained review task before deleting the runtime task. |
| Training destination is not new/empty or overlaps the package | Isolation would be unreliable. | Choose a new empty directory outside the downloaded package. | Never reuse another project or participant workspace. |
| `github_cli_unavailable_for_submission` | Automatic GitHub submission is unavailable. | Continue local practice; before submission install GitHub CLI or use the organizer's non-GitHub intake route. | This is not a local-practice failure. |
| Installed Skill path changed after an update | A cached, versioned plugin path became stale. | Rediscover the installed plugin through Codex; do not hard-code a cache version. | A source checkout is not proof of installed-plugin state. |

The doctor returns both stable issue codes and an `actions` array. Participant actions may repair local prerequisites. Organizer actions—especially exact-build qualification—must not be bypassed by changing records or widening selectors.

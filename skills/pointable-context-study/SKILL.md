---
name: pointable-context-study
description: Prepare and diagnose an explicitly assigned Pointable Context controlled-study package on local Windows, including release verification, qualified Codex-host checks, isolated workspace creation, and the unscored TRAIN-1 rehearsal. Use only when the user explicitly asks to set up or validate the research study. Stop at STUDY READY; never enter measured trials, inspect sealed scenarios, invoke a live model during a trial, or submit results without a separate participant confirmation.
---

# Pointable Context study setup

1. Locate the downloaded package root without searching unrelated user folders. Read `docs/evaluation/study-v2/STUDY_SETUP_AGENT.md` completely.
2. Restrict writes to the package and `%LOCALAPPDATA%\PointableContextStudy\v2\<session-id>`. Do not inspect another project or Codex task.
3. Verify `release-manifest.json` and `checksums.txt` when present. A source checkout is development-only and must not be represented as a released participant package.
4. Run the packaged doctor:
   - release: `node bin/pointable-study.mjs doctor --repository-root . --json`
   - source: `node dist/src/evaluation/study-v2/cli.js doctor --repository-root . --json`
5. Stop on any failed platform, pack-integrity, Codex-build, renderer, or plugin gate. GitHub CLI absence blocks automatic submission but not local practice; report that distinction.
6. Require the organizer-provided participant code and slot plus the participant-selected `zh-CN` or `en-US` language. Never choose a slot, infer a missing value, or change language after the session checkpoint exists.
7. Prepare only `TRAIN-1` with `scripts/prepare-study-v2-workspace.mjs prepare --scenario TRAIN-1 --language <zh-CN|en-US> --destination <absolute-new-path>`. Do not open another scenario transcript, entity file, answer contract, or facilitator material.
8. If and only if the release declares the native scripted runner qualified, launch the unscored `TRAIN-1` as ordinary Codex turns. Do not accept a browser or full-overlay transcript imitation as the practice surface, and do not use a model to answer it.
9. Emit only participant code, slot, language, pack digest, host qualification, native-runner qualification, and `STUDY READY`, then stop. Tell the participant to close this setup task before launching the controlled runner.

Start measured collection only when the immutable release manifest says exactly `approved_for_pilot_data_collection`. Treat prototype, candidate, missing, or unknown status as not approved. Do not upload, encrypt, or submit a result through this setup skill.

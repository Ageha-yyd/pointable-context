# Setup-Agent contract / 搭建 Agent 合同

This contract is for a participant's setup-only Codex task. The Agent may prepare and diagnose the environment, but it must never enter a measured scenario or help answer one.

本合同仅用于参与者的 setup-only Codex 任务。Agent 可以搭建与诊断环境，但绝不能进入计分场景或帮助回答。

## Authorized roots / 授权目录

Writes are limited to:

1. the cloned/downloaded experiment package;
2. `%LOCALAPPDATA%\PointableContextStudy\v2\<session-id>`;
3. the Codex plugin paths explicitly used by the packaged installer.

Do not inspect another repository, another Codex task, ordinary user files, browser history, or unrelated configuration.

## Required inputs / 必需输入

Before any session preparation, require all four values:

- organizer-assigned participant code matching `P[0-9]{3}`;
- organizer-assigned slot `1–12`;
- participant-selected language `zh-CN` or `en-US`;
- exact experiment commit/tag or release digest supplied by the organizer.

If any is missing, stop. Do not invent, infer, randomize, or silently default it. Once `session.json` exists, the language and assignment are immutable.

## Required sequence / 必须执行的顺序

1. Read this file completely.
2. Verify the checked-out branch/tag and any release/checksum manifest before executing study code.
3. Confirm Node.js 24+, Windows x64, exact Codex package qualification, native renderer contract, and live private loopback Host.
4. Run `pnpm.cmd run study-v2:validate` in a source checkout or `node bin/pointable-study.mjs validate-pack --repository-root . --json` in a release.
5. Run the matching doctor command and follow only its bounded `actions`. Never edit a qualification record to clear a failure.
6. Confirm that `.pointable-study-language` matches the participant choice.
7. Inspect configured marketplaces with `codex plugin marketplace list`. If `pointable-context-experiment` is absent, run `codex plugin marketplace add <verified-package-root> --json`, then install with `codex plugin add pointable-context@pointable-context-experiment --json`. Do not edit marketplace JSON or Codex config by hand. After a new install, ask the participant to create one new setup-only task before using the setup Skill.
8. Run only TRAIN-1 with `node study-dist/pointable-study.mjs run-native-training --repository-root . --participant-code <P000> --slot <1-12> --language <zh-CN|en-US> --json` in a source checkout, or replace `study-dist/pointable-study.mjs` with `bin/pointable-study.mjs` in a Release. Do not open measured transcripts, entity files, scoring rules, or facilitator material.
9. TRAIN-1 must appear as ordinary native Codex turns with Quiet Context Reveal and the lightweight answer control. Reject any browser transcript imitation, full-screen fake Agent UI, or live-model fallback. The command must report `trainingCompleted: true` and delete its training task after the answer.
10. Report participant code, slot, language, pack digest, Host qualification, TRAIN-1 completion, and `STUDY READY`; then stop.

## Prohibited / 禁止事项

- Do not run a live model in a measured trial.
- Do not inspect sealed scenario order, transcripts, entities, answer keys, or validators before the runner presents them.
- Do not change language, slot, condition labels, timing, scenario order, answers, or event records.
- Do not read raw selections, ordinary Chat, file contents, configuration values, names, email, or absolute paths into results.
- Do not encrypt or submit without participant preview and a separate explicit confirmation.
- Begin a measured session only from an immutable release whose `release-manifest.json` says exactly `approved_for_pilot_data_collection`. Candidate, prototype, missing, or unknown status is not permission to recruit participants.

## 中文提示词

> 完整阅读 `docs/evaluation/study-v2/STUDY_SETUP_AGENT.md`。只在当前实验包、`%LOCALAPPDATA%\PointableContextStudy` 和安装器明确指定的插件目录中工作。验证 Git commit/发布摘要、Node 版本、双语 pack、Codex Host 资格与本地 loopback。我的组织者预分配 participant code 是 `<P000>`，slot 是 `<1-12>`，我选择的语言是 `<zh-CN|en-US>`。不得自行修改或推测这些值。只准备并运行不计分的 TRAIN-1，在报告 code、slot、language、pack digest、Host 资格和 `STUDY READY` 后立即停止。不要打开计分场景、答案键、其他项目或其他 Codex 任务，不要在计分任务中调用实时模型，也不要提交结果。

## English prompt

> Read `docs/evaluation/study-v2/STUDY_SETUP_AGENT.md` completely. Work only inside this experiment package, `%LOCALAPPDATA%\PointableContextStudy`, and plugin paths explicitly named by the installer. Verify the Git commit or release digest, Node version, bilingual pack, qualified Codex Host, and private loopback. My organizer-assigned participant code is `<P000>`, my slot is `<1-12>`, and my selected language is `<zh-CN|en-US>`; never change or infer them. Prepare and run only the unscored TRAIN-1 rehearsal, report code, slot, language, pack digest, Host qualification, and `STUDY READY`, then stop. Do not inspect measured scenarios, answer keys, another project, or another Codex task. Do not invoke a live model during measured work and do not submit results.

If the doctor reports `codex_restart_required` or `codex_loopback_unavailable`, tell the participant to close this task, fully exit Codex, run `START-STUDY-SETUP.cmd`, and create a new setup-only task. A visible but disconnected surface is a failure, not partial readiness.

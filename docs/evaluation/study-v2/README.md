# Pointable Context controlled study v2 / 受控实验 v2

Status: experimental-branch package under qualification; not yet approved for formal participant data collection.

状态：实验分支研究包正在资格验证中；尚未批准用于正式参与者数据收集。

## What this experiment tests / 实验要检验什么

The study compares the same frozen, information-dense development history under two conditions:

- Condition A: native linear Codex Chat plus ordinary workspace navigation.
- Condition B: the same Chat and workspace, plus selection-triggered P-C micro mental-model cards inside the native Chat Lane.

本实验在完全相同的冻结开发历史上比较两种条件：

- A 条件：原生 Codex 线性 Chat 与普通工作区导航。
- B 条件：相同 Chat 与工作区，再加入原生 Chat Lane 内由文字选择触发的 P-C 微型心智模型卡片。

The primary outcomes are time to a correct decision and decision correctness. Secondary outcomes include time to the first correct object, navigation effort, wrong-object inspection, card use, and five bounded subjective ratings. No live model runs during measured trials, so every participant sees the same development process and facts.

主要指标是做出正确决策所需时间与决策正确性。次要指标包括首次找到正确对象的时间、导航成本、错误对象查看、卡片使用，以及五项限定主观评分。计分试次不调用实时模型，因此所有参与者看到完全相同的开发过程和事实。

## Study structure / 实验结构

1. Environment setup and integrity check.
2. One unscored TRAIN-1 rehearsal.
3. Six measured trials in an organizer-assigned counterbalanced order.
4. One five-item questionnaire.
5. Local result preview, explicit participant confirmation, encryption, and optional GitHub submission.

对应中文流程：环境与完整性检查；一次不计分训练；按组织者预分配顺序完成六个计分试次；填写五项问卷；本地预览结果；参与者明确确认后才加密并选择是否通过 GitHub 返回。

Each measured scenario contains five controlled Agent exchanges that reconstruct a realistic development evolution: initial request, implementation progress, evidence gap or drift, a newly introduced project concept, and the current decision. The two languages share the same object IDs, answer keys, assignment, and scoring rule.

每个计分场景包含五轮受控 Agent 对话，依次呈现初始请求、实现进展、证据缺口或状态漂移、新出现的项目概念，以及当前需要做出的决定。中英文共用相同对象 ID、答案键、任务分配与评分规则。

## GitHub branch setup / 从 GitHub 实验分支搭建

```powershell
git clone --branch experiment/study-v2-bilingual --single-branch https://github.com/Ageha-yyd/pointable-context.git
cd pointable-context
.\SETUP-EXPERIMENT.cmd zh-CN
# or / 或者
.\SETUP-EXPERIMENT.cmd en-US
```

The script installs the frozen Node dependencies, builds the study runner, validates every bilingual scenario and writes only the selected language to `.pointable-study-language`. It does not assign a participant code or slot and does not begin measured work.

脚本会安装锁定依赖、构建研究运行器、验证全部双语场景，并只把语言选择写入 `.pointable-study-language`。它不会自行分配参与者代码或 slot，也不会开始计分试次。

After setup, run `START-STUDY-SETUP.cmd`, create a new setup-only Codex task, and give it the exact prompt in `STUDY_SETUP_AGENT.md`. The Setup Agent must stop if the organizer has not supplied both `participant code` and `slot`.

## Research boundaries / 研究边界

- No browser transcript imitation and no full-screen fake Agent UI may be used as the measured surface.
- The generated conversation must appear as ordinary user/assistant Turns in native Codex Desktop.
- No live model, search engine, another Agent, or unrelated project is available during a measured trial.
- The runner never records raw selected text, ordinary Chat content, file contents, configuration values, names, email addresses, or absolute paths.
- A successful technical run does not establish the human-efficiency claim. Formal use still requires clean-machine rehearsal, fixed release digest, applicable ethics/governance approval, and organizer sign-off.

The source branch is for review and rehearsal. Formal recruitment should use an immutable commit/tag and generated ZIP with checksums, not the moving branch head.

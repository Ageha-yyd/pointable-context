# Participant guide / 参与者指南

## 中文

### 你会做什么

你将先完成一次不计分练习，再完成六个开发理解任务。每个任务都在原生 Codex Chat Lane 中呈现一个已经冻结的多轮 Agent 开发过程。你需要恢复当前项目状态并从给定选项中做出一个决策。部分试次允许你选中项目概念并在对话旁查看微型上下文卡片，另一些试次只有普通 Chat 与工作区导航。

实验不是编程能力测试。你不需要写功能，也不需要调用模型。请依据试次中提供的信息完成判断。

### 开始之前

你应从组织者获得：

- 一个私密 participant code，例如 `P014`；
- 一个 slot，范围 `1–12`；
- 固定的 GitHub branch/tag 或 Release 链接与摘要；
- 结果加密公钥和返回方式。

如果缺少 participant code 或 slot，请停止并联系组织者。不要自行选择，也不要让 Setup Agent 推测。

### 本地搭建

1. 在 Windows x64 机器上安装 Git、Node.js 24+、Codex Desktop 和 GitHub CLI（只有 GitHub 返回结果时才需要 GitHub CLI）。
2. 克隆组织者指定的固定实验版本。
3. 在仓库根目录运行 `SETUP-EXPERIMENT.cmd zh-CN`。如果你更希望使用英文，则运行 `SETUP-EXPERIMENT.cmd en-US`。
4. 脚本完成后，完全退出 Codex，再运行 `START-STUDY-SETUP.cmd`。
5. 新建一个只用于搭建的 Codex 任务，把 `STUDY_SETUP_AGENT.md` 中对应语言的提示原样发给 Agent。
6. 只在看到正确 participant code、slot、language、pack digest、Host 资格和 `STUDY READY` 后继续。

### 完成试次

1. 关闭 setup-only 任务，启动受控 runner。
2. TRAIN-1 不计分，用来练习选择文本、打开卡片、收起/移动卡片和提交答案。
3. 六个计分试次必须按 runner 给出的顺序完成。不要刷新或重排任务。
4. 阅读原生 Chat；如果出现 Quiet Context Reveal 条件，可以选中对话中的稳定对象名称或 ID，点击入口查看卡片。选择文字本身不计为查询，点击查看入口后才读取详情。
5. 需要时可以查看受控工作区，但不要使用另一个 Agent、搜索引擎、外部项目或未提供的资料。
6. 每轮只提交一个答案。打开卡片不是完成；提交答案才结束该轮。
7. 如果误关卡片，可以再次选择对象并重新打开。不要因界面错误自行猜测，记录稳定错误代码并联系组织者。
8. 每轮结束时 runner 会自动 checkpoint。进程意外停止后，只能用完全相同的 participant code、slot、language、session ID 和目录恢复；任何变化都应被拒绝。

### 问卷与结果

六轮结束后填写五项 1–7 评分。点击“稍后完成”只收起问卷；右下角入口可以恢复。提交问卷不应删除最后保留的 Codex 任务；切换到其他任务后再返回，冻结对话仍应能够恢复。

之后先查看本地结果预览。结果只应包含有限事件、试次指标、五项评分、环境版本和完整性摘要。若出现原始对话、文件内容、姓名、邮箱、配置或绝对路径，请拒绝提交并联系组织者。只有你明确确认后，runner 才会加密结果。GitHub PR 会暴露你的 GitHub 账号身份；如需账号匿名，请使用组织者提供的非 GitHub 返回方式。

## English

### What you will do

You will complete one unscored rehearsal followed by six development-comprehension tasks. Each task presents a frozen multi-turn Agent development process as ordinary turns in the native Codex Chat Lane. Your goal is to recover the current project state and choose one decision. Some trials let you select a stable project concept and reveal a micro context card beside the conversation; other trials provide only ordinary Chat and workspace navigation.

This is not a programming-skill test. You do not implement a feature and no live model is available during measured work.

### Before starting

Obtain a private participant code, an organizer-assigned slot from 1–12, an immutable experiment version and digest, the organizer encryption key, and a return route. Stop if the code or slot is missing; never select or infer one yourself.

### Local setup

1. Use Windows x64 with Git, Node.js 24+, Codex Desktop, and optionally GitHub CLI.
2. Clone the exact branch/tag or download the exact Release supplied by the organizer.
3. Run `SETUP-EXPERIMENT.cmd en-US` from the repository root. Use `zh-CN` instead if you choose Chinese.
4. Fully exit Codex, run `START-STUDY-SETUP.cmd`, then create a setup-only Codex task.
5. Give the Agent the matching prompt from `STUDY_SETUP_AGENT.md`.
6. Continue only after the exact participant code, slot, language, pack digest, Host qualification, and `STUDY READY` are shown.

### Completing trials

Close the setup task, complete TRAIN-1, then complete the six measured trials in runner order. In a Quiet Context Reveal trial, select a stable object label or ID and explicitly click the reveal action. You may use the controlled workspace, but not another Agent, a search engine, an external project, or other materials. A trial ends only when one answer is submitted.

### Questionnaire and result

Rate all five 1–7 items. “Complete later” collapses the questionnaire and leaves a resume affordance. Submitting must not delete the retained final Codex task; its frozen conversation should still restore after switching away and back.

Inspect the local preview before confirmation. Reject submission if it includes raw Chat, selected text, file contents, identity fields, configuration values, or absolute paths. GitHub submission is encrypted but your GitHub account remains visible on the pull request; use the organizer's alternative route if account anonymity is required.

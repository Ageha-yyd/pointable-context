# Study V2 Native Runner

## 目标

在 Codex 当前 Chat Lane 中，以普通 user/assistant Turn 重放无线上模型、可重复的受控开发对话，运行 A/B 试次，并自动记录有界的客观交互事件。

## 当前状态

当前 Codex `26.814.5517.0` 精确宿主/renderer 已完成自动 4/4、人工 10/10 资格。TRAIN-1 与六个 measured scenario 已各自冻结为三轮 user/assistant script；默认单轮与六轮 runner 已把私有 loopback scripted runtime、普通持久 Codex Turn、精确 task 激活、轻量答题、条件 B companion、checkpoint 与结果管线接通。轻量答题控件已通过当前 build 的形成性人工验收；真实 A/B 完整端到端尚未验收。

## 已完成

已实现冻结材料加载、单调计时事件协议、精确构建失败关闭、可恢复六轮 checkpoint、客观指标推导、原子结果与原生问卷。私有 runtime 使用无认证 custom model provider 和独立 App Server；默认关闭 WebSocket prewarm、plugins 与 apps，只记录 ordinal/model/transport，不保存 prompt，也不调用线上模型。每轮在生成任务成为当前 Desktop task 后才挂载轻量答题；A 不加载 companion，B 只增加 Quiet Context Reveal；终态只删除本轮任务并关闭 runtime。旧 full-overlay renderer 仅保留作组件资格、培训和诊断。

## 下一步

1. 运行 A/B 各一次当前-build 端到端，核对相同 transcript/workspace/answer key、B-only companion、零额外 Chat Turn 与终态清理；
2. 做干净 Windows ZIP 的 TRAIN-1、六轮、恢复、问卷、预览、加密和卸载演练；
3. 用测试账号演练 GitHub 返回路径，再冻结组织者、release 与研究治理参数。

## 阻塞

技术路径和默认 runner 接线不再阻塞。剩余阻塞是当前 build 的真实 A/B 完整端到端、干净机演练、GitHub 返回路径与研究治理批准。关闭这些项前不得开始参与者招募。

## 更新时间

2026-08-20T21:10:00+08:00

## 证据

> 2026-08-20 native scripted runner gate: the default single-trial and six-trial paths now use ordinary persistent Codex turns rather than the legacy full-overlay transcript. A private loopback custom model provider and dedicated App Server create the frozen three-turn history, the runner waits for the exact generated Desktop task before `trial_shown`, condition A mounts only the lightweight answer control, and condition B additionally mounts Quiet Context Reveal. Terminal events enter the existing append-only checkpoint and result pipeline; cleanup deletes only the generated task and stops the private runtime.

## 来源

docs/evidence/study-v2-native-scripted-runner-2026-08-20.txt:1

# P Map Pr63 Long Task Replay

## 要证明什么

公开项目的真实历史能否被压缩为有边界的多里程碑开发重放，并让 Pointable Context 暴露对象缺口、登记、恢复和稳定状态，而不把模拟重放误报为真人效率实验。

## 结果

PASS。`sindresorhus/p-map` PR #63 从功能出现前基线到最终 head 的七个真实 Git 节点完成重放；两个 task-local 对象先后经历缺口、登记与恢复，最终固定 review 为 4/4 available。项目自身 `xo + ava + tsd` 实际通过，AVA 报告 48 tests passed。重放同时发现并驱动修复了恢复信号粘住历史缺口的问题。

## 尚未证明

本次把真实版本历史压缩到一次短时重放，没有真人延迟重返、任务交接或自然 Chat 流程，不证明信息获取时间缩短、Chat Turn 减少、对象自动发现完整性、跨项目泛化或统计显著性。

## 验证方式

在隔离 clone 中固定 base、head 与七个递进节点，每个节点使用同一组显式 review terms 运行私有 milestone observation，并在稳定节点按策略登记 Concept 与 Decision；最终重新运行项目原生 `npm test`，再用 transition-local 单元回归覆盖 `gap → available → available`。

## 验证修订

git:92322ab83b1061cb2aa76868ced616a4797c1ea6+diff:2e07c61203dd13879faf2642d3697e4630e80c63

## 执行时间

2026-08-25T21:49:30.081+08:00

## 证据

> P_MAP_PR63_LONG_TASK_REPLAY v1; source=https://github.com/sindresorhus/p-map/pull/63; replay_base=a5faf425ad3f871d10b3a18e30ae10d1edc78311; replay_head=408b371bfeabc4c904daea2dc5989525bf361a6e; selected_nodes=7; final_review=4/4_available; observations=25; final_task_local_available=2; npm_test=passed; ava=48_passed; product_revision=git:92322ab83b1061cb2aa76868ced616a4797c1ea6+diff:2e07c61203dd13879faf2642d3697e4630e80c63; observed=2026-08-25T21:49:30.081+08:00; boundary=compressed_real_history_replay_not_human_efficiency_evidence

## 来源

docs/evidence/p-map-pr63-long-task-replay-2026-08-25.txt:1

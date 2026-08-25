# Vite Pr22642 Object Lifecycle Replay

## 要证明什么

Pointable Context 能否在一个超过原索引上限的真实大型开发仓库中，随完整 PR 历史只维护对理解与继续工作有价值的对象，并正确区分内容更新、身份替代、任务退役与无业务语义的噪声提交。

## 结果

PASS。Vite PR #22642 从合入前基线到最终 head 的 11 个真实提交形成 12 个里程碑。基线的两个源码模块可用，Task、Concept、Decision 与 Change 均在首次成为稳定理解单元的同一里程碑出现；一个 Change 在语义边界扩大时显式 supersede，最终 Task 退役。merge-main、两个仅补链接提交和 Windows test skip 均未创建新对象。最终当前需要为 5/5 available，Registry 为 3 active、2 terminal；32/32 定向回归通过。

## 尚未证明

本次没有运行 Vite 项目测试，也没有真人延迟重返、交接或自然 Chat 长任务，不证明实现本身正确合入 Vite、用户信息获取时间缩短、Chat Turn 减少、自动对象发现完整性或统计显著性。

## 验证方式

在隔离 clone 中固定 base、PR head 和全部 11 个递进提交；每个节点只用显式 need list 运行 milestone observation。按冻结策略在稳定节点最多新增一个 task-local 对象，内容变化原位 update，身份扩展 explicit supersede，PR 终态 retire；同时复验大型 workspace 的完整 development-context surface 与 companion 非法请求后的进程连续性。

## 验证修订

git:9c549d2f04985eee3e7743300dc11ae46484815d+diff:0ff94b7641ef5e6fefac71034c57f167800924cb

## 执行时间

2026-08-26T04:10:01.524+08:00

## 证据

> VITE_PR22642_OBJECT_LIFECYCLE_REPLAY v1; source=https://github.com/vitejs/vite/pull/22642; replay_base=578ffb80d46940f3b99cd96ed609f8b3a0ac5ede; replay_head=d34630c22c9397b5fa53071386fe20394bd4a61e; milestones=12; ledger_events=12; aggregate_available=59; aggregate_missing=3; final_review=5/5_available; created_identities=5; final_active=3; final_terminal=2; noise_milestones_without_new_objects=4/4; important_object_detection_delay=0_milestones; identity_policy=3_stable_or_retired_plus_1_explicit_supersession; large_workspace=scanned_2467_indexed_development_surface_1721; targeted_regression=32/32_passed; product_revision=git:9c549d2f04985eee3e7743300dc11ae46484815d+diff:0ff94b7641ef5e6fefac71034c57f167800924cb; observed=2026-08-26T04:10:01.524+08:00; boundary=compressed_real_history_replay_not_project_test_or_human_efficiency_evidence

## 来源

docs/evidence/vite-pr22642-object-lifecycle-replay-2026-08-26.txt:1

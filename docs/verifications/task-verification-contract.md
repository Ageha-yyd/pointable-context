# Task Verification Contract

## 要证明什么

显式 Concept、Change、Decision、Task 与 Verification 能通过各自写后 Gate，并与声明的 Module/Decision/Task/Verification 一起获得可恢复的结构覆盖结果；Codex Desktop 兼容性结论仍绑定精确 build 与 renderer digest。

## 结果

PASS。Artifact Check 验证 4/4 显式 Concept/Change/Decision，Record Check 验证 3/3 Task/Verification，长期对象 Coverage 为 7/7 available 且 omission/projection-failure/redundancy 均为 0；全量自动回归 244/244 通过。此前 Codex 26.810.7004.0 自动 4/4 与人工 10/10 的精确 build 资格仍由独立证据记录约束。

## 尚未证明

当前结果不能发现从未被 Agent 或用户声明的重要对象，不能外推不同 Codex Desktop 版本兼容，也没有证明字段优先级对真人最优或真人恢复上下文更快。

## 验证方式

执行完整 TypeScript 构建与 Node 自动回归，再运行只读 Artifact Check、Task/Verification Record Check 与 Context Coverage Gate。

## 验证修订

working-tree:08152a2+milestone-artifact-gate

## 执行时间

2026-08-20T02:34:47+08:00

## 证据

> 2026-08-20 milestone artifact gate: Artifact Check validated 4/4 explicit Concept/Change/Decision artifacts, Record Check validated 3/3 Task/Verification records, declared long-task Context Coverage returned 7/7 available with zero omission/projection-failure/redundancy, and the full regression passed 244/244.

## 来源

docs/evidence/milestone-artifact-gate-2026-08-20.txt:1

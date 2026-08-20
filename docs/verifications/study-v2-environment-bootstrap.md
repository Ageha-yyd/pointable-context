# Study V2 Environment Bootstrap

## 要证明什么

实验者可从发布包的一键入口获得实时环境诊断，并且当前 Host 不可用或精确构建资格不完整时会在试次前失败关闭。

## 结果

partial：类型检查、256/256 完整回归、study pack、临时发布包内容、一键入口复用当前 Host、实时 loopback 门禁和 7/10 人工资格边界均按预期工作。

## 尚未证明

尚未在全新 Windows 机器上演练 Codex 完全关闭时的启动分支；当前构建仍有 navigation recovery、stale response cleanup 和 refresh continuity 三项人工 Gate 未完成，因此不是完整资格化或可招募状态。

## 验证方式

运行 TypeScript 检查、完整 Node 测试、study-v2 pack 校验、临时 release 构建与内容回读、发布包 launcher、实时 doctor 和精确构建 compatibility inspector。

## 验证修订

dirty worktree snapshot at HEAD 08152a2d291a01e55293c1e935eca67b1c44b6fd

## 执行时间

2026-08-20T13:09:03+08:00

## 证据

> 2026-08-20 study-v2 environment bootstrap verification: TypeScript check passed, full product regression passed 256/256, study pack validated with digest 1ace78449678349fff6f7d67deb46b7ced922fc518e82f05dd4467bbb7067d76, the packaged START-STUDY-SETUP path reported codex_study_host_ready on 26.814.5517.0, live loopback passed, and exact-build qualification correctly remained manual_pending at 7/10 with 3 pending.

## 来源

docs/evidence/study-v2-environment-bootstrap-2026-08-20.txt:1

# Presentation Default

## 原来怎样

普通启动默认使用 P-A 记录式摘要；概念的定义、当前语境、流程位置和边界主要藏在字段或详情中，需要用户自行拼接。

## 现在怎样

普通启动默认使用 P-C 微型心智模型；P-A 与 P-B 只在显式研究条件中启用。

## 影响什么

用户首次打开概念卡就会看到“是什么、为什么现在出现、当前位于哪里、不能证明什么”；重启 companion 时也不再需要手工传入呈现参数。

## 证据

> let presentationMode: PointablePresentationMode = "mental-model";

## 来源

src/host/codex-cdp/workspace-companion-cli.ts:103

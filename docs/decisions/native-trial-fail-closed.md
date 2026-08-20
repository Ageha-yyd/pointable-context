# Native Trial Fail Closed

## 为什么需要决定

原生试次页面可能在 Host 连接丢失后仍短暂保留视觉外壳。若把“页面可见”误当成“交互已就绪”，参与者会进入一个无法点击、无法计时且无法产生可信事件的假试次。

## 选择了什么

每次原生试次都先检查当前 Codex 精确构建资格，再以 armed 状态挂载；只有试次 Host 与 B 条件下的 Pointable Host 都成功连接后才激活交互。构建未资格化、调试端点不可用或 Host 连接失败时，一律在挂载前停止。

## 后果是什么

视觉外壳不再代表交互可用，旧构建的资格也不能沿用到新构建。Codex 自动更新后需要重新完成兼容性与人工交互验收，这会增加一次版本门禁，但能避免收集不可解释的无效试次。

## 证据

> 2026-08-20 native trial Host gate: deterministic material loading, armed activation, bounded event transport, A/B routing, and the exact-build fail-closed regression passed; live interaction acceptance is blocked because Codex updated from qualified package 26.810.7004.0 to unqualified package 26.814.5517.0 and restarted without the required loopback CDP endpoint.

## 来源

docs/evidence/native-trial-host-gate-2026-08-20.txt:1

# Long Task Recovery Dogfood

## 目标

在真实、持续演进的软件开发任务中检查延迟重返、跨会话恢复、状态漂移和任务交接时，Pointable Context 的稳定对象是否足以帮助人重新建立正确理解。

## 当前状态

v2.33 已完成首个真实跨任务恢复验收，并建立独立于正式 study-v2 的 Recovery Observation Prototype：现在可在不操作原生 UI 的情况下自动验证匿名事件合同、恢复指标、失焦扣时、刷新成本和显式失败分类。

## 已完成

完成 p-map 与 Vite 两次公开历史回放、大型 workspace 完整开发面修复、首个全新 Codex 任务原生恢复 PASS，以及三类 Recovery Episode 合成回放；新增指标测试 6/6、完整回归 336/336，当前结构覆盖 18/18。

## 下一步

在不改动 Renderer 的前提下，把 prototype 接到一个显式启用、仅本地保存的开发期 observer；先自动记录真实 episode 的匿名交互与时间事件，之后再请求人判断恢复正确性。

## 阻塞

无技术阻塞。当前尚未挂载真实 Renderer 事件，因此 6/6 只证明测量合同与合成回放；人类理解、效率与 Chat Turn 降幅仍未证明。

## 更新时间

2026-08-26T21:02:56+08:00

## 证据

> TEST_EXECUTION_EVENT v1; run=7118ca2c-30cb-475c-ad82-4da02b068c38; outcome=passed; exit=0; revision=git:bd075bfdc1c1e39105c0ea2261abeafa4564e29e+status:3a522122c5d2edc32c5198827db68de8fe67160275faae4f6f5ed54d25b0c20a; started=2026-08-26T13:02:56.825Z; finished=2026-08-26T13:02:56.943Z; command_sha256=eb7702506c9e2b7d3336fad8881c5947d489dbba66184721fceb8d576be701ac; stdout_sha256=16435e79bbcf184f6e240cb83cf0aee572e2d00376510408c13f428f1429495f; stderr_sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855; drift=false; event_sha256=562da5ad68066922da5e56ea02133f783380b4e2741acd4b97a9f107ac0a08d8

## 来源

docs/evidence/test-executions/recovery-observation-pipeline.txt:1

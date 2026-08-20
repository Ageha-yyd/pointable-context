# 冻结的 Agent 开发历史——Authority Fence

一次异步详情读取从任务 A 发起，但用户在读取完成前切换到任务 B，旧结果随后出现在新卡片中。早期记录把身份连续性与时间新鲜度都称作 freshness check，导致团队误以为“刚读取的数据”天然属于当前交互。

最终设计将二者拆开：freshness 描述数据在何时被观察；`authority fence` 则在读取前绑定任务、选区 generation、scope 和 source revision，在读取后以及展示前再次验证。通过 Fence 只允许展示同一交互中的已验证快照，并不扩大来源的证明范围，也不能把 stale 数据升级为 current。

任务：判断 authority fence 能够建立什么，并提交答案代码。

- `CONCEPT-A`: 在展示前验证响应身份、交互上下文和来源修订仍然一致。
- `CONCEPT-B`: 推断任何通过 Fence 的响应都全局正确且永久 current。
- `CONCEPT-C`: 用时间戳比较替代所有来源和身份验证。

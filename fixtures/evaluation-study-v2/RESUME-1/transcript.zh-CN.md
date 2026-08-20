# 冻结的 Agent 开发历史——Relay Cache

任务最初只有一个 `relay-cache.ts`。长任务推进中，Agent 将持久化逻辑拆到 `store.ts`，增加只负责读取版本 1 快照的 migration adapter，并建立 `src/relay-cache/index.ts` 作为消费者入口。最初的序列化测试通过，但进程重启尚未验证；后续 restart fixture 已经通过。

旧文件名仍在早期对话和迁移代码中出现，这并不表示它仍是公共边界。`store.ts` 包含最新实现，但属于内部持久化细节；migration adapter 只提供旧快照读取兼容性。当前新消费者应通过 relay-cache public entry 接入。

任务：判断新消费者应该使用哪个导入边界，并提交一个答案代码。

- `RESUME-A`: 直接导入持久化 store，因为它包含最新实现。
- `RESUME-B`: 导入 relay-cache public entry，并把 migration adapter 视为旧快照读取支持。
- `RESUME-C`: 因为重启行为从未验证，所以推迟所有集成。

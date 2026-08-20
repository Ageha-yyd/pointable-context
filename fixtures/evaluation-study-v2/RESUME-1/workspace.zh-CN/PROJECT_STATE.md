# Relay Cache 项目状态

## 当前阶段

模块拆分和 restart fixture 已完成。新消费者现在必须选择受支持边界。

## relay-cache public entry

`src/relay-cache/index.ts` 是稳定消费者入口。`store.ts` 是内部持久化实现，migration adapter 只读取版本 1 快照。

## 边界

该决策不承诺 store 内部布局稳定。

## 下一步

通过公共入口连接新消费者。

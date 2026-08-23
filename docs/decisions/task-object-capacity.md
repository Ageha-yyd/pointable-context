# Task Object Capacity

## 为什么需要决定

长任务中的 active 与 terminal 对象持续累积时，既不能让容量耗尽突然中断维护，也不能为了释放空间而删除仍然承担历史解释或尚未完成的对象。

## 选择了什么

热 Registry 在每个当前任务达到 64 个 active 对象时给出软警告，256 个仍硬性拒绝；仅当一个终态 task-local 对象已被 checker-valid、同类型同名且唯一的稳定制品接管时，才允许显式归档。

## 后果是什么

Agent 会在容量成为故障前收到治理信号；归档先保存本地审计副本再移除热记录，active、无匹配和歧义对象保持原位。Archive 不参与查询，历史 Chat 由稳定制品继续解释。

## 证据

> Registry 容量采用 active-hot、terminal-audit 策略：`object-list` 在当前任务达到 64 个 active 对象时给出软警告但不阻断有效写入，256 个 active 仍然硬性 fail closed。匹配的 evidence-backed artifact 通过 checker 且 task-local 对象进入终态后，显式 `object-archive` 必须先写入本地审计副本，且只有稳定 Index 中恰好一个同类型、同 canonical name 对象时才能移出热 Registry；active、无匹配或歧义记录绝不归档。Archive 不参与 lookup authority，历史文字改由稳定制品继续解析。

## 来源

docs/PRD-inline-pointable-widgets.md:430

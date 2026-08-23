# Object Curation Policy

## 为什么需要决定

如果把每个新名词都登记为对象，长任务会迅速产生对象爆炸；如果要求用户逐个手工建卡，又会遗漏真正影响恢复、决策和交接的信息。

## 选择了什么

Agent 在明确授权的有界任务中只于稳定里程碑维护对象：稳定制品优先，未稳定但跨 Turn 有价值的身份进入 task-local partial 层，具备跨任务价值和精确证据后才升级为 evidence-backed artifact。默认每个里程碑最多新增一个临时对象。

## 后果是什么

用户不需要为每张卡新增 Chat Turn，系统也不会扫描 Chat 或为每个名词建卡。升级必须先通过适用 checker，再退役临时版本；验证失败时对象继续保持 partial，并明确显示其证据边界。

## 证据

> Agent 的对象选择采用显式 opt-in、稳定里程碑触发的两级路由：每次 mutation 前先列出当前任务对象并检查五类冻结制品目录；已有稳定制品优先，已有 active identity 只更新内容，身份变化才 supersede，无后续决策价值则 retire；尚属当前任务、但已具备稳定名称、跨 Turn 价值和完整类型化理解单元的对象进入 task-local partial 层，具有跨任务复用价值且存在 exact workspace evidence 的对象进入 evidence-backed artifact 层。单个稳定里程碑通常最多新增一个 task-local 对象，除非用户明确命名多个对象；只有稳定制品通过适用 checker 后才退役对应临时对象，检查失败时保留 partial 并报告边界。这里的“自动”只表示一次明确授权后由 Agent 在里程碑维护，不表示扫描 Chat、调用语义模型或为每个名词建卡，也不要求用户为每张卡新增 Chat Turn。

## 来源

docs/PRD-inline-pointable-widgets.md:429

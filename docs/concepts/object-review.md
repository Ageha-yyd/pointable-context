# Object Review

## 它是什么意思

在一个稳定里程碑，把后来确实需要查询的少量术语显式列出，并只在当前可查询的 workspace 与 task-local 身份面上检查它们是否可用、遗漏、歧义或类型错误。

## 为什么现在出现

结构 Coverage 只能检查事先声明的对象，Object Audit 也只能审查已经登记的对象；Object Review 补上“需要已经发生，但对象层没有提供”的可测量缺口。

## 它不是什么

它不扫描 Chat、不读取详情、不调用模型、不自动创建对象，也不把一次复盘结果当作用户效率或完整性的证明。

## 所处流程

- 稳定里程碑形成一组真实需要的术语
- 当前：对完整 workspace 与 task-local identity surface 做确定性复盘
- 根据 missing、ambiguous 或 type mismatch 调整对象策展
- 下一里程碑重新复盘并积累长任务证据

## 证据

> Host 只使用当前 task/workspace binding、完整 runtime-validated workspace identity 和当前 task-local identity；它不读取 Provider detail、不调用模型、不扫描历史消息；

## 来源

docs/PRD-inline-pointable-widgets.md:438

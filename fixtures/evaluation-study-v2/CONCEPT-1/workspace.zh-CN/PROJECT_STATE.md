# Authority Fence 项目状态

## 当前问题

任务、选区、scope 或 source revision 漂移后，异步结果不得继续展示。

## authority fence

在读取前绑定交互，在读取后和展示前重新验证任务、selection generation、scope 与 source revision。

## 边界

该 Fence 不证明来源之外的事实，也不会使旧观察变成当前事实。

## 下一步

保留三处 Fence，并测试 in-flight read 期间的导航。

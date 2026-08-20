# 冻结的 Agent 开发历史——Explicit Refresh

第一版卡片会在 watcher 发现文件变化时立即替换已打开内容。评审中，读者正在看的段落突然跳动，而且无法判断做决策时依据的是旧快照还是新快照。另一个极端方案是打开后永不检查变化，但这会静默隐藏 drift。

团队最终接受 `explicit refresh`：打开卡片时固定当前 snapshot，后台只检测 revision drift 并显示紧凑的“内容已更新”提示；只有用户点击 Refresh 后，系统才重新读取 authority、在同一位置替换内容，并优先概括最多三项变化。

任务：选择符合 explicit refresh 决策的实现行为，并提交答案代码。

- `DECISION-A`: watcher 触发时立即替换打开的卡片。
- `DECISION-B`: 固定打开快照、提示 drift，并只在可信 Refresh 操作后替换。
- `DECISION-C`: 卡片打开期间完全不检测变化。

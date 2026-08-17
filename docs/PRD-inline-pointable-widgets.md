# PRD：Agent Chat Lane 可指点上下文

- 版本：v0.11
- 状态：通用 context-scope 边界已冻结；P0-A core、fixture-only Headless MCP Plugin、Desktop fixture/live companions、App Server referent 协议和最小同表面 conversation client 已实现。当前 Codex Desktop 私有路径已通过人工点查，App Server 自有任务已通过 Chat→Selection→detail→referent chip→后续显式追问的端到端验证。现有 Desktop 私有 CDP 卡片回流到当前 Desktop 任务、Inline MCP App、大众分发与正式用户研究尚未资格化
- 日期：2026-08-18
- 工作名：Pointable Output / Selection Quick Look
- 首个研究与资格化宿主：当前 Codex desktop
- 核心研究结果指标：`time_to_verified_fact_ms`
- 核心生产路径指标：`time_to_detail_visible_ms`

## 1. 一句话产品定义

在同一 Agent 任务的 Chat Lane 中，用户既可以直接操作 Agent 已知的结构化对象，也可以选中当前可见的 user/assistant 消息文本，并在显式点击后从当前可信上下文 scope 中识别关键实体；系统原位展示小型、可验证的详情卡，并在需要比较、关系浏览、历史审查或批量操作时才升级到完整视图。

产品建立一个共享上下文访问层，并与四个互补表面协同：

1. **Chat**：处理开放式解释、综合判断与低置信问题。
2. **Selection Quick Look**：用户对当前可见文本中的上下文实体进行拉取式微检查。
3. **Inline Widget**：Agent 已经拥有稳定对象 ID 和结构化结果时主动提供的一次点击入口。
4. **Full View / Dashboard**：复杂上下文中的比较、关系导航、历史、审计和批量操作表面。

Widget 和 Quick Look 是 Chat 的局部加速器；Dashboard 是可选的复杂任务工作台。三者共享同一 Provider-backed 事实，不互相替代，也不分别建立事实真源。

## 2. 产品主张与研究假设

### 2.1 Product claim

对于当前可见文本中可识别、且用户只需查看少量任务相关事实的上下文实体，Selection Quick Look 或 Agent output 内的可指点 Widget，预计可以缩短从包含目标实体的基础回答完整呈现，到用户获得正确、可追溯事实的任务级时间，并减少为了获取已有详情而产生的额外 Chat turns，同时不降低事实正确率与可理解性。点击到详情可见的 activation latency 作为独立机制指标报告；不使用不可观测的“心理查询意图产生时刻”作为计时起点。

### 2.2 适用边界

该主张只针对 **point lookup**：

- 查看一个任务、文件、符号、论文、决策、风险或指标的少量当前事实；
- 从少量高置信候选中选择正确对象；
- 把稳定对象引用带入下一轮问题。

该主张不自动外推到：

- 多对象比较；
- 依赖分析；
- 复杂决策；
- 长期认知负荷；
- 信任；
- 团队生产力；
- Agent 事实正确性本身。

“显著提升”只能在正式研究完成后使用；当前实现、测试与运行探针不构成主效应研究结论。

### 2.3 Expected main findings

预期而非既有结论：

主效应研究只检验单对象 point lookup：

1. 纯线性 Chat 的 point lookup 会产生额外输入、等待、回溯和澄清成本。
2. 对唯一、明确的上下文实体，原位 Quick Look 应比重新发起一轮自然语言问答更快。
3. 当 Agent 已经持有结构化对象时，Inline Widget 应比用户再次选择文字更快。

以下是后续独立研究假设，不由 P0 主效应研究直接证明：

- 长时程和高信息密度是否会放大纯线性 Chat 的回溯成本；
- 对关系、比较、历史或批量任务，Full View 是否优于连续打开多个局部卡片；
- 结构化 referent 是否减少后续澄清并提升复杂追问效率。
- 识别范围过宽、候选过多、入口难发现或频繁误触是否会抵消 Quick Look 的时间收益。

## 3. 当前问题

### 3.1 纯 Chat 的点查成本

- 用户为了查看回答中某个对象的详情，需要重新输入名称、复制内容并发起新一轮对话。
- 用户依赖“上面那个”“第二个方案”等脆弱指代，容易增加澄清轮次。
- 长任务中对象状态、文档与计划会变化，旧消息中的描述可能已经漂移。
- 用户想确认一个局部事实时，完整重新生成答案会引入不必要的模型等待。

### 3.2 完整 Dashboard 的导航成本

- 用户只想看一个对象的少量事实时，打开完整工作台、定位项目、筛选对象和恢复视图状态过重。
- 小项目可能没有足够的信息密度支撑持续运行的 Dashboard。
- 旁路 Dashboard 如果不能保留当前对象、版本和原任务引用，会增加切换成本。

### 3.3 Agent 主动 Widget 的覆盖盲区

- Agent 只能为它已识别并决定输出的对象生成 Widget。
- 历史消息、用户消息、外部引用和未被 Agent 预先标记的概念仍需要用户主动查询。
- 每条消息都生成大量 Widget 会增加视觉噪声和扫描负担。

### 3.4 项目事实漂移

- 对象名称可能不变，但状态、关系、责任、证据和版本已经改变。
- 缓存、旧消息和当前项目事实可能冲突。
- 如果详情不显示来源、revision 和 freshness，结构化视觉会放大错误信息的权威感。

## 4. 产品目标

### 4.1 核心目标

将当前可见上下文实体的 point lookup，从一轮自然语言问答缩短为一次显式 Quick Look 操作，同时保证对象身份、来源和数据时点可验证。

研究 North-star metric：

`time_to_verified_fact_ms`

定义：

- A/B/C 共同起点：包含目标实体提及的基础回答已经完整、稳定且可交互地呈现，即 `target_bearing_output_ready`。
- 共同终点：用户提交目标事实答案，并由冻结的独立 gold answer/oracle 判定正确；详情仅仅可见不等于 verified。
- 生产环境不自行推断 verified；生产路径使用 `time_to_detail_visible_ms`、失败率和错误对象率监控。

### 4.2 次级目标

- 减少为获取已有详情而产生的额外 Chat turns。
- 减少对象名称重输、复制粘贴和指代澄清。
- 缩短从局部详情到精确追问的路径。
- 在小项目中避免强制建设和维护完整 Dashboard。
- 在复杂项目中保留从局部对象无损升级到 Full View 的能力。
- 不降低信息正确率、可理解性、可访问性和原 Chat 可用性。

### 4.3 非优化目标

- 最大化 Widget 数量、点击数或停留时长。
- 最大化 Dashboard 使用率。
- 把每个名词都识别为项目实体。
- 构建更复杂、更“炫”的可视化。
- 让所有点查都调用模型。
- 用 UI 掩盖数据源不确定、权限不足或状态陈旧。

## 5. 重点产品策略

| 编号 | 策略 | 产品规则 | 目的 |
|---|---|---|---|
| S1 | 一个事实层，多种表面 | Context Index 是共享查询层；Chat、Quick Look、Inline Widget 和 Full View 只是不同投影 | 防止状态分裂和重复维护 |
| S2 | 用户拉取优先 | 选区完成时最多做不访问上下文数据的本地 eligibility 判断；用户明确点击后才运行 resolver 和读取详情 | 避免误触、隐私泄漏和隐藏请求 |
| S3 | Exact-first | 优先稳定 ID、精确名称和 scope 内 alias；语义模型只在用户明确请求时参与 | 保持低延迟和可解释性 |
| S4 | 点击后按候选数路由 | 0 个给出有界无结果反馈；1 个精确匹配直达详情；2–3 个显示候选；更多转搜索或 Chat | 避免菜单负担抵消收益 |
| S5 | Progressive disclosure | 卡片只展示完成当前点查所需的 3–5 个关键事实；更多内容按需展开 | 控制认知和视觉负担 |
| S6 | Progressive escalation | 点查留在 Chat；比较、关系、历史、批量和写操作升级到 Full View | 让每种表面承担最合适任务 |
| S7 | Inline 与 Selection 互补 | Agent 已知对象优先 Inline；自由文本、历史消息和遗漏对象使用 Selection | 同时获得最低操作数和最大覆盖面 |
| S8 | 小项目轻量默认 | 小项目可以只有 thread-local 或微型索引，不要求 Dashboard 或后台常驻服务 | 降低安装、维护和理解成本 |
| S9 | Freshness-first | 每张卡显示稳定 ID、来源、revision、observed time 和 stale 状态 | 让“快”不以展示旧信息为代价 |
| S10 | 明确回流 | 查看详情不新增 turn；只有用户选择“引用并追问”并提交后才进入模型 | 区分信息获取与推理 |
| S11 | 渐进增强与降级 | Plugin/MCP tools 在无 UI 时仍返回等价文本；宿主能力按开关检测 | 面向更多宿主和大众分发 |
| S12 | Dashboard 是视图，不是真源 | Full View 可以不存在、延后出现或被替换；索引和详情查询仍可工作 | 解决小项目“面板税” |
| S13 | 不静默猜 scope | 跨 scope 同名或当前上下文不可信时必须消歧或放弃 | 防止打开错误对象 |
| S14 | 只读先行 | P0 Quick Look 不执行写入、部署、发送或其他高风险动作 | 降低安全和确认成本 |

## 6. 产品模型

### 6.1 四类用户表面

| 表面 | 最适合的问题 | 入口 | 数据形态 | 是否调用模型 |
|---|---|---|---|---|
| Chat | 解释、综合、未知问题、低置信澄清 | 用户自然语言输入 | 文本与工具结果 | 是 |
| Selection Quick Look | 对当前可见提及做单对象点查 | 用户选中文本后显式点击 | 当前实体详情 | 否 |
| Inline Widget | Agent 已知的结构化对象和预期动作 | 同一 Agent turn 内的对象入口 | 随结果返回的对象 snapshot | 普通展开否 |
| Full View / Dashboard | 比较、关系、历史、审计、批量和持续导航 | 用户显式打开 Full View | scope 级 current/history view | 视具体动作而定 |

本文用 **Full View** 指代“从局部点查升级到高密度项目表面”的规范能力；Dashboard、Workbench 和 CWA 是可能的具体实现名称，不作为三套不同能力重复规划。

### 6.2 表面路由原则

- Agent 已经知道对象 ID，并且宿主支持原位 UI：优先 Inline Widget。
- 用户正在阅读自由文本、历史消息或用户消息：提供 Selection Quick Look。
- 用户需要一次查看多个对象之间的关系：建议 Full View，但不自动跳转。
- 用户的问题无法映射到高置信上下文实体：保留 Chat。
- 同一次任务中可以同时存在四种表面，但任何对象只能有一个事实 authority。

### 6.3 “原位”的定义

“原位”是用户体验约束：

- Selection Quick Look 锚定到当前选区附近，不要求切换页面。
- Inline Widget 锚定到产生它的 Agent turn 或同 turn 的工具调用 item。
- Widget 不要求成为 `agentMessage` 文本 payload 的一部分。
- Full View 可以是同宿主的扩展表面或独立工作台，但必须带上精确 scope、实体和 revision，不要求用户重新搜索。

## 7. Context Index

### 7.1 定义

Context Index 是某个可信 context scope 中稳定实体、别名、少量摘要、关系、来源和版本信息的可查询索引。scope 可以是 thread、workspace、project、collection 或 external system。它不是第二事实库，也不是必须可视化的 Dashboard。

`Project Context Index` 只是 `scope.kind = project` 的一种实现，不是 Pointable Context 核心合同或安装前提。

它可以是：

- 当前 turn/thread 内由 tool result 形成的临时对象表；
- 仓库中的轻量 JSON/SQLite 索引；
- 由现有项目管理模型、代码索引、研究资料库或业务系统投影出的查询模型；
- 大型项目工作台背后的持久 Query Model。

### 7.2 四层对象合同

Context Index 不把事实、匹配结果和 UI 字段塞进同一个 canonical entity。P0 使用四层合同：

1. **Identity / index record**：稳定身份和 lookup 所需字段。
2. **Authoritative detail snapshot**：由 authority 在查询时返回的当前或历史事实。
3. **Surface projection**：面向 Quick Look、Inline 或文本 fallback 的展示投影。
4. **Candidate match**：某次 resolver 查询产生的临时匹配元数据。

最小 identity/index record：

~~~json
{
  "schema_version": "1.0",
  "scope": {
    "kind": "workspace",
    "id": "workspace-demo",
    "namespace": "decision-log"
  },
  "entity_id": "decision:auth-boundary",
  "entity_type": "decision",
  "canonical_name": "Host Authority Boundary",
  "aliases": ["authority boundary", "trusted host binding"],
  "summary": "定义宿主、Provider 与详情卡之间的可信边界。",
  "authority_ref": {
    "provider": "decision_log",
    "locator": "ADR-014"
  },
  "index_revision": "idx-42",
  "indexed_at": "2026-08-17T00:00:00Z",
  "deleted": false
}
~~~

最小 authoritative detail snapshot：

~~~json
{
  "scope": {
    "kind": "workspace",
    "id": "workspace-demo",
    "namespace": "decision-log"
  },
  "entity_id": "decision:auth-boundary",
  "entity_type": "decision",
  "entity_revision": "r18",
  "observed_at": "2026-08-17T00:00:00Z",
  "freshness": "current",
  "facts": {
    "status": "accepted",
    "owner": "platform-team",
    "risk": "host identity must not be model-supplied"
  },
  "relations": [],
  "source_refs": [
    { "source_type": "decision_log", "source_id": "ADR-014" }
  ]
}
~~~

`detail_fields`、本地化 label、排序、可用按钮和 `fallback_text` 属于 surface projection；`match_kind`、matched span 和候选排序属于 candidate match。它们不能改写 identity 或 authoritative snapshot。

### 7.3 Authority 规则

- UI、LLM、Chat 文本和 Dashboard 都不能自行成为 scope 内事实的 authority。
- 当前状态和详情必须由该实体类型声明的 authoritative provider 返回。
- LLM 可以提出 alias 或候选，但不能覆盖 entity ID、revision、status 或来源。
- 不同领域可以使用不同 provider，但必须统一返回可验证 snapshot envelope。
- 同一实体的旧 snapshot 不得静默显示为 current。

### 7.4 更新与失效

- 来源发生变化时，只失效受影响的实体和关系。
- 候选索引可以缓存；用户点击候选后的详情必须读取可接受的新鲜 snapshot。
- 如果只能返回旧数据，卡片必须显示 `stale`、原 observed time 和显式刷新入口。
- historical Inline Widget 保持其原 turn snapshot，不自动改写；需要当前事实时重新查询。
- context scope、thread、route 或 authority identity 改变时，未提交的候选和详情应关闭或重新验证。

## 8. 实体识别与路由

### 8.1 识别成本阶梯

用户显式点击“查项目上下文”后，resolver 按以下顺序执行，不得默认跳到最昂贵路径：

1. canonical ID 精确匹配；
2. canonical name 精确匹配；
3. 当前项目内 alias 精确匹配；
4. 当前项目内唯一的规范化词法匹配；
5. 用户显式选择“识别概念”后，才允许语义检索或模型辅助；
6. 仍不确定时放弃并交给 Chat 澄清。

### 8.2 匹配结果路由

| 结果 | UI 行为 | 请求行为 |
|---|---|---|
| 0 个匹配 | 在原入口位置显示有界的“当前项目未找到”；可提供“询问 Agent” | 不请求详情 |
| 1 个 canonical/exact 匹配 | 同一次显式 lookup 直接打开 Quick Look，不再要求第二次点击 | 读取该对象详情 |
| 2–3 个高置信匹配 | 显示候选数入口；展开菜单后选择一个 | 选择候选后读取详情 |
| 超过 3 个或类型混杂 | 不显示长菜单；转项目搜索或 Chat | 不批量读取详情 |
| 低置信语义匹配 | 只有用户显式启动识别后展示 | 可调用受控语义 resolver |
| 跨项目同名 | 显示项目与类型并要求消歧 | 不静默使用当前 cwd 猜测 |

### 8.3 候选菜单

每个候选只展示：

- 名称；
- 类型；
- 所属项目；
- 一句话摘要；
- 匹配原因：`exact_id`、`exact_alias`、`unique_name` 或 `semantic_candidate`；
- freshness 概要。

候选菜单不得：

- 展示虚假的精确置信百分比；
- 自动选择跨项目同名项；
- 因用户普通复制或辅助阅读而发起远程请求；
- 抢占键盘焦点或遮挡原生复制菜单。

### 8.4 可选文本范围

P0 只支持当前可见 Chat Lane 中的 user/assistant message 文本；“任意可见文本”不属于 P0 承诺。以下区域默认排除：

- Composer；
- 导航和侧栏列表；
- 终端；
- Diff；
- Browser；
- 已有 iframe；
- 隐藏、inert 或 detached 内容；
- 已由本产品挂载的候选菜单和详情卡。

## 9. 核心用户流程

### 9.1 路径 A：唯一实体 Selection Quick Look

1. 用户在 Chat Lane 选中包含一个明确项目实体的文字。
2. 系统在 selection completion 后最多执行不读取项目索引的本地 eligibility 检查。
3. 系统显示不抢焦点的通用“查项目上下文”入口。
4. 用户明确点击；此时才运行 project-scoped resolver。
5. resolver 返回一个 canonical/exact 对象，系统不再显示候选菜单。
6. Host 验证当前 project/thread/selection identity。
7. MCP/data provider 读取 authoritative entity detail。
8. 详情卡在选区附近打开，显示 3–5 个关键事实、来源和 freshness。
9. 用户关闭后回到原阅读位置；不新增 Chat turn，不调用模型。

目标：唯一 exact match 从点击通用入口到详情可见只需一次激活。

### 9.2 路径 B：多候选 Selection Quick Look

1. 用户选中文字并点击通用“查项目上下文”入口。
2. resolver 命中 2–3 个高置信对象或一个歧义 alias。
3. 系统显示“发现 N 个项目对象”的候选菜单。
4. 用户根据名称、类型、项目和摘要选择对象。
5. 系统只读取所选对象详情。
6. 详情卡原位展示。

目标：不为了消歧生成完整 Chat turn，也不预取所有候选详情。

### 9.3 路径 C：Agent 主动 Inline Widget

1. Agent 或工具已经获得稳定对象 ID 和结构化结果。
2. Agent 返回可独立阅读的自然语言答案。
3. 同一 turn 中最多 5 个高价值对象以可指点形式呈现。
4. 用户一次操作展开随结果返回的 snapshot 详情。
5. 普通展开不访问网络、不调用模型、不新增消息。
6. 若 snapshot 已旧，卡片明确提示并允许用户主动刷新当前详情。

### 9.4 路径 D：围绕对象精确追问

1. 用户从 Quick Look 或 Inline Widget 选择“引用并追问”。
2. Composer 显示包含项目、对象和 revision 的 referent Chip。
3. 用户输入自然语言问题并提交。
4. 宿主把 `user_text + structured referent` 写入同一 thread。
5. Agent 必须回显实际解析的对象、版本状态和任何歧义。
6. 只有这一步触发新的模型调用。

### 9.5 路径 E：升级 Full View

适用条件：

- 比较多个对象；
- 查看依赖或关系图；
- 检查历史、diff、证据或审计；
- 执行批量操作或写操作；
- 用户连续查询多个相关对象并主动选择进入全局视图。

流程：

1. 用户点击“打开完整视图”。
2. 系统传递 project ID、entity ID、revision 和期望 view。
3. Full View 必须直接落到正确对象或可解释 fallback。
4. 不得要求用户重新选择项目或搜索对象。
5. 若宿主不支持原位 Full View，返回稳定 deep link 和等价文本说明。

Quick Look 可以建议升级，但不得自动打开或抢走 Chat 焦点。

## 10. 小项目与复杂项目的平衡

### 10.1 三层复杂度模型

| 层级 | 适用情况 | 数据形态 | 默认 UI |
|---|---|---|---|
| L0 Thread-local | 短任务、单人、少量对象、单次会话 | 当前 turn/tool result 的临时对象表 | Chat + Inline/Selection |
| L1 Project Mini-index | 多轮会话、状态会变化、需要恢复或交接 | 轻量 JSON/SQLite/查询索引 | Selection Quick Look 为主，Full View 可选 |
| L2 Project Workbench | 多人/多 Agent、多依赖、历史、审计、比较、批量操作 | 持久 Query Model + change/history projection | Quick Look + Inline Widget +完整 Workbench |

### 10.2 升级信号

是否需要 Dashboard 不由代码行数单独决定，而由以下信号决定：

- 项目跨多个任务或多个会话；
- 多名人员或多个 Agent 参与；
- 存在依赖、阻塞、责任、风险或证据关系；
- 对象状态持续变化；
- 用户频繁查询相关对象；
- 需要比较、审计、历史恢复或交接；
- 需要批量或写操作。

v0.4 不冻结硬编码阈值。阈值应根据真实使用中的 lookup 频率、Full View 转化、放弃率和误触数据校准。

### 10.3 小项目默认规则

- 不强制创建 Dashboard。
- 不强制运行后台常驻索引器。
- 优先使用当前对话/工具结果中的稳定对象。
- 只有 exact ID、name 和少量 alias。
- 无持久索引时，只承诺对已注册对象和精确提及进行 Selection；自由文本概念识别不在 L0 承诺内。
- 无可查询对象时，Selection Quick Look 降级为“询问 Agent 关于选区”。
- 用户可以显式启用或关闭 Project Mini-index。

## 11. 分阶段范围

### 11.1 P0：可验证的点查闭环

P0 必须包含：

1. 当前任务的可信 context scope binding。
2. user/assistant message 文本 selection capture。
3. canonical ID、canonical name 和 scope-local alias 匹配。
4. 0/1/2–3/>3 结果路由。
5. 唯一匹配 Quick Look 和歧义候选菜单。
6. 点击后读取 authoritative detail。
7. 只读详情卡、source、revision、freshness、stale/error。
8. Agent 已知对象的 Inline Widget 与文本 fallback。
9. 对象引用进入 Composer 并回流同一 thread。
10. 无 UI 宿主的完整结构化文本降级。
11. 不要求存在完整 Dashboard；若有 Full View，只提供精确打开入口。
12. 鼠标、键盘、屏幕阅读器和 390px 视口支持。
13. 事件、隐私和研究测量合同。

P0 仍保留用户已经确认的两个目标：**原位详情**与**对象引用回流**。为避免把不同宿主能力混成一个不可诊断门禁，工程与研究按三个可独立验收的切片交付：

- **P0-A Selection Core**：context-scope binding、resolver、Quick Look、authority/freshness、文本 fallback、无障碍与安全；可作为独立可用的 Core 切片发布，但不得标为完整 P0。
- **P0-B Inline Extension**：仅在 `host_inline_rendering` 通过的宿主启用；未通过不破坏已发布的 P0-A，但该宿主不得声明 P0-B 支持。
- **P0-C Referent Roundtrip**：referent Chip、same-thread action 与 model-visible referent；未通过时降级为可复制上下文，且该宿主不得声明 P0-C 支持。

三个切片可以分开试验和使用发布开关；**完整 P0 = P0-A + P0-B + P0-C**，每项对外能力声明都必须按宿主和切片标注 `PASS / UNVERIFIED / UNSUPPORTED`。文本 fallback 是永久产品约束，即使 A/B/C 全部通过也不可删除。Full View 在 P0 只是一项可选 typed handoff capability，不是发布前置条件。

### 11.2 P1：语义识别与已有 Full View 接入

只有 P0 证明时间收益后才进入：

- 用户显式触发的语义概念识别；
- 项目内搜索；
- Quick Look 到已有 Full View 的精确下钻；
- 从已有 Full View 返回 Chat 时恢复原滚动位置和 referent；
- 卡片刷新和受控缓存；
- 结合用户选择生成建议后续问题；
- 通过真实数据校准 Full View 升级提示。

### 11.3 P2：完整工作台与写操作

- 完整 Project Workbench/Dashboard；
- 多对象比较、版本对比、关系图、时间线和局部矩阵；
- 跨会话长期恢复；
- 团队交接与审计；
- 批量选择和批量操作；
- 可确认的写操作；
- 跨项目关系；
- 跨宿主产品化和管理员策略；
- 远程 MCP、认证、租户隔离和商业分发。

## 12. P0 功能需求

### P0-1 Trusted context scope

- 每次 lookup 必须绑定可信 context scope；scope 至少包含 `kind + stable id + provider identity`。
- scope 可以来自已验证的 thread/workspace/project/collection binding，或来自用户显式选择的外部系统上下文。
- 没有可信 scope 时，即使全局只命中一个对象，也必须要求用户明确选择 scope 或 fail closed。
- Renderer/UI 不得提交或覆盖权威 scope ID、entity ID 或详情内容。

### P0-2 Selection affordance

- 仅在 selection completion 后评估通用入口 eligibility；此步骤不得读取 Project Context Index、调用 resolver/模型、发远程请求或新增消息。
- 用户显式点击通用入口后才运行 resolver；唯一 exact match 在同一次点击后直接读取详情，不增加第二次激活。
- affordance 不阻塞复制、标记和原生上下文菜单。
- 新选区替代旧候选；Escape、外部点击、thread/route/context 变化清理 UI。
- 定位使用当前选区几何，滚动、缩放和虚拟化时重定位或关闭。

### P0-3 Candidate resolution

- exact-first；不得为每次选区调用 LLM。
- 唯一 exact match 跳过候选菜单。
- 2–3 个候选必须显示项目、类型和匹配原因。
- 超过 3 个候选不得展示无限列表。
- 解析失败或权限不足时不猜测对象。

### P0-4 Detail card

- 默认只读。
- 首屏展示目标 3–5 个、最多 6 个任务相关事实。
- 始终展示 entity ID、source、revision 和 freshness。
- 支持 `loading`、`current`、`stale`、`partial`、`error`、`unavailable`。
- 关闭后保持原滚动位置并返回焦点。
- 详情失败时保留选中文本和稳定文本 fallback。

### P0-5 Inline output

- Agent 正文始终可独立阅读、复制和引用。
- 单条消息直接显示不超过 5 个高价值对象。
- 普通展开使用随同一 turn 返回的 snapshot，不访问网络。
- Inline Widget 失败不能阻塞正文。
- 历史 Widget 保持原 snapshot；刷新产生明确的新 revision，不静默改写旧消息。

### P0-6 Referent 回流

- referent Chip 可以移除。
- 发送时同时提交自然语言和结构化 referent。
- referent 包含 project、entity、revision 和原始来源。
- Agent 显示 resolved、stale、ambiguous、access_denied 或 unresolved。
- 模型不得在 unresolved 时猜测对象。
- 动作前后必须保持同一 thread；宿主若不能证明则降级为复制结构化上下文。

### P0-7 Full View 入口

- 只有 provider 明确提供 Full View 时展示。
- 必须携带 exact project/entity/revision/view。
- 打开失败显示稳定 fallback，不丢失当前卡片。
- P0 只验证 typed route、精确落点和失败 fallback；从 Full View 返回 Chat 的双向上下文恢复属于 P1。
- P0 不以 Full View 使用率作为成功指标。

### P0-8 文本优先与无 UI 降级

- MCP/data tools 必须在无组件时返回完整 model-readable text。
- 降级文本包含对象名称、关键事实、source、revision 和 freshness。
- 不支持 selection UI 时，提供“询问 Agent 关于选区”或显式 lookup tool。
- 不支持同线程回流时，提供可复制的 referent 文本，并标明限制。

### P0-9 无障碍与安全

- 鼠标、触摸、键盘和屏幕阅读器路径完整。
- Enter/Space 激活，Esc 关闭。
- 候选数量、对象身份和 freshness 可被读屏宣告。
- 390px 视口无页面级横向溢出或关键正文遮挡。
- 对象内容安全渲染，不执行对象携带的脚本或指令。
- Quick Look 普通点击不得触发修改文件、外部发送、购买、部署或其他副作用。
- 写动作不属于 P0。

## 13. 通用协议

### 13.1 Identity、snapshot 与 projection

Project Context 合同使用第 7.2 节四层模型：

- Identity/index record 必须保留 `project_id`、`entity_id`、`entity_type`、`canonical_name`、`authority_ref` 和 `index_revision`。
- Authoritative snapshot 必须保留 `project_id`、`entity_id`、`entity_revision`、`observed_at`、`freshness`、`facts` 和 `source_refs`。
- Surface projection 可以定义 `detail_fields`、本地化 label、排序、actions、fallback text 和组件资源，但不得改变 identity、revision 或事实值。
- Candidate match 只存在于单次 resolver 请求中，不写回 canonical record。

### 13.2 Candidate envelope

~~~json
{
  "project_id": "PRJ-01",
  "entity_id": "WU:GOV-1",
  "entity_type": "work_unit",
  "label": "GOV-1 AEN Harness Foundation",
  "summary": "建立 AEN harness 基础约束。",
  "match_kind": "exact_id",
  "matched_text": "GOV-1",
  "index_revision": "idx-42",
  "indexed_at": "2026-08-17T00:00:00Z",
  "detail_freshness": "unknown"
}
~~~

### 13.3 Referent envelope

~~~json
{
  "user_text": "它与当前方案有什么冲突？",
  "referents": [
    {
      "project_id": "PRJ-01",
      "entity_id": "WU:GOV-1",
      "entity_type": "work_unit",
      "entity_revision": "r18",
      "source_turn_id": "TURN-03",
      "source_item_id": "MCP-08",
      "label": "GOV-1 AEN Harness Foundation"
    }
  ]
}
~~~

### 13.4 推荐工具合同

- `resolve_project_entities`：只输入 bounded selected text；project context 由受信 Host/进程 binding 固定，返回 0–3 个候选、abstain 或 overflow，不读取详情。
- `read_project_entity`：只输入上一步返回的高熵、短时效 `entity_ref`；服务端重新读取 binding/index、验证完整 context tuple 与 index revision，再由 fresh record 派生 authority locator。
- `resolve_referents`：发送前验证 entity identity、revision 和权限。
- `render_entity_card`：仅负责呈现最终结构化数据，不拥有事实。
- `open_full_view`：可选；返回 typed route 或明确 unsupported。

`entity_ref` 是一次局部点查中的 server-minted capability，不是可长期保存的业务 ID，也不是 P0-C 的跨 turn referent envelope。调用方不得传 project ID、workspace root、provider 或 locator 覆盖服务端 binding。

Candidate 的 `indexed_at` 只说明索引何时生成，不能替代详情 freshness；只有 provider-backed authoritative snapshot 可以标记 `current`。

Data tool 与 render tool 应解耦，避免每次数据调用都强制挂载 UI。Host 可以用随机 `selection_nonce`、selection generation 和 thread binding 防止陈旧响应挂载，但这些字段属于 host-private binding envelope，不进入 model-visible referent。短 ID 或短选区不得使用可被字典反推的裸哈希；确需跨事件稳定关联时使用服务端 keyed HMAC。

## 14. 状态、版本与 freshness

### 14.1 Selection 状态

`idle → selection_detected → affordance_visible → resolving → detail_visible`

歧义路径：

`resolving → candidate_menu → resolving_selected → detail_visible`

异常：

`resolving → no_match | ambiguous_overflow | stale | error | unavailable`

### 14.2 Inline Widget 状态

`streaming → committed → object_hydrating → interactive`

异常：

`object_hydrating → partial_interactive | text_fallback | unavailable`

### 14.3 Referent 状态

`unselected → selected → bound_to_draft → submitted → resolving → resolved`

异常：

`resolving → stale | ambiguous | access_denied | unresolved`

### 14.4 Snapshot 规则

- Chat 历史中的 Inline Widget 是不可变 snapshot。
- Quick Look 默认读取 lookup 时的当前 snapshot。
- 卡片内 refresh 可以展示新 revision，但必须标出变化。
- reopen/restart 后不能把空卡或旧本地 UI state 冒充 current。
- 如果无法恢复原 snapshot，显示 stale/unavailable 和重新查询入口。

## 15. 制品与架构边界

### 15.1 推荐制品：Plugin 渐进增强

最终制品不应是 Skill-only，而应采用：

1. **Skill：策略层**  
   定义何时使用 Chat、Selection、Inline 或 Full View；何时调用 data/render tool；如何降级和验证。
2. **MCP server：数据与动作层**  
   负责 project binding、entity resolution、authority query、revision/freshness、结构化结果、referent 验证和文本 fallback。
3. **MCP Apps optional UI：呈现层**  
   在兼容宿主中渲染 Inline Widget 或可交互卡片；UI 不拥有业务事实。
4. **Host integration：选区与宿主能力层**  
   由宿主原生提供，或作为单独资格化的集成负责 selection capture、锚定浮层、同线程回流、确认策略、reopen/restart 和 capability detection；不能假定它可随 Plugin 安装。
5. **Plugin：可移植核心的安装与分发层**  
   打包 Skill、MCP server 配置、资源和 optional Inline UI；不把宿主私有 selection adapter 冒充通用 Plugin 能力。

OpenAI 官方文档说明 Plugin 可组合 Skill、MCP server 和 optional UI，具体能力可能因 surface 不同；同时建议从满足需求的最小形态开始，并保持工具在无 UI 时仍可用：

- [Plugin architecture](https://developers.openai.com/plugins/concepts/plugins)
- [MCP server and UI quickstart](https://developers.openai.com/plugins/build/app-quickstart)
- [Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)

### 15.2 Skill-only 边界

Skill 可以：

- 指导 Agent 何时生成稳定对象；
- 调用 resolver/detail 工具；
- 生成文本 fallback；
- 规定研究和验证步骤。

Skill 不能单独：

- 监听宿主文本选区；
- 创建锚定 UI；
- 接收点击；
- 保证同一 thread 回流；
- 更新宿主 model-visible context。

### 15.3 Selection host integration 边界

当前官方 OpenAI 文档中没有发现一个面向所有 Codex/ChatGPT surface、用于读取任意 Chat Lane 选区并挂载锚定浮层的通用 Plugin/MCP contract。

因此：

- Selection Quick Look 是产品主路径，但实现必须经过目标宿主 adapter qualification。
- 私有 CDP/DOM 注入只能作为受控实验或内部 fallback，不能作为大众分发主线。
- 无 selection adapter 的宿主仍可支持 Inline Widget、显式 lookup tool 和文本 fallback。
- 宿主能力必须按能力检测，不能只按产品名称分支。

### 15.4 Dashboard/Workbench 边界

- Dashboard 是 Project Context Index 的一种高密度 renderer，不是 MCP server 的替代品。
- P0 不要求创建 Dashboard。
- 已有项目系统可提供 typed Full View route。
- 新建完整 Dashboard 属于 P2。
- Quick Look 与 Full View 必须共享 entity identity、authority 和 revision 语义；它们可以使用不同 surface projection，不要求共用同一个详情 renderer。

### 15.5 自有参考宿主

若目标宿主无法满足 selection capture、inline UI 或同线程 referent，可用自有 ChatKit/Agent backend 构建参考宿主。它可以验证完整交互，但回写的是自有 thread，不能冒充原 Codex 任务闭环。

## 16. 模型与数据调用原则

- selection completion：最多做不访问项目数据的本地 eligibility 判断；不调用 resolver、data tool 或模型。
- 用户点击通用 lookup 入口：运行 project-scoped resolver；不调用模型。
- 唯一 exact match：resolver 后直接调用 data tool 读取详情；不增加第二次点击。
- 歧义候选：用户选择候选后调用 data tool 读取详情；不调用模型。
- view/expand/collapse：本地 UI 行为。
- Inline Widget 普通展开：使用同 turn snapshot。
- refresh：用户明确请求后调用 data tool。
- reference：只建立 referent，不立即调用模型。
- message submit：把文本和 referent 写回同一 thread，触发模型。
- semantic recognition：只有用户显式请求且 exact/alias 不足时才允许。
- Full View：由用户显式打开。
- 高风险工具：Quick Look 不直接执行。

## 17. 指标与埋点

### 17.1 生产指标与研究指标分离

生产环境可直接观测的主路径指标：

- `time_to_detail_visible_ms`：从用户显式点击 lookup 入口到正确详情 UI 可见；用于监控 Selection 机制延迟，不等同于用户已经理解或验证事实。
- `detail_open_failure_rate`、`wrong_project_count`、`wrong_entity_open_count` 与 `selection_affordance_false_activation_rate` 作为必要 guardrails。

研究主指标：

- `time_to_verified_fact_ms`：从 A/B/C 共同的 `target_bearing_output_ready` 起点，到参与者提交答案且被独立 gold answer/oracle 判定正确。

研究中的 verified 必须同时满足：

- 对象正确；
- authority/source 可检查；
- revision/freshness 明示；
- 用户在信息题或任务中正确确认；
- 独立评分器或预先冻结的 oracle 判定通过。

Widget、Client 或生产遥测不能自报 `verified`；仅 `detail_visible` 不等于 verified。

### 17.2 机制与次级指标

- `selection_intent_to_detail_visible_ms`
- `inline_activation_to_detail_visible_ms`
- `chat_submit_to_detail_visible_ms`
- `time_to_correct_information_ms`
- `additional_chat_turns`
- `human_active_time_ms`
- `system_wait_time_ms`
- `interaction_count`
- `surface_switch_count`
- `wrong_project_count`
- `wrong_entity_open_count`
- `candidate_top1_accuracy`
- `candidate_recall_at_3`
- `candidate_abstain_accuracy`
- `selection_affordance_false_activation_rate`
- `candidate_menu_abandon_rate`
- `detail_open_failure_rate`
- `stale_detection_rate`
- `freshness_field_coverage`
- `referent_clarification_count`
- `lookup_to_full_view_rate`
- `full_view_identity_preservation_rate`
- `text_fallback_success_rate`
- `detail_render_latency_p50/p95`
- 首次与最终信息题正确率。

### 17.3 最小事件

`lookup_selection_bound` 与 `quick_action_visible` 发生在显式点击前，生产环境只能保留在本地临时状态，不得外发；只有取得明确研究同意的研究构建可以上报其时间戳，且不能上报原始选区。生产侧第一个可外发事件是用户点击产生的 `lookup_intent_submitted`。

- `target_bearing_output_ready`
- `lookup_selection_bound`
- `quick_action_visible`
- `lookup_intent_submitted`
- `resolver_completed`
- `candidate_menu_open`
- `candidate_selected`
- `detail_request`
- `detail_visible`
- `study_answer_submitted`
- `oracle_scored`
- `detail_stale`
- `detail_refresh`
- `detail_close`
- `inline_widget_visible`
- `referent_add`
- `referent_remove`
- `message_submit`
- `referent_resolved`
- `referent_unresolved`
- `full_view_requested`
- `full_view_opened`
- `fallback_rendered`
- `widget_error`

### 17.4 隐私规则

- 默认不记录原始选中文本、完整对话或详情内容。
- 记录 project/entity 的不可逆研究 ID、match kind、revision 和时间戳。
- semantic recognition 发送选区前必须有显式用户动作和适当权限。
- 生产遥测与研究语料分离。
- 失败任务不得从主指标样本中静默删除。

### 17.5 分母与决策合同

正式研究前必须预注册：

- 最小有意义时间差；
- 事实正确率非劣界值；
- 误触、错误项目和 stale 漏检上限；
- 超时、失败、放弃、无匹配和缺失数据的处理；
- 每个 rate 的事件分母；
- 主要比较、置信区间和多重比较处理。

这些阈值由 pilot 的方差与任务基线支持，并在 confirmatory data 解盲前冻结；不得在 PRD 中把未经 pilot 支持的任意百分比写成既有发现。

## 18. 最小研究设计

### 18.1 主效应研究：单对象 point lookup

- A：Chat-only；用户通过新一轮消息获取对象详情。
- B：Selection Quick Look；用户选中文本并原位获取相同详情。
- C：Inline Widget；Agent output 预先携带相同对象 snapshot。

A/B/C 必须使用：

- 相同对象；
- 相同 authoritative data tool；
- 相同字段和事实；
- 相同 freshness；
- 相同最终信息题；
- 相同权限与错误注入。

A/B/C 使用共同起点 `target_bearing_output_ready`：包含目标实体提及的基础回答已经完整、稳定且可交互地显示。不能让 Selection 从“选区已经完成”才计时，也不能让 Inline 从更早或更晚的后台事件计时。

本研究估计的是**端到端产品路径效应**。另外报告三条机制延迟、human-active time 和 system-wait time；Inline 预加载或 Chat 模型等待带来的差异不能被单独归因为 UI 或认知负荷改善。

### 18.2 主效应任务

主效应只覆盖：

1. 唯一 exact entity；
2. 两个歧义 alias；
3. 对 1–2 个当前事实的只读确认。

### 18.3 独立安全与可靠性测试

- 无匹配；
- 跨项目同名；
- stale revision；
- data tool failure；
- permission denied；
- selection 被替换、route/thread 改变和 UI cleanup。

这些场景用于 guardrail 和 fail-closed 判定，不与成功 lookup 的时间主效应混算。

### 18.4 后续独立研究

- Referent 研究：评估结构化引用是否减少澄清回合，不与普通 detail lookup 混为同一实验。
- Full View 研究：比较局部卡片与 Full View 在多对象比较、关系和历史任务中的表现。
- 长时程研究：使用更长任务和回溯场景，单独检验信息密度与状态漂移的影响。

### 18.5 研究方法

- 优先 within-subject crossover。
- 对条件顺序和场景进行 counterbalance。
- Pilot 只用于验证任务、埋点和估计方差。
- 正式样本量基于 pilot effect/variance 做 power analysis。
- 同时报告 total time、human-active time 和 system-wait time。
- 主要结果为 TTVF；正确率为门禁。
- 候选、无答案和 stale 场景必须计算 abstain 和错误项目率。
- 不把后端预加载速度差异全部解释为认知负荷改善。
- Pilot 完成后、正式数据收集前冻结第 17.5 节决策合同。

## 19. P0 验收门禁

### 19.0 当前资格化快照（2026-08-18）

- **已通过（fixture-only）**：在当前 Codex desktop 的受控 loopback CDP 环境中，探针先在可见 user/assistant 消息内构造单一 Range 并触发仅本地的 selection 生命周期；此步骤只生成入口、不会查询。一次可信 CDP 鼠标点击后，显示 fixture 的 `DEC:ARCH-7` 详情、`r4`、`stale` 与来源；不会新增 Chat turn；关闭卡片及停止 Host Adapter 后 renderer 和自有 DOM 均被清理。
- **已通过（private live-workspace implementation）**：Host Adapter 在 callback 前独立读取并校验当前 Codex `threadId + hostId + route + fingerprint`；用户显式 bind 后，注册表固定 canonical workspace root、provider identity、scope hash 与 binding revision。文件索引有数量/深度/字节预算，详情点击后现场读取并以 `live_read` 返回 current snapshot；任务、路由、注册表、根路径或 authority tuple 漂移均 fail closed。显式 status/bind/rebind/unbind 已完成，且全量自动测试 `172 / 172 PASS`。
- **已通过（用户人工门禁）**：用户在当前可见 Chat Lane 中选择三个真实工作区关键词，确认 live detail 展示和关闭交互有效。该证据只资格化当前 Desktop 私有实现，不等于公共 Codex host contract 或大众分发资格。
- **未因此通过**：任意 Codex 版本的 host 兼容性、remote/team Provider、Inline MCP App UI、现有 Desktop 私有 CDP 卡片回流到当前 Desktop 任务，以及大众化插件分发。
- **DCPM/CWA 的位置**：可作为未来 `scope.kind = project` 的参考 Provider 或 Full View，不参与上述 fixture probe，也不是安装或运行前提。

### 19.0.1 App Server referent 资格化快照（2026-08-18）

- **已通过（零 turn 注入）**：全新 Codex App Server 任务执行 `thread/start → thread/inject_items → thread/read`；注入前后 turn 数均为 0，referent 不会自行发起模型生成，精确 probe task 随后删除。
- **已通过（同任务 model-visible context）**：同一 App Server 任务在显式 `turn/start` 后，模型准确返回仅存在于 referent 中的稳定 entity ID、revision 与不可预测验证 token；expected 与 actual 完全匹配。
- **已通过（有界与可追溯）**：`PointableReferentV1` 保留 scope、稳定 entity ID/type、revision、observed time、freshness、verification、最多 5 个 facts/sources，并受 16 KiB 总预算约束；载荷明确标记为 untrusted project data，不作为指令。
- **当前边界**：这是 App Server-owned task 的受支持协议路径，不是把现有 Desktop CDP/DOM companion 的卡片注入当前 Desktop task。两个宿主任务图仍然分离。
- **实现策略**：查看详情不注入、不调用模型；用户显式选择“引用”后才调用 `thread/inject_items`；用户显式提交问题后才调用 `turn/start`。App Server 未文档化 item 级删除/修改，因此更改引用应注入可见的 superseding referent，或新建/分叉任务，不得假装改写历史。

### 19.0.2 App Server 同表面客户端快照（2026-08-18）

- **已实现**：本地 loopback client 在一个 App Server-owned task 中同时拥有 Chat lane、user/assistant message 选区、Quick Look、候选菜单、详情卡、可见 referent tray 和 composer；不自动操作 Codex Desktop DOM/composer。
- **已通过（交互顺序）**：selection 只运行浏览器本地 eligibility；可信点击后才执行 bounded local-workspace lookup；详情引用只执行 `thread/inject_items` 并显示 host-owned chip；显式提交 composer 后才执行 `turn/start`。
- **已通过（真实协议）**：`README.md` live lookup 返回 `file:README.md` 与 content revision；引用后 task turns 仍为 0；后续问题产生非空 Agent delta 流，最终文本与 referent 中的 entity ID/revision 完全一致；probe task 已删除。
- **已通过（浏览器）**：Headless Edge 验证 2 条可见消息、message-only selection、锚定 detail、1 个 referent chip、关闭交互和零额外 lookup/reference turn。
- **安全边界**：HTTP 只绑定 `127.0.0.1`；随机 fragment capability 经专用 header 回传；API/asset/body/header 有界；CSP 禁止外部脚本、frame 和连接；对象内容只通过 `textContent` 投影；candidate/detail 引用是短时、一次性、task-local opaque capability。
- **尚未资格化**：重启后 resume、approval/user-input UI、remote/team Provider、远程认证、多用户隔离、写操作、当前 Windows Inline MCP App 与生产托管。

### 19.1 产品门禁

- 0 匹配在用户显式 lookup 后只显示有界无结果反馈，不生成伪对象卡。
- 唯一 exact match 不经过候选菜单。
- 2–3 个候选显示名称、类型、项目和匹配原因。
- 超过 3 个候选转搜索/Chat，不显示长菜单。
- 选区本身不访问 Project Context Index，不产生 resolver/detail 请求、Chat turn 或模型调用。
- 用户点击后只读取所选对象详情。
- 所有详情都有 project/entity/source/revision/freshness。
- stale、partial、unavailable 不得冒充 current。
- 跨项目错误为 0。
- Inline snapshot、Selection current detail 和 Full View 使用同一 entity identity。
- 无 Dashboard 的小项目仍可完成 exact lookup。
- Widget/UI 失败时原 Chat 与文本 fallback 完整可用。
- 键盘和屏幕阅读器可完成完整点查。
- 无脚本注入、危险自动执行或敏感原文进入默认日志。

### 19.2 同线程回流门禁

- 用户无需重新输入对象名称即可追问。**App Server-owned task：PASS；当前 Desktop 私有 task：未接线。**
- referent action 前后 thread identity 相同。**App Server-owned task：PASS。**
- 模型实际使用稳定 entity ID，而不是只复述 UI 文本。**App Server-owned task：PASS（随机 token 探针）。**
- stale、ambiguous 或 access denied 时模型不猜测。
- 无同线程能力时明确降级，不能声称闭环完成。

### 19.3 Host capability gates

逐宿主验证：

- `project_context_binding`
- `selection_capture`
- `anchored_quick_look`
- `host_inline_rendering`
- `same_thread_action`
- `model_visible_widget_context`
- `text_fallback_supported`
- `full_view_navigation`

某一宿主只有满足其承诺路径所需的全部门禁，才能标记支持该路径。例如，Inline Widget 不要求 `selection_capture`；Selection Quick Look 必须同时通过 `selection_capture` 和 `anchored_quick_look`。

### 19.4 研究门禁

在正式研究前：

- 冻结 oracle 和 gold entity corpus；
- 冻结事件 schema；
- 冻结失败分类；
- 证明 A/B/C 数据内容等价；
- 证明事实正确率不因 UI 条件下降；
- 冻结最小有意义时间差、正确率非劣界值、误触上限、分母和失败处理；
- 不把 pilot 或未经预注册的任意效果量写成“显著”结论。

## 20. 明确非目标

- 自动理解任意自然语言片段。
- 每次选区都调用 LLM 或远程服务。
- 把普通复制/高亮当作查询意图。
- 强制所有项目建设 Dashboard。
- 强制每条 Agent output 生成 Widget。
- 用 Quick Look 替代 Chat 的解释和综合能力。
- 在 P0 中做多实体依赖分析、批量操作或写操作。
- 建立新的隐藏思维链展示。
- 把 UI、缓存或 LLM 输出当作项目事实 authority。
- 声称无需适配即可跨任意 Agent/宿主运行。
- 以私有 CDP/DOM 注入作为大众产品的唯一运行时。
- 用 Widget 或 Dashboard 取代可复制、可引用的自然语言回答。

## 21. 主要风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 选区只是复制而非查询 | 误触、干扰原行为 | selection 不请求；显式 affordance；低打扰显示 |
| 概念识别过宽 | 候选多、延迟高、错误率高 | exact-first；候选上限；语义识别显式触发 |
| 错误项目绑定 | 展示错误事实 | trusted binding；跨项目消歧；fail closed |
| 状态陈旧 | 快速展示错误信息 | authoritative detail read；revision/freshness/stale |
| Inline Widget 过多 | Chat 碎片化 | 每 turn 最多 5 个；只显示高价值对象 |
| 连续卡片替代不了比较 | 上下文切换增加 | 建议 Full View；不强迫在小卡中完成复杂任务 |
| 小项目维护成本过高 | 用户放弃 | L0/L1 轻量模式；Dashboard 可选 |
| 宿主 selection 能力缺失 | 主路径不可用 | 单独资格化 host integration；显式 lookup；Inline/text fallback |
| UI 宿主差异 | 体验断裂 | capability detection；逐宿主 Gate |
| 详情视觉放大错误权威感 | 错误决策 | source、revision、freshness 常驻 |
| selection 文本泄露 | 隐私风险 | 本地预判；显式发送；默认不记录原文 |
| 点击触发隐藏动作 | 信任和安全问题 | P0 只读；写动作另行确认和分级 |
| 历史 Widget 被当作 current | 状态漂移 | immutable snapshot；刷新产生新 revision |
| Dashboard 切换丢失上下文 | 重复定位 | typed project/entity/revision handoff |

## 22. 当前参考实现与证据边界

### 22.1 DCPM CWA / WU Quick Look

本地 DCPM 的 WU Quick Look 是有价值的交互参考：

- 用户在 Chat/Side Chat 中选中包含唯一 WU Key 的文本；
- 私有 CDP Renderer Enhancer 显示“查询 CWA”入口；
- 点击后 daemon 直接读取 Query Model 的 matrix/detail；
- CWA Vue SSR 生成只读文档；
- Renderer 在选区附近挂载浮层。

它证明：

- 选区锚定 Quick Look 可以减少打开完整 CWA 的需要；
- CWA 和 Quick Look 可以共享一个 authoritative query path；
- Dashboard 不必已经打开，Quick Look 也能工作；
- 详情卡应保留打开完整视图的可选入口。

它不证明：

- 标准 Plugin 可以读取任意 Codex 选区；
- 该能力可跨宿主分发；
- 点击会把结构化 referent 写回同一 Agent task；
- 私有 CDP/DOM 注入适合大众产品。

参考：

- `D:/github repository/dcpm/docs/cwa.information-architecture.md`
- `D:/github repository/dcpm/docs/dev-18f.codex-chat-lane-wu-quick-look-widget.technical-design.md`
- `D:/github repository/dcpm/apps/daemon/server-process.ts`

### 22.2 CWA 的产品定位

CWA 是 Companion Web App：项目态势、工作台和应用级排查主界面。它与 Dashboard 有重叠，但更广，包含 Project Home、Progress、Matrix、Board、Gantt、Burndown、Quick Look、History 和 Inspector。

本 PRD 借鉴其“共享 Query Model + 局部 Quick Look + 完整 Workbench”的分层，不要求目标产品依赖 DCPM 或复制 CWA 全部能力。

DCPM/CWA Adapter 的正式定位是 **optional reference Provider**：用于验证复杂项目、持续状态与 Full View 下钻；它不得成为通用实体协议、Selection、Inline、Referent、P0 研究原型、构建或安装的前置条件。`WU:GOV-1` 等字段仅是兼容性 fixture / DCPM-shaped example，不定义产品领域模型。

### 22.3 MCP App 证据

本地 DCPM 的 DEV-59 evidence 在 `Codex Desktop 26.721.41059 (build 5848)`、`macOS 26.5.2`、package `gux-inline-app-preflight@0.1.1`、source digest `e8e6159443e2f3cd5375b199fde2edaa0f6c6e8863ed381bf1bf27ce97f2a7ae` 上取得第三方 MCP App iframe、structured result、Widget→tool callback、经确认的 follow-up、reopen/restart 和 failure recovery 证据。

这提高了 Plugin/MCP App 路线的可行性，但不能外推到：

- 当前 Windows Codex build；
- CLI/IDE；
- 所有未来版本；
- Selection capture；
- 大众远程分发和管理员策略。

参考：

- `D:/github repository/dcpm/docs/evidence/dev-59/gux-inline-app-preflight/codex-inline-app-capability-report.md`

## 23. 已确认决策与待验证前提

### 23.1 已确认产品决策

1. 首个研究与资格化宿主仍是当前 Codex desktop；这不是已经具备可发布 Selection contract 的声明。
2. 产品从“Inline Widget only”调整为 **Inline + Selection 双入口**。
3. Selection Quick Look 是用户拉取式点查主路径。
4. Agent 已知对象时 Inline Widget 仍是最低操作数路径。
5. P0 同时保留原位查看详情和对象引用回流，但按 Selection Core、Inline Extension、Referent Roundtrip 三个切片独立验收。
6. Inline 路径详情随同一 turn 的结构化结果返回；Selection 路径在用户点击后读取 authoritative detail。
7. 单条消息直接显示最多 5 个 Inline 对象。
8. 唯一 exact selection 跳过候选菜单。
9. 2–3 个高置信对象才显示候选菜单。
10. Dashboard 不再被全面排除，但不是 P0 必需品。
11. 小项目默认不建设完整 Dashboard。
12. Project Context Index 与 UI 分离。
13. 信息获取时间仍是主要价值，但指标更新为 TTVF。
14. P0 只读；写操作延后。
15. 可移植核心优先为 Plugin + Skill + MCP server + optional Inline UI，而不是 Skill-only；Selection host integration 由宿主提供或单独资格化，不能假定随 Plugin 分发。

### 23.2 v0.3 决策的继承与修订

| v0.3 决策 | v0.4 处理 |
|---|---|
| 同一 response lane 原位详情 | 保留，适用于 Inline；Selection 使用选区锚定浮层 |
| 对象引用回流同一 thread | 保留 |
| 详情随消息预返回 | 只对 Inline 路径保留；Selection 点击后查询 |
| 每消息最多 5 个对象 | 保留，仅针对 Inline 对象 |
| Dashboard 为非目标 | 修订为“强制 Dashboard 是非目标；按复杂度启用 Full View” |
| 任何对话的通用性 | 保留为领域协议目标，但要求宿主 adapter 和逐宿主 Gate |
| 当前 Codex 三项门禁 UNVERIFIED | 保留为 2026-08-16 Windows 宿主审计快照，并新增 selection gates |

### 23.3 待验证前提

- 当前 Windows Codex 是否提供可依赖的 selection capture 与锚定 UI contract。
- 当前 Windows Codex 是否实际渲染第三方 MCP App UI。
- 当前 Desktop 私有 CDP 卡片 action 是否能通过受支持合同回到当前 Desktop task；App Server-owned task 已通过。
- 结构化 referent 是否进入下一轮 model-visible context；App Server-owned task 已通过，其他宿主仍需分别资格化。
- 小项目使用 L0/L1 模式时，索引维护成本是否低于重复 Chat 成本。
- 用户能否发现 Selection Quick Look，而不干扰复制行为。
- exact/alias resolver 在真实项目中是否足以覆盖主要点查，不依赖 LLM。
- 何种 lookup 行为最能预测用户需要 Full View。

## 24. 推荐下一阶段

已完成：冻结 v0.9 通用 context-scope 与切片边界；建立无 UI Context Index/resolver/detail baseline；完成 fixture-only Plugin/MCP、常驻 fixture companion、宿主复验任务 tuple、显式 task→workspace 注册表、只读本地文件索引/live Provider，以及常驻 live local-workspace companion。用户已手动验证三个关键词、live detail 和关闭交互；live companion 又完成仅显式触发的 Plugin Skill、status/bind/rebind/unbind 最小管理面和真实 unbind→rebind 回读。

后续推荐顺序：

1. **已完成**：App Server referent 协议和最小同表面 conversation client 已通过自动测试、真实模型读回与 Headless Edge 交互验收。
2. 复用同一对象/referent 合同扩展 MCP App 探针，分别验证 Inline、tool callback、referent、model-visible context 和 lifecycle；能力按宿主独立标记。
3. 把 App Server client 收窄为 A/B/C 最小研究原型；先研究唯一 exact point lookup，再加入候选歧义和 stale，并正式采集 TTVF。
4. 只有时间收益、正确率和误触门禁通过后，才进入 task resume、approval UI、Markdown 概念索引、语义识别、Full View 与大众产品化；remote MCP、认证、管理员策略、遥测、隐私和发布审核在此阶段补齐。
5. DCPM/CWA、GitHub、Linear、论文库继续仅作为可选 Provider；不得反向定义核心实体协议。

## 25. 变更记录

- v0.11：完成最小 App Server-owned conversation client；同一表面提供 Chat、message selection、局部文件详情、candidate/detail opaque capability、可见 referent chip、SSE Agent 输出与后续追问。真实 App Server 验证引用后 0 turns、后续产生非空 delta 流并精确读回 entity/revision；Headless Edge 验证详情、chip 与关闭。加入 loopback token、CSP、有界 API、turn abort 和 text-only projection；自动测试更新为 `178 / 178 PASS`。明确其为本地研究 client，不等同于当前 Desktop task bridge 或生产 Chat replacement。
- v0.10：按推荐路线新增 `PointableReferentV1`、有界 Codex App Server JSONL client 与 referent session；实跑 `thread/inject_items` 证明引用注入不新增 turn，并在同一 App Server task 的后续显式 turn 中准确读回 entity/revision/随机 token。自动测试更新为 `172 / 172 PASS`。明确区分 App Server-owned task 已通过与现有 Desktop 私有 CDP 卡片尚未回流当前 Desktop task；下一阶段改为最小 App Server conversation client，而不是自动操作 Desktop composer。
- v0.9：在不依赖 DCPM/CWA 的前提下完成宿主复验的 Codex task tuple、显式 task→workspace 注册表、opaque workspace scope、本地文件 exact index、点击后 `live_read` 详情与常驻 workspace companion；旧 fixture companion 与 live companion 明确互斥运行。注册表/任务/路由/根路径/authority tuple 漂移均 fail closed；文件数量、目录深度、路径和读取大小均有硬预算。自动测试更新为 `164 / 164 PASS`。用户已手动验证三个工作区关键词、live detail 与关闭交互；companion 已封装为仅显式触发的 Skill，真实 status/unbind/rebind 回读通过；`docs/codex-desktop-host-compatibility.md` 冻结当前 Desktop 私有支持面与版本失效规则。
- v0.8：将一次性 Selection Host probe 扩展为显式启停的 fixture-only 常驻 companion；加入周期目标发现、断线重连、本机令牌控制面和优雅清理；用可信 CDP 鼠标拖选验证 `GOV-1` 的选区惰性、点击后原位详情、零新增 turn 和 companion 持续运行。根据人工反馈修复原生选区折叠竞态与关闭后 UI 重建，新增 Edge 真实浏览器的“拖选 → 详情 → 关闭 → 250ms 无重建”回归。该资格化仍不代表 Plugin 能自动启动 Selection Host，也不代表真实项目数据已接入。
- v0.7：纠正 DCPM/CWA 反客为主的实施偏移；核心合同改为通用 trusted context scope，DCPM 降级为 optional reference Provider，Selection/Inline/Referent 与研究原型均不得依赖 DCPM。推荐顺序改为先打通真实 Chat Lane 交互和通用 fixture，再按需接外部 Provider。
- v0.6：按已裁决的路线 3 交付 fixture-only Headless MCP Plugin；实现 `resolve_project_entities → entity_ref → read_project_entity`、自包含 stdio bundle、个人 marketplace 安装和 Codex CLI 0.146 app-server 直调；95/95 自动测试与独立安全审计通过。明确该结果不代表当前 Desktop、生产 CWA binding、Selection 捕获、锚定 UI、Inline Widget 或同任务回流已通过。
- v0.5：新增 P0-A 实施快照；完成无 UI eligibility、显式 activation、project-scoped resolver、authority/freshness 合同、文本 fallback、开发 fixture/CLI、Plugin manifest 与 Skill；记录生产宿主、MCP 打包 schema 和启动路径仍未闭合，不把基础切片误标为完整 P0-A 或 Codex UI 支持。
- v0.4：将产品从 Agent 主动 Inline Widget 扩展为 Inline + Selection 双入口；新增 Project Context Index、exact-first resolver、0/1/2–3/>3 路由、Selection Quick Look、按复杂度启用的可选 Dashboard、小项目 L0/L1/L2 分层、TTVF 指标、selection host gates 与 CWA/DCPM 参考实现边界；修订“详情预返回”和“Dashboard 非目标”的适用范围。
- v0.3：完成 Codex desktop 只读宿主能力审计；区分官方协议支持、当前安装包实现线索与端到端运行时证据；将原位要求校正为同一 Agent turn/Chat Lane 内锚定；增加三项硬门禁及最小探针验收方案。
- v0.2：确认当前 Codex desktop 为首个目标宿主；确认 P0 同时包含原位详情和对象引用回流；确认 Inline 详情预返回、本地展开及每条消息最多 5 个对象。
- v0.1：形成产品目标、范围、对象协议、交付形态、指标和研究边界的首版草案。

## 26. Codex desktop 宿主能力审计附录

### 26.1 审计快照

- 目标宿主：Windows ChatGPT desktop app 内的 Codex。
- 本机安装包快照：`OpenAI.Codex_26.810.7004.0_x64`。
- 本机 bundle/插件只读观察日期：2026-08-16。
- 官方 OpenAI 文档复核日期：2026-08-17。
- 2026-08-17 已在个人 marketplace 安装 fixture-only Headless MCP Plugin，并用 npm Codex CLI 0.146 的全新 app-server 直接完成无模型 `resolve → read` 探针；这不等同于 Desktop 包内 runtime 或 selection/UI 探针。

判定：

- `PASS`：指定宿主和版本取得端到端运行证据。
- `SPEC_SUPPORTED`：官方协议或其他宿主明确支持，但目标宿主尚未实测。
- `PRIVATE_REFERENCE`：私有/宿主特定实现已证明可能，但不是公开稳定 contract。
- `UNVERIFIED`：目标宿主缺少关键运行证据。
- `FAIL`：目标宿主可重复观察到不支持或行为错误。

### 26.2 官方支持边界

截至 2026-08-17 复核：

1. Plugin 可以组合 Skill、MCP server、structured results 和 optional UI；能力可能 surface-specific。
2. MCP tools 和 model-readable results 面向 ChatGPT 与 Codex。
3. 官方 quickstart 明确将 optional iframe UI 表述为 ChatGPT UI；其他 MCP Apps-compatible hosts 需要单独确认。
4. MCP Apps 定义 `tools/call`、`ui/message` 和 model-visible context 机制，但不等同于当前 Windows Codex 已完成运行时支持。
5. 官方文档中未找到通用 Chat Lane selection capture/anchored popover contract。
6. Tools 必须在无 UI 时仍可完成 headless workflow。

### 26.3 本机与本地仓库证据

- 当前 Windows bundle 存在 MCP App renderer/bridge 实现线索，但代码存在不等于 task runtime 已启用。
- 当前任务没有现成 UI resource probe 可直接闭合 Windows 端到端证据。
- DCPM DEV-18F 的 private CDP Renderer Enhancer 已证明 selection-anchored Quick Look 交互可能，结论为 `PRIVATE_REFERENCE`。
- DCPM DEV-59 在一个指定 macOS Codex Desktop build 上达到 MCP App lifecycle qualification，但结论不能迁移为当前 Windows `PASS`。

### 26.4 门禁矩阵

| 能力 | 当前结论 | 升级为 PASS 所需证据 |
|---|---|---|
| `project_context_binding` | `UNVERIFIED` | task/thread/workspace 与 project identity 可重复唯一绑定；歧义 fail closed |
| `headless_bundled_mcp_cli` | `PASS_CLI_0_146_FIXTURE` | 已安装 Plugin 归属、server readiness、两工具直调、structured/text fallback 与 fixture verification 均通过；生产 adapter 另行门禁 |
| `selection_capture` | `PRIVATE_REFERENCE / UNVERIFIED_PUBLIC` | 真实用户选区被公开或正式 adapter 捕获，不污染 copy/composer/nav |
| `anchored_quick_look` | `PRIVATE_REFERENCE / UNVERIFIED_PUBLIC` | 当前选区附近挂载、滚动/缩放/route/cleanup 均通过 |
| `host_inline_rendering` | `UNVERIFIED` | tool 返回唯一 nonce UI resource 后，活组件实际出现在当前 Codex task |
| `same_thread_action` | `UNVERIFIED` | 点击前后 thread ID 相同，无 fork/新窗口，并追加可审计 action |
| `model_visible_widget_context` | `UNVERIFIED` | 下一轮模型联合使用原任务 secret 与点击时 action nonce |
| `text_fallback_supported` | `PASS_CLI_0_146_FIXTURE / SPEC_SUPPORTED` | fixture 直调已返回等价结构化结果与 bounded model-readable text；生产 authority 仍需复验 |
| `full_view_navigation` | `PRIVATE_REFERENCE / UNVERIFIED_PUBLIC` | exact project/entity/revision 落点与失败 fallback 通过 |
| `reopen_restart_lifecycle` | `UNVERIFIED_WINDOWS` | reopen、完整 App restart、多 revision、offline/retry/recovery 通过 |

### 26.5 最小宿主探针

Selection probe：

1. 在当前 task 的 user/assistant text 中选中唯一 nonce。
2. 证明普通 selection 不产生 remote/tool/model request。
3. 显式点击 affordance 后，返回与 nonce 绑定的 card。
4. 验证滚动、缩放、Escape、外部点击、route/thread 变化和 uninstall cleanup。
5. 验证 copy、composer、nav、terminal、diff 和 browser 不被劫持。

Inline/referent probe：

1. MCP tool 返回唯一 `render_nonce` 的 UI resource 和等价文本。
2. card 本地展开不调用模型、不新增 turn。
3. “引用并追问”在点击时生成唯一 `action_nonce`。
4. 动作写回同一 thread。
5. 下一轮模型必须联合使用 `action_nonce` 与 Widget 不知道的原 task `checkpoint_secret`。
6. 三个全新任务连续通过后，相关能力才可标记 `PASS`。

总体结论：

- 产品方向已经从单一 Inline Widget 收敛为更完整的 Selection + Inline + Optional Full View。
- Plugin/MCP 是推荐的数据与分发主线。
- Headless MCP 的个人 Plugin 安装与 CLI 0.146 直调已通过，但当前 server 只绑定 bundled mini-project fixture。
- Selection Quick Look 仍依赖目标宿主 adapter qualification。
- 当前 Windows Codex 尚未通过完整实现门禁，但也没有被判定为不支持。
- 在门禁闭合前，完整文本 fallback 是不可删除的产品能力。

## 27. P0-A 实施快照

### 27.1 当前制品

实现根目录：`D:\github repository\CHI\pointable-context`

当前制品是 **P0-A 的无 UI 基础切片 + fixture-only Headless MCP Plugin**，不是完整 P0-A，也不是 Selection Quick Look 的宿主实现。它包含：

- Codex Plugin manifest、`.mcp.json`、自包含 `mcp/server.mjs` 与 fixture-specific `pointable-context` Skill；
- 纯本地、点击前不读取项目数据的 selection eligibility；
- 只能由受信宿主显式动作处理器调用的 activation ticket；ticket 与选区、selection generation、project/thread/route context 及候选绑定，并且一次性消费；
- project binding、Context Index、authority provider 的端口合同；
- exact key、canonical name、project-local alias、唯一 normalized exact 的确定性 resolver；
- `0 / 1 / 2–3 / >3`、mixed type 与 normalized ambiguity 的有界路由；
- authority identity、revision、observed time、freshness 与 source 验证；
- 无 UI 时仍可核验来源、版本、新鲜度与关键事实的 Markdown-safe 文本 fallback；
- stdin-first CLI、开发 fixture 与自动测试；
- `resolve_project_entities` 与 `read_project_entity` 两个无 UI 只读工具；
- 进程内高熵 `entity_ref`：5 分钟 TTL、4,096 容量 fail closed，并绑定完整 TrustedBinding tuple、实体身份与 index revision；
- 个人 marketplace staging、版本 cachebuster、安装缓存和无模型 app-server 直调探针。

文件型 binding/provider 明确命名为 fixture/development adapter。它只证明协议和失败路径，不代表生产宿主信任，也不能把 fixture snapshot 声称为 `current`。

### 27.2 已落实的重点策略

1. **普通选区保持惰性**：eligibility 不访问 index、provider、模型或网络；只有显式 action 才能签发 activation。
2. **项目身份先于检索**：无 binding、歧义、binding 漂移、跨项目 record 或重复 canonical identity 均 fail closed。
3. **exact-first、LLM-later**：P0 resolver 无模型依赖；多个弱 normalized match 不伪装成高置信候选。
4. **候选不预取详情**：2–3 个候选只返回 index 摘要与 `detailFreshness=unknown`，用户再次显式选择后才读 authority。
5. **异步读取后重校验**：index 和 provider 每次异步读取后都重新读取 live binding；context 改变时不返回旧候选或旧详情。
6. **current 必须有证据**：`live_read` 要求 snapshot 与 verification 位于有界新鲜度窗口；`revision_check` 必须携带并匹配 `verifiedRevision`；fixture read 不得建立 current；验证后的 method/time/revision 会保留在结构化结果与文本投影中。
7. **输出即安全边界**：拒绝危险 key、原型污染、跨项目/身份错配、不可见 semantic identity、未来 timestamp、超限对象与伪造 metadata；文本输出有 UTF-8 字节硬上限并中和 Markdown/链接/双向文本注入。
8. **CLI 默认保护原文**：选区默认经 stdin 输入，JSON eligibility 不回显原文；未解析、候选、无结果与 overflow 使用不同非零退出码。
9. **查询工作量必须有硬边界**：Context Index 在 resolver 前执行集合级预算；最多 2,048 条 record、4,096 个 alias、2 MiB 已验证 UTF-8 与 8 Mi resolution work units，超限即 fail closed，不让合法但极端输入把一次点查拖入十几秒 CPU 扫描。
10. **取消与超时贯穿端口**：caller abort 与默认 5 秒单操作 deadline 传入 binding、index、revalidation 和 provider；即使坏适配器忽略 `AbortSignal` 且永不返回，core 也会有界退出；端口真正开始前再次检查取消，并在同步阻塞返回时用单调时钟复核 deadline，区分 `request_aborted` 与可重试的 `operation_timeout`。
11. **文本 fallback 永久保留**：UI、MCP 或宿主能力缺失不影响模型和人读取同一 authority 结果。
12. **Resolve 不预取、Read 不信任调用方 locator**：候选阶段 provider 调用数必须为 0；详情阶段只接受 server-minted `entity_ref`，每次重读 binding/index 后从 fresh identity record 派生 locator。
13. **Fixture 声明贯穿全链路**：server identity、Skill、Plugin metadata、structuredContent 与文本均明确 `FIXTURE-ONLY`；不得把 mini-project 结果表述成当前项目或 CWA 事实。

### 27.3 当前验证结果

| 验证项 | 结果 | 边界 |
|---|---|---|
| TypeScript build/typecheck | `PASS` | 只覆盖无 UI core 与开发 adapter |
| 自动测试 | `95 / 95 PASS` | unit、contract、security/performance、timeout/abort、MCP memory/stdio/bundle 与 CLI E2E |
| 独立 MCP 安全审计 | `PASS` | 当前 fixture probe 无已知 P0/P1/P2；依赖审计 0 个已知漏洞 |
| Plugin manifest validator | `PASS` | manifest、`.mcp.json`、Skill 与 bundled entrypoint 均已包含 |
| Skill validator | `PASS` | Skill 仅在用户明确要求 fixture/demo 时触发，并拒绝模拟生产 authority |
| stdin CLI 手工 lookup | `PASS` | 使用 stale fixture，不代表 live production data |
| MCP v2 in-memory/stdio | `PASS` | 官方 v2 client 覆盖源码入口和自包含 bundle；legacy 2025-06-18 stdio 亦通过 |
| 个人 marketplace 安装 | `PASS` | `pointable-context@personal` 已启用，缓存制品与 staging bundle hash 一致 |
| Codex CLI app-server 直调 | `PASS_CLI_0_146_FIXTURE` | plugin/read 归属、MCP readiness、`GOV-1` resolve/read、`fixture_read` verification、无 UI metadata 全部通过；未调用模型 |
| 单端口 deadline / caller abort | `PASS` | 四类端口均有取消信号与 5 秒默认 deadline；同步阻塞返回也不能伪装成功 |
| 端到端延迟预算 | `TUNING_REQUIRED` | 当前按端口分别计时，唯一详情路径最坏可累计约 25 秒；真实宿主接入后须按目标 p95 设置总请求 deadline 与索引策略 |
| `project_context_binding` | `UNVERIFIED_PRODUCTION` | 仅 fixture binding 已验证 |
| `selection_capture` | `UNVERIFIED_PUBLIC` | 尚未接入当前 Codex Chat Lane |
| `anchored_quick_look` | `UNVERIFIED_PUBLIC` | 尚未实现宿主浮层、定位、清理与无障碍路径 |
| MCP bundled runtime | `PASS_CLI_0_146_FIXTURE / UNVERIFIED_DESKTOP` | camel `mcpServers` + `cwd:"."` + 相对 bundle/fixture 已在 CLI app-server 通过；Desktop 包内 runtime 尚未复验 |
| P0-B / P0-C | `NOT_STARTED` | Inline 与 referent 均不由本切片声称 |

### 27.4 当前阻塞与裁决点

无 UI core 与路线 3 的首个 Headless MCP fixture 已闭环；下一步视觉交互仍需按宿主分别资格化：

1. **Codex private enhancer 路线**：最快得到当前 Windows Codex 中的真实选区浮层，但依赖私有 DOM/CDP contract，移植性和发布性最低。
2. **自有 reference host 路线**：最容易把 selection、anchoring、cleanup、无障碍与研究事件做成稳定公开合同，但不能直接证明当前 Codex 支持。
3. **Headless MCP Plugin 路线**：先把 authority tool 接入 Codex/ChatGPT，再等待或单独资格化 UI host；最接近可分发数据层，但短期仍没有选区旁浮层。

MCP 打包合同已通过运行探针收敛：制品使用本机 validator、Codex 0.146 同版本 parser 与真实 CLI app-server 均接受的 camel `{ "mcpServers": ... }`；显式 `cwd:"."` 被锚定到安装缓存的 Plugin root，相对 `./mcp/server.mjs` 与 `./fixtures/mini-project` 均成功。制品不使用 `${PLUGIN_ROOT}`。官方网页对 snake wrapper 的表述与当前 runtime parser 仍有文档漂移风险，因此保留 contract regression，不将 CLI 结论外推到其他版本或 Desktop。

### 27.5 裁决后的最小下一步

- 若选择路线 1：只做 nonce selection probe、惰性证明、锚定/清理和 copy/composer/nav 排除，不先接领域详情 UI。
- 若选择路线 2：实现最小 reference host，并直接复用当前 core 的 eligibility、activation、resolver 与 fallback。
- 路线 3 已完成第一门：两个无 UI MCP tools、打包、个人安装、CLI app-server 探针与 Desktop 新任务 fixture 调用均通过。下一门是通用 context-scope 与真实 Selection/Inline 宿主资格化；外部 Provider 接入独立排期。

三条路线都必须继续复用同一 core 和通用 fixture；不得另建一套 Dashboard 数据源或把旧静态 Demo 当作生产事实层。DCPM/CWA、GitHub、Linear、论文库等只通过 Provider Registry 接入。

# PRD：Quiet Context Reveal（选区式上下文速览）

- 版本：v1.6
- 状态：摘要优先、当前 build 启动兼容性自检与文件 revision 原位刷新切片完成；进入场景摘要验证阶段
- 日期：2026-08-18
- 产品名：Pointable Context
- 首个宿主：Codex Desktop 原生 Chat Lane
- 首个场景：长时程软件开发任务

> 本文档取代 v1.0 以“Agent 输出旁默认显示 Context Capsule”为主入口的定义。v1.0 的类型化详情卡、可信对象引用、新鲜度校验和零 Chat Turn 约束继续复用；默认可视入口改为用户选区后的轻量按钮。浏览器、Dashboard、DCPM/CWA 和语义模型识别均不是主链。

## 1. 一句话产品定义

当用户在 Codex Chat Lane 中读到压缩的文件、模块、概念、决策或任务状态时，可以选中相关文字，看到一个不打扰阅读的小型“查看上下文”入口；点击后在原阅读位置附近打开有界、可验证的详情卡，无需离开当前任务、打开完整文件或再发起一轮 Chat。

## 2. 为什么调整方向

长任务会不断创建文件、修改模块、引入概念、形成决策并改变状态。Agent 的瀑布式输出必须压缩这些变化，用户因此需要在旧消息、当前代码和文档之间重建上下文。

v1.0 证明了原生 Chat Lane 中的胶囊能够展开、收起、显示来源/修订/新鲜度，而且不产生新 Chat Turn。但默认把胶囊放在每段输出旁会带来新的问题：

1. 用户没有查询意图时，胶囊仍占据 Chat Lane；
2. 对象多时，消息会被 UI 装饰切碎；
3. Agent 必须预判用户想查看哪个对象；
4. 小项目和简单消息会被过度结构化。

因此，产品改为“信息潜伏、用户拉取”：普通 Chat 保持原样，只有用户对某段文字产生局部理解需求时才出现入口。

## 3. 北极星目标

### 3.1 用户结果

用户从当前 Chat 中看到一个压缩引用，到确认一个正确、可追溯事实，应尽量做到：

- 不输入新问题；
- 不等待语言模型生成；
- 不打开浏览器或完整 Dashboard；
- 不离开当前阅读位置；
- 只看到与当前选区相关的少量信息。

### 3.2 核心指标

主指标：`time_to_verified_fact`，即从用户完成选区到确认正确事实的时间。

辅助指标：

- `chat_turns_to_fact`：为该事实新增的 Chat Turn 数；
- `lane_leave_rate`：是否离开当前 Chat Lane；
- `wrong_entity_rate`：是否打开错误对象；
- `card_sufficiency_rate`：卡片是否足以完成点查；
- `selection_interference_rate`：产品是否干扰普通复制、选择和阅读。

### 3.3 产品主张

在长时程、高信息密度的软件开发任务中，对用户主动选中的稳定项目对象提供零 Chat Turn、原位、类型化的 Context Quick Look，可以降低事实点查的寻址和理解成本，同时保持普通 Chat Lane 的视觉完整性。

这是待验证的研究主张，不是当前已被正式实验确认的结论。

## 4. 冻结的交互原则

### 4.1 Selection-triggered, not selection-requested

选中文字只触发本地、无数据读取的资格判断。只有可信的用户点击或键盘动作才允许查询 Context Index 或 Provider。

### 4.2 Agent-known data, user-pulled UI

Agent 工作过程中已知的文件、模块、决策、任务和验证结果仍是最可靠的数据来源，但这些对象默认只进入后台 Context Index，不自动变成可见胶囊。数据可以由 Agent 产生，界面必须由用户需求触发。

### 4.3 No semantic-model recognition

P0 不提供“识别更多概念”、自然语言语义扩展、LLM 候选生成或选区解释。Codex 已经能够处理开放式语义提问；在 Selection 管线中再加入模型只会增加延迟、歧义、隐私风险和重复能力。

识别顺序仅限：

1. exact canonical key；
2. exact 文件名/路径或稳定名称；
3. 当前 scope 内的确定性 alias；
4. 无匹配则保持安静。

### 4.4 Quiet by default

- 没有选区：零 UI；
- 普通复制/高亮：不查询、不抢焦点；
- 无匹配：点击后不显示详情卡，入口随选区清理；
- 关闭后：不因原选区仍存在而自动重开；
- 一次只显示一个入口和一个详情表面。

### 4.5 Native-lane-first

默认体验必须发生在当前 Codex Desktop 任务中。独立网页、localhost Dashboard、App Server conversation client、CWA 或其他侧边工作台不能作为 P0 默认入口或验收替代品。

### 4.6 Zero-turn and zero-model detail

打开、切换、展开、收起和关闭详情均不得创建 Chat Turn，也不得调用模型生成已有事实。卡片不足时，用户仍可使用 Codex 原有输入框；产品不额外提供“问 Agent”按钮。

### 4.7 Authority before polish

详情必须包含稳定身份、来源、修订、观察时间和 freshness。无法验证时显示 stale、partial、fixture 或 unavailable，不以流畅 UI 掩盖不确定性。

## 5. 核心用户旅程

### 5.1 唯一匹配

1. 用户在可见的 user/assistant 消息中选择 `architecture.md`、`ContextScopeRef` 或 `ARCH-7`。
2. 本地规则只确认选区长度、表面、连接与可见性合格，然后显示小型“查看上下文”按钮；此时尚未读取 Context Index。
3. 用户点击按钮，Host 才以 exact key/name/path/alias 做确定性解析。
4. 唯一匹配时读取当前权威快照，并复验 task、route、scope、selection digest、对象身份与 revision。
5. 选区附近打开类型化详情卡。
6. 用户关闭卡片，焦点和滚动位置恢复；Chat Turn 数不变。

### 5.2 两到三个歧义匹配

1. 用户选中的稳定名称在当前 scope 内对应 2–3 个对象。
2. 点击后显示候选菜单，每项包含名称、类型、scope 和匹配原因。
3. 用户选择一项后才读取详情。
4. 候选阶段不预取详情。

### 5.3 无匹配或结果过宽

- 0 个匹配：不显示项目详情卡，入口随 selection 清理；
- 超过 3 个或类型混杂：不展示长菜单，只提示缩小选区；
- 不把选区发送给模型，也不自动转成 Chat 提问。

### 5.4 完整内容升级

只有用户需要全文、跨对象比较、依赖分析、批量操作、审计或编辑时，才显示“打开完整内容”。这是次级、显式动作，不能在首次 Quick Look 时自动跳转。

## 6. 首个开发场景

### 6.1 文件或文档

选中 `architecture.md` 或 `PRD-inline-pointable-widgets.md` 后，卡片显示：用途、本次变化、影响范围、关键章节、revision、observedAt、freshness 和来源。

### 6.2 模块或项目内概念

选中 `src/adapters/local-workspace.ts` 等 TypeScript/JavaScript 模块后，卡片显示：职责、公开入口、本次变化、直接依赖与字面引用/测试关联、路径。选中 `ContextScopeRef` 等尚无文件身份的抽象概念时，仍需等待独立的 Agent-known Context Index Provider。

### 6.3 架构或产品决策

选中 `ARCH-7` 后，卡片显示：最终决策、原因、替代方案、约束、后果、决定时间和证据。

### 6.4 任务状态

选中 `NATIVE-CAPSULE-P0` 后，卡片显示：目标、已完成、当前状态、下一步、阻塞、负责人和状态时间。

### 6.5 验证结果

选中一个稳定验证标识后，卡片显示：验证范围、通过/失败、未覆盖边界、执行时间、代码修订和证据位置，避免把单元测试误读成生产资格化。

### 6.6 历史消息漂移

若消息当时的事实与当前 Provider 快照不同，卡片必须同时表达历史引用身份与当前 revision/freshness，不能静默改写历史含义。

## 7. 界面规格

### 7.1 隐式入口

- 只在有界、同一 Chat 消息表面的选区完成后出现；入口只表示“可发起查询”，不暗示已经匹配对象；
- 视觉层级低于 Chat 正文和原生选择菜单；
- 默认文案为“查看上下文”；
- 不用浮动大卡预告详情；
- Escape、重新选区、滚动离开、route 变化或 anchor 消失时关闭；
- 不覆盖 Copy、文本拖选和键盘选择。

### 7.2 候选菜单

- 只在 2–3 个确定性匹配时出现；
- 每项显示 `名称 · 类型 · scope` 和匹配原因；
- 不显示虚假的模型置信分数；
- 选择候选前不得请求详情。

### 7.3 详情卡

默认首屏预算：

- 类型与稳定名称；
- 一句话、与当前状态最相关的摘要；
- 紧凑类型与 freshness；
- 一个低显著性的卡内“查看详情”入口。

职责、公开入口、本次变化、依赖与影响、路径、revision、observedAt、来源等字段默认全部收起。用户点击卡内“查看详情”后，才在同一卡片内展开这些字段；再次点击“收起详情”恢复摘要态。展开/收起只是本地 UI 状态，不重新查询 Provider，不调用模型、不创建 Chat Turn、不打开浏览器。stale/partial/unavailable 不能被收起隐藏，必须在摘要态可见。

### 7.4 关闭与恢复

- 明确、可操作的关闭按钮；
- Escape 与外点关闭；
- 关闭后不自动重开；
- 焦点回到触发入口或原阅读位置；
- 不改变 Chat 滚动位置。

## 8. 数据与对象模型

### 8.1 Context Index 是后台索引，不是 Dashboard

最小索引记录：`scope/entityId/entityType/canonicalName/aliases/summary/authorityRef/indexRevision/indexedAt/deleted`。

详情快照：`entityId/entityType/entityRevision/observedAt/freshness/facts/relations/sources/verification`。

### 8.2 更新策略

- Agent 完成文件写入、模块创建、决策确认、测试运行或状态变化后，相关索引记录增量更新或失效；
- 候选索引可以缓存，详情只在显式点击后读取；
- task、route、scope、provider revision 或对象身份变化时，旧 capability 失效；
- stale-while-revalidate 只有在旧值明确标记 stale 时才允许。

### 8.3 小项目平衡

小项目只建立 exact ID、文件路径、明确名称和必要 alias，不预建 ontology，不显示 Dashboard。只有出现重复点查、跨对象比较、关系导航、审计或多 Agent 协作时，才考虑完整工作台。

### 8.4 Deterministic Artifact Context

Markdown/开发文档在用户点击后可按需组合三类只读事实：

1. 文件结构：首个 H1、首个有效说明段落和章节边界；
2. Git：当前状态、未提交 diff 涉及的当前章节、最近提交；
3. 确定性引用：工作区内直接提及该文件名的已跟踪文件，最多 3 项。

这些信息用于回答“用途、本次变化、影响范围”，不使用 LLM、embedding 或自然语言推断。Git 不可用时仍返回文件用途、路径和 freshness，并明确把 Git 状态标为 unavailable。引用结果只代表字面引用位置，不冒充完整语义依赖图。

### 8.5 Deterministic Source Module Context

TypeScript/JavaScript 模块在用户点击后按需组合四类只读事实：

1. 源码结构：文件头说明、公开 `export`/CommonJS 入口与有限的顶层声明；
2. 直接依赖：静态 `import`、re-export 和有界 CommonJS `require`；
3. Git：当前状态、diff 对应的有限声明，以及 clean 状态下的最近提交；
4. 依赖与影响：最多 3 个字面引用该模块 stem 的源码或测试文件，测试关联优先显示。

详情数据固定为“职责、公开入口、本次变化、依赖与影响、路径”五项。Git 状态并入“本次变化”，避免额外占用信息槽。解析范围只覆盖 `.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs`；不执行源码、不解析运行时依赖图、不调用语言服务器或模型。文件头说明缺失时，只根据入口文件名与公开导出生成保守描述。字面引用不等于完整调用关系，解析失败或 Git 不可用时必须显式降级。

这里的“五项”是详情数据合同，不是默认视觉合同。默认只显示一个按场景选择的摘要；五项在卡内 disclosure 中按需展开。

### 8.6 Dynamic snapshot semantics

长任务中对象可能在卡片打开后继续变化。产品必须区分“用户正在阅读的快照”和“Provider 最新状态”：

1. 卡片打开时固定 `entityRevision/observedAt/freshness`，不得在用户阅读中静默替换字段；
2. 后台只做轻量 revision 失效检测，不持续重取完整详情；
3. 发现 revision 变化时，在摘要态显示“内容已更新”及显式刷新入口；
4. 刷新保持同一卡片、同一选区和零 Chat Turn，并突出从旧 revision 到新 revision 的有限差异；
5. 对象被删除、Provider 不可用或 binding 漂移时，保留旧快照但明确标记 stale/unavailable，不能冒充 current；
6. 若没有历史 revision 数据，只能显示“当前状态”，不能编造“消息当时状态”。

v1.6 首个实现切片把上述原则收窄为可验证的文件语义：

- 卡片签发短期 `detailRef`，绑定 task、route、workspace scope、binding revision、selection digest/generation、对象身份与打开时快照；
- 打开后后台只读取目标文件的有界 stat revision，不重复解析全文、Git 或关系引用；
- revision 未变时仅续期，不改变卡片；变化时只显示 `内容已更新`；
- 用户可信点击 `刷新内容` 后才重新执行完整 Provider 读取，并在同一卡片显示最多 3 项 `before → after` 差异；
- 删除或探针不可用时保留旧卡并明确警告；过期、重新绑定、上下文漂移和容量耗尽均 fail closed；
- 当前轻量探针不声称捕获只发生于 Git 状态或外部引用关系的变化，这些变化在后续 revision contract 资格化前需要重新打开详情。

### 8.7 Scenario relevance policy

默认摘要只回答当前场景最可能需要的一个问题：

| 场景 | 默认摘要 | 展开后 |
|---|---|---|
| 新建模块 | 职责或公开入口 | exports、依赖、引用、路径 |
| 已修改模块 | 本次变化及影响数量 | 职责、exports、依赖、测试/调用方、路径 |
| clean 模块 | 职责 | 最近提交、exports、依赖、引用、路径 |
| 已修改文档 | 本次变化章节 | 用途、引用、Git 状态、路径 |
| clean 文档 | 用途 | 最近提交、章节、引用、路径 |
| stale/partial 对象 | freshness 警告 | 固定 revision、来源、可用事实 |
| 未来测试结果 | PASS/FAIL 与未覆盖边界 | 命令、修订、失败项、证据 |
| 未来决策/配置 | 决策结果或变化键 | 原因、约束、影响、证据 |

场景策略是投影优先级，不是新增 Provider 的理由。没有可靠数据时宁可少显示，也不填充通用字段凑满卡片。

## 9. P0 功能需求

### P0-1 Quiet eligibility

只在当前可见 user/assistant 消息的单一、有限长度选区上运行本地资格判断。composer、terminal、browser、diff、已有 iframe 和跨拒绝表面的选区必须排除。

### P0-2 Explicit action gate

只有可信 pointer/keyboard action 才创建查询请求。selectionchange 不读 Provider，不调用模型，不记录原文遥测。

### P0-3 Deterministic resolution

只使用 exact key/name/path 和 scope-local alias。P0 不包含语义模型、embedding、搜索扩展或“识别更多概念”。

### P0-4 Adaptive routing

0/1/2–3/>3 路由分别为静默、直达详情、候选菜单、缩小选区。混合类型结果按过宽处理。

### P0-5 Opaque capabilities

入口点击后由 Host/Server 签发不可伪造、短期、一次性引用，绑定 task、route、scope、selection digest、对象身份、authority 和 revision。模型不能覆盖 locator、provider、workspaceRoot 或 entityId。

### P0-6 Current authoritative detail

候选选择后读取当前权威快照；在读取前后复验 context/index/provider。漂移必须 fail closed。

### P0-7 Type-specific projection

Artifact、Module/Concept、Decision/Task 使用不同字段优先级。未知类型使用保守通用投影。

### P0-8 Zero-turn native detail

详情显示在当前 Codex Desktop Chat Lane 的选区附近；不打开浏览器，不调用 `ui/message`，不产生 follow-up，不调用模型。

### P0-9 Accessibility and lifecycle

支持键盘触发、读屏标签、Escape、焦点恢复、route/task/navigation 清理、并发上限、请求取消和 stale-response fence。

### P0-10 Text/structured fallback

无 UI 宿主必须保留有界、可读的 text/structured 结果，但不能把文本 fallback 表述为原生详情卡已挂载。

### P0-11 Pinned snapshot and explicit refresh

打开的卡片固定用户正在阅读的快照。后台仅做有界 revision 探测；变化后显示低干扰提示，只有可信 `刷新内容` 动作才能重读完整详情并在同一卡片投影最多 3 项差异。删除、不可用、过期或 binding 漂移必须保留旧快照或 fail closed，不能静默覆盖。

## 10. 明确非目标

- 不默认在 Agent 每段输出旁显示胶囊条；
- 不把普通 prose 的每个名词装饰成链接；
- 不提供“识别更多概念”或选区语义模型；
- 不在卡片中提供“问 Agent”；
- 不替代 Codex 的解释、综合和决策能力；
- 不把 Dashboard 搬入 Chat Lane；
- 不为普通 selection 自动读取数据；
- 不在 Quick Look 中执行写操作；
- 不把 fixture 数据表述为当前项目状态；
- 不把浏览器、App Server client、DCPM/CWA 当作默认运行前提；
- 不把私有 CDP/DOM 增强表述为公开稳定的 Codex Plugin 合同。

## 11. 原生宿主与可移植性边界

### 11.1 当前 P0

当前最接近目标交互的实现是 Codex Desktop 私有 Host Adapter：它能观察 Chat Lane 选区、显示锚定入口并在选区旁挂载详情。该路径必须按具体 Codex build 资格化。

### 11.2 标准 MCP App

标准 MCP App 可把 UI 与工具结果关联并保留结构化 fallback，但不能据此承诺任意普通 Chat prose 的 selection hook。现有 `render_context_capsule` 保留为类型化详情投影、fixture 验证和未来公开宿主能力参考，不再是默认入口。

### 11.3 浏览器与工作台

浏览器 App Server harness、Dashboard 和 CWA 仅用于研究、协议调试或复杂任务升级。任何默认要求用户离开当前 Codex 任务的路线均不满足 P0。

### 11.4 Codex Desktop compatibility gate

私有 Host Adapter 的兼容性优先级高于继续增加对象类型。每个 Codex Desktop build 必须重新通过：目标与主 execution context 识别、消息表面资格判断、trusted click、摘要卡挂载、卡内 disclosure、关闭/焦点恢复、滚动/虚拟化、导航重装和 stale-response 清理。启动自检失败时保持 Chat Lane 原样并在 companion status 中报告不兼容；不得留下半挂载入口或要求用户转到浏览器。单个当前 build 的 PASS 不能外推为跨版本支持。

启动自检固定检查四层私有合同：精确 `app://-/index.html` 主目标、主 frame、默认主 execution context、renderer lifecycle。`status --json` 必须返回：

- `qualified`：四层全部通过；
- `unavailable`：本地 debug endpoint/transport 无法检查；
- `incompatible`：宿主可达，但目标或 renderer 私有合同不匹配；
- `unchecked`：尚未完成一次 refresh。

`unavailable/incompatible` 必须 fail closed，不绑定 workspace、不残留 action/card/binding，并保留有界诊断 code。该启动自检只能证明可安装性，不能替代每个 build 的真实 selection、trusted click、展开/收起、关闭、焦点、导航与虚拟化人工门禁。

## 12. 成功指标与实验

### 12.1 对照条件

- A：纯线性 Chat；
- B：相同 Chat 内容 + Selection-triggered Context Quick Look。

两组使用相同项目状态和事实，B 不得获得额外信息。

### 12.2 任务

1. 找出某文档本次更新的关键点；
2. 解释新模块的责任和依赖；
3. 判断某决策为何采用；
4. 判断测试 PASS 的真实覆盖边界；
5. 判断旧消息和当前事实是否漂移。

### 12.3 目标

- exact lookup 的 median `time_to_verified_fact` 相比纯 Chat 降低至少 30%；
- 点查路径新增 Chat Turn 为 0；
- 普通复制/高亮产生的远程请求为 0；
- 错误对象率和事实错误率不高于纯 Chat；
- 本地/近端详情点击后 median 展示目标小于 500 ms。

这些是实验目标，正式用户研究前不得写成已证明结果。

## 13. P0 验收门禁

### 13.1 交互门禁

- [ ] 无 selection 时 Chat Lane 不出现常驻胶囊；
- [ ] selection 本身不读取详情、不调用模型；
- [ ] 只有 trusted explicit action 触发查询；
- [ ] 0/1/2–3/>3 路由正确；
- [ ] 详情在当前 Codex Desktop Chat Lane 原位显示；
- [ ] 不打开浏览器或 Dashboard；
- [ ] 打开、展开、关闭新增 Chat Turn 为 0；
- [ ] revision 变化只出现卡内提示，可信刷新在原卡完成且新增 Chat Turn 为 0；
- [ ] 关闭按钮、Escape、外点和焦点恢复可用；
- [ ] 普通复制、高亮、terminal、browser、diff 不误触。

### 13.2 数据门禁

- [ ] 只使用确定性 key/name/path/alias；
- [ ] 产品不存在“识别更多概念”模型分支；
- [ ] Markdown 用途、变化章节和引用位置均来自有界本地解析/Git，不调用模型；
- [ ] Source Module 的职责、exports、diff 声明、imports 和测试/引用位置均来自有界本地解析/Git，不执行源码、不调用模型；
- [ ] opaque ref 绑定完整 context 和对象身份；
- [ ] 点击后读取当前 authoritative snapshot；
- [ ] index/provider/context 漂移 fail closed；
- [ ] identity、source、revision、observedAt、freshness 全部可见；
- [ ] fixture、stale、partial、unavailable 状态不被隐藏。
- [ ] 打开快照不会被后台静默替换；删除/不可用保留旧值并显示明确警告；
- [ ] detail ref 对过期、task 重绑定、context 漂移和容量上限 fail closed；

### 13.3 研究门禁

- [ ] 用正确回答而非点击完成定义任务完成；
- [ ] 分开测试事实点查和开放式解释；
- [ ] 同时报告速度、正确率、误触和 stale/error；
- [ ] 未完成正式实验前不声称“显著提升”。

## 14. 现有实现复用矩阵

| 现有资产 | 决策 | v1.1 定位 |
|---|---|---|
| CDP Selection Renderer/Host Adapter | 主线保留 | 默认原生交互入口 |
| LookupService、resolver、validation | 保留 | 确定性解析与可信读取核心 |
| opaque entity/candidate refs | 保留 | 点击后安全 capability |
| 类型化 Context Capsule UI | 保留并降级 | 点击后的详情投影，不常驻显示 |
| source/revision/freshness | 保留 | 事实可信度基础 |
| Workspace file Provider | 优先演进 | 第一个真实开发数据源 |
| MCP `render_context_capsule` | 保留为可选 | fixture/渲染验证/未来标准宿主参考 |
| `ui/message` / Ask Agent | 删除 | 不属于产品交互 |
| 语义模型识别 | 删除 | 由 Codex 原生 Chat 能力覆盖 |
| App Server 浏览器 client | 降级 | 协议研究 harness |
| DCPM/CWA | 可选参考 | 非产品主体和运行前提 |
| Dashboard/workbench | 延后 | 比较、关系、批量与持续管理升级表面 |

## 15. 当前实现状态与缺口

截至 2026-08-18，已有：

- 原生 Chat Lane 选区资格判断与锚定按钮；
- selection inert、trusted click 查询、0/1/2–3/>3 路由；
- task/route/context/selection/lifecycle fence；
- fixture 与显式绑定 workspace 的只读 Provider；
- Markdown Artifact Context Extractor：用途、变化章节、确定性引用、Git 状态和路径；
- Source Module Context Extractor：职责、公开入口、变化声明、直接依赖、测试/引用关联和路径；
- 摘要优先的卡内 progressive disclosure：默认隐藏事实/元数据/来源，保留类型与 freshness；
- Artifact、Module/Concept、Decision/Task 类型化详情；
- 来源、修订、新鲜度、观察时间和文本 fallback；
- 关闭、Escape、外点、导航清理与 stale-response 防护；
- 现有 MCP App 胶囊零 `ui/message`、零浏览器导航。
- 文件卡片的 pinned snapshot、轻量 stat revision 探测、`内容已更新` 提示、显式原位刷新和最多 3 项差异；
- revision detail ref 的过期、task 重绑定、context 与容量 fail-closed 约束；

仍缺：

- 让当前 workspace 文件之外的 Module/Decision/Task 获得可靠 Provider；
- 把 Agent 工作结果增量写入轻量 Context Index；
- 证明不同 Codex Desktop 版本中的 Host Adapter 兼容性；
- 扩展 revision contract 以覆盖只有 Git 状态或外部引用关系变化、而源文件 stat 未变化的场景；
- 完成受控效率研究。

## 16. 推荐实施顺序

1. 已完成摘要态、卡内展开/收起和关闭的当前 Codex Desktop 人工验收；
2. 已完成当前 build 的四层启动兼容性自检与失败降级；
3. 已完成首个文件 revision 失效提示、显式零-turn 刷新、有限差异和真实 Edge 零-turn 验收；
4. 下一步用模块、文档、测试、决策/配置场景验证默认摘要是否命中重点；
5. 随后扩展必要的 revision signal，再开展 A/B 效率研究并决定是否扩展 Provider。

## 17. 已冻结决策

1. 首个宿主是 Codex Desktop 当前 Chat Lane。
2. 默认可视入口是用户选区后的轻量按钮，不是常驻胶囊。
3. Agent-known 对象是数据来源，不等于 Agent 主动显示 UI。
4. P0 只做确定性对象识别，不做语义模型识别。
5. 详情是类型化、原位、零模型、零 Chat Turn 的只读卡片。
6. 卡片内不提供“问 Agent”。
7. Context Index 是轻量后台，不要求 Dashboard。
8. 小项目按需索引，不预建复杂本体。
9. 浏览器、DCPM/CWA 和完整工作台不是主线。
10. 未完成用户研究前，只陈述假设和测量目标。

## 18. 变更记录

- v1.6：为打开的文件卡片增加绑定上下文的短期 detail ref、轻量 stat revision 探测、`内容已更新` 提示、可信显式原位刷新与最多 3 项差异；删除/不可用保留旧快照，过期、重绑定和容量耗尽 fail closed；真实 Edge 验收确认该路径零 Chat Turn。
- v1.5：为 workspace companion 增加 `qualified/unavailable/incompatible/unchecked` 四态兼容性自检；按精确主目标、主 frame、默认主 execution context 与 renderer lifecycle fail closed，并明确启动检查不替代人工交互门禁。
- v1.4：把五项事实从默认首屏改为卡内渐进披露；默认只保留场景摘要、类型和 freshness；冻结新增 Extractor，优先解决动态 revision 语义、场景信息优先级和 Codex Desktop 兼容性。
- v1.3：加入 TypeScript/JavaScript Source Module Context Extractor；通过文件头说明、公开导出、静态依赖、Git diff/status/log 和有界字面引用提供五项代码模块速览，保持零执行、零模型、零 Chat Turn。
- v1.2：在已验收的 Quiet Mode 原生链路上加入 Markdown Artifact Context Extractor；通过文件结构、Git diff/status/log 和有界字面引用提供“用途、本次变化、影响范围”，保持零模型、零 Chat Turn 和非 Git 显式降级。
- v1.1：把默认入口从 Agent 输出旁主动胶囊改为 Selection-triggered Quiet Context Reveal；Agent-known 退回数据层；彻底删除“识别更多概念”与选区语义模型；保留类型化胶囊作为点击后的详情投影和可选 MCP 渲染参考。
- v1.0：以 Agent-known 原生 Context Capsules 为主入口，建立零-turn 类型化详情，但默认可见程度过高。
- v0.12 及以前：Selection Quick Look、Referent 回流和浏览器工作台探索，现仅复用解析、安全和宿主生命周期资产。

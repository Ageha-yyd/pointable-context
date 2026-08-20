# PRD：Quiet Context Reveal（选区式上下文速览）

- 版本：v2.20
- 状态：P-C 微型心智模型已选为产品默认；短任务 pilot 暂缓；精确 `OpenAI.Codex 26.814.5517.0`、executable `151.0.7922.137` 与 v2.14 renderer 已完成自动 4/4 和人工 10/10 evidence-bound 资格。TRAIN-1 与六个 measured scenario 已冻结为三轮原生 user/assistant script；默认六轮 runner 已接入私有 loopback scripted runtime、持久原生任务、轻量答题控件、条件 B companion、checkpoint 与结果管线。轻量答题控件已通过当前 build 的形成性人工验收；真实 A/B 各一次端到端、干净 Windows ZIP 和研究治理仍未完成，参与者数据收集继续关闭
- 日期：2026-08-20
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

选中 `src/adapters/local-workspace.ts` 等 TypeScript/JavaScript 模块后，卡片显示：职责、公开入口、本次变化、直接依赖与字面引用/测试关联、路径。作者显式放入 `docs/concepts/*.md` 的概念制品可以通过文件名/稳定名称确定性解析，并按“它是什么意思、为什么现在出现、它不是什么、所处流程、证据”投影；普通 prose 中没有显式身份的抽象概念仍不做语义猜测。

作者显式放入 `docs/changes/*.md` 的变更制品按“原来怎样、现在怎样、影响什么、证据”投影。它回答一次具体转变，不等同于自动解释任意 Git diff；没有显式制品时仍使用现有文件/模块的有界 Git 摘要。

### 6.3 架构或产品决策

选中普通 path-qualified ADR/Decision Markdown 后，卡片显示显式 Status、Decision、Context/Rationale、Consequences 和路径。作者显式放入 `docs/decisions/*.md` 的 P-C 制品进一步按“为什么需要决定、选择了什么、后果是什么、证据”投影。P0 不用模型从普通文档推断“隐含决策”；尚无独立决策文件身份的对象仍由 fixture 或未来 Agent-known Provider 承载。

### 6.4 任务状态

作者显式放入 `docs/tasks/*.md` 的任务记录按“目标、当前状态、已完成、下一步、阻塞”投影，并保留更新时间与证据。普通 Chat 计划、TODO、Git 变更或文件存在本身不自动升级为任务状态。`NATIVE-CAPSULE-P0` 继续只是 fixture 兼容样例。

### 6.5 验证结果

作者显式放入 `docs/verifications/*.md` 的验证记录按“Claim → Result → Gap”投影，并保留验证方式、被验证修订、执行时间与证据。测试源码仍只说明静态验证范围；只有结构完整、明确写出结果与尚未证明边界、且证据行复验成功的记录才能表述一次实际结果。产品不根据测试文件名、测试定义、命令名称或 exit-code 缺失的 prose 自动生成 PASS/FAIL。

### 6.5 验证结果

选中 `.test/.spec` 或测试目录下的源码时，当前卡片只显示静态检测到的 `test/it` 标题、源码变化、有限依赖和路径，并固定声明“未执行，不能据此判定 PASS/FAIL”。只有未来接入真实测试运行证据后，稳定验证标识才能显示通过/失败、未覆盖边界、执行时间、代码修订和证据位置。

### 6.6 配置边界

选中 `package.json`、`tsconfig*.json`、`.mcp.json`、Plugin manifest 或显式 `*.config.json` 时，卡片显示配置用途、有限顶层键名、格式和路径。P0 不显示任何配置值，也不解析任意 JSON 数据文件为配置，避免把密钥或业务数据带入 Chat Lane。

### 6.7 历史消息漂移

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
- 卡片标题栏是唯一拖动热区；正文仍可选择，按钮仍可点击，拖动只能由可信主指针动作启动；
- 拖动位置限制在当前可视区域内；窗口尺寸、视觉视口或卡片高度变化时自动夹回可用范围；
- 后台 revision 提示与显式刷新复用同一卡片 DOM，并保留用户移动后的位置；新选区或关闭后不继承旧位置；
- Escape 与普通外点关闭；
- 详情卡打开时，点击当前 Chat composer 的 `textarea`、`input`、`contenteditable` 或 `role=textbox` 不属于外点关闭：输入框获得焦点，卡片继续作为回复时的阅读参照，后台 revision 检查不中断；
- 仅入口尚未打开详情时，点击 composer 仍按普通外点清理入口；
- 关闭后不自动重开；
- 焦点回到触发入口或原阅读位置；
- 不改变 Chat 滚动位置。

### 7.5 人类理解投影

详情卡不是统一数据库记录的缩小版。首屏应按对象类型回答用户正在建立的心智模型：

| 对象 | 首屏理解任务 | 推荐微型表示 |
|---|---|---|
| 概念 | 它是什么意思、为什么现在出现、它不是什么 | 定义 + 当前语境 + 边界 |
| 阶段 | 现在位于哪里、为什么做、下一步是什么 | 前一步 → 当前 → 下一步 |
| 变更 | 原来怎样、现在怎样、影响谁 | Before → After → Impact |
| 决策 | 为什么决定、选择了什么、后果是什么 | 问题 → 选择 → 后果 |
| 模块 | 接收什么、负责什么、影响什么 | 输入 → 职责 → 输出 |
| 文档 | 解决什么、核心结构是什么 | 一句话主旨 + 三段结构 |
| 证据 | 证明什么、依据是什么、还没证明什么 | Claim → Evidence → Gap |
| 状态/Gate | 能否继续、阻塞是什么、下一触发是什么 | 状态 + 阻塞 + 下一事件 |

来源、修订、observedAt 和 freshness 默认仍在第二层；只有 stale、partial、evidence gap 等会改变当前判断时，才进入首屏。证据入口使用低显著性的卡内 `为什么这样说`，展开后显示有界原文片段与来源，不打开浏览器、不创建 Chat Turn。

v1.9 首个实现只资格化显式 `concept` 制品，不借此宣称八类均已实现。`pilot` 作为冻结样例：首屏显示定义、当前阶段原因、四步流程、不能声称显著性的边界；证据默认收起。

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
   “同一卡片”要求复用现有卡片 DOM，保持当前位置、滚动位置与详情/证据 disclosure 状态；不得先移除旧卡再创建默认折叠的新卡；
5. 对象被删除、Provider 不可用或 binding 漂移时，保留旧快照但明确标记 stale/unavailable，不能冒充 current；
6. 若没有历史 revision 数据，只能显示“当前状态”，不能编造“消息当时状态”。

v2.2 把首个 stat-only 切片扩展为可验证、仍然轻量的动态上下文指纹：

- 卡片签发短期 `detailRef`，绑定 task、route、workspace scope、binding revision、selection digest/generation、对象身份与打开时快照；
- 所有文件都纳入目标文件 stat；没有 `.git` 的工作区稳定退化为 stat-only；
- 对可信 Git 根额外散列目标文件 porcelain 状态、该文件最近提交，以及与 Provider 同口径的有界字面引用路径集合；这些值不进入卡片；
- 显式 concept/change/decision 制品额外绑定其声明的 workspace evidence source stat，证据源变化不再依赖重新打开卡片；
- 后台不执行完整 Provider 投影，不读取引用文件内容，不建立语义依赖图；Git 子进程各自限制为 750ms/256KiB，可信 Git 根探针失败时返回 unavailable；
- revision 未变时仅续期，不改变卡片；变化时只显示 `内容已更新`；
- 用户可信点击 `刷新内容` 后才重新执行完整 Provider 读取，并在同一卡片显示最多 3 项 `before → after` 差异；
- 显式刷新后的差异放在卡片首层、P-C 心智模型之前；普通未刷新卡片仍保持 Quiet，不预留常驻变化区；
- 差异不是按底层字段顺序堆叠，而是按对象的理解任务排序：Task 优先“当前状态、下一步、阻塞”，Verification 优先“验证结果、仍未证明、要证明什么”，Decision 优先“选择、结果与代价、要解决的问题”，Concept/Change 同理优先当前语境或当前影响；
- 同一 `before → after` 只出现一次；新增/移除字段明确标为“原先未显示”或“已移除”，每个 label/value 继续受协议长度上限约束；
- 删除或探针不可用时保留旧卡并明确警告；过期、重新绑定、上下文漂移和容量耗尽均 fail closed；
- 引用指纹只证明字面引用成员集合变化；它不证明运行时调用关系，也不对成员集合未变化时的任意语义影响作推断。

2026-08-19 当前 Codex 任务的形成性验收使用 `local-workspace.ts` 做 relation-only 变化：目标模块保持不变，另一个已跟踪源码引用的移除触发了 `内容已更新`；可信刷新后，卡片 DOM 身份、left/top、scrollTop 与已展开的详情 disclosure 均保持，提示被清除且没有新增 Chat Turn。因为变化没有进入有界首屏字段，本次没有显示伪造的字段差异。该结果证明当前 build 的交互连续性，不证明用户效率提升或跨版本兼容性。

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

v1.7 已把其中三类收窄为安全、可执行合同：测试源码默认摘要是静态验证范围且明确未执行；已知 JSON 配置默认摘要是用途且永不投影值；path-qualified ADR 默认摘要是显式 Decision 段落。它们不冒充运行结果、解析后有效配置或语义决策图。

场景策略是投影优先级，不是新增 Provider 的理由。没有可靠数据时宁可少显示，也不填充通用字段凑满卡片。

### 8.8 Explicit Concept Artifact

P0 不从任意 prose 自动抽取心智模型。只有位于冻结目录且包含完整结构标题的作者制品才能进入 P-C：

- `docs/concepts/*.md`：`它是什么意思`、`为什么现在出现`、`它不是什么`、`所处流程`、`证据`、`来源`；
- `docs/changes/*.md`：`原来怎样`、`现在怎样`、`影响什么`、`证据`、`来源`；
- `docs/decisions/*.md`：`为什么需要决定`、`选择了什么`、`后果是什么`、`证据`、`来源`。

- 文件 stem 是确定性名称/alias，不调用 embedding 或模型；
- 流程最多 4 步，且必须显式标记一个 `当前：` 步骤；
- 来源必须是 workspace 内相对路径和行号；详情读取时原文证据必须与该行精确一致；
- 任一必填段、当前步骤或证据复验缺失时 fail closed；
- 当前轻量 revision v2 同时观察被选中的显式制品和其声明的 evidence source stat；变化只产生 `内容已更新`，完整事实仍必须由可信刷新动作重读。

### 8.9 Explicit Agent Work Result Artifact

Agent 工作结果采用文件式、按需索引的最小制品合同，不引入 Dashboard、常驻数据库或后台语义抽取：

- `docs/tasks/*.md` 必须包含：`目标`、`当前状态`、`已完成`、`下一步`、`阻塞`、ISO 8601 `更新时间`、`证据`、`来源`；
- `docs/verifications/*.md` 必须包含：`要证明什么`、`结果`、`尚未证明`、`验证方式`、`验证修订`、ISO 8601 `执行时间`、`证据`、`来源`；
- 文件 stem 是确定性名称/alias；只有完整显式制品才获得 `task` / result-bearing `verification` 身份；
- Task 状态与 Verification 结果都是作者声明，Provider 只验证结构、范围、当前文件快照与 exact evidence line，不补写结论；
- `docs/verifications/*.md` 与普通 `*.test.*`/`*.spec.*` 共用实体类型但语义不同：前者是证据绑定的运行/验收记录，后者永远只是未执行的静态测试定义；
- 证据漂移、必填字段缺失、时间格式无效或路径越界时 fail closed；
- 这一步只让 Agent 已经明确知道的稳定结果进入轻量 Context Index，不要求每个 Chat Turn 或每个文件变化都生成记录。

### 8.10 Agent Milestone Artifact Production Policy

里程碑制品维护必须显式 opt-in，支持两种边界清楚的授权：一次性创建/更新指定制品，或用户明确要求在当前有界长任务内维护 Pointable Context 上下文。后一授权在 task、workspace 或请求范围改变时自动结束，不能跨任务继承。

只有同时满足以下四项才创建或更新制品：

1. 存在可被用户再次选取的稳定、可识别身份；
2. 该信息预计在当前 Chat Turn 之后仍会被引用；
3. 它形成稳定概念、实质变更、明确决策，改变任务/交接状态，或记录一个实际发生的验证；
4. 当前 workspace 内存在一条可精确复验的有界证据行。

合格里程碑包括当前工作明确建立的稳定 Concept、Change 或 Decision，用户可见制品、状态/Gate 变化、真实命令/审查/人工验收结果，以及交接或明确停止点。优先更新已有 identity；单个里程碑通常不新建超过一条解释性制品、一条 Task 和一条 Verification。中间推理、隐含概念/决策、普通文件改动、计划中的测试、TODO、重复进度播报和可直接从源文件更快读取的静态事实不生成制品。

Concept/Change/Decision 必须使用冻结章节，文件 stem 与 H1 归一化身份一致，并引用受管上下文目录之外的一条 exact evidence；Task/Verification 继续使用冻结结构与时间字段。任何写入后必须运行适用的只读 Gate：`Artifact Check` 扫描前三类目录并拒绝额外章节、身份漂移、跨类型重名、循环/漂移证据；`Record Check` 扫描后两类目录并验证结构、ISO 时间、exact evidence 与跨类型 stem 唯一性。检查器不调用模型、不自动修复、不写文件；只有 `valid: true` 的集合才可视为可用索引输入。单用户人工验收只证明当前卡片字段可理解，仍不证明信息获取时间或 Chat Turn 已下降。

### 8.11 Explicit Long-task Context Coverage

结构覆盖不能通过扫描 Chat 或“猜哪些概念重要”获得。对已经 opt-in 的有界长任务，作者可维护严格的 `docs/context-coverage.json`，显式声明当前里程碑之后必须仍可恢复的 Module、Decision、Task 和 Verification。每项只包含稳定 `id`、类型 `kind` 与 workspace-relative `key`；声明本身不创建对象，也不改变 Provider authority。

只读 Coverage Gate 逐项执行：Context Index exact key/type 匹配 → 当前 Local Workspace Provider detail read → Task/Verification Record Check。输出只包含身份、修订、新鲜度、issue code 和计数，不包含 raw selection、事实字段、文件内容或配置值：

- `coverageRate = available / expected`；
- `omissionRate = missing / expected`；
- `projectionFailureRate = (type_mismatch + invalid + unavailable) / expected`；
- `redundancyRate = duplicate Task/Verification record files / discovered record candidates`。

这些指标只证明“显式声明的对象是否可恢复”，不能发现从未被声明的重要对象，也不证明真人信息获取效率。Coverage manifest 重名、越界、过大、结构无效或 Provider 不可读时 fail closed；工具不自动补写或修复记录。

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

Artifact、Module、Verification Source、Verification Result、Configuration、Decision、Task 使用不同字段优先级。测试源码不得推断 PASS/FAIL；结果只来自证据绑定的显式 Verification 制品；配置不得投影值；Decision 只消费 path-qualified Markdown 的显式章节。未知类型使用保守通用投影。

### P0-8 Zero-turn native detail

详情显示在当前 Codex Desktop Chat Lane 的选区附近；不打开浏览器，不调用 `ui/message`，不产生 follow-up，不调用模型。

### P0-9 Accessibility and lifecycle

支持键盘触发、读屏标签、Escape、焦点恢复、route/task/navigation 清理、并发上限、请求取消和 stale-response fence。

### P0-10 Text/structured fallback

无 UI 宿主必须保留有界、可读的 text/structured 结果，但不能把文本 fallback 表述为原生详情卡已挂载。

### P0-11 Pinned snapshot and explicit refresh

打开的卡片固定用户正在阅读的快照。后台仅做有界 revision 探测；变化后显示低干扰提示，只有可信 `刷新内容` 动作才能重读完整详情并在同一卡片投影最多 3 项差异。显式刷新差异进入首层并按对象理解任务排序；普通未刷新卡片不显示该区域。删除、不可用、过期或 binding 漂移必须保留旧快照或 fail closed，不能静默覆盖。

### P0-12 Declared long-task coverage gate

对显式 opt-in 的长任务，系统提供只读结构覆盖审计，分开报告遗漏、类型/投影失败与记录冗余。该门禁不读取普通 Chat、不调用模型、不输出事实内容、不自动创建记录，并且不能把未声明对象计入“已覆盖”。

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

兼容性结论必须落到一个与宿主 build 和 renderer bundle digest 绑定的只读资格记录中，且自动与人工证据分栏：

- 自动栏记录 `OpenAI.Codex` package/executable 版本、四层自检时间、状态、code 与 gates；
- 人工栏固定为 selection inert、trusted click、锚定卡片、渐进披露、关闭/焦点恢复、composer 持续、滚动/虚拟化、导航恢复、stale response 清理与刷新连续性十项；
- 每个 PASS/FAIL 人工项必须绑定 workspace 内 exact evidence line；未运行只能是 `pending`；
- renderer bundle SHA-256、宿主 package 版本或证据行漂移时 fail closed；
- 只有自动四层全 PASS 且十项人工门禁全部有证据地 PASS，才允许把该精确 build 标为 `qualified`；`manual_pending` 不能外推为兼容。

当前 `OpenAI.Codex 26.814.5517.0`、executable `151.0.7922.137` 与 renderer digest `d00e4620…2855` 已完成自动 4/4 和人工 10/10 evidence-bound 门禁，可以标记为该精确组合 `qualified`。该结果不能写成其他 Codex build、其他 renderer digest 或公开稳定宿主合同已支持。

## 12. 成功指标与实验

### 12.1 对照条件

- A：纯线性 Chat；
- B：相同 Chat 内容 + Selection-triggered Context Quick Look。

两组使用相同项目状态和事实，B 不得获得额外信息。

P-A/P-B/P-C 曾被设计为不带因果主张的呈现比较：

- P-A：当前记录式摘要 + 收起字段；
- P-B：人类叙事摘要；
- P-C：类型化微型心智模型 + 收起证据。

若未来恢复该比较，三者必须使用同一对象、同一事实、同一 evidence 和同一原生 Chat Lane，仅改变 projection。首个 `pilot` 任务要求回答“是什么、为什么现在出现、不能证明什么、前后步骤”，并记录正确理解时间、四个答案单元、证据展开、Chat Turn、lane leave、错误对象和 card sufficiency。8–12 人只用于发现流程/表达缺陷和估计方差，不用于显著性声明。

2026-08-19 的一次产品负责人形成性走查认为 P-C 更好，P-A 与 P-B 体验接近。2026-08-20 的产品路线决策据此直接采用 P-C 作为产品默认，当前不再投入周期比较 P-A/P-B/P-C；P-A/P-B 只保留为未来研究基线。该选择是产品判断，不证明 P-C 更快、更准确或更能减少 Chat Turn。

短任务效率对照同样暂缓。人在刚接触短任务时仍保有工作记忆，可能产生明显的 ceiling effect，无法代表 Pointable Context 面向的长时程、高信息密度和状态持续漂移问题。当前阶段先提升产品完整性，之后在真实长周期任务、延迟重返、跨会话恢复和任务交接中验证效果。

### 12.2 任务

冻结 v1 使用六类开发点查任务：

1. `DOC-1`：找出文档用途与当前刷新策略变化；
2. `MOD-1`：解释模块职责与有界 source/test 引用；
3. `TST-1`：识别静态测试定义，同时明确“未执行、不能判定 PASS/FAIL”；
4. `CFG-1`：识别 JSON 配置边界与顶层键，不披露值；
5. `ADR-1`：判断显式刷新决策、原因与后果；
6. `REV-1`：在冻结 mutation 后识别 `updated` 与一项有限差异。

### 12.3 目标

- exact lookup 的 median `time_to_verified_fact` 相比纯 Chat 降低至少 30%；
- 点查路径新增 Chat Turn 为 0；
- 普通复制/高亮产生的远程请求为 0；
- 错误对象率和事实错误率不高于纯 Chat；
- 本地/近端详情点击后 median 展示目标小于 500 ms。

这些是实验目标，正式用户研究前不得写成已证明结果。

### 12.4 技术延迟基准不是用户效率

自动基准只测 trusted action 之后的确定性 resolution、Provider read、revision check 和 explicit refresh，固定输出 `technical_latency_only`。它不调用模型、不创建 Chat Turn，也不把点击卡片当作任务完成。

2026-08-18 首个隔离工作区基准对 document/module/test-source/configuration/decision 各运行 20 次，exact-detail median 为 3.22–40.71 ms，unchanged revision check median 为 1.74 ms，explicit refresh 为 43.47 ms，达到本机 `<500 ms median` 技术目标。这只证明当前机器和 fixture 的组件延迟，不证明人的 `time_to_verified_fact` 已下降。

人工 A/B 必须采用相同 transcript、相同项目状态和冻结答案键，以最终正确事实提交为终点，同时记录 accuracy、Chat Turn、lane leave、wrong entity、card sufficiency 和 selection interference。协议见 `docs/evaluation-protocol.md`。

### 12.5 Frozen counterbalanced study pack v1

`docs/evaluation/study-v1` 已冻结但未运行。呈现 pilot 使用 12 个匿名 slot，把 `pilot` 按 P-A/P-B/P-C 各分配 4 人；每人只看一个固定 condition，避免同对象学习效应。效率 pilot 使用六行循环 Latin square 并在后六个 slot 反转 A/B phase：每位参与者完成六个不同任务，其中 A/B 各三项；跨 12 个 slot，每个 scenario 在每个序位出现两次、在 A/B 各出现六次。

该 pack 从 2026-08-20 起作为冻结研究资产保留，不是当前产品开发门禁，也不立即招募参与者。未来若产品的数据合同、卡片结构或长任务研究问题发生实质变化，不得用旧 digest 收集新问题的数据；应复制为新版本、更新长周期任务后重新冻结。

两条件共享同一 transcript、隔离 Git workspace、对象和 exact-evidence answer key。`prepare-evaluation-workspace.mjs` 只允许在产品仓库之外的新/空目录创建参与者 workspace；`mutate` 只接受带冻结 marker 的 workspace。每个 workspace 只供一名参与者使用。

`study:validate` 在 session 前验证答案证据、日志隐私字段、scenario/condition/序位平衡，并生成 `packDigest`。所有 CSV 行必须绑定该 digest。验证器 PASS 只证明材料内部一致，不证明研究流程已获真人验收，更不证明效率提升。

### 12.6 Controlled long-task study v2 measurement pipeline

study-v2 使用六段冻结的长任务开发历史、无实时模型的 A/B 条件和 12-slot counterbalancing。原生 trial surface 只记录白名单事件和有界对象/答案 code；`monotonicMs` 是每个 trial 从 `trial_shown` 起算的相对时间，跨 trial 由全局 `sequence` 排序，不能由研究者手工秒表覆盖。

严格结果管线从原生事件自动推导 `task_completion_ms`、答案正确性、首次正确对象时间、navigation 次数/时间、wrong object、card open/dwell 和 scripted follow-up；超时或退出固定写为 `NO_ANSWER`，不会伪造一个答案。六轮事件重新编号后进入同一个 session，结果先写入同目录临时区、完整校验 event/trial/assignment/scoring/privacy/integrity 一致性，再以 rename 原子发布。原始选区、Chat、文件内容、配置值、姓名、邮箱和绝对路径均不进入结果。

该管线解决“客观指标如何自动、精确地记录”。六轮 runner 以 append-only、逐轮 digest checkpoint 保存有界 run；进程中断后只恢复已完整落盘的连续前缀，build、pack、participant、slot 或 session 漂移即拒绝。第一阶段完成六轮后返回 `awaiting_questionnaire`；第二阶段在当前 Codex Chat Lane 原位显示五项 1–7 量表，所有评分都选中后才允许提交。问卷不新增 Chat Turn、不调用模型、不接受自由文本，提交后从 checkpoint 原子生成结果；若六轮尚未完成，finalize 会在运行或显示问卷之前失败，不能借终结命令补跑试次。

旧 runner 把 transcript、答案和控制器画在覆盖 Chat 的自定义 surface 中。它虽能验证事件、计时与结果管线，却不能代表真实 Agent 开发体验，因此从 v2.18 起只保留为 renderer 组件资格、培训与故障诊断工具，不再作为主效果实验。事件和结果管线可以复用，但 trial 的阅读表面必须替换。

### 12.7 Native controlled conversation replay

正式方向是在研究者提供的隔离 workspace 中，使用 Codex App Server 创建持久任务，并通过本机 loopback scripted Responses provider 逐轮产生固定回复。每个 scenario 由有界的多轮 user/assistant script、冻结项目状态、答案键和对象集合组成：

1. 每条历史以普通 Codex Turn 物化，而不是 `thread/inject_items` 或覆盖网页；
2. provider 同时保留 HTTP/SSE 与 Responses WebSocket 协议适配；默认 runner 使用独立的无认证 custom model provider 并关闭 WebSocket、plugins 与 apps，只消费预制回复，不保存原始 prompt，不访问线上模型；
3. A/B 共享完全相同的原生消息、workspace 和答案，只有 B 加载 Quiet Context Reveal；
4. 参与者始终在原生 Chat Lane 阅读、选择和打开卡片；实验控制只保留一个不遮挡阅读的有界答题/退出入口；
5. 预制历史 Turn 不计入 `chat_turns_to_fact`，只有任务开始后参与者主动提交的新 user Turn 才计数；
6. task 创建、每轮完成、Desktop 可见性和四个标准 selection surface 都必须分别验证，后端存在 Turn 不能替代桌面渲染证据。

2026-08-20 的垂直探针已经用两轮固定脚本产生 2 个普通 user Turn 和 2 个普通 assistant reply；Desktop Chat Lane 四条消息均可见且分别落在标准可选 surface 中，provider 请求仅命中 loopback WebSocket，`liveOpenAIModelInvoked=false`。`thread/inject_items` 对照只进入模型历史而未进入可见 Turn，因此明确禁止作为主实验实现。该探针证明技术路径可行，不证明完整 session、答题编排、条件隔离、干净机部署或用户效率。

v2.19 已把 TRAIN-1 和六个 measured scenario 分别冻结为三轮 `conversation.json`，并由同一个原生 task materializer 读取。pack validation 不只校验文件存在与 digest，还要求正确 answer code 仍在 transcript、正确 object 仍在 entity set、脚本引用完整且 Agent 输出含有可实际选取的 canonical label 或 ID；任一漂移均在创建任务前失败。低层 task materializer 仍故意返回 `answerControlMounted=false` 与 `quietContextCompanionMounted=false`，防止把“对话已物化”误报为“完整试次已接通”。

v2.20 的默认 `runStudyV2NativeTrial` 在其上完成组合：独立 App Server 通过私有 loopback custom provider 创建三轮普通持久 Turn；只有当生成任务成为当前 Desktop task 后，才产生 `trial_shown` 并开始单调计时。A 仅挂载轻量答题/退出入口，B 在完全相同的 transcript、workspace 与答案键上额外挂载 Quiet Context Reveal。终态事件进入既有 checkpoint、问卷和原子结果管线；每轮结束只删除该 runner 创建的任务并关闭私有 runtime。创建任务、等待用户切换任务与清理的时间不计入参与者任务时间。自动回归和一次独立 App Server/loopback provider 探针已通过；它们不替代真实 A/B Desktop 端到端、干净机演练或人的效率结果。

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
- [ ] 刷新复用同一卡片 DOM，保持位置、滚动和 disclosure 状态，不出现视觉消失或跳回默认折叠；
- [ ] 显式刷新差异位于 P-C 心智模型之前，并按对象类型优先呈现决定理解/行动的字段；普通卡片没有常驻差异区；
- [ ] 同值差异不重复；新增、删除和值长度上限均有明确、可验证的投影语义；
- [ ] 详情打开后聚焦当前 Chat composer 不关闭卡片，输入框获得焦点且 revision 检查继续；
- [ ] 关闭按钮、Escape、普通外点和焦点恢复可用；
- [ ] 可信标题栏拖动可移动卡片、正文和按钮不误触拖动、位置不越出视口，刷新后保持移动位置；
- [ ] 普通复制、高亮、terminal、browser、diff 不误触。
- [x] 当前宿主 package 版本、executable 版本与 renderer bundle digest 已写入兼容性记录；
- [x] 自动四层状态与十项人工交互门禁分栏，pending/failed 不被表述为完整 build qualified；
- [x] 每个手工 PASS/FAIL 均有 workspace 内 exact evidence line，版本或 bundle 漂移会使记录失配；

### 13.2 数据门禁

- [ ] 只使用确定性 key/name/path/alias；
- [ ] 产品不存在“识别更多概念”模型分支；
- [ ] Markdown 用途、变化章节和引用位置均来自有界本地解析/Git，不调用模型；
- [ ] Source Module 的职责、exports、diff 声明、imports 和测试/引用位置均来自有界本地解析/Git，不执行源码、不调用模型；
- [ ] Test/Spec 源码只显示静态标题和“未执行”边界，不推断 PASS/FAIL；
- [ ] 已知 JSON 配置只显示用途与有限键名，配置值和潜在密钥不进入卡片；
- [ ] ADR/Decision 只从 path-qualified Markdown 的显式章节读取；
- [ ] Concept 只从 `docs/concepts/*.md` 的冻结结构读取，并复验 workspace 内证据行；
- [ ] Task 只从 `docs/tasks/*.md` 的冻结结构读取，不从 Chat/TODO/Git 自动推断状态；
- [ ] 实际 Verification 结果只从 `docs/verifications/*.md` 的冻结结构读取，必须同时包含 result、gap、method、verified revision、executedAt 与 exact evidence line；
- [ ] Agent 记录维护必须是一笔显式请求或当前有界任务的 opt-in，不按 Chat Turn/文件变化自动写入；
- [ ] 每次写入后的只读 Record Check 验证结构、时间、证据和跨类型 identity，失败记录不进入可用索引；
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
- [ ] 自动延迟基准始终标记 `technical_latency_only`，不冒充 `time_to_verified_fact`；
- [ ] session 前冻结 answer key、transcript、workspace fixture、slot assignment 与 `packDigest`；
- [ ] 每个 scenario 在 12-slot 日程中 A/B 各 6 次、每个序位各 2 次；
- [ ] 日志不含 raw selection、文件内容、配置值、普通 Chat、姓名或邮箱；
- [ ] A/B 两条件使用相同 transcript、项目状态和事实答案键；
- [ ] 呈现 pilot 的 P-A/P-B/P-C 使用同一对象、事实与证据，且条件内不可切换；
- [ ] `pilot` 的四个理解单元分别计分，不以“打开卡片”代替理解完成；
- [ ] trial 时间只来自原生 monotonic event；结果指标由事件推导并与 CSV 交叉校验，人工秒表不能覆盖；
- [ ] 六轮结果先在临时目录完成 schema、assignment、scoring、privacy 与 integrity 校验，再原子发布；
- [x] 受控固定回复可形成普通、持久的 Codex user/assistant Turn，Desktop 中可见且可选，同时只连接本机 loopback provider；
- [x] TRAIN-1 与六个正式 scenario 已冻结为有界多轮脚本，并可由共享 materializer 形成普通原生 Turn；
- [x] 六轮 session runner 的默认主路径已用原生 scripted task、轻量答题和条件 companion 替换覆盖 Chat 的旧 renderer；
- [ ] A/B 在同一原生 transcript/workspace/answer key 上运行，B 只增加 Quiet Context Reveal；
- [x] 轻量答题入口已在当前 build 完成人工形成性验收：展开不遮挡主要 Chat、收起后入口保留、重新展开选择答案后自动清理；
- [ ] A/B 完整端到端中答题与退出入口不覆盖 Chat Lane，且不会把预制历史 Turn 计为参与者 Chat Turn；

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
| App Server + loopback scripted Responses | 主线研究基础 | 物化真实、固定、无线上模型的原生多轮 Codex 任务 |
| DCPM/CWA | 可选参考 | 非产品主体和运行前提 |
| Dashboard/workbench | 延后 | 比较、关系、批量与持续管理升级表面 |

## 15. 当前实现状态与缺口

截至 2026-08-20，已有：

- 原生 Chat Lane 选区资格判断与锚定按钮；
- selection inert、trusted click 查询、0/1/2–3/>3 路由；
- task/route/context/selection/lifecycle fence；
- fixture 与显式绑定 workspace 的只读 Provider；
- Markdown Artifact Context Extractor：用途、变化章节、确定性引用、Git 状态和路径；
- Source Module Context Extractor：职责、公开入口、变化声明、直接依赖、测试/引用关联和路径；
- Test Definition 投影：静态 `test/it` 标题、未执行边界、源码变化和有限依赖；
- Known JSON Configuration 投影：用途、有限顶层键名、零值披露和路径；
- Path-qualified ADR 投影：显式状态、决策、原因、后果和路径；
- 显式 Concept Artifact：严格结构、确定性名称、当前步骤、边界和 workspace 内证据行复验；
- 显式 Agent Work Result：严格 Task/Verification 结构、时间/验证修订、证据行复验与静态测试定义隔离；
- opt-in Agent 产出策略与只读 Record Check：稳定里程碑资格、已有 identity 更新、跨类型重名拒绝和写后 fail-closed；
- renderer 固定的 `record/narrative/mental-model` 三种研究条件，以及 concept/change/decision/task/verification 五种 P-C 微型心智模型和卡内证据展开；
- 摘要优先的卡内 progressive disclosure：默认隐藏事实/元数据/来源，保留类型与 freshness；
- Artifact、Module/Concept、Decision/Task 类型化详情；
- 来源、修订、新鲜度、观察时间和文本 fallback；
- 关闭、Escape、外点、导航清理与 stale-response 防护；
- 现有 MCP App 胶囊零 `ui/message`、零浏览器导航。
- 文件卡片的 pinned snapshot、stat/Git/字面关系/evidence-source revision v2 探测、`内容已更新` 提示、显式原位刷新和最多 3 项差异；
- 显式刷新后的类型化差异优先级：Task/Verification/Decision/Concept/Change 分别先回答用户此刻最需要理解或行动的问题，且位于完整心智模型之前；
- revision detail ref 的过期、task 重绑定、context 与容量 fail-closed 约束；
- 无后台遥测的可重复技术延迟基准，以及 counterbalanced 人工 A/B 协议；
- 冻结 study pack v1：P-A/P-B/P-C 与 A/B 两层分配、六类任务、exact-evidence answer key、隔离 Git workspace、revision mutation、隐私日志与 pack digest 校验；
- 显式长任务 Context Coverage：严格声明 Module/Decision/Task/Verification，逐项复验 Index + Provider + Record Check，并分开输出 coverage/omission/projection-failure/redundancy；当前仓库首个四对象基线为 4/4 available。
- 逐 build 兼容性资格记录与只读检查器：绑定 `OpenAI.Codex` package/executable 版本、renderer bundle digest、自动四层 gates 和十项 evidence-bound 人工门禁；renderer 变化后人工证据必须重做，不能沿用旧 digest；
- study-v2 原生事件到严格结果的自动管线：trial-relative monotonic timing、冻结 scoring contract、客观指标推导、六轮 sequence 归一化、trial/event 交叉校验和临时目录原子发布；
- study-v2 六轮 session orchestration：逐轮 digest checkpoint、连续前缀恢复、环境/pack/participant/slot/build 复验、`awaiting_questionnaire` 两阶段终结、未完成试次 fail-closed、原生 Chat Lane 五量表问卷和完成回执；
- study-v2 原生受控会话主 runner：私有 loopback custom provider、普通持久 Codex Turn、精确当前-task 激活门禁、轻量答题、条件 B companion、逐轮 checkpoint、结果管线和精确 task/runtime 清理；
- study-v2 原生场景材料：TRAIN-1 与六个 measured scenario 各三轮冻结对话，pack 对 answer code、correct object、完整引用与 Agent 输出中的 exact selectable term 做一致性门禁；共享 helper 已能将任一 measured scenario 物化为普通持久 Codex Turn；

仍缺：

- 当前已能把稳定 Agent-known Concept/Change/Decision/Task/Verification 写成受门禁的 workspace 制品；仍缺不适合落盘的临时 Agent-known 对象 Provider；
- 将显式 Verification 制品从文件式人工/Agent 记录扩展到可靠的测试运行事件接入；测试源码卡本身永远不能替代运行结果；
- 在真实长任务中测量已冻结产出策略的覆盖率、冗余率与漏记率；
- 证明不同 Codex Desktop 版本中的 Host Adapter 兼容性；
- 在真实长周期任务中完成延迟重返、跨会话恢复、状态漂移和交接场景的效果验证；短任务受控效率研究暂缓。
- study-v2 原生 Chat Lane 问卷已通过当前 build 的有界形成性验收，包括未选满禁用、五项提交、无 Chat Turn、收起后可见重进入口、状态保留与最终清理；仍缺干净 Windows ZIP 演练与真实提交演练。当前两阶段 CLI 仅用于内部原型，不能替代研究治理门禁。
- 旧 native trial renderer 仍保留作组件资格、培训与故障诊断，但默认试次已不再调用它；当前仍缺真实 A/B 各一次当前-build 端到端和干净 Windows ZIP 验收。

## 16. 推荐实施顺序

1. 已完成摘要态、卡内展开/收起和关闭的当前 Codex Desktop 人工验收；
2. 已完成当前 build 的四层启动兼容性自检与失败降级；
3. 已完成首个文件 revision 失效提示、显式零-turn 刷新、有限差异和真实 Edge 零-turn 验收；
4. 已完成文档、模块、测试源码、已知 JSON 配置与 path-qualified ADR 的摘要策略和真实仓库 Provider 验证；
5. 已完成隔离技术延迟基准和正式 A/B 协议；
6. 已完成人工采用 P-C 的 concept/change/decision 三种首批信息结构；P-A/P-B 继续只作为研究基线；
7. 已完成 stat/Git/字面关系/evidence-source revision v2 的真实 Chat Lane 动态变化验收；
8. 已完成轻量 Task/Verification 制品、Context Index 投影、自动回归和真实 Chat Lane 人工理解验收；
9. 已冻结 opt-in Agent 产出策略和只读 Record Check，防止记录泛滥并确保写后可验证；
10. 已冻结 counterbalanced study pack v1、答案键、12-slot 分配、隔离 workspace、mutation 与完整性检查，并将其保留为非当前门禁的研究资产；
11. 已完成首个显式长任务 Context Coverage 门禁：Module/Decision/Task/Verification 逐项验证、四类指标、隐私边界和当前仓库 4/4 基线；后续 dogfood 持续扩充真实期望对象；
12. 已完成对象多轮修改后的 pinned snapshot、revision drift、同卡刷新、删除/不可用、任务重绑定，以及显式刷新差异的类型化优先级与首层投影；后续 dogfood 持续校准字段优先级；
13. 已完成逐 build 兼容性证据入口、当前宿主/renderer 精确绑定、自动与人工门禁分栏及 fail-closed 检查；当前精确 `OpenAI.Codex 26.814.5517.0`、executable `151.0.7922.137` 与 v2.14 renderer digest `d00e4620…2855` 已通过自动 4/4、人工 10/10；
14. 已完成 opt-in Agent 里程碑制品维护扩展：Concept/Change/Decision 与 Task/Verification 共用稀疏产出策略，前三类增加只读 Artifact Check；
15. 开展长周期 dogfood，重点观察延迟重返、跨会话恢复、状态漂移和任务交接；当前显式 Coverage 随 Artifact Check 与首个原生理解验收扩展到七个期望对象；
16. 已完成受控固定回复进入普通 Codex Turn 的技术垂直切片，并在 Desktop 验证四条消息可见、可选、零线上模型；
17. 已把 TRAIN-1 与六个 measured scenario 冻结为三轮脚本，并完成答案/对象/可选词一致性门禁、私有 scripted runtime、原生 task 激活、轻量答题、B 条件 companion 与既有 checkpoint/result 管线接入；轻量答题控件的当前-build 人工形成性验收已通过；
18. 完成 A/B 各一次当前-build 端到端和干净 Windows ZIP 演练；只有研究治理门禁也通过后，才运行效率实验，并据内部 pilot 方差决定正式样本量。

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
11. 概念卡普通启动固定使用 P-C 微型心智模型；当前不运行 P-A/P-B/P-C 呈现比较，P-A/P-B 只作为未来研究基线，产品选择不得写成效率结论。
12. P-C 首批只资格化显式 concept/change/decision 制品；普通 prose、任意 Git diff 和隐含决策均不做语义推断。
13. 后台 revision v2 只散列有界 stat、Git 与字面关系信号；详情重读仍必须由可信刷新动作触发。
14. 打开的卡片是回复时的临时阅读参照；聚焦当前 Chat composer 不关闭卡片，其他外点仍按 Quiet Reveal 规则清理。
15. 显式刷新必须复用当前卡片 DOM，并保留位置、滚动与渐进披露状态；数据更新不等于重建界面上下文。
16. Agent 工作结果只有在稳定、结构完整且证据可复验时才进入 Task/Verification 索引；不从普通 Chat、测试源码或文件存在推断完成与 PASS/FAIL。
17. Agent 记录维护默认关闭；一次性请求或当前有界任务的明确 opt-in 才能启用，且所有写入必须通过只读 Record Check。
18. 研究数据只有在 frozen pack validation 通过且每行绑定同一 `packDigest` 时可纳入；材料校验和自动 Provider 回归不得冒充参与者结果。
19. 短任务 presentation/efficiency pilot 不是当前开发门禁；效果验证优先放在真实长周期任务的延迟重返、跨会话恢复、状态漂移和交接场景。
20. 动态刷新不复刻整张卡片；只在用户显式刷新后把最多三项、按对象理解任务排序的变化放在首层，普通阅读状态继续保持 Quiet。
21. `qualified_current_runtime` 只是自动宿主合同结果；完整 build 资格必须再绑定精确宿主版本、renderer digest 与十项有证据的人工门禁，且不得从一个 build 外推到另一个 build。
22. Agent 只在显式 opt-in 的稳定里程碑产出少量 Concept/Change/Decision/Task/Verification；Concept/Change/Decision 写后必须通过只读 Artifact Check，不能从普通 Chat 扫描或隐含推断。
23. 详情卡允许用户通过标题栏临时移动位置以继续阅读被遮挡的 Chat；拖动不是新查询、不产生 Chat Turn，并且不得把正文、disclosure 或关闭按钮变成拖动热区。
24. 受控实验必须把固定历史物化为普通 Codex Turn；`thread/inject_items` 和覆盖 Chat 的仿真 surface 均不能替代原生可见对话。旧 renderer 仅保留作组件资格、培训与诊断。
25. 实验可使用本机 loopback scripted Responses provider 维持回复可控，但不得调用线上模型、记录原始 prompt 或把 provider 配置写入正式产品路径。
26. 原生受控试次只有在 runner 创建的精确任务成为当前 Desktop task 后才开始计时；任务生成、用户切换与清理时间不计入参与者任务时间。每轮终止必须删除且只能删除本轮生成的任务，并关闭私有 provider/App Server。

## 18. 变更记录

- v2.20：把原生 scripted task 接入默认单轮与六轮 session runner。每轮使用独立 loopback custom model provider 和 App Server 创建三轮普通持久 Turn，精确任务激活后才挂载轻量答题；A 不加载 companion，B 只增加 Quiet Context Reveal。终态进入既有 digest checkpoint、问卷与原子结果管线，结束时精确删除生成任务并关闭 runtime。当前 build 的轻量答题控件已通过“展开不遮挡、收起保留入口、重新展开答题后清理”的人工形成性验收；289/289 自动回归和独立 App Server/loopback provider 探针通过。真实 A/B 完整端到端、干净机与研究治理仍待完成，不构成人效结论。
- v2.18：把 study-v2 主表面从覆盖 Chat 的仿真 trial 改为受控原生 Codex 多轮任务。实现本机 HTTP/SSE + Responses WebSocket scripted provider 和可复用 task materializer；两轮 live probe 在 Codex Desktop 中显示 2 条用户消息、2 条 Agent 回复及 4 个标准可选 surface，且只命中 loopback、未调用线上模型。对照证明 `thread/inject_items` 只有模型历史而没有可见 Turn。该结果只是原生重放技术资格，不代表完整 A/B runner、干净机部署或效率效果。
- v2.17：完成当前精确 `OpenAI.Codex 26.814.5517.0`、executable `151.0.7922.137` 与 v2.14 renderer digest `d00e4620…2855` 的逐 build 资格。四层自动 gates 4/4、原生交互人工 gates 10/10 均绑定 exact evidence line 并通过只读检查器；study-v2 doctor 因而在当前开发机转为 ready。该结论不外推到其他宿主版本、其他 renderer、干净机可部署性或人的效率提升。
- v2.16：把第二阶段评分从命令行参数改为 Codex Chat Lane 内的原生五量表问卷。五项全部选择后才允许提交；提交只经临时 Host binding 返回有界数字，不写入 Chat、不调用模型、不接受自由文本。真实形成性验收发现“稍后完成”缺少重进入口后，行为改为收起至“继续填写研究问卷”轻入口并保留已选状态；修复后的收起、恢复、提交、清理与零 Chat Turn 已在当前 build 通过。超时不发布结果，finalize 对不完整 session 仍在挂载问卷前 fail-closed。
- v2.15：接通 study-v2 六轮可恢复 session、原生事件与严格结果管线。所有任务时间和交互指标从 trial-relative monotonic event 自动推导，冻结 scoring contract 决定正确答案/对象，超时和退出使用 `NO_ANSWER`；逐轮 digest checkpoint 只恢复连续完整前缀，六轮全局 sequence 归一化后先在临时目录交叉校验 event/trial/assignment/privacy/integrity，再原子发布。两阶段 CLI 在 `awaiting_questionnaire` 后只接受五个 1–7 数字；未完成六轮的 finalize 在运行试次或采集问卷前 fail-closed。该切片仍不授权参与者数据收集。
- v2.14：根据原生形成性验收加入有界标题栏拖动。只有可信主指针按下标题栏才能启动；正文选择、按钮点击和关闭保持独立。位置被夹在视觉视口内，在同卡刷新时保留，关闭或新选区后清除；真实 Edge 连续三次覆盖拖动、composer 保持、revision 提示、同卡刷新与关闭，尚待当前 Codex build 人工复验。
- v2.13：把已有 opt-in Task/Verification 记录维护扩展为五类稀疏里程碑制品；Agent 可在当前工作已明确建立稳定 Concept/Change/Decision 时写入冻结目录，但不得扫描普通 Chat 或推断隐含对象。新增只读 Artifact Check，验证严格章节顺序、文件/H1 身份、跨类型唯一性、非循环 exact evidence 与稳定文件读取；失败制品不进入可用索引。
- v2.12：完成当前精确 `OpenAI.Codex 26.810.7004.0`、executable `151.0.7922.137` 与 renderer digest 的逐 build 资格；四层自动 gates 4/4、原生交互人工 gates 10/10 均以 exact evidence PASS。结论只覆盖该组合，不外推跨版本兼容。长任务 Coverage 同步声明新增的兼容性模块，产品进入延迟重返、跨会话恢复、状态漂移和交接 dogfood。
- v2.11：新增逐 Codex Desktop build 的兼容性资格记录与只读检查器；记录精确 package/executable 版本和 renderer bundle SHA-256，把四层自动宿主自检与十项人工原生交互门禁分开。人工 PASS/FAIL 必须绑定 exact evidence line，pending、版本漂移、bundle 漂移或证据漂移均不能得到完整资格。当前 build 自动 PASS、人工 pending，尚不构成跨版本兼容性结论。
- v2.10：把动态更新从“有限字段差异”收敛为类型化理解差异；显式刷新后，Task 优先状态/下一步/阻塞，Verification 优先结果/未证明/目标，Decision 优先选择/后果/问题，Concept/Change 优先当前语境或影响。差异置于 P-C 心智模型之前、去重并显式标记新增/删除；普通未刷新卡片仍不显示常驻变化区。该切片改善信息排序，但不构成人类效率证据。
- v2.9：新增显式长任务 `docs/context-coverage.json` 与只读 Coverage Gate；只对作者声明的 Module/Decision/Task/Verification 逐项验证 Index、Provider detail 和 Record Check，分开计算 coverage、omission、projection failure 与 record redundancy，输出不含事实或文件内容。当前仓库首个真实基线为 4/4 available；该门禁不推断未声明的重要对象，也不构成效率证据。
- v2.8：产品路线直接采用 P-C 微型心智模型，暂缓 P-A/P-B/P-C 呈现比较与短任务效率 pilot；冻结 study pack v1 继续保留但不作为当前门禁。下一阶段改为完善真实长周期开发任务的对象覆盖、动态 revision、原生兼容性与记录质量，之后在延迟重返、跨会话恢复、状态漂移和交接场景中重新冻结验证实验。
- v2.7：冻结未运行的 study pack v1：呈现 pilot 采用 P-A/P-B/P-C 各 4 个匿名 slot，效率 pilot 采用六行循环 Latin square 与 A/B phase inversion；加入六类实际开发任务、exact-evidence answer key、隔离 Git workspace、确定性 revision mutation、隐私日志、slot assignment CLI 与 pack digest 校验。自动端到端仅证明材料/Provider 一致，仍不构成用户效率证据。
- v2.6：记录 Task/Verification 原生卡片已通过当前场景人工验收；冻结一次性/有界任务两种 opt-in 授权、四项里程碑资格和已有 identity 更新策略；新增只读 Record Check，对结构、ISO 时间、exact evidence 与跨类型 stem 唯一性 fail closed。该验收与检查仍不构成用户效率证据。
- v2.5：新增证据绑定的显式 Agent Work Result 合同；`docs/tasks/*.md` 投影目标/状态/进展/下一步/阻塞，`docs/verifications/*.md` 投影 Claim/Result/Gap 并保留方式、验证修订和执行时间；两者进入同一 Quiet Reveal 与 P-C 原生卡片，普通 Chat 和测试源码仍不得自动产生完成/PASS 结论。
- v2.4：修正真实关系变化刷新时的界面连续性；显式刷新改为复用同一卡片 DOM，保留位置、滚动、详情与证据展开状态，并加入真实 Edge 的对象身份和 UI 状态回归。
- v2.3：把“边读边回复”纳入原生交互合同；详情卡打开时聚焦当前 Chat composer 保留卡片及后台 revision 检查，入口态或普通外点仍关闭，并加入真实 Edge 焦点/持久性验收。
- v2.2：记录三类 P-C 样例获产品负责人采用但不外推效率结论；把动态 revision 从 stat-only 扩展到目标 Git 状态/最近提交、Provider 同口径的字面引用成员集合，以及显式心智模型的 evidence source stat；完整详情仍只在可信刷新后读取。
- v2.1：把 P-C 从单一 `pilot` 概念扩展为三种显式、证据绑定的微型心智模型：concept 的“定义/语境/流程/边界”、change 的“Before/After/Impact”、decision 的“问题/选择/后果”；加入 `presentation-default` 与 `native-chat-lane` 真实样例，仍保持无模型、零 Chat Turn 和普通 prose 不推断。
- v2.0：记录同一 `pilot` 的单用户形成性比较结果（P-C 优于 P-A/P-B，P-A 与 P-B 接近），将 `mental-model` 收敛为普通启动默认；保留 P-A/P-B 作为固定研究基线，并明确该选择不是理解速度、正确率或 Chat Turn 效果证据。
- v1.9：把卡片目标从“有界记录摘要”推进到“类型匹配的微型心智模型”；新增严格、无模型的 `docs/concepts/*.md` 概念制品与证据行复验；为同一 `pilot` 数据加入固定 `record/narrative/mental-model` 三种原生呈现条件、卡内证据展开和 8–12 人非推断性 pilot 协议。
- v1.8：把技术响应速度与人的信息获取效率拆开；加入无模型、零 Chat Turn 的可重复 workspace latency benchmark、首个本机基线和 counterbalanced A/B 协议，明确自动 benchmark 不得冒充 `time_to_verified_fact` 或显著性证据。
- v1.7：加入安全的场景摘要切片：测试源码只显示静态测试标题并明确未执行，已知 JSON 配置只显示用途和键名，path-qualified ADR 只读取显式决策章节；用当前仓库文档、模块、测试和配置做 Provider 实测，避免通用五字段堆叠。
- v1.6：为打开的文件卡片增加绑定上下文的短期 detail ref、轻量 stat revision 探测、`内容已更新` 提示、可信显式原位刷新与最多 3 项差异；删除/不可用保留旧快照，过期、重绑定和容量耗尽 fail closed；真实 Edge 验收确认该路径零 Chat Turn。
- v1.5：为 workspace companion 增加 `qualified/unavailable/incompatible/unchecked` 四态兼容性自检；按精确主目标、主 frame、默认主 execution context 与 renderer lifecycle fail closed，并明确启动检查不替代人工交互门禁。
- v1.4：把五项事实从默认首屏改为卡内渐进披露；默认只保留场景摘要、类型和 freshness；冻结新增 Extractor，优先解决动态 revision 语义、场景信息优先级和 Codex Desktop 兼容性。
- v1.3：加入 TypeScript/JavaScript Source Module Context Extractor；通过文件头说明、公开导出、静态依赖、Git diff/status/log 和有界字面引用提供五项代码模块速览，保持零执行、零模型、零 Chat Turn。
- v1.2：在已验收的 Quiet Mode 原生链路上加入 Markdown Artifact Context Extractor；通过文件结构、Git diff/status/log 和有界字面引用提供“用途、本次变化、影响范围”，保持零模型、零 Chat Turn 和非 Git 显式降级。
- v1.1：把默认入口从 Agent 输出旁主动胶囊改为 Selection-triggered Quiet Context Reveal；Agent-known 退回数据层；彻底删除“识别更多概念”与选区语义模型；保留类型化胶囊作为点击后的详情投影和可选 MCP 渲染参考。
- v1.0：以 Agent-known 原生 Context Capsules 为主入口，建立零-turn 类型化详情，但默认可见程度过高。
- v0.12 及以前：Selection Quick Look、Referent 回流和浏览器工作台探索，现仅复用解析、安全和宿主生命周期资产。

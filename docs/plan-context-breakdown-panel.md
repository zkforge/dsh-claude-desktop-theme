# 计划：把上下文圆环面板做成 Claude Code 式「上下文窗口分解」

> 状态：**已实施**（2026-10-09）。实施记录与三处与本文原方案的偏离见文末「实施记录」。
> 试用调整（2026-10-09）：保留 360px 尺寸，移除「估算差额」行；每次打开时，标题与各明细分组全部默认收起。下文原方案中的差额行已由这次调整取代。
> 参照物：Claude Code Desktop 的 Context window 面板，两态。**收起态**：`Context window` + `216.7k / 1M (22%)` + 右侧 chevron，下面一条 4px 分段条（参照图 2）。**展开态**：同一头部之下是分类行 + 百分比 + 可展开的逐工具/逐文件明细（参照图 1）。
> 用户已明确：**不要「See detailed breakdown」按钮**；展开由标题行的 chevron 承担。
> 一句话结论：**形态与交互 100% 可做**（仓库已有 5 处「自绘面 + 原生 popover 顶层」先例）；**数据侧 6 成是宿主权威值、3 成可用宿主同一套启发式精确重算、2 处只能作为派生值如实标注**（自动压缩余量、采样值与启发式的差额）。

## 一、这份计划解决什么

现在环点开是宿主的 264px 面板：标题 + `~已用/窗口` + 4px 三段条（系统提示词 / 工具 / 对话）+ 三行图例。**没有**百分比列，没有 MCP 与系统工具的拆分，没有技能 / 记忆文件 / 自动压缩余量 / 空闲空间行，也没有可展开的逐项明细。

目标是把它换成参照物那种分解面板。环本体不动：`15-voice-input-and-context-ring-placement.md` 定下的「环不显示百分比、空会话也显示」结论保留，百分比只出现在面板里。

### 验收标准（可测量）

1. 面板出现在环上方 ≤8px，宽 360px（视口 clamp 12px），右缘与环对齐；宿主原生面板**从不出现**。
2. **两态**：收起态只有标题行（`Context window` + `~已用 / 窗口 (百分比)` + 右侧 chevron）与 4px 分段条，没有按钮、没有分隔线；点 chevron 或标题行展开成分类行（左色块 + 名称 + token + 百分比三列）与可展开分组（MCP 工具 / 系统工具 / 技能 / 记忆文件），再点收起。
3. 数值口径见 §6：工具组合计 = 宿主 `contextBreakdown.toolsTokens`；系统提示词行 = 宿主 `systemTokens`；对话消息行 = `messageTokens − 技能 − 记忆`；头部与宿主环同值。
4. 浅深两套配色、无字面色值、`npm run check` 全绿；真实 Chrome 测试覆盖两态切换、锚定几何、外点/Escape 关闭并回焦、宿主面板隐藏、深浅配色。

## 二、参照物规格（从截图量测 + 采样，非目测）

### 2.1 收起态（参照图 2，698×178 @2x → 349×89 CSS px）

- 卡片：白底、圆角 ≈12px、内边距 12px、宽 ≈349–360 CSS px。
- 标题行：左「Context window」13px 次要色；右「216.7k / 1M (22%)」同一字号；最右一枚 ≈12px 的浅灰 chevron（`#BFBFBF`，`>`）。
- 分段条：距标题行下沿 ≈10px，高 4px、左端圆角；轨道 `#EEEEEE`（空闲空间）。
- 条内分两群：**已用群**（MCP / 系统工具 / 系统提示词 / 技能 / 记忆，段间 1px 间隙）与**自动压缩余量段**（灰 `#C5C0B6`），两群之间留 **4px** 空隙（参照图 1、2 都有这个空隙）。
- 无分隔线、无按钮（用户已去掉）。

### 2.2 展开态（参照图 1）

- 头部与分段条与收起态完全一致，chevron 转为朝下。
- 行：13px / 行距 ≈19–20px；左侧 10px 圆角色块 + 名称，右侧 token 与百分比两列等宽数字。
- 分组头：`▾ MCP tools 47.9k 85`（chevron + 名称 + 合计 + 条数）；展开后灰字逐项行（名称 + token）。
- 采样色（浅色）：MCP `#2A77D8` / 系统工具 `#EB6835` / 系统提示词 `#1DAD7D` / 技能 `#EDA004` / 记忆文件 `#EA7BA5` / 自动压缩余量 `#C5C0B6` / 空闲 `#EEEEEE`。深色需另配一套（参照图只有浅色）。

## 三、DSH 侧数据现实（已核实）

### 3.1 权威值：宿主自己也这么算，客户端可直接读

- `contextPressure`：`{pressureTokens, projectedTokens, surfaceTokens, sampledSurfaceTokens, contextWindow}`；占用 = `projectedTokens ?? pressureTokens`（asar `dsh-client-ui-conversation/lib/client.js:16912-16920`）。
- `contextBreakdown`：`{systemTokens, toolsTokens, messageTokens}`，等于当前 surface 的启发式总量（asar `dsh-token-meter/lib/types/breakdown-projection.js:33-67`）。
- `requestHeader(): EpochHeader`（未弃用的读口，`@deepseek-ai/dsh-session` `lib/types/index.d.ts:259`）→ `header.tools: ToolSchema[]`（`{name, description, parameters, deferLoading?}`）；`requestContext().contextWindow`。
- 消息带结构化来源：技能目录 `source={kind:'skill-catalog', entries:[{name,description}]}`（asar `dsh-tool-skill/lib/index.js:238-262`）；AGENTS.md 指令 `source.kind==='agent-instructions'` + 正文 `Instructions from: <displayPath>`（asar `dsh-agent-instructions/lib/index.js:130-132,784`）。
- MCP 工具没有来源字段，只能靠公开名前缀 `mcp__<serverName>__<rawName>` 识别（asar `dsh-mcp-client/README.zh.md:71-77`）。

### 3.2 实机验证（本机真实会话日志与投影缓存）

- 某会话：`contextBreakdown={system:1953, tools:7921, messages:90461}`，`contextPressure={surfaceTokens:90953, pressureTokens:112035, sampledSurfaceTokens:90321, contextWindow:1000000}` → **采样值与启发式树差 ≈11%**，必须在界面上显式处理，不能假装行相加等于头部总数。
- 逐工具计价：真实会话 37 个工具，整数组 `ceil(JSON/4)+4 = 7492`，逐项合计 `7657`（+2.2%，逐项取整差）。
- 记忆文件：真实日志 5 条 instructions 消息 / 1785 tk，可按 `Instructions from:` 切出逐文件行。
- 技能目录：真实日志存在 `skill-catalog` 消息（2204 tk），`source.entries` 结构化可读。
- 本机 `compaction-basic` 是 `disabled: true`（`~/.dsh/profiles/desktop/cordis.yml:275-277`）→「自动压缩余量」行应**隐藏**而不是按默认值硬算；本机未配置 `mcp-client` → MCP 行按数据出现与否条件显示。

### 3.3 数据通道

- 插件 host 半边注册带 `wire` 的投影即可推给浏览器：`sessionProjections.cachedSnapshot()` 只产出声明了 `wire` 的单元（asar `dsh-session-projection/lib/index.js:165-170`），会话列表 RPC 把「源当前持有的每个 wire 值」交给客户端（asar `dsh-api-session-controller/lib/types/list.js:262-276`）。
- 先例成立：本插件 `ccdUsage` 投影在本机 151 份缓存记录里出现 149 次（`~/.dsh/storages/session_projcache/sessions/*.json`），登记与持久化都已在真实部署里跑通。
- 客户端读法：`ctx.sessions.list.getSnapshot().projectionsBySession[id].values[...]`——插件已经在用 `ctx.sessions.list`（[adapter.ts](../src/client/compat/adapter.ts)）。
- 当前会话 id：宿主会话区带 `data-conversation-session="<id>"`，composer 座位是它的后代（asar `dsh-client-ui-conversation/lib/client.js:16324-16335`）→ 从环 trigger `closest()` 即可取到，是稳定数据属性，可登记进 [host-dom.ts](../src/client/compat/host-dom.ts)。
- 回退方案：插件自己的认证路由（[service.ts](../src/host/stats/service.ts) 先例），若第 0 步探针证明投影在客户端不可见则改走它。

## 四、总体方案

- **数据分工**：权威三档由客户端直接读宿主投影（`contextPressure` / `contextBreakdown`）；插件只在自己的 host 投影 `ccdContext` 里携带必须重算的部分（逐工具行 + MCP 分组、逐文件行、逐技能行、压缩阈值）。这样既不重复宿主的 fold，也不引入对宿主包的运行时依赖（沿用 `ctx.get()` 结构化取值的既有风格）。
- **界面**：新 feature `context-panel`，React 面挂 `shell.overlay`（order 40，view-options 为 30）；面板用 `popover="manual"` + `showPopover()` 进顶层（复用 [popup.ts](../src/client/features/model-controls/popup.ts) 的定位 / 关闭 / 焦点陷阱模式），保证盖住宿主 `z-index:1100` 的原生面板。
- **两态**：面板自持一个 `expanded` 状态，默认收起。收起态 = 标题行（可点，`aria-expanded="false"`）+ 分段条；展开态 = 同一头部 + 分类行与分组。chevron 随状态转向（收起 `>`、展开 `⌄`），标题行整行都是切换热区；**没有底部按钮**（用户已去掉），展开态也不额外加分隔线。
- **接管宿主面板**：驱动在环 trigger（[host-dom.ts](../src/client/compat/host-dom.ts) `.y0jqnG_trigger`）上以捕获阶段拦截 click 并 `stopPropagation`，宿主面板永不打开（view-options 的既有手法）；插件自持开合状态。兜底：面板打开期间在 `documentElement` 打 `data-ccd-context-open`，CSS 用 `visibility:hidden;pointer-events:none` 隐藏 `.y0jqnG_panel`（不用 `display`，理由见 [view-options.css](../src/client/features/view-options/view-options.css)）。该 CSS 模块前缀已在 [host-builds.ts](../src/client/compat/host-builds.ts) 登记，新增选择器无需重解前缀表。
- **不驱动宿主开合**：宿主的 `useDismissOnOutsidePointer` 会把我们面板内的点击当成外部点击，驱动式同步必然被误关；自持状态是唯一稳的路线。

## 五、逐文件改动清单

### 新增（host）

| 文件 | 职责 |
| --- | --- |
| `src/host/context/pricing.ts` | 宿主同口径启发式（`ceil(len/4)`、`+4` 块开销），纯函数 |
| `src/host/context/unit.ts` | 投影单元 `ccdContext`（`stateSchema` / `init` / `apply` / `wire.viewSchema` / `stateVersion: 1`）：增量 fold 最新 `request/header` → 逐工具行，instructions 消息 → 逐文件行，`skill-catalog` 消息 → 逐技能行；状态有界，只留当前值 |
| `src/host/context/compaction.ts` | 读生效压缩策略（`ctx.get('loader').entries()` → entry 配置，跳过 `disabled`）→ `{thresholdTokens, headroomTokens} \| null` |
| `src/host/context/service.ts` | `mountContextBreakdown(ctx, isEnabled)`，镜像 `stats/service.ts` |
| `src/shared/context.ts` | 键名常量 + wire 契约类型 + 行算术纯函数（host/client 共用） |

### 新增（client）

| 文件 | 职责 |
| --- | --- |
| `src/client/features/context-panel/{index.ts,mount.ts,ContextPanel.tsx,context-panel.css}` | 面板本体（收起 / 展开两态）；文案内嵌 zh/en（按 `document.documentElement.lang`，[ViewOptionsCard.tsx](../src/client/features/view-options/ViewOptionsCard.tsx) 惯例） |
| `src/client/compat/context-panel.ts` | 驱动：定位 trigger、拦截 click、自持开合、读 `data-conversation-session`、订阅 `ctx.sessions.list`、会话切换/锚点消失即关闭、兜底隐藏标记的加与清 |

### 修改

- [host-dom.ts](../src/client/compat/host-dom.ts)：新增 `contextMeterPanel`、`conversationSession` 两个锚点。
- [ports.ts](../src/client/contracts/ports.ts) + [adapter.ts](../src/client/compat/adapter.ts)：新增 `contextBreakdown` port（读宿主两个投影 + 插件投影 + 当前会话 id）。
- [tokens.css](../src/client/theme/tokens.css)：`--ccd-context-*`（7 色浅深两套 + 轨道 + 面板几何 / 条高 / 行距）。
- [apply.ts](../src/client/apply.ts)：按开关挂载；[config.ts](../src/shared/config.ts)、[index.ts](../src/host/index.ts)、[locales.ts](../src/client/features/settings/locales.ts)、[ConfigPage.tsx](../src/client/features/settings/ConfigPage.tsx)：新开关 `context-panel`（默认开）。
- 文档：[ARCHITECTURE.md](../ARCHITECTURE.md)（界面模块表 + 数据通道段）、[DESIGN.md](../DESIGN.md)（面板几何 / 配色）、[README.md](../README.md)、[LIST.md](LIST.md)。

### 测试

- `tests/context-pricing.test.ts`：host 纯 fold（工具拆分与残差、instructions / 技能解析、空会话）。
- `tests/context-projection.test.ts`：apply / view / 状态 schema 往返 / stateVersion。
- `tests/context-panel-card.test.ts`：源码契约（CSS 数值、ARIA、文案、行序、**默认收起且无底部按钮**）。
- `tests/context-panel-browser.test.mjs`：真 Chrome（**两态切换与 chevron 方向**、锚定几何、clamp、展开、外点与 Escape 关闭并回焦、宿主面板隐藏、浅深配色），复用 [headless-chrome.mjs](../scripts/lib/headless-chrome.mjs)。
- `tests/context-panel-driver.test.ts`：拦截与标记清理，仿 [view-options-driver.test.ts](../tests/view-options-driver.test.ts)。
- [config.test.ts](../tests/config.test.ts)：新开关一行。

## 六、数值口径与边界（decision-complete）

记 `W = contextWindow`，`U = projectedTokens ?? pressureTokens`，`H = system + tools + messages`。

| 行 | 值 | 来源 |
| --- | --- | --- |
| 系统提示词 | `systemTokens` | 权威 |
| 工具（MCP / 系统两行） | 总量 `toolsTokens`；按 `mcp__<server>__<tool>` 前缀拆分；逐项 = `ceil(JSON.stringify(tool).length / 4)`；残差 = `toolsTokens − Σ逐项`（含数组级 +4 与取整差），并入工具组小计 | 权威总量 + 重算明细 |
| 技能 | Σ 全部 `skill-catalog` 消息；逐技能行只列最新目录的 `entries` | 重算 |
| 记忆文件 | Σ 全部 instructions 消息；逐文件行取 `source.changes` 路径 + 按 `Instructions from:` 切段 | 重算 |
| 对话消息 | `max(0, messageTokens − 技能 − 记忆)` | 权威 − 重算 |
| 估算差额 | `R = U − H`，`\|R\| ≥ max(200, W × 0.1%)` 才显示（带符号，不参与分段条） | 派生 |
| 自动压缩余量 | `W − floor(min(W × 0.8, W − 输出预留 − 65536))`；策略禁用或读不到 → 整行隐藏 | 派生 |
| 空闲空间 | `W − U` | 派生 |

- 分段条 = 各行按 `token / W` 缩放（宽度不足 2px 的分类整段不画，对齐参照图 1、2 里被丢掉的三个细分类）+ 余量灰段 + 空闲轨道；`R` 不入条。段间 1px 间隙，**已用群与余量段之间留 4px 空隙**；条高 4px、两端 2px 圆角，空闲空间是条自己的底色而不是一段。
- 百分比列 = `token / W × 100`，一位小数（对齐参照物 `0.0%`）；token 走参照物的紧凑格式（K/M，一位小数、末尾 `.0` 去掉——见文末实施记录第 3 条，这条与原文的「宿主同款」不同）。
- 空会话（无 `request/header`）：收起态头部右侧显示「等待首个请求」而不是数字，条只画轨道；展开态不出行，显示同样一句占位。环仍按现有空环逻辑绘制。
- 每次打开面板**默认收起**；`expanded` 只在本次打开期间有效，关闭即复位（不写本地存储）。
- 压缩发生后读的是当前 surface，自动反映；不做历史分解。
- 工具数 >200：分组内滚动，只渲染前 200 行 + 「还有 N 个」。
- 宿主面板形态或类名变化：拦截失败即把点击交还宿主（结构判定 + 标记清理），插件面保持可用。

## 七、分步实施（每步可独立验证）

0. **探针（0.5d）**：在真实 DSH 里确认（a）新投影键能在客户端 `projectionsBySession` 读到，（b）捕获阶段拦截 trigger click 能阻止宿主面板。任一条不成立即切到回退通道（认证路由）并记录结论。
1. **shared 契约 + host 分解器 + 单测（1d）**：纯函数先行，用真实日志样本断言工具拆分、残差、逐文件行。
2. **host 投影注册 + 挂载（0.5d）**：`ccdContext` 上线，冷启动 / 检查点 / stateVersion 行为对齐 `ccdUsage` 的既有测试。
3. **客户端 port + driver（1d）**：会话 id、投影订阅、开合与拦截、兜底隐藏。
4. **面板 UI（1.5d）**：两态切换（收起 / 展开）、标题行与 chevron、分段条、展开组、键盘与 ARIA、zh/en 文案。
5. **开关 + 文档 + 截图（0.5d）**：开关的 6 处改动 + ARCHITECTURE / DESIGN / README + 浅深两张真实截图。
6. **验证（0.5d）**：真 Chrome 测试 + 与真实会话对照 + `npm run check`（含 `check:package`）。

合计 ≈ 5.5 人日。

## 八、不做什么

- 不换环本体，不改「环不显示百分比」的既有结论。
- 不做精确分词器（宿主自身也是 4 字符启发式）。
- 不解析 MCP 服务器指令在系统提示词里的占比（宿主不区分，无法分离）。
- 不做首请求前的工具预览（`ctx.tools` 注册表 ≠ 实际请求信封，宁缺勿错）。
- 不做独立大页面或第二套界面；**不做底部按钮**（用户已明确去掉），展开只由标题行的 chevron 承担。
- 不引入新的 HTTP 路由（除非第 0 步探针判定投影通道不可用）。
- 不重写宿主环的交互内核，只接管面板画面。

## 九、风险与对策

| 风险 | 对策 |
| --- | --- |
| 采样值与启发式树差 ≈11% | 显式「估算差额」行；头部与环同值，行内标 `≈` |
| 逐项工具舍入偏差 +2.2% | 残差并入工具组小计，保证合计等于权威 `toolsTokens` |
| 宿主类名或结构变化 | 锚点集中 `host-dom.ts`；拦截失败交还宿主；真 Chrome 测试断言 |
| 客户端读不到插件投影 | 第 0 步探针前置；回退到认证路由 |
| wire 体积（数百工具） | 只带 `name / tokens / server`，不带 description 与 parameters；明细上限 200 行 |
| 回放成本 | 增量 fold，只对 header、instructions、skill-catalog 三类事件计价；状态有界 |
| 压缩策略读不到（本机就是 disabled） | 整行隐藏，不按默认值硬算 |

## 十、假设

- 宿主 wire 投影在客户端列表状态可见（第 0 步验证）。
- `data-conversation-session` 与上下文环的 CSS 模块前缀在本版构建稳定（后者已在 [host-builds.ts](../src/client/compat/host-builds.ts) 登记）。
- 4 字符启发式不变；若宿主换分词器，行口径需重新对齐。

## 十一、证据索引

| 结论 | 证据 |
| --- | --- |
| 宿主分解只有三档 | asar `dsh-token-meter/lib/types/breakdown-projection.js:33-67` |
| 占用口径 | asar `dsh-client-ui-conversation/lib/client.js:16912-16920` |
| 工具逐项计价公式 | asar `dsh-token-meter/lib/types/estimate.js:90-93` |
| MCP 命名 | asar `dsh-mcp-client/README.zh.md:71-77` |
| 技能目录结构化来源 | asar `dsh-tool-skill/lib/index.js:238-262` |
| AGENTS.md 指令渲染与来源 | asar `dsh-agent-instructions/lib/index.js:130-132,784` |
| 压缩阈值公式与默认值 | asar `dsh-compaction-basic/lib/index.js:124-132`、`README.zh.md:62-78` |
| wire 投影才外发 | asar `dsh-session-projection/lib/index.js:165-170` |
| 列表 RPC 携带全部 wire 值 | asar `dsh-api-session-controller/lib/types/list.js:262-276` |
| 会话 id 数据属性 | asar `dsh-client-ui-conversation/lib/client.js:16324-16335` |
| 本机 compaction 禁用 | `~/.dsh/profiles/desktop/cordis.yml:275-277` |
| 插件投影已在真实部署持久化 | `~/.dsh/storages/session_projcache/sessions/*.json`（151 份中 149 份含 `ccdUsage`） |

## 十二、实施记录

第 0 步探针的两条都在代码层面证实，没有走认证路由的回退分支：

- 投影通道：`dsh-api-session-controller` 的 `SessionListState.projectionsBySession` 是类型化的客户端字段，宿主列表 RPC 用 `cachedSnapshot`／投影缓存的**全部 wire 值**填它（`list.js` `projectionsFor`），所以新键与 `ccdUsage` 走同一条路。`ccdContext` 已按此注册。
- 拦截：宿主环的处理器是 React 在渲染根上委派的 `onClick`（asar `ContextMeter.js`：`onClick: () => setOpen(!open)`），在按钮上于捕获阶段 `stopPropagation` 即可拦下——与 `compat/view-options.ts` 同一手法，且那条路已有真 Chrome 测试。宿主面板因此**从不渲染**，`data-ccd-context-open` 那条 `visibility: hidden` 只是兜底。

三处与原方案不同，都是实施中发现原写法不成立：

1. **记忆文件／技能不能「Σ 全部 instructions 消息」**。宿主的 `contextBreakdown` 折的是**当前保留表面**，而表面会被 `surfaceOp` 替换——一次压缩是覆盖一段范围，不是追加。真实会话里 5 条 instructions 消息只有 1 条留在表面上。所以 `ccdContext` 照抄了 token meter 的表面折叠（保留 `[seq, tokens, kind, entries]` 节点列表并处理替换），逐文件／逐技能行按各自文本段落长度分摊节点价格，行相加恒等于节点价格之和。按此实现的折叠在真实 19 MB 会话日志上与宿主自己持久化的 `{systemTokens: 1953, toolsTokens: 7492, messageTokens: 93461}` **逐 token 相同**（`tests/context-pricing.test.ts` 记下了这个事实，fixture 是它的形状）。
2. **工具两组按比例拆，而不是「总量减逐项之和」**。逐项取整之和会**大于**权威总量（真实会话 37 个工具：逐项 7657 对整数组 7492，+2.2%），相减会得到负数。改为按逐项估值把权威总量按比例分给 MCP 与系统工具两行，两行恒等于宿主自己的 `toolsTokens`，取整差落在系统工具一行。
3. **数字格式跟参照图而不是跟宿主**。宿主的 `formatTokens` 在超过 100 时取整（`216.7k` 会印成 `217k`），参照图是一位小数、末尾 `.0` 去掉。面板跟参照图；头部仍然与环同值，因为两者读的是同一个 `contextPressure`。

其余按原方案落地：两态且默认收起、无底部按钮、`shell.overlay` order 40、`context-panel` 开关（默认开，6 处改动）、`compaction` 读 loader 条目（本机 `compaction-basic` 是 `disabled: true`，所以那一行不画）、`估算差额` 单列一行且不入条。

配套测试：`context-pricing`（计价与折叠，12 项）、`context-projection`（单元与开关，10 项）、`context-panel-card`（源码契约，11 项）、`context-panel-driver`（拦截与状态，8 项）、`context-panel-browser`（真 Chrome 两态、几何、间隙、丢弃细段、关闭与深浅配色，1 项）。

另修一处与本次改动无关的既有测试脆弱点：`tests/permission-menu-rows.test.ts` 断言「没有语言的文档不算中文」，但 `permissionCopy` 会回退到 `globalThis.navigator.language`，而 Node 的该值跟随 `LANG`——在 `LANG=zh_CN.UTF-8`（本机默认）下这条断言必然失败。现已在那一例里临时移除 navigator 回退，断言重新只描述文档规则。

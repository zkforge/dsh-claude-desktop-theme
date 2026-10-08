# 计划：侧栏「视图选项」改成 Claude 筛选弹层的形态

> 状态：**已实施**（方案 A：自渲染卡片 + 二级卡片；落地在 [features/view-options](../src/client/features/view-options/mount.ts)、[compat/view-options.ts](../src/client/compat/view-options.ts)、[compat/empty-groups.ts](../src/client/compat/empty-groups.ts)）。
> 当前形态按用户最新参考图调整为：状态值行 + 分隔线 + 分组方式与排序方式 + 分隔线 + 空分组开关；按需追加清除筛选。状态按活跃 → 已归档 → 全部显示。主卡片宽 200px、子卡片至少 128px、间距 1px，顶部对齐当前行；圆角 10px、轮廓 0.5px，浅色菜单局部配色从参考图采样。后文宿主调研仍适用，最终外观与交互以 [DESIGN.md §6.7](../DESIGN.md) 和真实浏览器测试为准。
> 最新修正：展开分组按 DOM 判断，折叠分组结合宿主会话目录、工作区成员与归档筛选判断，避免保留第一个空项目。全部为空时显示提示及「显示所有会话」入口；普通菜单行的悬停会关闭二级卡片。后文为原始方案调研，当前规则以 DESIGN 与 ARCHITECTURE 为准。
> 参照物是 Claude Code Desktop 侧栏那枚滑块图标点开的筛选弹层。

## 一、这份计划解决什么

DSH 的「视图选项」菜单现在是宿主原生的**三段单选列表**：三个灰色小节标题（分组方式 / 排序方式 / 筛选会话）+ 8 行选项，每段用蓝色勾选标出当前项。

参照物（Claude Code Desktop 的筛选弹层）是另一种读法：**没有小节标题**，取而代之的是

- 「标签 + 当前值 + ›」的**值行**，点开才是选项（参照物浮出二级卡片）；
- 行组之间用**分隔线**分段，而不是用标题；
- 一条**开关行**（`Show empty groups`，开时尾部一只蓝色 ✓）；
- 末尾一条**动作行**（`Clear filters`）。

改完的卡片：**3 个值行 + 1 个开关行 + 1 条动作行**，静止态 4 行高（约 120px），今天则是 11 行（小节标题 3 + 选项 8，量到 604 设备 px ≈ 302px）。

> **一处默认值变化要说在前面**：`显示空分组` 默认**关**（已定），也就是装上插件后，没有会话的工作区默认不再显示。这是本计划里唯一一处改变默认可见内容的地方，与参照物一致（Claude 的 `Show empty groups` 默认也是关）。

要改的是**信息结构**，不是皮肤。皮肤已经是本插件的：量截图 1，行距 48 设备 px（= 24px），小节标题同节奏 —— 正是 [menus.css](../src/client/theme/menus.css) 那一族的 24px 单元格（宿主自己的行是 30px `dense` / 34px 常行，24px 只可能来自这条家族规则），而且行里的前置图标也不见了（宿主这三段每行都带图标，家族规则把图标座收掉了）。所以这次不动卡片、不动配色、不动勾选蓝。

## 二、现状：这张菜单到底是什么（已核实）

从 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 里读到的宿主源码（`ui-workspace` 的 `WorkspaceBrowser`）：

```js
// 条目：标题条目用 text，选项行用 label + icon
{ id: "group-by", text: t("groupBy.label") },
{ id: "workspace", label: t("groupBy.workspace"), icon: IconProjectOutlineRegular },
{ id: "workspace-tree", label: t("groupBy.workspaceTree"), icon: … },
{ id: "flat", label: t("groupBy.flat"), icon: … },
{ id: "order-by", text: t("orderBy.label") },      // 手动排序 / 最近更新
{ id: "filter-by", text: t("filterBy.label") },    // 隐藏已归档 / 全部对话 / 仅显示已归档
selectedIds: [groupBy, orderBy, {default:"hide-archived", show:"show-archived", only:"only-archived"}[archivedFilter]],
onSelect: id => { …; setOpen(false); },            // ← 选一次就关菜单
align: "end", dense: true, portal: true,
listClassName: WorkspaceBrowser.module.css.viewOptionsMenu,   // → _7514NG_viewOptionsMenu
anchor: <Tooltip label={t("viewOptions.label")}><button className={iconButton wide} aria-label="视图选项">
```

由此得到的事实：

1. **它走的是宿主 `ui-primitives` 的 `Menu`**，所以卡片是 `data-menu-material`，行是 `button[role="menuitem"]`，勾选是 `.check` 座 —— 全部已经在 [host-dom.ts](../src/client/compat/host-dom.ts) 的前缀表与 [menus.css](../src/client/theme/menus.css) 的家族规则覆盖范围内。
2. **卡片有稳定把手**：`._7514NG_viewOptionsMenu`（`_7514NG_` 前缀已在 [host-builds.ts](../src/client/compat/host-builds.ts) 登记，Windows 侧自动换成 `_9lTDKa_`）。识别这张卡不必依赖本地化文字。
3. **宿主每次选择都会关菜单**（`setOpen(false)`）。这条决定了「清除筛选」的代价（见 §3.4）。
4. **分段靠结构**：`Menu` 把标题条目渲染成 viewport 的直接 `role="presentation"` 子节点，行在它下面。所以「一段 = 一个标题 + 其后若干行」可以用结构读出来，不必认字。
5. **宿主原语本来就支持子菜单，只是这张菜单没用**：条目可以是 `{ id, label, submenu: [...] }`，原语会给该行加 `aria-haspopup` / `aria-expanded`、hover 即展开、同级互斥，二级卡片是同一枚 `MenuSurface`（`role="menu"`，`left: calc(100% + 10px)`）。也就是说参照物那种形态是宿主现成能力 —— 见 §4.1。
6. `Menu` 的类名从 web frontend 产物里可读全（`_4ub78_` 前缀已登记）：`_itemWrap_4ub78_90`、`_item_4ub78_90`、`_itemLabel_4ub78_190`、`_check_4ub78_179`、`_separator_4ub78_80`、`_viewport_4ub78_19`、`_label_4ub78_129`、`_denseList_4ub78_124` 等。

### 2.1 三条决定成本的边界（都查过了）

- **三个视图设置，插件读不到也写不了。** SDK 的 `UiWorkspace` 服务（`dsh-client-ui-workspace` 的 `navigation.d.ts`）只暴露导航/归档/目录操作，视图 store 是它内部的 `private readonly view`；`stores.d.ts` 里的 `createWorkspaceViewStore` 注释明确说「模块级只导出工厂，模块级句柄会把 store 身份钉死在插件重载之间」，持久化走浏览器本地（`dsh.workspace.view.v5`，`localStorage` + subscribe 写回，**没有跨实例同步**）。所以插件改这三个值只有一条路：**点宿主自己的行**。
- **宿主没有「空分组」这个概念。** asar 里 `hideEmpty` / `emptyWorkspace` / `showEmpty` / `emptyGroup` 全部零命中 —— 所以「显示空分组」是插件要新做的行为，不是接管宿主开关。
- **宿主自己写行、自己量行。** `ui-workspace` 的 AnimatedRows 在 commit 里读每个 keyed 行的矩形，所以「隐藏一行」必须在宿主量测之前生效，否则会播一次 200ms 的位移动画（[blank-session-rows.ts](../src/client/compat/blank-session-rows.ts) 记录过这个坑）。

### 2.2 字典（中 / 英都在宿主里）

| 键 | 中文 | 英文 |
| --- | --- | --- |
| `groupBy.label` | 分组方式 | Group by |
| `groupBy.workspace` / `.workspaceTree` / `.flat` | 按工作区 / 按工作区树 / 单列表 | WorkSpace / Workspace Tree / In one list |
| `orderBy.label` | 排序方式 | Order by |
| `orderBy.manual` / `.updated` | 手动排序 / 最近更新 | Manual / Last updated |
| `filterBy.label` | 筛选会话 | Filter sessions |
| `viewOptions.hideArchived` / `.showArchived` / `.onlyArchived` | 隐藏已归档 / 全部对话（显示已归档）/ 仅显示已归档 | Hide archived / All conversations (show archived) / Archived only |

## 三、目标形态与每一行写什么

### 3.1 折叠态（卡片打开时看到四行）

| # | 行标签（维度名） | 当前值 | 行尾 | 点它做什么 |
| --- | --- | --- | --- | --- |
| 1 | 分组方式 · Group by | 按工作区 · WorkSpace | › | 展开本组选项 |
| 2 | 排序方式 · Order by | 手动排序 · Manual | › | 展开本组选项 |
| 3 | 筛选会话 · Filter sessions | 活跃会话 · Active | › | 展开本组选项 |
| — | **分隔线**（三条值行之后） | | | |
| 4 | 显示空分组 · Show empty groups | —（开关行，没有值列） | 开时一只蓝色 ✓（默认关） | 开/关 |
| — | **分隔线** | | | |
| 5 | 清除筛选 · Clear filters | —（动作行，无值无勾选） | | 把筛选恢复默认（§3.4） |

三条值行是一组，开关行自成一组，动作行在最后 —— 与参照物的分段节奏一致（它是「值行组 / 开关行组 / 动作行」，只是它有两个开关行、我们只有一个）。

**行序保持宿主原样**（分组 → 排序 → 筛选），只把「筛选会话」这一段的三个选项换名字（§3.2）。

**维度名与值里，只有筛选会话那一行的三个值是新写的**（见 §3.2 对照表），其余一律取宿主自己的词（分组方式 / 排序方式 / 按工作区 / 手动排序…），中英两套自动跟随宿主语言。

### 3.2 展开态（点开某一行之后）

一次只展开一组（手风琴），展开的那一组回到宿主原本的样子：

| 组 | 选项（当前项带蓝色勾选） |
| --- | --- |
| 分组方式 | 按工作区 ✓ / 按工作区树 / 单列表 |
| 排序方式 | 手动排序 ✓ / 最近更新 |
| 筛选会话 | 活跃会话 ✓ / 全部 / 已归档会话 |

**改名对照表**（这是你要求的「对齐 Status」）：

| 宿主原文（中 · 英） | 改成（中 · 英） | 语义 |
| --- | --- | --- |
| 隐藏已归档 · Hide archived | **活跃会话 · Active** | 只列未归档的会话 |
| 全部对话（显示已归档）· All conversations (show archived) | **全部 · All** | 归档会话也留在列表里 |
| 仅显示已归档 · Archived only | **已归档会话 · Archived** | 只列归档会话 |

改名意味着插件要**写**这两套文案（不再只是搬运），做法照 [permission-menu.ts](../src/client/compat/permission-menu.ts)：一张「每种文档语言一份」的词表（`document.documentElement.lang` 分流），写进宿主自己渲染的行文字里，释放时按记录还原；同一组词在**值行与展开态里是同一份**（照权限卡片的规矩：同一个东西隔一行不能叫两个名字）。

两条注意：

- 这三行在展开态里的**顺序是宿主的**（活跃会话 → 全部 → 已归档会话），不是参照物的（Active → Archived → All）。想改顺序只能用 CSS `order` 做视觉重排（宿主节点不能移动），代价是键盘走位仍按 DOM 顺序走 —— 见取舍 3。
- 目前 `viewOptions.*` 这三个键只有这一处菜单在用（已全库核对），所以改名是安全的；将来宿主新增入口时要一起看。

### 3.3 显示空分组（新功能，不是改形态）

| 项 | 决定 |
| --- | --- |
| 行的样子 | 开关行：标签 + 尾部蓝色 ✓（开）。参照物就是这种行 —— 没有值列、没有 › |
| 默认 | **关**（已定）：默认隐藏没有会话的工作区 —— 与参照物一致，也是本计划唯一改变默认可见内容的地方 |
| 「空」的定义 | 在当前筛选下，该分组（含按工作区树模式下的全部后代）里一行会话都没有 |
| 必须豁免 | **当前会话所在的分组及其祖先**永不隐藏（DSH 自己也会为当前会话保留祖先可见） |
| 状态 | **插件配置字段**（已定）：`Config` 里加一个 volatile 节点（如 `view.showEmptyGroups`，默认 `false`），[shared/config.ts](../src/shared/config.ts) 加默认值，设置页加一行，菜单行通过 `ctx.configForms` 写同一个值（客户端已有 `ConfigFormPort.set(field, value)`） |

**怎么判定「空」——我建议读 DOM，不重算宿主的业务。** 理由与做法：

- **宿主不给数据。** `WorkspaceSnapshot`（`@deepseek-ai/dsh-api-workspace-controller/client`）只有 `items` + 归档/置顶的会话 id 集合，没有「会话属于哪个工作区」；这条归属是 `WorkspaceBrowser` 自己按规范路径 + 最近已注册祖先算的。插件要算就得把这条业务重写一遍 —— 本仓库一直避免这件事（[stable-host-hooks-migration.md](research/stable-host-hooks-migration.md) 的结论也是「只读语义标记，不猜宿主结构」）。
- **宿主也没给标记。** 空分组底下宿主什么都不画：`EmptySessions`（`data-row-key="empty"`）只在**整棵树一个分组都没有**时渲染，不是每个分组一份（已核 asar）。所以「有空的占位行」这条捷径不存在。
- **DOM 里却什么都齐了。** 每个分组的容器是「工作区行 + 可选的 `role="group"` 子分组 + 会话行 + 可选的 `overflow:<key>` 按钮」：

  ```
  div                                   ← 分组容器（key = group.key）
    [data-row-key="workspace:<key>"]    ← 工作区行
    div[role="group"] …                 ← 按工作区树模式下的子分组（递归）
    [data-row-key="session:<id>"] …     ← 会话行
    [data-row-key="overflow:<key>"]     ← 「展开其余 n 个会话」（有它就说明有会话）
  ```

  判定规则因此是三句话：**有会话行、或有 `overflow` 按钮、或任何一个后代分组不空 → 这个分组不空**；被插件隐藏的 blank 行（`data-ccd-blank-session`）**不算数**；当前会话（`[data-row-key^="session:"][aria-selected="true"]`）所在的分组及其祖先**永不算空**。
- **隐藏写成插件样式表里按 `data-row-key` 的规则**，不是逐个元素加内联样式 —— 照 [blank-session-rows.ts](../src/client/compat/blank-session-rows.ts) 的写法（规则一写就与 React 的重渲染无关，元素一出现就被藏掉）。
- **一个已知的时机问题，先量再补。** 宿主的 AnimatedRows 在 commit 里就读了每个 keyed 行的矩形，所以我们的判定必然发生在量测之后一个 microtask；microtask 跑在绘制之前，所以**多半看不见**，但如果宿主为这个高度差播了 200ms 的滑动，启动时会看到分组「滑一下」。blank-session-rows.ts 当年就是撞上这个（issue 04）才改成「提前写规则」的。我的建议是：**先做最直接的版本，在真机上量一次启动**；确实看得见，再加一层「把上次算出的空分组键缓存起来、在下一轮渲染前先写规则」的补丁（那时才需要决定这个缓存放哪 —— 它只是派生数据，丢了无害，与设置本身不是一回事）。
- **因默认就是关**，这条隐藏是默认生效的行为，所以上面这次「启动量一次」是收工前的必做项，不是可选项。

**这是这份计划里唯一一个新功能**，也是唯一有真实风险的一行，建议排在最后单独做（前面的形态改动不依赖它）。

### 3.4 清除筛选

| 项 | 决定 |
| --- | --- |
| 行的样子 | 纯文字动作行，与普通行**完全一样**（参照物就是这样：没有图标、没有颜色、不加粗、不固定在底部），前面一条分隔线 |
| 出现条件 | **只在筛选偏离默认时出现**（参照物也这么做）。「偏离」= 筛选会话 ≠ 活跃会话，或 显示空分组 ≠ 关（默认） |
| 范围 | **只清筛选**（已定）：筛选会话 → 活跃会话、显示空分组 → 关；**不碰**分组方式与排序方式 |
| 代价 | 一次开关写入（本地即时）+ **最多一次宿主行点击**（只在筛选会话不是活跃会话时才需要）—— 卡片不会闪 |

> 为什么不连分组/排序一起恢复默认：那两个值插件**写不了**（§2.1 第一条），只能点宿主的行，而宿主每选一次就关卡片（§二.3），三项就得「开 → 点 → 开 → 点」三轮，卡片会闪两下。参照物的 `Clear filters` 连 Group by / Sort by 一起清，是因为它把分组/排序也算作筛选维度；我们这行叫「清除筛选」，只清筛选既准确又便宜。

### 3.5 参照物的规格（从 Claude.app 代码读出，非目测）

| 项 | 参照物（compact，桌面端默认） | 本插件现有对应物 |
| --- | --- | --- |
| 行高 | 24px | 24px ✅ 一样 |
| 行左右内边距 / 圆角 | 8px / 6px | 8px / 6px ✅ 一样 |
| 标签 | 13px/19px、400、`#0b0b0b` | 13px/20px、400、`--ccd-text` |
| **当前值列** | **12px/15px、`#898781`**、与标签间距 **12px**、**最多 160px 截断**；值非默认时改强调蓝 `#184f95` | 用 `--ccd-text-muted`（浅 `#8f8f8a` / 深 `#918f89`）—— 与参照物几乎同色 |
| **chevron** | `CaretRight` **16px**、`#898781`、右边距 **−4px** | 自绘一只 16px 细线 `›`，取 `--ccd-text-muted` |
| 分隔线 | **1px**、`rgba(11,11,11,.10)`、上下 **4px**、左右内缩 **8px**（与文字左缘对齐） | 家族规则已把 `[role="separator"]` 改成 `--ccd-border-soft`；间距与内缩照参照物写 |
| 勾选 ✓（含开关行） | 16px、`#2a78d6`、bold、靠右、右边距 −4px | 宿主自己的勾选座 + `--ccd-accent`（`#4b76ce`）—— 已经到位 |
| 卡片 | 10px 圆角、`#fff`、1px `rgba(11,11,11,.10)` 描边、宽 **200–320px**、内边距 4px、**无标题栏无底部固定区** | 12px 圆角、`--ccd-card`、`--ccd-border`、内边距 4px —— 圆角这一档本插件早就按 DESIGN.md §6.7 定成 12px，**保持不动** |
| 行 hover | `rgba(11,11,11,.05)` | `--ccd-hover` ✅ 同一层 |
| 动作行 | 与普通行同样式，仅前面多一条分隔线；**只在真有筛选生效时才渲染** | 照此办理 |

一句话：**参照物与本插件的行节奏本来就是同一档（24px / 8px / 6px），要补的只有「值列 + chevron + 分隔线 + 两种新行」四样。**

### 3.6 长值的处理

参照物对值列的处理是**截断而不是加宽**：值列最多 160px，超出省略号。我们的最长值现在是 `活跃会话 / 已归档会话 / 全部`（都很短，放得下），英文 `Archived` 更短。改名之后这条基本不再是问题 —— 只有「分组方式 = 按工作区树」这类值仍在安全范围内。

## 四、三条落地路线

| | A 自渲染整张卡片（完全体） | **B 就地改写宿主卡片（推荐）** | C 只对齐视觉 |
| --- | --- | --- | --- |
| 做法 | 插件拦住触发器，自己画卡片与二级浮层；点选时再程序化驱动宿主（点触发器 → 宿主卡片同步挂载 → 点目标行 → 收起） | 宿主照常开卡片，插件在打开那一刻把三段改写成值行、注入开关行与动作行；点值行**就地**展开本组其余行（宿主自己的行，点了就生效） | 保留三段单选列表，只把值列/间距/勾选对齐参照物 |
| 展开形态 | 浮出的二级卡片（`side="right"`、`sideOffset` 2px、同一套卡片样式）—— 与参照物一致 | 就地展开（卡片长高，不是二级卡片） | 无 |
| 新增代码 | 大：卡片、二级浮层、键盘走位、读屏语义、定位、Esc、外部点击全要自己写（[popup.ts](../src/client/features/model-controls/popup.ts) 只有单层面板的先例） | 中：一个 compat 模块 + 一族 CSS 规则 | 极小 |
| 依赖宿主的部分 | 触发器拦截 + 隐藏驱动宿主菜单（宿主升级后第一个坏的地方） | 只读宿主 DOM（结构 + 勾选座），写只写自己的注入节点 | 只读 |
| 改一项点击次数 | 2 次 | 2 次 | 1 次 |
| 保真度 | 最高 | 静止态一样，展开态不同 | 低（不是要的形态） |

**推荐 B。** 它把「插件要的样子」和「宿主的交互内核」分开：卡片、定位、外部点击、Esc、键盘走位、读屏语义全部还是宿主的，插件只改读法与展开方式；出问题时整张卡可以原样退回宿主形态（`permission-menu.ts` 就是这么做的：认不出就不动、释放时全部还原）。A 更保真，但它需要长期维护一套「驱动宿主隐藏菜单」的机制，与 [plan-selfrendered-controls.md](plan-selfrendered-controls.md) 里「自渲染只用于插件自己发起的动作，不替换宿主控件的内核」这条结论相抵。

### 4.1 子菜单是宿主原语现成能力，但它改变不了「谁持有状态」

§二.5 查到的 `submenu` 支持把 A 的**画面**成本压下来了，但 A 真正的成本在**状态**：三个设置由 `WorkspaceBrowser` 自己持有、存在浏览器本地（§2.1），插件既读不到也写不了。所以 A 里「用户点了一个选项」只能靠驱动宿主的隐藏菜单（程序化点触发器 → React 18 对离散事件同步 flush、卡片同一 tick 挂载 → 点目标行 → 宿主自己 `setOpen(false)`，中间用一条 `html[data-ccd-driving]` 规则把宿主卡片藏掉避免闪）。这条路能走通，但它把插件和宿主内部绑成了三段时序（拦截、放行、隐藏驱动），宿主升级时最先坏；而 B 只依赖「读结构 + 点宿主自己的行」，所有假设都能在当前构建的 DOM 上直接看见。

**顺带一条上游建议**：既然 `Menu` 已经有 `submenu`、`selectedIds` 和 `separator`，DSH 自己在视图选项里改成「值行 + 子菜单」几乎不用新写渲染代码 —— 如果这个形态将来由宿主提供，插件这一层可以整块退役。

## 五、方案 B 怎么做（分步，每步可独立验证）

新增 `src/client/compat/view-options-menu.ts`（挂载点照 `mountPermissionMenu` / `mountWorkspaceMenu`，放在 [apply.ts](../src/client/apply.ts) 同一块里，跟 `features.sidebar` 开关走），外加 [menus.css](../src/client/theme/menus.css) 末尾一族卡片作用域规则（`[data-ccd-view-options]`），以及 [host-dom.ts](../src/client/compat/host-dom.ts) 里加一条 `viewOptionsMenu: '._7514NG_viewOptionsMenu'`。

**要读的 DOM 形状**（从宿主 `Menu` 的渲染代码读出）：

```
div[role="menu"]._list_4ub78_7._7514NG_viewOptionsMenu      ← 卡片列表根
  div._viewport_4ub78_19[role="presentation"]               ← 行组
    div._label_4ub78_129[role="presentation"]「分组方式」     ← 小节标题
    div._itemWrap_4ub78_90
      button[role="menuitem"]._item_4ub78_90
        span._itemIcon_4ub78_148     ← 宿主图标座（家族规则已隐藏）
        span._itemLabel_4ub78_190「按工作区」  ← 选项文字
        svg._check_4ub78_179         ← 只在当前项上渲染
```

勾选座是**按需渲染**的，所以「这一行是不是当前值」看它有没有 `._check_4ub78_179` 就够，不必比较文字。

1. **认卡片。** 用 `._7514NG_viewOptionsMenu` 找开着的卡，打上 `data-ccd-view-options`。认不出来就整张不动 —— 失败方向是「宿主原样」，不是「半张卡」。
2. **分段。** 读 viewport 的直接子节点，遇到 `role="presentation"` 标题就开一段，后面的 `[role="menuitem"]` 归这一段。段数不是三、或某段没有勾选项，就整张不动。
3. **折叠态改写。** 每段取**带勾选的那一行**（当前值）：注入一个 span（`data-ccd-view-option-name`，文字 = 该段标题的文字）、注入一只 chevron；该行标记 `data-ccd-view-option-row`，同段其余行标记 `data-ccd-view-option-alt`，标题行标记 `data-ccd-view-option-heading`；段间插入一条 `role="separator"` 分隔线。CSS 负责：折叠态隐藏标题行与 alt 行、隐藏勾选座、把注入的 span 排到左列、宿主自己的选项文字排到右列并给 muted 墨色。**只注入、只打标记，绝不移动宿主节点**。
4. **展开态。** 值行上挂 click 监听：折叠时展开本组（收起别组），已展开时收起。点击要在行上 `stopPropagation()`，否则宿主会把它当成「又选了一次当前项」并关掉菜单。隐藏的 alt 行加 `disabled`，让宿主的键盘走位（收集 `button:not(:disabled)`）只走看得见的行；展开时移除 —— 这是本方案唯一一处改宿主属性。
5. **改三个选项的文字。** 按 §3.2 的对照表写（幂等 + 记录 + 释放还原），值行与展开态共用同一份词表。
6. **注入「显示空分组」开关行。** 宿主菜单里没有这种行，照 [session-menu.ts](../src/client/compat/session-menu.ts) 的做法**克隆一行原生行**（继承宿主自己的类与状态，所以样式与键盘走位自动跟随），去掉图标座，写标签与尾部勾选；点击时写配置字段并翻转勾选。克隆行不是宿主 item，点它**不会**关菜单（宿主只在 `onSelect` 与外部点击时关），正是开关行要的行为。
7. **配置字段落地。** `Config` 加 `view.showEmptyGroups`（volatile，默认 `false`）→ [shared/config.ts](../src/shared/config.ts) 默认值 → 设置页一行 → 菜单行经 `ctx.configForms` 读写同一个值。这条与第 6 步同批提交（没有它，开关无处可写）。
8. **隐藏空分组**（独立一步，默认生效）：按 §3.3 的递归规则判定，写成按 `data-row-key` 的样式表规则；豁免当前会话所在分组及其祖先。收工前在真机上量一次启动（见 §3.3 最后一条）。
9. **注入「清除筛选」动作行**（+ 前面一条分隔线）：同样克隆一行，标签写死，只在筛选偏离默认时插入；点击按 §3.4 的范围执行。
10. **释放。** 卡片关闭/卸载时移除所有注入节点与标记、还原文字与 `disabled`；模块释放时同样。宿主每次开卡都重新挂载，所以每次打开重新同步一次，全部写入幂等。
11. **（可选）触发器状态。** 参照物的触发器在弹层打开时保持浅灰填充，插件可以补一条 `[aria-expanded="true"]` 的填充规则（宿主只写了 `:hover`）。纯 CSS 的小尾巴，与主改动解耦。

**依赖顺序建议**：第 1–5 步是一件事（值行形态 + 改名）；第 6–7 步是一件事（开关行 + 配置字段）；第 8 步是独立的一件事（隐藏空分组，唯一的新行为）；第 9 步是最后一件（动作行）。四批分别提交、分别验证，第 8 步不通过也不影响前三批。

## 六、取舍：已定的与还差的

**已定（本轮确认）**

1. **分段**：三条值行之后才放第一条分隔线 —— 分组方式 / 排序方式 / 筛选会话 是一组，开关行自成一组，动作行在最后。
2. **行序**：保持宿主原序（分组 → 排序 → 筛选），不把筛选提到第一行。
3. **显示空分组默认关**（默认隐藏空工作区）。
4. **显示空分组的状态走配置字段**（`view.showEmptyGroups`）。
5. **清除筛选只清筛选**（筛选会话 + 显示空分组），不碰分组/排序。
6. **空分组按读 DOM 判定**，先做直接版，真机上量启动表现再决定要不要加缓存（§3.3）。

**还差的**

1. **展开形态**：就地展开（B，推荐）还是浮出二级卡片（A）？—— 这一条还没定，它决定整个实现是「一个 compat 模块」还是「一套自渲染弹层 + 驱动宿主隐藏菜单」。
2. **筛选会话三个选项的顺序**：保持宿主顺序（活跃会话 → 全部 → 已归档会话，推荐）还是用 CSS `order` 排成 活跃会话 → 已归档会话 → 全部（视觉对齐参照物，但键盘走位仍按 DOM 顺序，视觉与走位会不一致）？
3. **折叠态的读屏语义**：值行现在是 `menuitemradio` + `aria-checked`，但点它只展开不选中 —— 保持原样（省事但语义不诚实），还是折叠态改写成 `menuitem` + `aria-haspopup` + `aria-expanded`？
4. **隐藏行用 `disabled` 退出键盘走位**：接受这个做法，还是宁可让方向键走进隐藏行？

## 七、不做什么

- 不动三个宿主设置本身、不动宿主的存储与它自己的菜单实现。
- 不动其它弹层（工作区 ⋯、会话 ⋯、权限、账号卡片、指令面板）—— 它们已经在这一族里了。
- 不改卡片、行高、圆角、勾选蓝与配色（家族规则已经到位）。
- 不引入依赖；除 §3.2 的六个新词与动作行标签外不新造文案。

## 八、风险与对策

| 风险 | 说明 | 对策 |
| --- | --- | --- |
| React 重渲染冲掉注入节点 | 宿主每次开卡重新挂载列表 | 每次打开重新同步；只做幂等写；释放时还原 |
| 点值行被宿主当成重选 | 宿主行点击会 `setOpen(false)` | 行上拦 click，只切换展开 |
| 隐藏行仍在键盘走位里 | 宿主走位收集 `button:not(:disabled)` | 隐藏行加 `disabled`（唯一一处改宿主属性） |
| 改名的文字被宿主还原或串到别处 | 插件写的是宿主渲染的文字 | 只改这三行、按记录还原；将来宿主新增入口时一起核 |
| 隐藏空分组引起启动时「滑一下」 | 宿主在 commit 里量行，判定晚一个 microtask；microtask 在绘制前，多半看不见，但宿主可能为高度差播 200ms 滑动 | 先做直接版并**在真机上量一次启动**；看得见再加「缓存上次的空分组键、渲染前先写规则」的补丁（§3.3）。因为默认就是关，这是默认生效的路径，量过才算收工 |
| 空分组与归档筛选相互影响 | 只剩归档会话的工作区在「活跃会话」下就是空的 | 这是与参照物一致的行为，写进文档；当前会话所在分组及其祖先永不隐藏 |
| 新增配置字段牵动宿主与设置页 | schema、`shared/config.ts` 默认值、设置页一行、测试都要动 | 与 `features` 的写法完全同构（volatile 节点 + 默认值 + 表单行），照抄现有字段；默认值 `false` 写进 [install.md](../install.md) 的默认清单 |
| 读屏语义与行为不符 | 值行 `menuitemradio` 却只展开 | 见取舍 6 |
| 宿主改结构（分段假设失效） | 「标题 + 行」的结构是读出来的 | 认不出就整张不动；把这条假设记进 `host-dom.ts` 的 pinned 记录 |

## 九、验证

- `npm run check`（类型、模块边界、颜色归属、文档链接、测试、构建、包内容）。
- 新增 `tests/view-options-menu.test.ts`：用宿主 DOM 夹具断言折叠态改写、展开/收起、改名、两个注入行的出现条件、释放还原，以及「认不出就整张不动」。
- 增补 `tests/menu-surfaces.test.ts`：值列墨色、分隔线、chevron 座位这几条新规则。
- 空分组另有单测：给定「分组 → 会话」的假数据，断言哪些分组被藏、当前会话所在分组不被藏。
- 配置字段：默认值为 `false` 的测试（`tests/config.test.ts` / `install-default.test.ts` 那一族），以及设置页新一行能被读写。
- 真机：浅/深主题各看一次；中文与英文界面各看一次（改名表两套都要看）；键盘走一遍（Tab 到触发器 → Enter 开 → 方向键 → Enter 展开 → 方向键 → Enter 选 → Esc）；**默认（空分组关）下启动一次，看有没有「滑一下」**；关掉插件确认宿主原样。
- 量：实施前按 [DESIGN.md](../DESIGN.md) §八 的口径拍一张现状截图（本文已量到 24px 行距），实施后同口径再拍一张与参照物对看。

## 十、证据索引

| 事实 | 来源 |
| --- | --- |
| 菜单实现、条目、`setOpen(false)`、`listClassName` | DSH `0.2.0-rc.2` app.asar → `@deepseek-ai/dsh-client-ui-workspace` 的 `WorkspaceBrowser` |
| 中英字典、`._7514NG_viewOptionsMenu`（宿主声明 `min-width: 200px`） | 同上，`ui-workspace` 的 locales 与 `WorkspaceBrowser.module.css` |
| 视图设置插件写不了 | `dsh-client-ui-workspace` 的 `navigation.d.ts`（`UiWorkspace` 无 view 成员）、`stores.d.ts`（只导出工厂）、asar 内 store 的 `persist: "dsh.workspace.view.v5"` + `localStorage` 实现 |
| 宿主没有「空分组」概念 | asar 内 `hideEmpty` / `emptyWorkspace` / `showEmpty` / `emptyGroup` 零命中 |
| 隐藏行必须在宿主量测之前 | [blank-session-rows.ts](../src/client/compat/blank-session-rows.ts) 的注释 |
| 宿主菜单结构（`span.root > {anchor}{list}`、viewport、行、克隆行加入键盘走位） | [session-menu.ts](../src/client/compat/session-menu.ts) 的注释 |
| 「只注入、只打标记、认不出不动、释放还原」的先例 | [permission-menu.ts](../src/client/compat/permission-menu.ts) |
| 配置字段的写法（volatile 节点 + 设置页 + `ConfigFormPort.set`） | [host/index.ts](../src/host/index.ts)、[shared/config.ts](../src/shared/config.ts)、[contracts/ports.ts](../src/client/contracts/ports.ts) |
| 参照物规格与文案 | Claude.app `ion-dist`（`shared-28-*.js`、`i18n/en-US.json`、`c6a992d55-*.css`）与本次对话附图 3 |

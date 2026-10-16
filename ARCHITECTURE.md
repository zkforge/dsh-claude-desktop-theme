# 项目架构

插件由 Host 配置与统计服务、客户端主题与展示组件组成。Workspace、Session、消息、Composer 和模型选择由 DSH 管理。

## 代码结构

会话顶栏的参考菜单由 `compat/header-menus.ts` 添加电脑图标、标题下拉与项目标签，React 所属的标题和祖先导航节点保留原位置。`compat/header-menu-actions.ts` 从 Session／Workspace 权威快照读取名称和目录，通过 `sessions.using` 重命名，通过 `uiWorkspace` Fork 与归档。其余可用动作转发真实宿主控件，复制调用剪贴板；未公开的能力用明确说明对话框保留外观。菜单使用顶层 popover，支持二级菜单、键盘和边界避让，切换会话或卸载时清理菜单、标记、监听器和订阅。尺寸与配色由 `features/conversation/header-actions/header-menus.css` 和主题 token 提供。

| 目录 | 职责 |
| --- | --- |
| `src/shared` | 插件身份、配置与统计数据契约 |
| `src/host` | 配置 schema、会话用量投影与统计路由 |
| `src/client/contracts` | feature、服务、DOM 与配置表单端口 |
| `src/client/core` | 清理作用域与 feature 装配 |
| `src/client/compat` | SDK 接入、宿主选择器与布局量测 |
| `src/client/theme` | 设计变量、调色板、语义 token、Composer、宿主弹层与滚动条样式 |
| `src/client/features` | 界面模块、模型控件与配置页 |
| `src/client/apply.ts` | 客户端组合入口 |
| `scripts` | 构建、架构与安装包检查 |
| `tests` | 配置、生命周期、布局适配与统计行为测试 |

Host 依赖 shared 与 Host 运行库；客户端各层通过 contracts、core、compat 和 theme 共享能力。跨 feature 组合集中在 `apply.ts`。React 组件通过 props、回调和 SDK hooks 访问数据，Context 留在注册与适配层。

## 界面模块

| 模块 | 内容 | 默认 |
| --- | --- | --- |
| shell | 窗口骨架、分栏样式与右侧栏浮动卡片 | 开启 |
| sidebar | 导航、工作区、会话列表、账号菜单与视图选项卡片 | 开启 |
| new-session | 问候区与输入卡片布局 | 开启 |
| conversation | 顶栏、Markdown、滚动渐隐与回到底部按钮 | 开启 |
| composer-pet | 新会话输入卡右上角的小鲸鱼 | 开启 |
| statistics | 用量概览、热力图与模型图表 | 关闭 |
| composer-stats | 状态栏末尾的统计读数（输出速度与缓存命中率） | 关闭 |
| context-panel | 上下文圆环的分段分解面板（收起／展开两态） | 开启 |

会话过程默认平铺：`compat/conversation-process.ts` 通过宿主 `data-turn-process` 与 `data-process-activity` 控件展开整轮过程和步骤分组，跟随流式完成、历史加载及会话切换；样式在展开后隐藏「已完成，用时…」和步骤分组标题，并取消过程区的内部限高滚动。思考与工具调用条目仍由宿主渲染，各自的详情折叠保持独立。自动展开后恢复原输入焦点；关闭 conversation 功能会停止观察并恢复宿主标题显示，已展开的状态保留。

`composer-stats` 是唯一不挂载模块的开关：它是状态栏统计读数的接管，由 `compat/stats-values.ts` 与 composer 样式表承担，关闭（默认）时宿主的那一族读数不画；同一模块发布的宽度预算与这个开关无关，读数隐藏只是把它占的宽度还给模型按钮。

侧栏导航保留宿主按钮与操作：新会话显示「新建会话」及淡圆底加号，插件保留原文字并显示工具箱，自动化任务改为「例程」并显示时钟。`compat/sidebar-navigation.ts` 插入装饰 SVG、更新文字与无障碍名称，兼容展开／折叠和语言切换，卸载时恢复原节点；未知插件入口保持宿主原样。图形在 `features/sidebar/navigation-icons.ts`，悬停、键盘聚焦与当前面板的结束姿态由 `navigation.css` 控制，遵循减少动态效果偏好。三个入口的当前位置都带持久底色：插件与例程由宿主的 `panelActive` 标记，「新建会话」不是面板、拿不到这个类，所以它的选中态读宿主自己的另一条事实——会话根节点的 `data-phase="hero"`（新会话页；`new-session.css`、`compat/pet-anchor.ts` 与 `composerCardHero` 选择器读的是同一个值）。[sidebar.css](src/client/features/sidebar/sidebar.css) 用一条文档级 `:has()` 直接取它，不发观察器、也不写属性：发送第一条消息（`data-phase` 转 `active`）或选中插件／例程（布局的 keyed `main` 槽按 `activePanelId` 换掉整棵会话根节点）底色都会自行消失，折叠成轨道时它随其余展开布局值一起失效。

右侧栏由 [shell.css](src/client/features/shell/shell.css) 保留宿主的轨道宽度与四边 8px 内缩。没有视图时，DockKit 的 surface 显示落地卡片；有视图时，surface 只提供量测区域，卡片的轮廓与阴影落在各自的浮层上。所有定位与内容选择器都使用 `data-sidebar-right-*`、`data-dockkit-*`、`data-files-*` 稳定钩子，两套宿主构建共用一份规则。

[right-panes.ts](src/client/compat/right-panes.ts) 通过宿主的 `sidebarRight.float(tabId, rect)` 保留真实内容：DockLayout 只接受一格或左右两格，浮层则没有数量限制。插件在浮层节点上发布 `--ccd-pane-*`，样式表用 `!important` 覆盖行内矩形。宿主节点始终留在 React 渲染的位置，终端、浏览器、文件内容与关闭操作仍由宿主处理。

[pane-tiles.ts](src/client/compat/pane-tiles.ts) 保存列成员及各列独立的高度比例：前两块上下排，第三块开右列，后续块拆分较空列中最大的单元；关闭只把空出的高度给同列邻居，整列消失才让另一列铺满。状态按会话保存在本次挂载的内存中，不写宿主布局 store。块间距按视频为 12px。接缝支持鼠标、指针捕获及方向键／Home／End，拖动中关闭、切换会话或窗口失焦会终止拖动。原先独占一行的收起动作转发到卡片 ⋮ 菜单，放大使用同一面板放大动作，每块自有放大／还原，放大矩形从左导航右缘延伸到窗口右缘，覆盖聊天区域，恢复时保持分栏比例；guide 保留作落地页，最后一块关闭时收起整个右栏。

Files 和宿主 `text` 类型的文件资源预览合为一组：预览提供整张卡的标题和正文，树浮层覆盖左侧正文，两者均保留原 DOM 父节点；树的浮层**外层 cell**也提升层级，避免预览 cell 的堆叠上下文遮住树。新的预览自动成为当前文件，宿主的 `data-dockkit-float-active` 变化同步重新打开的旧文件；多文件通过卡片 ⋮ 菜单选择。对话中的文件链接会在需要时打开 Files：树的请求只跟随读者刚打开的那个预览（本次挂载首次见到的预览 id），恢复自 localStorage 的布局只做记录、不算打开，标签集合变小时也不请求——否则宿主对账旧标签期间插件新开的树会在宿主 `rightbar.session` 里撞上没有 occurrence 的标签，宿主抛错拆掉整列，右栏从此什么都打不开（见 TODO 第 7 条）。树宽比例、放大状态及预览选择按会话隔离。

[files-pane.ts](src/client/compat/files-pane.ts) 供给过滤框、树开关、Files 图标及空预览提示。无文件时，宽卡的树旁边显示居中的落地提示，窄卡优先显示完整文件树；打开文件后该提示让位给宿主预览。树收起保留一枚展开按钮及预览内容，查询和收起状态在同一挂载中的节点替换后恢复。过滤只检索已加载行，命中行及其祖先保留，未展开目录不做服务端搜索。目录 chevron、文件的纸页／代码图形与 24px 行距由 [right-panel.css](src/client/features/shell/right-panel.css) 控制。右侧栏插件自己写的词（Files 标题、过滤框提示、树开关、空态、⋮ 菜单、等待提示与截图行）集中在 [pane-labels.ts](src/client/compat/pane-labels.ts)，按 `<html lang>` 取中文或英文：中文界面中文，其余语言沿用参照图原文，语言变化时已挂载的卡片按新语言重写；宿主自己的路径、重新加载与在应用中打开两种语言下都不动。

[pane-chrome.ts](src/client/compat/pane-chrome.ts) 供给视频对应的标题和按钮顺序，静态图形在 [pane-icons.ts](src/client/compat/pane-icons.ts)。宿主标题隐藏并留在原位，视觉标题绘制在其旁边，避开原节点的点击和重命名行为。终端归为同一组，新增终端成为组内标签页，选择和关闭均转发真实宿主内容；单个标签仍显示纯文本标题，多标签展示切换和关闭控件。Files 的蓝色清单按钮转发树切换，收起后去除树的正文占位。浏览器的原地址 form 保留在正文 DOM 中，用标题栏地球按钮右侧的占位矩形定位到同一行，ResizeObserver 和布局刷新同步位置；不复制受控输入、不移动 React 所属节点，原生输入与回车提交保持原动作。原标题行填充节点仅在浏览器中隐藏，让地址框填满剩余空间。点击地球菜单的 dev 或右键地球会聚焦并选中地址框；释放时恢复 form 样式与填充节点。导航按钮转发原动作。地球菜单和截图菜单由 [browser-menu.ts](src/client/compat/browser-menu.ts) 构造；桌面 webview 的 `capturePage()` 返回 PNG 后下载，空页／无接口时禁用，异步结果受节点存活、当前网页及释放状态约束。参考里的服务器启动和配置项没有对应接口，点击说明而不伪造状态。菜单放进浏览器顶层 popover，按实际高度处理视口边界；空闲画布为空白，实际等待态由点阵层供给，真实网页出现后移除。独立窗口按钮按用户要求不渲染，标题宽度同步收回按钮占位；页面元素选取保持视频图标、点击解释宿主接口限制；Files 的 `?` 全目录搜索未接入，仍只过滤已加载行。

释放会移除所有自有控件、接缝、标记与坐标，并把当前会话中由插件浮起的页签 `dock` 回去。宿主的 `dock` 只寻址当前会话，其他会话保留宿主保存的浮层，不跨会话投递 pane id。真实 Chrome 测试覆盖独立分隔、关闭补位、文件组、层叠命中、旧文件重开、会话切换、节点替换、指针身份、键盘及清理。

模型与 effort 控件由新会话页和聊天页共用，选择操作调用官方 ModelDirectory。聊天顶栏的项目文件夹、终端与浏览器三个入口都转发宿主右侧栏操作，文件夹占工具组的第一位。顶栏最右的角位是宿主的单格槽位，原本由「收起右侧栏」的展开按钮占据：插件以更低优先级顶掉该条目，注册一个不渲染内容的条目把这一格留空；展开动作移进会话 ⋯ 菜单的第一项（`compat/session-menu.ts`），只在右侧栏收起时出现。这三个入口在窄列下不再整体让位：只有切换器仍留在顶栏那一行（Windows 构建、或侧栏收起而窗口又窄）时一行装不下四件东西，那时才隐藏它们（[conversation.css](src/client/features/conversation/conversation.css) 的容器查询按 `data-ccd-view-dock` 分辨这两种行）。顶栏的收尾内边距同时改按输入面右缘对齐：列宽不超过 Composer 的 770px 上限加两侧留白时，尾部最后一只控件（会话 ⋯）的中心落在输入面右边框上——右侧栏展开后中栏就是这个状态——列更宽时回到参考图的 12px 收尾。工具调用沿用 DSH 原生展示。

Composer 的状态栏在宿主里是可换行的（`InputBar.module.css` 的 `.yhfFVG_row { flex-wrap: wrap }`），窄列下尾部簇会被换到自己的一行、状态栏长高一行；插件取消换行，并把收紧的余量交给模型名（chip 自己省略号截断），前导工具组与 effort 保持原尺寸。这一行的高度是 Composer 底部内缩与 dock 偏移的量测基准，所以它必须是一行。

聊天顶栏的「对话 / 轨迹」是宿主自己的 View tablist（`role="tablist"` 的两个宿主按钮）。插件把两个段的文字标签换成自带图形（`features/conversation/view-switch-icons.ts`，无障碍名称写回 `aria-label`），量测当前段的几何发布为滑块位置，并把它停到侧栏窗口控制行的右上角：节点仍留在 React 渲染它的位置，由 `position: fixed` 离开顶栏那一行、按 `compat/view-switch.ts` 量出的侧栏列右内缩就位，与 macOS 侧栏开关同一套「窗口坐标」做法。侧栏收起（桌面构建的轨道宽为 0）、列为 Windows 构建或列窄到放不下时，它回到顶栏原位。

小鲸鱼通过 `shell.overlay` 挂载，位置由 `compat/pet-anchor.ts` 量测。它只显示在 `data-phase="hero"` 的新会话页；输入卡上方有其他内容或发送回显时收起。模型与 effort 选单使用原生 Popover 顶层显示，覆盖重叠的鲸鱼，不因选单打开而隐藏宠物。

侧栏区头那枚视图选项按钮打开插件自己的卡片（同一个 `shell.overlay` 槽的另一位占用者）：状态在第一段，分组方式和排序方式在第二段，空分组开关在第三段；值行是「维度 + 当前值 + ›」，选项在二级卡片里，清除筛选按需放在底部。宿主那张菜单只被读与点：三个视图设置存在浏览器本地，公开的 `UiWorkspace` 面不发布它们，所以 `compat/view-options.ts` 用 `data-ccd-view-options-driving` 隐藏宿主卡片、读出三段的值、并点它的行来改值；读不出宿主卡片时，将点击交给 DSH 自己的菜单。状态、活跃／已归档／全部与两条自有行由插件命名，分组和排序取宿主原词。

主卡片宽 200px、子卡片至少 128px、间距 1px，子卡片顶部对齐当前行。10px 圆角、0.5px 轮廓与浅色菜单配色按用户参考图绘制，局部变量为 `--ccd-view-menu-*`，深色沿用主题色阶。主卡片允许溢出以防原生 popover 裁掉子菜单；悬停和点击都展开当前维度，通用键盘走位由卡片处理一次。ARIA 与定位只在值变化时写入，避免观察器通知自身形成死循环。真实 Chrome 测试验证命中、间隙穿越、边缘对齐、浅深色配色与左右展开时的选项映射。

`显示空分组` 是插件设置（`view.showEmptyGroups`，默认关，设置页与卡片写同一字段）。`compat/empty-groups.ts` 按宿主渲染的行判定展开分组；折叠分组则读取 `sessions.list` 与 `workspaces.list` 的权威成员、归档状态，结合菜单驱动发布的当前筛选判断，树模式保留有会话的祖先目录。数据尚未就绪时保留未知分组，临时新会话即使是当前会话也不算可见历史。观察器及源订阅跟踪成员和筛选变化，排除自身标记。没有任何历史会话时，无论空分组开关如何，隐藏分组标题，在列表区域居中显示「你发起的会话会显示在这里」和淡色像素装饰；第一条历史会话出现后恢复列表。仅筛选结果为空时，显示筛选提示及「显示所有会话」按钮；按钮通过宿主菜单选择全部会话。驱动会等待 React 提交菜单关闭，再清理隐藏标记，避免旧 DOM 导致再次切换并打开原生菜单。

会话行的尾部只放一枚 ⋮，它点开的是宿主自己那张卡片：**置顶、重命名、分叉、归档**四行正是宿主 `ui-workspace` 注册进 `sidebar.workspaces.session.menu.item` 的四项。宿主在同一行上还挂了自己的两个悬停按钮（归档与置顶，注册进 `sidebar.workspaces.session.row.action`），[sidebar.css](src/client/features/sidebar/sidebar.css) 把这条列表的出口整个 `display: none`——`renderSlot` 的出口是带行内 `display: contents` 的 `div[data-slot]`，所以要 `!important` 才压得住——于是指到一行上只出现一枚图形，而这两件事都还在卡片里。按钮节点、回调与宿主的悬停状态仍归 React，撤掉规则就是宿主自己的行。⋮ 自身按参考图给 20px 盒、6px 圆角与 `--ccd-hover-strong` 的悬停填充（落在已经填色的行上，取 `--ccd-hover` 会同色），图形用顶栏那枚竖排 ⋮（宿主 `IconEllipsisOutlineRegular` 的同一几何，`--ccd-icon-more`）。单元测试钉规则、真实 Chrome 测试钉盒子、焦点、命中与两种状态下的填充。

浏览区的搜索与视图选项保留独立工具栏，位于项目树上方。项目动作通过 `margin-left: auto` 统一靠右，不再为工具栏预留横向空间；按钮为 22px，图标为 14px。项目加号常驻，⋯ 在悬停、键盘聚焦或菜单打开时显示。展开侧栏隐藏工具栏中的「添加工作区」，折叠轨道保留宿主入口。`compat/browser-header.ts` 仅负责最近会话标题的本地化改写与释放还原，不再合并表头或监听树滚动。

上下文圆环点开的是插件自己的分解面板（同一个 `shell.overlay` 槽的第三位占用者，order 40）：**收起态**是标题行（`上下文窗口` + `~已用 / 窗口 (百分比)` + 右端 chevron）加一条 4px 分段条，**展开态**在同一头部下加分类行（色块 + 名称 + token + 百分比）与按需出现的逐项分组。没有底部按钮：标题行整行就是开关，`aria-expanded` 挂在它上面。分段条按 token 权重分配 flex，已用段之间 1px、与「自动压缩余量」灰段之间 4px，宽度不足 2px 的分类整段不画（与参照图一致）；空闲空间是轨道本身。

环的点击在捕获阶段被 `compat/context-panel.ts` 拦下并 `stopPropagation`——宿主的处理器是 React 在根节点委派的 `onClick`，所以在按钮上停住事件就不会走到它——因此宿主那面板从不打开，插件自持开合状态（驱动宿主开合不可行：宿主的 `useDismissOnOutsidePointer` 会把我们面板里的点击当成外部点击）。`data-ccd-context-open` 与 `composer.css` 里那条 `visibility: hidden` 是兜底而不是机制。会话切换、页面切换或环本身消失都会关闭面板；每次打开都从收起态开始。

数字全部是宿主的：头部读 `contextPressure`（与环同一个值），分类行读 `contextBreakdown` 加上插件投影 `ccdContext` 重算的两份明细，`sessions.list` 的 `projectionsBySession` 里三者在同一处到达。分类行与空闲空间按窗口缩放；头部采样值与分类估值可能有差异，面板不展示「估算差额」行。真实会话上这套折叠与宿主自己持久化的 `{systemTokens, toolsTokens, messageTokens}` 逐 token 相同。标题与明细分组的展开状态仅在本次打开期间保留；每次重新打开时全部收起。

点击鲸鱼会等概率播放喷一口水、轻弹眨眼、摆尾回应之一，播放期间忽略连点。动作只属于宠物自身，不读写会话；隐藏页面或卸载组件时取消，减少动态效果偏好下只显示短暂闭眼反馈。

窗口的滚动条分两级落地。**墨色**：宿主自己画滚动条（`body` 上五个 token 加一套无作用域的 `::-webkit-scrollbar`），画出来的是常驻的经典滚动条，而参考图用的是系统的浮层滚动条——移动时才出现、停下淡出。所以 [scrollbars.css](src/client/theme/scrollbars.css) 不改宿主的轨道几何（轨道宽、拇指内缩、端部留白分别被转录的 `scrollbar-gutter`、侧栏行的内边距、设置列的 9px 量过），只换墨色并在静止时不画；[scroll-pill.ts](src/client/compat/scroll-pill.ts) 用一次捕获阶段的 `scroll` 监听给正在移动的容器写 `data-ccd-scrolling`（scroll 事件不冒泡，但会沿捕获链下行），停下 0.8s 后清掉，样式表只认这一个属性。名单之外的滚动面（弹层卡片、插件自己的面板）维持这条规则，宿主自己隐藏滚动条的横条一根都不动。**胶囊**：五个页面级滚动面（会话页、转录列、侧栏树、Files、智能体团队面板）的轨道不留墨，改由同一模块在 `body` 末尾的一张 `position: fixed` 层里画 4px 的胶囊：长度钳在 36–96px（画出来的拇指长度是"内容占轨道"的比例，刚过一屏的面会画出一条几乎与视口同高的长条），位置停在宿主那条不可见拇指的中心，因此拖动仍落在宿主自己的滚动条上、指针位置不变。整个模块是无条件装配的（`apply.ts`），它的属性写在宿主节点上，释放时逐条归还。

侧栏「分组方式」新增「按状态」，由 `view.groupByStatus` 持久化（默认开启）。开启时先通过原生菜单选择单列表，`compat/status-groups.ts` 再按 `uiSession.sessionStatus`（未提供该源的构建读取宿主行 StateDot 的 `data-state`，并监听其变化） 的等待输入、运行状态分区；第三组「已结束」表示当前未运行且无待输入，不把未读完成提醒当作持久成功标记。子任务从已有目录按 `origin=subagent` 和直接父级读取，不获取会话、不加载历史；普通 fork 仍是独立行。宿主行及其 React 父节点保持原位，flex order 与 reading-flow 提供展示与阅读顺序，补充方向键／Home／End／Enter／空格导航，原生菜单、重命名与选择继续处理真实会话。状态视图禁止手动拖排，原有视图保留拖排。搜索结果保持宿主原样，卸载时还原属性、自定义变量、动画与监听器。

新会话字符水波纹由 `features/new-session/ripples.ts` 绘制，`compat/hero-canvas.ts` 按宿主 `data-phase=hero` 管理装饰 Canvas。字符为固定生成纹理，不读取对话内容；主题墨色集中在 token 中，绘制上限 24fps、像素比最多 2。多层波前通过连续噪声扭曲并交错，局部波峰有疏密与明暗差异；整体沿连续时间轴常驻流动，强度在 0.8–1 之间轻微起伏，不再按周期熄灭或重置；深浅主题使用相同的明亮蓝色墨色。点击主页空白处以向外传播的变形区域显露同一自然波场，形成断续且明暗不均的亮带，触点先给出短暂柔光，2.8 秒后释放。播放期间忽略后续点击，不叠加、不改原点、不重启计时，结束后才能再次触发；输入卡、按钮、链接、菜单与顶栏不触发，事件不被拦截。点击位置按画布比例保存以适应缩放，不跟随鼠标移动；点击光场独立于背景淡入，刚打开主页也能反馈。光场在粗网格上计算，再平滑插值到固定字符行，避免逐字符计算噪声。标题栏另设不接收指针事件的装饰 Canvas，覆盖主页内容列正上方的窗口标题区域，主页顶栏背景透明；进入聊天后移除两层 Canvas，窗口隐藏、零尺寸或系统减少动态效果时停止动画并清除点击波前。`new-session` 模块开关同时控制该背景。

Composer 加号保留宿主命令按钮及其工具组归属，`theme/composer.css` 用与发送按钮相同的末行定位基准把它放入输入面左侧，编辑器与占位文字预留相同的前导宽度；语音录制隐藏工具组时撤回该留白。主页的工作区／已有模式选择行叠到输入面与原有工具行下方（整行绝对定位，工具行按同一行宽预留），采用轻量 chip；不搬移 React 所属节点，不增加环境选择或中央项目卡片。工作区与模式按钮各取内容宽度，只对过长工作区名设响应式上限。`compat/hero-chips.ts` 量测整行并发布 `--ccd-workspace-seat`，工具行预留整行加一个间距；标签、字体或窗口宽度变化时重新量测。

状态分组的收尾样式限定在状态视图：标题与原生会话文字对齐，统一 28px 行节奏、字号与缩进，并预留原生 ⋮ 的宽度以稳定长标题省略。子任务每行绘制连续竖线，末项以圆角肘线收尾，单个子任务也使用同一规则；数据、点击动作与分组逻辑不变。

顶栏的子代理数量与团队入口由 `view.showHeaderSubagents`、`view.showHeaderTeam` 分别控制，默认关闭。`features/conversation/header-actions/visibility.ts` 在 `conversation.session.header.actions` 列表中以更低 priority 注册同 id 的空渲染器，分别覆盖宿主 `subagent-catalog` 与 `agent-team` 条目；打开开关或释放聊天页模块后撤销覆盖，恢复原生入口。不操作后端服务，也不覆盖子代理谱系导航、侧栏树或其他顶栏条目。设置页两项通过同一 Host 配置传输即时写入。

## 配置与生命周期

Host `Config` 的 `.volatile()` 字段通过 DSH 设置服务投影到 `configForms`。客户端订阅 `ui-skin-ccd-style`，配置变化时释放旧作用域，再挂载主题与模块；相同配置跳过重复挂载。

安装 bundle 设置 `enabled: true`，用户层配置优先。Host schema 与尚未加载的配置使用 false 兜底。配置页通过宿主 `settings.section` 注册为总设置页的「Claude 主题」独立栏目，注册在常驻作用域，独立于风格总开关；沿用原配置，不再注册插件行内表单。

注册、样式、监听、观察器与异步资源由 CleanupScope 管理，按逆序释放。DOM 适配保存原属性与内联值，在释放时恢复。

## 主题与宿主适配

`theme/tokens.css` 集中声明尺寸、颜色、图形与字体变量；`palette.ts` 计算派生色，`tokens.ts` 合成 `{ light, dark }` token 对，由宿主 `theme.overrideTokens` 下发。配色跟随 DSH 的主题偏好，字体默认以 Geist 开头。

版本相关选择器集中在 `compat/host-dom.ts`。各适配模块量测宿主布局并发布属性或 CSS 变量，框架列宽和界面业务仍由宿主持有。

平台差异由宿主属性分流：`data-platform="darwin"` 只标记 macOS，交通灯与折叠侧栏的窗口控件几何都限制在该作用域内；Windows 由 `data-windows-titlebar` 标记，宿主在窗口上方另加 40px 标题栏条带，侧栏开关、原生「应用／编辑」菜单和窗口按钮都在其中，插件只让该条带沿用配置的侧栏配色，不移动其中的控件。

同一版本号的 macOS 与 Windows 安装包是两次不同构建（`0.2.0-rc.2` 分别是 commit `5e9e301d` 与 `04f392c9`），宿主 CSS Module 的类名前缀在两者间不同。`compat/host-builds.ts` 保存两套前缀表，`dom.mountStyles` 在挂载样式前改写类名，`hostSelectors`/`hostAnchors` 按当前构建解析选择器表，因此样式表与适配代码都只写一套类名。未登记的构建不会静默失效：`watchHostBuild` 在窗口骨架渲染后报告一次，配置页同时给出提示。前缀表由 `node scripts/host-prefixes.mjs --windows <app.asar>` 从该构建的 `app.asar` 重新读出（整版重绑用 `--pinned`），配对以参照构建里每个模块的完整类名集合为指纹，配不上就报错而不是猜。

## 统计数据

Host 注册 `ccdUsage` 会话投影单元，折叠提示数与输入、输出、缓存用量，按天、小时和模型聚合。水位与 durable 检查点由宿主的 `sessionProjectionCache` 管理；缺失数据在后台补齐。

`/api/ccd-stats` 通过宿主鉴权 fetch 通道提供快照。浏览器读取快照并渲染 Overview／Models 与 All／30d／7d；首次数据准备完成后显示卡片。聚合服务随总开关启用，卡片显示由 statistics 模块开关控制。

## 上下文分解

Host 注册 `ccdContext` 会话投影单元。宿主的 `contextBreakdown` 只发布三个数（系统提示词／工具／对话），说不出是哪个工具、哪个指令文件、哪个技能占的，所以这个单元按 token meter 自己的启发式（4 字符 1 token、每块与每条消息 4 token 结构开销）重新计价每个产生消息的事件，并严格照 `surfaceOp` 处理替换——一次压缩是覆盖一段范围而不是追加。保留的表面节点连同各自的价格存在状态里，读取时汇总成三类行；`stateVersion` 为 1。

自动压缩余量取自 loader 里启用且声明了 `thresholdRatio` / `headroomTokens` 的条目，阈值按 `floor(min(窗口 × 比例, 窗口 − 输出预留 − 余量))` 在读取时算出；没有这样的条目（本机 `compaction-basic` 是 `disabled: true`）时整行不画，而不是按默认值硬算。

## 构建与分发

Host 构建为 ESM，运行依赖外置。Client 打成 CommonJS factory，并包装为 `window.__ModuleLoader__.load({ id, factory(require) })`；React、Cordis 和 DSH 静态共享库由宿主模块表提供。CSS 作为文本打入客户端，在模块挂载时加入文档。

安装包包含 `lib/`、`cordis.patch.yml`、README、LICENSE 和 package.json。Geist 字体与 OFL 许可保留在仓库中，供本机安装。

`npm run check` 执行类型、模块边界、颜色归属、文档链接、测试、构建和包内容检查；`npm run pack:local` 通过同一套检查后生成 tarball。

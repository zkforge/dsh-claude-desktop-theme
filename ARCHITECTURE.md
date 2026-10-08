# 项目架构

插件由 Host 配置与统计服务、客户端主题与展示组件组成。Workspace、Session、消息、Composer 和模型选择由 DSH 管理。

## 代码结构

| 目录 | 职责 |
| --- | --- |
| `src/shared` | 插件身份、配置与统计数据契约 |
| `src/host` | 配置 schema、会话用量投影与统计路由 |
| `src/client/contracts` | feature、服务、DOM 与配置表单端口 |
| `src/client/core` | 清理作用域与 feature 装配 |
| `src/client/compat` | SDK 接入、宿主选择器与布局量测 |
| `src/client/theme` | 设计变量、调色板、语义 token、Composer 与宿主弹层样式 |
| `src/client/features` | 界面模块、模型控件与配置页 |
| `src/client/apply.ts` | 客户端组合入口 |
| `scripts` | 构建、架构与安装包检查 |
| `tests` | 配置、生命周期、布局适配与统计行为测试 |

Host 依赖 shared 与 Host 运行库；客户端各层通过 contracts、core、compat 和 theme 共享能力。跨 feature 组合集中在 `apply.ts`。React 组件通过 props、回调和 SDK hooks 访问数据，Context 留在注册与适配层。

## 界面模块

| 模块 | 内容 | 默认 |
| --- | --- | --- |
| shell | 窗口骨架与分栏样式 | 开启 |
| sidebar | 导航、工作区、会话列表、账号菜单与视图选项卡片 | 开启 |
| new-session | 问候区与输入卡片布局 | 开启 |
| conversation | 顶栏、Markdown、滚动渐隐与回到底部按钮 | 开启 |
| composer-pet | 新会话输入卡右上角的小鲸鱼 | 开启 |
| statistics | 用量概览、热力图与模型图表 | 关闭 |
| composer-stats | 状态栏末尾的统计读数（输出速度与缓存命中率） | 关闭 |

`composer-stats` 是唯一不挂载模块的开关：它是状态栏统计读数的接管，由 `compat/stats-values.ts` 与 composer 样式表承担，关闭（默认）时宿主的那一族读数不画；同一模块发布的宽度预算与这个开关无关，读数隐藏只是把它占的宽度还给模型按钮。

模型与 effort 控件由新会话页和聊天页共用，选择操作调用官方 ModelDirectory。聊天顶栏的项目文件夹、终端与浏览器三个入口都转发宿主右侧栏操作，文件夹占工具组的第一位。顶栏最右的角位是宿主的单格槽位，原本由「收起右侧栏」的展开按钮占据：插件以更低优先级顶掉该条目，注册一个不渲染内容的条目把这一格留空；展开动作移进会话 ⋯ 菜单的第一项（`compat/session-menu.ts`），只在右侧栏收起时出现。工具调用沿用 DSH 原生展示。

小鲸鱼通过 `shell.overlay` 挂载，位置由 `compat/pet-anchor.ts` 量测。它只显示在 `data-phase="hero"` 的新会话页；输入卡上方有其他内容或发送回显时收起。模型与 effort 选单使用原生 Popover 顶层显示，覆盖重叠的鲸鱼，不因选单打开而隐藏宠物。

侧栏区头那枚视图选项按钮打开插件自己的卡片（同一个 `shell.overlay` 槽的另一位占用者）：状态在第一段，分组方式和排序方式在第二段，空分组开关在第三段；值行是「维度 + 当前值 + ›」，选项在二级卡片里，清除筛选按需放在底部。宿主那张菜单只被读与点：三个视图设置存在浏览器本地，公开的 `UiWorkspace` 面不发布它们，所以 `compat/view-options.ts` 用 `data-ccd-view-options-driving` 隐藏宿主卡片、读出三段的值、并点它的行来改值；读不出宿主卡片时，将点击交给 DSH 自己的菜单。状态、活跃／已归档／全部与两条自有行由插件命名，分组和排序取宿主原词。

主卡片宽 200px、子卡片至少 128px、间距 1px，子卡片顶部对齐当前行。10px 圆角、0.5px 轮廓与浅色菜单配色按用户参考图绘制，局部变量为 `--ccd-view-menu-*`，深色沿用主题色阶。主卡片允许溢出以防原生 popover 裁掉子菜单；悬停和点击都展开当前维度，通用键盘走位由卡片处理一次。ARIA 与定位只在值变化时写入，避免观察器通知自身形成死循环。真实 Chrome 测试验证命中、间隙穿越、边缘对齐、浅深色配色与左右展开时的选项映射。

`显示空分组` 是插件设置（`view.showEmptyGroups`，默认关，设置页与卡片写同一字段）。`compat/empty-groups.ts` 按宿主渲染的行判定展开分组；折叠分组则读取 `sessions.list` 与 `workspaces.list` 的权威成员、归档状态，结合菜单驱动发布的当前筛选判断，树模式保留有会话的祖先目录。数据尚未就绪时保留未知分组，临时新会话即使是当前会话也不算可见历史。观察器及源订阅跟踪成员和筛选变化，排除自身标记。没有任何历史会话时，无论空分组开关如何，隐藏分组标题，在列表区域居中显示「你发起的会话会显示在这里」和淡色像素装饰；第一条历史会话出现后恢复列表。仅筛选结果为空时，显示筛选提示及「显示所有会话」按钮；按钮通过宿主菜单选择全部会话。驱动会等待 React 提交菜单关闭，再清理隐藏标记，避免旧 DOM 导致再次切换并打开原生菜单。

点击鲸鱼会等概率播放喷一口水、轻弹眨眼、摆尾回应之一，播放期间忽略连点。动作只属于宠物自身，不读写会话；隐藏页面或卸载组件时取消，减少动态效果偏好下只显示短暂闭眼反馈。

## 配置与生命周期

Host `Config` 的 `.volatile()` 字段通过 DSH 设置服务投影到 `configForms`。客户端订阅 `ui-skin-ccd-style`，配置变化时释放旧作用域，再挂载主题与模块；相同配置跳过重复挂载。

安装 bundle 设置 `enabled: true`，用户层配置优先。Host schema 与尚未加载的配置使用 false 兜底。配置页注册在常驻作用域，独立于风格总开关。

注册、样式、监听、观察器与异步资源由 CleanupScope 管理，按逆序释放。DOM 适配保存原属性与内联值，在释放时恢复。

## 主题与宿主适配

`theme/tokens.css` 集中声明尺寸、颜色、图形与字体变量；`palette.ts` 计算派生色，`tokens.ts` 合成 `{ light, dark }` token 对，由宿主 `theme.overrideTokens` 下发。配色跟随 DSH 的主题偏好，字体默认以 Geist 开头。

版本相关选择器集中在 `compat/host-dom.ts`。各适配模块量测宿主布局并发布属性或 CSS 变量，框架列宽和界面业务仍由宿主持有。

平台差异由宿主属性分流：`data-platform="darwin"` 只标记 macOS，交通灯与折叠侧栏的窗口控件几何都限制在该作用域内；Windows 由 `data-windows-titlebar` 标记，宿主在窗口上方另加 40px 标题栏条带，侧栏开关、原生「应用／编辑」菜单和窗口按钮都在其中，插件只让该条带沿用配置的侧栏配色，不移动其中的控件。

同一版本号的 macOS 与 Windows 安装包是两次不同构建（`0.2.0-rc.2` 分别是 commit `5e9e301d` 与 `04f392c9`），宿主 CSS Module 的类名前缀在两者间不同。`compat/host-builds.ts` 保存两套前缀表，`dom.mountStyles` 在挂载样式前改写类名，`hostSelectors`/`hostAnchors` 按当前构建解析选择器表，因此样式表与适配代码都只写一套类名。未登记的构建不会静默失效：`watchHostBuild` 在窗口骨架渲染后报告一次，配置页同时给出提示。前缀表由 `node scripts/host-prefixes.mjs --windows <app.asar>` 从该构建的 `app.asar` 重新读出（整版重绑用 `--pinned`），配对以参照构建里每个模块的完整类名集合为指纹，配不上就报错而不是猜。

## 统计数据

Host 注册 `ccdUsage` 会话投影单元，折叠提示数与输入、输出、缓存用量，按天、小时和模型聚合。水位与 durable 检查点由宿主的 `sessionProjectionCache` 管理；缺失数据在后台补齐。

`/api/ccd-stats` 通过宿主鉴权 fetch 通道提供快照。浏览器读取快照并渲染 Overview／Models 与 All／30d／7d；首次数据准备完成后显示卡片。聚合服务随总开关启用，卡片显示由 statistics 模块开关控制。

## 构建与分发

Host 构建为 ESM，运行依赖外置。Client 打成 CommonJS factory，并包装为 `window.__ModuleLoader__.load({ id, factory(require) })`；React、Cordis 和 DSH 静态共享库由宿主模块表提供。CSS 作为文本打入客户端，在模块挂载时加入文档。

安装包包含 `lib/`、`cordis.patch.yml`、README、LICENSE 和 package.json。Geist 字体与 OFL 许可保留在仓库中，供本机安装。

`npm run check` 执行类型、模块边界、颜色归属、文档链接、测试、构建和包内容检查；`npm run pack:local` 通过同一套检查后生成 tarball。

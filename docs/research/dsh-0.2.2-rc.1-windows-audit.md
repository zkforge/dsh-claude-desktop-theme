# DSH 0.2.2-rc.1 Windows 兼容性收集与修复计划

核查日期：2026-11-05。插件基线：`0.10.1`，提交 `f8fd782`。本轮先收集、校对，再实施；不以放宽 `engines.dsh` 代替实际适配。

## 证据与边界

- 目标是 Windows `0.2.2-rc.1`，不是本机旧版 macOS。官方 [Windows 更新清单](https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml) 指向 [安装包](https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.2-rc.1-win-x64.exe)。下载后已验证清单 SHA-512，解出 `resources/app.asar`；没有运行 Windows 安装程序。
- 目标清单：`dsh/package.json` 为 `0.2.2-rc.1`，根清单 `dshBuildCommit` 为 `c59d10aff167ad7eefead4b3a9082fb57c8fbfe8`。
- 旧版对照是本机 macOS `0.2.1-rc.5`，commit `d4db512a969fccf0c5cc7ec8fe38e9c1d27af916`。比较前按已登记前缀归一化，平台差异不能直接算成回归。
- 扫描全部 `src/**/*.ts,tsx,css` 中引用的宿主类名与标记，检查 1,016 处类名引用；核对 24 个 Windows 前缀、152 个非插件 `data-*` 名称、19 个 Slot 字符串。属性或 Slot 字符串存在只证明名称未消失，不证明结构、作用域或行为未变。
- 对重点模块按源码 region 对照：layout、sidebar、workspace、conversation、chat、attachment、model-selection、permission、settings 各页、tool、sidebar-right、files、documentpreview、browser、terminal、runner 的 API/Slot catalog。
- 已在 Chrome 中运行目标包内的真实 `FileNavigator` 函数（临时导出只作用于审计副本），配合现有 `mountFilesPane` 复现。这里只提供最小服务状态，不冒充 Windows Electron 端到端验证。
- 临时材料保留在 `/private/tmp/dsh-rc22-audit/`：`windows/resources/app.asar`、`old/`、`new/`、`normalized/`、`inventory.json`、`contracts.json`、`slots.json`、`regions.json`、`files-browser-results.jsonl`。机器可读摘要见 [审计摘要](dsh-0.2.2-rc.1-windows-audit.json)。

## 可重复失败信号

```sh
node /private/tmp/dsh-rc22-audit/check-contracts.mjs
node /private/tmp/dsh-rc22-audit/browser-repro.mjs
```

两条命令均已运行，并以退出码 1 失败。第一条检查插件实际引用的类名能否在真实发布包中找到；第二条渲染真实新版文件导航器后运行插件适配，检查搜索框是否存在、是否误插进分隔条。第二条结果重复一致：

```json
{"page":true,"rootTag":"ASIDE","hasFilter":false,"errors":[]}
{"page":false,"rootTag":"ASIDE","hasFilter":true,"filterParentRole":"separator","errors":[]}
```

`errors: []` 说明这是静默失配，不能只靠“控制台没有报错”验收。

## 已确认失配

| 编号 | 页面/范围 | 直接证据与影响 | 优先级 |
| --- | --- | --- | --- |
| W01 | 所有原生菜单；权限、Agent 预设、工作区/分支、侧栏视图选项 | `Menu` 共享类由 `4ub78` 变为 `1p5el`，且行号后缀改变。旧 `host-dom.ts` 的 label/wrap/button/check/viewport/separator 全部不匹配；`permission-menu.ts`、`workspace-menu.ts`、`workspace-branch.ts`、`view-options.ts` 的节点定位失效。对应外观覆盖也不再命中。 | P1 |
| W02 | 聊天正文、思考、文件提及链接 | `MarkdownText` 由 `1ypvv` 变为 `rve47`。`markdownBody`、file mention、link icon 失配，正文排版与 `conversation-stream.ts` 的正文识别/提及排除路径失效。 | P1 |
| W03 | 通用弹窗；配置、确认、详情等使用 Modal 的入口 | `Modal` 从 `o6lrb` 变为 `14mp3`，description/body/footer 行号也移动。`theme/dialogs.css` 的 mask/dialog/header/title/description/body/footer/close 八类规则失效。`RiskConfirmation` 不能未经核对与 Modal 一起替换。 | P1 |
| W04 | 用户消息、排队/回显消息 | 新 `chat/UserContent.js` 使用共享 `UserMessageBubble` 并写 `data-message-bubble`；`MessageItem` 已无旧 `bubble` 类。插件的浅/深主题气泡和文本选择规则仍引用 `.IzP3Va_bubble`。 | P1 |
| W05 | Files 独立页与预览旁导航器 | 文件树从旧 `FilesBody` 的 root/header/body 结构，改为独立 `FileNavigator` 的 `aside[data-files-root]`。独立页 root 仅有 body；旁栏模式 root 的首个非 body 子节点是 `role=separator`。`files-pane.ts:headerOf` 的假设因此错误：独立页不挂搜索框，旁栏把搜索与折叠控件插进 resize separator。`right-panel.css` 同样把非 body 子 div 当作头部。 | P1 |
| W06 | 无会话/首页顶部 | 新 `ConversationHeader.js` 删除 `headerSessionless`，插件仍引用该类并用它排除特定顶部规则。Windows 与 macOS 的顶部规则需分别验收，不能把 macOS 交通灯规则套到 Windows 标题栏。 | P2 |
| W07 | 发布包核对工具 | `host-prefixes.mjs` 用 version+commit 选择参照表。macOS rc5 的 frame 仍是已知的 `PIRFFq_frame`，但 commit 未单独登记，脚本无法还原 authored 前缀，默认 dry-run 误报 24 项 reference missing。另一方面新版模块有新增/删除 local，旧“整个 local 集合完全相等”也不能直接更新这些模块。 | P2 |

20 个共享类名失配的精确新旧对照记录在审计 JSON。另有两个新版删除的模块类（bubble、headerSessionless）。`OpZ85W_root` 在旧 macOS rc5 中已经不存在，属于既有失效引用，不应宣称为此次 Windows 升级新增的 bug。

## 变更已确认、表现仍待回归验证

| 页面/范围 | 新版实际变化 | 必须核对的行为 |
| --- | --- | --- |
| 侧栏会话列表 | 新 `rowResting` 包住时间/尾部 Slot/置顶图标，`rowQuickActions` 又包一层快捷动作；会话使用 context menu 触发，非旧 popup 包装结构 | 悬停/键盘聚焦、时间与菜单按钮让位、置顶、归档、搜索、拖拽、更多菜单；不把新功能直接隐藏 |
| 输入框/附件 | 新增 sending spinner、图片上传进度、失败/拒绝状态；发送接收阶段有调整 | 发送中状态、图片/文件失败显示、附件删除和重试、排队消息；不改宿主发送流程 |
| 模型选择器 | 新 badge/badgedName/badgedNameText，catalog 监听 models-updated | 原生与插件选单、长名称、模型更新、收藏和键盘操作；不要丢模型 badge 信息 |
| 设置 | SettingsPanel 删除旧 content 包装，title/nav/header/options 改成同级；设置图标改为 Slot；旧 CSS local content 删除 | 设置窗口布局、滚动、关闭、账户/模型/主题入口及英文；当前插件只精确使用该模块 trigger/triggerRow，不能仅因原生结构变更就断言设置页已经坏了 |
| 右栏/文件预览 | navigator 按 pane 管理并可嵌入预览；新增 PreviewFrame、文件树 resize、右栏 flash 与 tab menu；文件打开/替换放置规则变化 | 独立 Files、预览带树、不同文件类型、树开合、缩放、关闭/切换/整组关闭、会话切换与关闭后焦点 |
| 浏览器/终端 | 右栏服务与容器存在变化；其类型的基本服务仍在 | URL、后退/前进、截图、终端多标签、关闭与焦点，不能只验证 DOM 看起来正常 |
| 自定义/定时任务 | 页面标记仍在；适配按模块 local 动态注解 | 列表/详情/发现、搜索/筛选、任务新建/详情/删除弹窗、语言切换；未发现足以单凭源码认定的专属接口破坏 |
| 新版文本交互 | ChatView 新增 text-interaction overlay、引用等能力 | 选择正文、引用、文字菜单；新气泡和流式装饰不能截断宿主交互 |
| 全局布局 | MainPanel 新增 `data-global-panel` 包装，新增 drawer/inert；Windows 原生标题栏明确不走 `<768px` drawer 分支 | 中央页高度、右栏、窄宽、侧栏收起后导航按钮、Windows 标题栏；不把浏览器抽屉变化误报成 Windows 原生回归 |
| 统计/上下文/信息卡 | 共享正文/菜单与宿主布局会间接影响展示，未确认投影 API 破坏 | 首页统计、上下文展开、会话信息卡、已有 API 请求与卸载清理 |

## 已排除的草率结论

1. 24 个 Windows 模块前缀在 rc22 中都仍存在，frame 仍是 `mP3x-q_frame`，现有运行时识别返回 identified；不是“整个 Windows 前缀表全换了”。相同 frame 不能区分共享前端的代次，新增静态样式映射不能仅按 frame 缓存决策。
2. 152 个标记名中，没有“旧宿主存在而新宿主完全不存在”的项目；但 Files 证明“标记还在”不等于结构还在。
3. 检查的 19 个 Slot 名均存在；这不等于 owner props 与数据契约完全不变。未发现明确接口破坏的服务不能先改写。
4. 旧版 712 项测试通过不能证明新版兼容：不少 fixture 直接抄的是 `0.2.0-rc.2` 的 DOM/CSS，必须纳入新构建的结构或真实组件案例。

## 实施中追加的已确认失配

| 编号 | 范围 | 证据与处理 |
| --- | --- | --- |
| W08 | Files 行结构 | rc22 `Entry` 在 `li[data-files-entry]` 内增加 `div.row`，主 button/span 与 accessory 并列。旧直接子选择器不再命中；已覆盖两代主操作结构，保留 accessory。 |
| W09 | 定时任务 | rc22 有 active/paused/ended/all 四状态、嵌套 searchTools、手动创建和可编辑详情，任务使用 target 与 lastDelivery。原生删除调用 `schedule.edit({id,action:'delete'})`，history 不带 sessionId。旧自有详情在捕获阶段拦截原生行，阻止打开新详情且会把 paused 写成已结束。已明确识别新版结构并保留原生详情/新操作，旧代次继续既有适配；新版不进入旧删除与 history 路径。 |

## 实施计划与验收

### 第一步：补足新版失败用例

将新旧共享类名和真实 Files 新结构转成小型、注明来源的 fixture，测试必须运行插件实际 selector、挂载函数和 CSS；先看当前实现失败。保留旧版场景，防止为了 Windows 新版破坏现有 macOS。无需把安装包、整个宿主 bundle 或个人会话放入仓库。

### 第二步：修复共享样式边界和聊天

在 `compat/host-dom.ts`、`host-builds.ts` 或同层的明确边界集中处理共享 Menu/Modal/Markdown 代次；让 CSS、DOM 查询、生成的菜单 class 同步使用正确结构。优先使用经真实源码核对的稳定 data 属性/role；确需哈希的地方明确支持已验证的新旧类。不要只全局替换旧哈希，也不要在各业务模块散落平台判断。修复 `data-message-bubble` 气泡和无会话页头，保留原生文本交互与新上传状态。

### 第三步：修复文件导航器与右栏整合

明确区分旧版 Files root、独立 Files page、新版 preview 内 navigator。页头必须由真实头部标记/结构确定，禁止把 separator 当 header；搜索、树开合、preview/tab 操作分别落在正确的宿主控件上。保留 navigator resize、宿主焦点管理、文件切换与原生上下文菜单，不复制或搬动 React 所属节点。跨 pane、跨 tab 的状态和释放必须经过回归验证。

### 第四步：按页面清单补适配

先复现再修改上述待验页面。重点是侧栏行新包装、设置新布局、模型 badge、附件状态和 preview。没有证据的 API 不重写，不因为宿主新增能力而顺带扩张产品设计。工具应能用真实 archive 核对新旧 local，而非靠未验证的模糊匹配写表。

### 第五步：收尾验证与交付

- 新增针对真实新版差异的有意义回归测试，旧版及新版 fixture 均通过；运行完整 `npm run check`，包含 Chrome 测试。
- 按 AGENTS.md / install.md 用唯一保留 tarball 路径安装到本机 DSH desktop profile。首轮计划时本机为 macOS rc5，只能验收旧版不回退；追加修复时本机已升级 macOS rc22，仍不能写成 Windows rc22 实机已通过。
- 界面图变化遵循 AGENTS.md：完整窗口图须来自用户的合规截图，不伪造；可以重跑真实组件的局部截图脚本。缺少 Windows 实机结果或新完整窗口截图时如实列明。
- 更新文档，记录修复、测试、保留的 Windows 原生端待验项。此次不自动升版、不提交、不推送、不再发布 npm；用户本轮只授权修复实施与项目要求的本地安装。

实施者：按用户要求派遣一个 GPT-6.1 Sol，reasoning effort 为 medium。由主代理检查其结果与证据后交付。


## 实施结果（2026-11-05）

W01–W06、W08、W09 的上述已确认失配已修复，W07 核对工具也可对真实目标 dry-run 成功：

- `aliasHostSelectors` 在样式挂载与 DOM 查询边界统一支持 20 个已核对的共享类新旧拼写；菜单生成行携带两代类。未改变 RiskConfirmation 的类，也未用 frame 猜共享前端代次。
- 新气泡以 `data-message-bubble` 承接配色与文本选择规则；无会话头部根据真实 conversation session 属性识别。测试包含旧/新页头结构的首页与已有会话高度。
- Files 只认旧 path header 或插件自有 toolbar，独立页也能搜索。Entry 新包装层的主操作行得到同样行高与图标，accessory 保留。新版 resize separator 不承载过滤框，也不吃旧 header/两列布局规则。
- 预览自带 navigator 时不另开独立 Files；已有两者时以当前预览内树为操作目标。标题的树开合转发原生 toggle，关闭会卸载整个 aside；搜索等待新 navigator 与过滤框挂载后再聚焦。测试模型包含异步重挂载及独立 Files 并存，释放后原生 resize 节点仍在。
- 定时任务保留四状态、手动创建、原生详情与编辑/运行/暂停/清理/删除。只折叠 searchField，不隐藏清理菜单；搜索工具与已填充列表处于独立 grid 行。旧实现的重放用例确认会吞掉原生任务点击，修复后所有原生处理器可达。
- 前缀工具以已审计的 macOS rc5 身份还原参照；保留已登记 hash 且 owning bundle 相同时允许 local 变化，否则仍要求完整 local 集合唯一匹配。真实 Windows rc22 dry-run 输出 24 个前缀，全部与现表一致，因此本轮不改写运行时平台表。
- 自定义页的 Manager 37 个、Market 20 个适配 local 经新旧源码逐名校对，未发现旧有 local 在新版消失；`detailDescription` 的缺失为旧版既有情况，不宣称此次引入。

完整 `npm run pack:local --cache .cache/npm` 已通过：类型、架构、716 项测试（716 pass / 0 fail / 0 skipped，含 Chrome）、构建、包检查。另在最后将 navigator fixture mode 校正为真实 `push` 后，两项 targeted 测试通过。版本保持 0.10.1，未 commit、push 或发布。

已按源码安装流程安装到本机 DSH `desktop` profile，保留唯一路径：

`artifacts/install.xpgzuF/dsh-claude-desktop-theme-0.10.1.tgz`

### 验证证据索引

- `/private/tmp/dsh-rc22-audit/legacy-schedule-red.log`：用 `git show HEAD` 的原始三个 schedule 适配文件在临时 bundle 重放；任务点击未到达宿主处理器，退出 1，不回滚工作区。
- `/private/tmp/dsh-rc22-audit/targeted-green.log`：新版原语/Files/任务、旧右栏、view-options driver 共 10 项通过。
- `/private/tmp/dsh-rc22-audit/navigator-green.log`：真实卸载语义的两个 navigator 场景通过。
- `/private/tmp/dsh-rc22-audit/files-real-green.log`：重新运行原始真实 `FileNavigator` 反馈环，两种 page 值均 `hasFilter:true`、`filterParentRole:null`、`errors:[]`。
- `/private/tmp/dsh-rc22-audit/contracts-fixed.log`：1,016 处引用按双代共享类与已确认的 data-message-bubble 替代项核对，无新增未覆盖失配；原始 `contracts.json` 与本报告的缺失类证据保留。旧有 `OpZ85W_root` 单独视为已知失效引用，不计为本轮新增问题。
- `/private/tmp/dsh-rc22-audit/prefixes-fixed.log`：真实 archive 前缀 dry-run 输出。
- `/private/tmp/dsh-rc22-pack-final.log`：完整检查和打包日志。
- `/private/tmp/dsh-rc22-audit/install.log` 与 `installed-tarball.txt`：本机安装结果和保留路径。

主代理已在安装后通过 CUA 重载 macOS rc5 冒烟：首页、统计、导航、视图选项主卡与分组子菜单、定时任务页及旧版三状态筛选/搜索入口正常；没有修改筛选值，最后回到原首页。此项只证明本机旧版入口兼容。

### 仍需 Windows 原生环境验收

前半轮安装与冒烟发生在 macOS 0.2.1-rc.5；2026-11-06 已确认本机升级为 macOS 0.2.2-rc.1、commit c59d10af。发布包源码校对、Chrome 真组件及 fixture 回归仍不能替代 Windows Electron 实机。侧栏拖拽/上下文菜单、选中文字与引用、发送与图片上传失败/重试、模型更新 badge、设置新布局、各类预览/终端/浏览器焦点与服务操作、窄宽标题栏、统计/信息卡需按前述页面表做原生端验收。未确认破坏的服务和 API 未改写。

没有用户提供的新完整窗口原图，本轮未伪造更新 README 全界面截图。未改动宠物、像素场、模型选择器或上下文组件的外观资源，不需重渲染其动图/局部截图。


## Windows 实机截图追加回归（2026-11-06）

用户提供的三张真实 Windows 截图确认了先前仅做 local 名称核对和简化 fixture 未覆盖的级联/几何问题；原图保留在临时剪贴板目录，不复制个人账号信息到仓库。

| 问题 | 可重复失败 | 修复 |
| --- | --- | --- |
| 自定义页滚不下去，页头压住列表 | 在原生 AppFrame/MainPanel、PluginManagerPage CSS 与真实 header-scroll 驱动下，视口 932px，pageBody 的 clientHeight/scrollHeight 都为 1219px；标题和页签覆盖首卡。 | 新版根改为受约束的 flex 容器，让既有 pageBody 继续拥有滚动；测量页头恢复 flex，而不是旧 grid 的 display:contents，保留宿主 sticky/compact/inline/inert 驱动。解除其旧 960px 最大宽度，使标题与卡片左边一致；详情/更多保留 47px 返回行顶距。 |
| 新建任务 split 按钮右半灰色、内缝圆角不齐 | 原生 Button + TaskManagerPage CSS 下，主半黑色、菜单半 rgb(68,71,75)，主半内缝半径 7px。 | 标注原生 split 与菜单按钮，让两半使用同一主题填色、26px 控件高度和连续外圆角；不改宿主菜单/手动创建事件。菜单保留 management.css 的 30px 行规范。 |
| 账号「更多」同时出现飞机与 info | 原生 icon span 同时带 aria-hidden 和插件 original 标记，后面的图标尺寸规则以更高优先级把 display:none 改回 flex。 | 替代图标尺寸规则明确排除 original 节点，打开菜单时只显示插件 info；卸载恢复原生飞机。 |

新增 `tests/windows-layout-regressions-browser.test.mjs` 与 `tests/fixtures/rc22/`，加载真实发布模块的原生 CSS、实际共享 management.css 和 palette alias；先运行宿主 header attach，再挂载插件，保留真实克隆测量和滚动代码。回归通过真实 `Input.dispatchMouseEvent(mouseWheel)` 滚到末项，覆盖我的、发现、详情、更多、返回以及滚回顶部；compact toolbar 与返回顶部后的 Info 均通过物理点击，Info 的 inert 状态会恢复。原生菜单动作仍到达宿主处理器。

证据：`/private/tmp/dsh-rc22-audit/screenshots-red.log`、`detail-inset-red.log` 和 `screenshots-final-green.log`。演示截图在 `artifacts/windows-customize-top.png`、`artifacts/windows-customize-bottom.png`，只有演示插件名，不替换 README 的用户完整窗口图片。当前绿色结果中 pageBody 为 932/1325px，滚轮到 scrollTop 393，末卡 bottom 884 ≤ 容器 bottom 932；标题与卡片 left 均为 304。


### 侧栏底色追加修复与当前环境

本机已升级到 macOS 0.2.2-rc.1（c59d10af），主代理 CUA 在升级后的真实界面确认侧栏出现蓝紫渐变。原生 layout 的 macOS 非 drawer 选择器（含 dark 变体）比插件原有侧栏平面背景规则优先级更高；同一 Chrome 用例也复现 column 为透明混色并保留 linear-gradient，而目标色为 rgb(252,252,251)。已在精确的非 drawer frame paint 边界提升主题规则优先级，保留 drawer 分支，不修改宿主 token API 或 React 节点。

新增 computed style 回归覆盖 16 种平台/浅深/默认与自定义色/drawer 组合：column、原生 sidebar root、frame、Windows caption 与独立 canvas 均检查实际绘制色，而非只看 `resolveThemeTokens` 返回值。深色继续遵循现有产品约定使用内置配色，自定义色作用于浅色。证据为 `/private/tmp/dsh-rc22-audit/sidebar-paint-red.log` 与 `screenshots-and-sidebar-green.log`。

前缀工具补充已验证的 rc22 参照身份，当前默认本机 macOS rc22 到 Windows rc22 的真实 archive dry-run 仍识别 24 个前缀；日志在 `/private/tmp/dsh-rc22-audit/prefixes-macos-rc22-reference.log`。这解决本机升级后 exact rc5 参照前提失效的问题。


### 本轮检查与安装完成

追加四项修复后的完整 `npm run pack:local --cache .cache/npm` 通过：类型、架构、720 项测试（720 pass / 0 fail / 0 skipped，含 Chrome）、构建及包检查。完整日志：`/private/tmp/dsh-rc22-screenshots-pack.log`。

已安装到当前 macOS rc22 的 `desktop` profile，保留新唯一路径：

`artifacts/install.yUpxUA/dsh-claude-desktop-theme-0.10.1.tgz`

安装退出码为 0，记录在 `/private/tmp/dsh-rc22-audit/screenshots-install.log` 和 `screenshots-installed-tarball.txt`。版本仍为 0.10.1，无提交、推送或发布。前一轮 `install.xpgzuF` 保留作历史安装引用，不复用其 tarball 路径。Windows 原生端仍需用户按实际机器复验，本轮 Chrome 证据不冒充 Windows 实机验收。


### macOS rc22 安装后真实界面验收

主代理在当前 macOS 0.2.2-rc.1 重载后确认：侧栏恢复平面底色，自定义页页头与列表对齐；点击内容后 PageDown 能滚到末尾（已安装插件可见），PageUp 能返回顶部，sticky header 正常。验证期间未发送或清空原有未发送草稿。

CUA 的 scroll 动作未产生可观察变化，但键盘滚动提供了第二个有效信号，不能将前者单独认定为产品仍不能滚动。本轮滚动证据边界为：macOS Electron 实机键盘滚动通过；Chrome 原生 CSS/真实 header 驱动 fixture 的真实 mouseWheel 通过；Windows Electron 尚未实机复验。没有因此加入额外推测性修复，也未改动通过检查与安装后的代码。

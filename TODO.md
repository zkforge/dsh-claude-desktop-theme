# 任务

- 完成后请打勾 ：✅

1. ✅ 把「对话 / 轨迹」切换按钮从对话区顶部移到侧栏，位置按 Claude 侧栏里的摆放方式（第二张图的版式）。

   现状：切换按钮在对话区顶部。

   ![现状：对话 / 轨迹 切换按钮在对话区顶部](docs/issues/img/todo-view-switch-current.webp)

   涉及文件：`src/client/compat/view-switch.ts`、`src/client/features/conversation/conversation.css`、`src/client/features/sidebar/`。

2. ✅ 侧栏样式与 Claude 对齐。DSH 现状是一行「搜索 / 筛选 / 添加工作区」，另一行是首个工作区；Claude 的形态是：没有会话时显示「最近会话」四个字，右侧是搜索和筛选两个按钮；有会话时按第四张图，第一个会话的右方展示新建会话的加号，以及搜索和筛选。

   | 现状：无会话 | 现状：一行搜索、筛选、添加工作区，一行首个工作区 | 有会话时的参考 |
   | --- | --- | --- |
   | ![现状：空闲态侧栏](docs/issues/img/todo-sidebar-empty-current.webp) | ![现状：两行结构](docs/issues/img/todo-sidebar-rows-current.webp) | ![参考：第一个会话右方是新建会话的加号、搜索和筛选](docs/issues/img/todo-sidebar-sessions-target.webp) |

   涉及文件：`src/client/features/sidebar/sidebar.css`、`src/client/features/new-session/`、`src/client/compat/empty-groups.ts`、`src/client/compat/workspace-menu.ts`。

3. ✅ 侧栏三个入口里，点击「新建会话」后的选中底色不能保持，鼠标移开就消失；改成和另外两个入口一样，选中期间底色一直保留。

   涉及文件：`src/client/compat/sidebar-navigation.ts`、`src/client/features/sidebar/navigation.css`、`src/client/features/sidebar/sidebar.css`。

4. ✅ 把 DSH 的右侧栏改成浮动卡片的观感（三张预览图：Files、终端、浏览器）。面板脱离窗口边缘，自成一张带圆角的卡片，有自己的底色和轻微阴影，和侧栏的卡片风格统一。同时 Files 也要像 claude 一样的目录观感包括收起按钮，每个文件前的样式也是。

   | Files | 终端 | 浏览器 |
   | --- | --- | --- |
   | ![预览：Files 面板](docs/issues/img/todo-rightbar-files.png) | ![预览：终端面板](docs/issues/img/todo-rightbar-terminal.png) | ![预览：浏览器面板](docs/issues/img/todo-rightbar-browser.png) |

   涉及文件：`src/client/features/shell/shell.css`（`_6Qf49G_rightbarCol`）、`src/client/features/context-panel/`。

5. ✅ 右侧栏从「标签页」改成「分栏」：不再是一条共用的页签栏，而是每个视图一格、各自一条标题行与关闭，按 1/2/3/4 块铺在面板里（上下左右都能分，像 Claude），格与格之间是可拖的分隔线。

   ![参考：终端与 Files 两块上下排列](docs/issues/img/todo-rightbar-panes.png)

   宿主的限制：右侧栏用的 DockKit 标签式渲染器只接受「一格」或「左右两格」，竖分或第三格会让宿主抛错，分栏按钮也写死两格上限；所以四块只能走宿主自己的**浮层面板**（`float`，`position: fixed` 的卡片，自带标题行、关闭、停靠，内容由宿主渲染）。

   已按 2026-10-12 的 mp4 补齐：两列独立上下拖动、关闭同列补位、移除顶部空行、按视频复刻标题栏按钮与图标、面板放大／还原、Files 内部预览与树宽拖动、会话隔离及最后一块关闭自动收起。

   涉及文件：`src/client/compat/right-panes.ts`、`src/client/compat/host-dom.ts`、`src/client/contracts/ports.ts`（`SidebarRightPort` 补 `float`）、`src/client/features/shell/right-panel.css`。

6. ✅ 侧栏会话条目的尾部只留一枚 ⋮，点开菜单里是置顶、重命名、分叉、归档；宿主自己挂在同一行的归档／置顶两个悬停按钮不再画。

   现状：指到一条会话上会并排出现三个图形（⋯ 加宿主自己的归档、置顶）。参考图的那一行只有一枚 ⋮，这四件事都在它开出来的卡片里（宿主 `ui-workspace` 注册进 `sidebar.workspaces.session.menu.item` 的四项）。

   ![参考：会话行尾部一枚 ⋮，菜单里是置顶／重命名／分叉／归档](docs/issues/img/todo-session-row-menu.png)

   涉及文件：`src/client/features/sidebar/sidebar.css`、`src/client/theme/tokens.css`、`src/client/theme/palette.ts`。

7. ✅ 正文里的文件路径点开后右栏没反应、「打开侧边栏」也救不回来（只有重启应用才好）。

   实测根因：插件每次同步看到「有文件预览、没有 Files 树」就自己 `sidebar.openTab('files')`。**恢复自 localStorage 的布局**也是这个形状，而宿主此时正在逐个丢弃它复活不了的标签，于是插件新开的那个标签在宿主 `rightbar.session` 这个 slot entry 渲染时还没有对应的 occurrence，宿主抛

   ```
   Error: sidebarRight: tab "<id>" has no committed occurrence in session "<id>"
       at TabDomain.occurrence (…)
   slot entry crashed in 'rightbar.session': …
   ```

   侧栏面板随即被卸载，之后 `openResource`/`openTab` 全是空操作（正文文件链接、顶栏文件夹／终端／浏览器、会话菜单里的「打开侧边栏」都一样），只能重启应用。复现与抓取见 `scripts/watch-sidebar.mjs`（连 app 的 DevTools 端口，记录每条报错与右栏状态变化）。

   改法：树的请求只跟随**读者刚打开的那个预览**（本次挂载从未见过的预览 id），恢复布局的第一次同步只做记录、不算打开；标签集合在变小时（宿主对账）不请求；写入延后到另一个任务，并在写前重新读宿主记录。关闭组卡片也改成每个标签一个任务、每次按当前 DOM 复核。

   涉及文件：`src/client/compat/right-panes.ts`、`src/client/compat/pane-chrome.ts`、`tests/right-panes-browser.test.mjs`、`scripts/watch-sidebar.mjs`。

   宿主侧仍是 bug：desync 不该拆掉整列（文档见 `docs/research/` 与本次结论，未提交上游）。

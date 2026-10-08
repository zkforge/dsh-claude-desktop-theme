# DSH 宿主标记迁移清单

核查日期：2026-10-04。目标是减少 CCD 主题对构建哈希的依赖；本文是迁移调查，尚未实施样式改动。

## 证据范围

核对了仓库安装的 `@deepseek-ai/*` SDK，以及本机 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`。后者的 `dsh/package.json` 报告 `0.2.0-rc.2`，应用清单的 `dshBuildCommit` 为 `5e9e301dd9dc8923b2762f76dacfc5751f6ca851`。宿主标记的对应关系直接来自归档内各包的 `lib/client.js`，不是从插件注释推测。此轮未重新核查 Windows 安装包，也未验证后续版本。

官方 SDK 的主题与 Slot 文档见 [官方能力调查](dsh-official-theming.md)。需要区分：公开的扩展 API、宿主实现中的 DOM 属性、插件自己的 `data-ccd-*` 属性。后两者不能直接当作官方的永久兼容承诺。

## 可优先迁移的同元素对应

以下类名和属性在已核查构建中位于同一元素。选择器应限定在相应会话、输入卡或侧栏范围，避免命中嵌入会话等其他实例。

| 现有选择器 | 宿主已有标记 | 来源与注意事项 |
| --- | --- | --- |
| `.ST7X_W_body` | `[data-conversation-content]` | ui-conversation `ConversationContent`；涵盖 main 和 embedded，保留原规则的作用范围 |
| `.ST7X_W_scrollBody` | `[data-conversation-scroll]` | 同上；不是 ui-chat 内层 `.icaHSq_scroll` |
| `.ST7X_W_composerSeat` | `[data-composer-seat]` | 同上；还带 `data-conversation-region="composer"` |
| `.yhfFVG_card` | `[data-composer-card]` | ui-conversation `InputBar` |
| `.yhfFVG_scroll` | `[data-composer-card] [data-input-scroll]` | ui-conversation `DraftEditor`，就是输入面板滚动盒 |
| `.yhfFVG_input` | `[data-composer-card] [data-composer-input]` | ui-conversation `ComposerContentEditable`，实际可编辑元素 |
| `.yhfFVG_placeholder` | `[data-composer-card] [data-composer-placeholder]` | ui-conversation `DraftEditor`，独立的覆盖提示层 |
| `.ST7X_W_tabs` | `[data-conversation-tabs]` | ui-conversation `ConversationSessionHeader`，同时有 `role="tablist"` |
| `.ST7X_W_tab` | `[data-conversation-tabs] [role="tab"]` | 同上 |
| `.ST7X_W_tabActive` | `[data-conversation-tabs] [role="tab"][aria-selected="true"]` | 同上；用于 `view-switch.ts` 的活动项量测 |
| `.ST7X_W_headerLeading` | `[data-conversation-header-leading]` | ui-conversation `ConversationHeader` |
| `.ST7X_W_headerCorner` | `[data-conversation-header-corner]` | ui-conversation `ConversationSessionHeader` |
| `._6Qf49G_rightbarCol` | `[data-rightbar-col]` | ui-layout `RightbarColumn` |
| `.jJkEga_projectRow` | `[data-row-key^="workspace:"]` | ui-workspace `WorkspaceRow`，还带 `role="treeitem"` 与 `aria-expanded` |
| `.jJkEga_sessionRow` | `[data-row-key^="session:"]` | ui-workspace `SessionRow`，还带 `role="treeitem"` 与 `aria-selected` |
| 会话行 `.jJkEga_selected` | `[data-row-key^="session:"][aria-selected="true"]` | 同上；不能据此判断 archived/menuOpen |

阶段状态也能减少根类名依赖：`ConversationMainPanel` 在 `.ST7X_W_root` 上写 `data-phase`，`ConversationContent` 在 `[data-conversation-content]` 上写同一份 `data-content-phase`。定位 hero 内部编辑器、宠物输入卡等目标时，可从 `[data-conversation-content][data-content-phase="hero"]` 开始。但两者不是同一盒子，不可把所有根元素的布局规则直接搬到 content 上；观察阶段的 MutationObserver 也需要订阅 `data-content-phase`。

## Slot 能做什么

官方 `ctx.slots.register/inject` 可以在声明的区域注册自有组件，组件使用插件自己的 class/属性，从而不依赖宿主组件哈希。已声明的扩展位置包含 `shell.overlay`、`conversation.session.header.utilities`、`conversation.input.model`、`conversation.input.permission` 等，详见 SDK 类型。

`[data-slot="..."]` 是有意提供的样式定位接缝：[官方源码](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-renderer/src/client/scoped-slots.tsx#L1059) 明确以 Anchor contract 描述稳定的 Slot 包装层；已安装构建也实际输出此属性。这个承诺描述包装层的存在与注册变化时的稳定性，不能扩展成所有插槽名称永远不变。

它不是任意现有 class 的等价替代。ui-renderer 的 `SlotOutlet` 和 `RootOutlet` 包装层使用 `{ display: "contents" }`，其盒子不参与布局。背景、尺寸、边框等规则不能盲目移到这个包装层上。定位子元素仍然引入结构依赖。

`sidebar` 是单占位 Slot。SDK 明确说明，替换它会替换整列，原占位组件声明的内部 seats 随生命周期消失。为了去除哈希而重写整个侧栏，会扩大业务维护范围，暂不采用。

## 仍有缺口的区域

- 侧栏品牌、导航条目、工作区/会话行的标题、时间、图标、菜单开启与归档状态。目前行身份和部分 ARIA 状态可用，内部细节仍依赖 class。
- Composer 的工具行、发送按钮、附件内部、workspaceTrigger 状态，以及部分模型/权限控件的内部元素。输入卡标记不会自动解决所有内部布局。
- Hero 的标题组、欢迎插画、工作区行，以及聊天正文内层滚动列、回到底部按钮、Markdown 内层等。
- 窗口左/中列等缺少独立标记的盒子。通过 Slot 后代关系可以定位部分元素，但这种结构适配应单独记录，不能宣称为稳定 API。

优先向宿主请求语义 `data-*` 或约定的 CSS parts，以及明确的状态值（例如 sidebar navigation、row title/time、composer tools/submit、hero headline、chat transcript/jump）。官方若发布动态的组件 class 映射，也能消除手工前缀表，但组件语义和版本兼容仍需约定。不要依靠本地化文字、SVG 路径或全局 `_root`/`_body` 后缀来猜目标。

## 实施顺序与验证

1. 先迁移上表同元素的输入区与会话标签栏：更新 `compat/host-dom.ts`、相应 CSS、`composer-placeholder.ts`、`view-switch.ts`。对阶段查询改用 content 标记时同时更新观察属性与宠物定位。保持宿主编辑器、按钮和事件处理。
2. 再迁移会话内容/滚动/输入席位、顶栏已有标记、右栏，以及侧栏行身份/选中状态。逐条检查作用域和 CSS 优先级；不能只做字符串替换。
3. 让兼容诊断描述仍缺失的具体区域。当前 `watchHostBuild` 通过 frame 哈希识别构建，日志和设置页笼统说样式不生效；迁移后应体现语义标记已命中的部分，避免把已支持功能报成全部不可用。未知构建仍保留余下哈希兼容表的诊断。
4. 每批迁移验证新会话/已发送/嵌入会话、浅深主题、切换 View、侧栏折叠和右栏开合；SDK/API 检查之外，检查真实 DOM 定位和视觉布局。增加有意义的验证：只改宿主 class 的哈希而保留属性，迁移部分仍能定位和工作。仅检查 CSS 字符串不足以证明视觉等价。
5. 检查 source 中某个前缀所有使用都已消失后，才从前缀表删掉该模块。替换一个 class 不意味着整模块已摆脱哈希。本轮无法据此承诺把 24 个模块缩减到特定数量。

主题颜色已经通过官方 `theme.overrideTokens` 下发，模型控件和宠物也已使用部分官方插槽；这一部分主要是继续使用已有方式，迁移重点在宿主布局的 class 选择器。完成迁移也不自动证明未来所有版本兼容，`package.json` 的宿主版本约束须随实际验证调整。

## 可复查的一手来源

- 本机 app.asar：`dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`（上述 Conversation/InputBar/DraftEditor/SessionHeader）。
- 同一归档：`dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js`（WorkspaceRow/SessionRow）。
- 同一归档：`dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js`（AppFrame/RightbarColumn）。
- 同一归档：`dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js`（SlotOutlet/RootOutlet/ANCHOR_STYLE）。
- 安装的 SDK：`node_modules/@deepseek-ai/dsh-client-ui-theme/README.zh.md` 与 `lib/types/client/index.d.ts`（ThemeRuntime，包含 token override 的 light/dark 模式与 disposer）。
- 安装的 SDK：`node_modules/@deepseek-ai/dsh-client-ui-layout/lib/types/client/index.d.ts`（sidebar 替换的边界与 shell.overlay）。
- 安装的 SDK：`node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts`（SlotMap、Factory 和 owner props）。

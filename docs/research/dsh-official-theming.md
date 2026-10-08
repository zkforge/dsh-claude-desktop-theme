# DSH 官方主题扩展面调查

核查日期：2026-10-04。官方源码固定到公开仓库提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`（2026-10-03）。这份笔记回答官方契约是否存在；已安装 DSH Desktop `0.2.0-rc.2` 的实际 DOM 对应与迁移范围另见 [迁移矩阵](stable-host-hooks-migration.md)。公开仓库无法解析安装包记录的短提交 `5e9e301d`，因此不能把以下最新源码直接当成安装包源码。

## 已证实的官方扩展面

| 扩展面 | 官方证据 | 对本插件的意义 |
| --- | --- | --- |
| 主题 token 服务 | `ui-theme` README 明确允许第三方通过 `ctx.theme` 覆盖 alias token；导出类型 `ThemeTokenOverrides` 和方法 `overrideTokens(source, tokens)`，每个 token 提供 `{ light, dark }`，返回撤销函数。见 [README](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-theme/README.md)、[服务源码](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-theme/src/client/index.ts)。 | 颜色和已有字体、阴影等变量优先走主题变量，避免定位每个宿主组件。项目已经使用这个接口。 |
| UI Slots 注册 API | `ui-slots` README 要求客户端插件通过插槽组合 UI，支持 single/list/keyed/chain；官方 slots 文档公开声明、注册、替换规则和会话顶栏、模型控件等层级。见 [包文档](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-slots/README.md)、[Slots 文档](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/subsystems/slots.md)。 | 自己的控件和可替换区域应使用 slots，并由插件自己的 class/data 属性承载样式。避免复制宿主内部组件。 |
| `[data-slot="<key>"]` 样式锚点 | renderer 源码明确称其为 `Anchor contract`，每个 slot 渲染位置暴露稳定的 `data-slot` 包装，供动态样式定位；并明确设置 `display: contents`。见 [源码 L1059–1089](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-renderer/src/client/scoped-slots.tsx#L1059)。 | 这是官方有意提供的样式定位接缝，比猜哈希 class 强。适合限定作用域或定位其实际子元素；包装自身不产生盒子，不能把带盒子的宿主 class 直接全部替成它。 |

官方 [Web styling](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/web-styling.md) 同时说明：主题包拥有共享语义变量，组件旁的 CSS Modules 拥有组件样式；公共样式契约变更应更新所属包文档。这支持优先采用主题服务和已有公共变量，不支持把全部内部 class 当成主题 API。

## 语义 DOM 属性：存在，但承诺强度不同

官方源码确实生成一些不带构建哈希的语义属性：

- `data-composer-card`、`data-composer-dock`：见 [InputBar](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx)。
- `data-input-scroll`、`data-composer-placeholder`：见 [DraftEditor](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-conversation/src/client/input/editor/DraftEditor.tsx)。
- `data-conversation-content`、`data-conversation-scroll`、`data-composer-seat`、`data-content-phase`：见 [ConversationContent](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx)。

这些属性可消除相应选择器对构建哈希的依赖。**本次未找到这些属性组成完整、公开、永久兼容的第三方主题 DOM API 的说明**。它们不能自动获得 `data-slot` 源码所明确写出的锚点契约，也不能保证将来组件重构仍保留相同元素、嵌套或状态值。迁移时应核查当前安装产物的同元素对应，且把仍需结构推断的选择器留在兼容层。

## 官方稳定性说明的边界

[packages README 的 Release expectations](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/README.md#release-expectations) 把多数包组定位为 product / stable API，`client` 位于该范围；这是优先使用公开服务和 slots 的依据。

但是 [仓库总 README](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/README.md#developer-preview) 又明确说明开发者预览期会出现兼容性破坏；[官方产品页](https://www.deepseek.com/harness/) 也说明核心插件和基础 API 持续迭代。因此不能把 stable API 的定位解释成当前预览版本之间绝不改接口，更不能外推为全部 DOM 属性和插槽名称永久不变。本次未发现主题 DOM 专项的版本兼容矩阵或明确的弃用保留期承诺。

## 迁移建议

1. 共享外观继续通过 `ctx.theme.overrideTokens` 与官方已有语义变量表达。
2. 插件拥有的 UI 继续通过公开 slots 注册，并使用自己的样式标记。
3. 宿主布局覆盖先把可证明同元素对应的哈希 class 换成已有语义属性；用 `data-slot` 限定作用域时保留实际盒子边界。
4. 缺少等价标记的少量覆盖保留集中兼容表。要完全摆脱内部 DOM，需官方补齐带文档的主题 hooks 或组件 presentation props；“匹配 class 后缀”并不能提供这样的契约。

可达到的结果是减少构建哈希引起的重复维护；仍需在宿主结构或公开 API 变更时验证兼容性。

# 16 · 上方栏：删除「选择打开方式」按钮、右侧图标改黑、三点图标改竖排

| 项 | 内容 |
| --- | --- |
| 分类 | 功能调整 + 样式 |
| 优先级 | P2 |
| 截图 | 待补（请放入 `docs/issues/img/16-*.png`，2x 截图） |
| 涉及代码 | `src/client/features/conversation/header-actions/**`（含 `header-actions.css`）、`src/client/compat/open-target.ts`、`src/client/theme/tokens.css`、必要时 `src/client/features/conversation/conversation.css` |
| 关联锚点 | `host-dom.ts:80` `conversationHeader`、`:83` `headerCorner`、`:84-87` `openTargetAnchor`(`.iq4beG_menuAnchor`) / `openTargetSplit`(`.iq4beG_split`) |

## 问题

1. 上方栏（会话头部）的**「选择打开方式」按钮**（宿主 `ui-open-in-app` 的 OpenTarget 分体框）要**删掉**——功能后续会放到别处。
2. 上方栏**右侧的图标目前是浅灰**，观感偏弱，需要改成黑色。
3. 右上角的**「三个点」图标是横排三点**，需要改成**竖排三点**。

## 目标

1. 上方栏不再出现「选择打开方式」按钮。**已确认：它是该组按钮里的第一个**，删掉后其余按钮自然排布即可，不需要额外的位移/留白补偿（只需确认组内 `gap` 与容器 `padding` 不因此多出空洞）。
2. 上方栏右侧所有图标改为**高对比深色**：**浅色主题纯黑**，深色主题取同族**高对比亮色**（两套值都进 `tokens.css`，深色下不得使用纯黑，否则图标不可见）。
3. 「三个点」图标改为竖直排列；点击热区、打开菜单的行为不变。

## 验收标准

1. 会话头部（含普通会话与空会话态）均不再出现 OpenTarget 按钮/分体框（`iq4beG_menuAnchor`、`iq4beG_split` 对应的可见元素），原本由它占据的宽度被右侧组吸收，不出现空洞。
2. 该控件被移除后：`open-in-app` 的其它入口（如会话 ⋯ 菜单里的项，若存在）**不受影响**；插件自己新增的头部按钮（header-actions 的视图按钮）**不得被一起隐藏**。
3. 上方栏右侧图标在浅色主题为纯黑（`#000`）、深色主题为高对比亮色；hover、键盘 focus、active、禁用态仍然可分辨（不能出现「黑底黑图标」或「亮底亮图标」导致消失）。
4. 「三个点」为竖排，视觉居中、与相邻图标的基线与热区一致；hover/focus 时不变形、不位移。
5. 窄宽度（窗口最窄）下头部不溢出、不换行、按钮不重叠。
6. `npm run check` 通过。

## 落地提示

- 先确认「选择打开方式」当前是**宿主渲染**还是被插件接管：插件已有 `compat/open-target.ts`（`mountOpenTargetMode`，在 `apply.ts:121` 挂载），它只改模式与文案，未隐藏按钮；隐藏请按 `host-dom.ts` 已登记的 `openTargetAnchor` / `openTargetSplit` 收窄作用域，只作用于会话头部这一处。
- 「三个点」要先确认命中对象：它可能在宿主的 `headerCorner` 座位，也可能是插件 `header-actions` 里的按钮——两者的选择器完全不同，不要猜。若是 SVG artwork，优先用 `mask` + `--ccd-icon-*` 令牌重绘竖直三点；若只是旋转，注意 `prefers-reduced-motion`。
- 颜色 token 进 `tokens.css`（浅/深各一套，`theme-tokens` 测试要求每个浅色声明都有深色对应）；业务样式不写字面色值。
- 隐藏一个宿主按钮时，优先 `display: none` 并检查其容器是否仍有 `gap`/`padding` 留白；不要把整条头部收窄。
- **已确认**：浅色主题 `#000`，深色主题同族高对比亮色（避免深色下黑图标不可见）。
- **待确认（实施前请在报告里明确你的取舍）**：「三个点」是旋转现有图形还是按竖排重绘（前者更稳、后者更贴宿主风格）。

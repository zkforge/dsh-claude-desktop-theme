# 计划：插件控件自渲染 + 统一 Tooltip

## 一、这份计划解决什么

两件事，一件是根上的，一件是面子上的。

**根上的：把「贴宿主 DOM」改成「自己渲染」。** DSH 每次更新会重新哈希 CSS Module 类名，插件现在有 12 个图形是「盖在宿主按钮上」的（`mask` + `--ccd-icon-*`），靠 `._7514NG_` 这类类名找到宿主元素。类名一变就失效，必须跑 `scripts/host-prefixes.mjs` 重读前缀表。这个代价要一次性去掉。

**面子上的：把 tooltip 统一成 CCD 的样子。** 截图里那条黑底胶囊（`Terminal ⌘J`）是目标形态。现在插件自己的按钮用的是浏览器原生 `title=`，样子是系统的、不可控、和 CCD 不像。

工作方向（已定）：**凡是插件要的控件，插件自己画。宿主 DOM 只用来量位置、读状态，不再往上盖东西。**

## 二、现状：宿主依赖清点

### 2.1 现在的三种图形来源

| 来源 | 数量 | 位置 | 宿主升级会坏吗 |
| --- | --- | --- | --- |
| 宿主图形 mask（贴上去） | 12 | `theme/tokens.css` `--ccd-icon-*` | **会**。类名变了就失效 |
| 插件自绘（内联 SVG） | ~5 | `settings/fields.tsx`、`model-controls/EffortPanel.tsx`、`composer-pet/Whale.tsx` | 不会 |
| 宿主图形按 path 匹配 | 2 | `sidebar.css:234`、`composer.css:652` | 不会（`d=` 不参与哈希） |

**关键认识：真正会坏的只有第一类。** 而且它坏的原因不是「图形数据变了」，是「找不到宿主那个元素了」——图形数据写死在 tokens.css 里，一直没变。

### 2.2 12 个宿主 mask 逐个清点

| token | 盖在谁身上 | 性质 | 结论 |
| --- | --- | --- | --- |
| `--ccd-icon-plus` | 工作区「新建」按钮、项目行「+」 | 宿主按钮，功能简单 | 自渲染 |
| `--ccd-icon-more` | 会话 ⋯ 菜单按钮 | 宿主按钮 + 宿主菜单 | 自渲染按钮，菜单仍调宿主服务 |
| `--ccd-icon-archive` | 归档会话行的空槽 | 宿主**故意留空的格子** | 保留 mask（下面详述） |
| `--ccd-icon-session-ring` | 会话行状态槽 | 宿主空槽 | 保留 mask |
| `--ccd-icon-chevron-right` | 项目行折叠箭头 | 宿主**状态驱动**（`arrowOpen` 转 90°） | 保留 mask，或自渲染并自持状态 |
| `--ccd-icon-send` / `-stop` | 发送/停止按钮 | 宿主按钮 + 复杂交互 | **保留 mask**（见 2.3） |
| `--ccd-icon-folder` | 工作区 chip、头部文件夹按钮 | 头部那个已自渲染；chip 是宿主的 | chip 部分保留或自渲染 |
| `--ccd-icon-open` / `-terminal` / `-browser` | `open-in-app` 控件、右栏 tab 标题 | open-in-app **已隐藏**；terminal/browser 头部按钮**已自渲染** | 删除 `-open`；确认另两个是否还有消费者 |
| `--ccd-icon-context-ring` | 空会话上下文环 | 宿主空态 | 保留 mask |

### 2.3 不是所有宿主图形都该自渲染

**结论：自渲染适用于「插件自己发起的动作」，不适用于「替换宿主控件的内核」。**

反例是 `--ccd-icon-stop`：那个停止按钮背后是宿主的流式中断逻辑、`aria-label` 切换、「按 Escape 也停」的键盘联动。把它掏空换成自己的按钮，等于把流式控制重新实现一遍——风险远大于收益。这类保留 mask，但**用 path 匹配（2.1 的第三类）替掉类名匹配**，一样不受升级影响。

判断标准：

- **插件新加的功能** → 自渲染（文件夹/终端/浏览器三个按钮已经是了）
- **替换宿主已有控件的图形** → 保留 mask，但匹配方式从「类名」换成「图形本体 `d`」

## 三、Tooltip 方案

### 3.1 目标形态（量自截图）

| 项 | 值 | 说明 |
| --- | --- | --- |
| 底色 | `#2b2b2b` 左右的深灰 | 比纯黑浅一档；深浅主题下都应该是深底浅字 |
| 字色 | `#f5f5f5` 左右 | |
| 圆角 | 8px | 截图上是明显的圆角，不是胶囊 |
| 内边距 | 上下 ~6px、左右 ~10px | |
| 字号 / 字重 | 13px / 500 | 与 plugin 的 `--ccd-font-size-muted` 同档 |
| 快捷键 | 标签右侧、间距 ~14px、颜色比标签淡 | 截图里 `⌘ J` 明显比 `Terminal` 弱 |
| 与锚点距离 | ~8px | |
| 位置 | 锚点下方居中 | 截图是下方 |
| 出现延迟 | ~500ms | 避免指针扫过时闪 |
| 消失 | 立即 | |

截图里那个 `Terminal` 的高亮态是「指针悬停的按钮有浅灰填充」——**这与 tooltip 无关**，是按钮自己的 hover，已经在 `header-actions.css` 里实现了。

### 3.2 落地方式

新建 `src/client/theme/tooltip.tsx`（theme 层，feature 可依赖；与 `icons.tsx` 同层）：

- 一个 `<Tooltip>` 组件 + 一个 `useTooltip` hook
- 挂载到 `document.body` 末端的**单例浮层**，全局只有一个，避免每个按钮一个 DOM
- `role="tooltip"`，锚点用 `aria-describedby` 关联（**注意**：`aria-label` 仍然要保留，标签是功能名，tooltip 只是视觉重复）
- 位置计算复用 `statistics/card.ts` 里已有的那套「量锚点、算 left/top、避免出窗」逻辑——那段代码已经写好且经过验证，抽成共享函数而不是重写
- 键盘 focus 也要显示（`focus-visible`），不只是 hover
- `prefers-reduced-motion` 下不做淡入

### 3.3 需要改的现有控件

| 控件 | 现在 | 改成 |
| --- | --- | --- |
| `HeaderActionButton.tsx:34` | `title={label}` | `<Tooltip>`，内容为标签（这三个按钮**没有快捷键**，tooltip 只有文字） |
| `settings/fields.tsx:170` | `title={option.label}` | 保留 `title`（主题三选一是设置页内部小控件，用原生 tooltip 更轻），或统一改 |
| 会话 ⋯ 按钮 | 宿主的 tooltip | 宿主自带的，**不动**（见 §2.3 同款理由） |

## 四、实施顺序

分四步，每步都能独立验证、独立回滚。

### 第 1 步：建 `theme/icons.tsx`（纯新增，零风险）

把现有的自绘图形收进来，定义统一的 `Icon` 原语，规格照 DESIGN.md §2.1：

- 母版 16 格、线宽 1；20 格、线宽 1.2
- `fill:none`、`stroke:currentColor`、`linecap/linejoin:round`
- `aria-hidden="true"`

搬进去的：`Chevron`、`ThemeGlyph`(system/light/dark)、`EffortPanel` 的信息圈。**此时不改调用方**，先让新模块存在。

### 第 2 步：建 `theme/tooltip.tsx` + 抽公共定位函数

- 从 `statistics/card.ts` 抽出定位逻辑到 `theme/tooltip.tsx`（card.ts 改为调用它，行为不变）
- 实现 `<Tooltip>` 单例浮层
- 样式进 `theme/tooltip.css`

**验证点：** 统计卡的 tooltip 行为与改动前完全一致（有测试最好，没有就截图对比）。

### 第 3 步：把两个自渲染按钮接上 Tooltip

- `HeaderActionButton` 去掉 `title=`，改用 `<Tooltip>`
- `settings/fields.tsx` 的主题按钮按 §3.3 决定

**验证点：** 悬停 / 键盘 focus 都能出 tooltip，样子与截图一致；`aria-label` 仍在（读屏行为不变）。

### 第 4 步：宿主 mask 的十二条规则逐条收敛

这是最大的一步，建议**一条一条改、一条一条验**，不要一次全推：

1. 先用 `grep` 确认每个 token 还有没有消费者（`-open` 很可能已经没人用了，直接删）
2. 分类：
   - 「插件新动作」→ 改自渲染，删掉对应的宿主选择器
   - 「替换宿主控件图形」→ 匹配方式从类名改成 `:has(> svg > path[d^="…"])`
   - 「宿主空槽 / 空态」→ **保持 mask 不动**（`-archive`、`-session-ring`、`-context-ring`）
3. 每改完一条，删掉 `host-builds.ts` 里**确认不再需要**的前缀项

### 第 5 步（收尾）：评估 `host-builds.ts` 能瘦多少

全部改完之后，重新看 `host-builds.ts` 里那 23 个前缀还有几个是活的。目标是：**这个文件能缩到只剩「量尺寸、读状态」需要的那几个，或者干脆不需要。**

如果能全部去掉，`scripts/host-prefixes.mjs` 就可以退役了——这正是这次改动的最终目的。

## 五、风险与对策

| 风险 | 对策 |
| --- | --- |
| 自渲染按钮丢了无障碍 | 每个按钮保留 `aria-label`；tooltip 用 `aria-describedby` 关联；键盘 focus 可见 |
| 自渲染按钮丢了键盘行为 | 用真 `<button>`，不 div + onClick；Enter/Space 天然可用 |
| `d^=` path 匹配在宿主改图形后失效 | 加兜底：认不出来就 `display:none` 贴纸，让宿主原图显示，不出现空白框 |
| 定位逻辑抽取改坏统计卡 | 第 2 步单独做、单独验，先保证行为不变再谈复用 |
| 一次性改 12 条出连锁问题 | 拆成 12 次独立改动，每次 `npm run check` 通过才继续 |

## 六、需要你确认的取舍

1. **`--ccd-icon-chevron-right`（项目行折叠箭头）**：保留 mask（宿主类名一变就坏）还是自渲染（要自己接 `arrowOpen` 状态）？
2. **发送 / 停止按钮**：我在 §2.3 建议保留 mask（交互太复杂），但你如果想要彻底，我可以评估自渲染的代价。
3. **设置页的主题三选一 tooltip**：跟头部按钮统一用自绘 tooltip，还是保持原生 `title`（更轻）？

## 七、不做什么

- 不动宠物鲸鱼（`composer-pet`）——它已经是自绘的，跟这件事无关
- 不动宿主自己的菜单、Popover、上下文环的**逻辑**，只可能换图形
- 不引入图标库依赖除非你决定要（Tabler 是推荐，但 `icons.tsx` 自绘先跑通再说）

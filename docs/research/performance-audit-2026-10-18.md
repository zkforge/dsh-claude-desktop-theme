# 卡顿与长时使用性能审计（2026-10-18）

> 现象：插件使用时间越长、会话越多、历史越长，界面越卡、输入/拖动不跟手。
> 审计基线：`c8caf4c`（0.4.3）。本文是**源码审计 + 最小替身验证**的结果；
> 没有在真实 DSH 窗口上做 Performance/Heap 采样，因此文中把「代码可确认的行为」
> 与「预计影响、需实机量化」严格分开。不要用本文的复杂度推断直接宣称某个
> 毫秒数值。

## 0. 结论摘要

卡顿不是单一泄漏，而是三类问题叠加：

1. **随挂载次数累积**（配置切换、页面/会话重建触发重挂载）：
   - `scroll-pill` 的匿名 `scroll` 监听器在释放时不解绑；**已用最小替身复现**
     每次挂载→释放后监听器仍活跃，重复 N 次则每次滚动执行 N 份工作。
   - `view-switch` 的属性备份 `Map` 以 DOM 节点为强 key，会话/视图重建后旧
     tablist 节点不会被移除，直到整个模块释放。
2. **随历史规模放大**（不是泄漏，但越用越慢）：
   - 对话过程自动展开：每次 DOM 变更都扫描**全部**已加载轮次的过程按钮，
     即使它们全部已展开。已做调用计数：100 批通知下，100/1000/5000 个按钮
     分别产生 1 万/10 万/50 万次属性读取，且无任何状态变化。
   - 空分组、状态分组、统计读数、宠物锚点等模块用**全 body 观察器 + 全量
     扫描/布局读取**响应无关的 DOM 变化；成本随历史会话、工作区、可见行数
     和终端/文件数增长。
   - 宿主侧 `ccdContext` 在每条 committed surface 事件上复制整个节点数组，
     并对全部节点做多次归并/求和，单会话累计 O(N²)；统计服务在冷启动时每完成
     一个会话就全量重聚合，约 O(S²)。
3. **持续的主线程占用**（固定成本，但直接表现为「不跟手」）：
   - 新会话页的大面积 Canvas ASCII 波纹与标题栏 Canvas 常驻重绘（约 24fps），
     与输入、拖动共享主线程。
   - 打开 effort 面板拖动时，全 body `style` 观察器被滑块自身的逐帧样式写入
     唤醒，每次都同步读取布局；ultra 像素场每个显示帧也读一次几何。
   - 打开的上下文面板在任意会话列表更新时重建数据、重新挂载两个布局 effect
     并同步测量。

**建议顺序**：先修 1（确定性、改动小、直接消除累积），再修 3 中的热路径
（交互跟手），最后处理 2 的规模放大（需要删/改架构，收益最大但风险也最高）。

---

## 1. 已确认问题（有代码证据 / 已复现）

### P0-1 滚动条胶囊监听器泄漏（`scroll-pill`）

- 位置：[scroll-pill.ts:190](../../src/client/compat/scroll-pill.ts)（`adopt`）、
  [scroll-pill.ts:209](../../src/client/compat/scroll-pill.ts)（`release`）、
  [scroll-pill.ts:252](../../src/client/compat/scroll-pill.ts)（disposer）。
- 行为：`adopt` 用匿名箭头函数 `surface.addEventListener('scroll', …)` 注册；
  `release` 只清 timer、surface 标记、pill 节点和 Map，**没有
  `removeEventListener`**；disposer 走同一个 `release`。
- 放大链：
  1. 插件配置变化（`apply.ts:93-106`）会 `active.dispose()` 后整组重挂载；
  2. `sync`（[:216](../../src/client/compat/scroll-pill.ts)）在 surface 从
     `isConnected=false` 变为重新连接后，会用新闭包再次 `adopt` 同一个宿主
     scroller；
  3. 旧监听器仍持有旧 `pill`/`surface`/`element`，每次滚动执行旧 `place`
     （读 `clientHeight`/`scrollHeight`/rect、写已移除的节点）和旧 `awaken`
     （再起一个 `setTimeout`）。
- 复现（本轮实际执行，Node 最小替身，非浏览器耗时测试）：用同一个
  `EventTarget` 作为 scroller，mount→release 1/2/3 次后派发一次 `scroll`，
  `clientHeight` 读取次数与新 timer 数均为 1/2/3。
- 现有覆盖缺口：[scroll-pill-browser.test.mjs:266](../../tests/scroll-pill-browser.test.mjs)
  只验证节点/标记移除，不验证释放后事件。
- 修复：
  - `Pill` 保存具名 handler（或每 surface 一个 `AbortController`），`release`
    精确 `removeEventListener`；
  - `release` 同时 `clearTimeout`（已有）并确保 `pills.delete`；
  - 增加回归测试：「release 后派发 scroll，零工作」「同 surface 多次
    mount/dispose 后只有一个活动监听器」。
- 预计收益：消除每次滚动 × 重挂载次数的同步布局读取和定时器。该问题在用户
  频繁调整主题/设置、或页面阶段反复切换时最明显。

### P0-2 `view-switch` 强引用已脱离的 tablist 节点

- 位置：[view-switch.ts:91-106](../../src/client/compat/view-switch.ts)
  （`attributes` Map）、[:110-129](../../src/client/compat/view-switch.ts)
  （`decorate` 只清 `glyphs`）、[:218-226](../../src/client/compat/view-switch.ts)
  （仅 `restore` 清 Map）。
- 行为：每个被改写属性的 tab 都进入 `Map<Element, …>`；`decorate` 每轮清理
  `glyphs`，但不清理 `attributes`；tablist 被 React 替换时只重置
  `tabs`/`selected`。旧 tab 及其仍连接的子树因此被模块闭包强持有。
- 放大链：切换会话 / 视图重建 tablist → 新两个 tab 入 Map，旧节点永久保留
  （本次 mount 内）；会话切换越多，保留的脱离子树越多。
- 边界：该 Map 在整次 activation 结束时清空，所以不是跨插件禁用/启用的永久
  泄漏；但一次长会话运行中的累积是确定的。
- 修复：每轮 `decorate` 后恢复并删除 `!element.isConnected` 的记录；或按
  tablist 分段保存记录，tablist 替换时整段恢复并释放。
- 验证：连续切换 N 个会话后检查 Map 大小与 heap snapshot 中 detached
  `[data-...]` tab 节点数。

### P1-1 对话过程展开的全量扫描

- 位置：[conversation-process.ts:37-46](../../src/client/compat/conversation-process.ts)
  （全 body 观察器）、[:13-35](../../src/client/compat/conversation-process.ts)
  （`sync` 全量 `querySelectorAll`）。
- 行为：观察 `childList` + `attributes`（`aria-expanded`、`disabled`）；每个
  批次执行一次全文档查询，并读取每个按钮的 `disabled`/`aria-expanded`，即使
  全部已是展开态。它没有「只看新增节点/只处理变化记录」的过滤。
- 调用计数（本轮实际执行，Node 替身）：100 批通知、按钮全部
  `aria-expanded="true"` 时：
  | 过程按钮数 | 文档查询 | 属性读取 |
  | --- | --- | --- |
  | 100 | 100 | 10,000 |
  | 1,000 | 100 | 100,000 |
  | 5,000 | 100 | 500,000 |
  这是调用量证据，不是耗时测量；实际开销还取决于选择器匹配和布局稳定性。
- 放大链：自动展开让长会话里**所有已加载轮次**的过程区都保持展开，DOM 规模
  大；此后流式输出、工具更新、其他插件的结构写入都会触发批次 → 全量扫描。
  长会话比短会话更慢，符合「越用越卡」。
- 修复（按收益排序）：
  1. **只处理变更记录**：观察器回调接收 `records`，仅对
     `addedNodes` 内的 `[data-turn-process]`/`[data-step-process]` 以及
     `aria-expanded` 变成 `false` 的节点处理；
  2. 维护一个「待展开集合」，用 `WeakSet`/属性标记已处理节点，避免重复扫描；
  3. 将观察范围收窄到对话转录容器（若宿主有稳定锚点），而不是 `body`；
  4. 若必须全量兜底，至少在 `pending` 之外加 rAF/空闲调度并跳过用户正在
     滚动的旧轮次。
- 注意：不能只删观察器——宿主会在流式完成、历史加载和会话切换时折叠过程区，
  需要这些信号。改为增量处理即可。

### P1-2 其他「全 body 观察 + 全量计算」热路径

以下均为代码可确认的执行路径；具体毫秒需实机 trace。共同修法是：**收窄观察
目标 / 按 mutation records 过滤 / 读写分帧**。

| 模块 | 位置 | 每轮做的事 | 规模因子 |
| --- | --- | --- | --- |
| 空分组 | [empty-groups.ts:128-164](../../src/client/compat/empty-groups.ts)、[:178-184](../../src/client/compat/empty-groups.ts) | 无条件 `hasHistory` + `populatedGroups`（新建多个 Set、展开全部 workspace.sessionIds）+ 查全部 workspace group/行 | 历史会话 S、工作区 W；嵌套模式有 O(W²) 路径比较 |
| 状态分组 | [status-groups.ts:71-186](../../src/client/compat/status-groups.ts) | `Object.values(catalog.byId)` 建父子索引；查全部可见行；**无条件对每行 `getBoundingClientRect`**；`[...owned].find` 每行一次 | 会话 S、可见行 R、子任务组 C（可达 O(R·C)） |
| 统计读数 | [stats-values.ts:54-103](../../src/client/compat/stats-values.ts)、[:127-133](../../src/client/compat/stats-values.ts) | 全 body `style/class/characterData`；即使 `readouts=false` 也做 Composer 宽度测量链（多次 rect + computedStyle） | Composer 子节点数、布局抖动频率 |
| 会话渐隐 | [conversation-fade.ts:77-110](../../src/client/compat/conversation-fade.ts) | 全 body `style/class/characterData`；读滚动尺寸与 Composer rect | 流式/滚动频率 |
| 宠物锚点 | [pet-anchor.ts:44-81](../../src/client/compat/pet-anchor.ts) | 全 body `childList/style/class/data-phase`；页面滚动捕获监听；每次同步 `querySelector` + hero 卡片 rect | 任意 DOM 变化；hero 时期持续布局读 |
| 统计卡片 | [statistics/mount.ts:71-118](../../src/client/features/statistics/mount.ts) | 全 body `childList`；每次 `sync` 无条件 `measure()`（offsetHeight + 写 style + rect） | 统计卡存在期间的所有结构变化 |
| 文件过滤 | [files-pane.ts:247-267](../../src/client/compat/files-pane.ts)、[:436](../../src/client/compat/files-pane.ts) | 有查询时，每轮全量扫描已加载文件行、向上找祖先、逐行写/删隐藏标记（无差异判断） | 已展开文件数 F、树深 |
| 模型/effort 弹窗 | [model-controls/popup.ts:17-41](../../src/client/features/model-controls/popup.ts) | 全 body 所有 `style` 变化立即 `place()`（两个 rect） | 拖动/动画期间的样式写入频率 |

补充边界：
- 这些模块大多有用等值比较或自身标记排除，**没有发现无条件无限自激**；
  问题在于「无关变化也被放大」。
- `getBoundingClientRect` 只有在布局脏时才会同步刷新；逐项读取不等于逐次强制
  layout。上面的成本描述是上界式放大路径，需用 Performance 面板确认。
- `pet-anchor` 在整个功能生命周期常驻（[composer-pet/mount.ts:27-32](../../src/client/features/composer-pet/mount.ts)），
  非 hero 时期仍会响应全页变化；建议在非 hero 时直接断开观察器，进入 hero
  时再挂载。

### P1-3 上下文分解投影的 O(N²) 与无变化发布

- 位置：[host/context/unit.ts:226-246](../../src/host/context/unit.ts)、
  [:250-287](../../src/host/context/unit.ts)、[:349-362](../../src/host/context/unit.ts)。
- 行为：
  - 每条 surface 事件都 `{ ...state, nodes: [...state.nodes, node] }`，复制
    整个节点数组；N 条 append 累计 O(N²) 时间/分配。
  - `viewContext` 每次对全部节点做两次 `mergeEntries` + 两次 `sumKind`。
  - WeakMap 只对同一 `state` 命中；每次 append 都是新 state，所以即使可见的
    files/skills/工具/阈值都没变，也会生成新视图对象并发布。
- 放大链（SDK 已核对）：宿主在每条 committed event 上同步执行投影并广播
  `projectionsBySession` 替换帧（`dsh-session-projection` 与
  `dsh-api-session-controller`）。长会话每条上下文事件都会付这份成本。
- 现有防护：`CONTEXT_ENTRY_LIMIT=200` 只裁剪最终条目，不限制 `nodes` 本身；
  compaction 会缩短 `nodes`。
- 修复：
  1. 普通 append 不为重建数组而复制——可用分块/追加日志结构，或至少在
     state 内维护 `nodes` 的可变副本并返回新 state 引用（注意 SDK 靠引用变化
     驱动发布，不能原地改后返回同一引用）；
  2. 分类 totals/entries 增量维护（append 时累加，compaction 时重算受影响
     段），`viewContext` 直接读汇总；
  3. 视图缓存按语义字段（files/skills/totals/工具签名/阈值）比较，未变时复用
     上一份 wire view；
  4. 只为 `surfaceOp` 替换维护紧凑索引（seq → 位置），避免 `findIndex` 全扫。

### P2-1 统计冷启动 O(S²) 重聚合

- 位置：[host/stats/service.ts:171-193](../../src/host/stats/service.ts)、
  [:230-236](../../src/host/stats/service.ts)、
  [host/stats/aggregate.ts:76-197](../../src/host/stats/aggregate.ts)。
- 行为：`enqueue` 用 `queued.some` 去重（线性），`shift` 出队；**每个
  `fold.finally` 都 `publish()`**，而 `publish` 从全部 `values` 重新
  `aggregateUsage`（重建每会话日期 Set、三范围、排序）。S 个冷会话依次完成
  时累计 O(S² × 每会话摘要大小)。
- 修复：队列改用 ID `Set` + 游标；冷 fold 只更新 values/dirty 标记，按短时间
  窗口（例如 100–250ms）合并 publish，或在下一 GET 时聚合一次；规模更大时
  维护增量全时汇总 + 有界近期桶。
- 验证：注入 100/500/1000 个无 checkpoint 的小会话，记录
  `aggregateUsage` 调用数、总耗时与事件循环延迟；当前应约为 S+请求数 次。

### P2-2 统计轮询不随可见性暂停，且每次重建整卡

- 位置：[features/statistics/index.ts:16-20](../../src/client/features/statistics/index.ts)、
  [source.ts:91-137](../../src/client/features/statistics/source.ts)、
  [mount.ts:78-118](../../src/client/features/statistics/mount.ts)。
- 行为：
  - 功能挂载即开始 fetch；不可用 600ms、pending 2s、完成 30s 轮询；没有
    `document.hidden` 或 hero 可见性判断；离开 hero 只移除卡片，不暂停 source。
  - 每次成功轮询都 `publish` 新对象；`mount.ts` 按 snapshot 引用变化
    `remove()` + `createStatsCard()` 重建整卡；Models 视图会重建全部图柱/
    legend；卡片存在时全 body `childList` 观察器每次 `sync` 都 `measure()`。
  - Host 每个 GET 都重新 `listSessions`（克隆+排序所有 header）并
    `JSON.stringify` 整个 snapshot，没有 dirty/TTL 缓存。
- 修复：
  - 客户端：hero 不可见 / `document.hidden` 时暂停或降到分钟级；恢复时立即
    刷新；snapshot 语义相同（排除 `computedAt`）时复用卡片，只更新进度；
    `sync` 合并到 rAF 并过滤相关节点。
  - Host：缓存已算 snapshot，按 session 变更、跨日、冷 fold 进度置 dirty；
    对近邻 GET 复用结果。

---

## 2. 持续主线程占用（交互「不跟手」的直接来源）

### P1-4 新会话页 Canvas 常驻重绘

- 位置：[hero-canvas.ts:37-51](../../src/client/compat/hero-canvas.ts)、
  [new-session/ripples.ts:123-156](../../src/client/features/new-session/ripples.ts)、
  [new-session.css:74-96](../../src/client/features/new-session/new-session.css)。
- 行为：RAF 每个显示帧调度，只有 `draw` 按约 24fps 限流；每次 draw 主画布
  与标题栏画布各绘一遍；每帧 `getComputedStyle`、`clearRect`、新建
  `Float32Array`、重算噪声网格并逐字符 `fillText`。
- 影响：停留在新会话页时，输入框、侧栏拖动与动画共享主线程；这是固定负载，
  不随使用时间增长，但会放大其他卡顿的感知。
- 修复：
  - 缓存静态字形/颜色/网格，复用 `Float32Array` 与离屏 canvas；
  - 降低采样密度/帧率，或仅在窗口可见且输入空闲时绘制；
  - 输入聚焦/拖动期间暂停背景绘制，结束后恢复；
  - 保留 `prefers-reduced-motion`/hidden 的现有停止逻辑。

### P1-5 effort 拖动与弹窗定位的写读循环

- 位置：[model-controls/popup.ts:40-43](../../src/client/features/model-controls/popup.ts)、
  [EffortPanel.tsx:49-65](../../src/client/features/model-controls/EffortPanel.tsx)、
  [:142-155](../../src/client/features/model-controls/EffortPanel.tsx)。
- 行为：
  - 拖动滑块每次 `onChange` 写 `--effort-progress` 内联样式；弹窗的
    `MutationObserver` 观察 body 所有 `style` 变化，立即 `place()`，读取
    trigger 与 surface 两个 rect——即使位置没有变化。
  - ultra 像素场在每个显示帧 `getBoundingClientRect` + DPR，绘制才限 33ms；
    120Hz 屏上每秒 120 次读数。
- 修复：
  - `place` 合并到 rAF，并用 records 过滤（只关心 trigger/anchor 或祖先尺寸
    相关变化）；位置比较已在 `setPosition` 内做，可进一步跳过布局读；
  - 尺寸通过 `ResizeObserver` 缓存，`place` 只读缓存值；
  - 像素场每帧读几何改为 ResizeObserver 触发时更新尺寸。

### P1-6 上下文面板在无关会话更新时重建

- 位置：[context-panel.ts:245-249](../../src/client/compat/context-panel.ts)、
  [:101-175](../../src/client/compat/context-panel.ts)、
  [ContextPanel.tsx:146-193](../../src/client/features/context-panel/ContextPanel.tsx)。
- 行为：`projections.subscribe` 只要面板打开就 `refresh()`，无论更新属于哪个
  session；`refresh` 生成新 `breakdown` 对象 → React 重渲染 → 两个布局 effect
  因 `breakdown` 依赖变化而 cleanup/重建：隐藏并重新 `showPopover`、两次 rect
  测量、重建两个 observer 与 resize 监听；分段条 effect 同样重建。
- 修复：
  - 订阅回调比较当前 session id 与相关投影引用，未变则跳过；
  - 缓存解析结果，`breakdown` 内容相等时复用引用；
  - 定位 effect 依赖改为 `[open, anchor]`，内容尺寸交给已有 ResizeObserver；
  - 分段条 effect 只依赖 `open` 与必要数值。

---

## 3. 状态增长（低优先级，需长时间运行观察）

| 位置 | 状态 | 淘汰情况 | 说明 |
| --- | --- | --- | --- |
| [right-panes.ts:91-113](../../src/client/compat/right-panes.ts)、[:399-421](../../src/client/compat/right-panes.ts) | `sessions` / `floated` / `asked` | 无 session 级删除 | 只存小状态与 tab id；整次 activation 结束可被 GC |
| [files-pane.ts:176-179](../../src/client/compat/files-pane.ts)、[:273](../../src/client/compat/files-pane.ts) | `preferences`（query/hidden） | 无删除 | 同上 |
| [host/stats/unit.ts:49-66](../../src/host/stats/unit.ts)、[:110-158](../../src/host/stats/unit.ts) | 每会话日期/模型桶 | 仅输出端 `STATS_DAY_LIMIT=366` 截断 | 长期库会增长；若需要 All 视图，应保留独立全时汇总 + 有界近期桶 |

这些**不直接保留整棵 DOM**，不应作为本次卡顿的主因；建议跟随 session 删除/
归档做清理，或设 LRU 上限。

---

## 4. 已排除 / 需要澄清的怀疑

- **不是**所有 `getBoundingClientRect` 都会强制同步布局；只有布局脏时才会。
- 全 body 观察器本身有浏览器侧过滤成本，但不是「每次 DOM 变化全树 CSS 扫描」
  的充分证据；`:has()` 有失效优化，需 Selector Stats 实测。
- 主要五个 COMpat 模块没有发现无条件持续自激的 MutationObserver 循环；多数
  写入有等值判断或自身标记排除。
- 动画/计时器本体（鲸鱼反应、hero、effort 弹簧）在卸载/隐藏/reduced-motion
  时清理完整；未发现打开次数导致的 RAF/定时器数组增长。
- 前端未发现把全部历史 `state` 永久保留的强引用；`context`/`stats` 的视图缓存
  是 WeakMap。
- 统计模块默认关闭；上述统计问题只有在用户开启后才会出现。

---

## 5. 优化方案与实施顺序

### 阶段 0：建立基线（0.5 天）

1. 在真实 DSH 窗口用 Performance 面板录制以下场景，记录主线程长任务、脚本
   时间、Layout/Recalculate Style、GC：
   - 新会话页静置 30s（hero 动画）；
   - 长会话（≥100 轮）滚动与流式输出；
   - 连续切换 10 个会话；
   - 打开 effort 拖动 5s；
   - 打开上下文面板期间在其他会话产生更新；
   - 反复改主题配置 10 次后滚动。
2. 用 Memory 面板做两次 heap snapshot（使用前后），比对 detached DOM、
   `MutationObserver`/listener 数量。
3. 记录 `/api/ccd-stats` 请求频率与 Host 侧单次耗时（可在 debug 日志中加临时
   计时，验证后移除）。
4. 建立可重复的基准脚本（可复用 `scripts/lib/headless-chrome.mjs`），避免只靠
   体感。

**验收基线**：每个场景的长任务数、Layout 次数、堆增长、滚动帧率。

### 阶段 1：确定性修复（1–2 天，风险低）— 已实施

实施记录（2026-10-18，本次改动）：

1. `scroll-pill`：`Pill` 保存自己的具名 handler，`release` 精确
   `removeEventListener` 后再清 timer / 标记 / 节点。回归测试
   [scroll-pill.test.ts](../../tests/scroll-pill.test.ts)：同一 surface 反复
   mount→dispose 后只剩一个活动监听器；脱离的 surface 释放监听器与计时器。
2. `view-switch`：新增 `release` / `prune`，tablist 被替换或 `!isConnected`
   时恢复该节点仍归模块所有的属性，并从 `attributes` 删除；glyph 集合改为
   `Set<Element>`，随记录一起释放。测试
   [view-switch.test.ts](../../tests/view-switch.test.ts)：替换后旧节点被归还，
   连续 5 次重建不积累记录。
3. `conversation-process`：观察器改为按 `MutationRecord` 增量处理——属性记录
   只认目标是过程按钮且 `aria-expanded="false"`；`childList` 只搜索
   `addedNodes`；无相关记录的批次做零查询。挂载期一次性全量兜底保留。
   观察器创建失败时报告并归还，不再留下未释放的实例。
   测试 [conversation-process.test.ts](../../tests/conversation-process.test.ts)：
   无关批次零扫描、全展开批次零点击、排队期间到达的替换容器不被丢弃。
4. `pet-anchor`：位置观察器（`style/class/data-phase`）、`resize`、
   document 捕获 `scroll`、`visibilitychange` 与卡片 `ResizeObserver` 只在
   hero 页存在时挂载；被替换时整体摘除。另设一个只过滤 `data-phase` 的廉价
   关卡观察器，在会话页只做结构判定，不读布局。测试
   [composer-pet.test.ts](../../tests/composer-pet.test.ts)：离开 hero 后监听器
   归零、流式批次不量测，回到 hero 后恢复。
5. `stats-values` / `conversation-fade` / `statistics/mount`：统一改用
   [frame.ts](../../src/client/compat/frame.ts) 的 `frameScheduler`
   （rAF，缺失或被节流时 16ms 超时兜底），每帧最多一次读写；释放时
   `cancel()` 丢弃排队任务。三者仍观察整个 body（锚点可能被宿主整段替换），
   但批次先经过 [mutation-scope.ts](../../src/client/compat/mutation-scope.ts)
   的 `recordsTouch` 过滤：只有落在被量测区域上、区域内部或区域祖先上的记录
   才排队一次 pass，侧栏、转录流、右栏的写入直接丢弃。区域未知、已脱离或
   不能回答 `contains` 时一律视为相关，因此不会因为过滤而错过“锚点回来了”
   的那一批。测试分别为
   [composer-stats.test.ts](../../tests/composer-stats.test.ts)、
   [conversation-fade.test.ts](../../tests/conversation-fade.test.ts)、
   [frame.test.ts](../../tests/frame.test.ts) 与
   [mutation-scope.test.ts](../../tests/mutation-scope.test.ts)（区域内 / 区域外 /
   祖先 / 插入 / 脱离与跨 realm 的保守分支）。
6. `popup.ts`：body `style` 观察器、surface `ResizeObserver` 与 `resize`
   统一走 `schedulePlace`，每次 paint 至多一次 `place()`；卸载时取消排队帧。
   surface 的尺寸另用 `cachedSize` 缓存：`place()` 只读 trigger 的 rect，
   面板自身只在首次放置与 `ResizeObserver` 报告尺寸变化（或窗口 `resize`，
   面板宽度被视口夹住时会改变）时重读，拖动期间不再为每次定位同步布局两次。
   测试 [popup-size.test.ts](../../tests/popup-size.test.ts)。
7. 上下文面板：订阅回调先比对本会话的原始投影（标量 + 四组有序条目），
   未变则不重建；`reading()` 缓存未变的 breakdown；`publishedRaw` 在
   `refresh` 记录、在关闭 / 会话切换 / trigger 替换 / dispose 时清空。
   `ContextPanel.tsx` 的定位与分段条 effect 只依赖 `[open, anchor]` /
   `[open]`，尺寸交给已有 `ResizeObserver`。测试
   [context-panel-driver.test.ts](../../tests/context-panel-driver.test.ts)：
   同值新帧不替换快照、真实变化才替换、无容量会话不再逐帧唤醒。
8. `EffortPanel.tsx`：canvas 几何在挂载与 `ResizeObserver` 回调中读取，
   逐帧只做限流绘制。

**验收**：`npm run check` 全绿（427 项测试）。阶段 0 的场景中，切换会话/改
配置后的 listener 与 detached 节点数不随次数增长；长会话滚动时 Scripting
时间明显下降；effort 拖动期间不再出现每帧同步 Layout。真实窗口的 Performance
数字仍待阶段 0 的实机采样。

### 阶段 2：规模放大治理（3–5 天，中风险）

**已完成**（`npm run check` 全绿，435 项测试）：

1. `empty-groups`：观察器的批次先过 `recordsTouch(records, area)`，再问一次
   `recordsIntroduce(records, host.browserListArea)`（另一个面板里新建的列表
   也要一次 pass）；只有真正碰到侧栏列表区或向其插入列表容器的批次才扫描。
   catalog（筛选值、嵌套标记、已占用分组、历史）改为惰性缓存，靠列表容器与
   `ctx.sessions.list` 的订阅置脏，不再每次 pass 重走 DOM。同步改为两段式：
   先算出分组计划并比对现有节点，未变即返回，不再为一次空 pass 读
   `getBoundingClientRect` 或写属性。测试
   [empty-groups.test.ts](../../tests/empty-groups.test.ts)：别的面板的批次
   不扫分组、catalog 答案只走一次直到订阅发布。
2. `status-groups`：同样的批次过滤（`host.browserFlatList` 的插入视为相关），
   子节点顺序按列表快照缓存；同步同样先建 `plan` / `orderedRows` / `boxes`
   并比对 dataset、`--ccd-status-order`、tabindex、标题与过期子盒，未变则在
   任何 rect 读取与写入之前返回。测试
   [status-groups.test.ts](../../tests/status-groups.test.ts)：别的面板的批次
   不碰扁平列表、无变化的 pass 既不写也不读布局。
3. `adapter.populatedGroups`：工作区路径的归一化按 id 记忆，不再在 `some`
   里对同一路径反复跑正则。
4. `files-pane`：筛选只写差异（`mark(row, hidden)`，标记已是目标状态就跳过），
   因此一次 pass 不再把每一行重新 `setAttribute` 一遍、也不再把自己的写入喂回
   观察器。观察器按模块实际打扮的盒子（已接管的 pane、`host.filesRoot`、
   `host.rightbarPanel`、空栏）过滤批次，插入这些盒子的批次照旧触发。
   空栏的落点仍只限右栏自己的派生结构
   （`[data-sidebar-right-panel] … [data-dockkit-empty] … [data-dockkit-pane]`），
   文件树正文不会被误认成空栏。测试
   [files-pane-browser.test.mjs](../../tests/files-pane-browser.test.mjs)。
5. `right-panes` / `pane-chrome`：只有组里正在显示的那张卡片装配 chrome（其余
   卡片 `display:none`），所以 T 个终端不再各画一份 T 个 tab；tab 单元格按 id
   复用，选中/改名只改该单元格自己的 `aria-selected` / `tabindex` /
   `data-selected`，不再整份重建 tab list。测试
   [right-panes-browser.test.mjs](../../tests/right-panes-browser.test.mjs)：三张
   终端卡片只存在一份 tab list。
6. `hero-canvas` / `ripples`：墨水色与采样网格按画布尺寸与配色缓存
   （`RippleSurface`），`light` 缓冲跨帧复用，不再每帧 `getComputedStyle` 与
   逐帧分配 `Float32Array`；指针按下、按键输入期间跳过这一帧的绘制（时钟照走，
   手势结束后不补画过期帧）。测试
   [hero-ripples.test.ts](../../tests/hero-ripples.test.ts)。
7. `effort` 像素场：调色板按配色缓存（`WeakMap<canvas, {scheme, palette}>`），
   逐帧只做绘制；配色标记变化（`data-dsh-ccd-style` /
   `data-ds-dark-theme`）时重读一次。测试
   [effort-pixels.test.ts](../../tests/effort-pixels.test.ts)。

**验收**：`npm run check` 全绿（435 项测试）。历史 1000 会话、10 工作区、
20 个已加载文件、8 个终端时，上述场景的脚本时间与长任务数接近小规模基线；
DOM 节点数不随无关 mutation 增长。实机 Performance 采样仍待补。

### 阶段 3：Host 投影与统计（3–5 天，中高风险，需回归）

1. `ccdContext`：
   - append 不再全量复制；维护增量 totals/entries 与 seq 索引；
   - 语义未变时复用 wire view；
   - 压力测试 1k/2k/4k append 的 fold 时间与分配。
2. `ccdUsage`：
   - 排队 ID Set + 游标；合并 publish（短窗口/下一 GET）；
   - 增量全时汇总 + 有界近期桶；
   - 压力测试 S=100/500/1000 的冷启动。
3. 统计路由：snapshot 缓存 + dirty/TTL；客户端按可见性暂停轮询；语义相同
   复用统计卡。
4. 评估是否按 feature 开关注册/释放 `ccdUsage`/`ccdContext` 投影。需要先确认
   Cordis 响应式挂载语义与首次启用成本，不直接照搬。

**验收**：长会话 committed event 的投影耗时不随 N 超线性增长；冷启动聚合
调用次数从约 S 次降到常数/批次级；隐藏窗口/离开首页时无统计请求。

### 阶段 4：持续防回归

1. 增加性能预算测试（headless）：
   - 全展开长转录上 100 次 mutation 的扫描次数上界；
   - scroll-pill 多次 mount/dispose 后监听器数；
   - 切换 N 个会话后 view-switch Map 大小；
   - Host fold 固定规模的时间/分配上界（宽松阈值，避免 CI 抖动）。
2. 在 debug 模式暴露少量计数（observer 批次、扫描节点数、投影 fold 时间），
   默认关闭。
3. 把「全 body 观察 + 全量扫描」列入架构检查的 review 规则，新增模块必须
   说明规模因子与过滤策略。

---

## 6. 风险与注意事项

- 不要为了性能直接移除自动展开/隐藏逻辑：这些是产品行为，必须改为增量处理。
- 收窄观察范围时要确认宿主在会话切换、历史加载、布局重建时仍会触发；用
  现有 browser tests 与真实 DOM 核对锚点。
- Host 投影改动影响已持久化的 checkpoint 与 `stateVersion`；先写兼容读取与
  回放测试，再改写入路径。
- 统计缓存要区分「数据未变」与「时间戳变化」，否则仍会重建卡片。
- 本审计没有实机 profile；阶段 0 的数字应作为是否继续投入阶段 2/3 的决策依据。

## 7. 附：验证命令

```sh
npm run typecheck
npm test
```

```sh
node --test tests/scroll-pill-browser.test.mjs tests/view-switch.test.ts tests/conversation-process.test.ts
```

浏览器测试需要本机 Chrome；Host 侧压力脚本建议新建在 `scripts/` 下，作为
阶段 3 的交付物。

# 转录适配器性能优化（2026-10-26）

这是首轮四个转录适配器的采样。后续组件覆盖、大目录复测及真实 DSH 菜单录制见 [组件加载与响应核验](component-response-audit-2026-10-26.md)；不能把首轮结果推及整个插件。

基线为 cd527db（0.6.1），本次定位并优化工具分组引起的历史重复解析、相同属性写入和连带的标题／详情全量清理。本报告补充 [此前的源码审计](performance-audit-2026-10-18.md)，结果来自独立 Chrome 的真实适配器采样。

## 测量条件

- 本机 Chrome 156.0.8078.48，headless，1392×932，DPR 1，GPU 关闭。
- 250 轮演示历史，每轮两条工具调用与一个回复，另加一条运行中的调用和空回复。
- 同页挂载真实的工具分组、标题翻译、工具详情和回复签名适配器。
- 正文、工具输出、无关区域依次各追加 120 个文本分片，每片经 setTimeout(0) 让浏览器交付真实 MutationObserver 通知。
- DevTools Protocol 同时采集 Performance 指标、Tracing 时间线和 Profiler CPU profile。包装 querySelector/querySelectorAll 与 setAttribute 计数；计数不包含 closest、属性移除或文本写入。
- 优化前后各一次相同场景录制。数据含采样、计数和演示驱动本身的开销，不是统计置信区间或真实 DSH 延迟。

## 结果

以下耗时是每种场景累计 120 个分片的毫秒数，非单次更新耗时。

| 场景 | 查询次数：前 → 后 | setAttribute：前 → 后 | ScriptDuration：前 → 后 | TaskDuration：前 → 后 |
| --- | ---: | ---: | ---: | ---: |
| 正文流式 | 993,496 → 30,609 | 210,480 → 0 | 415.6 → 123.6 | 478.8 → 185.4 |
| 工具输出 | 993,878 → 31,577 | 210,482 → 2 | 394.9 → 119.5 | 453.7 → 188.8 |
| 无关区域 | 856 → 9 | 0 → 0 | 46.9 → 1.5 | 126.5 → 46.1 |

正文与工具输出的查询减少约 97%，脚本耗时减少约 70%。这两轮录制均没有观测到超过 50ms 的 longtask，因此不能据此宣称消除了长任务。布局累计耗时未下降；本次收益主要是减少 JavaScript 重复工作。墙钟用时仍在约 560–590ms，受分片定时器影响，不将其换算为用户响应速度提升。

## 实现与回归

1. 工具分组缓存每个 flow seat 的解析值；文本、状态和结构变化精确失效，嵌套 flow 的变化也使外层失效。普通包装节点不缓存，避免遗漏其后代依赖。
2. 分组的展开状态、成员位置、类别和运行标记只写差异，切断相同属性写入唤醒详情观察器的链路。
3. 三个工具适配器只扫描新增子树；childList 的父节点与 characterData 的文本祖先只用于定位所属 seat／详情区域。
4. 标题、命令、技能和文件预览的历史所有权，仅在节点移除或属性变化时检查；无关文本增长不再排队空详情任务。
5. Node 回归检查历史解析与属性写入计数，以及原地状态变化后的缓存刷新。真实 Chrome 回归覆盖流式时历史零写入／零解析／零所有权扫描、原生标题与命令更新、嵌套工具完成、表头替换、仅属性变化导致的区域退出及卸载清理。

## 复现与原始产物

```sh
node scripts/profile-transcript.mjs current
# 可调整演示规模：
node scripts/profile-transcript.mjs large 500 120
node --test tests/tool-call-groups.test.ts tests/tool-call-labels.test.ts tests/tool-call-details.test.ts tests/transcript-performance-browser.test.mjs
```

需要本机已有 Chrome；可通过 CHROME 指定路径。脚本生成：

- artifacts/performance/<label>.json：版本、场景参数、累计指标和 longtask。
- artifacts/performance/<label>.cpuprofile：可导入 DevTools 查看 CPU 火焰图。
- artifacts/performance/<label>.trace.json：可导入 DevTools Performance 查看时间线。

本次本地保留 before 与 after 两组原始产物；artifacts 被 Git 忽略。脚本运行结束会验证分组数量及装饰节点清理，不设置机器相关的耗时通过阈值。

## 边界

本机 DSH 未开放 9222 调试端口，本次没有重启用户应用来附加调试器。演示页未加载完整宿主、插件 CSS 或其他功能模块，未测量真实账号数据、大文件渲染、输入延迟、GPU 合成、跨平台表现或长期堆增长。需要实机补充时，可在 DSH 开启调试端口后用 DevTools Performance 录制真实长会话中的正文输出、工具详情展开和侧栏切换，核对 Scripting 与任务分布。界面样式与动画参数未变，因此未重新生成 README 截图和动图。

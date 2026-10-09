# 问题清单 · 第二批（15–17）

第一批（01–13）已实施并提交于 `48c768d`；其需求文档与截图已按需求从仓库删除，完整备份在 `.cache/docs-backup-20261004-004734/`（`.cache/` 已被 gitignore）。
`14-idle-session-ring.md` 由另一路并入同一次提交。

## 索引

| # | 任务 | 分类 | 优先级 | 文件 |
| --- | --- | --- | --- | --- |
| 15 | 语音输入移到权限选择之后；上下文圆环移到状态栏末尾、不显示百分比、空会话也显示 | 功能调整 + 样式 | P2 | [15-voice-input-and-context-ring-placement.md](issues/15-voice-input-and-context-ring-placement.md) |
| 16 | 上方栏：删除「选择打开方式」按钮、右侧图标改黑、三点图标改竖排 | 功能调整 + 样式 | P2 | [16-header-open-target-and-icon-tone.md](issues/16-header-open-target-and-icon-tone.md) |
| 17 | 会话两侧出现了可拖动但无作用的条（疑似原版遗留），定位并删除 | 干扰清理 | P1 | [17-conversation-edge-drag-handles.md](issues/17-conversation-edge-drag-handles.md) |

## 相关计划

| 计划 | 状态 | 文件 |
| --- | --- | --- |
| 上下文圆环的分段分解面板（两态、无底部按钮） | 已实施 | [plan-context-breakdown-panel.md](plan-context-breakdown-panel.md) |

## 共性约束

- 所有改动都走插件样式 / compat 层，不改宿主组件；宿主 class 哈希只经 `src/client/compat/host-dom.ts` 与 `host-builds.ts` 访问。
- 颜色、图标等设计变量统一进 `src/client/theme/tokens.css`，业务样式里不写字面色值（`scripts/check-architecture.mjs` 会检查）。
- 每个任务完成后跑 `npm run check`（typecheck + 架构检查 + 测试 + 构建 + 包检查）。
- 本批三项都需要先在**运行中的 DOM / 已安装 `app.asar`** 里核对锚点后再动手，不要照抄猜测的选择器。
- 界面类改动请附「改前 / 改后」截图；仓库内无截图工具、且改动期间不得启动 GUI 抢占资源，因此证据以「宿主 asar 实测结构 + 盒模型/级联计算值 + 既有截图程序化量测」提交，并在报告里说明无法截图的客观原因。

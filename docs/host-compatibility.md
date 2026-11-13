# 真实宿主兼容性验收

`npm run check` 验证插件代码、fixture、构建与包结构；`npm run test:host` 另外启动已打包的真实 DSH Desktop，通过它自己的 CLI 安装 tarball，再通过原生输入事件操作实际界面。它不注入插件模块、不替换宿主 DOM 或服务，也不借用日常账号、会话和 profile。

## 本机运行

先按 `install.md` 构建 tarball，然后执行：

```sh
npm run test:host -- --tarball artifacts/dsh-claude-desktop-theme-$(node -p 'require("./package.json").version').tgz
```

默认应用是 `/Applications/DeepSeek Harness.app`，可用 `--app /path/to/DeepSeek\ Harness.app` 或 `DSH_CCD_APP` 指定另一份构建。此阶段仅支持真实 macOS Desktop；它使用应用自带的 Electron，不使用 `CHROME` 替代宿主。Chrome for Testing 仍供普通浏览器回归和资源脚本使用。

每次运行创建独立的 `artifacts/host-smoke/run-*/`：其中的 `DSH_HOME`、Electron 用户目录和演示工作区均由本次脚本拥有。宿主首次启动通过原生“添加 API Key → 稍后配置”进入，不填写凭据、不发送模型请求。测试结束关闭自有进程并删除测试 profile，保留输入 tarball 和 `evidence/`。需要允许应用进程与本地 DevTools 连接；在限制它们的沙箱中须通过正常审批在沙箱外执行。

## 当前验收范围

1. 原生界面先独立启动，确认未加载主题，再关闭并通过 DSH CLI 安装 tarball。
2. 真实 Desktop 中出现主题与模型控件，平台标记为 macOS。
3. 原生编辑器接受并清空演示草稿。
4. 权限菜单切换到手动，宿主按钮的权威状态变为只读。
5. 未配置账号时模型目录显示空状态，Escape 正常关闭菜单。
6. 原生插件页、定时任务页及插件主题设置可导航。
7. 主题关闭时撤下样式门控与余额控件，再开启可恢复；余额开关改变实际 UI，并写入宿主配置。
8. 完整退出并重启应用后，设置仍然生效。
9. 检查未捕获的 renderer 异常及插件错误日志。

目前没有覆盖模型选择后的推理、流式回复、工具执行、文件预览、`/clear` 重放和 Windows 实机。模型空状态测试不能当作模型切换测试；fixture 中的平台标记也不能当作 Windows 验收。后续应根据真实故障补场景与适配边界，不为未观察到的问题建立通用兼容层。

## 失败证据

每个已完成阶段保存 PNG 截图和 DOM；失败时再尝试保存 `failure.png`、`failure.html`，并记录：

- `report.json`：失败步骤、错误、耗时、宿主版本及 commit、tarball SHA-256、实际完成的步骤与覆盖限制。
- `console.json`：renderer 控制台及未捕获异常。
- `host.log`：宿主启动和安装日志，连接 token 与用户目录脱敏。
- `actions.log`：点击的目标与坐标。

DevTools 命令设有超时，断线会拒绝尚未完成的请求。renderer 无响应时可能无法取得失败瞬间的截图，此时报告会明确记录证据采集失败，并保留最近已完成阶段的截图。启动失败不记作业务断言失败。

可以故意制造失败来验收证据链；以下命令**应退出 1**，报告应包含 `Injected failure after shell`：

```sh
npm run test:host -- --tarball artifacts/dsh-claude-desktop-theme-$(node -p 'require("./package.json").version').tgz --fail-after shell
```

只分享 `evidence/`，不要上传原始 profile。CI 的 artifact 路径也只包含这些证据与官方发布清单。

## 上游版本发现

`.github/workflows/host-compat.yml` 在相关 main 变更、手动运行及每六小时执行。它读取已安装 DSH 的 `app-update.yml` 所使用的官方 macOS ARM64 nightly feed：

`https://download.deepseek.com/dsh-desk/feeds/mac-arm64/nightly-mac.yml`

发现脚本保留原始清单，下载同一清单指定的 zip，并核对字节数及 SHA-512。成功缓存以**发布清单身份 + 插件 Git commit + runner 架构**为键；同一组合已成功时跳过重复验收，失败不会写入成功缓存，手动运行始终重测。缓存过期会重新验证。

新版本到达后，预计在下一次调度发现；GitHub 调度可能延迟，不能保证发布即刻运行。失败通过 workflow 状态和保留 14 天的 artifact 呈现，通知由仓库的 Actions 通知设置决定；不自动提交 Issue、改映射或发布插件。workflow 合入默认分支后定时任务才会生效。

```sh
# 只发现版本，保存官方清单
node scripts/dsh-release.mjs
# 下载已发现的同一候选，避免检查期间上游版本移动
node scripts/dsh-release.mjs --manifest artifacts/dsh-release.yml --download artifacts/dsh-upstream.zip
```

当前 feed 与 runner 仅覆盖 macOS ARM64。macOS runner 选择依据 [GitHub 官方 runner 列表](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。Windows 需要自己的官方发行源、安装和启动流程，以及在实际 Windows 环境中验证过的步骤，不能仅换平台参数后宣称支持。

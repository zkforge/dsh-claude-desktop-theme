# AGENTS.md

本项目是 DSH Desktop 的 CCD 风格插件。使用说明见 [README.md](README.md)，安装见 [install.md](install.md)，代码结构见 [ARCHITECTURE.md](ARCHITECTURE.md)。

每次改动完成后，主动按 [install.md](install.md) 的源码安装流程打包并安装到本地 DSH 的 `desktop` profile，使用唯一 tarball 路径并保留安装目录，无需再次询问确认。

## 常用命令

```sh
npm ci --cache .cache/npm
npm run typecheck
npm run check:architecture
npm test
npm run build
npm run check:package
npm run check
npm run pack:local --cache .cache/npm
```

CI（`.github/workflows/check.yml`）在每次 push 到 `main` 和每个 PR 上跑 `npm run check`。浏览器测试依赖 workflow 预装的 Google Chrome（通过 `CHROME` 指向 `/usr/bin/google-chrome`）；本地没有 Chrome 时这部分用例会静默 skip。

DSH 换了构建后，宿主 CSS Module 类名会重新哈希，用下面的命令从新构建的 `app.asar` 重解前缀表（不带 `--write` 只打印）：

```sh
node scripts/host-prefixes.mjs --windows <app.asar> --write
node scripts/host-prefixes.mjs --pinned <macOS app.asar> --windows <Windows app.asar> --write
```

README 里宠物动图不是导出资源：`scripts/pet-gifs.mjs` 用无头 Chrome 逐帧渲染小鲸鱼 `composer-pet/reactions.ts` 与 Claude 像素宠物 `ClaudeArt` 的真实动画，再用 ffmpeg 合成 GIF。改了宠物动作或配色后重跑一次（需要机器上已有 Chrome 与 ffmpeg，产物在 `assets/pet/`）；只更新 Claude 动图可运行 `npm run pet:gifs -- claude`：

```sh
npm run pet:gifs
```

Effort 面板拉到底时的像素流光同理：`scripts/effort-gif.mjs` 直接调 `model-controls/pixels.ts` 的 `drawPixelField`，按毫秒逐帧取图，深浅两套主题各出一条 GIF 到 `assets/effort/`。改了像素场或配色后重跑：

```sh
npm run effort:gifs
```

README 的完整界面截图是人工拍摄的：改到侧栏、会话页、右栏、设置页这类会被拍到的界面后，按同一口径重拍受影响的图。口径是 macOS、窗口 1392×932 逻辑 px、@2x、默认配色与 Geist、统计卡片开启、状态栏统计读数关闭、演示数据不含真实账号信息；导出 1600px 宽 WebP（`cwebp -resize 1600 0 -q 82`），文件名见 README 的图片引用。模型选择器的两张局部截图例外：运行 `node scripts/model-picker-screenshots.mjs`，直接渲染真实 `ModelControls` 与演示目录，沿用窗口、字体和 @2x 口径，裁剪组件后按原始分辨率以 WebP q82 导出。`check:architecture` 会校验 README 里绝对路径的图片是否还在仓库中。

`fullscreen-*.webp` 与 `model-menu-fullscreen-*.webp` 使用用户提供的 2784×1864 px 完整窗口截图，保留原始构图、背景和窗口边缘，使用 Claude 宠物与问候样式、开启水波纹；同样导出为 1600px 宽 WebP q82。

资源渲染脚本共用 `scripts/lib/headless-chrome.mjs` 里的 Chrome 与 DevTools 连接。

上下文圆环与分解面板的局部截图运行 `node scripts/context-panel-screenshots.mjs` 更新。脚本用演示数据渲染真实 `ContextPanel`，保留宿主圆环的几何与主题样式，展开分类和 MCP 明细，按与模型选择器相同的 @2x、Geist、WebP q82 口径导出黑白两张图。

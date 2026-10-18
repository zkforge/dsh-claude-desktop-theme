# AGENTS.md

本项目是 DSH Desktop 的 CCD 风格插件。使用说明见 [README.md](README.md)，安装见 [install.md](install.md)，代码结构见 [ARCHITECTURE.md](ARCHITECTURE.md)。

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

README 里小鲸鱼的三个动图不是导出资源：`scripts/pet-gifs.mjs` 用无头 Chrome 逐帧渲染 `composer-pet/reactions.ts` 的真实动画，再用 ffmpeg 合成 GIF。改了鲸鱼动作或配色后重跑一次（需要机器上已有 Chrome 与 ffmpeg，产物在 `assets/pet/`）：

```sh
npm run pet:gifs
```

Effort 面板拉到底时的像素流光同理：`scripts/effort-gif.mjs` 直接调 `model-controls/pixels.ts` 的 `drawPixelField`，按毫秒逐帧取图，深浅两套主题各出一条 GIF 到 `assets/effort/`。改了像素场或配色后重跑：

```sh
npm run effort:gifs
```

README 的界面截图是人工拍摄的，没有脚本：改到侧栏、会话页、右栏、设置页这类会被拍到的界面后，按同一口径重拍受影响的图。口径是 macOS、窗口 1392×932 逻辑 px、@2x、默认配色与 Geist、统计卡片开启、状态栏统计读数关闭、演示数据不含真实账号信息；导出 1600px 宽 WebP（`cwebp -resize 1600 0 -q 82`），文件名见 README 里的截图占位注释。`check:architecture` 会校验 README 里绝对路径的图片是否还在仓库中。

两个脚本共用 `scripts/lib/headless-chrome.mjs` 里的 Chrome 与 DevTools 连接。

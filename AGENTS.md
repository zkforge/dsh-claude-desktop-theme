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

DSH 换了构建后，宿主 CSS Module 类名会重新哈希，用下面的命令从新构建的 `app.asar` 重解前缀表（不带 `--write` 只打印）：

```sh
node scripts/host-prefixes.mjs --windows <app.asar> --write
node scripts/host-prefixes.mjs --pinned <macOS app.asar> --windows <Windows app.asar> --write
```

README 里小鲸鱼的三个动图不是导出资源：`scripts/pet-gifs.mjs` 用无头 Chrome 逐帧渲染 `composer-pet/reactions.ts` 的真实动画，再用 ffmpeg 合成 GIF。改了鲸鱼动作或配色后重跑一次（需要机器上已有 Chrome 与 ffmpeg，产物在 `assets/pet/`）：

```sh
npm run pet:gifs
```

# 安装指南

环境：DeepSeek Harness Desktop `0.2.0-rc.2`。桌面端支持 macOS（Apple 芯片）与 Windows 10 及以上（64 位）。首次安装前启动一次 DSH，初始化 desktop profile。源码构建另需 Node.js `>=22.18.0`、npm 和 Git。

## 从 npm 安装（推荐）

### 官方插件页

打开 DSH「插件 → 添加插件」，输入 `dsh-claude-desktop-theme` 并安装。安装后按下方「启用与配置」重载应用。

### 终端

已注册 `dsh` 命令时执行：

```sh
dsh plugin --profile desktop add dsh-claude-desktop-theme
```

macOS 未注册命令时，可使用应用内置 CLI：

```sh
"${DSH_CCD_APP:-/Applications/DeepSeek Harness.app}/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add dsh-claude-desktop-theme
```

Windows 可先通过「应用 → 管理 dsh 命令…」安装命令，再重开 PowerShell；也可直接调用应用内置启动器：

```powershell
$ccdApp = if ($env:DSH_CCD_APP) { $env:DSH_CCD_APP } else { Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness' }
& (Join-Path $ccdApp 'resources\runtime\cli\bin\dsh.cmd') plugin --profile desktop add dsh-claude-desktop-theme
```

安装的是已构建的 [npm 包](https://www.npmjs.com/package/dsh-claude-desktop-theme)，无需克隆源码或在本机编译。安装到应用正在使用的 `DSH_HOME` 与 profile；桌面版默认使用 `desktop`，不要安装到独立的 `web` profile。

### 插件市场

插件目录收录尚未完成，目前请通过官方插件页或终端安装。

## 从旧包名迁移

`0.1.0` 的 npm 包名为 `dsh-ccd-style`，从 `0.2.0` 起改为 `dsh-claude-desktop-theme`。这是安装新的 npm 包，旧包的更新命令不会自动切换包名。

1. 在旧插件设置中记录颜色、字体、模块开关；有手动覆盖配置时先备份当前 profile 的 `cordis.patch.yml`。
2. 使用应用正在使用的 CLI、`DSH_HOME` 和 `desktop` profile，先移除旧包，再安装新包：

   ```sh
   dsh plugin --profile desktop remove dsh-ccd-style
   dsh plugin --profile desktop add dsh-claude-desktop-theme
   ```

3. 重载应用，在「插件 → dsh-claude-desktop-theme → ui-skin-ccd-style」核对并重新设置自定义项。不要同时启用旧包和新包。

包名迁移不会自动复制旧包的自定义配置。手动维护用户层覆盖配置时，将插件 `name: dsh-ccd-style` 改为 `name: dsh-claude-desktop-theme`；条目 id 仍为 `ui-skin-ccd-style`，请勿添加重复 id。未注册 `dsh` 时，使用上面的应用内置 CLI 路径。

## 从源码安装

```sh
git clone https://github.com/zkforge/dsh-claude-desktop-theme.git
cd dsh-claude-desktop-theme
```

已有仓库时，在当前 checkout 执行对应平台的命令。

### macOS

```sh
set -e
npm ci --cache .cache/npm
npm run pack:local --cache .cache/npm

ccd_app="${DSH_CCD_APP:-/Applications/DeepSeek Harness.app}"
ccd_cli="$ccd_app/Contents/Resources/runtime/cli/bin/dsh"
ccd_version="$(node -p 'require("./package.json").version')"
ccd_install_dir="$(mktemp -d "$PWD/artifacts/install.XXXXXX")"
ccd_tarball="$ccd_install_dir/dsh-claude-desktop-theme-$ccd_version.tgz"
cp "$PWD/artifacts/dsh-claude-desktop-theme-$ccd_version.tgz" "$ccd_tarball"
"$ccd_cli" plugin --profile desktop add "$ccd_tarball"
```

应用位于其他位置时，通过 `DSH_CCD_APP` 指定。

### Windows

先注册 `dsh` 命令：点击窗口左上角（侧栏按钮右侧）的「应用」菜单 →「管理 dsh 命令…」→ 安装，然后重开一个 PowerShell 窗口。已注册时执行：

```powershell
$ErrorActionPreference = 'Stop'
npm ci --cache .cache/npm
npm run pack:local --cache .cache/npm

$ccdVersion = node -p "require('./package.json').version"
$ccdInstallDir = Join-Path $PWD ("artifacts/install." + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $ccdInstallDir | Out-Null
$ccdTarball = Join-Path $ccdInstallDir "dsh-claude-desktop-theme-$ccdVersion.tgz"
Copy-Item "artifacts/dsh-claude-desktop-theme-$ccdVersion.tgz" $ccdTarball
dsh plugin --profile desktop add $ccdTarball
```

未注册 `dsh` 时，把上面最后一行换成安装目录内的启动器。默认安装位置为 `%LOCALAPPDATA%\Programs\DeepSeek Harness`，安装到其他位置时用 `DSH_CCD_APP` 指向应用目录：

```powershell
$ccdApp = if ($env:DSH_CCD_APP) { $env:DSH_CCD_APP } else { Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness' }
$ccdCli = Join-Path $ccdApp 'resources\runtime\cli\bin\dsh.cmd'
& $ccdCli plugin --profile desktop add $ccdTarball
```

`pack:local` 会先完成类型、架构、测试、构建和包检查。每次安装使用唯一 tarball 路径；保留安装目录，profile 的本地依赖会引用它。

自定义数据目录沿用应用的 `DSH_HOME`；默认 profile 为 `~/.dsh/profiles/desktop`，Windows 上为 `%USERPROFILE%\.dsh\profiles\desktop`。

## 启用与配置

安装后重载 DSH：macOS 按 **⌘R**；Windows 从托盘菜单退出后重新打开应用。首次加载自动显示风格。升级保留此前的开关和配置。

在「插件 → dsh-claude-desktop-theme → ui-skin-ccd-style」调整：

- 总开关与各模块开关。
- 跟随系统、浅色或深色主题。
- 会话和侧栏背景色，自定义颜色作用于浅色模式。
- 界面与代码字体，可从本机字体列表选择或输入族名。
- 统计卡片，默认关闭。
- 显示空分组：默认关闭，没有会话的工作区不再显示在侧栏；侧栏「视图选项」菜单里是同一个开关。

改动即时生效，保存于当前 profile 的 `cordis.patch.yml`。颜色与字体留空时使用内置值。

## Geist 字体

安装仓库内的 `assets/fonts/Geist-Variable.ttf`：macOS 双击后在字体册中安装，Windows 右键选择「安装」。然后重启 DSH。字体使用 SIL OFL 1.1 许可，全文见 [OFL.txt](assets/fonts/OFL.txt)。字体仅供本机安装，不包含在 npm 包中。

## 升级与卸载

npm 安装的插件可通过同一 CLI 和 profile 更新：

```sh
dsh plugin --profile desktop update dsh-claude-desktop-theme
```

未注册 `dsh` 时，替换为上面的应用内置 CLI 路径。源码安装则更新源码，重新执行对应平台的安装命令。升级后重载 DSH，保留已有开关和配置。

临时恢复原生界面，在插件配置页关闭「启用 CCD 风格界面」。卸载使用同一应用、`DSH_HOME` 和 profile。

macOS：

```sh
"${DSH_CCD_APP:-/Applications/DeepSeek Harness.app}/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop remove dsh-claude-desktop-theme
```

Windows（已注册 `dsh` 时）：

```powershell
dsh plugin --profile desktop remove dsh-claude-desktop-theme
```

如曾手动添加用户层覆盖配置，移除其中 `id: ui-skin-ccd-style` 的条目，然后重载 DSH。

项目介绍与安装入口见 [README](README.md)。

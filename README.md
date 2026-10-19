<div align="center">

# DSH Claude Desktop Theme

为 DeepSeek Harness（DSH）Desktop 换上 Claude Code Desktop 外观

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-3DA639?style=for-the-badge&logo=opensourceinitiative&logoColor=white" alt="License"/>
  <img src="https://img.shields.io/npm/v/dsh-claude-desktop-theme?style=for-the-badge&color=4D6BFE&logo=npm&logoColor=white" alt="npm"/>
  <img src="https://img.shields.io/badge/DSH-latest-4D6BFE?style=for-the-badge" alt="DSH"/>
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-0078D4?style=for-the-badge" alt="Platform"/>
</p>

[安装](#快速安装) · [功能](#功能) · [界面预览](#界面预览) · [配置](#配置) · [架构](https://github.com/zkforge/dsh-claude-desktop-theme/blob/main/ARCHITECTURE.md) · [设计规范](https://github.com/zkforge/dsh-claude-desktop-theme/blob/main/DESIGN.md) · [安装指南](https://github.com/zkforge/dsh-claude-desktop-theme/blob/main/install.md) · [问题反馈](https://github.com/zkforge/dsh-claude-desktop-theme/issues)

</div>

<p align="center">
  <img src="https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/new-session-light.webp" width="1200" alt="新会话页：浅色主题、用量统计与字符水波纹">
</p>

## 快速安装

[npm 包](https://www.npmjs.com/package/dsh-claude-desktop-theme)已发布，两种入口任选其一：

- **插件页**：「插件 → 添加插件」，输入 `dsh-claude-desktop-theme`
- **终端**：`dsh plugin --profile desktop add dsh-claude-desktop-theme`

首次安装后插件自动开启，升级沿用已保存的配置。应用内安装无需注册 CLI；重载、应用内置 CLI 路径、旧包名迁移与源码安装见[安装指南](https://github.com/zkforge/dsh-claude-desktop-theme/blob/main/install.md)。

## 功能

### 侧栏

- DeepSeek Harness 品牌条目默认隐藏，可在「设置 → Claude 主题 → 视图」开启显示。
- 新建会话 / 插件 / 例程三枚入口与工作区、会话列表、账号菜单共用紧凑行高，当前入口常驻底色。
- 会话搜索框与导航行同宽同高，位于「新建会话」上方；原位置改为左侧「最近会话」标题和右侧筛选视图按钮。
- 会话条目尾部只有一枚 ⋮，菜单里是置顶、重命名、分叉与归档。
- 视图选项分状态、分组与排序、空分组三段。「按状态」把会话分为需要输入 / 进行中 / 已结束，状态变化时平滑移动，进行中的会话下显示子任务；项目分组与单列表仍然可选。
- 「对话 / 轨迹」切换器停在侧栏窗口控制行，以图标表示。

### 会话页

- 新会话页、输入卡片与聊天页共用一套布局，正文边缘随滚动渐隐。
- 顶栏左侧是电脑图标与标题下拉（Open in、Rename、Fork、Transcript view、Output style、Archive、Delete）；项目名以灰色标签显示，点击打开目录菜单。有宿主接口的动作接真实操作，其余点击说明限制。
- 顶栏右侧是项目文件夹、终端、浏览器三个右栏入口；展开右栏的动作在会话 ⋯ 菜单第一项。
- 整轮过程默认展开，「已完成，用时…」与步骤分组标题不再显示。
- Markdown 的链接、行内代码、表格与代码块按 CCD 风格重绘。

### 输入框

- 加号位于输入面内左侧；工作区与模式两枚 chip 同长，工作区名过长时省略，模式标签始终完整。
- 模型选单名称前的图标可在「Claude 主题 → 视图 → 显示模型图标」中开关，默认开启。
- 模型选择器支持搜索；effort 用滑杆，停在最后一档时实心填充换成一条像素流光。两者都可用键盘操作。
- 发送 / 停止是细线按钮，权限常显文字，上下文圆环在行末；输入面聚焦时边框加深。
- 上下文圆环点开分段面板：MCP 工具、系统工具、系统提示词、技能、记忆文件、对话消息、自动压缩余量与空闲空间，可逐项展开。

### 右侧栏

- Files 与浏览器各占一张浮动卡片，多个终端共用一张并用标签切换；第三块开启右列，两列分隔线各自可拖，比例按会话保留。
- 卡片可放大到覆盖聊天区（保留左导航）／还原；最后一块关闭时收起右栏。
- Files 的文件树与预览左右分栏、树宽可拖；标题左侧蓝色清单按钮收起 / 展开文件树；过滤框按名字收窄已加载的行，Esc 清除。
- 浏览器带 Servers / Files / Settings 分组菜单与 Save screenshot；标题栏可直接输入服务地址并回车访问。

### 菜单与滚动条

- 工作区、会话、权限与模型等菜单共用紧凑行高、圆角与悬停反馈，浅色与深色一致。
- 滚动条平时不画：滚动时出现、停下约一秒淡出；五个页面级滚动面（会话页、转录列、侧栏树、文件树、智能体团队面板）用一条封顶的深色浮层胶囊。

### 主题与细节

- 跟随 DSH 的浅色、深色与系统主题。
- 可自定义会话与侧栏背景色（仅浅色模式），以及界面、界面中文与代码字体。
- 主页字符水波纹持续流动，点击空白处触发同款扩散。
- 输入卡旁的宠物可在小鲸鱼与 Claude 像素宠物之间切换：小鲸鱼点击随机喷水、弹跳或摆尾；Claude 宠物点击后取出笔记本电脑、敲键盘，再恢复站姿。
- 「Claude 主题 → 个性化」可独立选择宠物样式、首页问候与图标；首页保留「探索未知之境」，也可切换为橙色星芒图标与 “What’s up next?”，问候语跟随界面语言，不显示姓名。默认保持原样式。
- 用量统计卡片：概览 / 模型视图、时间范围、贡献热力图与模型图表。

## 界面预览

截图为 macOS、默认配色与 Geist 字体，统计卡片开启，状态栏统计读数保持默认关闭。小鲸鱼的点击回应与 Effort 拉到底的动效见下一节。

| 界面 | 浅色 | 深色 |
| --- | --- | --- |
| 新会话页 | ![新会话页 · 浅色](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/new-session-light.webp) | ![新会话页 · 深色](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/new-session-dark.webp) |
| 会话页 | ![会话页 · 浅色](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/chat-light.webp) | ![会话页 · 深色](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/chat-dark.webp) |
| 插件设置 | ![插件设置 · 浅色](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/settings-light.webp) | ![插件设置 · 深色](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/settings-dark.webp) |

## 细节动效

<div align="center">

<table>
<tr>
<td width="33%" align="center">
<img src="https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/pet/pet-spout.gif" width="150" alt="喷一口水：身体轻晃、闭眼，从头顶喷出水柱，水滴向两侧散开落下"><br/>
<b>喷一口水</b><br/>
身体轻晃、闭眼，从头顶喷出水柱，水滴向两侧散开落下
</td>
<td width="33%" align="center">
<img src="https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/pet/pet-hop.gif" width="150" alt="轻弹眨眼：蓄力、向上轻跳、落地回弹并眨眼"><br/>
<b>轻弹眨眼</b><br/>
蓄力、向上轻跳、落地回弹并眨眼
</td>
<td width="33%" align="center">
<img src="https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/pet/pet-wag.gif" width="150" alt="摆尾回应：身体左右轻晃，尾巴与胸鳍摆动并眨眼"><br/>
<b>摆尾回应</b><br/>
身体左右轻晃，尾巴与胸鳍摆动并眨眼
</td>
</tr>
</table>

<table>
<tr>
<td width="50%" align="center">
<img src="https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/effort/effort-light.gif" width="260" alt="浅色 Effort 面板：滑杆停在 Max，实心填充淡出，像素流光从右端扫入并在轨道上持续流动"><br/>
<b>Effort 拉到底 · 浅色</b>
</td>
<td width="50%" align="center">
<img src="https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/effort/effort-dark.gif" width="260" alt="深色 Effort 面板：同一条像素流光，亮紫像素落在深色轨道上"><br/>
<b>Effort 拉到底 · 深色</b>
</td>
</tr>
</table>

</div>

## 配置

打开「设置 → Claude 主题」，改动即时生效：

| 分组 | 可调项 |
| --- | --- |
| 模块 | 窗口与分栏骨架、侧栏、新建页、主页字符水波纹（默认开启）、聊天页、输入框小鲸鱼、统计卡片、状态栏统计读数、上下文分解面板 |
| 外观 | 主题（浅色 / 深色 / 跟随系统）、会话背景色、侧栏背景色 |
| 视图 | 顶栏子代理入口、顶栏团队入口（默认关闭）、显示空分组（默认关闭） |
| 字体 | 界面字体、代码与等宽字体；界面中文字体在设置页不列，需写进 profile 的 `cordis.patch.yml` |

> [!NOTE]
> 自定义背景色只作用于浅色模式，深色模式使用内置深色调色板。界面默认使用 Geist，未安装时回退系统字体；仓库的 `assets/fonts/` 提供本机安装用字体与 OFL 许可，字体不包含在 npm 包中。

## 环境要求

支持最新版 DSH Desktop，兼容 `0.2.0-rc.2`；macOS（Apple 芯片）或 Windows 10 及以上（64 位）。源码构建另需 Node.js ≥ 22.18.0。

## 反馈与许可

通过 [Issue](https://github.com/zkforge/dsh-claude-desktop-theme/issues) 反馈问题，附上 DSH 版本、窗口尺寸和复现步骤。

[MIT](./LICENSE) © 2026 zkforge。

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
  <img src="https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/fullscreen-light.webp" width="1200" alt="新会话页：浅色主题、Claude 像素宠物、用量统计与字符水波纹">
</p>

## 快速安装

[npm 包](https://www.npmjs.com/package/dsh-claude-desktop-theme)已发布，两种入口任选其一：

- **插件页**：「插件 → 添加插件」，输入 `dsh-claude-desktop-theme`
- **终端**：`dsh plugin --profile desktop add dsh-claude-desktop-theme`

源码安装见[安装指南](https://github.com/zkforge/dsh-claude-desktop-theme/blob/main/install.md)。


## 界面预览

截图为 macOS、默认配色与 Geist 字体，统计卡片开启，状态栏统计读数保持默认关闭。两种宠物的点击回应与 Effort 拉到底的动效见下一节。

| 界面 | 浅色 | 深色 |
| --- | --- | --- |
| 新会话页 | ![新会话页 · 浅色](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/new-session-light.webp) | ![新会话页 · 深色](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/new-session-dark.webp) |
| 会话页 | ![会话页 · 浅色](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/chat-light.webp) | ![会话页 · 深色](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/chat-dark.webp) |
| 插件设置 | ![插件设置 · 浅色](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/settings-light.webp) | ![插件设置 · 深色](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/settings-dark.webp) |

### 完整窗口展示

以下为 macOS 完整窗口截图，使用 Claude 像素宠物与首页问候样式，开启主页水波纹，保留统计卡片。

| 界面 | 浅色 | 深色 |
| --- | --- | --- |
| 新会话页 · 完整窗口 | ![新会话页完整窗口 · 浅色](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/fullscreen-light.webp) | ![新会话页完整窗口 · 深色](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/fullscreen-dark.webp) |
| 模型选单展开 · 完整窗口 | ![模型选单完整窗口 · 浅色](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/model-menu-fullscreen-light.webp) | ![模型选单完整窗口 · 深色](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/model-menu-fullscreen-dark.webp) |

### 组件特写

| 组件 | 浅色 | 深色 |
| --- | --- | --- |
| 模型选择器 | ![模型选择器 · 浅色](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/model-picker-light.webp) | ![模型选择器 · 深色](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/model-picker-dark.webp) |
| 上下文圆环与分解面板 | ![上下文圆环与分解面板 · 浅色](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/context-panel-light.webp) | ![上下文圆环与分解面板 · 深色](https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/screenshots/context-panel-dark.webp) |

模型选择器与上下文分解面板均为组件局部截图，使用演示数据。模型选择器展示供应商分组、模型图标与当前选中项，可选模型和 Effort 档位以 DSH 实际提供的目录为准；上下文面板展示分类占比与展开的 MCP 工具明细，右下角保留用量圆环入口。

## 细节动效

<div align="center">

<table>
<tr>
<td width="25%" align="center">
<img src="https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/pet/pet-spout.gif" width="150" alt="喷一口水：身体轻晃、闭眼，从头顶喷出水柱，水滴向两侧散开落下"><br/>
<b>喷一口水</b><br/>
身体轻晃、闭眼，从头顶喷出水柱，水滴向两侧散开落下
</td>
<td width="25%" align="center">
<img src="https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/pet/pet-hop.gif" width="150" alt="轻弹眨眼：蓄力、向上轻跳、落地回弹并眨眼"><br/>
<b>轻弹眨眼</b><br/>
蓄力、向上轻跳、落地回弹并眨眼
</td>
<td width="25%" align="center">
<img src="https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/pet/pet-wag.gif" width="150" alt="摆尾回应：身体左右轻晃，尾巴与胸鳍摆动并眨眼"><br/>
<b>摆尾回应</b><br/>
身体左右轻晃，尾巴与胸鳍摆动并眨眼
</td>
<td width="25%" align="center">
<img src="https://raw.githubusercontent.com/zkforge/dsh-claude-desktop-theme/main/assets/pet/pet-claude.gif" width="150" alt="Claude 像素宠物：取出笔记本电脑、敲键盘，再收起电脑恢复站姿"><br/>
<b>Claude 像素宠物</b><br/>
取出笔记本电脑、敲键盘，再恢复站姿
</td>
</tr>
</table>

<p>在「设置 → Claude 主题 → 个性化 → 宠物样式」中切换小鲸鱼或 Claude 像素宠物，点击宠物即可播放动作。</p>

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

## 功能

### 侧栏

- 左下角账号菜单新增「余额」，显示 DeepSeek 官方 API 的人民币余额（`¥`）；悬停查看充值与赠金明细，点击刷新，菜单打开时每分钟后台更新，重新打开保留上次读数。复用设置 → 模型中的官方 API Key；未配置或查询失败时显示对应状态。

- DeepSeek Harness 品牌条目默认隐藏，可在「设置 → Claude 主题 → 视图」开启显示。
- 新建 / 插件 / 例程三枚入口与工作区、会话列表、账号菜单共用紧凑行高，当前入口常驻底色。
- 会话搜索框与导航行同宽同高，位于「新建」上方；原位置改为左侧「最近会话」标题和右侧筛选视图按钮。
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
- 内置 DeepSeek 路由的 Flash / V4 Pro 显示峰谷状态：模型按钮和选单中的趋势折线紧跟模型名，尺寸 16×12px、间距 6px；谷时绿色下降、峰时琥珀色上升，长名称省略时仍保留图标；悬停或键盘聚焦显示官方人民币参考价及距离切换的倒计时。参考价核对于 2026-10-20，节假日日历覆盖 2026 年；目录不提供实际 API 地址，使用代理时应以实际账单为准。价格及后续年度日历需随官方规则更新，未知年度不推算峰谷状态。
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
- 「Claude 主题 → 个性化」可独立选择宠物样式、输出中状态（原生鲸鱼或收缩扩散的 Claude 星芒与阶段文字）、回复签名（鲸鱼尾巴或 Claude 星芒）、首页问候与图标；首页保留「探索未知之境」，也可切换为橙色星芒图标与 “What’s up next?”，问候语跟随界面语言，不显示姓名。默认使用 Claude 宠物、输出状态、回复签名与首页问候。
- 用量统计卡片：概览 / 模型视图、时间范围、贡献热力图与模型图表。

## 配置

打开「设置 → Claude 主题」，改动即时生效：

| 分组 | 可调项 |
| --- | --- |
| 模块 | 窗口与分栏骨架、侧栏、新建页、主页字符水波纹（默认开启）、聊天页、输入框小鲸鱼、统计卡片（默认开启）、状态栏统计读数（默认关闭）、上下文分解面板 |
| 外观 | 主题（浅色 / 深色 / 跟随系统）、会话背景色、侧栏背景色 |
| 视图 | 顶栏子代理入口、顶栏团队入口（默认关闭）、显示空分组（默认关闭） |
| 字体 | 界面字体、代码与等宽字体；界面中文字体在设置页不列，需写进 profile 的 `cordis.patch.yml` |

> [!NOTE]
> 自定义背景色只作用于浅色模式，深色模式使用内置深色调色板。默认界面西文、中文与代码字体分别为 Anthropic Sans Web、Anthropic Serif Web 与 SF Mono，未安装时沿字体栈回退；仓库的 `assets/fonts/` 提供本机安装用字体与 OFL 许可，字体不包含在 npm 包中。

## 环境要求

支持最新版 DSH Desktop，兼容 `0.2.0-rc.2`；macOS（Apple 芯片）或 Windows 10 及以上（64 位）。源码构建另需 Node.js ≥ 22.18.0。

## 反馈与许可

通过 [Issue](https://github.com/zkforge/dsh-claude-desktop-theme/issues) 反馈问题，附上 DSH 版本、窗口尺寸和复现步骤。

[MIT](./LICENSE) © 2026 zkforge。

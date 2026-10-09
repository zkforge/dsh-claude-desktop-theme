# Claude 侧栏图标复刻

根据 2026-10-09 提供的侧栏截图手绘的 SVG：新建、项目、Artifacts、定时、自定义。
静态轮廓与悬停动作分别根据截图和 5.25 秒 GIF 复刻。
采用 SVG 分组与 CSS transform 实现，不包含 Claude 原始字体。
动作角度和时长是参考视频的近似值，不是从 Claude 原始代码提取的参数。

每个图标使用 24 × 24 viewBox 和 currentColor。内联 SVG 可继承父元素颜色；
通过 img 引用时不会继承页面的 currentColor，需内联或使用 CSS mask。
new.svg 包含淡色圆底，做 mask 会丢失圆底与笔画的颜色层次，建议内联。

内联 SVG，给外层按钮加 claude-sidebar-trigger，并加载 motion.css 即可使用：
项目上方两条线分别倾斜 8° / 3°；Artifacts 的圆形保持原位，叶片旋转 -25°，
矩形绕自身中心旋转 30° 并微调位置；工具箱旋转 -6°，中间横线分为三段。
悬停或选中保持偏转，移开且未选中时用 280ms 过渡回正。键盘聚焦触发同样动作，减少动态效果
偏好下取消过渡。新建圆底在悬停、聚焦或选中时隐藏。
定时图标的圆框与短针固定，长针从朝上旋转 45° 到右上方；两个结束姿态来自
Routines 截图，过渡时长沿用其他图标的 280ms。

preview.html 展示原尺寸侧栏与浅深色放大图，悬停、聚焦可查看动作，
「播放演示」依次展示五个图标。preview-motion.gif 是代码渲染的动效预览。
新建、工具箱、定时三个图标已接入 DSH 侧栏：新建会话、插件、例程。
运行时的 SVG 常量在 src/client/features/sidebar/navigation-icons.ts，动效在
src/client/features/sidebar/navigation.css；本目录保存设计素材与独立预览。

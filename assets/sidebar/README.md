# Claude 侧栏图标

根据侧栏截图手绘的五个 SVG：新建、项目、Artifacts、定时、自定义。采用 SVG
分组与 CSS transform 实现动作，不包含 Claude 原始字体；角度和时长是参考视频的
近似值，不是从 Claude 原始代码提取的参数。

每个图标使用 24 × 24 viewBox 与 currentColor。内联 SVG 继承父元素颜色；通过 img
引用时拿不到页面的 currentColor，需内联或改用 CSS mask。`new.svg` 带淡色圆底，
做 mask 会丢掉圆底与笔画的颜色层次，只能内联。

动作：项目上方两条线分别倾斜 8° / 3°；Artifacts 的圆形不动，叶片旋转 -25°，
矩形绕自身中心旋转 30° 并微调位置；工具箱旋转 -6°，中间横线分三段；定时图标的
圆框与短针固定，长针从朝上转到右上方 45°。悬停与键盘聚焦触发同样动作，移开后
280ms 过渡回正，`prefers-reduced-motion` 下不过渡。新建圆底在悬停、聚焦或选中时
隐藏。

其中新建、工具箱、定时三个已接入 DSH 侧栏（新建、插件、例程）：SVG 常量在
`src/client/features/sidebar/navigation-icons.ts`，动作在
`src/client/features/sidebar/navigation.css`。本目录保存的是同一份 SVG，供对照与
复用，构建不读取它们；改图标时两处要一起改。

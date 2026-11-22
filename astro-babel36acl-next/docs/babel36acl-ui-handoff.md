# Babel36acl Astro UI 交接稿

## 目标与边界

本站最终只运行 Astro 静态站。原 WordPress/Sakurairo 站点提供内容、公开路径和视觉契约；Firefly 固定提交 `6d82554b` 提供 Astro 内容渲染、搜索、RSS、目录和布局能力。

`motion-web` 只作为动效流程参考，`threeui` 只作为组件交互参考，`ui-ux-pro-max` 用于可访问性、响应式和 reduced-motion 检查。运行时不引入 React，也不把这些项目的默认配色或页面结构直接复制进来。

## 已从源码确认的视觉来源

- 旧 Astro/Sakurairo 样式使用深海军蓝背景、冰蓝强调、柔和紫色冲突色和透明层；文章内容的正式 token 位于 `sakurairo-arcaea-blog-skill/references/visual-tokens.md`。
- 文章阅读层使用 `#0a1220` / `#101b2d` / `#16243b`，正文接近白色，代码和结构强调使用冰蓝，普通表格保持文档表面而不是游戏 HUD。
- 旧站保留大图横幅、波浪过渡、半透明卡片、侧栏和文章目录；正文优先保证代码、表格、长段落和移动端换行。
- 当前迁移树的公开文章路径由 `canonicalPath` 决定，评论键和旧文章 ID 独立保存。

## 安装包与 Gemini 复核

实际解包的 `C:/Users/A1165/Documents/blog/arcaea_7.0.260c.apk` 提供了几何语言的交叉证据：

- `assets/layouts/dialog/dialogtop.png` 是紫灰低饱和玻璃带，带细白顶线、斜切端角和碎片纹理。
- `assets/layouts/dialog/button_single.png` 是带粒子纹理的长斜切按钮；`layouts/1080/alterego/divider-line.png` 与 `divider-diamond.png` 对应细线和小菱形分隔。
- `layouts/1080/mainmenu/event_button_purple.png` 使用紫色渐变、白色外框和菱形主体，说明几何点缀应留在标题、按钮和分隔层，不应侵入正文。

Gemini CLI 的只读审查以这些资源观察、旧 Astro 首页和 `visual-tokens.md` 为输入，没有修改代码，也没有声称直接读取 APK 像素。它确认当前首屏、冷色 token 和阅读比例已经回到旧站方向，并建议把卡片从近实色遮罩调回约 `.88`、增加细顶线、只在轻量构件使用斜切角和菱形。当前实现按此建议落地。

## 当前实现的共享 token

`src/styles/babel36acl.css` 提供跨页面的 Babel36acl 层：

- 深色默认模式使用 `#0a1220` / `#101b2d` / `#16243b`，卡片表面约 `.88` 不透明度，冰蓝 `#8be3ff` 和柔和紫 `#c9aeff` 作为强调。
- 卡片只保留一层 14px 玻璃模糊、1px 冷色边框和内侧高光；全屏壁纸最多再使用一层背景模糊，避免在表格单元格和正文原语上叠加 blur。
- 卡片和文章壳顶部有细灰紫光线，首屏标签、按钮、H4 与分隔线才使用小菱形或轻微斜切角，保留正文的高信噪比。
- 所有键盘可聚焦控件有可见焦点环；链接、按钮、摘要控件使用 pointer 光标。
- `prefers-reduced-motion: reduce` 时关闭长动画、平滑滚动和过渡；小屏正文允许任意长链接换行。

### 手机端玻璃层级（2026-10-04）

移动端增加了单独的材质层级：导航栏使用 24px 模糊与轻微饱和，搜索/主题/菜单、菜单抽屉和右下角悬浮控件使用 12–22px 模糊，分类条、文章卡片和文章壳使用约 `.78` 的冷色表面与 18–20px 模糊；正文本身保持透明和锐利，不对整页内容叠加 blur。导航栏和悬浮控件补了安全区 inset，分类横向滚动使用 proximity snap，缺少 `backdrop-filter` 或系统要求减少透明度时回退到不透明 Arcaea 表面。

这一层级参考 Apple 的 [Materials 指南](https://developer.apple.com/design/human-interface-guidelines/materials)：把动态玻璃留给导航和控件，把内容层交给标准材质，并限制自定义玻璃的使用范围；具体半径和透明度仍以本站的低饱和 Arcaea token 为准。

## 页面与组件契约

| 区域 | 交付要求 |
| --- | --- |
| 首页 | 保留大图横幅和站点身份；标题先于装饰；首屏后能直接看到文章入口和分类。 |
| 文章页 | 使用旧文章 canonical 路径；标题、日期、分类、标签、目录、代码、表格和相关推荐的层级稳定；评论系统没有真实配置时不渲染示例组件。 |
| 归档/分类/标签 | 可按标题、日期和分类扫描；空结果必须有文字说明和返回入口。 |
| 关于/工具 | 关于页只写 Babel36acl 的真实信息；书签页只收录已经核对的外部项目。 |
| 搜索 | Pagefind 结果要显示标题、路径和摘要；移动端结果不能横向溢出。 |
| 404/禁用页 | 禁用的主题示例页返回站内 404，不展示 Firefly 示例身份。 |
| 导航/侧栏 | 导航显示 Babel36acl，外部源码入口指向 AKCX2002；侧栏在文章页与列表页保持可预测。 |

## Antigravity/Figma 待确认项

Antigravity 审查采用只读 CLI：只读取本文件、`visual-tokens.md`、新旧 Astro 的布局与样式，输出 token、状态矩阵、动效预算和 Figma 交付要求，不修改工作区。当前会话因 CLI 无头权限问题和并发接管而被终止，尚未产生可引用的设计结论。

Gemini 的文字复核不能替代浏览器和 Figma 的像素审查；设计师仍需要在 Figma/Antigravity 中确认：

1. 首页横幅在 375、768、1024、1440px 的裁切位置和标题最大宽度。
2. 文章卡片、正文壳、目录和代码块的 light/dark 变体，以及透明层是否保持单层。
3. 文章页侧栏在滚动、目录展开、评论加载和无评论时的状态。
4. 动效的持续时间、暂停/跳过方式和 reduced-motion 结果。
5. 使用的图片、字体和图标的许可；交付时记录 Figma 页面、组件变体、节点 ID 和资产路径。

## 验收顺序

本轮本地验收已通过 `pnpm check`（262 个文件、0 errors/warnings/hints）、`pnpm type-check`、`pnpm build`（80 页，Pagefind 55 页）；构建产物中 Mermaid 回退数为 0。浏览器已检查 375px 手机、768px 平板和 1440px 桌面首页，以及一篇中文历史文章：首页保留 100vh 二次元首屏，文章页只有一个 H1、桌面右侧目录，手机文章页不再重复显示头像/分类/标签底栏，三种宽度均无横向溢出。公网发布、旧 WordPress 备份和停用切换仍需另行验收。

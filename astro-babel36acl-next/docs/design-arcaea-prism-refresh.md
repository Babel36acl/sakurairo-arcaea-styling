# Arcaea Prism 视觉刷新规范

> 目标：把当前 Firefly/Sakurairo 外壳重绘成一套有 Arcaea 气质的「冷光玻璃 + 切角 HUD」体系。
> 参考对象是 Arcaea 插件/笔记里的**风格元素**（切角、棱镜光轨、玻璃分层、判定色语义、HUD 小字），
> 不是复刻其布局或素材。保留本站既有的冰蓝 #8be3ff / 柔紫 #c9aeff 血统，向深空蓝黑过渡。

## 1. 设计主张

三层结构，任何页面都按这三层检查：

1. **材质层**：深空底 (#070b14 → #0b111c) + 半透明玻璃面板 + 1px 冷边 + 内高光。
2. **光线层**：棱镜光轨（青 #8ad8ff → 紫 #c7b6ff → 透明），只出现在顶缘、标题底线、链接下划线、分隔线上；不铺满卡片。
3. **形状层**：45° 切角只给**按钮（6px）/ 卡片（10px）/ 弹窗（16px）**的右上角；正文、表格、代码块不切角。

判定色只做**语义**，且必须配图标或文字：Pure #ffe178（成功/高亮）、Far #deb887（提醒）、Lost #ab6d80（错误/失效）。金色 #d8b365 是「金缮」点缀（引用块、精选、时间线节点），全站面积占比 < 2%。

## 2. Token（已落地：src/styles/arcaea-prism.css）

已提供 `--ac-*` 令牌与 `.ac-panel` / `.ac-rail-top` / `.ac-chamfer` / `.ac-kicker` / `.ac-divider` / `.ac-focus` / `.ac-state--*` 工具类。
**不要另建一套色值**；缺什么先在规范里补，再复用。

| 用途 | Token |
| --- | --- |
| 深空底 / 表面 | `--ac-void` `--ac-bg` `--ac-surface` `--ac-surface-2` |
| 冷光 | `--ac-sky` `--ac-violet` `--ac-periwinkle` `--ac-ice` |
| 线与文字 | `--ac-line` `--ac-line-strong` `--ac-text` `--ac-text-soft` `--ac-text-dim` |
| 玻璃与阴影 | `--ac-glass` `--ac-glass-strong` `--ac-blur-sm/md/lg` `--ac-shadow-card` |
| 切角 | `--ac-cut-sm/md/lg`（局部覆盖 `--ac-cut`） |
| 动效 | `--ac-ease` `--ac-fast` `--ac-med` |

## 3. 逐面设计

### 3.1 首页导航（SakurairoHomeHeader.astro）
- 顶部透明；滚动后 64px 玻璃条：`--ac-glass-strong` + `--ac-blur-md`，**顶缘 1px 棱镜光轨**，底边 1px `--ac-line`。
- 胶囊式桌面导航保留（这是 Sakurairo 的识别点），但换成深色玻璃 + 双色 1px 描边（上冷下紫，用 `border-image` 或渐变 padding-box 实现）。
- hover：药丸底色 `rgba(138,216,255,.12)`；当前页：底部 2px `--ac-edge` 短线 + 文字 `--ac-ice`。
- 搜索/随机背景/头像：34px 圆形玻璃，1px 冷边；hover 光轨环。
- 移动端：抽屉 = 顶部 12px 切角的整幅玻璃，菜单项左侧 1px 竖光轨；不要纯白底。

### 3.2 首页 Hero（banner-home.css 追加）
- 标题上方加 HUD kicker（`.ac-kicker`）：如 `BABEL ◆ ARC_36`，字距 .18em。
- 主标题保留本站衬线字体，但加一层从左上到右下的冷光渐变描边/高光（`background-clip:text` 只在浅色层用，保证对比度）。
- 标题下 48–72px 棱镜光轨（`.ac-divider` 加宽），再下面是副标题与标签。
- 滚动提示：竖线 + 菱形，260ms 呼吸，reduced-motion 停。

### 3.3 文章卡片（PostCard.astro / LegacyPostCard.astro）
- 容器：`--ac-glass` + `--ac-blur-md` + 1px `--ac-line` + 右上 10px 切角；封面图自身不透明，切角落在卡片上。
- 封面：底部 scrim（transparent → rgba(7,11,20,.72)），hover scale 1.03 / 420ms。
- 分类标签：浮在封面左上，6px 切角小胶囊，深底 + `--ac-sky` 文字。
- 元信息行：`--bac-code-font` 12px、`--ac-text-dim`，用 `◆` 分隔（`.ac-kicker` 结构）。
- hover：上移 3px + 顶缘光轨淡入 + 边框 `--ac-line-strong`；键盘 focus-visible 用 `--ac-ring`。
- 禁止：整卡霓虹外发光、彩色渐变大面积覆盖封面。

### 3.4 分类条与标签（CategoryBar.astro）
- 吸顶高度 = 导航高度；背景 `--ac-glass` + blur；底部 1px 线。
- 每个分类：6px 切角胶囊；当前分类用 1px 渐变描边 + `--ac-sky` 文本 + 左侧 6px 菱形。
- 横向滚动条隐藏但保留键盘可达（Tab 可见）。

### 3.5 文章页（PostDetail.astro 及其专属样式）
- 顶部阅读进度：2px，`--ac-edge`，fixed 在导航下方。
- H1 下：1px 光轨 + HUD kicker（日期 ◆ 分类 ◆ 字数）。
- H2：左侧 3px 渐变竖条 + 6px 上切角；H3 用 2px 短横线；不改变正文行高与字号。
- 引用块：左侧 2px 金缮线 #d8b365 + `rgba(216,179,101,.08)` 底；引号用 `--ac-gold`。
- Callout：note→sky、tip→pure、warning→far、danger→lost，仅换边线与图标色。
- 代码块保持现有 Arcaea Prism 主题，不重写 token 颜色。
- 行内链接：下划线用 1px `--ac-edge-soft`，hover 变实线并加 `text-underline-offset: 3px`。
- 右侧 TOC：玻璃面板 + 10px 切角；当前项左侧 2px 光轨 + 文本 `--ac-ice`；折叠按钮 28px 玻璃圆。
- 页脚：顶部 1px 光轨，站点名用 `.ac-kicker`，链接 hover 出现 1px 下划线（不用整行变色）。

### 3.6 移动端
- 导航 24px 模糊、卡片 16px、抽屉 20px；正文不模糊。
- 安全区 `env(safe-area-inset-*)`；触摸目标 ≥ 40px。
- 所有 hover 效果必须有非 hover 的等价信息（边框/文字色），触屏不依赖 hover。

## 4. 动效与无障碍
- 时长 180/260/420ms，缓动 `--ac-ease`；只动 transform / opacity / border-color / filter。
- `prefers-reduced-motion: reduce` 时关闭所有位移与呼吸，保留状态色。
- 正文文本对比度 ≥ 4.5:1（`--ac-text` 在 `--ac-bg` 上约 13:1，安全；`--ac-text-dim` 只用于 12px 以上的元信息，且不得承载唯一信息）。
- 焦点环统一 `--ac-ring`，不允许 `outline:none` 而无替代。
- 切角/判定色都只是增强，删除后信息仍完整。

## 5. 不要做
- 不引入新字体、不引入 React、不动构建产物体积策略。
- 不改 `src/styles/legacy-article-reference.css`、`public/assets/plugin/arcaea-article-content.css`（canonical 798 像素基线）。
- 不把光轨铺满整页背景，不做彩虹渐变，不做玻璃拟态叠玻璃超过两层。
- 不照搬 Arcaea 的游戏 UI 布局（曲目列表/判定条），只借材质与形状语言。

## 6. 文件所有权（并行施工，避免冲突）
- **根/指挥**：`src/styles/arcaea-prism.css`、`src/layouts/Layout.astro` 的 import、本规范、最终构建验证。
- **A（首页表面）**：`src/components/layout/SakurairoHomeHeader.astro`、`PostCard.astro`、`LegacyPostCard.astro`、`CategoryBar.astro`、`ExhibitionArea.astro`、新增 `src/styles/arcaea-home.css`。
- **B（文章表面）**：`src/components/layout/PostDetail.astro`、`Footer.astro`、`FloatingControls.astro`、`src/styles/toc.css`、`legacy-footer.css`、新增 `src/styles/arcaea-article.css`。
- **C（自动构建）**：`.github/workflows/*`、`scripts/verify-dist.mjs`、构建文档。

## 7. 验收
- 视觉：首页 / 文章页 / 归档 / 搜索 四类页面在 1440、1024、390 三档无溢出、无纯白残留、无对比度不足。
- 工程：`pnpm check`、`pnpm type-check`、`pnpm build` 通过；构建产物含 Pagefind 与字体子集。
- 回归：canonical 798 文章渲染不受影响（不改其样式文件）；首页卡片数量与链接不变。

## 8. 实现状态（2026-11-22）

### 8.1 已落地
| 层 | 文件 | 内容 |
| --- | --- | --- |
| 令牌/工具类 | `src/styles/arcaea-prism.css`（4704 B） | `--ac-*` 令牌、`.ac-panel` `.ac-panel--strong` `.ac-rail-top` `.ac-chamfer` `.ac-kicker` `.ac-divider` `.ac-focus` `.ac-state--pure|far|lost` |
| 全局入口 | `src/layouts/Layout.astro` | `babel36acl.css` 之后 `import "@/styles/arcaea-prism.css"` |
| 首页表面 | `src/styles/arcaea-home.css`（459 行）、`SakurairoHomeHeader.astro`、`CategoryBar.astro` | 顶栏透明→滚动 64px 玻璃条+顶缘光轨、胶囊导航、分类 6px 切角、卡片 10px 切角+封面 scrim+hover 上移 |
| 文章表面 | `src/styles/arcaea-article.css`、`PostDetail.astro`、`Footer.astro`、`FloatingControls.astro`、`toc.css`、`legacy-footer.css` | H1 下光轨+字数/时长 kicker、H2 3px 竖条、引用金缮、TOC 玻璃+10px 切角、页脚光轨、2px 阅读进度（`body:has(#post-container)` 门控） |
| 自动构建 | `.github/workflows/build.yml`、`deploy.yml`、`scripts/verify-dist.mjs`、`docs/build-and-deploy.md` | 单次 `pnpm build` 产出 artifact，`deploy.yml` 用 `workflow_run` 复用该 artifact，不再重复构建 |

### 8.2 边界处理
- **canonical 798 不受影响**：`LegacyArticleDetail.astro:38` 的 body 带 `legacy-article` 类，文章表面新规则全部挂在 `body:not(.legacy-article):not(.legacy-post-list)` 下；legacy 页的页脚排版另有还原规则。
- **正文不切角不模糊**：切角只作用于卡片/按钮/面板容器，正文段落、表格、代码块保持原样。
- **reduced-motion**：HomeHeader、卡片 hover、滚动提示均有 `prefers-reduced-motion: reduce` 分支。
- **无 backdrop-filter 回退**：`@supports not (backdrop-filter: blur(1px))` 时玻璃面板落回不透明 `--ac-surface`。

### 8.3 已知风险与取舍
1. 卡片 `clip-path` 会裁掉外层 `box-shadow`：以 1px 冷边 + 顶缘光轨 + hover 上移 3px 补偿，Arcaea 面板本就偏平面。
2. H2 竖条用 `left: -0.85rem`（≤640px 为 `-0.6rem`）挂在标题外侧，依赖正文 gutter；若未来改 markdown 容器内边距需同步。
3. 阅读进度条依赖 `animation-timeline: scroll()`，不支持的浏览器不显示（纯装饰，不影响阅读）。
4. CI 令牌检查容忍 `inlineStylesheets: auto` 的内联：`_astro/*.css` 未命中时会回落查 `public/` 与 `dist/*.html`，只告警不失败。

## 9. 验收结果

| 项 | 命令/方式 | 结果 |
| --- | --- | --- |
| 类型 | `tsc --noEmit --isolatedDeclarations -p tsconfig.json`（与 CI 的 `pnpm type-check` 同参） | exit 0 |
| Astro 语法 | 逐文件 `@astrojs/compiler` transform（临时脚本，验完即删） | 125/125 通过 |
| CSS 语法 | postcss 解析 arcaea-prism.css / arcaea-home.css / arcaea-article.css / toc.css | 通过 |
| 新增文件的 lint | `biome check scripts/verify-dist.mjs src/components/layout/PostDetail.astro` | 通过（CSS 由 biome.json 忽略，不在 lint 范围） |
| 产物自检 | `node scripts/verify-dist.mjs` | 旧产物：五项通过，仅 `--ac-sky` 缺失（旧构建早于 Prism 层）；fixture 验证内联分支通过 |
| 依赖锁 | `pnpm-lock.yaml` importers 与 package.json 逐项比对 | 无 missing / drift / 多余项，`--frozen-lockfile` 可用 |
| 冻结文件 | mtime 比对 | `babel36acl.css`、`legacy-article-reference.css`、`public/assets/plugin/arcaea-article-content.css` 均未改动 |

**未做**：本地 `pnpm build`。原因：本机只有 Node v26，Astro 7 的 vite 8 依赖在 `require` 上失败（`picomatch/index.js:6`），且 Node 22 无法下载。**完整构建与视觉回归必须在 GitHub Actions（Node 22）上跑**：push 到 master 触发 `Build and Check`，成功后 `Deploy` 会自动取用同一份 artifact。

## 10. 后续可选增强
- 首页 Hero 标题加冷光渐变描边（需先在浅色层验对比度）。
- 归档/搜索页套用同一套卡片切角（目前只覆盖首页与文章页）。
- 全仓跑一次 `biome check --write`：仓库里尚有若干与本次改动无关的旧格式漂移（如 `Footer.astro` 的 `interface Props` 单行、`SakurairoHomeHeader.astro` 的 links 数组缩进），本次未顺手改以免制造无关 diff。

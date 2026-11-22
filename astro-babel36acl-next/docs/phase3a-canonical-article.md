# Phase 3A — Canonical Article Detail Fidelity

验收日期：2026-10-08。结论：**PASS（按用户明确要求省略评论）**。范围仅限 canonical 798；本轮没有开展 Phase 3B，没有部署、提交或修改远端 WordPress。

## Canonical 与内容保护

- 标题：**HPM SDK Cmake 开发记录**；legacy ID：**798**。
- [WordPress 原站](https://babel36acl.xyz/2026/05/29/hpm-sdk-工程化开发指南：环境搭建到双核部署/)
- [Astro 本地预览](http://127.0.0.1:4323/2026/05/29/hpm-sdk-工程化开发指南：环境搭建到双核部署/)
- 内容源：`src/content/posts/wp-798.md`。
- 选择依据：扫描 44 篇迁移内容，结构评分最高的一组中对 8 条真实文章路由确认 HTTP 200；798 覆盖多级长文、代码、表格、引用、列表、TOC、Mermaid、作者／分类／日期／统计、版权和相邻文章。
- 恢复后的实际内容：88 个标题（12 H2、54 H3、22 H4）、306 段正文、46 个普通代码块、11 个 Mermaid、4 张表格。初始 inventory 的额外标题／段落来自迁移损坏，不作为最终结构计数。
- 原始导出与真实 WordPress 可共同证实的损坏，按用户授权修复：4 个代码块中的 `#` 注释，以及 9 处被转换器改成 `<br/>` 的 Mermaid 多行标签。其余 2 个 Mermaid 源本来一致。
- 转换器在原始 HTML `<pre>` 和 Markdown fence 内保留 `#`；停止改写 Mermaid 标签内容。没有批量重跑迁移器。
- `content-integrity.json` 逐个比对全部 57 个代码／图表源、88 个标题及 306 段正文，全部一致；4 个针对性转换回归用例通过。
- 用户已有 `../astro-babel36acl/src/content/articles/legacy-526/index.md` 保持原样，SHA256：`DD2503F7B8FA5CE8723E35D21A81CFEBD645D573FF586A6819C2C2515BD0E575`。

## Reference qualification

权威参考为本地只读通道连接的真实 WordPress：`127.0.0.1:18081 → SSH tunnel → WordPress`。文章未使用首页 frozen HTML。

最终资格化文件：`reports/visual/phase3a/reference-798/qualification-final.json`。

| 项目 | 结果 |
| --- | --- |
| HTTP / DOM | 200；body 存在；readyState complete；DOMContentLoaded / load 均触发 |
| 请求 / 响应 | 218 / 218 |
| 失败请求 / HTTP ≥ 400 | 0 / 0 |
| console errors / page errors | 0 / 0 |
| Critical CSS | 23 个外链 stylesheet 均已加载 |
| Fonts | document.fonts.ready；无 error 字体；实际使用字体加载完成 |
| 图片 | 非 lazy 图片有效；未展开评论表情的 lazy 图片不作为失败资源 |
| 图表运行时 | 11 / 11 Mermaid SVG 完成 |

初始资格化快照中曾有一个 ELK 模块仍在加载，已保留为历史诊断；最终快照明确等待全图表就绪。代理的 keep-alive socket reset 在本地 transport 修复；未改生产服务器、数据库、防火墙或公开路由。

Prism 等实际使用资源与 live 版本校验一致；Mermaid 使用 live 的 105 个模块依赖闭包，记录在 `mermaid-vendor-provenance.json`。本地插件 checkout 内的 Mermaid 版本曾与线上不同，不能以本地插件名称相同推断运行产物相同。同步工具现按“复制本地资源 → live Mermaid 闭包覆盖”执行。KaTeX 不在此文出现，其本地／远端版本差异作为 Phase 3B 前的未验证项保留，未声称公式能力通过。

## DOM 与责任归属

实际 Reference / Candidate 精简结构：

```text
body
├─ .site-header（共享 Header 的文章状态）
├─ #main-container
│  ├─ #page.site.wrapper（文章页不持有 current_blur）
│  │  ├─ .blank
│  │  └─ #content.site-content > #primary > #main
│  │     ├─ .has-toc
│  │     ├─ article
│  │     │  ├─ .entry-header > .entry-title + .entry-census + hr
│  │     │  ├─ .entry-content > .arcaea-article-content
│  │     │  └─ .post-footer
│  │     ├─ .toc-container > .toc
│  │     └─ .post-squares.nextprev
│  └─ #colophon.site-footer
├─ .background_blur.current_blur
├─ #moblieGoTop / #changskin
└─ .skin-menu + effects
```

原 Candidate 的 Firefly 文章外壳／正文包裹方式与上述结构不符，且其整篇 Markdown 解析会把原始 HTML 内代码注释变成正文结构。本轮由专用 renderer 恢复混合源中的标题和 Mermaid，不对整个原始 HTML 二次 Markdown 排版。恢复原生容器、标题／元信息、TOC 层级、文章底栏及相邻文章顺序；不靠逐段位移补偿。

最终差异：评论节点与评论元信息入口按用户要求移除；其余主要 Article 语义节点及父子／顺序关系已恢复。脚本、效果挂载与构建器生成节点不要求字面相同。

| 责任 | 文件 |
| --- | --- |
| Article shell、title、meta、article bottom、相邻文章 | `src/components/layout/LegacyArticleDetail.astro` |
| 正文结构和 heading IDs | `src/utils/legacy-article-renderer.ts` |
| 正文 typography、富文本原生绘制 | `src/styles/legacy-article-reference.css`（文章 scope） |
| reset 修正、文章状态与布局连接 | `src/styles/legacy-article.css` |
| 代码与图表 | `public/assets/legacy-code/`，原生 BAC runtime / Prism / Mermaid |
| TOC 结构与交互 | `LegacyArticleToc.astro`、`src/scripts/legacy-article.ts`、native Tocbot module |
| 页首／页脚 | 共享 `SakurairoHomeHeader.astro`、`Footer.astro` 的文章分支 |

仅 canonical 798 路由启用该 layout，其余文章保留现有路由行为。文章 CSS 与 keyframes 已限定范围；没有向首页堆入 Article 规则。

## Geometry、Typography 与静态 gate

所有像素结果使用与首页既有 gate 相同的 **RGB 最大通道差 > 12 算差异**，门槛 ≥ 99%。不是逐字节／零容差相同。

| 视口 | 全文匹配 | Ref / Candidate 文档高 | shell / title / meta / content / footer 最大偏差 | 394 个正文块最大累计偏移 | 结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| 390 × 844 | 99.863% | 96382 / 96382 | 0 CSS px | 0 CSS px | PASS |
| 768 × 1024 | 99.809% | 67239 / 67239 | 0 CSS px | 0 CSS px | PASS |
| 1272 × 720 | 99.867% | 62553 / 62553 | 0 CSS px | 0 CSS px | PASS |
| 1440 × 900 | 99.883% | 62553 / 62553 | 0 CSS px | 0 CSS px | PASS |

`reports/visual/phase3a/article-typography-contract.json` 保存四视口每类实际元素的 Reference / Candidate computed styles、rect 与差异判定。不存在的 a、em、del、mark、正文 H1/H5/H6、thead、figcaption 等明确 N/A，未用假内容填充覆盖。

| 元素 | Reference = Candidate 的主要字体参数 |
| --- | --- |
| p / strong / li | Zen Old Mincho；16px；line-height 29.12px |
| H2 | Zen Old Mincho；26.4px；700；line-height 34.848px |
| H3 | Zen Old Mincho；21.12px；700；line-height 28.512px |
| H4 | Zen Old Mincho；17.92px；700；line-height 25.088px |
| pre / block code | FiraCode Nerd Font 字体栈；15px；line-height 25.5px |
| inline code | FiraCode Nerd Font / Fira Code / JetBrains Mono / Consolas；14.72px |
| ul / ol / blockquote / table | 16px；line-height 24px；原生 marker、边距、padding 和边框 |

字体、字号、字重、行高、字距、文字阴影、间距和可见边框通过。少量 computed 字符串不同但 browser-equivalent：零宽 border 的 none/solid；tr 只有零宽侧边不同；空 hr 的未参与绘制 foreground color 不同，其显式背景及零宽边框一致。判定与原始值均保留，不抹去差异记录。

| 独立组件 | 四视口匹配范围 | 结果 |
| --- | ---: | --- |
| Title | 99.760%–100% | PASS；换行一致 |
| Meta | 99.982%–99.986% | PASS；使用原 Font Awesome webfont primitive |
| Header | 99.224%–99.615% | PASS |
| Desktop TOC | 100% | PASS；小视口静态侧栏 N/A，手机目录另测 |
| Code / blockquote / table | 100% | PASS |
| Mermaid 示例区 | 99.825%–99.943% | PASS；所有图表由完整正文 gate 覆盖 |
| Article bottom / previous-next | 100% | PASS |
| Site footer | 99.815%–100% | PASS；真实底部视口裁剪 |

每个 viewport 文件夹保存 `reference-full.png`、`candidate-full.png`、`absolute-diff.png`、`binary-mask.png` 以及独立分区图、geometry 和全部 paragraph rhythm：`reports/visual/phase3a/static/`。

测量方法：长页达到 6.3–9.6 万像素，Chromium 超大 fullPage／locator 截图曾丢失 SVG、backdrop 文字或绘出视口外面板。最终全文图由真实视口沿原始文档坐标分片拼接，不改文档高；固定 UI 在首片保留，滚动状态独立测量。页脚由真实底部视口截取。原始 WordPress fullPage 图作为诊断保留，不作为通过依据。

静态归一化仅涉及：用户取消的评论、已导入阅读量 528、随机 quote／服务器性能文字、两端同一 gallery 图片和动画冻结。原始评论参考图另存。正常页面仍保留懒加载；测试等实际图片加载后再截图，不依赖原站不会移除的 lazyload 类名。

## 富内容与动态验证

动态测试使用真实时钟，无 static stabilize CSS。手机 390 和桌面 1440 保存 top、TOC、copy、Mermaid overlay、25%／50%／75%／bottom 状态截图。

| 功能 | Reference | Candidate | 状态 |
| --- | --- | --- | --- |
| TOC 层级／折叠结构 | 88 标题 | 同样 88 标题 | PASS |
| TOC 点击目标 | 桌面约 80.41px；手机约 79.56px | 同值；不被 Header 遮挡 | PASS |
| 手机 TOC | 可打开 | 可打开、点击后关闭 | PASS |
| TOC scroll active | 本文滚动时原站 active 存在停留首项的行为 | 使用同一 native Tocbot 行为 | PASS（保留原站行为） |
| 复制 | copy-success；86 字符 | copy-success；86 字符 | PASS |
| 代码折叠 | 可展开／收起 | 同行为 | PASS |
| 代码与表格溢出 | 此文内容按原站 wrap；body 无横向溢出 | 同行为 | PASS；不强造横向滚动 |
| Mermaid 大图 | overlay 可打开／Escape 关闭 | 同行为 | PASS |
| Reading progress | 0 / 25 / 50 / 75 / 100% | 差异小于 0.001 个百分点 | PASS |
| Footer | 近底部 show，顶部隐藏 | 同责任／几何 | PASS |
| 控制面板、回到顶部 | 打开；回顶到 0；滚动收起 | 同值 | PASS |
| 正文图片／多图／lightbox | 此文无正文图片；44 篇原始源亦无此覆盖 | 未新增 | N/A |
| Math / video / shortcode | 此文没有 | 未扩展 | N/A |

作者头像和相邻文章背景均使用实际原站图源／既有 gallery；相邻顺序为步进电机文章（previous）→ 本文 → Flutter HMI 文章（next）。原站没有额外分享／related-post 模块的部分不新增。评论、验证码和评论提交接口按用户要求完全省略，没有发送测试评论。

动态证据：`reference-interactions/audit.json`、`candidate-interactions/audit.json`、`final-smoke.json`。两端 page errors 均为 0。

## Home ↔ Article lifecycle

真实 WordPress 与 Candidate 均完成三轮 Home → Article → Home，每一轮均记录 timeOrigin、所有 blur owner 的 class、backdrop-filter、background、position、z-index、wallpaper 和实例／计时器／监听器。

- Reference 首页：`#page.current_blur`；文章：`#page` 移除该类，`.background_blur.current_blur` 承担固定背景玻璃；回首页恢复。
- Candidate 首页：既有 `#content-panel` 承担首页玻璃；文章：`.background_blur.current_blur` 承担相同文章责任；回首页恢复原首页 owner。
- 两端 glass 为 saturate(1.2) blur(8px)，文章 wallpaper 由 body 固定背景承担。完整逐阶段 style / geometry 在各自 lifecycle audit 内。

| 文章采样，每轮 | Reference 第 1 / 2 / 3 轮 | Candidate 第 1 / 2 / 3 轮 |
| --- | --- | --- |
| canvas / Sakura | 每轮 2 / 1 | 每轮 2 / 1 |
| TOC / toolbar / Mermaid SVG | 每轮 1 / 46 / 11 | 每轮 1 / 46 / 11 |
| intervals / pending timeouts / pending main-thread rAF | 每轮 0 / 0 / 1 | 每轮 1 / 0 / 0 |
| global listeners | 81 / 81 / 81 | 67 / 67 / 67 |
| connected-node listeners | 804 / 804 / 804 | 527 / 527 / 527 |

每次回到首页，TOC／toolbar／Mermaid 实例恢复为 0；Sakura 保持 1，canvas 保持 2。Candidate 首页 global listeners 每轮 122，intervals 1，pending timeouts 3；connected listeners 251 / 253 / 267，随随机 medal 粒子数量而变，且每轮是新 document。

**证据边界：**本次成功的三轮是实际链接导航，timeOrigin 每次变化。Reference 在只读代理下采用可完成的键盘链接导航，Candidate 为鼠标点击；证明当前整页往返无实例积累及视觉责任正确，不声称已证明跨 PJAX 的同文档内存释放。原站鼠标 PJAX 路径曾出现导航 fallback 竞态，原始失败记录保留。pending rAF 计数不覆盖 OffscreenCanvas Worker 内部帧循环；Sakura 的持续绘制另由真实画面变化验证。

## Homepage regression 与工程验证

`Homepage Phase 2C allPass = true`，最终再次运行结果：

| 视口 | Homepage pixel match |
| --- | ---: |
| 390 | 99.657% |
| 768 | 99.794% |
| 1272 | 99.463% |
| 1440 | 99.442% |

实时抽查：Sakura 单实例且画面继续变化；Typewriter 从空到完整句子；Navbar 顶部／滚动几何及 glass 未变；Medal 实际触发 tilt、tooltip opacity 1、粒子已创建；首页 top／scroll blur owner 正确。没有静态 CSS 或冻结 Date 参与这些动态证据。

- `pnpm check`：272 files，0 errors / 0 warnings / 0 hints。
- `pnpm type-check`：exit 0。
- `pnpm build`：exit 0；Pagefind 完成。中文 stemming 提示属于既有工具能力说明。
- Content integrity：PASS。
- Article 四视口 static / component / geometry / typography：PASS。
- 当前整页导航路径的三轮生命周期及手机／桌面主要动态交互：PASS。

## Residual 分类与下一阶段边界

| 分类 | 说明 |
| --- | --- |
| Candidate bug | 本轮验收范围内未发现阻断项；非零像素残差集中在字形抗锯齿、小图标／Header 等，分区均 ≥ 99%。这不是所有文章／所有交互状态的全面保证。 |
| Reference limitation | 本文 native Tocbot active 保持首项的行为保留；代理下鼠标 PJAX fallback 竞态未修改远站。 |
| Measurement limitation | 超长页截图合成问题通过真实视口分片与 viewport crop 解决；静态 gate 会冻结随机内容，动态状态另测；监听器统计不等于浏览器堆内存分析。 |
| Intentional deviation | 用户明确不需要评论，移除评论区及入口；显示的阅读量和服务器性能文字为迁移快照，不代表 Astro 实时 WordPress 查询指标。 |
| 未覆盖能力 | 图片型正文、lightbox、Math、video、shortcode；KaTeX 本地版本差异尚未开展行为验证。 |

Phase 3A 已具备进入 Phase 3B 的条件。本轮仍停留在单篇 canonical 范围，未将 layout 扩散到其他文章。下一阶段应以同一 layout 验证复杂／短文／代码等可用真实样本；图片型内容需要真实来源样本后才能声明覆盖。

## 复验入口

服务就绪后，既有工具可重复运行：

```powershell
$env:FINAL_QUALIFY='1'
node tools/visual/article-qualify.mjs
node tools/visual/article-contract.mjs reference
node tools/visual/article-contract.mjs candidate
node tools/visual/article-content-integrity.mjs
node tools/visual/article-static-gate.mjs
node tools/visual/article-interactions.mjs reference
node tools/visual/article-interactions.mjs candidate
node tools/visual/article-lifecycle.mjs reference
node tools/visual/article-lifecycle.mjs candidate
node tools/visual/article-final-smoke.mjs
$env:CANDIDATE_URL='http://127.0.0.1:4323'
node tools/visual/phase2c-full-page-gate.mjs
node tools/visual/article-summarize.mjs
pnpm check
pnpm type-check
pnpm build
```

不要运行 bulk migration 作为复验；`article-repair-source.mjs` 是一次性迁移修复记录，也不应重复执行。参考同步工具会读取当前线上资源；将来线上版本变化后需要重新资格化及 gate，不能直接继承本次 PASS。

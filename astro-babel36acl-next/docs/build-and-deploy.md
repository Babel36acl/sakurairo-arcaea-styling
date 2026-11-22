# 构建与部署管线

本文描述 GitHub Actions 上的构建/部署实现，涉及三个文件：

| 文件 | 作用 |
|---|---|
| `.github/workflows/build.yml`（name: `Build and Check`） | **唯一的构建入口**：install → check → type-check → build → 产物自检 → 上传 `github-pages` artifact |
| `.github/workflows/deploy.yml`（name: `Deploy to GitHub Pages`） | 部署：复用 CI 产物（默认路径），或手动重跑一次完整构建后部署 |
| `scripts/verify-dist.mjs` | 零依赖产物自检，CI 在 `pnpm build` 之后直接 `node` 运行 |

> 两个 workflow 的 `name` 是耦合的：`deploy.yml` 用 `workflow_run.workflows: [ "Build and Check" ]` 监听 `build.yml`。改动 `build.yml` 的 `name` 时必须同步 `deploy.yml`，否则部署不再被触发。

## 管线一览

```
push / PR → master
        │
        ▼
┌───────────────────── Build and Check（build.yml）──────────────────────┐
│ checkout                                                              │
│   → pnpm/action-setup@v4        version: 11.22.0（= packageManager）   │
│   → actions/setup-node@v4        Node 22，cache: pnpm                 │
│   → pnpm install --frozen-lockfile                                    │
│   → pnpm check                  astro check                           │
│   → pnpm type-check             tsc --noEmit --isolatedDeclarations   │
│   → pnpm build                  完整产物管线下文「pnpm build 做了什么」 │
│   → node scripts/verify-dist.mjs                                      │
│   → touch dist/.nojekyll                                              │
│   → actions/upload-pages-artifact@v3   （artifact 名：github-pages）    │
└───────────────────────────────────────────────────────────────────────┘
        │ workflow_run: types [completed]，branches [master]
        │ 且 github.event.workflow_run.event == push && conclusion == success
        ▼
┌──────────────── Deploy to GitHub Pages（deploy.yml）───────────────────┐
│ actions/download-artifact@v4   name: github-pages, run-id: CI 的 run   │
│   → 解包 artifact.tar 到 dist/                                        │
│   → touch dist/.nojekyll                                              │
│   → actions/upload-pages-artifact@v3   在本 run 重新打包一次           │
│   → actions/deploy-pages@v4            环境：github-pages              │
└───────────────────────────────────────────────────────────────────────┘
```

为什么 deploy 里要「下载 → 解包 → 重新上传」：`actions/deploy-pages@v4` 只解析**当前 run** 里的 `github-pages` artifact（actions/deploy-pages#338 仍未支持按 artifact id 部署），跨 run 直接部署会报 `No artifacts named github-pages were found for this workflow run`。因此 workflow_run 这条路径必须先把 CI 的产物落到本 run 再部署。

## 触发与权限

- `build.yml`：`push`/`pull_request` → `master`；`concurrency: ${{ github.workflow }}-${{ github.ref }}` + `cancel-in-progress: true`（同一分支新推送取消旧构建）；`permissions: contents: read`；单 job，`timeout-minutes: 30`。
- `deploy.yml`：`workflow_run`（`Build and Check` + `completed` + `master`）与 `workflow_dispatch`；`permissions: contents: read, actions: read, pages: write, id-token: write`（`actions: read` 是跨 run 下载 artifact 必需的）；`concurrency: group: pages, cancel-in-progress: false`（不打断进行中的发布）；`environment: github-pages`。
- PR 触发的 CI 也会产生 `workflow_run`，所以 deploy job 的 `if` 额外要求 `workflow_run.event == 'push'`，fork/PR 的构建不会发布到生产。

## 本地等价命令

Node 22.x（`engines.node >= 22.23.0`）、pnpm 11.22.0（`packageManager` + `.npmrc` 的 `manage-package-manager-versions = true` 会强制这个版本）：

```bash
pnpm install --frozen-lockfile   # CI 用；本地首次可省略 --frozen-lockfile
pnpm check                        # astro check
pnpm type-check                   # tsc --noEmit --isolatedDeclarations
pnpm build                        # 完整管线，输出 dist/
node scripts/verify-dist.mjs      # 与 CI 相同的产物自检
pnpm preview                      # 本地预览 dist（构建后）
```

`pnpm build` 做了什么（**不要**在 CI 里拆开或换成 `astro build`）：`generate-github-card-data` → `generate-lqips` → `generate-vndb-covers` → `astro build` → `prune-pio-assets` → `subset-fonts` → `minify-inline-scripts` → `run-pagefind`。改用 `astro build` 会漏掉 LQIP、VNDB 封面、字体子集、内联脚本压缩和 Pagefind 索引。

设置了 `CF_WORKERS`（Cloudflare adapter）时产物根目录是 `dist/client`，此时自检要显式传目录：

```bash
node scripts/verify-dist.mjs dist/client
# 或 DIST_DIR=dist/client node scripts/verify-dist.mjs
```

## 产物自检：scripts/verify-dist.mjs

零依赖（只用 `node:fs/promises`），因此本地/CI 都不需要额外安装；失败时以退出码 1 结束并把原因汇总打印到 stderr。

校验项：

1. 关键产物存在且非空：`index.html`、`404.html`、`pagefind/pagefind.js`、`sitemap-index.xml`、`rss.xml`。
2. `dist` 下 `.html` 数量 ≥ 60（可用 `MIN_HTML_FILES` 覆盖），用于发现内容集合被清空或构建提前中断。
3. `dist/_astro/` 下每个 `.css` 都非 0 字节。
4. 打包后的 CSS（`dist/_astro/*.css`）包含 `--ac-sky`（Arcaea Prism 令牌层，来自 `src/styles/arcaea-prism.css`，由 `src/layouts/Layout.astro` 导入）与 `--bac-code`（代码块主题令牌，主要来自 `public/assets/legacy-code/`）。
   - 做法：先查 `_astro/*.css`；没命中再查 `public/` 下的 CSS 与 `dist/*.html`（`astro.config` 的 `build.inlineStylesheets: auto` 会把 < 4 kB 的样式内联进 HTML）。只有全站都找不到才**失败**，说明 Prism 样式没有被真正 import；落在内联 HTML 里或 public 拷贝里只打 ⚠️（提示"可能被内联"）。
   - `--bac-code` 同样三级回落，命中最宽的一级时告警不失败（代码块令牌主要来自 public 拷贝）。

CSS 可能被 esbuild 压成单行，因此脚本用 `String.prototype.includes` 做包含判断，不要改成按行正则。

## 常见失败排查

**Node 版本**

- `ERR_PNPM_UNSUPPORTED_ENGINE` / `Unsupported engine`：用了非 22.x。CI 固定 Node 22；本地请切到 22.x（见 `package.json` 的 `engines.node`）。Node 26 目前与 Astro 7 不兼容，不要用新 Node 跑构建。
- `pnpm: command not found` 或 `setup-node cache: pnpm` 报错：`pnpm/action-setup` 必须排在 `actions/setup-node` **之前**（cache 依赖 PATH 上的 pnpm），顺序不要调换。

**frozen-lockfile**

- `ERR_PNPM_OUTDATED_LOCKFILE`：`pnpm-lock.yaml` 与 `package.json` 不一致。本地用同一 pnpm 版本执行 `pnpm install` 并提交 lockfile；**不要**把 CI 改成 `--no-frozen-lockfile`，那会让 CI 结果与提交内容脱钩。
- 换 pnpm 大版本会改写 lockfile 格式，pnpm 版本必须与 `package.json` 的 `packageManager`（11.22.0）一致。

**Pagefind**

- `pagefind: command not found` / 索引为空：Pagefind 是 `pnpm build` 的最后一步（`scripts/run-pagefind.ts`），索引写到产物根目录的 `pagefind/`。构建被中途打断、或产物根目录判断错（`CF_WORKERS` 时是 `dist/client`）都会导致 `pagefind/pagefind.js` 缺失。
- 搜索面板里内容缺失：检查 `pagefind.yml` 的排除规则（`span.katex`、`[data-pagefind-ignore]`、`.search-panel` 等），以及被排除页面是否真的不该被索引。

**字体子集化**

- `scripts/subset-fonts.ts` 在 `fontConfig.enable` 为 true 时，按 `fontConfig.fontsList` 生成 woff2 子集到 `_astro/fonts`；字体源文件缺失、路径写错或 `subsetFonts` 配置与字体不匹配时会在这里失败（构建链是 `&&` 串联，失败不会静默跳过）。
- 若站点不使用自托管字体，确认 `fontConfig.enable` 是 `false`，脚本会 no-op。

**部署相关**

- `No artifacts named github-pages were found for this workflow run`：deploy run 里没有重新上传 artifact。确认 deploy.yml 的 `Upload Pages artifact` 步骤存在且没被 `if` 跳过。
- `Artifact not found for run-id ...` / 下载 404：CI run 的 artifact 已过期（`upload-pages-artifact` 默认保留 1 天），或该 run 根本没跑到上传步骤。重新触发一次 `Build and Check` 即可。
- `Get Pages site failed` / 部署被拒：仓库 Settings → Pages → Build and deployment 的 Source 必须是 **GitHub Actions**，环境 `github-pages` 存在且允许 `master` 部署。
- `Deployment failed, try again later`：多为 Pages 侧暂时性错误或并发部署，重跑 deploy job。

## 只重跑部署

1. **推荐**：Actions → `Deploy to GitHub Pages` → *Run workflow*（`workflow_dispatch`）。这条路径会在 deploy run 内重跑 install/check/type-check/build/verify 再部署——因为 `GITHUB_TOKEN` 无法跨 run 复用 artifact，`deploy-pages` 也只认本 run 的产物。步骤与 `build.yml` 必须保持同步（改一处要改两处）。
2. **CI 刚跑完、只想重发**：在 `Deploy to GitHub Pages` 的那次 run 上 *Re-run all jobs*（artifact 保留期内有效）。
3. 想重新构建后再发：Actions → `Build and Check` → *Re-run all jobs*，成功后 deploy 会被 `workflow_run` 自动触发；或在 `master` 上新推一个提交。

## 改动约定

- 不要改 `package.json` 的 `build` 链来「简化 CI」；CI 只调用 `pnpm build`。
- 不要新增构建依赖：`verify-dist.mjs` 刻意保持零依赖。
- 改 `build.yml` 的 `name` 要同步 `deploy.yml` 的 `workflow_run.workflows`；改构建步骤要同步 `deploy.yml` 的手动部署步骤。

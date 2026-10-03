# Sakurairo Arcaea WordPress

统一维护博客技能、主题部署补丁和独立 Mermaid 插件的主仓库。生产渲染插件 [babel-arcaea-code](https://github.com/AKCX2002/babel-arcaea-code) 保持独立发布，以子模块固定版本。

## 目录与职责

| 路径 | 维护内容 |
| --- | --- |
| `babel-arcaea-code/` | 独立子模块，生产插件 v1.6.85；Prism、Mermaid、Markmap、KaTeX/MathJax |
| `babel-arcaea-mermaid/` | 合并后的独立 Mermaid 插件；供未使用统一插件的站点使用，不与生产统一插件重复启用 |
| `sakurairo-arcaea-blog-skill/` | 合并后的博客写作、排版与发布技能 |
| `sakurairo-theme/` | 合并后的 Sakurairo 使用技能与参考文档，**不是运行主题源码** |
| `theme-patches/` | 上游 Sakurairo 的本地修复及生产部署记录 |
| `deployment/` | 保留本地补丁的服务器主题更新器 |
| `wordpress-dm1-calculator/` | 原有独立工具子模块 |

运行主题来自 [mirai-mamori/Sakurairo](https://github.com/mirai-mamori/Sakurairo)，线上当前基于 3.0.11 加本仓库补丁。公式使用 KaTeX；部署详情和回滚位置见 [主题部署记录](theme-patches/README.md)。

## 获取和维护

```sh
git clone --recurse-submodules https://github.com/AKCX2002/sakurairo-arcaea-styling.git
cd sakurairo-arcaea-styling
git submodule update --init --recursive
```

技能和主题补丁直接在本仓库修改、提交。生产插件先在其独立仓库发布，再更新本仓库 gitlink；不要用 `submodule update --remote` 随意替换已验证的生产版本。

技能安装：

```sh
bash sakurairo-arcaea-blog-skill/install.sh
bash sakurairo-theme/install.sh
```

安装器包含 `references/` 和 `scripts/`，也可通过各 README 的远程安装入口使用。

## 发布与部署

- Astro Markdown 文章和 VPS/OpenResty 发布流程见 [`docs/astro-markdown-publishing.md`](docs/astro-markdown-publishing.md)。日常只需在 `astro-babel36acl/src/content/articles/<slug>/index.md` 写 Markdown；本地构建通过后推送 `main`，GitHub Actions 会生成静态包，并在配置 VPS secrets 后原子切换远端 `current` 版本链接。
- `.github/workflows/mermaid-release.yml` 统一承接独立 Mermaid 插件的构建、发布及依赖检查。根仓库 `v1.x` Release 和 zip 对应此插件，不能作为整站部署包。
- `babel-arcaea-code` 继续使用自身仓库的 CI 与 Release，生产站点不切换到旧 Mermaid 插件。
- 主题更新器先获取上游 main、应用本地补丁、检查 PHP，再备份切换。检测到未记录的本地修改或补丁冲突时停止。完整文章及页脚检查失败时回滚。
- 新增主题修改应同步 `theme-patches/navigation-accessibility.diff` 与服务器 `/etc/sakurairo-theme/local-overrides.patch`，不能直接覆盖线上后等待定时更新。

## 迁移与历史

2026-09-06 使用不压缩历史的 Git subtree 合并：

| 原仓库 | 导入提交 | 新路径 |
| --- | --- | --- |
| AKCX2002/babel-arcaea-mermaid | `a2ad4f86e5a99b42beb735bc0ef676be84130125` | `babel-arcaea-mermaid/` |
| AKCX2002/sakurairo-arcaea-blog-skill | `de9fdd906596f65c5e772a80e0758272ab7b8d85` | `sakurairo-arcaea-blog-skill/` |
| AKCX2002/sakurairo-theme | `c1974cdeeeeb650ef34a0b3b9be1f4a3b935199c` | `sakurairo-theme/` |

原提交及作者保留在主仓库历史中，原仓库保留迁移说明。后续修改统一提交到此处；无需继续 subtree pull。旧 checkout 可作为历史参考，不应继续在那里开发技能。

旧 Mermaid 仓库已发布 v1.1.10 过渡包，将 WordPress 更新源迁移到本仓库，其原 Release & Sync 已停用。本仓库同版插件包已发布并检查目录结构与更新地址。两个旧技能安装入口也已转向本仓库。生产 `babel-arcaea-code` 保持 v1.6.85。

## 许可

主仓库及技能遵循各目录的 MIT 许可；独立 Mermaid 插件遵循其 GPL-2.0-or-later 许可。外部主题、插件和工具子模块保留各自许可，主仓库许可不覆盖它们。

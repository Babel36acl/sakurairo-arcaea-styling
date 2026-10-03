# Astro Markdown 发布流程

Astro 站点的文章源文件位于 `astro-babel36acl/src/content/articles/`。每篇文章是一个目录，目录内用 `index.md` 保存正文和 frontmatter；图片和其他只属于该文章的文件也放在同一目录。

## 新建文章

在 `astro-babel36acl` 目录执行：

```powershell
npm ci
npm run new:post -- stm32-uart-dma "STM32 UART DMA 实战"
```

项目用 `.nvmrc` 固定 Node.js 22；本地若使用 nvm，请先切换到该版本。

脚本会创建一个默认草稿，例如：

```text
src/content/articles/stm32-uart-dma/index.md
```

文章 frontmatter 最小形式如下：

```yaml
---
title: "STM32 UART DMA 实战"
description: "说明文章解决的问题、适用场景和主要结论。"
published: "2026-10-03"
permalink: "/2026/10/03/stm32-uart-dma/"
draft: false
categories: ["嵌入式实战"]
tags: ["STM32", "UART"]
---

正文从这里开始。
```

日期必须加引号，`permalink` 发布后不要随意改变。要修改已发布的旧 JSON 文章，先确认原文章路由，再在 frontmatter 中填写对应的 `legacyId`；普通新文章不要填写它，也不要复用旧路由。

草稿 `draft: true` 只在本地开发时显示，生产构建会排除它。写作期间运行：

```powershell
npm run dev
```

## 提交与发布

完成文章后先执行本地门槛：

```powershell
npm run build
npm run test:publishing
```

`npm run build` 会验证 frontmatter、生成静态 HTML、搜索索引、站点地图，并检查每个文章路由确实有构建产物。`npm run test:publishing` 会在源码目录建立并清理一篇临时草稿/正式文章，确认草稿不会进入生产构建、正式文章会进入首页/搜索/站点地图。

确认预览无误后提交并推送：

```powershell
git add astro-babel36acl/src/content/articles
git commit -m "feat(blog): 发布 STM32 UART DMA 实战"
git push origin main
```

GitHub Actions 会执行同一套构建。成功后通过 SSH 将 `dist/` 上传到 VPS 的新版本目录，再原子切换 OpenResty 读取的 `current` 链接；上一版目录会保留用于回滚。上传和切换由发布脚本完成，不要手工覆盖正在服务的目录。

首次接入现有 VPS 时，在仓库的 GitHub Actions secrets 中配置：

- `ASTRO_VPS_HOST`、`ASTRO_VPS_USER`、`ASTRO_VPS_SSH_KEY`：必填，使用专用部署账号和限制到该站点的 SSH 私钥。
- `ASTRO_VPS_PORT`：可选，默认 `22`。
- `ASTRO_VPS_RELEASE_ROOT`、`ASTRO_VPS_CURRENT_LINK`：可选，默认分别为 `/opt/1panel/www/sites/babel36acl.xyz/astro-releases` 和 `/opt/1panel/www/sites/babel36acl.xyz/astro-current`。这两个路径必须与现有 OpenResty `root` 的实际配置核对后再填写；工作流不会替你猜测或修改 OpenResty 配置。

当前 VPS 的 OpenResty 容器把 /opt/1panel/www 挂载为容器内的 /www，站点配置使用 /www/sites/babel36acl.xyz/astro-current 作为静态 root；因此发布脚本会在宿主机创建相对 `current` 链接，让同一个链接在宿主机和容器挂载路径下都能解析；WordPress 容器保留用于回滚，但不再接收公开站点请求。

推送到 `main` 时，三个必填 secrets 缺失会明确跳过 VPS 作业而保留构建结果；手动运行工作流并选择 `deploy_vps=true` 只适用于 secrets 已配置的仓库。

## 图片

文章图片放在文章目录内：

```text
src/content/articles/stm32-uart-dma/uart-flow.png
```

正文使用相对引用：

```markdown
![UART DMA 数据流](./uart-flow.png)
```

Astro 会把它作为内容资源处理。公共站点素材仍放在 `public/`，引用路径以 `/assets/...` 开头。不要把构建后的 `dist/` 重新放回源码目录，也不要只上传一张图片而漏掉同一提交里的文章文件。

## 回滚

发布脚本每次使用时间戳版本目录，例如 `releases/20261003-1420-abc1234/`，切换前保留旧 `current` 目标。发现错误时把 `current` 原子切回上一版并重新加载 OpenResty；修复应回到 Git 提交中完成，不能只在服务器改文件。

## 现在如何上传一篇文章

```powershell
cd C:\Users\A1165\Documents\blog\sakurairo-arcaea-styling\astro-babel36acl
npm run new:post -- my-new-post "我的新文章"
# 编辑 src/content/articles/my-new-post/index.md
npm run build
npm run test:publishing
git add src/content/articles/my-new-post
git commit -m "feat(blog): 发布我的新文章"
git push origin main
```

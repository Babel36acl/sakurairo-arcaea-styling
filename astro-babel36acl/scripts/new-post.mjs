import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [slug, ...titleParts] = process.argv.slice(2);
if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
  console.error('用法: npm run new:post -- my-post "文章标题"（文件名用小写英文、数字和横线）');
  process.exit(1);
}
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = path.join(root, 'src/content/articles', slug);
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const title = titleParts.join(' ') || slug;
await mkdir(directory, { recursive: true });
const file = path.join(directory, 'index.md');
await writeFile(file, `---
title: ${JSON.stringify(title)}
description: "在这里填写文章摘要"
published: "${date}"
permalink: "/${date.replaceAll('-', '/')}/${slug}/"
draft: true
categories: []
tags: []
---

## 正文

从这里开始写作。标题由页面显示，正文从二级标题开始。

<!-- 图片放在此文件同目录，用 ![说明](./image.png) 引用。 -->
`, { encoding: 'utf8', flag: 'wx' });
console.log(`已新建草稿: ${file}\n预览: npm run dev\n发布: 完善摘要，将 draft 改为 false，然后 npm run build 并提交 Git。`);

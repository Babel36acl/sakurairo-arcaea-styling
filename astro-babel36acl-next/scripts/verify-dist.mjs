#!/usr/bin/env node
/**
 * 构建产物自检（零依赖，CI 里在 `pnpm build` 之后直接跑）：
 *
 *   node scripts/verify-dist.mjs [dist 目录]
 *
 * 校验项：
 *   1. 关键产物存在且非空：index.html / 404.html / pagefind/pagefind.js /
 *      sitemap-index.xml / rss.xml
 *   2. dist 下 HTML 文件数量 >= 60（内容集合被清空、构建提前中断时能立刻发现）
 *   3. dist/_astro 下的每个 CSS 产物都非空
 *   4. 打包后的 CSS 文本包含 --arcaea-bg-main（主题令牌层真的被打包进 _astro bundle）
 *      与 --bac-code（代码块主题令牌，主要来自 public/assets/legacy-code）
 *
 * 任一项失败都会打印原因并以退出码 1 结束；全部通过时退出码 0。
 * 环境变量：DIST_DIR（默认 dist）、MIN_HTML_FILES（默认 60）。
 *
 * 注意：Astro 在 CI/本地把产物写到 dist；只有设置了 CF_WORKERS 时才是 dist/client，
 * 那种情况需要显式传入目录（node scripts/verify-dist.mjs dist/client）。
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DIST_DIR = path.resolve(
	process.argv[2] ?? process.env.DIST_DIR ?? "dist",
);
const MIN_HTML_FILES = Number.parseInt(process.env.MIN_HTML_FILES ?? "60", 10);
const MIN_HTML_FILES_FALLBACK = Number.isFinite(MIN_HTML_FILES)
	? MIN_HTML_FILES
	: 60;

/** 必须存在且非空的产物 */
const REQUIRED_FILES = [
	{
		file: "index.html",
		label: "首页",
		hint: "astro build 没有输出首页：确认 pnpm build 走到了 astro build 且没有提前退出",
	},
	{
		file: "404.html",
		label: "404 页面",
		hint: "src/pages/404.astro 缺失，或产物根目录不是 dist（设置了 CF_WORKERS 时是 dist/client）",
	},
	{
		file: "pagefind/pagefind.js",
		label: "Pagefind 搜索索引",
		hint: "Pagefind 没有跑：确认 package.json 的 build 链末尾执行了 scripts/run-pagefind.ts，且索引写到了 dist/pagefind",
	},
	{
		file: "sitemap-index.xml",
		label: "站点地图",
		hint: "@astrojs/sitemap 未启用，或 src/config/siteConfig.ts 的 site_url 为空",
	},
	{
		file: "rss.xml",
		label: "RSS 订阅源",
		hint: "src/pages/rss.xml.ts 缺失或构建失败",
	},
];

/**
 * 打包后 CSS 必须包含的自定义属性。
 * requireBundled: true 表示必须出现在 dist/_astro（由 src 里的样式真正打包）；
 * false 允许只出现在 public/ 原样拷贝的样式里，但会给出警告。
 */
const CSS_TOKENS = [
	{
		token: "--arcaea-bg-main",
		label: "Arcaea 主题令牌层",
		owner: "src/styles/babel36acl.css（由 src/layouts/Layout.astro 导入）",
		requireBundled: true,
	},
	{
		token: "--bac-code",
		label: "代码块主题令牌",
		owner:
			"public/assets/legacy-code/prism/themes/*.css（public/ 原样拷贝的兼容样式）",
		requireBundled: false,
	},
];

const failures = [];
const warnings = [];

function ok(message) {
	console.log(`✅ ${message}`);
}

function fail(message) {
	failures.push(message);
	console.log(`❌ ${message}`);
}

function warn(message) {
	warnings.push(message);
	console.log(`⚠️  ${message}`);
}

/** 递归列出目录下所有文件（绝对路径） */
async function walkFiles(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const absolute = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walkFiles(absolute)));
		} else if (entry.isFile()) {
			files.push(absolute);
		}
	}
	return files;
}

function relative(file) {
	return path.relative(DIST_DIR, file).split(path.sep).join("/");
}

function formatBytes(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

const cssTextCache = new Map();

async function readCss(file) {
	if (!cssTextCache.has(file)) {
		cssTextCache.set(file, await readFile(file, "utf8"));
	}
	return cssTextCache.get(file);
}

async function findTokenHit(candidates, token) {
	for (const file of candidates) {
		let text;
		try {
			text = await readCss(file);
		} catch (error) {
			fail(
				`读取 ${relative(file)} 失败：${error instanceof Error ? error.message : String(error)}`,
			);
			continue;
		}
		if (text.includes(token)) return file;
	}
	return null;
}

async function checkRequiredFiles() {
	for (const { file, label, hint } of REQUIRED_FILES) {
		const absolute = path.join(DIST_DIR, file);
		let info;
		try {
			info = await stat(absolute);
		} catch {
			fail(`缺少 ${file}（${label}）—— ${hint}`);
			continue;
		}
		if (!info.isFile()) {
			fail(`${file} 不是文件（${label}）`);
			continue;
		}
		if (info.size === 0) {
			fail(`${file} 是空文件（${label}）—— ${hint}`);
			continue;
		}
		ok(`${file}（${label}，${formatBytes(info.size)}）`);
	}
}

function checkHtmlCount(files) {
	const htmlFiles = files.filter((file) => file.endsWith(".html"));
	if (htmlFiles.length < MIN_HTML_FILES_FALLBACK) {
		fail(
			`dist 下只有 ${htmlFiles.length} 个 HTML 文件，少于 ${MIN_HTML_FILES_FALLBACK} 个——内容集合可能被清空，或构建在生成页面之前就中断了`,
		);
		return;
	}
	ok(`HTML 页面 ${htmlFiles.length} 个（阈值 ${MIN_HTML_FILES_FALLBACK}）`);
}

async function checkCssBundles(files) {
	const cssFiles = files.filter((file) => file.endsWith(".css"));
	const bundleCss = cssFiles.filter((file) =>
		relative(file).startsWith("_astro/"),
	);

	if (bundleCss.length === 0) {
		fail(
			"dist/_astro 下没有 CSS 产物——astro build 没有产出样式，或 cssCodeSplit 输出到了别处",
		);
	} else {
		let emptyCount = 0;
		for (const file of bundleCss) {
			const info = await stat(file);
			if (info.size === 0) {
				emptyCount++;
				fail(`dist/${relative(file)} 是 0 字节——CSS 构建产物为空`);
			}
		}
		if (emptyCount === 0) {
			ok(`dist/_astro 下 ${bundleCss.length} 个 CSS 产物均非空`);
		}
	}

	for (const { token, label, owner, requireBundled } of CSS_TOKENS) {
		const bundledHit = await findTokenHit(bundleCss, token);
		if (bundledHit) {
			ok(
				`打包后的 CSS 含 ${token}（${label}），见 dist/${relative(bundledHit)}`,
			);
			continue;
		}

		// Astro 的 build.inlineStylesheets 默认是 "auto"：小于 4 kB 的样式表会被内联进
		// HTML 的 <style> 里，于是令牌不在 _astro/*.css 却在页面 HTML 中。先按「全站都算」
		// 的口径再找一遍，找到就不算失败，只提示它落在哪里。
		const otherCss = cssFiles.filter((file) => !bundleCss.includes(file));
		const htmlFiles = files.filter((file) => file.endsWith(".html"));
		const fallbackHit =
			(await findTokenHit(otherCss, token)) ??
			(await findTokenHit(htmlFiles, token));

		if (fallbackHit) {
			const where = `dist/${relative(fallbackHit)}`;
			warn(
				requireBundled
					? `${token}（${label}）没有出现在 dist/_astro 的样式表里，但在 ${where} 找到了——通常是 inlineStylesheets 把这段 CSS 内联进了页面。确认来源 ${owner} 仍在，且内联不是裁剪后的残缺产物`
					: `${token}（${label}）只出现在 ${where}，不在 _astro bundle 里；确认这是 public/ 原样拷贝或页面内联，而不是漏打包`,
			);
			continue;
		}

		if (bundleCss.length === 0) {
			fail(`无法在 CSS 中查找 ${token}（${label}）：没有 CSS 产物`);
			continue;
		}

		fail(
			`CSS/HTML 产物里都找不到 ${token}（${label}）——来源 ${owner} 没有被 import，或整段被裁剪`,
		);
	}
}

async function main() {
	console.log(`🔍 Verifying build output: ${DIST_DIR}`);

	let distInfo = null;
	try {
		distInfo = await stat(DIST_DIR);
	} catch {
		distInfo = null;
	}
	if (!distInfo?.isDirectory()) {
		fail(`产物目录不存在：${DIST_DIR}——先跑 pnpm build`);
		return finish();
	}

	await checkRequiredFiles();

	let files = [];
	try {
		files = await walkFiles(DIST_DIR);
	} catch (error) {
		fail(
			`遍历 ${DIST_DIR} 失败：${error instanceof Error ? error.message : String(error)}`,
		);
		return finish();
	}
	console.log(`📦 产物文件总数：${files.length}`);

	checkHtmlCount(files);
	await checkCssBundles(files);

	return finish();
}

function finish() {
	console.log("");
	if (failures.length > 0) {
		console.error(`❌ dist 自检失败（${failures.length} 项）：`);
		for (const message of failures) {
			console.error(`   - ${message}`);
		}
		process.exit(1);
	}
	if (warnings.length > 0) {
		console.log(`⚠️  ${warnings.length} 项警告，见上。`);
	}
	console.log("✅ dist 自检通过");
	process.exit(0);
}

main().catch((error) => {
	console.error("❌ dist 自检异常退出：", error);
	process.exit(1);
});

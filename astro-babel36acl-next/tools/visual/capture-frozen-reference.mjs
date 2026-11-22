import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createBrowser, createContext, routeUrl, viewportByName, VIEWPORTS, ensureDir, PROJECT_ROOT } from "./common.mjs";

const sourceUrl = process.env.REFERENCE_SOURCE_URL || "http://127.0.0.1:18081/";
const outputRoot = path.join(PROJECT_ROOT, "reference", "frozen", "home");
const assetsRoot = path.join(outputRoot, "assets");
const galleryRoot = path.join(outputRoot, "gallery");
const captureViewport = viewportByName(process.env.REFERENCE_CAPTURE_VIEWPORT || "desktop-1440");

await fs.rm(outputRoot, { recursive: true, force: true });
await ensureDir(assetsRoot);
await ensureDir(galleryRoot);

const browser = await createBrowser();
const context = await createContext(browser, captureViewport, { static: false });
const page = await context.newPage();
const responses = new Map();
const responseTasks = [];

page.on("response", (response) => {
	const url = response.url();
	if (responses.has(url)) return;
	const task = (async () => {
		let body = null;
		try {
			if (response.status() >= 200 && response.status() < 300) body = await response.body();
		} catch {
			body = null;
		}
		responses.set(url, {
			url,
			status: response.status(),
			resourceType: response.request().resourceType(),
			headers: response.headers(),
			body,
		});
	})();
	responseTasks.push(task);
});

const response = await page.goto(routeUrl(sourceUrl), { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});
await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());
await page.waitForTimeout(1_200);

// Trigger every first-page lazy cover and the footer gallery without changing the source page.
for (const card of await page.locator(".post-list-thumb").all()) {
	await card.scrollIntoViewIfNeeded();
	await page.waitForTimeout(250);
}
await page.waitForTimeout(1_000);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(250);
await Promise.allSettled(responseTasks);

// Freeze only runtime state that is known to be transient or random. The visual
// structure and computed styles remain those of the loaded reference page.
const canonical = await page.evaluate(() => {
	for (const selector of ["script", ".medal-particles-container", ".medal-particles", ".medal-particle", "#canvas_sakura"]) {
		document.querySelectorAll(selector).forEach((element) => element.remove());
	}
	for (const cursor of document.querySelectorAll(".typed-cursor")) cursor.remove();
	for (const element of document.querySelectorAll(".header-info .element")) {
		if (element.textContent?.trim()) element.textContent = "世界は灰色でも、音だけは嘘をつかなかった。";
	}
	const body = document.body;
	const nav = document.querySelector(".nav-search-wrapper");
	const bodyStyle = getComputedStyle(body);
	const styleSnapshot = (element, pseudo = null) => {
		if (!element) return null;
		const style = getComputedStyle(element, pseudo);
		return {
			backgroundImage: style.backgroundImage,
			backgroundPosition: style.backgroundPosition,
			backgroundSize: style.backgroundSize,
			backgroundRepeat: style.backgroundRepeat,
			filter: style.filter,
			opacity: style.opacity,
			mixBlendMode: style.mixBlendMode,
		};
	};
	return {
		nav: nav?.getBoundingClientRect().toJSON() ?? null,
		bodyBackground: bodyStyle.backgroundImage,
		backgroundContract: {
			body: styleSnapshot(body),
			bodyBefore: styleSnapshot(body, "::before"),
			bodyAfter: styleSnapshot(body, "::after"),
			centerbg: styleSnapshot(document.querySelector(".centerbg")),
			bannerDimOverlay: styleSnapshot(document.querySelector("#banner-dim-container .banner-dim-overlay")),
		},
		fonts: {
			status: document.fonts.status,
			checks: ["16px \"Zen Old Mincho\"", "900 16px \"Font Awesome 6 Free\"", "400 16px \"Font Awesome 6 Brands\""].map((font) => ({ font, ok: document.fonts.check(font) })),
		},
		animations: [...document.getAnimations({ subtree: true })].map((animation) => ({
			name: animation.animationName,
			target: animation.effect?.target?.className || animation.effect?.target?.id || animation.effect?.target?.tagName || null,
			playState: animation.playState,
		})),
		galleryIds: [...document.querySelectorAll(".post-list-thumb img[data-src], .post-list-thumb img[src]")]
			.map((image) => image.dataset.src || image.getAttribute("src"))
			.filter((value) => value && value.includes("/wp-json/sakura/v1/gallery")),
	};
});

const records = [...responses.values()].filter((record) => record.body && record.resourceType !== "document");
const urlToLocal = new Map();
const pathToRecord = new Map();
for (const record of records.sort((left, right) => left.url.localeCompare(right.url))) {
	const localPath = assetPath(record.url, record.headers["content-type"] || "");
	urlToLocal.set(record.url, localPath);
	pathToRecord.set(localPath, record);
	await ensureDir(path.dirname(path.join(outputRoot, localPath)));
	await fs.writeFile(path.join(outputRoot, localPath), record.body);
}

// API responses are 302s; use their Location header to map each requested gallery
// id directly to the captured image, while retaining the explicit id mapping.
const redirectMap = [...responses.values()]
	.filter((record) => record.status >= 300 && record.status < 400 && record.headers.location)
	.map((record) => [record.url, new URL(record.headers.location, record.url).toString()]);
for (const [from, to] of redirectMap) {
	const local = urlToLocal.get(to) || urlToLocal.get(stripHash(to));
	if (local) urlToLocal.set(from, local);
}

// CSS is part of the fixture contract. Rewrite font, image and imported CSS
// URLs after every response has a stable local path.
for (const record of records) {
	const local = urlToLocal.get(record.url);
	if (!local) continue;
	const contentType = record.headers["content-type"] || "";
	if (/css/i.test(contentType)) {
		const cssBase = path.posix.dirname(local);
		await fs.writeFile(path.join(outputRoot, local), rewriteText(record.body.toString("utf8"), record.url, urlToLocal, cssBase), "utf8");
	} else if (/javascript|ecmascript/i.test(contentType)) {
		await fs.writeFile(path.join(outputRoot, local), rewriteText(record.body.toString("utf8"), record.url, urlToLocal), "utf8");
	}
}

const gallery = {};
for (const source of new Set(canonical.galleryIds)) {
	const id = galleryId(source);
	const local = urlToLocal.get(source) || urlToLocal.get(`${source}`);
	if (id && local) gallery[id] = local;
}
const wallpaperSource = [...responses.values()].find((record) => record.url.includes("/wp-content/uploads/iro_gallery/img/") && record.headers["content-type"]?.startsWith("image/"));
const wallpaperLocal = wallpaperSource ? urlToLocal.get(wallpaperSource.url) : null;
const wallpaperMetadata = wallpaperSource ? await sharp(wallpaperSource.body).metadata() : null;
if (wallpaperLocal) urlToLocal.set("http://127.0.0.1:18081/wp-json/sakura/v1/gallery?img=w", wallpaperLocal);
for (const [id, local] of Object.entries(gallery)) {
	await fs.writeFile(path.join(galleryRoot, `${id}.json`), `${JSON.stringify({ id, file: local }, null, 2)}\n`, "utf8");
}

let html = await page.content();
html = rewriteText(html, sourceUrl, urlToLocal);
html = html.replace(/<link\b[^>]*rel=["']preconnect["'][^>]*>/gi, "");
html = html.replace(/<link\b[^>]*rel=["'](?:alternate|https:\/\/api\.w\.org\/)["'][^>]*>/gi, "");
html = html.replace(/<link\b([^>]*?)href=["'](https?:\/\/[^"']+)["']([^>]*)>/gi, (full, before, href, after) => {
	const local = urlToLocal.get(href);
	return local ? `<link${before}href="${local}"${after}>` : full;
});
html = html.replace(/\b(?:src|href|poster|data-src)=["'](https?:\/\/[^"']+)["']/gi, (full, href) => {
	const local = urlToLocal.get(decodeHtml(href)) || urlToLocal.get(href);
	return local ? full.replace(href, local) : full;
});
html = html.replace(/\b(?:src|href|poster|data-src)=["']([^"']*\/wp-json\/sakura\/v1\/gallery[^"']*)["']/gi, (full, href) => {
	const normalized = decodeHtml(href);
	const local = urlToLocal.get(normalized) || gallery[galleryId(normalized)];
	return local ? full.replace(href, local) : full;
});
html = html.replace(/\b(?:src|href|poster|data-src)=["']([^"']*\/wp-json\/sakura\/v1\/gallery[^"']*)["']/gi, (full, href) => {
	const local = urlToLocal.get(decodeHtml(href));
	return local ? full.replace(href, local) : full;
});
html = html.replace(/\s+srcset=["'][^"']*["']/gi, "");
html = html.replace(/\b(href|action)=["']http:\/\/127\.0\.0\.1:18081([^"']*)["']/gi, (_full, attribute, suffix) => `${attribute}="${suffix || "/"}"`);
html = html.replace(/<link\b[^>]*\b(?:href|src)=["']https?:\/\/[^"']+["'][^>]*>/gi, "");
html = html.replace(/\b(?:src|poster|data-src)=["']https?:\/\/[^"']+["']/gi, 'src="data:,"');
html = html.replace(/url\((['"]?)https?:\/\/[^'"\)]+\1\)/gi, "url(data:,)");

const indexPath = path.join(outputRoot, "index.html");
await fs.writeFile(indexPath, html, "utf8");

const hashes = {};
for (const file of await walkFiles(outputRoot)) {
	const relative = path.relative(outputRoot, file).replaceAll("\\", "/");
	if (relative === "manifest.json") continue;
	hashes[relative] = (await sha256(file));
}
const manifest = {
	kind: "frozen-reference",
	route: "/",
	capturedFrom: sourceUrl,
	capturedAt: new Date().toISOString(),
	viewportContract: VIEWPORTS,
	captureViewport,
	settings: { deviceScaleFactor: 1, colorScheme: "dark", locale: "zh-CN", timezone: "Asia/Shanghai", scriptsExecutedInFixture: false },
	assets: records.map((record) => ({ original: record.url, status: record.status, resourceType: record.resourceType, local: urlToLocal.get(record.url) || null, contentType: record.headers["content-type"] || null, bytes: record.body.length, sha256: sha256Buffer(record.body) })),
	fonts: records.filter((record) => record.resourceType === "font" || /font\//i.test(record.headers["content-type"] || "") || /\.(?:ttf|otf|woff2?|eot)(?:\?|$)/i.test(record.url)).map((record) => ({ original: record.url, local: urlToLocal.get(record.url) || null, contentType: record.headers["content-type"] || null, bytes: record.body.length, sha256: sha256Buffer(record.body) })),
	wallpaper: wallpaperSource ? { original: wallpaperSource.url, file: wallpaperLocal, width: wallpaperMetadata?.width || null, height: wallpaperMetadata?.height || null, sha256: sha256Buffer(wallpaperSource.body) } : { status: "missing" },
	gallery: { mapping: gallery, files: Object.fromEntries(Object.entries(gallery).map(([id, file]) => [id, { file, sha256: hashes[file] || null }])) },
	hashes,
	canonicalStates: { nav1440: canonical.nav, bodyBackground: canonical.bodyBackground, fixtureBodyBackground: wallpaperLocal ? `url("${wallpaperLocal}")` : null, backgroundContract: canonical.backgroundContract, fonts: canonical.fonts, animations: canonical.animations, transientState: { scriptsRemoved: true, particlesRemoved: true, typedCursorRemoved: true, quote: "世界は灰色でも、音だけは嘘をつかなかった。" } },
	resourceClosure: { capturedResponseCount: records.length, failedResponses: [...responses.values()].filter((record) => record.status >= 400).map((record) => ({ url: record.url, status: record.status })), externalRuntimeRequests: 0 },
};
await fs.writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: outputRoot, assets: records.length, fonts: manifest.fonts.length, gallery, wallpaper: wallpaperLocal, nav1440: canonical.nav }, null, 2));

await context.close();
await browser.close();

function assetPath(url, contentType) {
	const parsed = new URL(url);
	const base = path.basename(parsed.pathname) || "resource";
	const cleanBase = base.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "resource";
	const ext = path.extname(cleanBase) || extensionFor(contentType);
	const stem = ext ? cleanBase.slice(0, -ext.length) : cleanBase;
	const hash = crypto.createHash("sha256").update(url).digest("hex").slice(0, 12);
	return `assets/${hash}-${stem || "resource"}${ext}`;
}

function extensionFor(contentType) {
	if (/css/i.test(contentType)) return ".css";
	if (/javascript|ecmascript/i.test(contentType)) return ".js";
	if (/json/i.test(contentType)) return ".json";
	if (/font\/ttf/i.test(contentType)) return ".ttf";
	if (/font\/otf/i.test(contentType)) return ".otf";
	if (/woff2/i.test(contentType)) return ".woff2";
	if (/woff/i.test(contentType)) return ".woff";
	if (/image\/png/i.test(contentType)) return ".png";
	if (/image\/jpe?g/i.test(contentType)) return ".jpg";
	if (/image\/webp/i.test(contentType)) return ".webp";
	if (/image\/svg/i.test(contentType)) return ".svg";
	return ".bin";
}

function rewriteText(text, baseUrl, mapping, localBase = null) {
	let output = text;
	const renderLocal = (local) => {
		if (!localBase) return local;
		const relative = path.posix.relative(localBase, local).replaceAll("\\", "/");
		return relative || path.posix.basename(local);
	};
	const candidates = [...mapping.keys()].sort((left, right) => right.length - left.length);
	for (const original of candidates) {
		const local = mapping.get(original);
		if (!local) continue;
		const rendered = renderLocal(local);
		for (const variant of [original, original.replaceAll("&", "&amp;"), `${original}&quot;`]) {
			const pattern = new RegExp(`${escapeRegExp(variant)}(?![A-Za-z0-9._~:/?#%&=-])`, "g");
			output = output.replace(pattern, variant.endsWith("&quot;") ? `${rendered}&quot;` : rendered);
		}
	}
	output = output.replace(/url\((['"]?)([^'"\)]+)\1\)/gi, (full, quote, raw) => {
		if (/^(?:data:|blob:|about:|#)/i.test(raw)) return full;
		let absolute;
		try { absolute = new URL(decodeHtml(raw), baseUrl).toString(); } catch { return full; }
		const local = mapping.get(absolute) || mapping.get(stripHash(absolute));
		return local ? `url(${quote}${renderLocal(local)}${quote})` : full;
	});
	if (localBase) {
		// A loaded stylesheet can contain optional fallback faces that were never
		// requested by the page. Remove those external fallbacks so the fixture
		// remains closed under offline execution.
		output = output.replace(/url\((['"]?)(?:https?:\/\/[^'")]+|\/webfonts\/[^'")]+|\.\.?\/webfonts\/[^'")]+)\1\)/gi, "url(data:,)");
	}
	return output;
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function decodeHtml(value) { return value.replaceAll("&amp;", "&").replaceAll("&#038;", "&"); }
function stripHash(value) { const parsed = new URL(value); parsed.hash = ""; return parsed.toString(); }
function galleryId(value) {
	try {
		const parsed = new URL(value);
		return [...parsed.searchParams.keys(), ...parsed.searchParams.values()].find((item) => /^\d+$/.test(item)) || null;
	} catch {
		return null;
	}
}
function sha256Buffer(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }
async function sha256(file) { return sha256Buffer(await fs.readFile(file)); }
async function* filesRecursive(directory) {
	for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
		const full = path.join(directory, entry.name);
		if (entry.isDirectory()) yield* filesRecursive(full);
		else yield full;
	}
}
async function walkFiles(directory) { const result = []; for await (const file of filesRecursive(directory)) result.push(file); return result; }

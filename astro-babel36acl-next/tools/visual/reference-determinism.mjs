import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createBrowser, createContext, preparePage, routeUrl, VIEWPORTS, PROJECT_ROOT, captureSections, ensureDir } from "./common.mjs";

const baseUrl = process.env.FROZEN_REFERENCE_URL || "http://127.0.0.1:18082/";
const fixtureRoot = path.join(PROJECT_ROOT, "reference", "frozen", "home");
const screenshotRoot = path.join(fixtureRoot, "screenshots");
const reportPath = path.join(PROJECT_ROOT, "reports", "visual", "reference-frozen-determinism.json");
const manifest = JSON.parse(await fs.readFile(path.join(fixtureRoot, "manifest.json"), "utf8"));
const browser = await createBrowser();
const result = {
	kind: "reference-determinism",
	baseUrl,
	repeats: ["A", "B", "C"],
	viewports: {},
	resourceClosure: { externalRequests: [], failedRequests: [], missingImages: [], fontFailures: [], integrityFailures: [] },
	canonicalStates: manifest.canonicalStates || {},
};
for (const [file, expected] of Object.entries(manifest.hashes || {})) {
	try {
		const actual = await sha256(path.join(fixtureRoot, file));
		if (actual !== expected) result.resourceClosure.integrityFailures.push({ file, expected, actual });
	} catch (error) {
		result.resourceClosure.integrityFailures.push({ file, error: error.code || String(error) });
	}
}

try {
	for (const viewport of VIEWPORTS) {
		const directory = path.join(screenshotRoot, viewport.name);
		await ensureDir(path.join(directory, "sections"));
		const captures = [];
		for (let index = 0; index < 3; index += 1) {
			const context = await createContext(browser, viewport, { static: true });
			const page = await context.newPage();
			const externalRequests = [];
			const failedRequests = [];
			const assets = [];
			await context.route("**/*", async (route) => {
				const url = route.request().url();
				if (!isLocalFixtureUrl(url, baseUrl) && /^https?:/i.test(url)) {
					externalRequests.push(url);
					return route.abort("blockedbyclient");
				}
				return route.continue();
			});
			page.on("request", (request) => {
				const url = request.url();
				if (!isLocalFixtureUrl(url, baseUrl) && !/^(?:data|blob|about):/i.test(url)) externalRequests.push(url);
			});
			page.on("response", (response) => {
				assets.push({ url: response.url(), status: response.status(), resourceType: response.request().resourceType() });
				if (response.status() >= 400) failedRequests.push({ url: response.url(), error: `HTTP ${response.status()}` });
			});
			page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || "unknown" }));
			try {
				await page.goto(routeUrl(baseUrl), { waitUntil: "domcontentloaded", timeout: 30_000 });
				await preparePage(page, { static: true, waitForImages: false, waitForBackgroundImages: true, waitMs: 250 });
				for (const card of await page.locator(".post-list-thumb").all()) {
					await card.scrollIntoViewIfNeeded();
					await page.waitForTimeout(100);
				}
				await page.evaluate(() => window.scrollTo(0, 0));
				await page.waitForTimeout(150);
				const name = String.fromCharCode(65 + index);
				const screenshotPath = path.join(directory, index === 0 ? "home.png" : `home-${name}.png`);
				await page.screenshot({ path: screenshotPath, fullPage: false, animations: "disabled", scale: "css" });
				const fullPagePath = path.join(directory, `full-page-${name}.png`);
				await page.screenshot({ path: fullPagePath, fullPage: true, animations: "disabled", scale: "css" });
				const cardPath = path.join(directory, `first-post-card-${name}.png`);
				await page.locator(".post-list-thumb").first().screenshot({ path: cardPath, animations: "disabled", scale: "css" });
				if (index === 0) {
					await captureSections(page, path.join(directory, "sections"));
				}
				// Locator screenshots scroll the document. Restore the canonical
				// top-of-page state before probing geometry in every capture.
				await page.evaluate(() => {
					const root = document.scrollingElement || document.documentElement;
					root.scrollTop = 0;
					document.body.scrollTop = 0;
					window.scrollTo(0, 0);
				});
				await page.waitForTimeout(50);
				const probes = await page.evaluate(() => {
					const selectors = [".site-header", ".nav-search-wrapper", ".headertop", ".centerbg", ".focusinfo", ".header-info", ".site-content", ".site-main", ".post-list-thumb", ".site-footer"];
					const rect = (element) => { if (!element) return null; const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; };
					return {
						geometry: Object.fromEntries(selectors.map((selector) => [selector, [...document.querySelectorAll(selector)].slice(0, 10).map(rect)])),
						overflow: { innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth },
						fonts: { status: document.fonts.status, checks: ['16px "Zen Old Mincho"', '900 16px "Font Awesome 6 Free"', '400 16px "Font Awesome 6 Brands"'].map((font) => ({ font, ok: document.fonts.check(font) })), loadedFaces: [...document.fonts].filter((face) => face.status === "loaded").map((face) => ({ family: face.family, weight: face.weight, style: face.style, unicodeRange: face.unicodeRange })) },
						animations: [...document.getAnimations({ subtree: true })].map((animation) => ({ name: animation.animationName, target: animation.effect?.target?.className || animation.effect?.target?.id || animation.effect?.target?.tagName || null, playState: animation.playState })),
						images: [...document.images].map((image) => ({ src: image.currentSrc || image.src, complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight })),
					};
				});
				probes.domSha256 = (await import("node:crypto")).createHash("sha256").update(await page.content()).digest("hex");
				probes.assets = uniqueObjects(assets).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
				const missingImages = probes.images.filter((image) => image.src && !/^(?:data|blob|about):/i.test(image.src) && (!image.complete || image.naturalWidth === 0));
				result.resourceClosure.externalRequests.push(...externalRequests);
				result.resourceClosure.failedRequests.push(...failedRequests);
				result.resourceClosure.missingImages.push(...missingImages.map((image) => ({ viewport: viewport.name, name, ...image })));
				captures.push({ name, path: path.relative(fixtureRoot, screenshotPath).replaceAll("\\", "/"), fullPagePath: path.relative(fixtureRoot, fullPagePath).replaceAll("\\", "/"), cardPath: path.relative(fixtureRoot, cardPath).replaceAll("\\", "/"), sha256: await sha256(screenshotPath), probes });
			} finally {
				await context.close();
			}
		}
		const comparisons = {};
		for (const [left, right] of [["A", "B"], ["B", "C"], ["A", "C"]]) {
			const leftCapture = captures.find((capture) => capture.name === left);
			const rightCapture = captures.find((capture) => capture.name === right);
			comparisons[`${left}vs${right}`] = {
				image: await compareImages(path.join(fixtureRoot, leftCapture.path), path.join(fixtureRoot, rightCapture.path), path.join(PROJECT_ROOT, "reports", "visual", "reference-frozen", viewport.name, `${left}vs${right}.png`)),
				fullPage: await compareImages(path.join(fixtureRoot, leftCapture.fullPagePath), path.join(fixtureRoot, rightCapture.fullPagePath), path.join(PROJECT_ROOT, "reports", "visual", "reference-frozen", viewport.name, `full-page-${left}vs${right}.png`)),
				postCard: await compareImages(path.join(fixtureRoot, leftCapture.cardPath), path.join(fixtureRoot, rightCapture.cardPath), path.join(PROJECT_ROOT, "reports", "visual", "reference-frozen", viewport.name, `post-card-${left}vs${right}.png`)),
				domStable: leftCapture.probes.domSha256 === rightCapture.probes.domSha256,
				assetsStable: stableJson(leftCapture.probes.assets) === stableJson(rightCapture.probes.assets),
				geometryStable: stableJson(leftCapture.probes.geometry) === stableJson(rightCapture.probes.geometry),
				fontsStable: stableJson(leftCapture.probes.fonts) === stableJson(rightCapture.probes.fonts),
				animationsStable: stableJson(leftCapture.probes.animations) === stableJson(rightCapture.probes.animations),
			};
		}
		result.viewports[viewport.name] = { width: viewport.width, height: viewport.height, captures, comparisons };
	}
} finally {
	await browser.close();
}

result.resourceClosure.externalRequests = [...new Set(result.resourceClosure.externalRequests)];
result.resourceClosure.failedRequests = uniqueObjects(result.resourceClosure.failedRequests);
result.resourceClosure.missingImages = uniqueObjects(result.resourceClosure.missingImages);
result.resourceClosure.fontFailures = Object.entries(result.viewports).flatMap(([viewport, data]) => data.captures.flatMap((capture) => capture.probes.fonts.checks.filter((check) => !check.ok).map((check) => ({ viewport, capture: capture.name, ...check }))));
await ensureDir(path.dirname(reportPath));
await fs.writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: reportPath, externalRequests: result.resourceClosure.externalRequests.length, failedRequests: result.resourceClosure.failedRequests.length, missingImages: result.resourceClosure.missingImages.length, fontFailures: result.resourceClosure.fontFailures.length, integrityFailures: result.resourceClosure.integrityFailures.length, viewports: Object.fromEntries(Object.entries(result.viewports).map(([name, data]) => [name, data.comparisons])) }, null, 2));

if (Object.values(result.resourceClosure).some((failures) => failures.length > 0)) process.exitCode = 1;
for (const [name, viewport] of Object.entries(result.viewports)) {
	for (const comparison of Object.values(viewport.comparisons)) {
		if (comparison.image.diffPixels !== 0 || comparison.fullPage.diffPixels !== 0 || comparison.postCard.diffPixels !== 0 || !comparison.domStable || !comparison.assetsStable || !comparison.geometryStable || !comparison.fontsStable || !comparison.animationsStable) process.exitCode = 1;
	}
}

function isLocalFixtureUrl(url, base) { try { return new URL(url).origin === new URL(base).origin; } catch { return false; } }
function stableJson(value) { return JSON.stringify(value); }
function uniqueObjects(values) { return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()]; }
async function sha256(file) { const data = await fs.readFile(file); const crypto = await import("node:crypto"); return crypto.createHash("sha256").update(data).digest("hex"); }
async function compareImages(leftPath, rightPath, diffPath) {
	const left = await sharp(leftPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
	const right = await sharp(rightPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
	const width = Math.max(left.info.width, right.info.width);
	const height = Math.max(left.info.height, right.info.height);
	const diff = Buffer.alloc(width * height * 4);
	let diffPixels = 0;
	for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
		const offset = (y * width + x) * 4;
		const a = pixelAt(left, x, y); const b = pixelAt(right, x, y);
		if (a.some((channel, index) => channel !== b[index])) { diffPixels += 1; diff[offset] = 255; diff[offset + 3] = 255; }
	}
	await ensureDir(path.dirname(diffPath));
	await sharp(diff, { raw: { width, height, channels: 4 } }).png().toFile(diffPath);
	return { width, height, diffPixels, totalPixels: width * height, diffRatio: diffPixels / (width * height) };
}
function pixelAt(image, x, y) { if (x >= image.info.width || y >= image.info.height) return [0, 0, 0, 0]; const offset = (y * image.info.width + x) * image.info.channels; return [image.data[offset] || 0, image.data[offset + 1] || 0, image.data[offset + 2] || 0, image.data[offset + 3] || 0]; }

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const TOOLS_ROOT = path.join(PROJECT_ROOT, "tools", "visual");
export const REFERENCE_ROOT = path.join(PROJECT_ROOT, "reference");
export const REPORT_ROOT = path.join(PROJECT_ROOT, "reports", "visual");

export const VIEWPORTS = [
	{ name: "mobile-390", width: 390, height: 844 },
	{ name: "tablet-768", width: 768, height: 1024 },
	{ name: "desktop-1272", width: 1272, height: 720 },
	{ name: "desktop-1440", width: 1440, height: 900 },
];

export const ROUTE = process.env.VISUAL_ROUTE || "/";
export const REFERENCE_URL = process.env.REFERENCE_URL || "https://babel36acl.xyz";
export const CANDIDATE_URL = process.env.CANDIDATE_URL || "http://127.0.0.1:4321";
export const TIMEZONE_ID = process.env.VISUAL_TIMEZONE || "Asia/Shanghai";
export const FIXED_NOW = process.env.VISUAL_FIXED_NOW || "2026-01-01T00:00:00.000Z";

export const PROBE_SELECTORS = [
	".site-header",
	".nav-search-wrapper",
	".headertop",
	".centerbg",
	".focusinfo",
	".center-text",
	".header-info",
	".site-content",
	".site-main",
	".post-list-thumb",
	".site-footer",
];

export const SECTION_SELECTORS = {
	"header/nav": [".site-header", ".headertop", ".nav-search-wrapper"],
	hero: [".centerbg"],
	"hero-info": [".focusinfo", ".center-text", ".header-info"],
	"post-list": [".site-content", ".site-main"],
	"first-post-card": [".post-list-thumb"],
	footer: [".site-footer"],
};

const STATIC_STABILIZE_CSS = path.join(PROJECT_ROOT, "tests", "visual", "stabilize.css");
const STATIC_STABILIZE_CSS_TEXT = await fs.readFile(STATIC_STABILIZE_CSS, "utf8");

export function viewportByName(name) {
	const viewport = VIEWPORTS.find((entry) => entry.name === name);
	if (!viewport) throw new Error(`Unknown viewport: ${name}`);
	return viewport;
}

export function parseArgs(argv = process.argv.slice(2)) {
	const args = {};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (!token.startsWith("--")) continue;
		const [key, inlineValue] = token.slice(2).split("=", 2);
		if (inlineValue !== undefined) {
			args[key] = inlineValue;
			continue;
		}
		const next = argv[index + 1];
		if (next && !next.startsWith("--")) {
			args[key] = next;
			index += 1;
		} else {
			args[key] = true;
		}
	}
	return args;
}

export function routeUrl(baseUrl, route = ROUTE) {
	return new URL(route, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

export function viewportFolder(viewport) {
	return viewport.name;
}

export async function ensureDir(directory) {
	await fs.mkdir(directory, { recursive: true });
}

export async function readJson(filePath, fallback = null) {
	try {
		return JSON.parse(await fs.readFile(filePath, "utf8"));
	} catch (error) {
		if (error?.code === "ENOENT") return fallback;
		throw error;
	}
}

export async function writeJson(filePath, value) {
	await ensureDir(path.dirname(filePath));
	await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function deterministicInitScript() {
	return ({ fixedNow, storage, visualTest }) => {
		const OriginalDate = Date;
		const fixedTime = new OriginalDate(fixedNow).getTime();
		class VisualDate extends OriginalDate {
			constructor(...args) {
				super(...(args.length ? args : [fixedTime]));
			}
			static now() {
				return fixedTime;
			}
		}
		window.Date = VisualDate;
		let randomState = 0x9e3779b9;
		Math.random = () => {
			randomState = (1664525 * randomState + 1013904223) >>> 0;
			return randomState / 0x100000000;
		};
		try {
			window.localStorage.clear();
			window.sessionStorage.clear();
			for (const [key, value] of Object.entries(storage || {})) {
				window.localStorage.setItem(key, String(value));
			}
		} catch {
			// Storage can be unavailable for opaque origins; the page remains testable.
		}
		if (visualTest) {
			window.__VISUAL_TEST__ = { fixedNow, storageKeys: Object.keys(storage || {}) };
		} else {
			delete window.__VISUAL_TEST__;
		}
	};
}

export async function createBrowser() {
	return chromium.launch({
		headless: process.env.VISUAL_HEADED !== "1",
		args: ["--force-color-profile=srgb", "--disable-gpu"],
	});
}

export async function createContext(browser, viewport, options = {}) {
	const context = await browser.newContext({
		viewport: { width: viewport.width, height: viewport.height },
		deviceScaleFactor: 1,
		colorScheme: "dark",
		locale: "zh-CN",
		timezoneId: TIMEZONE_ID,
		serviceWorkers: "block",
		reducedMotion: options.static === false ? "no-preference" : "reduce",
	});
	await context.addInitScript(deterministicInitScript(), {
		fixedNow: FIXED_NOW,
		storage: options.storage || {},
		visualTest: options.static !== false,
	});
	if (options.static !== false) {
		await context.addInitScript({
			content: `(() => {
				const inject = () => {
					const root = document.documentElement || document.head;
					if (!root) return false;
					if (document.getElementById("visual-stabilize-early")) return true;
					const style = document.createElement("style");
					style.id = "visual-stabilize-early";
					style.textContent = ${JSON.stringify(STATIC_STABILIZE_CSS_TEXT)};
					root.appendChild(style);
					return true;
				};
				if (!inject()) document.addEventListener("DOMContentLoaded", inject, { once: true });
			})();`,
		});
	}
	if (options.blockFonts) {
		await context.route("**/*", async (route) => {
			if (route.request().resourceType() === "font") {
				await route.abort();
				return;
			}
			await route.continue();
		});
	}
	return context;
}

async function waitForImages(page) {
	await page.evaluate(async () => {
		const images = [...document.images];
		await Promise.race([
			Promise.all(images.map(async (image) => {
				const rect = image.getBoundingClientRect();
				const outsideViewport = rect.bottom < -100 || rect.top > window.innerHeight + 100;
				if (image.loading === "lazy" && outsideViewport) return;
				if (!image.complete) {
					await Promise.race([
						new Promise((resolve) => {
							image.addEventListener("load", resolve, { once: true });
							image.addEventListener("error", resolve, { once: true });
						}),
						new Promise((resolve) => setTimeout(resolve, 5000)),
					]);
				}
				if (typeof image.decode === "function") {
					try {
						await image.decode();
					} catch {
						// Broken images are recorded by the asset probe instead of blocking capture.
					}
				}
			})),
			new Promise((resolve) => setTimeout(resolve, 8000)),
		]);
	});
}

async function waitForBackgroundImages(page) {
	const urls = await page.evaluate(() => {
		const found = new Set();
		for (const element of document.querySelectorAll("*")) {
			for (const style of [getComputedStyle(element), getComputedStyle(element, "::before"), getComputedStyle(element, "::after")]) {
				for (const match of style.backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)) found.add(match[1]);
			}
		}
		return [...found].filter((url) => !url.startsWith("data:"));
	});
	await page.evaluate(async (sources) => {
		await Promise.race([
			Promise.all(sources.map((src) => new Promise((resolve) => {
				const image = new Image();
				image.onload = resolve;
				image.onerror = resolve;
				image.src = src;
			}))),
			new Promise((resolve) => setTimeout(resolve, 8_000)),
		]);
	}, urls);
}

export async function preparePage(page, options = {}) {
	const { static: staticCapture = true, waitMs = 250 } = options;
	await page.emulateMedia({ colorScheme: "dark", reducedMotion: staticCapture ? "reduce" : "no-preference" });
	if (options.url) {
		await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: options.timeout || 45_000 });
	}
	if (page.url() === "about:blank") throw new Error("preparePage requires a navigated page or an explicit url");
	if (staticCapture) {
		await page.evaluate((css) => {
			if (document.getElementById("visual-stabilize-early")) return;
			const style = document.createElement("style");
			style.id = "visual-stabilize-late";
			style.textContent = css;
			(document.head || document.documentElement || document.body)?.appendChild(style);
		}, STATIC_STABILIZE_CSS_TEXT);
	}
	if (options.waitForLoad !== false) await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());
	if (options.waitForImages !== false) await waitForImages(page);
	if (options.waitForBackgroundImages !== false) await waitForBackgroundImages(page);
	if (waitMs > 0) await page.waitForTimeout(waitMs);
	if (staticCapture) {
		await page.evaluate(() => {
			for (const animation of document.getAnimations({ subtree: true })) {
				try {
					animation.pause();
					animation.currentTime = 0;
				} catch {
					// Some document animations can be detached while scripts update the page.
				}
			}
		});
	}
	await page.evaluate(() => window.scrollTo(0, 0));
	return {
		url: page.url(),
		title: await page.title(),
		bodyClass: await page.locator("body").getAttribute("class").catch(() => null),
	};
}

export async function openPreparedPage(browser, baseUrl, viewport, options = {}) {
	const context = await createContext(browser, viewport, options);
	const page = await context.newPage();
	const targetUrl = routeUrl(baseUrl, options.route || ROUTE);
	const response = await page.goto(targetUrl, {
		waitUntil: "domcontentloaded",
		timeout: options.timeout || 45_000,
	});
	const metadata = await preparePage(page, { ...options });
	return { context, page, response, metadata };
}

export async function closeBrowserResources(resources) {
	if (!resources) return;
	await resources.page?.close().catch(() => {});
	await resources.context?.close().catch(() => {});
}

export function safeFilename(value) {
	return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "page";
}

export function selectorLabel(selector) {
	return selector.replace(/^[.#]/, "").replace(/[^a-z0-9_-]+/gi, "-");
}

export async function inspectUrl(browser, baseUrl, viewport = VIEWPORTS[0]) {
	const context = await createContext(browser, viewport, { static: true });
	const page = await context.newPage();
	try {
		const response = await page.goto(routeUrl(baseUrl), { waitUntil: "domcontentloaded", timeout: 30_000 });
		return {
			url: page.url(),
			status: response?.status() ?? null,
			title: await page.title().catch(() => null),
			contentType: response?.headers()["content-type"] ?? null,
		};
	} finally {
		await context.close();
	}
}

export async function collectElementData(page, selector, properties = []) {
	return page.evaluate(
		({ selector: targetSelector, properties: propertyList }) => {
			const element = document.querySelector(targetSelector);
			if (!element) return { selector: targetSelector, status: "missing" };
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			const computed = {};
			for (const property of propertyList) computed[property] = style.getPropertyValue(property);
			return {
				selector: targetSelector,
				status: "present",
				rect: {
					x: rect.x,
					y: rect.y,
					width: rect.width,
					height: rect.height,
				},
				computed,
			};
		},
		{ selector, properties },
	);
}

export async function captureSections(page, outputDirectory) {
	const sections = {};
	for (const [name, selectors] of Object.entries(SECTION_SELECTORS)) {
		let found = null;
		for (const selector of selectors) {
			const locator = page.locator(selector).first();
			if (await locator.count()) {
				found = { locator, selector };
				break;
			}
		}
		if (!found) {
			sections[name] = { status: "missing", selectors };
			continue;
		}
		const filename = `${safeFilename(name)}.png`;
		await ensureDir(outputDirectory);
		await found.locator.screenshot({ path: path.join(outputDirectory, filename), animations: "disabled", scale: "css" });
		sections[name] = { status: "present", selector: found.selector, path: filename };
	}
	return sections;
}

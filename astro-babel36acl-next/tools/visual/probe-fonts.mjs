import path from "node:path";
import {
	REPORT_ROOT,
	ROUTE,
	VIEWPORTS,
	closeBrowserResources,
	createBrowser,
	openPreparedPage,
	parseArgs,
	viewportByName,
	writeJson,
} from "./common.mjs";

const args = parseArgs();
const baseUrl = args.url || process.env.VISUAL_URL;
if (!baseUrl) throw new Error("probe-fonts requires --url or VISUAL_URL");
const selectedViewports = args.viewport ? [viewportByName(args.viewport)] : VIEWPORTS;
const label = args.label || process.env.VISUAL_LABEL || "page";
const output = args.output || path.join(REPORT_ROOT, "probes", `fonts-${label}.json`);
const browser = await createBrowser();
const result = { kind: "fonts", label, url: baseUrl, route: ROUTE, viewports: {}, failures: [] };

try {
	for (const viewport of selectedViewports) {
		const resources = await openPreparedPage(browser, baseUrl, viewport, { route: ROUTE, static: true, waitForLoad: false, waitForImages: false, waitMs: 0 });
		try {
			result.viewports[viewport.name] = {
				status: resources.response?.status() ?? null,
				url: resources.page.url(),
				fonts: await resources.page.evaluate(() => {
					const cssFontFaces = [];
					for (const sheet of [...document.styleSheets]) {
						try {
							for (const rule of [...sheet.cssRules]) {
								if (rule.type === CSSRule.FONT_FACE_RULE) {
									cssFontFaces.push({
										family: rule.style.getPropertyValue("font-family"),
										weight: rule.style.getPropertyValue("font-weight"),
										style: rule.style.getPropertyValue("font-style"),
										src: rule.style.getPropertyValue("src"),
									});
								}
							}
						} catch {
							cssFontFaces.push({ href: sheet.href, status: "cross-origin-unreadable" });
						}
					}
					const loadedFaces = [...document.fonts].map((font) => ({
						family: font.family,
						weight: font.weight,
						style: font.style,
						status: font.status,
						unicodeRange: font.unicodeRange,
					}));
					const resources = performance
						.getEntriesByType("resource")
						.filter((entry) => /\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)|font/i.test(entry.name))
						.map((entry) => ({ name: entry.name, duration: entry.duration, transferSize: entry.transferSize }));
					const samples = [
						"body",
						".site-header",
						"nav",
						".center-text",
						".header-info",
						".site-content",
					].map((selector) => {
						const element = document.querySelector(selector);
						if (!element) return { selector, status: "missing" };
						const style = getComputedStyle(element);
						return {
							selector,
							status: "present",
							family: style.fontFamily,
							size: style.fontSize,
							weight: style.fontWeight,
							style: style.fontStyle,
							lineHeight: style.lineHeight,
							letterSpacing: style.letterSpacing,
							fontCheck: document.fonts.check(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`),
						};
					});
					return { documentFontsStatus: document.fonts.status, cssFontFaces, loadedFaces, resources, samples };
				}),
			};
		} catch (error) {
			result.failures.push({ viewport: viewport.name, error: String(error?.stack || error) });
		} finally {
			await closeBrowserResources(resources);
		}
	}
} finally {
	await browser.close();
}
await writeJson(output, result);
console.log(JSON.stringify({ output, failures: result.failures.length }, null, 2));

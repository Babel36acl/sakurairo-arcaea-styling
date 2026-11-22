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
if (!baseUrl) throw new Error("probe-assets requires --url or VISUAL_URL");
const selectedViewports = args.viewport ? [viewportByName(args.viewport)] : VIEWPORTS;
const label = args.label || process.env.VISUAL_LABEL || "page";
const output = args.output || path.join(REPORT_ROOT, "probes", `assets-${label}.json`);
const browser = await createBrowser();
const result = { kind: "assets", label, url: baseUrl, route: ROUTE, viewports: {}, failures: [] };

try {
	for (const viewport of selectedViewports) {
		const resources = await openPreparedPage(browser, baseUrl, viewport, { route: ROUTE, static: true, waitForLoad: false, waitForImages: false, waitMs: 0 });
		try {
			result.viewports[viewport.name] = {
				status: resources.response?.status() ?? null,
				url: resources.page.url(),
				assets: await resources.page.evaluate(() => ({
					images: [...document.images].map((image) => ({
						src: image.currentSrc || image.src,
						complete: image.complete,
						naturalWidth: image.naturalWidth,
						naturalHeight: image.naturalHeight,
						loading: image.loading,
						decode: image.decoding,
					})),
					stylesheets: [...document.styleSheets].map((sheet) => ({ href: sheet.href, disabled: sheet.disabled })),
					scripts: [...document.scripts].map((script) => ({ src: script.src, type: script.type, async: script.async, defer: script.defer })),
					resources: performance.getEntriesByType("resource").map((entry) => ({
						name: entry.name,
						initiatorType: entry.initiatorType,
						duration: entry.duration,
						transferSize: entry.transferSize,
					})),
				})),
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

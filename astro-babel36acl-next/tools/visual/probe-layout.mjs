import path from "node:path";
import {
	REPORT_ROOT,
	ROUTE,
	PROBE_SELECTORS,
	VIEWPORTS,
	closeBrowserResources,
	collectElementData,
	createBrowser,
	openPreparedPage,
	parseArgs,
	viewportByName,
	writeJson,
} from "./common.mjs";

const args = parseArgs();
const baseUrl = args.url || process.env.VISUAL_URL;
if (!baseUrl) throw new Error("probe-layout requires --url or VISUAL_URL");
const selectedViewports = args.viewport ? [viewportByName(args.viewport)] : VIEWPORTS;
const label = args.label || process.env.VISUAL_LABEL || "page";
const output = args.output || path.join(REPORT_ROOT, "probes", `layout-${label}.json`);
const browser = await createBrowser();
const result = { kind: "layout", label, url: baseUrl, route: ROUTE, viewports: {}, failures: [] };

try {
	for (const viewport of selectedViewports) {
		const resources = await openPreparedPage(browser, baseUrl, viewport, { route: ROUTE, static: true, waitForLoad: false, waitForImages: false, waitMs: 0 });
		try {
			const nodes = [];
			for (const selector of PROBE_SELECTORS) {
				nodes.push(
					await collectElementData(pageOrThrow(resources), selector, [
						"display",
						"position",
						"top",
						"right",
						"bottom",
						"left",
						"z-index",
						"overflow",
						"opacity",
						"transform",
					]),
				);
			}
			result.viewports[viewport.name] = {
				width: viewport.width,
				height: viewport.height,
				status: resources.response?.status() ?? null,
				url: resources.page.url(),
				nodes,
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

function pageOrThrow(resources) {
	if (!resources?.page) throw new Error("Browser page was not created");
	return resources.page;
}

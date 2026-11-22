import path from "node:path";
import {
	REPORT_ROOT,
	ROUTE,
	PROBE_SELECTORS,
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
if (!baseUrl) throw new Error("probe-scroll-states requires --url or VISUAL_URL");
const selectedViewports = args.viewport ? [viewportByName(args.viewport)] : VIEWPORTS;
const label = args.label || process.env.VISUAL_LABEL || "page";
const output = args.output || path.join(REPORT_ROOT, "probes", `scroll-${label}.json`);
const browser = await createBrowser();
const percentages = [0, 0.25, 0.5, 0.75, 1];
const result = { kind: "scroll-states", label, url: baseUrl, route: ROUTE, percentages, viewports: {}, failures: [] };

try {
	for (const viewport of selectedViewports) {
		const resources = await openPreparedPage(browser, baseUrl, viewport, { route: ROUTE, static: true, waitForLoad: false, waitForImages: false, waitMs: 0 });
		try {
			const states = [];
			for (const percentage of percentages) {
				await resources.page.evaluate((value) => {
					const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
					window.scrollTo(0, maxScroll * value);
				}, percentage);
				await resources.page.waitForTimeout(100);
				states.push({ percentage, state: await collectScrollState(resources.page) });
			}
			const reverse = [];
			for (const percentage of [...percentages].reverse()) {
				await resources.page.evaluate((value) => {
					const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
					window.scrollTo(0, maxScroll * value);
				}, percentage);
				await resources.page.waitForTimeout(100);
				reverse.push({ percentage, state: await collectScrollState(resources.page) });
			}
			result.viewports[viewport.name] = {
				status: resources.response?.status() ?? null,
				url: resources.page.url(),
				states,
				reverse,
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

async function collectScrollState(page) {
	return page.evaluate((selectors) => {
		const styleKeys = ["opacity", "transform", "filter", "position", "background", "z-index"];
		return {
			scrollTop: window.scrollY,
			documentHeight: document.documentElement.scrollHeight,
			viewportHeight: window.innerHeight,
			nodes: selectors.map((selector) => {
				const element = document.querySelector(selector);
				if (!element) return { selector, status: "missing" };
				const rect = element.getBoundingClientRect();
				const style = getComputedStyle(element);
				const computed = Object.fromEntries(styleKeys.map((key) => [key, style.getPropertyValue(key)]));
				return {
					selector,
					status: "present",
					rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
					class: element.className,
					computed,
				};
			}),
		};
	}, PROBE_SELECTORS);
}

import path from "node:path";
import {
	REFERENCE_ROOT,
	REFERENCE_URL,
	ROUTE,
	VIEWPORTS,
	captureSections,
	closeBrowserResources,
	createBrowser,
	ensureDir,
	openPreparedPage,
	parseArgs,
	viewportByName,
	writeJson,
} from "./common.mjs";

const args = parseArgs();
const baseUrl = args.url || REFERENCE_URL;
const count = Math.max(1, Number(args.count || 2));
const selectedViewports = args.viewport
	? [viewportByName(args.viewport)]
	: VIEWPORTS;
const routeSlug = ROUTE === "/" ? "home" : ROUTE.replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9_-]+/gi, "-");
const browser = await createBrowser();
const manifest = {
	kind: "reference",
	route: ROUTE,
	requestedBaseUrl: baseUrl,
	sourceLabel: process.env.VISUAL_REFERENCE_BUILD || "historical WordPress reference",
	browser: { name: "chromium", version: browser.version(), headless: process.env.VISUAL_HEADED !== "1" },
	settings: {
		deviceScaleFactor: 1,
		colorScheme: "dark",
		locale: "zh-CN",
		timezone: process.env.VISUAL_TIMEZONE || "Asia/Shanghai",
		screenshotScale: "css",
	},
	viewports: {},
	failures: [],
};

try {
	for (const viewport of selectedViewports) {
		const outputDirectory = path.join(REFERENCE_ROOT, viewport.name);
		const sectionsDirectory = path.join(outputDirectory, "sections");
		await ensureDir(outputDirectory);
		const captures = [];
		for (let index = 0; index < count; index += 1) {
			const resources = await openPreparedPage(browser, baseUrl, viewport, { route: ROUTE, static: true, blockFonts: true });
			try {
				const filename = index === 0 ? `${routeSlug}.png` : `${routeSlug}-B.png`;
				const outputPath = path.join(outputDirectory, filename);
				await resources.page.screenshot({ path: outputPath, fullPage: false, animations: "disabled", scale: "css" });
				captures.push({
					name: index === 0 ? "A" : String.fromCharCode(65 + index),
					path: path.relative(REFERENCE_ROOT, outputPath).replaceAll("\\", "/"),
					status: resources.response?.status() ?? null,
					url: resources.page.url(),
					metadata: resources.metadata,
				});
				if (index === 0) {
					const sections = await captureSections(resources.page, sectionsDirectory);
					captures[captures.length - 1].sections = sections;
				}
			} catch (error) {
				manifest.failures.push({ viewport: viewport.name, capture: index, error: String(error?.stack || error) });
			} finally {
				await closeBrowserResources(resources);
			}
		}
		manifest.viewports[viewport.name] = { width: viewport.width, height: viewport.height, routeSlug, captures };
	}
} finally {
	await browser.close();
}

manifest.capturedAt = new Date().toISOString();
await writeJson(path.join(REFERENCE_ROOT, "manifest.json"), manifest);
console.log(JSON.stringify({ output: path.join(REFERENCE_ROOT, "manifest.json"), failures: manifest.failures.length }, null, 2));

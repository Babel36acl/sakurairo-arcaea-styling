import path from "node:path";
import {
	CANDIDATE_URL,
	REPORT_ROOT,
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
const baseUrl = args.url || CANDIDATE_URL;
const selectedViewports = args.viewport
	? [viewportByName(args.viewport)]
	: VIEWPORTS;
const routeSlug = ROUTE === "/" ? "home" : ROUTE.replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9_-]+/gi, "-");
const outputRoot = path.join(REPORT_ROOT, "candidate");
const browser = await createBrowser();
const manifest = {
	kind: "candidate",
	route: ROUTE,
	requestedBaseUrl: baseUrl,
	sourceLabel: process.env.VISUAL_CANDIDATE_BUILD || "local Astro candidate",
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
		const outputDirectory = path.join(outputRoot, viewport.name);
		const sectionsDirectory = path.join(outputDirectory, "sections");
		await ensureDir(outputDirectory);
		const resources = await openPreparedPage(browser, baseUrl, viewport, { route: ROUTE, static: true, blockFonts: true });
		try {
			const outputPath = path.join(outputDirectory, `${routeSlug}.png`);
			await resources.page.screenshot({ path: outputPath, fullPage: false, animations: "disabled", scale: "css" });
			const sections = await captureSections(resources.page, sectionsDirectory);
			manifest.viewports[viewport.name] = {
				width: viewport.width,
				height: viewport.height,
				routeSlug,
				capture: {
					path: path.relative(REPORT_ROOT, outputPath).replaceAll("\\", "/"),
					status: resources.response?.status() ?? null,
					url: resources.page.url(),
					metadata: resources.metadata,
					sections,
				},
			};
		} catch (error) {
			manifest.failures.push({ viewport: viewport.name, error: String(error?.stack || error) });
		} finally {
			await closeBrowserResources(resources);
		}
	}
} finally {
	await browser.close();
}

manifest.capturedAt = new Date().toISOString();
await writeJson(path.join(REPORT_ROOT, "candidate-manifest.json"), manifest);
console.log(JSON.stringify({ output: path.join(REPORT_ROOT, "candidate-manifest.json"), failures: manifest.failures.length }, null, 2));

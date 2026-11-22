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
if (!baseUrl) throw new Error("probe-animations requires --url or VISUAL_URL");
const selectedViewports = args.viewport ? [viewportByName(args.viewport)] : VIEWPORTS;
const label = args.label || process.env.VISUAL_LABEL || "page";
const output = args.output || path.join(REPORT_ROOT, "probes", `animations-${label}.json`);
const browser = await createBrowser();
const result = { kind: "animations", label, url: baseUrl, route: ROUTE, viewports: {}, failures: [] };

try {
	for (const viewport of selectedViewports) {
		const resources = await openPreparedPage(browser, baseUrl, viewport, { route: ROUTE, static: false, waitForLoad: false, waitForImages: false, waitMs: 100 });
		try {
			result.viewports[viewport.name] = {
				status: resources.response?.status() ?? null,
				url: resources.page.url(),
				animations: await resources.page.evaluate(() => {
					const describeTarget = (target) => {
						if (!(target instanceof Element)) return null;
						const parts = [];
						let current = target;
						while (current && current instanceof Element && parts.length < 4) {
							let part = current.tagName.toLowerCase();
							if (current.id) part += `#${current.id}`;
							if (current.classList.length) part += `.${[...current.classList].slice(0, 3).join(".")}`;
							parts.unshift(part);
							current = current.parentElement;
						}
						return parts.join(" > ");
					};
					return document.getAnimations({ subtree: true }).map((animation) => {
						const timing = animation.effect?.getTiming?.() || {};
						return {
							target: describeTarget(animation.effect?.target),
							animationName: animation.animationName || null,
							keyframes: animation.effect?.getKeyframes?.() || [],
							duration: timing.duration,
							delay: timing.delay,
							easing: timing.easing,
							fill: timing.fill,
							iterations: timing.iterations,
							playState: animation.playState,
							currentTime: animation.currentTime,
						};
					});
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

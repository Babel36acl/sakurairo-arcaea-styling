import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
	closeBrowserResources,
	createBrowser,
	ensureDir,
	openPreparedPage,
	REPORT_ROOT,
	VIEWPORTS,
	writeJson,
} from "./common.mjs";

const referenceRoot = path.join(REPORT_ROOT, "..", "..", "reference", "frozen", "home", "screenshots");
const outputRoot = path.join(REPORT_ROOT, "phase2c");
const candidateUrl = process.env.CANDIDATE_URL || "http://127.0.0.1:4323";
const threshold = Number(process.env.PHASE2C_PIXEL_THRESHOLD || 12);
const browser = await createBrowser();
const result = {
	kind: "phase2c-full-page-gate",
	reference: "reference/frozen/home/screenshots/*/full-page-A.png",
	candidateUrl,
	threshold,
	viewports: {},
	failures: [],
};

try {
	for (const viewport of VIEWPORTS) {
		const outputDirectory = path.join(outputRoot, viewport.name);
		await ensureDir(outputDirectory);
		const referencePath = path.join(referenceRoot, viewport.name, "full-page-A.png");
		const candidatePath = path.join(outputDirectory, "full-page.png");
		const diffPath = path.join(outputDirectory, "diff.png");
		try {
			const resources = await openPreparedPage(browser, candidateUrl, viewport, {
				route: "/",
				static: true,
				waitMs: 700,
				waitForImages: true,
				waitForBackgroundImages: true,
			});
			try {
				await resources.page.screenshot({ path: candidatePath, fullPage: true, animations: "disabled", scale: "css" });
				const geometry = await resources.page.evaluate(() => {
					const rect = (selector) => {
						const element = document.querySelector(selector);
						if (!element) return null;
						const box = element.getBoundingClientRect();
						return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom };
					};
					return {
						documentScrollHeight: document.documentElement.scrollHeight,
						content: rect("#content"),
						primary: rect("#primary"),
						lastCard: rect("#post-list-container > .post-list-thumb:last-child"),
						pagination: rect("#pagination"),
						exhibition: rect(".exhibition-area-container"),
						footer: rect("#colophon"),
						footerClass: document.querySelector("#colophon")?.className || null,
					};
				});
				const comparison = await compareImages(referencePath, candidatePath, diffPath, threshold);
				result.viewports[viewport.name] = { geometry, referencePath, candidatePath, diffPath, comparison };
			} finally {
				await closeBrowserResources(resources);
			}
		} catch (error) {
			result.failures.push({ viewport: viewport.name, error: String(error?.stack || error) });
		}
	}
} finally {
	await browser.close();
}

result.allPass = Object.values(result.viewports).length === VIEWPORTS.length &&
	Object.values(result.viewports).every(({ comparison }) => comparison.pixelMatch >= 0.99);
await writeJson(path.join(outputRoot, "gate.json"), result);
console.log(JSON.stringify({ output: path.join(outputRoot, "gate.json"), allPass: result.allPass, failures: result.failures.length, viewports: Object.fromEntries(Object.entries(result.viewports).map(([name, value]) => [name, value.comparison])) }, null, 2));

async function compareImages(referencePath, candidatePath, diffPath, pixelThreshold) {
	const reference = await readImage(referencePath);
	const candidate = await readImage(candidatePath);
	const width = Math.max(reference.info.width, candidate.info.width);
	const height = Math.max(reference.info.height, candidate.info.height);
	const output = Buffer.alloc(width * height * 4);
	const rows = Array.from({ length: height }, () => 0);
	let diffPixels = 0;
	let exactDiffPixels = 0;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const offset = (y * width + x) * 4;
			const a = pixelAt(reference, x, y);
			const b = pixelAt(candidate, x, y);
			const maxDelta = Math.max(...a.map((channel, index) => Math.abs(channel - b[index])));
			if (maxDelta > 0) exactDiffPixels += 1;
			if (maxDelta > pixelThreshold) {
				diffPixels += 1;
				rows[y] += 1;
				output[offset] = 255;
				output[offset + 1] = 0;
				output[offset + 2] = 0;
				output[offset + 3] = 255;
			}
		}
	}
	await sharp(output, { raw: { width, height, channels: 4 } }).png().toFile(diffPath);
	const bands = buildBands(rows, width);
	return {
		status: "ok",
		width,
		height,
		exactDiffPixels,
		exactPixelMatch: 1 - exactDiffPixels / (width * height),
		diffPixels,
		pixelMatch: 1 - diffPixels / (width * height),
		totalPixels: width * height,
		diffPath,
		topDiffBands: bands,
	};
}

function buildBands(rows, width) {
	const minimumSignal = Math.max(1, Math.floor(width * 0.005));
	const bands = [];
	let current = null;
	for (let y = 0; y < rows.length; y += 1) {
		if (rows[y] < minimumSignal) {
			if (current) {
				bands.push(current);
				current = null;
			}
			continue;
		}
		if (!current) current = { start: y, end: y, diffPixels: 0, peakRowPixels: 0 };
		current.end = y;
		current.diffPixels += rows[y];
		current.peakRowPixels = Math.max(current.peakRowPixels, rows[y]);
	}
	if (current) bands.push(current);
	return bands.sort((a, b) => b.diffPixels - a.diffPixels).slice(0, 10);
}

async function readImage(filePath) {
	return sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function pixelAt(image, x, y) {
	if (x >= image.info.width || y >= image.info.height) return [0, 0, 0, 0];
	const offset = (y * image.info.width + x) * image.info.channels;
	return [image.data[offset] || 0, image.data[offset + 1] || 0, image.data[offset + 2] || 0, image.data[offset + 3] || 0];
}

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
	REFERENCE_ROOT,
	REPORT_ROOT,
	ROUTE,
	VIEWPORTS,
	PROJECT_ROOT,
	ensureDir,
	parseArgs,
	writeJson,
} from "./common.mjs";

const args = parseArgs();
const routeSlug = ROUTE === "/" ? "home" : ROUTE.replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9_-]+/gi, "-");
const threshold = Number(args.threshold ?? process.env.VISUAL_PIXEL_THRESHOLD ?? 0);
const referenceRoot = args["reference-root"] || REFERENCE_ROOT;
const candidateRoot = args["candidate-root"] || path.join(REPORT_ROOT, "candidate");
const outputRoot = args["output-root"] || REPORT_ROOT;
const selectedViewports = args.viewport ? VIEWPORTS.filter((viewport) => viewport.name === args.viewport) : VIEWPORTS;
const result = {
	kind: "image-diff",
	route: ROUTE,
	threshold,
	noiseFloor: {},
	viewports: {},
	failures: [],
};

for (const viewport of selectedViewports) {
	const referenceDirectory = path.join(referenceRoot, viewport.name);
	const candidateDirectory = path.join(candidateRoot, viewport.name);
	const outputDirectory = path.join(outputRoot, viewport.name);
	await ensureDir(outputDirectory);
	const referencePath = args.reference || path.join(referenceDirectory, `${routeSlug}.png`);
	const referenceBPath = args["reference-b"] || path.join(referenceDirectory, `${routeSlug}-B.png`);
	const candidatePath = args.candidate || path.join(candidateDirectory, `${routeSlug}.png`);
	const diffPath = args.diff || path.join(outputDirectory, "diff.png");
	try {
		if (await exists(referencePath) && await exists(referenceBPath)) {
			result.noiseFloor[viewport.name] = await compareImages(referencePath, referenceBPath, path.join(outputDirectory, "reference-noise.png"), threshold);
		} else {
			result.noiseFloor[viewport.name] = { status: "missing-capture", reference: relative(referencePath), referenceB: relative(referenceBPath) };
		}
		if (await exists(referencePath) && await exists(candidatePath)) {
			result.viewports[viewport.name] = await compareImages(referencePath, candidatePath, diffPath, threshold);
			result.viewports[viewport.name].reference = relative(referencePath);
			result.viewports[viewport.name].candidate = relative(candidatePath);
			result.viewports[viewport.name].diff = relative(diffPath);
			result.viewports[viewport.name].sections = await compareSections(referenceDirectory, candidateDirectory, outputDirectory, threshold);
		} else {
			result.viewports[viewport.name] = { status: "missing-capture", reference: relative(referencePath), candidate: relative(candidatePath) };
		}
	} catch (error) {
		result.failures.push({ viewport: viewport.name, error: String(error?.stack || error) });
	}
}

await writeJson(path.join(outputRoot, "diff-results.json"), result);
console.log(JSON.stringify({ output: path.join(outputRoot, "diff-results.json"), failures: result.failures.length }, null, 2));

async function compareSections(referenceDirectory, candidateDirectory, outputDirectory, pixelThreshold) {
	const sections = {};
	const referenceSections = path.join(referenceDirectory, "sections");
	const candidateSections = path.join(candidateDirectory, "sections");
	const names = new Set();
	for (const root of [referenceSections, candidateSections]) {
		for (const file of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
			if (file.isFile() && file.name.endsWith(".png")) names.add(file.name);
		}
	}
	for (const filename of names) {
		const referencePath = path.join(referenceSections, filename);
		const candidatePath = path.join(candidateSections, filename);
		const sectionName = filename.replace(/\.png$/, "");
		if (!(await exists(referencePath)) || !(await exists(candidatePath))) {
			sections[sectionName] = { status: "missing-capture", reference: relative(referencePath), candidate: relative(candidatePath) };
			continue;
		}
		const diffPath = path.join(outputDirectory, "sections", filename);
		sections[sectionName] = await compareImages(referencePath, candidatePath, diffPath, pixelThreshold);
		sections[sectionName].reference = relative(referencePath);
		sections[sectionName].candidate = relative(candidatePath);
		sections[sectionName].diff = relative(diffPath);
	}
	return sections;
}

async function compareImages(referencePath, candidatePath, diffPath, pixelThreshold) {
	const reference = await readImage(referencePath);
	const candidate = await readImage(candidatePath);
	const width = Math.max(reference.info.width, candidate.info.width);
	const height = Math.max(reference.info.height, candidate.info.height);
	const output = Buffer.alloc(width * height * 4);
	let diffPixels = 0;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const outputOffset = (y * width + x) * 4;
			const referencePixel = pixelAt(reference, x, y);
			const candidatePixel = pixelAt(candidate, x, y);
			const different = referencePixel.some((channel, index) => Math.abs(channel - candidatePixel[index]) > pixelThreshold);
			if (different) {
				diffPixels += 1;
				output[outputOffset] = 255;
				output[outputOffset + 1] = 0;
				output[outputOffset + 2] = 0;
				output[outputOffset + 3] = 255;
			} else {
				output[outputOffset] = 0;
				output[outputOffset + 1] = 0;
				output[outputOffset + 2] = 0;
				output[outputOffset + 3] = 0;
			}
		}
	}
	await ensureDir(path.dirname(diffPath));
	await sharp(output, { raw: { width, height, channels: 4 } }).png().toFile(diffPath);
	return {
		status: "ok",
		width,
		height,
		diffPixels,
		totalPixels: width * height,
		diffRatio: width * height ? diffPixels / (width * height) : 0,
	};
}

async function readImage(filePath) {
	return sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function pixelAt(image, x, y) {
	if (x >= image.info.width || y >= image.info.height) return [0, 0, 0, 0];
	const offset = (y * image.info.width + x) * image.info.channels;
	return [image.data[offset] || 0, image.data[offset + 1] || 0, image.data[offset + 2] || 0, image.data[offset + 3] || 0];
}

async function exists(filePath) {
	return fs.access(filePath).then(() => true).catch(() => false);
}

function relative(filePath) {
	return path.relative(PROJECT_ROOT, filePath).replaceAll("\\", "/");
}

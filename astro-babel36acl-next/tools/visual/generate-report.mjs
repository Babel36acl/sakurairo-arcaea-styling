import path from "node:path";
import {
	PROJECT_ROOT,
	REFERENCE_ROOT,
	REPORT_ROOT,
	ROUTE,
	VIEWPORTS,
	readJson,
	writeJson,
} from "./common.mjs";
import fs from "node:fs/promises";

const scorecardPath = path.join(REPORT_ROOT, "scorecard.json");
const referenceManifest = await readJson(path.join(REFERENCE_ROOT, "manifest.json"), { viewports: {}, failures: [] });
const candidateManifest = await readJson(path.join(REPORT_ROOT, "candidate-manifest.json"), { viewports: {}, failures: [] });
const diffResults = await readJson(path.join(REPORT_ROOT, "diff-results.json"), { noiseFloor: {}, viewports: {}, failures: [] });
const probes = await loadProbes();
const scorecard = {
	generatedAt: new Date().toISOString(),
	route: ROUTE,
	reference: {
		requestedBaseUrl: referenceManifest.requestedBaseUrl || process.env.REFERENCE_URL || "",
		build: referenceManifest.sourceLabel || "",
		browser: referenceManifest.browser || null,
	},
	candidate: {
		requestedBaseUrl: candidateManifest.requestedBaseUrl || process.env.CANDIDATE_URL || "",
		build: candidateManifest.sourceLabel || "",
		browser: candidateManifest.browser || null,
	},
	noiseFloor: diffResults.noiseFloor || {},
	routes: { [ROUTE]: {} },
	fonts: {},
	animations: {},
	assets: {},
	behavior: {},
	failures: [
		...(referenceManifest.failures || []).map((failure) => ({ category: "capture-reference", ...failure })),
		...(candidateManifest.failures || []).map((failure) => ({ category: "capture-candidate", ...failure })),
		...(diffResults.failures || []).map((failure) => ({ category: "pixel-diff", ...failure })),
	],
};

const geometryMismatches = [];
const styleMismatches = [];
const sectionRatios = [];

for (const viewport of VIEWPORTS) {
	const key = viewport.name;
	const diff = diffResults.viewports?.[key] || { status: "missing" };
	const layoutReference = probes.layoutReference?.viewports?.[key];
	const layoutCandidate = probes.layoutCandidate?.viewports?.[key];
	const styleReference = probes.stylesReference?.viewports?.[key];
	const styleCandidate = probes.stylesCandidate?.viewports?.[key];
	const geometry = compareGeometry(layoutReference, layoutCandidate, key, geometryMismatches);
	const styles = compareStyles(styleReference, styleCandidate, key, styleMismatches);
	const noise = diffResults.noiseFloor?.[key];
	const sectionData = diff.sections || {};
	for (const [section, sectionResult] of Object.entries(sectionData)) {
		if (sectionResult?.status === "ok") sectionRatios.push({ viewport: key, section, diffRatio: sectionResult.diffRatio, diffPixels: sectionResult.diffPixels });
	}
	scorecard.routes[ROUTE][key] = {
		status: diff.status || "missing",
		diffPixels: diff.diffPixels ?? null,
		diffRatio: diff.diffRatio ?? null,
		referenceNoiseRatio: noise?.diffRatio ?? null,
		geometryMismatchCount: geometry.length,
		computedStyleMismatchCount: styles.length,
		sections: sectionData,
		artifacts: {
			reference: diff.reference || null,
			candidate: diff.candidate || null,
			diff: diff.diff || null,
		},
	};
	scorecard.fonts[key] = compareFontProbe(probes.fontsReference?.viewports?.[key], probes.fontsCandidate?.viewports?.[key]);
	scorecard.animations[key] = compareAnimationProbe(probes.animationsReference?.viewports?.[key], probes.animationsCandidate?.viewports?.[key]);
	scorecard.assets[key] = compareAssetProbe(probes.assetsReference?.viewports?.[key], probes.assetsCandidate?.viewports?.[key]);
	scorecard.behavior[key] = compareScrollProbe(probes.scrollReference?.viewports?.[key], probes.scrollCandidate?.viewports?.[key]);
}

geometryMismatches.sort((a, b) => {
	const missingDelta = (item) => item.delta === undefined ? 1 : 0;
	return missingDelta(a) - missingDelta(b) || Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) || String(a.selector || "").localeCompare(String(b.selector || ""));
});
styleMismatches.sort((a, b) => {
	const missingStatus = (item) => item.status === "missing" ? 1 : 0;
	return missingStatus(a) - missingStatus(b) || String(a.property || a.status || "").localeCompare(String(b.property || b.status || "")) || String(a.selector || "").localeCompare(String(b.selector || ""));
});
scorecard.mismatches = {
	geometry: geometryMismatches.slice(0, 5),
	computedStyle: styleMismatches.slice(0, 5),
};
scorecard.nextPriority = sectionRatios.sort((a, b) => b.diffRatio - a.diffRatio).slice(0, 5);

await writeJson(scorecardPath, scorecard);
await fs.writeFile(path.join(REPORT_ROOT, "report.md"), renderMarkdown(scorecard), "utf8");
console.log(JSON.stringify({ scorecard: scorecardPath, report: path.join(REPORT_ROOT, "report.md") }, null, 2));

async function loadProbes() {
	const names = ["layoutReference", "layoutCandidate", "stylesReference", "stylesCandidate", "fontsReference", "fontsCandidate", "animationsReference", "animationsCandidate", "assetsReference", "assetsCandidate", "scrollReference", "scrollCandidate"];
	const files = {
		layoutReference: "layout-reference.json",
		layoutCandidate: "layout-candidate.json",
		stylesReference: "styles-reference.json",
		stylesCandidate: "styles-candidate.json",
		fontsReference: "fonts-reference.json",
		fontsCandidate: "fonts-candidate.json",
		animationsReference: "animations-reference.json",
		animationsCandidate: "animations-candidate.json",
		assetsReference: "assets-reference.json",
		assetsCandidate: "assets-candidate.json",
		scrollReference: "scroll-reference.json",
		scrollCandidate: "scroll-candidate.json",
	};
	const loaded = {};
	for (const name of names) loaded[name] = await readJson(path.join(REPORT_ROOT, "probes", files[name]), null);
	return loaded;
}

function compareGeometry(reference, candidate, viewport, output) {
	if (!reference || !candidate) return [{ viewport, status: "missing-probe" }];
	const candidateBySelector = new Map((candidate.nodes || []).map((node) => [node.selector, node]));
	const mismatches = [];
	for (const expected of reference.nodes || []) {
		const actual = candidateBySelector.get(expected.selector);
		if (!actual || expected.status !== actual.status) {
			mismatches.push({ viewport, selector: expected.selector, status: "missing", expected: expected.status, actual: actual?.status || "missing" });
			continue;
		}
		for (const property of ["x", "y", "width", "height"]) {
			const expectedValue = expected.rect?.[property];
			const actualValue = actual.rect?.[property];
			const delta = Number((actualValue - expectedValue).toFixed(3));
			if (Math.abs(delta) > 0.5) mismatches.push({ viewport, selector: expected.selector, property, expected: expectedValue, actual: actualValue, delta });
		}
	}
	output.push(...mismatches);
	return mismatches;
}

function compareStyles(reference, candidate, viewport, output) {
	if (!reference || !candidate) return [{ viewport, status: "missing-probe" }];
	const candidateBySelector = new Map((candidate.nodes || []).map((node) => [node.selector, node]));
	const mismatches = [];
	for (const expected of reference.nodes || []) {
		const actual = candidateBySelector.get(expected.selector);
		if (!actual || expected.status !== actual.status) {
			mismatches.push({ viewport, selector: expected.selector, status: "missing", expected: expected.status, actual: actual?.status || "missing" });
			continue;
		}
		for (const property of reference.properties || []) {
			const expectedValue = String(expected.computed?.[property] ?? "").trim();
			const actualValue = String(actual.computed?.[property] ?? "").trim();
			if (expectedValue !== actualValue) mismatches.push({ viewport, selector: expected.selector, property, expected: expectedValue, actual: actualValue });
		}
	}
	output.push(...mismatches);
	return mismatches;
}

function compareFontProbe(reference, candidate) {
	if (!reference || !candidate) return { status: "missing-probe" };
	const referenceFaces = reference.fonts?.loadedFaces || [];
	const candidateFaces = candidate.fonts?.loadedFaces || [];
	const referenceLoadedFaces = referenceFaces.filter((face) => face.status === "loaded");
	const candidateLoadedFaces = candidateFaces.filter((face) => face.status === "loaded");
	const failed = [...referenceFaces, ...candidateFaces].filter((face) => face.status === "error");
	const mismatch = JSON.stringify(reference.fonts?.samples || []) !== JSON.stringify(candidate.fonts?.samples || []);
	return {
		status: failed.length ? "font-load-failure" : mismatch ? "font-mismatch" : "ok",
		referenceDocumentStatus: reference.fonts?.documentFontsStatus || null,
		candidateDocumentStatus: candidate.fonts?.documentFontsStatus || null,
		referenceLoadedFaces,
		candidateLoadedFaces,
		referenceUnloadedFaces: referenceFaces.filter((face) => face.status === "unloaded").length,
		candidateUnloadedFaces: candidateFaces.filter((face) => face.status === "unloaded").length,
		resourceCount: { reference: reference.fonts?.resources?.length || 0, candidate: candidate.fonts?.resources?.length || 0 },
		mismatch,
	};
}

function compareAnimationProbe(reference, candidate) {
	if (!reference || !candidate) return { status: "missing-probe" };
	const names = (items) => (items || []).map((item) => `${item.animationName || "css"}:${item.duration}:${item.delay}`).sort();
	const expected = names(reference.animations);
	const actual = names(candidate.animations);
	return { status: JSON.stringify(expected) === JSON.stringify(actual) ? "ok" : "animation-mismatch", referenceCount: expected.length, candidateCount: actual.length, reference: expected, candidate: actual };
}

function compareAssetProbe(reference, candidate) {
	if (!reference || !candidate) return { status: "missing-probe" };
	const brokenReference = (reference.assets?.images || []).filter((image) => image.complete && image.naturalWidth === 0).length;
	const brokenCandidate = (candidate.assets?.images || []).filter((image) => image.complete && image.naturalWidth === 0).length;
	return { status: brokenReference || brokenCandidate ? "asset-load-failure" : "ok", brokenImages: { reference: brokenReference, candidate: brokenCandidate }, resourceCount: { reference: reference.assets?.resources?.length || 0, candidate: candidate.assets?.resources?.length || 0 } };
}

function compareScrollProbe(reference, candidate) {
	if (!reference || !candidate) return { status: "missing-probe" };
	return { status: JSON.stringify(reference.states) === JSON.stringify(candidate.states) ? "ok" : "behavior-mismatch", referenceStates: reference.states?.length || 0, candidateStates: candidate.states?.length || 0 };
}

function renderMarkdown(data) {
	const lines = [];
	lines.push(`# Visual regression report`, "", `- Route: \`${data.route}\``, `- Reference: ${data.reference.requestedBaseUrl || "unknown"} (${data.reference.build || "unknown"})`, `- Candidate: ${data.candidate.requestedBaseUrl || "unknown"} (${data.candidate.build || "unknown"})`, `- Generated: ${data.generatedAt}`, "");
	lines.push("## Pixel mismatch", "", "| Viewport | Diff pixels | Diff ratio | Reference noise ratio | Status |", "| --- | ---: | ---: | ---: | --- |");
	for (const viewport of Object.keys(data.routes[data.route] || {})) {
		const row = data.routes[data.route][viewport];
		lines.push(`| ${viewport} | ${row.diffPixels ?? "-"} | ${formatRatio(row.diffRatio)} | ${formatRatio(row.referenceNoiseRatio)} | ${row.status} |`);
	}
	lines.push("", "## Geometry mismatch", "", ...renderMismatchTable(data.mismatches.geometry, "geometry"));
	lines.push("", "## Computed-style mismatch", "", ...renderMismatchTable(data.mismatches.computedStyle, "style"));
	lines.push("", "## Fonts", "", "| Viewport | Status | Reference faces | Candidate faces |", "| --- | --- | ---: | ---: |");
	for (const [viewport, font] of Object.entries(data.fonts)) lines.push(`| ${viewport} | ${font.status} | ${font.referenceLoadedFaces?.length ?? "-"} | ${font.candidateLoadedFaces?.length ?? "-"} |`);
	lines.push("", "## Animations", "", "| Viewport | Status | Reference count | Candidate count |", "| --- | --- | ---: | ---: |");
	for (const [viewport, animation] of Object.entries(data.animations)) lines.push(`| ${viewport} | ${animation.status} | ${animation.referenceCount ?? "-"} | ${animation.candidateCount ?? "-"} |`);
	lines.push("", "## Other categories", "", "- Asset mismatch: recorded under `assets` in `scorecard.json`.", "- Behavioral mismatch: recorded under `behavior` from the 0/25/50/75/100% scroll probe.", "- Animation mismatch: recorded separately from static screenshots; static capture uses `stabilize.css`.");
	lines.push("", "## Next priority", "");
	if (!data.nextPriority.length) lines.push("No section diff result was available.");
	else for (const item of data.nextPriority) lines.push(`- \`${item.section}\` at ${item.viewport}: diff ratio ${formatRatio(item.diffRatio)} (${item.diffPixels} pixels).`);
	if (data.failures.length) lines.push("", "## Failures", "", ...data.failures.map((failure) => `- [${failure.category}] ${failure.viewport || ""}: ${failure.error || failure.status || "unknown"}`));
	return `${lines.join("\n")}\n`;
}

function renderMismatchTable(items, kind) {
	if (!items.length) return ["No mismatch was recorded."];
	if (kind === "geometry") {
		return ["| Viewport | Selector | Property | Expected | Actual | Delta |", "| --- | --- | --- | ---: | ---: | ---: |", ...items.map((item) => `| ${item.viewport} | \`${item.selector}\` | ${item.property || item.status} | ${item.expected ?? "-"} | ${item.actual ?? "-"} | ${item.delta ?? "-"} |`)];
	}
	return ["| Viewport | Selector | Property | Expected | Actual |", "| --- | --- | --- | --- | --- |", ...items.map((item) => `| ${item.viewport} | \`${item.selector}\` | ${item.property || item.status} | \`${String(item.expected ?? "-").replaceAll("`", "'")}\` | \`${String(item.actual ?? "-").replaceAll("`", "'")}\` |`)];
}

function formatRatio(value) {
	return typeof value === "number" ? `${(value * 100).toFixed(4)}%` : "-";
}

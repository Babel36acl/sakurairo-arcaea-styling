import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT, REPORT_ROOT, VIEWPORTS, ensureDir } from "./common.mjs";

const inputPath = path.join(REPORT_ROOT, "frozen-gate", "diff-results.json");
const outputPath = path.join(REPORT_ROOT, "frozen-gate", "post-card-metrics.json");
const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
const viewports = {};
for (const viewport of VIEWPORTS) {
	const comparison = input.viewports?.[viewport.name];
	const card = comparison?.sections?.["first-post-card"];
	viewports[viewport.name] = card
		? {
			status: card.status,
			width: card.width,
			height: card.height,
			diffPixels: card.diffPixels,
			totalPixels: card.totalPixels,
			diffRatio: card.diffRatio,
			pixelMatch: 1 - card.diffRatio,
			gate: 1 - card.diffRatio >= 0.99 ? "pass" : "below-99%",
			reference: card.reference,
			candidate: card.candidate,
			diff: card.diff,
		}
		: { status: "missing-capture", gate: "blocked" };
}

const result = {
	kind: "post-card-pixel-gate",
	threshold: input.threshold,
	referenceNoiseFloor: Object.fromEntries(Object.entries(input.noiseFloor || {}).map(([name, value]) => [name, value.diffRatio ?? null])),
	viewports,
	allPass: Object.values(viewports).every((value) => value.gate === "pass"),
	decision: Object.values(viewports).every((value) => value.gate === "pass") ? "Phase 2C — Footer + Homepage Full-page Fidelity" : "Phase 2B — Paint-only convergence",
};
await ensureDir(path.dirname(outputPath));
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: path.relative(PROJECT_ROOT, outputPath).replaceAll("\\", "/"), allPass: result.allPass, decision: result.decision, viewports }, null, 2));

import { execFileSync } from "node:child_process";
import path from "node:path";
import { CANDIDATE_URL, REFERENCE_URL, TOOLS_ROOT, parseArgs } from "./common.mjs";

const args = parseArgs();
const referenceUrl = args["reference-url"] || REFERENCE_URL;
const candidateUrl = args["candidate-url"] || CANDIDATE_URL;
const env = {
	...process.env,
	REFERENCE_URL: referenceUrl,
	CANDIDATE_URL: candidateUrl,
	VISUAL_REFERENCE_BUILD: args["reference-build"] || process.env.VISUAL_REFERENCE_BUILD || "historical WordPress reference",
	VISUAL_CANDIDATE_BUILD: args["candidate-build"] || process.env.VISUAL_CANDIDATE_BUILD || "local Astro candidate",
};

function run(name, extra = []) {
	const script = path.join(TOOLS_ROOT, name);
	console.log(`\n[visual] ${name}`);
	execFileSync(process.execPath, [script, ...extra], { cwd: path.resolve(TOOLS_ROOT, "../.."), env, stdio: "inherit" });
}

if (!args["skip-reference"]) run("capture-reference.mjs", ["--count", "2"]);
run("capture-candidate.mjs");

const probes = [
	["probe-layout.mjs", "layout-reference", referenceUrl],
	["probe-layout.mjs", "layout-candidate", candidateUrl],
	["probe-styles.mjs", "styles-reference", referenceUrl],
	["probe-styles.mjs", "styles-candidate", candidateUrl],
	["probe-fonts.mjs", "fonts-reference", referenceUrl],
	["probe-fonts.mjs", "fonts-candidate", candidateUrl],
	["probe-assets.mjs", "assets-reference", referenceUrl],
	["probe-assets.mjs", "assets-candidate", candidateUrl],
	["probe-animations.mjs", "animations-reference", referenceUrl],
	["probe-animations.mjs", "animations-candidate", candidateUrl],
	["probe-scroll-states.mjs", "scroll-reference", referenceUrl],
	["probe-scroll-states.mjs", "scroll-candidate", candidateUrl],
];
for (const [script, label, url] of probes) run(script, ["--url", url, "--label", label, "--output", path.join("reports", "visual", "probes", `${label}.json`)]);
run("diff-images.mjs");
run("generate-report.mjs");

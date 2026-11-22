// Only prose headings belong to the page's heading hierarchy. WordPress
// exports code as HTML <pre>, in addition to Markdown fenced code blocks.
export function normalizeMarkdownHeadingDepth(value) {
	let fence = null;
	let inPre = false;
	return String(value ?? "").split("\n").map((line) => {
		if (inPre) {
			if (/<\/pre\s*>/i.test(line)) inPre = false;
			return line;
		}
		if (!fence && /<pre(?:\s|>)/i.test(line)) {
			inPre = !/<\/pre\s*>/i.test(line);
			return line;
		}
		const marker = line.match(/^\s*(`{3,}|~{3,})/);
		if (marker) {
			if (!fence) fence = marker[1];
			else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && /^\s*(`+|~+)\s*$/.test(line)) fence = null;
			return line;
		}
		return !fence && /^#\s+/.test(line) ? `#${line}` : line;
	}).join("\n");
}

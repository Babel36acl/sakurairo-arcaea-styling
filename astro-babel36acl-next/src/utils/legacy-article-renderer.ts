export interface LegacyArticleHeading {
	depth: number;
	id: string;
	text: string;
}

const escapeHtml = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** WordPress HTML code blocks retain their source whitespace and hierarchy. */
export function renderLegacyArticle(body: string): { html: string; headings: LegacyArticleHeading[] } {
	const headings: LegacyArticleHeading[] = [];
	// Migrated legacy entries are HTML with only headings and diagrams converted
	// to Markdown. Parsing the entire HTML again introduces paragraphs/code nodes
	// inside existing raw blocks. Restore those two structural forms in place.
	const pieces = body.split(/(<pre\b[^>]*>[\s\S]*?<\/pre\s*>)/gi);
	const restored = pieces.map(piece => /^<pre\b/i.test(piece) ? piece : piece
		.replace(/^```mermaid[^\S\n]*\n([\s\S]*?)^```[^\S\n]*$/gm, (_block, source: string) => `<div class="arcaea-mermaid-box"><pre class="mermaid">${escapeHtml(source.trim())}</pre></div>`)
		.replace(/^(#{1,6})[ \t]+(.+)$/gm, (_line, hashes: string, text: string) => `<h${hashes.length}>${text.trim()}</h${hashes.length}>`)).join("");
	const html = restored.replace(/<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, depth, text) => {
		const id = `toc-head-${headings.length + 1}`;
		headings.push({ depth: Number(depth), id, text: String(text).replace(/<[^>]*>/g, "") });
		return `<h${depth} id="${id}">${text}</h${depth}>`;
	});
	return { html, headings };
}

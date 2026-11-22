import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { normalizeMarkdownHeadingDepth } from "./legacy-heading-normalization.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(appRoot, "..");
const currentAppRoot = path.join(workspaceRoot, "astro-babel36acl");
const inventoryPath = path.join(workspaceRoot, "tmp", "astro-wp-inventory.json");
const postsDataPath = path.join(currentAppRoot, "src", "data", "posts.json");
const pagesDataPath = path.join(currentAppRoot, "src", "data", "pages.json");
const articlesRoot = path.join(currentAppRoot, "src", "content", "articles");
const postsRoot = path.join(appRoot, "src", "content", "posts");
const pagesRoot = path.join(appRoot, "src", "content", "pages");
const manifestRoot = path.join(appRoot, "src", "data");

const trimHtml = (value) =>
	String(value ?? "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/\s+/g, " ")
		.trim();

const dateOnly = (value, fallback = "2025-01-01") => {
	const date = new Date(value ?? fallback);
	if (Number.isNaN(date.getTime())) return fallback;
	return date.toISOString().slice(0, 10);
};

const quote = (value) => JSON.stringify(String(value ?? ""));
const list = (values) => JSON.stringify(
	Array.from(new Set((values ?? []).map((value) => String(value).trim()).filter(Boolean))),
);

const toCanonicalPath = (route) => {
	const normalized = String(route ?? "").trim().replace(/^\/+|\/+$/g, "");
	return normalized ? `/${normalized}/` : "/";
};

const oldUrlSet = ({ id, type, canonicalPath, sourceUrl }) => {
	const urls = new Set();
	if (sourceUrl) urls.add(new URL(sourceUrl).pathname);
	if (type === "post") {
		urls.add(`/?p=${id}`);
		urls.add(`/index.php?p=${id}`);
	} else {
		urls.add(`/?page_id=${id}`);
		urls.add(`/index.php?page_id=${id}`);
	}
	if (canonicalPath !== "/") {
		urls.add(canonicalPath.replace(/\/$/, ".html"));
	}
	return [...urls];
};

const frontmatter = (data) => [
	"---",
	`title: ${quote(data.title)}`,
	`description: ${quote(data.description || data.title)}`,
	`published: ${data.published}`,
	...(data.updated ? [`updated: ${data.updated}`] : []),
	`draft: ${Boolean(data.draft)}`,
	`image: ${quote(data.image || "")}`,
	`tags: ${list(data.tags)}`,
	`category: ${data.primaryCategory ? quote(data.primaryCategory) : "null"}`,
	`categories: ${list(data.categories)}`,
	`primaryCategory: ${data.primaryCategory ? quote(data.primaryCategory) : "null"}`,
	`lang: ${quote(data.lang || "zh_CN")}`,
	`pinned: false`,
	`author: ${quote("chuixin")}`,
	`sourceLink: ${quote(data.sourceUrl || "")}`,
	`licenseName: ""`,
	`licenseUrl: ""`,
	`comment: false`,
	`password: ""`,
	`passwordHint: ""`,
	`series: ""`,
	`legacyId: ${Number(data.legacyId)}`,
	`contentType: ${quote(data.contentType)}`,
	`permalink: ${quote(data.canonicalPath)}`,
	`canonicalPath: ${quote(data.canonicalPath)}`,
	`legacyUrls: ${list(data.legacyUrls)}`,
	`commentKey: ${quote(`wp-${data.legacyId}`)}`,
	`sourceSlug: ${quote(data.sourceSlug || "")}`,
	"---",
	"",
].join("\n");

const pageFrontmatter = (data) => [
	"---",
	`title: ${quote(data.title)}`,
	`description: ${quote(data.description || data.title)}`,
	`published: ${data.published}`,
	...(data.updated ? [`updated: ${data.updated}`] : []),
	`draft: ${Boolean(data.draft)}`,
	`slug: ${quote(data.slug)}`,
	`legacyId: ${Number(data.legacyId)}`,
	`permalink: ${quote(data.canonicalPath)}`,
	`canonicalPath: ${quote(data.canonicalPath)}`,
	`legacyUrls: ${list(data.legacyUrls)}`,
	`sourceSlug: ${quote(data.sourceSlug || "")}`,
	"---",
	"",
].join("\n");

const normalizeInternalLinks = (html, routeById) => String(html ?? "")
	.replace(/https?:\/\/babel36acl\.xyz/gi, "")
	.replace(/(?:\/index\.php)?\?p=(\d+)/gi, (_match, id) => routeById.get(Number(id)) ?? `/?p=${id}`)
	.replace(/(?:\/index\.php)?\?page_id=(\d+)/gi, (_match, id) => routeById.get(Number(id)) ?? `/?page_id=${id}`);

const decodeHtmlEntities = (value) => String(value ?? "")
	.replace(/&amp;/gi, "&")
	.replace(/&lt;/gi, "<")
	.replace(/&gt;/gi, ">")
	.replace(/&quot;/gi, '"')
	.replace(/&#39;/gi, "'");

// Preserve Mermaid labels verbatim; the native renderer supports multiline labels.
const normalizeMermaidSource = (value) => String(value ?? "");

// WordPress exports headings and Mermaid diagrams as raw HTML. Convert only
// these structural wrappers to Markdown so Astro can collect headings and run
// the existing Mermaid rehype plugin without changing the article body.
const normalizeLegacyBody = (html) => normalizeMarkdownHeadingDepth(
	String(html ?? "")
	.replace(
		/<div[^>]*class=["'][^"']*\barcaea-mermaid-box\b[^"']*["'][^>]*>\s*<pre[^>]*class=["'][^"']*\bmermaid\b[^"']*["'][^>]*>([\s\S]*?)<\/pre>\s*<\/div>/gi,
		(_match, code) => {
			const fence = String.fromCharCode(96).repeat(3);
			return `\n\n${fence}mermaid\n${normalizeMermaidSource(decodeHtmlEntities(String(code).replace(/<[^>]+>/g, "").trim()))}\n${fence}\n\n`;
		},
	)
	.replace(
		/<h([1-6])(?:\s[^>]*)?>([\s\S]*?)<\/h\1>/gi,
		(_match, depth, content) => `\n\n${"#".repeat(Number(depth))} ${String(content).trim()}\n\n`,
	)
	.replace(/```mermaid\s*\n([\s\S]*?)\n```/gi, (_match, code) => {
		const fence = String.fromCharCode(96).repeat(3);
		return `${fence}mermaid\n${normalizeMermaidSource(String(code).trim())}\n${fence}`;
	}),
);

const removeGeneratedFiles = async (root) => {
	await fs.mkdir(root, { recursive: true });
	for (const entry of await fs.readdir(root, { withFileTypes: true, recursive: true })) {
		if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".mdx"))) {
			const parent = entry.parentPath ?? entry.path ?? root;
			await fs.unlink(path.join(parent, entry.name));
		}
	}
};

const inventory = JSON.parse(await fs.readFile(inventoryPath, "utf8"));
const entries = Array.isArray(inventory) ? inventory : inventory.entries ?? [];
const postsData = JSON.parse(await fs.readFile(postsDataPath, "utf8"));
const pagesData = JSON.parse(await fs.readFile(pagesDataPath, "utf8"));
const inventoryById = new Map(entries.map((entry) => [Number(entry.id), entry]));
const postsDataById = new Map(postsData.map((entry) => [Number(entry.id), entry]));
const pagesDataById = new Map(pagesData.map((entry) => [Number(entry.id), entry]));
const routeById = new Map();
for (const entry of [...postsData, ...pagesData]) {
	const route = toCanonicalPath(entry.route || entry.slug);
	if (route !== "/") routeById.set(Number(entry.id), route);
}

await removeGeneratedFiles(postsRoot);
await removeGeneratedFiles(pagesRoot);
await fs.mkdir(manifestRoot, { recursive: true });

const migratedPosts = [];
const articleFiles = await fs.readdir(articlesRoot, { recursive: true });
for (const relativeFile of articleFiles) {
	if (!String(relativeFile).endsWith(".md")) continue;
	const sourceFile = path.join(articlesRoot, relativeFile);
	const parsed = matter(await fs.readFile(sourceFile, "utf8"));
	const legacyId = Number(parsed.data.legacyId);
	if (!Number.isInteger(legacyId)) continue;
	const inventoryEntry = inventoryById.get(legacyId);
	const sourceEntry = postsDataById.get(legacyId) ?? inventoryEntry;
	const entry = inventoryEntry ?? sourceEntry;
	if (!entry) continue;
	const canonicalPath = parsed.data.permalink || toCanonicalPath(entry.route || entry.slug);
	const categories = Array.isArray(parsed.data.categories)
		? parsed.data.categories
		: (entry.categories ?? []).map((category) => category.name ?? category);
	const tags = Array.isArray(parsed.data.tags) ? parsed.data.tags : (entry.tags ?? []);
	const data = {
		title: parsed.data.title || entry.title,
		description: parsed.data.description || sourceEntry.excerpt || entry.title,
		published: dateOnly(parsed.data.published || sourceEntry.date),
		updated: parsed.data.updated ? dateOnly(parsed.data.updated) : (sourceEntry.modified ? dateOnly(sourceEntry.modified) : null),
		draft: parsed.data.draft === true || entry.status !== "publish",
		image: "",
		tags,
		categories,
		primaryCategory: categories[0] || null,
		legacyId,
		contentType: "post",
		canonicalPath,
		legacyUrls: oldUrlSet({ id: legacyId, type: "post", canonicalPath, sourceUrl: sourceEntry.sourceUrl || sourceEntry.url }),
		sourceUrl: sourceEntry.sourceUrl || sourceEntry.url,
		sourceSlug: entry.slug,
	};
	const body = normalizeLegacyBody(normalizeInternalLinks(parsed.content, routeById));
	const destination = path.join(postsRoot, `wp-${legacyId}.md`);
	await fs.writeFile(destination, `${frontmatter(data)}${body.trim()}\n`, "utf8");
	migratedPosts.push({ id: legacyId, ...data, file: path.relative(appRoot, destination) });
}

const migratedPages = [];
for (const entry of entries.filter((item) => item.type === "page")) {
	const sourceEntry = pagesDataById.get(Number(entry.id)) ?? entry;
	const canonicalPath = toCanonicalPath(sourceEntry.route || sourceEntry.slug);
	const slug = String(sourceEntry.slug || sourceEntry.route || `wp-${entry.id}`).replace(/^\/+|\/+$/g, "");
	const data = {
		title: sourceEntry.title || `WordPress page ${entry.id}`,
		description: sourceEntry.excerpt || sourceEntry.title || `WordPress page ${entry.id}`,
		published: dateOnly(sourceEntry.date),
		updated: sourceEntry.modified ? dateOnly(sourceEntry.modified) : null,
		draft: entry.status !== "publish",
		slug,
		legacyId: Number(entry.id),
		canonicalPath,
		legacyUrls: oldUrlSet({ id: entry.id, type: "page", canonicalPath, sourceUrl: sourceEntry.sourceUrl || sourceEntry.url }),
		sourceSlug: sourceEntry.slug,
	};
	const body = normalizeLegacyBody(normalizeInternalLinks(sourceEntry.content, routeById));
	const destination = path.join(pagesRoot, `wp-${entry.id}.md`);
	await fs.writeFile(destination, `${pageFrontmatter(data)}${body.trim()}\n`, "utf8");
	migratedPages.push({ id: Number(entry.id), ...data, file: path.relative(appRoot, destination) });
}

await fs.writeFile(path.join(manifestRoot, "content-manifest.json"), `${JSON.stringify({
	generatedAt: new Date().toISOString(),
	source: path.relative(workspaceRoot, inventoryPath),
	posts: migratedPosts,
	pages: migratedPages,
	}, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
	posts: migratedPosts.length,
	pages: migratedPages.length,
	publishedPosts: migratedPosts.filter((post) => !post.draft).length,
	publishedPages: migratedPages.filter((page) => !page.draft).length,
	manifest: path.relative(appRoot, path.join(manifestRoot, "content-manifest.json")),
}, null, 2));

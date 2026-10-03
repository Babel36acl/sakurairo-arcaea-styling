import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readMarkdownArticles } from "./read-markdown-articles.mjs";

const SITE = "https://babel36acl.xyz";
const posts = JSON.parse(await readFile(path.resolve("src/data/posts.json"), "utf8"));
const pages = JSON.parse(await readFile(path.resolve("src/data/pages.json"), "utf8"));
const root = fileURLToPath(new URL("..", import.meta.url));
const articles = await readMarkdownArticles(root);
const overriddenLegacyIds = new Set(articles.flatMap((article) => article.legacyId === undefined ? [] : [article.legacyId]));
const activePosts = posts.filter((post) => !overriddenLegacyIds.has(post.id));
const activePages = pages.filter((page) => !overriddenLegacyIds.has(page.id));
const archiveRoutes = [...new Set([
  ...activePosts.map((post) => post.date.slice(0, 7)),
  ...articles.map((article) => article.published.slice(0, 7)),
])].map((month) => month.replace("-", "/"));
const routes = ["", ...activePosts.map((post) => post.route), ...activePages.map((page) => page.route), ...articles.map((article) => article.route), ...archiveRoutes];

function loc(route) {
  const segments = route
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment));
  return `${SITE}/${segments.join("/")}${segments.length > 0 ? "/" : ""}`;
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes.map((route) => `  <url><loc>${loc(route)}</loc></url>`).join("\n")}
</urlset>
`;

await mkdir(path.resolve("dist"), { recursive: true });
await writeFile(path.resolve("dist/sitemap.xml"), xml);
console.log(`Generated sitemap.xml with ${routes.length} URLs.`);

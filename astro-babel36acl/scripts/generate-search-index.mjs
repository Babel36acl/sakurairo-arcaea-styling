import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readMarkdownArticles } from "./read-markdown-articles.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#8230;|&hellip;/gi, "...");
}

function plainText(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?(\[[^\]]*\])\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[>*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(entry, content) {
  const source = plainText(entry.excerpt) || content;
  return source.length > 180 ? `${source.slice(0, 177)}...` : source;
}

const [posts, pages] = await Promise.all([
  readFile(resolve(root, "src/data/posts.json"), "utf8").then(JSON.parse),
  readFile(resolve(root, "src/data/pages.json"), "utf8").then(JSON.parse)
]);
const articles = await readMarkdownArticles(root);
const overriddenLegacyIds = new Set(articles.flatMap((article) => article.legacyId === undefined ? [] : [article.legacyId]));

const index = [...posts, ...pages].filter((entry) => !overriddenLegacyIds.has(entry.id)).map((entry) => {
  const content = plainText(entry.content);
  return {
    id: entry.id,
    type: entry.type,
    title: plainText(entry.title),
    url: `/${entry.route}/`,
    excerpt: excerpt(entry, content),
    content: content.slice(0, 9000)
  };
});
for (const article of articles) {
  const content = plainText(article.content);
  index.push({
    id: article.legacyId ?? article.id,
    type: "post",
    title: plainText(article.title),
    url: `/${article.route}/`,
    excerpt: excerpt({ excerpt: article.description }, content),
    content: content.slice(0, 9000)
  });
}

await mkdir(resolve(root, "public"), { recursive: true });
await writeFile(resolve(root, "public/search-index.json"), `${JSON.stringify(index)}\n`, "utf8");
console.log(`Generated search index: ${index.length} entries`);

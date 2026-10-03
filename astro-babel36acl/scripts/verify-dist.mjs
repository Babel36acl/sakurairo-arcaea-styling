import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMarkdownArticles } from './read-markdown-articles.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = path.join(root, 'dist');
const posts = JSON.parse(await readFile(path.join(root, 'src/data/posts.json'), 'utf8'));
const pages = JSON.parse(await readFile(path.join(root, 'src/data/pages.json'), 'utf8'));
const articles = await readMarkdownArticles(root);
const overriddenLegacyIds = new Set(articles.flatMap((article) => article.legacyId === undefined ? [] : [article.legacyId]));
const activePosts = posts.filter((post) => !overriddenLegacyIds.has(post.id));
const activePages = pages.filter((page) => !overriddenLegacyIds.has(page.id));
const entries = [...activePosts, ...activePages, ...articles.map((article) => ({ route: article.route }))];
const routes = new Set(['/', ...entries.map((entry) => `/${entry.route.replace(/^\/+|\/+$/g, '')}`)]);
const months = new Set([
  ...activePosts.map((post) => post.date.slice(0, 7)),
  ...articles.map((article) => article.published.slice(0, 7)),
]);

async function mustExist(file, description) {
  try { await access(file); } catch { throw new Error(`缺少${description}: ${file}`); }
}

for (const route of routes) {
  const target = route === '/' ? path.join(dist, 'index.html') : path.join(dist, route.slice(1), 'index.html');
  await mustExist(target, `页面 ${route}`);
}
for (const month of months) {
  const [year, monthNumber] = month.split('-');
  await mustExist(path.join(dist, year, monthNumber, 'index.html'), `归档页面 ${month}`);
}

const searchIndex = JSON.parse(await readFile(path.join(root, 'public/search-index.json'), 'utf8'));
if (searchIndex.length !== entries.length) throw new Error(`搜索索引 ${searchIndex.length} 条，内容 ${entries.length} 条`);
const sitemap = await readFile(path.join(dist, 'sitemap.xml'), 'utf8');
const sitemapCount = (sitemap.match(/<url>/g) || []).length;
const expectedSitemapCount = 1 + entries.length + months.size;
if (sitemapCount !== expectedSitemapCount) throw new Error(`sitemap ${sitemapCount} 条，预期 ${expectedSitemapCount} 条`);
console.log(`Static artifact verified: ${entries.length} content pages, ${months.size} archive pages, ${sitemapCount} sitemap URLs.`);

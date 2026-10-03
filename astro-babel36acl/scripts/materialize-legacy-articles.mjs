import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = JSON.parse(await readFile(path.join(root, 'src', 'data', 'posts.json'), 'utf8'));
const targetRoot = path.join(root, 'src', 'content', 'articles');

function unwrap(content) {
  const match = String(content || '').match(/^\s*<div class="arcaea-article-content">([\s\S]*)<\/div>\s*$/);
  return match ? match[1].trim() : String(content || '').trim();
}

function field(value) {
  return JSON.stringify(String(value ?? '').trim());
}

function list(values) {
  return JSON.stringify((values || []).map((value) => String(value?.name || value).trim()).filter(Boolean));
}

for (const post of source) {
  const route = String(post.route || '').replace(/^\/+|\/+$/g, '');
  const directory = path.join(targetRoot, `legacy-${post.id}`);
  await mkdir(directory, { recursive: true });
  const published = String(post.date).slice(0, 10);
  const updated = String(post.modified || post.date).slice(0, 10);
  const body = unwrap(post.content);
  const markdown = [
    '---',
    `title: ${field(post.title)}`,
    `description: ${field(post.excerpt || post.title)}`,
    `published: "${published}"`,
    `updated: "${updated >= published ? updated : published}"`,
    `permalink: "/${route}/"`,
    'draft: false',
    `categories: ${list(post.categories)}`,
    `tags: ${list(post.tags)}`,
    `legacyId: ${post.id}`,
    '---',
    '',
    body,
    '',
  ].join('\n');
  await writeFile(path.join(directory, 'index.md'), markdown, 'utf8');
}

console.log(`Materialized ${source.length} legacy WordPress posts as Astro content entries.`);

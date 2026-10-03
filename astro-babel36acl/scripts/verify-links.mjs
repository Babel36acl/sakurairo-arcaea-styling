import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const dist = path.join(process.cwd(), 'dist');
const htmlFiles = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.isFile() && entry.name.endsWith('.html')) htmlFiles.push(file);
  }
}

async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}

await walk(dist);
const missing = new Set();
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const raw = match[1];
    if (!raw || raw.startsWith('#') || /^(?:https?:|mailto:|tel:|data:|javascript:|blob:)/i.test(raw)) continue;
    const url = new URL(raw, 'https://babel36acl.xyz/');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    else if (pathname.endsWith('/')) pathname += 'index.html';
    if (!await exists(path.join(dist, pathname.slice(1)))) missing.add(url.pathname);
  }
}

if (missing.size) throw new Error(`静态内部链接缺少目标 (${missing.size}):\n${[...missing].sort().join('\n')}`);
console.log(`Internal links verified: ${htmlFiles.length} HTML files, no missing local targets.`);

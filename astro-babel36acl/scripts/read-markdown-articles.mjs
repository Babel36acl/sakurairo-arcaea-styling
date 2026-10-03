import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

function scalar(value) {
  const text = value.trim();
  if ((text.startsWith('[') && text.endsWith(']')) || (text.startsWith('"') && text.endsWith('"'))) {
    try { return JSON.parse(text); } catch { /* fall through to the legacy parser */ }
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text.startsWith('[') && text.endsWith(']')) {
    return text.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean)
      .map((item) => item.replace(/^['"]|['"]$/g, ''));
  }
  return text.replace(/^['"]|['"]$/g, '');
}

function parse(file, source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`${file}: 缺少 frontmatter 起止标记 ---`);
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator < 1) throw new Error(`${file}: 无法解析 frontmatter 行 ${line}`);
    data[line.slice(0, separator).trim()] = scalar(line.slice(separator + 1));
  }
  if (data.draft === undefined) data.draft = true;
  const route = String(data.permalink || '').replace(/^\/+|\/+$/g, '');
  return {
    id: file,
    legacyId: data.legacyId === undefined ? undefined : Number(data.legacyId),
    route,
    title: String(data.title || ''),
    description: String(data.description || ''),
    published: String(data.published || ''),
    updated: String(data.updated || data.published || ''),
    draft: data.draft === true,
    content: match[2],
  };
}

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.md')) result.push(fullPath);
  }
  return result;
}

export async function readMarkdownArticles(root, { includeDrafts = false } = {}) {
  const directory = path.join(root, 'src', 'content', 'articles');
  let files = [];
  try { files = await walk(directory); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const entries = await Promise.all(files.map(async (file) => parse(file, await readFile(file, 'utf8'))));
  return entries.filter((entry) => includeDrafts || !entry.draft);
}

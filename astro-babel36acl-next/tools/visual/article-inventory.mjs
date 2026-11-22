import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';
import { writeJson, PROJECT_ROOT } from './common.mjs';

const root = path.join(PROJECT_ROOT, 'src/content/posts');
const rows = [];
for (const file of await fs.readdir(root)) {
  if (!file.endsWith('.md')) continue;
  const { data, content } = matter(await fs.readFile(path.join(root, file), 'utf8'));
  if (!data.legacyId) continue;
  const html = marked.parse(content);
  const features = Object.fromEntries(['h2','h3','h4','p','img','pre','code','blockquote','ul','ol','table','a','details','video','iframe'].map(tag => [tag, [...html.matchAll(new RegExp(`<${tag}(?:\\s|>)`, 'gi'))].length]));
  features.mermaid = (content.match(/```mermaid|class="mermaid/g) || []).length;
  features.math = (content.match(/\$\$|\\\[/g) || []).length;
  const score = Object.values(features).filter(Boolean).length * 100 + Math.min(features.img, 5)*10 + Math.min(features.p, 50);
  rows.push({ id:data.legacyId,title:data.title,route:data.canonicalPath,source:`src/content/posts/${file}`, features,score,chars:content.length });
}
rows.sort((a,b)=>b.score-a.score);
for (const row of rows.slice(0, 8)) {
  try {
    const response = await fetch(`http://127.0.0.1:18081${row.route}`, {signal:AbortSignal.timeout(30000)});
    const html = await response.text();
    row.reference = {status:response.status, bytes:html.length, postIdMatch:html.includes(`post-${row.id}`)};
  } catch(error) {row.reference={error:String(error)};}
}
await writeJson(path.join(PROJECT_ROOT,'reports/visual/phase3a/inventory.json'),rows);
console.log(JSON.stringify(rows.slice(0,8),null,2));

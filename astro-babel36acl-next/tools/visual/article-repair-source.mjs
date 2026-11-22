import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import {normalizeMarkdownHeadingDepth} from '../../scripts/legacy-heading-normalization.mjs';
import {PROJECT_ROOT,writeJson} from './common.mjs';
const sourceFile=path.resolve(PROJECT_ROOT,'../astro-babel36acl/src/content/articles/legacy-798/index.md');
const targetFile=path.join(PROJECT_ROOT,'src/content/posts/wp-798.md');
const source=matter(await fs.readFile(sourceFile,'utf8')).content;
const target=await fs.readFile(targetFile,'utf8');
const blocks=[...source.matchAll(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi)].map(x=>x[0]).filter(x=>!/^<pre[^>]*\bmermaid\b/i.test(x));
let fixed=target;const changes=[];
for(const block of blocks){
 if(normalizeMarkdownHeadingDepth(block)!==block)throw new Error('HTML code must be unchanged by normalization');
 const damaged=block.replace(/^#(?=\s)/gm,'##');
 if(damaged!==block&&fixed.includes(damaged)){fixed=fixed.replace(damaged,block);changes.push({original:block,damaged});}
}
if(!changes.length)throw new Error('No proven damage matched; refusing an unverified rewrite');
const originalProse=target.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi,'');
const fixedProse=fixed.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi,'');
if(originalProse!==fixedProse)throw new Error('Prose changed');
await fs.writeFile(targetFile,fixed,'utf8');
await writeJson(path.join(PROJECT_ROOT,'reports/visual/phase3a/source-repair.json'),{sourceFile,targetFile,blocksChecked:blocks.length,blocksRepaired:changes.length,proseUnchanged:true,changes});
console.log({blocksChecked:blocks.length,blocksRepaired:changes.length,proseUnchanged:true});

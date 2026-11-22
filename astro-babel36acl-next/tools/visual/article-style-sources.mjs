import fs from 'node:fs/promises';
import path from 'node:path';
import {fromHtml} from 'hast-util-from-html';
import {PROJECT_ROOT,writeJson} from './common.mjs';
const dir=path.join(PROJECT_ROOT,'reports/visual/phase3a/reference-798');
const q=JSON.parse(await fs.readFile(path.join(dir,'qualification.json'),'utf8'));
const tree=fromHtml(q.state.head,{fragment:true});const inline=[];
const walk=n=>{if(n.tagName==='style')inline.push({id:n.properties?.id||'',css:n.children.map(c=>c.value||'').join('')});n.children?.forEach(walk);};walk(tree);
await writeJson(path.join(dir,'inline-styles.json'),inline);
const sheets=[];
for(const [i,s]of q.state.stylesheets.entries()){
 const response=await fetch(s.href,{signal:AbortSignal.timeout(30000)});
 if(response.status!==200)throw new Error(`${s.href}: ${response.status}`);
 const css=await response.text(); const file=`sheet-${i}.css`;
 await fs.writeFile(path.join(dir,file),css);sheets.push({...s,file,bytes:css.length});
}
await writeJson(path.join(dir,'style-sources.json'),sheets);
console.log({inline:inline.map(x=>({id:x.id,bytes:x.css.length})),sheets});

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {PROJECT_ROOT,writeJson} from './common.mjs';
const root=path.join(PROJECT_ROOT,'public/assets/legacy-code');
const origin='http://127.0.0.1:18081/wp-content/plugins/babel-arcaea-code/assets/';
const queue=['mermaid/mermaid.esm.min.mjs'];
const seen=new Set(queue),records=[];
while(queue.length){
 const batch=queue.splice(0,4);
 const results=await Promise.all(batch.map(async file=>{
  const response=await fetch(origin+file,{signal:AbortSignal.timeout(90000)});
  if(!response.ok)throw new Error(`${response.status}: ${file}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  const target=path.resolve(root,file);
  if(!target.startsWith(root+path.sep))throw new Error('Outside vendor root');
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);
  records.push({file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  return {file,text:bytes.toString('utf8')};
 }));
 for(const {file,text}of results){
  for(const m of text.matchAll(/["'](\.\.?\/[^"']+\.mjs)["']/g)){
   const child=path.posix.normalize(path.posix.join(path.posix.dirname(file),m[1]));
   if(!seen.has(child)){seen.add(child);queue.push(child);}
  }
 }
 console.log('Mermaid verified',records.length,'pending',queue.length);
}
await writeJson(path.join(PROJECT_ROOT,'reports/visual/phase3a/mermaid-vendor-provenance.json'),{origin,records});

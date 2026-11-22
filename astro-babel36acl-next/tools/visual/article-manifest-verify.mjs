import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {PROJECT_ROOT,readJson,writeJson} from './common.mjs';
const file=path.join(PROJECT_ROOT,'reports/visual/phase3a/manifest-asset-verification.json');
const rows=await readJson(file),{manifest}=await readJson(path.join(PROJECT_ROOT,'src/data/legacy-article-runtime.json'));
const hash=b=>crypto.createHash('sha256').update(b.toString('utf8').replaceAll('\r\n','\n')).digest('hex');
for(const row of rows.filter(r=>r.error)){
 const asset=manifest.scripts[row.name]||manifest.styles[row.name];
 const local=asset.src.replace('/assets/legacy-code/','').split('?')[0];
 const response=await fetch('http://127.0.0.1:18081/wp-content/plugins/babel-arcaea-code/assets/'+local,{signal:AbortSignal.timeout(90000)});
 if(!response.ok)throw new Error(`${row.name}: HTTP ${response.status}`);
 const liveHash=hash(Buffer.from(await response.arrayBuffer())),localHash=hash(await fs.readFile(path.join(PROJECT_ROOT,'../babel-arcaea-code/assets',local)));
 delete row.error;Object.assign(row,{file:local,http:response.status,same:liveHash===localHash,liveHash,localHash});
 await writeJson(file,rows);console.log(row.name,row.same);
}

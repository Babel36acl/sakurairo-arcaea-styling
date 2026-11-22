import fs from 'node:fs/promises';
import {createBrowser,readJson,writeJson} from './common.mjs';
const b=await createBrowser(),rows={};
try{for(const side of ['candidate','reference']){
 const p=await b.newPage({viewport:{width:768,height:1024},colorScheme:'dark',locale:'zh-CN'});
 const a=(await readJson('reports/visual/phase3a/inventory.json')).find(r=>r.id===798);
 await p.goto((side==='reference'?'http://127.0.0.1:18081':'http://127.0.0.1:4323')+a.route,{waitUntil:'load',timeout:120000});
 await p.waitForFunction(()=>document.querySelectorAll('.mermaid svg').length===11,{},{timeout:180000});await p.evaluate(()=>document.fonts.ready);
 await p.addStyleTag({content:await fs.readFile('tests/visual/stabilize.css','utf8')});
 await p.evaluate(()=>{for(const e of document.querySelectorAll('#comments,.comments-number'))e.remove();document.querySelector('#footer_yiyan').textContent='酒调动着我们自身的温度，我们却糊涂的感谢世界的温暖。——鲍鹏山「百家讲坛」';document.querySelector('.site-stats').textContent='加载耗时 1.718 秒 | 查询 73 次 | 内存使用 14.83 MB';scrollTo(0,document.documentElement.scrollHeight-innerHeight);});
 await p.waitForTimeout(1000);
 rows[side]=await p.locator('#colophon').evaluate(e=>[e,...e.querySelectorAll('p,.footer-content')].map(e=>({id:e.id,text:e.textContent,rect:e.getBoundingClientRect().toJSON(),style:Object.fromEntries(['position','font','font-style','transform','visibility','margin','padding','display'].map(p=>[p,getComputedStyle(e).getPropertyValue(p)]))})));
 await p.screenshot({path:'reports/visual/phase3a/'+side+'-footer-probe.png'});
 await p.locator('#colophon').screenshot({path:'reports/visual/phase3a/'+side+'-footer-crop.png'});await p.close();
}console.log(JSON.stringify(rows,null,2));await writeJson('reports/visual/phase3a/footer-probe.json',rows);}finally{await b.close();}

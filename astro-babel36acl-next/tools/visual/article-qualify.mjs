import fs from 'node:fs/promises';
import path from 'node:path';
import { createBrowser, writeJson, PROJECT_ROOT } from './common.mjs';

const inventory = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT,'reports/visual/phase3a/inventory.json'),'utf8'));
const article = inventory.find(row=>row.id===Number(process.env.ARTICLE_ID || 798));
const output = path.join(PROJECT_ROOT,`reports/visual/phase3a/reference-${article.id}`);
await fs.mkdir(output,{recursive:true});
const browser = await createBrowser();
// Qualification observes the real runtime; freezing Date also freezes theme timers.
const context = await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,colorScheme:'dark',locale:'zh-CN',timezoneId:'Asia/Shanghai'});
const page = await context.newPage();
const events={requests:[],responses:[],failed:[],consoleErrors:[],pageErrors:[],domcontentloaded:false,load:false};
page.on('request',r=>events.requests.push({url:r.url(),type:r.resourceType(),method:r.method()}));
page.on('response',async r=>{const row={url:r.url(),status:r.status(),type:r.request().resourceType()};events.responses.push(row);if(r.status()>=400)row.body=await r.text().catch(String);});
page.on('requestfailed',r=>events.failed.push({url:r.url(),failure:r.failure()}));
page.on('console',m=>{if(m.type()==='error')events.consoleErrors.push(m.text());});
page.on('pageerror',e=>events.pageErrors.push(String(e)));
page.on('domcontentloaded',()=>events.domcontentloaded=true);
page.on('load',()=>events.load=true);
try {
 const response=await page.goto(`http://127.0.0.1:18081${article.route}`,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForLoadState('load',{timeout:120000});
 await page.evaluate(()=>document.fonts.ready);
 await page.waitForFunction(()=>document.querySelectorAll('.mermaid svg').length===11&&!document.querySelector('[data-bac-mermaid-rendering="1"]'),{},{timeout:180000});
 await page.waitForTimeout(1000);
 const state=await page.evaluate(()=>{
   const id=e=>e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+[...e.classList].map(c=>'.'+c).join('');
   const tree=(e,d=0)=>{if(d>6||['SCRIPT','STYLE','SVG','PATH'].includes(e.tagName))return null;return {node:id(e),children:[...e.children].map(c=>tree(c,d+1)).filter(Boolean)};};
   return {url:location.href,title:document.title,readyState:document.readyState,body:!!document.body,bodyClass:document.body.className,
    fonts:[...document.fonts].map(f=>({family:f.family,status:f.status,weight:f.weight})),
    stylesheets:[...document.querySelectorAll('link[rel=stylesheet]')].map(e=>({href:e.href,loaded:!!e.sheet})),
    images:[...document.images].map(e=>({src:e.currentSrc||e.src,loaded:e.complete&&e.naturalWidth>0,loading:e.loading,width:e.naturalWidth,height:e.naturalHeight})),
    features:{headings:document.querySelectorAll('.entry-content h2,.entry-content h3,.entry-content h4').length,mermaid:document.querySelectorAll('.mermaid svg').length,code:document.querySelectorAll('pre').length},tree:tree(document.body),
    article:document.querySelector('article')?.outerHTML, head:document.head.innerHTML,
    links:[...document.querySelectorAll('a')].filter(e=>/toc|prev|next|share|author|tag|category/.test(e.className+' '+e.parentElement.className)).map(e=>({text:e.textContent.trim().slice(0,120),href:e.getAttribute('href'),class:e.className,parent:e.parentElement.className}))};
 });
 const suffix=process.env.FINAL_QUALIFY?'-final':'';
 await fs.writeFile(path.join(output,`dom${suffix}.html`),await page.content());
 await page.screenshot({path:path.join(output,`top${suffix}.png`)});
 await writeJson(path.join(output,`qualification${suffix}.json`),{article,http:response.status(),events,state});
 console.log(JSON.stringify({output,http:response.status(),requests:events.requests.length,responses:events.responses.length,failed:events.failed,badResponses:events.responses.filter(r=>r.status>=400),consoleErrors:events.consoleErrors,pageErrors:events.pageErrors,domcontentloaded:events.domcontentloaded,load:events.load,readyState:state.readyState,fontsError:state.fonts.filter(f=>f.status==='error'),features:state.features},null,2));
} finally {await browser.close();}

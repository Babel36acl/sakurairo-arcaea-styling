import fs from 'node:fs/promises';
import path from 'node:path';
import {createBrowser,writeJson,PROJECT_ROOT} from './common.mjs';
import {instrumentArticleRuntime} from './article-runtime-instrumentation.mjs';
const side=process.argv[2]||'reference';
const base=side==='reference'?'http://127.0.0.1:18081':'http://127.0.0.1:4323';
const rows=JSON.parse(await fs.readFile(path.join(PROJECT_ROOT,'reports/visual/phase3a/inventory.json'),'utf8'));
const article=rows.find(x=>x.id===798);
const dir=path.join(PROJECT_ROOT,'reports/visual/phase3a',`${side}-lifecycle`);await fs.mkdir(dir,{recursive:true});
const browser=await createBrowser();
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,colorScheme:'dark',locale:'zh-CN',timezoneId:'Asia/Shanghai'});
await context.addInitScript(instrumentArticleRuntime);
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
const samples=[];
const save=()=>writeJson(path.join(dir,'audit.json'),{side,article,samples,errors});
async function sample(name){
 await page.waitForTimeout(1200);
 const state=await page.evaluate(()=>{
  const keys=['#page','.background_blur','#content-panel','.site-header','.nav-search-wrapper','.toc','#colophon','.bac-reading-progress','#bar'];
  const layers=Object.fromEntries(keys.map(k=>{const e=document.querySelector(k);if(!e)return[k,null];const s=getComputedStyle(e),r=e.getBoundingClientRect();return[k,{class:e.className,style:Object.fromEntries(['backdrop-filter','background','position','z-index','display','transform','opacity'].map(p=>[p,s.getPropertyValue(p)])),rect:{x:r.x,y:r.y,width:r.width,height:r.height}}];}));
  return {url:location.href,timeOrigin:performance.timeOrigin,scrollY,height:document.documentElement.scrollHeight,layers,runtime:window.__runtimeCounts(),wallpaper:{body:getComputedStyle(document.body).backgroundImage},counts:{canvas:document.querySelectorAll('canvas').length,sakura:document.querySelectorAll('#canvas_sakura').length,toc:document.querySelectorAll('.toc').length,toolbars:document.querySelectorAll('.code-toolbar').length,mermaid:document.querySelectorAll('.mermaid').length,svg:document.querySelectorAll('.mermaid svg').length},mermaidPending:[...document.querySelectorAll('[data-bac-mermaid-rendering]')].map(e=>e.getAttribute('data-bac-mermaid-rendering'))};
 });samples.push({name,...state});await save();console.log(name,state.timeOrigin,state.counts);
 await page.screenshot({path:path.join(dir,`${name}.png`),timeout:30000});
}
async function follow(route){
 if(route==='/'){await page.locator('.site-header').hover();await page.waitForTimeout(700);}
 const link=route==='/'?page.locator('.site-header nav a').filter({hasText:'首页'}).first():page.locator('.post-title a').filter({hasText:article.title}).first();
 await link.scrollIntoViewIfNeeded();await page.waitForTimeout(700);
 if(side==='reference'){await link.focus();await page.keyboard.press('Enter');}else await link.click();
 await page.waitForURL(u=>decodeURI(u.pathname).replace(/\/$/,'')===decodeURI(route).replace(/\/$/,''),{timeout:60000});
 await page.waitForLoadState('load',{timeout:60000});
 await page.waitForFunction(()=>document.readyState==='complete'&&document.fonts.status==='loaded',{},{timeout:60000});
}
try{
 await page.goto(base+'/',{waitUntil:'load',timeout:90000});
 await sample('home-initial');
 for(let round=1;round<=3;round++){
  await follow(article.route);
  try { await page.waitForFunction(()=>document.querySelectorAll('.mermaid svg').length===11&&!document.querySelector('[data-bac-mermaid-rendering="1"]'),{},{timeout:60000}); }
  catch(error){await sample(`article-${round}-not-ready`);await fs.writeFile(path.join(dir,`article-${round}-not-ready.html`),await page.content());throw error;}
  await sample(`article-${round}`);
  if(round===1){for(const ratio of [.25,.5,.75,1]){await page.evaluate(r=>scrollTo(0,(document.documentElement.scrollHeight-innerHeight)*r),ratio);await sample(`scroll-${Math.round(ratio*100)}`);}await page.evaluate(()=>scrollTo(0,0));}
  await follow('/');await sample(`home-${round}`);
 }
}catch(error){errors.push(String(error));console.error(error);process.exitCode=1;}finally{await save();await browser.close();}

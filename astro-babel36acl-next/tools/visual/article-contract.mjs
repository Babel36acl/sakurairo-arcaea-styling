import fs from 'node:fs/promises';
import path from 'node:path';
import { createBrowser, writeJson, readJson, PROJECT_ROOT, VIEWPORTS } from './common.mjs';

const inventory=JSON.parse(await fs.readFile(path.join(PROJECT_ROOT,'reports/visual/phase3a/inventory.json'),'utf8'));
const selected=inventory.find(x=>x.id===798);
const side=process.argv[2] || 'reference';
const origin=side==='reference'?'http://127.0.0.1:18081':'http://127.0.0.1:4323';
const browser=await createBrowser();
const results=await readJson(path.join(PROJECT_ROOT,`reports/visual/phase3a/${side}-contract.json`),{});
try {
 for(const vp of VIEWPORTS.filter(v=>!process.env.ARTICLE_VIEWPORT||v.name===process.env.ARTICLE_VIEWPORT)){
  const context=await browser.newContext({viewport:{width:vp.width,height:vp.height},deviceScaleFactor:1,colorScheme:'dark',locale:'zh-CN',timezoneId:'Asia/Shanghai'});
  const page=await context.newPage();
  await page.addInitScript(()=>document.addEventListener('bac:content-ready',()=>{window.__articleContentReady=true;}));
  await page.goto(origin+selected.route,{waitUntil:'load',timeout:120000});
  await page.evaluate(()=>Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,15000))]));
  await page.waitForFunction(()=>window.__articleContentReady===true,{},{timeout:180000});
  await page.waitForTimeout(1500);
  results[vp.name]=await page.evaluate(()=>{
   const props=['font-family','font-size','font-weight','font-style','line-height','letter-spacing','color','background','text-shadow','margin','padding','border','border-width','border-style','border-color','border-radius','display','position','overflow','gap','width','max-width','text-align','backdrop-filter','z-index','vertical-align','list-style-type'];
   const describe=e=>{if(!e)return null;const s=getComputedStyle(e),r=e.getBoundingClientRect();return {node:e.tagName.toLowerCase(),id:e.id,class:e.className,text:e.textContent.slice(0,160),rect:{x:r.x,y:r.y+scrollY,width:r.width,height:r.height,bottom:r.bottom+scrollY},style:Object.fromEntries(props.map(p=>[p,s.getPropertyValue(p)])),before:{content:getComputedStyle(e,'::before').content},after:{content:getComputedStyle(e,'::after').content}};};
   const selectors=['body','.site-header','.nav-search-wrapper','.headertop','#page','.background_blur','#content','#primary','article','.entry-header','.entry-title','.entry-census','.entry-content','.arcaea-article-content','.toc-container','.toc','.toc-list','.post-footer','.post-squares','.post-navigation','#comments','#colophon','.bac-reading-progress','#content-panel','#main-grid','.markdown','#post-title'];
   const content=document.querySelector('.entry-content')||document.querySelector('.markdown-content');
   const type=['p','a','strong','em','del','mark','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','code','code:not(pre code)','pre','table','thead','tbody','tr','th','td','hr','figcaption'];
   const tree=(e,d=0)=>{if(d>6||['SCRIPT','STYLE','PATH','SVG'].includes(e.tagName))return null;return {node:e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(typeof e.className==='string'?'.'+e.className.trim().replaceAll(/\s+/g,'.'):''),children:[...e.children].filter(c=>!e.matches('.entry-content,.markdown,.arcaea-article-content')||!c.matches('p,pre,ul,ol,table')).map(c=>tree(c,d+1)).filter(Boolean)};};
   return {title:document.title,bodyClass:document.body.className,scrollHeight:document.documentElement.scrollHeight,geometry:Object.fromEntries(selectors.map(s=>[s,describe(document.querySelector(s))])),typography:Object.fromEntries(type.map(s=>[s,describe([...content?.querySelectorAll(s)||[]].find(e=>!e.closest('svg,.mermaid')))])),rhythm:[...(content?.querySelectorAll('p,h2,h3,h4')||[])].filter(e=>!e.closest('svg,.mermaid')).map(describe),tree:tree(document.body),code:content?.querySelector('pre:not(.mermaid)')?.outerHTML,headings:[...(content?.querySelectorAll('h2,h3,h4')||[])].map(e=>({tag:e.tagName,id:e.id,text:e.textContent})),rich:{tables:content?.querySelectorAll('table').length,mermaid:content?.querySelectorAll('.mermaid').length,images:content?.querySelectorAll('img').length}};
  });
  const dir=path.join(PROJECT_ROOT,'reports/visual/phase3a',side,vp.name);await fs.mkdir(dir,{recursive:true});
  await page.screenshot({path:path.join(dir,'top.png')});
  await fs.writeFile(path.join(dir,'dom.html'),await page.content());
  await context.close();
  await writeJson(path.join(PROJECT_ROOT,`reports/visual/phase3a/${side}-contract.json`),results);
  console.log(side,vp.name,results[vp.name].scrollHeight);
 }
}finally{await browser.close();}

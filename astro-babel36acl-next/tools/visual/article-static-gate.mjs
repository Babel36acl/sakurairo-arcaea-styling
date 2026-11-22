import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {createBrowser,PROJECT_ROOT,VIEWPORTS,writeJson,readJson} from './common.mjs';
const root=path.join(PROJECT_ROOT,'reports/visual/phase3a/static');
const inventory=await readJson(path.join(PROJECT_ROOT,'reports/visual/phase3a/inventory.json'));
const article=inventory.find(r=>r.id===798);
const stabilize=await fs.readFile(path.join(PROJECT_ROOT,'tests/visual/stabilize.css'),'utf8');
const browser=await createBrowser();
const result=await readJson(path.join(root,'gate.json'),{threshold:12,viewports:{},normalizations:['User explicitly omitted comments and comment entry','Live view counter uses the imported 528 snapshot','Random footer quote and server performance counters use the shared homepage snapshot','Static animation stabilization only; dynamic tests are separate']});
const selection=process.env.ARTICLE_VIEWPORT;
try{for(const vp of VIEWPORTS.filter(v=>!selection||v.name===selection)){
 const dir=path.join(root,vp.name);await fs.mkdir(dir,{recursive:true});const captures={};
 for(const side of ['reference','candidate']){
  const context=await browser.newContext({viewport:{width:vp.width,height:vp.height},deviceScaleFactor:1,colorScheme:'dark',locale:'zh-CN',timezoneId:'Asia/Shanghai'});
  const gallery=await fs.readFile(path.join(PROJECT_ROOT,'public/assets/gallery/sakurairo-reference.jpg'));
  await context.route('**/assets/gallery/*',route=>route.fulfill({status:200,contentType:'image/jpeg',body:gallery}));
  await context.addInitScript(()=>{document.addEventListener('bac:content-ready',()=>window.__readyArticle=true);});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto((side==='reference'?'http://127.0.0.1:18081':'http://127.0.0.1:4323')+article.route,{waitUntil:'load',timeout:120000});
  await page.waitForFunction(()=>window.__readyArticle,{},{timeout:180000});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(500);
  // Complete the real initialization before freezing motion: the native nav
  // uses transition callbacks and the diagrams paint lazily off screen.
  for(const box of await page.locator('.arcaea-mermaid-box').all()){await box.scrollIntoViewIfNeeded();await page.waitForTimeout(120);}
  await page.locator('.post-squares').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  // Native background loader keeps the lazyload class after setting the URL.
  // Wait for the actual image, not a class transition absent from WordPress.
  await page.waitForFunction(()=>[...document.querySelectorAll('.post-squares .background')].every(e=>getComputedStyle(e).backgroundImage!=='none'),{},{timeout:30000});
  await page.evaluate(()=>Promise.all([...document.querySelectorAll('.post-squares .background')].map(e=>new Promise((resolve,reject)=>{const url=getComputedStyle(e).backgroundImage.match(/url\(["']?([^"')]+)/)?.[1];if(!url)return reject(new Error('Adjacent background is missing'));const image=new Image();image.onload=()=>resolve(true);image.onerror=()=>reject(new Error('Adjacent background failed'));image.src=url;}))));
  await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(800);
  await page.addStyleTag({content:stabilize});
  await page.evaluate(()=>{
   window.__staticSuppressed=[];
   for(const e of document.querySelectorAll('body *')){
    const s=getComputedStyle(e),r=e.getBoundingClientRect();
    if(s.position==='fixed'&&(r.top>=innerHeight||r.bottom<=0||r.left>=innerWidth||r.right<=0)){
     window.__staticSuppressed.push({tag:e.tagName,id:e.id,class:e.className,rect:r.toJSON()});
     e.style.visibility='hidden';
    }
   }
  });
  if(side==='reference')await page.screenshot({path:path.join(dir,'reference-original-top.png'),animations:'disabled'});
  await page.evaluate(()=>{
   window.__originalComments=[...document.querySelectorAll('#comments,.comments-number')].map(e=>({node:e,parent:e.parentNode,next:e.nextSibling}));
   for(const row of window.__originalComments)row.node.remove();
   const meta=document.querySelector('.entry-census');if(meta)for(const n of meta.childNodes)if(n.nodeType===3)n.textContent=n.textContent.replace(/\d+ 次阅读/,'528 次阅读');
   const quote=document.querySelector('#footer_yiyan');if(quote)quote.textContent='酒调动着我们自身的温度，我们却糊涂的感谢世界的温暖。——鲍鹏山「百家讲坛」';
   const stats=document.querySelector('.site-stats');if(stats)stats.textContent='加载耗时 1.718 秒 | 查询 73 次 | 内存使用 14.83 MB';
   scrollTo(0,0);
  });
  await page.waitForTimeout(300);
  const capture=await page.evaluate(()=>{
   const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y+scrollY,width:r.width,height:r.height,bottom:r.bottom+scrollY};};
   const content=document.querySelector('.entry-content');
   const p=[...content.querySelectorAll('p,h2,h3,h4')].filter(e=>!e.closest('svg,.mermaid'));
   const selectors={shell:'article',title:'.entry-title',meta:'.entry-census',content:'.entry-content',toc:'.toc',bottom:'.post-footer',adjacent:'.post-squares',footer:'#colophon',header:'.site-header',code:'.code-toolbar pre',blockquote:'blockquote',table:'table',mermaid:'.arcaea-mermaid-box'};
   return{scrollHeight:document.documentElement.scrollHeight,suppressedOffscreenFixedElements:window.__staticSuppressed,geometry:Object.fromEntries(Object.entries(selectors).map(([k,s])=>[k,rect(document.querySelector(s))])),rhythm:p.map(e=>({tag:e.tagName,text:e.textContent.slice(0,60),...rect(e)}))};
  });
  captures[side]={...capture,errors};
  await viewportStitch(page,path.join(dir,`${side}-full.png`),vp,capture.scrollHeight);
  await page.evaluate(()=>{document.querySelector('#colophon').style.visibility='';scrollTo(0,document.documentElement.scrollHeight-innerHeight);});
  await page.waitForTimeout(800);
  captures[side].footerAtBottom=await page.locator('#colophon').evaluate(e=>[e,...e.querySelectorAll('p,.footer-content')].map(e=>({class:e.className,id:e.id,text:e.textContent,rect:e.getBoundingClientRect().toJSON(),style:Object.fromEntries(['position','margin','padding','line-height','transform','display','visibility','opacity'].map(p=>[p,getComputedStyle(e).getPropertyValue(p)]))})));
  const footerBox=await page.locator('#colophon').boundingBox();
  // Chromium locator screenshots can clip backdrop-filter text on huge pages.
  // Crop the real viewport paint without asking Chromium to resize the surface.
  const footerViewport=await page.screenshot();
  await sharp(footerViewport).extract({left:Math.floor(footerBox.x),top:Math.floor(footerBox.y),width:Math.ceil(footerBox.width),height:Math.ceil(footerBox.height)}).png().toFile(path.join(dir,`${side}-footer.png`));
  if(side==='reference'){
   await page.evaluate(()=>{for(const row of window.__originalComments)row.parent.insertBefore(row.node,row.next);});
   await page.waitForTimeout(1000);
   await page.screenshot({path:path.join(dir,'reference-original-full.png'),fullPage:true,animations:'disabled'});
  }
  await context.close();console.log(vp.name,side,capture.scrollHeight);
 }
 const comparison=await compare(path.join(dir,'reference-full.png'),path.join(dir,'candidate-full.png'),dir,captures.reference.geometry);
 comparison.regions.footer=await compareComponent(path.join(dir,'reference-footer.png'),path.join(dir,'candidate-footer.png'));
 const geometry=Object.fromEntries(Object.entries(captures.reference.geometry).map(([key,r])=>{const c=captures.candidate.geometry[key];return[key,r&&c?Object.fromEntries(['x','y','width','height'].map(p=>[p,c[p]-r[p]])):null];}));
 const rhythm=captures.reference.rhythm.map((r,i)=>({index:i,text:r.text,topDelta:captures.candidate.rhythm[i]?.y-r.y,heightDelta:captures.candidate.rhythm[i]?.height-r.height}));
 result.viewports[vp.name]={captures,comparison,geometry,rhythm,maxRhythmDelta:Math.max(...rhythm.map(r=>Math.abs(r.topDelta)))};
 await writeJson(path.join(dir,'gate.json'),result.viewports[vp.name]);
 await writeJson(path.join(root,'gate.json'),result);console.log(vp.name,'pixelMatch',comparison.pixelMatch,'maxRhythm',result.viewports[vp.name].maxRhythmDelta);
}}finally{await browser.close();}
result.allPass=Object.keys(result.viewports).length===4&&Object.values(result.viewports).every(v=>v.comparison.pixelMatch>=.99);
for(const v of VIEWPORTS){const saved=await readJson(path.join(root,v.name,'gate.json'));if(saved)result.viewports[v.name]=saved;}
result.allPass=Object.keys(result.viewports).length===4&&Object.values(result.viewports).every(v=>v.comparison.pixelMatch>=.99);
await writeJson(path.join(root,'gate.json'),result);

async function compare(aPath,bPath,dir,geometry){
 const a=await sharp(aPath,{limitInputPixels:false}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const b=await sharp(bPath,{limitInputPixels:false}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const width=Math.max(a.info.width,b.info.width),height=Math.max(a.info.height,b.info.height);
 const absolute=Buffer.alloc(width*height*3),mask=Buffer.alloc(width*height);let mismatch=0,exact=0;
 const zones={...geometry,'content-top':{x:geometry.content.x,y:geometry.content.y,width:geometry.content.width,height:2000},'content-middle':{x:geometry.content.x,y:geometry.content.y+geometry.content.height/2,width:geometry.content.width,height:2000}};
 delete zones.footer;
 const stats=Object.fromEntries(Object.entries(zones).filter(([,r])=>r&&r.y<height).map(([k])=>[k,{total:0,diff:0}]));
 const regionEntries=Object.entries(stats);
 for(let y=0;y<height;y++){
 const rowRegions=regionEntries.filter(([key])=>y>=zones[key].y&&y<zones[key].y+zones[key].height);
 for(let x=0;x<width;x++){
  const p=y*width+x;let delta=0;const ai=(y*a.info.width+x)*4,bi=(y*b.info.width+x)*4;
  for(let c=0;c<3;c++){const d=Math.abs((y<a.info.height&&x<a.info.width?a.data[ai+c]:0)-(y<b.info.height&&x<b.info.width?b.data[bi+c]:0));absolute[p*3+c]=d;delta=Math.max(delta,d);}
  if(delta)exact++;if(delta>12){mismatch++;mask[p]=255;}
  for(const[k,s]of rowRegions){const r=zones[k];if(x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height){s.total++;if(delta>12)s.diff++;}}
 }
 }
 await sharp(absolute,{raw:{width,height,channels:3},limitInputPixels:false}).png().toFile(path.join(dir,'absolute-diff.png'));
 await sharp(mask,{raw:{width,height,channels:1},limitInputPixels:false}).png().toFile(path.join(dir,'binary-mask.png'));
 for(const [key,s]of Object.entries(stats)){
  const r=zones[key],box={left:Math.max(0,Math.floor(r.x)),top:Math.max(0,Math.floor(r.y)),width:Math.min(width-Math.max(0,Math.floor(r.x)),Math.ceil(r.width)),height:Math.min(a.info.height-Math.max(0,Math.floor(r.y)),Math.ceil(r.height),3000)};
  if(box.width>0&&box.height>0)for(const [side,file]of [['reference',aPath],['candidate',bPath]])if(box.top+box.height<=(side==='reference'?a.info.height:b.info.height))await sharp(file,{limitInputPixels:false}).extract(box).png().toFile(path.join(dir,`${side}-${key}.png`));
  s.pixelMatch=s.total?1-s.diff/s.total:null;
 }
 return{width,height,pixelMatch:1-mismatch/(width*height),exactPixelMatch:1-exact/(width*height),mismatch,regions:stats};
}

async function viewportStitch(page,file,vp,height){
 // Capture actual viewport paint at each document offset. Huge Chromium
 // fullPage rasters lose offscreen SVG/backdrop layers on the reference.
 // Fixed chrome is shown only in the first tile (its document-top position);
 // its scrolling states are captured independently by article-interactions.
 const tiles=[];
 for(let top=0;top<height;top+=vp.height){
  await page.evaluate(y=>scrollTo(0,y),top);await page.waitForTimeout(70);
  if(top===vp.height)await page.evaluate(()=>{
   window.__fixedTileHidden=[];
   for(const e of document.querySelectorAll('body *')){
    const s=getComputedStyle(e);
    if(s.position==='fixed'&&!e.matches('.background_blur')&&!e.contains(document.querySelector('article'))){window.__fixedTileHidden.push([e,e.style.visibility]);e.style.visibility='hidden';}
   }
   const toc=document.querySelector('.toc');if(toc){window.__fixedTileHidden.push([toc,toc.style.visibility]);toc.style.visibility='hidden';}
  });
  const y=await page.evaluate(()=>scrollY),length=Math.min(vp.height,height-top);
  const bytes=await page.screenshot();
  const cropped=await sharp(bytes).extract({left:0,top:top-y,width:vp.width,height:length}).png().toBuffer();
  tiles.push({input:cropped,left:0,top});
  if(tiles.length%20===0)console.log(path.basename(path.dirname(file)),path.basename(file),'tiles',tiles.length);
 }
 await sharp({create:{width:vp.width,height,channels:3,background:'#333'},limitInputPixels:false}).composite(tiles).png().toFile(file);
 await page.evaluate(()=>{for(const[e,visibility]of window.__fixedTileHidden||[])e.style.visibility=visibility;scrollTo(0,0);});
 await page.waitForTimeout(800);
}

async function compareComponent(aFile,bFile){
 const a=await sharp(aFile).ensureAlpha().raw().toBuffer({resolveWithObject:true}),b=await sharp(bFile).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const width=Math.max(a.info.width,b.info.width),height=Math.max(a.info.height,b.info.height);let diff=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let delta=0;for(let c=0;c<4;c++)delta=Math.max(delta,Math.abs((a.data[(y*a.info.width+x)*4+c]||0)-(b.data[(y*b.info.width+x)*4+c]||0)));
  if(delta>12)diff++;
 }
 return{total:width*height,diff,pixelMatch:1-diff/(width*height),capture:'Actual viewport at bottom, isolated footer crop'};
}

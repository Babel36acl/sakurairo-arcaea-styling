import path from 'node:path';
import {createBrowser,PROJECT_ROOT,readJson,writeJson,ensureDir} from './common.mjs';
const side=process.argv[2]||'candidate';
const root=path.join(PROJECT_ROOT,'reports/visual/phase3a',`${side}-interactions`);await ensureDir(root);
const inventory=await readJson(path.join(PROJECT_ROOT,'reports/visual/phase3a/inventory.json'));
const article=inventory.find(r=>r.id===798);
const browser=await createBrowser();const result=await readJson(path.join(root,'audit.json'),{side,viewports:{}});delete result.failure;
try{for(const width of [1440,390].filter(w=>!process.env.ARTICLE_WIDTH||w===Number(process.env.ARTICLE_WIDTH))){
 const context=await browser.newContext({viewport:{width,height:width===390?844:900},deviceScaleFactor:1,colorScheme:'dark',locale:'zh-CN',permissions:['clipboard-read','clipboard-write']});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto((side==='reference'?'http://127.0.0.1:18081':'http://127.0.0.1:4323')+article.route,{waitUntil:'load',timeout:120000});
 await page.waitForFunction(()=>document.querySelectorAll('.mermaid svg').length===11&&!document.querySelector('[data-bac-mermaid-rendering="1"]'),{},{timeout:180000});await page.evaluate(()=>document.fonts.ready);
 const r={errors,states:[]};result.viewports[width]=r;
 async function snap(name){
  await page.waitForTimeout(800);await page.screenshot({path:path.join(root,`${width}-${name}.png`)});
  r.states.push({name,...await page.evaluate(()=>{const p=document.querySelector('.bac-reading-progress');const nav=document.querySelector('.nav-search-wrapper');return{scrollY,progress:p?{width:p.getBoundingClientRect().width,style:p.getAttribute('style'),html:p.innerHTML}:null,active:document.querySelector('.toc .is-active-link')?.getAttribute('href'),footer:document.querySelector('#colophon')?.className,nav:nav?.getBoundingClientRect().toJSON()};})});
 }
 await snap('top');
 if(width===390){await page.locator('.mo-toc-button').click();await page.waitForTimeout(700);r.mobileOpen=await page.locator('.mo_toc_panel').evaluate(e=>e.classList.contains('open'));await snap('mobile-toc');}
 const toc=width===390?'.mo_toc_panel':'.toc';
 const first=page.locator(toc+' a.toc-link[href]' ).first();const hash=await first.getAttribute('href');await first.click({position:{x:10,y:8}});await page.waitForTimeout(1600);
 r.tocClick=await page.evaluate(hash=>{const h=document.querySelector(hash),active=document.querySelector('.toc .is-active-link');return{hash,headingTop:h?.getBoundingClientRect().top,active:active?.getAttribute('href'),textTop:h?getComputedStyle(h,'::before').height:null};},hash);await snap('toc-active');
 const copy=page.locator('.copy-to-clipboard-button').first();await copy.scrollIntoViewIfNeeded();await copy.hover();await copy.click();await page.waitForTimeout(200);
 r.copy={state:await copy.getAttribute('data-copy-state'),clipboardLength:(await page.evaluate(()=>navigator.clipboard.readText())).length};await snap('code-copy');
 const fold=page.locator('.bac-code-fold-toggle').first();await fold.scrollIntoViewIfNeeded();await fold.click();r.fold=await fold.getAttribute('aria-expanded');await fold.click();
 const diagram=page.locator('.arcaea-mermaid-box').first();await diagram.scrollIntoViewIfNeeded();await diagram.hover();await diagram.getByRole('button',{name:'查看 Mermaid 大图'}).click();
 await page.waitForTimeout(500);r.diagramOverlay=await page.evaluate(()=>!!document.querySelector('.arcaea-mermaid-overlay.active'));await snap('mermaid-overlay');await page.keyboard.press('Escape');
 r.horizontal=await page.evaluate(()=>({body:document.documentElement.scrollWidth>innerWidth,code:[...document.querySelectorAll('.code-toolbar pre')].map(e=>({client:e.clientWidth,scroll:e.scrollWidth,overflow:getComputedStyle(e).overflowX,whiteSpace:getComputedStyle(e).whiteSpace})),table:[...document.querySelectorAll('table')].filter(e=>e.closest('.entry-content')).map(e=>({client:e.clientWidth,scroll:e.scrollWidth,overflow:getComputedStyle(e).overflowX}))}));
 for(const ratio of [.25,.5,.75,1]){await page.evaluate(r=>scrollTo(0,(document.documentElement.scrollHeight-innerHeight)*r),ratio);await snap(`scroll-${ratio*100}`);}
 await writeJson(path.join(root,'audit.json'),result);await context.close();console.log(side,width,JSON.stringify({copy:r.copy,toc:r.tocClick,overlay:r.diagramOverlay,errors}));
}}catch(e){result.failure=String(e.stack||e);console.error(e);process.exitCode=1;}finally{await writeJson(path.join(root,'audit.json'),result);await browser.close();}

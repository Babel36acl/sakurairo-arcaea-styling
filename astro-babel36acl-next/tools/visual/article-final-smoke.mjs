import path from 'node:path';
import {createBrowser,PROJECT_ROOT,readJson,writeJson} from './common.mjs';
const root=path.join(PROJECT_ROOT,'reports/visual/phase3a');
const browser=await createBrowser(),result=await readJson(path.join(root,'final-smoke.json'),{});
try {
 const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'dark',locale:'zh-CN'});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:4323/',{waitUntil:'load'});
 await page.evaluate(()=>document.fonts.ready);
 const samples=[];
 for(let i=0;i<8;i++){samples.push(await page.locator('.typewriter').allTextContents());await page.waitForTimeout(500);}
 const canvas=page.locator('#canvas_sakura');const a=await canvas.screenshot();await page.waitForTimeout(500);const b=await canvas.screenshot();
 const glass=async()=>page.evaluate(()=>Object.fromEntries(['#content-panel','.background_blur','.nav-search-wrapper'].map(s=>{const e=document.querySelector(s);return[s,e?{filter:getComputedStyle(e).backdropFilter,background:getComputedStyle(e).background,rect:e.getBoundingClientRect().toJSON()}:null]})));
 const top=await glass();await page.evaluate(()=>scrollTo(0,1100));await page.waitForTimeout(700);const scrolled=await glass();
 const medal=page.locator('.medal-capsule.gold').first();await medal.scrollIntoViewIfNeeded();await page.waitForTimeout(1500);
 await medal.evaluate(e=>e.addEventListener('medal:tilt',()=>e.dataset.tiltObserved='true'));
 await medal.hover({position:{x:25,y:25}});await page.waitForTimeout(1000);
 const medalState=await medal.evaluate(e=>({initialized:e.dataset.medalEffectsInitialized,tiltObserved:e.dataset.tiltObserved,inlineTransform:e.style.transform,transform:getComputedStyle(e).transform,tooltipOpacity:getComputedStyle(e.querySelector('.medal-info-tooltip')).opacity,particles:e.querySelectorAll('.medal-particle').length}));
 result.home={typewriterSamples:samples,typewriterChanges:new Set(samples.map(s=>JSON.stringify(s))).size>1,sakuraCount:await canvas.count(),sakuraPaintChanges:!a.equals(b),glass:{top,scrolled},medal:medalState,errors};
 const article=(await readJson(path.join(root,'inventory.json'))).find(r=>r.id===798);
 for(const side of (process.env.HOME_ONLY?[]:['reference','candidate'])){
  await page.goto((side==='reference'?'http://127.0.0.1:18081':'http://127.0.0.1:4323')+article.route,{waitUntil:'load',timeout:120000});
  await page.waitForFunction(()=>document.querySelectorAll('.mermaid svg').length===11,{},{timeout:180000});
  await page.evaluate(()=>scrollTo(0,1000));await page.waitForTimeout(800);
  await page.locator('#changskin').click();await page.waitForTimeout(600);
  const skinOpen=await page.locator('.skin-menu').evaluate(e=>e.classList.contains('show'));
  await page.locator('#moblieGoTop').click();await page.waitForTimeout(1800);
  result[side]={skinOpen,backToTop:await page.evaluate(()=>scrollY),skinClosedOnScroll:await page.locator('.skin-menu').evaluate(e=>!e.classList.contains('show'))};
 }
 await writeJson(path.join(root,'final-smoke.json'),result);console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}

import { createBrowser, openPreparedPage, closeBrowserResources, viewportByName } from './common.mjs';
const browser = await createBrowser(); const v = viewportByName('desktop-1272');
for (const [label,url] of [['ref','http://127.0.0.1:18082/'],['cand','http://127.0.0.1:4323/']]) {
  const r = await openPreparedPage(browser,url,v,{static:true,waitMs:700,waitForImages:true,waitForBackgroundImages:true});
  const out = await r.page.evaluate(() => {
    const all = [...document.querySelectorAll('body *')];
    return all.filter(e => { const s=getComputedStyle(e), b=e.getBoundingClientRect(); const key=`${e.id} ${String(e.className)}`.toLowerCase(); return /(sidebar|widget|iro|archive|recent|site-info|stats|exhibition|content-panel|content-wrapper|main-grid)/.test(key) && s.display!=='none' && b.width>0 && b.height>0; }).map(e=>{const s=getComputedStyle(e),b=e.getBoundingClientRect();return {tag:e.tagName,id:e.id,cls:String(e.className).slice(0,180),text:e.textContent?.trim().replace(/\s+/g,' ').slice(0,120),rect:{x:b.x,y:b.y,w:b.width,h:b.height,b:b.bottom},display:s.display,pos:s.position,z:s.zIndex,bg:s.backgroundColor,opacity:s.opacity}}).sort((a,b)=>a.rect.y-b.rect.y||a.rect.x-b.rect.x).slice(0,120);
  });
  console.log(label,JSON.stringify(out,null,2)); await closeBrowserResources(r);
}
await browser.close();

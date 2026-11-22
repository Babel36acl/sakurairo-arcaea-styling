import { createBrowser, openPreparedPage, closeBrowserResources, viewportByName } from "./common.mjs";
const b=await createBrowser();
for(const [label,url] of [["ref","http://127.0.0.1:18082/"],["cand","http://127.0.0.1:4323/"]]){
 const h=await openPreparedPage(b,url,viewportByName("desktop-1272"),{static:true,waitMs:700,waitForImages:true,waitForBackgroundImages:true});
 const out=await h.page.evaluate(()=>{
   const sels=[".site-header",".nav-search-wrapper",".nav-search-wrapper nav",".nav-search-wrapper .menu",".nav-search-wrapper .menu li",".nav-search-wrapper .menu a",".nav-search-divider",".header-tool",".user-menu-wrapper",".mobile-nav",".mo-nav-button"];
   return {justify:getComputedStyle(document.querySelector(".site-header")).justifyContent, items:Object.fromEntries(sels.map(sel=>[sel,[...document.querySelectorAll(sel)].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {text:e.textContent?.trim(),rect:{x:r.x,y:r.y,w:r.width,h:r.height,b:r.bottom},display:s.display,position:s.position,width:s.width,maxWidth:s.maxWidth,overflow:s.overflow,padding:s.padding,margin:s.margin,gap:s.gap,font:s.font,color:s.color,opacity:s.opacity}})]))};
 });
 console.log(`===${label}===`);console.log(JSON.stringify(out,null,2));await closeBrowserResources(h);
}
await b.close();

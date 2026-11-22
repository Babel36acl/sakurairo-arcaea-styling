import { createBrowser, openPreparedPage, closeBrowserResources, viewportByName } from "./common.mjs";
const b=await createBrowser();
const h=await openPreparedPage(b,"http://127.0.0.1:4323/",viewportByName("desktop-1272"),{static:true,waitMs:700});
console.log(JSON.stringify(await h.page.evaluate(()=>[...document.querySelector(".site-header").children].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {tag:e.tagName,cls:String(e.className),rect:{x:r.x,y:r.y,w:r.width,h:r.height},display:s.display,flex:s.flex,flexGrow:s.flexGrow,flexShrink:s.flexShrink,flexBasis:s.flexBasis,margin:s.margin,position:s.position,width:s.width,height:s.height,visibility:s.visibility,order:s.order}})),null,2));
await closeBrowserResources(h);await b.close();

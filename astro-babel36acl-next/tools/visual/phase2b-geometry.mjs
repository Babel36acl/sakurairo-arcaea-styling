import { createBrowser, openPreparedPage, closeBrowserResources, VIEWPORTS } from './common.mjs';
const selectors=['#content','#primary','#main','.main-title','#post-list-container','.post-list-thumb','.post-thumb','.post-date','.post-meta','.post-title','.post-excerpt','#pagination','#legacy-pagination-slot'];
function rect(e){if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height};}
function snap(){
 const rect=(e)=>{if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height};};
 const selectors=['#content','#primary','#main','.main-title','#post-list-container','.post-list-thumb','.post-thumb','.post-date','.post-meta','.post-title','.post-excerpt','#pagination','#legacy-pagination-slot'];
 const out={};
 for(const s of selectors){const es=[...document.querySelectorAll(s)];out[s]=es.slice(0,5).map(e=>rect(e));}
 out.overflow={innerWidth,scrollWidth:document.documentElement.scrollWidth,bodyScrollWidth:document.body.scrollWidth};
 out.classes=document.body.className;
 return out;
}
for(const v of VIEWPORTS){
 const b=await createBrowser();
 const result={viewport:v.name};
 for(const [label,url] of [['reference','http://127.0.0.1:18081/'],['candidate','http://127.0.0.1:4321/']]){
   const h=await openPreparedPage(b,url,v,{static:true,waitMs:300});
   result[label]=await h.page.evaluate(snap);
   await closeBrowserResources(h);
 }
 console.log(JSON.stringify(result));
 await b.close();
}

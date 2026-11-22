import {createBrowser,openPreparedPage,closeBrowserResources,VIEWPORTS} from './common.mjs';
const b=await createBrowser();
for(const v of VIEWPORTS){
 const out={viewport:v.name};
 for(const [label,url] of [['ref','http://127.0.0.1:18081/'],['cand','http://127.0.0.1:4321/']]){
  const r=await openPreparedPage(b,url,v,{static:true,waitMs:250});
  out[label]=await r.page.evaluate(()=>{const sels=['#navbar','nav','#navbar nav','.nav-search-wrapper','#top-row']; return Object.fromEntries(sels.map(sel=>{const e=document.querySelector(sel);if(!e)return [sel,null];const b=e.getBoundingClientRect(),s=getComputedStyle(e);return [sel,{rect:{x:b.x,y:b.y,w:b.width,h:b.height},display:s.display,width:s.width,maxWidth:s.maxWidth,padding:s.padding,margin:s.margin,boxSizing:s.boxSizing,position:s.position}]}));});
  await closeBrowserResources(r);
 }
 console.log(JSON.stringify(out));
}
await b.close();

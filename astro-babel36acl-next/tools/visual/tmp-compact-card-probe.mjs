import { createBrowser, openPreparedPage, closeBrowserResources, VIEWPORTS } from './common.mjs';
const sels=['.post-list-thumb','.post-thumb','.post-thumb img','.post-date','.post-meta','.post-title','.post-title h3','.post-excerpt','.post-excerpt p','.ai-excerpt-tip'];
for (const v of VIEWPORTS) {
  console.log('\n###',v.name);
  for (const [label,url] of [['ref','http://127.0.0.1:18081/'],['cand','http://127.0.0.1:4321/']]) {
    const b=await createBrowser(); const h=await openPreparedPage(b,url,v,{static:true,waitMs:500,waitForImages:true,waitForBackgroundImages:false});
    const out=await h.page.evaluate((sels)=>{
      const card=document.querySelector('.post-list-thumb');
      const result={text:{},styles:{},pseudo:{}};
      for(const sel of sels){const e=card?.querySelector(sel)|| (sel==='.post-list-thumb'?card:null);if(!e){result.styles[sel]=null;continue;}const s=getComputedStyle(e),r=e.getBoundingClientRect();result.text[sel]=e.textContent?.trim();result.styles[sel]={rect:[+r.x.toFixed(2),+r.y.toFixed(2),+r.width.toFixed(2),+r.height.toFixed(2)],display:s.display,position:s.position,font:s.font,color:s.color,background:s.background,border:s.border,borderRadius:s.borderRadius,boxShadow:s.boxShadow,filter:s.filter,backdropFilter:s.backdropFilter,opacity:s.opacity,overflow:s.overflow,objectFit:s.objectFit,objectPosition:s.objectPosition,verticalAlign:s.verticalAlign,letterSpacing:s.letterSpacing,lineHeight:s.lineHeight}; for(const p of ['::before','::after']){const q=getComputedStyle(e,p);result.pseudo[sel+p]={content:q.content,display:q.display,position:q.position,inset:q.inset,width:q.width,height:q.height,background:q.background,border:q.border,boxShadow:q.boxShadow,filter:q.filter,backdropFilter:q.backdropFilter,opacity:q.opacity,zIndex:q.zIndex};}}
      const img=card?.querySelector('img'); if(img) result.image={src:img.currentSrc,natural:[img.naturalWidth,img.naturalHeight],complete:img.complete};
      return result;
    },sels);
    console.log(label,JSON.stringify(out)); await closeBrowserResources(h); await b.close();
  }
}

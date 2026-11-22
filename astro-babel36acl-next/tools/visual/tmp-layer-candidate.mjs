import {createBrowser,openPreparedPage,closeBrowserResources,viewportByName} from './common.mjs';
const browser=await createBrowser();
const r=await openPreparedPage(browser,'http://127.0.0.1:4323/',viewportByName('desktop-1272'),{static:true,waitMs:500});
console.log(await r.page.evaluate(()=>Object.fromEntries(['body','#wallpaper-wrapper','#banner-overlay-container','.banner-home-text-overlay','#banner-images-container','#content-panel','.skin-menu','#iro-widget'].map(s=>{const e=document.querySelector(s),c=getComputedStyle(e);return[s,{rect:e.getBoundingClientRect().toJSON(),z:c.zIndex,filter:c.filter,backdrop:c.backdropFilter,pos:c.position,bg:c.background}]}))));
await r.page.addStyleTag({content:'body.legacy-post-list #wallpaper-wrapper{z-index:0!important}'});
await r.page.screenshot({path:'tmp/hero-layer.png',fullPage:false});
await closeBrowserResources(r);await browser.close();

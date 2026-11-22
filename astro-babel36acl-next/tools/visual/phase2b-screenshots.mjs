import fs from 'node:fs/promises';
import {createBrowser,openPreparedPage,closeBrowserResources,VIEWPORTS,REPORT_ROOT} from './common.mjs';
const dir=`${REPORT_ROOT}/phase2`;
await fs.mkdir(dir,{recursive:true});
for(const v of VIEWPORTS){
 for(const [label,url] of [['reference','http://127.0.0.1:18081/'],['candidate','http://127.0.0.1:4321/']]){
  const b=await createBrowser(); const h=await openPreparedPage(b,url,v,{static:true,waitMs:500});
  const card=h.page.locator('.post-list-thumb').first(); await card.screenshot({path:`${dir}/${v.name}-${label}-card-final.png`,animations:'disabled',scale:'css'});
  const shell=h.page.locator('#content').first(); if(await shell.count()) await shell.screenshot({path:`${dir}/${v.name}-${label}-content-shell-final.png`,animations:'disabled',scale:'css'});
  await closeBrowserResources(h); await b.close();
 }
}

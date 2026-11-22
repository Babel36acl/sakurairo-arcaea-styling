import fs from 'node:fs/promises';
import { createBrowser, openPreparedPage, closeBrowserResources, viewportByName } from './common.mjs';
const b=await createBrowser();
for(const name of ['desktop-1272','desktop-1440']){const r=await openPreparedPage(b,'http://127.0.0.1:18082/',viewportByName(name),{static:true,waitMs:700,waitForImages:true,waitForBackgroundImages:true});const data=await r.page.evaluate(()=>({iro:document.querySelector('#iro-widget')?.outerHTML, bodyClass:document.body.className, all:document.querySelector('#iro-widget')?.parentElement?.outerHTML}));await fs.writeFile(`tmp/iro-${name}.json`,JSON.stringify(data,null,2),'utf8');await closeBrowserResources(r)}await b.close();

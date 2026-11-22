import {createBrowser,readJson} from './common.mjs';
const browser=await createBrowser();
try {
 const article=(await readJson('reports/visual/phase3a/inventory.json')).find(r=>r.id===798);
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.goto('http://127.0.0.1:18081'+article.route,{waitUntil:'load',timeout:120000});
 await page.waitForFunction(()=>document.querySelectorAll('.mermaid svg').length===11,{},{timeout:180000});
 await page.locator('.post-squares').scrollIntoViewIfNeeded();await page.waitForTimeout(3000);
 console.log(JSON.stringify(await page.locator('.post-squares').evaluate(e=>({html:e.outerHTML,scrollY,rect:e.getBoundingClientRect(),backgrounds:[...e.querySelectorAll('.background')].map(e=>({class:e.className,style:getComputedStyle(e).backgroundImage,rect:e.getBoundingClientRect()}))})),null,2));
}finally{await browser.close();}

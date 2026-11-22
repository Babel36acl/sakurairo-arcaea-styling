import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { closeBrowserResources, createBrowser, ensureDir, openPreparedPage, REPORT_ROOT, VIEWPORTS } from './common.mjs';
const browser = await createBrowser();
const root = path.join(REPORT_ROOT, 'tmp-solid');
await ensureDir(root);
for (const v of VIEWPORTS) {
  const resources = await openPreparedPage(browser, 'http://127.0.0.1:4323/', v, { route: '/', static: true, waitMs: 700, waitForImages: true, waitForBackgroundImages: true });
  const dir = path.join(root, v.name); await ensureDir(dir);
  await resources.page.addStyleTag({ content: 'body.legacy-post-list #content-panel { background: rgb(51,51,51) !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }' });
  const cand = path.join(dir, 'full-page.png');
  await resources.page.screenshot({ path: cand, fullPage: true, animations: 'disabled', scale: 'css' });
  const ref = path.join(REPORT_ROOT, '..', '..', 'reference', 'frozen', 'home', 'screenshots', v.name, 'full-page-A.png');
  const a = await sharp(ref).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const b = await sharp(cand).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let exact=0, tol=0; const n=Math.max(a.info.width,b.info.width)*Math.max(a.info.height,b.info.height);
  for(let y=0;y<Math.max(a.info.height,b.info.height);y++) for(let x=0;x<Math.max(a.info.width,b.info.width);x++) { const o=(y*Math.max(a.info.width,b.info.width)+x)*4; const oa=(y*a.info.width+x)*a.info.channels; const ob=(y*b.info.width+x)*b.info.channels; let md=0; for(let c=0;c<4;c++){const av=(x<a.info.width&&y<a.info.height)?a.data[oa+c]:0; const bv=(x<b.info.width&&y<b.info.height)?b.data[ob+c]:0; md=Math.max(md,Math.abs(av-bv));} if(md>0)exact++; if(md>12)tol++; }
  console.log(v.name, JSON.stringify({ width:b.info.width,height:b.info.height, exactDiffPixels:exact, exactPixelMatch:1-exact/n, diffPixels:tol, pixelMatch:1-tol/n }));
  await closeBrowserResources(resources);
}
await browser.close();

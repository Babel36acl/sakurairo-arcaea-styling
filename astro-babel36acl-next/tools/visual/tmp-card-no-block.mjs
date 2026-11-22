import path from 'node:path';
import sharp from 'sharp';
import { createBrowser, openPreparedPage, closeBrowserResources, VIEWPORTS, REPORT_ROOT, ensureDir } from './common.mjs';
const browser = await createBrowser();
for (const viewport of VIEWPORTS) {
  const paths = {};
  for (const [label, url] of [['ref','http://127.0.0.1:18082/'],['cand','http://127.0.0.1:4323/']]) {
    const resources = await openPreparedPage(browser, url, viewport, { static: true, waitMs: 500, waitForImages: true, waitForBackgroundImages: true });
    const card = resources.page.locator('.post-list-thumb').first();
    await card.scrollIntoViewIfNeeded();
    await resources.page.waitForTimeout(400);
    const out = path.join(REPORT_ROOT, 'tmp-no-block', `${viewport.name}-${label}.png`);
    await ensureDir(path.dirname(out));
    await card.screenshot({ path: out, animations: 'disabled', scale: 'css' });
    paths[label] = out;
    await closeBrowserResources(resources);
  }
  const [left, right] = await Promise.all([sharp(paths.ref).raw().toBuffer({ resolveWithObject: true }), sharp(paths.cand).raw().toBuffer({ resolveWithObject: true })]);
  let diff = 0;
  for (let i = 0; i < left.data.length; i += 1) if (Math.abs(left.data[i] - right.data[i]) > 0) diff += 1;
  console.log(viewport.name, JSON.stringify({ width: left.info.width, height: left.info.height, diffChannels: diff, channels: left.info.channels, totalPixels: left.info.width * left.info.height, diffRatio: diff / left.data.length }));
}
await browser.close();

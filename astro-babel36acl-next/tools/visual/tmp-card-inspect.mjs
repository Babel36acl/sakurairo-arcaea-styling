import { createBrowser, openPreparedPage, closeBrowserResources, viewportByName } from './common.mjs';

const browser = await createBrowser();
const viewport = viewportByName('desktop-1272');
for (const [label, url] of [['ref', 'http://127.0.0.1:18082/'], ['cand', 'http://127.0.0.1:4323/']]) {
  const resources = await openPreparedPage(browser, url, viewport, { static: true, blockFonts: label === 'cand', waitMs: 500 });
  const card = resources.page.locator('.post-list-thumb').first();
  await card.scrollIntoViewIfNeeded();
  await resources.page.waitForTimeout(500);
  const info = await resources.page.evaluate(() => {
    const card = document.querySelector('.post-list-thumb');
    const pick = (selector) => {
      const e = card?.querySelector(selector);
      if (!e) return null;
      const s = getComputedStyle(e), r = e.getBoundingClientRect();
      return { selector, text: e.textContent?.trim(), html: e.outerHTML.slice(0, 350), rect: { x: r.x, y: r.y, w: r.width, h: r.height }, display: s.display, visibility: s.visibility, opacity: s.opacity, color: s.color, background: s.background, filter: s.filter, transform: s.transform, overflow: s.overflow, z: s.zIndex, font: s.font, line: s.lineHeight };
    };
    const r = card?.getBoundingClientRect();
    const img = card?.querySelector('img');
    return { body: document.body.className, cardRect: r && { x: r.x, y: r.y, w: r.width, h: r.height }, cardText: card?.innerText, cardHtml: card?.outerHTML.slice(0, 1200), children: ['.post-thumb', '.post-thumb img', '.post-date', '.post-meta', '.post-title', '.post-title h3', '.post-excerpt', '.post-excerpt p', '.ai-excerpt-tip'].map(pick), img: img && { src: img.currentSrc, complete: img.complete, natural: [img.naturalWidth, img.naturalHeight], loading: img.loading }, fonts: { status: document.fonts.status, list: [...document.fonts].map(f => ({ family: f.family, status: f.status })) } };
  });
  console.log(label, JSON.stringify(info, null, 2));
  await closeBrowserResources(resources);
}
await browser.close();

import { createBrowser, openPreparedPage, closeBrowserResources, VIEWPORTS } from './common.mjs';

const b = await createBrowser();
const v = VIEWPORTS.find((x) => x.name === 'desktop-1272');
for (const [label, url] of [['ref', 'http://127.0.0.1:18081/'], ['cand', 'http://127.0.0.1:4321/']]) {
  const h = await openPreparedPage(b, url, v, { static: true, waitMs: 500 });
  const result = await h.page.evaluate(() => {
    const e = document.querySelector('.post-list-thumb .post-thumb');
    const nodes = [e, e?.querySelector('a'), e?.querySelector('img')].filter(Boolean);
    const pseudo = (which) => {
      const s = getComputedStyle(e, which);
      return { content: s.content, display: s.display, position: s.position, inset: s.inset, background: s.background, backgroundImage: s.backgroundImage, filter: s.filter, opacity: s.opacity, z: s.zIndex };
    };
    const out = { html: e?.outerHTML.slice(0, 1800), pseudo: { before: pseudo('::before'), after: pseudo('::after') } };
    for (const node of nodes) {
      const s = getComputedStyle(node);
      const r = node.getBoundingClientRect();
      out[node.tagName] = { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, html: node.outerHTML.slice(0, 500), display: s.display, position: s.position, overflow: s.overflow, background: s.background, filter: s.filter, opacity: s.opacity, z: s.zIndex, objectFit: s.objectFit };
    }
    return out;
  });
  console.log(label, JSON.stringify(result, null, 2));
  await closeBrowserResources(h);
}
await b.close();

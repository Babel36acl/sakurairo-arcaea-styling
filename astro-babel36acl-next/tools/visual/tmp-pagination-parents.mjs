import { createBrowser, openPreparedPage, closeBrowserResources, viewportByName } from "./common.mjs";
const b = await createBrowser();
for (const [label, url] of [["ref", "http://127.0.0.1:18082/"], ["cand", "http://127.0.0.1:4323/"]]) {
  const r = await openPreparedPage(b, url, viewportByName("desktop-1272"), { static: true, waitMs: 700, waitForImages: true, waitForBackgroundImages: true });
  const out = await r.page.evaluate(() => {
    const el = document.querySelector("#pagination");
    const chain = [];
    for (let e = el; e; e = e.parentElement) {
      const box = e.getBoundingClientRect(); const s = getComputedStyle(e);
      chain.push({ tag: e.tagName, id: e.id, cls: String(e.className), rect: { x: box.x, y: box.y, w: box.width, h: box.height, b: box.bottom }, display:s.display, pos:s.position, margin:s.margin, padding:s.padding, clear:s.clear, float:s.float, height:s.height, minHeight:s.minHeight, boxSizing:s.boxSizing });
    }
    return { chain, previous: el?.previousElementSibling?.outerHTML.slice(0,600), next: el?.nextElementSibling?.outerHTML.slice(0,600) };
  });
  console.log(`===${label}===`); console.log(JSON.stringify(out, null, 2));
  await closeBrowserResources(r);
}
await b.close();

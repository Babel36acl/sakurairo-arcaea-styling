import { createBrowser, openPreparedPage, closeBrowserResources, VIEWPORTS } from "./common.mjs";
const browser = await createBrowser();
for (const viewport of VIEWPORTS) {
  const h = await openPreparedPage(browser, "http://127.0.0.1:18082/", viewport, { static: true, waitMs: 400 });
  const out = await h.page.evaluate(() => {
    const out = {};
    for (const sel of ["body", ".site.wrapper", "#page", "#content", "#primary", ".site-footer"]) {
      const e = document.querySelector(sel);
      if (!e) continue;
      out[sel] = { outer: e.outerHTML.slice(0, 5000), children: [...e.children].map((c) => ({ tag: c.tagName, id: c.id, cls: String(c.className), rect: c.getBoundingClientRect().toJSON(), style: { display: getComputedStyle(c).display, position: getComputedStyle(c).position, flex: getComputedStyle(c).flex, padding: getComputedStyle(c).padding, margin: getComputedStyle(c).margin, minHeight: getComputedStyle(c).minHeight, height: getComputedStyle(c).height } })) };
    }
    return out;
  });
  console.log(`=== ${viewport.name} ===`); console.log(JSON.stringify(out, null, 2));
  await closeBrowserResources(h);
}
await browser.close();

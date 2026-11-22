import { createBrowser, openPreparedPage, closeBrowserResources, VIEWPORTS } from "./common.mjs";

const browser = await createBrowser();
for (const viewport of VIEWPORTS) {
  for (const [label, url] of [["ref", "http://127.0.0.1:18082/"], ["cand", "http://127.0.0.1:4323/"]]) {
    let h;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { h = await openPreparedPage(browser, url, viewport, { static: true, waitMs: 700, waitForImages: true, waitForBackgroundImages: false }); break; }
      catch (error) { if (attempt === 3) { console.error(`FAILED ${viewport.name} ${label}`, error); continue; } await new Promise((resolve) => setTimeout(resolve, 700)); }
    }
    if (!h) continue;
    const result = await h.page.evaluate(() => {
      const selectors = [
        "html", "body", ".site.wrapper", "#page", "#content-panel", "#content-panel-inner", "#main-grid",
        "#content", "#primary", "#main", ".main-title", "#swup-container", "#content-wrapper",
        "#post-list-container", ".post-list-thumb", "#legacy-pagination-slot", "#pagination", ".site-footer", ".site-info", ".footer-content", ".theme-info",
      ];
      const info = (selector) => {
        const e = document.querySelector(selector);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        const b = e.getBoundingClientRect();
        return {
          selector, tag: e.tagName, id: e.id, cls: String(e.className), rect: { x: b.x, y: b.y, width: b.width, height: b.height, bottom: b.bottom },
          display: s.display, position: s.position, float: s.float, clear: s.clear, boxSizing: s.boxSizing,
          width: s.width, height: s.height, minHeight: s.minHeight, maxHeight: s.maxHeight,
          margin: s.margin, padding: s.padding, overflow: s.overflow, gap: s.gap,
          flex: `${s.flexGrow} ${s.flexShrink} ${s.flexBasis}`, align: s.alignItems,
        };
      };
      const pseudo = (selector) => {
        const e = document.querySelector(selector);
        if (!e) return null;
        return Object.fromEntries(["::before", "::after"].map((p) => { const s = getComputedStyle(e, p); return [p, { content: s.content, display: s.display, position: s.position, height: s.height, margin: s.margin, padding: s.padding, clear: s.clear, float: s.float }]; }));
      };
      const footerChildren = [...document.querySelectorAll(".site-footer *")].slice(0, 30).map((e) => ({ tag: e.tagName, id: e.id, cls: String(e.className), text: e.textContent?.trim().slice(0, 90) }));
      return { viewport: { width: innerWidth, height: innerHeight }, doc: { scrollHeight: document.documentElement.scrollHeight, bodyScrollHeight: document.body.scrollHeight, bodyHeight: document.body.getBoundingClientRect().height }, selectors: Object.fromEntries(selectors.map((s) => [s, info(s)])), pseudo: { content: pseudo("#content"), page: pseudo("#page"), wrapper: pseudo(".site.wrapper"), list: pseudo("#post-list-container") }, footerChildren };
    });
    console.log(`=== ${viewport.name} ${label} ===`);
    console.log(JSON.stringify(result, null, 2));
    await closeBrowserResources(h);
  }
}
await browser.close();

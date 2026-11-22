import { createBrowser, openPreparedPage, closeBrowserResources, VIEWPORTS } from "./common.mjs";

const browser = await createBrowser();
for (const viewport of VIEWPORTS) {
  for (const [label, url] of [["ref", "http://127.0.0.1:18082/"], ["cand", "http://127.0.0.1:4323/"]]) {
    const resources = await openPreparedPage(browser, url, viewport, {
      static: true,
      waitMs: 700,
      waitForImages: true,
      waitForBackgroundImages: true,
    });
    const data = await resources.page.evaluate(() => {
      const collect = (selector) => [...document.querySelectorAll(selector)].map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName,
          cls: String(element.className),
          text: element.textContent?.replace(/\\s+/g, " ").trim(),
          html: element.outerHTML.slice(0, 1000),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom },
          display: style.display,
          position: style.position,
          padding: style.padding,
          margin: style.margin,
          gap: style.gap,
          color: style.color,
          background: style.background,
          font: style.font,
          border: style.border,
          radius: style.borderRadius,
          boxShadow: style.boxShadow,
        };
      });
      return {
        viewport: { width: innerWidth, height: innerHeight },
        html: document.querySelector("#pagination")?.outerHTML,
        pagination: collect("#pagination, #pagination > *, #pagination a, #pagination button, #pagination svg, #pagination i"),
        slot: collect("#legacy-pagination-slot"),
      };
    });
    console.log(`=== ${viewport.name} ${label} ===`);
    console.log(JSON.stringify(data, null, 2));
    await closeBrowserResources(resources);
  }
}
await browser.close();

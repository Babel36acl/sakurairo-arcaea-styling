import { createBrowser, openPreparedPage, closeBrowserResources, viewportByName } from "./common.mjs";
const b = await createBrowser();
for (const [label, url] of [["ref", "http://127.0.0.1:18082/"], ["cand", "http://127.0.0.1:4323/"]]) {
  const h = await openPreparedPage(b, url, viewportByName("desktop-1272"), { static: true, waitMs: 700, waitForImages: true, waitForBackgroundImages: true });
  const out = await h.page.evaluate(() => {
    const sels = ["#colophon", ".site-info", ".footer-content", ".hitokoto", ".footer_info", ".site-stats", ".theme-info", ".sakura-icon", ".theme-info a"];
    return Object.fromEntries(sels.map(sel => [sel, [...document.querySelectorAll(sel)].map(e => { const b=e.getBoundingClientRect(), s=getComputedStyle(e); return {text:e.textContent?.replace(/\\s+/g," ").trim(), rect:{x:b.x,y:b.y,w:b.width,h:b.height,b:b.bottom}, display:s.display, position:s.position, margin:s.margin, padding:s.padding, font:s.font, line:s.lineHeight, color:s.color, background:s.backgroundColor, border:s.border, shadow:s.boxShadow, opacity:s.opacity}; })]));
  });
  console.log(`===${label}===`); console.log(JSON.stringify(out, null, 2));
  await closeBrowserResources(h);
}
await b.close();

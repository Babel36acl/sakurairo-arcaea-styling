import { createBrowser, openPreparedPage, closeBrowserResources, viewportByName } from './common.mjs';
const browser = await createBrowser();
const resources = await openPreparedPage(browser, 'http://127.0.0.1:18082/', viewportByName('desktop-1272'), { static: true, waitMs: 700, waitForImages: true, waitForBackgroundImages: true });
const output = await resources.page.evaluate(() => {
  const selectors = ['.skin-menu', '#iro-widget', '.sakura_widget', '.widget.widget_block', '.wp-block-group', '.wp-block-heading', '.wp-block-latest-posts', '.wp-block-latest-posts li', '.wp-block-latest-posts a', '.wp-block-archives-list', '.wp-block-categories', '.theme-controls', '.theme-controls > .menu-list', '.theme-controls .font-family-controls', '.theme-controls .font-family-controls button', '.theme-controls li'];
  const items = [];
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      items.push({ selector, tag: element.tagName, id: element.id, cls: String(element.className), text: element.children.length ? undefined : element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80), rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, display: style.display, position: style.position, box: style.boxSizing, width: style.width, height: style.height, padding: style.padding, margin: style.margin, gap: style.gap, flex: style.flex, align: style.alignItems, justify: style.justifyContent, background: style.backgroundColor, border: style.border, borderRadius: style.borderRadius, shadow: style.boxShadow, color: style.color, font: style.font, line: style.lineHeight, list: style.listStyle, overflow: style.overflow, z: style.zIndex });
    }
  }
  return items;
});
console.log(JSON.stringify(output, null, 2));
await closeBrowserResources(resources);
await browser.close();

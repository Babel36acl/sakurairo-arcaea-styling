import fs from 'node:fs/promises';
import { createBrowser, openPreparedPage, closeBrowserResources, viewportByName } from './common.mjs';
const browser = await createBrowser();
const resources = await openPreparedPage(browser, 'http://127.0.0.1:18082/', viewportByName('desktop-1272'), { static:true, waitMs:500 });
const result = await resources.page.evaluate(() => {
  const selectors = ['html', 'body', '.background', '#page', '.site.wrapper', '#content', '.skin-menu', '#iro-widget', '.sakura_widget', '.theme-controls', '.wp-block-heading'];
  const props = ['background','background-attachment','background-size','filter','backdrop-filter','position','z-index','inset','display','flex-direction','height','min-height','max-height','overflow','transform','padding','margin','text-align','border-top','border-bottom','box-sizing'];
  const styles = Object.fromEntries(selectors.map(sel => {
    const el = document.querySelector(sel);
    if(!el) return [sel, null];
    return [sel, { html:el.outerHTML.slice(0,200), rect:el.getBoundingClientRect().toJSON(), style:Object.fromEntries(props.map(p=>[p,getComputedStyle(el).getPropertyValue(p)])) }];
  }));
  const rules=[];
  function walk(list, parent='') {
    for(const rule of list) {
      if(rule.cssRules) walk(rule.cssRules,parent+(rule.conditionText || '')+' ');
      else if(rule.selectorText && /skin-menu|iro-widget|sakura_widget|theme-controls|font-family-controls|menu-list|^body|^html|^\.wrapper|#page|^h2|^\.dark h2/.test(rule.selectorText)) rules.push({parent,css:rule.cssText});
    }
  }
  for(const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch {} }
  return {styles,rules};
});
await fs.writeFile('tmp/layer-probe.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result.styles,null,2));
await closeBrowserResources(resources); await browser.close();

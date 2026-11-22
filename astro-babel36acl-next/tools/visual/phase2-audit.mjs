import path from 'node:path';
import { createBrowser, openPreparedPage, closeBrowserResources, VIEWPORTS, REPORT_ROOT, writeJson, ensureDir, parseArgs } from './common.mjs';
const args = parseArgs();
const root = path.join(REPORT_ROOT, 'phase2');
await ensureDir(root);
const browser = await createBrowser();
const result = {};
try {
  for (const viewport of VIEWPORTS.filter(v => !args.viewport || v.name === args.viewport)) {
    result[viewport.name] = {};
    for (const [label, url] of [['reference','http://127.0.0.1:18081'], ['candidate', args.candidate || 'http://127.0.0.1:4321']]) {
      const r = await openPreparedPage(browser, url, viewport, { static: true });
      try {
        const data = await r.page.evaluate(() => {
          const selectors = ['body','.site-header','.nav-search-wrapper','nav','nav a','.centerbg','.focusinfo','.center-text','.header-info','.header-info p','.top-social','.top-social a','.top-social img','.banner-image-slot img','#banner-dim-container .banner-dim-overlay','.site-content','#navbar','#navbar > div > div','#content-panel-inner'];
          const props = ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','margin','padding','display','position','top','left','transform','background','backgroundImage','backgroundSize','backgroundPosition','color','textShadow','boxShadow','border','borderRadius','filter','backdropFilter','opacity','boxSizing','gap','animationName'];
          return { headerHtml: document.querySelector('.header-info')?.innerHTML, samples: Object.fromEntries(selectors.map(sel => {
            const el=document.querySelector(sel);
            if(!el) return [sel,null];
            const s=getComputedStyle(el), b=el.getBoundingClientRect();
            return [sel,{rect:{x:b.x,y:b.y,width:b.width,height:b.height},styles:Object.fromEntries(props.map(p=>[p,s[p]]))}];
          })), faces:[...document.fonts].filter(f=>f.status==='loaded').map(f=>({family:f.family,weight:f.weight,style:f.style,status:f.status})), resources:performance.getEntriesByType('resource').filter(e=>/\.(ttf|woff2?|otf)([?#]|$)/.test(e.name)).map(e=>e.name) };
        });
        const cdp=await r.context.newCDPSession(r.page);
        await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
        const {root:doc}=await cdp.send('DOM.getDocument');
        data.platformFonts={};
        for(const selector of ['.center-text','.header-info p','nav a']) {
          const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:doc.nodeId,selector});
          if(nodeId) data.platformFonts[selector]=(await cdp.send('CSS.getPlatformFontsForNode',{nodeId})).fonts;
        }
        await r.page.screenshot({path:path.join(root,`${viewport.name}-${label}.png`),animations:'disabled',scale:'css'});
        result[viewport.name][label]=data;
        console.log(viewport.name, label, JSON.stringify(Object.fromEntries(Object.entries(data.samples).filter(([s])=>['.centerbg','.focusinfo','.center-text','.header-info','.site-header','.nav-search-wrapper'].includes(s)).map(([s,d])=>[s,d?.rect]))));
      } finally { await closeBrowserResources(r); }
    }
  }
} finally { await browser.close(); }
await writeJson(path.join(root,args.viewport ? `${args.viewport}-audit.json` : 'audit.json'),result);

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {PROJECT_ROOT,writeJson} from './common.mjs';
const require=createRequire(import.meta.resolve('postcss-nesting'));
const postcss=require('postcss');
const ref=path.join(PROJECT_ROOT,'reports/visual/phase3a/reference-798');
const source=path.resolve(PROJECT_ROOT,'../babel-arcaea-code/assets');
const target=path.join(PROJECT_ROOT,'public/assets/legacy-code');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
// Verify the implementation being reused against the qualified live assets.
const checks=[];
for(const file of ['js/content-loader.js','prism/prism-init.js','mermaid/mermaid-init.js','mermaid/mermaid-enhance.js','reading/reading-progress.js']){
 const live=await fetch('http://127.0.0.1:18081/wp-content/plugins/babel-arcaea-code/assets/'+file,{signal:AbortSignal.timeout(30000)});
 if(!live.ok)throw new Error(`Cannot verify ${file}: ${live.status}`);
 const actual=Buffer.from(await live.arrayBuffer()),local=await fs.readFile(path.join(source,file));
 const same=hash(actual.toString('utf8').replaceAll('\r\n','\n'))===hash(local.toString('utf8').replaceAll('\r\n','\n'));checks.push({file,live:hash(actual),local:hash(local),same,normalization:'CRLF to LF only'});
 if(!same)throw new Error(`Live/runtime source mismatch: ${file}`);
}
function scope(css){
 const root=postcss.parse(css);
 const animations=new Map();
 root.walkAtRules(/keyframes$/,rule=>{animations.set(rule.params,`legacy-article-${rule.params}`);rule.params=animations.get(rule.params);});
 root.walkDecls(/^(?:-webkit-)?animation(?:-name)?$/,decl=>{decl.value=decl.value.replace(/[a-zA-Z][\w-]*/g,name=>animations.get(name)||name);});
 root.walkRules(rule=>{
  if(rule.parent.type==='atrule'&&/keyframes$/.test(rule.parent.name))return;
  rule.selectors=rule.selectors.map(selector=>{
   if(/^(?:html|:root)\b/.test(selector))return selector.replace(/^(?:html|:root)\b/,'html.legacy-article-root').replace(/\bbody\b/g,'body.legacy-article');
   if(/^body\b/.test(selector))return selector.replace(/^body\b/,'body.legacy-article');
   return `body.legacy-article ${selector}`;
  });
 });
 return root.toString();
}
for(const dir of ['prism','mermaid','katex','css','reading','js'])await fs.cp(path.join(source,dir),path.join(target,dir),{recursive:true});
// Local plugin checkout and live WordPress ship different Mermaid bundles.
// Always replace the module closure with the qualified live version after copy.
await import('./article-vendor-sync.mjs');
// Runtime-loaded CSS obeys the same article ownership as the initial bundle.
for(const file of await fs.readdir(target,{recursive:true}))if(file.endsWith('.css')){
 const full=path.join(target,file);await fs.writeFile(full,scope(await fs.readFile(full,'utf8')));
}
await fs.copyFile(path.resolve(source,'../LICENSE'),path.join(target,'LICENSE'));
const configScript=await fs.readFile(path.join(ref,'bac-assets.js'),'utf8');
const config=JSON.parse(configScript.match(/var BAC_Config = (.*);\s*\n/)[1]);
const manifest=JSON.parse(configScript.match(/var BAC_Assets = (.*);(?:\s|$)/)[1]);
delete manifest.groups.markmap;
for(const bucket of ['styles','scripts'])for(const [key,asset]of Object.entries(manifest[bucket])){
 if(key.includes('markmap')){delete manifest[bucket][key];continue;}
 const rewrite=s=>typeof s==='string'?s.replaceAll(/https?:\/\/[^/]+\/wp-content\/plugins\/babel-arcaea-code\/assets/g,'/assets/legacy-code'):s;
 asset.src=rewrite(asset.src);asset.before=asset.before.map(rewrite);asset.after=asset.after.map(rewrite);
}
await writeJson(path.join(PROJECT_ROOT,'src/data/legacy-article-runtime.json'),{config,manifest});
const inline=JSON.parse(await fs.readFile(path.join(ref,'inline-styles.json'),'utf8'));
const theme=await fs.readFile(path.join(ref,'sheet-5.css'),'utf8');
const content=await fs.readFile(path.join(ref,'sheet-4.css'),'utf8');
const enhance=await fs.readFile(path.join(ref,'sheet-3.css'),'utf8');
const css=scope(`${inline[2].css}\n${content}\n${enhance}\n${theme}\n${inline[4].css}`);
await fs.writeFile(path.join(PROJECT_ROOT,'src/styles/legacy-article-reference.css'),`/* Sakurairo 3.0.11 + Babel Arcaea Code, captured from qualified WordPress.\n * Article-scoped source rules; provenance: reports/visual/phase3a/reference-798/style-sources.json. */\n${css}`);
const fonts=postcss.parse(inline[5].css);const keep=[];
for(const rule of fonts.nodes){
 if(rule.type!=='atrule'||rule.name!=='font-face')continue;
 const family=rule.nodes.find(d=>d.prop==='font-family')?.value;
 if(!family?.includes('FiraCode Nerd Font'))continue;
 const weight=rule.nodes.find(d=>d.prop==='font-weight')?.value;
 const style=rule.nodes.find(d=>d.prop==='font-style')?.value;
 if(style!=='normal'||!['300','400','500','600','700'].includes(weight))continue;
 const decl=rule.nodes.find(d=>d.prop==='src'),url=decl.value.match(/url\(['"]?([^'"\)]+)/)[1];
 const filename=path.basename(new URL(url).pathname);const dest=path.join(target,'fonts',filename);
 await fs.mkdir(path.dirname(dest),{recursive:true});
 const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Font download failed');
 await fs.writeFile(dest,Buffer.from(await response.arrayBuffer()));decl.value=decl.value.replace(url,`/assets/legacy-code/fonts/${filename}`);keep.push(rule.toString());
}
const brandsUrl='https://s4.zstatic.net/ajax/libs/font-awesome/6.7.2/webfonts/fa-brands-400.woff2';
const brands=await fetch(brandsUrl,{signal:AbortSignal.timeout(90000)});
if(!brands.ok)throw new Error('Font Awesome Brands download failed');
await fs.writeFile(path.join(target,'fonts/fa-brands-400.woff2'),Buffer.from(await brands.arrayBuffer()));
keep.push('@font-face{font-family:"Font Awesome 6 Brands";font-style:normal;font-weight:400;font-display:block;src:url("/assets/legacy-code/fonts/fa-brands-400.woff2") format("woff2")}');
await fs.writeFile(path.join(PROJECT_ROOT,'src/styles/legacy-article-fonts.css'),keep.join('\n'));
await writeJson(path.join(PROJECT_ROOT,'reports/visual/phase3a/runtime-provenance.json'),{checks,cssBytes:css.length,source,target});
console.log({verified:checks.length,cssBytes:css.length,fonts:keep.length});

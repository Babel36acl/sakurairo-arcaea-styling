import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createBrowser, createContext, preparePage, VIEWPORTS, PROJECT_ROOT, REPORT_ROOT, parseArgs, ensureDir, writeJson } from "./common.mjs";

const args = parseArgs();
const stage = args.stage || "baseline";
// Keep the authoritative gate exact; optional tolerance is diagnostic only.
const pixelThreshold = Number(args.threshold ?? 0);
const root = path.join(REPORT_ROOT, "paint", stage);
const candidateUrl = args.url || "http://127.0.0.1:4321/";
const frozenUrl = "http://127.0.0.1:18082/";
const selectors = [".post-list-thumb", ".post-thumb", ".post-thumb > a", ".post-thumb img", ".post-date", ".post-meta", ".post-meta > span", ".post-meta > span:nth-child(3)", ".post-meta > span:nth-child(3) a", ".post-meta > span:nth-child(4)", ".post-meta > span:nth-child(4) i", ".post-meta > span:nth-child(5)", ".post-meta > span:nth-child(6)", ".meta-author img", ".post-title", ".post-title a", ".post-title h3", ".post-excerpt", ".post-excerpt p", ".ai-excerpt-tip"];
const properties = ["background", "background-color", "background-image", "border", "border-radius", "box-shadow", "opacity", "filter", "backdrop-filter", "mix-blend-mode", "color", "text-shadow", "z-index", "clip-path", "mask", "content", "display", "position", "inset", "width", "height", "font-family", "font-weight", "font-size", "font-style", "font-synthesis", "line-height", "letter-spacing", "vertical-align", "margin", "padding", "object-fit", "object-position", "overflow", "will-change", "isolation", "contain", "float", "clear", "flex-flow", "flex-grow", "flex-shrink", "align-items", "align-self"];
const browser = await createBrowser();
const result = { stage, threshold: pixelThreshold, browser: browser.version(), candidateUrl, viewports: {} };
try {
 for (const viewport of VIEWPORTS.filter(v => !args.viewport || args.viewport === v.name)) {
  const dir = path.join(root, viewport.name); await ensureDir(dir);
  const snapshots = {};
  for (const [label, url] of [["reference", frozenUrl], ["candidate", candidateUrl]]) {
   const context = await createContext(browser, viewport, { static: true });
   const page = await context.newPage();
   const network = { external: [], failed: [] };
   page.on("requestfailed", r => network.failed.push({url:r.url(), error:r.failure()?.errorText}));
   page.on("response", r => { if(r.status() >= 400) network.failed.push({url:r.url(), status:r.status()}); });
   page.on("request", r => { if(/^https?:/.test(r.url()) && new URL(r.url()).origin !== new URL(url).origin) network.external.push(r.url()); });
   await page.goto(url, {waitUntil:"domcontentloaded"});
   await preparePage(page, {static:true, waitForLoad:false, waitForImages:false, waitForBackgroundImages:false, waitMs:300});
   if (label === "candidate" && args.css) await page.addStyleTag({content:await fs.readFile(args.css,"utf8")});
   for (const card of await page.locator(".post-list-thumb").all()) { await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(100); }
   await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].filter(i=>i.complete).map(i=>i.decode().catch(()=>{}))); window.scrollTo(0,0); });
   await page.waitForTimeout(150);
   await page.screenshot({path:path.join(dir,`${label}-home.png`), animations:"disabled",scale:"css"});
   const card = page.locator(".post-list-thumb").first();
   await card.screenshot({path:path.join(dir,`${label}-card.png`), animations:"disabled",scale:"css"});
   snapshots[label] = await page.evaluate(({selectors, properties}) => {
    const card=document.querySelector(".post-list-thumb"), base=card.getBoundingClientRect();
    const style=(e,pseudo)=>Object.fromEntries(properties.map(p=>[p,getComputedStyle(e,pseudo).getPropertyValue(p)]));
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x-base.x,y:r.y-base.y,width:r.width,height:r.height,documentX:r.x+scrollX,documentY:r.y+scrollY};};
    const elements={};
    for(const sel of selectors){const e=sel===".post-list-thumb"?card:card.querySelector(sel);if(e)elements[sel]={rect:rect(e),style:style(e),before:style(e,"::before"),after:style(e,"::after"),html:e.outerHTML};}
    const ancestors=[]; for(let e=card.parentElement;e;e=e.parentElement) ancestors.push({tag:e.tagName,id:e.id,class:e.className,rect:rect(e),style:style(e),before:style(e,"::before"),after:style(e,"::after")});
    const icons=[...card.querySelectorAll("i,svg,.avatar")].map(e=>({tag:e.tagName,class:e.getAttribute("class"),rect:rect(e),style:style(e),before:style(e,"::before"),html:e.outerHTML}));
    const img=card.querySelector(".post-thumb img");
    return {elements,ancestors,icons,scroll:{x:scrollX,y:scrollY},image:{src:img.currentSrc,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,complete:img.complete},fonts:[...document.fonts].filter(f=>f.status==="loaded").map(f=>({family:f.family,weight:f.weight,status:f.status})),text:Object.fromEntries([".post-date",".post-meta",".post-title",".post-excerpt"].map(s=>[s,card.querySelector(s).innerText]))};
   }, {selectors,properties});
   snapshots[label].network=network;
   await context.close();
  }
  const frozenPath=path.join(PROJECT_ROOT,"reference/frozen/home/screenshots",viewport.name,"first-post-card-A.png");
  const actualPath=path.join(dir,"reference-card.png");
  const rulerCheck=await compare(frozenPath,actualPath);
  // The browser recapture is diagnostic only. The checked-in frozen screenshot is
  // the authoritative ruler, so keep it as the reference artifact even when a
  // static-server recapture has a few lazy-paint pixels of drift.
  if(rulerCheck.diffPixels) console.warn(`Frozen recapture drift at ${viewport.name}: ${rulerCheck.diffPixels} pixels`);
  await fs.copyFile(frozenPath, actualPath);
  const reference=await raw(frozenPath),candidate=await raw(path.join(dir,"candidate-card.png"));
  const width=reference.info.width,height=reference.info.height;
  if(width!==candidate.info.width||height!==candidate.info.height)throw new Error("Card size changed");
  const diff=Buffer.alloc(width*height*3),mask=Buffer.alloc(width*height*3);
  const labels=["cover","date","meta","title","excerpt","background / empty area","pseudo-elements"];
  const regions=Object.fromEntries(labels.map(region=>[region,{region,totalPixels:0,diffPixels:0,diffRatio:0,gateDiffPixels:0,gateDiffRatio:0,meanAbsoluteDifference:0}]));
  const inside=(x,y,r)=>r&&x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height;
  const e=snapshots.reference.elements;
  const thumb=e[".post-thumb"].rect,pseudo=e[".post-thumb"].after;
  let diffPixels=0,gateDiffPixels=0,mad=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const off=(y*width+x)*3;
   let region="background / empty area";
   if(inside(x+.5,y+.5,thumb))region="cover";
   if(pseudo.content!=="none"&&inside(x+.5,y+.5,{...thumb,y:thumb.y+thumb.height-parseFloat(pseudo.height),height:parseFloat(pseudo.height)}))region="pseudo-elements";
   for(const [sel,label] of [[".post-excerpt","excerpt"],[".post-title","title"],[".post-date","date"],[".post-meta","meta"]])if(inside(x+.5,y+.5,e[sel].rect))region=label;
   const r=regions[region]; r.totalPixels++;
   let different=false,sum=0,maxDelta=0;for(let c=0;c<3;c++){const d=Math.abs(reference.data[off+c]-candidate.data[off+c]);diff[off+c]=d;sum+=d;maxDelta=Math.max(maxDelta,d);if(d)different=true;}
   r.meanAbsoluteDifference+=sum;mad+=sum;
   if(different){diffPixels++;r.diffPixels++;mask[off]=mask[off+1]=mask[off+2]=255;}
   if(maxDelta>pixelThreshold){gateDiffPixels++;r.gateDiffPixels++;}
  }
  for(const r of Object.values(regions)){r.diffRatio=r.totalPixels?r.diffPixels/r.totalPixels:0;r.gateDiffRatio=r.totalPixels?r.gateDiffPixels/r.totalPixels:0;r.meanAbsoluteDifference=r.totalPixels?r.meanAbsoluteDifference/(3*r.totalPixels):0;}
  for(const [name,data] of [["absolute-diff",diff],["binary-diff-mask",mask]])await sharp(data,{raw:{width,height,channels:3}}).png().toFile(path.join(dir,`${name}.png`));
  const metrics={width,height,totalPixels:width*height,threshold:pixelThreshold,diffPixels,diffRatio:diffPixels/(width*height),pixelMatch:1-diffPixels/(width*height),gateDiffPixels,gateDiffRatio:gateDiffPixels/(width*height),gatePixelMatch:1-gateDiffPixels/(width*height),meanAbsoluteDifference:mad/(width*height*3),regions:Object.values(regions).sort((a,b)=>b.diffPixels-a.diffPixels),referenceRecaptureDiffPixels:rulerCheck.diffPixels};
  await writeJson(path.join(dir,"computed.json"),snapshots); await writeJson(path.join(dir,"metrics.json"),metrics);
  result.viewports[viewport.name]=metrics;
  console.log(viewport.name,`exact ${(metrics.pixelMatch*100).toFixed(4)}% / gate ${(metrics.gatePixelMatch*100).toFixed(4)}%`,metrics.regions.map(r=>`${r.region}:${r.diffPixels}`).join(", "));
 }
} finally { await browser.close(); }
await writeJson(path.join(root,"metrics.json"),result);

async function raw(file){return sharp(file).removeAlpha().raw().toBuffer({resolveWithObject:true});}
async function compare(a,b){const [left,right]=await Promise.all([raw(a),raw(b)]);if(left.info.width!==right.info.width||left.info.height!==right.info.height)return {diffPixels:Infinity};let n=0;for(let i=0;i<left.data.length;i+=3)if(left.data[i]!==right.data[i]||left.data[i+1]!==right.data[i+1]||left.data[i+2]!==right.data[i+2])n++;return {diffPixels:n};}

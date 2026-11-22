import path from 'node:path';
import {PROJECT_ROOT,VIEWPORTS,readJson,writeJson} from './common.mjs';
const root=path.join(PROJECT_ROOT,'reports/visual/phase3a');
const reference=await readJson(path.join(root,'reference-contract.json'));
const candidate=await readJson(path.join(root,'candidate-contract.json'));
const typography={viewports:{},allPass:true};
const expand=s=>{const a=s.split(' ');return a.length===1?[a[0],a[0],a[0],a[0]]:a.length===2?[a[0],a[1],a[0],a[1]]:a.length===3?[a[0],a[1],a[2],a[1]]:a;};
for(const vp of VIEWPORTS){
 const elements={};
 for(const [selector,r]of Object.entries(reference[vp.name].typography)){
  const c=candidate[vp.name].typography[selector];
  if(!r&&!c){elements[selector]={status:'N/A',reason:'Absent from the canonical body'};continue;}
  if(!r||!c){elements[selector]={status:'FAIL',reference:r,candidate:c};typography.allPass=false;continue;}
  const differences=[];
  for(const [property,value]of Object.entries(r.style))if(value!==c.style[property]){
   let equivalent=false,reason='';
   const widthsR=expand(r.style['border-width']),widthsC=expand(c.style['border-width']);
   if(property.startsWith('border')&&widthsR.every(w=>w==='0px')&&widthsC.every(w=>w==='0px')){equivalent=true;reason='All four border widths are zero; no border paint or geometry.';}
   else if(property==='border-style'){
    const a=expand(value),b=expand(c.style[property]);
    equivalent=a.every((s,i)=>s===b[i]||widthsR[i]==='0px'&&widthsC[i]==='0px');
    if(equivalent)reason='Only zero-width sides differ; the painted top border matches.';
   }else if(selector==='hr'&&property==='color'&&r.style.background===c.style.background&&r.style['border-width']==='0px'&&c.style['border-width']==='0px'){
    equivalent=true;reason='Empty hr paints its identical explicit background; foreground color is unused.';
   }
   differences.push({property,reference:value,candidate:c.style[property],equivalent,reason});
  }
  const pass=differences.every(d=>d.equivalent);if(!pass)typography.allPass=false;
  elements[selector]={status:pass?'PASS':'FAIL',reference:r,candidate:c,differences};
 }
 typography.viewports[vp.name]=elements;
}
await writeJson(path.join(root,'article-typography-contract.json'),typography);
const staticGate={threshold:12,method:'Real viewport tiles stitched at original document offsets; footer cropped from a real bottom viewport.',normalizations:['Comments and comment entry omitted by user instruction; raw reference also retained.','View count snapshot 528; random quote and article server stats frozen.','Same captured gallery image on both sides; native lazy loading completed before capture.','Animation stabilization only for static captures; dynamic audit uses real clocks and no stabilization.'],viewports:{}};
for(const vp of VIEWPORTS)staticGate.viewports[vp.name]=await readJson(path.join(root,'static',vp.name,'gate.json'));
staticGate.allPass=Object.values(staticGate.viewports).every(g=>g.comparison.pixelMatch>=.99);
await writeJson(path.join(root,'static/gate.json'),staticGate);
const home=await readJson(path.join(PROJECT_ROOT,'reports/visual/phase2c/gate.json'));
const summary={typographyPass:typography.allPass,staticPass:staticGate.allPass,homepagePass:home.allPass,viewports:{}};
for(const [vp,g]of Object.entries(staticGate.viewports))summary.viewports[vp]={pixelMatch:g.comparison.pixelMatch,referenceHeight:g.captures.reference.scrollHeight,candidateHeight:g.captures.candidate.scrollHeight,maxGeometryDelta:Math.max(...Object.values(g.geometry).filter(Boolean).flatMap(Object.values).map(Math.abs)),rhythmBlocks:g.rhythm.length,maxRhythmDelta:g.maxRhythmDelta,components:Object.fromEntries(Object.entries(g.comparison.regions).map(([k,v])=>[k,v.pixelMatch])),home:home.viewports[vp].comparison.pixelMatch};
await writeJson(path.join(root,'summary.json'),summary);console.log(JSON.stringify(summary,null,2));

import path from 'node:path';
import sharp from 'sharp';
import { REPORT_ROOT, VIEWPORTS } from './common.mjs';
for (const v of VIEWPORTS) {
  const ref = await sharp(path.join(REPORT_ROOT,'..','..','reference','frozen','home','screenshots',v.name,'full-page-A.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const cand = await sharp(path.join(REPORT_ROOT,'tmp-solid',v.name,'full-page.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const w=Math.max(ref.info.width,cand.info.width),h=Math.max(ref.info.height,cand.info.height); const rows=Array(h).fill(0); const exactRows=Array(h).fill(0);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const ra=(y<ref.info.height&&x<ref.info.width)?(y*ref.info.width+x)*ref.info.channels:-1;const cb=(y<cand.info.height&&x<cand.info.width)?(y*cand.info.width+x)*cand.info.channels:-1;let md=0;for(let c=0;c<4;c++){const a=ra<0?0:ref.data[ra+c];const b=cb<0?0:cand.data[cb+c];md=Math.max(md,Math.abs(a-b));}if(md>0)exactRows[y]++;if(md>12)rows[y]++;}
  const bands=[];let cur=null;const min=Math.max(1,Math.floor(w*.005));for(let y=0;y<h;y++){if(rows[y]<min){if(cur){bands.push(cur);cur=null;}continue;}if(!cur)cur={start:y,end:y,diffPixels:0,peak:0};cur.end=y;cur.diffPixels+=rows[y];cur.peak=Math.max(cur.peak,rows[y]);}if(cur)bands.push(cur);bands.sort((a,b)=>b.diffPixels-a.diffPixels);
  const ranges=[[0,50,'header/nav'],[50,720,'hero/transition'],[720,850,'content-title'],[850,1200,'card-1'],[1200,1550,'card-2'],[1550,1900,'card-3'],[1900,2250,'card-4'],[2250,2600,'card-5'],[2600,2950,'card-6'],[2950,3300,'card-7'],[3300,3650,'card-8'],[3650,4000,'card-9'],[4000,4400,'card-10/pagination'],[4400,h,'exhibition/footer']];
  const region=ranges.map(([s,e,name])=>({name,start:s,end:Math.min(e,h),diffPixels:rows.slice(s,Math.min(e,h)).reduce((a,b)=>a+b,0),exactDiffPixels:exactRows.slice(s,Math.min(e,h)).reduce((a,b)=>a+b,0)})).sort((a,b)=>b.diffPixels-a.diffPixels);
  console.log(v.name, JSON.stringify({bands:bands.slice(0,12),region},null,2));
}

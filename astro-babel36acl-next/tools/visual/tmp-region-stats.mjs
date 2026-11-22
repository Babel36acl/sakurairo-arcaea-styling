import sharp from "sharp";
import path from "node:path";
const root = "C:/Users/A1165/Documents/blog/sakurairo-arcaea-styling/astro-babel36acl-next";
const ref = await sharp(path.join(root, "reference/frozen/home/screenshots/desktop-1272/full-page-A.png")).ensureAlpha().raw().toBuffer({resolveWithObject:true});
const cand = await sharp(path.join(root, "reports/visual/phase2c/desktop-1272/full-page.png")).ensureAlpha().raw().toBuffer({resolveWithObject:true});
for (const [name, y0, y1] of [["nav",0,100],["footer-side",1180,1500],["card2",1450,1650],["card3",1600,1850],["pagination",4090,4250]]) {
  const byX = Array.from({length:ref.info.width},()=>0); const byY=[]; let count=0;
  for(let y=y0;y<Math.min(y1,ref.info.height);y++){let row=0;for(let x=0;x<ref.info.width;x++){const o=(y*ref.info.width+x)*4;const d=Math.max(Math.abs(ref.data[o]-cand.data[o]),Math.abs(ref.data[o+1]-cand.data[o+1]),Math.abs(ref.data[o+2]-cand.data[o+2]),Math.abs(ref.data[o+3]-cand.data[o+3]));if(d>12){count++;row++;byX[x]++;}}byY.push([y,row]);}
  const xBands=[];let cur=null;for(let x=0;x<byX.length;x++){if(byX[x]<2){if(cur){xBands.push(cur);cur=null;}continue;}if(!cur)cur={start:x,end:x,count:0};cur.end=x;cur.count+=byX[x];}if(cur)xBands.push(cur);
  const yBands=[];for(const [y,row] of byY){if(row<2){if(cur){/*noop*/}continue;} yBands.push([y,row]);}
  console.log(name, JSON.stringify({count, xBands:xBands.sort((a,b)=>b.count-a.count).slice(0,15), topRows:byY.sort((a,b)=>b[1]-a[1]).slice(0,12)}));
}

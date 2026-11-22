import sharp from 'sharp';
import path from 'node:path';
import { REPORT_ROOT } from './common.mjs';
const ref=path.join(REPORT_ROOT,'..','..','reference','frozen','home','screenshots','desktop-1272','full-page-A.png');
const cand=path.join(REPORT_ROOT,'tmp-solid','desktop-1272','full-page.png');
await sharp(ref).extract({left:760,top:660,width:460,height:700}).png().toFile(path.join(REPORT_ROOT,'tmp-solid','ref-side-crop.png'));
await sharp(cand).extract({left:760,top:660,width:460,height:700}).png().toFile(path.join(REPORT_ROOT,'tmp-solid','cand-side-crop.png'));

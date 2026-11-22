import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createBrowser, openPreparedPage, closeBrowserResources, VIEWPORTS, REPORT_ROOT } from "./common.mjs";

const sidebarData = JSON.parse(await fs.readFile(path.join(process.cwd(), "tmp", "iro-desktop-1272.json"), "utf8"));
const sidebarHtml = sidebarData.all;
const controlsHtml = `
<div class="theme-controls row-container">
  <ul class="menu-list"><li id="white-bg" title="浅色模式"><i class="fa-regular fa-sun"></i></li><li id="dark-bg" title="深色模式"><i class="fa-regular fa-moon"></i></li></ul>
  <ul class="menu-list" title="切换页面背景图像"><li id="diy1-bg"><i class="fa-regular fa-heart"></i></li><li id="diy2-bg"><i class="fa-regular fa-star"></i></li><li id="diy3-bg"><i class="fa-brands fa-delicious"></i></li><li id="diy4-bg"><i class="fa-regular fa-lemon"></i></li></ul>
  <div class="font-family-controls row-container"><button type="button" class="control-btn-serif selected" title="切换到字体 A" data-name="serif"><i class="fa-solid fa-font fa-lg"></i></button><button type="button" class="control-btn-sans-serif" title="切换到字体 B" data-name="sans-serif"><i class="fa-solid fa-bold fa-lg"></i></button></div>
</div>`;
const css = `
body.legacy-post-list #content-panel { background: rgb(51 51 51) !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
@media (min-width: 1200px) {
  body.legacy-post-list #content-panel > .legacy-visual-skin-menu { display:flex; position:absolute; z-index:99; top:-15px; right:50px; box-sizing:border-box; width:431px; height:85vh; min-height:0; max-height:85%; padding:16px 16px 0; margin:0; flex-direction:column; justify-content:space-between; overflow:auto; color:#ccc; font:300 19.2px/28.8px "Zen Old Mincho",serif; }
  body.legacy-post-list .legacy-visual-skin-menu #iro-widget { display:flex; box-sizing:border-box; width:385px; max-height:700px; padding:5px; margin:5px; flex:0 1 auto; overflow:hidden; background:rgba(26,26,26,.58); border:1px solid rgba(125,125,125,.19); border-radius:10px; box-shadow:rgba(26,26,26,.8) 0 1px 20px 2px; color:#ccc; }
  body.legacy-post-list .legacy-visual-skin-menu .sakura_widget { display:block; box-sizing:border-box; flex:1 1 0%; width:373px; min-height:0; overflow:auto; color:#ccc; }
  body.legacy-post-list .legacy-visual-skin-menu .widget { display:block; box-sizing:border-box; width:373px; padding:0; margin:0; color:#ccc; }
  body.legacy-post-list .legacy-visual-skin-menu h2.wp-block-heading { display:block; box-sizing:border-box; width:373px; margin:23.904px 0; padding:0; color:#ccc; font:700 28.8px/43.2px "Zen Old Mincho",serif; }
  body.legacy-post-list .legacy-visual-skin-menu ul { box-sizing:border-box; width:373px; padding:0; margin:19.2px 0; color:#ccc; font:300 19.2px/28.8px "Zen Old Mincho",serif; }
  body.legacy-post-list .legacy-visual-skin-menu .wp-block-latest-posts,
  body.legacy-post-list .legacy-visual-skin-menu .wp-block-archives,
  body.legacy-post-list .legacy-visual-skin-menu .wp-block-categories { list-style:none; }
  body.legacy-post-list .legacy-visual-skin-menu li { box-sizing:border-box; color:#ccc; font:300 19.2px/28.8px "Zen Old Mincho",serif; }
  body.legacy-post-list .legacy-visual-skin-menu .wp-block-latest-posts li { min-height:28.8px; }
  body.legacy-post-list .legacy-visual-skin-menu a { color:rgb(152 182 255); text-decoration:none; font:300 19.2px/28.8px "Zen Old Mincho",serif; }
  body.legacy-post-list .legacy-visual-skin-menu .theme-controls { display:flex; box-sizing:border-box; width:399px; height:136px; padding:0; margin:0; flex:1 1 auto; color:#ccc; }
  body.legacy-post-list .legacy-visual-skin-menu .theme-controls > .menu-list,
  body.legacy-post-list .legacy-visual-skin-menu .font-family-controls { display:flex; box-sizing:border-box; height:126px; padding:5px; margin:5px; flex:1 1 auto; justify-content:space-between; background:rgba(26,26,26,.58); border:1px solid rgba(125,125,125,.19); border-radius:10px; box-shadow:rgba(26,26,26,.8) 0 1px 20px 2px; list-style:none; }
  body.legacy-post-list .legacy-visual-skin-menu .theme-controls > .menu-list:first-child { width:122px; }
  body.legacy-post-list .legacy-visual-skin-menu .theme-controls > .menu-list:nth-child(2) { width:125px; display:grid; grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr; }
  body.legacy-post-list .legacy-visual-skin-menu .font-family-controls { width:122px; }
  body.legacy-post-list .legacy-visual-skin-menu .theme-controls li,
  body.legacy-post-list .legacy-visual-skin-menu .theme-controls button { box-sizing:border-box; flex:1 1 auto; color:#ccc; background:rgba(26,26,26,.8); border:1px solid rgba(125,125,125,.19); border-radius:10px; }
  body.legacy-post-list .legacy-visual-skin-menu .theme-controls li { min-width:50px; height:109px; padding:0; margin:2.5px; line-height:50px; text-align:center; }
  body.legacy-post-list .legacy-visual-skin-menu .theme-controls .menu-list:nth-child(2) li { height:52px; }
  body.legacy-post-list .legacy-visual-skin-menu .theme-controls button { width:50px; height:109px; padding:5px; margin:2.5px; font:12px/12px "Noto Serif SC",serif; }
  body.legacy-post-list .legacy-visual-skin-menu .theme-controls button.selected { border:3px solid rgb(15 17 23); }
  body.legacy-post-list .legacy-visual-skin-menu .theme-controls button.control-btn-sans-serif { font-family:"Noto Sans SC",sans-serif; }
}
@media (max-width:1199px) { body.legacy-post-list #content-panel > .legacy-visual-skin-menu { display:none !important; } }
`;

const referenceRoot = path.join(REPORT_ROOT, "..", "..", "reference", "frozen", "home", "screenshots");
const outputRoot = path.join(REPORT_ROOT, "tmp-inject-sidebars");
await fs.mkdir(outputRoot, { recursive: true });
const browser = await createBrowser();
const result = {};
try {
  for (const viewport of VIEWPORTS) {
    const resources = await openPreparedPage(browser, "http://127.0.0.1:4323/", viewport, { route: "/", static: true, waitMs:700, waitForImages:true, waitForBackgroundImages:true });
    const candidatePath = path.join(outputRoot, viewport.name + ".png");
    const referencePath = path.join(referenceRoot, viewport.name, "full-page-A.png");
    try {
      await resources.page.addStyleTag({ content: css });
      await resources.page.evaluate(({ sidebarHtml, controlsHtml }) => {
        if (window.innerWidth < 1200) return;
        const panel = document.querySelector("#content-panel");
        if (!panel) return;
        const wrapper = document.createElement("div");
        wrapper.className = "legacy-visual-skin-menu no-select";
        wrapper.innerHTML = sidebarHtml;
        const controls = document.createElement("div");
        controls.innerHTML = controlsHtml;
        wrapper.append(controls.firstElementChild);
        panel.append(wrapper);
      }, { sidebarHtml, controlsHtml });
      await resources.page.screenshot({ path:candidatePath, fullPage:true, animations:"disabled", scale:"css" });
      result[viewport.name] = await compare(referencePath, candidatePath, path.join(outputRoot, viewport.name+"-diff.png"));
    } finally { await closeBrowserResources(resources); }
  }
} finally { await browser.close(); }
console.log(JSON.stringify(result,null,2));

async function compare(referencePath, candidatePath, diffPath) {
  const reference = await read(referencePath), candidate = await read(candidatePath);
  const width = Math.max(reference.info.width, candidate.info.width), height = Math.max(reference.info.height, candidate.info.height);
  const output = Buffer.alloc(width*height*4); let diffPixels=0;
  for(let y=0;y<height;y++) for(let x=0;x<width;x++){const offset=(y*width+x)*4,a=pixel(reference,x,y),b=pixel(candidate,x,y),delta=Math.max(...a.map((v,i)=>Math.abs(v-b[i])));if(delta>12){diffPixels++;output[offset]=255;output[offset+3]=255;}}
  await sharp(output,{raw:{width,height,channels:4}}).png().toFile(diffPath);
  return { width,height,diffPixels,pixelMatch:1-diffPixels/(width*height),diffPath };
}
async function read(file){return sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});}
function pixel(image,x,y){if(x>=image.info.width||y>=image.info.height)return[0,0,0,0];const o=(y*image.info.width+x)*image.info.channels;return [image.data[o]||0,image.data[o+1]||0,image.data[o+2]||0,image.data[o+3]||0];}

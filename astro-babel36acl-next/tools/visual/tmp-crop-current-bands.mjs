import sharp from "sharp";
import path from "node:path";
const root = "C:/Users/A1165/Documents/blog/sakurairo-arcaea-styling/astro-babel36acl-next";
const base = path.join(root, "reports/visual/phase2c/desktop-1272");
const ref = path.join(root, "reference/frozen/home/screenshots/desktop-1272/full-page-A.png");
const cand = path.join(base, "full-page.png");
for (const [name, top, height] of [["nav", 0, 100], ["sidebar", 1180, 300], ["card", 1400, 150], ["sidebar2", 1600, 220], ["pagination", 4090, 150]]) {
  for (const [label, file] of [["ref", ref], ["cand", cand]]) {
    await sharp(file).extract({ left: 0, top, width: 1272, height }).png().toFile(path.join(base, `${name}-${label}.png`));
  }
}

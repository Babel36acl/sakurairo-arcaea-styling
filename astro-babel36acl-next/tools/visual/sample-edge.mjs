import path from "node:path";
import sharp from "sharp";
const base = path.join(process.cwd(), "reports", "visual", "paint", "crop-test", process.argv[2] || "mobile-390");
const [a, b] = await Promise.all([raw(path.join(base, "reference-element.png")), raw(path.join(base, "candidate-element.png"))]);
for (const y of [0, 10, 50, 100, 150, 200, 218, 219, 220, 240, 260, 280, 300]) {
  const vals=[];
  for (const x of [345,346,347,348,349,350,351,352,353,354,355,356,357,358,359]) {
    const o=(y*a.info.width+x)*3, p=(y*b.info.width+x)*3;
    vals.push(`${x}:${a.data[o]},${a.data[o+1]},${a.data[o+2]}|${b.data[p]},${b.data[p+1]},${b.data[p+2]}`);
  }
  console.log(y, vals.join(" "));
}
async function raw(file){return sharp(file).removeAlpha().raw().toBuffer({resolveWithObject:true});}

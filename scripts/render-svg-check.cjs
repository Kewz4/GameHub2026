// Dev helper: render an SVG (or a chunk of SVG markup) to PNG for visual
// verification of the reactive controller diagrams. Not shipped/used at runtime.
//   node scripts/render-svg-check.cjs <input.svg> <output.png>
const sharp = require("sharp");
const fs = require("node:fs");

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error("usage: node scripts/render-svg-check.cjs <in.svg> <out.png>");
  process.exit(1);
}
sharp(fs.readFileSync(input), { density: 200 })
  .resize(1000, null, { fit: "inside" })
  .flatten({ background: "#2a2a2a" })
  .png()
  .toFile(output)
  .then(() => console.log("rendered", output));

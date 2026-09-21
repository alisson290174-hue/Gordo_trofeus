// Regenerates the app icon (Windows .ico, the Linux icon set, and the flat PNGs used at
// runtime) from the single vector source at src/renderer/src/assets/icons/app-icon-refresh.svg.
// Run with: node scripts/generate-app-icon.cjs
const sharp = require("sharp");
const pngToIco = require("png-to-ico").default;
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SVG_PATH = path.join(
  ROOT,
  "src/renderer/src/assets/icons/app-icon-refresh.svg"
);

const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  const svgBuffer = fs.readFileSync(SVG_PATH);
  const buffers = {};

  for (const size of LINUX_SIZES) {
    const buf = await sharp(svgBuffer, { density: 384 })
      .resize(size, size)
      .png()
      .toBuffer();
    buffers[size] = buf;
    fs.writeFileSync(path.join(ROOT, "build/icons", `${size}x${size}.png`), buf);
  }

  fs.writeFileSync(path.join(ROOT, "build/icon.png"), buffers[512]);
  fs.writeFileSync(path.join(ROOT, "resources/icon.png"), buffers[512]);

  const icoBuf = await pngToIco(ICO_SIZES.map((s) => buffers[s]));
  fs.writeFileSync(path.join(ROOT, "build/icon.ico"), icoBuf);

  console.log("Regenerated build/icon.ico, build/icon.png, build/icons/*, resources/icon.png");
  console.log(
    "build/icon.icns was NOT regenerated (no macOS icon tooling available here) — still the old icon."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

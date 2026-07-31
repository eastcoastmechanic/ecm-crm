import sharp from "sharp";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const logo = path.join(root, "public", "logo.png");
const iconsDir = path.join(root, "public", "icons");

mkdirSync(iconsDir, { recursive: true });

const NAVY = { r: 10, g: 22, b: 40, alpha: 1 };

async function padToSquare(size, outPath) {
  const inner = Math.round(size * 0.82);
  const resizedLogo = await sharp(logo)
    .resize(inner, inner, { fit: "contain", background: NAVY })
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: NAVY,
    },
  })
    .composite([{ input: resizedLogo, gravity: "center" }])
    .png()
    .toFile(outPath);

  console.log(`wrote ${outPath}`);
}

await padToSquare(192, path.join(iconsDir, "icon-192.png"));
await padToSquare(512, path.join(iconsDir, "icon-512.png"));
await padToSquare(180, path.join(root, "public", "icons", "apple-touch-icon.png"));

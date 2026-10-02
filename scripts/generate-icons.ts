// Generates PWA icons from an SVG (run: npm run icons). Output is committed so builds don't depend on sharp.
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const mark = (pad: number, bg: boolean) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f172a"/><stop offset="1" stop-color="#1e293b"/></linearGradient>
    <linearGradient id="a" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#60a5fa"/></linearGradient>
  </defs>
  ${bg ? `<rect width="512" height="512" rx="${pad ? 0 : 112}" fill="url(#g)"/>` : ""}
  <g transform="translate(256 262) scale(${1 - pad / 256})">
    <path d="M-150 90 A170 170 0 1 1 150 90" fill="none" stroke="url(#a)" stroke-width="38" stroke-linecap="round"/>
    <path d="M0 10 L98 -78" stroke="#fff" stroke-width="22" stroke-linecap="round"/>
    <circle cx="0" cy="12" r="26" fill="#fff"/>
    <rect x="-96" y="118" width="192" height="26" rx="13" fill="#fff" opacity=".9"/>
  </g>
</svg>`;

async function out(name: string, size: number, pad: number, bg = true) {
  const buf = await sharp(Buffer.from(mark(pad, bg))).resize(size, size).png().toBuffer();
  writeFileSync(`public/icons/${name}`, buf);
}
(async () => {
  await out("icon-192.png", 192, 0);
  await out("icon-512.png", 512, 0);
  await out("maskable-512.png", 512, 60); // extra safe-zone padding for maskable icons
  await out("apple-touch-icon.png", 180, 0);
  await out("favicon-32.png", 32, 0);
  writeFileSync("public/icons/icon.svg", mark(0, true));
  console.log("icons written");
})();

/* Generate PWA icons for HSE Tracker (site gradient #0ea5e9 → #10b981).
   Outputs into the repo root: icon-192/512, maskable-512, apple-touch-180, favicon-32. */
const { createCanvas } = require(process.env.TEMP + '\\hse-xlsx\\node_modules\\@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2];
const C1 = '#0ea5e9', C2 = '#10b981';

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function draw(size, maskable) {
  const cv = createCanvas(size, size);
  const ctx = cv.getContext('2d');
  // brand gradient background
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, C1); g.addColorStop(1, C2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // "any" icons: rounded square (iOS style). maskable: full-bleed, Android applies its own mask.
  if (!maskable) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = '#000';
    roundRectPath(ctx, 0, 0, size, size, size * 0.22);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // content stays inside the maskable safe zone (central ~62%)
  const k = maskable ? 0.62 : 1;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,.18)';
  ctx.shadowBlur = size * 0.02;
  ctx.shadowOffsetY = size * 0.008;
  ctx.font = `bold ${Math.round(size * 0.27 * k)}px Arial`;
  ctx.fillText('HSE', size / 2, size * (maskable ? 0.44 : 0.42));
  ctx.font = `bold ${Math.round(size * 0.1 * k)}px Arial`;
  ctx.fillText('T R A C K E R', size / 2, size * (maskable ? 0.62 : 0.63));
  return cv;
}

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
  ['favicon-32.png', 32, false],
];
for (const [name, size, maskable] of targets) {
  const buf = draw(size, maskable).toBuffer('image/png');
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(name, size + 'px', buf.length + ' bytes');
}

// SVG favicon (modern browsers)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${C1}"/><stop offset="1" stop-color="${C2}"/></linearGradient></defs>
<rect width="512" height="512" rx="113" fill="url(#g)"/>
<text x="256" y="245" font-family="Arial,Helvetica,sans-serif" font-size="148" font-weight="bold" fill="#fff" text-anchor="middle">HSE</text>
<text x="256" y="345" font-family="Arial,Helvetica,sans-serif" font-size="54" font-weight="bold" fill="#fff" text-anchor="middle" letter-spacing="6">TRACKER</text>
</svg>`;
fs.writeFileSync(path.join(OUT, 'favicon.svg'), svg);
console.log('favicon.svg', Buffer.byteLength(svg) + ' bytes');

/* Generate Android launcher + splash assets from the brand identity.
   Outputs into <repo>/assets/ for @capacitor/assets:
     icon.png            512  – legacy launcher (full composed)
     icon-foreground.png 1024 – adaptive foreground (text, transparent bg)
     icon-background.png 1024 – adaptive background (gradient)
     splash.png          2732 – splash (gradient + logo)
*/
const { createCanvas } = require(process.env.TEMP + '\\hse-xlsx\\node_modules\\@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

const REPO = process.argv[2];
const OUT = path.join(REPO, 'assets');
fs.mkdirSync(OUT, { recursive: true });
const C1 = '#0ea5e9', C2 = '#10b981';

function grad(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, C1); g.addColorStop(1, C2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
function label(ctx, w, h, scale) {
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,.18)';
  ctx.shadowBlur = w * 0.012 * scale;
  ctx.font = `bold ${Math.round(w * 0.30 * scale)}px Arial`;
  ctx.fillText('HSE', w / 2, h * 0.44);
  ctx.font = `bold ${Math.round(w * 0.105 * scale)}px Arial`;
  ctx.fillText('T R A C K E R', w / 2, h * 0.60);
}

// legacy icon (512, full compose)
{
  const cv = createCanvas(512, 512), ctx = cv.getContext('2d');
  grad(ctx, 512, 512); label(ctx, 512, 512, 1);
  fs.writeFileSync(path.join(OUT, 'icon.png'), cv.toBuffer('image/png'));
}
// adaptive background: pure gradient (1024)
{
  const cv = createCanvas(1024, 1024), ctx = cv.getContext('2d');
  grad(ctx, 1024, 1024);
  fs.writeFileSync(path.join(OUT, 'icon-background.png'), cv.toBuffer('image/png'));
}
// adaptive foreground: transparent + content inside the safe zone (1024)
{
  const cv = createCanvas(1024, 1024), ctx = cv.getContext('2d');
  ctx.shadowColor = 'rgba(0,0,0,.22)'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 8;
  label(ctx, 1024, 1024, 0.72);
  fs.writeFileSync(path.join(OUT, 'icon-foreground.png'), cv.toBuffer('image/png'));
}
// splash: gradient with centred logo (portrait 2732)
{
  const cv = createCanvas(2732, 2732), ctx = cv.getContext('2d');
  grad(ctx, 2732, 2732);
  ctx.save();
  ctx.translate((2732 - 1400) / 2, (2732 - 1400) / 2);
  label(ctx, 1400, 1400, 1);
  ctx.restore();
  fs.writeFileSync(path.join(OUT, 'splash.png'), cv.toBuffer('image/png'));
}

for (const f of fs.readdirSync(OUT)) {
  const b = fs.readFileSync(path.join(OUT, f));
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  console.log(f, w + 'x' + h, b.length + ' bytes');
}

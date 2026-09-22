/* PWA verifier: manifest + icons + service-wiring must all line up. */
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2];
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let pass = 0; const fail = [];
const t = (n, c, extra) => { c ? pass++ : fail.push(n + (extra ? ' — ' + extra : '')); };

// --- manifest ---
const mfPath = path.join(ROOT, 'manifest.webmanifest');
t('manifest exists', fs.existsSync(mfPath));
let mf = null;
try { mf = JSON.parse(fs.readFileSync(mfPath, 'utf8')); } catch (e) { fail.push('manifest parses — ' + e.message); }
if (mf) {
  t('manifest has name + short_name', !!mf.name && !!mf.short_name);
  t('manifest lang/dir are Arabic RTL', mf.lang === 'ar' && mf.dir === 'rtl', mf.lang + '/' + mf.dir);
  t('manifest display standalone', mf.display === 'standalone', mf.display);
  t('manifest scope/start_url present', !!mf.scope && !!mf.start_url);
  t('manifest theme/background colors', /^#[0-9a-f]{6}$/i.test(mf.theme_color) && /^#[0-9a-f]{6}$/i.test(mf.background_color));
  t('manifest declares >= 4 icons', (mf.icons || []).length >= 4, String((mf.icons || []).length));

  // --- icons: exist, real PNG, correct dimensions ---
  const pngSize = f => {
    const b = fs.readFileSync(f);
    if (b.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  };
  let has192 = false, has512 = false, hasMaskable = false;
  for (const ic of mf.icons || []) {
    const f = path.join(ROOT, ic.src);
    t('icon file exists: ' + ic.src, fs.existsSync(f));
    if (!fs.existsSync(f) || !ic.sizes || ic.sizes === 'any') continue;
    if (!/\.png$/i.test(ic.src)) continue;
    const dim = pngSize(f);
    const [w, h] = ic.sizes.split('x').map(Number);
    t('icon ' + ic.src + ' is ' + ic.sizes, !!dim && dim.w === w && dim.h === h,
      dim ? dim.w + 'x' + dim.h : 'not a png');
    if (ic.sizes === '192x192' && dim) has192 = true;
    if (ic.sizes === '512x512' && dim && ic.purpose !== 'maskable') has512 = true;
    if (ic.sizes === '512x512' && dim && ic.purpose === 'maskable') hasMaskable = true;
  }
  t('installability: 192px icon', has192);
  t('installability: 512px icon', has512);
  t('installability: maskable 512px icon', hasMaskable);
}

// --- service worker ---
const swPath = path.join(ROOT, 'sw.js');
t('sw.js exists', fs.existsSync(swPath));
if (fs.existsSync(swPath)) {
  const sw = fs.readFileSync(swPath, 'utf8');
  t('sw registers install/activate/fetch', /addEventListener\('install'/.test(sw) && /addEventListener\('activate'/.test(sw) && /addEventListener\('fetch'/.test(sw));
  t('sw never caches Supabase', sw.includes('.supabase.co'));
  t('sw has offline navigation fallback', sw.includes("caches.match('index.html')"));
  // every precached URL must actually exist in the repo
  const pre = (sw.match(/\[[\s\S]*?\]/) || [''])[0].match(/'([^']+)'/g) || [];
  for (const raw of pre) {
    const u = raw.slice(1, -1);
    if (u === './' || u === 'index.html') continue;
    t('precache exists in repo: ' + u, fs.existsSync(path.join(ROOT, u)));
  }
}

// --- index.html wiring ---
t('index links manifest', /rel="manifest"\s+href="manifest\.webmanifest"/.test(html));
t('index has theme-color meta', /name="theme-color"/.test(html));
t('index has favicon link', /rel="icon"/.test(html));
t('index registers service worker', /serviceWorker\.register\('sw\.js'\)/.test(html));
t('SW registration is guarded', /'serviceWorker' in navigator/.test(html));
t('apple-touch-icon linked', /rel="apple-touch-icon"/.test(html));

console.log('PWA CHECK — passed: ' + pass + (fail.length ? ' | FAILED ' + fail.length : ' | ALL GREEN'));
fail.forEach(f => console.log('  ✘ ' + f));
process.exit(fail.length ? 1 : 0);

const fs = require('fs');
const h = fs.readFileSync(process.argv[2], 'utf8');

// --- 1) ID check: every getElementById('x') must exist in HTML or be created dynamically in JS
const scripts = [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const js = scripts.reduce((a, b) => a.length > b.length ? a : b, ''); // أكبر سكربت (الرئيسي)
const refs = new Set([...js.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)].map(m => m[1]));
const dyn = new Set([...js.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map(m => m[1]));
const htmlOnly = h.replace(/<script>[\s\S]*?<\/script>/g, '');
const htmlIds = new Set([...htmlOnly.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map(m => m[1]));
const missingIds = [...refs].filter(id => !htmlIds.has(id) && !dyn.has(id));
console.log('1) getElementById targets:', refs.size, '| MISSING IDS:', missingIds.length ? missingIds.join(', ') : '(none)');

// --- 2) i18n key check
const i = h.indexOf('const I18N=');
const j = h.indexOf('const T=()');
const I18N = eval('(' + h.slice(i, j).replace('const I18N=', '').replace(/;\s*$/, '') + ')');
const used = new Set([...js.matchAll(/T\(\)\.([A-Za-z0-9_]+)/g)].map(m => m[1]));
const usedDI = new Set([...js.matchAll(/data-i="([A-Za-z0-9_]+)"/g)].map(m => m[1]));
const all = new Set([...used, ...usedDI]);
console.log('2) MISSING IN AR:', [...all].filter(k => !(k in I18N.ar)).join(', ') || '(none)');
console.log('   MISSING IN EN:', [...all].filter(k => !(k in I18N.en)).join(', ') || '(none)');

// --- 3) duplicate ids in HTML
const counts = {};
[...htmlOnly.matchAll(/id="([A-Za-z0-9_-]+)"/g)].forEach(m => { counts[m[1]] = (counts[m[1]] || 0) + 1; });
const dups = Object.keys(counts).filter(k => counts[k] > 1);
console.log('3) DUPLICATE HTML IDS:', dups.length ? dups.join(', ') : '(none)');

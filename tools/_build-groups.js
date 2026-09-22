// Build groups-data.js (A / B / Daily lists) from the parsed portal exports
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const out = {};
for (const [g, rows] of Object.entries(raw)) {
  out[g] = rows.map(r => [clean(r.id), clean(r.name)]);
}
const total = Object.values(out).reduce((a, b) => a + b.length, 0);
const header =
  '/* ============================================================\n' +
  ' * قروبات الدوام — Duty groups (A / B / Daily)\n' +
  ' * المصدر: Hyundai HSE Portal — Scorecard (تصدير ' + new Date().toISOString().slice(0, 10) + ')\n' +
  ' * A: ' + out.A.length + ' | B: ' + out.B.length + ' | Daily: ' + out.D.length + ' | المجموع: ' + total + '\n' +
  ' * التنسيق: [الرقم الوظيفي, الاسم بالإنجليزي]\n' +
  ' * لا تُعدّل يدوياً — يُولَّد من ملفات المصدر.\n' +
  ' * ============================================================ */\n' +
  'window.GRP_DATA = ' + JSON.stringify(out) + ';\n';
fs.writeFileSync(process.argv[3], header, 'utf8');
console.log('A:', out.A.length, '| B:', out.B.length, '| Daily:', out.D.length, '| total:', total);
console.log('bytes:', Buffer.byteLength(header));
console.log('sample A[0]:', JSON.stringify(out.A[0]), '| D[0]:', JSON.stringify(out.D[0]));

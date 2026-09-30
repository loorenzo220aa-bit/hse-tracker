/* leave-import.js — استيراد ملف إجازات HR-F-5 إلى leave-data.js (seed للتطبيق)
 * المصدر: ورقتان — Sheet1 (سجل الإجازات الفعلي) و ML (مخطط الإجازات القادمة)
 * يُخرج: leave-data.js يحوي window.LVSEED = {gen, defEnt, roster, leaves}
 * خصوصية: لا أرقام وطنية، لا هويات، لا أرقام هواتف — أسماء وأرقام وظيفية فقط.
 * الاستخدام: node tools/leave-import.js "C:\...\HR-F-5 Vacation Form HSE.xlsx"
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require(path.join(process.env.TEMP, 'hse-xlsx', 'node_modules', 'exceljs'));

const F = process.argv[2];
if (!F) { console.error('usage: node tools/leave-import.js <xlsx>'); process.exit(1); }
const OUT = path.join(__dirname, '..', 'leave-data.js');
const DEF_ENT = 21;               // منصوب قانوني: أقل من 5 سنوات خدمة (كل التواريخ 2024+)
const ID_RE = /^(SASL|HECL)-\d{3,}$/i;

const txt = v => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('');
    if (v.result !== undefined) return v.result;
    if (v.text) return v.text;
  }
  return v;
};
const ds = v => {
  const s = txt(v);
  if (s instanceof Date) return s.toISOString().slice(0, 10);
  const str = String(s == null ? '' : s).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  /* نصوص منسوخة من Excel: "Sun Jun 29 2025 03:00:00 GMT+0300 (Arabian Standard Time)" */
  const p = Date.parse(str);
  if (str && !isNaN(p)) return new Date(p).toISOString().slice(0, 10);
  return str.slice(0, 10);
};
const isD = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
const addDays = (s, n) => new Date(new Date(s + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);
const normId = s => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
const typeCode = t => {
  t = String(t || '').toLowerCase();
  if (/emerg/.test(t)) return 'emg';
  if (/death|bereave/.test(t)) return 'dth';
  if (/marriage|wedding/.test(t)) return 'mrg';
  return 'reg';
};
const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(F);
  const today = new Date().toISOString().slice(0, 10);
  const stat = { swapped: 0, durMismatch: 0, jUnparsed: [], staleWin: 0, dupML: 0, junk: [], winDefaultDur: 0 };
  const roster = new Map();   // id -> {i,n,t,e}
  const leaves = [];          // {i,s,d,y,w?}

  /* ---------- Sheet1: سجل الإجازات ---------- */
  const sh = wb.getWorksheet('Sheet1');
  let cur = null;
  sh.eachRow({ includeEmpty: false }, (row, r) => {
    if (r === 1) return;
    const g = c => txt(row.getCell(c).value);
    const idc = normId(g(1) || g(2));
    /* المعرّف القديم يبقى سارياً: صفوف القمامة (مثل ".") لا تقطع كتلة الموظف */
    if (idc && ID_RE.test(idc)) cur = idc;
    else if (idc) stat.junk.push('Sheet1 R' + r + ':' + idc);
    const name = String(g(3) || '').trim();
    if (!cur || !ID_RE.test(cur)) return;
    if (name && !roster.has(cur)) roster.set(cur, { i: cur, n: name, t: String(g(6) || '').trim(), e: DEF_ENT });
    const dep = ds(g(11)), arr = ds(g(12));
    if (!isD(dep) || !isD(arr) || !roster.has(cur)) return;
    let a = dep, b = arr;
    if (b < a) { const t = a; a = b; b = t; stat.swapped++; }
    const d = dayDiff(a, b) + 1;
    const tot = Number(txt(g(14)));
    if (Number.isFinite(tot) && tot && tot !== d) stat.durMismatch++;
    leaves.push({ i: cur, s: a, d, y: typeCode(g(13)) });
  });

  /* ---------- ML: مخطط الإجازات القادمة ----------
   * تخطيطان مدعومان (كشف تلقائي من أول صف بيانات):
   *   قديم (2025): col1=?, id=2, name=3, natid=4, part=5, trade=6, TO(نهاية)=7, should(بداية)=8, days=9, range=10
   *   جديد (2026.09.29): id=1, name=2, natid=3, part=4, trade=5, TO(نهاية)=6, should(بداية)=7, days=8, range=9, STATUS=10
   * natid (رقم وطني) لا يُقرأ نهائياً — خصوصية. */
  const ml = wb.getWorksheet('ML ');
  const newLayout = ID_RE.test(normId(txt(ml.getRow(5).getCell(1).value)));
  const COL = newLayout
    ? { id: 1, name: 2, trade: 5, end: 6, start: 7, days: 8, rng: 9 }
    : { id: 2, name: 3, trade: 6, end: 7, start: 8, days: 9, rng: 10 };
  const seenML = new Set();
  ml.eachRow({ includeEmpty: false }, (row, r) => {
    if (r < 5) return;
    const g = c => txt(row.getCell(c).value);
    const id = normId(g(COL.id));
    if (!id) return;
    if (!ID_RE.test(id)) { stat.junk.push('ML R' + r + ':' + id); return; }
    if (seenML.has(id)) stat.dupML++;
    seenML.add(id);
    const name = String(g(COL.name) || '').trim();
    const trade = String(g(COL.trade) || '').trim();
    let winStart = ds(g(COL.start)), winEnd = ds(g(COL.end));
    if (!roster.has(id)) roster.set(id, { i: id, n: name, t: trade, e: DEF_ENT });
    else if (trade && !roster.get(id).t) roster.get(id).t = trade;
    const daysTxt = String(g(COL.days) || '');
    const daysNum = parseInt(daysTxt, 10);
    const rng = String(g(COL.rng) || '').trim();
    if (!isD(winStart) || !isD(winEnd)) return;
    if (winEnd < winStart) { const t2 = winStart; winStart = winEnd; winEnd = t2; stat.invWin = (stat.invWin || 0) + 1; }   /* نافذة معكوسة ← تبديل */

    if (rng) {
      // نطاق فعلي: "21 NOV - 11 DEC" بدون سنة — نستنتج أقرب سنة لبداية النافذة
      // نطبّع الفواصل الشاذة أولاً: "14 NOV 2 DEC" و"20 SEP - 8 -OCT"
      const clean = rng.replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim();
      const m = clean.match(/(\d{1,2})\s*([A-Za-z]{3,})\s+(\d{1,2})\s+([A-Za-z]{3,})/);
      if (!m) { stat.jUnparsed.push(id + ':' + rng); return; }
      const mo1 = MON[m[2].slice(0, 3).toUpperCase()];
      const mo2 = MON[m[4].slice(0, 3).toUpperCase()];
      if (mo1 === undefined || mo2 === undefined) { stat.jUnparsed.push(id + ':' + rng); return; }
      const wy = +winStart.slice(0, 4);
      let best = null, bestDist = Infinity;
      for (let y = wy - 1; y <= wy + 2; y++) {
        const s = `${y}-${String(mo1 + 1).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
        const dist = Math.abs(dayDiff(winStart, s));
        if (dist < bestDist) { bestDist = dist; best = s; }
      }
      let e = `${best.slice(0, 4)}-${String(mo2 + 1).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`;
      if (e < best) e = `${+best.slice(0, 4) + 1}-${e.slice(5)}`;
      const d = dayDiff(best, e) + 1;
      leaves.push({ i: id, s: best, d, y: 'reg' });
      return;
    }
    // لا نطاق بعد: نافذة مستقبلية فقط (تُعرض كـ «مجدولة ضمن نافذة»)
    if (winEnd < today) { stat.staleWin++; return; }
    const d = Number.isFinite(daysNum) ? daysNum : DEF_ENT;
    if (!Number.isFinite(daysNum)) stat.winDefaultDur++;
    leaves.push({ i: id, s: winStart, d, y: 'reg', w: winEnd });
  });

  /* ---------- إخراج ---------- */
  const rosterArr = [...roster.values()].sort((a, b) => a.i.localeCompare(b.i))
    .map(r => ({ ...r, t: r.t || '—' }));
  const leavesOut = leaves.slice().sort((a, b) => a.s.localeCompare(b.s) || a.i.localeCompare(b.i));

  const gen = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const body =
    '/* leave-data.js — بيانات الإجازات السنوية (تُولّد عبر tools/leave-import.js من ملف ' + path.basename(F) + ')\n' +
    ' * الحقول: roster[] = {i: رقم وظيفي, n: اسم, t: التخصص (القسم), e: الاستحقاق السنوي بالأيام}\n' +
    ' *         leaves[] = {i, s: تاريخ البداية, d: المدة بالأيام, y: نوع (reg/emg/dth/mrg), w: نهاية النافذة (اختياري)}\n' +
    ' * لا يحتوي أرقاماً وطنية أو هويات أو هواتف. التعديل يُعاد توليد الأداة — التغييرات اليدوية تُحفظ في المتصفح.\n' +
    ' */\n' +
    'window.LVSEED = ' + JSON.stringify({ gen, defEnt: DEF_ENT, roster: rosterArr, leaves: leavesOut }, null, 0) + ';\n';
  fs.writeFileSync(OUT, body, 'utf8');

  /* ---------- فحص خصوصية على الخرج الفعلي ---------- */
  const leaks = (body.match(/\b\d{10}\b/g) || []).concat(body.match(/\b05\d{8}\b/g) || []);
  if (leaks.length) { console.error('PRIVACY FAIL — رقم وطني/هاتف في الخرج:', leaks.slice(0, 5)); process.exit(2); }

  /* ---------- إحصاءات للتحقق ---------- */
  const byYear = {}, byType = {}, future = [], onNow = [];
  const empLeaves = new Map();
  leavesOut.forEach(l => {
    byYear[l.s.slice(0, 4)] = (byYear[l.s.slice(0, 4)] || 0) + 1;
    byType[l.y] = (byType[l.y] || 0) + 1;
    (empLeaves.get(l.i) || empLeaves.set(l.i, []).get(l.i)).push(l);
    if (l.s > today) future.push(l);
    if (!l.w && l.s <= today && today <= addDays(l.s, l.d - 1)) onNow.push(l.i);
  });
  let consumed2026 = 0, planned2026 = 0;
  leavesOut.forEach(l => {
    const isWindow = !!l.w;
    if (!isWindow && l.s <= today && l.s.slice(0, 4) === today.slice(0, 4)) consumed2026 += l.d;
    if (isWindow || l.s > today) if (l.s.slice(0, 4) === today.slice(0, 4)) planned2026 += l.d;
  });
  // معاينة التعارضات المستقبلية داخل التخصص نفسه
  const conflicts = [];
  const byTrade = new Map();
  rosterArr.forEach(r => byTrade.set(r.i, r.t));
  const fut = leavesOut.filter(l => addDays(l.s, l.d - 1) >= today);
  for (let a = 0; a < fut.length; a++) for (let b = a + 1; b < fut.length; b++) {
    const A = fut[a], B = fut[b];
    if (A.i === B.i) continue;
    if (byTrade.get(A.i) !== byTrade.get(B.i)) continue;
    const ae = addDays(A.s, A.d - 1), be = A.w || ae, Bw = B.w || addDays(B.s, B.d - 1);
    if (A.s <= (B.w || addDays(B.s, B.d - 1)) && B.s <= be) conflicts.push(`${byTrade.get(A.i)}: ${A.i}[${A.s}..${be}] × ${B.i}[${B.s}..${Bw}]`);
  }
  const trades = [...new Set(rosterArr.map(r => r.t))].sort();
  console.log('=== leave-import: OK ===');
  console.log('roster:', rosterArr.length, ' leaves:', leavesOut.length, '(file:', leaves.length, ')');
  console.log('trades (قسم):', trades.join(' | '));
  console.log('leaves by start-year:', JSON.stringify(byYear), ' by type:', JSON.stringify(byType));
  console.log('future leaves (start>today):', future.length, ' windows:', leavesOut.filter(l => l.w).length);
  console.log('ON LEAVE TODAY:', onNow.length, onNow.join(','));
  console.log('consumed 2026:', consumed2026, 'days | planned/remaining 2026:', planned2026, ' | Σentitlement:', rosterArr.length * DEF_ENT);
  console.log('future conflicts (same trade):', conflicts.length);
  conflicts.slice(0, 8).forEach(c => console.log('   ', c));
  console.log('fixes:', JSON.stringify(stat));
  console.log('written:', OUT, Math.round(fs.statSync(OUT).size / 1024) + 'KB');
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });

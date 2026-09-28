/* ============================================================
   استيراد ملف موافقات أرامكو (Excel) إلى جدول Supabase `approvals`
   ------------------------------------------------------------
   الاستخدام:
     node tools/appr-import.js "C:/Users/USER/Desktop/Book2.xlsx"           ← تجربة (طباعة الخطة فقط)
     node tools/appr-import.js "C:/Users/USER/Desktop/Book2.xlsx" --apply   ← تنفيذ الكتابة
   القواعد:
     • لا يُحذف أي صف موجود — الصفوف غير المشمولة بالملف تبقى كما هي
     • الاسم المطابق لموظف مسجل: يحدّث حقل approval (+ aramco_id/phone إن كانت فارغة)
     • غير المطابق: صف جديد بمفتاح اصطناعي HYU-xxxxx والاسم داخل JSON
     • التصنيف الأربعة يُشتق من أعمدة الملف بترتيب أولوية: الفشل ← الترانزميتال
       المعلّق ← القبول النهائي ← فترة التجربة 90/180 ← اجتاز بلا معاملة ← قيد التقييم
   ============================================================ */
const path = require('path');
const ExcelJS = require(path.join(process.env.TEMP, 'hse-xlsx', 'node_modules', 'exceljs'));

const SB_URL = 'https://xdmngrosmblrqoirjaai.supabase.co';
const SB_KEY = 'sb_publishable_0yFEikxwbqcW0zaKK27E0w_pHP_InLj';
const HDR = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const REST = SB_URL + '/rest/v1/';

const normName = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const pad = n => String(n).padStart(2, '0');

function dstr(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.getUTCFullYear() + '-' + pad(v.getUTCMonth() + 1) + '-' + pad(v.getUTCDate());
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/([A-Za-z]{3})\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/); // 'Tue Oct 14 2025 …'
  if (m) { const d = new Date(m[3] + ' ' + m[2] + ' ' + m[4]); if (!isNaN(d)) return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  const t = Date.parse(s);
  if (!isNaN(t)) { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  return '';
}
function cv(cell) {
  const v = cell.value;
  if (v && typeof v === 'object' && v.richText) return v.richText.map(t => t.text).join('');
  if (v && typeof v === 'object' && v.result !== undefined) return v.result;
  if (v && typeof v === 'object' && v.text !== undefined) return v.text;
  if (v && typeof v === 'object' && v.hyperlink) return v.text || v.hyperlink;
  return v;
}
const normHdr = v => String(v == null ? '' : v).toUpperCase().replace(/\s+/g, ' ').trim();

/* رؤوس الأعمدة ← مفاتيح (يتحمل تغيّر ترتيب/تسمية الأعمدة داخل الملف) */
function colMap(ws, hdrRow) {
  const map = {};
  ws.getRow(hdrRow).eachCell({ includeEmpty: false }, (c, cn) => {
    const h = normHdr(cv(c));
    const set = k => { if (map[k] === undefined) map[k] = cn; };
    if (h === 'COMPANY') set('co');
    else if (h === 'NAME') set('name');
    else if (h === 'POSITION') set('pos');
    else if (h === 'STATUS') set('ws');
    else if (h === 'NATIONALITY') set('nat');
    else if (h.indexOf('RENTAL') >= 0) set('rd');
    else if (h.indexOf('NON-SAUDI APPROVAL') >= 0) set('apNS');
    else if (h.indexOf('SAUDI APPROVAL') >= 0) set('apSA');
    else if (h === 'TR SENT BY PMT') set('tr');
    else if (h.indexOf('ARAMCO EXAM DATE') >= 0) set('ed');
    else if (h.indexOf('ARAMCO EXAM') >= 0 && h.indexOf('RESULT') >= 0) set('ex');
    else if (h.indexOf('TRANSMITTAL') >= 0 && h.indexOf('APPROVAL DATE') >= 0 && h.indexOf('EXPIRATION') < 0) set('ad');
    else if (h.indexOf('EXPIRATION') >= 0 && h.indexOf('FINAL') >= 0) set('xpFinal');
    else if (h.indexOf('EXPIRATION') >= 0) set('xp');
    else if (h === 'EXAM & INTERVIEW DATE') set('ivd');
    else if (h === 'INTERVIEW RESULT') set('iv');
    else if (h === 'FINAL INTERVIEW STATUS') set('fin');
    else if (h === 'REMARKS') set('note');
  });
  return map;
}

/* التصنيف الأربعة — ترتيب الأولوية كما في مواصفات الصفحة */
function derive(r) {
  const ws = (r.ws || '').toUpperCase(), ex = (r.ex || '').toUpperCase();
  const iv = (r.iv || '').toUpperCase(), ap = (r.ap || '').toUpperCase();
  const fin = (r.fin || '').toUpperCase();
  if (/FAILED|RETAKE|NO\s*SHOW/.test(ws)) return 'failed_non_compliant';
  if (/FAILED|NO\s*SHOW/.test(ex)) return 'failed_non_compliant';
  if (/FAILED|NO\s*SHOW/.test(iv)) return 'failed_non_compliant';
  if (/WAITING FOR.*TRANSMITTAL/.test(ap)) return ex ? 'passed_pending_transmittal' : 'under_evaluation';
  if (ap === 'APPROVED' || fin.indexOf('ACCEPT') >= 0) return 'green_helmet_approved';
  if (/(90|180)\s*DAYS/.test(ap) || ap.indexOf('EXTENDED') >= 0) return 'under_evaluation';
  if (ex === 'PASSED') return 'passed_pending_transmittal';
  return 'under_evaluation';
}
const STATUS_KEY = { green_helmet_approved: 'أخضر', passed_pending_transmittal: 'ترانزميتال', under_evaluation: 'تجربة', failed_non_compliant: 'فشل' };

function apprEncode(o) {
  const out = { s: o.s };
  ['c', 't', 'n', 'ad', 'xp', 'ed', 'ex', 'ws', 'tr', 'note',
    'nat', 'rd', 'ap', 'apn', 'xi', 'xf', 'iv', 'ivd', 'fin'].forEach(k => { if (o[k]) out[k] = o[k]; });
  return JSON.stringify(out);
}
function apprSynthId(name) {
  let h = 5381; const s = String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'HYU-' + h.toString(36).toUpperCase();
}
async function sb(table, method, body, qs) {
  const r = await fetch(REST + table + (qs || ''), { method, headers: HDR, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  if (!r.ok) throw new Error(table + ' ' + method + ' → ' + r.status + ' ' + txt.slice(0, 300));
  return txt ? JSON.parse(txt) : null;
}
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node tools/appr-import.js <xlsx> [--apply]'); process.exit(2); }
  const APPLY = process.argv.indexOf('--apply') >= 0;

  /* 1) قراءة الملف */
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  let hdrRow = 0;
  for (let rn = 1; rn <= Math.min(ws.rowCount, 10); rn++) {
    if (normHdr(cv(ws.getRow(rn).getCell(1))) === 'NO.') { hdrRow = rn; break; }
  }
  if (!hdrRow) { console.error('لم يُعثر على صف الرؤوس (NO.)'); process.exit(2); }
  const map = colMap(ws, hdrRow);
  const need = ['co', 'name', 'pos', 'ws', 'ed', 'ex', 'apSA', 'ad', 'xp', 'fin'];
  const missing = need.filter(k => map[k] === undefined);
  if (missing.length) { console.error('أعمدة ناقصة في الملف:', missing.join(', ')); process.exit(2); }

  const all = [];
  for (let rn = hdrRow + 1; rn <= ws.rowCount; rn++) {
    const r = ws.getRow(rn);
    const raw = k => { const cn = map[k]; if (!cn) return null; return cv(r.getCell(cn)); };
    const g = k => { const v = raw(k); if (v == null) return ''; if (v instanceof Date) return dstr(v); return String(v).trim().replace(/\s+/g, ' '); };
    const rec = {
      rn: rn, co: g('co'), name: g('name'), pos: g('pos'), ws: g('ws'),
      nat: g('nat'), rd: g('rd'),
      ap: g('apSA') || g('apNS'), apS: g('apSA'), apN: g('apNS'),
      tr: g('tr'), ed: dstr(g('ed')), ex: g('ex'),
      ad: dstr(g('ad')), xp: dstr(g('xp')), xpFinal: dstr(g('xpFinal')),
      ivd: dstr(g('ivd')), iv: g('iv'), fin: g('fin'), note: g('note')
    };
    if (rec.name) all.push(rec);
  }
  /* 2) إزالة التكرارات: لكل اسم أحدث صف (بأحدث تاريخ تقدّم) */
  const keyDate = r => [r.ed, r.ad, r.xp, r.xpFinal, r.ivd].filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort().pop() || '';
  const byName = {};
  all.forEach(rec => {
    const k = normName(rec.name);
    if (!k) return;
    if (!byName[k] || keyDate(rec) >= keyDate(byName[k])) byName[k] = rec;
  });
  const uniq = Object.values(byName);

  /* 3) جلب البيانات الحالية */
  const [emps, apprs] = await Promise.all([
    sb('employees', 'GET', null, '?select=num,en,ar,phone'),
    sb('approvals', 'GET', null, '?select=emp_id,rotation,approval,phone,aramco_id,area')
  ]);
  const empIdx = {};
  emps.forEach(e => { const k = normName(e.en); if (k && !empIdx[k]) empIdx[k] = e; });
  const apprIdx = {};
  apprs.forEach(a => { apprIdx[String(a.emp_id || '').toUpperCase().replace(/\s+/g, '')] = a; });

  /* 4) بناء خطة الكتابة */
  const updates = [], inserts = [];
  const dist = { green_helmet_approved: 0, passed_pending_transmittal: 0, under_evaluation: 0, failed_non_compliant: 0 };
  let matched = 0, missingRow = 0;
  uniq.forEach(rec => {
    const status = derive(rec);
    dist[status]++;
    const emp = empIdx[normName(rec.name)] || null;
    const permanent = (rec.fin || '').toUpperCase().indexOf('ACCEPT') >= 0;
    const keepName = !emp || !(emp.en || emp.ar);
    const body = {
      s: status, c: rec.co || '', t: rec.pos || '',
      n: keepName ? rec.name : '', ad: rec.ad || '',
      xp: permanent ? '' : (rec.xp || rec.xpFinal || ''),
      ed: rec.ed || '', ex: rec.ex || '', ws: rec.ws || '',
      tr: rec.tr || '', note: rec.note || '',
      /* حقول خام لتصدير تنسيق TR STATUS (الجنسة/rental/أنواع الاعتماد/انتهاءات خام/المقابلة) */
      nat: rec.nat || '', rd: rec.rd || '',
      ap: rec.apS || '', apn: rec.apN || '',
      xi: rec.xp || '', xf: rec.xpFinal || '',
      iv: rec.iv || '', ivd: rec.ivd || '', fin: rec.fin || ''
    };
    if (emp) {
      matched++;
      const id = String(emp.num || '').trim().toUpperCase();
      const existing = apprIdx[id];
      if (existing) {
        const payload = { approval: apprEncode(body) };
        if (!existing.aramco_id && rec.tr) payload.aramco_id = rec.tr;
        if (!existing.phone && emp.phone) payload.phone = emp.phone;
        updates.push({ id: id, name: rec.name, status: status, body: payload });
      } else {
        missingRow++;
        inserts.push({ emp_id: id, rotation: '', approval: apprEncode(body), phone: emp.phone || '', aramco_id: rec.tr || '', area: '' });
      }
    } else {
      const sid = apprSynthId(rec.name);
      const existing = apprIdx[sid];
      if (existing) {
        /* تشغيل ثانٍ: الصف موجود ← تحديث بدل إدراج مكرر */
        updates.push({ id: sid, name: rec.name, status: status, body: { approval: apprEncode(body) } });
      } else {
        inserts.push({ emp_id: sid, rotation: '', approval: apprEncode(body), phone: '', aramco_id: rec.tr || '', area: '' });
      }
    }
  });
  const idList = inserts.map(i => i.emp_id);
  if (new Set(idList).size !== idList.length) {
    console.error('تكرار مفاتيح emp_id بين الصفوف الجديدة — أوقف التنفيذ.'); process.exit(2);
  }

  /* 5) الصفوف القديمة غير المشمولة (تبقى كما هي) */
  const updIds = new Set(updates.map(u => u.id));
  const insIds = new Set(inserts.map(i => i.emp_id));
  const legacyOnly = apprs.filter(a => {
    const k = String(a.emp_id || '').toUpperCase().replace(/\s+/g, '');
    return !updIds.has(k) && !insIds.has(k);
  });

  /* 6) تقرير */
  console.log('== خطة الاستيراد ==' + (APPLY ? ' (تطبيق)' : ' (تجربة — بدون كتابة)'));
  console.log('الملف: ' + path.basename(file) + ' | الورقة: ' + ws.name + ' | صفوف: ' + all.length + ' → أسماء فريدة: ' + uniq.length);
  console.log('التصنيف: أخضر ' + dist.green_helmet_approved + ' | ترانزميتال ' + dist.passed_pending_transmittal
    + ' | تجربة ' + dist.under_evaluation + ' | فشل ' + dist.failed_non_compliant);
  console.log('مطابقة بأسماء الموظفين: ' + matched + ' (منها ' + missingRow + ' بدون صف اعتماد ← إدراج)');
  console.log('صفوف جديدة لأشخاص غير مسجّلين: ' + (inserts.length - missingRow));
  console.log('تحديثات على صفوف موجودة: ' + updates.length);
  console.log('صفوف قديمة تبقى كما هي (غير مشمولة بالملف): ' + legacyOnly.length);

  if (!APPLY) {
    console.log('\n— العينة حسب التصنيف —');
    ['green_helmet_approved', 'passed_pending_transmittal', 'under_evaluation', 'failed_non_compliant'].forEach(s => {
      const list = uniq.filter(r => derive(r) === s).slice(0, 6).map(r => r.name + ' [' + (r.ed || r.ad || '—') + ']');
      console.log('  ' + STATUS_KEY[s] + ': ' + (uniq.filter(r => derive(r) === s).length) + ' — ' + list.join(' | '));
    });
    console.log('\nشغّل الأمر نفسه مع --apply لتنفيذ الكتابة.');
    return;
  }

  /* 7) التنفيذ */
  let nUpd = 0, nIns = 0;
  for (const batch of chunk(updates, 8)) {
    await Promise.all(batch.map(async u => {
      await sb('approvals', 'PATCH', u.body, '?emp_id=eq.' + encodeURIComponent(u.id));
      nUpd++;
    }));
  }
  for (const batch of chunk(inserts, 60)) {
    await sb('approvals', 'POST', batch);
    nIns += batch.length;
  }
  console.log('\nتم: تحديث ' + nUpd + ' | إدراج ' + nIns);

  /* 8) التحقق النهائي */
  const final = await sb('approvals', 'GET', null, '?select=emp_id,approval');
  const d2 = { green_helmet_approved: 0, passed_pending_transmittal: 0, under_evaluation: 0, failed_non_compliant: 0, other: 0 };
  const today = new Date().toISOString().slice(0, 10);
  let alerts = 0, withRaw = 0;
  final.forEach(a => {
    let o = {};
    try { o = JSON.parse(a.approval || '{}'); } catch (e) { }
    const s = o.s;
    if (d2[s] !== undefined) d2[s]++; else d2.other++;
    if (o.nat || o.rd || o.ap || o.apn || o.xi || o.xf || o.iv || o.ivd || o.fin) withRaw++;
    let al = 0;
    if (s === 'failed_non_compliant') al++;
    if (s === 'under_evaluation' && o.xp && o.xp < today) al++;
    if (s === 'green_helmet_approved' && o.xp && o.xp < today) al++;
    if (s === 'passed_pending_transmittal' && o.ed && (Date.parse(today) - Date.parse(o.ed)) / 86400000 > 30) al++;
    if (al) alerts++;
  });
  console.log('التحقق: إجمالي الصفوف ' + final.length + ' | أخضر ' + d2.green_helmet_approved + ' | ترانزميتال '
    + d2.passed_pending_transmittal + ' | تجربة ' + d2.under_evaluation + ' | فشل ' + d2.failed_non_compliant
    + ' | قديمة/أخرى ' + d2.other + ' | صفوف عليها تنبيه ' + alerts + ' | صفوف بحقول خام للتصدير ' + withRaw);
})().catch(e => { console.error('ERR', e.stack); process.exit(1); });

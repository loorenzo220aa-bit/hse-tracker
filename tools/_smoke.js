const fs = require('fs');
const { JSDOM, VirtualConsole } = require('C:/Users/USER/AppData/Local/Temp/hse-test/node_modules/jsdom');

const file = process.argv[2];
const html = fs.readFileSync(file, 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.stack || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
vc.on('warn', (...a) => { /* ignore console.warn (Supabase offline) */ });
vc.on('log', () => {});

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://loorenzo220aa-bit.github.io/hse-tracker/',
  virtualConsole: vc,
  pretendToBeVisual: true,
  beforeParse(w) {
    // jsdom لا يأتي بـ fetch؛ نحاكيه بيرفض الاتصال (نفس سلوك عدم توفر الشبكة)
    // مع تسجيل الطلبات حتى نتحقق من محتوياتها (مثل تشفير كلمة المرور)
    if (!w.AbortController) w.AbortController = class { abort() {} };
    w.__fetchCalls = [];
    w.fetch = (url, init) => {
      w.__fetchCalls.push({ url: String(url), method: (init && init.method) || 'GET', body: (init && init.body) || '' });
      return Promise.reject(new Error('offline (test stub)'));
    };
    // بيانات القروبات تُحمَّل من ملف خارجي (لا يجلبه jsdom) — نحقنها يدوياً
    try {
      const src = fs.readFileSync(require('path').join(require('path').dirname(file), 'groups-data.js'), 'utf8');
      const marker = 'window.GRP_DATA = ';
      const i = src.indexOf(marker);
      w.GRP_DATA = JSON.parse(src.slice(i + marker.length).trim().replace(/;\s*$/, ''));
    } catch (e) { w.GRP_DATA = {}; w.__grpErr = e.message; }
    // بيانات الإجازات السنوية (leave-data.js) — نفس أسلوب حقن القروبات
    try {
      const lvs = fs.readFileSync(require('path').join(require('path').dirname(file), 'leave-data.js'), 'utf8');
      const lvMark = 'window.LVSEED = ';
      const li = lvs.indexOf(lvMark);
      w.LVSEED = JSON.parse(lvs.slice(li + lvMark.length).trim().replace(/;\s*$/, ''));
    } catch (e) { w.LVSEED = { roster: [], leaves: [] }; w.__lvErr = e.message; }
  },
});

const { window } = dom;
const d = window.document;

setTimeout(() => {
  const ok = [];
  const bad = [];
  const t = (name, cond, extra) => (cond ? ok : bad).push(name + (extra ? ' — ' + extra : ''));

  // 1) top-level script completed (all handlers/functions registered)
  t('toast() defined', typeof window.toast === 'function');
  t('renderAppr() defined', typeof window.renderAppr === 'function');
  t('renderVeh() defined', typeof window.renderVeh === 'function');
  t('vehSaveBtn handler registered', typeof d.getElementById('vehSaveBtn').onclick === 'function');
  t('vehExportBtn handler registered', typeof d.getElementById('vehExportBtn').onclick === 'function');
  t('INIT ran: month picker set', !!d.getElementById('monthPicker').value, d.getElementById('monthPicker').value);

  // 2) language applied
  t('applyLang ran (dir=rtl)', d.documentElement.dir === 'rtl');
  t('employee card heading correct', d.querySelector('[data-i="t_emp"]').textContent.includes('إدارة الموظفين'),
    JSON.stringify(d.querySelector('[data-i="t_emp"]').textContent));
  t('no "XX" option labels left', !d.body.innerHTML.includes('>XX<'));
  // الهوية الجديدة: عنوان الموقع + إزالة عناوين الصفحة الرئيسية القديمة + عناوين الأقسام
  t('site title is Hyundai E&C', d.title === 'هيونداي للهندسة والإنشاءات (Hyundai E&C)', d.title);
  t('old homepage headings removed', !d.querySelector('[data-i="title"]') && !d.querySelector('[data-i="subtitle"]'));
  t('home sections titled (overview + quick access)',
    !!d.querySelector('.bc-title[data-i="home_stats"]') && !!d.querySelector('.bc-title[data-i="home_actions"]'));

  // 3) login flow with the seeded default admin
  d.getElementById('lgUser').value = 'admin';
  d.getElementById('lgPass').value = 'admin200';
  window.doLogin();

  setTimeout(() => {
    t('app visible after login', !d.getElementById('appWrap').classList.contains('hide'));
    t('logged-in user shown', d.getElementById('whoName').textContent.length > 0,
      d.getElementById('whoName').textContent);
    t('toast works without error', (() => { try { window.toast('test'); return true; } catch (e) { return false; } })());

    // 4) aramco tab renders rows into a real <tbody>
    const ab = d.getElementById('apprBody');
    t('apprBody exists', !!ab);
    t('apprBody is a <tbody>', !!ab && ab.tagName === 'TBODY');
    t('appr rows rendered', !!ab && ab.querySelectorAll('tr').length > 0, ab ? ab.querySelectorAll('tr').length + ' rows' : '');
    t('appr header has 8 columns', d.querySelectorAll('#viewAppr thead th').length === 8);
    // compact status pills
    const pills = [...ab.querySelectorAll('.st')];
    t('status uses compact pill', pills.length > 0 && pills.every(p => p.classList.contains('tag')), pills.length + ' pills');
    t('status labels are short', pills.every(p => (p.textContent || '').trim().length <= 20),
      pills.map(p => p.textContent.trim()).filter(x => x && x.length > 20).join(' | ') || 'max ' + Math.max(0, ...pills.map(p => p.textContent.trim().length)) + ' chars');
    t('full status kept in tooltip', pills.every(p => p.hasAttribute('title')));
    t('long text no longer wraps in pill', /\.st\{[^}]*white-space:nowrap/.test(html.replace(/\s+/g, ' ')));

    // 4b) نموذج التصنيفات الأربعة + محرك التنبيهات (ابروفل ارامكو)
    try {
      const ST = window.eval('APPR_ST');
      t('status model: exactly 4 statuses', Array.isArray(ST) && ST.length === 4 && ST.indexOf('green_helmet_approved') >= 0,
        JSON.stringify(ST));
      t('legacy PASS(Waiting…) → pending transmittal', window.apprParse('PASS(Waiting for a transmittal)').s === 'passed_pending_transmittal');
      t('legacy ACCEPTED → green helmet', window.apprParse('ACCEPTED').s === 'green_helmet_approved');
      t('legacy Trainee 180-day → under evaluation', window.apprParse('Trainee for 180-day').s === 'under_evaluation');
      t('JSON payload round-trips through approval field',
        window.apprParse(window.apprEncode({ s: 'under_evaluation', c: 'HYUNDAI (DIRECT)', t: 'SAFETY TRAINEE', xp: '2026-12-31' })).xp === '2026-12-31');
      t('KPI cards rendered (4)', d.querySelectorAll('#apprKpi .stat').length === 4,
        d.querySelectorAll('#apprKpi .stat').length + ' cards');
      t('status filter: all + 4 statuses', d.querySelectorAll('#apprStatus option').length === 5,
        d.querySelectorAll('#apprStatus option').length + ' options');
      t('company filter wired', typeof d.getElementById('apprCo').onchange === 'function');
      t('bell + counter exist in header', !!d.getElementById('apprBellBtn') && !!d.getElementById('apprBellN'));
      t('add button marked edit-only', !!d.getElementById('apprAddBtn').closest('.edit-only'));
      // تصدير Excel بنفس تنسيق ملف TR STATUS (قالب OOXML + كتابة خلايا محفوظة التنسيق)
      t('apprExportBtn handler registered', typeof d.getElementById('apprExportBtn').onclick === 'function');
      t('Aramco template committed', fs.existsSync(require('path').join(require('path').dirname(file), 'Aramco_Template.xlsx')));
      const exRow = window.apprExportRow({ i: 'SASL-9999', n: 'TEST SUBJECT', c: 'HYUNDAI (DIRECT)', t: 'SAFETY OFFICER',
        ws: 'ACTIVE', nat: 'Saudi', rd: 'Direct', ap: '90 DAYS', apn: 'APPROVED', xi: '2026-07-01', xf: '2026-12-31',
        ed: '2026-01-05', ex: 'PASSED', ad: '2026-01-10', tr: 'TR-77', iv: 'PASSED', ivd: '2026-01-06', note: 'r' }, 0, '2026-06-01');
      t('export row has exactly 36 columns', exRow.length === 36 && window.eval('APPR_EXPORT_COLS') === 36, exRow.length + ' cols');
      t('export row maps file columns (NO/NAME/STATUS/dates)',
        exRow[0] === 1 && exRow[2] === 'TEST SUBJECT' && exRow[7] === 'ACTIVE' && exRow[14] === '2026-01-05'
        && exRow[16] === '2026-01-10' && exRow[17] === '2026-07-01' && exRow[24] === '2026-12-31' && exRow[35] === 'r',
        JSON.stringify(exRow.slice(0, 4)));
      t('export row computes remaining days (S/Z)', exRow[18] === window.apprDays('2026-06-01', '2026-07-01')
        && exRow[25] === window.apprDays('2026-06-01', '2026-12-31'), 'S=' + exRow[18] + ' Z=' + exRow[25]);
      t('export keeps legacy approval text in SAUDI column',
        window.apprExportRow({ i: 'LEG-1', a: 'Safety officer 90-day', s: 'under_evaluation' }, 4, '2026-06-01')[11] === 'Safety officer 90-day');
      t('export column letters A..AJ', window.apprCol(1) === 'A' && window.apprCol(12) === 'L' && window.apprCol(36) === 'AJ');
      t('appr export degrades gracefully without JSZip', (() => {
        try { d.getElementById('apprExportBtn').click(); return !d.getElementById('apprExportBtn').disabled; }
        catch (e) { return false; }
      })());
      // ثلاثة أتصارات: كامل / مفلتر / PDF بتصميم الموقع
      t('filtered export button registered', typeof d.getElementById('apprExportFBtn').onclick === 'function');
      t('PDF export button registered', typeof d.getElementById('apprPdfBtn').onclick === 'function');
      t('apprFilterRows follows status filter', (() => {
        const sel = d.getElementById('apprStatus');
        const all = window.apprFilterRows();
        if (!all.length || !all[0].s) return false;
        const st0 = all[0].s;
        sel.value = st0;
        const f = window.apprFilterRows();
        sel.value = '';
        return f.length > 0 && f.length <= all.length && f.every(x => x.s === st0);
      })());
      t('apprFilterRows follows search box', (() => {
        const se = d.getElementById('apprSearch');
        const all = window.apprFilterRows();
        if (!all.length) return false;
        se.value = 'ZZQQXX'; const z = window.apprFilterRows();
        const nm = window.apprName(all[0]).trim();
        se.value = nm; const m = window.apprFilterRows();
        se.value = '';
        return z.length === 0 && m.length > 0 && m.length <= all.length;
      })());
      t('PDF libraries committed (jsPDF + html2canvas)', (() => {
        const p = require('path'), dir = p.dirname(file);
        return fs.existsSync(p.join(dir, 'jspdf.umd.min.js')) && fs.existsSync(p.join(dir, 'html2canvas.min.js'));
      })());
      t('apprPdfBuild renders off-screen page (head + 4 KPIs + rows + foot)', (() => {
        const el = window.apprPdfBuild([{ i: 'P1', s: 'green_helmet_approved', n: 'PDF ONE', c: 'CO',
          t: 'SAFETY OFFICER', ad: '2026-01-01', p: '0500000000', xp: '' }]);
        const ok = el.classList.contains('appr-pdf')
          && el.querySelectorAll('.appr-pdf-table tbody tr').length === 1
          && el.querySelectorAll('.appr-pdf-kpi .stat').length === 4
          && !!el.querySelector('.appr-pdf-head') && !!el.querySelector('.appr-pdf-foot');
        el.remove();
        return ok;
      })());
      t('alert: overdue probation', window.apprAlerts({ i: 'X', s: 'under_evaluation', xp: '2020-01-01' }).some(a => a.k === 'overdue'));
      t('alert: stale transmittal (>30d)', window.apprAlerts({ i: 'X', s: 'passed_pending_transmittal', ed: '2026-01-01' }).some(a => a.k === 'stale'));
      t('alert: failed status', window.apprAlerts({ i: 'X', s: 'failed_non_compliant' }).some(a => a.k === 'failed'));
      t('no alert for fresh green helmet', window.apprAlerts({ i: 'X', s: 'green_helmet_approved' }).length === 0);
      d.getElementById('apprBellBtn').click();
      t('bell drawer opens with content', !d.getElementById('apprBellDlg').classList.contains('hide')
        && d.getElementById('apprBellList').textContent.trim().length > 0);
      d.getElementById('apprBellX').click();
      t('bell drawer closes', d.getElementById('apprBellDlg').classList.contains('hide'));
      // شريط التنقل السفلي (ثيم الهوية) يتبع أي تبديل برمجي للعرض
      const th0 = d.documentElement.getAttribute('data-theme');
      d.documentElement.setAttribute('data-theme', 'brand');
      window.switchView('appr');
      t('brand bottom-nav follows programmatic switch',
        (d.querySelector('.bottom-nav .nav-item.active') || { dataset: {} }).dataset.view === 'viewAppr',
        'active=' + (d.querySelector('.bottom-nav .nav-item.active') || { dataset: {} }).dataset.view);
      window.switchView('vio');
      t('brand bottom-nav returns to violations',
        (d.querySelector('.bottom-nav .nav-item.active') || { dataset: {} }).dataset.view === 'viewVio');
      d.documentElement.setAttribute('data-theme', th0);
    } catch (e) { bad.push('approvals model threw: ' + e.message); }

    // 4c) الإجازات السنوية (annual leave tab)
    try {
      t('leave seed injected from leave-data.js',
        !!window.LVSEED && (window.LVSEED.roster || []).length === 206 && (window.LVSEED.leaves || []).length === 190,
        window.LVSEED ? (window.LVSEED.roster || []).length + '/' + (window.LVSEED.leaves || []).length : 'missing');
      t('leave tab + view exist', !!d.getElementById('tabLv') && !!d.getElementById('viewLv'));
      d.getElementById('tabLv').click();
      t('leave view visible + tab active',
        !d.getElementById('viewLv').classList.contains('hide') && d.getElementById('tabLv').classList.contains('active'));
      t('leave KPI cards rendered (4)', d.querySelectorAll('#lvKpi .stat').length === 4,
        d.querySelectorAll('#lvKpi .stat').length + ' cards');
      t('conflict banner lists same-trade overlap clusters',
        !d.getElementById('lvAlert').classList.contains('hide')
        && d.getElementById('lvAlert').textContent.includes('SAFETY OFFICER'),
        JSON.stringify(d.getElementById('lvAlert').textContent.slice(0, 90)));
      t('table: 9 columns + all 206 employees',
        d.querySelectorAll('#lvTable thead th').length === 9 && d.querySelectorAll('#lvBody tr').length === 206,
        d.querySelectorAll('#lvTable thead th').length + ' cols / ' + d.querySelectorAll('#lvBody tr').length + ' rows');
      t('status pills use house tag colors',
        d.querySelectorAll('#lvBody .tag').length === 206
        && [...d.querySelectorAll('#lvBody .tag')].every(p => p.classList.contains('t-per') || p.classList.contains('t-abs') || p.classList.contains('t-wrn')));
      t('dept filter: 10 trades + all', d.getElementById('lvDept').options.length === 11,
        d.getElementById('lvDept').options.length + ' options');
      t('status filter: all + 3 states', d.getElementById('lvStatus').options.length === 4);
      t('dept filter narrows rows', (() => {
        const sel = d.getElementById('lvDept');
        const pick = [...sel.options].find(o => o.value);
        sel.value = pick.value; sel.dispatchEvent(new window.Event('change'));
        const n = d.querySelectorAll('#lvBody tr').length;
        sel.value = ''; sel.dispatchEvent(new window.Event('change'));
        return n > 0 && n < 206;
      })());
      t('search box filters rows', (() => {
        const se = d.getElementById('lvSearch');
        se.value = 'ZZQQXX'; se.dispatchEvent(new window.Event('input'));
        const z = d.querySelectorAll('#lvBody tr').length;
        se.value = window.LVSEED.roster[0].n; se.dispatchEvent(new window.Event('input'));
        const m = d.querySelectorAll('#lvBody tr').length;
        se.value = ''; se.dispatchEvent(new window.Event('input'));
        return z === 0 && m > 0;
      })(), 'z/m');
      // منطق الحسابات — دالة نقية بتواريخ محسومة
      const lc = JSON.parse(window.eval(`(function(){
        const rec={i:'T1',e:21};
        const c1=lvCalc(rec,[{k:'a',i:'T1',s:'2026-01-05',d:10},{k:'b',i:'T1',s:'2026-10-01',d:5}],'2026-09-29');
        const c2=lvCalc(rec,[{k:'c',i:'T1',s:'2026-09-20',d:20}],'2026-09-29');
        const c3=lvCalc(rec,[],'2026-09-29');
        const c4=lvCalc(rec,[{k:'w',i:'T1',s:'2026-11-01',d:21,w:'2026-12-05'}],'2026-09-29');
        return JSON.stringify({used:c1.used,left:c1.left,st1:c1.status,next1:c1.next&&c1.next.s,
          st2:c2.status,ent3:c3.ent,st3:c3.status,st4:c4.status});
      })()`));
      t('lvCalc: consumed/remaining from past leaves', lc.used === 10 && lc.left === 11, JSON.stringify(lc));
      t('lvCalc: future leave → scheduled + next date', lc.st1 === 'scheduled' && lc.next1 === '2026-10-01');
      t('lvCalc: ongoing → on_leave, empty → at_work, ent=21', lc.st2 === 'on_leave' && lc.st3 === 'at_work' && lc.ent3 === 21);
      t('lvCalc: planning window → scheduled', lc.st4 === 'scheduled');
      // تعارضات الكوادر داخل التخصص نفسه
      const cf = JSON.parse(window.eval(`(function(){
        const roster=[{i:'X1',t:'SAFETY OFFICER',n:'A'},{i:'X2',t:'SAFETY OFFICER',n:'B'},{i:'X3',t:'RIGGER III',n:'C'}];
        const leaves=[{k:'l1',i:'X2',s:'2026-10-05',d:10}];
        const hit=lvConflicts({i:'X1',s:'2026-10-08',d:5},roster,leaves,'2026-09-29');
        const other=lvConflicts({i:'X3',s:'2026-10-08',d:5},roster,leaves,'2026-09-29');
        const apart=lvConflicts({i:'X1',s:'2026-11-20',d:5},roster,leaves,'2026-09-29');
        const exp=lvConflicts({i:'X1',s:'2026-09-29',d:5},roster,[{k:'l0',i:'X2',s:'2026-08-01',d:3}],'2026-09-29');
        return JSON.stringify({hit:hit.length,other:other.length,apart:apart.length,exp:exp.length});
      })()`));
      t('overlap: same trade + intersecting dates flagged', cf.hit === 1, JSON.stringify(cf));
      t('overlap: different trade ignored', cf.other === 0);
      t('overlap: non-intersecting ignored', cf.apart === 0);
      t('overlap: expired leaves ignored', cf.exp === 0);
      // الجدول الزمني (مخطط جانت)
      const gseg = [...d.querySelectorAll('#lvSeg .gseg')];
      t('table/timeline switch segments', gseg.length === 2
        && gseg.some(b => b.dataset.m === 'gantt') && gseg.some(b => b.dataset.m === 'table'));
      gseg.find(b => b.dataset.m === 'gantt').click();
      t('timeline renders bars (90-day horizon)', d.querySelectorAll('#lvGantt .lv-g-bar').length > 0,
        d.querySelectorAll('#lvGantt .lv-g-bar').length + ' bars');
      t('timeline groups rows by trade', d.querySelectorAll('#lvGantt .lv-g-trade').length >= 2,
        d.querySelectorAll('#lvGantt .lv-g-trade').length + ' groups');
      t('timeline: today marker + legend', !!d.querySelector('#lvGantt .lv-g-today') && !!d.querySelector('#lvGantt .lv-legend'));
      t('table hidden in timeline mode', d.getElementById('lvTableWrap').classList.contains('hide'));
      gseg.find(b => b.dataset.m === 'table').click();
      t('table restored', !d.getElementById('lvTableWrap').classList.contains('hide'));
      // النموذج: إضافة طلب إجازة (بدون حفظ — بدون confirm في الاختبار)
      t('add button present and edit-only', !!d.getElementById('lvAddBtn')
        && d.getElementById('lvAddBtn').closest('.edit-only') !== null);
      d.getElementById('lvAddBtn').click();
      t('leave dialog opens: employee select + start/dur/end',
        !d.getElementById('lvDlg').classList.contains('hide')
        && !!d.getElementById('lvfEmp') && d.getElementById('lvfEmp').options.length >= 206
        && !!d.getElementById('lvfStart') && !!d.getElementById('lvfDur') && !!d.getElementById('lvfEnd'));
      t('duration auto-fills end date', (() => {
        const s = d.getElementById('lvfStart'), du = d.getElementById('lvfDur'), e = d.getElementById('lvfEnd');
        s.value = '2026-12-01'; s.dispatchEvent(new window.Event('input'));
        du.value = '10'; du.dispatchEvent(new window.Event('input'));
        return e.value === '2026-12-10';
      })(), 'end=' + d.getElementById('lvfEnd').value);
      d.getElementById('lvDlgX').click();
      t('leave dialog closes', d.getElementById('lvDlg').classList.contains('hide'));
      // التصدير: صف 11 عموداً + القالب مُثبّت + الزران متصلان
      t('export row: 11 columns mapped', (() => {
        const r = window.lvExportRow({ r: { i: 'SASL-9999', n: 'TEST EMP', t: 'SAFETY OFFICER', e: 21 },
          ent: 21, used: 5, left: 16, status: 'scheduled', next: { s: '2026-12-01', d: 19 } }, 0);
        return r.length === 11 && r[1] === 'TEST EMP' && r[4] === 21 && r[6] === 16
          && String(r[7]).indexOf('2026-12-01') === 0 && r[8] === 19;
      })());
      t('Leaves_Template.xlsx committed', fs.existsSync(require('path').join(require('path').dirname(file), 'Leaves_Template.xlsx')));
      t('Excel export wired + degrades without JSZip', (() => {
        try { d.getElementById('lvExportBtn').click();
          return typeof d.getElementById('lvExportBtn').onclick === 'function' && !d.getElementById('lvExportBtn').disabled; }
        catch (e) { return false; }
      })());
      t('PDF export button registered', typeof d.getElementById('lvPdfBtn').onclick === 'function');
      t('lvPdfBuild renders page (head + 4 KPIs + 206 rows + foot)', (() => {
        const el = window.lvPdfBuild(window.lvFilterRows());
        const ok = el.classList.contains('appr-pdf')
          && el.querySelectorAll('.appr-pdf-table tbody tr').length === 206
          && el.querySelectorAll('.appr-pdf-kpi .stat').length === 4
          && !!el.querySelector('.appr-pdf-head') && !!el.querySelector('.appr-pdf-foot');
        el.remove();
        return ok;
      })());
      // مزامنة التخزين بين النوافذ (نفس الجيل يغلب — تعديلات المتصفح سارية بين النوافذ)
      t('storage overlay sync (same gen applies + restore seed)', (() => {
        const n0 = window.eval('LV.leaves.length');
        window.localStorage.setItem('hse-leaves-v1',
          JSON.stringify({ roster: window.eval('LV.roster'), leaves: [], defEnt: 21, gen: window.eval('LV.gen') }));
        window.dispatchEvent(Object.assign(new window.Event('storage'), { key: 'hse-leaves-v1' }));
        const cleared = window.eval('LV.leaves.length') === 0;
        window.localStorage.removeItem('hse-leaves-v1');
        window.dispatchEvent(Object.assign(new window.Event('storage'), { key: 'hse-leaves-v1' }));
        return cleared && window.eval('LV.leaves.length') === n0;
      })());
      // بوابة الجيل: نسخة محلية من بذرة أقدم تحل محلها البذرة الجديدة — التحديث يصل الجميع
      t('stale local copy (old gen) replaced by fresh seed + persisted', (() => {
        const seedN = window.eval('window.LVSEED.leaves.length');
        window.localStorage.setItem('hse-leaves-v1',
          JSON.stringify({ roster: [], leaves: [], defEnt: 21, gen: '2020-01-01T00:00:00Z' }));
        window.dispatchEvent(Object.assign(new window.Event('storage'), { key: 'hse-leaves-v1' }));
        const applied = window.eval('LV.leaves.length') === seedN;
        let persisted = false;
        try { persisted = JSON.parse(window.localStorage.getItem('hse-leaves-v1') || '{}').gen === window.eval('LV.gen'); } catch (e) {}
        window.localStorage.removeItem('hse-leaves-v1');
        window.dispatchEvent(Object.assign(new window.Event('storage'), { key: 'hse-leaves-v1' }));
        const restored = window.eval('LV.leaves.length') === seedN;
        return applied && persisted && restored;
      })());
      d.getElementById('tabVio').click();
    } catch (e) { bad.push('annual leave threw: ' + e.message); }

    // 4d) حماية سجل الحركات: فشل الرفع لا يُقدَّم كنجاح + طابور إعادة رفع تلقائي
    t('rec-queue helpers defined', typeof window.sbTry === 'function'
      && typeof window.recQueuePut === 'function' && typeof window.recQueueDrop === 'function'
      && typeof window.flushRecQueue === 'function' && typeof window.syncRecQueue === 'function');
    t('recQueuePut dedupes by id', (() => {
      window.localStorage.removeItem('hse-rec-queue');
      window.recQueuePut({ id: 'dup-1', type: 'violation' });
      window.recQueuePut({ id: 'dup-1', type: 'violation' });
      const n = JSON.parse(window.localStorage.getItem('hse-rec-queue') || '[]').length;
      window.localStorage.removeItem('hse-rec-queue');
      return n === 1;
    })());
    t('delRec drops the entry from the retry queue', (() => {
      window.localStorage.removeItem('hse-rec-queue');
      window.recQueuePut({ id: 'q-del-1', type: 'violation' });
      window.delRec('q-del-1');                       /* الجزء المتزامن يحذف من الطابور قبل انتظار الشبكة */
      const n = JSON.parse(window.localStorage.getItem('hse-rec-queue') || '[]').length;
      return n === 0;
    })());

    /* — قسم السيارات: لا خانة اسم فارغة — موظف غير موجود في employees يُقرأ من قوائم الحضور — */
    t('empAny: name recovered from attendance roster (GRP_DATA)',
      window.empAny('SASL-0606').en === 'AALI KHALID B ALOTAIBI', window.empAny('SASL-0606').en);
    t('empAny: unknown code falls back to the code itself (never blank)',
      window.empAny('ZZZ-9999').en === 'ZZZ-9999', String(window.empAny('ZZZ-9999').en));
    window.eval("(function(){ D.veh.push({id:'VEH-ORPH', empId:'SASL-0606', company:'HDEC', make:'TESTMAKE', model:'TESTMODEL', year:'2026', colour:'W', plate:'', date:'2026-09-29', notes:'', rot:'A'}); renderVeh(); })()");
    const orphRow = [].slice.call(d.querySelectorAll('#vehBody tr'))
      .find(function (x) { return x.textContent.indexOf('TESTMAKE') >= 0; });
    t('vehicles: orphan row shows name + job code (never blank)',
      !!orphRow && orphRow.cells[0].textContent.trim() === 'AALI KHALID B ALOTAIBI'
        && orphRow.cells[1].textContent.trim() === 'SASL-0606',
      orphRow ? JSON.stringify([orphRow.cells[0].textContent, orphRow.cells[1].textContent]) : 'row missing');
    t('vehicles: orphan kept selectable in employee dropdown (edit safe)',
      !!d.querySelector('#vehEmp option[value="SASL-0606"]'));
    window.eval("(function(){ D.veh = D.veh.filter(function(v){ return v.id !== 'VEH-ORPH'; }); renderVeh(); })()");

    /* مزامنة ماستر MPR: قوائم الموظفين الثلاث (إجازات/حضور/دليل) مقتطعة من tools/mpr-master.json */
    t('MPR master sync: leave + groups + staff all inside the master list', (() => {
      try {
        const p = require('path'), f = require('fs');
        const norm = s => String(s || '').toUpperCase().replace(/\s+/g, '');
        const mpr = new Set(JSON.parse(f.readFileSync(p.join(p.dirname(file), 'tools', 'mpr-master.json'), 'utf8')).map(x => norm(x.num)));
        const lv = ((window.LVSEED && window.LVSEED.roster) || []).every(r => mpr.has(norm(r.i)));
        const g = window.GRP_DATA || {};
        const gr = ['A', 'B', 'D'].every(k => (g[k] || []).every(x => mpr.has(norm(x[0]))));
        const src2 = f.readFileSync(file, 'utf8');
        const st = ['STAFF_HDEC', 'STAFF_HEC'].every(nm => {
          const m = src2.match(new RegExp('const ' + nm + '=(\\[[^\\n]*?\\]);'));
          return !!m && JSON.parse(m[1]).every(s => mpr.has(norm(s.i)));
        });
        return lv && gr && st;
      } catch (e) { return false; }
    })(), 'roster/groups/staff ⊈ mpr-master.json');

    /* السيناريو الكامل (غير متزامن): حفظ والشبكة مقطوعة ← تحذير صادق + بقاء محلي،
       ثم عودة الاتصال ← رفع تلقائي وتفريغ الطابور. يُستدعى من finish(). */
    // — الطبقة العامة للكتابة الموثوقة: إشعار صادق + طابور عام + لا محو عند فشل الجلب —
    function runWriteLayerTest(done) {
      try {
        t('write-layer: helpers defined',
          ['sbWrite', 'flushWriteQueue', 'syncWriteQueue', 'syncAllQueues', 'writeToast', 'refreshFromServer', 'wqPut']
            .every(function (fn) { return typeof window[fn] === 'function'; }));
        t('writeToast: success shows caller message',
          window.writeToast({ ok: true }, 'MSG-OK-TEST') === true
            && d.getElementById('toast').textContent === 'MSG-OK-TEST',
          d.getElementById('toast').textContent);
        window.writeToast({ ok: false, queued: true }, 'X');
        const tq = d.getElementById('toast').textContent;
        t('writeToast: queued failure is honest — no fake success',
          tq.indexOf('قائمة الإرسال') >= 0 && tq.indexOf('MSG-OK-TEST') < 0, tq);
        window.writeToast({ ok: false, queued: false, status: 403 }, 'X');
        const tr = d.getElementById('toast').textContent;
        t('writeToast: server rejection says not saved', tr.indexOf('لم يُحفظ') >= 0, tr);

        // sbWrite: فشل مؤقت ← طابور عام؛ ثم الإفراغ ← إرسال فعلي
        window.localStorage.removeItem('hse-write-queue');
        const midFetch = window.fetch;
        window.fetch = function () { return Promise.reject(new Error('offline (test stub)')); };
        window.sbWrite('vehicles', 'POST', { id: 'WQ-PROBE' }).then(function (res) {
          const wq = JSON.parse(window.localStorage.getItem('hse-write-queue') || '[]');
          t('sbWrite offline: queued to hse-write-queue',
            res.ok === false && res.queued === true && wq.length === 1 && wq[0].table === 'vehicles',
            JSON.stringify(res) + ' q=' + wq.length);
          window.fetch = function (url, init) {
            window.__fetchCalls.push({ url: String(url), method: (init && init.method) || 'GET', body: (init && init.body) || '' });
            return Promise.resolve({ ok: true, status: 201, text: function () { return Promise.resolve('[]'); } });
          };
          return window.flushWriteQueue();
        }).then(function (n) {
          const wq2 = JSON.parse(window.localStorage.getItem('hse-write-queue') || '[]');
          const posts = window.__fetchCalls.filter(function (c) {
            return c.method === 'POST' && /rest\/v1\/vehicles/.test(c.url) && String(c.body).indexOf('WQ-PROBE') >= 0;
          });
          t('flushWriteQueue: emptied + queued write POSTed',
            wq2.length === 0 && n >= 1 && posts.length >= 1,
            'q=' + wq2.length + ' n=' + n + ' posts=' + posts.length);
          // loadAll: فشل الشبكة لا يمحو البيانات المحلية (شرط آمن للتحديث الدوري)
          window.eval("(function(){ D.rec.push({id:'SENT-REC', empId:'X', type:'violation', date:'2026-09-01', note:'SENTINEL-KEEP', by:'t', ts:1}); D.emp.push({id:'SENT-EMP', ar:'سنتينل', en:'Sentinel', num:'SNT-1', dept:'', phone:'', plate:'', grp:'', photo:''}); })()");
          window.fetch = function () { return Promise.reject(new Error('offline (test stub)')); };
          return window.loadAll();
        }).then(function () {
          const keep = window.eval("(function(){ return D.rec.some(function(r){return r.id==='SENT-REC';}) && D.emp.some(function(e){return e.id==='SENT-EMP';}); })()");
          t('loadAll on network failure keeps local data (no wipe)', keep === true);
          window.fetch = midFetch;
          // refreshFromServer: لا يقاطع أثناء الكتابة في حقل
          const fi = d.getElementById('filtEmp');
          if (fi) fi.focus();
          return window.refreshFromServer();
        }).then(function (ran) {
          t('refreshFromServer: skipped while user is typing — no interruption', ran === false,
            'activeElement=' + (d.activeElement && d.activeElement.id));
          window.eval("(function(){ D.rec = D.rec.filter(function(r){ return r.id !== 'SENT-REC'; }); D.emp = D.emp.filter(function(e){ return e.id !== 'SENT-EMP'; }); fillEmpSel(); renderStats(); renderRecs(); renderSum(); })()");
          window.localStorage.removeItem('hse-write-queue');
          done();
        }).catch(function (e) { bad.push('write-layer threw: ' + e.message); done(); });
      } catch (e) { bad.push('write-layer setup threw: ' + e.message); done(); }
    }

    /* — صدق رفض الخادم + عدم فقدان أي سجل معلّق (4 فحوصات جديدة) — */
    function runHonestRejectTests(done) {
      try {
        const okFetch = window.fetch;   // مُحاكي النجاح201 (الذي يسجّل في __fetchCalls)
        const recs403 = function (url, init) {
          if (String(url).indexOf('/rest/v1/records') >= 0 && init && init.method === 'POST')
            return Promise.resolve({ ok: false, status: 403, text: function () { return Promise.resolve('{"message":"blocked by policy"}'); } });
          return okFetch.apply(window, arguments);
        };

        // (1) رفض دائم (4xx) أثناء الإضافة: لا طابور + لا شبح محلي + تحذير صادق بلا وعود كاذبة
        window.localStorage.removeItem('hse-rec-queue');
        const n1 = window.eval('D.rec.length');
        window.fetch = recs403;
        d.getElementById('recNote').value = 'CHECK-REJECT-403';
        d.getElementById('addRecBtn').click();
        setTimeout(function () {
          try {
            const q1 = JSON.parse(window.localStorage.getItem('hse-rec-queue') || '[]');
            t('reject: no queue on permanent 4xx', q1.length === 0, 'q=' + q1.length);
            t('reject: no phantom row left locally (removed immediately)', window.eval('D.rec.length') === n1,
              'n=' + window.eval('D.rec.length') + ' vs ' + n1);
            const tt = d.getElementById('toast').textContent;
            t('reject: honest toast — not saved, no false retry promise',
              tt.indexOf('رفض') >= 0 && tt.indexOf('ستُعاد') < 0, JSON.stringify(tt));
            t('reject: row absent from table', d.getElementById('recBody').textContent.indexOf('CHECK-REJECT-403') < 0, 'still visible!');
          } catch (e) { bad.push('reject assertions threw: ' + e.message); }

          // (2) الإفراغ: الرفض الدائم يُسقط من الطابور بلا إعادة محاولة عمياء + يزيل الشبح
          try {
            window.localStorage.removeItem('hse-rec-queue');
            window.eval("(function(){ var r={id:'rej-flush-1',empId:'REC-Q-EMP',type:'violation',date:'2026-09-15',note:'CHECK-FLUSH-REJECT',by:'admin',ts:Date.now()}; D.rec.push(r); recQueuePut({id:r.id,emp_id:r.empId,type:r.type,date:r.date,note:r.note,by_user:r.by,ts:r.ts}); renderRecs(); })()");
            window.fetch = recs403;
          } catch (e) { bad.push('flush-reject setup threw: ' + e.message); done(); return; }
          window.flushRecQueue().then(function () {
            try {
              const q2 = JSON.parse(window.localStorage.getItem('hse-rec-queue') || '[]');
              t('flush: permanent reject dropped — no blind retry', q2.length === 0, JSON.stringify(q2).slice(0, 80));
              t('flush: rejected phantom removed from D.rec',
                window.eval("!D.rec.some(function(r){return r.id==='rej-flush-1';})"), 'still there');
            } catch (e) { bad.push('flush-reject assertions threw: ' + e.message); }

            // (3) حارس فقدان البيانات محذوف: الرفع يحدث حتى لو غاب السجل عن D.rec
            try {
              window.localStorage.removeItem('hse-rec-queue');
              window.fetch = okFetch;
              window.__fetchCalls = [];
              window.recQueuePut({ id: 'absent-1', emp_id: 'REC-Q-EMP', type: 'violation', date: '2026-09-15', note: 'CHECK-ABSENT-UPLOAD', by_user: 'admin', ts: 1 });
            } catch (e) { bad.push('absent-upload setup threw: ' + e.message); done(); return; }
            window.flushRecQueue().then(function () {
              try {
                const q3 = JSON.parse(window.localStorage.getItem('hse-rec-queue') || '[]');
                const posts = window.__fetchCalls.filter(function (c) {
                  return c.method === 'POST' && /rest\/v1\/records/.test(c.url) && String(c.body).indexOf('CHECK-ABSENT-UPLOAD') >= 0;
                });
                t('flush: uploads entry even when missing from D.rec (no-drop guard)', q3.length === 0 && posts.length >= 1,
                  'q=' + q3.length + ' posts=' + posts.length);
              } catch (e) { bad.push('absent-upload assertions threw: ' + e.message); }

              // (4) شارة «قيد الرفع» على الصف المعلّق
              try {
                window.localStorage.removeItem('hse-rec-queue');
                window.eval("(function(){ document.getElementById('filtEmp').value=''; document.getElementById('filtType').value=''; var r={id:'badge-1',empId:'REC-Q-EMP',type:'violation',date:curMonth()+'-15',note:'CHECK-BADGE',by:'admin',ts:Date.now()}; D.rec.push(r); recQueuePut({id:r.id,emp_id:r.empId,type:r.type,date:r.date,note:r.note,by_user:r.by,ts:r.ts}); renderRecs(); })()");
                const btxt = d.getElementById('recBody').textContent;
                t('pending badge shows «قيد الرفع» on queued row',
                  btxt.indexOf('قيد الرفع') >= 0 && btxt.indexOf('CHECK-BADGE') >= 0, btxt.slice(0, 80));
                window.eval("D.rec = D.rec.filter(function(r){ return ['CHECK-REJECT-403','CHECK-FLUSH-REJECT','CHECK-ABSENT-UPLOAD','CHECK-BADGE'].indexOf(String(r.note))<0; }); renderRecs(); renderStats(); renderSum();");
                window.localStorage.removeItem('hse-rec-queue');
              } catch (e) { bad.push('badge assertions threw: ' + e.message); }
              window.fetch = okFetch;
              runVisThenCrash(done);
            }).catch(function (e) { bad.push('absent flush threw: ' + e.message); window.fetch = okFetch; done(); });
          }).catch(function (e) { bad.push('flush-reject threw: ' + e.message); done(); });
        }, 80);
      } catch (e) { bad.push('reject setup threw: ' + e.message); done(); }
    }

    /* — تغذية راجعة فورية + ضمان رؤية الصف الجديد + كشف الأعطال بصرياً (5 فحوصات) — */
    function runVisThenCrash(done) {
      // (5-7) الضغط لا يصمت أبداً + قفز فلتر الشهر + إزالة فلتر يحجب الصف
      try {
        window.localStorage.removeItem('hse-rec-queue');
        window.eval("(function(){ if(!D.emp.some(function(e){return e.id==='OTHER-EMP';})){ D.emp.push({id:'OTHER-EMP',ar:'موظف آخر',en:'Other Emp',num:'OT-001',dept:'HSE',phone:'',plate:'',grp:'',photo:''}); } fillEmpSel(); document.getElementById('filtEmp').value='OTHER-EMP'; document.getElementById('filtType').value=''; document.getElementById('monthPicker').value='2026-01'; document.getElementById('recEmp').value='REC-Q-EMP'; document.getElementById('recType').value='violation'; document.getElementById('recDate').value='2026-09-15'; document.getElementById('recNote').value='CHECK-VIS-0915'; })()");
        d.getElementById('addRecBtn').click();
        const tSync = d.getElementById('toast').textContent;
        t('add: instant feedback while saving — no silent press', tSync.indexOf('جارٍ الحفظ') >= 0, JSON.stringify(tSync));
      } catch (e) { bad.push('vis setup threw: ' + e.message); done(); return; }
      setTimeout(function () {
        try {
          const mp2 = d.getElementById('monthPicker');
          t('add: month filter jumps to record month — row always visible', mp2.value === '2026-09', 'mp=' + mp2.value);
          t('add: blocking employee filter cleared', d.getElementById('filtEmp').value === '', 'filtEmp=' + d.getElementById('filtEmp').value);
          t('add: new row visible in table', d.getElementById('recBody').textContent.indexOf('CHECK-VIS-0915') >= 0, 'not visible!');
          const tt2 = d.getElementById('toast').textContent;
          t('add: final toast = success after instant feedback', tt2.indexOf('تم حفظ الحركة') >= 0, JSON.stringify(tt2));
          window.eval("D.rec = D.rec.filter(function(r){ return String(r.note).indexOf('CHECK-VIS')<0; }); D.emp = D.emp.filter(function(e){ return e.id!=='OTHER-EMP'; }); fillEmpSel(); document.getElementById('monthPicker').value='2026-09'; document.getElementById('filtEmp').value=''; renderStats(); renderRecs(); renderSum();");
        } catch (e) { bad.push('vis assertions threw: ' + e.message); }
        runCrashTest(done);
      }, 80);
    }
    function runCrashTest(done) {
      // (8-9) عطل غير متوقع داخل مسار الحفظ ← رسالة صريحة + بلا شبح + زر مفعّل
      try {
        const origSave = window.saveRec;
        window.saveRec = function () { throw new Error('boom-crash-test'); };
        const n0 = window.eval('D.rec.length');
        d.getElementById('recNote').value = 'CHECK-CRASH';
        d.getElementById('addRecBtn').click();
        const tt = d.getElementById('toast').textContent;
        t('crash: error surfaces to user — no silent failure',
          tt.indexOf('خطأ يمنع حفظ الحركة') >= 0 && tt.indexOf('boom-crash-test') >= 0, JSON.stringify(tt));
        t('crash: no phantom row left', window.eval('D.rec.length') === n0,
          'n=' + window.eval('D.rec.length') + ' vs ' + n0);
        t('crash: save button re-enabled', d.getElementById('addRecBtn').disabled === false, 'still disabled');
        window.saveRec = origSave;
        window.eval("localStorage.removeItem('hse-rec-queue'); renderRecs();");
        runExportTests(done);
      } catch (e) { bad.push('crash test threw: ' + e.message); done(); }
    }
    function runExportTests(done) {
      // — تصدير الملخص الشهري: النطاق + فكّ الملاحظة/المستند + بناء PDF + الزران (4 فحوصات) —
      try {
        const probe = window.eval(`(function(){
          var out={};
          try{
            var m=curMonth();
            D.emp.push({id:'VIO-TMP-EMP', ar:'موظف النطاق', en:'Scope Emp', num:'VIO-900', dept:'HSE', phone:'', plate:'', grp:'', photo:''});
            var e0=D.emp[D.emp.length-1];
            var e1=sortedEmp().filter(function(x){ return x.id!=='VIO-TMP-EMP'; })[0]||null;
            var b1=e1?sumData(m).map[e1.id].vio:0;
            D.rec.push({id:'svo-1', empId:e0.id, type:'violation', date:m+'-11', note:'vio t1', by:SESSION, ts:Date.now()});
            D.rec.push({id:'svo-2', empId:e0.id, type:'violation', date:m+'-12', note:'vio t2', by:SESSION, ts:Date.now()});
            if(e1) D.rec.push({id:'svo-3', empId:e1.id, type:'absence', date:m+'-13', note:'abs t', by:SESSION, ts:Date.now()});
            var rows=sumVioRows(m).rows, r0=null;
            rows.forEach(function(x){ if(x.e.id===e0.id) r0=x; });
            out.scope = !!r0 && r0.o.vio===2
              && rows.every(function(x){ return x.o.vio>0; })
              && !rows.some(function(x){ return x.e.id!==e0.id && x.o.vio>b1; });
            out.n=rows.length;
            var host=recPdfBuild();
            if(host){
              out.head=!!host.querySelector('.rsum-head');
              out.foot=!!host.querySelector('.appr-pdf-foot');
              out.sumRows=host.querySelectorAll('.rsum-sec tbody tr').length;
              out.emps=host.querySelectorAll('.rsum-emp').length;
              out.vios=host.querySelectorAll('.rsum-vio').length;
              host.parentNode && host.parentNode.removeChild(host);
            }
          }catch(ex){ out.err=ex.message; }
          D.rec=D.rec.filter(function(r){ return r.id!=='svo-1'&&r.id!=='svo-2'&&r.id!=='svo-3'; });
          D.emp=D.emp.filter(function(e){ return e.id!=='VIO-TMP-EMP'; });
          return JSON.stringify(out);
        })()`);
        const o = JSON.parse(probe);
        t('export scope: only employees with violations — desc, absence-only excluded',
          !o.err && o.scope, JSON.stringify(o));
        t('export pdf builder: head + foot + summary rows + employee blocks + violation cards',
          !o.err && o.head && o.foot && o.sumRows === o.n && o.emps === o.n && o.vios >= 2, JSON.stringify(o));
        const pn = window.eval("recNoteObj({note:JSON.stringify({note:'ملاحظة', file:{name:'e.jpg', type:'image/jpeg', data:'data:image/jpeg;base64,AAA'}})})");
        const pa = window.eval("recNoteObj({note:'نص عادي'})");
        t('export recNoteObj: JSON note splits text vs file (no base64 leak to cells)',
          pn && pn.note === 'ملاحظة' && pn.file && pn.file.name === 'e.jpg' && pa.note === 'نص عادي' && !pa.file,
          JSON.stringify({pn:pn, pa:pa}));
        const x0 = window.XLSX; let cerr = '';
        try { window.XLSX = undefined; d.getElementById('exportBtn').click(); }
        catch (ex) { cerr = ex.message; } finally { window.XLSX = x0; }
        const et = d.getElementById('toast').textContent;
        t('export excel: never silent — no throw, honest toast (lib/empty/success)',
          !cerr && et.length > 0, cerr || JSON.stringify(et));
        t('export pdf button wired', typeof d.getElementById('recPdfBtn').onclick === 'function');
        done();
      } catch (e) { bad.push('export tests threw: ' + e.message); done(); }
    }

    function runRecQueueTest(done) {
      try {
        // العودة لجلسة المدير (الجلسة الحالية cryptotest العرضي)
        window.doLogout();
        d.getElementById('lgUser').value = 'admin';
        d.getElementById('lgPass').value = 'admin200';
        window.doLogin();
        t('rec-queue: admin session restored', d.documentElement.getAttribute('data-perm') === 'edit',
          'perm=' + d.documentElement.getAttribute('data-perm'));
        window.eval("(function(){ D.emp.push({id:'REC-Q-EMP', ar:'موظف اختبار', en:'Rec Queue Emp', num:'RQ-001', dept:'HSE', phone:'', plate:'', grp:'', photo:''}); fillEmpSel(); })()");
        const sel = d.getElementById('recEmp');
        sel.value = 'REC-Q-EMP';
        t('rec-queue: employee select populated', sel.value === 'REC-Q-EMP');

        // بيئة الاختبار: fetch يرفض دائماً (قطع الاتصال)
        window.localStorage.removeItem('hse-rec-queue');
        d.getElementById('recType').value = 'violation';
        d.getElementById('recDate').value = '2026-09-15';
        d.getElementById('recNote').value = 'CHECK-QUEUE-OFFLINE';
        const n0 = window.eval('D.rec.length');
        d.getElementById('addRecBtn').click();
        setTimeout(function () {
          try {
            const q = JSON.parse(window.localStorage.getItem('hse-rec-queue') || '[]');
            t('offline save: payload queued for retry', q.length === 1
              && String(q[0].payload.note) === 'CHECK-QUEUE-OFFLINE'
              && String(q[0].payload.emp_id) === 'REC-Q-EMP', JSON.stringify(q[0] || null).slice(0, 120));
            t('offline save: entry still visible locally (D.rec +1)', window.eval('D.rec.length') === n0 + 1);
            const tt = d.getElementById('toast').textContent;
            t('offline save: honest warning, no fake success',
              tt.indexOf('تعذّر') >= 0 && tt.indexOf('تم حفظ الحركة') < 0, JSON.stringify(tt));
            t('offline save: row listed in سجل الحركات',
              !!d.querySelector('#recBody tr')
              && d.getElementById('recBody').textContent.indexOf('CHECK-QUEUE-OFFLINE') >= 0);

            // عودة الاتصال ← الإفراغ يرفع المعلّق ويصفّي الطابور
            const origFetch = window.fetch;
            window.fetch = function (url, init) {
              window.__fetchCalls.push({ url: String(url), method: (init && init.method) || 'GET', body: (init && init.body) || '' });
              return Promise.resolve({ ok: true, status: 201, text: function () { return Promise.resolve('[]'); } });
            };
            window.flushRecQueue().then(function () {
              try {
                const q2 = JSON.parse(window.localStorage.getItem('hse-rec-queue') || '[]');
                t('flush: queue emptied after successful upload', q2.length === 0, JSON.stringify(q2).slice(0, 80));
                const posts = window.__fetchCalls.filter(function (c) {
                  return c.method === 'POST' && /rest\/v1\/records/.test(c.url)
                    && String(c.body).indexOf('CHECK-QUEUE-OFFLINE') >= 0;
                });
                t('flush: payload POSTed to records', posts.length >= 1, posts.length + ' calls');
              } catch (e) { bad.push('flush assertions threw: ' + e.message); }
              // ثم فحوصات صدق الرفض وعدم فقدان المعلّق، ثم الطبقة العامة، ثم التنظيف
              runHonestRejectTests(function () {
              runWriteLayerTest(function () {
              // التنظيف واسترجاع جلسة cryptotest كما هي
              try {
                window.eval("(function(){ D.rec = D.rec.filter(function(r){ return r.note !== 'CHECK-QUEUE-OFFLINE'; }); renderStats(); renderRecs(); renderSum(); })()");
                window.localStorage.removeItem('hse-rec-queue');
                window.fetch = origFetch;
                window.eval("(function(){ D.emp = D.emp.filter(function(e){ return e.id !== 'REC-Q-EMP'; }); fillEmpSel(); })()");
                window.doLogout();
                d.getElementById('lgUser').value = 'cryptotest';
                d.getElementById('lgPass').value = 'MySecret123';
                window.doLogin();
              } catch (e) { bad.push('rec-queue cleanup threw: ' + e.message); }
              done();
              });
              });   /* نهاية runHonestRejectTests */
            }).catch(function (e) { bad.push('flush threw: ' + e.message); done(); });
          } catch (e) { bad.push('rec-queue async threw: ' + e.message); done(); }
        }, 80);
      } catch (e) { bad.push('rec-queue setup threw: ' + e.message); done(); }
    }

    // 5) dashboard / charts
    const dd = d.getElementById('dashDaily');
    t('dashboard card exists', !!d.getElementById('dashCard'));
    t('daily bars rendered', !!dd && dd.querySelectorAll('.b').length >= 28, dd ? dd.querySelectorAll('.b').length + ' bars' : '');
    t('type distribution rendered', d.getElementById('dashTypes').querySelectorAll('.dash-row').length === 6);
    t('months comparison rendered', d.getElementById('dashMonths').querySelectorAll('.b').length === 6);
    t('top list rendered or empty-state', d.getElementById('dashTop').innerHTML.length > 0);
    t('dashboard i18n applied', d.querySelector('[data-i="dash_title"]').textContent.includes('لوحة التحكم'));

    // 6) dark mode toggle
    try {
      const tb = d.getElementById('themeBtn');
      t('theme button exists', !!tb);
      const before = d.documentElement.getAttribute('data-theme');
      tb.click();
      const after = d.documentElement.getAttribute('data-theme');
      t('dark mode toggles', (before === 'dark') ? after !== 'dark' : after === 'dark', 'before=' + before + ' after=' + after);
      t('theme persisted', window.localStorage.getItem('hse-theme') === (after === 'dark' ? 'dark' : 'light'));
      tb.click(); // revert
      t('dark mode reverts', d.documentElement.getAttribute('data-theme') === before);
    } catch (e) { bad.push('theme toggle threw: ' + e.message); }

    // 6) password hashing
    try {
      const h = window.hashPass('admin200');
      t('hashPass produces salted hash', typeof h === 'string' && h.startsWith('h$') && /^[0-9a-f]{64}$/.test(h.slice(h.lastIndexOf('$') + 1)), h.slice(0, 24) + '…');
      t('hashPass is one-way (≠ plaintext)', h !== 'admin200');
      t('hashPass deterministic', window.hashPass('admin200') === h);
      t('hashPass differs per password', window.hashPass('password1') !== h);
      t('passMatch accepts hashed form', window.passMatch({ pass: h }, 'admin200') === true);
      t('passMatch rejects wrong password', window.passMatch({ pass: h }, 'wrong') === false);
      t('passMatch still accepts legacy plaintext', window.passMatch({ pass: 'legacy' }, 'legacy') === true);
      t('migration button exists', !!d.getElementById('migBtn'));

      // صلاحيات المستخدمين
      t('permission checkbox replaces role select', !!d.getElementById('uPermFull') && !d.getElementById('uRole'));
      t('user row has edit (permissions) button', !!d.querySelector('#userBody [data-editu]'));
      t('admin holds full permissions', window.isAdmin() === true);
      t('admin data-perm = edit', d.documentElement.getAttribute('data-perm') === 'edit',
        'got: ' + d.documentElement.getAttribute('data-perm'));

      // create a user → the payload written to Supabase must contain a hash, not plaintext
      d.getElementById('uName').value = 'اختبار التشفير';
      d.getElementById('uUser').value = 'cryptotest';
      d.getElementById('uPass').value = 'MySecret123';
      d.getElementById('addUserBtn').click();
      setTimeout(() => {
        const calls = window.__fetchCalls.filter(c => c.method === 'POST' && /rest\/v1\/users/.test(c.url));
        const bodies = calls.map(c => { try { return JSON.parse(c.body); } catch (e) { return null; } }).filter(Boolean);
        const saved = bodies.find(b => b.username === 'cryptotest');
        t('new user payload has hashed password', !!saved && saved.password !== 'MySecret123' && /^h\$/.test(saved.password || ''),
          saved ? String(saved.password).slice(0, 20) + '…' : 'no users POST captured');

        // حساب بلا صلاحيات (role=user): يرى كل شيء ولا يعدّل شيئاً
        window.doLogout();
        d.getElementById('lgUser').value = 'cryptotest';
        d.getElementById('lgPass').value = 'MySecret123';
        window.doLogin();
        setTimeout(function () {
          t('view-only login succeeds', !d.getElementById('appWrap').classList.contains('hide'));
          t('view-only has no permissions', window.isAdmin() === false);
          t('data-perm = view for view-only user', d.documentElement.getAttribute('data-perm') === 'view',
            'got: ' + d.documentElement.getAttribute('data-perm'));
          t('users card hidden from view-only user', d.getElementById('usersCard').classList.contains('hide'));
          t('every save control marked edit-only',
            !!d.getElementById('addEmpBtn').closest('.edit-only') && !!d.getElementById('addRecBtn').closest('.edit-only')
            && !!d.getElementById('tsSaveBtn').closest('.edit-only') && !!d.getElementById('depSaveBtn').closest('.edit-only')
            && !!d.getElementById('vehSaveBtn').closest('.edit-only') && !!d.getElementById('importBtn').closest('.edit-only'));
          runRecQueueTest(finish);
        }, 300);
      }, 250);
    } catch (e) { bad.push('password hashing threw: ' + e.message); runRecQueueTest(finish); }

    function finish() {
      // 7) switch tabs (this exercises renderVeh / renderDep / renderTs / renderStaff)
      ['tabVeh', 'tabAppr', 'tabLv', 'tabDep', 'tabEmp', 'tabTs', 'tabVio'].forEach(id => {
        try { d.getElementById(id).click(); } catch (e) { bad.push('tab ' + id + ' click threw: ' + e.message); }
      });
      t('viewVio active at end', !d.getElementById('viewVio').classList.contains('hide'));

      // تكامل عبر التبويبات: حالة الاعتماد على بطاقات الموظفين + شارة الميدان في القروبات
      t('staff cards carry approval status pill', d.querySelectorAll('#staffGrid .staff-st').length > 0,
        d.querySelectorAll('#staffGrid .staff-st').length + ' pills');
      try {
        const gl = JSON.parse(window.eval(`(function(){
          const bak=D.dep;
          D.dep=[{id:'t-fd1',empId:'HYU-TEST1',area:'Fire Team Day',list:'A',rot:'A',status:'Active'}];
          const inFire=apprInFireGroup('HYU-TEST1');
          const warn=apprBadge({i:'HYU-TEST1',s:'under_evaluation'},['failed','nogreen']);
          const ok=apprBadge({i:'HYU-TEST1',s:'green_helmet_approved'},['failed','nogreen']);
          D.dep=bak;
          return JSON.stringify({inFire:inFire,warn:warn.indexOf('appr-warn')>=0,ok:ok===''});
        })()`));
        t('field member without green helmet flagged', gl.inFire && gl.warn && gl.ok, JSON.stringify(gl));
      } catch (e) { bad.push('field badge eval: ' + e.message); }

      // deployment: no-location box (الموظفون بلا موقع عمل)
      const nlBox = d.getElementById('depNoLoc');
      t('deployment no-location box rendered', !!nlBox);
      t('no-location box hidden when nobody unassigned (offline: 0 employees)', !!nlBox && nlBox.classList.contains('hide'));
      try {
        const nlInfo = JSON.parse(window.eval(`(function(){
          const bakE=D.emp, bakD=D.dep;
          try {
            D.dep=[{id:'nl-1',empId:'KEEP-1',area:'SRU 1',list:'A',rot:'A',status:'Active'}];
            D.emp=[
              {id:'KEEP-1',num:'KEEP-1',ar:'',en:'DEPLOYED ONE',dept:'Safety Officer',phone:'',plate:'',grp:'',photo:''},
              {id:'LOOSE-1',num:'LOOSE-1',ar:'',en:'UNASSIGNED ONE',dept:'Safety Officer',phone:'',plate:'',grp:'',photo:''},
              {id:'LOOSE-2',num:'LOOSE-2',ar:'',en:'UNASSIGNED TWO',dept:'Rigger III',phone:'',plate:'',grp:'',photo:''}
            ];
            renderDep();
            const nl=document.getElementById('depNoLoc');
            return JSON.stringify({rows: nl?nl.querySelectorAll('tbody tr').length:-1});
          } finally { D.emp=bakE; D.dep=bakD; renderDep(); }
        })()`));
        t('no-location list = every employee missing a deployment row', nlInfo.rows === 2, nlInfo.rows + ' rows (expected 2)');
      } catch (e) { bad.push('no-location list: ' + e.message); }
      try {
        // معالجة زر «تعيين»: يملأ نموذج التوزيع ويرشد لاختيار المنطقة
        const sel = d.getElementById('depEmp');
        sel.innerHTML = '<option value="syn-1">Synthetic — SYN-1</option>';
        const abtn = d.createElement('button');
        abtn.setAttribute('data-assign', 'syn-1');
        d.getElementById('depBody').appendChild(abtn);
        abtn.click();
        t('assign button fills employee select', sel.value === 'syn-1', 'value=' + sel.value);
        const picks = [...html.matchAll(/dep_pickArea:'([^']+)'/g)].map(m => m[1]);
        t('assign shows area guidance toast', picks.includes(d.getElementById('toast').textContent),
          JSON.stringify(d.getElementById('toast').textContent));
        abtn.remove(); sel.innerHTML = '';
      } catch (e) { bad.push('assign handler threw: ' + e.message); }

      // ربط القروبات بالتوزيع — deployment هو مصدر الحقيقة
      try {
        const link = JSON.parse(window.eval(`(function(){
          const bakD=D.dep; const g0=grpData(); const victim=(g0.D&&g0.D[0]||[])[0];
          D.dep=[{id:'t-l1',empId:victim,area:'SRU 1',list:'A',rot:'A',status:'Active'}];
          const g1=grpData();
          const moved=!!victim&&!g1.D.some(r=>r[0]===victim)&&g1.A.some(r=>r[0]===victim);
          D.dep=[{id:'t-l2',empId:'NEW-999',area:'SRU 2',list:'B',rot:'daily_duty',status:'Active'}];
          const g2=grpData();
          const daily=g2.D.some(r=>r[0]==='NEW-999');
          D.dep=bakD;
          const g3=grpData();
          return JSON.stringify({moved:moved,daily:daily,restore:g3.D.length===g0.D.length&&g3.A.length===g0.A.length});
        })()`));
        t('groups follow deployment: person moved Daily→A', link.moved);
        t('groups follow deployment: daily_duty lands in Daily', link.daily);
        t('grpData leaves static lists unmutated', link.restore);
      } catch (e) { bad.push('group linkage eval: ' + e.message); }

      // ترجمة شاملة عند تبديل اللغة (خارج #appWrap أيضاً: القائمة السفلية + placeholders)
      try {
        const IW = window.eval('I18N');
        const navSp = d.querySelector('.bottom-nav .nav-item [data-i]');
        t('bottom-nav items carry data-i', !!navSp);
        d.getElementById('langBtn').click();
        t('lang switch translates bottom-nav (EN)', !!navSp && navSp.textContent === IW.en[navSp.getAttribute('data-i')],
          navSp ? navSp.textContent : 'no nav');
        t('lang switch translates placeholder (EN)', d.getElementById('globalSearch').placeholder === IW.en.gs_ph,
          d.getElementById('globalSearch').placeholder);
        d.getElementById('langBtn').click();
        t('lang switch back restores Arabic nav', !!navSp && navSp.textContent === IW.ar[navSp.getAttribute('data-i')]);
      } catch (e) { bad.push('i18n switch: ' + e.message); }

      // 8b) groups tab (A / B / Daily)
      try {
        t('groups data injected', !!window.GRP_DATA && (window.GRP_DATA.A || []).length === 69 && (window.GRP_DATA.B || []).length === 74 && (window.GRP_DATA.D || []).length === 34,
          window.__grpErr ? window.__grpErr : 'A=' + (window.GRP_DATA.A || []).length + ' B=' + (window.GRP_DATA.B || []).length + ' D=' + (window.GRP_DATA.D || []).length);
        t('groups tab exists', !!d.getElementById('tabGrp'));
        d.getElementById('tabGrp').click();
        t('groups view visible', !d.getElementById('viewGrp').classList.contains('hide'));
        t('groups header has 7 columns', d.querySelectorAll('#grpTable thead th').length === 7);
        t('groups stats rendered (8 cards incl. fire)', d.querySelectorAll('#grpStats .stat').length === 8,
          d.querySelectorAll('#grpStats .stat').length + ' cards');
        t('group A rows rendered', d.querySelectorAll('#grpBody tr').length === 69,
          d.querySelectorAll('#grpBody tr').length + ' rows');
        const fdSeg = [...d.querySelectorAll('#grpSeg .gseg')].find(b => b.dataset.g === 'FD');
        const fnSeg = [...d.querySelectorAll('#grpSeg .gseg')].find(b => b.dataset.g === 'FN');
        t('fire day/night segments exist', !!fdSeg && !!fnSeg);
        fdSeg && fdSeg.click();
        t('fire day group selected (offline 0 rows)', d.querySelectorAll('#grpBody tr').length === 0,
          'rows: ' + d.querySelectorAll('#grpBody tr').length);
        fnSeg && fnSeg.click();
        t('fire night group selected (offline 0 rows)', d.querySelectorAll('#grpBody tr').length === 0,
          'rows: ' + d.querySelectorAll('#grpBody tr').length);
        const allSeg = [...d.querySelectorAll('#grpSeg .gseg')].find(b => b.dataset.g === '');
        allSeg.click();
        t('all groups listed together', d.querySelectorAll('#grpBody tr').length === 177,
          d.querySelectorAll('#grpBody tr').length + ' rows');
        t('every row shows a match status', d.querySelectorAll('#grpBody tr td:last-child .tag').length === 177,
          d.querySelectorAll('#grpBody tr td:last-child .tag').length + ' status pills (no employee data offline → all flagged)');
        t('group pill in every row', d.querySelectorAll('#grpBody tr td:nth-child(2) .tag').length === 177);
        t('daily rows get the orange group pill', d.querySelectorAll('#grpBody tr td:nth-child(2) .t-wrn').length === 34,
          d.querySelectorAll('#grpBody tr td:nth-child(2) .t-wrn').length + ' Daily pills');
        try {
          const ngInfo = JSON.parse(window.eval(`(function(){
            const bakE=D.emp;
            try {
              D.emp=[
                {id:'NG-T1',num:'NG-T1',ar:'',en:'GHOST NG EMP',dept:'Rigger III',phone:'',plate:'',grp:'',photo:''},
                {id:'NG-T2',num:'NG-T2',ar:'',en:'SECOND GHOST EMP',dept:'Fireman',phone:'',plate:'',grp:'',photo:''}
              ];
              renderGrp();
              const seg=[...document.querySelectorAll('#grpSeg .gseg')].find(b=>b.dataset.g==='NG');
              if(!seg) return JSON.stringify({seg:false});
              seg.click();
              const rows=document.querySelectorAll('#grpBody tr').length;
              const cards=[...document.querySelectorAll('#grpStats .stat')];
              const v=(cards.length?cards[cards.length-1].querySelector('.v').textContent:'').trim();
              const cell=document.querySelector('#grpBody tr td:nth-child(3)');
              return JSON.stringify({seg:true,rows:rows,stat:v,nameOk:!!cell&&cell.textContent.indexOf('GHOST NG EMP')>=0});
            } finally { D.emp=bakE; renderGrp(); const allSeg=[...document.querySelectorAll('#grpSeg .gseg')].find(b=>b.dataset.g===''); if(allSeg) allSeg.click(); }
          })()`));
          t('no-group segment exists in the groups bar', ngInfo.seg === true, JSON.stringify(ngInfo));
          t('no-group list = every employee outside all groups', ngInfo.rows === 2, ngInfo.rows + ' rows (expected 2)');
          t('no-group stat card mirrors the list', ngInfo.stat === '2', 'stat=' + ngInfo.stat);
          t('no-group row shows the employee name', ngInfo.nameOk === true, JSON.stringify(ngInfo));
        } catch (e) { bad.push('no-group list: ' + e.message); }
        const inp = d.getElementById('grpSearch');
        inp.value = 'AALI KHALID';
        inp.dispatchEvent(new window.Event('input'));
        t('groups search filters', d.querySelectorAll('#grpBody tr').length === 1,
          d.querySelectorAll('#grpBody tr').length + ' rows for "AALI KHALID"');
        inp.value = ''; inp.dispatchEvent(new window.Event('input'));
        t('groups export wired', typeof d.getElementById('grpExportBtn').onclick === 'function');
        t('template export is attExport', typeof window.attExport === 'function' && typeof d.getElementById('grpExportBtn2').onclick === 'function');
        t('auto-date helper present', typeof window.attDateCell === 'function' && window.attDateCell('<c r="D9" s="8"/>', new Date(2026, 0, 2)).includes('DATE: 02/01/2026'));
        t('fire sheet names wired', typeof window.attSheetName === 'function' && window.attSheetName('FD') === 'TTENDANCE SHEET FIRE DAY' && window.attSheetName('FN') === 'TTENDANCE SHEET FIRE NIGHT',
          window.attSheetName('FD') + ' / ' + window.attSheetName('FN'));
        t('export degrades gracefully without JSZip', (() => {
          try { d.getElementById('grpExportBtn').click(); return !d.getElementById('grpExportBtn').disabled; }
          catch (e) { return false; }
        })());
        t('groups tab active', d.getElementById('tabGrp').classList.contains('active'));
        t('groups title translated', d.querySelector('[data-i="grp_title"]').textContent.includes('قروبات الدوام'),
          JSON.stringify(d.querySelector('[data-i="grp_title"]').textContent));
        d.getElementById('tabVio').click();
      } catch (e) { bad.push('groups tab threw: ' + e.message); }

      // 8) month change triggers re-render
      try {
        d.getElementById('monthPicker').value = '2026-08';
        d.getElementById('monthPicker').dispatchEvent(new window.Event('change'));
        t('month change re-render ok', true);
      } catch (e) { bad.push('month change threw: ' + e.message); }

      // أخطاء الشبكة المتوقعة من المحاكي لا تُعدّ عيوباً
      const expected = ['offline (test stub)', 'blocked by policy', 'boom-crash-test'];   // الثالث: العطل المتعمَّد في فحص «كشف الأعطال»
      const unexpected = errors.filter(e => !expected.some(p => e.includes(p)));

      console.log('\n=== PASSED (' + ok.length + ') ===');
      ok.forEach(x => console.log('  ✔ ' + x));
      if (bad.length) { console.log('\n=== FAILED (' + bad.length + ') ==='); bad.forEach(x => console.log('  ✘ ' + x)); }
      if (errors.length) {
        console.log('\n=== LOG (' + errors.length + ' expected stub/reject errors, ignored) ===');
      }
      if (unexpected.length) {
        console.log('\n=== UNEXPECTED ERRORS (' + unexpected.length + ') ===');
        unexpected.slice(0, 10).forEach(x => console.log('  ! ' + x.split('\n').slice(0, 4).join('\n    ')));
      }
      console.log('\nRESULT: ' + (bad.length === 0 && unexpected.length === 0 ? 'ALL GREEN' : 'ISSUES FOUND'));
      process.exit(bad.length === 0 && unexpected.length === 0 ? 0 : 1);
    }
  }, 600);
}, 800);

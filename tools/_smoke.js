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
        !!window.LVSEED && (window.LVSEED.roster || []).length === 101 && (window.LVSEED.leaves || []).length === 192,
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
      t('table: 9 columns + all 101 employees',
        d.querySelectorAll('#lvTable thead th').length === 9 && d.querySelectorAll('#lvBody tr').length === 101,
        d.querySelectorAll('#lvTable thead th').length + ' cols / ' + d.querySelectorAll('#lvBody tr').length + ' rows');
      t('status pills use house tag colors',
        d.querySelectorAll('#lvBody .tag').length === 101
        && [...d.querySelectorAll('#lvBody .tag')].every(p => p.classList.contains('t-per') || p.classList.contains('t-abs') || p.classList.contains('t-wrn')));
      t('dept filter: 7 trades + all', d.getElementById('lvDept').options.length === 8,
        d.getElementById('lvDept').options.length + ' options');
      t('status filter: all + 3 states', d.getElementById('lvStatus').options.length === 4);
      t('dept filter narrows rows', (() => {
        const sel = d.getElementById('lvDept');
        const pick = [...sel.options].find(o => o.value);
        sel.value = pick.value; sel.dispatchEvent(new window.Event('change'));
        const n = d.querySelectorAll('#lvBody tr').length;
        sel.value = ''; sel.dispatchEvent(new window.Event('change'));
        return n > 0 && n < 101;
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
        && !!d.getElementById('lvfEmp') && d.getElementById('lvfEmp').options.length > 100
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
      t('lvPdfBuild renders page (head + 4 KPIs + 101 rows + foot)', (() => {
        const el = window.lvPdfBuild(window.lvFilterRows());
        const ok = el.classList.contains('appr-pdf')
          && el.querySelectorAll('.appr-pdf-table tbody tr').length === 101
          && el.querySelectorAll('.appr-pdf-kpi .stat').length === 4
          && !!el.querySelector('.appr-pdf-head') && !!el.querySelector('.appr-pdf-foot');
        el.remove();
        return ok;
      })());
      // مزامنة التخزين بين النوافذ (overlay يغلب البذرة ثم يعود)
      t('storage overlay sync (apply + restore seed)', (() => {
        const n0 = window.eval('LV.leaves.length');
        window.localStorage.setItem('hse-leaves-v1',
          JSON.stringify({ roster: window.eval('LV.roster'), leaves: [], defEnt: 21 }));
        window.dispatchEvent(Object.assign(new window.Event('storage'), { key: 'hse-leaves-v1' }));
        const cleared = window.eval('LV.leaves.length') === 0;
        window.localStorage.removeItem('hse-leaves-v1');
        window.dispatchEvent(Object.assign(new window.Event('storage'), { key: 'hse-leaves-v1' }));
        return cleared && window.eval('LV.leaves.length') === n0;
      })());
      d.getElementById('tabVio').click();
    } catch (e) { bad.push('annual leave threw: ' + e.message); }

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
          finish();
        }, 300);
      }, 250);
    } catch (e) { bad.push('password hashing threw: ' + e.message); finish(); }

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
        t('groups data injected', !!window.GRP_DATA && (window.GRP_DATA.A || []).length === 71 && (window.GRP_DATA.B || []).length === 74 && (window.GRP_DATA.D || []).length === 54,
          window.__grpErr ? window.__grpErr : 'A=71 B=74 D=54');
        t('groups tab exists', !!d.getElementById('tabGrp'));
        d.getElementById('tabGrp').click();
        t('groups view visible', !d.getElementById('viewGrp').classList.contains('hide'));
        t('groups header has 7 columns', d.querySelectorAll('#grpTable thead th').length === 7);
        t('groups stats rendered (8 cards incl. fire)', d.querySelectorAll('#grpStats .stat').length === 8,
          d.querySelectorAll('#grpStats .stat').length + ' cards');
        t('group A rows rendered', d.querySelectorAll('#grpBody tr').length === 71,
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
        t('all groups listed together', d.querySelectorAll('#grpBody tr').length === 199,
          d.querySelectorAll('#grpBody tr').length + ' rows');
        t('every row shows a match status', d.querySelectorAll('#grpBody tr td:last-child .tag').length === 199,
          d.querySelectorAll('#grpBody tr td:last-child .tag').length + ' status pills (no employee data offline → all flagged)');
        t('group pill in every row', d.querySelectorAll('#grpBody tr td:nth-child(2) .tag').length === 199);
        t('daily rows get the orange group pill', d.querySelectorAll('#grpBody tr td:nth-child(2) .t-wrn').length === 54,
          d.querySelectorAll('#grpBody tr td:nth-child(2) .t-wrn').length + ' Daily pills');
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
      const expected = 'offline (test stub)';
      const unexpected = errors.filter(e => !e.includes(expected));

      console.log('\n=== PASSED (' + ok.length + ') ===');
      ok.forEach(x => console.log('  ✔ ' + x));
      if (bad.length) { console.log('\n=== FAILED (' + bad.length + ') ==='); bad.forEach(x => console.log('  ✘ ' + x)); }
      if (errors.length) {
        console.log('\n=== LOG (' + errors.length + ' expected offline-stub errors, ignored) ===');
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

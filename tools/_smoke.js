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

  // 3) login flow with the seeded default admin
  d.getElementById('lgUser').value = 'علي';
  d.getElementById('lgPass').value = 'علي123';
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
      const h = window.hashPass('علي123');
      t('hashPass produces salted hash', typeof h === 'string' && h.startsWith('h$') && /^[0-9a-f]{64}$/.test(h.slice(h.lastIndexOf('$') + 1)), h.slice(0, 24) + '…');
      t('hashPass is one-way (≠ plaintext)', h !== 'علي123');
      t('hashPass deterministic', window.hashPass('علي123') === h);
      t('hashPass differs per password', window.hashPass('password1') !== h);
      t('passMatch accepts hashed form', window.passMatch({ pass: h }, 'علي123') === true);
      t('passMatch rejects wrong password', window.passMatch({ pass: h }, 'wrong') === false);
      t('passMatch still accepts legacy plaintext', window.passMatch({ pass: 'legacy' }, 'legacy') === true);
      t('migration button exists', !!d.getElementById('migBtn'));

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
        finish();
      }, 250);
    } catch (e) { bad.push('password hashing threw: ' + e.message); finish(); }

    function finish() {
      // 7) switch tabs (this exercises renderVeh / renderDep / renderTs / renderStaff)
      ['tabVeh', 'tabAppr', 'tabDep', 'tabEmp', 'tabTs', 'tabVio'].forEach(id => {
        try { d.getElementById(id).click(); } catch (e) { bad.push('tab ' + id + ' click threw: ' + e.message); }
      });
      t('viewVio active at end', !d.getElementById('viewVio').classList.contains('hide'));

      // 8b) groups tab (A / B / Daily)
      try {
        t('groups data injected', !!window.GRP_DATA && (window.GRP_DATA.A || []).length === 71 && (window.GRP_DATA.B || []).length === 74 && (window.GRP_DATA.D || []).length === 54,
          window.__grpErr ? window.__grpErr : 'A=71 B=74 D=54');
        t('groups tab exists', !!d.getElementById('tabGrp'));
        d.getElementById('tabGrp').click();
        t('groups view visible', !d.getElementById('viewGrp').classList.contains('hide'));
        t('groups header has 7 columns', d.querySelectorAll('#grpTable thead th').length === 7);
        t('groups stats rendered (6 cards)', d.querySelectorAll('#grpStats .stat').length === 6,
          d.querySelectorAll('#grpStats .stat').length + ' cards');
        t('group A rows rendered', d.querySelectorAll('#grpBody tr').length === 71,
          d.querySelectorAll('#grpBody tr').length + ' rows');
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

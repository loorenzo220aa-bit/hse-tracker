/* End-to-end test of the attendance-template fill:
   extract the ATT_* functions from index.html, fill the real template,
   then verify values, styles, merges, print area and embedded assets. */
const fs = require('fs');
const path = require('path');
const ExcelJS = require(process.env.TEMP + '\\hse-xlsx\\node_modules\\exceljs');
const JSZip = require(process.env.TEMP + '\\hse-xlsx\\node_modules\\jszip');

const html = fs.readFileSync(process.argv[2], 'utf8');
const SRC = html.slice(html.indexOf('/* ==== ATTENDANCE TEMPLATE EXPORT'), html.indexOf('/* ==== END ATTENDANCE ==== */'));
const groupsSrc = fs.readFileSync(process.argv[3], 'utf8');
const GMARK = 'window.GRP_DATA = ';
const GRP = JSON.parse(groupsSrc.slice(groupsSrc.indexOf(GMARK) + GMARK.length).trim().replace(/;\s*$/, ''));
const TEMPLATE = process.argv[4];
const OUT = process.env.TEMP;

let pass = 0; const fail = [];
const t = (name, cond, extra) => { cond ? pass++ : fail.push(name + (extra ? ' — ' + extra : '')); };

(async () => {
  eval(SRC + '\nglobalThis.__ATT={ATT_SHEET_B, ATT_FIRST_ROW, ATT_NUMBERED_UNTIL};');
  const { ATT_SHEET_B, ATT_FIRST_ROW } = globalThis.__ATT;
  const FIX_DATE = new Date(2026, 8, 22); // 22/09/2026 — fixed so the assertion is stable

  // --- unit: date cell formatting (single-digit day/month must be padded) ---
  const dc = attDateCell('<c r="D9" s="8"/>', new Date(2027, 0, 5));
  t('date format DD/MM/YYYY with padding', dc.indexOf('DATE: 05/01/2027') > -1, dc);
  t('date cell keeps style index', /\bs="8"/.test(dc), dc);

  // --- unit: attSetCell fallback inserts a missing cell in column order ---
  const fake = '<row r="9"><c r="A9" s="1"/><c r="C9" s="2"/></row>';
  const filled = attSetCell(fake, 'B9', 'inlineStr', '<is><t>X</t></is>');
  t('missing cell inserted in column order', filled.indexOf('r="B9"') > filled.indexOf('r="A9"') && filled.indexOf('r="B9"') < filled.indexOf('r="C9"'), filled);
  t('existing cell style preserved', attSetCell('<c r="E12" s="21"/>', 'E12', 'inlineStr', '<is><t>N</t></is>') === '<c r="E12" s="21" t="inlineStr"><is><t>N</t></is></c>');
  t('xml escaping', attXmlEsc('a & b <c> \' " ') === 'a &amp; b &lt;c&gt; &apos; &quot; ');

  const origZip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE));
  const origEntries = Object.keys(origZip.files).sort();
  const origSheet = await origZip.file('xl/worksheets/sheet1.xml').async('string');

  async function build(grp) {
    const names = GRP[grp].map(r => r[1]);
    const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE));
    const sheetPath = Object.keys(zip.files).find(p => /^xl\/worksheets\/sheet\d+\.xml$/.test(p));
    let sheetXml = await zip.file(sheetPath).async('string');
    sheetXml = attFillSheet(sheetXml, names);
    sheetXml = attDateCell(sheetXml, FIX_DATE);
    zip.file(sheetPath, sheetXml);
    const last = ATT_FIRST_ROW + names.length - 1;
    zip.file('xl/workbook.xml', attWorkbook(await zip.file('xl/workbook.xml').async('string'), grp, last));
    let app = await zip.file('docProps/app.xml').async('string');
    zip.file('docProps/app.xml', app.split(ATT_SHEET_B).join(attSheetName(grp)));
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const file = path.join(OUT, 'att-test-' + grp + '.xlsx');
    fs.writeFileSync(file, buf);
    return { file, names, last, zip };
  }

  const b = await build('B');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(b.file);
  const ws = wb.worksheets[0];
  const dirs = k => Object.keys(k.files).filter(p => !p.endsWith('/')).sort();
  const od = dirs(origZip), nd = dirs(b.zip);
  t('zip entry set identical', JSON.stringify(nd) === JSON.stringify(od), 'orig=' + od.length + ' out=' + nd.length);
  t('sheet name kept for B', ws.name === 'TTENDANCE SHEET GROUP B', ws.name);
  t('first name written', ws.getCell('E12').value === b.names[0], JSON.stringify(ws.getCell('E12').value));
  t('last name written (row 85)', ws.getCell('E8' + 5).value === b.names[73], JSON.stringify(ws.getCell('E85').value));
  t('all 74 names written', b.names.every((n, i) => ws.getCell('E' + (12 + i)).value === n));
  t('header row untouched', ws.getCell('E11').value === 'NAME OF EMPLOYEE');
  t('serials 1..50 untouched', [1, 25, 50].every((v, k) => ws.getCell('D' + (12 + [0, 24, 49][k])).value === v));
  t('serials continue past row 61', ws.getCell('D62').value === 51 && ws.getCell('D85').value === 74, 'D62=' + ws.getCell('D62').value + ' D85=' + ws.getCell('D85').value);
  t('merges count unchanged', (ws.model.merges || []).length === 411, (ws.model.merges || []).length);
  const e12 = ws.getCell('E12');
  t('name cell keeps template style (Arial 11 + border)',
    e12.style.font && e12.style.font.name === 'Arial' && e12.style.font.size === 11 && !!e12.style.border,
    JSON.stringify(e12.style.font) + ' border=' + !!e12.style.border);
  const d61 = ws.getCell('D61');
  t('yellow highlight row preserved', d61.style.fill && String(d61.style.fill.fgColor.argb).toUpperCase() === 'FFFFFF00',
    JSON.stringify(d61.style.fill && d61.style.fill.fgColor));
  t('row heights preserved', ws.getRow(12).height === 18 && ws.getRow(62).height === 15,
    'r12=' + ws.getRow(12).height + ' r62=' + ws.getRow(62).height);
  t('date cell auto-updated to today', ws.getCell('D9').value === 'DATE: 22/09/2026', JSON.stringify(ws.getCell('D9').value));
  t('date cell keeps its style',
    ws.getCell('D9').style.font && ws.getCell('D9').style.font.name === 'Bookman Old Style' && ws.getCell('D9').style.font.bold === true,
    JSON.stringify(ws.getCell('D9').style.font));
  t('time/company cells untouched', ws.getCell('D10').value === 'COMPANY: HYUNDAI' && ws.getCell('H9').value === 'TIME: 03:00');
  t('topic cell untouched', ws.getCell('D8').value === 'TOPIC: ');

  // workbook.xml checks (print area + defined names)
  const wbXml = await b.zip.file('xl/workbook.xml').async('string');
  t('Print_Area extended to row 85', wbXml.includes('$D$1:$N$85'), (wbXml.match(/\$D\$1:\$N\$\d+/) || [])[0]);
  t('autofilter range left untouched', wbXml.includes('$D$11:$N$61'));
  t('defined names still point at the sheet name', wbXml.includes("'TTENDANCE SHEET GROUP B'!$D$1:$N$85"));

  // embedded assets must survive byte-for-byte
  const outZip = await JSZip.loadAsync(fs.readFileSync(b.file));
  for (const p of ['xl/media/image1.emf', 'xl/embeddings/Microsoft_Word_Document.docx', 'xl/printerSettings/printerSettings1.bin']) {
    const a = await origZip.file(p).async('nodebuffer');
    const c = await outZip.file(p).async('nodebuffer');
    t('asset intact: ' + path.basename(p), a.equals(c), a.length + ' vs ' + c.length);
  }
  t('sheet xml changed (names added)', (await outZip.file('xl/worksheets/sheet1.xml').async('string')) !== origSheet);

  // --- group A: sheet renamed everywhere ---
  const a = await build('A');
  const wbA = new ExcelJS.Workbook(); await wbA.xlsx.readFile(a.file);
  t('sheet renamed for group A', wbA.worksheets[0].name === 'TTENDANCE SHEET GROUP A', wbA.worksheets[0].name);
  const wbXmlA = await a.zip.file('xl/workbook.xml').async('string');
  t('defined names renamed for group A', wbXmlA.includes("'TTENDANCE SHEET GROUP A'!$D$1:$N$82") && !wbXmlA.includes('GROUP B'));
  const appXmlA = await a.zip.file('docProps/app.xml').async('string');
  t('docProps renamed for group A', appXmlA.includes('TTENDANCE SHEET GROUP A') && !appXmlA.includes('GROUP B'));
  const wbD = await build('D');
  const wbXmlD = await wbD.zip.file('xl/workbook.xml').async('string');
  t('daily sheet renamed', wbXmlD.includes('name="TTENDANCE SHEET DAILY"'), (wbXmlD.match(/<sheet name="[^"]+"/) || [])[0]);
  t('daily print area row 65', wbXmlD.includes('$D$1:$N$65'));

  console.log('ATTENDANCE TEST — passed: ' + pass + (fail.length ? ' | FAILED ' + fail.length : ' | ALL GREEN'));
  fail.forEach(f => console.log('  ✘ ' + f));
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('THREW:', e); process.exit(1); });

// Produce three sample attendance files (A / B / Daily) for visual review
const fs = require('fs');
const path = require('path');
const JSZip = require(process.env.TEMP + '\\hse-xlsx\\node_modules\\jszip');
const html = fs.readFileSync(process.argv[2], 'utf8');
const SRC = html.slice(html.indexOf('/* ==== ATTENDANCE TEMPLATE EXPORT'), html.indexOf('/* ==== END ATTENDANCE ==== */'));
const gs = fs.readFileSync(process.argv[3], 'utf8');
const GM = 'window.GRP_DATA = ';
const GRP = JSON.parse(gs.slice(gs.indexOf(GM) + GM.length).trim().replace(/;\s*$/, ''));
const TPL = process.argv[4];
const OUTDIR = process.argv[5];

(async () => {
  eval(SRC + '\nglobalThis.__A={ATT_SHEET_B,ATT_FIRST_ROW};');
  for (const g of ['A', 'B', 'D']) {
    const names = GRP[g].map(r => r[1]);
    const zip = await JSZip.loadAsync(fs.readFileSync(TPL));
    const sp = Object.keys(zip.files).find(p => /^xl\/worksheets\/sheet\d+\.xml$/.test(p));
    zip.file(sp, attDateCell(attFillSheet(await zip.file(sp).async('string'), names)));
    zip.file('xl/workbook.xml', attWorkbook(await zip.file('xl/workbook.xml').async('string'), g, globalThis.__A.ATT_FIRST_ROW + names.length - 1));
    let app = await zip.file('docProps/app.xml').async('string');
    zip.file('docProps/app.xml', app.split(globalThis.__A.ATT_SHEET_B).join(attSheetName(g)));
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const label = g === 'D' ? 'Daily' : 'Group ' + g;
    const out = path.join(OUTDIR, 'Attendance list for ' + label + '.xlsx');
    fs.writeFileSync(out, buf);
    console.log('wrote', path.basename(out), buf.length, 'bytes,', names.length, 'names');
  }
})().catch(e => { console.error(e); process.exit(1); });

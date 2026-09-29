/* lv-template.js — بناء قالب تصدير الإجازات السنوية Leaves_Template.xlsx
   ------------------------------------------------------------
   الاستخدام:  node tools/lv-template.js [المسار_النهائي]
   المخرج: ورقة واحدة (ANNUAL LEAVE) — 11 عموداً A..K، ترويسة منسّقة في الصف 1،
   صف نموذج في الصف 2 (التصدير يكتب من صف 2 وينسخ تنسيقه لما زاد)،
   فلتر A1:K2، تجميد الصف الأول، اتجاه RTL، منطقة طباعة A1:K2 (التصدير يمدّدها).
   الملف لا يحوي أي بيانات شخصية — عناوين ونموذج فقط. */
const fs = require('fs');
const path = require('path');
const ExcelJS = require(path.join(process.env.TEMP, 'hse-xlsx', 'node_modules', 'exceljs'));

const OUT = process.argv[2] || path.join(__dirname, '..', 'Leaves_Template.xlsx');

const HEAD = ['#', 'اسم الموظف', 'الرقم الوظيفي', 'القسم / التخصص', 'الاستحقاق السنوي',
  'المستهلك', 'المتبقي', 'الإجازة القادمة', 'المدة (يوم)', 'الحالة', 'ملاحظات'];
const SAMPLE = [1, 'SAMPLE NAME (نموذج)', 'SASL-0000', 'SAFETY OFFICER', 21, 7, 14,
  '2026-12-01', 19, 'مجدولة', 'آخر إجازة: 2026-06-01 (5 أيام)'];
const WIDTHS = [5, 34, 15, 22, 15, 12, 12, 16, 13, 14, 38];

(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ANNUAL LEAVE', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: 'A1:K2' }
  });
  ws.autoFilter = 'A1:K2';
  ws.properties.defaultRowHeight = 18;
  WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const border = { top: { style: 'thin', color: { argb: 'FF94A3B8' } },
    left: { style: 'thin', color: { argb: 'FF94A3B8' } },
    bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
    right: { style: 'thin', color: { argb: 'FF94A3B8' } } };

  /* صف 1: الترويسة */
  const hRow = ws.addRow(HEAD);
  hRow.height = 24;
  hRow.eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } };
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Calibri' };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = border;
  });

  /* صف 2: نموذج (يُستبدل بأول صف بيانات، وتنسخ صيغته للصفوف التالية) */
  const sRow = ws.addRow(SAMPLE);
  sRow.height = 20;
  sRow.eachCell((c, col) => {
    c.alignment = { vertical: 'middle', horizontal: col === 2 || col === 4 || col === 11 ? 'right' : 'center' };
    c.border = border;
    c.font = { size: 10, name: 'Calibri' };
    if ([5, 6, 7, 9].includes(col)) c.numFmt = '0';
  });

  await wb.xlsx.writeFile(OUT);
  const size = fs.statSync(OUT).size;
  console.log('template written:', OUT, size, 'bytes');
  console.log('headers:', HEAD.length, 'cols A..' + String.fromCharCode(64 + HEAD.length), '| sheet: ANNUAL LEAVE | RTL + frozen + autofilter A1:K2');
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });

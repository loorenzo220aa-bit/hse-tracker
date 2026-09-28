/* ============================================================
   بناء قالب تصدير اعتمادات أرامكو من ملف الكتاب الأصلي
   ------------------------------------------------------------
   الاستخدام:  node tools/appr-template.js "C:\path\Book2.xlsx" "Aramco_Template.xlsx"
   المخرج: نسخة «نظيفة» من الملف بنفس التنسيق 100% (عرض الأعمدة،
   أنماط الخلايا، إعدادات الطباعة، الدمج، ثيم) لكن:
     • تُمسح قيم الصفوف 3+ (بما فيها الأرقام الشخصية: آقامة/جواز)
     • تُفرَّغ السلاسل المشتركة غير المستخدمة في الصفوف 1-2
     • يُحذف calcChain (لم نعد نكتب معادلات) وتُفرَّغ نصوص التعليقات
     • تُضبط مناطق الطباعة/الفلتر على الصفوف 2..2 (التصدير يوسّعها)
   الملف الأصلي لا يُرفع إلى المستودع أبداً — القالب فقط.
   ============================================================ */
const fs = require('fs');
const J = require(process.env.TEMP + '\\hse-xlsx\\node_modules\\jszip');

const src = process.argv[2], out = process.argv[3];
if (!src || !out) { console.error('Usage: node tools/appr-template.js <src.xlsx> <out.xlsx>'); process.exit(2); }

(async () => {
  const zip = await J.loadAsync(fs.readFileSync(src));

  /* 1) ورقة العمل: مسح قيم الصفوف ≥3 مع الإبقاء على <c> وأنماطها (s=) */
  let sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  let clearedRows = 0, clearedCells = 0;
  sheet = sheet.replace(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (rowXml, rn) => {
    if (Number(rn) < 3) return rowXml;
    clearedRows++;
    const out2 = rowXml.replace(/(<c\b[^>]*?)(?:\s*\/>|>[\s\S]*?<\/c>)/g, (cXml, open) => {
      if (/>[\s\S]*?<\/c>/.test(cXml)) clearedCells++;
      const stripped = open.replace(/\s+t="[^"]*"/, '');
      return stripped + '/>';
    });
    return out2;
  });
  /* نطاق الفلتر داخل الورقة (إن وجد) */
  sheet = sheet.replace(/ref="A2:IY\d+"/g, 'ref="A2:AJ2"');
  zip.file('xl/worksheets/sheet1.xml', sheet); /* حفظ (!) — بدونه تبقى الورقة الأصلية */

  /* 2) السلاسل المشتركة: نُبقي فقط ما يستعمله الصف 1-2 (الرؤوس)، ونفرّغ الباقي */
  const used = new Set();
  (sheet.match(/<c\b[^>]*\br="[A-Z]+[12]"[^>]*t="s"[^>]*>\s*<v>(\d+)<\/v>/g) || []).forEach(m => {
    const v = m.match(/<v>(\d+)<\/v>/); if (v) used.add(Number(v[1]));
  });
  let sst = await zip.file('xl/sharedStrings.xml').async('string');
  let siIdx = -1, blanked = 0;
  sst = sst.replace(/<si>[\s\S]*?<\/si>/g, m => { siIdx++; return used.has(siIdx) ? m : (blanked++, '<si><t></t></si>'); });
  zip.file('xl/sharedStrings.xml', sst);

  /* 3) التعليقات: تفريغ النصوص (التعليقات على صفوف بيانات) */
  const cf = zip.file('xl/comments1.xml');
  if (cf) { let c = await cf.async('string'); c = c.replace(/<text>[\s\S]*?<\/text>/g, '<text></text>'); zip.file('xl/comments1.xml', c); }

  /* 4) calcChain: يُحذف (لا معادلات بعد الآن) — من المحتوى ومن العلاقات */
  zip.remove('xl/calcChain.xml');
  let ct = await zip.file('[Content_Types].xml').async('string');
  ct = ct.replace(/<Override[^>]*calcChain[^>]*\/>/g, '');
  zip.file('[Content_Types].xml', ct);
  let rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  rels = rels.replace(/<Relationship[^>]*calcChain[^>]*\/>/g, '');
  zip.file('xl/_rels/workbook.xml.rels', rels);

  /* 5) workbook: مناطق الطباعة والفلتر ← الصف2 (التصدير يمدّدها لآخر صف بيانات) */
  const wbPath = 'xl/workbook.xml';
  let wb = await zip.file(wbPath).async('string');
  wb = wb.replace(/'TR STATUS 2026 \(2\)'!\$A\$2:\$[A-Z]+\$\d+/g, "'TR STATUS 2026 (2)'!$A$2:$AJ$2");
  zip.file(wbPath, wb);

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(out, buf);
  console.log('template written:', out, buf.length, 'bytes');
  console.log('rows cleared:', clearedRows, '| cells cleared:', clearedCells, '| shared strings blanked:', blanked, '| header strings kept:', used.size);
})().catch(e => { console.error('ERR', e.stack); process.exit(1); });

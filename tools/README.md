# أدوات الصيانة — HSE Tracker

كل أدوات الفحص والاستيراد المستخدمة في هذا المشروع محفوظة هنا حتى لا تضيع مع أي حذف على الجهاز.
الموقع نفسه لا يعتمد عليها (تعمل من Node)، وهي فقط لمن يعيد الصيانة لاحقاً.

## الاختبارات (شغّلها بعد أي تعديل على `index.html`)

| الأمر | الوظيفة |
|---|---|
| `node tools/_check.js index.html` | يتحقق من مطابقة كل `getElementById` لعناصر HTML، وتوازن مفاتيح الترجمة (عربي/إنجليزي)، وخلو التكرار |
| `node tools/_smoke.js index.html` | اختبار وظيفي كامل بـ jsdom (تسجيل دخول، تبويبات، تصدير، قروبات…) |
| `node tools/_sha-test.js index.html` | تحقق من تجزئة كلمات المرور (SHA-256 + salt) |
| `node tools/_att-test.js index.html groups-data.js Attendance_Template.xlsx` | اختبار تصدير نموذج الحضور (33 فحصاً: التنسيق والصور المدمجة ومنطقة الطباعة) |

> لتشغيل `_smoke.js` و `_att-test.js` يحتاج jszip/exceljs —
> ثبّتها مؤقتاً: `npm install jszip exceljs --prefix %TEMP%\hse-xlsx`

## الاستيراد / إعادة البناء

- `tools/sources/` = النسخ الأصلية من ملفات استيراد بورتال هيونداي (A / B / Daily).
  منها أُعيد بناء `groups-data.js` عبر:
  `node tools/_parse-groups.js` ← `node tools/_build-groups.js` ← `node tools/_analyze-groups.js`
- `tools/_migrate-users.js` = أداة مرّة واحدة لتحويل كلمات المرور المخزّنة إلى صيغة مُجزّأة (نُفّذت سابقاً).
- `tools/_serve.js` = خادم محصّل لمعاينة الموقع على `localhost`.
- `tools/_status-preview.html` = معاينة قبل/بعد لشكل شارة الحالة في تبويب الاعتمادات.
- `tools/_att-samples.js` = يولّد3 ملفات حضور نموذجية (A/B/Daily) للمعاينة.

## القالب الرسمي

`Attendance_Template.xlsx` في جذر المشروع = نموذج الحضور الأصلي **بểmحته100%**
(الشعار، المستند المدمج، التنسيق، إعدادات الطباعة). التصدير يعدّل خلايا داخله فقط —
لا تُعِد كتابته بأداة تحرير جداول لأن ذلك يمسح الصور المدمجة.

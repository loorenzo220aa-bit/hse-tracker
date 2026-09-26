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
- `tools/_serve.js` = خادم محصّل لمعاينة الموقع على `localhost` (شغّله: `node tools/_serve.js . 8777`).
- `tools/_status-preview.html` = معاينة قبل/بعد لشكل شارة الحالة في تبويب الاعتمادات.
- `tools/_att-samples.js` = يولّد3 ملفات حضور نموذجية (A/B/Daily) للمعاينة.

## القالب الرسمي

`Attendance_Template.xlsx` في جذر المشروع = نموذج الحضور الأصلي **بểmحته100%**
(الشعار، المستند المدمج، التنسيق، إعدادات الطباعة). التصدير يعدّل خلايا داخله فقط —
لا تُعِد كتابته بأداة تحرير جداول لأن ذلك يمسح الصور المدمجة.

## تطبيق الجوال

**1) PWA (يعمل من المتصفح — ثبّته من كروم)**
- الملفات: `manifest.webmanifest` + `sw.js` + أيقونات `icon-*.png` / `favicon.svg` في جذر المشروع.
- التثبيت على أندرويد: كروم ← ⋮ ← «تثبيت التطبيق» (أو «إضافة إلى الشاشة الرئيسية»).
- `sw.js`: واجهة الموقع تُخزَّن للعمل بدون نت — بيانات Supabase تبقى مباشرة ولا تُخزَّن أبداً.
- فحص: `node tools/_pwa-check.js .` · إعادة توليد الأيقونات: `node tools/_gen-icons.js .`

**2) APK حقيقي (Capacitor 7) — المتطلبات**
- **JDK 21** (إجباري — قالب Capacitor 7 يترجم بـ`source release:21`):
  نسخة محمولة zip مثل `https://corretto.aws/downloads/latest/amazon-corretto-21-x64-windows-jdk.zip`
  أو `https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip`
- Android SDK: `cmdline-tools` + `platform-tools` + `platforms;android-35` + `build-tools;35.0.0`
- Gradle 8.11.1 يُنزَّل تلقائياً مع أول بناء (لا يثبَّت يدوياً).

```powershell
# 1) متغيرات البيئة (كل جلسة بناء)
$env:JAVA_HOME    = 'C:\path\to\jdk-21'          # يحتوي bin\java.exe (Capacitor 7 يتطلب 21)
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:PATH         = "$env:JAVA_HOME\bin;$env:PATH"

# 2) مرة واحدة: المنصة + الأصول
npm install
npx cap add android                        # إذا لم تكن موجودة
npx @capacitor/assets generate --android   # أيقونات/سبلاش من assets/

# 3) توقيع الإصدار (مرة واحدة فقط)
#    يُنتج %USERPROFILE%\.android-keys\hse-tracker.jks
#    + android\keystore.properties  (مُستبعد من git)

# 4) البناء
cd android; .\gradlew.bat assembleRelease
# الناتج: android\app\build\outputs\apk\release\app-release.apk
```

- **ممنوع رفع** `*.jks` و `keystore.properties` للريبو (في `.gitignore`) —
  إن ضاع المفتاح يتعذّر تحديث التطبيق بنفس التوقيع، فاحتفظ بنسخة احتياطية آمنة.
- مصادر الأيقونات/السبلاش: `node tools/_gen-android-assets.js .`
- رقم الإصدار: `android/app/build.gradle` ← `versionCode` / `versionName`.
- التطبيق يحمّل الموقع المباشر (`server.url` في `capacitor.config.json`)،
  يعني **كل تحديث للموقع يظهر في التطبيق فوراً** دون إعادة بناء APK.

## تصميم التطبيق (App Skin) — مادي فاتح عصري

التطبيق داخل أندرويد يظهر بتصميم مختلف عن الموقع (Material 3 فاتح):
شريط تبويبات **سفلي** ثابت، شريط علوي لاصق مضغوط، بطاقات بيضاء بحواف مستديرة،
أزرار وشرائح على شكل حاوٍ (Pills)، حقول بحدود ناعمة — والموقع في المتصفح **لا يتأثر إطلاقاً**.

- **كيف يعمل:** سطر واحد في `<head>` يضع علامة `data-app="1"` على `<html>` داخل
  Capacitor (عبر `window.Capacitor.isNativePlatform()`) أو من `localStorage`.
  كل قواعد التصميم مسبوقة بـ `html[data-app="1"]` في آخر `<style>` — خارج التطبيق لا تُطبَّق.
- **معاينة في المتصفح:** افتح `index.html?app=1` (أو عبر `_serve.js`:
  `http://127.0.0.1:8777/?app=1`) لرؤية شكل التطبيق دون جهاز أندرويد.
- **الوضع الليلي:** داخل التطبيق يبدأ بالوضع الفاتح افتراضياً (بغضّ النظر عن إعدادات
  النظام) ما لم يختر المستخدم الوضع الليلي صراحة من زر 🌙 — وتنسيق الليل للتصميم جاهز.
- **تحديثات مستقبلية:** أي تغيير ضمن هذا النطاق يصل للتطبيق فور نشر الموقع،
  لأن APK يحمّل الموقع المباشر.

## إصلاحات تسجيل الدخول (v1.1)

1. **رسائل خطأ محددة** بدل «خطأ» العامة:
   «اسم المستخدم غير موجود» / «كلمة المرور غير صحيحة…» / «تعذّر الوصول للخادم…» —
   تُميّز فوراً بين غلط كلمة المرور وانقطاع النت (عربي + إنجليزي).
2. **توحيد كتابة النص** (`normCred`): الأرقام العربية `١٢٣` ← `123` ودمج NFC قبل
   التجزئة — يمنع رفض كلمة صحيحة كُتبت بلوحة مفاتيح عربية (لا يغيّر كلمات لاتينية).
   و`passMatch` يجرّب الصيغتين (المُوحَّدة والخام) لتوافق كل التجزئات القديمة والجديدة.
3. **زر 👁** لإظهار/إخفاء كلمة المرور في نافذة الدخول — يرى المستخدم ما يكتبه فعلاً.
4. **منع التعبئة التلقائية في التطبيق**: `android:importantForAutofill="no"`
   (يمنع حقن كلمة مرور محفوظة قديمة في حقل الدخول داخل الـ WebView).
5. **`cache:'no-store'`** لطلبات GET إلى Supabase — لا ردّ قديم من ذاكرة المتصفح.

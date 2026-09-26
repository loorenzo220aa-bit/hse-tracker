/* HSE Tracker — Service Worker (offline shell + fast repeat loads)
   - التنقّل: الشبكة أولاً، ومع انقطاع النت يرجع آخر نسخة مخزّنة
   - باقي الملفات (JS/CSS/قوالب Excel): الذاكرة أولاً + تحديث بالخلفية
   - Supabase: لا يُخزَّن أبداً (بيانات وجلسة مباشرة)                       */
const CACHE = 'hse-tracker-v2';
const PRE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'groups-data.js',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'favicon.svg',
  'favicon-32.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(PRE.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const rq = e.request;
  if (rq.method !== 'GET') return;
  let u;
  try { u = new URL(rq.url); } catch (_) { return; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
  // بيانات سحابية مباشرة — تمرير بدون تخزين
  if (u.hostname.endsWith('.supabase.co')) return;

  // تصفّح الصفحات: network-first مع رجوع للنسخة المخزّنة عند غياب النت
  if (rq.mode === 'navigate') {
    e.respondWith(
      fetch(rq)
        .then(r => {
          const c1 = r.clone(), c2 = r.clone();
          caches.open(CACHE).then(k => { k.put(rq, c1); k.put('index.html', c2); });
          return r;
        })
        .catch(() => caches.match(rq).then(m => m || caches.match('index.html')))
    );
    return;
  }

  // بقية الأصول: cache-first + revalidate بالخلفية (stale-while-revalidate)
  e.respondWith(
    caches.match(rq).then(cached => {
      if (cached) {
        fetch(rq).then(r => {
          if (r && r.status === 200) caches.open(CACHE).then(k => k.put(rq, r.clone()));
        }).catch(() => {});
        return cached;
      }
      return fetch(rq).then(r => {
        if (r && r.status === 200 && (r.type === 'basic' || r.type === 'cors' || r.type === 'opaque')) {
          const c = r.clone();
          caches.open(CACHE).then(k => k.put(rq, c)).catch(() => {});
        }
        return r;
      }).catch(err => { throw err; });
    })
  );
});

/* หมอมู AI — Service Worker
 * กฎเหล็ก (บทเรียนจาก RUDY): bypass API ภายนอกที่ "บรรทัดแรก" ของ fetch handler
 * ก่อนเช็คอย่างอื่นทั้งหมด — กันบั๊ก Safari iOS PWA intercept CORS preflight → TypeError
 */
const CACHE = 'mormoo-v1'; // เวลาอัปเดตแอป ให้ bump เลขนี้

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html'])));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // ── BYPASS ก่อนทุกอย่าง ──
  const u = e.request.url;
  if (
    u.includes('workers.dev') ||
    u.includes('generativelanguage') ||
    u.includes('fonts.googleapis') ||
    u.includes('fonts.gstatic')
  ) return;

  if (e.request.method !== 'GET') return;

  // network-first, cache fallback (แอปสด content สดเสมอ, ออฟไลน์ยังเปิดได้)
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && e.request.url.startsWith(self.location.origin)) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

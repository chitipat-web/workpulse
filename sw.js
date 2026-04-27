// ทีมงานลาล่า — Service Worker
const CACHE_NAME = 'lala-team-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&family=Prompt:wght@400;500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

// ===== INSTALL =====
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache ไฟล์หลักก่อน — external libs อาจ fail ได้, ไม่เป็นไร
      return cache.addAll(['/index.html', '/manifest.json']).catch(() => {
        return cache.addAll(['/index.html']);
      });
    }).then(() => {
      console.log('[SW] Installed');
      return self.skipWaiting();
    })
  );
});

// ===== ACTIVATE =====
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ===== FETCH (Network First กับ Cache Fallback) =====
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // ไม่ cache Firebase / API calls
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebase') ||
    url.pathname.includes('/v1/') ||
    event.request.method !== 'GET'
  ) {
    return; // ให้ผ่านไปตามปกติ
  }

  // Strategy: Network First → Cache Fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache เฉพาะ response ที่สำเร็จ
        if (response && response.status === 200) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
        }
        return response;
      })
      .catch(() => {
        // ออฟไลน์ → ดึงจาก cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Fallback หน้า offline สำหรับ navigation
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

// ===== PUSH NOTIFICATIONS (รองรับในอนาคต) =====
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'ทีมงานลาล่า', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'lala-notif',
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});

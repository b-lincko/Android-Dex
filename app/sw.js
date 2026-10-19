/* Android DEX offline shell. API traffic is never cached. */
const VERSION = 'dex-console-v2.0.0';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/boot.js',
  './js/app.js',
  './js/api.js',
  './js/shell.js',
  './js/panels.js',
  './js/core.js',
  './js/demo.js',
  './js/i18n.js',
  './js/views/shared.js',
  './js/views/apps.js',
  './js/views/phone.js',
  './js/views/files.js',
  './js/views/clipboard.js',
  './js/views/notifications.js',
  './js/views/media.js',
  './js/views/gaming.js',
  './js/views/developer.js',
  './js/views/settings.js',
  './vendor/qrcode.js',
  './assets/icons.svg',
  './assets/app-icon.png',
  './assets/stream-preview.svg',
  './data/demo-state.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/dav/') || url.pathname === '/ws') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put('./index.html', copy)).catch(() => {});
          return response;
        })
        .catch(async () => (await caches.match('./index.html')) || Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        fetch(request).then((response) => {
          if (response.ok) caches.open(VERSION).then((cache) => cache.put(request, response)).catch(() => {});
        }).catch(() => {});
        return cached;
      }
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match('./index.html'));
    }),
  );
});

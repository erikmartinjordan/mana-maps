const MANA_CACHE_VERSION = 'mana-maps-v2';
const MANA_RUNTIME_CACHE = `${MANA_CACHE_VERSION}-runtime`;
const MANA_PRECACHED_URLS = [
  '/',
  '/index.html',
  '/map/',
  '/map/index.html',
  '/styles.css',
  '/auth-gallery.css',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/maskable-icon.svg',
  '/js/pwa.js',
  '/js/i18n.js',
  '/js/filter.js',
  '/js/gallery-page.js',
  '/js/persistence.js',
  '/js/public-profile.js',
  '/js/ogc-loader.js',
  '/js/import-export.js',
  '/js/tools.js',
  '/js/modal.js',
  '/js/stats.js',
  '/js/plans.js',
  '/js/markers.js',
  '/js/tracking.js',
  '/js/responsive.js',
  '/js/firebase.js',
  '/js/gallery.js',
  '/js/user-maps.js',
  '/js/upsell.js',
  '/js/context-menu.js',
  '/js/shortcuts.js',
  '/js/categorize.js',
  '/js/auth.js',
  '/js/collab.js',
  '/js/chat.js',
  '/js/undo-redo.js',
  '/js/map-core.js',
  '/js/globe.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(MANA_CACHE_VERSION)
      .then((cache) => cache.addAll(MANA_PRECACHED_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key !== MANA_CACHE_VERSION && key !== MANA_RUNTIME_CACHE)
        .map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(MANA_RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/map/') || caches.match('/')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(MANA_RUNTIME_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

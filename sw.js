const CACHE_NAME = 'mana-maps-pwa-v1';
const PRECACHE_URLS = [
  '/',
  '/map/',
  '/map/index.html',
  '/js/pwa.js',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;900&family=DM+Mono:wght@400;500&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css',
  'https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css',
  '/styles.css',
  '/auth-gallery.css',
  'https://unpkg.com/shpjs@4.0.4/dist/shp.js',
  'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js',
  'https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js',
  '/js/firebase-config.local.js',
  '/js/firebase.js',
  '/js/i18n.js?v=1776927826',
  '/js/markers.js?v=1776927827',
  '/js/modal.js?v=1776927826',
  '/js/map-core.js?v=1776927828',
  '/js/stats.js?v=1776927826',
  '/js/globe.js?v=1776927826',
  '/js/tools.js?v=1776927827',
  '/js/context-menu.js?v=1776927827',
  '/js/import-export.js?v=1776927828',
  '/js/chat.js?v=1776927827',
  '/js/undo-redo.js?v=1776927827',
  '/js/persistence.js?v=1776927828',
  '/js/gallery.js?v=1776927826',
  '/js/ogc-loader.js?v=1776927826',
  '/js/responsive.js?v=1776927826',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js',
  '/js/auth.js?v=1776927826',
  '/js/user-maps.js?v=1776927826',
  '/js/tracking.js?v=1776927826',
  '/js/collab.js?v=1776927826',
  '/js/plans.js?v=1776927826',
  '/js/upsell.js?v=1776927826',
  '/js/categorize.js?v=1776927826',
  '/js/shortcuts.js?v=1776927826'
];

const PRECACHE_KEYS = new Set(PRECACHE_URLS.map((url) => new URL(url, self.location.origin).href));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(PRECACHE_URLS.map((url) => {
        const absoluteUrl = new URL(url, self.location.origin);
        const request = new Request(absoluteUrl.href, {
          cache: 'reload',
          mode: absoluteUrl.origin === self.location.origin ? 'same-origin' : 'no-cors'
        });

        return fetch(request).then((response) => {
          if (!response || (!response.ok && response.type !== 'opaque')) {
            throw new Error(`Unable to precache ${absoluteUrl.href}`);
          }

          return cache.put(absoluteUrl.href, response);
        });
      })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(cacheNames
        .filter((cacheName) => cacheName !== CACHE_NAME)
        .map((cacheName) => caches.delete(cacheName))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isNavigation = event.request.mode === 'navigate';
  const isPrecached = PRECACHE_KEYS.has(requestUrl.href);

  if (isPrecached) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  event.respondWith(networkFirst(event.request, isNavigation));
});

function cacheFirst(request) {
  return caches.match(request.url)
    .then((cachedResponse) => cachedResponse || fetch(request));
}

function networkFirst(request, isNavigation) {
  return caches.open(CACHE_NAME).then((cache) => fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone());
      }

      return response;
    })
    .catch(() => caches.match(request)
      .then((cachedResponse) => cachedResponse || (isNavigation && caches.match('/map/index.html')))
      .then((response) => response || Response.error())));
}

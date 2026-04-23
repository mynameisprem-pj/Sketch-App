/* ═══════════════════════════════════════════════════════
   Tracer Sketch — Service Worker
   Strategy: Cache-first with network fallback.
   On install: pre-cache every file the app needs.
   On fetch:   serve from cache instantly; update in background.
═══════════════════════════════════════════════════════ */

const CACHE_NAME = 'tracer-sketch-v1';

/* Every file the app needs to work offline */
const FILES_TO_CACHE = [
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg'
];

/* ── INSTALL: pre-cache all files ───────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  /* Activate immediately, don't wait for old SW to die */
  self.skipWaiting();
});

/* ── ACTIVATE: clean up old caches ─────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  /* Take control of all open tabs immediately */
  self.clients.claim();
});

/* ── FETCH: cache-first, fallback to network ────────── */
self.addEventListener('fetch', event => {
  /* Only handle GET requests */
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        /* Serve from cache instantly */
        return cached;
      }

      /* Not in cache — try network, then cache the result */
      return fetch(event.request)
        .then(response => {
          /* Only cache valid responses */
          if (!response || response.status !== 200 || response.type === 'opaque') {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          /* Network failed and not in cache — return offline fallback */
          return caches.match('./index.html');
        });
    })
  );
});
// KSE Index Viewer Service Worker
// - Precache the app shell so PWA opens offline
// - Stale-while-revalidate for /api/* (background refresh, instant render)
// - Network-only for the user's Apps Script Web App (script.google.com) — never cached

const VERSION = 'v1';
const SHELL_CACHE = `kse-shell-${VERSION}`;
const API_CACHE = `kse-api-${VERSION}`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/api.js',
  '/js/store.js',
  '/js/format.js',
  '/js/pages/indices.js',
  '/js/pages/market.js',
  '/js/pages/portfolio.js',
  '/js/pages/stock.js',
  '/js/pages/settings.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== API_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache the Apps Script Web App (user portfolio data) — always live.
  if (url.hostname.includes('script.google.com') || url.hostname.includes('script.googleusercontent.com')) {
    return; // default network handling
  }

  // /api/* — stale-while-revalidate
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(staleWhileRevalidate(req, API_CACHE));
    return;
  }

  // Shell assets — cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
  }
});

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(cacheName);
    cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    // For navigation requests, fall back to index.html
    if (req.mode === 'navigate') {
      const idx = await caches.match('/index.html');
      if (idx) return idx;
    }
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then(resp => {
    if (resp && resp.ok) cache.put(req, resp.clone());
    return resp;
  }).catch(() => null);
  return cached || (await networkPromise) || new Response(JSON.stringify({ ok: false, error: 'offline' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

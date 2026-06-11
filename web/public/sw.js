// KSE Index Viewer Service Worker
// - App shell: network-first with cache fallback (deploys reach users on next open, offline still works)
// - /api/*: stale-while-revalidate, EXCEPT requests sent with cache:'reload'/'no-cache'/'no-store'
//   (explicit ↻ refresh) which go network-first
// - Network-only for the user's Apps Script Web App (script.google.com) — never cached

const VERSION = 'v2';
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

  // /api/* — stale-while-revalidate normally; network-first when the page
  // explicitly asked to bypass caches (fetch cache:'reload' on ↻ refresh).
  // Cache Storage lookups ignore req.cache, so we must honor it ourselves.
  if (url.pathname.startsWith('/api/')) {
    const forced = req.cache === 'reload' || req.cache === 'no-cache' || req.cache === 'no-store'
      || req.headers.get('X-Bypass-Cache') === '1';
    event.respondWith(
      (forced ? networkFirst(req, API_CACHE) : staleWhileRevalidate(req, API_CACHE))
        .catch(() => offlineJson())
    );
    return;
  }

  // Shell assets — network-first so new deploys take effect on next open;
  // cached copy keeps the app working offline.
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, SHELL_CACHE));
  }
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const idx = await cache.match('/index.html');
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
  return cached || (await networkPromise) || offlineJson();
}

function offlineJson() {
  return new Response(JSON.stringify({ ok: false, error: 'offline' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

// StdOut Service Worker v1
const SW_VERSION = '1.0.0';
const SHELL_CACHE = 'stdout-shell-v1';
const ASSET_CACHE = 'stdout-assets-v1';

// Shell assets to pre-cache on install
const SHELL_ASSETS = [
  '/offline.html',
  '/fonts/inter-latin-400.woff2',
  '/fonts/inter-latin-500.woff2',
  '/fonts/inter-latin-600.woff2',
  '/fonts/inter-latin-700.woff2',
  '/fonts/jetbrains-mono-latin-400-v2.woff2',
  '/fonts/jetbrains-mono-latin-600-v2.woff2',
];

// Install: pre-cache shell assets, activate immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean up old caches, claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k =>
            (k.startsWith('stdout-shell-') && k !== SHELL_CACHE) ||
            (k.startsWith('stdout-assets-') && k !== ASSET_CACHE)
          )
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Message handler
self.addEventListener('message', (event) => {
  if (event.data?.type === 'GET_VERSION') {
    if (event.source) {
      event.source.postMessage({ type: 'VERSION', version: SW_VERSION });
    }
  }
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // 1. Hashed Astro assets (/_astro/*): cache-first + opportunistic caching
  if (url.pathname.startsWith('/_astro/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(res => {
            if (res.ok) cache.put(event.request, res.clone());
            return res;
          }).catch(() => new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  // 2. Fonts: cache-first (they never change)
  if (url.pathname.startsWith('/fonts/')) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(res => {
            if (res.ok) cache.put(event.request, res.clone());
            return res;
          }).catch(() => new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  // 3. Navigation requests: network-first, fall back to offline.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match('/offline.html').then(cached => {
          if (cached) return cached;
          return new Response(
            '<html><body style="background:#07070C;color:#E2E8F0;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center;padding:2rem"><h1 style="color:#F97316;margin-bottom:0.5rem">You\'re Offline</h1><p style="color:#94A3B8">Connect to the internet to use StdOut.</p></div></body></html>',
            { status: 503, headers: { 'Content-Type': 'text/html' } }
          );
        })
      )
    );
    return;
  }

  // 4. Everything else: network only
});

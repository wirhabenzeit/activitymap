/* global self, caches, fetch, Request, Response, URL */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `activitymap-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `activitymap-static-${CACHE_VERSION}`;

const APP_SHELL_URLS = [
  '/map',
  '/list',
  '/stats/calendar',
  '/offline.html',
  '/site.webmanifest',
  '/favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.allSettled(
        APP_SHELL_URLS.map(async (url) => {
          const request = new Request(url, { cache: 'reload' });
          const response = await fetch(request);
          if (response.ok) {
            await cache.put(url, response.clone());
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== STATIC_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

const isStaticAssetRequest = (request) =>
  request.destination === 'script' ||
  request.destination === 'style' ||
  request.destination === 'image' ||
  request.destination === 'font' ||
  request.destination === 'worker';

const staleWhileRevalidate = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }

  const response = await network;
  if (response) {
    return response;
  }

  return new Response('', { status: 504, statusText: 'Offline' });
};

const networkFirstNavigation = async (request) => {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cachedPage = await cache.match(request);
    if (cachedPage) {
      return cachedPage;
    }

    const cachedMap = await cache.match('/map');
    if (cachedMap) {
      return cachedMap;
    }

    const offlinePage = await cache.match('/offline.html');
    if (offlinePage) {
      return offlinePage;
    }

    return new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    return;
  }

  if (url.pathname.startsWith('/_next/static/') || isStaticAssetRequest(request)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
  }
});

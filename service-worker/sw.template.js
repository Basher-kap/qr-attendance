/* eslint-env serviceworker */
// Service worker of QR Attendance. It keeps the whole app on the device so it opens without a
// connection. The build (quasar.config.ts) fills in VERSION and FILES for every release, so
// each release has its own cache and the browser notices that this file changed.
const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = `qr-attendance-${VERSION}`;
const scope = self.registration.scope;
const at = (path) => new URL(path, scope).href;

self.addEventListener('install', (event) => {
  // The new version waits (it is not activated) until the page asks for it or every open
  // tab is closed, so a page that is open never loses files it still needs.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map(at))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('qr-attendance-') && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Only this app's own files. Calls to Supabase and Google always go to the network.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // The app uses hash routes, so every page is the same index.html (also after the
    // Google sign-in returns to /?code=...).
    event.respondWith(
      caches.match(at('index.html')).then((hit) => hit || fetch(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});

/* Service worker for QR Attendee: lets the installed app open and work with no internet.
 *
 * This file is a template. build/offline-plugin.mjs fills in VERSION, BUILT_AT and PRECACHE at
 * build time and writes the result to dist/spa/sw.js, so every file of the app is stored on the
 * device the first time it is opened online.
 *
 * Only this site's own files are handled. Requests to Supabase or Google (sign-in and cloud data)
 * are never touched and always go to the network.
 */
const VERSION = '__VERSION__';
const BUILT_AT = Number('__BUILT_AT__');
const PRECACHE = /* __PRECACHE__ */ [];

const PREFIX = 'qr-attendee-';
const CACHE = `${PREFIX}${BUILT_AT}-${VERSION}`;
const NAVIGATION_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // "reload" skips the browser's own cache so the stored copy is exactly this version.
      // If any file fails, the install fails and the previous version keeps working.
      await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Keep this version and the one before it: a page that is still open may need a file of the
      // old version, and the server no longer has it.
      const ours = (await caches.keys()).filter((key) => key.startsWith(PREFIX));
      const newestFirst = ours.sort((a, b) => builtAt(b) - builtAt(a));
      await Promise.all(newestFirst.slice(2).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

function builtAt(cacheName) {
  return Number(cacheName.slice(PREFIX.length).split('-')[0]) || 0;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase, Google: network only
  if (url.pathname === '/sw.js') return; // always ask the server for the newest worker

  if (request.mode === 'navigate') event.respondWith(openPage(request));
  else event.respondWith(getFile(request));
});

// Opening the app: the network when it answers quickly (so a new version shows up), otherwise the
// stored copy. With no connection the stored copy is used straight away.
async function openPage(request) {
  try {
    return await Promise.race([
      fetch(request),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('slow')), NAVIGATION_TIMEOUT_MS),
      ),
    ]);
  } catch {
    const page = await caches.match('/', { ignoreSearch: true });
    return page || Response.error();
  }
}

// Scripts, styles, fonts and images: the stored copy first, the network for anything not stored.
async function getFile(request) {
  const stored = await caches.match(request, { ignoreSearch: true });
  if (stored) return stored;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return Response.error();
  }
}

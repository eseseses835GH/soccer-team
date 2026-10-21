// Offline support at the pitch.
// - Every build stamps BUILD (a hash of the build) and PRECACHE (the app's JS/CSS/worker) into this
//   file (see swManifest in vite.config.ts). A new deploy therefore means a new sw.js: the browser
//   installs it, it downloads the new files, takes over, and deletes the previous version's cache.
// - Pages (index.html) and the other un-hashed files (manifest, icons): network first, so a new
//   deploy is picked up on the next open; the cached copy is used only when offline.
// - Hashed files in assets/ and Google Fonts: cache first (their content never changes).
// - Supabase (login + sync) and Google sign-in (accounts.google.com, the GIS script) are never cached.
const BUILD = '__BUILD_ID__';
const PRECACHE = [/*__PRECACHE__*/];
const CACHE = `kochot-${BUILD}`;
const FONTS = 'kochot-fonts'; // kept across versions
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './icon-192.png', './apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  // `reload` skips the HTTP cache so we never precache a stale index.html. If anything fails, the
  // install fails and the previous version stays in charge (the browser retries on a later visit).
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll([...SHELL, ...PRECACHE].map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function put(cacheName, req, res) {
  if (res.ok || res.type === 'opaque') {
    const copy = res.clone();
    caches.open(cacheName).then((c) => c.put(req, copy));
  }
  return res;
}

const NAV_TIMEOUT_MS = 3500;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never cache login/sync traffic (Supabase API, auth, realtime): always straight to the network.
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in') || /\/(auth|rest|realtime)\/v1\//.test(url.pathname)) return;
  if (url.hostname === 'accounts.google.com' || url.hostname.endsWith('.google.com')) return;
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return;

  if (req.mode === 'navigate') {
    // Network first, but a weak connection at the pitch shouldn't keep the app from opening: after
    // NAV_TIMEOUT_MS the cached page is used, and the network answer still refreshes the cache.
    const net = fetch(req).then((res) => {
      if (res.ok) put(CACHE, './index.html', res);
      return res;
    });
    const cached = () => caches.match('./index.html').then((r) => r || caches.match('./'));
    e.waitUntil(net.catch(() => {}));
    e.respondWith(
      new Promise((resolve, reject) => {
        let done = false;
        const finish = (r) => {
          if (done || !r) return false;
          done = true;
          resolve(r);
          return true;
        };
        const timer = setTimeout(() => cached().then(finish), NAV_TIMEOUT_MS);
        net.then(
          (res) => {
            clearTimeout(timer);
            finish(res);
          },
          () => {
            clearTimeout(timer);
            cached().then((r) => finish(r) || done || reject(new Error('offline')));
          },
        );
      }),
    );
    return;
  }

  // Content-hashed build files and fonts: cache first. `ignoreVary`: the precached copies were
  // fetched without an Origin header, while module scripts and CSS are requested with one, and some
  // servers answer with `Vary: Origin`.
  if (isFont || /\/assets\//.test(url.pathname)) {
    e.respondWith(caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req).then((res) => put(isFont ? FONTS : CACHE, req, res))));
    return;
  }

  // Other same-origin files (manifest, icons, CSV template): network first, cache when offline.
  e.respondWith(
    fetch(req)
      .then((res) => put(CACHE, req, res))
      .catch(() => caches.match(req, { ignoreVary: true }).then((r) => r || Response.error())),
  );
});

/**
 * RigRout service worker — app-shell caching only.
 *
 * Scope is deliberately narrow: this caches the static files that make up the
 * page itself (HTML/CSS/JS/manifest/icon) so the app still loads with no
 * connection. It does NOT cache anything under /api/ or /data/, and does not
 * intercept any cross-origin request (map tiles, OSRM routing, Overpass,
 * Nominatim, 511 feeds). Caching live restriction/road-ban/routing data would
 * mean a driver could see yesterday's (or last week's) data believing it's
 * current — that's worse than no offline support at all. Offline mode here
 * means "the app shell loads," not "the data is available offline."
 */
const CACHE_NAME = 'rigrout-shell-v6';
const SHELL_FILES = [
  './rigrout.html',
  './manifest.json',
  './icon.svg',
  './mobile-config.js',
  './MarkerCluster.css',
  './MarkerCluster.Default.css',
  './leaflet.markercluster.js'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) { return cache.addAll(SHELL_FILES); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n !== CACHE_NAME; })
             .map(function(n) { return caches.delete(n); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GET requests for known shell files. Everything
  // else (API calls, /data/, third-party map/routing/geocoding services)
  // passes straight through untouched.
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') !== -1) return;
  if (url.pathname.indexOf('/data/') !== -1) return;

  const isShellFile = SHELL_FILES.some(function(f) {
    return url.pathname.endsWith(f.replace('./', '/'));
  });
  if (!isShellFile) return;

  // Network-first keeps deployed safety and data-handling fixes current.
  // Fall back to the cached shell only when the network is unavailable.
  event.respondWith(
    fetch(req).then(function(resp) {
      if (resp && resp.status === 200) {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(req, copy); });
      }
      return resp;
    }).catch(function() { return caches.match(req); })
  );
});

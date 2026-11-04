/* Offline shell: the app's own files load instantly and work without signal at the diamond.
   Team data always comes fresh from the network. Bump VERSION whenever you deploy changes. */
const VERSION = 'dugout-v19';
const SHELL = ['./', 'index.html', 'style.css', 'config.js', 'js/main.js', 'js/app.js', 'js/platform.js', 'js/weather.js', 'js/market.js', 'js/rules.js', 'js/scorecard.js', 'js/prefs.js', 'js/icons.js', 'manifest.webmanifest', 'privacy.html', 'icons/icon.svg', 'icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // Supabase, fonts and maps go straight to the network
  // network first so new deploys show up right away; fall back to the cached copy when offline
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});

/* Cache only the offline fallback and public icons. Never cache account pages or APIs. */
const CACHE = 'predictpos-offline-v1';
const ASSETS = ['/offline.html', '/logos/android-chrome-192x192.png', '/logos/android-chrome-512x512.png'];
self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((name) => name.startsWith('predictpos-offline-') && name !== CACHE).map((name) => caches.delete(name)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
    if (event.request.mode === 'navigate' && !url.pathname.startsWith('/api/')) {
        event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
    } else if (ASSETS.includes(url.pathname)) {
        event.respondWith(caches.match(url.pathname).then((cached) => cached || fetch(event.request)));
    }
});

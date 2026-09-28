// Minimal service worker: makes the app installable. API calls are never cached
// because attendance must always reflect live server state.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

// Sara service worker: makes the app installable, shows push notifications, and gives a friendly
// page when the server can't be reached. It never caches API data or conversations.
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open('sara-shell-v4').then((c) => c.addAll([OFFLINE, '/offline.css', '/offline.js', '/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== 'sara-shell-v4').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});

// The offline page's own files come from the cache when the server is down.
self.addEventListener('fetch', (event) => {
  const path = new URL(event.request.url).pathname;
  if (event.request.mode === 'navigate' || !['/offline.css', '/offline.js', '/icon-192.png'].includes(path)) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(path)));
});

self.addEventListener('push', (event) => {
  let data = { title: 'Sara', body: '', url: '/' };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* empty or non-JSON push */
  }
  event.waitUntil(
    (async () => {
      // If Sara is open and in front, the page shows the message itself.
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (wins.some((w) => w.focused && w.visibilityState === 'visible')) return;
      await self.registration.showNotification(data.title, { body: data.body, icon: '/icon-192.png', badge: '/icon-192.png', tag: data.tag, data: { url: data.url } });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = wins[0];
      if (win) {
        await win.focus();
        win.postMessage({ type: 'open', url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

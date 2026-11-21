/* Minimal service worker.
   Its only job is to make the app installable on a phone ("add to home screen").
   It deliberately caches NOTHING: a clinic screen showing yesterday's appointments
   or a stale balance is worse than a screen that says it is offline. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {
  /* fall through to the network */
})

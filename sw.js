// Service worker: appka funguje i offline a biblické texty se ukládají do mezipaměti.
// Dotazy na AI (googleapis.com) se NIKDY neukládají.
const VERSION = 'v2';
const SHELL_CACHE = `shell-${VERSION}`;
const BIBLE_CACHE = 'bible-v1';
const BIBLE_ORIGIN = 'https://bible.helloao.org';

const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/ai.js',
  './js/bible.js',
  './js/books-cs.js',
  './js/markdown.js',
  './js/prompt.js',
  './js/storage.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== BIBLE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Vlastní soubory appky: nejdřív síť (ať jsou vždy aktuální), offline z mezipaměti.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
    );
    return;
  }

  // Biblické texty se nemění: nejdřív mezipaměť, jinak síť.
  if (url.origin === BIBLE_ORIGIN && url.pathname.startsWith('/api/')) {
    event.respondWith(
      caches.open(BIBLE_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
  }
  // Ostatní (Google AI) jde přímo na síť bez ukládání.
});

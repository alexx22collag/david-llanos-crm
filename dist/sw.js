const cacheName = 'dl-coaching-v11';
const assets = ['./', './index.html', './privacidad.html', './terminos.html', './app.js', './model.js', './agenda.js', './coach.js', './styles.css', './dashboard.css', './david-llanos-lockup.jpg', './google-g.png', './favicon-32.png', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('dl-coaching-') && key !== cacheName).map(key => caches.delete(key)))));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const isNavigation = event.request.mode === 'navigate';
  if (!isNavigation && !assets.some(asset => new URL(asset, self.registration.scope).href === url.href)) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cached = await caches.open(cacheName);
    return (await cached.match(event.request)) || (isNavigation ? await cached.match('./index.html') : null) || Response.error();
  }));
});

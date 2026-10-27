// Service worker : permet d'utiliser l'appli hors connexion une fois ouverte (tablettes en atelier)
const CACHE = 'kla-v1';
const COQUILLE = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'img/icone.png',
  'js/app.js', 'js/outils.js', 'js/db.js', 'js/etat.js', 'js/photo.js', 'js/audio.js', 'js/studio.js',
  'js/cibles.js', 'js/archive.js', 'js/ar.js',
  'vendor/jszip.min.js', 'vendor/qrcode.mjs', 'vendor/three/three.module.js', 'vendor/three/addons/renderers/CSS3DRenderer.js',
  'vendor/mindar/mindar-image.prod.js', 'vendor/mindar/mindar-image-three.prod.js',
  'vendor/mindar/controller-mGt1s8dJ.js', 'vendor/mindar/ui-fBadYuor.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Réseau d'abord (pour recevoir les mises à jour), cache en secours
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok && !u.search) { const copie = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copie)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

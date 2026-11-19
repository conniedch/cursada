// CursadOK: deja la app disponible aunque no haya señal.
// Siempre pide primero la versión nueva; la copia guardada solo se usa sin conexión.
const CACHE = 'cursadok-v18';
const SHELL = ['./', 'index.html', 'styles.css', 'config.js', 'backend.js', 'catalog.js', 'beneficios.js', 'importer.js', 'logic.js', 'app.js', 'vendor/supabase.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Solo archivos de la app: los datos (Supabase) y las letras van directo a internet.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('index.html'))),
  );
});

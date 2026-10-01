// Service worker de printquote: la app se abre sin conexión.
// No es parte del paquete de Vite: `scripts/pwa-plugin.ts` lo copia a `dist/sw.js` rellenando
// VERSION (hash del contenido de dist/) y PRECACHE (lista de archivos que se descargan al instalar).
//
// - Instalar: precaché de la app (HTML, JS, CSS, worker, visor, pieza de ejemplo, iconos).
//   El chunk del PDF y las fuentes NO: se guardan la primera vez que se piden.
// - Navegación: red primero (se ve la versión nueva en cuanto se publica); sin red, la app de la caché.
// - Resto del mismo origen y del scope: caché primero y, si falta, red y guardar.
// - Activar: borra las cachés printquote-* de otras versiones. No hay skipWaiting: una pestaña abierta
//   no pierde los archivos que aún va a pedir; la versión nueva manda al cerrar las pestañas.

const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;

const PREFIX = 'printquote-';
const CACHE = PREFIX + VERSION;
const SCOPE = self.registration.scope; // p. ej. https://bertmarti.github.io/printquote/

self.addEventListener('install', (event) => {
  // cache: 'reload' salta la caché HTTP: lo precacheado es lo que hay publicado ahora. Los assets/* llevan el hash
  // del contenido en el nombre (inmutables) y la página acaba de pedirlos: con 'default' salen de la caché HTTP
  // en vez de descargarse dos veces en la primera visita.
  const urls = [SCOPE, ...PRECACHE.map((path) => new URL(path, SCOPE).href)];
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(urls.map((url) => new Request(url, { cache: /\/assets\//.test(url) ? 'default' : 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith(PREFIX) && name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  if (!request.url.startsWith(SCOPE) || request.url === SCOPE + 'sw.js') return; // otro origen, fuera del scope o este archivo
  event.respondWith(request.mode === 'navigate' ? fromNetworkFirst(request) : fromCacheFirst(request));
});

async function fromNetworkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) await (await caches.open(CACHE)).put(SCOPE, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(SCOPE, { cacheName: CACHE, ignoreSearch: true, ignoreVary: true });
    if (cached) return cached;
    throw error;
  }
}

async function fromCacheFirst(request) {
  const cached = await caches.match(request, { cacheName: CACHE, ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

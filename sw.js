const CACHE_NAME = 'licweekly-cache-v13';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manual_de_usuario.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './img/logo.png',
  './img/icon-192.png',
  './img/icon-512.png',
  './img/apple-touch-icon.png',
  './img/favicon-32x32.png',
  './img/favicon-16x16.png',
  './img/favicon.ico'
];

// 1. Instalación: Guardar recursos estáticos en la caché del navegador
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// 2. Activación: Limpiar cachés antiguas si se actualiza la versión
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Estrategia de respuesta: Cache First con actualización en segundo plano
self.addEventListener('fetch', (event) => {
  // Ignorar peticiones que no sean GET o esquemas no soportados (ej. chrome-extension)
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Devuelve el recurso de la caché inmediatamente y actualiza la caché en segundo plano
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {
          // Si no hay red, no pasa nada, ya se sirvió de la caché
        });

        return cachedResponse;
      }

      // Si no estaba en caché, buscarlo en la red
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      });
    })
  );
});

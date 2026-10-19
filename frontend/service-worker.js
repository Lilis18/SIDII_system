const STATIC_CACHE = 'sidii-static-v4';
const RUNTIME_CACHE = 'sidii-runtime-v1';
const CACHE_PREFIX = 'sidii-';
const OFFLINE_URL = './offline.html';

const PRECACHE_URLS = [
	'./',
	'./index.html',
	'./login.html',
	'./register.html',
	'./dashboard.html',
	'./cambiar-contrasena.html',
	'./usuarios-admin.html',
	'./offline.html',
	'./manifest.json',
	'./css/global.css',
	'./css/login.css',
	'./css/dashboard.css',
	'./css/evidencias.css',
	'./css/assistant.css',
	'./public/utp-1.jpg',
	'./js/api-config.js',
	'./js/auth.js',
	'./js/login.js',
	'./js/cargaDeDatos.js',
	'./js/evidencias.js',
	'./js/grafico.js',
	'./js/dashboard.js',
	'./js/footer.js',
	'./js/pwa.js',
	'./js/assistant.js',
	'./public/icon-192.png',
	'./public/icon-512.png',
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const exists = await caches.has(STATIC_CACHE);
			console.log(`[SW] ¿Existe la caché estática '${STATIC_CACHE}'?: ${exists}`);
			const cache = await caches.open(STATIC_CACHE);

			const urlsToPrefetch = PRECACHE_URLS.map((url) => new URL(url, self.registration.scope).href);
			await cache.addAll(urlsToPrefetch);
			console.log(`[SW] Caché estática '${STATIC_CACHE}' precargada con éxito.`);

			return self.skipWaiting();
		})(),
	);
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            // Uso de caches.keys() para obtener el listado de almacenes
            return Promise.all(
                cacheNames
                    .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX) 
                        && ![STATIC_CACHE, RUNTIME_CACHE].includes(cacheName))
                    // Uso de caches.delete() para eliminar cachés de versiones antiguas
                    .map((cacheName) => {
                        console.log(`[SW] Eliminando caché obsoleta: ${cacheName}`);
                        return caches.delete(cacheName);
                    })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const requestUrl = new URL(request.url);
	if (requestUrl.origin !== self.location.origin || requestUrl.pathname.includes('/api/')) return;

	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request)
				.catch(async () => {
					const cache = await caches.open(STATIC_CACHE);
					return cache.match(new URL(OFFLINE_URL, self.registration.scope));
				}),
		);
		return;
	}

	if (['script', 'style', 'image', 'font'].includes(request.destination)) {
        event.respondWith(
            (async () => {
                const staticCache = await caches.open(STATIC_CACHE);
                const runtimeCache = await caches.open(RUNTIME_CACHE);

                // Uso de cache.match() buscando primero en static, luego en runtime
                const cachedResponse = await staticCache.match(request) || await runtimeCache.match(request);
                if (cachedResponse) return cachedResponse;

                const response = await fetch(request);
                // Uso de cache.put() para guardar dinámicamente recursos en RUNTIME_CACHE
                if (response.ok) {
                    await runtimeCache.put(request, response.clone());
                }
                return response;
            })()
        );
    }
});


const STATIC_CACHE = 'sidii-static-v12';
const RUNTIME_CACHE = 'sidii-runtime-v1';
const PAGE_CACHE = 'sidii-pages-v1';
const CACHE_PREFIX = 'sidii-';
const API_CACHE_PREFIX = 'sidii-api-v1-';
const OFFLINE_URL = './offline.html';
const API_ORIGIN = (() => {
	try {
		const configuredOrigin = new URL(self.location.href).searchParams.get('apiOrigin');
		return configuredOrigin ? new URL(configuredOrigin).origin : null;
	} catch {
		return null;
	}
})();

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
	'./css/evidenvias.css',
	'./css/assistant.css',
	'./public/utp-1.jpg',
	'./js/api-config.js',
	'./js/auth.js',
	'./js/login.js',
	'./js/cargaDeDatos.js',
	'./js/evidencias.js',
	'./js/grafico.js',
	'./js/dasboard.js',
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
						&& ![STATIC_CACHE, RUNTIME_CACHE, PAGE_CACHE].includes(cacheName)
						&& !cacheName.startsWith(API_CACHE_PREFIX))
                    // Uso de caches.delete() para eliminar cachés de versiones antiguas
                    .map((cacheName) => {
                        console.log(`[SW] Eliminando caché obsoleta: ${cacheName}`);
                        return caches.delete(cacheName);
                    })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('message', (event) => {
	if (event.data?.type !== 'CLEAR_API_CACHE') return;

	event.waitUntil(
		caches.keys().then((cacheNames) => Promise.all(
			cacheNames
				.filter((cacheName) => cacheName.startsWith(API_CACHE_PREFIX))
				.map((cacheName) => caches.delete(cacheName)),
		)),
	);
});

async function createApiCacheKey(request) {
	const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
	if (!token) return null;

	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	const tokenHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
	const cacheUrl = new URL(request.url);
	cacheUrl.searchParams.set('__sidii_session', tokenHash);
	const cacheRequest = new Request(cacheUrl, request);
	const cacheHeaders = new Headers(cacheRequest.headers);
	cacheHeaders.delete('Authorization');

	return {
		cacheName: `${API_CACHE_PREFIX}${tokenHash}`,
		request: new Request(cacheRequest, { headers: cacheHeaders }),
	};
}

async function getCachedApiResponse(cache, request) {
	const cachedResponse = await cache.match(request, { ignoreVary: true });
	if (!cachedResponse) return null;

	const headers = new Headers(cachedResponse.headers);
	headers.set('X-SIDII-Cache', 'HIT');
	headers.set('X-SIDII-Offline', 'true');
	return new Response(await cachedResponse.arrayBuffer(), {
		status: cachedResponse.status,
		statusText: cachedResponse.statusText,
		headers,
	});
}

// Recuperación offline de API: guarda JSON exitoso por sesión y devuelve la última copia si falla la red o el servidor (5xx).
async function networkFirstApi(request) {
	let cacheKey;
	try {
		cacheKey = await createApiCacheKey(request);
	} catch (error) {
		console.warn('[SW] No se pudo generar la clave privada de caché; se consulta solo la red.', error);
		return fetch(request);
	}
	if (!cacheKey) return fetch(request);

	const cache = await caches.open(cacheKey.cacheName);
	try {
		const response = await fetch(request);
		if (response.status === 401 || response.status === 403) {
			await caches.delete(cacheKey.cacheName);
			return response;
		}
		if (response.status >= 500) {
			const cachedResponse = await getCachedApiResponse(cache, cacheKey.request);
			if (cachedResponse) return cachedResponse;
			return response;
		}
		if (response.ok && (response.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
			try {
				await cache.put(cacheKey.request, response.clone());
			} catch (error) {
				console.warn('[SW] No se pudo actualizar la caché de la API.', error);
			}
		}
		return response;
	} catch (error) {
		const cachedResponse = await getCachedApiResponse(cache, cacheKey.request);
		if (cachedResponse) {
			return cachedResponse;
		}
		return new Response(JSON.stringify({ msg: 'Sin conexión y sin datos previos guardados para esta sesión.' }), {
			status: 503,
			headers: {
				'Content-Type': 'application/json; charset=utf-8',
				'X-SIDII-Cache': 'MISS',
				'X-SIDII-Offline': 'true',
			},
		});
	}
}

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const requestUrl = new URL(request.url);
	if (API_ORIGIN && requestUrl.origin === API_ORIGIN && requestUrl.pathname.startsWith('/api/')) {
		event.respondWith(networkFirstApi(request));
		return;
	}
	if (requestUrl.origin !== self.location.origin) return;

	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request)
				.then(async (response) => {
					if (response.ok && (response.headers.get('content-type') || '').includes('text/html')) {
						const pageCache = await caches.open(PAGE_CACHE);
						await pageCache.put(request, response.clone());
					}
					return response;
				})
				.catch(async () => {
					const pageCache = await caches.open(PAGE_CACHE);
					const cachedPage = await pageCache.match(request);
					if (cachedPage) return cachedPage;

					const staticCache = await caches.open(STATIC_CACHE);
					const precachedPage = await staticCache.match(request);
					if (precachedPage) return precachedPage;

					return staticCache.match(new URL(OFFLINE_URL, self.registration.scope));
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


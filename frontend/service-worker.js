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
		caches.open(STATIC_CACHE).then((cache) =>
			cache.addAll(PRECACHE_URLS.map((url) => new URL(url, self.registration.scope).href)),
		),
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((cacheNames) =>
			Promise.all(
				cacheNames
					.filter((cacheName) => cacheName.startsWith(CACHE_PREFIX)
						&& ![STATIC_CACHE, RUNTIME_CACHE].includes(cacheName))
					.map((cacheName) => caches.delete(cacheName)),
			),
		).then(() => self.clients.claim()),
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
				const cachedResponse = await staticCache.match(request)
					|| await runtimeCache.match(request);
				if (cachedResponse) return cachedResponse;

				const response = await fetch(request);
				if (response.ok) await runtimeCache.put(request, response.clone());
				return response;
			})(),
		);
	}
});
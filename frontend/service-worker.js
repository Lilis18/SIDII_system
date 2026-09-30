const CACHE_NAME = 'sidii-static-v1';
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
	'./public/icon-192.png',
	'./public/icon-512.png',
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) =>
			cache.addAll(PRECACHE_URLS.map((url) => new URL(url, self.registration.scope).href)),
		),
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((cacheNames) =>
			Promise.all(
				cacheNames
					.filter((cacheName) => cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME)
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
				.catch(() => caches.match(OFFLINE_URL)),
		);
		return;
	}

	if (['script', 'style', 'image', 'font'].includes(request.destination)) {
		event.respondWith(
			caches.match(request).then((cachedResponse) => {
				if (cachedResponse) return cachedResponse;
				return fetch(request).then((response) => {
					if (response.ok) {
						const responseCopy = response.clone();
						caches.open(CACHE_NAME).then((cache) => cache.put(request, responseCopy));
					}
					return response;
				});
			}),
		);
	}
});
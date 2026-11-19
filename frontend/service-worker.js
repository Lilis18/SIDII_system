const STATIC_CACHE = 'sidii-static-v19';
const RUNTIME_CACHE = 'sidii-runtime-v1';
const PAGE_CACHE = 'sidii-pages-v1';
const CACHE_PREFIX = 'sidii-';
const API_CACHE_PREFIX = 'sidii-api-v1-';
const PREAUDIT_CACHE_PREFIX = 'sidii-preauditorias-v2-';
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
	'./css/auditorias.css',
	'./css/assistant.css',
	'./css/alertas.css',
	'./public/utp-1.jpg',
	'./js/api-config.js',
	'./js/auth.js',
	'./js/semaforo.js',
	'./js/login.js',
	'./js/cargaDeDatos.js',
	'./js/evidencias.js',
	'./js/auditorias.js',
	'./js/grafico.js',
	'./js/dasboard.js',
	'./js/footer.js',
	'./js/pwa.js',
	'./js/assistant.js',
	'./js/alertas.js',
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
						&& !cacheName.startsWith(API_CACHE_PREFIX)
						&& !cacheName.startsWith(PREAUDIT_CACHE_PREFIX))
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

// ---------------------------------------------------------------------------
// Alertas push: notificaciones con botones de acción que se ejecutan en segundo plano.
// ---------------------------------------------------------------------------
const ALERT_API_BASE = `${API_ORIGIN || self.location.origin}/api`;
const ALERT_DB_NAME = 'sidii-alertas-sw';
const ALERT_STORE = 'acciones-pendientes';
const ALERT_SYNC_TAG = 'sidii-acciones-alertas';
const ALERT_ICON = new URL('./public/icon-192.png', self.registration.scope).href;

function abrirBaseAlertas() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(ALERT_DB_NAME, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(ALERT_STORE, { keyPath: 'id' });
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function operarAccionesPendientes(modo, operacion) {
	const db = await abrirBaseAlertas();
	try {
		return await new Promise((resolve, reject) => {
			const tx = db.transaction(ALERT_STORE, modo);
			const solicitud = operacion(tx.objectStore(ALERT_STORE));
			tx.oncomplete = () => resolve(solicitud?.result);
			tx.onerror = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}

async function avisarAClientes(mensaje) {
	const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
	clientes.forEach((cliente) => cliente.postMessage(mensaje));
}

function mostrarAvisoAlerta(titulo, cuerpo, tag) {
	return self.registration.showNotification(titulo, {
		body: cuerpo,
		icon: ALERT_ICON,
		badge: ALERT_ICON,
		tag: tag || 'sidii-alerta-respuesta',
		data: { url: './dashboard.html#alertas' },
	});
}

self.addEventListener('push', (event) => {
	let datos = {};
	try {
		datos = event.data ? event.data.json() : {};
	} catch {
		datos = { titulo: 'SIDII', mensaje: event.data ? event.data.text() : 'Tienes una nueva alerta.' };
	}
	const titulo = datos.titulo || 'SIDII';
	const maxAcciones = self.Notification?.maxActions ?? 2;
	const opciones = {
		body: datos.mensaje || 'Tienes una nueva alerta en SIDII.',
		icon: ALERT_ICON,
		badge: ALERT_ICON,
		tag: datos.tag || `sidii-alerta-${Date.now()}`,
		renotify: true,
		requireInteraction: Boolean(datos.requireInteraction),
		timestamp: datos.timestamp || Date.now(),
		vibrate: datos.severidad === 'critica' ? [200, 100, 200, 100, 200] : [150],
		actions: (datos.actions || []).slice(0, maxAcciones),
		data: {
			alertaId: datos.alertaId,
			url: datos.url || './dashboard.html#alertas',
			acciones: datos.acciones || {},
			token: datos.token,
		},
	};
	event.waitUntil(Promise.all([
		self.registration.showNotification(titulo, opciones),
		avisarAClientes({ type: 'SIDII_ALERTA_RECIBIDA', alertaId: datos.alertaId }),
	]));
});

async function abrirSIDII(url) {
	const destino = new URL(url || './dashboard.html#alertas', self.registration.scope).href;
	const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
	const existente = clientes.find((cliente) => new URL(cliente.url).origin === self.location.origin);
	if (existente) {
		await existente.focus();
		if ('navigate' in existente) return existente.navigate(destino);
		return existente;
	}
	return self.clients.openWindow(destino);
}

async function enviarAccionAlerta(alertaId, accion, token) {
	const response = await fetch(`${ALERT_API_BASE}/alertas/${encodeURIComponent(alertaId)}/accion-push`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ accion, token }),
	});
	const cuerpo = await response.json().catch(() => ({}));
	return { ok: response.ok, status: response.status, msg: cuerpo.msg };
}

async function guardarAccionPendiente(alertaId, accion, token) {
	await operarAccionesPendientes('readwrite', (store) => store.put({
		id: `${alertaId}:${accion}`,
		alertaId,
		accion,
		token,
		creada: Date.now(),
	}));
	if (self.registration.sync) {
		try {
			await self.registration.sync.register(ALERT_SYNC_TAG);
		} catch {
			// Sin Background Sync: la página enviará la cola al abrirse (mensaje SIDII_ENVIAR_ACCIONES).
		}
	}
}

async function ejecutarAccionDesdeNotificacion(datos, accion) {
	const tag = `sidii-alerta-${datos.alertaId}`;
	let resultado;
	try {
		resultado = await enviarAccionAlerta(datos.alertaId, accion, datos.token);
	} catch {
		resultado = null; // Sin conexión.
	}
	if (!resultado || resultado.status >= 500) {
		await guardarAccionPendiente(datos.alertaId, accion, datos.token);
		await mostrarAvisoAlerta('SIDII · sin conexión', 'Tu respuesta se guardó y se enviará en cuanto haya conexión.', tag);
		return;
	}
	// 401/403/409: token vencido, ya usado o alerta atendida por otra persona.
	await mostrarAvisoAlerta(
		resultado.ok ? 'SIDII ✓' : 'SIDII',
		resultado.msg || (resultado.ok ? 'Acción registrada.' : 'No se pudo completar la acción. Abre SIDII para revisarla.'),
		tag,
	);
	await avisarAClientes({ type: 'SIDII_ALERTA_ACTUALIZADA', alertaId: datos.alertaId });
}

async function enviarAccionesPendientes() {
	const pendientes = await operarAccionesPendientes('readonly', (store) => store.getAll()) || [];
	for (const pendiente of pendientes) {
		// Si sigue sin red, fetch lanza y Background Sync reintentará más tarde.
		const resultado = await enviarAccionAlerta(pendiente.alertaId, pendiente.accion, pendiente.token);
		if (resultado.status >= 500) throw new Error('Servidor no disponible');
		await operarAccionesPendientes('readwrite', (store) => store.delete(pendiente.id));
		await mostrarAvisoAlerta(
			resultado.ok ? 'SIDII ✓' : 'SIDII',
			resultado.msg || (resultado.ok ? 'Acción registrada.' : 'No se pudo completar la acción pendiente.'),
			`sidii-alerta-${pendiente.alertaId}`,
		);
		await avisarAClientes({ type: 'SIDII_ALERTA_ACTUALIZADA', alertaId: pendiente.alertaId });
	}
}

self.addEventListener('notificationclick', (event) => {
	const notificacion = event.notification;
	const datos = notificacion.data || {};
	const accion = event.action;
	notificacion.close();

	// Notificación local de sincronización offline (la crea js/alertas.js).
	if (datos.tipo === 'SINCRONIZACION_FALLIDA') {
		event.waitUntil(accion === 'reintentar'
			? avisarAClientes({ type: 'SIDII_REINTENTAR_SYNC' }).then(() => abrirSIDII('./dashboard.html'))
			: abrirSIDII('./dashboard.html'));
		return;
	}

	const definicion = accion ? datos.acciones?.[accion] : null;
	if (accion && definicion?.modo === 'servidor' && datos.alertaId && datos.token) {
		event.waitUntil(ejecutarAccionDesdeNotificacion(datos, accion));
		return;
	}
	const vista = definicion?.vista && definicion.vista !== 'alertas' ? definicion.vista : null;
	const url = vista ? `./dashboard.html#tab=${vista}` : (datos.url || './dashboard.html#alertas');
	event.waitUntil(abrirSIDII(url));
});

self.addEventListener('sync', (event) => {
	if (event.tag === ALERT_SYNC_TAG) event.waitUntil(enviarAccionesPendientes());
});

self.addEventListener('message', (event) => {
	if (event.data?.type === 'SIDII_ENVIAR_ACCIONES') {
		event.waitUntil(enviarAccionesPendientes().catch(() => {}));
	}
});

// El navegador renovó la suscripción: se informa al backend con el endpoint anterior.
self.addEventListener('pushsubscriptionchange', (event) => {
	event.waitUntil((async () => {
		const anterior = event.oldSubscription;
		const nueva = event.newSubscription || (anterior?.options
			? await self.registration.pushManager.subscribe(anterior.options)
			: null);
		if (!anterior?.endpoint || !nueva) return;
		await fetch(`${ALERT_API_BASE}/push/renovar`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ oldEndpoint: anterior.endpoint, subscription: nueva.toJSON() }),
		});
	})());
});

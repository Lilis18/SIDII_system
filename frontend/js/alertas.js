// Alertas de SIDII: suscripción Web Push, bandeja de alertas y acciones.
(() => {
	const apiBase = String(window.SIDII_API_BASE || 'http://localhost:5000/api').replace(/\/+$/, '');
	const SAVED_TAB_KEY = 'sidii_last_dashboard_tab';
	const pushSoportado = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
	const esDashboard = () => document.body?.dataset.page === 'dashboard';

	const estado = {
		filtro: 'activas',
		alertas: [],
		resaltar: null,
		endpointActual: null,
		pushConfigurado: true,
	};

	const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	})[character]);

	const api = (path, options) => window.SIDII.api(path, options, { queueOffline: false });

	// -----------------------------------------------------------------------
	// Enlaces desde notificaciones: dashboard.html#alertas, #alerta=<id>, #tab=<vista>
	// Se resuelve antes de que dasboard.js restaure la última pestaña guardada.
	// -----------------------------------------------------------------------
	function leerHash() {
		const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''));
		if (!hash) return null;
		if (hash === 'alertas') return { vista: 'alertas' };
		if (hash.startsWith('alerta=')) return { vista: 'alertas', alertaId: hash.slice(7) };
		if (hash.startsWith('tab=')) return { vista: hash.slice(4) };
		return null;
	}

	const destinoInicial = esDashboard() ? leerHash() : null;
	if (destinoInicial) {
		try {
			if (destinoInicial.vista === 'alertas') localStorage.removeItem(SAVED_TAB_KEY);
			else localStorage.setItem(SAVED_TAB_KEY, destinoInicial.vista);
		} catch {
			// Sin almacenamiento disponible: se abre la pestaña por defecto.
		}
		history.replaceState(null, '', window.location.pathname + window.location.search);
	}

	// -----------------------------------------------------------------------
	// Web Push
	// -----------------------------------------------------------------------
	function base64UrlAUint8(base64) {
		const relleno = '='.repeat((4 - (base64.length % 4)) % 4);
		const binario = atob((base64 + relleno).replace(/-/g, '+').replace(/_/g, '/'));
		return Uint8Array.from(binario, (caracter) => caracter.charCodeAt(0));
	}

	function bufferABase64Url(buffer) {
		if (!buffer) return '';
		return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	}

	async function registroSW() {
		const registro = await Promise.race([
			navigator.serviceWorker.ready,
			new Promise((resolve) => { window.setTimeout(() => resolve(null), 8000); }),
		]);
		if (!registro) throw new Error('El service worker de SIDII no está activo todavía. Recarga la página.');
		return registro;
	}

	async function estadoPush() {
		if (!pushSoportado) return 'no-soportado';
		if (Notification.permission === 'denied') return 'bloqueado';
		try {
			const registro = await navigator.serviceWorker.getRegistration();
			const suscripcion = await registro?.pushManager.getSubscription();
			estado.endpointActual = suscripcion?.endpoint || null;
			if (suscripcion && Notification.permission === 'granted') return 'activo';
		} catch {
			// Se considera inactivo.
		}
		return 'inactivo';
	}

	/**
	 * Crea la suscripción push. Si el navegador responde "push service error" (por ejemplo, porque quedó
	 * una suscripción vieja de llaves anteriores), la borra y lo intenta una vez más antes de avisar.
	 */
	async function crearSuscripcion(registro, publicKey) {
		const opciones = { userVisibleOnly: true, applicationServerKey: base64UrlAUint8(publicKey) };
		try {
			return await registro.pushManager.subscribe(opciones);
		} catch (error) {
			const esErrorDelServicio = error?.name === 'AbortError' || /push service/i.test(error?.message || '');
			if (!esErrorDelServicio) throw error;
			const vieja = await registro.pushManager.getSubscription();
			if (vieja) await vieja.unsubscribe().catch(() => {});
			await new Promise((resolve) => { window.setTimeout(resolve, 1000); });
			try {
				return await registro.pushManager.subscribe(opciones);
			} catch (segundoError) {
				console.warn('No se pudo crear la suscripción push:', segundoError);
				throw new Error('Tu navegador no pudo registrarse en su servicio de notificaciones. Borra los datos de este sitio (F12 → Application → Clear site data) y vuelve a intentarlo. Si usas Brave, activa "Usar servicios de Google para mensajes push"; si no, prueba con otro navegador o con otra red.');
			}
		}
	}

	async function suscribir({ pedirPermiso = false } = {}) {
		if (!pushSoportado) throw new Error('Este navegador no admite notificaciones push. En iPhone, instala SIDII en la pantalla de inicio (iOS 16.4 o superior).');
		if (Notification.permission === 'default' && pedirPermiso) await Notification.requestPermission();
		if (Notification.permission !== 'granted') {
			throw new Error(Notification.permission === 'denied'
				? 'Las notificaciones están bloqueadas. Actívalas desde la configuración del sitio en tu navegador.'
				: 'Necesitas permitir las notificaciones para recibir alertas.');
		}
		let publicKey;
		try {
			({ publicKey } = await api('/push/vapid-public-key'));
		} catch (error) {
			if (error.status === 503) estado.pushConfigurado = false;
			throw error;
		}
		const registro = await registroSW();
		let suscripcion = await registro.pushManager.getSubscription();
		if (suscripcion && bufferABase64Url(suscripcion.options?.applicationServerKey) !== publicKey) {
			await suscripcion.unsubscribe(); // Cambiaron las llaves VAPID del servidor.
			suscripcion = null;
		}
		if (!suscripcion) {
			suscripcion = await crearSuscripcion(registro, publicKey);
		}
		await api('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: suscripcion.toJSON() }) });
		estado.endpointActual = suscripcion.endpoint;
	}

	async function desuscribir() {
		const registro = await navigator.serviceWorker.getRegistration();
		const suscripcion = await registro?.pushManager.getSubscription();
		if (!suscripcion) return;
		try {
			await api('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: suscripcion.endpoint }) });
		} finally {
			await suscripcion.unsubscribe();
			estado.endpointActual = null;
		}
	}

	// Al cerrar sesión, este dispositivo deja de recibir alertas de esa cuenta.
	// Se usa la fase de captura para leer el token antes de que auth.js lo borre.
	document.addEventListener('click', (event) => {
		if (!event.target.closest?.('[data-logout]') || !estado.endpointActual) return;
		const token = localStorage.getItem('token');
		if (!token) return;
		fetch(`${apiBase}/push/unsubscribe`, {
			method: 'POST',
			keepalive: true,
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ endpoint: estado.endpointActual }),
		}).catch(() => {});
	}, true);

	// -----------------------------------------------------------------------
	// Bandeja de alertas
	// -----------------------------------------------------------------------
	const ETIQUETAS_ESTADO = {
		abierta: 'Abierta',
		pospuesta: 'Pospuesta',
		prorroga: 'En prórroga',
		revision: 'En revisión',
		resuelta: 'Resuelta',
		cerrada: 'Atendida',
		informativa: 'Aviso',
	};
	const ETIQUETAS_ACCION = {
		creada: 'Creada', actualizada: 'Datos actualizados', recordatorio: 'Recordatorio', resuelta: 'Resuelta automáticamente',
		prorroga_vencida: 'Prórroga vencida', aprobar_prorroga: 'Prórroga aprobada', rechazar_prorroga: 'Prórroga rechazada',
		solicitar_revision: 'Revisión solicitada', solicitar_prorroga: 'Prórroga solicitada', posponer: 'Pospuesta',
		confirmar_dato: 'Dato confirmado', hacer_admin: 'Ascendido a ADMIN', mantener_usuario: 'Se mantuvo como USER',
		reportar_cambio: 'Cambio reportado', marcar_atendida: 'Atendida',
	};
	const ACCIONES_CON_COMENTARIO = new Set(['solicitar_prorroga', 'solicitar_revision']);

	const formatoRelativo = new Intl.RelativeTimeFormat('es-MX', { numeric: 'auto' });
	function haceCuanto(fecha) {
		const segundos = (new Date(fecha).getTime() - Date.now()) / 1000;
		const pasos = [[60, 'second'], [60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'], [Infinity, 'year']];
		let valor = segundos;
		for (const [limite, unidad] of pasos) {
			if (Math.abs(valor) < limite) return formatoRelativo.format(Math.round(valor), unidad);
			valor /= limite;
		}
		return '';
	}

	// Mismo semáforo y mismos componentes visuales que Cargar datos y Gestión de datos (js/semaforo.js, css/dashboard.css).
	function semaforoDe(metadata) {
		if (!window.Semaforo || typeof metadata?.programado !== 'number' || typeof metadata?.realizado !== 'number') return null;
		return window.Semaforo.calcular(metadata.realizado, metadata.programado);
	}

	function barraSemaforo(sem) {
		if (!sem || sem.porcentaje === null) return '';
		const relleno = Math.max(0, Math.min(100, sem.porcentaje));
		return `<div class="alerta-semaforo">
			<span class="sem-badge" style="--sem:${escapeHTML(sem.hex)};--sem-tinta:${escapeHTML(sem.tinta)}" title="${escapeHTML(sem.texto)}">${escapeHTML(sem.nombre)} · ${escapeHTML(sem.porcentaje)} %</span>
			<div class="sem-barra" style="--sem:${escapeHTML(sem.hex)};--pct:${relleno}" role="img" aria-label="Cumplimiento ${escapeHTML(sem.porcentaje)} por ciento, ${escapeHTML(sem.nombre)}"><i></i></div>
		</div>`;
	}

	function tarjeta(alerta) {
		const historial = (alerta.historial || []).filter((item) => item.accion !== 'creada');
		const acciones = (alerta.acciones || []).map((accion) => `<button type="button" class="button button-small ${accion.modo === 'servidor' ? 'button-primary' : 'button-secondary'}" data-alerta-accion="${escapeHTML(accion.id)}" data-modo="${escapeHTML(accion.modo)}" data-vista="${escapeHTML(accion.vista || '')}">${escapeHTML(accion.titulo)}</button>`).join('');
		const extra = [
			alerta.metadata?.periodoNombre,
			alerta.prorrogaHasta && alerta.estado === 'prorroga' ? `Prórroga hasta ${new Date(alerta.prorrogaHasta).toLocaleDateString('es-MX')}` : '',
			alerta.pospuestaHasta && alerta.estado === 'pospuesta' ? `Se recordará ${haceCuanto(alerta.pospuestaHasta)}` : '',
		].filter(Boolean).map((texto) => `<span>${escapeHTML(texto)}</span>`).join('');
		const sem = semaforoDe(alerta.metadata);
		const colorSemaforo = sem && sem.porcentaje !== null ? ` style="--alerta-color:${escapeHTML(sem.hex)}"` : '';
		return `<article class="alerta-card severidad-${escapeHTML(alerta.severidad)} ${alerta.leida ? '' : 'no-leida'} ${estado.resaltar === alerta.id ? 'resaltada' : ''}"${colorSemaforo} id="alerta-${escapeHTML(alerta.id)}" data-alerta-id="${escapeHTML(alerta.id)}">
			<header class="alerta-card-header">
				<span class="alerta-chip">${escapeHTML(alerta.etiqueta)}</span>
				<span class="alerta-estado">${escapeHTML(ETIQUETAS_ESTADO[alerta.estado] || alerta.estado)}</span>
				<time datetime="${escapeHTML(alerta.actualizada)}">${escapeHTML(haceCuanto(alerta.actualizada))}</time>
			</header>
			<h3>${escapeHTML(alerta.titulo)}</h3>
			<p>${escapeHTML(alerta.mensaje)}</p>
			${barraSemaforo(sem)}
			${extra ? `<p class="alerta-meta">${extra}</p>` : ''}
			${historial.length ? `<details class="alerta-historial"><summary>Historial (${historial.length})</summary><ul>${historial.map((item) => `<li>${escapeHTML(ETIQUETAS_ACCION[item.accion] || item.accion)}${item.via === 'push' ? ' · desde la notificación' : ''} · ${escapeHTML(new Date(item.fecha).toLocaleString('es-MX'))}${item.comentario ? ` · “${escapeHTML(item.comentario)}”` : ''}</li>`).join('')}</ul></details>` : ''}
			<div class="alerta-acciones">${acciones}${alerta.leida ? '' : '<button type="button" class="button button-quiet button-small" data-alerta-leida>Marcar como leída</button>'}</div>
		</article>`;
	}

	async function textoPanelPush() {
		const situacion = await estadoPush();
		if (!estado.pushConfigurado) return { situacion: 'sin-servidor', texto: 'El servidor aún no tiene configuradas las notificaciones push. Las alertas se muestran solo aquí.' };
		const textos = {
			activo: 'Este dispositivo recibe alertas aunque SIDII esté cerrado. Puedes responder desde la propia notificación.',
			inactivo: 'Activa las notificaciones para recibir alertas y responderlas sin abrir SIDII.',
			bloqueado: 'Bloqueaste las notificaciones de SIDII. Actívalas desde la configuración del sitio en tu navegador.',
			'no-soportado': 'Este navegador no admite notificaciones push. En iPhone, instala SIDII en la pantalla de inicio (iOS 16.4 o superior).',
		};
		return { situacion, texto: textos[situacion] };
	}

	async function pintarPanelPush(contenedor) {
		const panel = contenedor.querySelector('#alertasPush');
		if (!panel) return;
		const { situacion, texto } = await textoPanelPush();
		panel.dataset.estado = situacion;
		panel.innerHTML = `<div><strong>Notificaciones push</strong><p>${escapeHTML(texto)}</p></div>
			<div class="action-row">
				${situacion === 'inactivo' ? '<button type="button" class="button button-primary button-small" data-push="activar">Activar notificaciones</button>' : ''}
				${situacion === 'activo' ? '<button type="button" class="button button-secondary button-small" data-push="probar">Enviar prueba</button><button type="button" class="button button-quiet button-small" data-push="desactivar">Desactivar</button>' : ''}
			</div>`;
	}

	function pintarLista(contenedor) {
		const lista = contenedor.querySelector('#alertasLista');
		if (!lista) return;
		lista.innerHTML = estado.alertas.length
			? estado.alertas.map(tarjeta).join('')
			: `<p class="alertas-vacio">${estado.filtro === 'activas' ? 'No tienes alertas pendientes. 🎉' : 'Aún no hay alertas en tu historial.'}</p>`;
		if (estado.resaltar) {
			lista.querySelector(`#alerta-${CSS.escape(estado.resaltar)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	}

	async function cargarAlertas(contenedor) {
		const mensaje = contenedor.querySelector('#alertasMensaje');
		try {
			const respuesta = await api(`/alertas?filtro=${estado.filtro}`);
			estado.alertas = Array.isArray(respuesta) ? respuesta : [];
			if (mensaje?.dataset.type !== 'success') window.SIDII.showMessage(mensaje, '');
		} catch (error) {
			window.SIDII.showMessage(mensaje, error.message || 'No se pudieron cargar las alertas.');
		}
		pintarLista(contenedor);
	}

	function abrirVista(vista) {
		document.querySelector(`#dashboardNav [data-tab="${CSS.escape(vista)}"]`)?.click();
	}

	async function ejecutarAccion(contenedor, alertaId, boton) {
		const { alertaAccion: accion, modo, vista } = boton.dataset;
		const mensaje = contenedor.querySelector('#alertasMensaje');
		if (modo === 'abrir') {
			api(`/alertas/${encodeURIComponent(alertaId)}/leida`, { method: 'POST' }).then(actualizarDistintivo).catch(() => {});
			if (vista && vista !== 'alertas') abrirVista(vista);
			return;
		}
		let comentario;
		if (ACCIONES_CON_COMENTARIO.has(accion)) {
			comentario = window.prompt('Comentario opcional para acompañar la solicitud:', '');
			if (comentario === null) return;
		}
		boton.disabled = true;
		try {
			const respuesta = await api(`/alertas/${encodeURIComponent(alertaId)}/accion`, {
				method: 'POST',
				body: JSON.stringify({ accion, comentario: comentario || undefined }),
			});
			window.SIDII.showMessage(mensaje, respuesta.msg || 'Acción registrada.', 'success');
			await cargarAlertas(contenedor);
			actualizarDistintivo();
		} catch (error) {
			window.SIDII.showMessage(mensaje, error.message || 'No se pudo completar la acción.');
			boton.disabled = false;
			if (error.status === 409) await cargarAlertas(contenedor);
		}
	}

	function render(contenedor) {
		contenedor.innerHTML = `<header class="section-heading"><p class="eyebrow">Seguimiento</p><h1>Alertas</h1></header>
			<section class="alertas-push" id="alertasPush" aria-live="polite"></section>
			<div class="alertas-toolbar">
				<div class="alertas-filtros" role="tablist" aria-label="Filtrar alertas">
					<button type="button" role="tab" data-filtro="activas" aria-selected="${estado.filtro === 'activas'}">Pendientes</button>
					<button type="button" role="tab" data-filtro="todas" aria-selected="${estado.filtro === 'todas'}">Historial</button>
				</div>
				<button type="button" class="button button-quiet button-small" data-alertas-leidas>Marcar todas como leídas</button>
			</div>
			<p class="inline-message" id="alertasMensaje" role="status" hidden></p>
			<div class="alertas-lista" id="alertasLista"><p class="alertas-vacio">Cargando alertas...</p></div>`;
		void pintarPanelPush(contenedor);
		void cargarAlertas(contenedor);
	}

	function enlazarEventos(contenedor) {
		contenedor.addEventListener('click', async (event) => {
			const filtro = event.target.closest('[data-filtro]');
			const pushBoton = event.target.closest('[data-push]');
			const accion = event.target.closest('[data-alerta-accion]');
			const leida = event.target.closest('[data-alerta-leida]');
			const todas = event.target.closest('[data-alertas-leidas]');
			const mensaje = contenedor.querySelector('#alertasMensaje');

			if (filtro) {
				estado.filtro = filtro.dataset.filtro;
				contenedor.querySelectorAll('[data-filtro]').forEach((boton) => boton.setAttribute('aria-selected', String(boton === filtro)));
				await cargarAlertas(contenedor);
			} else if (pushBoton) {
				pushBoton.disabled = true;
				try {
					if (pushBoton.dataset.push === 'activar') {
						await suscribir({ pedirPermiso: true });
						window.SIDII.showMessage(mensaje, 'Notificaciones activadas en este dispositivo.', 'success');
					} else if (pushBoton.dataset.push === 'probar') {
						const respuesta = await api('/push/prueba', { method: 'POST' });
						window.SIDII.showMessage(mensaje, respuesta.msg, 'success');
					} else if (pushBoton.dataset.push === 'desactivar') {
						await desuscribir();
						window.SIDII.showMessage(mensaje, 'Este dispositivo ya no recibirá notificaciones push.', 'success');
					}
				} catch (error) {
					window.SIDII.showMessage(mensaje, error.message || 'No se pudo completar la operación.');
				}
				await pintarPanelPush(contenedor);
			} else if (accion) {
				await ejecutarAccion(contenedor, accion.closest('[data-alerta-id]').dataset.alertaId, accion);
			} else if (leida) {
				const tarjetaAlerta = leida.closest('[data-alerta-id]');
				try {
					await api(`/alertas/${encodeURIComponent(tarjetaAlerta.dataset.alertaId)}/leida`, { method: 'POST' });
					tarjetaAlerta.classList.remove('no-leida');
					leida.remove();
					actualizarDistintivo();
				} catch (error) {
					window.SIDII.showMessage(mensaje, error.message || 'No se pudo marcar la alerta.');
				}
			} else if (todas) {
				try {
					await api('/alertas/leidas', { method: 'POST' });
					await cargarAlertas(contenedor);
					actualizarDistintivo();
				} catch (error) {
					window.SIDII.showMessage(mensaje, error.message || 'No se pudieron marcar las alertas.');
				}
			}
		});
	}

	// -----------------------------------------------------------------------
	// Pestaña del dashboard y distintivo
	// -----------------------------------------------------------------------
	function activarPestana() {
		document.querySelectorAll('#dashboardNav [data-tab]').forEach((boton) => {
			const activo = boton.dataset.tab === 'alertas';
			boton.classList.toggle('is-active', activo);
			boton.setAttribute('aria-current', activo ? 'page' : 'false');
		});
		document.querySelectorAll('[data-view]').forEach((vista) => vista.classList.toggle('is-active', vista.dataset.view === 'alertas'));
		document.querySelector('#dashboardNav')?.classList.remove('is-open');
		document.querySelector('#menuToggle')?.setAttribute('aria-expanded', 'false');
		render(document.querySelector('#view-alertas'));
	}

	async function actualizarDistintivo() {
		const distintivo = document.querySelector('#alertasBadge');
		if (!distintivo || !localStorage.getItem('token') || !navigator.onLine) return;
		try {
			const { total = 0, porSeveridad = {} } = await api('/alertas/resumen');
			distintivo.textContent = total > 99 ? '99+' : String(total);
			distintivo.hidden = total === 0;
			distintivo.dataset.critica = String(Boolean(porSeveridad.critica));
			distintivo.setAttribute('aria-label', `${total} alertas sin leer`);
		} catch {
			// El distintivo es informativo; se reintenta en el siguiente ciclo.
		}
	}

	function refrescarSiVisible() {
		const vista = document.querySelector('#view-alertas');
		if (vista?.classList.contains('is-active')) void cargarAlertas(vista);
		void actualizarDistintivo();
	}

	// Aviso del sistema operativo cuando la cola offline no pudo sincronizarse y SIDII está en segundo plano.
	window.addEventListener('sidii:offline-sync', async (event) => {
		const { pending, authRequired } = event.detail || {};
		if (!pending || document.visibilityState === 'visible' || !pushSoportado || Notification.permission !== 'granted') return;
		try {
			const registro = await navigator.serviceWorker.getRegistration();
			await registro?.showNotification('SIDII · cambios sin sincronizar', {
				body: authRequired
					? 'Tienes capturas pendientes. Inicia sesión en línea para sincronizarlas.'
					: `Quedan ${pending} captura(s) sin enviar. Se reintentará al recuperar la conexión.`,
				icon: new URL('./public/icon-192.png', window.location.href).href,
				tag: 'sidii-sync',
				actions: authRequired ? [] : [{ action: 'reintentar', title: 'Reintentar ahora' }],
				data: { tipo: 'SINCRONIZACION_FALLIDA' },
			});
		} catch {
			// Sin notificaciones disponibles: el aviso en pantalla de pwa.js es suficiente.
		}
	});

	function enviarAccionesPendientesDelSW() {
		navigator.serviceWorker?.controller?.postMessage({ type: 'SIDII_ENVIAR_ACCIONES' });
	}

	function iniciar() {
		if (!esDashboard() || !localStorage.getItem('token')) return;
		const vista = document.querySelector('#view-alertas');
		const nav = document.querySelector('#dashboardNav');
		if (!vista || !nav) return;

		enlazarEventos(vista);
		nav.addEventListener('click', (event) => {
			if (event.target.closest('[data-tab="alertas"]')) activarPestana();
		});

		if (destinoInicial?.vista === 'alertas') {
			estado.resaltar = destinoInicial.alertaId || null;
			activarPestana();
		}
		// Notificación tocada con SIDII ya abierto: el Service Worker solo cambia el hash.
		window.addEventListener('hashchange', () => {
			const destino = leerHash();
			if (!destino) return;
			history.replaceState(null, '', window.location.pathname + window.location.search);
			if (destino.vista === 'alertas') {
				estado.resaltar = destino.alertaId || null;
				activarPestana();
			} else {
				abrirVista(destino.vista);
			}
		});

		void actualizarDistintivo();
		window.setInterval(() => {
			if (document.visibilityState === 'visible') void actualizarDistintivo();
		}, 60000);
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') refrescarSiVisible();
		});

		if (pushSoportado) {
			navigator.serviceWorker.addEventListener('message', (event) => {
				const tipo = event.data?.type;
				if (tipo === 'SIDII_ALERTA_RECIBIDA' || tipo === 'SIDII_ALERTA_ACTUALIZADA') refrescarSiVisible();
				if (tipo === 'SIDII_REINTENTAR_SYNC') void window.SIDII.syncOfflineQueue?.();
			});
			// Mantener la suscripción al día sin volver a pedir permiso.
			if (Notification.permission === 'granted') suscribir().catch(() => {});
			navigator.permissions?.query({ name: 'notifications' }).then((permiso) => {
				permiso.onchange = () => {
					if (Notification.permission === 'granted') suscribir().catch(() => {});
					const panel = document.querySelector('#view-alertas.is-active');
					if (panel) void pintarPanelPush(panel);
				};
			}).catch(() => {});
			if (navigator.onLine) enviarAccionesPendientesDelSW();
			window.addEventListener('online', enviarAccionesPendientesDelSW);
		}
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', iniciar, { once: true });
	} else {
		iniciar();
	}

	window.SIDII = window.SIDII || {};
	window.SIDII.alertas = { suscribir, desuscribir, actualizarDistintivo };
})();

if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
	const serviceWorkerUrl = new URL('./service-worker.js', window.location.href);
	try {
		if (window.SIDII_API_BASE) {
			serviceWorkerUrl.searchParams.set('apiOrigin', new URL(window.SIDII_API_BASE).origin);
		}
	} catch (error) {
		console.error('No se pudo configurar el origen de API para el service worker:', error);
	}

	navigator.serviceWorker.register(serviceWorkerUrl.href).catch((error) => {
		console.error('No se pudo registrar el service worker de SIDII:', error);
	});
}

function showConnectionStatus(message) {
	let status = document.querySelector('#sidiiConnectionStatus');
	if (!status) {
		status = document.createElement('div');
		status.id = 'sidiiConnectionStatus';
		status.className = 'connection-status';
		status.setAttribute('role', 'status');
		status.setAttribute('aria-live', 'polite');
		document.body.prepend(status);
	}
	status.textContent = message;
	status.hidden = !message;
}

function updateConnectionStatus() {
	showConnectionStatus(navigator.onLine ? '' : 'Sin conexión a internet. Puedes consultar los últimos datos guardados y capturar cambios offline.');
}

window.addEventListener('online', () => {
	showConnectionStatus('Conexión restablecida. Sincronizando los cambios pendientes...');
	window.setTimeout(updateConnectionStatus, 5000);
});
window.addEventListener('offline', updateConnectionStatus);
window.addEventListener('sidii:offline-sync', (event) => {
	const { synchronized, pending, authRequired, error } = event.detail;
	showConnectionStatus(pending
		? (authRequired
			? 'Hay cambios pendientes. Inicia sesión en línea para actualizar tu sesión y sincronizarlos.'
			: 'No se pudieron sincronizar todos los cambios. Se volverá a intentar al recuperar la conexión.')
		: (error ? 'No se pudo revisar la cola offline.' : `Conexión restablecida. ${synchronized} cambio(s) sincronizado(s).`));
	window.setTimeout(updateConnectionStatus, 5000);
});

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', updateConnectionStatus, { once: true });
} else {
	updateConnectionStatus();
}
function showOfflineAuthWarning() {
	if (!sessionStorage.getItem('sidii.offlineAuthWarning')) return;
	sessionStorage.removeItem('sidii.offlineAuthWarning');
	showConnectionStatus('Sesión iniciada, pero no se pudo habilitar el inicio offline en este dispositivo.');
	window.setTimeout(updateConnectionStatus, 7000);
}
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', showOfflineAuthWarning, { once: true });
} else {
	showOfflineAuthWarning();
}

async function solicitarPermisoNotificaciones() {
	if (!('Notification' in window)) return 'unsupported';
	if (Notification.permission !== 'default') return Notification.permission;

	try {
		return await Notification.requestPermission();
	} catch (error) {
		console.error('No se pudo solicitar permiso para notificaciones:', error);
		return 'denied';
	}
}

window.mostrarNotificacion = (titulo, cuerpo) => {
	if (!('Notification' in window) || Notification.permission !== 'granted') return false;

	try {
		const notification = new Notification(String(titulo), {
			body: String(cuerpo),
			icon: new URL('./public/icon-192.png', window.location.href).href,
			tag: 'sidii-local-notification',
		});
		notification.onclick = () => window.focus();
		return true;
	} catch (error) {
		console.warn('El navegador no pudo mostrar la notificación local:', error);
		return false;
	}
};

function requestDashboardNotificationPermission() {
	if (document.body?.dataset.page === 'dashboard') {
		void solicitarPermisoNotificaciones();
	}
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', requestDashboardNotificationPermission, { once: true });
} else {
	requestDashboardNotificationPermission();
}

let installPrompt;

window.addEventListener('beforeinstallprompt', (event) => {
	event.preventDefault();
	installPrompt = event;

	const installButton = document.createElement('button');
	installButton.className = 'pwa-install-button';
	installButton.type = 'button';
	installButton.textContent = 'Instalar SIDII';
	installButton.setAttribute('aria-label', 'Instalar SIDII en este dispositivo');
	installButton.addEventListener('click', async () => {
		await installPrompt.prompt();
		await installPrompt.userChoice;
		installPrompt = null;
		installButton.remove();
	});
	document.body.append(installButton);
});

window.addEventListener('appinstalled', () => {
	document.querySelector('.pwa-install-button')?.remove();
});
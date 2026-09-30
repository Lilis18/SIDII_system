if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
	navigator.serviceWorker.register('./service-worker.js').catch((error) => {
		console.error('No se pudo registrar el service worker de SIDII:', error);
	});
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
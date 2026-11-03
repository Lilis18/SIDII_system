document.addEventListener('DOMContentLoaded', () => {
	const form = document.querySelector('#loginForm');
	if (!form) return;

	const password = document.querySelector('#password');
	const toggle = document.querySelector('#togglePassword');
	const submit = form.querySelector('[type="submit"]');
	const message = document.querySelector('#loginMessage');
	const registerLink = document.querySelector('#registerLink');

	toggle?.addEventListener('click', () => {
		const showing = password.type === 'text';
		password.type = showing ? 'password' : 'text';
		toggle.setAttribute('aria-label', showing ? 'Mostrar contraseña' : 'Ocultar contraseña');
		toggle.setAttribute('aria-pressed', String(!showing));
	});

	if (navigator.onLine) {
		window.SIDII.api('/auth/super-admin-exists')
			.then((data) => {
				if (registerLink) registerLink.hidden = Boolean(data.exists);
			})
			.catch((error) => console.error('No se pudo comprobar el registro inicial:', error));
	}

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		window.SIDII.showMessage(message, '');
		submit.disabled = true;
		submit.textContent = 'Ingresando...';
		const email = form.elements.correo.value.trim();

		try {
			if (!navigator.onLine) {
				const authenticated = await window.SIDII.authenticateOffline(email, password.value);
				if (!authenticated) {
					throw new Error('Sin conexión: solo puede ingresar el usuario autenticado previamente en este dispositivo y con su contraseña correcta.');
				}
			} else {
				try {
					const data = await window.SIDII.api('/auth/login', {
						method: 'POST',
						body: JSON.stringify({ email, password: password.value }),
					});
					window.SIDII.saveSession(data, email);
					try {
						await window.SIDII.rememberOfflineLogin(email, password.value, data);
					} catch (error) {
						console.error('No se pudo habilitar el inicio de sesión offline:', error);
						sessionStorage.setItem('sidii.offlineAuthWarning', 'true');
					}
				} catch (error) {
					if (error.status) throw error;
					const authenticated = await window.SIDII.authenticateOffline(email, password.value);
					if (!authenticated) {
						throw new Error('No fue posible conectar y no hay credenciales offline válidas para este usuario en este dispositivo.');
					}
				}
			}
			window.location.href = 'dashboard.html';
		} catch (error) {
			window.SIDII.showMessage(message, error.message || 'Error de conexión con el servidor.');
		} finally {
			submit.disabled = false;
			submit.textContent = 'Ingresar';
		}
	});
});

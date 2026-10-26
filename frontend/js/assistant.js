(() => {
	const apiBase = String(window.SIDII_API_BASE || 'http://localhost:5000/api').replace(/\/+$/, '');
	const answers = [
		{
			match: /contrase|password/,
			text: 'En el panel, abre “Cambiar contraseña”. Escribe tu contraseña actual, define la nueva y confirma el cambio. Al terminar, SIDII cerrará la sesión y tendrás que ingresar de nuevo.',
			page: 'cambiar-contrasena.html',
		},
		{
			match: /periodo|mes|cuatrimestre/,
			text: () => {
				const month = new Intl.DateTimeFormat('es-MX', {
					timeZone: 'America/Mexico_City',
					month: 'long',
				}).format(new Date());
				const monthNumber = Number(new Intl.DateTimeFormat('en-US', {
					timeZone: 'America/Mexico_City',
					month: 'numeric',
				}).format(new Date()));
				const period = monthNumber <= 4 ? 'Enero - Abril' : monthNumber <= 8 ? 'Mayo - Agosto' : 'Septiembre - Diciembre';
				return `En ${month}, el periodo vigente es ${period}. Los otros periodos solo se habilitan mediante un override de SUPER ADMIN.`;
			},
			tab: 'perfil',
			notification: true,
		},
		{
			match: /evidencia|pdf|firma|documento/,
			text: 'Abre “Cargar evidencias”, completa los datos, adjunta los PDF y las firmas si las tienes, y selecciona “Generar y unir PDF”. La generación de PDF requiere que la biblioteca externa haya cargado.',
			tab: 'evidencias',
		},
		{
			match: /grafica|gr[aá]fico|reporte|imprimir|exportar/,
			text: 'En “Visualizador de gráficas” puedes filtrar por periodo y tipo. Usa “Imprimir / Guardar PDF” para elegir las gráficas que necesitas exportar.',
			tab: 'graficos',
		},
		{
			match: /editar|eliminar|modificar|registros existentes/,
			text: 'Abre “Gestión de datos” para consultar, editar o eliminar registros. Al editar, los campos disponibles dependen del periodo vigente y de los overrides configurados.',
			tab: 'edicion',
		},
		{
			match: /usuario|admin|rol|permiso|registr/,
			text: 'SUPER ADMIN puede gestionar usuarios y cambiar roles. ADMIN puede registrar usuarios. Desde “Perfil”, usa “Registrar usuario” o “Gestionar usuarios” según tu rol.',
			tab: 'perfil',
		},
		{
			match: /captur|carg|guardar|indicador|programado|realizado/,
			text: 'En “Cargar datos”, elige tipo y subtipo, completa el resumen y el indicador, captura los valores del periodo habilitado y selecciona “Guardar datos”.',
			tab: 'cargar',
		},
		{
			match: /iniciar sesi[oó]n|login|entrar|acceso|cuenta/,
			text: 'Para entrar, usa tu correo institucional y contraseña en la pantalla de inicio. Si no tienes cuenta, solicita el registro a un administrador.',
			page: 'login.html',
		},
		{
			match: /conexi[oó]n|sin internet|offline|instalar|instalaci[oó]n/,
			text: 'SIDII puede abrir su interfaz sin conexión si ya se había cargado, pero iniciar sesión, consultar datos y generar algunos documentos requiere internet.',
		},
	];

	function normalize(value) {
		return value.toLocaleLowerCase('es-MX').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
	}

	async function chatRequest(endpoint, options = {}) {
		const token = localStorage.getItem('token');
		if (!token) throw new Error('Se requiere una sesión para acceder al historial.');

		const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) };
		if (options.body) headers['Content-Type'] = 'application/json';
		const controller = new AbortController();
		const timeout = window.setTimeout(() => controller.abort(), 10000);

		try {
			const response = await fetch(`${apiBase}/chat/${endpoint}`, {
				...options,
				headers,
				signal: controller.signal,
			});
			const result = await response.json().catch(() => null);
			if (!response.ok) throw new Error(result?.msg || 'No se pudo completar la solicitud del chat.');
			return result;
		} finally {
			window.clearTimeout(timeout);
		}
	}

	function getAnswer(question) {
		const normalized = normalize(question);
		const answer = answers.find((item) => item.match.test(normalized));
		if (!answer) {
			return {
				text: 'Puedo orientar sobre inicio de sesión, usuarios, periodos, captura de datos, evidencias PDF, gráficas y edición. ¿Cuál de esos temas necesitas?',
			};
		}
		return { ...answer, text: typeof answer.text === 'function' ? answer.text() : answer.text };
	}

	function mountAssistant() {
		if (document.querySelector('.assistant-launcher')) return;

		const stylesheet = document.createElement('link');
		stylesheet.rel = 'stylesheet';
		stylesheet.href = 'css/assistant.css';
		document.head.append(stylesheet);

		const widget = document.createElement('section');
		widget.className = 'assistant-widget';
		widget.innerHTML = `
			<button class="assistant-launcher" type="button" aria-expanded="false" aria-controls="assistantPanel" aria-label="Abrir ayuda SIDII">
				<span aria-hidden="true">?</span><span>Ayuda</span>
			</button>
			<section class="assistant-panel" id="assistantPanel" role="dialog" aria-label="Asistente de ayuda SIDII" hidden>
				<header class="assistant-header">
					<div><p>Prototipo</p><h2>Ayuda SIDII</h2></div>
					<button class="assistant-close" type="button" aria-label="Cerrar ayuda">×</button>
				</header>
				<div class="assistant-messages" role="log" aria-live="polite" aria-relevant="additions">
					<p class="assistant-message assistant-message--bot">Hola. Puedo guiarte por la página y responder dudas frecuentes. ¿Qué necesitas hacer?</p>
				</div>
				<p class="assistant-status" role="status" aria-live="polite" hidden></p>
				<div class="assistant-suggestions" aria-label="Preguntas frecuentes">
					<button type="button" data-question="¿Cómo cargo datos?">Cargar datos</button>
					<button type="button" data-question="¿Qué periodo está activo?">Periodo activo</button>
					<button type="button" data-question="¿Cómo genero un PDF?">Generar PDF</button>
				</div>
				<form class="assistant-form">
					<label class="assistant-sr-only" for="assistantInput">Escribe tu pregunta</label>
					<input id="assistantInput" name="question" type="text" maxlength="240" placeholder="Escribe tu pregunta" autocomplete="off" required>
					<button type="submit" aria-label="Enviar pregunta">Enviar</button>
				</form>
			</section>`;
		document.body.append(widget);

		const launcher = widget.querySelector('.assistant-launcher');
		const panel = widget.querySelector('.assistant-panel');
		const closeButton = widget.querySelector('.assistant-close');
		const messageList = widget.querySelector('.assistant-messages');
		const status = widget.querySelector('.assistant-status');
		const form = widget.querySelector('.assistant-form');
		const input = widget.querySelector('#assistantInput');
		const suggestionButtons = [...widget.querySelectorAll('[data-question]')];
		const submitButton = form.querySelector('[type="submit"]');

		function setBusy(busy) {
			input.disabled = busy;
			submitButton.disabled = busy;
			suggestionButtons.forEach((button) => { button.disabled = busy; });
		}

		function showStatus(message) {
			status.textContent = message;
			status.hidden = !message;
		}

		function setOpen(open) {
			panel.hidden = !open;
			launcher.setAttribute('aria-expanded', String(open));
			if (open) input.focus();
			else launcher.focus();
		}

		function addMessage(text, kind, answer = null) {
			const message = document.createElement('p');
			message.className = `assistant-message assistant-message--${kind}`;
			message.textContent = text;
			messageList.append(message);

			if (answer?.tab && document.querySelector(`[data-tab="${answer.tab}"]`)) {
				const action = document.createElement('button');
				action.className = 'assistant-action';
				action.type = 'button';
				action.textContent = 'Abrir esta sección';
				action.addEventListener('click', () => {
					document.querySelector(`[data-tab="${answer.tab}"]`).click();
					setOpen(false);
				});
				message.append(action);
			} else if (answer?.page && localStorage.getItem('token')) {
				const action = document.createElement('a');
				action.className = 'assistant-action';
				action.href = answer.page;
				action.textContent = answer.page === 'login.html' ? 'Ir al inicio de sesión' : 'Abrir cambio de contraseña';
				message.append(action);
			}

			messageList.scrollTop = messageList.scrollHeight;
		}

		async function persistMessage(mensaje, rol) {
			if (!localStorage.getItem('token')) return true;
			try {
				await chatRequest('save', {
					method: 'POST',
					body: JSON.stringify({ mensaje, rol }),
				});
				return true;
			} catch (error) {
				console.error('No se pudo guardar el mensaje del asistente:', error);
				return false;
			}
		}

		async function loadHistory() {
			if (!localStorage.getItem('token')) return;
			setBusy(true);
			try {
				const history = await chatRequest('history');
				if (!Array.isArray(history)) throw new Error('La respuesta del historial no es válida.');
				const validMessages = history.filter((entry) =>
					typeof entry.mensaje === 'string' && ['usuario', 'bot'].includes(entry.rol),
				);
				if (validMessages.length) {
					messageList.replaceChildren();
					validMessages.forEach((entry) => addMessage(entry.mensaje, entry.rol === 'usuario' ? 'user' : 'bot'));
				}
			} catch (error) {
				console.error('No se pudo cargar el historial del asistente:', error);
				showStatus('No se pudo recuperar el historial. Puedes seguir usando la ayuda.');
			} finally {
				setBusy(false);
			}
		}

		async function submitQuestion(question) {
			const cleanQuestion = question.trim();
			if (!cleanQuestion) return;
			setBusy(true);
			showStatus('');
			try {
				addMessage(cleanQuestion, 'user');
				const userMessageSaved = await persistMessage(cleanQuestion, 'usuario');
				const answer = getAnswer(cleanQuestion);
				addMessage(answer.text, 'bot', answer);
				if (answer.notification) {
					window.mostrarNotificacion?.('SIDII', 'El Chatbot Asistente tiene una sugerencia normativa para ti');
				}
				const botMessageSaved = await persistMessage(answer.text, 'bot');
				if (!userMessageSaved || !botMessageSaved) {
					showStatus('No se pudo guardar parte de esta conversación. Revisa tu conexión e inténtalo de nuevo.');
				}
			} finally {
				setBusy(false);
			}
		}

		launcher.addEventListener('click', () => setOpen(panel.hidden));
		closeButton.addEventListener('click', () => setOpen(false));
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			void submitQuestion(input.value);
			input.value = '';
		});
		suggestionButtons.forEach((button) => {
			button.addEventListener('click', () => { void submitQuestion(button.dataset.question); });
		});
		document.addEventListener('keydown', (event) => {
			if (event.key === 'Escape' && !panel.hidden) setOpen(false);
		});
		void loadHistory();
	}

	document.addEventListener('DOMContentLoaded', mountAssistant, { once: true });
	window.addEventListener('offline', () => {
		window.mostrarNotificacion?.('SIDII', 'La aplicación detectó que te quedaste sin conexión. Algunas funciones no estarán disponibles.');
	});
})();
document.addEventListener('DOMContentLoaded', async () => {
	const dashboard = document.querySelector('[data-page="dashboard"]');
	if (!dashboard || !window.SIDII.requireSession()) return;

	const name = localStorage.getItem('nombre') || 'Usuario';
	const role = localStorage.getItem('role') || 'USER';
	const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';
	const forcedPeriods = new Set();
	const periodNames = ['Enero - Abril', 'Mayo - Agosto', 'Septiembre - Diciembre'];
	const menu = document.querySelector('#dashboardNav');
	const menuToggle = document.querySelector('#menuToggle');
	const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	})[character]);

	const periodIsCurrent = (index) => {
		const month = new Date().getMonth() + 1;
		return month >= index * 4 + 1 && month <= index * 4 + 4;
	};
	const periodEnabled = (index) => periodIsCurrent(index) || forcedPeriods.has(index);
	window.SIDII.periodIsEnabled = periodEnabled;

	function renderProfile() {
		const actions = isAdmin ? `<section class="admin-tools"><div class="section-heading"><p class="eyebrow">Administración</p><h2>Accesos y periodos</h2></div>
			<div class="action-row">${role === 'SUPER_ADMIN' ? '<a class="button button-secondary" href="usuarios-admin.html">Gestionar usuarios</a>' : ''}<a class="button button-secondary" href="register.html">Registrar usuario</a></div>
			${role === 'SUPER_ADMIN' ? `<div class="period-controls">${periodNames.map((period, index) => `<button class="button button-secondary" type="button" data-period="${index}" ${periodIsCurrent(index) ? 'disabled' : ''}>${periodIsCurrent(index) ? 'Periodo vigente' : periodEnabled(index) ? 'Deshabilitar' : 'Habilitar'} ${period}</button>`).join('')}</div>` : ''}
			<p class="inline-message" id="periodMessage" role="status" hidden></p>
		</section>` : '';
		document.querySelector('#view-perfil').innerHTML = `<header class="section-heading"><p class="eyebrow">Cuenta</p><h1>Perfil</h1></header>
			<section class="profile-summary"><div><span class="field-caption">Nombre</span><strong>${escapeHTML(name)}</strong></div><div><span class="field-caption">Rol</span><strong>${escapeHTML(role)}</strong></div><a class="button button-secondary" href="cambiar-contrasena.html">Cambiar contraseña</a></section>${actions}`;
	}

	async function loadPeriods() {
		try {
			const response = await window.SIDII.api('/periods');
			(response.forcedPeriods || []).forEach((index) => forcedPeriods.add(index));
			renderProfile();
		} catch (error) {
			console.error('No se pudieron cargar los periodos:', error);
		}
	}

	document.querySelector('#view-perfil').addEventListener('click', async (event) => {
		const button = event.target.closest('[data-period]');
		if (!button || !isAdmin) return;
		const index = Number(button.dataset.period);
		const message = document.querySelector('#periodMessage');
		const enabled = !periodEnabled(index);
		button.disabled = true;
		try {
			const result = await window.SIDII.api('/periods', {
				method: 'PUT',
				body: JSON.stringify({ index, habilitado: enabled }),
			});
			forcedPeriods.clear();
			(result.forcedPeriods || []).forEach((item) => forcedPeriods.add(item));
			renderProfile();
			window.SIDII.showMessage(document.querySelector('#periodMessage'), 'Periodos actualizados.', 'success');
		} catch (error) {
			window.SIDII.showMessage(message, error.message || 'No se pudo actualizar el periodo.');
			button.disabled = false;
		}
	});

	function changeTab(tab) {
		document.querySelectorAll('[data-tab]').forEach((button) => {
			const active = button.dataset.tab === tab;
			button.classList.toggle('is-active', active);
			button.setAttribute('aria-current', active ? 'page' : 'false');
		});
		document.querySelectorAll('[data-view]').forEach((view) => {
			view.classList.toggle('is-active', view.dataset.view === tab);
		});
		menu.classList.remove('is-open');
		menuToggle.setAttribute('aria-expanded', 'false');

		const view = document.querySelector(`#view-${tab}`);
		if (tab === 'cargar') window.SIDII.renderCargaDeDatos(view);
		if (tab === 'edicion') window.SIDII.renderGestionDatos(view);
		if (tab === 'evidencias') window.SIDII.renderEvidencias(view);
		if (tab === 'graficos') window.SIDII.renderGraficos(view);
	}

	menu.addEventListener('click', (event) => {
		const button = event.target.closest('[data-tab]');
		if (button) changeTab(button.dataset.tab);
	});
	menuToggle.addEventListener('click', () => {
		const open = menu.classList.toggle('is-open');
		menuToggle.setAttribute('aria-expanded', String(open));
	});

	renderProfile();
	await loadPeriods();
});

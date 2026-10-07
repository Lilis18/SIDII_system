(() => {
	const periods = ['Enero - Abril', 'Mayo - Agosto', 'Septiembre - Diciembre'];
	const subtypes = {
		componente: Array.from({ length: 5 }, (_, index) => `Componente ${index + 1}`),
		actividad: Array.from({ length: 15 }, (_, index) => `Actividad ${Math.floor(index / 3) + 1}.${index % 3 + 1}`),
		fin: [],
		proposito: [],
	};

	const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	})[character]);

	function renderPeriodRows(container, existing = []) {
		container.innerHTML = periods.map((name, index) => {
			const old = existing.find((period) => period.nombre === name) || {};
			const disabled = !window.SIDII.periodIsEnabled(index);
			return `<tr><td data-label="Periodo">${name}</td><td data-label="Programado"><input type="number" min="0" step="any" name="programado${index}" value="${escapeHTML(old.programado ?? '')}" ${disabled ? 'disabled' : ''}></td><td data-label="Realizado"><input type="number" min="0" step="any" name="realizado${index}" value="${escapeHTML(old.realizado ?? '')}" ${disabled ? 'disabled' : ''}></td></tr>`;
		}).join('');
	}

	function renderLoad(container) {
		container.innerHTML = `<header class="section-heading"><p class="eyebrow">Captura</p><h1>Cargar datos</h1></header>
			<form id="dataEntryForm" class="data-form">
				<div class="form-grid">
					<label>Tipo de dato<select name="tipo" required><option value="">Selecciona</option><option value="componente">Componente</option><option value="actividad">Actividad</option><option value="fin">Fin</option><option value="proposito">Propósito</option></select></label>
					<label id="subtypeField" hidden>Subtipo<select name="subtipo"><option value="">Selecciona</option></select></label>
					<label class="span-all">Resumen narrativo<input name="resumen" type="text" required maxlength="500"></label>
					<label class="span-all">Indicador<input name="indicador" type="text" required maxlength="500"></label>
				</div>
				<div class="table-scroll"><table class="data-table period-table"><thead><tr><th>Periodo</th><th>Programado</th><th>Realizado</th></tr></thead><tbody id="entryPeriods"></tbody></table></div>
				<p class="inline-message" id="entryMessage" role="status" hidden></p>
				<button class="button button-primary" type="submit">Guardar datos</button>
			</form>`;

		const form = container.querySelector('#dataEntryForm');
		const typeField = form.elements.tipo;
		const subtypeField = container.querySelector('#subtypeField');
		const subtypeSelect = form.elements.subtipo;
		const periodBody = container.querySelector('#entryPeriods');
		window.SIDII.showMessage(container.querySelector('#entryMessage'), '');
		renderPeriodRows(periodBody);

		typeField.addEventListener('change', () => {
			const options = subtypes[typeField.value] || [];
			subtypeField.hidden = options.length === 0;
			subtypeSelect.required = options.length > 0;
			subtypeSelect.innerHTML = '<option value="">Selecciona</option>' + options.map((item) => `<option value="${escapeHTML(item)}">${escapeHTML(item)}</option>`).join('');
		});

		form.addEventListener('submit', async (event) => {
			event.preventDefault();
			const message = container.querySelector('#entryMessage');
			const submit = form.querySelector('[type="submit"]');
			const payload = {
				tipo: typeField.value,
				subtipo: subtypeSelect.value,
				resumen: form.elements.resumen.value.trim(),
				indicador: form.elements.indicador.value.trim(),
				periodos: periods.map((name, index) => ({
					nombre: name,
					programado: form.elements[`programado${index}`].value === '' ? 0 : Number(form.elements[`programado${index}`].value),
					realizado: form.elements[`realizado${index}`].value === '' ? 0 : Number(form.elements[`realizado${index}`].value),
				})),
			};
			if ((payload.tipo === 'componente' || payload.tipo === 'actividad') && !payload.subtipo) {
				window.SIDII.showMessage(message, 'Selecciona un subtipo.');
				return;
			}
			submit.disabled = true;
			try {
				await window.SIDII.api('/data/guardar', { method: 'POST', body: JSON.stringify(payload) });
				form.reset();
				subtypeField.hidden = true;
				window.SIDII.showMessage(message, 'Datos guardados correctamente.', 'success');
			} catch (error) {
				window.SIDII.showMessage(message, error.message || 'No se pudieron guardar los datos.');
			} finally {
				submit.disabled = false;
			}
		});
	}

	function renderManagement(container) {
		container.innerHTML = `<header class="section-heading"><p class="eyebrow">Registros</p><h1>Gestión de datos</h1></header>
			<p id="managementMessage" class="inline-message" role="status" hidden></p>
			<div class="table-scroll"><table class="data-table"><thead><tr><th>Tipo</th><th>Subtipo</th><th>Resumen</th><th>Indicador</th><th>Periodos</th><th>Acciones</th></tr></thead><tbody id="recordsTable"><tr><td colspan="6">Cargando registros...</td></tr></tbody></table></div>
			<div id="editRecord"></div>`;

		const table = container.querySelector('#recordsTable');
		const editor = container.querySelector('#editRecord');
		const message = container.querySelector('#managementMessage');
		let records = [];

		function renderRecords() {
			table.innerHTML = records.map((record) => {
				const periodList = (record.periodos || []).map((period) => `<li><strong>${escapeHTML(period.nombre)}:</strong> ${escapeHTML(period.programado ?? 0)} / ${escapeHTML(period.realizado ?? 0)}</li>`).join('');
				return `<tr><td data-label="Tipo">${escapeHTML(record.tipo)}</td><td data-label="Subtipo">${escapeHTML(record.subtipo || '-')}</td><td data-label="Resumen">${escapeHTML(record.resumen)}</td><td data-label="Indicador">${escapeHTML(record.indicador)}</td><td data-label="Periodos"><ul class="period-list">${periodList || '<li>Sin periodos</li>'}</ul></td><td class="table-actions"><button type="button" class="button button-small" data-edit="${escapeHTML(record._id)}">Editar</button><button type="button" class="button button-danger button-small" data-remove="${escapeHTML(record._id)}">Eliminar</button></td></tr>`;
			}).join('') || '<tr><td colspan="6">No hay registros.</td></tr>';
		}

		async function loadRecords() {
			try {
				const result = await window.SIDII.api('/data');
				records = Array.isArray(result) ? result : [];
				renderRecords();
			} catch (error) {
				table.innerHTML = `<tr><td colspan="6">${escapeHTML(error.message)}</td></tr>`;
			}
		}

		function showEditor(record) {
			editor.innerHTML = `<form id="editDataForm" class="edit-form"><h2>Editar registro</h2>
				<div class="form-grid"><label>Tipo<select name="tipo" required>${Object.keys(subtypes).map((type) => `<option value="${type}" ${record.tipo === type ? 'selected' : ''}>${type}</option>`).join('')}</select></label>
				<label id="editSubtypeField" ${subtypes[record.tipo]?.length ? '' : 'hidden'}>Subtipo<select name="subtipo">${(subtypes[record.tipo] || []).map((item) => `<option value="${escapeHTML(item)}" ${record.subtipo === item ? 'selected' : ''}>${escapeHTML(item)}</option>`).join('')}</select></label>
				<label class="span-all">Resumen<input name="resumen" value="${escapeHTML(record.resumen)}" required></label><label class="span-all">Indicador<input name="indicador" value="${escapeHTML(record.indicador)}" required></label></div>
				<div class="table-scroll"><table class="data-table period-table"><thead><tr><th>Periodo</th><th>Programado</th><th>Realizado</th></tr></thead><tbody id="editPeriods"></tbody></table></div>
				<button class="button button-primary" type="submit">Guardar cambios</button> <button class="button button-secondary" type="button" data-cancel-edit>Cancelar</button></form>`;
			const form = editor.querySelector('#editDataForm');
			const subtypeField = editor.querySelector('#editSubtypeField');
			form.elements.tipo.addEventListener('change', () => {
				const options = subtypes[form.elements.tipo.value] || [];
				subtypeField.hidden = options.length === 0;
				form.elements.subtipo.innerHTML = options.map((item) => `<option value="${escapeHTML(item)}">${escapeHTML(item)}</option>`).join('');
			});
			renderPeriodRows(editor.querySelector('#editPeriods'), record.periodos || []);
			form.addEventListener('submit', async (event) => {
				event.preventDefault();
				const payload = {
					tipo: form.elements.tipo.value,
					subtipo: form.elements.subtipo.value,
					resumen: form.elements.resumen.value.trim(),
					indicador: form.elements.indicador.value.trim(),
					periodos: periods.map((name, index) => ({
						nombre: name,
						programado: form.elements[`programado${index}`].value === '' ? 0 : Number(form.elements[`programado${index}`].value),
						realizado: form.elements[`realizado${index}`].value === '' ? 0 : Number(form.elements[`realizado${index}`].value),
					})),
				};
				try {
					await window.SIDII.api(`/data/${encodeURIComponent(record._id)}`, { method: 'PUT', body: JSON.stringify(payload) });
					editor.innerHTML = '';
					window.SIDII.showMessage(message, 'Registro actualizado.', 'success');
					await loadRecords();
				} catch (error) {
					window.SIDII.showMessage(message, error.message || 'No se pudo actualizar el registro.');
				}
			});
		}

		table.addEventListener('click', async (event) => {
			const editButton = event.target.closest('[data-edit]');
			const deleteButton = event.target.closest('[data-remove]');
			if (editButton) {
				const record = records.find((item) => item._id === editButton.dataset.edit);
				if (record) showEditor(record);
			} else if (deleteButton && window.confirm('¿Eliminar este registro?')) {
				try {
					await window.SIDII.api(`/data/${encodeURIComponent(deleteButton.dataset.remove)}`, { method: 'DELETE' });
					window.SIDII.showMessage(message, 'Registro eliminado.', 'success');
					await loadRecords();
				} catch (error) {
					window.SIDII.showMessage(message, error.message || 'No se pudo eliminar el registro.');
				}
			}
		});
		editor.addEventListener('click', (event) => {
			if (event.target.closest('[data-cancel-edit]')) editor.innerHTML = '';
		});
		loadRecords();
	}

	window.SIDII.renderCargaDeDatos = renderLoad;
	window.SIDII.renderGestionDatos = renderManagement;
})();

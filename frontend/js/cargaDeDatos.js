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

	const { calcular, evaluarRegistro, contarPorNivel, NIVELES, SIN_META } = window.Semaforo;
	const semDe = (record) => record.semaforo || evaluarRegistro(record);

	// Insignia del semáforo: el color siempre va con el nombre del nivel, así se entiende aunque no se distingan los colores
	function badge(sem) {
		const texto = sem.porcentaje === null ? sem.nombre : `${sem.porcentaje}% · ${sem.nombre}`;
		return `<span class="sem-badge" style="--sem:${sem.hex};--sem-tinta:${sem.tinta}" title="${escapeHTML(sem.texto)}">${escapeHTML(texto)}</span>`;
	}
	// Mensaje al guardar: el semáforo de cada periodo que tiene meta
	const textoGuardado = (semaforo) => {
		const partes = (semaforo?.periodos || [])
			.map((sem, i) => ({ sem, i }))
			.filter(({ sem }) => sem.porcentaje !== null)
			.map(({ sem, i }) => `${MESES_CORTOS[i]}: ${sem.porcentaje}% (${sem.nombre})`);
		return partes.length ? `Semáforo → ${partes.join(' · ')}.` : 'Sin meta programada, no se puede calcular el semáforo.';
	};

	// Calcula el semáforo en vivo de cada periodo mientras se escriben las metas (misma función que usa el servidor)
	function enlazarSemaforo(tbody) {
		const actualizar = () => {
			periods.forEach((_, index) => {
				const prog = Number(tbody.querySelector(`[name="programado${index}"]`).value) || 0;
				const real = Number(tbody.querySelector(`[name="realizado${index}"]`).value) || 0;
				const sem = calcular(real, prog);
				const faltan = sem.porcentaje !== null && sem.porcentaje < 90
					? `<small class="sem-faltan">Te faltan ${Math.ceil((prog * 0.9 - real) * 10) / 10} para Aceptable (90%)</small>` : '';
				tbody.querySelector(`[data-sem="${index}"]`).innerHTML = badge(sem) + faltan;
			});
		};
		tbody.addEventListener('input', actualizar);
		actualizar();
		return actualizar;
	}

	const MESES_CORTOS = ['Ene–Abr', 'May–Ago', 'Sep–Dic'];
	const relleno = (sem) => (sem.porcentaje === null ? 0 : Math.min(sem.porcentaje, 100));

	// Anillo de cumplimiento: el color y el porcentaje salen del semáforo
	function anillo(sem, grande = false) {
		const texto = sem.porcentaje === null ? '—' : `${sem.porcentaje}%`;
		const lectura = sem.porcentaje === null ? sem.nombre : `${sem.porcentaje}%, ${sem.nombre}`;
		return `<div class="sem-anillo${grande ? ' grande' : ''}" style="--sem:${sem.hex};--pct:${relleno(sem)}" role="img" aria-label="Cumplimiento ${escapeHTML(lectura)}"><span>${texto}</span></div>`;
	}

	// Barra de progreso de un periodo
	const barra = (sem) => `<div class="sem-barra" style="--sem:${sem.hex};--pct:${relleno(sem)}"><i></i></div>`;

	// Evaluaciones de un indicador según la base elegida:
	//  - cuatrimestre: una por periodo (Ene–Abr, May–Ago, Sep–Dic); los periodos vacíos no cuentan
	//  - anual: una sola, con la suma de los tres periodos
	function evaluaciones(record, base) {
		const sem = semDe(record);
		const periodos = (record.periodos || []).map((period, i) => ({
			etiqueta: MESES_CORTOS[i] || period.nombre,
			programado: Number(period.programado) || 0,
			realizado: Number(period.realizado) || 0,
			sem: sem.periodos[i] || calcular(period.realizado, period.programado),
		}));
		const vacia = (e) => e.sem.porcentaje === null && !(e.realizado > 0);
		if (base === 'anual') {
			const programado = periodos.reduce((s, e) => s + e.programado, 0);
			const realizado = periodos.reduce((s, e) => s + e.realizado, 0);
			const anual = { etiqueta: 'Anual (Ene–Dic)', programado, realizado, sem: calcular(realizado, programado) };
			return { lista: vacia(anual) ? [] : [anual], vacios: [] };
		}
		return { lista: periodos.filter((e) => !vacia(e)), vacios: periodos.filter(vacia).map((e) => e.etiqueta) };
	}

	// La evaluación más baja del indicador (null si no tiene ninguna con meta)
	function peorPorcentaje(record, base) {
		const valores = evaluaciones(record, base).lista.map((e) => e.sem.porcentaje).filter((v) => v !== null);
		return valores.length ? Math.min(...valores) : null;
	}

	// Más urgentes primero: menor cumplimiento arriba, los que no tienen meta al final
	function porRiesgo(base) {
		return (a, b) => {
			const x = peorPorcentaje(a, base);
			const y = peorPorcentaje(b, base);
			if (x === null) return y === null ? 0 : 1;
			if (y === null) return -1;
			return x - y;
		};
	}

	const TEXTO_BASE = {
		cuatrimestre: 'Cada indicador se evalúa en cada cuatrimestre (Ene–Abr, May–Ago, Sep–Dic), comparando lo realizado contra lo programado de ese periodo. Así se detecta a tiempo qué periodo va mal. Los números de arriba cuentan evaluaciones: un periodo con meta es una.',
		anual: 'Cada indicador recibe una sola evaluación con la suma de los tres cuatrimestres: total realizado ÷ total programado. Sirve para ver el cierre del año, pero no muestra en qué periodo se perdió el avance.',
	};

	function renderPeriodRows(container, existing = []) {
		container.innerHTML = periods.map((name, index) => {
			const old = existing.find((period) => period.nombre === name) || {};
			const disabled = !window.SIDII.periodIsEnabled(index);
			return `<tr><td data-label="Periodo">${name}</td><td data-label="Programado"><input type="number" min="0" step="any" name="programado${index}" value="${escapeHTML(old.programado ?? '')}" ${disabled ? 'disabled' : ''}></td><td data-label="Realizado"><input type="number" min="0" step="any" name="realizado${index}" value="${escapeHTML(old.realizado ?? '')}" ${disabled ? 'disabled' : ''}></td><td data-label="Semáforo" class="sem-cell" data-sem="${index}">${badge(calcular(old.realizado, old.programado))}</td></tr>`;
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
				<div class="table-scroll"><table class="data-table period-table"><thead><tr><th>Periodo</th><th>Programado</th><th>Realizado</th><th>Semáforo</th></tr></thead><tbody id="entryPeriods"></tbody></table></div>
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
		const refrescarSemaforo = enlazarSemaforo(periodBody);

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
				const result = await window.SIDII.api('/data/guardar', { method: 'POST', body: JSON.stringify(payload) });
				form.reset();
				refrescarSemaforo();
				subtypeField.hidden = true;
				window.SIDII.showMessage(
					message,
					result?.queuedOffline
						? 'Datos guardados en este dispositivo. Se sincronizarán automáticamente al recuperar la conexión.'
						: `Datos guardados correctamente. ${textoGuardado(result?.semaforo || evaluarRegistro(payload))}`,
					'success',
				);
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
			<div class="sem-tablero">
				<div class="sem-resumen" id="semResumen" role="group" aria-label="Filtrar por nivel de cumplimiento"></div>
			</div>
			<p class="sem-ayuda">Rojo: menos de 70% · Naranja: 70% a 79.9% · Amarillo: 80% a 89.9% · Verde: 90% a 110% · Azul: más de 110% · Gris: sin meta. Rojo y naranja requieren atención.</p>
			<div class="sem-herramientas">
				<label>Evaluar por<select id="semBase"><option value="cuatrimestre">Cuatrimestre (Ene–Abr, May–Ago, Sep–Dic)</option><option value="anual">Anual (suma de los 3 cuatrimestres)</option></select></label>
				<label>Ordenar por<select id="semOrden"><option value="riesgo">Más urgentes primero</option><option value="captura">Orden de captura</option></select></label>
				<span class="sem-vivo" id="semVivo"><i></i><span id="semVivoTexto">Cargando…</span></span>
			</div>
			<p class="sem-ayuda" id="semBaseTexto"></p>
			<div class="table-scroll"><table class="data-table"><thead><tr><th>Tipo</th><th>Subtipo</th><th>Resumen</th><th>Indicador</th><th>Evaluación</th><th>Acciones</th></tr></thead><tbody id="recordsTable"><tr><td colspan="6">Cargando registros...</td></tr></tbody></table></div>
			<div id="editRecord"></div>`;

		const table = container.querySelector('#recordsTable');
		const editor = container.querySelector('#editRecord');
		const message = container.querySelector('#managementMessage');
		let records = [];
		let filtro = '';
		let orden = 'riesgo';
		let base = 'cuatrimestre';
		let huella = '';

		function marcarVivo(conectado) {
			container.querySelector('#semVivo').classList.toggle('sin-conexion', !conectado);
			container.querySelector('#semVivoTexto').textContent = conectado
				? `Actualizado a las ${new Date().toLocaleTimeString('es-MX')} · se actualiza solo cada 20 s`
				: 'Sin conexión · mostrando lo último que se cargó';
		}

		function destello() {
			const tablero = container.querySelector('.sem-tablero');
			tablero.classList.remove('sem-flash');
			void tablero.offsetWidth;
			tablero.classList.add('sem-flash');
		}

		function renderResumen() {
			const conteo = Object.fromEntries([...NIVELES, SIN_META].map((nivel) => [nivel.clave, 0]));
			records.forEach((record) => evaluaciones(record, base).lista.forEach((e) => { conteo[e.sem.clave] += 1; }));
			const botones = [{ clave: '', nombre: 'Todos', hex: '#18181b' }, ...NIVELES, SIN_META];
			container.querySelector('#semResumen').innerHTML = botones.map((nivel) => `<button type="button" class="sem-filtro${filtro === nivel.clave ? ' is-selected' : ''}" data-nivel="${nivel.clave}" aria-pressed="${filtro === nivel.clave}" style="--sem:${nivel.hex}"><strong>${nivel.clave ? (conteo[nivel.clave] ?? 0) : records.length}</strong><span>${nivel.nombre}</span></button>`).join('');
		}

		function renderRecords() {
			const visibles = filtro ? records.filter((record) => evaluaciones(record, base).lista.some((e) => e.sem.clave === filtro)) : records;
			const lista = orden === 'riesgo' ? [...visibles].sort(porRiesgo(base)) : visibles;
			table.innerHTML = lista.map((record) => {
				const { lista, vacios } = evaluaciones(record, base);
				const peor = peorPorcentaje(record, base);
				const acento = (lista.find((e) => e.sem.porcentaje === peor && peor !== null) || { sem: SIN_META }).sem.hex;
				const items = lista.map((e) => (base === 'anual'
					? `<li class="sem-anual">${anillo(e.sem)}<div>${badge(e.sem)}<small>Programado ${escapeHTML(e.programado)} · Realizado ${escapeHTML(e.realizado)}</small></div></li>`
					: `<li class="sem-periodo"><div class="sem-periodo-top"><strong>${escapeHTML(e.etiqueta)}</strong>${badge(e.sem)}</div>${barra(e.sem)}<small>Programado ${escapeHTML(e.programado)} · Realizado ${escapeHTML(e.realizado)}</small></li>`)).join('')
					+ (lista.length ? '' : '<li class="sem-sin-meta">Sin meta programada en ningún periodo</li>')
					+ (lista.length && vacios.length ? `<li class="sem-sin-meta">Sin captura: ${escapeHTML(vacios.join(', '))}</li>` : '');
				return `<tr class="sem-fila" style="--sem:${acento}"><td data-label="Tipo">${escapeHTML(record.tipo)}</td><td data-label="Subtipo">${escapeHTML(record.subtipo || '-')}</td><td data-label="Resumen">${escapeHTML(record.resumen)}</td><td data-label="Indicador">${escapeHTML(record.indicador)}</td><td data-label="Evaluación"><ul class="sem-periodos">${items}</ul></td><td class="table-actions"><button type="button" class="button button-small" data-edit="${escapeHTML(record._id)}">Editar</button><button type="button" class="button button-danger button-small" data-remove="${escapeHTML(record._id)}">Eliminar</button></td></tr>`;
			}).join('') || (filtro ? '<tr><td colspan="6">No hay indicadores en este nivel.</td></tr>' : '<tr><td colspan="6">No hay registros.</td></tr>');
		}

		async function loadRecords({ silencioso = false } = {}) {
			try {
				const result = await window.SIDII.api('/data');
				const nueva = JSON.stringify(result);
				const cambio = nueva !== huella;
				huella = nueva;
				records = Array.isArray(result) ? result : [];
				marcarVivo(true);
				if (silencioso && !cambio) return;
				if (silencioso) destello();
				renderResumen();
				renderRecords();
			} catch (error) {
				if (silencioso) { marcarVivo(false); return; }
				table.innerHTML = `<tr><td colspan="6">${escapeHTML(error.message)}</td></tr>`;
			}
		}

		function showEditor(record) {
			editor.innerHTML = `<form id="editDataForm" class="edit-form"><h2>Editar registro</h2>
				<div class="form-grid"><label>Tipo<select name="tipo" required>${Object.keys(subtypes).map((type) => `<option value="${type}" ${record.tipo === type ? 'selected' : ''}>${type}</option>`).join('')}</select></label>
				<label id="editSubtypeField" ${subtypes[record.tipo]?.length ? '' : 'hidden'}>Subtipo<select name="subtipo">${(subtypes[record.tipo] || []).map((item) => `<option value="${escapeHTML(item)}" ${record.subtipo === item ? 'selected' : ''}>${escapeHTML(item)}</option>`).join('')}</select></label>
				<label class="span-all">Resumen<input name="resumen" value="${escapeHTML(record.resumen)}" required></label><label class="span-all">Indicador<input name="indicador" value="${escapeHTML(record.indicador)}" required></label></div>
				<div class="table-scroll"><table class="data-table period-table"><thead><tr><th>Periodo</th><th>Programado</th><th>Realizado</th><th>Semáforo</th></tr></thead><tbody id="editPeriods"></tbody></table></div>
				<button class="button button-primary" type="submit">Guardar cambios</button> <button class="button button-secondary" type="button" data-cancel-edit>Cancelar</button></form>`;
			const form = editor.querySelector('#editDataForm');
			const subtypeField = editor.querySelector('#editSubtypeField');
			form.elements.tipo.addEventListener('change', () => {
				const options = subtypes[form.elements.tipo.value] || [];
				subtypeField.hidden = options.length === 0;
				form.elements.subtipo.innerHTML = options.map((item) => `<option value="${escapeHTML(item)}">${escapeHTML(item)}</option>`).join('');
			});
			renderPeriodRows(editor.querySelector('#editPeriods'), record.periodos || []);
			enlazarSemaforo(editor.querySelector('#editPeriods'));
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
		const textoBase = container.querySelector('#semBaseTexto');
		textoBase.textContent = TEXTO_BASE[base];
		container.querySelector('#semBase').addEventListener('change', (event) => {
			base = event.target.value;
			textoBase.textContent = TEXTO_BASE[base];
			renderResumen();
			renderRecords();
		});
		container.querySelector('#semOrden').addEventListener('change', (event) => {
			orden = event.target.value;
			renderRecords();
		});
		// El tablero se actualiza solo: mientras esta pantalla está abierta vuelve a pedir los datos cada 20 s
		clearInterval(container._semTimer);
		container._semTimer = setInterval(() => {
			if (!container.isConnected) { clearInterval(container._semTimer); return; }
			if (!container.classList.contains('is-active') || document.hidden) return;
			loadRecords({ silencioso: true });
		}, 20000);
		container.querySelector('#semResumen').addEventListener('click', (event) => {
			const boton = event.target.closest('[data-nivel]');
			if (!boton) return;
			filtro = boton.dataset.nivel;
			renderResumen();
			renderRecords();
		});
		editor.addEventListener('click', (event) => {
			if (event.target.closest('[data-cancel-edit]')) editor.innerHTML = '';
		});
		loadRecords();
	}

	window.SIDII.renderCargaDeDatos = renderLoad;
	window.SIDII.renderGestionDatos = renderManagement;
})();

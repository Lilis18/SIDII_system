(() => {
	const periods = ['Enero - Abril', 'Mayo - Agosto', 'Septiembre - Diciembre'];
	const chartTypes = [
		{ key: 'fin', title: 'Fin' },
		{ key: 'proposito', title: 'Propósito' },
		{ key: 'componente', title: 'Componentes', subtype: true },
		{ key: 'actividad', title: 'Actividades', subtype: true },
	];
	const components = Array.from({ length: 5 }, (_, index) => `Componente ${index + 1}`);
	const activities = Array.from({ length: 15 }, (_, index) => `Actividad ${Math.floor(index / 3) + 1}.${index % 3 + 1}`);
	const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	})[character]);

	const { calcular, NIVELES, SIN_META } = window.Semaforo;
	const MESES_CORTOS = ['Ene–Abr', 'May–Ago', 'Sep–Dic'];
	const TEXTO_BASE = {
		cuatrimestre: 'Cada indicador se evalúa en cada cuatrimestre: lo realizado contra lo programado de ese periodo. Así se detecta a tiempo qué periodo va mal.',
		anual: 'Cada indicador recibe una sola evaluación con la suma de los tres cuatrimestres. Sirve para ver el cierre del año.',
	};
	const insignia = (sem) => `<span class="sem-badge" style="--sem:${sem.hex};--sem-tinta:${sem.tinta}" title="${escapeHTML(sem.texto)}">${escapeHTML(sem.porcentaje === null ? sem.nombre : `${sem.porcentaje}% · ${sem.nombre}`)}</span>`;

	// Evaluaciones de un indicador según la base: una por cuatrimestre (los vacíos no cuentan) o una anual
	function evaluaciones(record, base) {
		const periodos = (record.periodos || []).map((period, i) => {
			const programado = Number(period.programado) || 0;
			const realizado = Number(period.realizado) || 0;
			return { etiqueta: MESES_CORTOS[i] || period.nombre, programado, realizado, sem: calcular(realizado, programado) };
		});
		const lista = base === 'anual'
			? (() => {
				const programado = periodos.reduce((s, e) => s + e.programado, 0);
				const realizado = periodos.reduce((s, e) => s + e.realizado, 0);
				return [{ etiqueta: 'Anual', programado, realizado, sem: calcular(realizado, programado) }];
			})()
			: periodos;
		return lista.filter((e) => !(e.sem.porcentaje === null && !(e.realizado > 0)));
	}

	async function render(container) {
		container.innerHTML = `<header class="section-heading"><p class="eyebrow">Seguimiento</p><h1>Visualizador de gráficas</h1></header>
			<div class="export-panel"><fieldset><legend>Gráficas a exportar</legend>${chartTypes.map((chart) => `<label><input type="checkbox" name="export-${chart.key}" checked> ${chart.title}</label>`).join('')}<button class="button button-primary" id="exportCharts" type="button">Imprimir / Guardar PDF</button></fieldset></div>
			<p class="inline-message" id="chartMessage" role="status" hidden></p>
			<section class="sem-panel" id="semPanel"><div class="chart-heading"><div><p class="eyebrow">Semáforo inteligente</p><h2>Cumplimiento de indicadores</h2></div><label class="chart-select">Evaluar por<select id="semBaseViz"><option value="cuatrimestre">Cuatrimestre</option><option value="anual">Anual</option></select></label></div>
				<p class="sem-ayuda" id="semBaseTextoViz"></p>
				<div class="sem-resumen" id="semCuentas"></div>
				<h3 class="sem-subtitulo">Indicadores que requieren atención <small>(rojo y naranja, del menor al mayor cumplimiento)</small></h3>
				<ul class="sem-atencion" id="semAtencionViz"></ul>
				<span class="sem-vivo" id="vizVivo"><i></i><span id="vizVivoTexto">Cargando…</span></span></section>
			<div class="charts-grid">${chartTypes.map((chart) => `<section class="chart-section" id="grafico${chart.key[0].toUpperCase()}${chart.key.slice(1)}" data-chart="${chart.key}"><div class="chart-heading"><div><p class="eyebrow">Resumen</p><h2>${chart.title}</h2></div>${chart.subtype ? `<label class="chart-select">${chart.key === 'componente' ? 'Componente' : 'Actividad'}<select data-subtype="${chart.key}"><option value="">${chart.key === 'componente' ? 'Todos los componentes' : 'Todas las actividades'}</option>${(chart.key === 'componente' ? components : activities).map((item) => `<option value="${escapeHTML(item)}">${escapeHTML(item)}</option>`).join('')}</select></label>` : ''}</div>
				<div class="chart-filters" role="group" aria-label="Filtrar periodo">${['Todos', ...periods].map((period, index) => `<button type="button" data-period-filter="${chart.key}" data-period="${index === 0 ? '' : escapeHTML(period)}" class="${index === 0 ? 'is-selected' : ''}">${period}</button>`).join('')}</div>
				<div class="chart-legend"><span><i class="legend-planned"></i> Programado</span><span><i class="legend-completed"></i> Realizado (el color es el semáforo)</span></div><div class="chart-bars" data-bars="${chart.key}" aria-live="polite"></div></section>`).join('')}</div>`;

		const message = container.querySelector('#chartMessage');
		let records;
		try {
			records = await window.SIDII.api('/data');
			if (!Array.isArray(records)) records = [];
		} catch (error) {
			window.SIDII.showMessage(message, error.message || 'No se pudieron cargar las gráficas.');
			return;
		}

		const filterState = Object.fromEntries(chartTypes.map(({ key }) => [key, { period: '', subtype: '' }]));
		const getChartData = (type) => records.filter((record) => record.tipo === type && (!filterState[type].subtype || record.subtipo === filterState[type].subtype)).map((record) => {
			const selectedPeriods = (record.periodos || []).filter((period) => !filterState[type].period || period.nombre === filterState[type].period);
			if (!selectedPeriods.length) return null;
			return {
				name: record.subtipo || record.resumen || record.tipo,
				planned: selectedPeriods.reduce((sum, period) => sum + (Number(period.programado) || 0), 0),
				completed: selectedPeriods.reduce((sum, period) => sum + (Number(period.realizado) || 0), 0),
			};
		}).filter(Boolean).map((item) => ({ ...item, sem: calcular(item.completed, item.planned) }));
		let base = 'cuatrimestre';
		let huella = JSON.stringify(records);

		function drawSemaforo() {
			container.querySelector('#semBaseTextoViz').textContent = TEXTO_BASE[base];
			const conteo = Object.fromEntries([...NIVELES, SIN_META].map((nivel) => [nivel.clave, 0]));
			const atencion = [];
			records.forEach((record) => evaluaciones(record, base).forEach((e) => {
				conteo[e.sem.clave] += 1;
				if (e.sem.clave === 'insuficiente' || e.sem.clave === 'moderado') atencion.push({ record, e });
			}));
			atencion.sort((a, b) => a.e.sem.porcentaje - b.e.sem.porcentaje);
			container.querySelector('#semCuentas').innerHTML = [...NIVELES, SIN_META].map((nivel) => `<div class="sem-filtro sem-cuenta" style="--sem:${nivel.hex}"><strong>${conteo[nivel.clave]}</strong><span>${nivel.nombre}</span></div>`).join('');
			container.querySelector('#semAtencionViz').innerHTML = atencion.map(({ record, e }) => `<li style="--sem:${e.sem.hex}"><div><strong>${escapeHTML(record.indicador || record.resumen)}</strong><small>${escapeHTML(record.subtipo || record.tipo)} · ${escapeHTML(e.etiqueta)} · Programado ${e.programado} · Realizado ${e.realizado}</small></div>${insignia(e.sem)}</li>`).join('')
				|| '<li class="sem-sin-atencion">Ningún indicador está en rojo ni naranja.</li>';
		}

		function marcarVivo(conectado) {
			container.querySelector('#vizVivo').classList.toggle('sin-conexion', !conectado);
			container.querySelector('#vizVivoTexto').textContent = conectado
				? `Actualizado a las ${new Date().toLocaleTimeString('es-MX')} · se actualiza solo cada 20 s`
				: 'Sin conexión · mostrando lo último que se cargó';
		}

		function drawCharts() {
			drawSemaforo();
			for (const { key } of chartTypes) {
				const data = getChartData(key);
				const max = Math.max(1, ...data.flatMap((item) => [item.planned, item.completed]));
				const bars = container.querySelector(`[data-bars="${key}"]`);
				bars.innerHTML = data.map((item) => `<div class="chart-row"><strong title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</strong><div class="bar-pair"><div class="bar-line"><span class="bar planned" style="width:${Math.max(item.planned ? 1 : 0, item.planned / max * 100)}%"></span><span>${item.planned}</span></div><div class="bar-line"><span class="bar completed" style="width:${Math.max(item.completed ? 1 : 0, item.completed / max * 100)}%;background:${item.sem.hex}"></span><span>${item.completed}</span></div><div class="bar-line">${insignia(item.sem)}</div></div></div>`).join('') || '<p class="empty-chart">No hay datos para los filtros seleccionados.</p>';
			}
		}

		container.addEventListener('click', (event) => {
			const filter = event.target.closest('[data-period-filter]');
			if (!filter) return;
			const { periodFilter: type, period } = filter.dataset;
			filterState[type].period = period;
			container.querySelectorAll(`[data-period-filter="${type}"]`).forEach((button) => button.classList.toggle('is-selected', button === filter));
			drawCharts();
		});

		container.querySelector('#semBaseViz').addEventListener('change', (event) => {
			base = event.target.value;
			drawSemaforo();
		});

		// Se actualiza solo: mientras esta pantalla está abierta vuelve a pedir los datos cada 20 s
		clearInterval(container._vizTimer);
		container._vizTimer = setInterval(async () => {
			if (!container.isConnected) { clearInterval(container._vizTimer); return; }
			if (!container.classList.contains('is-active') || document.hidden) return;
			try {
				const nuevos = await window.SIDII.api('/data');
				marcarVivo(true);
				if (!Array.isArray(nuevos) || JSON.stringify(nuevos) === huella) return;
				huella = JSON.stringify(nuevos);
				records = nuevos;
				drawCharts();
				const panel = container.querySelector('#semPanel');
				panel.classList.remove('sem-flash');
				void panel.offsetWidth;
				panel.classList.add('sem-flash');
			} catch (error) { marcarVivo(false); }
		}, 20000);

		container.querySelectorAll('[data-subtype]').forEach((select) => {
			select.addEventListener('change', () => {
				filterState[select.dataset.subtype].subtype = select.value;
				drawCharts();
			});
		});

		container.querySelector('#exportCharts').addEventListener('click', () => {
			const selected = chartTypes.filter(({ key }) => container.querySelector(`[name="export-${key}"]`).checked);
			if (!selected.length) {
				window.SIDII.showMessage(message, 'Selecciona al menos una gráfica para imprimir.');
				return;
			}
			container.querySelectorAll('[data-chart]').forEach((section) => {
				section.classList.toggle('print-selected', selected.some((chart) => chart.key === section.dataset.chart));
			});
			document.body.classList.add('printing-charts');
			window.addEventListener('afterprint', () => {
				document.body.classList.remove('printing-charts');
				container.querySelectorAll('.print-selected').forEach((section) => section.classList.remove('print-selected'));
			}, { once: true });
			window.print();
		});

		drawCharts();
		marcarVivo(true);
	}

	window.SIDII.renderGraficos = render;
})();

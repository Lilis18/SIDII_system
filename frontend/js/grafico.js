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

	async function render(container) {
		container.innerHTML = `<header class="section-heading"><p class="eyebrow">Seguimiento</p><h1>Visualizador de gráficas</h1></header>
			<div class="export-panel"><fieldset><legend>Gráficas a exportar</legend>${chartTypes.map((chart) => `<label><input type="checkbox" name="export-${chart.key}" checked> ${chart.title}</label>`).join('')}<button class="button button-primary" id="exportCharts" type="button">Imprimir / Guardar PDF</button></fieldset></div>
			<p class="inline-message" id="chartMessage" role="status" hidden></p>
			<div class="charts-grid">${chartTypes.map((chart) => `<section class="chart-section" id="grafico${chart.key[0].toUpperCase()}${chart.key.slice(1)}" data-chart="${chart.key}"><div class="chart-heading"><div><p class="eyebrow">Resumen</p><h2>${chart.title}</h2></div>${chart.subtype ? `<label class="chart-select">${chart.key === 'componente' ? 'Componente' : 'Actividad'}<select data-subtype="${chart.key}"><option value="">${chart.key === 'componente' ? 'Todos los componentes' : 'Todas las actividades'}</option>${(chart.key === 'componente' ? components : activities).map((item) => `<option value="${escapeHTML(item)}">${escapeHTML(item)}</option>`).join('')}</select></label>` : ''}</div>
				<div class="chart-filters" role="group" aria-label="Filtrar periodo">${['Todos', ...periods].map((period, index) => `<button type="button" data-period-filter="${chart.key}" data-period="${index === 0 ? '' : escapeHTML(period)}" class="${index === 0 ? 'is-selected' : ''}">${period}</button>`).join('')}</div>
				<div class="chart-legend"><span><i class="legend-planned"></i> Programado</span><span><i class="legend-completed"></i> Realizado</span></div><div class="chart-bars" data-bars="${chart.key}" aria-live="polite"></div></section>`).join('')}</div>`;

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
		}).filter(Boolean);

		function drawCharts() {
			for (const { key } of chartTypes) {
				const data = getChartData(key);
				const max = Math.max(1, ...data.flatMap((item) => [item.planned, item.completed]));
				const bars = container.querySelector(`[data-bars="${key}"]`);
				bars.innerHTML = data.map((item) => `<div class="chart-row"><strong title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</strong><div class="bar-pair"><div class="bar-line"><span class="bar planned" style="width:${Math.max(item.planned ? 1 : 0, item.planned / max * 100)}%"></span><span>${item.planned}</span></div><div class="bar-line"><span class="bar completed" style="width:${Math.max(item.completed ? 1 : 0, item.completed / max * 100)}%"></span><span>${item.completed}</span></div></div></div>`).join('') || '<p class="empty-chart">No hay datos para los filtros seleccionados.</p>';
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
	}

	window.SIDII.renderGraficos = render;
})();

/**
 * SEMÁFORO INTELIGENTE DE INDICADORES (aportación innovadora de SIDII)
 *
 * Cumplimiento (%) = (Meta realizada ÷ Meta programada) × 100
 *
 * IMPORTANTE: este archivo existe en DOS lugares con EL MISMO contenido:
 *   - backend/utils/semaforo.js  (lo usa el servidor)
 *   - frontend/js/semaforo.js    (lo usa el navegador)
 * Así Cargar datos, Gestión de datos y el servidor siempre muestran el mismo resultado.
 * Si cambias un rango, cámbialo en los dos archivos.
 */
(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory(); // Node (backend)
	else root.Semaforo = factory(); // navegador (frontend)
})(typeof self !== 'undefined' ? self : this, function () {
	// Rangos normativos, de menor a mayor cumplimiento
	const NIVELES = [
		{ clave: 'insuficiente', nombre: 'Insuficiente', color: 'rojo', hex: '#c62828', texto: 'Muy por debajo de la meta; es lo primero que hay que revisar.' },
		{ clave: 'moderado', nombre: 'Moderado', color: 'naranja', hex: '#ef6c00', texto: 'Por debajo del mínimo aceptable; hay que acelerar el avance.' },
		{ clave: 'adecuado', nombre: 'Adecuado', color: 'amarillo', hex: '#f9a825', tinta: '#18181b', texto: 'Cerca de la meta, pero todavía le falta un poco.' },
		{ clave: 'aceptable', nombre: 'Aceptable', color: 'verde', hex: '#2e7d32', texto: 'Cumple con lo que se programó.' },
		{ clave: 'excedido', nombre: 'Excedido', color: 'azul', hex: '#1565c0', texto: 'Superó la meta; conviene revisar si se programó muy baja.' },
	];
	const SIN_META = { clave: 'sin_meta', nombre: 'Sin meta', color: 'gris', hex: '#71717a', texto: 'No hay meta programada, no se puede calcular.' };

	// Color del texto sobre cada color (el amarillo necesita texto oscuro para leerse bien)
	[...NIVELES, SIN_META].forEach((nivel) => { nivel.tinta = nivel.tinta || '#ffffff'; });

	const redondear = (numero) => Math.round(numero * 10) / 10;

	// Devuelve { porcentaje, clave, nombre, color, hex, tinta, texto }. Si la meta programada es 0 no divide.
	function calcular(realizado, programado) {
		const real = Number(realizado) || 0;
		const prog = Number(programado) || 0;
		if (!(prog > 0)) return { porcentaje: null, ...SIN_META };

		// se redondea a 6 decimales para que 11 ÷ 10 sea exactamente 110% y no 110.00000000000001%
		const porcentaje = Math.round((real / prog) * 100 * 1e6) / 1e6;
		let nivel;
		if (porcentaje < 70) nivel = NIVELES[0];
		else if (porcentaje < 80) nivel = NIVELES[1];
		else if (porcentaje < 90) nivel = NIVELES[2];
		else if (porcentaje <= 110) nivel = NIVELES[3];
		else nivel = NIVELES[4];
		return { porcentaje: redondear(porcentaje), ...nivel };
	}

	// Rojo y naranja son los que requieren atención
	const requiereAtencion = (semaforo) => semaforo.clave === 'insuficiente' || semaforo.clave === 'moderado';

	// Semáforo de un registro de SIDII ({ periodos: [{ nombre, programado, realizado }] }):
	// uno por periodo (en el mismo orden) y uno global con la suma de los periodos
	function evaluarRegistro(registro) {
		const periodos = Array.isArray(registro && registro.periodos) ? registro.periodos : [];
		let programado = 0;
		let realizado = 0;
		const porPeriodo = periodos.map((periodo) => {
			programado += Number(periodo.programado) || 0;
			realizado += Number(periodo.realizado) || 0;
			return { nombre: periodo.nombre, ...calcular(periodo.realizado, periodo.programado) };
		});
		return { periodos: porPeriodo, global: calcular(realizado, programado) };
	}

	const conSemaforo = (registro) => ({ ...registro, semaforo: evaluarRegistro(registro) });

	// Cuántos indicadores hay en cada nivel (todas las claves siempre presentes)
	function contarPorNivel(evaluados) {
		const cuenta = { insuficiente: 0, moderado: 0, adecuado: 0, aceptable: 0, excedido: 0, sin_meta: 0 };
		evaluados.forEach((registro) => { cuenta[registro.semaforo.global.clave] += 1; });
		return cuenta;
	}

	// Resumen para el tablero: conteo por nivel y lista de indicadores en rojo/naranja, del menor al mayor cumplimiento
	function resumirSemaforo(evaluados) {
		const atencion = evaluados
			.filter((registro) => requiereAtencion(registro.semaforo.global))
			.sort((a, b) => a.semaforo.global.porcentaje - b.semaforo.global.porcentaje)
			.map((registro) => ({
				_id: registro._id,
				tipo: registro.tipo,
				subtipo: registro.subtipo,
				indicador: registro.indicador,
				porcentaje: registro.semaforo.global.porcentaje,
				nivel: registro.semaforo.global.nombre,
				clave: registro.semaforo.global.clave,
				color: registro.semaforo.global.color,
				hex: registro.semaforo.global.hex,
				tinta: registro.semaforo.global.tinta,
			}));
		return { total: evaluados.length, resumen: contarPorNivel(evaluados), atencion };
	}

	return { NIVELES, SIN_META, calcular, requiereAtencion, evaluarRegistro, conSemaforo, contarPorNivel, resumirSemaforo };
});

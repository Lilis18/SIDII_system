// Cálculo del semáforo de cumplimiento de indicadores (funciones puras, sin base de datos).

const NOMBRES_PERIODO = ['Enero - Abril', 'Mayo - Agosto', 'Septiembre - Diciembre'];
const ZONA_HORARIA = 'America/Mexico_City';

const numeroEnv = (nombre, porDefecto) => {
  const valor = Number(process.env[nombre]);
  return Number.isFinite(valor) && valor > 0 ? valor : porDefecto;
};

// Umbrales en porcentaje de cumplimiento (realizado / programado).
const UMBRALES = Object.freeze({
  rojo: numeroEnv('SEMAFORO_UMBRAL_ROJO', 70),          // < 70 %  → rojo
  verde: numeroEnv('SEMAFORO_UMBRAL_VERDE', 90),        // 70–89 % → amarillo, ≥ 90 % → verde
  sobrecumplimiento: numeroEnv('SEMAFORO_UMBRAL_SOBRE', 120), // > 120 % → posible error de captura
});

function fechaEnMexico(fecha = new Date()) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(fecha).map(({ type, value }) => [type, Number(value)]));
  return { anio: partes.year, mes: partes.month, dia: partes.day };
}

function periodoActual(fecha = new Date()) {
  return Math.floor((fechaEnMexico(fecha).mes - 1) / 4);
}

// Días naturales que faltan para que termine el cuatrimestre vigente (0 = hoy es el último día).
function diasParaCierre(fecha = new Date()) {
  const { anio, mes, dia } = fechaEnMexico(fecha);
  const mesFinal = (Math.floor((mes - 1) / 4) + 1) * 4;
  const ultimoDia = new Date(Date.UTC(anio, mesFinal, 0)).getUTCDate();
  const hoy = Date.UTC(anio, mes - 1, dia);
  const cierre = Date.UTC(anio, mesFinal - 1, ultimoDia);
  return Math.round((cierre - hoy) / 86400000);
}

// ¿Hoy es el primer día de un cuatrimestre (1 de enero, mayo o septiembre)?
function esInicioDePeriodo(fecha = new Date()) {
  const { mes, dia } = fechaEnMexico(fecha);
  return dia === 1 && [1, 5, 9].includes(mes);
}

function indicePeriodo(periodo, posicion) {
  const indice = NOMBRES_PERIODO.indexOf(String(periodo?.nombre || '').trim());
  return indice >= 0 ? indice : posicion;
}

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function calcularSemaforo(programado, realizado) {
  const prog = numero(programado);
  const real = numero(realizado);
  if (prog <= 0) {
    return { color: real > 0 ? 'inconsistente' : 'sin_meta', porcentaje: null };
  }
  const porcentaje = Math.round((real / prog) * 1000) / 10;
  let color = 'verde';
  if (porcentaje < UMBRALES.rojo) color = 'rojo';
  else if (porcentaje < UMBRALES.verde) color = 'amarillo';
  else if (porcentaje > UMBRALES.sobrecumplimiento) color = 'sobrecumplimiento';
  return { color, porcentaje };
}

const TIPO_POR_COLOR = {
  rojo: 'SEMAFORO_ROJO',
  amarillo: 'SEMAFORO_AMARILLO',
  sobrecumplimiento: 'SOBRECUMPLIMIENTO',
  inconsistente: 'DATO_INCONSISTENTE',
};

/**
 * Devuelve los hallazgos de un registro de Data.
 * Un periodo se evalúa cuando ya tiene realizado capturado o cuando ya terminó
 * (un periodo pasado con realizado en 0 cuenta como incumplimiento).
 * El periodo vigente sin captura no se evalúa aquí; lo cubre la alerta PERIODO_POR_CERRAR.
 */
function evaluarRegistro(registro, fecha = new Date()) {
  const actual = periodoActual(fecha);
  const hallazgos = [];
  (registro?.periodos || []).forEach((periodo, posicion) => {
    const periodoIndex = indicePeriodo(periodo, posicion);
    const programado = numero(periodo?.programado);
    const realizado = numero(periodo?.realizado);
    const evaluable = realizado > 0 || periodoIndex < actual;
    if (programado > 0 && !evaluable) return;

    const { color, porcentaje } = calcularSemaforo(programado, realizado);
    const tipo = TIPO_POR_COLOR[color];
    if (!tipo) return;
    hallazgos.push({
      tipo,
      color,
      periodoIndex,
      periodoNombre: NOMBRES_PERIODO[periodoIndex] || periodo?.nombre || `Periodo ${posicion + 1}`,
      programado,
      realizado,
      porcentaje,
    });
  });
  return hallazgos;
}

module.exports = {
  NOMBRES_PERIODO,
  UMBRALES,
  TIPOS_SEMAFORO: Object.values(TIPO_POR_COLOR),
  calcularSemaforo,
  evaluarRegistro,
  periodoActual,
  diasParaCierre,
  esInicioDePeriodo,
  fechaEnMexico,
};

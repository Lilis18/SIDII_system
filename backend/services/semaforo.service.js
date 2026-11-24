// Cálculo del semáforo de cumplimiento de indicadores (funciones puras, sin base de datos).

const NOMBRES_PERIODO = ['Enero - Abril', 'Mayo - Agosto', 'Septiembre - Diciembre'];
const ZONA_HORARIA = 'America/Mexico_City';

// Los niveles y rangos los define el semáforo inteligente del equipo (utils/semaforo.js),
// el mismo que usan Cargar datos, Gestión de datos y el tablero. Aquí solo se decide qué niveles generan alerta.
const Semaforo = require('../utils/semaforo');

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

// Igual que Semaforo.calcular, pero distingue "sin meta" de "hay avance sin meta" (dato inconsistente).
function calcularSemaforo(programado, realizado) {
  const resultado = Semaforo.calcular(numero(realizado), numero(programado));
  if (resultado.clave === 'sin_meta' && numero(realizado) > 0) return { ...resultado, clave: 'inconsistente', nombre: 'Inconsistente' };
  return resultado;
}

// Niveles del semáforo que generan alerta.
const TIPO_POR_CLAVE = {
  insuficiente: 'SEMAFORO_ROJO',
  moderado: 'SEMAFORO_NARANJA',
  excedido: 'SOBRECUMPLIMIENTO',
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
  const anioActual = fechaEnMexico(fecha).anio;
  // Registros de años anteriores: todos sus cuatrimestres ya terminaron.
  const anioRegistro = Number(registro?.anio) || anioActual;
  const hallazgos = [];
  (registro?.periodos || []).forEach((periodo, posicion) => {
    const periodoIndex = indicePeriodo(periodo, posicion);
    const programado = numero(periodo?.programado);
    const realizado = numero(periodo?.realizado);
    const evaluable = realizado > 0 || anioRegistro < anioActual || periodoIndex < actual;
    if (programado > 0 && !evaluable) return;

    const nivel = calcularSemaforo(programado, realizado);
    const tipo = TIPO_POR_CLAVE[nivel.clave];
    if (!tipo) return;
    hallazgos.push({
      tipo,
      nivel: nivel.nombre,
      texto: nivel.texto,
      periodoIndex,
      periodoNombre: NOMBRES_PERIODO[periodoIndex] || periodo?.nombre || `Periodo ${posicion + 1}`,
      programado,
      realizado,
      porcentaje: nivel.porcentaje,
    });
  });
  return hallazgos;
}

module.exports = {
  NOMBRES_PERIODO,
  TIPOS_SEMAFORO: Object.values(TIPO_POR_CLAVE),
  calcularSemaforo,
  evaluarRegistro,
  periodoActual,
  diasParaCierre,
  esInicioDePeriodo,
  fechaEnMexico,
};

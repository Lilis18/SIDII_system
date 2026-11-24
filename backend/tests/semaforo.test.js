// Pruebas del semáforo inteligente y de su uso en las alertas. Ejecutar con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Semaforo = require('../utils/semaforo');
const semaforoAlertas = require('../services/semaforo.service');

test('el semáforo del backend y el del frontend son idénticos', () => {
  const leer = (ruta) => fs.readFileSync(path.join(__dirname, '..', '..', ruta), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(
    leer('backend/utils/semaforo.js'),
    leer('frontend/js/semaforo.js'),
    'Si cambias un rango del semáforo, cámbialo en los dos archivos.',
  );
});

test('niveles del semáforo por porcentaje de cumplimiento', () => {
  const casos = [[50, 'insuficiente'], [75, 'moderado'], [85, 'adecuado'], [100, 'aceptable'], [110, 'aceptable'], [115, 'excedido']];
  for (const [realizado, clave] of casos) {
    assert.equal(Semaforo.calcular(realizado, 100).clave, clave, `${realizado} %`);
  }
  assert.equal(Semaforo.calcular(5, 0).clave, 'sin_meta');
});

test('solo Insuficiente, Moderado, Excedido e inconsistente generan alerta', () => {
  const fecha = new Date('2026-11-18T12:00:00-06:00');
  const hallazgos = semaforoAlertas.evaluarRegistro({
    anio: 2026,
    periodos: [
      { nombre: 'Enero - Abril', programado: 10, realizado: 7.5 },
      { nombre: 'Mayo - Agosto', programado: 10, realizado: 8.5 },
      { nombre: 'Septiembre - Diciembre', programado: 0, realizado: 3 },
    ],
  }, fecha);
  assert.deepEqual(hallazgos.map((h) => h.tipo), ['SEMAFORO_NARANJA', 'DATO_INCONSISTENTE']);
});

test('el periodo vigente sin captura no alerta, pero uno de un año anterior sí', () => {
  const fecha = new Date('2027-01-10T12:00:00-06:00');
  const registro = (anio) => ({ anio, periodos: [
    { nombre: 'Enero - Abril', programado: 10, realizado: 0 },
    { nombre: 'Mayo - Agosto', programado: 0, realizado: 0 },
    { nombre: 'Septiembre - Diciembre', programado: 10, realizado: 0 },
  ] });
  assert.deepEqual(semaforoAlertas.evaluarRegistro(registro(2027), fecha), []);
  assert.deepEqual(
    semaforoAlertas.evaluarRegistro(registro(2026), fecha).map((h) => `${h.tipo}:${h.periodoIndex}`),
    ['SEMAFORO_ROJO:0', 'SEMAFORO_ROJO:2'],
  );
});

test('días para el cierre del cuatrimestre', () => {
  assert.equal(semaforoAlertas.diasParaCierre(new Date('2026-12-24T09:00:00-06:00')), 7);
  assert.equal(semaforoAlertas.diasParaCierre(new Date('2026-04-30T09:00:00-06:00')), 0);
  assert.equal(semaforoAlertas.esInicioDePeriodo(new Date('2026-05-01T09:00:00-06:00')), true);
});

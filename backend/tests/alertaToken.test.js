const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-solo-para-pruebas';
const { crearTokenAccion, verificarTokenAccion } = require('../services/alertaToken.service');

test('un token de acción válido identifica la alerta y el usuario', () => {
  const datos = verificarTokenAccion(crearTokenAccion('alerta1', 'usuario1'));
  assert.equal(datos.alertaId, 'alerta1');
  assert.equal(datos.usuarioId, 'usuario1');
  assert.ok(datos.jti);
});

test('un token alterado se rechaza', () => {
  assert.equal(verificarTokenAccion(`${crearTokenAccion('a', 'u')}x`), null);
});

test('un token de sesión no sirve como token de acción', () => {
  const sesion = jwt.sign({ id: 'usuario1', role: 'SUPER_ADMIN' }, process.env.JWT_SECRET);
  assert.equal(verificarTokenAccion(sesion), null);
});

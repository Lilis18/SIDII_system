// Tokens de acción para botones de notificaciones push.
// El Service Worker no tiene acceso al JWT de sesión (vive en localStorage), así que cada
// notificación lleva un token propio: firmado, de un solo uso, limitado a una alerta y a un usuario.
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const AUDIENCIA = 'sidii-alert-action';
const VIGENCIA = process.env.ALERTA_TOKEN_VIGENCIA || '72h';

// Secreto derivado: un token de acción nunca sirve como token de sesión y viceversa.
function secreto() {
  const base = process.env.ALERTA_TOKEN_SECRET || process.env.JWT_SECRET;
  return crypto.createHmac('sha256', base).update('sidii-alert-actions').digest('hex');
}

function crearTokenAccion(alertaId, usuarioId) {
  return jwt.sign(
    { a: String(alertaId), u: String(usuarioId) },
    secreto(),
    { expiresIn: VIGENCIA, audience: AUDIENCIA, jwtid: crypto.randomUUID() },
  );
}

function verificarTokenAccion(token) {
  if (typeof token !== 'string' || token.length > 1024) return null;
  try {
    const datos = jwt.verify(token, secreto(), { audience: AUDIENCIA });
    if (!datos.a || !datos.u || !datos.jti) return null;
    return { alertaId: datos.a, usuarioId: datos.u, jti: datos.jti };
  } catch {
    return null;
  }
}

module.exports = { crearTokenAccion, verificarTokenAccion };

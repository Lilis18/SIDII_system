const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT || '').trim();

let pushHabilitado = false;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    pushHabilitado = true;
  } catch (error) {
    console.error('[push] Las llaves VAPID no son válidas; las notificaciones push quedan desactivadas.', error.message);
  }
} else {
  console.warn('[push] Faltan VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY o VAPID_SUBJECT. Las alertas se guardarán, pero no se enviarán como push. Genera las llaves con: npm run vapid');
}

const MAX_FALLOS = 5;

function estaHabilitado() {
  return pushHabilitado;
}

function obtenerLlavePublica() {
  return pushHabilitado ? VAPID_PUBLIC_KEY : null;
}

/**
 * Envía un payload a todas las suscripciones de un usuario.
 * Elimina las suscripciones que el servicio de push reporta como vencidas (404/410).
 * Nunca lanza: devuelve cuántos dispositivos recibieron el mensaje.
 */
async function enviarAUsuario(usuarioId, payload, { urgencia = 'normal', ttl = 60 * 60 * 24 } = {}) {
  if (!pushHabilitado) return 0;

  let suscripciones;
  try {
    suscripciones = await PushSubscription.find({ usuario: usuarioId }).lean();
  } catch (error) {
    console.error('[push] No se pudieron leer las suscripciones:', error.message);
    return 0;
  }
  if (!suscripciones.length) return 0;

  const cuerpo = JSON.stringify(payload);
  let entregados = 0;

  await Promise.all(suscripciones.map(async (suscripcion) => {
    try {
      await webpush.sendNotification({
        endpoint: suscripcion.endpoint,
        keys: suscripcion.keys,
      }, cuerpo, { TTL: ttl, urgency: urgencia });
      entregados += 1;
      await PushSubscription.updateOne(
        { _id: suscripcion._id },
        { $set: { ultimoEnvio: new Date(), fallosConsecutivos: 0 } },
      );
    } catch (error) {
      try {
        if (error.statusCode === 404 || error.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: suscripcion._id });
          return;
        }
        console.warn(`[push] Falló el envío a una suscripción (${error.statusCode || error.message}).`);
        const actualizada = await PushSubscription.findOneAndUpdate(
          { _id: suscripcion._id },
          { $inc: { fallosConsecutivos: 1 } },
          { new: true },
        );
        if (actualizada && actualizada.fallosConsecutivos >= MAX_FALLOS) {
          await PushSubscription.deleteOne({ _id: suscripcion._id });
        }
      } catch (cleanupError) {
        console.error('[push] No se pudo actualizar la suscripción fallida:', cleanupError.message);
      }
    }
  }));

  return entregados;
}

function validarSuscripcion(suscripcion) {
  if (!suscripcion || typeof suscripcion !== 'object') return null;
  const { endpoint, keys, expirationTime } = suscripcion;
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return null;
  try {
    if (new URL(endpoint).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  if (keys.p256dh.length > 256 || keys.auth.length > 128) return null;
  return {
    endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    expirationTime: Number.isFinite(expirationTime) ? expirationTime : null,
  };
}

module.exports = {
  estaHabilitado,
  obtenerLlavePublica,
  enviarAUsuario,
  validarSuscripcion,
};

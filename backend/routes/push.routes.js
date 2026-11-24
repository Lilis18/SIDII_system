const express = require('express');
const PushSubscription = require('../models/PushSubscription');
const { protect } = require('../middleware/authMiddleware');
const push = require('../services/push.service');
const alertas = require('../services/alertas.service');

const router = express.Router();

// Llave pública VAPID que el navegador necesita para suscribirse.
router.get('/vapid-public-key', (req, res) => {
  const llave = push.obtenerLlavePublica();
  if (!llave) return res.status(503).json({ msg: 'Las notificaciones push no están configuradas en el servidor.' });
  res.json({ publicKey: llave });
});

router.post('/subscribe', protect, async (req, res) => {
  const suscripcion = push.validarSuscripcion(req.body?.subscription);
  if (!suscripcion) return res.status(400).json({ msg: 'Suscripción no válida.' });
  try {
    // Si el dispositivo ya estaba suscrito con otra cuenta, pasa a la cuenta actual.
    await PushSubscription.findOneAndUpdate(
      { endpoint: suscripcion.endpoint },
      {
        $set: {
          usuario: req.user.id,
          keys: suscripcion.keys,
          expirationTime: suscripcion.expirationTime,
          userAgent: String(req.get('user-agent') || '').slice(0, 300),
          fallosConsecutivos: 0,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    res.status(201).json({ msg: 'Notificaciones activadas en este dispositivo.' });
  } catch (error) {
    console.error('[push] Error al guardar la suscripción:', error);
    res.status(500).json({ msg: 'No se pudo activar las notificaciones.' });
  }
});

router.post('/unsubscribe', protect, async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint !== 'string') return res.status(400).json({ msg: 'Falta el endpoint.' });
  try {
    await PushSubscription.deleteOne({ endpoint, usuario: req.user.id });
    res.json({ msg: 'Notificaciones desactivadas en este dispositivo.' });
  } catch (error) {
    console.error('[push] Error al eliminar la suscripción:', error);
    res.status(500).json({ msg: 'No se pudo desactivar las notificaciones.' });
  }
});

// El navegador renovó la suscripción (evento pushsubscriptionchange del Service Worker).
// Conocer el endpoint anterior (una URL secreta) autoriza moverlo al nuevo.
router.post('/renovar', async (req, res) => {
  const anterior = req.body?.oldEndpoint;
  const nueva = push.validarSuscripcion(req.body?.subscription);
  if (typeof anterior !== 'string' || !nueva) return res.status(400).json({ msg: 'Datos no válidos.' });
  try {
    const existente = await PushSubscription.findOne({ endpoint: anterior });
    if (!existente) return res.status(404).json({ msg: 'Suscripción no encontrada.' });
    await PushSubscription.deleteOne({ endpoint: nueva.endpoint, _id: { $ne: existente._id } });
    existente.set({ endpoint: nueva.endpoint, keys: nueva.keys, expirationTime: nueva.expirationTime, fallosConsecutivos: 0 });
    await existente.save();
    res.json({ msg: 'Suscripción renovada.' });
  } catch (error) {
    console.error('[push] Error al renovar la suscripción:', error);
    res.status(500).json({ msg: 'No se pudo renovar la suscripción.' });
  }
});

// Envía una alerta de prueba al propio usuario.
router.post('/prueba', protect, async (req, res) => {
  if (!push.estaHabilitado()) return res.status(503).json({ msg: 'Las notificaciones push no están configuradas en el servidor.' });
  try {
    await alertas.crearAlerta({
      tipo: 'PRUEBA',
      titulo: '🔔 Notificación de prueba',
      mensaje: 'Si ves este mensaje, las alertas de SIDII llegan a este dispositivo.',
      destinatarios: [req.user.id],
      informativa: true,
    });
    res.json({ msg: 'Notificación de prueba enviada.' });
  } catch (error) {
    console.error('[push] Error al enviar la prueba:', error);
    res.status(500).json({ msg: 'No se pudo enviar la notificación de prueba.' });
  }
});

module.exports = router;

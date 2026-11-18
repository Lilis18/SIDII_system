const express = require('express');
const mongoose = require('mongoose');
const Alerta = require('../models/Alerta');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');
const { verificarTokenAccion } = require('../services/alertaToken.service');
const alertas = require('../services/alertas.service');

const router = express.Router();
const esId = (valor) => mongoose.isValidObjectId(valor);

function responderError(res, error, contexto) {
  if (error instanceof alertas.AlertaError) return res.status(error.status).json({ msg: error.message });
  console.error(`[alertas] ${contexto}:`, error);
  return res.status(500).json({ msg: 'No se pudo completar la operación de alertas.' });
}

// Bandeja del usuario: GET /api/alertas?filtro=activas|todas&limite=50
router.get('/', protect, async (req, res) => {
  const limite = Math.min(Math.max(Number(req.query.limite) || 50, 1), 200);
  const filtro = { destinatarios: req.user.id };
  if (req.query.filtro !== 'todas') filtro.activa = true;
  try {
    const lista = await Alerta.find(filtro).sort({ updatedAt: -1 }).limit(limite).lean();
    res.json(lista.map((alerta) => alertas.serializar(alerta, { _id: req.user.id, role: req.user.role })));
  } catch (error) {
    responderError(res, error, 'Error al listar alertas');
  }
});

// Contador para el distintivo de la pestaña.
router.get('/resumen', protect, async (req, res) => {
  try {
    const pendientes = await Alerta.aggregate([
      { $match: { destinatarios: new mongoose.Types.ObjectId(String(req.user.id)), leidaPor: { $ne: new mongoose.Types.ObjectId(String(req.user.id)) }, $or: [{ activa: true }, { estado: 'informativa' }] } },
      { $group: { _id: '$severidad', total: { $sum: 1 } } },
    ]);
    const porSeveridad = Object.fromEntries(pendientes.map((item) => [item._id, item.total]));
    res.json({ total: pendientes.reduce((suma, item) => suma + item.total, 0), porSeveridad });
  } catch (error) {
    responderError(res, error, 'Error al resumir alertas');
  }
});

router.post('/:id/leida', protect, async (req, res) => {
  if (!esId(req.params.id)) return res.status(400).json({ msg: 'Alerta no válida.' });
  try {
    const resultado = await Alerta.updateOne(
      { _id: req.params.id, destinatarios: req.user.id },
      { $addToSet: { leidaPor: req.user.id } },
    );
    if (!resultado.matchedCount) return res.status(404).json({ msg: 'La alerta no existe.' });
    res.json({ msg: 'Alerta marcada como leída.' });
  } catch (error) {
    responderError(res, error, 'Error al marcar alerta');
  }
});

router.post('/leidas', protect, async (req, res) => {
  try {
    await Alerta.updateMany({ destinatarios: req.user.id }, { $addToSet: { leidaPor: req.user.id } });
    res.json({ msg: 'Todas las alertas se marcaron como leídas.' });
  } catch (error) {
    responderError(res, error, 'Error al marcar alertas');
  }
});

// Acción desde la bandeja de la app (sesión normal).
router.post('/:id/accion', protect, async (req, res) => {
  if (!esId(req.params.id)) return res.status(400).json({ msg: 'Alerta no válida.' });
  const { accion, comentario } = req.body || {};
  if (typeof accion !== 'string' || !alertas.ACCIONES[accion]) return res.status(400).json({ msg: 'Acción no válida.' });
  try {
    const { mensaje, alerta, usuario } = await alertas.ejecutarAccion({
      alertaId: req.params.id, accion, usuarioId: req.user.id, via: 'app', comentario,
    });
    res.json({ msg: mensaje, alerta: alertas.serializar(alerta, usuario) });
  } catch (error) {
    responderError(res, error, 'Error al ejecutar acción');
  }
});

// Acción desde el botón de la notificación (Service Worker, sin sesión).
// Se autoriza con el token de un solo uso que viaja dentro del push.
router.post('/:id/accion-push', async (req, res) => {
  if (!esId(req.params.id)) return res.status(400).json({ msg: 'Alerta no válida.' });
  const { accion, token } = req.body || {};
  if (typeof accion !== 'string' || !alertas.ACCIONES[accion]) return res.status(400).json({ msg: 'Acción no válida.' });

  const datos = verificarTokenAccion(token);
  if (!datos || datos.alertaId !== req.params.id) {
    return res.status(401).json({ msg: 'El enlace de esta notificación venció. Abre SIDII para atender la alerta.' });
  }
  try {
    if (!await User.exists({ _id: datos.usuarioId })) return res.status(401).json({ msg: 'Usuario no encontrado.' });
    // Consumir el token de forma atómica: si ya se usó, no se repite la acción.
    const consumo = await Alerta.updateOne(
      { _id: req.params.id, tokensUsados: { $ne: datos.jti } },
      { $push: { tokensUsados: { $each: [datos.jti], $slice: -200 } } },
    );
    if (!consumo.modifiedCount) return res.status(409).json({ msg: 'Esta notificación ya se usó.' });

    const { mensaje } = await alertas.ejecutarAccion({
      alertaId: req.params.id, accion, usuarioId: datos.usuarioId, via: 'push',
    });
    res.json({ msg: mensaje });
  } catch (error) {
    responderError(res, error, 'Error al ejecutar acción push');
  }
});

module.exports = router;

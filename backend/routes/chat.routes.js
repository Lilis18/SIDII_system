const express = require('express');
const ChatHistory = require('../models/ChatHistory');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();
const allowedRoles = new Set(['usuario', 'bot']);
const maximumMessageLength = 4000;

router.get('/history', protect, async (req, res) => {
  try {
    const history = await ChatHistory.find({ userId: req.user.id })
      .sort({ fecha: 1, _id: 1 })
      .lean();
    res.json(history);
  } catch (error) {
    console.error('Error al recuperar el historial del chat:', error);
    res.status(500).json({ msg: 'No se pudo recuperar el historial del chat.' });
  }
});

router.post('/save', protect, async (req, res) => {
  const { mensaje, rol } = req.body || {};
  const cleanMessage = typeof mensaje === 'string' ? mensaje.trim() : '';

  if (!cleanMessage || cleanMessage.length > maximumMessageLength || !allowedRoles.has(rol)) {
    return res.status(400).json({ msg: 'El mensaje o su rol no son válidos.' });
  }

  try {
    const savedMessage = await ChatHistory.create({
      userId: req.user.id,
      mensaje: cleanMessage,
      rol,
    });
    res.status(201).json(savedMessage);
  } catch (error) {
    console.error('Error al guardar un mensaje del chat:', error);
    res.status(500).json({ msg: 'No se pudo guardar el mensaje del chat.' });
  }
});

module.exports = router;
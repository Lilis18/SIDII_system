const express = require('express');
const rateLimit = require('express-rate-limit');
const ChatHistory = require('../models/ChatHistory');
const { protect } = require('../middleware/authMiddleware');
const { generateAssistantAnswer, getOfficialSources } = require('../services/geminiAssistant.service');

const router = express.Router();
const allowedRoles = new Set(['usuario', 'bot']);
const maximumMessageLength = 4000;
const maximumQuestionLength = 1000;
const assistantBurstLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 3,
  keyGenerator: (req) => String(req.user.id),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { msg: 'Has enviado varias preguntas seguidas. Espera un minuto e inténtalo de nuevo.' },
});
const assistantDailyUserLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 8,
  keyGenerator: (req) => String(req.user.id),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { msg: 'Alcanzaste el límite diario de preguntas con IA para tu cuenta. Puedes volver mañana.' },
});
const assistantDailyAppLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 60,
  keyGenerator: () => 'sidii-gemini-free-quota',
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { msg: 'Se alcanzó el límite diario de IA de SIDII. Puedes usar la ayuda local o volver mañana.' },
});

router.post('/ask', protect, assistantBurstLimit, assistantDailyUserLimit, assistantDailyAppLimit, async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question || question.length > maximumQuestionLength) {
    return res.status(400).json({ msg: `La pregunta debe tener entre 1 y ${maximumQuestionLength} caracteres.` });
  }

  try {
    const history = await ChatHistory.find({ userId: req.user.id })
      .sort({ fecha: -1, _id: -1 })
      .limit(8)
      .lean();
    const answer = await generateAssistantAnswer({ question, history: history.reverse() });
    res.json({ answer, sources: getOfficialSources(question) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ msg: error.message });
    console.error('Error al generar respuesta del asistente:', error);
    return res.status(502).json({ msg: 'No se pudo generar una respuesta con IA. Inténtalo de nuevo.' });
  }
});

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
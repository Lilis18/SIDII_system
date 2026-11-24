const express = require('express');
const router = express.Router();
const Subtipo = require('../models/Subtipo'); // Modelo de Subtipo
const { protect } = require('../middleware/authMiddleware');

// Obtener subtipos por tipo
router.get('/:tipo', protect, async (req, res) => {
  try {
    const { tipo } = req.params;
    const subtipos = await Subtipo.find({ tipo });
    res.json(subtipos);
  } catch (error) {
    console.error('Error al obtener subtipos:', error);
    res.status(500).json({ msg: 'Error al obtener subtipos' });
  }
});

module.exports = router;

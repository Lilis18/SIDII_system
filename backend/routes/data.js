const express = require('express');
const router = express.Router();
const Data = require('../models/Data');
const { protect } = require('../middleware/authMiddleware'); // Middleware para validar token
const { disparadores: alertas } = require('../services/alertas.service');
const { evaluarRegistro, conSemaforo, resumirSemaforo } = require('../utils/semaforo'); // Semáforo inteligente

// Ruta para guardar datos
router.post('/guardar', protect, async (req, res) => {
  const offlineOperationId = req.get('X-SIDII-Operation-Id');
  try {
    if (offlineOperationId) {
      if (offlineOperationId.length > 100) {
        return res.status(400).json({ msg: 'Identificador de operación no válido' });
      }
      const alreadySaved = await Data.findOne({
        usuario: req.user.id,
        offlineOperationId
      }).select('+offlineOperationId');
      if (alreadySaved) {
        return res.status(200).json({ message: 'Datos guardados correctamente' });
      }
    }

    const nuevoDato = new Data({
      usuario: req.user.id,
      ...(offlineOperationId ? { offlineOperationId } : {}),
      tipo: req.body.tipo,
      subtipo: req.body.subtipo,
      resumen: req.body.resumen,
      indicador: req.body.indicador,
      periodos: req.body.periodos
    });

    await nuevoDato.save();
    alertas.datoGuardado(nuevoDato);
    // Se responde con el semáforo del indicador recién guardado (por periodo y global)
    res.status(201).json({ message: 'Datos guardados correctamente', semaforo: evaluarRegistro(nuevoDato.toObject()) });
  } catch (error) {
    if (offlineOperationId && error.code === 11000) {
      const alreadySaved = await Data.findOne({
        usuario: req.user.id,
        offlineOperationId
      }).select('+offlineOperationId');
      if (alreadySaved) {
        return res.status(200).json({ message: 'Datos guardados correctamente' });
      }
    }
    console.error(error);
    res.status(500).json({ message: 'Error al guardar los datos' });
  }
});

// Obtener datos con filtros
router.get('/', protect, async (req, res) => {
    const { fin, proposito, componente, actividad } = req.query;

    const query = {};

    if (fin) query.fin = fin;
    if (proposito) query.proposito = proposito;
    if (componente) query.componente = componente;
    if (actividad) query.actividad = actividad;

    try {
        // Cada registro trae su semáforo (por periodo y global). Filtro opcional: /api/data?nivel=insuficiente
        const data = (await Data.find(query).lean()).map(conSemaforo);
        const nivel = String(req.query.nivel || '').trim();
        res.json(nivel ? data.filter((registro) => registro.semaforo.global.clave === nivel) : data);
    } catch (error) {
        res.status(500).json({ msg: 'Error al obtener los datos' });
    }
});

// Cambié auth por protect aquí
router.get('/subtipos/:tipo', protect, async (req, res) => {
  const { tipo } = req.params;
  try {
    const subtipos = await Data.find({ tipo }).distinct('subtipo');
    res.json({ subtipos });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error al obtener los subtipos' });
  }
});

// Actualizar un registro
router.put('/:id', protect, async (req, res) => {
    try {
        const actualizado = await Data.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        );
        if (actualizado) alertas.datoActualizado(actualizado, req.user);
        res.json(actualizado);
    } catch (error) {
        console.error(error);
        res.status(500).json({ msg: 'Error al actualizar el registro' });
    }
});

// Eliminar datos
router.delete('/:id', protect, async (req, res) => {
  try {
    const resultado = await Data.findByIdAndDelete(req.params.id);
    
    if (!resultado) {
      return res.status(404).json({ mensaje: 'Registro no encontrado' });
    }
    alertas.datoEliminado(resultado, req.user);

    res.json({ mensaje: 'Registro eliminado' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al eliminar el dato' });
  }
});

router.get('/tipos', protect, async (req, res) => {
  try {
    const tipos = await Data.distinct('tipo');
    res.json(tipos);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener los tipos' });
  }
});

router.get('/subtipos/:tipo', protect, async (req, res) => {
  const { tipo } = req.params;
  try {
    const subtipos = await Data.find({ tipo }).distinct('subtipo');
    res.json({ subtipos });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error al obtener los subtipos' });
  }
});


// Semáforo: cuántos indicadores hay en cada nivel y cuáles requieren atención (rojo y naranja, del menor al mayor cumplimiento)
router.get('/semaforo/resumen', protect, async (req, res) => {
  try {
    const registros = (await Data.find().lean()).map(conSemaforo);
    res.json(resumirSemaforo(registros));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error al calcular el semáforo' });
  }
});

module.exports = router;

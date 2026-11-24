const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Data = require('../models/Data');
const { protect } = require('../middleware/authMiddleware'); // Middleware para validar token
const { disparadores: alertas } = require('../services/alertas.service');
const { evaluarRegistro, conSemaforo, resumirSemaforo } = require('../utils/semaforo'); // Semáforo inteligente

const ROLES_ADMIN = ['SUPER_ADMIN', 'ADMIN'];
const TIPOS_VALIDOS = ['componente', 'actividad', 'fin', 'proposito'];
const esAdmin = (usuario) => ROLES_ADMIN.includes(usuario?.role);
const esDueno = (registro, usuario) => String(registro?.usuario) === String(usuario?.id);

/**
 * Toma del cuerpo solo los campos que el usuario puede capturar.
 * Nunca se acepta `usuario`, `_id` ni otros campos internos desde el cliente.
 * Devuelve { datos } o { error } con un mensaje para el usuario.
 */
function camposPermitidos(body = {}, { parcial = false } = {}) {
  const datos = {};
  if (body.tipo !== undefined || !parcial) {
    const tipo = String(body.tipo ?? '').trim();
    if (!TIPOS_VALIDOS.includes(tipo)) return { error: 'Selecciona un tipo de dato válido.' };
    datos.tipo = tipo;
  }
  for (const campo of ['subtipo', 'resumen', 'indicador']) {
    if (body[campo] !== undefined) datos[campo] = String(body[campo] ?? '').trim().slice(0, 500);
  }
  if (body.periodos !== undefined || !parcial) {
    if (!Array.isArray(body.periodos) || body.periodos.length > 3) return { error: 'Los periodos no tienen un formato válido.' };
    const periodos = [];
    for (const periodo of body.periodos) {
      const programado = Number(periodo?.programado ?? 0);
      const realizado = Number(periodo?.realizado ?? 0);
      if (!Number.isFinite(programado) || !Number.isFinite(realizado) || programado < 0 || realizado < 0) {
        return { error: 'Programado y realizado deben ser números mayores o iguales a 0.' };
      }
      periodos.push({ nombre: String(periodo?.nombre ?? '').trim().slice(0, 60), programado, realizado });
    }
    datos.periodos = periodos;
  }
  return { datos };
}

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
        return res.status(200).json({ msg: 'Datos guardados correctamente' });
      }
    }

    const { datos, error } = camposPermitidos(req.body);
    if (error) return res.status(400).json({ msg: error });

    const nuevoDato = new Data({
      ...datos,
      usuario: req.user.id,
      ...(offlineOperationId ? { offlineOperationId } : {}),
    });

    await nuevoDato.save();
    alertas.datoGuardado(nuevoDato);
    // Se responde con el semáforo del indicador recién guardado (por periodo y global)
    res.status(201).json({ msg: 'Datos guardados correctamente', semaforo: evaluarRegistro(nuevoDato.toObject()) });
  } catch (error) {
    if (offlineOperationId && error.code === 11000) {
      const alreadySaved = await Data.findOne({
        usuario: req.user.id,
        offlineOperationId
      }).select('+offlineOperationId');
      if (alreadySaved) {
        return res.status(200).json({ msg: 'Datos guardados correctamente' });
      }
    }
    console.error(error);
    res.status(500).json({ msg: 'Error al guardar los datos' });
  }
});

// Obtener datos. ADMIN y SUPER_ADMIN ven todos los registros; USER solo los suyos.
// Filtros opcionales: ?tipo=actividad&subtipo=Actividad 1.1&nivel=insuficiente
router.get('/', protect, async (req, res) => {
  const query = esAdmin(req.user) ? {} : { usuario: req.user.id };
  if (typeof req.query.tipo === 'string' && req.query.tipo) query.tipo = req.query.tipo;
  if (typeof req.query.subtipo === 'string' && req.query.subtipo) query.subtipo = req.query.subtipo;

  try {
    // Cada registro trae su semáforo (por periodo y global).
    const data = (await Data.find(query).lean()).map(conSemaforo);
    const nivel = String(req.query.nivel || '').trim();
    res.json(nivel ? data.filter((registro) => registro.semaforo.global.clave === nivel) : data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: 'Error al obtener los datos' });
  }
});

router.get('/tipos', protect, async (req, res) => {
  try {
    const tipos = await Data.distinct('tipo');
    res.json(tipos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: 'Error al obtener los tipos' });
  }
});

router.get('/subtipos/:tipo', protect, async (req, res) => {
  const { tipo } = req.params;
  try {
    const subtipos = await Data.find({ tipo }).distinct('subtipo');
    res.json({ subtipos });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: 'Error al obtener los subtipos' });
  }
});

// Semáforo: cuántos indicadores hay en cada nivel y cuáles requieren atención (rojo y naranja, del menor al mayor cumplimiento)
router.get('/semaforo/resumen', protect, async (req, res) => {
  try {
    const registros = (await Data.find().lean()).map(conSemaforo);
    res.json(resumirSemaforo(registros));
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: 'Error al calcular el semáforo' });
  }
});

// Actualizar un registro: solo su dueño o un administrador, y solo los campos permitidos.
router.put('/:id', protect, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ msg: 'Registro no válido' });
  try {
    const registro = await Data.findById(req.params.id);
    if (!registro) return res.status(404).json({ msg: 'Registro no encontrado' });
    if (!esDueno(registro, req.user) && !esAdmin(req.user)) {
      return res.status(403).json({ msg: 'Solo puedes editar tus propios registros.' });
    }

    const { datos, error } = camposPermitidos(req.body, { parcial: true });
    if (error) return res.status(400).json({ msg: error });

    registro.set(datos);
    const actualizado = await registro.save();
    alertas.datoActualizado(actualizado, req.user);
    res.json(actualizado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: 'Error al actualizar el registro' });
  }
});

// Eliminar un registro: solo su dueño o un administrador.
router.delete('/:id', protect, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ msg: 'Registro no válido' });
  try {
    const registro = await Data.findById(req.params.id);
    if (!registro) return res.status(404).json({ msg: 'Registro no encontrado' });
    if (!esDueno(registro, req.user) && !esAdmin(req.user)) {
      return res.status(403).json({ msg: 'Solo puedes eliminar tus propios registros.' });
    }

    await registro.deleteOne();
    alertas.datoEliminado(registro, req.user);
    res.json({ msg: 'Registro eliminado' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: 'Error al eliminar el dato' });
  }
});

module.exports = router;

// Motor de alertas de SIDII: catálogo, creación con deduplicación, envío push y acciones.
const Alerta = require('../models/Alerta');
const Data = require('../models/Data');
const User = require('../models/User');
const push = require('./push.service');
const { crearTokenAccion } = require('./alertaToken.service');
const semaforo = require('./semaforo.service');

const DIAS_PRORROGA = Number(process.env.ALERTA_DIAS_PRORROGA) > 0 ? Number(process.env.ALERTA_DIAS_PRORROGA) : 15;
const HORAS_POSPONER = Number(process.env.ALERTA_HORAS_POSPONER) > 0 ? Number(process.env.ALERTA_HORAS_POSPONER) : 24;
const DIAS_AVISO_CIERRE = String(process.env.ALERTA_DIAS_AVISO_CIERRE || '7,2')
  .split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0);

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

// modo "servidor": la acción se ejecuta en el backend (también desde la notificación, sin abrir la app).
// modo "abrir": la notificación abre SIDII en la vista indicada.
const ACCIONES = {
  ver: { titulo: 'Ver detalle', modo: 'abrir', vista: 'alertas' },
  corregir: { titulo: 'Corregir dato', modo: 'abrir', vista: 'edicion' },
  capturar: { titulo: 'Capturar ahora', modo: 'abrir', vista: 'edicion' },
  aprobar_prorroga: { titulo: 'Aprobar prórroga', modo: 'servidor', roles: ['SUPER_ADMIN'] },
  rechazar_prorroga: { titulo: 'Rechazar', modo: 'servidor', roles: ['SUPER_ADMIN'] },
  solicitar_revision: { titulo: 'Solicitar revisión', modo: 'servidor', roles: ['SUPER_ADMIN'] },
  solicitar_prorroga: { titulo: 'Pedir prórroga', modo: 'servidor' },
  posponer: { titulo: 'Recordar mañana', modo: 'servidor' },
  confirmar_dato: { titulo: 'El dato es correcto', modo: 'servidor' },
  hacer_admin: { titulo: 'Hacer ADMIN', modo: 'servidor', roles: ['SUPER_ADMIN'] },
  mantener_usuario: { titulo: 'Mantener USER', modo: 'servidor', roles: ['SUPER_ADMIN'] },
  reportar_cambio: { titulo: 'No reconozco el cambio', modo: 'servidor' },
  marcar_atendida: { titulo: 'Marcar atendida', modo: 'servidor' },
};

// Para cada tipo: severidad y acciones según el papel de quien la recibe.
//   rector      → usuarios SUPER_ADMIN
//   responsable → dueño del registro de datos
//   otros       → cualquier otro destinatario
const CATALOGO = {
  SEMAFORO_ROJO: {
    severidad: 'critica', etiqueta: 'Semáforo rojo',
    rector: ['aprobar_prorroga', 'solicitar_revision'], responsable: ['corregir', 'solicitar_prorroga'], otros: ['ver'],
  },
  SEMAFORO_NARANJA: {
    severidad: 'alta', etiqueta: 'Semáforo naranja',
    responsable: ['ver', 'posponer'], otros: ['ver', 'posponer'],
  },
  SOBRECUMPLIMIENTO: {
    severidad: 'media', etiqueta: 'Sobrecumplimiento',
    responsable: ['confirmar_dato', 'corregir'], otros: ['ver'],
  },
  DATO_INCONSISTENTE: {
    severidad: 'media', etiqueta: 'Dato inconsistente',
    responsable: ['corregir', 'confirmar_dato'], otros: ['ver'],
  },
  PERIODO_POR_CERRAR: {
    severidad: 'alta', etiqueta: 'Periodo por cerrar',
    responsable: ['capturar', 'solicitar_prorroga'], otros: ['ver'],
  },
  PRORROGA_SOLICITADA: {
    severidad: 'alta', etiqueta: 'Prórroga solicitada',
    rector: ['aprobar_prorroga', 'rechazar_prorroga'], otros: ['ver'],
  },
  RESPUESTA_RECTORIA: { severidad: 'info', etiqueta: 'Respuesta de Rectoría', otros: ['ver'] },
  PERIODO_ACTUALIZADO: { severidad: 'info', etiqueta: 'Periodos', otros: ['ver'] },
  NUEVO_USUARIO: {
    severidad: 'media', etiqueta: 'Nuevo usuario',
    rector: ['hacer_admin', 'mantener_usuario'], otros: ['ver'],
  },
  CAMBIO_ROL: { severidad: 'info', etiqueta: 'Cambio de rol', otros: ['ver'] },
  REGISTRO_MODIFICADO: {
    severidad: 'media', etiqueta: 'Registro modificado',
    responsable: ['ver', 'reportar_cambio'], otros: ['ver'],
  },
  CAMBIO_REPORTADO: {
    severidad: 'alta', etiqueta: 'Cambio no reconocido',
    rector: ['ver', 'marcar_atendida'], otros: ['ver'],
  },
  PRUEBA: { severidad: 'info', etiqueta: 'Prueba', otros: ['ver'] },
};

const ESTADOS_CON_ACCIONES = new Set(['abierta', 'pospuesta']);

class AlertaError extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const id = (valor) => (valor ? String(valor._id || valor) : '');
const recortar = (texto, max) => {
  const limpio = String(texto ?? '').replace(/\s+/g, ' ').trim();
  return limpio.length > max ? `${limpio.slice(0, max - 1)}…` : limpio;
};
const capitalizar = (texto) => String(texto || '').charAt(0).toUpperCase() + String(texto || '').slice(1);
const formatoFecha = (fecha) => new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Mexico_City', day: 'numeric', month: 'long', year: 'numeric',
}).format(fecha);

function describirDato(registro) {
  const tipo = capitalizar(registro?.tipo || 'Registro');
  const subtipo = String(registro?.subtipo || '').trim();
  // Los subtipos ya incluyen el tipo ("Componente 2", "Actividad 1.1").
  const nombre = subtipo && subtipo.toLowerCase().startsWith(tipo.toLowerCase()) ? subtipo : `${tipo}${subtipo ? ` ${subtipo}` : ''}`;
  const texto = registro?.indicador || registro?.resumen || '';
  return recortar(`${nombre}${texto ? `: ${texto}` : ''}`, 90);
}

async function idsConRol(...roles) {
  const usuarios = await User.find({ role: { $in: roles } }).select('_id').lean();
  return usuarios.map((usuario) => id(usuario));
}

async function nombreUsuario(usuarioId) {
  if (!usuarioId) return 'Sin responsable';
  const usuario = await User.findById(usuarioId).select('name').lean();
  return usuario?.name || 'Usuario eliminado';
}

function papelDe(alerta, usuario) {
  const catalogo = CATALOGO[alerta.tipo] || {};
  if (usuario?.role === 'SUPER_ADMIN' && catalogo.rector) return 'rector';
  if (alerta.responsable && id(alerta.responsable) === id(usuario) && catalogo.responsable) return 'responsable';
  return 'otros';
}

/** Acciones disponibles para un usuario en el estado actual de la alerta. */
function accionesPara(alerta, usuario) {
  const catalogo = CATALOGO[alerta.tipo] || {};
  const lista = catalogo[papelDe(alerta, usuario)] || catalogo.otros || ['ver'];
  return lista
    .map((accionId) => ({ id: accionId, ...ACCIONES[accionId] }))
    .filter((accion) => accion.titulo)
    .filter((accion) => !accion.roles || accion.roles.includes(usuario?.role))
    .filter((accion) => accion.modo === 'abrir' || (alerta.activa && ESTADOS_CON_ACCIONES.has(alerta.estado)));
}

function serializar(alerta, usuario) {
  const leidaPor = (alerta.leidaPor || []).map(id);
  return {
    id: id(alerta),
    tipo: alerta.tipo,
    etiqueta: CATALOGO[alerta.tipo]?.etiqueta || alerta.tipo,
    severidad: alerta.severidad,
    titulo: alerta.titulo,
    mensaje: alerta.mensaje,
    estado: alerta.estado,
    activa: alerta.activa,
    periodoIndex: alerta.periodoIndex,
    metadata: alerta.metadata || {},
    prorrogaHasta: alerta.prorrogaHasta,
    pospuestaHasta: alerta.pospuestaHasta,
    creada: alerta.createdAt,
    actualizada: alerta.updatedAt,
    leida: leidaPor.includes(id(usuario)),
    acciones: accionesPara(alerta, usuario).map(({ id: accionId, titulo, modo, vista }) => ({ id: accionId, titulo, modo, vista })),
    historial: (alerta.historial || []).slice(-10).map(({ accion, via, fecha, comentario }) => ({ accion, via, fecha, comentario })),
  };
}

// ---------------------------------------------------------------------------
// Envío push
// ---------------------------------------------------------------------------

async function notificar(alerta) {
  if (!push.estaHabilitado() || !alerta?.destinatarios?.length) return;
  const usuarios = await User.find({ _id: { $in: alerta.destinatarios } }).select('_id role').lean();
  const urgencia = ['critica', 'alta'].includes(alerta.severidad) ? 'high' : 'normal';

  await Promise.all(usuarios.map((usuario) => {
    const acciones = accionesPara(alerta, usuario);
    const tieneAccionesServidor = acciones.some((accion) => accion.modo === 'servidor');
    const payload = {
      tipo: 'SIDII_ALERTA',
      alertaId: id(alerta),
      alertaTipo: alerta.tipo,
      severidad: alerta.severidad,
      titulo: alerta.titulo,
      mensaje: alerta.mensaje,
      tag: `sidii-alerta-${id(alerta)}`,
      url: `dashboard.html#alerta=${id(alerta)}`,
      requireInteraction: alerta.severidad === 'critica',
      timestamp: Date.now(),
      // Los navegadores muestran como máximo 2 botones.
      actions: acciones.slice(0, 2).map((accion) => ({ action: accion.id, title: accion.titulo })),
      acciones: Object.fromEntries(acciones.map((accion) => [accion.id, { modo: accion.modo, vista: accion.vista }])),
      ...(tieneAccionesServidor ? { token: crearTokenAccion(id(alerta), id(usuario)) } : {}),
    };
    return push.enviarAUsuario(usuario._id, payload, { urgencia });
  }));
}

// ---------------------------------------------------------------------------
// Creación y resolución
// ---------------------------------------------------------------------------

/**
 * Crea una alerta evitando duplicados.
 * - Si ya hay una alerta activa con la misma clave, se actualiza (y solo se re-notifica si renotificar = true).
 * - Si existe una alerta cerrada con la misma clave y firma, el usuario ya la atendió con esos mismos datos: no se repite.
 * - informativa = true: aviso sin seguimiento; con unica = true no se vuelve a crear si ya existe esa clave.
 */
async function crearAlerta({
  tipo, titulo, mensaje, destinatarios, responsable, dato, periodoIndex, clave, firma, metadata = {},
  informativa = false, unica = false, renotificar = false, severidad,
}) {
  const catalogo = CATALOGO[tipo];
  if (!catalogo) throw new Error(`Tipo de alerta desconocido: ${tipo}`);
  const listaDestinatarios = [...new Set((destinatarios || []).map(id).filter(Boolean))];
  if (!listaDestinatarios.length) return null;

  const claveFinal = clave || `${tipo}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const datos = {
    tipo,
    severidad: severidad || catalogo.severidad,
    titulo: recortar(titulo, 120),
    mensaje: recortar(mensaje, 500),
    destinatarios: listaDestinatarios,
    responsable: responsable || undefined,
    dato: dato || undefined,
    periodoIndex,
    clave: claveFinal,
    firma,
    metadata,
  };

  if (informativa) {
    if (unica && await Alerta.exists({ clave: claveFinal })) return null;
    const alerta = await Alerta.create({ ...datos, estado: 'informativa', activa: false });
    await notificar(alerta);
    return alerta;
  }

  const existente = await Alerta.findOne({ clave: claveFinal, activa: true });
  if (existente) {
    const cambiaron = existente.firma !== firma;
    existente.set({ titulo: datos.titulo, mensaje: datos.mensaje, metadata, firma });
    listaDestinatarios.forEach((destinatario) => {
      if (!existente.destinatarios.map(id).includes(destinatario)) existente.destinatarios.push(destinatario);
    });
    if (renotificar) {
      existente.leidaPor = [];
      existente.historial.push({ accion: 'recordatorio', via: 'sistema' });
    } else if (cambiaron) {
      existente.historial.push({ accion: 'actualizada', via: 'sistema' });
    }
    await existente.save();
    if (renotificar) await notificar(existente);
    return existente;
  }

  if (firma && await Alerta.exists({ clave: claveFinal, estado: 'cerrada', firma })) return null;

  try {
    const alerta = await Alerta.create({ ...datos, historial: [{ accion: 'creada', via: 'sistema' }] });
    await notificar(alerta);
    return alerta;
  } catch (error) {
    if (error.code === 11000) return Alerta.findOne({ clave: claveFinal, activa: true });
    throw error;
  }
}

async function resolverAlertas(filtro, motivo) {
  const alertas = await Alerta.find({ ...filtro, activa: true }).select('_id').lean();
  if (!alertas.length) return 0;
  const ids = alertas.map((alerta) => alerta._id);
  await Alerta.updateMany(
    { _id: { $in: ids }, activa: true },
    { $set: { activa: false, estado: 'resuelta' }, $push: { historial: { accion: 'resuelta', via: 'sistema', comentario: motivo, fecha: new Date() } } },
  );
  // Las solicitudes de prórroga que dependían de estas alertas ya no tienen sentido.
  await Alerta.updateMany(
    { 'metadata.alertaOrigen': { $in: ids.map(String) }, activa: true },
    { $set: { activa: false, estado: 'resuelta' }, $push: { historial: { accion: 'resuelta', via: 'sistema', comentario: 'La alerta de origen se resolvió.', fecha: new Date() } } },
  );
  return ids.length;
}

// ---------------------------------------------------------------------------
// Evaluación de indicadores
// ---------------------------------------------------------------------------

const TIPOS_DE_DATO = [...semaforo.TIPOS_SEMAFORO, 'PERIODO_POR_CERRAR'];

function textoSemaforo(hallazgo, registro, responsableNombre) {
  const descripcion = describirDato(registro);
  const avance = hallazgo.porcentaje === null
    ? `realizado ${hallazgo.realizado} sin meta programada`
    : `${hallazgo.realizado} de ${hallazgo.programado} (${hallazgo.porcentaje} %)`;
  const titulos = {
    SEMAFORO_ROJO: '🔴 Indicador en semáforo rojo (Insuficiente)',
    SEMAFORO_NARANJA: '🟠 Indicador en semáforo naranja (Moderado)',
    SOBRECUMPLIMIENTO: '🔵 Indicador excedido',
    DATO_INCONSISTENTE: '⚠️ Dato inconsistente',
  };
  const notas = {
    DATO_INCONSISTENTE: 'Hay avance realizado, pero la meta programada es 0.',
  };
  return {
    titulo: titulos[hallazgo.tipo],
    mensaje: `${descripcion} · ${hallazgo.periodoNombre}: ${avance}. ${notas[hallazgo.tipo] || hallazgo.texto} Responsable: ${responsableNombre}.`,
  };
}

/** Evalúa un registro de Data: crea las alertas que correspondan y resuelve las que ya no aplican. */
async function evaluarDato(registro, { fecha = new Date(), cacheRoles } = {}) {
  if (!registro?._id) return;
  const hallazgos = semaforo.evaluarRegistro(registro, fecha);
  const responsable = registro.usuario ? id(registro.usuario) : null;

  // 1. Resolver alertas activas cuya condición desapareció.
  const activas = await Alerta.find({ dato: registro._id, activa: true, tipo: { $in: TIPOS_DE_DATO } }).select('_id tipo periodoIndex').lean();
  const vigentes = new Set(hallazgos.map((hallazgo) => `${hallazgo.tipo}:${hallazgo.periodoIndex}`));
  const porResolver = activas.filter((alerta) => {
    if (alerta.tipo === 'PERIODO_POR_CERRAR') {
      const periodo = (registro.periodos || [])[alerta.periodoIndex];
      return !periodo || Number(periodo.realizado) > 0 || !(Number(periodo.programado) > 0);
    }
    return !vigentes.has(`${alerta.tipo}:${alerta.periodoIndex}`);
  });
  if (porResolver.length) {
    await resolverAlertas({ _id: { $in: porResolver.map((alerta) => alerta._id) } }, 'El indicador cambió y la condición ya no se cumple.');
  }

  if (!hallazgos.length) return;

  // 2. Crear o actualizar las alertas vigentes.
  const roles = cacheRoles || {
    superAdmins: await idsConRol('SUPER_ADMIN'),
    admins: await idsConRol('ADMIN'),
  };
  const responsableNombre = await nombreUsuario(responsable);

  for (const hallazgo of hallazgos) {
    let destinatarios = [responsable];
    if (hallazgo.tipo === 'SEMAFORO_ROJO') destinatarios = [...roles.superAdmins, responsable];
    if (hallazgo.tipo === 'SEMAFORO_NARANJA') destinatarios = [responsable, ...roles.admins];
    const { titulo, mensaje } = textoSemaforo(hallazgo, registro, responsableNombre);
    await crearAlerta({
      tipo: hallazgo.tipo,
      titulo,
      mensaje,
      destinatarios,
      responsable,
      dato: registro._id,
      periodoIndex: hallazgo.periodoIndex,
      clave: `${hallazgo.tipo}:${id(registro)}:${hallazgo.periodoIndex}`,
      firma: `${hallazgo.programado}/${hallazgo.realizado}`,
      metadata: {
        indicador: recortar(registro.indicador || registro.resumen, 200),
        tipoDato: registro.tipo,
        subtipo: registro.subtipo,
        periodoNombre: hallazgo.periodoNombre,
        programado: hallazgo.programado,
        realizado: hallazgo.realizado,
        porcentaje: hallazgo.porcentaje,
        nivel: hallazgo.nivel,
        responsableNombre,
      },
    });
  }
}

/** Avisos de cierre de cuatrimestre para indicadores con meta y sin realizado capturado. */
async function avisarCierreDePeriodo(fecha = new Date()) {
  const { anio } = semaforo.fechaEnMexico(fecha);
  const indice = semaforo.periodoActual(fecha);
  const llavePeriodo = `${anio}-${indice}`;

  // Los avisos de cuatrimestres anteriores ya no aplican (el semáforo rojo toma su lugar).
  await resolverAlertas({ tipo: 'PERIODO_POR_CERRAR', 'metadata.llavePeriodo': { $ne: llavePeriodo } }, 'El cuatrimestre terminó.');

  const dias = semaforo.diasParaCierre(fecha);
  if (!DIAS_AVISO_CIERRE.includes(dias)) return 0;

  const nombrePeriodo = semaforo.NOMBRES_PERIODO[indice];
  // Solo registros del año en curso (los anteriores al campo `anio` no lo tienen).
  const cursor = Data.find({ $or: [{ anio }, { anio: { $exists: false } }] }).lean().cursor();
  let avisos = 0;
  for await (const registro of cursor) {
    const periodo = (registro.periodos || []).find((item, posicion) => (
      semaforo.NOMBRES_PERIODO.indexOf(String(item?.nombre || '').trim()) === indice
      || (semaforo.NOMBRES_PERIODO.indexOf(String(item?.nombre || '').trim()) === -1 && posicion === indice)
    ));
    if (!periodo || !(Number(periodo.programado) > 0) || Number(periodo.realizado) > 0 || !registro.usuario) continue;
    const clave = `PERIODO_POR_CERRAR:${id(registro)}:${llavePeriodo}`;
    // Un solo aviso por cada día configurado, aunque la revisión corra varias veces (reinicios del servidor).
    const previa = await Alerta.findOne({ clave, activa: true }).select('metadata.diasRestantes').lean();
    if (previa?.metadata?.diasRestantes === dias) continue;
    const cuando = dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`;
    await crearAlerta({
      tipo: 'PERIODO_POR_CERRAR',
      titulo: `⏰ El periodo ${nombrePeriodo} cierra ${cuando}`,
      mensaje: `${describirDato(registro)} tiene meta programada de ${periodo.programado} y aún no tiene avance realizado capturado.`,
      destinatarios: [registro.usuario],
      responsable: registro.usuario,
      dato: registro._id,
      periodoIndex: indice,
      clave,
      metadata: {
        llavePeriodo,
        diasRestantes: dias,
        indicador: recortar(registro.indicador || registro.resumen, 200),
        tipoDato: registro.tipo,
        subtipo: registro.subtipo,
        periodoNombre: nombrePeriodo,
        programado: Number(periodo.programado),
      },
      renotificar: true,
    });
    avisos += 1;
  }
  return avisos;
}

/** Reactiva alertas pospuestas y prórrogas vencidas. */
async function reactivarVencidas(fecha = new Date()) {
  const vencidas = await Alerta.find({
    activa: true,
    $or: [
      { estado: 'pospuesta', pospuestaHasta: { $lte: fecha } },
      { estado: 'prorroga', prorrogaHasta: { $lte: fecha } },
    ],
  });
  for (const alerta of vencidas) {
    const eraProrroga = alerta.estado === 'prorroga';
    alerta.estado = 'abierta';
    alerta.leidaPor = [];
    alerta.historial.push({ accion: eraProrroga ? 'prorroga_vencida' : 'recordatorio', via: 'sistema' });
    if (eraProrroga && !alerta.titulo.startsWith('Prórroga vencida')) {
      alerta.titulo = recortar(`Prórroga vencida · ${alerta.titulo}`, 120);
    }
    await alerta.save();
    await notificar(alerta);
  }
  return vencidas.length;
}

async function avisarInicioDePeriodo(fecha = new Date()) {
  if (!semaforo.esInicioDePeriodo(fecha)) return null;
  const { anio } = semaforo.fechaEnMexico(fecha);
  const indice = semaforo.periodoActual(fecha);
  const todos = await User.find({}).select('_id').lean();
  return crearAlerta({
    tipo: 'PERIODO_ACTUALIZADO',
    titulo: `📅 Inicia el periodo ${semaforo.NOMBRES_PERIODO[indice]}`,
    mensaje: `Ya puedes capturar el avance del cuatrimestre ${semaforo.NOMBRES_PERIODO[indice]} ${anio}.`,
    destinatarios: todos.map(id),
    clave: `PERIODO_INICIO:${anio}-${indice}`,
    informativa: true,
    unica: true,
  });
}

/** Revisión completa (la ejecuta el cron diario). */
async function revisionGeneral(fecha = new Date()) {
  const cacheRoles = { superAdmins: await idsConRol('SUPER_ADMIN'), admins: await idsConRol('ADMIN') };
  let evaluados = 0;
  for await (const registro of Data.find({}).lean().cursor()) {
    try {
      await evaluarDato(registro, { fecha, cacheRoles });
      evaluados += 1;
    } catch (error) {
      console.error(`[alertas] No se pudo evaluar el registro ${id(registro)}:`, error.message);
    }
  }
  const avisosCierre = await avisarCierreDePeriodo(fecha);
  await avisarInicioDePeriodo(fecha);
  const reactivadas = await reactivarVencidas(fecha);
  return { evaluados, avisosCierre, reactivadas };
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

async function responderAlResponsable(alerta, titulo, mensaje, severidad) {
  if (!alerta.responsable) return;
  await crearAlerta({
    tipo: 'RESPUESTA_RECTORIA',
    severidad,
    titulo,
    mensaje,
    destinatarios: [alerta.responsable],
    responsable: alerta.responsable,
    dato: alerta.dato,
    periodoIndex: alerta.periodoIndex,
    metadata: { alertaOrigen: id(alerta), indicador: alerta.metadata?.indicador },
    informativa: true,
  });
}

/**
 * Ejecuta una acción sobre una alerta en nombre de un usuario.
 * via: 'app' (desde la bandeja) o 'push' (desde el botón de la notificación).
 */
async function ejecutarAccion({ alertaId, accion, usuarioId, via = 'app', comentario }) {
  const [alerta, usuario] = await Promise.all([
    Alerta.findById(alertaId),
    User.findById(usuarioId).select('_id name role'),
  ]);
  if (!alerta) throw new AlertaError(404, 'La alerta no existe.');
  if (!usuario) throw new AlertaError(401, 'Usuario no encontrado.');
  if (!alerta.destinatarios.map(id).includes(id(usuario))) throw new AlertaError(403, 'Esta alerta no está dirigida a ti.');

  const disponible = accionesPara(alerta, usuario).find((item) => item.id === accion && item.modo === 'servidor');
  if (!disponible) throw new AlertaError(409, 'Esta alerta ya fue atendida o la acción ya no está disponible.');

  const ahora = new Date();
  const nota = typeof comentario === 'string' ? recortar(comentario, 500) : undefined;
  let mensaje = 'Acción registrada.';

  switch (accion) {
    case 'aprobar_prorroga': {
      const hasta = new Date(ahora.getTime() + DIAS_PRORROGA * 86400000);
      let objetivo = alerta;
      if (alerta.tipo === 'PRORROGA_SOLICITADA') {
        alerta.estado = 'cerrada';
        alerta.activa = false;
        const origen = alerta.metadata?.alertaOrigen ? await Alerta.findById(alerta.metadata.alertaOrigen) : null;
        if (origen?.activa) {
          origen.estado = 'prorroga';
          origen.prorrogaHasta = hasta;
          origen.historial.push({ accion, usuario: usuario._id, via, comentario: nota });
          await origen.save();
          objetivo = origen;
        }
      } else {
        alerta.estado = 'prorroga';
        alerta.prorrogaHasta = hasta;
      }
      await Alerta.updateMany(
        { 'metadata.alertaOrigen': id(objetivo), tipo: 'PRORROGA_SOLICITADA', activa: true, _id: { $ne: alerta._id } },
        { $set: { activa: false, estado: 'cerrada' } },
      );
      await responderAlResponsable(objetivo, '✅ Prórroga aprobada', `${objetivo.metadata?.indicador || 'Tu indicador'}: la Rectoría aprobó una prórroga hasta el ${formatoFecha(hasta)}.`);
      mensaje = `Prórroga aprobada hasta el ${formatoFecha(hasta)}.`;
      break;
    }
    case 'rechazar_prorroga':
      alerta.estado = 'cerrada';
      alerta.activa = false;
      await responderAlResponsable(alerta, '❌ Prórroga no aprobada', `${alerta.metadata?.indicador || 'Tu indicador'}: la Rectoría no aprobó la prórroga solicitada.`, 'alta');
      mensaje = 'Solicitud de prórroga rechazada.';
      break;
    case 'solicitar_revision':
      alerta.estado = 'revision';
      await responderAlResponsable(alerta, '🔎 Rectoría solicita revisión', `${alerta.metadata?.indicador || 'Tu indicador'} (${alerta.metadata?.periodoNombre || 'periodo'}): revisa y corrige la captura o la meta.`, 'alta');
      mensaje = 'Se pidió al responsable revisar el indicador.';
      break;
    case 'solicitar_prorroga': {
      const superAdmins = await idsConRol('SUPER_ADMIN');
      await crearAlerta({
        tipo: 'PRORROGA_SOLICITADA',
        titulo: '📨 Solicitud de prórroga',
        mensaje: `${usuario.name} solicita prórroga para ${alerta.metadata?.indicador || 'un indicador'} (${alerta.metadata?.periodoNombre || 'periodo vigente'}).${nota ? ` Motivo: ${nota}` : ''}`,
        destinatarios: superAdmins,
        responsable: alerta.responsable,
        dato: alerta.dato,
        periodoIndex: alerta.periodoIndex,
        clave: `PRORROGA_SOLICITADA:${id(alerta)}`,
        metadata: { ...alerta.metadata, alertaOrigen: id(alerta), solicitante: usuario.name },
      });
      mensaje = 'Solicitud de prórroga enviada a Rectoría.';
      break;
    }
    case 'posponer':
      alerta.estado = 'pospuesta';
      alerta.pospuestaHasta = new Date(ahora.getTime() + HORAS_POSPONER * 3600000);
      mensaje = `Te lo recordaremos en ${HORAS_POSPONER} horas.`;
      break;
    case 'confirmar_dato':
      alerta.estado = 'cerrada';
      alerta.activa = false;
      mensaje = 'Dato confirmado como correcto.';
      break;
    case 'hacer_admin': {
      const nuevo = alerta.metadata?.usuarioId ? await User.findById(alerta.metadata.usuarioId) : null;
      if (!nuevo) throw new AlertaError(404, 'El usuario ya no existe.');
      if (nuevo.role === 'USER') {
        nuevo.role = 'ADMIN';
        await nuevo.save();
        await alRolCambiado(nuevo);
      }
      alerta.estado = 'cerrada';
      alerta.activa = false;
      mensaje = `${nuevo.name} ahora es ADMIN.`;
      break;
    }
    case 'mantener_usuario':
    case 'marcar_atendida':
      alerta.estado = 'cerrada';
      alerta.activa = false;
      mensaje = 'Alerta atendida.';
      break;
    case 'reportar_cambio': {
      const superAdmins = await idsConRol('SUPER_ADMIN');
      await crearAlerta({
        tipo: 'CAMBIO_REPORTADO',
        titulo: '🚩 Cambio no reconocido en un registro',
        mensaje: `${usuario.name} no reconoce un cambio: ${alerta.mensaje}`,
        destinatarios: superAdmins,
        responsable: alerta.responsable,
        dato: alerta.dato,
        clave: `CAMBIO_REPORTADO:${id(alerta)}`,
        metadata: { alertaOrigen: id(alerta), ...alerta.metadata },
      });
      alerta.estado = 'cerrada';
      alerta.activa = false;
      mensaje = 'Se avisó a la Rectoría.';
      break;
    }
    default:
      throw new AlertaError(400, 'Acción no válida.');
  }

  alerta.historial.push({ accion, usuario: usuario._id, via, comentario: nota });
  if (!alerta.leidaPor.map(id).includes(id(usuario))) alerta.leidaPor.push(usuario._id);
  try {
    await alerta.save();
  } catch (error) {
    if (error.name === 'VersionError') throw new AlertaError(409, 'Otra persona atendió esta alerta al mismo tiempo. Actualiza la bandeja.');
    throw error;
  }
  return { mensaje, alerta, usuario };
}

// ---------------------------------------------------------------------------
// Disparadores desde otros módulos (nunca lanzan errores al endpoint que los llama)
// ---------------------------------------------------------------------------

function enSegundoPlano(nombre, tarea) {
  Promise.resolve()
    .then(tarea)
    .catch((error) => console.error(`[alertas] Falló el disparador ${nombre}:`, error));
}

async function avisarCambioAjeno(registro, actor, verbo) {
  const dueno = id(registro?.usuario);
  const actorId = id(actor?.id || actor?._id);
  if (!dueno || !actorId || dueno === actorId) return;
  const actorNombre = actor.name || (await nombreUsuario(actorId));
  await crearAlerta({
    tipo: 'REGISTRO_MODIFICADO',
    titulo: `✏️ ${actorNombre} ${verbo} tu registro`,
    mensaje: `${describirDato(registro)} fue ${verbo === 'eliminó' ? 'eliminado' : 'modificado'} por ${actorNombre}.`,
    destinatarios: [dueno],
    responsable: dueno,
    dato: verbo === 'eliminó' ? undefined : registro._id,
    clave: `REGISTRO_MODIFICADO:${id(registro)}:${actorId}`,
    metadata: { indicador: recortar(registro.indicador || registro.resumen, 200), tipoDato: registro.tipo, subtipo: registro.subtipo, actorNombre },
    renotificar: true,
  });
}

const disparadores = {
  datoGuardado(registro) {
    enSegundoPlano('datoGuardado', () => evaluarDato(registro));
  },
  datoActualizado(registro, actor) {
    enSegundoPlano('datoActualizado', async () => {
      await evaluarDato(registro);
      await avisarCambioAjeno(registro, actor, 'modificó');
    });
  },
  datoEliminado(registro, actor) {
    enSegundoPlano('datoEliminado', async () => {
      if (!registro?._id) return;
      await resolverAlertas({ dato: registro._id }, 'El registro fue eliminado.');
      await avisarCambioAjeno(registro, actor, 'eliminó');
    });
  },
  usuarioRegistrado(usuario) {
    enSegundoPlano('usuarioRegistrado', async () => {
      if (!usuario || usuario.role === 'SUPER_ADMIN') return;
      await crearAlerta({
        tipo: 'NUEVO_USUARIO',
        titulo: '👤 Nuevo usuario registrado',
        mensaje: `${usuario.name} (${usuario.email}) se registró como ${usuario.role}. ¿Quieres darle permisos de ADMIN?`,
        destinatarios: await idsConRol('SUPER_ADMIN'),
        clave: `NUEVO_USUARIO:${id(usuario)}`,
        metadata: { usuarioId: id(usuario), nombre: usuario.name },
      });
    });
  },
  rolCambiado(usuario) {
    enSegundoPlano('rolCambiado', () => alRolCambiado(usuario));
  },
  periodoForzado({ index, habilitado }, actor) {
    enSegundoPlano('periodoForzado', async () => {
      const todos = await User.find({}).select('_id').lean();
      const nombre = semaforo.NOMBRES_PERIODO[index] || `Periodo ${index}`;
      await crearAlerta({
        tipo: 'PERIODO_ACTUALIZADO',
        titulo: habilitado ? `📅 Se habilitó el periodo ${nombre}` : `📅 Se cerró el periodo ${nombre}`,
        mensaje: habilitado
          ? `${actor?.name || 'Rectoría'} habilitó la captura del periodo ${nombre}.`
          : `${actor?.name || 'Rectoría'} deshabilitó la captura del periodo ${nombre}.`,
        destinatarios: todos.map(id),
        informativa: true,
      });
    });
  },
};

async function alRolCambiado(usuario) {
  if (!usuario?._id) return;
  await resolverAlertas({ tipo: 'NUEVO_USUARIO', 'metadata.usuarioId': id(usuario) }, `Se asignó el rol ${usuario.role}.`);
  await crearAlerta({
    tipo: 'CAMBIO_ROL',
    titulo: '🔐 Tu rol en SIDII cambió',
    mensaje: `Ahora tienes el rol ${usuario.role}. Si no esperabas este cambio, contacta a la Rectoría.`,
    destinatarios: [usuario._id],
    informativa: true,
  });
}

module.exports = {
  ACCIONES,
  CATALOGO,
  AlertaError,
  accionesPara,
  serializar,
  crearAlerta,
  notificar,
  evaluarDato,
  revisionGeneral,
  avisarCierreDePeriodo,
  reactivarVencidas,
  ejecutarAccion,
  disparadores,
};

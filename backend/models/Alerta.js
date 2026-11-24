const mongoose = require('mongoose');

const TIPOS_ALERTA = [
  'SEMAFORO_ROJO',
  'SEMAFORO_NARANJA',
  'SOBRECUMPLIMIENTO',
  'DATO_INCONSISTENTE',
  'PERIODO_POR_CERRAR',
  'PRORROGA_SOLICITADA',
  'RESPUESTA_RECTORIA',
  'PERIODO_ACTUALIZADO',
  'NUEVO_USUARIO',
  'CAMBIO_ROL',
  'REGISTRO_MODIFICADO',
  'CAMBIO_REPORTADO',
  'PRUEBA',
];

const ESTADOS_ALERTA = [
  'abierta',      // requiere atención
  'pospuesta',    // el usuario pidió recordarla más tarde
  'prorroga',     // la Rectoría concedió una prórroga
  'revision',     // la Rectoría solicitó revisión al responsable
  'resuelta',     // la condición desapareció sola (por ejemplo, se corrigió el dato)
  'cerrada',      // alguien la atendió con una acción final
  'informativa',  // aviso sin seguimiento
];

const historialSchema = new mongoose.Schema({
  accion: { type: String, required: true },
  usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  via: { type: String, enum: ['push', 'app', 'sistema'], default: 'sistema' },
  comentario: { type: String, maxlength: 500 },
  fecha: { type: Date, default: Date.now },
}, { _id: false });

const alertaSchema = new mongoose.Schema({
  tipo: { type: String, enum: TIPOS_ALERTA, required: true },
  severidad: { type: String, enum: ['critica', 'alta', 'media', 'info'], required: true },
  titulo: { type: String, required: true, maxlength: 120 },
  mensaje: { type: String, required: true, maxlength: 500 },
  destinatarios: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
  // Responsable del indicador (dueño del registro) cuando la alerta se refiere a un dato.
  responsable: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  dato: { type: mongoose.Schema.Types.ObjectId, ref: 'Data' },
  periodoIndex: { type: Number, min: 0, max: 2 },
  // Llave de deduplicación: no puede haber dos alertas activas con la misma clave.
  clave: { type: String, required: true },
  // Firma de los valores que provocaron la alerta; evita repetir una alerta ya cerrada con los mismos datos.
  firma: { type: String },
  estado: { type: String, enum: ESTADOS_ALERTA, default: 'abierta' },
  activa: { type: Boolean, default: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  pospuestaHasta: { type: Date },
  prorrogaHasta: { type: Date },
  leidaPor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  historial: { type: [historialSchema], default: [] },
  // Identificadores de tokens de acción ya usados (un solo uso por token).
  tokensUsados: { type: [String], default: [], select: false },
}, { timestamps: true, optimisticConcurrency: true });

alertaSchema.index({ clave: 1 }, { unique: true, partialFilterExpression: { activa: true } });
alertaSchema.index({ destinatarios: 1, createdAt: -1 });
alertaSchema.index({ dato: 1, activa: 1 });
alertaSchema.index({ estado: 1, pospuestaHasta: 1 });

module.exports = mongoose.model('Alerta', alertaSchema);
module.exports.TIPOS_ALERTA = TIPOS_ALERTA;
module.exports.ESTADOS_ALERTA = ESTADOS_ALERTA;

const mongoose = require('mongoose');

const auditoriaFinalSchema = new mongoose.Schema({
  preauditoriaId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
  usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  nombreUsuario: { type: String, required: true },
  correoUsuario: { type: String, required: true },
  revisadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  nombreRevisor: { type: String, required: true },
  datosActividad: { type: mongoose.Schema.Types.Mixed, required: true },
  archivo: { type: mongoose.Schema.Types.Mixed, required: true },
  resultadoPreauditoria: { type: mongoose.Schema.Types.Mixed, required: true },
  informePreauditoria: { type: String, required: true },
  revision: {
    resultado: { type: String, enum: ['corregidas_todas', 'corregidas_parcialmente', 'sin_correccion'], required: true },
    cambiosRealizados: { type: String, required: true },
    observacionesPendientes: { type: String, default: '' },
    fecha: { type: Date, default: Date.now },
  },
  resultadoFinal: { type: String, required: true },
  informeTexto: { type: String, required: true },
}, { timestamps: true, collection: 'auditoriasfinales' });

auditoriaFinalSchema.index({ usuario: 1, createdAt: -1 });
auditoriaFinalSchema.index({ 'archivo.sha256': 1 });

module.exports = mongoose.model('AuditoriaFinal', auditoriaFinalSchema);

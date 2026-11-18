const mongoose = require('mongoose');

const preauditoriaSchema = new mongoose.Schema({
  usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  nombreUsuario: { type: String, required: true },
  correoUsuario: { type: String, required: true },
  datosActividad: { type: mongoose.Schema.Types.Mixed, required: true },
  archivo: {
    nombre: { type: String, required: true },
    mimeType: { type: String, required: true },
    tamanioBytes: { type: Number, required: true },
    sha256: { type: String, required: true },
    paginas: { type: Number, default: 0 },
    caracteresExtraidos: { type: Number, default: 0 },
    textoExtraible: { type: Boolean, default: false },
  },
  analisis: {
    nivelRelacion: { type: String, enum: ['Alta', 'Media', 'Baja', 'No determinada'], default: 'No determinada' },
    resumen: { type: String, required: true },
    hallazgos: [{ categoria: String, gravedad: String, titulo: String, detalle: String, fuente: String, evidenciaDocumento: String }],
    validaciones: [{ nombre: String, estado: String, detalle: String }],
    recomendaciones: [String],
    limitaciones: [String],
    revisionFirmas: { type: mongoose.Schema.Types.Mixed, default: null },
    alcanceRevision: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  informeTexto: { type: String, required: true },
  estado: { type: String, enum: ['pendiente_revision'], default: 'pendiente_revision', index: true },
  estadoNotificacion: { type: String, enum: ['nueva', 'pospuesta'], default: 'nueva' },
}, { timestamps: true, collection: 'preauditorias' });

preauditoriaSchema.index({ usuario: 1, estado: 1, createdAt: -1 });
preauditoriaSchema.index({ usuario: 1, 'archivo.sha256': 1 });

module.exports = mongoose.model('Preauditoria', preauditoriaSchema);

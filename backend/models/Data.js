const mongoose = require('mongoose');

const anioActual = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City', year: 'numeric' }).format(new Date()));

const dataSchema = new mongoose.Schema({
  usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  offlineOperationId: { type: String, unique: true, sparse: true, select: false },
  tipo: { type: String, required: true },
  subtipo: { type: String },
  resumen: { type: String },
  indicador: { type: String },
  // Año al que pertenecen los cuatrimestres del registro (los registros anteriores a este campo no lo tienen).
  anio: { type: Number, default: anioActual, index: true },
  periodos: {
    type: [
      {
        nombre: String,
        programado: { type: Number, min: 0 },
        realizado: { type: Number, min: 0 }
      }
    ],
    default: []
  }
}, { timestamps: true });

module.exports = mongoose.model('Data', dataSchema);

const mongoose = require('mongoose');

const chatHistorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  mensaje: { type: String, required: true, trim: true, maxlength: 4000 },
  rol: { type: String, required: true, enum: ['usuario', 'bot'] },
  fecha: { type: Date, required: true, default: Date.now },
});

chatHistorySchema.index({ userId: 1, fecha: 1, _id: 1 });

module.exports = mongoose.model('ChatHistory', chatHistorySchema);
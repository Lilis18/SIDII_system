const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema({
  usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  endpoint: { type: String, required: true, unique: true, maxlength: 2048 },
  keys: {
    p256dh: { type: String, required: true, maxlength: 256 },
    auth: { type: String, required: true, maxlength: 128 },
  },
  expirationTime: { type: Number, default: null },
  userAgent: { type: String, maxlength: 300 },
  ultimoEnvio: { type: Date },
  fallosConsecutivos: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);

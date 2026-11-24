const mongoose = require("mongoose");

const appSettingsSchema = new mongoose.Schema({
  // El primer y único SUPER_ADMIN
  superAdminId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true 
  },
  // Periodos habilitados manualmente por SUPER_ADMIN (0 = Ene-Abr, 1 = May-Ago, 2 = Sep-Dic).
  forcedPeriods: { type: [Number], default: [] },
}, { timestamps: true });

module.exports = mongoose.model("AppSettings", appSettingsSchema);

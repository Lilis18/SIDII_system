require('dotenv').config();

const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const dataRoutes = require('./routes/data');
const authRoutes = require('./routes/auth.routes');
const subtiposRoutes = require('./routes/subtipos');
const periodosRoutes = require('./routes/periodosRoutes')
const cacheControl = require('./middleware/cache-control');

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET debe configurarse en backend/.env o en el entorno del servidor.');
}

const app = express();
app.use(cacheControl);

const normalizeOrigin = (value) => {
  try {
    return new URL(value.trim().replace(/^(["'])(.*)\1$/, '$2')).origin;
  } catch {
    return null;
  }
};
const configuredOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([
  'https://sistema-integral-de-indicadores-zxuf.onrender.com',
  ...configuredOrigins,
].map(normalizeOrigin).filter(Boolean));

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(normalizeOrigin(origin))) return callback(null, true);
    return callback(new Error(`Origen no permitido por CORS: ${origin}`));
  },
}));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Rutas
app.use('/api/data', dataRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/subtipos', subtiposRoutes);
app.use('/api/periods', periodosRoutes);

// Error 404 para rutas no encontradas
app.use((req, res) => res.status(404).json({ message: 'Ruta no encontrada' }));

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Servidor corriendo en puerto ${PORT} :)`);
    });
  })
  .catch((error) => {
    console.error('Backend no iniciado:', error.message);
    process.exit(1);
  });

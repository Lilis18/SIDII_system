const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const AppSettings = require("../models/AppSettings");
const Data = require('../models/Data');
const Preauditoria = require('../models/Preauditoria');
const PushSubscription = require('../models/PushSubscription');
const { protect } = require('../middleware/authMiddleware');
const { disparadores: alertas } = require('../services/alertas.service');

const JWT_SECRET = process.env.JWT_SECRET;
const LONGITUD_MINIMA_CONTRASENA = 8;
const ROLES_ADMIN = ['SUPER_ADMIN', 'ADMIN'];

// Límite de intentos para evitar que se prueben contraseñas sin freno.
const limiteAcceso = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_MAX_INTENTOS) || 10,
  // Solo cuentan los intentos fallidos: un administrador que registra varias personas no se bloquea.
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { msg: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.' },
});

function validarContrasena(contrasena) {
  if (typeof contrasena !== 'string' || contrasena.length < LONGITUD_MINIMA_CONTRASENA) {
    return `La contraseña debe tener al menos ${LONGITUD_MINIMA_CONTRASENA} caracteres.`;
  }
  return null;
}

function firmarToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '1d' });
}

// Registro.
// - Si no existe ningún usuario, el primero se registra libremente y queda como SUPER_ADMIN.
// - Después, solo un ADMIN o SUPER_ADMIN con sesión puede registrar usuarios (pantalla "Registrar usuario").
router.post('/register', limiteAcceso, async (req, res, next) => {
  try {
    if (await User.exists({})) return protect(req, res, next);
    return next();
  } catch (error) {
    console.error('Error en /register:', error);
    return res.status(500).json({ msg: 'Error en el registro' });
  }
}, async (req, res) => {
  const { name, email, password } = req.body || {};

  if (req.user && !ROLES_ADMIN.includes(req.user.role)) {
    return res.status(403).json({ msg: 'Solo un administrador puede registrar usuarios.' });
  }
  if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ msg: 'Escribe el nombre y el correo.' });
  }
  const errorContrasena = validarContrasena(password);
  if (errorContrasena) return res.status(400).json({ msg: errorContrasena });

  try {
    const userExists = await User.findOne({ email: email.trim() });
    if (userExists) {
      return res.status(400).json({ msg: 'El usuario ya existe' });
    }

    const role = req.user ? "USER" : "SUPER_ADMIN";

    // Crear el usuario (el hash se hace en el pre('save')).
    // El índice único de SUPER_ADMIN (models/User.js) impide que dos registros simultáneos creen dos.
    const newUser = new User({ name: name.trim(), email: email.trim(), password, role });
    await newUser.save();
    alertas.usuarioRegistrado(newUser);

    // Si es SUPER_ADMIN, guardamos en AppSettings
    if (role === "SUPER_ADMIN") {
      let settings = await AppSettings.findOne();
      if (!settings) {
        settings = new AppSettings({ superAdminId: newUser._id });
      } else {
        settings.superAdminId = newUser._id;
      }
      await settings.save();
    }

    res.json({
      token: firmarToken(newUser),
      name: newUser.name,
      role: newUser.role,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ msg: 'El usuario ya existe o ya hay un SUPER_ADMIN registrado.' });
    }
    console.error("Error en /register:", error);
    res.status(500).json({ msg: 'Error en el registro' });
  }
});


// Login
router.post('/login', limiteAcceso, async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ msg: 'Escribe tu correo y tu contraseña.' });
    }

    try {
        const user = await User.findOne({ email: email.trim() });
        // Mismo mensaje en ambos casos para no revelar qué correos existen.
        if (!user || !(await user.matchPassword(password))) {
            return res.status(400).json({ msg: 'Correo o contraseña incorrectos' });
        }

        res.json({
            token: firmarToken(user),
            role: user.role,
            nombre: user.name
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ msg: 'Error en login' });
    }
});

// Ruta para cambio de contraseña
router.put('/cambiar-contrasena', protect, async (req, res) => {
    const { contrasenaActual, nuevaContrasena } = req.body || {};

    if (!contrasenaActual || !nuevaContrasena) {
        return res.status(400).json({ msg: 'Debes proporcionar la contraseña actual y la nueva' });
    }
    const errorContrasena = validarContrasena(nuevaContrasena);
    if (errorContrasena) return res.status(400).json({ msg: errorContrasena });

    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'Usuario no encontrado' });

        const esCorrecta = await user.matchPassword(contrasenaActual);
        if (!esCorrecta) {
            return res.status(400).json({ msg: 'La contraseña actual es incorrecta' });
        }

        user.password = nuevaContrasena; // el pre('save') hará el hash automáticamente
        await user.save();

        res.json({ msg: 'Contraseña actualizada correctamente' });
    } catch (error) {
        console.error('Error al actualizar la contraseña:', error);
        res.status(500).json({ msg: 'Error al actualizar la contraseña' });
    }
});

const onlySuperAdmin = (req, res, next) => {
  // Revisar rol REAL desde req.user (ya viene de la BD)
  if (req.user.role !== "SUPER_ADMIN") {
    return res.status(403).json({ msg: "No autorizado - Solo SUPER_ADMIN" });
  }
  next();
};

// El SUPER_ADMIN no puede cambiarse de rol ni eliminarse; así el sistema nunca se queda sin administrador principal.
function validarUsuarioObjetivo(req, user) {
  if (!user) return { status: 404, msg: "Usuario no encontrado" };
  if (String(user._id) === String(req.user.id)) return { status: 400, msg: "No puedes modificar tu propia cuenta desde aquí." };
  if (user.role === "SUPER_ADMIN") return { status: 403, msg: "La cuenta SUPER_ADMIN no se puede modificar ni eliminar." };
  return null;
}

// Cambiar rol de usuario
router.put("/users/:id/role", protect, onlySuperAdmin, async (req, res) => {
  const { role } = req.body || {};
  if (!["ADMIN", "USER"].includes(role)) {
    return res.status(400).json({ msg: "Rol no válido" });
  }
  try {
    const user = await User.findById(req.params.id);
    const problema = validarUsuarioObjetivo(req, user);
    if (problema) return res.status(problema.status).json({ msg: problema.msg });

    user.role = role;
    await user.save();
    alertas.rolCambiado(user);
    res.json({ msg: `Rol actualizado a ${role}`, user: { _id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al actualizar rol" });
  }
});

// Eliminar usuario. Si tiene registros capturados o preauditorías pendientes, no se elimina
// para no dejar información sin responsable; primero hay que reasignarlos o eliminarlos.
router.delete("/users/:id", protect, onlySuperAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    const problema = validarUsuarioObjetivo(req, user);
    if (problema) return res.status(problema.status).json({ msg: problema.msg });

    const [registros, preauditorias] = await Promise.all([
      Data.countDocuments({ usuario: user._id }),
      Preauditoria.countDocuments({ usuario: user._id }),
    ]);
    if (registros || preauditorias) {
      return res.status(409).json({
        msg: `No se puede eliminar: el usuario tiene ${registros} registro(s) de datos y ${preauditorias} preauditoría(s) pendiente(s). Reasígnalos o elimínalos primero.`,
      });
    }

    await user.deleteOne();
    await PushSubscription.deleteMany({ usuario: user._id });
    res.json({ msg: "Usuario eliminado correctamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al eliminar usuario" });
  }
});

router.get("/super-admin-exists", async (req, res) => {
  try {
    const superAdmin = await User.exists({ role: "SUPER_ADMIN" });
    return res.json({ exists: !!superAdmin });
  } catch (error) {
    console.error("Error verificando SUPER_ADMIN:", error);
    return res.status(500).json({ msg: "Error interno del servidor" });
  }
});

// GET /api/auth/users
router.get("/users", protect, onlySuperAdmin, async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.json(users);
  } catch (error) {
    console.error("Error al obtener usuarios:", error);
    res.status(500).json({ msg: "Error al obtener usuarios" });
  }
});

module.exports = router;

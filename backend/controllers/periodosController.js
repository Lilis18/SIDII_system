const AppSettings = require('../models/AppSettings');
const { disparadores: alertas } = require('../services/alertas.service');

const getCurrentPeriodIndex = (date = new Date()) => {
  const month = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    month: 'numeric',
  }).format(date));
  return Math.floor((month - 1) / 4);
};

// Los periodos habilitados manualmente se guardan en AppSettings para que no se pierdan al reiniciar el servidor.
async function leerPeriodosForzados() {
  const settings = await AppSettings.findOne().select('forcedPeriods').lean();
  return Array.isArray(settings?.forcedPeriods) ? settings.forcedPeriods : [];
}

const respuestaPeriodos = (forcedPeriods) => {
  const currentPeriod = getCurrentPeriodIndex();
  return { currentPeriod, forcedPeriods, activePeriods: [...new Set([currentPeriod, ...forcedPeriods])] };
};

const getPeriodos = async (req, res) => {
  try {
    res.json(respuestaPeriodos(await leerPeriodosForzados()));
  } catch (error) {
    console.error('Error al consultar periodos:', error);
    res.status(500).json({ msg: 'No se pudieron consultar los periodos.' });
  }
};

const togglePeriodo = async (req, res) => {
  const { index, habilitado } = req.body || {};

  if (!Number.isInteger(index) || index < 0 || index > 2 || typeof habilitado !== 'boolean') {
    return res.status(400).json({ msg: 'Datos inválidos' });
  }
  if (index === getCurrentPeriodIndex()) {
    return res.status(400).json({ msg: 'El periodo vigente se activa automáticamente.' });
  }

  try {
    let settings = await AppSettings.findOne();
    if (!settings) settings = new AppSettings({ superAdminId: req.user.id });
    const actuales = settings.forcedPeriods || [];
    const cambio = habilitado !== actuales.includes(index);
    settings.forcedPeriods = habilitado
      ? [...new Set([...actuales, index])]
      : actuales.filter((item) => item !== index);
    await settings.save();
    if (cambio) alertas.periodoForzado({ index, habilitado }, req.user);

    res.json({ msg: `Periodo ${index} actualizado a ${habilitado}`, ...respuestaPeriodos(settings.forcedPeriods) });
  } catch (error) {
    console.error('Error al actualizar periodos:', error);
    res.status(500).json({ msg: 'No se pudo actualizar el periodo.' });
  }
};

module.exports = { getPeriodos, togglePeriodo, getCurrentPeriodIndex };

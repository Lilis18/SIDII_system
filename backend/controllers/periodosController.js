let forcedPeriods = [];

const getCurrentPeriodIndex = (date = new Date()) => {
  const month = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    month: 'numeric',
  }).format(date));
  return Math.floor((month - 1) / 4);
};

const getPeriodos = (req, res) => {
  const currentPeriod = getCurrentPeriodIndex();
  res.json({ currentPeriod, forcedPeriods, activePeriods: [...new Set([currentPeriod, ...forcedPeriods])] });
};

const togglePeriodo = (req, res) => {
  const { index, habilitado } = req.body;

  if (!Number.isInteger(index) || index < 0 || index > 2 || typeof habilitado !== 'boolean') {
    return res.status(400).json({ message: 'Datos inválidos' });
  }
  if (index === getCurrentPeriodIndex()) {
    return res.status(400).json({ message: 'El periodo vigente se activa automáticamente.' });
  }

  if (habilitado && !forcedPeriods.includes(index)) forcedPeriods.push(index);
  if (!habilitado && forcedPeriods.includes(index)) forcedPeriods = forcedPeriods.filter(i => i !== index);

  const currentPeriod = getCurrentPeriodIndex();
  res.json({
    message: `Periodo ${index} actualizado a ${habilitado}`,
    currentPeriod,
    forcedPeriods,
    activePeriods: [...new Set([currentPeriod, ...forcedPeriods])],
  });
};

module.exports = { getPeriodos, togglePeriodo, getCurrentPeriodIndex };

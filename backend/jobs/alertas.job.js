const cron = require('node-cron');
const alertas = require('../services/alertas.service');

const ZONA = 'America/Mexico_City';
let ejecutando = false;

async function ejecutar(nombre, tarea) {
  if (ejecutando) return;
  ejecutando = true;
  try {
    const resultado = await tarea();
    console.log(`[alertas] ${nombre} completada`, resultado ?? '');
  } catch (error) {
    console.error(`[alertas] ${nombre} falló:`, error);
  } finally {
    ejecutando = false;
  }
}

function iniciarTareasDeAlertas() {
  if (process.env.ALERTAS_CRON === 'off') {
    console.log('[alertas] Tareas programadas desactivadas (ALERTAS_CRON=off).');
    return;
  }

  // Revisión diaria: semáforos, avisos de cierre de cuatrimestre e inicio de periodo.
  cron.schedule(process.env.ALERTAS_CRON_DIARIO || '0 8 * * *', () => {
    void ejecutar('Revisión diaria', () => alertas.revisionGeneral());
  }, { timezone: ZONA });

  // Cada 15 minutos: recordatorios pospuestos y prórrogas vencidas.
  cron.schedule('*/15 * * * *', () => {
    void ejecutar('Reactivación de alertas', () => alertas.reactivarVencidas());
  }, { timezone: ZONA });

  // Al arrancar (Render puede dormir el servicio y perder la ejecución de las 8:00).
  setTimeout(() => {
    void ejecutar('Revisión al iniciar', () => alertas.revisionGeneral());
  }, 15000);
}

module.exports = { iniciarTareasDeAlertas };

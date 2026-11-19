# Alertas de SIDII

Sistema de alertas con **notificaciones Web Push** y **botones de acción nativos**: quien recibe la alerta puede responderla desde la propia notificación (por ejemplo, el Rector aprueba una prórroga) sin abrir la app. El Service Worker envía la respuesta al backend en segundo plano.

> Rector = rol `SUPER_ADMIN`. Responsable de un indicador = usuario que capturó el registro (`Data.usuario`).

## Catálogo de alertas

| Alerta | Cuándo se genera | Quién la recibe | Botones |
|---|---|---|---|
| 🔴 **Semáforo rojo** (Insuficiente) | Cumplimiento < 70 % | Rector · Responsable | Rector: **Aprobar prórroga · Solicitar revisión**. Responsable: Corregir dato · Pedir prórroga |
| 🟠 **Semáforo naranja** (Moderado) | Cumplimiento de 70 a 79 % | Responsable · ADMIN | Ver detalle · Recordar mañana |
| 🔵 **Excedido** | Más del 110 % (revisar si la meta se programó muy baja) | Responsable | El dato es correcto · Corregir dato |
| ⚠️ **Dato inconsistente** | Realizado > 0 con programado = 0 | Responsable | Corregir dato · El dato es correcto |
| ⏰ **Periodo por cerrar** | 7 y 2 días antes de que termine el cuatrimestre, si hay meta sin avance | Responsable | Capturar ahora · Pedir prórroga |
| 📨 **Prórroga solicitada** | El responsable pidió una prórroga | Rector | Aprobar prórroga · Rechazar |
| ✅ **Respuesta de Rectoría** | Prórroga aprobada o rechazada, o revisión solicitada | Responsable | Ver detalle |
| 📅 **Periodos** | Inicio de cuatrimestre, o el Rector habilita o deshabilita un periodo | Todos | Ver detalle |
| 👤 **Nuevo usuario** | Alguien se registra | Rector | Hacer ADMIN · Mantener USER |
| 🔐 **Cambio de rol** | Se cambia el rol de un usuario | Ese usuario | Ver detalle |
| ✏️ **Registro modificado** | Otra persona edita o elimina tu registro | Responsable | Ver detalle · No reconozco el cambio |
| 🚩 **Cambio no reconocido** | El responsable reporta un cambio | Rector | Ver detalle · Marcar atendida |
| 🔄 **Sincronización fallida** | Capturas offline sin enviar con SIDII en segundo plano (notificación local) | El mismo usuario | Reintentar ahora |

**Cómo se evalúa el semáforo:** las alertas usan el **semáforo inteligente del equipo** (`backend/utils/semaforo.js`, el mismo que muestra la pantalla). Generan alerta los niveles Insuficiente, Moderado y Excedido; Adecuado (80–89 %) y Aceptable (90–110 %) no. Si se cambian los rangos en ese archivo, las alertas se ajustan solas. Se evalúa `realizado / programado` de cada cuatrimestre. Un cuatrimestre se evalúa cuando ya tiene realizado capturado o cuando ya terminó; un cuatrimestre pasado con realizado 0 queda en rojo.

**Comportamiento automático:**
- **Sin duplicados:** solo hay una alerta activa por indicador, periodo y tipo.
- **Autorresolución:** si se corrige el dato y la condición desaparece, la alerta se marca "Resuelta" sola.
- **Datos confirmados:** un dato marcado como "El dato es correcto" no vuelve a alertar mientras no cambie.
- **Posponer:** "Recordar mañana" vuelve a notificar a las 24 h.
- **Prórroga:** al vencer, la alerta se reabre y se notifica de nuevo.

## Cómo funciona

```
Captura/edición (routes/data.js) ─┐
Registro / cambio de rol ─────────┼─► services/alertas.service.js ──► MongoDB (Alerta)
Periodo habilitado ───────────────┤         │
Cron diario 8:00 (jobs/) ─────────┘         └─► services/push.service.js ──► Web Push ──► Service Worker
                                                                                       │
     POST /api/alertas/:id/accion-push  ◄── botón de la notificación (token de un solo uso)
```

- **Seguridad de los botones:** el Service Worker no tiene acceso al JWT de sesión, que vive en `localStorage`. Por eso cada notificación lleva un **token de acción propio** con estas propiedades:
  - Está firmado con un secreto derivado, así que no sirve como sesión.
  - Es de **un solo uso** y vence en 72 h.
  - Está limitado a esa alerta y a ese usuario.
  - El backend vuelve a validar que el usuario tenga permiso para la acción, según su rol y el estado de la alerta.
- **Sin conexión:** si el botón se pulsa sin internet, la respuesta se guarda en IndexedDB y se envía con Background Sync, o al abrir SIDII en navegadores que no lo soportan.
- **Concurrencia:** si dos personas atienden la misma alerta al mismo tiempo, la segunda recibe el aviso "ya fue atendida".

## Archivos

| Archivo | Qué contiene |
|---|---|
| `backend/models/Alerta.js` | Modelo de alerta: estado, historial y deduplicación |
| `backend/models/PushSubscription.js` | Dispositivos suscritos por usuario |
| `backend/services/semaforo.service.js` | Qué niveles del semáforo del equipo generan alerta, y fechas de cuatrimestre |
| `backend/services/alertas.service.js` | Catálogo, motor, acciones y disparadores |
| `backend/services/push.service.js` | Envío Web Push (VAPID) y limpieza de suscripciones vencidas |
| `backend/services/alertaToken.service.js` | Tokens de acción de un solo uso |
| `backend/routes/alertas.routes.js` | `/api/alertas`: bandeja, resumen, leídas y acciones |
| `backend/routes/push.routes.js` | `/api/push`: llave VAPID, suscribir, desuscribir, renovar y prueba |
| `backend/jobs/alertas.job.js` | Cron diario y reactivación cada 15 min |
| `frontend/js/alertas.js` | Pestaña Alertas, suscripción push y distintivo |
| `frontend/css/alertas.css` | Estilos de la bandeja |
| `frontend/service-worker.js` | Bloque final: `push`, `notificationclick`, `sync` y `pushsubscriptionchange` |

**Ganchos agregados en archivos existentes** (una línea cada uno, nunca hacen fallar el endpoint original):
- `server.js`: monta las rutas e inicia el cron.
- `routes/data.js`: evalúa el registro al guardar, editar y eliminar.
- `routes/auth.routes.js`: avisa al registrar un usuario y al cambiar un rol.
- `controllers/periodosController.js`: avisa cuando se habilita o deshabilita un periodo.
- `dashboard.html`: agrega la pestaña, la vista, el CSS y el script.
- `service-worker.js`: sube la versión de caché a v15 y precarga los archivos nuevos.

## Configuración

1. Generar las llaves VAPID una sola vez y guardarlas en el `.env` del backend (en local y en Render):
   ```bash
   cd backend && npm install && npm run vapid
   ```
   ```env
   VAPID_PUBLIC_KEY=...
   VAPID_PRIVATE_KEY=...
   VAPID_SUBJECT=mailto:correo-del-administrador@...
   ```
   Si faltan las llaves, las alertas se siguen guardando y se ven en la pestaña, pero no se envían como push.
2. Opcionales, con su valor por defecto:
   - `ALERTA_DIAS_PRORROGA=15`, `ALERTA_HORAS_POSPONER=24`, `ALERTA_DIAS_AVISO_CIERRE=7,2`
   - `ALERTAS_CRON_DIARIO=0 8 * * *` (hora de México), `ALERTAS_CRON=off` para desactivar el cron
3. Cada usuario entra en **Alertas → Activar notificaciones** en cada dispositivo y puede usar **Enviar prueba**.

## Compatibilidad

| Plataforma | Push | Botones en la notificación |
|---|---|---|
| Android (Chrome, Edge, Samsung Internet) | ✅ | ✅ (máximo 2) |
| Windows y macOS (Chrome, Edge) | ✅ | ✅ |
| Firefox escritorio | ✅ | ✅ |
| iPhone y iPad (iOS 16.4 o superior) | ✅ solo con SIDII **instalada** en la pantalla de inicio | ❌ Al tocar la notificación se abre la alerta en la bandeja |
| Safari macOS | ✅ | ❌ |

Push requiere HTTPS (o `localhost`).

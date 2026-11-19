# Observaciones para el equipo

Durante la implementación de las alertas (rama `erika/alertas`) encontré estos puntos en otros módulos. **No los modifiqué** porque no son parte de las alertas; quedan como sugerencias para quien corresponda.

## Seguridad y permisos (prioridad alta)

1. **`PUT` y `DELETE /api/data/:id` no validan dueño ni rol** (`backend/routes/data.js`). Cualquier usuario con sesión puede editar o borrar registros ajenos. Además, `PUT` guarda `req.body` completo, así que también se puede cambiar el campo `usuario`.
   *Mitigación de las alertas:* el dueño recibe la alerta "Registro modificado" y puede reportarla a Rectoría, pero eso no sustituye la validación.
2. **`GET /api/data` devuelve los registros de todos los usuarios.** Los filtros `fin`, `proposito`, `componente` y `actividad` no existen en el modelo `Data`, así que no tienen efecto.
3. **`PUT /api/auth/cambiar-contrasena` no funciona.** Usa `req.usuarioId`, que es `undefined`; el middleware guarda el usuario en `req.user.id`. Siempre responde "Usuario no encontrado".
4. **`GET /api/subtipos/:tipo` no tiene `protect`.**
5. **`POST /api/auth/register` es público:** cualquiera puede crear una cuenta USER. El primer usuario registrado se vuelve SUPER_ADMIN, y si hay dos registros simultáneos con la base vacía, ambos podrían quedar como SUPER_ADMIN.
   *Mitigación de las alertas:* el Rector recibe "Nuevo usuario" con cada registro.

## Datos y periodos

6. **Los periodos forzados viven en memoria** (`controllers/periodosController.js`): se pierden en cada reinicio, y Render reinicia o duerme el servicio con frecuencia. Convendría guardarlos en `AppSettings`.
7. **`PUT /api/auth/periods` escribe `settings.periodsOpen`,** un campo que no existe en el esquema `AppSettings`, así que no hace nada. Parece código viejo.
8. **`Data` no tiene año.** No se pueden distinguir los cuatrimestres de distintos años.
   *Efecto en las alertas:* al pasar de diciembre a enero, Septiembre–Diciembre no se considera "cerrado", así que un avance en 0 de ese cuatrimestre no genera semáforo rojo automático.
   *Sugerencia:* agregar `anio` al modelo.
9. **No hay campo de carrera ni de área responsable** en `Data`. Las alertas usan al usuario que capturó el registro como responsable.

## Código

10. **`backend/controllers/authController.js` usa `import`/`export` (ESM)** en un proyecto CommonJS. Hoy no se usa, pero si alguien lo importa con `require`, el servidor falla al arrancar.
11. **La ruta `GET /subtipos/:tipo` está declarada dos veces** en `routes/data.js`.
12. **`frontend/js/pwa.js` pide permiso de notificaciones apenas se abre el dashboard,** sin que el usuario lo solicite. Chrome y Edge penalizan esto: muestran el aviso de forma silenciosa o lo bloquean.
    *Sugerencia:* quitar `requestDashboardNotificationPermission()` y dejar que el permiso se pida desde el botón **Alertas → Activar notificaciones**, que ya lo hace con un gesto del usuario.

## Infraestructura

13. **Render (plan gratuito) duerme el backend sin tráfico,** así que la revisión diaria de las 8:00 puede no ejecutarse a tiempo. Las alertas ya corren una revisión al arrancar el servidor, pero para que los avisos lleguen a la hora conviene una de dos opciones:
    - un *ping* externo (por ejemplo, UptimeRobot) a cualquier ruta del backend;
    - un Render Cron Job.
14. **Hay que agregar las variables `VAPID_*` en Render.** Ver `docs/ALERTAS.md`.

## Ideas de la propuesta original que quedan fuera de las alertas

- **App Shortcuts** (`manifest.json → shortcuts`): menú al mantener presionado el ícono, por ejemplo "Cargar evidencia rápida" o "Ver alertas".
- **Evidencia rápida con cámara y preclasificación con IA:** requiere guardar las evidencias en el backend (hoy el PDF solo se genera en el navegador) y definir un proveedor de IA. La API key debe quedarse en el backend.

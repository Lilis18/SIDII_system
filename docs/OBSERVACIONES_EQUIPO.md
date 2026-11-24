# Observaciones para el equipo

Revisión completa del proyecto con la versión más reciente: `main` en `dfe2c8d` más la rama `erika/alertas`. Incluye el semáforo inteligente, las preauditorías y las alertas.

Cada punto indica dónde está el problema y qué se recomienda. Las correcciones se aplicaron en la rama `erika/alertas` y están verificadas con pruebas automáticas (`npm test`) y pruebas de integración.

## Estado de las correcciones

| # | Observación | Estado |
|---|---|---|
| 1 | Editar o borrar registros ajenos | ✅ Solo el dueño o un administrador; se guardan únicamente los campos permitidos |
| 2 | `GET /api/data` devuelve todo | ✅ USER ve solo sus registros; ADMIN y SUPER_ADMIN ven todos. Filtros por `tipo` y `subtipo` |
| 3 | Cambio de contraseña roto | ✅ Usa `req.user.id`; mínimo 8 caracteres |
| 4 | SUPER_ADMIN sin protección | ✅ No se puede degradar ni eliminar, ni modificar la propia cuenta |
| 5 | Usuarios eliminados dejan registros huérfanos | ✅ No se elimina un usuario con registros o preauditorías pendientes (responde 409) |
| 6 | Sin límite de intentos de inicio de sesión | ✅ `express-rate-limit`: 10 intentos fallidos cada 15 min por IP |
| 7 | Preauditorías sin límite | ✅ Máximo 20 por usuario cada 24 h (`PREAUDITORIA_MAX_DIARIAS`) |
| 8 | JSON de 50 MB | ✅ Límite de 1 MB |
| 9 | Registro público | ✅ Solo el primer usuario se registra libremente; después solo un administrador. Índice único de SUPER_ADMIN |
| 10 | Errores internos en las respuestas | ✅ Eliminados. El inicio de sesión responde un mensaje genérico, sin revelar si el correo existe |
| 11 | `Data` sin año ni fechas | ✅ `anio` y `timestamps` en registros nuevos. Las alertas consideran cerrados los periodos de años anteriores |
| 12 | Periodos en memoria | ✅ Se guardan en `AppSettings.forcedPeriods` |
| 13 | Semáforo duplicado | ✅ `npm test` falla si los dos archivos no son idénticos |
| 14 | Subtipos | 🟡 Ruta `/api/subtipos` protegida. **Falta que el equipo decida** si los subtipos vienen de la base o del frontend |
| 15 | Números sin validar | ✅ `min: 0` en el modelo y validación en la ruta |
| 16 | Envío de datos a Groq | ✅ Aviso en la pantalla de evidencias |
| 17 | Modelo de visión | ✅ Revisado: la guía del auditor indica que Groq documenta el modelo. Se agregaron las variables `GROQ_*` al `.env.example`, donde faltaban |
| 18 | `pdf-parse` antiguo | ⏸ **Pendiente.** Cambiarlo requiere probar con PDFs reales de la universidad |
| 19 | Ruta duplicada | ✅ Eliminada |
| 20 | Código muerto | ✅ Eliminados `PUT /auth/periods` y `authController.js` |
| 21 | Formato de respuestas | ✅ Errores con `{ msg }` en datos, autenticación, periodos y subtipos. Convención documentada en el README |
| 22 | `console.log` de depuración | ✅ Eliminado |
| 23 | Permiso de notificaciones automático | ✅ Se pide solo desde Alertas → Activar notificaciones |
| 24 | Sin README | ✅ `README.md` con instalación, variables, despliegue, roles y convenciones |
| 25 | Sin pruebas ni revisión automática | ✅ `npm test` (8 pruebas) y GitHub Actions (`.github/workflows/ci.yml`) en cada PR |

**Cambios de comportamiento que el equipo debe conocer:**
- **Gestión de datos y gráficas:** un usuario con rol USER ahora ve solo sus propios registros.
- **Registro de usuarios:** `register.html` solo funciona sin sesión mientras no existe ningún usuario. Después, solo lo puede usar un administrador con sesión, que es como ya lo usaba el panel.
- **Contraseñas:** deben tener al menos 8 caracteres.

El resto del documento conserva el detalle original de cada observación.

---

## 🔴 Prioridad alta: seguridad y errores

### 1. Cualquier usuario puede editar o borrar registros ajenos
**Dónde:** `backend/routes/data.js`, rutas `PUT /api/data/:id` y `DELETE /api/data/:id`.

No se revisa si quien edita es el dueño del registro ni su rol. Además, `PUT` guarda `req.body` completo, así que también se puede cambiar el campo `usuario`, es decir, el dueño.

**Recomendación:** permitir la edición solo al dueño o a ADMIN/SUPER_ADMIN, y guardar únicamente los campos permitidos (`tipo`, `subtipo`, `resumen`, `indicador`, `periodos`).

*Mitigación actual:* el dueño recibe la alerta "Registro modificado" y puede reportarla a Rectoría, pero eso no sustituye la validación.

### 2. `GET /api/data` devuelve los registros de todos los usuarios
**Dónde:** `backend/routes/data.js`.

Los filtros `fin`, `proposito`, `componente` y `actividad` buscan campos que no existen en el modelo `Data`, así que no filtran nada.

**Recomendación:** definir quién puede ver qué registros (por ejemplo, USER solo los suyos) y filtrar por `tipo` y `subtipo`, que sí existen.

### 3. El cambio de contraseña no funciona
**Dónde:** `backend/routes/auth.routes.js:101`.

Usa `req.usuarioId`, que no existe, así que siempre responde "Usuario no encontrado".

**Recomendación:** cambiarlo por `req.user.id`. Es una corrección de una línea.

### 4. El SUPER_ADMIN puede quedarse sin acceso
**Dónde:** `backend/routes/auth.routes.js`, rutas `PUT /users/:id/role` y `DELETE /users/:id`.

El backend no impide cambiar el rol del SUPER_ADMIN ni borrarlo, incluso a sí mismo. Si eso pasa, el sistema se queda sin administrador principal. El frontend lo oculta, pero el backend lo permite.

**Recomendación:** rechazar esas operaciones cuando el usuario objetivo sea SUPER_ADMIN.

### 5. Al borrar un usuario, sus registros quedan huérfanos
**Dónde:** `DELETE /api/auth/users/:id`.

Sus `Data`, preauditorías, auditorías y alertas quedan en la base sin dueño.

**Recomendación:** decidir si se reasignan o se archivan, o impedir que se borren usuarios que tengan registros.

### 6. No hay límite de intentos de inicio de sesión
**Dónde:** `POST /api/auth/login`.

Se pueden probar contraseñas sin ningún freno.

**Recomendación:** usar `express-rate-limit` en `/login` y `/register`, por ejemplo con un máximo de 10 intentos cada 15 minutos.

### 7. Las preauditorías se pueden usar sin límite
**Dónde:** `POST /api/auditorias/preauditorias`.

Cada llamada gasta tokens de Groq (texto e imágenes), y cualquier usuario con sesión puede repetirla sin restricción. Eso puede generar costos.

**Recomendación:** un límite por usuario por día, y reutilizar el resultado cuando se sube el mismo archivo (ya se calcula su `sha256`).

### 8. El servidor acepta JSON de hasta 50 MB en todas las rutas
**Dónde:** `backend/server.js:50-51`.

Con unas cuantas peticiones grandes se puede saturar el servidor.

**Recomendación:** dejar 1 MB como límite general. Las preauditorías ya reciben su PDF por `multer`, que tiene su propio límite.

### 9. El registro de usuarios es público
**Dónde:** `POST /api/auth/register`.

Cualquiera puede crear una cuenta USER. El primer usuario registrado se vuelve SUPER_ADMIN, y si dos personas se registran al mismo tiempo con la base vacía, ambas podrían quedar como SUPER_ADMIN.

**Recomendación:** que solo un ADMIN pueda registrar usuarios, y crear el primer SUPER_ADMIN con un script de instalación.

*Mitigación actual:* el Rector recibe la alerta "Nuevo usuario" con cada registro.

### 10. Hay errores internos que se le muestran al usuario
**Dónde:** `backend/routes/auth.routes.js:57`.

La respuesta de `/register` incluye `error: error.message`, que puede revelar detalles internos.

**Recomendación:** registrar el error en la consola del servidor y responder solo un mensaje general.

---

## 🟠 Prioridad media: datos y funcionamiento

### 11. `Data` no guarda el año ni la fecha de creación
**Dónde:** `backend/models/Data.js`.

No se pueden distinguir los cuatrimestres de distintos años ni consultar un historial.

*Efecto en las alertas:* al pasar de diciembre a enero, el cuatrimestre Septiembre–Diciembre no se considera cerrado.

**Recomendación:** agregar `anio` y `{ timestamps: true }`.

### 12. Los periodos habilitados se pierden al reiniciar el servidor
**Dónde:** `backend/controllers/periodosController.js`.

Los periodos habilitados por SUPER_ADMIN se guardan en memoria, y Render reinicia o duerme el servicio con frecuencia.

**Recomendación:** guardarlos en `AppSettings`.

### 13. El semáforo está copiado en dos archivos
**Dónde:** `backend/utils/semaforo.js` y `frontend/js/semaforo.js`.

Hay que mantenerlos iguales a mano. Hoy coinciden, pero es fácil que se desajusten.

**Recomendación:** un script que compare los dos archivos antes de cada commit, o que el backend sirva el archivo al frontend.

### 14. Los subtipos están escritos a mano en el frontend
**Dónde:** `frontend/js/cargaDeDatos.js`.

Ya existen el modelo `Subtipo` y la ruta `/api/subtipos/:tipo`, pero nadie los usa. Además, esa ruta no pide sesión (`protect`).

**Recomendación:** decidir una sola fuente de subtipos y proteger la ruta.

### 15. No se validan los números capturados
**Dónde:** `backend/models/Data.js` y `routes/data.js`.

`programado` y `realizado` pueden ser negativos, texto o vacíos.

**Recomendación:** poner `min: 0` en el esquema y validar en la ruta.

### 16. Las preauditorías envían datos a un servicio externo
**Dónde:** `backend/services/groqAuditService.js` y `groqSignatureVisionService.js`.

El texto del PDF y las imágenes de las firmas se envían a Groq.

**Recomendación:** avisarlo en la pantalla de evidencias antes de enviar, sobre todo por las firmas, y revisar si la política institucional lo permite.

### 17. Revisar el modelo de visión por defecto
**Dónde:** `backend/services/groqSignatureVisionService.js:1`.

Usa `qwen/qwen3.8-27b`. No se pudo confirmar que ese modelo exista en Groq; si no existe, la revisión de firmas fallará.

**Recomendación:** comprobarlo en la consola de Groq o definir `GROQ_VISION_MODEL` en Render.

### 18. `pdf-parse` 1.1.1 no se ha actualizado en años
**Dónde:** `backend/package.json`.

Trae una versión antigua de pdf.js.

**Recomendación:** evaluar una alternativa mantenida, por ejemplo `pdfjs-dist` actual.

---

## 🟡 Prioridad baja: calidad de código

19. **Ruta duplicada:** `GET /subtipos/:tipo` está declarada dos veces en `backend/routes/data.js`.
20. **Código muerto:**
    - `PUT /api/auth/periods` escribe `settings.periodsOpen`, un campo que no existe en `AppSettings`.
    - `backend/controllers/authController.js` usa `import`/`export` (ESM) en un proyecto CommonJS. Si alguien lo carga con `require`, el servidor falla al arrancar.
21. **Las respuestas no siguen un formato único:** unas usan `msg`, otras `message` y otras `mensaje`. Conviene acordar uno, por ejemplo `msg`, porque `auth.js` del frontend ya lee `msg` o `message`.
22. **Queda un `console.log` de depuración** en `backend/routes/auth.routes.js:1`: "📌 Cargando auth.routes.js".
23. **El dashboard pide permiso de notificaciones al abrirse,** sin que el usuario lo solicite (`frontend/js/pwa.js`). Chrome y Edge lo penalizan: muestran el aviso de forma silenciosa o lo bloquean.
    **Recomendación:** quitar `requestDashboardNotificationPermission()` y dejar que el permiso se pida desde **Alertas → Activar notificaciones**.

---

## ⚪ Organización del proyecto

24. **No hay README.** No hay instrucciones de instalación, de las variables de entorno necesarias (`MONGO_URI`, `JWT_SECRET`, `FRONTEND_URL`, `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_VISION_MODEL`, `VAPID_*`), de cómo correrlo en local ni de cómo desplegarlo en Render.
25. **No hay pruebas ni revisión automática.** `npm test` no hace nada y no existe `.github/workflows`. Una revisión que corra al abrir cada Pull Request detectaría errores como el de la observación 3 antes de llegar a `main`.

---

## Infraestructura

- **Render duerme el servidor sin tráfico (plan gratuito).** Por eso la revisión diaria de alertas de las 8:00 puede no ejecutarse a tiempo. Las alertas ya corren una revisión al arrancar el servidor, pero para que lleguen a la hora conviene una de dos opciones:
  - un *ping* externo (por ejemplo, UptimeRobot) a cualquier ruta del backend;
  - un Render Cron Job.
- **Hay que agregar las variables en Render** antes de desplegar las alertas: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT`. Ver `docs/ALERTAS.md`.

---

## Lo que está bien hecho

- **El frontend escapa todo el contenido** antes de mostrarlo, incluido lo que responde la IA. No se encontraron riesgos de inyección de código (XSS).
- **Las preauditorías tienen buenas protecciones:**
  - validan que el archivo sea realmente un PDF;
  - le indican a la IA que no siga instrucciones escritas dentro del documento;
  - solo citan el PDF cuando la cita aparece de verdad en el texto;
  - aclaran que no autentican firmas.
- **Las preauditorías controlan bien el acceso:** cada registro lo ven solo su dueño o un administrador.
- **Cada petición vuelve a consultar al usuario en la base,** así que un cambio de rol o un usuario eliminado se aplica de inmediato.
- **El semáforo es una sola fuente para todo:** las alertas, la captura, la gestión de datos y las gráficas usan los mismos niveles y colores.

---

## Ideas que quedan fuera de las alertas

- **App Shortcuts** (`manifest.json → shortcuts`): un menú al mantener presionado el ícono, por ejemplo "Cargar evidencia rápida" o "Ver alertas".
- **Evidencia rápida con cámara y preclasificación con IA:** requiere guardar las evidencias en el backend y reutilizar el servicio de Groq que ya existe.

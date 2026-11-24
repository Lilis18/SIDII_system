# SIDII · Sistema Integral de Información Institucional

PWA de la Universidad Tecnológica de Puebla para capturar y dar seguimiento a los indicadores del programa presupuestario. Incluye:

- **Semáforo inteligente** de cumplimiento.
- **Preauditorías** de evidencias con IA.
- **Alertas push** con acciones desde la notificación.
- Funcionamiento **sin conexión**.

## Estructura

```
backend/    API en Node.js + Express + MongoDB (Mongoose)
  routes/       auth, data, periods, subtipos, chat, auditorias, alertas, push
  services/     Groq (preauditorías), alertas, push, semáforo de alertas
  utils/        semaforo.js (compartido con el frontend), exportaciones de auditoría
  jobs/         tareas programadas de alertas
  tests/        pruebas automáticas (npm test)
frontend/   PWA estática (HTML, CSS y JavaScript sin framework)
  js/           un archivo por módulo (auth, cargaDeDatos, evidencias, auditorias, alertas…)
  service-worker.js
docs/       ALERTAS.md y OBSERVACIONES_EQUIPO.md
```

## Requisitos

- Node.js 20 o superior (las pruebas usan Node 22).
- Una base de datos MongoDB (Atlas o local).
- Opcional:
  - una clave de Groq para las preauditorías;
  - llaves VAPID para las notificaciones push.

## Puesta en marcha local

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

Después de copiar `.env.example`, llena `backend/.env` con tus valores. Las variables están descritas en la siguiente sección. El servidor corre en `http://localhost:5000`.

### 2. Frontend

```bash
cd frontend
echo VITE_BACKEND_URL=http://localhost:5000/api > .env
npm run build
npx serve -l 8081 .
```

- `npm run build` genera `js/api-config.js` con la URL del backend.
- Abre `http://localhost:8081/login.html`.
- Si la base está vacía, aparece **"Crear SUPER ADMIN"**. El primer usuario que se registra es el SUPER_ADMIN. Después, solo los administradores pueden registrar usuarios, desde el panel.

> El archivo `js/api-config.js` que está en el repositorio apunta a producción. No lo subas con la URL local.

## Variables de entorno (`backend/.env`)

| Variable | Obligatoria | Para qué sirve |
|---|---|---|
| `MONGO_URI` | Sí | Conexión a MongoDB |
| `JWT_SECRET` | Sí | Firma de las sesiones. Usa una cadena larga y aleatoria. |
| `FRONTEND_URL` | Sí | Orígenes permitidos por CORS, separados por comas |
| `PORT` | No | Puerto del backend (5000 por defecto) |
| `GROQ_API_KEY` | Para preauditorías | Clave de Groq |
| `GROQ_MODEL`, `GROQ_VISION_MODEL`, `GROQ_MAX_DOCUMENT_CHARS` | No | Modelos de texto e imagen, y límite de texto enviado |
| `PREAUDITORIA_MAX_DIARIAS` | No | Preauditorías por usuario en 24 h (20 por defecto) |
| `LOGIN_MAX_INTENTOS` | No | Intentos de inicio de sesión por IP cada 15 min (10 por defecto) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Para alertas push | Se generan con `npm run vapid` (ver `docs/ALERTAS.md`) |

Nunca subas `backend/.env` a GitHub; ya está en `.gitignore`. Las claves de Groq y la llave privada VAPID solo van en el backend.

## Despliegue (Render)

- **Backend:** servicio web Node con `npm install` y `npm start`. Configura las variables de la tabla anterior.
- **Frontend:** sitio estático con `npm run build` y `VITE_BACKEND_URL` apuntando al backend.

Al cambiar archivos que precarga el Service Worker, sube la versión de `STATIC_CACHE` en `frontend/service-worker.js` (ver `frontend/PWA_CACHE_GUIDE.md`).

## Roles

| Rol | Puede |
|---|---|
| `SUPER_ADMIN` | Todo: gestionar usuarios y roles, y habilitar periodos. Es único y no se puede degradar ni eliminar. |
| `ADMIN` | Registrar usuarios, ver y editar todos los registros, y revisar preauditorías |
| `USER` | Capturar y editar sus propios registros, y generar preauditorías |

## Convenciones del equipo

- **Respuestas de error de la API:** siempre `{ msg: "texto para el usuario" }`. El detalle técnico va en la consola del servidor, nunca en la respuesta.
- **Semáforo:** `backend/utils/semaforo.js` y `frontend/js/semaforo.js` deben ser idénticos. `npm test` falla si no lo son.
- **Código:** el frontend se indenta con tabuladores y el backend con 2 espacios. Todo el HTML que se arma con datos pasa por `escapeHTML`.
- **Ramas:** cada quien trabaja en su rama y abre un Pull Request hacia `main`. GitHub Actions corre las pruebas en cada PR (`.github/workflows/ci.yml`).

## Pruebas

```bash
cd backend
npm test
```

## Documentación

- `docs/ALERTAS.md`: alertas push.
- `AUDITOR_PREAUDITORIA_IMPLEMENTACION.md`: preauditorías con IA.
- `frontend/PWA_CACHE_GUIDE.md`: caché y modo sin conexión.
- `docs/OBSERVACIONES_EQUIPO.md`: observaciones de revisión y su estado.

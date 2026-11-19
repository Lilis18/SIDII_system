# Implementación del auditor: preauditoría y auditoría final

## Flujo añadido

1. La pantalla existente **Cargar evidencias** sigue generando, previsualizando y descargando el PDF como lo hacía antes.
2. Después de generar y descargar el PDF, un evento adicional envía una copia al backend junto con los datos de la actividad y, por separado, las imágenes de firma seleccionadas. El PDF y las imágenes solo se procesan en memoria.
3. El backend abre el PDF, recupera el texto que se puede seleccionar, registra cuántas páginas y caracteres recuperó y envía ese texto a Groq. También envía las imágenes de firma al modelo visual para describir su apariencia. Si no se puede recuperar texto del PDF, o si falla Groq, no se presenta el documento como analizado y no se guarda una preauditoría incompleta.
4. La preauditoría se guarda en MongoDB en `preauditorias`, asociada al usuario autenticado.
5. Cada persona puede consultar sus propias preauditorías en **Mis preauditorías**. `ADMIN` y `SUPER_ADMIN` ven la bandeja global **Preauditorías pendientes** y reciben una notificación en la interfaz cuando detectan registros nuevos (consulta periódica de la API mientras el panel está abierto).
6. **Ver después** conserva el registro pendiente en MongoDB. La lista se copia a Cache Storage en un almacén identificado por usuario para consulta de solo lectura offline.
7. Un administrador puede registrar si se corrigieron todas, algunas o ninguna de las observaciones y describir los cambios realizados.
8. Al guardar, el backend crea una auditoría final en `auditoriasfinales`, consolida allí la preauditoría, la revisión y los datos de origen, y elimina el registro temporal de `preauditorias` de la bandeja.
9. La ventana permite descargar el informe final como PDF y Excel `.xlsx`. La descarga no elimina el historial final de MongoDB.

## Colecciones MongoDB nuevas

- `preauditorias`: análisis inicial, propietario, datos de actividad, metadatos del PDF y texto del informe.
- `auditoriasfinales`: resultado consolidado, referencia a la preauditoría, datos originales, resultado de Groq y revisión administrativa.

Los binarios PDF se procesan en memoria y **no se guardan como archivos en MongoDB**. Se persisten el texto extraído, los metadatos, la huella SHA-256, el análisis y el informe. La clave del usuario se deriva del JWT verificado por el backend; el frontend no puede enviar un `usuario` para apropiarse de un registro.

## Variable Groq

En `backend/.env.example` se documenta `GROQ_API_KEY` y `GROQ_MODEL`. Para usarla, copia el archivo a `backend/.env` y pega la clave real únicamente en ese archivo. No pongas la clave en `frontend/.env`, `api-config.js`, HTML ni JavaScript del navegador, y no la subas a GitHub.

El modelo de texto configurado es `openai/gpt-oss-20b`. Para la revisión visual de las imágenes de firma se configura `GROQ_VISION_MODEL=qwen/qwen3.8-27b`. Ambos modelos se llaman desde el backend; la clave nunca llega al navegador. Groq documenta que Qwen 3.8 27B acepta texto e imágenes. La revisión visual describe si el trazo parece una firma o si la imagen está borrosa, vacía o recortada; no identifica a la persona ni autentica la firma.

## Pruebas locales sin credenciales de producción

Requisitos: Node.js 20 o superior, npm, MongoDB Community Server y Python 3 (solo para servir el frontend localmente). No necesitas las credenciales de la base de datos desplegada. Sí necesitas tu propia clave de Groq para ejecutar el análisis real.

### 1. MongoDB local

Instala MongoDB Community Server en Windows e inicia el servicio de MongoDB. No necesitas usuario/contraseña para la instancia local de desarrollo predeterminada. Alternativamente puedes usar un clúster Atlas propio de pruebas, pero no necesitas acceso a la base de datos desplegada de SIDII.

### 2. Configurar backend

Desde una terminal:

```powershell
cd SIDII_system\backend
Copy-Item .env.example .env
```

Edita `backend/.env` y configura:

```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/sidii_utp_local
JWT_SECRET=UNA_CADENA_ALEATORIA_LARGA_Y_PRIVADA
FRONTEND_URL=http://localhost:8081,http://127.0.0.1:8081
GROQ_API_KEY=TU_CLAVE_REAL_DE_GROQ
GROQ_MODEL=openai/gpt-oss-20b
GROQ_VISION_MODEL=qwen/qwen3.8-27b
GROQ_MAX_DOCUMENT_CHARS=24000
```

Instala dependencias (usar `npm install` para que npm actualice `package-lock.json` con `pdf-parse`):

```powershell
npm install
npm run dev
```

El backend escucha en `http://localhost:5000`.

### 3. Configurar frontend

En otra terminal:

```powershell
cd SIDII_system\frontend
Copy-Item .env.example .env
```

En `frontend/.env` establece:

```env
VITE_BACKEND_URL=http://127.0.0.1:5000/api
```

Genera la configuración y sirve el frontend:

```powershell
npm run build
python -m http.server 8081
```

Abre `http://localhost:8081/login.html`. `npm run build` vuelve a generar `frontend/js/api-config.js` con la URL local; antes de desplegar otra vez, cambia `VITE_BACKEND_URL` a la URL productiva y vuelve a ejecutar el build. `localhost` permite Service Workers en contexto seguro de desarrollo.

### 4. Crear usuarios de prueba

1. Abre el registro desde la pantalla de acceso. El backend actual asigna `SUPER_ADMIN` a la primera cuenta de una base vacía; las cuentas siguientes comienzan como `USER`.
2. Inicia sesión con la primera cuenta.
3. Desde la gestión de usuarios, el `SUPER_ADMIN` puede cambiar el rol de otra cuenta a `ADMIN`.
4. Abre una segunda sesión/navegador para comprobar que un usuario normal solo consulta sus propias preauditorías y no puede registrar una revisión final.

### 5. Probar el ciclo

1. Inicia sesión con una cuenta de usuario o administrador.
2. Abre **Cargar evidencias**, completa al menos el título de actividad y el resto de los campos, y adjunta uno o más PDF si corresponde.
3. Pulsa **Generar y unir PDF**. Se conserva la generación y descarga, ahora con el membrete institucional en la primera parte del documento. Después se envía una copia al backend junto con las imágenes de firma seleccionadas.
4. Comprueba el mensaje de resultado. Una preauditoría correcta debe tener respuesta HTTP `201` y un documento nuevo en MongoDB `preauditorias`.
5. Con un usuario normal, abre **Mis preauditorías**. Con un administrador, abre **Preauditorías pendientes**.
6. Selecciona **Ver después** y comprueba que el registro sigue en `preauditorias`.
7. Con un administrador, abre la preauditoría, selecciona el resultado de la revisión, describe los cambios y pulsa **Guardar y actualizar**.
8. Comprueba que se creó un documento en `auditoriasfinales` y que el registro temporal salió de `preauditorias`.
9. Descarga PDF y Excel y abre ambos archivos para verificar su contenido.

### 6. Verificar la caché offline

1. Con sesión iniciada y conexión, visita **Mis preauditorías** o **Preauditorías pendientes** para que la lista quede guardada localmente.
2. Abre DevTools → Application → Cache Storage. Debe existir `sidii-preauditorias-v2-<id-de-usuario>`.
3. Selecciona Network → Offline y vuelve a la sección. Se muestra la última copia guardada como consulta de solo lectura; no es posible registrar correcciones ni generar la auditoría final sin conexión.
4. La caché está separada por ID del usuario. Al cerrar sesión se elimina la caché de preauditorías de la cuenta que estaba activa en ese navegador.

## Límites que deben conocerse

- La preauditoría requiere conexión con MongoDB y Groq. Offline solo se consulta la última copia en caché.
- Se admite un PDF unificado de hasta 15 MB por solicitud. El backend comprueba la consistencia de sumas de metas por periodo y, cuando hay datos numéricos completos, contrasta el porcentaje capturado con el calculado a partir de los totales.
- El PDF fuente se procesa en memoria y no queda almacenado como binario. Si más adelante necesitas conservar el documento original, habría que añadir almacenamiento de archivos (por ejemplo GridFS o un servicio de objetos).
- La revisión del contenido se basa en el texto que se puede seleccionar y recuperar del PDF. Los elementos que solo aparezcan como imagen (texto escaneado, sellos, gráficas o fotografías) no se leen mediante este proceso. Si no se recupera texto, no se genera una preauditoría para evitar aparentar que el documento fue revisado. Aún no se incorpora OCR.
- El sistema registra lo que declara el administrador sobre las correcciones, pero no vuelve a inspeccionar un nuevo PDF corregido porque el formulario actual no proporciona un archivo de sustitución. Esto evita presentar una declaración humana como si fuera una comprobación automática.
- El informe PDF incorpora el archivo institucional `frontend/public/Membrete_UTP.jpg` y los datos del programa/unidad en el encabezado. El mismo membrete se incorpora al PDF de evidencias descargado para que ambos documentos mantengan una presentación común. La distribución final puede ajustarse si compartes un formato institucional adicional.
- Las notificaciones administrativas se consultan mediante polling mientras el dashboard está abierto. No se ha añadido Web Push remoto ni claves VAPID.

## Archivos incorporados y cambios

### Archivos nuevos

- `backend/models/Preauditoria.js`
- `backend/models/AuditoriaFinal.js`
- `backend/routes/auditorias.routes.js`
- `backend/services/groqAuditService.js`
- `backend/services/groqSignatureVisionService.js`
- `backend/utils/auditExports.js`
- `frontend/js/auditorias.js`
- `frontend/css/auditorias.css`
- `AUDITOR_PREAUDITORIA_IMPLEMENTACION.md`

### Archivos existentes ampliados

- `backend/server.js`: registra la nueva ruta `/api/auditorias`.
- `backend/package.json`: declara `multer` y el analizador PDF `pdf-parse`.
- `backend/.env.example`: añade `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_VISION_MODEL` y `GROQ_MAX_DOCUMENT_CHARS`, además de una URI MongoDB local de ejemplo.
- `frontend/dashboard.html`: incorpora la sección de consulta de preauditorías y carga el nuevo JavaScript/CSS.
- `frontend/js/evidencias.js`: emite un evento con una copia Blob, los datos y las dos imágenes de firma seleccionadas; añade el membrete institucional al PDF descargable. Las imágenes se transmiten para análisis visual, pero no se guardan en MongoDB.
- `frontend/js/dasboard.js`: incorpora el enrutamiento de la nueva sección sin alterar las pestañas anteriores.
- `frontend/service-worker.js`: incrementa la versión del shell a `sidii-static-v16`, precarga los activos nuevos y conserva las cachés de preauditorías por usuario.
- `frontend/PWA_CACHE_GUIDE.md`: documenta el nuevo almacenamiento offline.
- `.gitignore`: refuerza la exclusión de archivos `.env`.

## Endpoints añadidos

- `POST /api/auditorias/preauditorias`: valida el PDF, extrae texto, consulta Groq y persiste la preauditoría.
- `GET /api/auditorias/preauditorias/mias`: lista las preauditorías pendientes del usuario autenticado.
- `GET /api/auditorias/preauditorias/pendientes`: lista todas las pendientes para `ADMIN` y `SUPER_ADMIN`.
- `GET /api/auditorias/preauditorias/:id`: consulta controlada por propietario/rol.
- `POST /api/auditorias/preauditorias/:id/posponer`: marca que la notificación se atenderá después y mantiene el registro pendiente.
- `POST /api/auditorias/preauditorias/:id/revision`: solo administrador; guarda las correcciones, crea auditoría final y elimina el registro temporal.
- `GET /api/auditorias/finales/:id`: consulta una auditoría final según permisos.
- `GET /api/auditorias/finales/:id/pdf`: descarga PDF.
- `GET /api/auditorias/finales/:id/excel`: descarga XLSX.

## Protección de datos al usar Groq

La preauditoría transmite a Groq el texto que se extrae del PDF y los campos del formulario. Antes de procesar evidencias institucionales reales, confirma que la institución autoriza el uso de un proveedor externo y evita incluir datos personales o confidenciales que no sean necesarios. Para las primeras pruebas utiliza documentos de prueba sin datos reales.

## Estado de validación de esta entrega

Se comprobaron los archivos JavaScript con `node --check` y se hizo una prueba local controlada del servicio visual para verificar que las imágenes se agregan a la solicitud y que una firma ausente se informa como no adjunta. No se pudo hacer una llamada real a Groq, conectar a tu MongoDB ni renderizar el PDF final desde este entorno porque no se dispone de tu clave ni de las dependencias instaladas en tu equipo. Ejecuta `npm install` en el backend y prueba con tu clave de Groq antes de usarlo en producción.


## Trazabilidad de la revisión del contenido y las firmas

La preauditoría informa el número de páginas y caracteres de texto recuperados del PDF, así como el número enviado a Groq. Si el texto supera `GROQ_MAX_DOCUMENT_CHARS` (por defecto 24,000), el informe indica que la revisión fue parcial. Para hallazgos que Groq atribuya al contenido del PDF, se solicita un fragmento textual literal y el backend comprueba que dicho fragmento exista en el texto recuperado antes de mostrarlo como evidencia. Esto ayuda a rastrear el origen del señalamiento, pero no garantiza que la IA detecte todos los errores. El proceso no lee texto que esté únicamente dentro de imágenes ni interpreta páginas escaneadas; para eso hace falta OCR o una revisión visual de las páginas.

Las imágenes de firma se envían en la misma solicitud multipart como datos temporales en memoria. El backend valida PNG/JPEG y las envía al modelo visual `GROQ_VISION_MODEL`. No se guarda el contenido de las imágenes en `preauditorias` ni en `auditoriasfinales`; MongoDB conserva únicamente el resultado textual de la revisión. La observación visual no permite confirmar identidad, autenticidad, validez legal ni quién realizó la firma.

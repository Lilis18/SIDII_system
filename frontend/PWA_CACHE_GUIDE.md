# Guía de caché de la PWA SIDII

## Qué hace la caché en una PWA

Una PWA usa un service worker, un script que el navegador ejecuta aparte de la página, para interceptar solicitudes del mismo origen. Con la API Cache Storage puede guardar respuestas y reutilizarlas cuando la red no está disponible. La caché no sincroniza por sí sola datos modificados ni convierte una API en offline: hay que decidir explícitamente qué recursos guardar y qué estrategia usar.

SIDII separa el contenido estático de los recursos encontrados durante la navegación:

- `sidii-static-v16`: shell y recursos conocidos, precargados durante la instalación.
- `sidii-pages-v1`: páginas HTML visitadas, guardadas para poder recargarlas sin red.
- `sidii-runtime-v1`: recursos locales que no estaban en la precarga y se descargan durante el uso.
- `sidii-api-v1-<hash>`: respuestas JSON GET autenticadas, separadas por token de sesión.

Las respuestas privadas de API solo se almacenan de forma explícita por el service worker para lecturas GET autenticadas. Las escrituras, peticiones sin Bearer token y respuestas no JSON no se guardan. El backend marca sus respuestas `Cache-Control: no-store, private` para evitar la caché HTTP normal; el worker aplica Cache Storage de forma independiente.

## Flujo de SIDII

1. `frontend/js/pwa.js` registra `frontend/service-worker.js`. Para producción, el sitio debe servirse por HTTPS; `localhost` también es válido para desarrollo.
2. En `install`, el worker comprueba si existe la caché estática con `caches.has()`, la abre con `caches.open()` y precarga el shell con `cache.addAll()`. Si falta un solo recurso, `addAll()` rechaza toda la operación y el worker no se instala. Por eso todos los nombres en `PRECACHE_URLS` deben coincidir exactamente con los archivos publicados.
3. En `activate`, `caches.keys()` enumera las cachés. `caches.delete()` elimina versiones antiguas de SIDII y `clients.claim()` toma control de las páginas abiertas.
4. `frontend/js/pwa.js` configura el origen real desde `SIDII_API_BASE` en la URL de registro del worker. En `fetch`, las solicitudes `GET` de ese origen y ruta `/api/` usan **Network First**; los métodos de escritura y solicitudes a otros orígenes no se interceptan.
5. Para navegar, SIDII usa **network-first**: intenta la página actual en la red y guarda el HTML exitoso en `sidii-pages-v1`. Si falla la red, devuelve primero la misma página visitada; después intenta la copia precargada y, al final, `offline.html`.
6. Para scripts, estilos, imágenes y fuentes, SIDII busca primero en la caché estática y luego en runtime. Si no encuentra el recurso, lo descarga y, si la respuesta es correcta, la guarda en runtime con `cache.put(request, response.clone())`.

El método `clone()` conserva una copia de la respuesta porque el cuerpo de una respuesta Fetch se consume al leerlo; el navegador todavía necesita la respuesta original.

## Inicio de sesión y captura offline

Solo el último usuario que inició sesión correctamente en línea queda habilitado para volver a iniciar sesión sin conexión en ese dispositivo. Se almacena un verificador PBKDF2 con sal, no la contraseña en texto claro. Los datos GET siguen particionados por el token de esa sesión y el cierre de sesión ya no elimina esa caché; por eso un usuario diferente no recibe las respuestas privadas del usuario anterior.

Las altas desde **Cargar datos** que fallen por falta de red se guardan en IndexedDB, vinculadas al correo del usuario activo. Al recuperar internet, la cola se reenvía automáticamente mientras haya una sesión válida. Cada alta lleva un identificador idempotente para que un reintento no cree registros duplicados. Si el JWT expiró mientras el usuario estuvo offline, los cambios permanecen pendientes; inicia sesión en línea para obtener un token vigente y permitir que continúe la sincronización.

## Métodos de Cache API utilizados

| Método | Objeto | Uso en SIDII |
| --- | --- | --- |
| `caches.has(name)` | `CacheStorage` | Comprueba si ya existe la caché estática. |
| `caches.open(name)` | `CacheStorage` | Abre o crea la caché estática/runtime. |
| `cache.addAll(urls)` | `Cache` | Descarga y guarda el shell durante `install`. |
| `caches.keys()` | `CacheStorage` | Obtiene las cachés existentes para la limpieza. |
| `caches.delete(name)` | `CacheStorage` | Elimina cachés SIDII obsoletas. |
| `cache.match(request)` | `Cache` | Busca navegación offline o recursos guardados. |
| `cache.put(request, response)` | `Cache` | Guarda recursos locales obtenidos durante el uso. |

## Cómo comprobarlo en Chrome o Edge

1. Despliega el frontend actualizado en Render y ábrelo por su URL HTTPS. Evita `file://`; el service worker no funciona desde archivos locales.
2. Abre DevTools con `F12` y recarga la página. En **Application > Service Workers**, comprueba que `service-worker.js` figura como **activated** y que la página está controlada por él.
3. En **Application > Cache Storage**, abre `sidii-static-v16`. Deben aparecer `login.html`, `dashboard.html`, `offline.html`, `js/assistant.js`, `css/assistant.css` y otros recursos precargados. `sidii-pages-v1` contendrá las páginas visitadas.
4. Comprueba el caché runtime. Entra al panel, abre **Cargar evidencias** y deja que aparezca el membrete `public/Membrete_UTP.jpg`. Ese archivo no está en la precarga; al cargarse como imagen debe aparecer en `sidii-runtime-v1`.
5. Con sesión iniciada y después de visitar **Visualizador de gráficas**, selecciona **Network > Offline** y recarga `dashboard.html`. Debe mostrarse el dashboard desde `sidii-pages-v1`, restaurar la pestaña de gráficas y pintar los datos desde `sidii-api-v1-...`; las imágenes se sirven desde las cachés estática/runtime. Una página no visitada ni precargada caerá en `offline.html`.
6. Con sesión iniciada, carga datos para que una respuesta real de `GET /api/data` llegue con `200`. En **Network > Headers > Response Headers** verás `Cache-Control: no-store, private`; en **Application > Cache Storage** debe aparecer una caché `sidii-api-v1-...` con esa ruta. El worker guarda explícitamente la respuesta JSON pese a ese encabezado HTTP.
7. Activa **Network > Offline** y vuelve a solicitar `/api/data` desde la aplicación. La llamada debe devolver la última respuesta. En Network revisa `X-SIDII-Cache: HIT` y `X-SIDII-Offline: true`. Desactiva Offline al terminar.
8. Cierra sesión y activa **Network > Offline**. Solo el usuario autenticado previamente en ese dispositivo, con su contraseña correcta, debe poder iniciar sesión. Otro usuario o una contraseña incorrecta deben rechazarse. La caché `sidii-api-v1-...` se conserva particionada por un hash del token para recuperar los últimos datos del usuario; el token no se escribe en Cache Storage.
9. Mientras sigues offline, captura un registro desde **Cargar datos**. La página debe confirmar que quedó guardado en el dispositivo. Recupera la conexión y comprueba que aparece en el servidor; si el JWT expiró mientras estabas offline, inicia sesión en línea para sincronizarlo.
10. Inicia sesión y abre el asistente. En **Network**, filtra por `chat`: `GET /api/chat/history` debe responder `200`; al enviar una pregunta deben aparecer dos `POST /api/chat/save`, con `rol: "usuario"` y `rol: "bot"`, ambos con respuesta `201`. Recarga y confirma que el historial vuelve a pintarse. No compartas capturas que muestren el valor de `Authorization`.
11. En el dashboard, permite notificaciones cuando el navegador lo solicite. Pregunta por el periodo vigente para comprobar el aviso del asistente y selecciona **Network > Offline** para comprobar el aviso de desconexión. El navegador debe tener concedido el permiso.

También puedes inspeccionar los registros desde **Console**:

```js
navigator.serviceWorker.controller?.scriptURL
caches.keys()
caches.open('sidii-static-v16').then(cache => cache.keys()).then(requests => requests.map(request => new URL(request.url).pathname))
caches.open('sidii-runtime-v1').then(cache => cache.keys()).then(requests => requests.map(request => new URL(request.url).pathname))
caches.keys().then(names => names.filter(name => name.startsWith('sidii-api-v1-')))
```

## Historial del asistente

`backend/models/ChatHistory.js` define cada mensaje con `userId`, `mensaje`, `rol` (`usuario` o `bot`) y `fecha`. `backend/routes/chat.routes.js` ofrece `GET /api/chat/history` y `POST /api/chat/save`; ambas rutas requieren JWT. El servidor deriva `userId` de `req.user.id`, valida los roles y limita el texto a 4000 caracteres. El índice por usuario y fecha permite recuperar los mensajes en orden.

Al montar el widget, `frontend/js/assistant.js` solicita el historial con el token de la sesión y lo representa como texto escapado por el DOM (`textContent`). Por cada pregunta y respuesta envía una solicitud de guardado. Si no hay sesión, el asistente conserva las respuestas FAQ locales sin intentar consultar ni guardar historial. Si la API no responde, la conversación actual sigue visible y el widget muestra un aviso de que no pudo persistirla.

El historial persistente se almacena en MongoDB; una copia de lecturas autenticadas puede quedar temporalmente en la caché API separada por sesión para consulta offline.

## Notificaciones

`frontend/js/pwa.js` solicita permiso al cargar el dashboard y expone `window.mostrarNotificacion(titulo, cuerpo)`. Solo crea una `Notification` cuando el permiso es `granted`. El asistente notifica una sugerencia al consultar periodos, y `frontend/js/assistant.js` escucha `offline` para avisar cuando se pierde la conexión.

Esto implementa notificaciones locales del navegador. No es Web Push: notificaciones remotas con la aplicación cerrada requieren `PushManager`, una suscripción, claves VAPID y un servicio push en el backend.

Si el worker no se instala, revisa **Console** y **Network** por un `404` dentro de `PRECACHE_URLS`: `cache.addAll()` requiere que cada archivo exista. Después de desplegar un cambio del shell, actualiza `STATIC_CACHE` en `service-worker.js` para que las instalaciones existentes reciban la nueva versión.

## Cache-Control HTTP y caché PWA

`Cache-Control: no-store, private` evita que la caché HTTP normal guarde respuestas privadas. No es el mecanismo que conserva gráficas offline. El service worker, al guardar explícitamente las respuestas JSON autorizadas con Cache Storage, controla la recuperación offline; ambas capas tienen políticas separadas. La última respuesta disponible puede quedar desactualizada y solo se actualiza cuando vuelve a funcionar la red.

## Límites actuales

SIDII guarda la interfaz y respuestas exitosas de lectura API autenticadas para ofrecer consulta offline. El inicio de sesión, la escritura de datos y la actualización de la API requieren conexión. El worker no sincroniza automáticamente operaciones pendientes.

## Preauditorías y consulta offline

El Service Worker `sidii-static-v16` precarga `js/auditorias.js` y `css/auditorias.css`. La pantalla de preauditorías guarda una instantánea de los registros pendientes en Cache Storage con el nombre `sidii-preauditorias-v2-<id-de-usuario>`. Las colecciones locales se mantienen separadas por cuenta y el Service Worker conserva estos almacenes durante las actualizaciones. En modo offline la consulta es de solo lectura; el registro de correcciones, el análisis con Groq y la consolidación en MongoDB requieren conexión.


## Revisión del contenido y de las imágenes de firma

La preauditoría envía a Groq el texto que se pudo recuperar del PDF. El informe registra cuántas páginas se abrieron y cuántos caracteres se recuperaron y se enviaron; cuando el texto excede el límite configurado, se indica que la revisión fue parcial. Los PDF sin texto seleccionable no se presentan como analizados: requieren una etapa de OCR antes de generar una preauditoría. Las imágenes de las firmas se envían por separado al modelo visual configurado en `GROQ_VISION_MODEL`, se revisan en memoria y no se guardan en MongoDB. La revisión visual solo describe si la imagen parece contener un trazo de firma o si tiene problemas de legibilidad; no autentica la firma ni identifica a la persona que la realizó.

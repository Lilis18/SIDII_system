(() => {
  const apiBase = String(window.SIDII_API_BASE || 'http://localhost:5000/api').replace(/\/+$/, '');
  const API_PATH = '/auditorias';
  const CACHE_PREFIX = 'sidii-preauditorias-v2-';
  const SNAPSHOT_PATH = '/__sidii_preauditorias_snapshot__';
  const adminRoles = ['SUPER_ADMIN', 'ADMIN'];
  let activeContainer = null;
  let pendingRecords = [];
  let notificationHost = null;

  const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);

  function getCurrentUserId() {
    try {
      const token = localStorage.getItem('token') || '';
      const payload = token.split('.')[1];
      if (!payload) return null;
      const base = payload.replace(/-/g, '+').replace(/_/g, '/');
      const normalized = base.padEnd(Math.ceil(base.length / 4) * 4, '=');
      return JSON.parse(atob(normalized)).id || null;
    } catch {
      return null;
    }
  }

  function isAdmin() {
    return adminRoles.includes(localStorage.getItem('role'));
  }

  async function requestJson(path, options = {}) {
    const token = localStorage.getItem('token');
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(`${apiBase}${API_PATH}${path}`, { ...options, headers });
    const data = (response.headers.get('content-type') || '').includes('application/json')
      ? await response.json() : null;
    if (!response.ok) {
      const error = new Error(data?.msg || data?.message || `La solicitud falló (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function cacheName() {
    const userId = getCurrentUserId();
    return userId ? `${CACHE_PREFIX}${userId}` : null;
  }

  function snapshotRequest() {
    const userId = getCurrentUserId();
    if (!userId) return null;
    return new Request(new URL(`${SNAPSHOT_PATH}/${encodeURIComponent(userId)}`, window.location.origin).href);
  }

  async function saveSnapshot(records) {
    if (!('caches' in window)) return;
    const name = cacheName();
    const request = snapshotRequest();
    if (!name || !request) return;
    const cache = await caches.open(name);
    await cache.put(request, new Response(JSON.stringify({
      userId: getCurrentUserId(),
      savedAt: new Date().toISOString(),
      records,
    }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
  }

  async function readSnapshot() {
    if (!('caches' in window)) return [];
    const name = cacheName();
    const request = snapshotRequest();
    if (!name || !request) return [];
    const cache = await caches.open(name);
    const response = await cache.match(request);
    if (!response) return [];
    const snapshot = await response.json();
    if (snapshot.userId !== getCurrentUserId()) return [];
    return Array.isArray(snapshot.records) ? snapshot.records : [];
  }

  async function updateCachedRecord(record) {
    const current = await readSnapshot();
    const id = String(record._id);
    const next = [record, ...current.filter((item) => String(item._id) !== id)];
    await saveSnapshot(next.slice(0, 100));
  }

  async function removeCachedRecord(id) {
    const current = await readSnapshot();
    await saveSnapshot(current.filter((item) => String(item._id) !== String(id)));
  }

  function ensureNotificationHost() {
    if (notificationHost?.isConnected) return notificationHost;
    notificationHost = document.createElement('aside');
    notificationHost.className = 'preaudit-notification-host';
    notificationHost.setAttribute('aria-live', 'polite');
    document.body.append(notificationHost);
    return notificationHost;
  }

  function showPendingToast(record) {
    const host = ensureNotificationHost();
    const toast = document.createElement('section');
    toast.className = 'preaudit-toast';
    toast.innerHTML = `<strong>Se ha realizado una preauditoría</strong>
      <p>${escapeHTML(record.datosActividad?.tituloActividad || 'Evidencia pendiente de revisión')}</p>
      <div class="preaudit-toast-actions">
        <button type="button" class="button button-primary" data-open>Revisar ahora</button>
        <button type="button" class="button button-secondary" data-defer>Ver después</button>
      </div>`;
    toast.querySelector('[data-open]').addEventListener('click', () => {
      toast.remove();
      openPreaudit(record);
    });
    toast.querySelector('[data-defer]').addEventListener('click', async () => {
      toast.remove();
      await deferPreaudit(record._id);
    });
    host.append(toast);
    if (typeof window.mostrarNotificacion === 'function') {
      window.mostrarNotificacion('Se ha realizado una preauditoría', record.datosActividad?.tituloActividad || 'Hay una preauditoría pendiente de revisión.');
    }
  }

  function createModal() {
    let dialog = document.querySelector('#sidiiPreauditDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'sidiiPreauditDialog';
    dialog.className = 'preaudit-dialog';
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    document.body.append(dialog);
    return dialog;
  }

  function buildReviewFields(record) {
    if (!isAdmin()) {
      return `<div class="preaudit-readonly-note">La revisión administrativa y el registro de correcciones corresponden a un usuario con rol ADMIN o SUPER_ADMIN.</div>`;
    }
    return `<section class="preaudit-review-form">
      <h3>Revisión administrativa</h3>
      <label>¿Cuál es el resultado de la revisión?
        <select name="resultadoRevision" required>
          <option value="">Selecciona una opción</option>
          <option value="corregidas_todas">Se corrigieron todas las observaciones</option>
          <option value="corregidas_parcialmente">Se corrigieron algunas observaciones</option>
          <option value="sin_correccion">No se realizaron correcciones</option>
        </select>
      </label>
      <label>Describe los cambios realizados o explica por qué no se corrigieron
        <textarea name="cambiosRealizados" rows="4" minlength="5" required placeholder="Describe las modificaciones realizadas..."></textarea>
      </label>
      <label>Observaciones que permanecen pendientes (si aplica)
        <textarea name="observacionesPendientes" rows="3" placeholder="Indica qué aspectos requieren seguimiento..."></textarea>
      </label>
    </section>`;
  }

  function renderFindings(items) {
    if (!items?.length) return '<p>No se registraron hallazgos específicos.</p>';
    return `<ul class="preaudit-list">${items.map((item) => `<li><span class="preaudit-severity">${escapeHTML(item.gravedad || 'Informativa')}</span><strong>${escapeHTML(item.titulo)}</strong><small>${escapeHTML(item.categoria || 'Contenido')}</small><p>${escapeHTML(item.detalle)}</p>${item.evidenciaDocumento ? `<blockquote class="preaudit-evidence-quote"><strong>Fragmento localizado en el PDF:</strong> “${escapeHTML(item.evidenciaDocumento)}”</blockquote>` : ''}</li>`).join('')}</ul>`;
  }

  function renderChecks(items) {
    if (!items?.length) return '<p>No hay validaciones registradas.</p>';
    return `<div class="preaudit-checks">${items.map((item) => `<div><strong>${escapeHTML(item.nombre)}</strong><span>${escapeHTML(item.estado)}</span><p>${escapeHTML(item.detalle)}</p></div>`).join('')}</div>`;
  }

  function openPreaudit(record) {
    const dialog = createModal();
    const analysis = record.analisis || {};
    const isReviewer = isAdmin();
    const canReviewNow = isReviewer && navigator.onLine;
    dialog.innerHTML = `<div class="preaudit-dialog-header">
        <div><p class="eyebrow">SIDII · Revisión documental</p><h2>Preauditoría de evidencias</h2><p class="preaudit-subtitle">${escapeHTML(record.datosActividad?.tituloActividad || 'Actividad sin título')}</p></div>
        <button class="preaudit-close" type="button" aria-label="Cerrar">×</button>
      </div>
      <div class="preaudit-dialog-content">
        <div class="preaudit-meta"><span>Programa: ${escapeHTML(record.datosActividad?.clavePP || '—')}</span><span>Archivo: ${escapeHTML(record.archivo?.nombre || '—')}</span><span>Generada: ${escapeHTML(new Date(record.createdAt || Date.now()).toLocaleString('es-MX'))}</span></div>
        <div class="preaudit-level"><span>Relación preliminar con la actividad</span><strong>${escapeHTML(analysis.nivelRelacion || 'No determinada')}</strong></div>
        <section><h3>Resumen del análisis</h3><p>${escapeHTML(analysis.resumen || 'Sin resumen.')}</p></section>
        <section><h3>Posibles inconsistencias y observaciones</h3>${renderFindings(analysis.hallazgos)}</section>
        <section><h3>Qué se revisó del documento</h3>${renderChecks(analysis.validaciones)}</section>
        <section><h3>Recomendaciones</h3>${analysis.recomendaciones?.length ? `<ul>${analysis.recomendaciones.map((item) => `<li>${escapeHTML(item)}</li>`).join('')}</ul>` : '<p>Sin recomendaciones adicionales.</p>'}</section>
        ${analysis.limitaciones?.length ? `<section><h3>Aspectos que requieren revisión manual</h3><ul>${analysis.limitaciones.map((item) => `<li>${escapeHTML(item)}</li>`).join('')}</ul></section>` : ''}
        <p class="preaudit-disclaimer">Esta revisión ayuda a identificar posibles problemas, pero no confirma por sí sola la veracidad de los documentos ni la autenticidad de las firmas. La decisión final corresponde al personal autorizado.</p>
        ${canReviewNow ? buildReviewFields(record) : '<div class="preaudit-readonly-note">Consulta de solo lectura. Para registrar correcciones y generar la auditoría final necesitas conexión y permisos de administrador.</div>'}
        <p class="preaudit-message" role="status" hidden></p>
        <div class="preaudit-dialog-actions" data-actions>
          ${canReviewNow ? '<button class="button button-primary" type="button" data-save-review>Guardar y actualizar</button>' : ''}
          <button class="button button-secondary" type="button" data-defer-modal>Ver después</button>
        </div>
      </div>`;
    dialog.querySelector('.preaudit-close').addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-defer-modal]').addEventListener('click', async () => {
      await deferPreaudit(record._id, dialog);
    });
    if (canReviewNow) {
      dialog.querySelector('[data-save-review]').addEventListener('click', async () => {
        await saveReview(record, dialog);
      });
    }
    if (!dialog.open) dialog.showModal();
  }

  async function deferPreaudit(id, dialog = null) {
    try {
      if (navigator.onLine) {
        await requestJson(`/preauditorias/${encodeURIComponent(id)}/posponer`, { method: 'POST' });
      }
      if (dialog?.open) dialog.close();
      const message = navigator.onLine
        ? 'La preauditoría quedó guardada en la bandeja de pendientes.'
        : 'Sin conexión: se conserva la última copia local para consulta. La actualización de estado se enviará al recuperar conexión.';
      if (window.SIDII?.showMessage && activeContainer) {
        const status = activeContainer.querySelector('#preauditPageMessage');
        if (status) window.SIDII.showMessage(status, message, 'success');
      }
      await refreshPending({ quiet: true });
    } catch (error) {
      const message = dialog?.querySelector('.preaudit-message');
      if (message) {
        message.hidden = false;
        message.textContent = error.message;
      } else window.alert(error.message);
    }
  }

  async function downloadFinal(id, format) {
    const token = localStorage.getItem('token');
    const response = await fetch(`${apiBase}${API_PATH}/finales/${encodeURIComponent(id)}/${format}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.msg || `No se pudo descargar ${format.toUpperCase()}.`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Auditoria_Final_${id}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  async function saveReview(record, dialog) {
    const result = dialog.querySelector('[name="resultadoRevision"]')?.value;
    const changes = dialog.querySelector('[name="cambiosRealizados"]')?.value.trim();
    const pending = dialog.querySelector('[name="observacionesPendientes"]')?.value.trim() || '';
    const message = dialog.querySelector('.preaudit-message');
    const button = dialog.querySelector('[data-save-review]');
    if (!result || !changes || changes.length < 5) {
      message.hidden = false;
      message.textContent = 'Selecciona el resultado y describe los cambios o la razón por la que no se corrigieron.';
      return;
    }
    button.disabled = true;
    message.hidden = false;
    message.textContent = 'Guardando la revisión y consolidando la auditoría final...';
    try {
      const data = await requestJson(`/preauditorias/${encodeURIComponent(record._id)}/revision`, {
        method: 'POST',
        body: JSON.stringify({ resultado: result, cambiosRealizados: changes, observacionesPendientes: pending }),
      });
      await removeCachedRecord(record._id);
      await refreshPending({ quiet: true });
      dialog.querySelector('.preaudit-dialog-content').innerHTML = `<div class="preaudit-final-success"><h3>Auditoría final guardada</h3><p>${escapeHTML(data.message || 'La revisión quedó consolidada en MongoDB.')}</p><p>La preauditoría temporal salió de la bandeja de pendientes. El resultado final y el historial de revisión permanecen almacenados.</p><div class="preaudit-dialog-actions"><button class="button button-primary" type="button" data-export-pdf>Descargar PDF</button><button class="button button-secondary" type="button" data-export-excel>Descargar Excel</button><button class="button button-quiet" type="button" data-close-final>Cerrar</button></div></div>`;
      dialog.querySelector('[data-export-pdf]').addEventListener('click', async () => {
        try { await downloadFinal(data.auditoriaFinal._id, 'pdf'); } catch (error) { window.alert(error.message); }
      });
      dialog.querySelector('[data-export-excel]').addEventListener('click', async () => {
        try { await downloadFinal(data.auditoriaFinal._id, 'excel'); } catch (error) { window.alert(error.message); }
      });
      dialog.querySelector('[data-close-final]').addEventListener('click', () => dialog.close());
      if (activeContainer) renderPendingList();
    } catch (error) {
      message.textContent = error.message || 'No fue posible guardar la revisión.';
      button.disabled = false;
    }
  }

  function renderPendingList(offline = false) {
    if (!activeContainer) return;
    const list = activeContainer.querySelector('#preauditPendingList');
    if (!list) return;
    if (!pendingRecords.length) {
      list.innerHTML = `<p class="preaudit-empty">${offline ? 'No hay preauditorías guardadas en la caché de esta cuenta.' : 'No hay preauditorías pendientes de revisión.'}</p>`;
      return;
    }
    list.innerHTML = `${offline ? '<p class="preaudit-offline-label">Consulta offline: se muestra la última copia guardada en este navegador. No se pueden registrar cambios sin conexión.</p>' : ''}
      <div class="table-scroll"><table class="data-table preaudit-table"><thead><tr><th>Actividad</th><th>Programa</th><th>Responsable</th><th>Fecha</th><th>Relación</th><th>Acción</th></tr></thead><tbody>
      ${pendingRecords.map((record) => `<tr><td>${escapeHTML(record.datosActividad?.tituloActividad || 'Sin título')}</td><td>${escapeHTML(record.datosActividad?.clavePP || '—')}</td><td>${escapeHTML(record.nombreUsuario || '—')}</td><td>${escapeHTML(new Date(record.createdAt || Date.now()).toLocaleDateString('es-MX'))}</td><td>${escapeHTML(record.analisis?.nivelRelacion || 'No determinada')}</td><td><button type="button" class="button button-small button-secondary" data-review-id="${escapeHTML(record._id)}">${offline ? 'Consultar' : 'Revisar'}</button></td></tr>`).join('')}
      </tbody></table></div>`;
    list.querySelectorAll('[data-review-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const record = pendingRecords.find((item) => String(item._id) === button.dataset.reviewId);
        if (record) openPreaudit(record);
      });
    });
  }

  async function refreshPending({ quiet = false } = {}) {
    let offline = !navigator.onLine;
    try {
      if (!offline) {
        pendingRecords = await requestJson(isAdmin() ? '/preauditorias/pendientes' : '/preauditorias/mias');
        await saveSnapshot(pendingRecords);
      } else {
        pendingRecords = await readSnapshot();
      }
    } catch (error) {
      offline = true;
      pendingRecords = await readSnapshot();
      if (!quiet && !pendingRecords.length) console.warn('No se pudieron consultar las preauditorías pendientes:', error);
    }
    if (activeContainer) renderPendingList(offline);

    if (isAdmin() && !offline && pendingRecords.length) {
      const key = `sidii.preaudit.notified.${getCurrentUserId()}`;
      let seen = [];
      try { seen = JSON.parse(localStorage.getItem(key) || '[]'); } catch { seen = []; }
      const unseen = pendingRecords.filter((item) => !seen.includes(String(item._id)));
      if (unseen.length) {
        unseen.forEach(showPendingToast);
        const nextSeen = [...seen, ...unseen.map((item) => String(item._id))].slice(-300);
        localStorage.setItem(key, JSON.stringify(nextSeen));
      }
    }
  }

  function renderPreauditorias(container) {
    activeContainer = container;
    const heading = isAdmin() ? 'Preauditorías pendientes' : 'Mis preauditorías';
    const description = isAdmin()
      ? 'Revisa los hallazgos generados y registra el resultado de las correcciones para consolidar la auditoría final.'
      : 'Consulta las preauditorías que generaste. La revisión y consolidación final corresponde a una persona administradora.';
    container.innerHTML = `<header class="section-heading"><p class="eyebrow">Auditoría documental</p><h1>${heading}</h1><p>${description}</p></header>
      <p id="preauditPageMessage" class="inline-message" role="status" hidden></p>
      <div class="preaudit-toolbar"><span id="preauditConnectionState">${navigator.onLine ? 'Conectado' : 'Sin conexión'}</span><button class="button button-secondary" type="button" id="refreshPreaudits">Actualizar lista</button></div>
      <div id="preauditPendingList" aria-live="polite"><p>Cargando preauditorías...</p></div>`;
    container.querySelector('#refreshPreaudits').addEventListener('click', () => refreshPending());
    void refreshPending();
  }

  async function handleGeneratedEvidence(event) {
    const { documento, datosActividad, firmaTitularDataUrl, firmaEnlaceDataUrl } = event.detail || {};
    const message = document.querySelector('#evidenceMessage');
    if (!(documento instanceof Blob) || !datosActividad) return;
    if (!navigator.onLine) {
      window.SIDII.showMessage(message, 'El PDF se generó y descargó, pero no se pudo enviar a Groq ni guardar la preauditoría sin conexión. Vuelve a generarla cuando tengas conexión.', 'error');
      return;
    }
    try {
      window.SIDII.showMessage(message, 'Revisando el contenido y las imágenes de las firmas. Guardando el resultado...', 'success');
      const form = new FormData();
      form.append('datosActividad', JSON.stringify(datosActividad));
      form.append('documento', documento, 'Evidencia_Unificada.pdf');
      if (firmaTitularDataUrl) form.append('firmaTitularDataUrl', firmaTitularDataUrl);
      if (firmaEnlaceDataUrl) form.append('firmaEnlaceDataUrl', firmaEnlaceDataUrl);
      const result = await requestJson('/preauditorias', { method: 'POST', body: form });
      await updateCachedRecord(result.preauditoria);
      if (isAdmin()) {
        const key = `sidii.preaudit.notified.${getCurrentUserId()}`;
        let seen = [];
        try { seen = JSON.parse(localStorage.getItem(key) || '[]'); } catch { seen = []; }
        localStorage.setItem(key, JSON.stringify([...seen, String(result.preauditoria._id)].slice(-300)));
      }
      window.SIDII.showMessage(message, 'Preauditoría generada y guardada en MongoDB.', 'success');
      showPendingToast(result.preauditoria);
    } catch (error) {
      console.error('No se pudo completar la preauditoría:', error);
      window.SIDII.showMessage(message, `El PDF se generó, pero no se pudo completar la preauditoría: ${error.message}`, 'error');
    }
  }

  async function clearUserAuditCache() {
    const name = cacheName();
    if (name && 'caches' in window) await caches.delete(name).catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('sidii:evidencia-generada', (event) => { void handleGeneratedEvidence(event); });
    if (document.body?.dataset.page === 'dashboard') {
      void refreshPending({ quiet: true });
      if (isAdmin()) window.setInterval(() => { void refreshPending({ quiet: true }); }, 25000);
      window.addEventListener('online', () => { void refreshPending({ quiet: true }); });
      window.addEventListener('offline', () => {
        if (activeContainer) void refreshPending({ quiet: true });
      });
    }
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-logout]')) void clearUserAuditCache();
    }, true);
  });

  window.SIDII = window.SIDII || {};
  window.SIDII.renderPreauditorias = renderPreauditorias;
  window.SIDII.refreshPreauditorias = refreshPending;
})();

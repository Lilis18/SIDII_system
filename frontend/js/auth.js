(() => {
  const apiBase = String(window.SIDII_API_BASE || 'http://localhost:5000/api').replace(/\/+$/, '');
  const OFFLINE_AUTH_KEY = 'sidii.offlineAuth';
  const OFFLINE_DB_NAME = 'sidii-offline-v1';
  const OFFLINE_WRITES_STORE = 'pending-writes';
  let syncInProgress = false;

  async function api(path, options = {}, { queueOffline = true } = {}) {
    const token = localStorage.getItem('token');
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    if (token) headers.Authorization = `Bearer ${token}`;

    let response;
    try {
      response = await fetch(`${apiBase}${path}`, { ...options, headers });
    } catch (error) {
      if (queueOffline && options.method?.toUpperCase() === 'POST' && path === '/data/guardar') {
        return queueOfflineWrite(path, options.body);
      }
      throw error;
    }
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : null;
    if (!response.ok) {
      const error = new Error(data?.msg || data?.message || 'Ocurrió un error.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function saveSession(data, email = localStorage.getItem('email') || '') {
    localStorage.setItem('token', data.token);
    localStorage.setItem('nombre', data.nombre || data.name || '');
    localStorage.setItem('role', data.role || 'USER');
    localStorage.setItem('email', email.trim().toLowerCase());
  }

  function clearSession() {
    ['token', 'nombre', 'role', 'email'].forEach((key) => localStorage.removeItem(key));
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function encodeBytes(bytes) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes)));
  }

  async function derivePasswordVerifier(password, salt) {
    if (!window.crypto?.subtle) {
      throw new Error('Este navegador no permite verificar credenciales offline en un contexto no seguro.');
    }
    const key = await window.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    return encodeBytes(await window.crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210000 },
      key,
      256,
    ));
  }

  async function rememberOfflineLogin(email, password, data) {
    localStorage.removeItem(OFFLINE_AUTH_KEY);
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const record = {
      email: normalizeEmail(email),
      salt: encodeBytes(salt),
      verifier: await derivePasswordVerifier(password, salt),
      token: data.token,
      nombre: data.nombre || data.name || '',
      role: data.role || 'USER',
    };
    localStorage.setItem(OFFLINE_AUTH_KEY, JSON.stringify(record));
  }

  function decodeBytes(value) {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  }

  function constantTimeEqual(left, right) {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) {
      difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return difference === 0;
  }

  async function authenticateOffline(email, password) {
    const serialized = localStorage.getItem(OFFLINE_AUTH_KEY);
    if (!serialized) return false;

    let record;
    try {
      record = JSON.parse(serialized);
    } catch (error) {
      console.error('La credencial offline guardada está dañada.', error);
      localStorage.removeItem(OFFLINE_AUTH_KEY);
      return false;
    }
    if (record.email !== normalizeEmail(email) || !record.token) return false;

    const verifier = await derivePasswordVerifier(password, decodeBytes(record.salt));
    if (!constantTimeEqual(verifier, record.verifier)) return false;

    saveSession(record, record.email);
    return true;
  }

  function openOfflineDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(OFFLINE_DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(OFFLINE_WRITES_STORE)) {
          request.result.createObjectStore(OFFLINE_WRITES_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudo abrir el almacenamiento offline.'));
    });
  }

  async function queueOfflineWrite(path, body) {
    const owner = normalizeEmail(localStorage.getItem('email'));
    if (!localStorage.getItem('token') || !owner) {
      throw new Error('Inicia sesión antes de guardar datos sin conexión.');
    }
    const database = await openOfflineDatabase();
    const operation = {
      id: window.crypto.randomUUID(),
      owner,
      path,
      body,
      createdAt: Date.now(),
    };
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(OFFLINE_WRITES_STORE, 'readwrite');
      transaction.objectStore(OFFLINE_WRITES_STORE).add(operation);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('No se pudo guardar el cambio pendiente.'));
      transaction.onabort = () => reject(transaction.error || new Error('No se pudo guardar el cambio pendiente.'));
    });
    database.close();
    return { queuedOffline: true, operationId: operation.id };
  }

  async function getPendingWrites(owner) {
    const database = await openOfflineDatabase();
    const operations = await new Promise((resolve, reject) => {
      const request = database.transaction(OFFLINE_WRITES_STORE, 'readonly')
        .objectStore(OFFLINE_WRITES_STORE).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudieron leer los cambios pendientes.'));
    });
    database.close();
    return operations.filter((operation) => operation.owner === owner)
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  async function removePendingWrite(id) {
    const database = await openOfflineDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(OFFLINE_WRITES_STORE, 'readwrite');
      transaction.objectStore(OFFLINE_WRITES_STORE).delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('No se pudo confirmar la sincronización.'));
      transaction.onabort = () => reject(transaction.error || new Error('No se pudo confirmar la sincronización.'));
    });
    database.close();
  }

  async function syncOfflineQueue() {
    const owner = normalizeEmail(localStorage.getItem('email'));
    if (syncInProgress || !navigator.onLine || !localStorage.getItem('token') || !owner) return 0;
    syncInProgress = true;
    let synchronized = 0;
    let authRequired = false;
    try {
      const pending = await getPendingWrites(owner);
      for (const operation of pending) {
        try {
          await api(operation.path, {
            method: 'POST',
            headers: { 'X-SIDII-Operation-Id': operation.id },
            body: operation.body,
          }, { queueOffline: false });
          await removePendingWrite(operation.id);
          synchronized += 1;
        } catch (error) {
          authRequired = error.status === 401 || error.status === 403;
          console.warn('Hay cambios pendientes de sincronización.', error);
          break;
        }
      }
      const remaining = await getPendingWrites(owner);
      window.dispatchEvent(new CustomEvent('sidii:offline-sync', {
        detail: { synchronized, pending: remaining.length, authRequired },
      }));
    } catch (error) {
      console.error('No se pudieron procesar los cambios pendientes offline.', error);
      window.dispatchEvent(new CustomEvent('sidii:offline-sync', {
        detail: { synchronized, pending: 1, error: true },
      }));
    } finally {
      syncInProgress = false;
    }
    return synchronized;
  }

  function requireSession() {
    if (!localStorage.getItem('token')) {
      window.location.replace('login.html');
      return false;
    }
    return true;
  }

  function showMessage(element, message, type = 'error') {
    if (!element) return;
    element.textContent = message;
    element.hidden = !message;
    element.dataset.type = type;
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function initializeSharedControls() {
    const name = localStorage.getItem('nombre');
    const hasSession = Boolean(localStorage.getItem('token'));
    document.querySelectorAll('#headerUser').forEach((element) => {
      element.textContent = name ? `Hola, ${name}` : '';
    });
    document.querySelectorAll('[data-session-back]').forEach((element) => {
      element.hidden = !hasSession;
    });

    document.querySelectorAll('[data-logout]').forEach((button) => {
      button.addEventListener('click', () => {
        clearSession();
        window.location.href = 'login.html';
      });
    });

    document.querySelectorAll('[data-toggle-password]').forEach((button) => {
      button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.togglePassword);
        if (!input) return;
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        button.textContent = showing ? 'Mostrar' : 'Ocultar';
        button.setAttribute('aria-label', showing ? 'Mostrar contraseña' : 'Ocultar contraseña');
        button.setAttribute('aria-pressed', String(!showing));
      });
    });
  }

  function initializeRegisterForm() {
    const form = document.querySelector('#registerForm');
    if (!form) return;
    const message = document.querySelector('#registerMessage');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      showMessage(message, '');
      try {
        const data = await api('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            name: form.elements.name.value.trim(),
            email: form.elements.email.value.trim(),
            password: form.elements.password.value,
          }),
        });
        if (localStorage.getItem('token')) {
          showMessage(message, 'Usuario registrado correctamente.', 'success');
          form.reset();
          return;
        }
        const email = form.elements.email.value.trim();
        saveSession(data, email);
        try {
          await rememberOfflineLogin(email, form.elements.password.value, data);
        } catch (error) {
          console.error('No se pudo habilitar el inicio de sesión offline:', error);
          sessionStorage.setItem('sidii.offlineAuthWarning', 'true');
        }
        window.location.href = 'dashboard.html';
      } catch (error) {
        showMessage(message, error.message || 'Error de conexión con el servidor.');
      } finally {
        submit.disabled = false;
      }
    });
  }

  function initializePasswordForm() {
    const form = document.querySelector('#changePasswordForm');
    if (!form) return;
    if (!requireSession()) return;
    const message = document.querySelector('#changePasswordMessage');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      showMessage(message, '');
      const current = form.elements.currentPassword.value;
      const next = form.elements.newPassword.value;
      if (next !== form.elements.confirmPassword.value) {
        showMessage(message, 'Las contraseñas nuevas no coinciden.');
        return;
      }
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        await api('/auth/cambiar-contrasena', {
          method: 'PUT',
          body: JSON.stringify({ contrasenaActual: current, nuevaContrasena: next }),
        });
        clearSession();
        window.alert('Contraseña actualizada. Inicia sesión de nuevo.');
        window.location.href = 'login.html';
      } catch (error) {
        showMessage(message, error.message || 'Error al cambiar la contraseña.');
      } finally {
        submit.disabled = false;
      }
    });
  }

  async function initializeUsersPage() {
    const table = document.querySelector('#usersTable');
    if (!table) return;
    if (!requireSession()) return;
    const role = localStorage.getItem('role');
    if (role !== 'SUPER_ADMIN') {
      table.innerHTML = '<tr><td colspan="4">No tienes permisos para gestionar usuarios.</td></tr>';
      return;
    }
    const message = document.querySelector('#usersMessage');

    async function loadUsers() {
      table.innerHTML = '<tr><td colspan="4">Cargando usuarios...</td></tr>';
      try {
        const users = await api('/auth/users');
        table.innerHTML = users.map((user) => {
          const id = escapeHTML(user._id);
          const userRole = escapeHTML(user.role);
          let actions = '<strong>No editable</strong>';
          if (user.role === 'USER') {
            actions = `<button class="button button-small" data-role="ADMIN" data-id="${id}">Convertir en ADMIN</button> <button class="button button-danger button-small" data-delete="${id}">Eliminar</button>`;
          } else if (user.role === 'ADMIN') {
            actions = `<button class="button button-small" data-role="USER" data-id="${id}">Convertir en USER</button> <button class="button button-danger button-small" data-delete="${id}">Eliminar</button>`;
          }
          return `<tr><td>${escapeHTML(user.name)}</td><td>${escapeHTML(user.email)}</td><td>${userRole}</td><td class="table-actions">${actions}</td></tr>`;
        }).join('') || '<tr><td colspan="4">No hay usuarios registrados.</td></tr>';
      } catch (error) {
        table.innerHTML = `<tr><td colspan="4">${escapeHTML(error.message)}</td></tr>`;
      }
    }

    table.addEventListener('click', async (event) => {
      const roleButton = event.target.closest('[data-role]');
      const deleteButton = event.target.closest('[data-delete]');
      try {
        if (roleButton) {
          await api(`/auth/users/${encodeURIComponent(roleButton.dataset.id)}/role`, {
            method: 'PUT', body: JSON.stringify({ role: roleButton.dataset.role }),
          });
          showMessage(message, 'Rol actualizado.', 'success');
          await loadUsers();
        } else if (deleteButton && window.confirm('¿Seguro que deseas eliminar este usuario?')) {
          await api(`/auth/users/${encodeURIComponent(deleteButton.dataset.delete)}`, { method: 'DELETE' });
          showMessage(message, 'Usuario eliminado.', 'success');
          await loadUsers();
        }
      } catch (error) {
        showMessage(message, error.message || 'No se pudo completar la acción.');
      }
    });
    await loadUsers();
  }

  function getCurrentPeriodIndex(date = new Date()) {
    const month = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Mexico_City',
      month: 'numeric',
    }).format(date));
    return Math.floor((month - 1) / 4);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initializeSharedControls();
    initializeRegisterForm();
    initializePasswordForm();
    initializeUsersPage();
  });

  window.addEventListener('online', () => {
    void syncOfflineQueue();
  });

  window.SIDII = {
    api,
    saveSession,
    clearSession,
    requireSession,
    showMessage,
    getCurrentPeriodIndex,
    authenticateOffline,
    rememberOfflineLogin,
    syncOfflineQueue,
  };
  if (navigator.onLine) void syncOfflineQueue();
})();

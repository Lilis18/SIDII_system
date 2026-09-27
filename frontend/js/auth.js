(() => {
  const apiBase = String(window.SIDII_API_BASE || 'http://localhost:5000/api').replace(/\/+$/, '');

  async function api(path, options = {}) {
    const token = localStorage.getItem('token');
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${apiBase}${path}`, { ...options, headers });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : null;
    if (!response.ok) {
      const error = new Error(data?.msg || data?.message || 'Ocurrió un error.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function saveSession(data) {
    localStorage.setItem('token', data.token);
    localStorage.setItem('nombre', data.nombre || data.name || '');
    localStorage.setItem('role', data.role || 'USER');
  }

  function clearSession() {
    ['token', 'nombre', 'role'].forEach((key) => localStorage.removeItem(key));
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
    document.querySelectorAll('#headerUser').forEach((element) => {
      element.textContent = name ? `Hola, ${name}` : '';
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
        saveSession(data);
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

  document.addEventListener('DOMContentLoaded', () => {
    initializeSharedControls();
    initializeRegisterForm();
    initializePasswordForm();
    initializeUsersPage();
  });

  window.SIDII = { api, saveSession, clearSession, requireSession, showMessage };
})();

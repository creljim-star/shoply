/* Lógica de la PWA "Shoply": lista de la compra compartida + modo Admin. */

const $ = (sel) => document.querySelector(sel);

const state = {
  name: localStorage.getItem('compra:name') || '',
  items: [],
  pushEnabled: false,
  adminToken: localStorage.getItem('compra:adminToken') || '',
  isAdmin: false,
};

// Colores estables por nombre para los avatares.
const AVATAR_COLORS = ['#16a34a', '#0ea5e9', '#8b5cf6', '#ef4444', '#f59e0b', '#ec4899', '#14b8a6', '#6366f1'];
function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function euros(n) {
  return (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.adminToken) headers['x-admin-token'] = state.adminToken;
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    const err = new Error('Error ' + res.status);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function loadState() {
  try {
    const data = await api('/api/state');
    state.items = data.items || [];
    state.pushEnabled = data.pushEnabled;
    render();
  } catch (e) {
    /* silencioso: reintenta en el siguiente poll */
  }
}

async function checkAdmin() {
  if (!state.adminToken) {
    state.isAdmin = false;
    return;
  }
  try {
    const r = await api('/api/admin/me');
    state.isAdmin = !!r.admin;
  } catch (e) {
    state.isAdmin = false;
  }
  if (!state.isAdmin) {
    // Token caducado (p. ej. tras un reinicio del servidor).
    state.adminToken = '';
    localStorage.removeItem('compra:adminToken');
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render() {
  $('#who-btn').textContent = '👤 ' + state.name;

  // Estado de la interfaz de admin
  document.body.classList.toggle('is-admin', state.isAdmin);
  $('#admin-bar').classList.toggle('hidden', !state.isAdmin);
  $('#admin-btn').classList.toggle('active', state.isAdmin);
  $('#admin-btn').textContent = state.isAdmin ? '🔓' : '🔒';
  $('#clear-bought-btn').classList.toggle('hidden', !state.isAdmin);

  if (state.isAdmin) {
    const total = state.items.reduce((s, i) => s + (Number(i.price) || 0), 0);
    $('#admin-total').textContent = 'Total: ' + euros(total);
  }

  const lists = $('#lists');
  if (!state.items.length) {
    lists.innerHTML = '<div class="empty">Aún no hay nada en la lista.<br>¡Añade lo primero! 👇</div>';
    return;
  }

  // Agrupar por persona, con la del usuario primero.
  const groups = {};
  for (const it of state.items) {
    (groups[it.person] = groups[it.person] || []).push(it);
  }
  const names = Object.keys(groups).sort((a, b) => {
    if (a === state.name) return -1;
    if (b === state.name) return 1;
    return a.localeCompare(b);
  });

  lists.innerHTML = names.map((name) => renderPerson(name, groups[name])).join('');
}

function renderPerson(name, items) {
  const pending = items.filter((i) => !i.bought).length;
  const rows = items.map(renderItem).join('');
  return `
    <div class="person-block">
      <div class="person-head">
        <span class="avatar" style="background:${colorFor(name)}">${initials(name)}</span>
        <span>${escapeHtml(name)}${name === state.name ? ' (tú)' : ''}</span>
        <span class="count">${pending} pend.</span>
      </div>
      ${rows}
    </div>`;
}

function renderItem(it) {
  const cls = ['item'];
  if (it.bought) cls.push('bought');
  if (it.checked) cls.push('checked');

  // Marca de estado: en admin es pulsable (tick "en el carrito").
  const mark = it.bought ? '✓' : it.checked ? '✓' : '';

  // Precio: editable solo en modo admin.
  let priceHtml = '';
  if (state.isAdmin) {
    priceHtml = `<input class="price-input" type="text" inputmode="decimal"
      value="${it.price != null ? String(it.price).replace('.', ',') : ''}"
      placeholder="0,00" data-action="price" aria-label="Precio" />`;
  } else if (it.price != null) {
    priceHtml = `<span class="price-tag">${euros(it.price)}</span>`;
  }

  return `
    <div class="item ${cls.join(' ')}" data-id="${it.id}">
      <div class="check" data-action="toggle">${mark}</div>
      <div class="text">${escapeHtml(it.text)}</div>
      ${priceHtml}
      <button class="del" data-action="del" aria-label="Borrar">🗑️</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// Acciones de la lista
// ---------------------------------------------------------------------------
async function addItem(text) {
  text = text.trim();
  if (!text) return;
  await api('/api/items', {
    method: 'POST',
    body: JSON.stringify({ person: state.name, text }),
  });
  await loadState();
}

// En modo admin, el tick marca "ya está en el carrito" (checked).
async function toggleChecked(id, current) {
  if (!state.isAdmin) {
    toast('Solo quien va a la compra (Admin) puede marcar los productos.');
    return;
  }
  await api('/api/items/' + id, {
    method: 'PATCH',
    body: JSON.stringify({ checked: !current }),
  });
  await loadState();
}

async function setPrice(id, value) {
  try {
    await api('/api/items/' + id, {
      method: 'PATCH',
      body: JSON.stringify({ price: value }),
    });
  } catch (e) {
    toast('No se pudo guardar el precio.');
  }
  await loadState();
}

async function deleteItem(id) {
  await api('/api/items/' + id, { method: 'DELETE' });
  await loadState();
}

async function clearBought() {
  try {
    await api('/api/clear-bought', { method: 'POST' });
    await loadState();
  } catch (e) {
    toast('Necesitas modo Admin para limpiar.');
  }
}

// ---------------------------------------------------------------------------
// Finalizar compra (marcar todo como comprado)
// ---------------------------------------------------------------------------
async function finishShopping() {
  if (!confirm('¿Marcar TODA la lista como comprada?')) return;
  try {
    const r = await api('/api/admin/finish', { method: 'POST' });
    await loadState();
    toast(`✅ Compra finalizada. Total: ${euros(r.total)}`);
  } catch (e) {
    toast('No se pudo finalizar la compra.');
  }
}

// ---------------------------------------------------------------------------
// Modo Admin (login / logout)
// ---------------------------------------------------------------------------
function openAdminModal() {
  if (state.isAdmin) {
    // Ya es admin: el botón sirve para salir.
    adminLogout();
    return;
  }
  $('#admin-error').textContent = '';
  $('#admin-password').value = '';
  $('#admin-modal').classList.remove('hidden');
  setTimeout(() => $('#admin-password').focus(), 50);
}

function closeAdminModal() {
  $('#admin-modal').classList.add('hidden');
}

async function adminLogin() {
  const password = $('#admin-password').value;
  if (!password) return;
  try {
    const r = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    state.adminToken = r.token;
    state.isAdmin = true;
    localStorage.setItem('compra:adminToken', r.token);
    closeAdminModal();
    toast('🔓 Modo Admin activado');
    await loadState();
  } catch (e) {
    $('#admin-error').textContent = '❌ Contraseña incorrecta.';
  }
}

async function adminLogout() {
  try {
    await api('/api/admin/logout', { method: 'POST' });
  } catch (e) {
    /* da igual */
  }
  state.adminToken = '';
  state.isAdmin = false;
  localStorage.removeItem('compra:adminToken');
  toast('Has salido del modo Admin.');
  await loadState();
}

// ---------------------------------------------------------------------------
// Alerta "Voy a la compra"
// ---------------------------------------------------------------------------
async function sendAlert() {
  const btn = $('#alert-btn');
  btn.disabled = true;
  $('#alert-status').textContent = 'Enviando aviso…';
  try {
    const r = await api('/api/alert', {
      method: 'POST',
      body: JSON.stringify({ person: state.name }),
    });
    if (!r.pushEnabled) {
      $('#alert-status').textContent = '⚠️ Las notificaciones push no están configuradas en el servidor.';
    } else {
      $('#alert-status').textContent = `✅ Aviso enviado a ${r.sent} dispositivo(s).`;
    }
  } catch (e) {
    $('#alert-status').textContent = '❌ No se pudo enviar el aviso.';
  } finally {
    btn.disabled = false;
    setTimeout(() => ($('#alert-status').textContent = ''), 6000);
  }
}

// ---------------------------------------------------------------------------
// Notificaciones push (suscripción)
// ---------------------------------------------------------------------------
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function enableNotifications() {
  const btn = $('#notif-btn');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast('Este navegador no soporta notificaciones push.');
    return;
  }
  try {
    const { key, pushEnabled } = await api('/api/vapid-public-key');
    if (!pushEnabled || !key) {
      toast('El servidor aún no tiene las notificaciones configuradas.');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      toast('Permiso de notificaciones denegado.');
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }
    await api('/api/subscribe', {
      method: 'POST',
      body: JSON.stringify({ person: state.name, subscription: sub }),
    });
    localStorage.setItem('compra:notif', '1');
    btn.classList.add('active');
    btn.textContent = '🔔 Notificaciones activadas';
    toast('¡Notificaciones activadas! 🎉');
  } catch (e) {
    console.error(e);
    toast('No se pudieron activar las notificaciones.');
  }
}

// ---------------------------------------------------------------------------
// Toast (aviso en pantalla)
// ---------------------------------------------------------------------------
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

// ---------------------------------------------------------------------------
// Nombre / pantallas
// ---------------------------------------------------------------------------
function showApp() {
  $('#name-screen').classList.add('hidden');
  $('#app-screen').classList.remove('hidden');
  if (localStorage.getItem('compra:notif') === '1') {
    $('#notif-btn').classList.add('active');
    $('#notif-btn').textContent = '🔔 Notificaciones activadas';
  }
  checkAdmin().then(loadState);
}

function showNameScreen() {
  $('#app-screen').classList.add('hidden');
  $('#name-screen').classList.remove('hidden');
  $('#name-input').value = state.name;
  $('#name-input').focus();
}

function saveName() {
  const v = $('#name-input').value.trim();
  if (!v) {
    $('#name-input').focus();
    return;
  }
  state.name = v;
  localStorage.setItem('compra:name', v);
  showApp();
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------
$('#name-save').addEventListener('click', saveName);
$('#name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveName();
});

$('#who-btn').addEventListener('click', showNameScreen);
$('#admin-btn').addEventListener('click', openAdminModal);
$('#admin-login').addEventListener('click', adminLogin);
$('#admin-cancel').addEventListener('click', closeAdminModal);
$('#admin-logout').addEventListener('click', adminLogout);
$('#finish-btn').addEventListener('click', finishShopping);
$('#admin-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') adminLogin();
});

$('#add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#item-input');
  addItem(input.value);
  input.value = '';
  input.focus();
});

// Delegación de eventos en la lista (tick / borrar).
$('#lists').addEventListener('click', (e) => {
  const action = e.target.dataset.action;
  if (!action) return;
  const row = e.target.closest('.item');
  if (!row) return;
  const id = row.dataset.id;
  if (action === 'toggle') toggleChecked(id, row.classList.contains('checked'));
  if (action === 'del') deleteItem(id);
});

// Guardar precio al salir del campo o pulsar Enter.
$('#lists').addEventListener(
  'blur',
  (e) => {
    if (e.target.dataset.action === 'price') {
      const row = e.target.closest('.item');
      if (row) setPrice(row.dataset.id, e.target.value);
    }
  },
  true
);
$('#lists').addEventListener('keydown', (e) => {
  if (e.target.dataset.action === 'price' && e.key === 'Enter') e.target.blur();
});

$('#alert-btn').addEventListener('click', sendAlert);
$('#notif-btn').addEventListener('click', enableNotifications);
$('#clear-bought-btn').addEventListener('click', clearBought);

// Mensajes desde el service worker (cuando llega un push con la app abierta).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'push') {
      toast('🛒 ' + (e.data.body || '¡Vamos a la compra!'));
      loadState();
    }
  });
}

// Recargar al volver a la pestaña.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.name) loadState();
});

// Sincronización periódica (cada 5 s). No refresca mientras se edita un precio.
setInterval(() => {
  if (state.name && !document.hidden && document.activeElement?.dataset?.action !== 'price') {
    loadState();
  }
}, 5000);

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch((e) => console.warn('SW:', e));
}

if (state.name) showApp();
else showNameScreen();

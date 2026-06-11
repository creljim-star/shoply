/* Lógica de la PWA "Shoply": compras con pestañas, totales por persona e historial. */

const $ = (sel) => document.querySelector(sel);

const state = {
  name: localStorage.getItem('compra:name') || '',
  trips: [],
  activeId: null,
  selectedId: null,
  pushEnabled: false,
  adminToken: localStorage.getItem('compra:adminToken') || '',
  isAdmin: false,
};

// Colores estables por nombre para los avatares.
const AVATAR_COLORS = ['#12b886', '#0ea5e9', '#8b5cf6', '#ef4444', '#f59e0b', '#ec4899', '#14b8a6', '#6366f1'];
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
  if (state.name) headers['x-user'] = encodeURIComponent(state.name);
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
    state.trips = data.trips || [];
    state.activeId = data.activeId;
    state.pushEnabled = data.pushEnabled;
    // Mantener la pestaña elegida; si no existe, ir a la activa.
    if (!state.selectedId || !state.trips.find((t) => t.id === state.selectedId)) {
      state.selectedId = state.activeId;
    }
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
    state.adminToken = '';
    localStorage.removeItem('compra:adminToken');
  }
}

// ---------------------------------------------------------------------------
// Selección de compra (pestaña)
// ---------------------------------------------------------------------------
function selectedTrip() {
  return state.trips.find((t) => t.id === state.selectedId) || state.trips.find((t) => t.id === state.activeId);
}
function isActiveSelected() {
  const t = selectedTrip();
  return !!t && t.id === state.activeId;
}
// ¿Puede el usuario editar lo que ve? Solo en la compra activa.
function canEdit() {
  return isActiveSelected();
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render() {
  $('#who-btn').textContent = '👤 ' + state.name;

  const trip = selectedTrip();
  const activeSel = isActiveSelected();
  const adminOnActive = state.isAdmin && activeSel;

  // Barra de admin: solo con sentido sobre la compra activa.
  document.body.classList.toggle('is-admin', state.isAdmin);
  $('#admin-bar').classList.toggle('hidden', !adminOnActive);
  $('#admin-btn').classList.toggle('active', state.isAdmin);
  $('#admin-btn').textContent = state.isAdmin ? '🔓' : '🔒';

  // Solo se pueden añadir productos a la compra activa.
  $('#add-form').classList.toggle('hidden', !activeSel);
  $('#history-note').classList.toggle('hidden', activeSel);

  // Borrar compra del historial: solo admin y solo en compras antiguas (no la activa).
  $('#history-actions').classList.toggle('hidden', !(state.isAdmin && !activeSel && trip));

  if (adminOnActive && trip) {
    $('#admin-total').textContent = 'Total: ' + euros(trip.total);
  }

  renderTabs();
  renderList(trip);
}

function renderTabs() {
  const tabs = $('#tabs');
  tabs.innerHTML = state.trips
    .map((t) => {
      const sel = t.id === state.selectedId ? 'sel' : '';
      const isActive = t.id === state.activeId;
      const label = isActive ? '🛒 ' + escapeHtml(t.title) : escapeHtml(t.title);
      const total = t.total ? `<span class="tab-total">${euros(t.total)}</span>` : '';
      return `<button class="tab ${sel} ${isActive ? 'is-active' : 'is-history'}" data-trip="${t.id}">${label}${total}</button>`;
    })
    .join('');
}

function renderList(trip) {
  const lists = $('#lists');
  if (!trip || !trip.items.length) {
    lists.innerHTML = isActiveSelected()
      ? '<div class="empty">Aún no hay nada en esta compra.<br>¡Añade lo primero! 👇</div>'
      : '<div class="empty">Esta compra no tiene productos.</div>';
    $('#grand-total').classList.add('hidden');
    return;
  }

  // Agrupar por persona, con la del usuario primero.
  const groups = {};
  for (const it of trip.items) (groups[it.person] = groups[it.person] || []).push(it);
  const names = Object.keys(groups).sort((a, b) => {
    if (a === state.name) return -1;
    if (b === state.name) return 1;
    return a.localeCompare(b);
  });

  lists.innerHTML = names.map((name) => renderPerson(name, groups[name])).join('');

  // Total de la compra (lo ve todo el mundo).
  $('#grand-total').classList.remove('hidden');
  $('#grand-total').innerHTML = `Total de la compra <strong>${euros(trip.total)}</strong>`;
}

function renderPerson(name, items) {
  const subtotal = items.reduce((s, i) => s + (Number(i.price) || 0), 0);
  const pending = items.filter((i) => !i.bought).length;
  const rows = items.map(renderItem).join('');
  return `
    <div class="person-block">
      <div class="person-head">
        <span class="avatar" style="background:${colorFor(name)}">${initials(name)}</span>
        <span class="person-name">${escapeHtml(name)}${name === state.name ? ' (tú)' : ''}</span>
        <span class="person-subtotal">${euros(subtotal)}</span>
        ${pending ? `<span class="count">${pending} pend.</span>` : '<span class="count done">✓</span>'}
      </div>
      ${rows}
    </div>`;
}

function renderItem(it) {
  const editable = canEdit();
  const admin = state.isAdmin && editable;

  const cls = ['item'];
  if (it.bought) cls.push('bought');
  if (it.checked) cls.push('checked');

  const mark = it.bought || it.checked ? '✓' : '';

  let priceHtml = '';
  if (admin) {
    // Botón que abre el teclado de precios (calculadora).
    const label = it.price != null ? euros(it.price) : '➕ €';
    priceHtml = `<button class="price-btn ${it.price != null ? 'has-price' : ''}" data-action="pricepad">${label}</button>`;
  } else if (it.price != null) {
    priceHtml = `<span class="price-tag">${euros(it.price)}</span>`;
  }

  // Borrar: el admin puede con todo; cada persona solo con lo suyo.
  const canDelete = editable && (state.isAdmin || it.person === state.name);
  const delBtn = canDelete ? `<button class="del" data-action="del" aria-label="Borrar">🗑️</button>` : '';

  return `
    <div class="item ${cls.join(' ')}" data-id="${it.id}">
      <div class="check" data-action="toggle">${mark}</div>
      <div class="text">${escapeHtml(it.text)}</div>
      ${priceHtml}
      ${delBtn}
    </div>`;
}

// ---------------------------------------------------------------------------
// Acciones de la lista (solo compra activa)
// ---------------------------------------------------------------------------
async function addItem(text) {
  text = text.trim();
  if (!text) return;
  await api('/api/items', { method: 'POST', body: JSON.stringify({ person: state.name, text }) });
  await loadState();
}

async function toggleChecked(id, current) {
  if (!state.isAdmin) {
    toast('Solo quien va a la compra (Admin) puede marcar los productos.');
    return;
  }
  await api('/api/items/' + id, { method: 'PATCH', body: JSON.stringify({ checked: !current }) });
  await loadState();
}

async function setPrice(id, value) {
  try {
    await api('/api/items/' + id, { method: 'PATCH', body: JSON.stringify({ price: value }) });
  } catch (e) {
    toast('No se pudo guardar el precio.');
  }
  await loadState();
}

async function deleteItem(id) {
  try {
    await api('/api/items/' + id, { method: 'DELETE' });
  } catch (e) {
    toast('Solo puedes borrar tus propios productos.');
  }
  await loadState();
}

// ---------------------------------------------------------------------------
// Teclado de precios (calculadora)
// ---------------------------------------------------------------------------
const pricePad = { id: null, value: '' };

function openPricePad(id) {
  const trip = selectedTrip();
  const item = trip && trip.items.find((i) => i.id === id);
  if (!item) return;
  pricePad.id = id;
  pricePad.value = item.price != null ? String(item.price).replace('.', ',') : '';
  $('#pad-title').textContent = item.text;
  renderPad();
  $('#price-modal').classList.remove('hidden');
}

function closePricePad() {
  $('#price-modal').classList.add('hidden');
  pricePad.id = null;
}

function renderPad() {
  $('#pad-display').textContent = (pricePad.value || '0') + ' €';
}

function padKey(k) {
  let v = pricePad.value;
  if (k === 'back') {
    v = v.slice(0, -1);
  } else if (k === ',') {
    if (!v.includes(',')) v = (v === '' ? '0' : v) + ',';
  } else {
    // dígito: máximo 2 decimales y un tamaño razonable
    if (v.includes(',') && v.split(',')[1].length >= 2) return;
    if (v.replace(',', '').length >= 6) return;
    if (v === '0') v = ''; // evitar ceros a la izquierda
    v += k;
  }
  pricePad.value = v;
  renderPad();
}

async function savePricePad() {
  const id = pricePad.id;
  closePricePad();
  if (id) await setPrice(id, pricePad.value);
}

// ---------------------------------------------------------------------------
// Mostrar / ocultar contraseña
// ---------------------------------------------------------------------------
function togglePassword() {
  const inp = $('#admin-password');
  const showing = inp.type === 'text';
  inp.type = showing ? 'password' : 'text';
  $('#pw-toggle').textContent = showing ? '👁️' : '🙈';
  inp.focus();
}

// ---------------------------------------------------------------------------
// Acciones de Admin sobre la compra
// ---------------------------------------------------------------------------
async function finishShopping() {
  if (!confirm('¿Marcar TODA la compra como comprada?')) return;
  try {
    const r = await api('/api/admin/finish', { method: 'POST' });
    await loadState();
    toast(`✅ Marcado como comprado. Total: ${euros(r.total)}`);
  } catch (e) {
    toast('No se pudo finalizar la compra.');
  }
}

async function deleteTrip(id, skipConfirm) {
  const trip = state.trips.find((t) => t.id === id);
  const name = trip ? trip.title : 'esta compra';
  if (!skipConfirm && !confirm(`¿Borrar "${name}" del historial?\nNo se puede deshacer.`)) return;
  try {
    await api('/api/trips/' + id, { method: 'DELETE' });
    state.selectedId = null; // volver a la compra activa
    await loadState();
    toast('🗑️ Lista borrada.');
  } catch (e) {
    toast('No se pudo borrar (¿es la compra activa?).');
  }
}

// ---------------------------------------------------------------------------
// Mantener pulsada una pestaña -> menú para borrar la lista
// ---------------------------------------------------------------------------
const tabMenu = { id: null };

function openTabMenu(id) {
  if (!state.isAdmin) {
    toast('🔒 Solo el admin puede borrar listas.');
    return;
  }
  const trip = state.trips.find((t) => t.id === id);
  if (!trip) return;
  tabMenu.id = id;
  $('#tab-menu-title').textContent = trip.title;
  const isActive = id === state.activeId;
  $('#tab-menu-note').classList.toggle('hidden', !isActive);
  $('#tab-menu-delete').classList.toggle('hidden', isActive);
  $('#tab-menu').classList.remove('hidden');
  if (navigator.vibrate) navigator.vibrate(15); // vibración de confirmación
}

function closeTabMenu() {
  $('#tab-menu').classList.add('hidden');
  tabMenu.id = null;
}

async function newTrip() {
  if (!confirm('¿Empezar una compra nueva con la fecha de hoy?\nLa actual pasará al historial.')) return;
  try {
    await api('/api/admin/new-trip', { method: 'POST' });
    state.selectedId = null; // se reposicionará en la nueva activa
    await loadState();
    toast('🛒 Nueva compra iniciada.');
  } catch (e) {
    toast('No se pudo crear la nueva compra.');
  }
}

// ---------------------------------------------------------------------------
// Modo Admin (login / logout)
// ---------------------------------------------------------------------------
function openAdminModal() {
  if (state.isAdmin) {
    adminLogout();
    return;
  }
  $('#admin-error').textContent = '';
  $('#admin-password').value = '';
  $('#admin-password').type = 'text'; // visible por defecto
  $('#pw-toggle').textContent = '🙈';
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
    const r = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
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
    const r = await api('/api/alert', { method: 'POST', body: JSON.stringify({ person: state.name }) });
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
    await api('/api/subscribe', { method: 'POST', body: JSON.stringify({ person: state.name, subscription: sub }) });
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
// Toast
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
  const v = $('#name-input').value.trim().replace(/\s+/g, ' ');
  const err = $('#name-error');
  if (!v) {
    if (err) err.textContent = 'Escribe tu nombre y tu primer apellido.';
    $('#name-input').focus();
    return;
  }
  // Debe incluir al menos nombre y primer apellido (2 palabras).
  if (v.split(' ').length < 2) {
    if (err) err.textContent = 'Pon tu nombre y tu primer apellido (ej. Carlos Relaño).';
    $('#name-input').focus();
    return;
  }
  if (err) err.textContent = '';
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
$('#new-trip-btn').addEventListener('click', newTrip);
$('#del-trip-btn').addEventListener('click', () => deleteTrip(state.selectedId));
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

// Pestañas de compras: tocar = seleccionar; mantener pulsado = menú borrar.
const tabsEl = $('#tabs');
let lpTimer = null;
let lpFired = false;
let lpStart = { x: 0, y: 0 };

function cancelLongPress() {
  clearTimeout(lpTimer);
  lpTimer = null;
}

tabsEl.addEventListener('pointerdown', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  lpFired = false;
  lpStart = { x: e.clientX, y: e.clientY };
  cancelLongPress();
  lpTimer = setTimeout(() => {
    lpFired = true;
    openTabMenu(tab.dataset.trip);
  }, 500);
});
tabsEl.addEventListener('pointermove', (e) => {
  if (lpTimer && Math.hypot(e.clientX - lpStart.x, e.clientY - lpStart.y) > 10) cancelLongPress();
});
tabsEl.addEventListener('pointerup', cancelLongPress);
tabsEl.addEventListener('pointercancel', cancelLongPress);
tabsEl.addEventListener('pointerleave', cancelLongPress);
tabsEl.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.tab')) e.preventDefault(); // evita el menú nativo al mantener pulsado
});

tabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  if (lpFired) {
    // Fue una pulsación larga: no seleccionamos la pestaña.
    lpFired = false;
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  state.selectedId = btn.dataset.trip;
  render();
});

// Eventos del menú de la pestaña.
$('#tab-menu-delete').addEventListener('click', () => {
  const id = tabMenu.id;
  closeTabMenu();
  if (id) deleteTrip(id, true);
});
$('#tab-menu-cancel').addEventListener('click', closeTabMenu);
$('#tab-menu').addEventListener('click', (e) => {
  if (e.target.id === 'tab-menu') closeTabMenu();
});

// Lista: tick / borrar.
$('#lists').addEventListener('click', (e) => {
  const action = e.target.dataset.action;
  if (!action) return;
  const row = e.target.closest('.item');
  if (!row) return;
  const id = row.dataset.id;
  if (action === 'toggle') toggleChecked(id, row.classList.contains('checked'));
  if (action === 'del') deleteItem(id);
  if (action === 'pricepad') openPricePad(id);
});

// Teclado de precios.
$('#pad-display').parentElement.querySelector('.pad-grid').addEventListener('click', (e) => {
  const key = e.target.closest('.pad-key');
  if (key) padKey(key.dataset.k);
});
$('#pad-save').addEventListener('click', savePricePad);
$('#pad-clear').addEventListener('click', () => {
  pricePad.value = '';
  renderPad();
});
$('#pad-cancel').addEventListener('click', closePricePad);
$('#price-modal').addEventListener('click', (e) => {
  if (e.target.id === 'price-modal') closePricePad();
});

// Mostrar / ocultar contraseña.
$('#pw-toggle').addEventListener('click', togglePassword);

$('#alert-btn').addEventListener('click', sendAlert);
$('#notif-btn').addEventListener('click', enableNotifications);

// Mensajes desde el service worker (push con la app abierta).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'push') {
      toast('🛒 ' + (e.data.body || '¡Vamos a la compra!'));
      loadState();
    }
  });
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.name) loadState();
});

// Sincronización periódica (cada 5 s). No refresca mientras el teclado de precios está abierto.
setInterval(() => {
  const padOpen = !$('#price-modal').classList.contains('hidden');
  if (state.name && !document.hidden && !padOpen) loadState();
}, 5000);

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch((e) => console.warn('SW:', e));
}

if (state.name) showApp();
else showNameScreen();

/**
 * Servidor de la "Lista de la compra de la oficina".
 *
 * - Sirve la PWA (carpeta /public).
 * - Guarda la lista compartida y las suscripciones a notificaciones en un fichero JSON.
 * - Envía notificaciones push cuando alguien pulsa "Voy a la compra".
 *
 * Variables de entorno:
 *   PORT                 Puerto (por defecto 3000).
 *   DATA_FILE            Ruta del fichero de datos (por defecto ./data/data.json).
 *   ADMIN_PASSWORD       Contraseña del modo Admin (por defecto "shoply").
 *   VAPID_PUBLIC_KEY     Clave pública VAPID (genérala con: npm run keys).
 *   VAPID_PRIVATE_KEY    Clave privada VAPID.
 *   VAPID_SUBJECT        mailto: o URL de contacto (opcional).
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const webpush = require('web-push');
const { ensureIcons } = require('./lib/icons');
const store = require('./lib/store');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'shoply';

// ---------------------------------------------------------------------------
// Configuración de notificaciones push (VAPID)
// ---------------------------------------------------------------------------
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

// Estas se resuelven en resolveVapid(), tras cargar la base de datos:
// 1º variables de entorno, 2º claves guardadas, 3º se generan y se guardan.
let VAPID_PUBLIC_KEY = '';
let pushEnabled = false;

// ---------------------------------------------------------------------------
// Almacenamiento (PostgreSQL permanente si hay DATABASE_URL; si no, fichero)
// ---------------------------------------------------------------------------
/**
 * Cada "compra" (trip) es una pestaña con fecha y sus propios artículos.
 * Siempre hay como mucho una compra 'active'; las terminadas pasan a 'archived'.
 * @type {{ trips: any[], subscriptions: any[], vapid: any, adminTokens: string[] }}
 */
let db = { trips: [], subscriptions: [], vapid: null, adminTokens: [] };

// Normaliza el objeto cargado y migra datos antiguos (lista plana -> compra).
function normalizeDb(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { trips: [], subscriptions: [], vapid: null, adminTokens: [] };
  }
  const out = {
    trips: Array.isArray(parsed.trips) ? parsed.trips : [],
    subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
    vapid: parsed.vapid || null,
    adminTokens: Array.isArray(parsed.adminTokens) ? parsed.adminTokens : [],
  };
  // Migración: datos antiguos con lista plana (parsed.items) -> una compra activa.
  if (!out.trips.length && Array.isArray(parsed.items) && parsed.items.length) {
    out.trips.push(makeTrip(parsed.items));
    console.log('[db] Migrados', parsed.items.length, 'artículos antiguos a una compra.');
  }
  return out;
}

// Resuelve las claves VAPID y activa las notificaciones push.
function resolveVapid() {
  let pub = process.env.VAPID_PUBLIC_KEY || '';
  let priv = process.env.VAPID_PRIVATE_KEY || '';

  if (pub && priv) {
    console.log('[push] Usando claves VAPID de variables de entorno.');
  } else if (db.vapid && db.vapid.publicKey && db.vapid.privateKey) {
    pub = db.vapid.publicKey;
    priv = db.vapid.privateKey;
    console.log('[push] Usando claves VAPID guardadas.');
  } else {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey;
    priv = keys.privateKey;
    db.vapid = { publicKey: pub, privateKey: priv };
    saveDb();
    console.log('[push] Claves VAPID generadas automáticamente y guardadas.');
  }

  try {
    webpush.setVapidDetails(VAPID_SUBJECT, pub, priv);
    VAPID_PUBLIC_KEY = pub;
    pushEnabled = true;
    console.log('[push] Notificaciones push ACTIVADAS.');
  } catch (err) {
    pushEnabled = false;
    console.error('[push] No se pudieron activar las notificaciones:', err.message);
  }
}

// Guarda el estado actual (de forma perezosa, gestionado por el store).
function saveDb() {
  store.save(db);
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
let idCounter = Date.now();
function nextId() {
  idCounter += 1;
  return idCounter.toString(36);
}

function cleanName(name) {
  return String(name || '').trim().slice(0, 40);
}

function cleanText(text) {
  return String(text || '').trim().slice(0, 200);
}

// Convierte "1,99" / "1.99" / 2 en un número >= 0, o null si no es válido.
function cleanPrice(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = parseFloat(String(value).replace(',', '.'));
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Compras (trips)
// ---------------------------------------------------------------------------
// Partes de la fecha en horario de España (Europe/Madrid), para que el "día"
// coincida con el del usuario aunque el servidor esté en UTC.
function madridParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { dd: get('day'), mm: get('month'), yyyy: get('year') };
}
// Fecha "dd/mm/aaaa" para el título de la compra.
function fechaES(date = new Date()) {
  const { dd, mm, yyyy } = madridParts(date);
  return `${dd}/${mm}/${yyyy}`;
}
// Fecha "aaaa-mm-dd" (para comparar días).
function fechaISO(date = new Date()) {
  const { dd, mm, yyyy } = madridParts(date);
  return `${yyyy}-${mm}-${dd}`;
}

// Borra las compras VACÍAS de días anteriores (las de hoy se conservan aunque
// estén vacías). Así, si un día no se añade nada, esa lista desaparece al
// día siguiente en lugar de acumularse.
function cleanupEmptyTrips() {
  const today = fechaISO();
  const before = db.trips.length;
  db.trips = db.trips.filter((t) => {
    const vacia = !Array.isArray(t.items) || t.items.length === 0;
    const deDiaAnterior = (t.date || '') < today;
    return !(vacia && deDiaAnterior);
  });
  if (db.trips.length !== before) {
    console.log('[db] Limpieza:', before - db.trips.length, 'lista(s) vacía(s) de días anteriores borrada(s).');
    saveDb();
  }
}

// Crea una compra activa nueva (opcionalmente con artículos ya existentes).
function makeTrip(items = []) {
  const now = new Date();
  return {
    id: nextId(),
    title: 'COMPRA ' + fechaES(now),
    date: fechaISO(now), // aaaa-mm-dd (horario de España)
    status: 'active',
    createdAt: now.toISOString(),
    archivedAt: null,
    items: Array.isArray(items) ? items : [],
  };
}

// Devuelve la compra activa; si no hay ninguna, la crea.
// Antes limpia las listas vacías de días anteriores.
function getActiveTrip() {
  cleanupEmptyTrips();
  let trip = db.trips.find((t) => t.status === 'active');
  if (!trip) {
    trip = makeTrip();
    db.trips.push(trip);
    saveDb();
  }
  return trip;
}

// Total (suma de precios) de una compra.
function tripTotal(trip) {
  const sum = trip.items.reduce((s, i) => s + (typeof i.price === 'number' ? i.price : 0), 0);
  return Math.round(sum * 100) / 100;
}

// Busca un artículo dentro de la compra ACTIVA (las archivadas son de solo lectura).
function findActiveItem(id) {
  return getActiveTrip().items.find((i) => i.id === id);
}

// ---------------------------------------------------------------------------
// Autenticación de Admin (la persona que va a comprar)
// ---------------------------------------------------------------------------
function isAdmin(req) {
  const token = req.get('x-admin-token') || '';
  return token && db.adminTokens.includes(token);
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Necesitas modo Admin.' });
  next();
}

// Nombre de quien hace la petición (se envía codificado en la cabecera x-user).
function currentUser(req) {
  try {
    return cleanName(decodeURIComponent(req.get('x-user') || ''));
  } catch (e) {
    return '';
  }
}

// ---------------------------------------------------------------------------
// App Express
// ---------------------------------------------------------------------------
// Generar los iconos de la PWA si todavía no existen.
try {
  const made = ensureIcons(path.join(__dirname, 'public', 'icons'));
  if (made.length) console.log('[icons] Generados:', made.join(', '));
} catch (err) {
  console.warn('[icons] No se pudieron generar los iconos:', err.message);
}

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Clave pública para que el navegador pueda suscribirse a push.
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ key: VAPID_PUBLIC_KEY, pushEnabled });
});

// Estado completo: todas las compras (activa + historial) con sus artículos.
app.get('/api/state', (req, res) => {
  const active = getActiveTrip();
  // Orden: la activa primero, luego las archivadas de más reciente a más antigua.
  const trips = db.trips
    .slice()
    .sort((a, b) => {
      if (a.status === 'active') return -1;
      if (b.status === 'active') return 1;
      return (b.archivedAt || b.createdAt).localeCompare(a.archivedAt || a.createdAt);
    })
    .map((t) => ({ ...t, total: tripTotal(t) }));
  res.json({ trips, activeId: active.id, pushEnabled, storage: store.getMode() });
});

// Añadir un artículo a la compra activa.
app.post('/api/items', (req, res) => {
  const person = cleanName(req.body.person);
  const text = cleanText(req.body.text);
  if (!person) return res.status(400).json({ error: 'Falta el nombre.' });
  if (!text) return res.status(400).json({ error: 'Falta el artículo.' });

  const item = {
    id: nextId(),
    person,
    text,
    checked: false, // marcado por el Admin: "ya está en el carrito"
    bought: false, // compra finalizada
    price: null, // precio puesto por el Admin
    createdAt: new Date().toISOString(),
  };
  getActiveTrip().items.push(item);
  saveDb();
  res.status(201).json(item);
});

// Modificar un artículo de la compra activa.
// - El texto lo puede editar cualquiera (corregir su propio artículo).
// - El tick (checked), el precio y "comprado" (bought) son SOLO de Admin.
app.patch('/api/items/:id', (req, res) => {
  const item = findActiveItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'No encontrado (¿es de una compra antigua?).' });

  if (typeof req.body.text === 'string') {
    const t = cleanText(req.body.text);
    if (t) item.text = t;
  }

  const wantsAdminField =
    'checked' in req.body || 'bought' in req.body || 'price' in req.body;
  if (wantsAdminField) {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Necesitas modo Admin.' });
    if (typeof req.body.checked === 'boolean') item.checked = req.body.checked;
    if (typeof req.body.bought === 'boolean') item.bought = req.body.bought;
    if ('price' in req.body) item.price = cleanPrice(req.body.price);
  }

  saveDb();
  res.json(item);
});

// Borrar un artículo de la compra activa.
// Permitido si eres Admin, o si el artículo es tuyo (lo añadiste tú).
app.delete('/api/items/:id', (req, res) => {
  const trip = getActiveTrip();
  const item = trip.items.find((i) => i.id === req.params.id);
  if (!item) return res.json({ removed: 0 });

  if (!isAdmin(req) && item.person !== currentUser(req)) {
    return res.status(403).json({ error: 'Solo puedes borrar tus propios productos.' });
  }

  trip.items = trip.items.filter((i) => i.id !== item.id);
  saveDb();
  res.json({ removed: 1 });
});

// ---------------------------------------------------------------------------
// Modo Admin
// ---------------------------------------------------------------------------

// Entrar en modo Admin con la contraseña.
app.post('/api/admin/login', (req, res) => {
  const password = String(req.body.password || '');
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Contraseña incorrecta.' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  db.adminTokens.push(token);
  // Limitar el número de sesiones guardadas.
  if (db.adminTokens.length > 50) db.adminTokens = db.adminTokens.slice(-50);
  saveDb();
  res.json({ token });
});

// Comprobar si el token sigue siendo de Admin (al recargar la página).
app.get('/api/admin/me', (req, res) => {
  res.json({ admin: isAdmin(req) });
});

// Salir del modo Admin.
app.post('/api/admin/logout', (req, res) => {
  const token = req.get('x-admin-token') || '';
  db.adminTokens = db.adminTokens.filter((t) => t !== token);
  saveDb();
  res.json({ ok: true });
});

// Marcar todo como comprado dentro de la compra activa. Solo Admin.
app.post('/api/admin/finish', requireAdmin, (req, res) => {
  const trip = getActiveTrip();
  let count = 0;
  for (const item of trip.items) {
    if (!item.bought) {
      item.bought = true;
      count += 1;
    }
  }
  saveDb();
  res.json({ marked: count, total: tripTotal(trip) });
});

// Borrar una compra (del historial o la activa). Solo Admin.
// Si se borra la activa, getActiveTrip() crea una nueva vacía con la fecha de hoy.
app.delete('/api/trips/:id', requireAdmin, (req, res) => {
  const trip = db.trips.find((t) => t.id === req.params.id);
  if (!trip) return res.json({ removed: 0 });
  db.trips = db.trips.filter((t) => t.id !== req.params.id);
  getActiveTrip(); // asegura que siempre quede una compra activa
  saveDb();
  res.json({ removed: 1 });
});

// Nueva compra: archiva la activa actual y empieza una nueva (con la fecha de hoy). Solo Admin.
app.post('/api/admin/new-trip', requireAdmin, (req, res) => {
  const current = getActiveTrip();
  // Solo archivamos la compra actual si tiene contenido; si está vacía, la reutilizamos.
  if (current.items.length) {
    current.status = 'archived';
    current.archivedAt = new Date().toISOString();
    const fresh = makeTrip();
    db.trips.push(fresh);
    saveDb();
    return res.json({ trip: fresh, archived: current.id });
  }
  // Estaba vacía: solo refrescamos su fecha a hoy.
  const now = new Date();
  current.title = 'COMPRA ' + fechaES(now);
  current.date = fechaISO(now);
  current.createdAt = now.toISOString();
  saveDb();
  res.json({ trip: current, archived: null });
});

// Guardar una suscripción de notificaciones push.
app.post('/api/subscribe', (req, res) => {
  const person = cleanName(req.body.person);
  const subscription = req.body.subscription;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Suscripción inválida.' });
  }
  // Evitar duplicados por endpoint.
  db.subscriptions = db.subscriptions.filter((s) => s.subscription.endpoint !== subscription.endpoint);
  db.subscriptions.push({ person, subscription, createdAt: new Date().toISOString() });
  saveDb();
  res.status(201).json({ ok: true });
});

// Disparar la alerta "¡Vamos a la compra!" -> push a todos.
app.post('/api/alert', async (req, res) => {
  const person = cleanName(req.body.person) || 'Alguien';
  const customMsg = cleanText(req.body.message);

  const payload = JSON.stringify({
    title: '🛒 ¡Vamos a la compra!',
    body: customMsg || `${person} va a la compra. Añade lo que necesites.`,
    person,
  });

  if (!pushEnabled) {
    return res.json({ sent: 0, total: db.subscriptions.length, pushEnabled: false });
  }

  let sent = 0;
  const stale = [];
  await Promise.all(
    db.subscriptions.map(async (s) => {
      try {
        await webpush.sendNotification(s.subscription, payload);
        sent += 1;
      } catch (err) {
        // 404/410 = suscripción caducada -> la quitamos.
        if (err.statusCode === 404 || err.statusCode === 410) {
          stale.push(s.subscription.endpoint);
        } else {
          console.error('[push] Error enviando:', err.statusCode, err.body || err.message);
        }
      }
    })
  );

  if (stale.length) {
    db.subscriptions = db.subscriptions.filter((s) => !stale.includes(s.subscription.endpoint));
    saveDb();
  }

  res.json({ sent, total: db.subscriptions.length, pushEnabled: true });
});

// Cualquier otra ruta -> la PWA (para que funcione al abrir el enlace directo).
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
async function main() {
  const m = await store.init();
  console.log(`[store] Almacenamiento: ${m === 'postgres' ? 'PostgreSQL (permanente)' : 'fichero local'}`);
  db = normalizeDb(await store.load());
  cleanupEmptyTrips(); // borra listas vacías de días anteriores al arrancar
  resolveVapid();

  app.listen(PORT, () => {
    console.log(`\n🛒 Shoply escuchando en http://localhost:${PORT}`);
    console.log(`   Modo Admin con contraseña: "${ADMIN_PASSWORD}" (cámbiala con ADMIN_PASSWORD)`);
    console.log(`   Datos: ${m === 'postgres' ? 'PostgreSQL permanente ✅' : 'fichero local (temporal)'}\n`);
  });
}

main().catch((err) => {
  console.error('[fatal] No se pudo iniciar el servidor:', err);
  process.exit(1);
});

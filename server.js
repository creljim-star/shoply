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

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'data.json');
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
// Almacenamiento simple en fichero JSON
// ---------------------------------------------------------------------------
/** @type {{ items: any[], subscriptions: any[], vapid: any, adminTokens: string[] }} */
let db = { items: [], subscriptions: [], vapid: null, adminTokens: [] };

function loadDb() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      db = {
        items: Array.isArray(parsed.items) ? parsed.items : [],
        subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
        vapid: parsed.vapid || null,
        adminTokens: Array.isArray(parsed.adminTokens) ? parsed.adminTokens : [],
      };
    }
  } catch (err) {
    console.error('[db] No se pudo leer el fichero de datos, empiezo vacío:', err.message);
    db = { items: [], subscriptions: [], vapid: null, adminTokens: [] };
  }
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

let saveTimer = null;
function saveDb() {
  // Guardado "perezoso" para no escribir en disco en cada pulsación.
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (err) {
      console.error('[db] Error guardando datos:', err.message);
    }
  }, 200);
}

loadDb();
resolveVapid();

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

// Estado completo: lista de artículos.
app.get('/api/state', (req, res) => {
  res.json({ items: db.items, pushEnabled });
});

// Añadir un artículo a la lista.
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
  db.items.push(item);
  saveDb();
  res.status(201).json(item);
});

// Modificar un artículo.
// - El texto lo puede editar cualquiera (corregir su propio artículo).
// - El tick (checked), el precio y "comprado" (bought) son SOLO de Admin.
app.patch('/api/items/:id', (req, res) => {
  const item = db.items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'No encontrado.' });

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

// Borrar un artículo.
app.delete('/api/items/:id', (req, res) => {
  const before = db.items.length;
  db.items = db.items.filter((i) => i.id !== req.params.id);
  saveDb();
  res.json({ removed: before - db.items.length });
});

// Vaciar artículos ya comprados (limpieza tras la compra). Solo Admin.
app.post('/api/clear-bought', requireAdmin, (req, res) => {
  const before = db.items.length;
  db.items = db.items.filter((i) => !i.bought);
  saveDb();
  res.json({ removed: before - db.items.length });
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

// Marcar todo como comprado (al terminar la compra). Solo Admin.
app.post('/api/admin/finish', requireAdmin, (req, res) => {
  let count = 0;
  let total = 0;
  for (const item of db.items) {
    if (!item.bought) {
      item.bought = true;
      count += 1;
    }
    if (typeof item.price === 'number') total += item.price;
  }
  total = Math.round(total * 100) / 100;
  saveDb();
  res.json({ marked: count, total });
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

app.listen(PORT, () => {
  console.log(`\n🛒 Shoply escuchando en http://localhost:${PORT}`);
  console.log(`   Modo Admin con contraseña: "${ADMIN_PASSWORD}" (cámbiala con ADMIN_PASSWORD)\n`);
});

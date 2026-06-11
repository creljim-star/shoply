/**
 * Almacenamiento de Shoply.
 *
 * - Si existe DATABASE_URL  -> PostgreSQL (permanente, p. ej. Neon/Supabase).
 * - Si no                   -> fichero JSON local (desarrollo).
 *
 * Guarda TODO el estado (compras, suscripciones, claves, tokens) como un único
 * documento JSON. Es más que suficiente para una lista de la compra de oficina
 * y mantiene el código simple.
 */
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL || '';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'data.json');

let pool = null;
let mode = 'file';

// Inicializa el almacenamiento. Devuelve 'postgres' o 'file'.
async function init() {
  if (DATABASE_URL) {
    try {
      const { Pool } = require('pg');
      pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }, // Neon/Supabase/Render requieren SSL
        max: 3,
      });
      await pool.query(
        'CREATE TABLE IF NOT EXISTS shoply_store (id text PRIMARY KEY, data jsonb NOT NULL)'
      );
      mode = 'postgres';
      return mode;
    } catch (err) {
      console.error('[store] ⚠️ No se pudo conectar a PostgreSQL:', err.message);
      console.error('[store] ⚠️ Usando fichero TEMPORAL. Revisa la variable DATABASE_URL.');
      pool = null;
      mode = 'file';
    }
  } else {
    mode = 'file';
  }
  return mode;
}

// Carga el estado guardado, o null si no hay nada todavía.
async function load() {
  if (mode === 'postgres') {
    const r = await pool.query("SELECT data FROM shoply_store WHERE id = 'main'");
    return r.rows.length ? r.rows[0].data : null;
  }
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    console.error('[store] No se pudo leer el fichero:', err.message);
  }
  return null;
}

// Guardado "perezoso": agrupa escrituras seguidas en una sola.
let saveTimer = null;
let pending = null;
function save(data) {
  pending = data;
  if (saveTimer) return;
  saveTimer = setTimeout(flush, 250);
}

async function flush() {
  saveTimer = null;
  const data = pending;
  pending = null;
  if (data == null) return;
  try {
    if (mode === 'postgres') {
      await pool.query(
        `INSERT INTO shoply_store (id, data) VALUES ('main', $1::jsonb)
         ON CONFLICT (id) DO UPDATE SET data = $1::jsonb`,
        [JSON.stringify(data)]
      );
    } else {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    }
  } catch (err) {
    console.error('[store] Error guardando:', err.message);
  }
}

module.exports = { init, load, save, getMode: () => mode };

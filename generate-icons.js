/**
 * Genera los iconos PNG de la PWA (carrito blanco sobre fondo verde).
 * Normalmente no hace falta ejecutarlo: el servidor los crea al arrancar.
 *
 * Uso:  node generate-icons.js
 */
const path = require('path');
const { ensureIcons } = require('./lib/icons');

const outDir = path.join(__dirname, 'public', 'icons');
const made = ensureIcons(outDir, { force: true });
made.forEach((n) => console.log('✓', n));
console.log('\nIconos generados en public/icons/');

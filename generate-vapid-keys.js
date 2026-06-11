/**
 * Genera un par de claves VAPID para las notificaciones push.
 *
 * Uso:
 *   npm run keys
 *
 * Copia las dos claves que imprime en las variables de entorno
 * VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY (en local en un fichero .env
 * o en el panel de tu hosting).
 */
const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();

console.log('\n=== Claves VAPID generadas ===\n');
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('\nGuárdalas como variables de entorno. ¡No compartas la privada!\n');

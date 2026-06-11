# 🛒 Shoply

App **instalable en el móvil** (PWA) para que tus compañeros de oficina
escriban su lista de la compra. Cuando alguien va a comprar, pulsa un botón
y **todos reciben una notificación** en el móvil para añadir lo que necesiten.

- ✅ Se instala en el móvil desde el navegador (sin Play Store ni App Store).
- ✅ Cada persona entra **solo con su nombre** (sin contraseñas).
- ✅ Lista compartida en tiempo real, agrupada por persona.
- ✅ Botón **"📣 Voy a la compra"** que envía una notificación push a todos.
- ✅ **Modo Admin** (con contraseña) para quien va a comprar.

## 🔒 Modo Admin (la persona que va a comprar)

Pulsa el **candado 🔒** arriba a la derecha e introduce la contraseña.
En modo Admin puedes:

- ✅ **Marcar cada producto** según lo metes al carrito (tick azul = "ya lo tengo").
- 💶 **Poner el precio** de cada producto (verás el **total** arriba).
- ✅ Pulsar **"Marcar todo como comprado"** al terminar la compra.
- 🧹 **Quitar comprados** para dejar la lista lista para la próxima vez.

Los compañeros normales solo pueden añadir productos y ver precios/estado;
no pueden marcar ni poner precios.

> **Contraseña por defecto:** `shoply`. **Cámbiala** definiendo la variable
> de entorno `ADMIN_PASSWORD` (en Render: *Environment*).

---

## 🚀 Puesta en marcha (gratis, en internet)

La forma recomendada es subirla a **Render** (plan gratuito). Necesitarás una
cuenta gratuita de **GitHub** y otra de **Render**. No hace falta instalar nada
en tu ordenador.

### 1. Sube el código a GitHub
1. Crea una cuenta en https://github.com (si no tienes).
2. Crea un repositorio nuevo (por ejemplo `shoply`).
3. Sube **todos los archivos de esta carpeta** al repositorio
   (puedes arrastrarlos en *Add file → Upload files*).

### 2. Crea el servicio en Render
1. Crea una cuenta en https://render.com (puedes entrar con GitHub).
2. Pulsa **New + → Web Service** y conecta tu repositorio de GitHub.
3. Render detectará la configuración. Si te pide los datos a mano:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free
4. Pulsa **Create Web Service** y espera a que termine (1-2 min).
5. Te dará una URL pública, algo como
   `https://shoply.onrender.com`.

¡Eso es todo! Las notificaciones funcionan sin configurar nada (el servidor
genera sus claves automáticamente).

### 3. Instálala en el móvil (cada compañero)
1. Abre la URL en el móvil con **Chrome** (Android) o **Safari** (iPhone).
2. **Android/Chrome:** menú ⋮ → *Instalar app* / *Añadir a pantalla de inicio*.
   **iPhone/Safari:** botón *Compartir* → *Añadir a pantalla de inicio*.
3. Abre la app, escribe tu nombre y pulsa **🔔 Activar notificaciones**.

> **iPhone:** las notificaciones push solo funcionan si la app está
> **instalada** en la pantalla de inicio (requisito de Apple, iOS 16.4+).

---

## ⚠️ Sobre la persistencia (plan gratuito)

En el plan **gratuito de Render** el almacenamiento es temporal: la lista
puede borrarse cuando el servicio se reinicia o se vuelve a desplegar, y el
servicio "se duerme" tras un rato sin uso (la primera visita tarda unos
segundos en despertar). Para una lista de la compra de oficina suele ser
suficiente.

Si quieres que la lista sea **permanente**, añade un disco persistente
(opción de pago de Render) y define la variable `DATA_FILE=/data/data.json`.
Tienes las indicaciones comentadas en [`render.yaml`](render.yaml).

---

## 💻 Probar en tu ordenador (opcional)

Requiere **Node.js 18+** instalado (https://nodejs.org).

```bash
npm install
npm start
```

Abre http://localhost:3000. Para probar las notificaciones desde otro móvil
en local necesitarás HTTPS (las push requieren conexión segura), por eso es
más cómodo usar Render directamente.

---

## 🔑 Fijar las claves de notificaciones (opcional)

Por defecto el servidor genera las claves push automáticamente. Si prefieres
fijarlas (para que no cambien al redeplegar), genera un par:

```bash
npm run keys
```

y define `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` como variables de entorno en
Render (*Environment*).

---

## 🗂️ Estructura del proyecto

```
server.js              Servidor (API + envío de notificaciones)
lib/icons.js           Generador de iconos PNG (se ejecuta solo al arrancar)
generate-icons.js      Generar iconos a mano (opcional)
generate-vapid-keys.js Generar claves push a mano (opcional)
render.yaml            Configuración de despliegue en Render
public/                La app que se instala en el móvil (PWA)
  index.html
  app.js
  styles.css
  manifest.json        Hace la web "instalable"
  service-worker.js    Caché + recepción de notificaciones
  icons/
data/                  Donde se guarda la lista (data.json)
```

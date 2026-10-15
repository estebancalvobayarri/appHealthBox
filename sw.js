// Service worker: permite instalar la app y abrirla sin conexión.
// Los datos (Supabase) y los vídeos nunca se guardan en caché.
// Si cambias archivos de la app, sube el número de versión.
const VERSION = "healthbox-v18";
const SHELL = [
  "./",
  "index.html",
  "admin.html",
  "css/styles.css",
  "js/config.js",
  "js/common.js",
  "js/api.js",
  "js/app.js",
  "js/admin.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "favicon.ico",
  "images/letra_oscura.png",
  "images/letra_clara.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Primero la red (para recibir siempre la última versión); si no hay conexión, la copia guardada.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!sameOrigin && !isFont) return;
  if (req.headers.has("range") || /\.(mp4|webm|mov|m4v)$/i.test(url.pathname)) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: sameOrigin }).then((r) => r || (req.mode === "navigate" ? caches.match("index.html") : undefined)))
  );
});

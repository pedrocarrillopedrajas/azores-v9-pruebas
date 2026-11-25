// AZORES - caché de aplicación prueba envíos limpios 2026-11-16-1
const CACHE = "azores-shell-pruebas-v963-20261125-1";
const FILES = ["./", "./index.html", "./styles.css", "./app.js", "./oportunidades.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./logo-azores.jpg", "./cata-celebracion.gif"];
const SCOPE = new URL(self.registration.scope);
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("azores-shell-pruebas-") && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);
  // No interceptar Supabase ni otras aplicaciones GitHub Pages.
  if (req.method !== "GET" || url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // Evita reutilizar respuestas antiguas de la caché HTTP del navegador.
      const response = await fetch(req, {cache: "no-store"});
      if (response.ok) await cache.put(req, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(req, {ignoreSearch: req.mode === "navigate"});
      if (cached) return cached;
      if (req.mode === "navigate") {
        const fallback = await cache.match("./index.html");
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type: "window", includeUncontrolled: true});
    const existing = windows.find(client => client.url.startsWith(self.registration.scope));
    if (existing) return existing.focus();
    return self.clients.openWindow(self.registration.scope);
  })());
});

// V9.37: mostrar push recibidos incluso con la app cerrada.
self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { payload = {body: event.data?.text() || ""}; }
  const title = typeof payload.title === "string" ? payload.title : "AZORES · Envíos";
  const body = typeof payload.body === "string" ? payload.body : "Hay novedades en un envío.";
  event.waitUntil(self.registration.showNotification(title, {
    body, icon: "./icon-192.png", badge: "./icon-192.png",
    tag: typeof payload.tag === "string" ? payload.tag : "azores-envios",
    data: {url: self.registration.scope}
  }));
});

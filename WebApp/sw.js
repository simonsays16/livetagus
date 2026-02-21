const CACHE_NAME = "livetagus-v.b12.20022026";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./app.html",
  "./horarios.html",
  "./privacidade.html",
  "./output.css",
  "./menu.js",
  "./offline.js",
  "./imagens/icon.svg",
  "./imagens/logotransparente.svg",
  "./imagens/favicon-96x96.png",
  "./imagens/badge_coded_in_europe_portugal_margem_sul.svg",
  "./json/fertagus_sentido_lisboa.json",
  "./json/fertagus_sentido_margem.json",
  "./json/feriados.json",
];

// Instalação: Guarda os ficheiros
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[Service Worker] Caching app shell");
      return cache.addAll(ASSETS_TO_CACHE);
    }),
  );
  self.skipWaiting();
});

// Ativação: Limpa caches antigas
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        }),
      );
    }),
  );
  return self.clients.claim();
});

// Fetch: Serve do cache primeiro, rede depois (Offline-First)
self.addEventListener("fetch", (event) => {
  if (
    event.request.url.includes("api.") ||
    event.request.url.includes("npoint")
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) return response;

      // Lógica para Clean URLs: Se pedires /app, tenta buscar /app.html na cache
      const url = new URL(event.request.url);
      if (
        event.request.mode === "navigate" &&
        !url.pathname.endsWith(".html")
      ) {
        return (
          caches.match(url.pathname + ".html") ||
          caches.match(url.pathname + "/index.html")
        );
      }

      return fetch(event.request);
    }),
  );
});

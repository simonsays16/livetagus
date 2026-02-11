/* Filename: sw.js */
const CACHE_NAME = "livetagus-v.b45.11022026"; // Incrementa isto quando fizeres grandes updates
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
  // Ignora pedidos para outras APIs (ex: npoint, livetagus-api) para tentar sempre a rede primeiro nelas
  if (
    event.request.url.includes("api.") ||
    event.request.url.includes("npoint")
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return (
        response ||
        fetch(event.request).catch(() => {
          // Se falhar a rede e não estiver em cache (ex: imagem externa), não faz nada ou retorna fallback
          return null;
        })
      );
    }),
  );
});

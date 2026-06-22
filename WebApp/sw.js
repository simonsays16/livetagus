// --- BEGIN VERSIONS ---
const GLOBAL_VERSION = "livetagus-v.rc36.22062026";
const ASSETS_VERSIONS = {
  "./index.html": "v.rc19.22062026",
  "./index.js": "v.rc3.21062026",
  "./index-home.js": "v.rc1.22062026",
  "./home-map.js": "v.rc6.22062026",
  "./app.html": "v.rc1.07062026",
  "./app-alerts.js": "v.rc3.13062026",
  "./app-config.js": "v.rc1.13062026",
  "./app-init.js": "v.rc2.13062026",
  "./app-settings.js": "v.rc3.07062026",
  "./app-trains.js": "v.rc1.14062026",
  "./app-ui.js": "v.rc3.21062026",
  "./lucide-icons.js": "v.rc1.08062026",
  "./sudoku.html": "v.rc2.07062026",
  "./sudoku.js": "v.rc1.24052026",
  "./sudoku-train.js": "v.rc2.28052026",
  "./horarios.html": "v.rc1.24052026",
  "./horarios.js": "v.rc1.24052026",
  "./privacidade.html": "v.rc2.21062026",
  "./tabs.js": "v.rc1.24052026",
  "./train-scrollbar.js": "v.rc3.22062026",
  "./output.css": "v.rc7.22062026",
  "./menu.js": "v.rc3.21062026",
  "./nav-tools.js": "v.rc9.08062026",
  "./offline.js": "v.rc1.24052026",
  "./imagens/icon.svg": "v.rc1.24052026",
  "./imagens/logotransparente.svg": "v.rc1.24052026",
  "./imagens/favicon-96x96.png": "v.rc1.24052026",
  "./imagens/badge_coded_in_europe_portugal_margem_sul.svg": "v.rc1.24052026",
  "./imagens/netlify-dark.svg": "v.rc1.24052026",
  "./imagens/netlify-light.svg": "v.rc1.24052026",
  "./json/fertagus_sentido_lisboa.json": "v.rc1.24052026",
  "./json/fertagus_sentido_margem.json": "v.rc1.24052026",
  "./json/feriados.json": "v.rc1.24052026"
};
// --- END VERSIONS ---

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const newCache = await caches.open(GLOBAL_VERSION);

      // Encontra a cache antiga para podermos reaproveitar ficheiros
      const cacheNames = await caches.keys();
      const oldCacheName = cacheNames.find(
        (name) => name.startsWith("livetagus-") && name !== GLOBAL_VERSION,
      );
      const oldCache = oldCacheName ? await caches.open(oldCacheName) : null;

      // Obtém o dicionário de versões antigas (se existir)
      let oldVersions = {};
      if (oldCache) {
        const oldVersionsRes = await oldCache.match("/virtual-versions-dict");
        if (oldVersionsRes) oldVersions = await oldVersionsRes.json();
      }

      const filesToCache = Object.keys(ASSETS_VERSIONS);

      // Verifica cada ficheiro individualmente
      await Promise.all(
        filesToCache.map(async (url) => {
          const newVer = ASSETS_VERSIONS[url];
          const oldVer = oldVersions[url];

          if (oldCache && newVer === oldVer) {
            // Se a versão é igual, copia da cache antiga (poupa tráfego)
            const response = await oldCache.match(url);
            if (response) {
              return newCache.put(url, response);
            }
          }

          // Se a versão mudou ou não estava na cache, vai buscar à rede
          try {
            const req = new Request(url, { cache: "no-cache" }); // Força a ignorar a cache do browser
            const response = await fetch(req);
            if (response.ok) await newCache.put(url, response);
          } catch (err) {
            console.error(`[SW] Falha ao fazer cache de ${url}:`, err);
          }
        }),
      );

      // Guarda o novo dicionário de versões na cache para a próxima atualização
      const versionsResponse = new Response(JSON.stringify(ASSETS_VERSIONS), {
        headers: { "Content-Type": "application/json" },
      });
      await newCache.put("/virtual-versions-dict", versionsResponse);

      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keyList) => {
        return Promise.all(
          keyList.map((key) => {
            if (key !== GLOBAL_VERSION && key.startsWith("livetagus-")) {
              return caches.delete(key);
            }
          }),
        );
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (
    event.request.url.includes("api.") ||
    event.request.url.includes("openstreetmap.org")
  )
    return;

  event.respondWith(
    caches.match(event.request).then(async (response) => {
      if (response) return response;

      const url = new URL(event.request.url);

      if (
        event.request.mode === "navigate" &&
        !url.pathname.endsWith(".html")
      ) {
        const htmlMatch = await caches.match(url.pathname + ".html");
        if (htmlMatch) return htmlMatch;

        const indexMatch = await caches.match(url.pathname + "/index.html");
        if (indexMatch) return indexMatch;
      }

      return fetch(event.request).catch((err) => {
        console.error("[SW] Falha na rede:", err);
        if (event.request.mode === "navigate")
          return caches.match("./app.html");
      });
    }),
  );
});

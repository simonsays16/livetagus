// --- BEGIN VERSIONS ---
const GLOBAL_VERSION = "livetagus-v.rc3.03102026";
const ASSETS_VERSIONS = {
  "./index.html": "v.rc2.30092026",
  "./index.js": "v.rc3.21062026",
  "./index-home.js": "v.rc1.22062026",
  "./home-map.js": "v.rc1.03102026",
  "./app.html": "v.rc2.30092026",
  "./app-alerts.js": "v.rc3.13062026",
  "./app-config.js": "v.rc2.13092026",
  "./app-occupancy.js": "v.rc1.12092026",
  "./app-timefilter.js": "v.rc1.12092026",
  "./planear-searchbar.js": "v.rc1.12092026",
  "./app-init.js": "v.rc1.13092026",
  "./app-settings.js": "v.rc4.12092026",
  "./app-trains.js": "v.rc3.28092026",
  "./app-ui.js": "v.rc5.12092026",
  "./lucide-icons.js": "v.rc1.25062026",
  "./sudoku.html": "v.rc2.30092026",
  "./sudoku.js": "v.rc1.24052026",
  "./sudoku-train.js": "v.rc2.28052026",
  "./horarios.html": "v.rc2.30092026",
  "./horarios.js": "v.rc1.24052026",
  "./privacidade.html": "v.rc3.30092026",
  "./tabs.js": "v.rc1.24052026",
  "./train-scrollbar.js": "v.rc1.03102026",
  "./output.css": "v.rc12.12092026",
  "./assets/fonts/fonts.css": "v.rc1.30092026",
  "./assets/fonts/inter-normal-variavel-v20-latin.woff2": "v.rc1.30092026",
  "./assets/fonts/jetbrains-mono-normal-variavel-v24-latin.woff2":
    "v.rc1.30092026",
  "./menu.js": "v.rc1.28092026",
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
  "./json/feriados.json": "v.rc1.24052026",
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

// Ficheiros com a versão no nome
const CACHE_IMUTAVEIS = "lt-imutaveis";

function eImutavel(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/vendor/") ||
      /-v\d+-[\w-]+\.woff2$/.test(url.pathname))
  );
}

// "maplibre-gl@4.7.1.min.js" e "maplibre-gl@4.8.0.min.js" são a mesma
// família: ao guardar uma versão nova, a anterior sai.
function familia(pathname) {
  return pathname
    .replace(/@\d[\w.-]*?(?=\.(?:min\.)?(?:js|css)$)/, "@*")
    .replace(/-v\d+-/, "-v*-");
}

async function guardarImutavel(request, response) {
  const cache = await caches.open(CACHE_IMUTAVEIS);
  const fam = familia(new URL(request.url).pathname);
  for (const antigo of await cache.keys()) {
    const p = new URL(antigo.url).pathname;
    if (antigo.url !== request.url && familia(p) === fam)
      await cache.delete(antigo);
  }
  await cache.put(request, response);
}

self.addEventListener("fetch", (event) => {
  if (
    event.request.url.includes("api.") ||
    event.request.url.includes("openstreetmap.org")
  )
    return;

  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.searchParams.has("t")) {
    event.respondWith(
      fetch(event.request).catch(async (err) => {
        const guardado = await caches.match(event.request, {
          ignoreSearch: true,
        });
        if (guardado) return guardado;
        throw err;
      }),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(async (response) => {
      if (response) return response;

      // Imutáveis: à primeira vez, da rede, e ficam guardados.
      if (event.request.method === "GET" && eImutavel(url)) {
        const res = await fetch(event.request);
        if (res.ok)
          event.waitUntil(guardarImutavel(event.request, res.clone()));
        return res;
      }

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

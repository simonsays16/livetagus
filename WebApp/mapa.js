/**
 * mapa.js
 * Main da página de mapa ao vivo dos comboios Fertagus.
 */

document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  // ─── ELEMENTOS DOM ───────────────────────────────────────────────────
  const mapEl = document.getElementById("map");
  const loadingEl = document.getElementById("map-loading");
  const refreshBtn = document.getElementById("btn-refresh");
  const legendToggle = document.getElementById("btn-legend");
  const legendCard = document.getElementById("legend-card");
  const legendClose = document.getElementById("legend-close");

  // ─── iOS DETECTION ───────────────────────────────────────────────────
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) document.body.classList.add("is-ios");

  const isAndroid = /Android/i.test(navigator.userAgent);
  if (isAndroid) document.body.classList.add("is-android");

  // ─── ESTADO ──────────────────────────────────────────────────────────
  let mapInstance = null;
  let latestResult = { trainsForMap: [], trainsForList: [] };
  let apiIntervalId = null;
  let posIntervalId = null;
  let lastBackgroundTime = 0;

  // Expor a lista actual ao modal da estação (callback)
  function getCurrentTrainsForList() {
    return latestResult.trainsForList || [];
  }

  // ─── MENU GLOBAL: BOTÃO DE FERRAMENTAS + PARTILHA ────────────────────

  function injectMenuExtras() {
    const header = document.querySelector("#global-nav header");
    const trigger = document.getElementById("menu-trigger");
    if (!header || !trigger || document.getElementById("menu-controls-wrapper"))
      return;

    const wrapper = document.createElement("div");
    wrapper.id = "menu-controls-wrapper";
    wrapper.className = "flex items-center gap-1";
    header.insertBefore(wrapper, trigger);

    // ── BOTÃO DE PARTILHA ──────────────────────────────────────────
    const shareBtn = document.createElement("button");
    shareBtn.id = "mapa-share-trigger";
    shareBtn.className =
      "p-2 rounded-full transition-colors text-zinc-900 dark:text-white";
    shareBtn.setAttribute("aria-label", "Partilhar mapa");
    shareBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
           viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
           class="w-5 h-5">
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
        <polyline points="16 6 12 2 8 6"/>
        <line x1="12" x2="12" y1="2" y2="15"/>
      </svg>`;
    wrapper.appendChild(shareBtn);
    if (window.MapaShare) window.MapaShare.attachToButton(shareBtn);

    // ── BOTÃO DE FERRAMENTAS INTELIGENTES (popover existente) ──────
    const btn = document.createElement("button");
    btn.id = "mobility-trigger";
    btn.className =
      "p-2 rounded-full transition-colors text-zinc-900 dark:text-white group relative";
    btn.setAttribute("aria-label", "Ferramentas Inteligentes");
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5">
        <path d="m10.586 5.414-5.172 5.172"/><path d="m18.586 13.414-5.172 5.172"/><path d="M6 12h12"/><circle cx="12" cy="20" r="2"/><circle cx="12" cy="4" r="2"/><circle cx="20" cy="12" r="2"/><circle cx="4" cy="12" r="2"/>
      </svg>`;
    wrapper.appendChild(btn);
    wrapper.appendChild(trigger);

    const popover = document.createElement("div");
    popover.id = "mobility-popover";
    popover.className =
      "absolute top-16 right-4 w-70 bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl hidden origin-top-right transition-all duration-300 transform scale-95 opacity-0 z-50 overflow-hidden";
    popover.innerHTML = `
      <div class="px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-100 dark:border-zinc-800">
        <p class="text-[9px] font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">Funcionalidades</p>
      </div>
      <div class="flex flex-col">
        <a href="./app" class="w-full flex items-center gap-4 px-4 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-left">
          <i data-lucide="train-track" class="w-4 h-4 text-zinc-900 dark:text-white"></i>
          <div class="flex-1">
            <p class="text-sm font-medium text-zinc-900 dark:text-white leading-none">Fertagus tempo real</p>
            <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 font-light tracking-wide">Lista e próximas partidas</p>
          </div>
          <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600"></i>
        </a>
        <div class="h-px w-full bg-zinc-100 dark:bg-zinc-800"></div>
        <a href="./paragens" class="w-full flex items-center gap-4 px-4 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-left">
          <i data-lucide="bus" class="w-4 h-4 text-zinc-900 dark:text-white"></i>
          <div class="flex-1">
            <p class="text-sm font-medium text-zinc-900 dark:text-white leading-none">A Minha Paragem</p>
            <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 font-light tracking-wide">Vais de autocarro para a estação?</p>
          </div>
          <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600"></i>
        </a>
      </div>`;
    document.getElementById("global-nav").appendChild(popover);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = popover.classList.contains("hidden");
      if (isHidden) {
        popover.classList.remove("hidden");
        requestAnimationFrame(() => {
          popover.classList.remove("scale-95", "opacity-0");
          popover.classList.add("scale-100", "opacity-100");
        });
      } else {
        popover.classList.remove("scale-100", "opacity-100");
        popover.classList.add("scale-95", "opacity-0");
        setTimeout(() => popover.classList.add("hidden"), 200);
      }
    });
    document.addEventListener("click", (e) => {
      if (
        !popover.classList.contains("hidden") &&
        !popover.contains(e.target) &&
        !btn.contains(e.target)
      ) {
        popover.classList.remove("scale-100", "opacity-100");
        popover.classList.add("scale-95", "opacity-0");
        setTimeout(() => popover.classList.add("hidden"), 200);
      }
    });

    if (window.lucide) window.lucide.createIcons();
  }

  // ─── LOOP DE POSIÇÃO ─────────────────────────────────────────────────

  function updateAllPositions() {
    if (!mapInstance || !window.MapaGeo || !window.MapaGeo.isInitialized())
      return;
    const zoom = mapInstance.getZoom();
    const now = new Date();

    const visibleIds = [];
    for (const train of latestResult.trainsForMap || []) {
      const pos = window.MapaGeo.computeTrainPosition(train, now);
      if (!pos) continue;
      // Ignora chegadas (segment=done) para não manter markers no terminal
      if (pos.segment === "done") continue;
      window.MapaRender.upsertTrain(mapInstance, train, pos, zoom);
      visibleIds.push(train.id);
    }
    window.MapaRender.removeMissingTrains(visibleIds);

    // Se o painel de detalhes está aberto, atualiza-o também
    if (window.MapaDetails && window.MapaDetails.isOpen()) {
      const cur = (latestResult.trainsForList || []).find(
        (t) => t.id === window.MapaDetails.getCurrentId(),
      );
      if (cur) window.MapaDetails.refresh(cur);
    }
    // Se o modal da estação está aberto, re-renderiza a lista
    if (window.MapaStation && window.MapaStation.isOpen()) {
      window.MapaStation.refresh();
    }
  }

  // ─── LOOP DE API ─────────────────────────────────────────────────────

  async function fetchAndApply() {
    if (refreshBtn) {
      refreshBtn.querySelector("i")?.classList.add("animate-spin");
    }
    try {
      const result = await window.MapaApi.fetchLiveTrains();
      latestResult = result || { trainsForMap: [], trainsForList: [] };
      updateAllPositions();
    } catch (e) {
      console.error("[Mapa] Erro no fetch:", e);
    } finally {
      if (refreshBtn) {
        setTimeout(() => {
          refreshBtn.querySelector("i")?.classList.remove("animate-spin");
        }, 500);
      }
    }
  }

  // ─── INICIALIZAÇÃO DO MAPA ───────────────────────────────────────────

  async function initMap() {
    const tileUrl = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

    mapInstance = new maplibregl.Map({
      container: "map",
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          basemap: {
            type: "raster",
            tiles: [tileUrl],
            tileSize: 256,
            attribution:
              '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · Dados Fertagus · Infraestruturas de Portugal',
          },
        },
        layers: [
          {
            id: "basemap-layer",
            type: "raster",
            source: "basemap",
            minzoom: 0,
            maxzoom: 22,
          },
        ],
      },
      center: MAPA.CENTER,
      zoom: MAPA.ZOOM,
      minZoom: MAPA.MIN_ZOOM,
      maxZoom: MAPA.MAX_ZOOM,
      maxBounds: MAPA.MAX_BOUNDS,
      attributionControl: false,
      // Touch defaults: pinch zoom + drag OK; double-tap zoom desactivado
      // para evitar "double-tap & hold" indesejado em iOS sobre markers.
      dragRotate: false,
      pitchWithRotate: false,
      touchZoomRotate: true,
    });

    window.MapaRender.setMap(mapInstance);

    mapInstance.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    mapInstance.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-right",
    );

    mapInstance.on("zoom", () => {
      window.MapaRender.onZoomChange(mapInstance.getZoom());
    });

    return new Promise((resolve) => {
      mapInstance.on("load", resolve);
    });
  }

  // ─── CARREGAR LINHA E ESTAÇÕES ───────────────────────────────────────

  async function loadStaticData() {
    const [lineRes, stopsRes] = await Promise.all([
      fetch(MAPA.LINE_JSON)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(MAPA.STOPS_JSON)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);

    if (lineRes) {
      window.MapaGeo.initLineGeometry(lineRes);
      window.MapaRender.drawLine(mapInstance, lineRes);
    } else {
      console.warn("[Mapa] Linha não carregou; interpolação linear.");
      window.MapaGeo.initLineGeometry({
        type: "FeatureCollection",
        features: [],
      });
    }
    if (stopsRes) {
      window.MapaRender.drawStations(mapInstance, stopsRes);
    }
  }

  // ─── BOOT ────────────────────────────────────────────────────────────

  async function boot() {
    requestAnimationFrame(() => injectMenuExtras());

    if (!mapEl) {
      console.error("[Mapa] #map não encontrado");
      return;
    }
    if (typeof window.maplibregl === "undefined") {
      console.error("[Mapa] MapLibre GL não carregado");
      if (loadingEl)
        loadingEl.innerHTML =
          '<p class="text-xs uppercase text-zinc-500 tracking-widest">Erro: MapLibre não disponível.</p>';
      return;
    }
    if (typeof window.turf === "undefined") {
      console.warn("[Mapa] Turf.js não carregado — posições lineares.");
    }
    const missing = {
      MAPA: !window.MAPA,
      MapaGeo: !window.MapaGeo,
      MapaApi: !window.MapaApi,
      MapaRender: !window.MapaRender,
      MapaDetails: !window.MapaDetails,
      MapaStation: !window.MapaStation,
      MapaShare: !window.MapaShare,
    };
    if (Object.values(missing).some(Boolean)) {
      console.error("[Mapa] Módulos em falta:", missing);
      return;
    }

    // Regista a fonte de comboios usada pelo modal da estação
    window.MapaStation.setTrainsSource(getCurrentTrainsForList);

    try {
      await initMap();
      await loadStaticData();

      // Click num comboio → details
      window.MapaRender.setClickHandler((train) => {
        window.MapaDetails.open(train);
      });

      // Primeiro fetch
      await fetchAndApply();

      // ─── VERIFICAR URL HASH (Autofocus de Comboios) ───
      const hash = window.location.hash.replace("#", "");
      if (hash && latestResult.trainsForList) {
        const train = latestResult.trainsForList.find(
          (t) => String(t.id) === hash,
        );
        if (train && train.isLive) window.MapaDetails.open(train);
      }

      if (loadingEl) {
        loadingEl.classList.add("opacity-0", "pointer-events-none");
        setTimeout(() => loadingEl.classList.add("hidden"), 400);
      }

      // Loops
      startLoops();

      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      console.error("[Mapa] Erro no boot:", e);
      if (loadingEl) {
        loadingEl.innerHTML =
          '<p class="text-xs uppercase text-zinc-500 tracking-widest">Erro a carregar o mapa.</p>';
      }
    }
  }

  // ─── GESTÃO DE LOOPS ─────────────────────────────────────────────────

  function startLoops() {
    if (!apiIntervalId) {
      apiIntervalId = setInterval(fetchAndApply, MAPA.API_REFRESH_MS);
    }
    if (!posIntervalId) {
      posIntervalId = setInterval(updateAllPositions, MAPA.POSITION_UPDATE_MS);
    }
  }

  function stopLoops() {
    if (apiIntervalId) {
      clearInterval(apiIntervalId);
      apiIntervalId = null;
    }
    if (posIntervalId) {
      clearInterval(posIntervalId);
      posIntervalId = null;
    }
  }

  // ─── UI HANDLERS ─────────────────────────────────────────────────────

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => fetchAndApply());
  }
  if (legendToggle && legendCard) {
    legendToggle.addEventListener("click", () => {
      legendCard.classList.toggle("hidden");
    });
  }
  if (legendClose && legendCard) {
    legendClose.addEventListener("click", () => {
      legendCard.classList.add("hidden");
    });
  }

  // ─── VISIBILIDADE: PAUSA/RESUME + HARD RELOAD APÓS LONGA AUSÊNCIA ────
  //
  // Problema clássico: o utilizador deixa a app em background; ao voltar,
  // o mapa e a posição dos comboios estão completamente desatualizados e,
  // em alguns browsers (Safari iOS em particular), a tab fica "congelada"
  // porque os intervalos foram parados pelo sistema e os WebSockets/fetches
  // pendentes ficam suspensos.
  //
  // Estratégia (igual à app-init.js):
  //   - Ao esconder, regista o timestamp e pára os loops.
  //   - Ao reaparecer:
  //       · Se esteve > 1 h em background → window.location.reload() para
  //         garantir estado limpo (WebSockets reconectam, cache é invalidada).
  //       · Caso contrário → força um fetch imediato e reinicia os loops.

  function onVisible() {
    const bgDurationMs = lastBackgroundTime
      ? Date.now() - lastBackgroundTime
      : 0;
    lastBackgroundTime = 0;

    if (bgDurationMs > 60 * 60 * 1000) {
      // Mais de 1 hora → reload completo
      try {
        window.location.reload();
      } catch (_) {}
      return;
    }

    // Caso contrário: reanima rapidamente
    fetchAndApply();
    startLoops();
  }

  function onHidden() {
    lastBackgroundTime = Date.now();
    stopLoops();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) onHidden();
    else onVisible();
  });

  // Fallback para browsers antigos ou casos em que o visibilitychange não
  // dispara (ex: switch entre apps no iOS com home gesture)
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      // bfcache restore → re-hidrata
      fetchAndApply();
      startLoops();
    }
  });
  window.addEventListener("focus", () => {
    // Se os loops estavam parados por algum motivo, reativa
    if (!apiIntervalId || !posIntervalId) {
      fetchAndApply();
      startLoops();
    }
  });

  // Pequena melhoria mobile: em iOS Safari, tapar em margens do canvas
  // pode fechar barras de UI. Nada a fazer aqui mas deixamos pointer:
  // events relevantes no CSS.

  // ─── GO! ─────────────────────────────────────────────────────────────
  boot();
});

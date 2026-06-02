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
    const barClasses = [
      "bg-white/80",
      "dark:bg-[#09090b]/80",
      "backdrop-blur-md",
      "border-b",
      "border-zinc-200/50",
      "dark:border-white/5",
      "supports-[backdrop-filter]:bg-white/60",
      "dark:supports-[backdrop-filter]:bg-[#09090b]/60",
    ];
    barClasses.forEach((cls) => header.classList.remove(cls));
    header.classList.remove("px-6");
    header.classList.add("px-3");
    const logoEl = header.firstElementChild;
    if (logoEl && !document.getElementById("map-logo-pill")) {
      const logoPill = document.createElement("div");
      logoPill.id = "map-logo-pill";
      logoPill.className = [
        "flex items-center",
        "px-3 py-2",
        "rounded-xl",
        "bg-white/80 dark:bg-[#09090b]/80",
        "backdrop-blur-md",
        "border border-zinc-200/50 dark:border-white/5",
        "shadow-sm",
      ].join(" ");
      logoEl.parentNode.insertBefore(logoPill, logoEl);
      logoPill.appendChild(logoEl);
    }
    const circleClass = [
      "p-2 rounded-full",
      "bg-white/80 dark:bg-[#09090b]/80",
      "backdrop-blur-md",
      "border border-zinc-200/50 dark:border-white/5",
      "shadow-sm",
      "transition-colors",
      "text-zinc-900 dark:text-white",
    ].join(" ");

    // wraper dos botões
    const wrapper = document.createElement("div");
    wrapper.id = "menu-controls-wrapper";
    wrapper.className = "flex items-center gap-2";
    header.insertBefore(wrapper, trigger);

    // ── BOTÃO DE PARTILHA ──────────────────────────────────────────
    const shareBtn = document.createElement("button");
    shareBtn.id = "mapa-share-trigger";
    shareBtn.className = circleClass;
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

    // ── BOTÃO DE FERRAMENTAS INTELIGENTES ──────────────────────────
    const btn = document.createElement("button");
    btn.id = "mobility-trigger";
    btn.className = circleClass + " group relative";
    btn.setAttribute("aria-label", "Ferramentas Inteligentes");
    btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layout-grid-icon lucide-layout-grid">
        <rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>
        <path d="m10.586 5.414-5.172 5.172"/><path d="m18.586 13.414-5.172 5.172"/><path d="M6 12h12"/><circle cx="12" cy="20" r="2"/><circle cx="12" cy="4" r="2"/><circle cx="20" cy="12" r="2"/><circle cx="4" cy="12" r="2"/>
    </svg>`;
    wrapper.appendChild(btn);
    // menu - adicionar círculo background
    trigger.classList.add(
      "bg-white/80",
      "dark:bg-[#09090b]/80",
      "backdrop-blur-md",
      "border",
      "border-zinc-200/50",
      "dark:border-white/5",
      "shadow-sm",
      "rounded-full",
      "py-3.5",
    );
    wrapper.appendChild(trigger);

    const popover = document.createElement("div");
    popover.id = "mobility-popover";
    popover.className =
      "absolute top-16 right-4 w-70 bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl hidden origin-top-right transition-all duration-300 transform scale-95 opacity-0 z-50 overflow-hidden";
    popover.innerHTML = `
      <div class="px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
        <p class="text-[9px] font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
          Mobilidade & Smart
        </p>
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
            <p class="text-sm font-medium text-zinc-900 dark:text-white leading-none">A Minha Paragem (BETA)</p>
            <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 font-light tracking-wide">Autocarros para a estação</p>
          </div>
          <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600"></i>
        </a>
        
        <div class="h-px w-full bg-zinc-100 dark:bg-zinc-800"></div>

        <a href="./sudoku" class="w-full flex items-center gap-4 px-4 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-left group/btn">
          <i data-lucide="gamepad-2" class="w-4 h-4 text-zinc-900 dark:text-white group-hover/btn:scale-110 transition-transform duration-300"></i>
          <div class="flex-1">
            <p class="text-sm font-medium text-zinc-900 dark:text-white leading-none">Jogo de Sudoku</p>
            <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 font-light tracking-wide">Tempo extra? Joga Sudoku</p>
          </div>
          <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 group-hover/btn:translate-x-1 transition-transform"></i>
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
        popover.classList.add("scale-95", "opacity-0");
        popover.classList.remove("scale-100", "opacity-100");
        setTimeout(() => popover.classList.add("hidden"), 300);
      }
    });
    document.addEventListener("click", (e) => {
      if (!popover.classList.contains("hidden") && !btn.contains(e.target)) {
        popover.classList.add("scale-95", "opacity-0");
        popover.classList.remove("scale-100", "opacity-100");
        setTimeout(() => popover.classList.add("hidden"), 300);
      }
    });
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
  function tryOpenFromHash() {
    const hash = window.location.hash.replace("#", "").trim();
    if (!hash) return false;

    const parts = hash.split("&");
    const trainId = parts[0];
    const originKey = parts[1];
    const destKey = parts[2];

    // Limpeza imediata do URL para ficar bonito
    if (parts.length > 1) {
      window.history.replaceState(null, null, "#" + trainId);
    }

    const list = latestResult.trainsForList || [];
    const train = list.find((t) => String(t.id) === trainId);
    if (!train) return false;
    if (originKey && destKey && window.MapaRender) {
      window.MapaRender.setUserRouteFilter(originKey, destKey);
    }

    // Ao abrir, ele vai puxar o startRouteFocus que já vai ler o filtro acima!
    if (window.MapaDetails) {
      window.MapaDetails.open(train);
    }

    return true;
  }

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

      // Click num comboio → details (em estado mini, com route focus)
      window.MapaRender.setClickHandler((train) => {
        window.MapaDetails.open(train);
      });

      // ─── AVISOS + MANUTENÇÃO ─────────────────────────────────────────
      // Inicializa ANTES do primeiro fetch ao vivo: se houver manutenção,
      // o /fertagus fica bloqueado e o mapa nunca o contacta.
      let maintenanceActive = false;
      if (window.MapaAlerts) {
        const alertsState = await window.MapaAlerts.init({
          // Manutenção detetada → bloqueia a API e limpa o mapa.
          onEnterOffline: () => {
            window.MapaApi.setOfflineMode(true);
            stopLoops();
            window.MapaRender.removeAllTrains();
            latestResult = { trainsForMap: [], trainsForList: [] };
          },
          // Botão "Mapa Offline" → revela o mapa offline (horários).
          onForceOffline: () => {
            window.MapaApi.setOfflineMode(true);
            fetchAndApply();
            startLoops();
          },
          // Fim da manutenção → retoma o modo ao vivo.
          onExitOffline: () => {
            window.MapaApi.setOfflineMode(false);
            fetchAndApply();
            startLoops();
          },
        });
        maintenanceActive = !!(alertsState && alertsState.maintenance);
      }

      // Primeiro fetch (saltado em manutenção — só após "Mapa Offline")
      if (!maintenanceActive) {
        await fetchAndApply();

        // ─── VERIFICAR URL HASH (Autofocus de Comboios) ───
        // Funciona para qualquer comboio (live, programado, extra)
        tryOpenFromHash();
      }

      if (loadingEl) {
        loadingEl.classList.add("opacity-0", "pointer-events-none");
        setTimeout(() => loadingEl.classList.add("hidden"), 400);
      }

      // Loops (só arrancam fora de manutenção)
      if (!maintenanceActive) startLoops();

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

  // ─── HASH CHANGE: permite navegar/partilhar links em runtime ────────
  window.addEventListener("hashchange", () => {
    tryOpenFromHash();
  });

  // ─── VISIBILIDADE: PAUSA/RESUME + HARD RELOAD APÓS LONGA AUSÊNCIA ────
  function onVisible() {
    const bgDurationMs = lastBackgroundTime
      ? Date.now() - lastBackgroundTime
      : 0;
    lastBackgroundTime = 0;

    if (bgDurationMs > 60 * 60 * 1000) {
      try {
        window.location.reload();
      } catch (_) {}
      return;
    }

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

  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      fetchAndApply();
      startLoops();
    }
  });
  window.addEventListener("focus", () => {
    if (!apiIntervalId || !posIntervalId) {
      fetchAndApply();
      startLoops();
    }
  });

  // ─── GO! ─────────────────────────────────────────────────────────────
  boot();
});

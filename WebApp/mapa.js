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

  // ─── MENU GLOBAL: BOTÃO DE FERRAMENTAS + PARTILHA passa para nav-tools.js

  // ─── LOOP DE POSIÇÃO ─────────────────────────────────────────────────

  function updateAllPositions() {
    if (!mapInstance || !window.MapaGeo || !window.MapaGeo.isInitialized())
      return;
    const zoom = mapInstance.getZoom();
    const now = new Date();

    const visibleIds = [];
    for (const train of latestResult.trainsForMap || []) {
      // A estimativa do /fertagus define SEMPRE o ciclo de vida do comboio
      // (quando aparece e quando termina). Calculamo-la primeiro.
      const est = window.MapaGeo.computeTrainPosition(train, now);

      // FIM DE VIAGEM = decidido pelo /fertagus (todos os nós com ComboioPassou).
      // Removemos o comboio mesmo que a TML ainda reporte a unidade parada no
      // terminus — é isto que evita o ponto "preso" no fim da viagem.
      if (est && est.segment === "done") continue;

      // Posição REAL (TML via /mapa) tem prioridade nas COORDENADAS enquanto a
      // viagem decorre; a estimativa é o fallback.
      // Passamos o nº de estações já passadas no /fertagus para o cross-check
      // que deteta GPS congelado (ver mapa-live.js).
      const passedCount = Array.isArray(train.nodes)
        ? train.nodes.reduce(
            (acc, n) => acc + (n && n.ComboioPassou ? 1 : 0),
            0,
          )
        : 0;
      const live =
        window.MapaLive && typeof window.MapaLive.getPosition === "function"
          ? window.MapaLive.getPosition(train.id, passedCount)
          : null;

      let pos;
      if (live) {
        // Força a posição GPS para CIMA da linha e orienta SEMPRE pela linha
        // (sentido de viagem) — evita coordenadas fora dos carris e setas
        // "lixadas" nas estações por causa do ruído do GPS.
        const snapped =
          typeof window.MapaGeo.snapToLine === "function"
            ? window.MapaGeo.snapToLine(live.lng, live.lat, train.direction)
            : null;

        const lng = snapped ? snapped.lng : live.lng;
        const lat = snapped ? snapped.lat : live.lat;
        const bearing = snapped
          ? snapped.bearing
          : est
            ? est.bearing
            : live.bearing != null
              ? live.bearing
              : 0;

        // segment "moving" garante render + animação suave: o mapa-render
        // faz lerp de startPos→targetPos ao longo de POSITION_UPDATE_MS.
        pos = {
          lng,
          lat,
          bearing,
          segment: "moving",
          progress: 0.5,
          isReal: true,
        };
      } else {
        pos = est;
        if (pos) pos.isReal = false;
      }

      if (!pos) continue;
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

  // ─── LOOP DE POSIÇÕES REAIS (TML via /mapa) ──────────────────────────
  // Atualiza o cache de localizações reais (mapa-live.js). O updateAllPositions
  // lê esse cache de forma síncrona: havendo posição real usa-a, senão cai na
  // estimativa. Em manutenção (modo offline forçado) não há posições reais.

  async function refreshLivePositions() {
    if (!window.MapaLive) return;
    if (window.MapaApi.isOfflineMode && window.MapaApi.isOfflineMode()) return;
    try {
      await window.MapaLive.refresh();
    } catch (e) {
      console.warn("[Mapa] refresh posições reais falhou:", e.message);
    }
  }

  // Tick único (5 s): primeiro refresca o GPS, SÓ DEPOIS retargeta os pontos.
  // Assim cada novo alvo da animação usa sempre dados frescos — evita ciclos
  // "alvo igual → ponto para → salto" e mantém o movimento contínuo.
  async function liveTick() {
    await refreshLivePositions();
    updateAllPositions();
  }

  // ─── INICIALIZAÇÃO DO MAPA ───────────────────────────────────────────

  async function initMap() {
    // O basemap (vetorial da OpenFreeMap, com plano B em raster) e o tema
    // claro/escuro são geridos pelo mapa-tema.js.
    mapInstance = new maplibregl.Map({
      container: "map",
      style: window.MapaTema.estiloInicial(),
      center: MAPA.CENTER,
      zoom: MAPA.ZOOM,
      minZoom: MAPA.MIN_ZOOM,
      maxZoom: MAPA.MAX_ZOOM,
      maxBounds: MAPA.MAX_BOUNDS,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchZoomRotate: true,
      // Mapa sempre plano: o estilo não tem 3D e assim o MapLibre nunca
      // desenha em perspetiva (mais tiles e mais trabalho por frame).
      maxPitch: 0,
    });
    mapInstance.touchZoomRotate.disableRotation();

    window.MapaRender.setMap(mapInstance);

    // No canto de baixo o MapLibre põe cada controlo novo POR CIMA dos
    // anteriores: o "i" entra primeiro para ficar por baixo do zoom.
    mapInstance.addControl(new InfoControl(), "bottom-right");

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

  // ─── ATRIBUIÇÃO NUM BOTÃO "i" ────────────────────────────────────────
  // As regras de atribuição da OSMF permitem recolher os créditos desde que
  // comecem visíveis e continuem a um toque de distância (o "(i)"). Por isso
  // o balão abre ao carregar e fecha à primeira interação com o mapa ou ao
  // fim de 5 s. O texto vem do #lt-atribuicao do mapa.html.
  class InfoControl {
    onAdd(map) {
      this._map = map;
      const box = document.createElement("div");
      box.className = "maplibregl-ctrl lt-info";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lt-info-btn";
      btn.setAttribute("aria-label", "Créditos do mapa e fontes dos dados");
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';

      let pop = document.getElementById("lt-atribuicao");
      if (!pop) {
        pop = document.createElement("div");
        pop.id = "lt-atribuicao";
        pop.className = "lt-info-pop";
        pop.setAttribute("role", "note");
        pop.innerHTML =
          '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · Dados Fertagus · Infraestruturas de Portugal';
      }
      pop.hidden = false;
      btn.setAttribute("aria-controls", pop.id);
      box.append(pop, btn);

      const abrir = (on) => {
        box.classList.toggle("is-open", on);
        btn.setAttribute("aria-expanded", on ? "true" : "false");
      };
      this._fechar = () => {
        clearTimeout(this._t);
        abrir(false);
      };
      this._tecla = (e) => {
        if (e.key === "Escape" && box.classList.contains("is-open"))
          this._fechar();
      };
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        clearTimeout(this._t);
        abrir(!box.classList.contains("is-open"));
      });
      map.on("movestart", this._fechar);
      map.on("click", this._fechar);
      document.addEventListener("keydown", this._tecla);

      abrir(true);
      this._t = setTimeout(this._fechar, 5000);
      this._box = box;
      return box;
    }

    onRemove() {
      clearTimeout(this._t);
      this._map.off("movestart", this._fechar);
      this._map.off("click", this._fechar);
      document.removeEventListener("keydown", this._tecla);
      this._box.remove();
    }
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

      if (window.MapaCM) window.MapaCM.init(mapInstance);

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
        await refreshLivePositions(); // NOVO: posições reais TML antes do 1º paint
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
    // Um só loop: refresca GPS e retargeta no mesmo tick (ver liveTick).
    if (!posIntervalId) {
      posIntervalId = setInterval(liveTick, MAPA.POSITION_UPDATE_MS);
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

    refreshLivePositions();
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
  boot();
});

/**
 * mapa-render.js
 * Renderização visual do mapa: linha da Fertagus, estações, comboios e
 * cartões de "trajeto restante" para o comboio focado.
 */

(function () {
  "use strict";

  // ─── ESTADO INTERNO ──────────────────────────────────────────────────
  const markers = new Map(); // trainId → entry
  const routeCardMarkers = new Map(); // stationKey → entry
  const routeEndMarkers = [];
  let clickHandler = null;
  let animationFrameId = null;

  let mainMap = null;
  let routeFocusTrainId = null;
  let routeFocusSignature = "";
  let routeFocusUserDetached = false; // user fez drag/wheel manualmente
  let isFlying = false;

  // Estações em cluster denso (norte) — precisam de slot system.
  const NORTH_CLUSTER = new Set([
    "campolide",
    "sete_rios",
    "entrecampos",
    "roma_areeiro",
  ]);

  const IMPORTANT_STATIONS = new Set([
    "sete_rios",
    "entrecampos",
    "pragal",
    "corroios",
    "coina",
    "pinhal_novo",
    "palmela",
  ]);
  let lastZoomStateWasDetailed = false;

  let userOriginKey = null;
  let userDestKey = null;

  // Função para injetar o filtro que vem do link
  function setUserRouteFilter(origin, dest) {
    userOriginKey = origin;
    userDestKey = dest;
  }

  // ─── HELPERS ─────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function getModalState() {
    if (
      window.MapaDetails &&
      typeof window.MapaDetails.getModalState === "function"
    ) {
      return window.MapaDetails.getModalState();
    }
    if (window.MapaDetails && window.MapaDetails.isOpen()) return "mini";
    if (window.MapaStation && window.MapaStation.isOpen()) return "station";
    return "closed";
  }

  // ─── CÂMERA: PADDING POR ESTADO DO MODAL ─────────────────────────────

  function getRouteFocusPadding() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const isMobile = w < 768;
    const state = getModalState();

    if (isMobile) {
      // Aumentamos o padding do topo para compensar o menu global
      // e a altura do próprio marcador quando fazemos zoom
      const topPad = 130;

      if (state === "expanded") {
        const visibleTop = Math.max(topPad, h * 0.12);
        return {
          top: visibleTop,
          bottom: Math.round(h * 0.85),
          left: 40,
          right: 40,
        };
      }

      if (state === "mini" || state === "station") {
        // Garantimos um mínimo de píxeis (350px ou 400px) para que
        // a margem nunca seja menor do que a altura mínima do painel (320px)
        const bottomPad =
          state === "station"
            ? Math.max(400, Math.round(h * 0.55))
            : Math.max(350, Math.round(h * 0.45));

        return {
          top: topPad,
          bottom: bottomPad,
          left: 40,
          right: 40,
        };
      }

      return { top: topPad, bottom: 120, left: 40, right: 40 };
    }

    // Desktop
    if (state === "mini" || state === "expanded" || state === "station") {
      return { top: 120, bottom: 120, left: 100, right: 500 };
    }
    return { top: 120, bottom: 120, left: 100, right: 100 };
  }

  // ─── CÂMERA: FOCO NO TRAJECTO RESTANTE ───────────────────────────────

  function trainById(id) {
    const entry = markers.get(id);
    return entry ? entry.train : null;
  }

  function remainingNodes(train) {
    return (train && train.nodes ? train.nodes : []).filter(
      (n) => !n.ComboioPassou,
    );
  }

  function applyRouteFocus(train, opts) {
    if (!train || !mainMap) return;
    if (typeof maplibregl === "undefined") return;
    const subtle = opts && opts.subtle;
    const pos = window.MapaGeo
      ? window.MapaGeo.computeTrainPosition(train, new Date())
      : null;
    if (!pos) return;
    let remaining = remainingNodes(train);
    if (remaining.length === 0) return;

    // Quando há filtro de rota do utilizador, limita o enquadramento
    // entre a posição actual do comboio e a estação de destino do user
    // (não o destino final do comboio).
    if (userDestKey) {
      const destIdx = remaining.findIndex((n) => {
        const st = MAPA.resolveStationByApiId(n.EstacaoID);
        return st && st.key === userDestKey;
      });
      if (destIdx !== -1) {
        remaining = remaining.slice(0, destIdx + 1);
      }
    }

    const bounds = new maplibregl.LngLatBounds(
      [pos.lng, pos.lat],
      [pos.lng, pos.lat],
    );
    for (const node of remaining) {
      const st = MAPA.resolveStationByApiId(node.EstacaoID);
      if (st) bounds.extend([st.lng, st.lat]);
    }

    const padding = getRouteFocusPadding();
    const duration = subtle ? 700 : MAPA.ROUTE_FOCUS_DURATION_MS;

    isFlying = true;
    try {
      mainMap.fitBounds(bounds, {
        padding,
        duration,
        maxZoom: MAPA.ROUTE_FOCUS_MAX_ZOOM,
        essential: true,
        linear: false,
      });
    } catch (e) {
      console.warn("[MapaRender] fitBounds falhou:", e.message);
    }
    mainMap.once("moveend", () => {
      isFlying = false;
    });
  }

  function recomputeRouteFocusIfNeeded(train) {
    if (!train || routeFocusTrainId !== train.id) return;
    if (routeFocusUserDetached) return;
    const remaining = remainingNodes(train);
    const sig = remaining.map((n) => n.EstacaoID).join(",");
    const changed = sig !== routeFocusSignature;
    routeFocusSignature = sig;
    if (remaining.length === 0) return;
    // Mudou o conjunto de estações (passou uma) → reaplica com mais ênfase
    applyRouteFocus(train, { subtle: !changed });
  }

  function updateFocusClasses() {
    for (const entry of markers.values()) {
      entry.el.classList.toggle(
        "is-focused",
        routeFocusTrainId === entry.train.id,
      );
    }
  }

  function startRouteFocus(train) {
    if (!train || !mainMap) return;
    routeFocusTrainId = train.id;
    routeFocusSignature = "";
    routeFocusUserDetached = false;
    drawRouteStationCards(train);
    applyRouteFocus(train, { subtle: false });
    try {
      window.history.replaceState(null, null, "#" + train.id);
    } catch (_) {}
    updateFocusClasses();
  }

  function endRouteFocus() {
    routeFocusTrainId = null;
    userOriginKey = null;
    userDestKey = null;
    routeFocusSignature = "";
    routeFocusUserDetached = false;
    clearRouteStationCards();
    try {
      window.history.replaceState(
        null,
        null,
        window.location.pathname + window.location.search,
      );
    } catch (_) {}
    updateFocusClasses();
  }

  function isRouteFocused() {
    return routeFocusTrainId != null;
  }

  function recenterTracking() {
    // Quando um modal fecha mas há um comboio focado, refaz o
    // enquadramento com o novo padding (sem modal).
    if (!mainMap) return;
    if (routeFocusTrainId) {
      const t = trainById(routeFocusTrainId);
      if (t) {
        applyRouteFocus(t, { subtle: true });
      }
    } else {
      // Sem comboio focado → mostra toda a linha
      showWholeLine({ duration: 500 });
    }
  }

  function showWholeLine(opts) {
    if (!mainMap || typeof maplibregl === "undefined") return;
    const bounds = new maplibregl.LngLatBounds(
      [MAPA.STATIONS[0].lng, MAPA.STATIONS[0].lat],
      [MAPA.STATIONS[0].lng, MAPA.STATIONS[0].lat],
    );
    for (const s of MAPA.STATIONS) bounds.extend([s.lng, s.lat]);
    try {
      mainMap.fitBounds(bounds, {
        padding: { top: 80, bottom: 80, left: 50, right: 50 },
        duration: (opts && opts.duration) || 700,
        maxZoom: 11.5,
        essential: true,
      });
    } catch (_) {}
  }

  function focusStation(station) {
    // Limpa qualquer focus em comboio para evitar conflitos visuais.
    if (routeFocusTrainId) endRouteFocus();
    if (!mainMap || !station) return;
    isFlying = true;
    mainMap.flyTo({
      center: [station.lng, station.lat],
      zoom: Math.max(mainMap.getZoom(), 14.5),
      offset: getStationFocusOffset(),
      speed: 1.1,
      essential: true,
    });
    mainMap.once("moveend", () => {
      isFlying = false;
    });
  }

  function getStationFocusOffset() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w < 768) {
      // Estação ligeiramente para cima do centro para deixar espaço ao modal
      return [0, -h * 0.18];
    }
    return [-180, 0]; // empurra centro à esquerda do modal lateral
  }

  // ─── BACKWARD-COMPAT API ─────────────────────────────────────────────
  //
  // startTracking(id), startTrackingTrain(id), stopTracking() continuam
  // a existir e mapeiam para o novo modelo.

  function startTracking(id) {
    const t = trainById(id);
    if (t) startRouteFocus(t);
  }

  function startTrackingTrain(id) {
    return startTracking(id);
  }

  function stopTracking() {
    endRouteFocus();
  }

  // ─── ANIMAÇÃO SUAVE DOS MARKERS ──────────────────────────────────────

  function animateMarkers(time) {
    for (const entry of markers.values()) {
      if (entry.startPos && entry.targetPos) {
        let t = (time - entry.animationStartTime) / MAPA.POSITION_UPDATE_MS;
        if (t > 1) t = 1;
        const lng = lerp(entry.startPos.lng, entry.targetPos.lng, t);
        const lat = lerp(entry.startPos.lat, entry.targetPos.lat, t);
        entry.marker.setLngLat([lng, lat]);
      }
    }
    animationFrameId = requestAnimationFrame(animateMarkers);
  }

  // ─── HELPERS DE ESTILO ───────────────────────────────────────────────

  function carriageFillColor(train) {
    const c = MAPA.OCCUPANCY_COLORS;
    if (train.isOffline && train.occupancy == null) return c.offline;
    if (train.occupancy == null) return c.default;
    if (train.occupancy === 0) return c.empty;
    if (train.occupancy <= 50) return c.low;
    if (train.occupancy <= 85) return c.medium;
    return c.high;
  }

  function filledCarriages(train) {
    if (train.occupancy == null) return train.carriages;
    return Math.round((train.occupancy / 100) * train.carriages);
  }

  function ringColor(train) {
    return MAPA.STATUS_COLORS[train.dotStatus] || MAPA.STATUS_COLORS.gray;
  }

  function isPulsing(train) {
    return train.dotStatus === "orange" || train.dotStatus === "red";
  }

  function isAtRest(position) {
    if (!position) return true;
    return position.segment === "boarding" || position.segment === "before";
  }

  // ─── LINHA DA FERTAGUS ────────────────────────────────────────────────

  function drawLine(map, geojson) {
    if (!geojson) return;
    if (!map.getSource("fertagus-line")) {
      map.addSource("fertagus-line", { type: "geojson", data: geojson });
    }
    if (!map.getLayer("fertagus-line-casing")) {
      map.addLayer({
        id: "fertagus-line-casing",
        type: "line",
        source: "fertagus-line",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#1e293b",
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3, 16, 10],
          "line-opacity": 0.35,
        },
      });
    }
    if (!map.getLayer("fertagus-line")) {
      map.addLayer({
        id: "fertagus-line",
        type: "line",
        source: "fertagus-line",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#000000",
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.5, 16, 5],
          "line-opacity": 0.95,
        },
      });
    }
  }

  // ─── ESTAÇÕES (pontos + labels) ──────────────────────────────────────

  function drawStations(map, stops) {
    if (!stops) return;
    const features = stops.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.c[1], s.c[0]] },
      properties: { id: s.id, name: s.n },
    }));
    if (!map.getSource("fertagus-stations")) {
      map.addSource("fertagus-stations", {
        type: "geojson",
        data: { type: "FeatureCollection", features },
      });
    }
    if (!map.getLayer("fertagus-stations-layer")) {
      map.addLayer({
        id: "fertagus-stations-layer",
        type: "circle",
        source: "fertagus-stations",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            4,
            12,
            6,
            15,
            9,
            17,
            13,
          ],
          "circle-color": "#ffffff",
          "circle-stroke-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            1.5,
            15,
            2.5,
          ],
          "circle-stroke-color": "#0f172a",
        },
      });
    }
    if (!map.getLayer("fertagus-stations-labels")) {
      map.addLayer({
        id: "fertagus-stations-labels",
        type: "symbol",
        source: "fertagus-stations",
        minzoom: 11,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 16, 14],
          "text-offset": [0, 1.2],
          "text-anchor": "center",
          "text-letter-spacing": 0.05,
          "text-transform": "uppercase",
        },
        paint: {
          "text-color": "#0f172a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 2,
          "text-halo-blur": 0.5,
        },
      });
    }

    map.on("click", "fertagus-stations-layer", (e) => {
      const f = e.features && e.features[0];
      if (!f) return;
      const station = MAPA.STATIONS.find(
        (s) => s.name === f.properties.name || s.apiName === f.properties.name,
      );
      if (station && window.MapaStation) {
        window.MapaStation.open(station);
      }
    });
    map.on("mouseenter", "fertagus-stations-layer", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "fertagus-stations-layer", () => {
      map.getCanvas().style.cursor = "";
    });
  }

  // ─── CARTÕES DE ESTAÇÃO NO TRAJECTO ──────────────────────────────────

  function computeNodeDelayMin(node) {
    if (!node || !window.MapaGeo) return null;
    const prog = window.MapaGeo.parseTimeHHMMSS(node.HoraProgramada);
    const prev = window.MapaGeo.parseTimeHHMMSS(node.HoraPrevista);
    if (!prog || !prev) return null;
    return Math.floor((prev.getTime() - prog.getTime()) / 60000);
  }

  function nodeTimeString(node) {
    if (!node) return "--:--";
    const prev = (node.HoraPrevista || "").substring(0, 5);
    const prog = (node.HoraProgramada || "").substring(0, 5);
    if (prev && !prev.startsWith("HH")) return prev;
    if (prog && !prog.startsWith("HH")) return prog;
    return "--:--";
  }

  function offsetForCard(stationKey, idxInCluster, totalInCluster) {
    // Estações distantes → posicionar acima da estação.
    if (!NORTH_CLUSTER.has(stationKey)) return [0, -10];

    // Cluster norte: spread em 4 quadrantes
    const slot = idxInCluster % 4;
    const offsets = [
      [-58, -14],
      [58, -14],
      [-58, 30],
      [58, 30],
    ];
    return offsets[slot];
  }

  // Resolver problema de cartões sobre estações futuras

  function buildStationCardHtml(station, timeStr, delayMin, isDestination) {
    const onTime = delayMin == null || delayMin < 1;
    const ringHex = onTime ? "#10b981" : "#f59e0b";
    const ringRgb = onTime ? "16,185,129" : "245,158,11";
    const delayBadge = !onTime
      ? `<span class="rsc-delay">+${delayMin}m</span>`
      : `<span class="rsc-ontime">A horas</span>`;

    const destTag = isDestination
      ? `<span class="rsc-dest" aria-label="Destino"></span>`
      : "";
    return `
      <div class="rsc-pill" data-station-key="${escapeHtml(station.key)}"
           style="--rsc-ring:${ringHex}; --rsc-glow:rgba(${ringRgb},.35);">
        ${destTag}
        <div class="rsc-row1">
          <span class="rsc-name">${escapeHtml(station.name)}</span>
          <span class="rsc-time">${escapeHtml(timeStr)}</span>
        </div>
        <div class="rsc-row2">${delayBadge}</div>
      </div>`;
  }

  function drawRouteStationCards(train) {
    clearRouteStationCards();
    if (!train || !mainMap || typeof maplibregl === "undefined") return;
    const allRemaining = remainingNodes(train);
    if (allRemaining.length === 0) return;
    let remaining = [];

    // 3. A LÓGICA DO FILTRO:
    // Se o userOriginKey e userDestKey existirem (vieram do link),
    // filtramos TODOS os nós do comboio (mesmo os que já passaram) para mostrar só estes dois.
    if (userOriginKey && userDestKey) {
      // PRIORIDADE 1: LINK (Mostra apenas as duas escolhidas)
      remaining = train.nodes.filter((node) => {
        const st = MAPA.resolveStationByApiId(node.EstacaoID);
        return st && (st.key === userOriginKey || st.key === userDestKey);
      });
    } else {
      // PRIORIDADE 2: NAVEGAÇÃO NORMAL (Respeita o Zoom)
      const currentZoom = mainMap.getZoom();
      lastZoomStateWasDetailed = currentZoom >= 10.8; // O nosso limite de zoom

      remaining = allRemaining.filter((node, idx) => {
        const isDestination = idx === allRemaining.length - 1;
        // Mostra se: for o destino final OR houver zoom suficiente OR for estação importante
        if (isDestination || lastZoomStateWasDetailed) return true;

        const st = MAPA.resolveStationByApiId(node.EstacaoID);
        return st && IMPORTANT_STATIONS.has(st.key);
      });
    }

    if (remaining.length === 0) return;
    let clusterIdx = 0;
    const clusterCount = remaining.filter((n) => {
      const st = MAPA.resolveStationByApiId(n.EstacaoID);
      return st && NORTH_CLUSTER.has(st.key);
    }).length;

    const lastNode = remaining[remaining.length - 1];

    remaining.forEach((node) => {
      const st = MAPA.resolveStationByApiId(node.EstacaoID);
      if (!st) return;
      const inCluster = NORTH_CLUSTER.has(st.key);
      const idx = inCluster ? clusterIdx++ : 0;

      const delayMin = computeNodeDelayMin(node);
      const timeStr = nodeTimeString(node);
      const isDestination = node === lastNode;

      const el = document.createElement("div");
      el.className = ""; // estacao removida
      el.innerHTML = buildStationCardHtml(st, timeStr, delayMin, isDestination);

      const offset = offsetForCard(st.key, idx, clusterCount);
      const m = new maplibregl.Marker({
        element: el,
        anchor: "bottom-right",
        offset: [0, -10],
      })
        .setLngLat([st.lng, st.lat])
        .addTo(mainMap);

      routeCardMarkers.set(st.key, { marker: m, el, station: st, node });
    });
  }

  function updateRouteStationCards(train) {
    if (!train) return;

    let remaining = [];
    if (userOriginKey && userDestKey) {
      remaining = train.nodes.filter((node) => {
        const st = MAPA.resolveStationByApiId(node.EstacaoID);
        return st && (st.key === userOriginKey || st.key === userDestKey);
      });
    } else {
      const allRemaining = remainingNodes(train);
      remaining = allRemaining.filter((node, idx) => {
        const isDestination = idx === allRemaining.length - 1;
        if (isDestination || lastZoomStateWasDetailed) return true;
        const st = MAPA.resolveStationByApiId(node.EstacaoID);
        return st && IMPORTANT_STATIONS.has(st.key);
      });
    }

    const remainingKeys = new Set();
    for (const node of remaining) {
      const st = MAPA.resolveStationByApiId(node.EstacaoID);
      if (!st) continue;
      remainingKeys.add(st.key);
      const entry = routeCardMarkers.get(st.key);
      if (!entry) continue;
      const delayMin = computeNodeDelayMin(node);
      const timeStr = nodeTimeString(node);
      const isDestination = node === remaining[remaining.length - 1];
      entry.el.innerHTML = buildStationCardHtml(
        entry.station,
        timeStr,
        delayMin,
        isDestination,
      );
      entry.node = node;
    }
    // Remove cards de estações já passadas
    for (const [key, entry] of Array.from(routeCardMarkers.entries())) {
      if (!remainingKeys.has(key)) {
        try {
          entry.marker.remove();
        } catch (_) {}
        routeCardMarkers.delete(key);
      }
    }
  }

  function clearRouteStationCards() {
    for (const e of routeCardMarkers.values()) {
      try {
        e.marker.remove();
      } catch (_) {}
    }
    routeCardMarkers.clear();
  }

  // ─── MARKER DOS COMBOIOS ─────────────────────────────────────────────

  function buildMarkerHtml(train) {
    const carCount = train.carriages || 4;
    const filled = filledCarriages(train);
    const fill = carriageFillColor(train);
    const ring = ringColor(train);

    const carriagesHtml = [];
    for (let i = 0; i < carCount; i++) {
      const active = i < filled;
      const bg = active ? fill : "var(--car-empty, #3f3f46)";
      const bc = active ? fill : "var(--car-empty, #3f3f46)";
      carriagesHtml.push(
        `<div class="train-carriage" data-active="${active ? "1" : "0"}"
               style="background-color:${bg}; border-color:${bc};"></div>`,
      );
    }

    const wifiHtml = `
      <svg class="train-wifi" viewBox="0 0 24 18" xmlns="http://www.w3.org/2000/svg"
           style="--wifi-color:${ring};">
        <path class="wifi-arc wifi-arc-3" d="M3 11 Q 12 -1 21 11" />
        <path class="wifi-arc wifi-arc-2" d="M6 13 Q 12 5 18 13" />
        <path class="wifi-arc wifi-arc-1" d="M9 15 Q 12 11 15 15" />
        <circle class="wifi-dot" cx="12" cy="17" r="1.1" />
      </svg>`;

    const frontSvg = `
      <img src="./imagens/front_fertagus.svg" class="train-front-img" alt="" aria-hidden="true"
           data-front-img="1" />
    `;

    const arrowSvg = `
      <svg class="train-arrow-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <polygon points="6,3 21,12 6,21" fill="${ring}"
                 stroke="white" stroke-width="1.8" stroke-linejoin="round" />
      </svg>`;

    return `
      <div class="train-view train-view-icon ${isPulsing(train) ? "pulse" : ""}"
           style="--ring-color:${ring}; --ring-glow:${ring}55;">
        <div class="train-icon-disc">
          <div class="train-ring"></div>
          <div class="train-front">${frontSvg}</div>
        </div>
        <div class="train-arrow" data-at-rest="0">
          ${arrowSvg}
        </div>
      </div>

      <div class="train-view train-view-cars ${isPulsing(train) ? "pulse" : ""}"
           style="--ring-color:${ring};">
        <div class="train-cars-body">
          <div class="train-wifi-badge">${wifiHtml}</div>
          <div class="train-cars-wrapper" data-car-count="${carCount}">
            ${carriagesHtml.join("")}
          </div>
        </div>
      </div>
    `;
  }

  function updateMarkerStyle(entry, train) {
    const el = entry.el;
    const ring = ringColor(train);
    const fill = carriageFillColor(train);
    const filled = filledCarriages(train);

    const iconView = el.querySelector(".train-view-icon");
    const carsView = el.querySelector(".train-view-cars");
    if (iconView) {
      iconView.style.setProperty("--ring-color", ring);
      iconView.style.setProperty("--ring-glow", ring + "55");
      const poly = iconView.querySelector(".train-arrow-svg polygon");
      if (poly) poly.setAttribute("fill", ring);
    }
    if (carsView) {
      carsView.style.setProperty("--ring-color", ring);
      const wifi = carsView.querySelector(".train-wifi");
      if (wifi) wifi.style.setProperty("--wifi-color", ring);
    }

    const carriageEls = el.querySelectorAll(".train-carriage");
    const carCount = train.carriages || 4;
    if (carriageEls.length !== carCount) {
      el.innerHTML = buildMarkerHtml(train);
      ensureFrontFallback(el);
      return;
    }
    carriageEls.forEach((c, i) => {
      const active = i < filled;
      c.dataset.active = active ? "1" : "0";
      c.style.backgroundColor = active ? fill : "";
      c.style.borderColor = active ? fill : "";
    });

    iconView.classList.toggle("pulse", isPulsing(train));
    carsView.classList.toggle("pulse", isPulsing(train));
  }

  /**
   * Liga onerror em JS (em vez de inline) para cumprir CSP.
   */
  function ensureFrontFallback(el) {
    const img = el.querySelector('[data-front-img="1"]');
    if (!img) return;
    img.addEventListener("error", () => {
      const span = document.createElement("span");
      span.className = "train-front-fallback";
      img.replaceWith(span);
    });
  }

  function scaleCarriagesToRealWorld(entry, zoom) {
    if (zoom < MAPA.ZOOM_DETAIL_CUTOFF || !entry.map) return;

    const train = entry.train;
    const carCount = train.carriages || 4;

    const carLengthMeters = 50;
    const carWidthMeters = 10;

    const coords = entry.marker.getLngLat();
    const metersPerPixel =
      (156543.03392 * Math.cos((coords.lat * Math.PI) / 180)) /
      Math.pow(2, zoom);
    const pixelsPerMeter = 1 / metersPerPixel;

    let carLengthPx = carLengthMeters * pixelsPerMeter;
    let carWidthPx = carWidthMeters * pixelsPerMeter;

    carLengthPx = Math.max(carLengthPx, 8);
    carWidthPx = Math.max(carWidthPx, 6);

    const wrapper = entry.el.querySelector(".train-cars-wrapper");
    if (wrapper) {
      const gapPx = Math.max(1, 0.8 * pixelsPerMeter);
      wrapper.style.gap = `${gapPx}px`;
      wrapper.style.padding = "0";
      wrapper.style.width = `${carWidthPx}px`;
    }

    const carriages = entry.el.querySelectorAll(".train-carriage");
    carriages.forEach((c) => {
      c.style.height = `${carLengthPx}px`;
      c.style.width = "100%";
      c.style.flex = "0 0 auto";
    });
  }

  function applyRotation(entry, bearing) {
    const arrow = entry.el.querySelector(".train-arrow");
    const body = entry.el.querySelector(".train-cars-body");

    if (arrow) {
      arrow.style.transform = `translate(-50%, -50%) rotate(${bearing - 90}deg) translateX(30px)`;
    }
    if (body) {
      body.style.transform = `translate(-50%, -50%) rotate(${bearing}deg)`;
    }
  }

  function applyViewState(entry, zoom, position) {
    const isDetail = zoom >= MAPA.ZOOM_DETAIL_CUTOFF;
    entry.el.dataset.view = isDetail ? "cars" : "icon";

    const atRest = isAtRest(position);
    const arrow = entry.el.querySelector(".train-arrow");
    if (arrow) arrow.dataset.atRest = atRest ? "1" : "0";
  }

  // ─── API PÚBLICA: MARKERS ────────────────────────────────────────────

  function upsertTrain(map, train, position, zoom) {
    if (!position) return;
    let entry = markers.get(train.id);
    const now = performance.now();

    if (!entry) {
      const el = document.createElement("div");
      el.className = "train-marker";
      el.innerHTML = buildMarkerHtml(train);
      ensureFrontFallback(el);

      const onPress = (e) => {
        e.stopPropagation();
        userOriginKey = null;
        userDestKey = null;
        if (typeof clickHandler === "function") {
          const currentEntry = markers.get(train.id);
          const freshTrain = currentEntry ? currentEntry.train : train;
          clickHandler(freshTrain);
        }
      };
      el.addEventListener("click", onPress);

      const marker = new maplibregl.Marker({
        element: el,
        anchor: "center",
        rotationAlignment: "map",
        pitchAlignment: "map",
      })
        .setLngLat([position.lng, position.lat])
        .addTo(map);

      entry = {
        marker,
        el,
        train,
        bearing: position.bearing || 0,
        map,
        startPos: { lng: position.lng, lat: position.lat },
        targetPos: { lng: position.lng, lat: position.lat },
        animationStartTime: now,
      };
      markers.set(train.id, entry);

      applyViewState(entry, zoom, position);
      applyRotation(entry, position.bearing || 0);
      scaleCarriagesToRealWorld(entry, zoom);

      if (!animationFrameId) {
        animationFrameId = requestAnimationFrame(animateMarkers);
      }

      // Se este é o comboio focado, atualiza cards e foco
      if (routeFocusTrainId === train.id) {
        drawRouteStationCards(train);
        recomputeRouteFocusIfNeeded(train);
      }

      entry.el.classList.toggle("is-focused", routeFocusTrainId === train.id);
      return;
    }

    entry.map = map;
    const currentVisualPos = entry.marker.getLngLat();
    entry.startPos = { lng: currentVisualPos.lng, lat: currentVisualPos.lat };
    entry.targetPos = { lng: position.lng, lat: position.lat };
    entry.animationStartTime = now;

    const newBearing = position.bearing || 0;
    const delta = Math.abs(((newBearing - entry.bearing + 540) % 360) - 180);
    if (delta > 3) {
      applyRotation(entry, newBearing);
      entry.bearing = newBearing;
    }

    if (
      entry.train.dotStatus !== train.dotStatus ||
      entry.train.occupancy !== train.occupancy ||
      entry.train.carriages !== train.carriages ||
      entry.train.isOffline !== train.isOffline
    ) {
      updateMarkerStyle(entry, train);
    }
    entry.train = train;

    applyViewState(entry, zoom, position);
    scaleCarriagesToRealWorld(entry, zoom);

    if (routeFocusTrainId === train.id) {
      updateRouteStationCards(train);
      recomputeRouteFocusIfNeeded(train);
    }
  }

  function onZoomChange(zoom) {
    for (const entry of markers.values()) {
      applyViewState(entry, zoom, null);
      scaleCarriagesToRealWorld(entry, zoom);
    }
    const isDetailed = zoom >= 10.8;
    // Só recalculamos os cartões se o utilizador cruzou a linha de zoom (para não sobrecarregar o browser)
    if (routeFocusTrainId && isDetailed !== lastZoomStateWasDetailed) {
      lastZoomStateWasDetailed = isDetailed;
      const t = trainById(routeFocusTrainId);
      if (t) drawRouteStationCards(t); // Redesenha magicamente as estações em falta!
    }
  }

  function removeTrain(trainId) {
    const entry = markers.get(trainId);
    if (!entry) return;
    try {
      entry.marker.remove();
    } catch (_) {}
    markers.delete(trainId);
  }

  function removeMissingTrains(currentIds) {
    const keep = new Set(currentIds);
    for (const id of Array.from(markers.keys())) {
      if (!keep.has(id)) removeTrain(id);
    }
  }

  function removeAllTrains() {
    for (const id of Array.from(markers.keys())) removeTrain(id);
  }

  function setClickHandler(fn) {
    clickHandler = fn;
  }

  function getMarkers() {
    return markers;
  }

  // ─── INTERAÇÃO MANUAL DO USER COM O MAPA ─────────────────────────────
  function setMap(mapInstance) {
    mainMap = mapInstance;
    const detachIfUser = (e) => {
      if (!routeFocusTrainId) return;
      if (isFlying) return; // movimento causado pelo nosso fitBounds
      if (e && e.originalEvent) {
        routeFocusUserDetached = true;
      }
    };
    mainMap.on("dragstart", detachIfUser);
    mainMap.on("touchstart", detachIfUser);
    mainMap.on("wheel", detachIfUser);
  }

  // ─── EXPORT ──────────────────────────────────────────────────────────
  window.MapaRender = {
    setMap,
    // Novo modelo
    startRouteFocus,
    endRouteFocus,
    isRouteFocused,
    drawRouteStationCards,
    updateRouteStationCards,
    clearRouteStationCards,
    showWholeLine,
    setUserRouteFilter,
    // Compat
    startTracking,
    startTrackingTrain,
    stopTracking,
    focusStation,
    recenterTracking,
    // Render
    drawLine,
    drawStations,
    upsertTrain,
    removeTrain,
    removeMissingTrains,
    removeAllTrains,
    onZoomChange,
    setClickHandler,
    getMarkers,
    _ringColor: ringColor,
    _carriageFillColor: carriageFillColor,
    _filledCarriages: filledCarriages,
  };
})();

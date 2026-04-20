/**
 * mapa-render.js
 * Renderização visual do mapa: linha da Fertagus, estações e comboios.
 */

(function () {
  "use strict";

  const markers = new Map(); // trainId → entry
  let clickHandler = null;
  let animationFrameId = null;

  // ─── ANIMAÇÃO SUAVE (LERP) ───────────────────────────────────────────

  // Variáveis para a Câmera
  let mainMap = null;
  let trackedTrainId = null;
  let isFlying = false;
  let flyToTimeout = null;

  function getDynamicOffset() {
    const isMobile = window.innerWidth < 768;
    let isModalOpen = false;

    if (window.MapaDetails && window.MapaDetails.isOpen()) isModalOpen = true;
    if (window.MapaStation && window.MapaStation.isOpen()) isModalOpen = true;

    if (isMobile && isModalOpen) {
      // Empurra o centro do mapa para baixo, fazendo o comboio subir (fuga ao modal)
      return [0, window.innerHeight * 0.28];
    }
    if (!isMobile && isModalOpen) {
      // Empurra o centro para a direita (fuga ao modal lateral)
      return [220, 0];
    }
    return [0, 0];
  }

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

    // ─── TRACKING DA CÂMARA ───
    if (trackedTrainId && !isFlying && mainMap) {
      const entry = markers.get(trackedTrainId);
      if (entry) {
        const coords = entry.marker.getLngLat();
        mainMap.jumpTo({
          center: [coords.lng, coords.lat],
          offset: getDynamicOffset(),
        });
      }
    }
    animationFrameId = requestAnimationFrame(animateMarkers);
  }

  function getDynamicOffset() {
    const isMobile = window.innerWidth < 768;
    const isModalOpen =
      (window.MapaDetails && window.MapaDetails.isOpen()) ||
      (window.MapaStation && window.MapaStation.isOpen());

    if (isMobile && isModalOpen) {
      // Telemóvel: comboio no topo (empurramos o centro do mapa para baixo)
      return [0, window.innerHeight * 0.28];
    }
    if (!isMobile && isModalOpen) {
      // PC: compensa a largura do painel lateral (440px)
      return [180, 0];
    }
    return [0, 0];
  }

  function setMap(mapInstance) {
    mainMap = mapInstance;
    // Pára o tracking se o utilizador interagir manualmente com o mapa
    const stopTrack = () => {
      if (trackedTrainId) stopTracking();
    };
    mainMap.on("dragstart", stopTrack);
    mainMap.on("wheel", stopTrack);
    mainMap.on("touchstart", stopTrack);
  }

  function startTracking(id) {
    trackedTrainId = id;
    window.history.replaceState(null, null, "#" + id); // Atualiza URL
    const entry = markers.get(id);
    if (entry && mainMap) {
      isFlying = true;
      mainMap.flyTo({
        center: entry.marker.getLngLat(),
        zoom: Math.max(mainMap.getZoom(), 15),
        offset: getDynamicOffset(),
        speed: 1.2,
      });
      mainMap.once("moveend", () => {
        isFlying = false;
      });
    }
  }

  function stopTracking() {
    trackedTrainId = null;
    window.history.replaceState(null, null, window.location.pathname); // Limpa URL
  }

  function recenterTracking() {
    if (trackedTrainId && mainMap) {
      isFlying = true;
      mainMap.easeTo({ offset: [0, 0], duration: 400 });
      mainMap.once("moveend", () => {
        isFlying = false;
      });
    }
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

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

  /** Cor de preenchimento das carruagens (idêntica à app). */
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

  /** True quando queremos pulse (atenção). */
  function isPulsing(train) {
    return train.dotStatus === "orange" || train.dotStatus === "red";
  }

  /** True quando o comboio está parado numa estação. */
  function isAtRest(position) {
    if (!position) return true;
    return position.segment === "boarding" || position.segment === "before";
  }

  // ─── DESENHAR A LINHA DA FERTAGUS ────────────────────────────────────

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

  // ─── DESENHAR AS ESTAÇÕES ────────────────────────────────────────────

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

    // Click → modal da estação (se registado). Hover muda cursor.
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

  // ─── CONSTRUÇÃO DO MARKER ────────────────────────────────────────────
  //
  // Estrutura do DOM de um marker:
  //   .train-marker                (wrapper; recebe data-view/at-rest)
  //     .train-view-icon           (zoom-out)
  //       .train-ring + .train-front (disco + imagem direita)
  //       .train-arrow              (seta play rotacionada)
  //     .train-view-cars           (zoom-in)
  //       .train-cars-body         (roda pelo bearing; contém WiFi + carruagens)
  //         .train-wifi-badge      (na frente do comboio)
  //         .train-cars-wrapper    (flex column: carruagens)
  //           .train-carriage × N

  function buildMarkerHtml(train) {
    const carCount = train.carriages || 4;
    const filled = filledCarriages(train);
    const fill = carriageFillColor(train);
    const ring = ringColor(train);

    // ─── Carruagens (elementos individuais, flex-column) ─────────────
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

    // ─── WiFi badge (na frente da composição) ─────────────────────────
    const wifiHtml = `
      <svg class="train-wifi" viewBox="0 0 24 18" xmlns="http://www.w3.org/2000/svg"
           style="--wifi-color:${ring};">
        <path class="wifi-arc wifi-arc-3" d="M3 11 Q 12 -1 21 11" />
        <path class="wifi-arc wifi-arc-2" d="M6 13 Q 12 5 18 13" />
        <path class="wifi-arc wifi-arc-1" d="M9 15 Q 12 11 15 15" />
        <circle class="wifi-dot" cx="12" cy="17" r="1.1" />
      </svg>`;

    // ─── Frente do comboio (imagem; fallback para bloco simples) ─────
    const frontSvg = `
      <img src="./imagens/front_fertagus.svg" class="train-front-img" alt="" aria-hidden="true"
           onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'train-front-fallback'}))" />
    `;

    // ─── Seta "play" (lucide) para a direção ─────────────────────────
    // Preenchida com a cor do ring, contorno ligeiramente mais escuro/claro
    // para contraste com o mapa.
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

  /**
   * Atualiza cores/ocupação/pulse sem refazer todo o HTML.
   */
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
      // Refaz tudo se a composição mudou (raro)
      el.innerHTML = buildMarkerHtml(train);
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
   * Escala as carruagens para as dimensões reais (26 m × 3.2 m cada).
   */
  function scaleCarriagesToRealWorld(entry, zoom) {
    if (zoom < MAPA.ZOOM_DETAIL_CUTOFF || !entry.map) return;

    const train = entry.train;
    const carCount = train.carriages || 4;

    // Cada carruagem: 26 m comprimento × 3.2 m largura
    const carLengthMeters = 50;
    const carWidthMeters = 10;

    const coords = entry.marker.getLngLat();
    const metersPerPixel =
      (156543.03392 * Math.cos((coords.lat * Math.PI) / 180)) /
      Math.pow(2, zoom);
    const pixelsPerMeter = 1 / metersPerPixel;

    // Individual dimensions per carriage
    let carLengthPx = carLengthMeters * pixelsPerMeter;
    let carWidthPx = carWidthMeters * pixelsPerMeter;

    // Mínimos: cada carruagem nunca fica menor que 8px de comprimento
    carLengthPx = Math.max(carLengthPx, 8);
    carWidthPx = Math.max(carWidthPx, 6);

    const wrapper = entry.el.querySelector(".train-cars-wrapper");
    if (wrapper) {
      // Ligeiro gap entre carruagens (representa a articulação, ~0.8m)
      const gapPx = Math.max(1, 0.8 * pixelsPerMeter);
      wrapper.style.gap = `${gapPx}px`;
      wrapper.style.padding = "0";
      wrapper.style.width = `${carWidthPx}px`;
      // Height não é necessário no wrapper — é determinada pelas carruagens
    }

    const carriages = entry.el.querySelectorAll(".train-carriage");
    carriages.forEach((c) => {
      c.style.height = `${carLengthPx}px`;
      c.style.width = "100%";
      c.style.flex = "0 0 auto";
    });
  }

  // ─── ROTAÇÃO ─────────────────────────────────────────────────────────
  //
  // Zoom-out: só a seta gira (train front fica sempre direito).
  // Zoom-in:  o corpo inteiro gira (carruagens + WiFi alinhados à linha).

  function applyRotation(entry, bearing) {
    const arrow = entry.el.querySelector(".train-arrow");
    const body = entry.el.querySelector(".train-cars-body");

    if (arrow) {
      // Seta: 0° aponta para cima (norte). Bearing da geo: 0° = norte.
      // maplibre rotationAlignment=map faz este cálculo automaticamente.
      arrow.style.transform = `translate(-50%, -50%) rotate(${bearing - 90}deg) translateX(30px)`;
    }
    if (body) {
      body.style.transform = `translate(-50%, -50%) rotate(${bearing}deg)`;
    }
  }

  /**
   * Aplica a vista (ícone vs carruagens) e a flag de "at rest".
   * Quando at-rest, a seta esmaece para indicar "parado".
   */
  function applyViewState(entry, zoom, position) {
    const isDetail = zoom >= MAPA.ZOOM_DETAIL_CUTOFF;
    entry.el.dataset.view = isDetail ? "cars" : "icon";

    const atRest = isAtRest(position);
    const arrow = entry.el.querySelector(".train-arrow");
    if (arrow) arrow.dataset.atRest = atRest ? "1" : "0";
  }

  // ─── API PÚBLICA ─────────────────────────────────────────────────────

  function upsertTrain(map, train, position, zoom) {
    if (!position) return;
    let entry = markers.get(train.id);
    const now = performance.now();

    if (!entry) {
      const el = document.createElement("div");
      el.className = "train-marker";
      el.innerHTML = buildMarkerHtml(train);

      // Click handler — usa pointer events para compatibilidade iOS/Android
      const onPress = (e) => {
        e.stopPropagation();
        if (typeof clickHandler === "function") {
          // Em vez de enviar o 'train' da closure antiga, vamos buscar o comboio
          // mais recente ao nosso dicionário de marcadores!
          const currentEntry = markers.get(train.id);
          const freshTrain = currentEntry ? currentEntry.train : train;

          clickHandler(freshTrain);
        }
      };
      el.addEventListener("click", onPress);
      // Também aceitar 'touchend' para iOS antigos que não disparam click
      // fiavelmente sobre elementos absolutos.

      const marker = new maplibregl.Marker({
        element: el,
        anchor: "center", // Âncora no centro do comboio
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
      return;
    }

    // Update path ─────────────────────────────────────────────────────
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
  }

  function onZoomChange(zoom) {
    for (const entry of markers.values()) {
      applyViewState(entry, zoom, null);
      scaleCarriagesToRealWorld(entry, zoom);
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

  // ─── CONTROLO DE CÂMERA ──────────────────────────────────────────────

  function setMap(mapInstance) {
    mainMap = mapInstance;

    // Desliga o tracking se o utilizador interagir (arrastar ou fazer scroll no mapa)
    const stopTrack = (e) => {
      if (e.originalEvent && trackedTrainId) {
        stopTracking();
      }
    };
    mainMap.on("dragstart", stopTrack);
    mainMap.on("touchstart", stopTrack);
    mainMap.on("wheel", stopTrack);
  }

  function startTrackingTrain(id) {
    trackedTrainId = id;
    window.history.replaceState(null, null, "#" + id); // Põe o ID no URL

    const entry = markers.get(id);
    if (entry && mainMap) {
      isFlying = true;
      mainMap.flyTo({
        center: entry.marker.getLngLat(),
        zoom: Math.max(mainMap.getZoom(), 14), // Zoom in mínimo
        offset: getDynamicOffset(),
        speed: 1.2,
      });
      mainMap.once("moveend", () => {
        isFlying = false;
      });
    }
  }

  function focusStation(station) {
    stopTracking(); // Estações não se movem, não precisam de tracking contínuo
    if (mainMap) {
      mainMap.flyTo({
        center: [station.lng, station.lat],
        zoom: Math.max(mainMap.getZoom(), 15),
        offset: getDynamicOffset(),
        speed: 1.2,
      });
    }
  }

  function stopTracking() {
    trackedTrainId = null;
    window.history.replaceState(
      null,
      null,
      window.location.pathname + window.location.search,
    ); // Limpa a hash do URL
  }

  // Usado quando os modais fecham, para que o mapa recentre suavemente
  function recenterTracking() {
    if (trackedTrainId && mainMap) {
      isFlying = true;
      mainMap.easeTo({ offset: [0, 0], duration: 400 });
      mainMap.once("moveend", () => {
        isFlying = false;
      });
    }
  }

  window.MapaRender = {
    setMap,
    startTracking,
    focusStation,
    recenterTracking,
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

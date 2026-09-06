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
  let followModeTrainId = null;
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

    // A âncora é onde o comboio está DESENHADO, não um recálculo da posição.
    // O computeTrainPosition pode discordar do marcador — devolve null se o
    // MapaGeo ainda não estiver iniciado, usa um "agora" diferente do da
    // animação, e não sabe da interpolação em curso. Enquadrar por ele fazia
    // o mapa começar na estação seguinte em vez de no comboio.
    const entry = markers.get(train.id);
    let pos = null;
    if (entry && entry.marker && entry.marker.getLngLat) {
      try {
        const ll = entry.marker.getLngLat();
        if (ll && isFinite(ll.lng) && isFinite(ll.lat)) pos = ll;
      } catch (_) {}
    }
    if (!pos && window.MapaGeo) {
      pos = window.MapaGeo.computeTrainPosition(train, new Date());
    }
    if (!pos) return;

    let remaining = remainingNodes(train);
    // Sem estações em falta (comboio no fim do percurso, ou ComboioPassou mal
    // marcado) o enquadramento não pode desistir: fica ao menos o último nó,
    // para haver sempre um par comboio → terminal.
    if (remaining.length === 0) {
      const todos = train.nodes || [];
      if (todos.length) remaining = [todos[todos.length - 1]];
    }

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
    let apanhouEstacao = false;
    for (const node of remaining) {
      const st = MAPA.resolveStationByApiId(node.EstacaoID);
      if (st) {
        bounds.extend([st.lng, st.lat]);
        apanhouEstacao = true;
      }
    }
    // Se nenhum nó foi reconhecido, o enquadramento seria um ponto só — e o
    // fitBounds de um ponto salta para o zoom máximo. Melhor ficar pela
    // terminal do percurso, mesmo que venha por nome em vez de id.
    if (!apanhouEstacao && !userDestKey) {
      const todos = train.nodes || [];
      const ult = todos[todos.length - 1];
      const st =
        ult &&
        (MAPA.resolveStationByApiId(ult.EstacaoID) ||
          (MAPA.resolveStationByApiName
            ? MAPA.resolveStationByApiName(ult.NomeEstacao)
            : null));
      if (st) bounds.extend([st.lng, st.lat]);
      else return; // sem par não vale a pena mexer o mapa
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
    if (followModeTrainId === train.id) return;
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
    followModeTrainId = null;
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
    const glideMs = MAPA.TRAIN_GLIDE_MS || MAPA.POSITION_UPDATE_MS;
    for (const entry of markers.values()) {
      if (entry.startPos && entry.targetPos) {
        let t = (time - entry.animationStartTime) / glideMs;
        if (t > 1) t = 1;
        const lng = lerp(entry.startPos.lng, entry.targetPos.lng, t);
        const lat = lerp(entry.startPos.lat, entry.targetPos.lat, t);
        entry.marker.setLngLat([lng, lat]);

        // NOVO: Interpolar Rotação em vez de "Snap" a cada 5 segundos
        if (
          entry.startBearing !== undefined &&
          entry.targetBearing !== undefined
        ) {
          const currentBearing = lerp(
            entry.startBearing,
            entry.targetBearing,
            t,
          );
          if (Math.abs((entry.bearing || 0) - currentBearing) > 0.1) {
            applyRotation(entry, currentBearing);
            entry.bearing = currentBearing;
          }
        }

        // NOVO: Prender a Câmara Frame-a-Frame ao Comboio
        if (
          followModeTrainId === entry.train.id &&
          !routeFocusUserDetached &&
          !isFlying &&
          mainMap
        ) {
          mainMap.jumpTo({
            center: [lng, lat],
            bearing: entry.bearing,
            padding: {
              top: 0,
              bottom: Math.max(300, window.innerHeight * 0.42),
              left: 0,
              right: 0,
            },
          });
        }
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
          "line-color": LINHA_CLARO,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.5, 16, 5],
          "line-opacity": 0.95,
        },
      });
    }
    aplicarTemaLinha(map);
    // O mapa-tema.js dispara "styledata" quando o tema muda, e é também o que
    // acontece numa troca de estilo a sério. Serve para os dois casos.
    if (!map._ltLinhaTema) {
      map._ltLinhaTema = true;
      map.on("styledata", () => aplicarTemaLinha(map));
    }
  }

  // ─── COR DA LINHA CONFORME O TEMA ────────────────────────────────────
  // Só o traço da linha muda: sobre o basemap invertido, preto sobre escuro
  // desaparecia. O casing (o contorno largo e translúcido, #1e293b a 35%)
  // fica como está — é ele que dá volume ao traço nos dois temas.
  const LINHA_CLARO = "#000000";
  const LINHA_ESCURO = "#ffffff";

  function aplicarTemaLinha(map) {
    if (!map || !map.getLayer("fertagus-line")) return;
    const escuro = document.documentElement.classList.contains("dark");
    try {
      map.setPaintProperty(
        "fertagus-line",
        "line-color",
        escuro ? LINHA_ESCURO : LINHA_CLARO,
      );
    } catch (e) {
      console.warn("[MapaRender] cor da linha:", e && e.message);
    }
  }

  // ─── ESTAÇÕES (pontos + labels) ──────────────────────────────────────
  //
  // O marcador da Fertagus são DUAS camadas: um círculo branco com contorno
  // ("fertagus-stations-bg") e, por cima, o logótipo. O logótipo é composto
  // pelo mapa-icones.js com background "none" — se trouxesse fundo próprio
  // ficava um quadrado dentro do círculo.
  //
  // Regra entre as duas: o icon-size é ~68% do DIÂMETRO do círculo, que é
  // 2 × circle-radius. Mais do que isso e o logótipo encosta ao contorno,
  // dando a sensação de não haver círculo nenhum.
  //
  //   zoom   raio   diâmetro   icon-size
  //     6      5       10          7
  //     9      8       16         11
  //    12     16       32         22
  //    15     22       44         30
  //    17     30       60         41
  //
  // Do zoom 12 para cima nada mudou. Abaixo disso o marcador encolhe: com os
  // intermodais escondidos e as linhas a 0 px até ao zoom 10, a Fertagus fica
  // sozinha no mapa e ao tamanho grande tapava metade da margem sul. A partir
  // do 12 volta ao destaque de sempre.

  // ─── SELECÇÃO ────────────────────────────────────────────────────────
  // Sem anel por cima: o círculo branco de fundo passa a verde.
  function selectionColorExpr(sel) {
    const mine = sel && sel.op === "fertagus" ? sel : null;
    const expr = window.MapaSelecao
      ? window.MapaSelecao.matchExpr(mine, ["name", "id"])
      : false;
    const green = (window.MapaSelecao && window.MapaSelecao.GREEN) || "#22C55E";
    return ["case", expr, green, "#ffffff"];
  }

  function applyStationSelection(map, sel) {
    if (!map || !map.getLayer("fertagus-stations-bg")) return;
    try {
      map.setPaintProperty(
        "fertagus-stations-bg",
        "circle-color",
        selectionColorExpr(sel),
      );
    } catch (e) {
      console.warn("[MapaRender] selecção falhou:", e && e.message);
    }
  }

  const FERTAGUS_ICON = "fertagus-logo-icon";
  const FERTAGUS_LOGO = "/imagens/lig-logos/fertagus.png";
  let fertagusIconReady = false;

  // ─── SELO DA CP NAS ESTAÇÕES PARTILHADAS ─────────────────────────────
  // Estações onde a Fertagus e a CP param. O selo aparece ao lado do marcador
  // da Fertagus, mas só quando a camada da CP está ligada e com zoom suficiente
  // — caso contrário anunciava um operador que não está no mapa.
  // O clique continua a abrir a Fertagus: o selo é informação, não um atalho.
  const CP_BADGE_ICON = "cp-badge-icon";
  const CP_BADGE_LOGO = "/imagens/lig-logos/cp.svg";
  const CP_BADGE_LAYER = "fertagus-cp-badge";
  const CP_BADGE_MINZOOM = 13; // igual ao dos restantes intermodais

  function cpBadgeLayerDef() {
    return {
      id: CP_BADGE_LAYER,
      type: "symbol",
      source: "fertagus-stations",
      minzoom: CP_BADGE_MINZOOM,
      // Sem nomes ainda: nada é desenhado até o cruzamento estar feito.
      filter: ["in", ["get", "name"], ["literal", []]],
      layout: {
        "icon-image": CP_BADGE_ICON,
        // Cerca de 45% do marcador da Fertagus.
        "icon-size": window.MapaIcones.sizeExpr([
          [8, 12],
          [12, 15],
          [15, 20],
          [17, 26],
        ]),
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        // icon-translate é em pixéis e não é multiplicado pelo icon-size, o que
        // o torna previsível: encosta o selo à direita do círculo, cujo raio
        // vai de 12 a 30 px.
        "icon-translate": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8,
          ["literal", [18, -8]],
          12,
          ["literal", [23, -10]],
          15,
          ["literal", [31, -14]],
          17,
          ["literal", [42, -19]],
        ],
      },
    };
  }

  function applyCpBadgeVisibility(map) {
    if (!map || !map.getLayer(CP_BADGE_LAYER)) return;
    const on = !window.MapaView || window.MapaView.isVisible("cp");
    try {
      map.setLayoutProperty(CP_BADGE_LAYER, "visibility", on ? "visible" : "none");
    } catch (_) {}
  }

  function refreshCpBadges(map) {
    if (!map || !window.GtfsHorarios || !window.GtfsHorarios.sharedFertagusCp)
      return;
    // Se a camada da CP está desligada, os dados nem sequer são descarregados.
    const on = !window.MapaView || window.MapaView.isVisible("cp");
    if (!on) {
      applyCpBadgeVisibility(map);
      return;
    }
    const ready =
      window.MapaCP && window.MapaCP.ensureLoaded
        ? window.MapaCP.ensureLoaded()
        : Promise.resolve();
    Promise.all([ready, window.MapaIcones ? ensureCpBadgeIcon(map) : false])
      .then(([, iconOk]) => {
        if (!iconOk) return null;
        return window.GtfsHorarios.sharedFertagusCp();
      })
      .then((shared) => {
        if (!shared || !map.getSource("fertagus-stations")) return;
        // O filtro compara pelo nome tal como está no geojson das estações.
        const nomes = [];
        for (const st of window.MAPA && window.MAPA.STATIONS ? window.MAPA.STATIONS : [])
          if (shared.has(normName(st.name))) nomes.push(st.name);
        if (!map.getLayer(CP_BADGE_LAYER)) map.addLayer(cpBadgeLayerDef());
        map.setFilter(CP_BADGE_LAYER, ["in", ["get", "name"], ["literal", nomes]]);
        applyCpBadgeVisibility(map);
        // Clicar no selo abre a Fertagus, tal como o resto do marcador.
        if (!map._ltCpBadgeClick) {
          map._ltCpBadgeClick = true;
          map.on("click", CP_BADGE_LAYER, onStationFeatureClick);
          map.on("mouseenter", CP_BADGE_LAYER, () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", CP_BADGE_LAYER, () => {
            map.getCanvas().style.cursor = "";
          });
        }
      })
      .catch((e) => console.warn("[MapaRender] selos da CP:", e && e.message));
  }

  function ensureCpBadgeIcon(map) {
    return window.MapaIcones.ensure(map, {
      id: CP_BADGE_ICON,
      url: CP_BADGE_LOGO,
      // Redondo com traço, para ler como um selo ao lado do círculo maior.
      background: "circle",
      padding: 0.18,
    });
  }

  function normName(v) {
    return String(v == null ? "" : v)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  // Círculo branco de fundo. É também o alvo de clique: é um círculo perfeito
  // e já responde antes de o logótipo carregar.
  function stationBackgroundLayerDef() {
    return {
      id: "fertagus-stations-bg",
      type: "circle",
      source: "fertagus-stations",
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          6,
          5,
          9,
          8,
          12,
          16,
          15,
          22,
          17,
          30,
        ],
        // Verde na estação seleccionada. É este círculo que faz de fundo do
        // logótipo, por isso é aqui que a selecção se vê.
        "circle-color": selectionColorExpr(
          window.MapaSelecao && window.MapaSelecao.current(),
        ),
        "circle-stroke-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          6,
          1,
          9,
          1.5,
          15,
          2.5,
        ],
        "circle-stroke-color": "#0f172a",
      },
    };
  }

  function stationLayerDef() {
    if (fertagusIconReady && window.MapaIcones) {
      return {
        id: "fertagus-stations-layer",
        type: "symbol",
        source: "fertagus-stations",
        layout: {
          "icon-image": FERTAGUS_ICON,
          // ~68% do diâmetro do círculo em todos os pontos, para o logótipo
          // não encostar ao contorno nem se perder no branco.
          "icon-size": window.MapaIcones.sizeExpr([
            [6, 7],
            [9, 11],
            [12, 22],
            [15, 30],
            [17, 41],
          ]),
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      };
    }
    // Enquanto o logótipo não chega, esta camada não desenha nada — quem se vê
    // é o círculo branco de baixo. rgba(0,0,0,0) em vez de "transparent", para
    // não depender de o parser de cores aceitar nomes CSS.
    return {
      id: "fertagus-stations-layer",
      type: "circle",
      source: "fertagus-stations",
      paint: { "circle-radius": 0, "circle-color": "rgba(0,0,0,0)" },
    };
  }

  function ensureStationIcon(map) {
    if (fertagusIconReady || !window.MapaIcones) return;
    window.MapaIcones.ensure(map, {
      id: FERTAGUS_ICON,
      url: FERTAGUS_LOGO,
      // Sem fundo: o círculo por baixo já é o fundo branco. Com "none" o
      // icon-size passa a ser exactamente o tamanho do logótipo.
      background: "none",
    }).then((ok) => {
      if (!ok) return; // sem logótipo fica só o círculo branco
      fertagusIconReady = true;
      if (map.getLayer("fertagus-stations-layer"))
        window.MapaIcones.replaceLayer(map, stationLayerDef());
    });
  }

  function onStationFeatureClick(e) {
    const f = e.features && e.features[0];
    if (!f) return;
    const station = MAPA.STATIONS.find(
      (s) => s.name === f.properties.name || s.apiName === f.properties.name,
    );
    if (station && window.MapaStation) window.MapaStation.open(station);
  }

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

    // A. Círculo de fundo primeiro. É também o que fica verde na estação
    // seleccionada.
    if (!map.getLayer("fertagus-stations-bg")) {
      map.addLayer(stationBackgroundLayerDef());
      if (window.MapaSelecao && !map._ltSelFertagus) {
        map._ltSelFertagus = true;
        window.MapaSelecao.register((sel) => applyStationSelection(map, sel));
      }
    }

    // B. Logótipo por cima.
    if (!map.getLayer("fertagus-stations-layer")) {
      map.addLayer(stationLayerDef());
      ensureStationIcon(map);
    }

    // C. Nomes no topo.
    if (!map.getLayer("fertagus-stations-labels")) {
      map.addLayer({
        id: "fertagus-stations-labels",
        type: "symbol",
        source: "fertagus-stations",
        minzoom: 11,
        layout: {
          "text-field": ["get", "name"],
          // Uma fonte só: o servidor de glyphs deste estilo devolve 404 para
          // fontstacks combinados. Ver a nota no mapa-icones.js.
          "text-font": (window.MapaIcones && window.MapaIcones.FONT) || [
            "Open Sans Semibold",
          ],
          "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 16, 14],
          // 2,5 em a 14 px dá ~35 px, mais do que os 30 px de raio do círculo
          // ao zoom 17 — o nome fica abaixo do marcador, não por cima.
          "text-offset": [0, 2.5],
          "text-anchor": "top",
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

    // D. Interacção no círculo de fundo, não no logótipo: a área de clique é um
    // círculo perfeito e funciona mesmo antes de o ícone carregar.
    map.on("click", "fertagus-stations-bg", onStationFeatureClick);
    // Selos da CP nas estações partilhadas, e a acompanhar o botão do olho.
    refreshCpBadges(map);
    if (window.MapaView && !map._ltCpBadgeWatch) {
      map._ltCpBadgeWatch = true;
      window.MapaView.onChange(() => refreshCpBadges(map));
    }

    map.on("mouseenter", "fertagus-stations-bg", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "fertagus-stations-bg", () => {
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
      ? `<span class="rsc-delay">+${delayMin} MIN</span>`
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
        startBearing: position.bearing || 0,
        targetBearing: position.bearing || 0,
        map,
        startPos: { lng: position.lng, lat: position.lat },
        targetPos: { lng: position.lng, lat: position.lat },
        animationStartTime: now,
        isRealPosition: !!position.isReal,
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
    let delta = newBearing - (entry.bearing || 0);

    // Contornar bloqueios de 360º para girar sempre pelo caminho mais curto
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    if (Math.abs(delta) > 0.5) {
      entry.startBearing = entry.bearing || 0;
      entry.targetBearing = entry.startBearing + delta;
    } else {
      entry.startBearing = entry.bearing || 0;
      entry.targetBearing = entry.bearing || 0;
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
    entry.isRealPosition = !!position.isReal;

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

  // Indica se o marcador deste comboio está a usar posição REAL (TML) ou
  // a estimativa do mapa-geo. Usado pelo modal de detalhes para o rótulo.
  function isRealPosition(trainId) {
    const entry = markers.get(trainId);
    return !!(entry && entry.isRealPosition);
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
        // NOVO: Desativar followMode e repor botão se houver interação mecânica do utilizador (pan, scroll, pitch)
        if (followModeTrainId) {
          followModeTrainId = null;
          const b = document.querySelector('[data-details-action="follow"]');
          if (b) {
            b.classList.remove(
              "text-blue-500",
              "dark:text-blue-400",
              "bg-blue-50",
              "dark:bg-blue-500/10",
            );
            b.classList.add(
              "text-zinc-400",
              "hover:text-zinc-900",
              "dark:hover:text-white",
            );
          }
        }
      }
    };
    mainMap.on("dragstart", detachIfUser);
    mainMap.on("touchstart", detachIfUser);
    mainMap.on("wheel", detachIfUser);
    mainMap.on("rotatestart", detachIfUser);
    mainMap.on("pitchstart", detachIfUser);
  }

  function isFollowModeActive(trainId) {
    return followModeTrainId === trainId;
  }

  function toggleFollowMode(train) {
    if (!mainMap || !train) return false;
    if (followModeTrainId === train.id) {
      // Desativar: Levantar a câmara e restaurar foco 2D.
      followModeTrainId = null;
      mainMap.easeTo({ pitch: 0, duration: 600 });
      applyRouteFocus(train, { subtle: false });
      return false;
    } else {
      // Ativar: Mudar a câmara com inércia para dentro do comboio.
      followModeTrainId = train.id;
      routeFocusTrainId = train.id;
      routeFocusUserDetached = false;
      isFlying = true;

      const entry = markers.get(train.id);
      const pos = entry
        ? { lng: entry.targetPos.lng, lat: entry.targetPos.lat }
        : window.MapaGeo.computeTrainPosition(train, new Date());
      const bearing = entry
        ? entry.targetBearing || entry.bearing || 0
        : pos.bearing || 0;

      mainMap.easeTo({
        center: [pos.lng, pos.lat],
        zoom: 16.8, // Zoom alto e suficiente para as carruagens
        pitch: 65, // Tilted como a visão de um pára-brisas
        bearing: bearing,
        padding: {
          top: 0,
          bottom: Math.max(300, window.innerHeight * 0.42),
          left: 0,
          right: 0,
        },
        duration: 1200,
      });

      mainMap.once("moveend", () => {
        isFlying = false; // liberta a flag e passa a ser atualizado frame-a-frame no jumpTo()
      });
      return true;
    }
  }

  // ─── EXPORT ──────────────────────────────────────────────────────────
  window.MapaRender = {
    setMap,
    // Focus
    toggleFollowMode,
    isFollowModeActive,
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
    isRealPosition,
    _ringColor: ringColor,
    _carriageFillColor: carriageFillColor,
    _filledCarriages: filledCarriages,
  };
})();

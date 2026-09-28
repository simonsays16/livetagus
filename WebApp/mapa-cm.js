/**
 * mapa-cm.js  ·  LiveTagus (mapa)
 * Paragens de autocarro Carris Metropolitana (CM) no mapa, a partir do
 * json/ligacoes_atualizado.json (ligações intermodais por estação Fertagus).
 *
 * SÓ aparecem as paragens das estações VERIFICADAS (ver AVAILABLE_STATIONS).
 * Cada paragem (poste) é um marcador; ao clicar abre uma sheet (reaproveita
 * #details-panel/#details-backdrop, igual aos detalhes do mapa) com dois
 * estados — tal como o modal do comboio:
 *   • MINI: nome, operador (CM) + logo, pills das linhas (cores reais) e as
 *     3 próximas partidas + botão "Ver Mais Partidas".
 *   • EXPANDIDO: até 15 partidas.
 * É possível filtrar por linha, tal como na página "A Minha Paragem".
 * A paragem selecionada fica destacada com outra cor no mapa.
 *
 * Edge cases (sem JSON, sem linhas, API CM em baixo, sem previsões, filtro
 * sem resultados) tratados localmente — mesma lógica de estacao.js/paragens.js.
 */

(function () {
  "use strict";

  // ─── BLOQUEIO: estações já verificadas (nome em maiúsculas) ──────────
  // Acrescentar aqui à medida que forem validadas as restantes.
  const AVAILABLE_STATIONS = [
    "ENTRECAMPOS",
    "SETE RIOS",
    "CAMPOLIDE",
    "PRAGAL",
    "CORROIOS",
    "FOROS DE AMORA",
    "FOGUETEIRO",
    "COINA",
    "PENALVA",
    "VENDA DO ALCAIDE",
    "PALMELA",
    "SETUBAL",
  ];

  // ─── CONFIG ──────────────────────────────────────────────────────────
  const CM_API_BASE = "https://api.carrismetropolitana.pt/v2";
  const LIGACOES_JSON = "./json/ligacoes_atualizado.json";
  const ARRIVALS_REFRESH_MS = 30_000;
  const ARRIVALS_LIMIT = 15; // partidas no estado expandido
  const MINI_ARRIVALS = 3; // partidas visíveis no estado minimizado

  const SRC_ID = "cm-stops";
  const LAYER_ID = "cm-stops-layer";
  const CM_LOGO_LIGHT = "/imagens/lig-logos/cm-light.svg";
  const CM_LOGO_DARK = "/imagens/lig-logos/cm-dark.svg";
  const CM_MARKER_COLOR = "#FFDD00";
  const CM_SELECTED_COLOR = "#22C55E"; // paragem selecionada (destaque)

  // ─── ESTADO ──────────────────────────────────────────────────────────
  let map = null;
  let ligacoesCache = null;
  const stopsById = new Map(); // poleId -> { id, name, lines[], location[lat,lng], station }

  let panel = null;
  let backdrop = null;
  let currentStop = null;
  let selectedId = null; // paragem destacada no mapa
  let activeLine = null; // filtro de linha (null = todas)
  let refreshTimer = null;
  let arrivalsAbort = null;

  // Drag (swipe → fechar/expandir)
  let dragActive = false;
  let dragStartY = 0;
  let dragLastY = 0;
  let dragStartTs = 0;

  // ─── HELPERS ───────────────────────────────────────────────────────────
  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normColor(c) {
    if (!c) return "#18181b";
    const s = String(c).trim();
    return s.startsWith("#") ? s : "#" + s.replace(/^#/, "");
  }

  function isMobile() {
    return !window.matchMedia("(min-width: 768px)").matches;
  }

  // Linhas únicas (por line-id), preservando ordem e cor.
  function uniqueLines(stop) {
    const out = [];
    const seen = new Set();
    for (const l of stop.lines || []) {
      const id = l && l["line-id"];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id: String(id),
        name: String(l["line-name"] != null ? l["line-name"] : id),
        color: normColor(l["route-color"]),
      });
    }
    return out;
  }

  function lineColorMap(stop) {
    const m = {};
    for (const l of uniqueLines(stop)) m[l.id] = l.color;
    return m;
  }

  // ─── LOAD + GATE ───────────────────────────────────────────────────────
  async function loadLigacoes() {
    if (ligacoesCache !== null) return ligacoesCache;
    try {
      const res = await fetch(LIGACOES_JSON, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      ligacoesCache = await res.json();
    } catch (e) {
      console.warn("[MapaCM] ligacoes JSON indisponível:", e.message);
      ligacoesCache = {};
    }
    return ligacoesCache;
  }

  function isStationAllowed(name) {
    if (!name) return false;
    const up = String(name)
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return AVAILABLE_STATIONS.some(
      (a) =>
        a
          .toUpperCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "") === up,
    );
  }

  // Constrói features GeoJSON só das estações permitidas e popula stopsById.
  function buildFeatures(data) {
    stopsById.clear();
    const features = [];
    for (const key in data) {
      if (key === "operador") continue;
      const station = data[key];
      if (!station || !isStationAllowed(station.name)) continue;
      const cm = (station.ligacoes && station.ligacoes.cm) || [];
      for (const stop of cm) {
        if (!stop || !stop.id || !Array.isArray(stop.location)) continue;
        const [lat, lng] = stop.location;
        if (typeof lat !== "number" || typeof lng !== "number") continue;
        const entry = {
          id: String(stop.id),
          name: stop.name || `Paragem: ${stop.id}`,
          lines: stop.lines || [],
          location: [lat, lng],
          gmapslink: stop.gmapslink || "",
          station: station.name,
        };
        stopsById.set(entry.id, entry);
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng, lat] },
          properties: { id: entry.id },
        });
      }
    }
    return { type: "FeatureCollection", features };
  }

  // ─── MAP LAYER ─────────────────────────────────────────────────────────
  async function init(mapInstance) {
    if (!mapInstance) return;
    // O mapa fica conhecido já: um toque nos primeiros segundos não pode
    // encontrar map a null. O resto — descarregar as ligações e criar a camada
    // das paragens — espera que a Fertagus esteja desenhada (mapa-render.js).
    map = mapInstance;
    if (window.LTArranque && !window.LTArranque.aberto()) {
      window.LTArranque.depois(() => init(mapInstance));
      return;
    }
    const data = await loadLigacoes();
    const geojson = buildFeatures(data);
    if (geojson.features.length === 0) return; // nada verificado → sem layer

    if (!map.getSource(SRC_ID)) {
      map.addSource(SRC_ID, { type: "geojson", data: geojson });
    }
    if (!map.getLayer(LAYER_ID)) {
      map.addLayer(stopLayerDef());
      // O logótipo é composto de forma assíncrona (mapa-icones.js): entra já o
      // círculo amarelo e a camada é trocada quando o ícone estiver pronto.
      ensureStopIcon();
      watchSelection();

      map.on("click", LAYER_ID, (e) => {
        const f = e.features && e.features[0];
        if (!f) return;
        const stop = stopsById.get(String(f.properties.id));
        if (stop) open(stop);
      });
      map.on("mouseenter", LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });
    }
    applySelectionPaint();
  }

  // ─── MARCADOR DAS PARAGENS ───────────────────────────────────────────
  // Logótipo da Carris sobre fundo branco. Diâmetros 8/14/20 px: menores que
  // os do Metro e da CP, e bem menores que os da Fertagus — são postes de
  // autocarro, não devem competir com as estações.
  //
  // A variante escolhida é a cm-light.svg: é a que tem tinta escura, feita
  // para fundos claros, e o fundo do ícone é branco em qualquer tema.
  //
  // Só a partir do zoom 13, como os restantes intermodais: abaixo disso o mapa
  // fica limpo e as paragens não são sequer clicáveis, porque o MapLibre não
  // consulta uma camada que não desenha. (Opacidade a zero não servia: as
  // features continuavam a responder ao rato.) As paragens guardadas, essas,
  // aparecem a qualquer zoom — são as do utilizador.
  const STOPS_MINZOOM = 13;
  const STOP_ICON = "cm-logo-icon";
  const STOP_LOGO = "/imagens/lig-logos/cm-light.svg";
  const STOP_FADE = ["interpolate", ["linear"], ["zoom"], 13, 0.55, 15, 1];
  const STOP_ICON_SEL = STOP_ICON + "-sel";
  let stopIconReady = false;

  // Pinta a paragem seleccionada: o fundo do logótipo fica verde. Substitui o
  // antigo applySelectionPaint, que só funcionava com a camada de círculos.
  function applySelection(sel) {
    const layer = map && map.getLayer(LAYER_ID);
    if (!layer) return;
    const mine = sel && sel.op === "cm" ? sel : null;
    const expr = window.MapaSelecao
      ? window.MapaSelecao.matchExpr(mine, ["id"])
      : false;
    try {
      if (layer.type === "symbol") {
        map.setLayoutProperty(LAYER_ID, "icon-image", [
          "case",
          expr,
          STOP_ICON_SEL,
          STOP_ICON,
        ]);
      } else {
        map.setPaintProperty(LAYER_ID, "circle-color", [
          "case",
          expr,
          CM_SELECTED_COLOR,
          CM_MARKER_COLOR,
        ]);
      }
    } catch (e) {
      console.warn("[CM] selecção falhou:", e && e.message);
    }
  }

  function stopLayerDef() {
    if (stopIconReady && window.MapaIcones) {
      return {
        id: LAYER_ID,
        type: "symbol",
        source: SRC_ID,
        minzoom: STOPS_MINZOOM,
        layout: {
          "icon-image": STOP_ICON,
          "icon-size": window.MapaIcones.sizeExpr([
            [12, 8],
            [15, 14],
            [17, 20],
          ]),
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: { "icon-opacity": STOP_FADE },
      };
    }
    return {
      id: LAYER_ID,
      type: "circle",
      source: SRC_ID,
      minzoom: STOPS_MINZOOM,
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          12,
          4,
          15,
          7,
          17,
          10,
        ],
        "circle-color": CM_MARKER_COLOR,
        "circle-stroke-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          13,
          1.5,
          17,
          2.5,
        ],
        "circle-stroke-color": "#000000",
        "circle-opacity": STOP_FADE,
        "circle-stroke-opacity": STOP_FADE,
      },
    };
  }

  function ensureStopIcon() {
    if (stopIconReady || !window.MapaIcones || !map) return;
    Promise.all([
      window.MapaIcones.ensure(map, { id: STOP_ICON, url: STOP_LOGO }),
      window.MapaIcones.ensure(map, {
        id: STOP_ICON_SEL,
        url: STOP_LOGO,
        bgColor: CM_SELECTED_COLOR,
      }),
    ]).then((r) => {
      if (!r[0] || !r[1]) return; // sem logótipo fica o círculo amarelo
      stopIconReady = true;
      if (map.getLayer(LAYER_ID)) {
        window.MapaIcones.replaceLayer(map, stopLayerDef());
        // A camada é nova: a expressão da selecção tem de ser reposta.
        applySelection(window.MapaSelecao && window.MapaSelecao.current());
      }
    });
  }

  function watchSelection() {
    if (!window.MapaSelecao || !map || map._ltSelCm) return;
    map._ltSelCm = true;
    window.MapaSelecao.register(applySelection);
  }

  // Destaca a paragem selecionada (cor + anel maior) via paint properties.
  function applySelectionPaint() {
    if (!map || !map.getLayer(LAYER_ID)) return;
    // Com o logótipo a camada é symbol e estas propriedades não existem. O
    // destaque da selecionada passa a ser o anel verde do mapa-selecao.js,
    // que já cobre todos os operadores.
    if (map.getLayer(LAYER_ID).type !== "circle") return;
    const sel = selectedId || "__none__";
    map.setPaintProperty(LAYER_ID, "circle-color", [
      "case",
      ["==", ["get", "id"], sel],
      CM_SELECTED_COLOR,
      CM_MARKER_COLOR,
    ]);
    map.setPaintProperty(LAYER_ID, "circle-radius", [
      "interpolate",
      ["linear"],
      ["zoom"],
      13,
      ["case", ["==", ["get", "id"], sel], 6, 4],
      15,
      ["case", ["==", ["get", "id"], sel], 10, 7],
      17,
      ["case", ["==", ["get", "id"], sel], 13, 10],
    ]);
    map.setPaintProperty(LAYER_ID, "circle-stroke-color", [
      "case",
      ["==", ["get", "id"], sel],
      "#0f172a",
      "#000000",
    ]);
  }

  // ─── DOM DO PAINEL ───────────────────────────────────────────────────
  function ensureElements() {
    if (panel && backdrop) return;
    panel = document.getElementById("details-panel");
    backdrop = document.getElementById("details-backdrop");
    if (!panel || !backdrop) console.error("[MapaCM] Elementos DOM ausentes");
  }

  function operatorHeaderHtml() {
    return `
      <div class="flex items-center gap-2.5">
        <div class="leading-tight">
          <p class="text-[9px] font-mono tracking-wider text-zinc-400">ID: #${escapeHtml(currentStop.id)}</p>
        </div>
      </div>`;
  }

  // Pills das linhas (cores reais). Clicáveis → filtram as partidas.
  function linePillsHtml() {
    const lines = uniqueLines(currentStop);
    if (lines.length === 0) {
      return `<p class="text-[10px] uppercase tracking-[0.2em] text-zinc-400 font-bold mt-4">Sem carreiras registadas</p>`;
    }
    const pills = lines
      .map((l) => {
        const isActive = activeLine === l.id;
        const dimmed = activeLine && !isActive;
        const style = isActive
          ? `background:${l.color};color:#fff;border-color:${l.color}`
          : `background:transparent;color:${l.color};border-color:${l.color}`;
        return `<button type="button" data-cm-line="${escapeHtml(l.id)}"
          class="px-2 py-1 text-[10px] font-extrabold tracking-widest border rounded-[3px] transition-all duration-150${dimmed ? " opacity-35" : ""}"
          style="${style}"
          title="${isActive ? "Mostrar todas" : "Filtrar por " + escapeHtml(l.name)}"
        >${escapeHtml(l.name)}</button>`;
      })
      .join("");

    const reset = activeLine
      ? `<button type="button" data-cm-line-reset="1"
          class="px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">Todas</button>`
      : "";

    return `
      <div class="mt-4">
        <p class="text-[9px] uppercase tracking-[0.25em] text-zinc-400 font-bold mb-2.5">Carreiras${activeLine ? " · a filtrar " + escapeHtml(activeLine) : ""}</p>
        <div class="flex flex-wrap items-center gap-1.5">${pills}${reset}</div>
      </div>`;
  }

  function shellHtml() {
    const gmaps = currentStop.gmapslink
      ? `<a href="${escapeHtml(currentStop.gmapslink)}" target="_blank" rel="noopener"
          class="inline-flex items-center gap-1.5 mt-4 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">
          <i data-lucide="map-pin" class="w-3 h-3"></i> Abrir no Maps
        </a>`
      : "";

    return `
      <div class="flex flex-col h-full bg-white dark:bg-[#09090b]">
        <div class="dp-handle md:hidden shrink-0" data-drag-area="1" aria-hidden="true">
          <div class="dp-handle-pill"></div>
        </div>

        <div class="dp-header relative shrink-0 px-6 pt-3 md:pt-safe-ios md:pt-5 pb-5 border-b border-zinc-100 dark:border-zinc-900" data-drag-area="1">
          <button data-cm-action="close"
            class="absolute right-4 top-3 md:top-5 w-10 h-10 flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
            aria-label="Fechar">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>

          <div class="flex items-center gap-2 mb-3">
            <img src="${CM_LOGO_LIGHT}" alt="Carris Metropolitana" class="w-5 h-5 object-contain cm-logo-light" onerror="this.style.display='none'"/>
            <img src="${CM_LOGO_DARK}" alt="Carris Metropolitana" class="w-5 h-5 object-contain cm-logo-dark" onerror="this.style.display='none'"/>
            <span class="text-[9px] font-bold tracking-[0.3em] uppercase text-yellow-500">Carris Metropolitana</span>
            <span class="h-px flex-1 max-w-16 bg-zinc-200 dark:bg-zinc-800"></span>
          </div>
          <h2 class="text-2xl md:text-2xl font-light tracking-tighter text-zinc-900 dark:text-white leading-[1.1] pr-12">
            ${escapeHtml(currentStop.name)}
          </h2>
          ${operatorHeaderHtml()}
          ${linePillsHtml()}
          ${gmaps}
        </div>

        <!-- PARTIDAS (3 no mini, até ${ARRIVALS_LIMIT} no expandido) -->
        <div class="px-5 pt-4 shrink-0">
          <p class="text-[9px] uppercase tracking-[0.25em] text-zinc-400 font-bold mb-3 px-1">Próximas Partidas</p>
          <div data-cm-arrivals="1">${skeletonHtml()}</div>
        </div>
      </div>`;
  }

  function skeletonHtml() {
    let rows = "";
    for (let i = 0; i < 3; i++) {
      rows += `
        <div class="flex items-center justify-between px-1 py-3 border-b border-zinc-100 dark:border-zinc-900 animate-pulse">
          <div class="flex items-center gap-3 flex-1 min-w-0">
            <span class="block bg-zinc-200 dark:bg-zinc-800 rounded" style="width:42px;height:22px"></span>
            <span class="block bg-zinc-200 dark:bg-zinc-800 rounded h-2.5" style="width:55%"></span>
          </div>
          <span class="block bg-zinc-200 dark:bg-zinc-800 rounded h-2.5" style="width:40px"></span>
        </div>`;
    }
    return rows;
  }

  function stateMsg(text, icon) {
    const ic = icon
      ? `<i data-lucide="${icon}" class="w-4 h-4 shrink-0"></i>`
      : "";
    return `
      <div class="px-1 py-8 flex items-center justify-center gap-2.5 text-zinc-400">
        ${ic}<span class="text-[10px] uppercase tracking-[0.2em] font-bold">${escapeHtml(text)}</span>
      </div>`;
  }

  // `paragem` só vem no modo estação: acrescenta o botão da paragem antes da
  // carreira e o nome dela por baixo do destino. Sem ele, a linha é igual.
  function arrivalRowHtml(b, now, colorMap, withBorder, paragem) {
    const diff = Math.floor((b.ts - now) / 60);
    let timeStr;
    let timeCls = "text-zinc-900 dark:text-white font-bold";
    let pulse = "";
    if (diff <= 0) {
      timeStr = "A chegar";
      timeCls = "text-emerald-600 dark:text-emerald-400 font-extrabold";
      pulse = `<span class="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse"></span>`;
    } else if (diff < 60) {
      timeStr = `${diff} min`;
    } else {
      const d = new Date(b.ts * 1000);
      timeStr = d.toLocaleTimeString("pt-PT", {
        hour: "2-digit",
        minute: "2-digit",
      });
      timeCls = "text-zinc-500 font-medium";
    }
    const liveDot =
      b.live && diff > 0
        ? `<span class="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse"></span>`
        : "";
    const colour = normColor(
      b.route_color || colorMap[String(b.line_id)] || "#18181b",
    );
    const border = withBorder
      ? "border-b border-zinc-100 dark:border-zinc-900"
      : "";
    return `
      <div class="flex items-center justify-between px-1 py-3.5 ${border}">
        <div class="flex items-center gap-3 flex-1 min-w-0 pr-3">
          ${paragem ? paragemBtnHtml(paragem) + "\n          " : ""}<span class="text-white text-[10px] font-bold tracking-widest text-center px-1.5 py-1 rounded-[3px] shrink-0"
            style="background:${colour};min-width:42px">${escapeHtml(b.line_id)}</span>
          ${
            paragem
              ? `<span class="min-w-0 flex flex-col">
                  <span class="truncate text-zinc-600 dark:text-zinc-400 text-[12px]">${escapeHtml(b.headsign || "—")}</span>
                  <span class="truncate text-zinc-400 text-[10px]">${escapeHtml(paragem.nome)}</span>
                </span>`
              : `<span class="truncate text-zinc-600 dark:text-zinc-400 text-[12px]">${escapeHtml(b.headsign || "—")}</span>`
          }
        </div>
        <div class="flex items-center shrink-0">
          ${pulse}${liveDot}
          <span class="text-[10px] uppercase tracking-[0.15em] ${timeCls}">${escapeHtml(timeStr)}${b.live ? "" : ' <span class="text-zinc-400 normal-case font-light">(prog.)</span>'}</span>
        </div>
      </div>`;
  }

  function toggleWrapHtml(expanded) {
    return `
      <div class="dp-toggle-wrap shrink-0">
        <button type="button" data-cm-toggle="1"
          class="dp-toggle w-full py-3 flex items-center justify-center gap-2 text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors border-t border-zinc-100 dark:border-zinc-900"
          aria-label="Ver mais partidas">
          <span data-cm-toggle-text>${expanded ? "Ver Menos Partidas" : "Ver Mais Partidas"}</span>
          <svg class="dp-toggle-chevron" xmlns="http://www.w3.org/2000/svg" width="14" height="14"
               viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
               style="transform:rotate(${expanded ? 180 : 0}deg)">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
      </div>`;
  }

  function footerNoteHtml() {
    return `
      <div class="px-1 py-6 text-center">
        <p class="text-[9px] leading-relaxed text-zinc-400 dark:text-zinc-600 tracking-wide max-w-xs mx-auto">
          Previsões em tempo real fornecidas pela Carris Metropolitana. Podem variar.
        </p>
      </div>`;
  }

  // ─── PARTIDAS (CM API) ───────────────────────────────────────────────
  async function renderArrivals() {
    if (!panel) return;
    const target = panel.querySelector("[data-cm-arrivals]");
    if (!target) return;

    if (arrivalsAbort) {
      try {
        arrivalsAbort.abort();
      } catch (_) {}
    }
    arrivalsAbort = new AbortController();
    const signal = arrivalsAbort.signal;

    const colorMap = lineColorMap(currentStop);
    const expanded = panel.dataset.state === "expanded";

    try {
      const res = await fetch(
        `${CM_API_BASE}/arrivals/by_stop/${encodeURIComponent(currentStop.id)}`,
        { cache: "no-store", signal },
      );
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (signal.aborted) return;

      const now = Math.floor(Date.now() / 1000);
      let buses = (Array.isArray(data) ? data : [])
        .map((b) => ({
          ...b,
          ts: b.estimated_arrival_unix || b.scheduled_arrival_unix,
          live: !!b.estimated_arrival_unix,
        }))
        .filter((b) => b.ts && b.ts >= now - 30);

      if (activeLine)
        buses = buses.filter((b) => String(b.line_id) === activeLine);

      buses = buses.sort((a, b) => a.ts - b.ts).slice(0, ARRIVALS_LIMIT);

      if (buses.length === 0) {
        target.innerHTML =
          stateMsg(
            activeLine ? "Sem partidas para esta carreira" : "Sem previsões",
            null,
          ) + `<div class="dp-expanded-content">${footerNoteHtml()}</div>`;
        if (window.lucide) window.lucide.createIcons();
        return;
      }

      // 3 sempre visíveis; restantes no bloco expandido (escondido no mini).
      const visible = buses.slice(0, MINI_ARRIVALS);
      const rest = buses.slice(MINI_ARRIVALS);

      let html = visible
        .map((b, i) =>
          arrivalRowHtml(
            b,
            now,
            colorMap,
            i < visible.length - 1 || rest.length > 0,
          ),
        )
        .join("");

      if (rest.length > 0) {
        html += toggleWrapHtml(expanded);
        html += `<div class="dp-expanded-content">`;
        html += rest
          .map((b, i) => arrivalRowHtml(b, now, colorMap, i < rest.length - 1))
          .join("");
        html += footerNoteHtml();
        html += `</div>`;
      } else {
        // Nada para expandir — nota só visível no expandido (desktop sempre).
        html += `<div class="dp-expanded-content">${footerNoteHtml()}</div>`;
      }

      target.innerHTML = html;
      attachToggleListener();
      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      if (signal.aborted) return;
      target.innerHTML =
        stateMsg("Sem ligação ao servidor", "wifi-off") +
        `<div class="dp-expanded-content">${footerNoteHtml()}</div>`;
      if (window.lucide) window.lucide.createIcons();
    }
  }

  // ─── ESTADO MINI / EXPANDIDO ─────────────────────────────────────────
  function setState(s) {
    if (!panel) return;
    panel.dataset.state = s;
    updateBackdropForState();
    syncToggle();
  }

  function syncToggle() {
    if (!panel) return;
    const expanded = panel.dataset.state === "expanded";
    const txt = panel.querySelector("[data-cm-toggle-text]");
    const chev = panel.querySelector("[data-cm-toggle] .dp-toggle-chevron");
    if (txt)
      txt.textContent = expanded ? "Ver Menos Partidas" : "Ver Mais Partidas";
    if (chev) chev.style.transform = `rotate(${expanded ? 180 : 0}deg)`;
  }

  function updateBackdropForState() {
    if (!backdrop || !panel) return;
    if (panel.dataset.state === "expanded") {
      backdrop.classList.remove("opacity-0", "pointer-events-none");
      backdrop.classList.add("opacity-100");
      backdrop.dataset.intensity = "strong";
    } else {
      // mini → backdrop subtil para o mapa continuar legível
      backdrop.classList.add("opacity-0", "pointer-events-none");
      backdrop.classList.remove("opacity-100");
      backdrop.dataset.intensity = "soft";
    }
  }

  function attachToggleListener() {
    const btn = panel.querySelector("[data-cm-toggle]");
    if (!btn) return;
    btn.addEventListener("click", () => {
      setState(panel.dataset.state === "expanded" ? "mini" : "expanded");
    });
  }

  // ─── EVENTOS DO SHELL (close + filtro de linha) ──────────────────────
  function attachShellListeners() {
    panel.querySelectorAll("[data-cm-action='close']").forEach((b) => {
      b.addEventListener("click", () => close());
    });
    panel.querySelectorAll("[data-cm-line]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.cmLine;
        activeLine = activeLine === id ? null : id;
        rerenderHeaderAndArrivals();
      });
    });
    const reset = panel.querySelector("[data-cm-line-reset]");
    if (reset) {
      reset.addEventListener("click", () => {
        activeLine = null;
        rerenderHeaderAndArrivals();
      });
    }
  }

  // Re-render do shell ao mudar o filtro (mantém estado mini/expandido).
  function rerenderHeaderAndArrivals() {
    if (!panel || !currentStop) return;
    const prevState = panel.dataset.state;
    panel.innerHTML = shellHtml();
    panel.dataset.state = prevState;
    attachShellListeners();
    if (window.lucide) window.lucide.createIcons();
    renderArrivals();
  }

  // ─── DRAG (swipe → fechar/expandir) ──────────────────────────────────
  function pointerY(e) {
    if (e.touches && e.touches.length) return e.touches[0].clientY;
    if (e.changedTouches && e.changedTouches.length)
      return e.changedTouches[0].clientY;
    return e.clientY || 0;
  }
  function isDragAreaTarget(target) {
    let el = target;
    while (el && el !== panel) {
      if (el.dataset && el.dataset.dragArea === "1") return true;
      if (el.dataset && el.dataset.detailsScroll === "1") return false;
      el = el.parentElement;
    }
    return false;
  }
  function onPointerDown(e) {
    if (!currentStop) return;
    if (!isDragAreaTarget(e.target)) return;
    if (!isMobile()) return;
    dragActive = true;
    dragStartY = pointerY(e);
    dragLastY = dragStartY;
    dragStartTs = Date.now();
    panel.style.transition = "none";
  }
  function onPointerMove(e) {
    if (!dragActive) return;
    const y = pointerY(e);
    dragLastY = y;
    const dy = y - dragStartY;
    panel.style.transform = `translateY(${Math.max(0, dy)}px)`;
    if (backdrop && !backdrop.classList.contains("hidden") && dy > 0) {
      backdrop.style.opacity = String(Math.max(0, 1 - dy / 300));
    }
  }
  function onPointerUp() {
    if (!dragActive) return;
    dragActive = false;
    const dy = dragLastY - dragStartY;
    const dt = Date.now() - dragStartTs;
    const velocity = dt > 0 ? dy / dt : 0;
    panel.style.transition = "";
    panel.style.transform = "";
    if (backdrop) backdrop.style.opacity = "";

    // Swipe up significativo no estado mini → expande.
    if (panel.dataset.state === "mini" && (dy < -60 || velocity < -0.5)) {
      setState("expanded");
      return;
    }
    // Swipe down → expandido recolhe para mini; mini fecha.
    if (dy > 110 || (velocity > 0.6 && dy > 40)) {
      if (panel.dataset.state === "expanded") setState("mini");
      else close();
    }
  }
  function attachDragHandlers() {
    if (!panel) return;
    panel.addEventListener("touchstart", onPointerDown, { passive: true });
    panel.addEventListener("touchmove", onPointerMove, { passive: true });
    panel.addEventListener("touchend", onPointerUp, { passive: true });
    panel.addEventListener("touchcancel", onPointerUp, { passive: true });
    panel.addEventListener("pointerdown", onPointerDown);
    panel.addEventListener("pointermove", onPointerMove);
    panel.addEventListener("pointerup", onPointerUp);
    panel.addEventListener("pointercancel", onPointerUp);
  }
  function detachDragHandlers() {
    if (!panel) return;
    panel.removeEventListener("touchstart", onPointerDown);
    panel.removeEventListener("touchmove", onPointerMove);
    panel.removeEventListener("touchend", onPointerUp);
    panel.removeEventListener("touchcancel", onPointerUp);
    panel.removeEventListener("pointerdown", onPointerDown);
    panel.removeEventListener("pointermove", onPointerMove);
    panel.removeEventListener("pointerup", onPointerUp);
    panel.removeEventListener("pointercancel", onPointerUp);
  }

  // ─── AÇÕES PÚBLICAS ──────────────────────────────────────────────────
  function open(stop) {
    // Pinta de verde o fundo do logótipo desta paragem. Directo, pela mesma
    // razão que no mapa-station.js.
    if (stop && window.MapaSelecao) {
      const loc = Array.isArray(stop.location) ? stop.location : [];
      window.MapaSelecao.set({
        op: "cm",
        id: stop.id,
        name: stop.name || null,
        lat: typeof loc[0] === "number" ? loc[0] : null,
        lng: typeof loc[1] === "number" ? loc[1] : null,
      });
    }
    ensureElements();
    if (!panel || !backdrop || !stop) return;

    // Fecha outras sheets que partilham o mesmo painel.
    if (window.MapaDetails && window.MapaDetails.isOpen())
      window.MapaDetails.close();
    if (window.MapaStation && window.MapaStation.isOpen())
      window.MapaStation.close({ silent: true });

    currentStop = stop;
    activeLine = null;
    hub = null;
    selectedId = stop.id;
    applySelectionPaint();

    if (map && Array.isArray(stop.location)) {
      const [lat, lng] = stop.location;
      map.flyTo({
        center: [lng, lat],
        zoom: Math.max(map.getZoom(), 15.5),
        offset: isMobile() ? [0, -window.innerHeight * 0.2] : [-180, 0],
        speed: 1.1,
        essential: true,
      });
    }

    panel.innerHTML = shellHtml();
    attachShellListeners();

    // Abre MINIMIZADO (igual ao modal do comboio).
    panel.dataset.state = "mini";
    panel.classList.remove("translate-y-full");
    panel.classList.add("translate-y-0");
    backdrop.classList.remove("hidden");
    updateBackdropForState();

    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", onBackdropClick);
    attachDragHandlers();

    if (window.lucide) window.lucide.createIcons();

    renderArrivals();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(renderArrivals, ARRIVALS_REFRESH_MS);
  }

  function onBackdropClick() {
    close();
  }

  function close() {
    // Tira o verde da paragem. Aqui e não no window.MapaCM.close, porque os
    // handlers internos chamam esta função local directamente.
    if (window.MapaSelecao) window.MapaSelecao.clear();
    ensureElements();
    if (!panel || !backdrop) return;

    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (arrivalsAbort) {
      try {
        arrivalsAbort.abort();
      } catch (_) {}
      arrivalsAbort = null;
    }

    panel.classList.add("translate-y-full");
    panel.classList.remove("translate-y-0");
    panel.dataset.state = "closed";
    backdrop.classList.add("opacity-0", "pointer-events-none");
    backdrop.classList.remove("opacity-100");

    backdrop.removeEventListener("click", onBackdropClick);
    document.removeEventListener("keydown", onKey);
    detachDragHandlers();

    setTimeout(() => {
      backdrop.classList.add("hidden");
      if (panel.dataset.state === "closed") panel.innerHTML = "";
    }, 320);
    currentStop = null;
    activeLine = null;
    hub = null;
    selectedId = null;
    applySelectionPaint();

    //if (window.MapaRender) window.MapaRender.showWholeLine();
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }
  function isOpen() {
    // O modo estação não tem currentStop. Sem o hub aqui, os outros painéis
    // perguntavam isto, achavam a Carris fechada e abriam-se por cima dela.
    return !!currentStop || !!hub;
  }

  // Paragens verificadas já indexadas (após init) — usado pela pesquisa
  // (mapa-search.js) para não duplicar o gate AVAILABLE_STATIONS.
  function getStops() {
    return Array.from(stopsById.values());
  }

  // ═══════════════════════════════════════════════════════════════════
  //  MODO ESTAÇÃO — todas as paragens da Carris de uma estação da Fertagus
  // ═══════════════════════════════════════════════════════════════════
  //
  // Aberto a partir das ligações no percurso de um comboio. Junta as partidas
  // de todas as paragens da estação numa lista só, com filtro por carreira
  // (várias ao mesmo tempo) e, em cada partida, um botão que mostra no mapa a
  // paragem de onde sai.
  //
  // A API da Carris só dá partidas por paragem, uma de cada vez. Para não
  // levar com o limite de pedidos:
  //   - no máximo HUB_CONCORRENCIA pedidos em voo;
  //   - cada paragem fica em cache HUB_CACHE_MS — mudar o filtro, voltar a
  //     abrir ou mostrar uma paragem não pede nada à rede;
  //   - um 429 pára o resto dessa ronda, e as paragens que falharam ficam com
  //     as partidas que já tinham;
  //   - com o separador em segundo plano, o refresh não corre.
  // As paragens de cada estação vêm do ligacoes_atualizado.json (o bootup.js
  // actualiza-as a partir do CSV da Carris), portanto saber QUAIS são não
  // custa pedido nenhum.

  const HUB_CONCORRENCIA = 2;
  const HUB_CACHE_MS = 25_000;
  const cacheChegadas = new Map(); // id da paragem → { t, dados }
  let hub = null;

  const normNome = (v) =>
    String(v == null ? "" : v)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  function paragensDaEstacao(nome) {
    const alvo = normNome(nome);
    if (!alvo) return [];
    return getStops().filter((s) => normNome(s.station) === alvo);
  }

  async function buscarParagem(id, signal) {
    const c = cacheChegadas.get(id);
    if (c && Date.now() - c.t < HUB_CACHE_MS) return c.dados;
    const res = await fetch(
      `${CM_API_BASE}/arrivals/by_stop/${encodeURIComponent(id)}`,
      { cache: "no-store", signal },
    );
    if (!res.ok) {
      const e = new Error("HTTP " + res.status);
      e.status = res.status;
      throw e;
    }
    const dados = await res.json();
    const arr = Array.isArray(dados) ? dados : [];
    cacheChegadas.set(id, { t: Date.now(), dados: arr });
    return arr;
  }

  async function buscarTodas(ids, signal) {
    const fila = ids.slice();
    const res = new Map();
    const falhas = new Set();
    let limitado = false;
    async function trabalhador() {
      while (fila.length && !signal.aborted && !limitado) {
        const id = fila.shift();
        try {
          res.set(id, await buscarParagem(id, signal));
        } catch (e) {
          if (signal.aborted) return;
          if (e && e.status === 429) limitado = true;
          falhas.add(id);
        }
      }
    }
    const n = Math.min(HUB_CONCORRENCIA, fila.length);
    await Promise.all(Array.from({ length: n }, trabalhador));
    // As que ficaram por pedir depois de um 429 também contam como falhadas.
    for (const id of fila) falhas.add(id);
    return { res, falhas, limitado };
  }

  // As carreiras do ficheiro (para o filtro existir antes de a API responder)
  // MAIS as que aparecem nas partidas. Só do ficheiro, uma carreira nova da
  // Carris que ainda lá não estivesse aparecia na lista mas não dava para
  // filtrar.
  function hubLinhas() {
    const m = new Map();
    for (const p of hub.paragens) {
      for (const l of uniqueLines(p)) if (!m.has(l.id)) m.set(l.id, l);
    }
    for (const arr of hub.dados.values()) {
      for (const b of arr) {
        const id = b && b.line_id != null ? String(b.line_id) : "";
        if (!id || m.has(id)) continue;
        m.set(id, {
          id,
          name: id,
          color: normColor(b.route_color || "#18181b"),
        });
      }
    }
    return Array.from(m.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "pt", { numeric: true }),
    );
  }

  const PARAGEM_SVG =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6.5" y="2" width="11" height="8" rx="2"/><path d="M12 10v11"/><path d="M9 21h6"/></svg>';

  function paragemBtnHtml(p) {
    const ativa = hub && hub.paragemVista === p.id;
    return `<button type="button" data-cm-paragem="${escapeHtml(p.id)}"
      class="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-full border transition-colors ${
        ativa
          ? "bg-yellow-400 border-yellow-400 text-zinc-900"
          : "border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:border-zinc-500"
      }"
      title="Mostrar a paragem ${escapeHtml(p.nome)}" aria-label="Mostrar a paragem ${escapeHtml(p.nome)} no mapa">${PARAGEM_SVG}</button>`;
  }

  function hubChipsHtml() {
    const linhas = hubLinhas();
    if (!linhas.length) return "";
    const sel = hub.sel;
    const pills = linhas
      .map((l) => {
        const ativa = sel.has(l.id);
        const apagada = sel.size && !ativa;
        const style = ativa
          ? `background:${l.color};color:#fff;border-color:${l.color}`
          : `background:transparent;color:${l.color};border-color:${l.color}`;
        return `<button type="button" data-cm-hub-line="${escapeHtml(l.id)}" aria-pressed="${ativa}"
          class="px-2 py-1 text-[10px] font-extrabold tracking-widest border rounded-[3px] transition-all duration-150${apagada ? " opacity-35" : ""}"
          style="${style}">${escapeHtml(l.name)}</button>`;
      })
      .join("");
    const reset = sel.size
      ? `<button type="button" data-cm-hub-reset="1"
          class="px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">Todas</button>`
      : "";
    const rotulo = sel.size
      ? ` · ${sel.size} ${sel.size === 1 ? "seleccionada" : "seleccionadas"}`
      : "";
    return `
      <div class="mt-4">
        <p class="text-[9px] uppercase tracking-[0.25em] text-zinc-400 font-bold mb-2.5">Carreiras${rotulo}</p>
        <div class="flex flex-wrap items-center gap-1.5">${pills}${reset}</div>
      </div>`;
  }

  function hubHoraTxt() {
    const d = new Date(hub.fromTs * 1000);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function hubFromBarHtml() {
    if (!hub.fromTs) return "";
    return `
      <div class="mt-4 flex items-center gap-2 pl-3 pr-1 py-1.5 rounded-lg border border-blue-500/35 bg-blue-500/10 text-blue-700 dark:text-blue-300">
        <span class="flex-1 text-[10px] font-bold uppercase tracking-[0.14em]">Partidas a partir das ${hubHoraTxt()}</span>
        <button type="button" data-cm-hub-from-clear="1" aria-label="Mostrar todas as partidas"
          class="w-6 h-6 inline-flex items-center justify-center rounded-full opacity-70 hover:opacity-100">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>`;
  }

  function shellHubHtml() {
    const n = hub.paragens.length;
    return `
      <div class="flex flex-col h-full bg-white dark:bg-[#09090b]">
        <div class="dp-handle md:hidden shrink-0" data-drag-area="1" aria-hidden="true">
          <div class="dp-handle-pill"></div>
        </div>
        <div class="dp-header relative shrink-0 px-6 pt-3 md:pt-safe-ios md:pt-5 pb-5 border-b border-zinc-100 dark:border-zinc-900" data-drag-area="1">
          <button data-cm-action="close"
            class="absolute right-4 top-3 md:top-5 w-10 h-10 flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
            aria-label="Fechar"><i data-lucide="x" class="w-5 h-5"></i></button>
          <div class="flex items-center gap-2 mb-3">
            <img src="${CM_LOGO_LIGHT}" alt="" class="w-5 h-5 object-contain cm-logo-light"/>
            <img src="${CM_LOGO_DARK}" alt="" class="w-5 h-5 object-contain cm-logo-dark"/>
            <span class="text-[9px] font-bold tracking-[0.3em] uppercase text-yellow-500">Carris Metropolitana</span>
            <span class="h-px flex-1 max-w-16 bg-zinc-200 dark:bg-zinc-800"></span>
          </div>
          <h2 class="text-2xl font-light tracking-tighter text-zinc-900 dark:text-white leading-[1.1] pr-12">${escapeHtml(hub.nome)}</h2>
          <p class="text-[9px] uppercase tracking-[0.25em] text-zinc-400 font-bold mt-2">${n} ${n === 1 ? "paragem" : "paragens"} da estação</p>
          ${hubFromBarHtml()}
          ${hubChipsHtml()}
        </div>
        <div class="px-5 pt-4 shrink-0">
          <p class="text-[9px] uppercase tracking-[0.25em] text-zinc-400 font-bold mb-3 px-1">Próximas Partidas</p>
          <div data-cm-arrivals="1">${skeletonHtml()}</div>
        </div>
      </div>`;
  }

  // Desenha a lista a partir do que já está em memória. Mudar o filtro, fechar
  // o aviso da hora ou mostrar uma paragem passa por aqui — sem rede.
  function hubDesenharLista() {
    if (!hub || !panel) return;
    const target = panel.querySelector("[data-cm-arrivals]");
    if (!target) return;
    const now = Math.floor(Date.now() / 1000);
    const corte = Math.max(now - 30, hub.fromTs || 0);
    const cores = {};
    for (const l of hubLinhas()) cores[l.id] = l.color;
    const porId = new Map(hub.paragens.map((p) => [p.id, p]));

    let todas = [];
    for (const [id, arr] of hub.dados) {
      const p = porId.get(id);
      if (!p) continue;
      for (const b of arr) {
        const ts = b.estimated_arrival_unix || b.scheduled_arrival_unix;
        if (!ts || ts < corte) continue;
        if (hub.sel.size && !hub.sel.has(String(b.line_id))) continue;
        todas.push({
          ...b,
          ts,
          live: !!b.estimated_arrival_unix,
          _p: { id, nome: p.name },
        });
      }
    }
    todas = todas.sort((a, b) => a.ts - b.ts).slice(0, ARRIVALS_LIMIT);

    const expanded = panel.dataset.state === "expanded";
    const nota = hubNotaHtml();
    if (!todas.length) {
      const semNada = hub.dados.size === 0 && hub.falhas.size > 0;
      target.innerHTML =
        stateMsg(
          semNada
            ? "Sem ligação ao servidor"
            : hub.sel.size
              ? "Sem partidas nestas carreiras"
              : hub.fromTs
                ? `Sem partidas depois das ${hubHoraTxt()}`
                : "Sem previsões",
          semNada ? "wifi-off" : null,
        ) +
        nota +
        `<div class="dp-expanded-content">${footerNoteHtml()}</div>`;
      if (window.lucide) window.lucide.createIcons();
      return;
    }
    const visiveis = todas.slice(0, MINI_ARRIVALS);
    const resto = todas.slice(MINI_ARRIVALS);
    let html = visiveis
      .map((b, i) =>
        arrivalRowHtml(
          b,
          now,
          cores,
          i < visiveis.length - 1 || resto.length > 0,
          b._p,
        ),
      )
      .join("");
    if (resto.length) {
      html += toggleWrapHtml(expanded);
      html += `<div class="dp-expanded-content">`;
      html += resto
        .map((b, i) =>
          arrivalRowHtml(b, now, cores, i < resto.length - 1, b._p),
        )
        .join("");
      html += nota + footerNoteHtml() + `</div>`;
    } else {
      html += `<div class="dp-expanded-content">${nota}${footerNoteHtml()}</div>`;
    }
    target.innerHTML = html;
    attachToggleListener();
    target.querySelectorAll("[data-cm-paragem]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        mostrarParagem(btn.dataset.cmParagem);
      });
    });
    if (window.lucide) window.lucide.createIcons();
  }

  function hubNotaHtml() {
    if (!hub.falhas.size) return "";
    const txt = hub.limitado
      ? "A Carris está a limitar pedidos; algumas paragens mostram os dados anteriores."
      : `${hub.falhas.size} ${hub.falhas.size === 1 ? "paragem sem resposta" : "paragens sem resposta"}; a mostrar o que chegou.`;
    return `<p class="text-[10px] text-zinc-400 px-1 pt-3">${escapeHtml(txt)}</p>`;
  }

  async function hubAtualizar() {
    if (!hub) return;
    if (typeof document !== "undefined" && document.hidden) return;
    if (arrivalsAbort) {
      try {
        arrivalsAbort.abort();
      } catch (_) {}
    }
    arrivalsAbort = new AbortController();
    const signal = arrivalsAbort.signal;
    const eu = hub;
    const r = await buscarTodas(
      eu.paragens.map((p) => p.id),
      signal,
    );
    if (signal.aborted || hub !== eu) return;
    // Uma paragem que falhou fica com o que já tinha, em vez de desaparecer.
    const antes = hubLinhas().length;
    for (const [id, arr] of r.res) eu.dados.set(id, arr);
    eu.falhas = r.falhas;
    eu.limitado = r.limitado;
    // Carreiras novas vindas da API: os chips também têm de as ter.
    if (hubLinhas().length !== antes) hubRedesenharTudo();
    else hubDesenharLista();
  }

  function hubRedesenharTudo() {
    if (!panel || !hub) return;
    const estado = panel.dataset.state;
    panel.innerHTML = shellHubHtml();
    panel.dataset.state = estado;
    hubLigarCabecalho();
    if (window.lucide) window.lucide.createIcons();
    hubDesenharLista();
  }

  function hubLigarCabecalho() {
    panel
      .querySelectorAll("[data-cm-action='close']")
      .forEach((b) => b.addEventListener("click", () => close()));
    // Várias carreiras ao mesmo tempo: tocar acrescenta ou tira. Sem nenhuma
    // escolhida, mostram-se todas.
    panel.querySelectorAll("[data-cm-hub-line]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.cmHubLine;
        if (hub.sel.has(id)) hub.sel.delete(id);
        else hub.sel.add(id);
        hubRedesenharTudo();
      });
    });
    const reset = panel.querySelector("[data-cm-hub-reset]");
    if (reset)
      reset.addEventListener("click", () => {
        hub.sel.clear();
        hubRedesenharTudo();
      });
    const semHora = panel.querySelector("[data-cm-hub-from-clear]");
    if (semHora)
      semHora.addEventListener("click", () => {
        hub.fromTs = null;
        hubRedesenharTudo();
      });
  }

  // Mostra no mapa a paragem de uma partida, sem fechar a lista.
  function mostrarParagem(id) {
    const stop = stopsById.get(String(id));
    if (!stop || !hub) return;
    hub.paragemVista = stop.id;
    const [lat, lng] = stop.location;
    if (window.MapaSelecao) {
      window.MapaSelecao.set({
        op: "cm",
        id: stop.id,
        name: stop.name,
        lat,
        lng,
      });
    }
    selectedId = stop.id;
    applySelectionPaint();
    if (map) {
      map.flyTo({
        center: [lng, lat],
        zoom: Math.max(map.getZoom(), 17),
        offset: isMobile() ? [0, -window.innerHeight * 0.2] : [-180, 0],
        speed: 1.1,
        essential: true,
      });
    }
    hubDesenharLista(); // só para marcar o botão desta paragem
  }

  // Enquadra todas as paragens da estação, para se ver onde fica cada uma.
  function hubEnquadrar() {
    if (!map || typeof maplibregl === "undefined" || !hub.paragens.length)
      return;
    try {
      const b = new maplibregl.LngLatBounds();
      for (const p of hub.paragens) b.extend([p.location[1], p.location[0]]);
      const mob = isMobile();
      map.fitBounds(b, {
        padding: {
          top: 70,
          left: 40,
          right: mob ? 40 : 420,
          bottom: mob ? Math.round(window.innerHeight * 0.45) : 60,
        },
        maxZoom: 17,
        duration: 800,
        essential: true,
      });
    } catch (_) {}
  }

  /**
   * Abre as partidas de todas as paragens da Carris de uma estação.
   * @param {string} nome  nome da estação da Fertagus
   * @param {{fromTime?: number}} opts  fromTime em ms: só partidas a partir daí
   * @returns {boolean} false se a estação não tiver paragens conhecidas
   */
  function openEstacao(nome, opts) {
    ensureElements();
    if (!panel || !backdrop) return false;
    const paragens = paragensDaEstacao(nome);
    if (!paragens.length) return false;

    if (window.MapaDetails && window.MapaDetails.isOpen())
      window.MapaDetails.close();
    if (window.MapaStation && window.MapaStation.isOpen())
      window.MapaStation.close({ silent: true });

    const ft = opts && opts.fromTime;
    currentStop = null;
    activeLine = null;
    hub = {
      nome: paragens[0].station || nome,
      paragens,
      sel: new Set(),
      // Uma hora já passada não filtra nada — como no painel dos intermodais.
      fromTs:
        typeof ft === "number" && isFinite(ft) && ft > Date.now() + 60000
          ? Math.floor(ft / 1000)
          : null,
      dados: new Map(),
      falhas: new Set(),
      limitado: false,
      paragemVista: null,
    };
    // O que já estiver em cache aparece logo, sem esperar pela rede.
    for (const p of paragens) {
      const c = cacheChegadas.get(p.id);
      if (c && Date.now() - c.t < HUB_CACHE_MS) hub.dados.set(p.id, c.dados);
    }
    if (window.MapaSelecao) window.MapaSelecao.clear();
    selectedId = null;
    applySelectionPaint();

    panel.innerHTML = shellHubHtml();
    hubLigarCabecalho();
    panel.dataset.state = "mini";
    panel.classList.remove("translate-y-full");
    panel.classList.add("translate-y-0");
    backdrop.classList.remove("hidden");
    updateBackdropForState();
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", onBackdropClick);
    attachDragHandlers();
    if (window.lucide) window.lucide.createIcons();

    hubEnquadrar();
    if (hub.dados.size) hubDesenharLista();
    hubAtualizar();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(hubAtualizar, ARRIVALS_REFRESH_MS);
    return true;
  }

  window.MapaCM = {
    init,
    open,
    close,
    isOpen,
    getStops,
    openEstacao,
    paragensDaEstacao,
    _hub: () => hub,
  };
})();

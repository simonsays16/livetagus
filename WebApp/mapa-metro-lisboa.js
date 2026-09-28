/**
 * mapa-metro-lisboa.js
 * Metro de Lisboa: linhas + estações (com popup de detalhe).
 *
 * Visibilidade no mapa: este ficheiro define também o controlador partilhado
 * window.MapaView (botão do "olho" + menu) que liga/desliga "ml" e "mts" e
 * persiste a escolha em localStorage["mapview"] (ex.: "ml,mts"). A Carris
 * Metropolitana e a Fertagus estão SEMPRE visíveis (não entram no toggle).
 */

(function () {
  "use strict";

  const ML_SHAPE_PATH = "/geojson/metro-shape.geojson";
  const ML_STATIONS_PATH = "/geojson/estacoes-metro.geojson";

  // Clicar numa estação abre a sheet de próximas partidas (mapa-gtfs-horarios.js)
  // em vez do popup. O popup fica no ficheiro como fallback: se o módulo não
  // estiver carregado, ou com esta flag em false, volta ao comportamento antigo.
  const USE_GTFS_PANEL = true;

  let mlShapeData = null;
  let mlStationsData = null;

  // ═══════════════════════════════════════════════════════════════════
  //  CONTROLADOR DE VISIBILIDADE PARTILHADO (window.MapaView) + BOTÃO OLHO
  //  Definido aqui; o mapa-mts.js apenas o consome (window.MapaView).
  // ═══════════════════════════════════════════════════════════════════
  function ensureMapaView() {
    if (window.MapaView) return window.MapaView;

    const KEY = "mapview";
    // Registo de grupos já mostrados ao utilizador. Guardar isto à parte
    // permite distinguir "desligou" de "este grupo ainda não existia quando a
    // preferência foi gravada" — sem esta chave, uma camada nova desligada
    // voltava a ligar-se no arranque seguinte.
    const KEY_KNOWN = "mapview_known";
    const TOGGLEABLE = ["ml", "mts"]; // cm e fertagus ficam sempre
    const DEFAULT = ["ml", "mts"];
    const LABELS = { ml: "Metro de Lisboa", mts: "Metro Sul (Almada)" };
    const DOTS = { ml: "#e2231a", mts: "#6cc24a" };

    const listeners = [];
    let visible = load();

    function load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw == null) return new Set(DEFAULT);
        const parts = raw
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter((g) => TOGGLEABLE.includes(g));
        return new Set(parts);
      } catch (_) {
        return new Set(DEFAULT);
      }
    }
    function persist() {
      try {
        localStorage.setItem(KEY, Array.from(visible).join(","));
      } catch (_) {}
    }
    function isVisible(g) {
      return visible.has(g);
    }
    function getVisible() {
      return new Set(visible);
    }
    function notify() {
      const snap = getVisible();
      listeners.forEach((fn) => {
        try {
          fn(snap);
        } catch (_) {}
      });
    }
    function set(g, on) {
      if (!TOGGLEABLE.includes(g)) return;
      if (on) visible.add(g);
      else visible.delete(g);
      persist();
      syncMenu();
      notify();
    }
    function toggle(g) {
      set(g, !visible.has(g));
    }

    function knownGroups() {
      try {
        const raw = localStorage.getItem(KEY_KNOWN);
        return raw
          ? new Set(
              raw
                .split(",")
                .map((x) => x.trim().toLowerCase())
                .filter(Boolean),
            )
          : new Set();
      } catch (_) {
        return new Set();
      }
    }
    function markKnown(g) {
      try {
        const set = knownGroups();
        set.add(g);
        localStorage.setItem(KEY_KNOWN, Array.from(set).join(","));
      } catch (_) {}
    }

    // Permite a outros módulos (mapa-cp.js, por ex.) acrescentarem uma camada
    // ao menu do olho sem editar este ficheiro.
    function register(group, opts) {
      const g = String(group == null ? "" : group)
        .trim()
        .toLowerCase();
      if (!g) return;
      if (!TOGGLEABLE.includes(g)) TOGGLEABLE.push(g);
      LABELS[g] = (opts && opts.label) || LABELS[g] || g;
      DOTS[g] = (opts && opts.dot) || DOTS[g] || "#71717a";
      const on = !(opts && opts.defaultOn === false);
      if (on && !DEFAULT.includes(g)) DEFAULT.push(g);

      // O load() inicial já correu e descartou este grupo por ser desconhecido.
      if (knownGroups().has(g)) {
        let inPref = false;
        try {
          const raw = localStorage.getItem(KEY);
          inPref =
            raw != null &&
            raw
              .split(",")
              .map((x) => x.trim().toLowerCase())
              .includes(g);
        } catch (_) {}
        if (inPref) visible.add(g);
        else visible.delete(g);
      } else {
        if (on) visible.add(g);
        markKnown(g);
        persist();
      }

      rebuildMenu();
      syncMenu();
      notify();
    }

    function rebuildMenu() {
      if (!menuEl) return;
      menuEl.innerHTML = `
        <p class="lt-eye-title">Mostrar no mapa</p>
        ${TOGGLEABLE.map(rowHtml).join("")}
        <p class="lt-eye-foot">Fertagus e Carris sempre visíveis.</p>`;
      menuEl.querySelectorAll("[data-view-group]").forEach((row) => {
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          toggle(row.getAttribute("data-view-group"));
        });
      });
      if (window.lucide) window.lucide.createIcons();
    }
    function onChange(fn) {
      if (typeof fn !== "function") return;
      listeners.push(fn);
      try {
        fn(getVisible());
      } catch (_) {}
    }

    // ── UI: botão + menu ──────────────────────────────────────────────
    let menuEl = null;
    function injectStyles() {
      if (document.getElementById("lt-mapview-styles")) return;
      const css = `
        /* Mesmo visual do botão "perto de mim" (mapa-perto.js): faz parte da
           mesma pilha no canto superior direito, e o "top" é atribuído pelo
           MapaPerto.layout(). O fallback do top serve para o caso de o
           mapa-perto.js não estar carregado. */
        .lt-eye-btn {
          position: fixed; right: .75rem;
          top: calc(env(safe-area-inset-top, 0px) + 4.75rem);
          z-index: 15; width: 42px; height: 42px;
          display: inline-flex; align-items: center; justify-content: center;
          border: 1px solid rgba(228,228,231,.5);
          background: rgba(255,255,255,.8);
          -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
          border-radius: 9999px; box-shadow: 0 1px 2px rgba(0,0,0,.06);
          color: #18181b; cursor: pointer;
          transition: box-shadow .2s ease, transform .15s ease, background .2s ease;
        }
        html.dark .lt-eye-btn {
          border-color: rgba(255,255,255,.06);
          background: rgba(9,9,11,.8); color: #fff;
        }
        .lt-eye-btn:hover { box-shadow: 0 4px 12px rgba(0,0,0,.1); }
        .lt-eye-btn:active { transform: scale(.94); }
        .lt-eye-btn svg { width: 1.05rem; height: 1.05rem; }

        .lt-eye-menu {
          position: fixed; right: .75rem; z-index: 16; width: 14rem;
          border: 1px solid rgb(228 228 231); background: rgba(255,255,255,.97);
          -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
          border-radius: .75rem; box-shadow: 0 10px 25px -5px rgba(0,0,0,.15);
          padding: .75rem;
        }
        html.dark .lt-eye-menu { border-color: rgb(39 39 42); background: rgba(9,9,11,.97); }
        /* Sem o top do MapaPerto.layout(), o menu cai por baixo do botão. */
        .lt-eye-menu:not([style*="top"]) { top: calc(env(safe-area-inset-top, 0px) + 8.25rem); }
        .lt-eye-menu.lt-hidden { display: none; }
        .lt-eye-title { font-size: 9px; font-weight: 700; letter-spacing: .3em; text-transform: uppercase; color: #71717a; margin: 0 0 .5rem .25rem; }
        .lt-eye-row {
          display: flex; align-items: center; gap: .6rem; width: 100%;
          padding: .5rem; border: none; background: transparent; cursor: pointer;
          border-radius: .25rem; color: inherit;
        }
        .lt-eye-row:hover { background: rgba(0,0,0,.04); }
        html.dark .lt-eye-row:hover { background: rgba(255,255,255,.06); }
        .lt-eye-dot { width: .6rem; height: .6rem; border-radius: 9999px; flex-shrink: 0; }
        .lt-eye-label { flex: 1; text-align: left; font-size: 12px; font-weight: 600; color: #27272a; }
        html.dark .lt-eye-label { color: #e4e4e7; }
        .lt-eye-row:not(.lt-on) .lt-eye-label { color: #a1a1aa; }
        .lt-eye-check { width: 1rem; height: 1rem; color: #10b981; opacity: 0; transition: opacity .15s; }
        .lt-eye-row.lt-on .lt-eye-check { opacity: 1; }
        .lt-eye-foot { margin: .5rem .25rem 0; font-size: 9px; letter-spacing: .04em; color: #a1a1aa; }
      `;
      const s = document.createElement("style");
      s.id = "lt-mapview-styles";
      s.innerHTML = css;
      document.head.appendChild(s);
    }

    function rowHtml(group) {
      return `
        <button class="lt-eye-row" data-view-group="${group}">
          <span class="lt-eye-dot" style="background:${DOTS[group]}"></span>
          <span class="lt-eye-label">${LABELS[group]}</span>
          <i data-lucide="check" class="lt-eye-check"></i>
        </button>`;
    }

    function buildUI() {
      injectStyles();
      const host =
        (document.getElementById("btn-legend") &&
          document.getElementById("btn-legend").parentElement) ||
        (document.getElementById("map") &&
          document.getElementById("map").parentElement) ||
        document.body;

      const btn = document.createElement("button");
      btn.className = "lt-eye-btn";
      btn.id = "btn-mapview";
      btn.setAttribute("aria-label", "Mostrar/esconder camadas");
      btn.innerHTML = `<i data-lucide="eye"></i>`;

      menuEl = document.createElement("div");
      menuEl.className = "lt-eye-menu lt-hidden";
      menuEl.id = "mapview-menu";
      menuEl.innerHTML = `
        <p class="lt-eye-title">Mostrar no mapa</p>
        ${TOGGLEABLE.map(rowHtml).join("")}
        <p class="lt-eye-foot">Fertagus e Carris sempre visíveis.</p>`;

      host.appendChild(btn);
      host.appendChild(menuEl);
      // Entra na pilha de botões flutuantes; o MapaPerto decide as posições.
      if (window.MapaPerto && window.MapaPerto.layout)
        window.MapaPerto.layout();

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        // Reposiciona antes de mostrar: o header pode ter mudado de altura.
        if (window.MapaPerto && window.MapaPerto.layout)
          window.MapaPerto.layout();
        menuEl.classList.toggle("lt-hidden");
      });
      menuEl.querySelectorAll("[data-view-group]").forEach((row) => {
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          toggle(row.getAttribute("data-view-group"));
        });
      });
      document.addEventListener("click", (e) => {
        if (menuEl.classList.contains("lt-hidden")) return;
        if (e.target === btn || btn.contains(e.target)) return;
        if (!menuEl.contains(e.target)) menuEl.classList.add("lt-hidden");
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") menuEl.classList.add("lt-hidden");
      });

      syncMenu();
      if (window.lucide) window.lucide.createIcons();
    }

    function syncMenu() {
      if (!menuEl) return;
      menuEl.querySelectorAll("[data-view-group]").forEach((row) => {
        const g = row.getAttribute("data-view-group");
        row.classList.toggle("lt-on", visible.has(g));
      });
    }

    // DOM já está pronto (scripts com defer); construir o botão.
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", buildUI, { once: true });
    } else {
      buildUI();
    }

    window.MapaView = {
      isVisible,
      getVisible,
      set,
      toggle,
      onChange,
      register,
      groups: () => TOGGLEABLE.slice(),
      KEY,
    };
    return window.MapaView;
  }

  ensureMapaView();

  // ═══════════════════════════════════════════════════════════════════
  //  POPUP DE ESTAÇÃO (partilhado com mapa-mts via CSS guardado por id)
  // ═══════════════════════════════════════════════════════════════════
  function injectMetroPopupStyles() {
    if (document.getElementById("lt-metro-popup-styles")) return;
    const popupStyles = `
    .zara-metro-popup .maplibregl-popup-content {
        padding: 0 !important;
        border-radius: 0px !important;
        border: 1px solid #e4e4e7 !important;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05) !important;
        background: #ffffff !important;
        font-family: "Open Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        overflow: hidden !important;
        min-width: 220px;
    }
    .zara-metro-popup .maplibregl-popup-close-button {
        color: #a1a1aa !important; font-size: 18px !important; padding: 2px 8px !important;
        right: 0 !important; top: 6px !important; z-index: 10 !important;
        transition: color 0.2s ease; background: transparent !important; border: none !important;
    }
    .zara-metro-popup .maplibregl-popup-close-button:hover { color: #000 !important; background: transparent !important; }
    .zara-metro-popup .zara-top-bar { height: 4px; width: 100%; }
    .zara-metro-popup .zara-content { padding: 18px 32px 18px 20px; display: flex; align-items: center; gap: 16px; }
    .zara-metro-popup .zara-icon-wrapper { width: 35px; height: 35px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
    .zara-metro-popup .zara-icon { width: 100%; height: 100%; object-fit: contain; }
    .zara-metro-popup .zara-text { display: flex; flex-direction: column; justify-content: center; }
    .zara-metro-popup .zara-title { font-size: 14px; font-weight: 700; color: #09090b; margin: 0; letter-spacing: -0.01em; text-transform: uppercase; }
    .zara-metro-popup .zara-subtitle { font-size: 11px; font-weight: 400; color: #71717a; margin: 4px 0 0 0; text-transform: uppercase; letter-spacing: 0.06em; }
    .zara-metro-popup.maplibregl-popup-anchor-bottom .maplibregl-popup-tip { border-top-color: #ffffff !important; }
    .zara-metro-popup.maplibregl-popup-anchor-top .maplibregl-popup-tip { border-bottom-color: #e4e4e7 !important; }
    `;
    const styleEl = document.createElement("style");
    styleEl.id = "lt-metro-popup-styles";
    styleEl.innerHTML = popupStyles;
    document.head.appendChild(styleEl);
  }
  injectMetroPopupStyles();

  const metroColors = {
    Azul: "#4E84C4",
    Amarela: "#F4BC18",
    Verde: "#00AAA6",
    Vermelha: "#DF096F",
  };

  function getMLColors(linhaStr) {
    if (!linhaStr) return ["#1e293b"];
    const colors = [];
    if (linhaStr.includes("Azul")) colors.push(metroColors["Azul"]);
    if (linhaStr.includes("Amarela")) colors.push(metroColors["Amarela"]);
    if (linhaStr.includes("Verde")) colors.push(metroColors["Verde"]);
    if (linhaStr.includes("Vermelha")) colors.push(metroColors["Vermelha"]);
    return colors.length > 0 ? colors : ["#1e293b"];
  }

  function getMLSubtitle(linhaStr) {
    if (!linhaStr) return "Metro de Lisboa";
    const cleaned = linhaStr.replace(/\[|\]/g, "").trim();
    return "Linha " + cleaned;
  }

  function getTopBarGradient(colors) {
    if (colors.length === 0) return "background: #000;";
    if (colors.length === 1) return `background: ${colors[0]};`;
    if (colors.length === 2)
      return `background: linear-gradient(to right, ${colors[0]} 50%, ${colors[1]} 50%);`;
    if (colors.length === 3)
      return `background: linear-gradient(to right, ${colors[0]} 33.3%, ${colors[1]} 33.3%, ${colors[1]} 66.6%, ${colors[2]} 66.6%);`;
    return `background: ${colors[0]};`;
  }

  // Um único popup de metro de cada vez (partilhado ML/MTS via window).
  function closeMetroPopup() {
    if (window.__ltMetroPopup) {
      try {
        window.__ltMetroPopup.remove();
      } catch (_) {}
      window.__ltMetroPopup = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  INTERCEÇÃO DO MAPA → desenhar ML
  // ═══════════════════════════════════════════════════════════════════
  function patchMapaRender() {
    if (!window.MapaRender) return false;
    if (window.MapaRender._mlPatched) return true;
    const originalSetMap = window.MapaRender.setMap;
    window.MapaRender.setMap = function (map) {
      // .call(this, …) preserva o receptor: há vários módulos a envolver este
      // método em cadeia (MTS, Metro, selecção, guardadas).
      if (originalSetMap) originalSetMap.call(this, map);
      initML(map);
    };
    window.MapaRender._mlPatched = true;
    return true;
  }
  if (!patchMapaRender()) {
    const timer = setInterval(() => {
      if (patchMapaRender()) clearInterval(timer);
    }, 20);
  }

  const ML_LAYERS = [
    "ml-lines-casing",
    "ml-lines-color",
    "ml-stations-points",
    "ml-stations-labels",
  ];
  function applyMlLayerVisibility(map, on) {
    const v = on ? "visible" : "none";
    ML_LAYERS.forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
    });
    // Esconder a camada fecha a sheet, mas só se for a do Metro de Lisboa.
    if (!on && window.GtfsHorarios && window.GtfsHorarios.operator() === "ml")
      window.GtfsHorarios.close();
  }

  // ─── ORDEM DAS CAMADAS ──────────────────────────────────────────────
  //
  // Estas camadas devem ficar ABAIXO da linha da Fertagus. O problema é de
  // tempo: o mapa.js chama MapaRender.setMap() logo depois de criar o mapa, mas
  // a "fertagus-line-casing" só é criada no drawLine(), depois do "load" e do
  // fetch do line.json. O "styledata" dispara muito antes, e o addLayer do
  // MapLibre ATIRA quando o beforeId não existe:
  //
  //   Error: Cannot add layer "ml-lines-casing" before non-existing layer
  //          "fertagus-line-casing"
  //
  // ... e a camada nunca chegava a ser adicionada — as linhas e as estações
  // simplesmente não apareciam, dependendo de qual fetch ganhava a corrida.
  // Solução: se a referência ainda não existir, adiciona por cima e reordena
  // assim que ela aparecer.
  const BELOW_ID = "fertagus-line-casing";
  const pendingOrder = [];

  function addLayerBelow(map, def, beforeId) {
    try {
      if (beforeId && map.getLayer(beforeId)) {
        map.addLayer(def, beforeId);
      } else {
        map.addLayer(def);
        if (beforeId) pendingOrder.push(def.id);
      }
    } catch (e) {
      console.warn("[Metro Lisboa] camada", def.id, "falhou:", e && e.message);
    }
  }

  // As etiquetas das estações não levam beforeId: são texto e devem ficar SEMPRE
  // no topo. Sem isto, ao reordenar as outras camadas as etiquetas acabavam por
  // baixo das linhas — diferente do que acontece quando não há corrida.
  const KEEP_ON_TOP = ["ml-stations-labels"];

  // Reordena as camadas em espera. A ordem relativa entre elas mantém-se,
  // porque são movidas na ordem em que foram criadas.
  function flushLayerOrder(map) {
    if (!pendingOrder.length || !map.getLayer(BELOW_ID)) return;
    for (const id of pendingOrder) {
      if (!map.getLayer(id)) continue;
      try {
        map.moveLayer(id, BELOW_ID);
      } catch (_) {}
    }
    pendingOrder.length = 0;
    for (const id of KEEP_ON_TOP) {
      if (!map.getLayer(id)) continue;
      try {
        map.moveLayer(id);
      } catch (_) {}
    }
  }

  function watchLayerOrder(map) {
    if (map._ltMlOrder) return;
    map._ltMlOrder = true;
    const check = () => flushLayerOrder(map);
    map.on("styledata", check);
    map.on("load", check);
  }

  // ─── MARCADOR DAS ESTAÇÕES ──────────────────────────────────────────
  // Diâmetros idênticos aos do círculo anterior (raio 3/5/8 → 6/10/16 px). Se
  // o logótipo não carregar, volta ao círculo.
  const STATION_ICON = "ml-logo-icon";
  const STATION_LOGO = "/imagens/lig-logos/metro.svg";
  // Hierarquia de tamanhos no mapa (diâmetro em px). A Fertagus é sempre a
  // maior — é a razão de ser da app e tem de ter destaque:
  //   zoom        8    12    15    18
  //   Fertagus    8    12    18    26   (não muda, e nunca esbatida)
  //   Metro/CP   12    15    20    30   ← escolha explícita: ficou o maior
  //   Carris      –     –    14    20     marcador do mapa
  // A opacidade nunca chega a zero: mais esbatido ao longe, opaco de perto,
  // mas presente em qualquer zoom.
  // Nome da estação só com muito zoom: aos 15 já se distingue rua a rua, e
  // antes disso as etiquetas empilhavam-se umas sobre as outras.
  // Ver a nota em mapa-icones.js: o servidor de glyphs deste estilo não tem
  // "Open Sans Bold", e um fontstack em falta não desenha texto nem dá erro.
  const LABEL_FONT = (window.MapaIcones && window.MapaIcones.FONT) || [
    "Open Sans Semibold",
  ];
  const LABEL_MINZOOM = 14;
  // Os operadores intermodais só aparecem a partir daqui. Abaixo disto o mapa
  // fica limpo e as paragens não são sequer clicáveis — o minzoom trata das
  // duas coisas, porque o MapLibre não consulta uma camada que não desenha.
  // (Opacidade a zero não servia: as features continuavam a responder ao rato.)
  // As paragens guardadas e as estações da Fertagus não têm este limite.
  const STATIONS_MINZOOM = 13;
  const STATION_FADE = ["interpolate", ["linear"], ["zoom"], 13, 0.55, 15, 1];
  const STATION_ICON_SEL = STATION_ICON + "-sel";
  let iconReady = false;

  // Duas variantes do mesmo logótipo: fundo branco e fundo verde. Trocar a
  // imagem é mais barato do que uma segunda camada por baixo, e o verde fica
  // ATRÁS do logótipo, que é o que se quer.
  function ensureIcons(map) {
    if (!window.MapaIcones) return Promise.resolve(false);
    const green = (window.MapaSelecao && window.MapaSelecao.GREEN) || "#22C55E";
    return Promise.all([
      window.MapaIcones.ensure(map, { id: STATION_ICON, url: STATION_LOGO }),
      window.MapaIcones.ensure(map, {
        id: STATION_ICON_SEL,
        url: STATION_LOGO,
        bgColor: green,
      }),
    ]).then((r) => r[0] && r[1]);
  }

  // Pinta a estação seleccionada. Tem de ser chamada outra vez sempre que a
  // camada é recriada — o MapLibre não guarda expressões de camadas mortas.
  function applySelection(map, sel) {
    const layer = map && map.getLayer("ml-stations-points");
    if (!layer) return;
    const mine = sel && sel.op === "ml" ? sel : null;
    const expr = window.MapaSelecao
      ? window.MapaSelecao.matchExpr(mine, ["nome_destino", "id_destino"])
      : false;
    const green = (window.MapaSelecao && window.MapaSelecao.GREEN) || "#22C55E";
    try {
      if (layer.type === "symbol") {
        map.setLayoutProperty("ml-stations-points", "icon-image", [
          "case",
          expr,
          STATION_ICON_SEL,
          STATION_ICON,
        ]);
      } else {
        map.setPaintProperty("ml-stations-points", "circle-color", [
          "case",
          expr,
          green,
          "#FFFFFF",
        ]);
      }
    } catch (e) {
      console.warn("[ml] selecção falhou:", e && e.message);
    }
  }

  function stationLayerDef() {
    if (iconReady && window.MapaIcones) {
      return {
        id: "ml-stations-points",
        type: "symbol",
        source: "ml-stations",
        minzoom: STATIONS_MINZOOM,
        layout: {
          "icon-image": STATION_ICON,
          "icon-size": window.MapaIcones.sizeExpr([
            [8, 12],
            [12, 15],
            [15, 20],
            [18, 30],
          ]),
          // Sem colisão: o círculo também não colidia, e as estações não se
          // podem esconder umas às outras.
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: { "icon-opacity": STATION_FADE },
      };
    }
    return {
      id: "ml-stations-points",
      type: "circle",
      source: "ml-stations",
      minzoom: STATIONS_MINZOOM,
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8,
          3.5,
          12,
          5.5,
          15,
          8,
          18,
          11,
        ],
        "circle-color": "#FFFFFF",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#000000",
        "circle-opacity": STATION_FADE,
        "circle-stroke-opacity": STATION_FADE,
      },
    };
  }

  // Definida dentro do initML, quando o mapa já é conhecido.
  let carregar = () => {};
  let mlLoading = null;
  // Arranque automático atrás do portão da Fertagus (ver mapa-render.js).
  // Sem portão (outra página, ou ordem de scripts diferente), corre já.
  const depoisDaFertagus = (fn) =>
    window.LTArranque ? window.LTArranque.depois(fn) : fn();

  function initML(map) {
    // Reagir às mudanças de visibilidade. É também aqui que os dados são
    // pedidos pela PRIMEIRA vez: quem tem o Metro escondido não descarrega
    // ficheiro nenhum do Metro.
    if (window.MapaView) {
      window.MapaView.onChange((vis) => {
        const on = vis.has("ml");
        if (on) depoisDaFertagus(() => carregar(map));
        applyMlLayerVisibility(map, on);
        if (!on) closeMetroPopup();
      });
    } else {
      // Sem menu de camadas não há como esconder nada: carrega tudo.
      depoisDaFertagus(() => carregar(map));
    }

    const addLayers = () => {
      watchLayerOrder(map);
      if (!map.getSource("ml-lines"))
        map.addSource("ml-lines", { type: "geojson", data: mlShapeData });
      if (mlStationsData && !map.getSource("ml-stations"))
        map.addSource("ml-stations", { type: "geojson", data: mlStationsData });

      // 1. CASING
      if (!map.getLayer("ml-lines-casing")) {
        addLayerBelow(
          map,
          {
            id: "ml-lines-casing",
            type: "line",
            source: "ml-lines",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": "#000000",
              "line-width": [
                "interpolate",
                ["linear"],
                ["zoom"],
                10,
                0,
                14,
                7.0,
                18,
                12.0,
              ],
              "line-opacity": 0.9,
            },
          },
          BELOW_ID,
        );
      }

      // 2. COR DA LINHA
      if (!map.getLayer("ml-lines-color")) {
        addLayerBelow(
          map,
          {
            id: "ml-lines-color",
            type: "line",
            source: "ml-lines",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": ["get", "colour"],
              "line-width": [
                "interpolate",
                ["linear"],
                ["zoom"],
                10,
                0,
                14,
                4.5,
                18,
                8.5,
              ],
              "line-opacity": 1.0,
            },
          },
          BELOW_ID,
        );
      }

      // 3. ESTAÇÕES
      // Logótipo com fundo branco em vez do círculo (mapa-icones.js).
      if (!map.getLayer("ml-stations-points")) {
        addLayerBelow(map, stationLayerDef(), BELOW_ID);
      }

      // 4. LABELS
      if (!map.getLayer("ml-stations-labels")) {
        map.addLayer({
          id: "ml-stations-labels",
          type: "symbol",
          source: "ml-stations",
          minzoom: LABEL_MINZOOM,
          layout: {
            "text-field": ["get", "nome_destino"],
            "text-font": LABEL_FONT,
            "text-size": ["interpolate", ["linear"], ["zoom"], 14, 11, 18, 14],
            // AO LADO do logótipo. O offset é em ems do text-size: 1.2 em a 14 px
            // dá ~17 px, mais do que o raio do ícone (15 px ao zoom 18).
            "text-offset": [1.2, 0],
            "text-anchor": "left",
            "text-max-width": 9,
          },
          paint: {
            "text-color": "#1e293b",
            "text-halo-color": "#ffffff",
            "text-halo-width": 2,
          },
        });
      }

      // Selecção: aplica já o estado actual e volta a aplicar sempre que muda.
      // O unsubscribe não é preciso — a camada vive tanto quanto a página.
      if (window.MapaSelecao && !map._ltSel_ml) {
        map._ltSel_ml = true;
        window.MapaSelecao.register((sel) => applySelection(map, sel));
      } else if (window.MapaSelecao) {
        applySelection(map, window.MapaSelecao.current());
      }
      // Aplicar a visibilidade atual logo após criar as camadas.
      applyMlLayerVisibility(
        map,
        !window.MapaView || window.MapaView.isVisible("ml"),
      );

      // --- CLIQUE NA ESTAÇÃO → SHEET DE PARTIDAS (ou popup, em fallback) ---
      function handleStationClick(e) {
        if (!e.features || e.features.length === 0) return;
        const feature = e.features[0];
        const props = feature.properties;

        if (USE_GTFS_PANEL && window.GtfsHorarios) {
          closeMetroPopup();
          window.GtfsHorarios.open(props, { operator: "ml" });
          return;
        }

        const name = props.nome_destino || "Estação";
        const linhaStr = props.linha || "";
        const subtitle = getMLSubtitle(linhaStr);
        const colors = getMLColors(linhaStr);
        const gradient = getTopBarGradient(colors);

        const html = `
          <div class="zara-top-bar" style="${gradient}"></div>
          <div class="zara-content">
            <div class="zara-icon-wrapper">
              <img class="zara-icon" src="/imagens/lig-logos/metro.svg" alt="Metro" onerror="this.style.display='none'">
            </div>
            <div class="zara-text">
              <h3 class="zara-title">${name}</h3>
              <p class="zara-subtitle">${subtitle}</p>
            </div>
          </div>`;

        closeMetroPopup();
        let coords = feature.geometry.coordinates;
        if (Array.isArray(coords[0])) coords = e.lngLat;

        window.__ltMetroPopup = new maplibregl.Popup({
          closeButton: true,
          closeOnClick: true,
          className: "zara-metro-popup",
          offset: 12,
        })
          .setLngLat(coords)
          .setHTML(html)
          .addTo(map);
      }

      map.on("click", "ml-stations-points", handleStationClick);
      map.on(
        "mouseenter",
        "ml-stations-points",
        () => (map.getCanvas().style.cursor = "pointer"),
      );
      map.on(
        "mouseleave",
        "ml-stations-points",
        () => (map.getCanvas().style.cursor = ""),
      );
    };

    // Só é chamada quando a camada é ligada, e só corre uma vez.
    carregar = function () {
      if (mlLoading) return mlLoading;
      mlLoading = Promise.all([
        fetch(ML_SHAPE_PATH).then((r) => r.json()),
        fetch(ML_STATIONS_PATH).then((r) => r.json()),
        // Os ícones entram na mesma espera, para o addLayers já saber se os pode
        // usar. São dois: fundo branco e fundo verde (seleccionada).
        ensureIcons(map),
      ])
        .then(([mlShape, mlStations, hasIcon]) => {
          mlShapeData = mlShape;
          mlStationsData = mlStations;
          iconReady = !!hasIcon;
          if (map.isStyleLoaded()) addLayers();
          else map.once("styledata", addLayers);
        })
        .catch((err) => {
          mlLoading = null; // deixa tentar outra vez ao religar a camada
          console.error("[Metro Lisboa] Erro ao carregar dados:", err);
        });
      return mlLoading;
    };

    // Se a camada já estava ligada quando a página abriu, o onChange acima já
    // disparou antes de o carregar existir — daí esta segunda tentativa.
    if (!window.MapaView || window.MapaView.isVisible("ml"))
      depoisDaFertagus(() => carregar(map));
  }
})();

/**
 * mapa-guardadas.js · LiveTagus (mapa)
 * As paragens que o utilizador guardou na página /paragens, mostradas no mapa.
 *
 * A página /paragens guarda-as em localStorage["cm_saved_stops"] como
 * { id, name, addedAt, availableLines, hiddenLines } — sem coordenadas. Aqui as
 * coordenadas são resolvidas por id em duas fontes, pela ordem:
 *
 *   1. window.MapaCM.getStops()  — paragens verificadas junto às estações
 *      Fertagus, já com a forma completa que a sheet Carris espera (lines com
 *      cor, gmapslink, estação de referência).
 *   2. /json/stops_cm.json       — catálogo completo da Carris Metropolitana,
 *      para paragens guardadas fora dessa área. A sheet abre igual; só os chips
 *      de linha ficam de fora, porque este ficheiro não traz as cores.
 *
 * Ao contrário da camada Carris normal (só a partir do zoom 13, são milhares de
 * postes), estas ficam SEMPRE visíveis e com o nome ao lado: são poucas, são as
 * do utilizador, e a ideia é encontrá-las sem procurar.
 *
 * API: window.MapaGuardadas.getStops() | refresh() | count()
 *
 * Inclusão: <script src="./mapa-guardadas.js" defer></script> (depois do mapa-cm.js)
 */

(function () {
  "use strict";
  if (window.MapaGuardadas) return;

  const STORAGE_KEY = "cm_saved_stops"; // mesma chave que o paragens.js
  const STOPS_JSON = "/json/stops_cm.json";
  const SRC = "lt-saved";
  const L_HALO = "lt-saved-halo";
  const L_DOT = "lt-saved-dot";
  const L_LABEL = "lt-saved-label";
  const CM_YELLOW = "#FFDD00";

  let map = null;
  let catalog = null; // Map id -> { id, name, lines, location }
  let catalogPromise = null;
  let resolved = []; // paragens guardadas já com coordenadas

  // ─── LEITURA DO LOCALSTORAGE ─────────────────────────────────────────
  function readSaved() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      return list
        .filter((s) => s && s.id)
        .map((s) => ({
          id: String(s.id),
          name: s.name || `Paragem ${s.id}`,
          availableLines: Array.isArray(s.availableLines)
            ? s.availableLines
            : [],
          addedAt: s.addedAt || 0,
        }));
    } catch (e) {
      console.warn("[MapaGuardadas] localStorage ilegível:", e && e.message);
      return [];
    }
  }

  // ─── CATÁLOGO CARRIS (fallback para paragens fora da área verificada) ──
  function loadCatalog() {
    if (catalog) return Promise.resolve(catalog);
    if (catalogPromise) return catalogPromise;
    catalogPromise = fetch(STOPS_JSON)
      .then((r) => (r.ok ? r.json() : null))
      .then((list) => {
        const m = new Map();
        for (const s of list || []) {
          if (!s || !s.id || !Array.isArray(s.c)) continue;
          const [lat, lng] = s.c;
          if (typeof lat !== "number" || typeof lng !== "number") continue;
          m.set(String(s.id), {
            id: String(s.id),
            name: s.n || `Paragem ${s.id}`,
            lines: Array.isArray(s.l) ? s.l : [],
            location: [lat, lng],
          });
        }
        catalog = m;
        return m;
      })
      .catch((e) => {
        console.warn("[MapaGuardadas] catálogo indisponível:", e && e.message);
        catalog = new Map();
        return catalog;
      });
    return catalogPromise;
  }

  // ─── RESOLUÇÃO ───────────────────────────────────────────────────────
  function verifiedById() {
    const m = new Map();
    if (window.MapaCM && typeof window.MapaCM.getStops === "function") {
      for (const s of window.MapaCM.getStops() || []) m.set(String(s.id), s);
    }
    return m;
  }

  function resolve() {
    const saved = readSaved();
    if (!saved.length) {
      resolved = [];
      return Promise.resolve(resolved);
    }
    const verified = verifiedById();
    const missing = saved.filter((s) => !verified.has(s.id));

    const step = missing.length ? loadCatalog() : Promise.resolve(catalog);
    return step.then((cat) => {
      const out = [];
      for (const s of saved) {
        const v = verified.get(s.id);
        if (v) {
          // Forma completa: a sheet Carris tem tudo o que precisa.
          out.push({
            id: s.id,
            name: s.name || v.name, // o nome pode ter sido editado pelo utilizador
            officialName: v.name, // ... mas o original continua pesquisável
            location: v.location,
            lines: v.lines || [],
            gmapslink: v.gmapslink || "",
            station: v.station || "",
            source: "verified",
          });
          continue;
        }
        const c = cat && cat.get(s.id);
        if (c) {
          out.push({
            id: s.id,
            name: s.name || c.name,
            officialName: c.name,
            location: c.location,
            // Strings simples: o mapa-cm.js ignora-as (espera line-id/route-color)
            // e a sheet mostra as linhas que vierem da API de partidas.
            lines: [],
            lineNames: c.lines,
            gmapslink: "",
            station: "",
            source: "catalog",
          });
          continue;
        }
        console.warn(
          `[MapaGuardadas] paragem guardada ${s.id} ("${s.name}") sem coordenadas conhecidas.`,
        );
      }
      resolved = out;
      return out;
    });
  }

  // ─── CAMADA ──────────────────────────────────────────────────────────
  function collection() {
    return {
      type: "FeatureCollection",
      features: resolved.map((s) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.location[1], s.location[0]] },
        properties: { id: s.id, name: s.name },
      })),
    };
  }

  function ensureLayers() {
    if (!map) return false;
    try {
      if (!map.getSource(SRC))
        map.addSource(SRC, { type: "geojson", data: collection() });

      // O anel verde da selecção (mapa-selecao.js) tem de continuar por cima.
      const before = map.getLayer("lt-sel-glow") ? "lt-sel-glow" : undefined;

      if (!map.getLayer(L_HALO)) {
        map.addLayer(
          {
            id: L_HALO,
            type: "circle",
            source: SRC,
            paint: {
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                8,
                7,
                13,
                11,
                17,
                16,
              ],
              "circle-color": CM_YELLOW,
              "circle-opacity": 0.22,
              "circle-blur": 0.2,
            },
          },
          before,
        );
      }
      if (!map.getLayer(L_DOT)) {
        map.addLayer(
          {
            id: L_DOT,
            type: "circle",
            source: SRC,
            paint: {
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                8,
                4,
                13,
                6,
                17,
                9,
              ],
              "circle-color": CM_YELLOW,
              "circle-stroke-width": 2,
              "circle-stroke-color": "#18181b",
            },
          },
          before,
        );
      }
      if (!map.getLayer(L_LABEL)) {
        map.addLayer(
          {
            id: L_LABEL,
            type: "symbol",
            source: SRC,
            minzoom: 12.5,
            layout: {
              "text-field": ["get", "name"],
              // Ver a nota em mapa-icones.js: o servidor de glyphs deste estilo
              // não tem "Open Sans Bold", e um fontstack em falta não desenha
              // texto nem dá erro na consola.
              "text-font": (window.MapaIcones && window.MapaIcones.FONT) || [
                "Open Sans Semibold",
              ],
              "text-size": ["interpolate", ["linear"], ["zoom"], 12.5, 10, 18, 13],
              "text-offset": [0, 1.25],
              "text-anchor": "top",
              "text-max-width": 9,
              "text-allow-overlap": false,
            },
            paint: {
              "text-color": "#3f3f46",
              "text-halo-color": "#ffffff",
              "text-halo-width": 1.6,
            },
          },
          before,
        );
      }

      if (!map._ltSavedClick) {
        map.on("click", L_DOT, onStopClick);
        map.on("mouseenter", L_DOT, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", L_DOT, () => {
          map.getCanvas().style.cursor = "";
        });
        map._ltSavedClick = true;
      }
      return true;
    } catch (e) {
      console.warn("[MapaGuardadas] camada falhou:", e && e.message);
      return false;
    }
  }

  function onStopClick(e) {
    const f = e.features && e.features[0];
    if (!f) return;
    const stop = resolved.find((s) => s.id === String(f.properties.id));
    if (stop) openStop(stop);
  }

  function openStop(stop) {
    if (window.MapaCM && typeof window.MapaCM.open === "function") {
      window.MapaCM.open(stop);
      return;
    }
    // Sem a sheet Carris disponível, ao menos centra e marca.
    if (window.MapaSelecao)
      window.MapaSelecao.set({
        lng: stop.location[1],
        lat: stop.location[0],
        id: stop.id,
        op: "guardadas",
      });
  }

  function push() {
    if (!map) return;
    if (!ensureLayers()) return;
    const src = map.getSource(SRC);
    if (src && src.setData) src.setData(collection());
  }

  // Texto legível no tema escuro.
  function applyTheme() {
    if (!map || !map.getLayer(L_LABEL)) return;
    const dark = document.documentElement.classList.contains("dark");
    try {
      map.setPaintProperty(L_LABEL, "text-color", dark ? "#e4e4e7" : "#3f3f46");
      map.setPaintProperty(
        L_LABEL,
        "text-halo-color",
        dark ? "#09090b" : "#ffffff",
      );
    } catch (_) {}
  }

  // ─── ARRANQUE ────────────────────────────────────────────────────────
  function init(m) {
    map = m;
    const start = () => {
      refresh();
      applyTheme();
    };
    if (map.isStyleLoaded()) start();
    else map.once("styledata", start);

    // Mudança de tema recria o estilo → volta a desenhar.
    map.on("styledata", () => {
      if (resolved.length) push();
      applyTheme();
    });
  }

  function refresh() {
    return resolve().then(() => {
      push();
      return resolved;
    });
  }

  function patchMapaRender() {
    if (!window.MapaRender) return false;
    if (window.MapaRender._savedPatched) return true;
    const orig = window.MapaRender.setMap;
    window.MapaRender.setMap = function (m) {
      if (orig) orig.call(this, m);
      init(m);
    };
    window.MapaRender._savedPatched = true;
    return true;
  }
  if (!patchMapaRender()) {
    const t = setInterval(() => {
      if (patchMapaRender()) clearInterval(t);
    }, 20);
  }

  // As paragens Carris verificadas chegam de forma assíncrona (mapa-cm.js faz
  // fetch das ligações), por isso vale a pena tentar outra vez pouco depois.
  setTimeout(() => {
    if (map) refresh();
  }, 2500);

  // Guardar/remover noutro separador, ou voltar a esta página.
  window.addEventListener("storage", (e) => {
    if (!e.key || e.key === STORAGE_KEY) refresh();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  window.addEventListener("lt:saved-stops-changed", refresh);

  window.MapaGuardadas = {
    getStops: () => resolved.slice(),
    refresh,
    count: () => resolved.length,
    open: openStop,
  };
})();

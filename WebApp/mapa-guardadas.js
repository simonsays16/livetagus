/**
 * mapa-guardadas.js · LiveTagus (mapa)
 * As paragens que o utilizador guardou na página /paragens, mostradas no mapa.
 *
 * A lista e os dados vêm do paragens-guardadas.js (window.LTParagens): as
 * escolhas em localStorage["cm_saved_stops"] e, comprimidos, os dados da API
 * (nome oficial, coordenadas e linhas com cores). Cada paragem é resolvida
 * por id, pela ordem:
 *
 *   1. window.MapaCM.getStops()  — paragens verificadas junto às estações
 *      Fertagus (estação de referência incluída).
 *   2. LTParagens.asLigacao(id)  — os dados guardados da paragem, já com a
 *      mesma forma das ligações (linhas com cor → chips na sheet Carris).
 *   3. /data/json/stops_cm.json  — catálogo local, para paragens cujos dados
 *      ainda não chegaram (sem rede ao guardar). Aqui sem cores de linha.
 *
 * Link direto: /mapa#paragem=<id> abre a sheet dessa paragem (usado na
 * página /paragens, "Ver no mapa").
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
  const STOPS_JSON = "/data/json/stops_cm.json";
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
    if (window.LTParagens) return window.LTParagens.list();
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

    const P = window.LTParagens;
    const guardadas = P
      ? Promise.all(missing.map((s) => P.asLigacao(s.id).catch(() => null)))
      : Promise.resolve([]);
    return guardadas.then((lig) => {
      const porId = new Map();
      missing.forEach((s, i) => lig[i] && porId.set(s.id, lig[i]));
      const faltam = missing.some((s) => !porId.has(s.id));
      return (faltam ? loadCatalog() : Promise.resolve(catalog)).then((cat) => [
        cat,
        porId,
      ]);
    }).then(([cat, porId]) => {
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
        const g = porId.get(s.id);
        if (g) {
          out.push({
            id: s.id,
            name: s.name || g.name,
            officialName: g.name,
            location: g.location,
            lines: g.lines,
            gmapslink: g.gmapslink,
            station: "",
            source: "saved",
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
        geometry: {
          type: "Point",
          coordinates: [s.location[1], s.location[0]],
        },
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
              "text-size": [
                "interpolate",
                ["linear"],
                ["zoom"],
                12.5,
                10,
                18,
                13,
              ],
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
    // Atrás do portão da Fertagus (ver mapa-render.js); sem ele, corre já.
    const start = () => {
      const correr = () => {
        refresh();
        applyTheme();
      };
      if (window.LTArranque) window.LTArranque.depois(correr);
      else correr();
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
      abrirDoLink();
      return resolved;
    });
  }

  // /mapa#paragem=<id> → abre a paragem guardada (uma vez).
  let linkTratado = false;
  function abrirDoLink() {
    if (linkTratado) return;
    const m = /^#paragem=([^&]+)/.exec(window.location.hash || "");
    if (!m) {
      linkTratado = true;
      return;
    }
    const id = decodeURIComponent(m[1]);
    const stop = resolved.find((s) => s.id === id);
    if (!stop) return; // ainda a resolver: tenta no próximo refresh
    linkTratado = true;
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch (_) {}
    if (map && stop.location) {
      try {
        map.jumpTo({ center: [stop.location[1], stop.location[0]], zoom: Math.max(map.getZoom(), 15) });
      } catch (_) {}
    }
    openStop(stop);
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

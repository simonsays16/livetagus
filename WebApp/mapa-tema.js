/**
 * mapa-tema.js · LiveTagus (mapa)
 * Basemap do mapa e tema claro/escuro.
 *
 * O basemap é vetorial (tiles PBF da OpenFreeMap), com um estilo por tema:
 *   claro  → data/map/claro.json
 *   escuro → data/map/escuro.json
 * Os estilos são nossos (estrutura inspirada no basemap da TML GO: estradas
 * apagadas para as linhas de transporte sobressaírem, ferrovia tracejada,
 * carreiras fluviais). ~46 camadas, sem edifícios 3D, pontos de interesse,
 * escudos de estrada nem sprite, com os nomes em português. Menos camadas a
 * desenhar em cada frame = menos bateria, e o estilo não muda sem sabermos.
 * Só os tiles e as fontes vêm de tiles.openfreemap.org.
 *
 * TROCA DE TEMA
 * map.setStyle() destrói todas as fontes e camadas, e o mapa-render, o
 * mapa-cm e outros não as voltam a criar. Por isso a troca usa a opção
 * transformStyle: o estilo novo recebe as fontes e camadas próprias do
 * antigo (tudo o que não é do basemap), por cima do basemap, como estavam.
 * Como o basemap tem a mesma fonte de tiles nos dois estilos, o MapLibre
 * aplica só a diferença: as camadas próprias nem chegam a ser recriadas.
 *
 * PLANO B
 * Se a OpenFreeMap falhar (estilo, TileJSON ou todos os tiles), o mapa passa
 * para o raster do OpenStreetMap que se usava antes, com o mesmo truque de
 * inversão para o tema escuro. As camadas próprias passam com o mesmo
 * transformStyle.
 *
 * API: window.MapaTema.estiloInicial() · isDark() · modo() · refresh()
 *
 * Inclusão: <script src="./mapa-tema.js" defer></script> (depois do mapa-render.js)
 */

(function () {
  "use strict";
  if (window.MapaTema) return;

  // MAPA é um const global do mapa-config.js (não fica em window).
  const CFG = (typeof MAPA !== "undefined" && MAPA.BASEMAP) || {};
  const ESTILOS = CFG.estilos || {
    light: "/data/map/claro.json",
    dark: "/data/map/escuro.json",
  };
  const RASTER_TILES =
    CFG.raster || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const GLYPHS =
    CFG.glyphs || "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

  // Fontes do basemap (vetorial e raster). Tudo o resto é das camadas próprias.
  const FONTES_BASE = new Set(["openmaptiles", "basemap"]);
  const BASEMAP_LAYER = "basemap-layer";

  // Plano B: só se a OpenFreeMap falhar a sério, não por um tile isolado.
  const TILES_FALHADOS_MAX = 6;

  // Inversão do raster para o tema escuro (só no plano B). Ver a história no
  // histórico do ficheiro: brilho mínimo > máximo inverte a luminância, e o
  // hue-rotate devolve as cores ao sítio.
  const ESCURO = {
    "raster-brightness-min": 1,
    "raster-brightness-max": 0,
    "raster-hue-rotate": 180,
    "raster-saturation": -0.45,
    "raster-contrast": -0.12,
  };
  const CLARO = {
    "raster-brightness-min": 0,
    "raster-brightness-max": 1,
    "raster-hue-rotate": 0,
    "raster-saturation": 0,
    "raster-contrast": 0,
  };

  let map = null;
  let modo = "vetor"; // "vetor" | "raster"
  let aplicado = null; // tema que está no basemap: "dark" | "light"
  let ultimoAnunciado = null;
  let observando = false;
  let tilesOk = 0;
  let tilesFalhados = 0;

  function isDark() {
    return document.documentElement.classList.contains("dark");
  }
  function temaAlvo() {
    return isDark() ? "dark" : "light";
  }

  // ─── ESTILOS ─────────────────────────────────────────────────────────
  function estiloRaster() {
    return {
      version: 8,
      glyphs: GLYPHS,
      sources: {
        basemap: {
          type: "raster",
          tiles: [RASTER_TILES],
          tileSize: 256,
          maxzoom: 19,
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
        },
      },
      layers: [
        {
          id: BASEMAP_LAYER,
          type: "raster",
          source: "basemap",
          minzoom: 0,
          maxzoom: 22,
        },
      ],
    };
  }

  /** O estilo com que o mapa nasce (usado pelo mapa.js). */
  function estiloInicial() {
    aplicado = temaAlvo();
    return modo === "vetor" ? ESTILOS[aplicado] : estiloRaster();
  }

  function eDoBasemap(layer) {
    return (
      !layer ||
      layer.type === "background" ||
      FONTES_BASE.has(layer.source) ||
      layer.id === BASEMAP_LAYER
    );
  }

  // Passa as fontes e camadas próprias do estilo antigo para o novo, por
  // cima do basemap, pela mesma ordem.
  function transportar(antigo, novo) {
    if (!antigo) return novo;
    const sources = Object.assign({}, novo.sources);
    for (const [id, src] of Object.entries(antigo.sources || {})) {
      if (!FONTES_BASE.has(id) && !(id in sources)) sources[id] = src;
    }
    const proprias = (antigo.layers || []).filter((l) => !eDoBasemap(l));
    const ids = new Set((novo.layers || []).map((l) => l.id));
    return Object.assign({}, novo, {
      sources,
      layers: (novo.layers || []).concat(
        proprias.filter((l) => !ids.has(l.id)),
      ),
    });
  }

  function trocarEstilo(estilo) {
    try {
      map.setStyle(estilo, { transformStyle: transportar });
      return true;
    } catch (e) {
      console.warn("[MapaTema] troca de estilo falhou:", e && e.message);
      return false;
    }
  }

  // ─── TEMA ────────────────────────────────────────────────────────────
  function pintarRaster() {
    if (!map.getLayer(BASEMAP_LAYER)) return false;
    const props = aplicado === "dark" ? ESCURO : CLARO;
    try {
      for (const k in props) map.setPaintProperty(BASEMAP_LAYER, k, props[k]);
      return true;
    } catch (e) {
      console.warn("[MapaTema] não foi possível aplicar:", e && e.message);
      return false;
    }
  }

  function aplicar() {
    if (!map) return;
    const alvo = temaAlvo();
    if (modo === "raster") {
      aplicado = alvo;
      pintarRaster();
      return;
    }
    if (alvo === aplicado) return;
    // Mesmo estilo nos dois temas: nada a trocar no basemap.
    if (ESTILOS[alvo] === ESTILOS[aplicado]) {
      aplicado = alvo;
      return;
    }
    // Antes do primeiro carregamento, a troca espera por ele.
    if (!map.isStyleLoaded()) {
      map.once("idle", aplicar);
      return;
    }
    if (trocarEstilo(ESTILOS[alvo])) aplicado = alvo;
  }

  // As camadas próprias (Metro, CP, guardadas, linha Fertagus) adaptam as
  // cores no "styledata" e no evento lt:theme.
  function avisarCamadas() {
    try {
      if (map && map.fire) map.fire("styledata");
    } catch (_) {}
    try {
      window.dispatchEvent(
        new CustomEvent("lt:theme", { detail: { dark: isDark() } }),
      );
    } catch (_) {}
  }

  function onTemaMudou() {
    aplicar();
    const tema = temaAlvo();
    if (tema !== ultimoAnunciado) {
      ultimoAnunciado = tema;
      avisarCamadas();
    }
  }

  function observarTema() {
    if (observando) return;
    observando = true;
    try {
      const obs = new MutationObserver(onTemaMudou);
      obs.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
    } catch (_) {}
    try {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", onTemaMudou);
    } catch (_) {}
  }

  // ─── PLANO B ─────────────────────────────────────────────────────────
  function passarParaRaster(motivo) {
    if (modo === "raster" || !map) return;
    console.warn(
      "[MapaTema] OpenFreeMap indisponível (" +
        motivo +
        "); a usar o raster do OpenStreetMap.",
    );
    modo = "raster";
    aplicado = temaAlvo();
    trocarEstilo(estiloRaster());
    if (typeof window.sa_event === "function")
      window.sa_event("mapa_basemap_raster");
  }

  function vigiarFalhas() {
    map.on("error", (e) => {
      if (modo !== "vetor") return;
      const url = (e && e.error && (e.error.url || "")) || "";
      // O estilo (JSON) não carregou.
      if (/\/data\/map\//.test(url)) return passarParaRaster("estilo");
      if (e && e.sourceId === "openmaptiles") {
        // Sem tile = falhou o TileJSON (a lista de tiles).
        if (!e.tile) return passarParaRaster("TileJSON");
        tilesFalhados++;
        if (tilesOk === 0 && tilesFalhados >= TILES_FALHADOS_MAX)
          passarParaRaster("tiles");
      }
    });
    map.on("sourcedata", (e) => {
      if (e && e.sourceId === "openmaptiles" && e.tile) tilesOk++;
    });
  }

  // ─── ARRANQUE ────────────────────────────────────────────────────────
  function init(m) {
    map = m;
    ultimoAnunciado = temaAlvo();
    if (aplicado == null) aplicado = temaAlvo();
    vigiarFalhas();
    // No plano B, uma troca de estilo repõe a paint por omissão do raster.
    map.on("styledata", () => {
      if (modo === "raster") pintarRaster();
    });
    // Se o tema mudou enquanto o mapa carregava.
    map.once("load", aplicar);
    observarTema();
  }

  function patchMapaRender() {
    if (!window.MapaRender) return false;
    if (window.MapaRender._temaPatched) return true;
    const orig = window.MapaRender.setMap;
    window.MapaRender.setMap = function (m) {
      if (orig) orig.call(this, m);
      init(m);
    };
    window.MapaRender._temaPatched = true;
    return true;
  }
  if (!patchMapaRender()) {
    const t = setInterval(() => {
      if (patchMapaRender()) clearInterval(t);
    }, 20);
  }

  window.MapaTema = {
    isDark,
    estiloInicial,
    modo: () => modo,
    refresh: aplicar,
    // Para testar o plano B na consola: MapaTema._raster()
    _raster: () => passarParaRaster("manual"),
  };
})();

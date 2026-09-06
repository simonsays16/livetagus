/**
 * mapa-mts.js
 * Metro Sul do Tejo (MTS / Almada): linhas + estações no mapa.
 *
 * - Linhas:    /geojson/mts-shape-stops.geojson  (apenas LineStrings)
 * - Estações:  /geojson/mts-stations.geojson     (Points: id/name/lines/line_colors)
 *
 * Clicar numa estação abre a sheet de PRÓXIMAS PARTIDAS (window.MtsHorarios,
 * hoje um alias de window.GtfsHorarios em mapa-gtfs-horarios.js, alimentado
 * pelo bundle gtfs-departures do MTS) — mesmo visual das estações Fertagus.
 *
 * A visibilidade ("mts") é controlada pelo window.MapaView (mapa-metro-lisboa.js)
 * via botão do olho. Carregar este ficheiro DEPOIS do mapa-metro-lisboa.js.
 */

(function () {
  "use strict";

  const LINES_PATH = "/geojson/mts-shape-stops.geojson";
  const STATIONS_PATH = "/geojson/mts-stations.geojson";

  let linesData = null;
  let stationsData = null;

  // Deslocamento por linha (px): L1=+, L2=0, L3=- → em rede Y cada par fica separado.
  const offsetExpr = [
    "interpolate",
    ["linear"],
    ["zoom"],
    10,
    ["*", 3.0, ["match", ["get", "ref"], "1", 1, "3", -1, 0]],
    14,
    ["*", 3.5, ["match", ["get", "ref"], "1", 1, "3", -1, 0]],
    18,
    ["*", 4.0, ["match", ["get", "ref"], "1", 1, "3", -1, 0]],
  ];

  // ─── Esperar pelo MapaView ──────────────────────────────────────────
  function whenMapaView(cb) {
    if (window.MapaView) return cb(window.MapaView);
    const t = setInterval(() => {
      if (window.MapaView) {
        clearInterval(t);
        cb(window.MapaView);
      }
    }, 20);
  }

  // ─── Intercetar o mapa → desenhar MTS ───────────────────────────────
  function patchMapaRender() {
    if (!window.MapaRender) return false;
    if (window.MapaRender._mtsPatched) return true;
    const orig = window.MapaRender.setMap;
    window.MapaRender.setMap = function (map) {
      // .call(this, …) preserva o receptor: há vários módulos a envolver este
      // método em cadeia (MTS, Metro, selecção, guardadas).
      if (orig) orig.call(this, map);
      initMTS(map);
    };
    window.MapaRender._mtsPatched = true;
    return true;
  }
  if (!patchMapaRender()) {
    const t = setInterval(() => {
      if (patchMapaRender()) clearInterval(t);
    }, 20);
  }

  const MTS_LAYERS = [
    "mts-lines-casing",
    "mts-lines-color",
    "mts-stations-points",
    "mts-stations-labels",
  ];
  function applyVisibility(map, on) {
    const v = on ? "visible" : "none";
    MTS_LAYERS.forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
    });
    // Só fecha a sheet se for a do MTS — o painel é partilhado com o Metro.
    if (
      !on &&
      window.GtfsHorarios &&
      window.GtfsHorarios.operator() === "mts"
    )
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
  //   Error: Cannot add layer "mts-lines-casing" before non-existing layer
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
      console.warn("[MTS] camada", def.id, "falhou:", e && e.message);
    }
  }

  // As etiquetas não levam beforeId: são texto e devem ficar SEMPRE no topo.
  // Sem isto, ao reordenar as outras camadas acabavam por baixo das linhas.
  const KEEP_ON_TOP = ["mts-stations-labels"];

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
    if (map._ltMtsOrder) return;
    map._ltMtsOrder = true;
    const check = () => flushLayerOrder(map);
    map.on("styledata", check);
    map.on("load", check);
  }


  // ─── MARCADOR DAS ESTAÇÕES ──────────────────────────────────────────
  // Logótipo com fundo branco em vez do círculo branco. Os diâmetros são
  // exactamente os de antes (raio 3/5/8 → 6/10/16 px), e se o logótipo não
  // carregar mantém-se o círculo, para o mapa nunca ficar sem estações.
  const STATION_ICON = "mts-logo-icon";
  const STATION_LOGO = "/imagens/lig-logos/mts.svg";
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
    const layer = map && map.getLayer("mts-stations-points");
    if (!layer) return;
    const mine = sel && sel.op === "mts" ? sel : null;
    const expr = window.MapaSelecao
      ? window.MapaSelecao.matchExpr(mine, ["name", "id"])
      : false;
    const green = (window.MapaSelecao && window.MapaSelecao.GREEN) || "#22C55E";
    try {
      if (layer.type === "symbol") {
        map.setLayoutProperty("mts-stations-points", "icon-image", [
          "case",
          expr,
          STATION_ICON_SEL,
          STATION_ICON,
        ]);
      } else {
        map.setPaintProperty("mts-stations-points", "circle-color", [
          "case",
          expr,
          green,
          "#FFFFFF",
        ]);
      }
    } catch (e) {
      console.warn("[mts] selecção falhou:", e && e.message);
    }
  }

  function stationLayerDef() {
    if (iconReady && window.MapaIcones) {
      return {
        id: "mts-stations-points",
        type: "symbol",
        source: "mts-stations",
        minzoom: STATIONS_MINZOOM,
        layout: {
          "icon-image": STATION_ICON,
          "icon-size": window.MapaIcones.sizeExpr([
            [8, 12],
            [12, 15],
            [15, 20],
            [18, 30],
          ]),
          // Sem colisão: um círculo também não colidia, e as estações não se
          // podem esconder umas às outras.
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: { "icon-opacity": STATION_FADE },
      };
    }
    return {
      id: "mts-stations-points",
      type: "circle",
      source: "mts-stations",
      minzoom: STATIONS_MINZOOM,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3.5, 12, 5.5, 15, 8, 18, 11],
        "circle-color": "#FFFFFF",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#000000",
        "circle-opacity": STATION_FADE,
        "circle-stroke-opacity": STATION_FADE,
      },
    };
  }

  // Definida dentro do init, quando o mapa já é conhecido.
  let carregar = () => {};
  let mtsLoading = null;

  function initMTS(map) {
    whenMapaView((MV) => {
      MV.onChange((vis) => {
        // É aqui que os dados são pedidos pela primeira vez: quem tem o MTS
        // escondido não descarrega os ficheiros do MTS.
        if (vis.has("mts")) carregar();
        applyVisibility(map, vis.has("mts"));
      });
    });

    const addLayers = () => {
      watchLayerOrder(map);
      if (!map.getSource("mts-data"))
        map.addSource("mts-data", { type: "geojson", data: linesData });
      if (!map.getSource("mts-stations"))
        map.addSource("mts-stations", { type: "geojson", data: stationsData });

      // 1. CASING (preto)
      if (!map.getLayer("mts-lines-casing")) {
        addLayerBelow(
          map,
          {
            id: "mts-lines-casing",
            type: "line",
            source: "mts-data",
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
              "line-offset": offsetExpr,
            },
          },
          BELOW_ID,
        );
      }

      // 2. COR DA LINHA
      if (!map.getLayer("mts-lines-color")) {
        addLayerBelow(
          map,
          {
            id: "mts-lines-color",
            type: "line",
            source: "mts-data",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": ["get", "colour"],
              // Aparece e desaparece com o zoom, exactamente como no Metro de
              // Lisboa: largura 0 no zoom 10, cheia no 14. O casing já fazia
              // isto; a linha de cor começava em 2 px e ficava visível sozinha
              // ao longe, sem contorno nenhum por baixo.
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
              "line-offset": offsetExpr,
            },
          },
          BELOW_ID,
        );
      }

      // 3. ESTAÇÕES — logótipo com fundo branco (mapa-icones.js).
      if (!map.getLayer("mts-stations-points")) {
        addLayerBelow(map, stationLayerDef(), BELOW_ID);
      }

      // 4. NOMES — só com muito zoom. Sem beforeId: texto fica no topo.
      if (!map.getLayer("mts-stations-labels")) {
        try {
          map.addLayer({
            id: "mts-stations-labels",
            type: "symbol",
            source: "mts-stations",
            minzoom: LABEL_MINZOOM,
            layout: {
              "text-field": ["get", "name"],
              // Mesmo par de fontes das etiquetas do Metro: é o que existe no
              // glyph set deste estilo.
              "text-font": LABEL_FONT,
              "text-size": ["interpolate", ["linear"], ["zoom"], 14, 11, 18, 14],
              // AO LADO do logótipo. O offset é em ems do text-size: 1.2 em a
              // 14 px dá ~17 px, mais do que o raio do ícone (15 px ao zoom 18).
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
        } catch (e) {
          console.warn("[MTS] etiquetas falharam:", e && e.message);
        }
      }


      // Selecção: aplica já o estado actual e volta a aplicar sempre que muda.
      // O unsubscribe não é preciso — a camada vive tanto quanto a página.
      if (window.MapaSelecao && !map._ltSel_mts) {
        map._ltSel_mts = true;
        window.MapaSelecao.register((sel) => applySelection(map, sel));
      } else if (window.MapaSelecao) {
        applySelection(map, window.MapaSelecao.current());
      }
      applyVisibility(map, !window.MapaView || window.MapaView.isVisible("mts"));

      // --- CLIQUE NA ESTAÇÃO → SHEET DE PARTIDAS ---
      function onStationClick(e) {
        if (!e.features || !e.features.length) return;
        const p = e.features[0].properties || {};
        let lines = p.lines,
          colors = p.line_colors;
        if (typeof lines === "string") {
          try {
            lines = JSON.parse(lines);
          } catch (_) {
            lines = [];
          }
        }
        if (typeof colors === "string") {
          try {
            colors = JSON.parse(colors);
          } catch (_) {
            colors = [];
          }
        }
        const station = {
          id: p.id,
          name: p.name,
          lines: lines || [],
          line_colors: colors || [],
        };
        if (window.MtsHorarios) window.MtsHorarios.open(station);
        else console.warn("[MTS] window.MtsHorarios em falta");
      }

      map.on("click", "mts-stations-points", onStationClick);
      map.on(
        "mouseenter",
        "mts-stations-points",
        () => (map.getCanvas().style.cursor = "pointer"),
      );
      map.on(
        "mouseleave",
        "mts-stations-points",
        () => (map.getCanvas().style.cursor = ""),
      );
    };

    // Só corre quando a camada é ligada: quem tem o MTS escondido não
    // descarrega os ficheiros do MTS.
    carregar = function () {
      if (mtsLoading) return mtsLoading;
      mtsLoading = Promise.all([
      fetch(LINES_PATH).then((r) => r.json()),
      fetch(STATIONS_PATH).then((r) => r.json()),
      // Os ícones entram na mesma espera, para o addLayers já saber se os pode
      // usar. São dois: fundo branco e fundo verde (seleccionada).
      ensureIcons(map),
    ])
      .then(([lines, stations, hasIcon]) => {
        linesData = lines;
        stationsData = stations;
        iconReady = !!hasIcon;
        if (map.isStyleLoaded()) addLayers();
        else map.once("styledata", addLayers);
      })
      .catch((err) => {
        mtsLoading = null; // deixa tentar outra vez ao religar a camada
        console.error("[MTS] Erro ao carregar dados:", err);
      });
      return mtsLoading;
    };

    // Se a camada já estava ligada quando a página abriu, o onChange acima
    // disparou antes de o carregar existir — daí esta segunda tentativa.
    if (!window.MapaView || window.MapaView.isVisible("mts")) carregar();
  }
})();

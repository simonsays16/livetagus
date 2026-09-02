/**
 * mapa-cp.js · LiveTagus (mapa)
 * CP — Comboios de Portugal: linhas e estações no mapa.
 *
 * Ao contrário do Metro de Lisboa e do Metro Sul, que usam geojson feitos à mão
 * (/geojson/metro-shape.geojson, /geojson/mts-shape-stops.geojson), aqui TUDO
 * vem do bundle gtfs-departures — é a única fonte:
 *
 *   /resources/data/gtfs/cp-comboios-de-portugal-gtfs-departures/
 *     manifest.json        → mapa de recursos
 *     routes.json          → cor, nome e tipo de cada linha
 *     shapes/index.json    → geometrias, com route_ids e bbox por shape
 *     shapes/<id>.json     → FeatureCollection com um LineString
 *     stops/index.json     → estações servidas, com coordenadas
 *
 * UMA GEOMETRIA POR LINHA. Um feed nacional tem dezenas de variantes por linha
 * (reforços, comboios que ficam a meio, desvios) e desenhá-las todas dava um
 * emaranhado — além dos megabytes. Por isso escolhe-se uma só por grupo, a mais
 * comprida, que é a que representa a linha inteira. O agrupamento e o critério
 * estão em SHAPE_GROUP e SHAPE_PICK, em baixo.
 *
 * Clicar numa estação abre o painel de partidas (window.GtfsHorarios) com o
 * stop_id directo — o CP não precisa da correspondência por nome que o ML e o
 * MTS precisam, porque as estações no mapa SÃO as paragens do GTFS.
 *
 * Visibilidade: registada no botão do olho via window.MapaView.register("cp").
 * Os dados só são descarregados quando a camada está visível.
 *
 * Inclusão: <script src="./mapa-cp.js" defer></script> (depois do mapa-metro-lisboa.js)
 */

(function () {
  "use strict";
  if (window.MapaCP) return;

  // ═══ CONFIGURAÇÃO ══════════════════════════════════════════════════════
  const BUNDLE = "/resources/data/gtfs/cp-comboios-de-portugal-gtfs-departures";
  const VIEW_GROUP = "cp";
  const CP_COLOR = "#0075C9"; // cor de marca aproximada (o dot do menu do olho)

  // De onde vem a GEOMETRIA das linhas:
  //   "geojson" → /geojson/cp-lisboa-linhas.geojson: as quatro linhas da região
  //               de Lisboa desenhadas no OpenStreetMap, já sem as plataformas.
  //               62 KB, e é o âmbito certo para esta app.
  //   "bundle"  → shapes do gtfs-departures. Mantido porque é a única forma de
  //               ter a rede nacional, mas dá ~184 geometrias e muitos MB.
  // As ESTAÇÕES vêm sempre do bundle: é lá que estão os stop_id de que o painel
  // de partidas precisa.
  const LINES_SOURCE = "geojson";
  const LINES_GEOJSON = "/geojson/cp-lisboa-linhas.geojson";

  // O geojson cobre só Lisboa e o bundle traz as estações do país inteiro. Sem
  // este filtro ficavam centenas de estações sem linha nenhuma por baixo.
  const FILTER_STATIONS_TO_LINES = true;
  // Folgado de propósito: o ponto de uma estação no GTFS está muitas vezes na
  // entrada do edifício e não sobre a via. Incluir uma estação a mais é
  // inofensivo; fazer desaparecer uma verdadeira em silêncio não é.
  const STATION_MAX_DIST_M = 800;

  // Como agrupar as geometrias antes de escolher uma:
  //   "route"       → uma por route_id do GTFS. Atenção: num feed nacional
  //                   cada relação origem-destino é uma route diferente, por
  //                   isso isto pode dar dezenas de geometrias.
  //   "route_name"  → uma por nome de linha (Norte, Sado, Azambuja…). É o que
  //                   corresponde a "uma de cada tipo" no sentido humano.
  //   "route_type"  → uma por tipo de serviço (urbano, regional, longo curso).
  // O módulo escreve na consola quantas geometrias daria cada modo.
  const SHAPE_GROUP = "route";
  // Qual escolher dentro do grupo:
  //   "longest" → a de maior extensão (bbox), representa a linha inteira
  //   "busiest" → a que serve mais padrões de viagem
  const SHAPE_PICK = "longest";

  const FETCH_CONCURRENCY = 6; // ficheiros de shape em paralelo
  // Simplificação da geometria com o turf, se estiver disponível. Num mapa à
  // escala do país a diferença é invisível e corta muitos pontos.
  const SIMPLIFY_TOLERANCE = 0.0004; // ~40 m

  // Traço branco. Para voltar às cores próprias de cada linha basta trocar por
  // ["coalesce", ["get", "colour"], CP_COLOR] — tanto o geojson como o bundle
  // trazem "colour" em #RRGGBB.
  const LINE_COLOR = "#FFFFFF";

  // Largura do traço. Dois requisitos ao mesmo tempo:
  //
  // 1. Aparece e desaparece com o zoom, nos mesmos limiares do Metro de Lisboa
  //    e do MTS: 0 px no zoom 10, cheia no 14. Ao contrário deles, a CP é uma
  //    rede regional e antes desenhava-se já a partir do zoom 7.
  // 2. A borda preta é o branco + 3 px, ou seja 1,5 px de cada lado a partir do
  //    zoom 14. Antes eram 2 px e o traço mínimo era 1,2 px: no tema claro a
  //    borda caía abaixo de um pixel do ecrã e sobrava um traço branco em fundo
  //    branco. É a borda que faz o branco existir — se mexeres numa, mexe nas
  //    duas.
  //
  // No zoom 10 as duas são 0, senão a borda aparecia sozinha antes do traço.
  const LINE_BORDER = 3;
  const LINE_WIDTH = (extra) => [
    "interpolate",
    ["linear"],
    ["zoom"],
    10,
    0,
    14,
    4.2 + extra,
    18,
    7.0 + extra,
  ];

  const SRC_LINES = "cp-lines";
  const SRC_STATIONS = "cp-stations";
  const L_CASING = "cp-lines-casing";
  const L_COLOR = "cp-lines-color";
  const L_POINTS = "cp-stations-points";
  const L_LABELS = "cp-stations-labels";
  const LAYERS = [L_CASING, L_COLOR, L_POINTS, L_LABELS];
  const BELOW_ID = "fertagus-line-casing";

  // ═══ ESTADO ════════════════════════════════════════════════════════════
  let map = null;
  let loading = null; // Promise do carregamento (uma vez só)
  let lines = null; // FeatureCollection das geometrias escolhidas
  let stations = null; // FeatureCollection das estações
  let stopsById = new Map();
  const pendingOrder = [];
  // Estações que a CP partilha com a Fertagus. O marcador da CP fica escondido
  // nessas: os dois ficavam praticamente sobrepostos e o da CP, por baixo,
  // apanhava cliques que eram para a Fertagus. Quem lá está é o marcador da
  // Fertagus, com o selo da CP ao lado e o botão de troca no cabeçalho.
  // Continuam no getStations(), portanto continuam a aparecer na pesquisa.
  let sharedIds = [];

  // ═══ ORDEM DAS CAMADAS ═════════════════════════════════════════════════
  // Mesmo problema do mapa-mts.js: a "fertagus-line-casing" pode ainda não
  // existir (é criada no drawLine, depois do fetch do line.json) e o addLayer
  // atira se o beforeId não existir. Adiciona por cima e reordena depois.
  function addLayerBelow(def, beforeId) {
    try {
      if (beforeId && map.getLayer(beforeId)) {
        map.addLayer(def, beforeId);
      } else {
        map.addLayer(def);
        if (beforeId) pendingOrder.push(def.id);
      }
    } catch (e) {
      console.warn("[CP] camada", def.id, "falhou:", e && e.message);
    }
  }

  function flushLayerOrder() {
    if (!map || !pendingOrder.length || !map.getLayer(BELOW_ID)) return;
    for (const id of pendingOrder) {
      if (!map.getLayer(id)) continue;
      try {
        map.moveLayer(id, BELOW_ID);
      } catch (_) {}
    }
    pendingOrder.length = 0;
    // As etiquetas são texto: ficam sempre no topo.
    if (map.getLayer(L_LABELS)) {
      try {
        map.moveLayer(L_LABELS);
      } catch (_) {}
    }
  }

  // ═══ CARREGAMENTO ══════════════════════════════════════════════════════
  function getJSON(url) {
    return fetch(url, { credentials: "same-origin" }).then((r) => {
      if (!r.ok) throw new Error(`${r.status} em ${url}`);
      return r.json();
    });
  }

  // Diagonal do bbox [minLon, minLat, maxLon, maxLat], em graus. Serve só para
  // comparar extensões entre variantes da mesma linha.
  function bboxSpan(bbox) {
    if (!Array.isArray(bbox) || bbox.length < 4) return 0;
    const dx = (bbox[2] - bbox[0]) * Math.cos((bbox[1] * Math.PI) / 180);
    const dy = bbox[3] - bbox[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Uma geometria por grupo. Devolve [{ shapeId, meta }].
  function pickShapes(shapeIndex, routesById) {
    const groups = new Map();
    for (const shapeId in shapeIndex) {
      const meta = shapeIndex[shapeId];
      const routeId = (meta.route_ids && meta.route_ids[0]) || null;
      const route = routeId ? routesById.get(routeId) : null;
      let key;
      if (SHAPE_GROUP === "route_type") {
        key = route && route.route_type != null ? `t${route.route_type}` : "t?";
      } else if (SHAPE_GROUP === "route_name") {
        key =
          (route && (route.route_short_name || route.route_long_name)) ||
          routeId ||
          `s${shapeId}`;
      } else {
        key = routeId || `s${shapeId}`;
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ shapeId, meta });
    }

    const out = [];
    for (const [, list] of groups) {
      list.sort((a, b) => {
        if (SHAPE_PICK === "busiest") {
          const d =
            (b.meta.pattern_ids || []).length -
            (a.meta.pattern_ids || []).length;
          if (d) return d;
        }
        const s = bboxSpan(b.meta.bbox) - bboxSpan(a.meta.bbox);
        if (s) return s;
        return String(a.shapeId).localeCompare(String(b.shapeId)); // determinista
      });
      out.push(list[0]);
    }
    return out;
  }

  // Fetch com concorrência limitada, para não abrir dezenas de pedidos de uma vez.
  async function fetchAll(items, worker, limit) {
    const results = [];
    let i = 0;
    const runners = new Array(Math.min(limit, items.length))
      .fill(0)
      .map(async () => {
        while (i < items.length) {
          const idx = i++;
          try {
            const r = await worker(items[idx]);
            if (r) results.push(r);
          } catch (e) {
            console.warn("[CP] shape falhou:", e && e.message);
          }
        }
      });
    await Promise.all(runners);
    return results;
  }

  function simplify(feature) {
    if (!window.turf || !window.turf.simplify) return feature;
    try {
      return window.turf.simplify(feature, {
        tolerance: SIMPLIFY_TOLERANCE,
        highQuality: false,
      });
    } catch (_) {
      return feature;
    }
  }

  // Distância ponto→conjunto de linhas, em metros. Só serve para decidir se uma
  // estação fica perto de algum traçado, por isso basta a distância aos
  // vértices — não é preciso projectar nos segmentos.
  function distToLines(lon, lat, features, step) {
    const R = 6371000,
      rad = Math.PI / 180;
    const cosLat = Math.cos(lat * rad);
    let best = Infinity;
    for (const f of features) {
      const parts =
        f.geometry.type === "MultiLineString"
          ? f.geometry.coordinates
          : [f.geometry.coordinates];
      for (const ls of parts) {
        for (let i = 0; i < ls.length; i += step) {
          const dx = (ls[i][0] - lon) * cosLat * rad * R;
          const dy = (ls[i][1] - lat) * rad * R;
          const d = dx * dx + dy * dy;
          if (d < best) best = d;
        }
      }
    }
    return Math.sqrt(best);
  }

  function loadGeojsonLines() {
    return getJSON(LINES_GEOJSON).then((gj) => {
      const feats = ((gj && gj.features) || []).filter(
        (f) => f && f.geometry && /LineString$/.test(f.geometry.type),
      );
      for (const f of feats) {
        const p = f.properties || {};
        // Normaliza para as mesmas propriedades que o caminho do bundle produz.
        f.properties = {
          shape_id: p["gtfs:shape_id"] || p.ref || null,
          route_id: p["gtfs:route_id"] || null,
          colour: p.colour || CP_COLOR,
          ref: p.ref || p.name || "",
          name: p.name || "",
        };
      }
      return { type: "FeatureCollection", features: feats };
    });
  }

  function load() {
    if (loading) return loading;
    loading = getJSON(`${BUNDLE}/manifest.json`)
      .then((manifest) => {
        const res = manifest.resources || {};
        const useGeojson = LINES_SOURCE === "geojson";
        return Promise.all([
          getJSON(`${BUNDLE}/${res.routes || "routes.json"}`).catch(() => []),
          useGeojson
            ? Promise.resolve({})
            : getJSON(
                `${BUNDLE}/${res.shapes_index || "shapes/index.json"}`,
              ).catch(() => ({})),
          getJSON(`${BUNDLE}/${res.stops_index || "stops/index.json"}`),
          // Os ícones entram na mesma espera, para o addLayers já saber se os
          // pode usar. São dois: fundo branco e fundo verde (seleccionada). Se
          // o /imagens/lig-logos/cp.svg não existir, fica o círculo.
          ensureIcons(),
        ]).then(async ([routes, shapeIndex, stopsIndex, hasIcon]) => {
          iconReady = !!hasIcon;
          const routesById = new Map(
            (routes || []).map((r) => [r.route_id, r]),
          );

          // ── Geometrias ──
          if (useGeojson) {
            lines = await loadGeojsonLines();
          } else {
            const chosen = pickShapes(shapeIndex, routesById);
            const features = await fetchAll(
              chosen,
              async ({ shapeId, meta }) => {
                const gj = await getJSON(`${BUNDLE}/${meta.file}`);
                const f = gj && gj.features && gj.features[0];
                if (!f) return null;
                const routeId = (meta.route_ids && meta.route_ids[0]) || null;
                const route = routeId ? routesById.get(routeId) : null;
                const out = simplify(f);
                out.properties = {
                  shape_id: shapeId,
                  route_id: routeId,
                  // A cor vem do feed; o fallback é a cor de marca da CP.
                  colour:
                    route && route.route_color
                      ? `#${route.route_color}`
                      : CP_COLOR,
                  ref:
                    (route &&
                      (route.route_short_name || route.route_long_name)) ||
                    routeId ||
                    "",
                  route_type:
                    route && route.route_type != null ? route.route_type : null,
                };
                return out;
              },
              FETCH_CONCURRENCY,
            );
            lines = { type: "FeatureCollection", features };
          }

          // ── Estações ──
          // Um feed da CP tem uma paragem por plataforma; agrupa-se por
          // parent_station para desenhar um marcador por estação em vez de
          // dois em cima um do outro.
          const seen = new Map();
          for (const key in stopsIndex) {
            const e = stopsIndex[key];
            stopsById.set(e.stop_id, e);
            if (!Array.isArray(e.coordinates)) continue;
            const groupKey = e.parent_station || e.stop_id;
            if (seen.has(groupKey)) continue;
            seen.set(groupKey, e);
          }
          let stationEntries = Array.from(seen.values());
          const beforeFilter = stationEntries.length;
          if (FILTER_STATIONS_TO_LINES && lines.features.length) {
            // Um vértice em cada 4 chega para decidir proximidade e corta o
            // trabalho para um quarto.
            stationEntries = stationEntries.filter(
              (e) =>
                distToLines(
                  e.coordinates[0],
                  e.coordinates[1],
                  lines.features,
                  4,
                ) <= STATION_MAX_DIST_M,
            );
          }
          stations = {
            type: "FeatureCollection",
            features: stationEntries.map((e) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: e.coordinates },
              properties: {
                stop_id: e.stop_id,
                name: e.stop_name,
                // Sem o Set, uma estação da Linha de Sintra listava "Sintra"
                // dezenas de vezes — uma por route_id do feed nacional.
                lines: Array.from(new Set(e.route_short_names || [])).join(
                  " · ",
                ),
              },
            })),
          };

          // Diagnóstico: um feed nacional tem muitas "routes" no sentido GTFS
          // (cada relação origem-destino é uma), por isso "uma por linha" pode
          // dar dezenas de geometrias. Isto diz quantas daria cada modo, para
          // se poder escolher o SHAPE_GROUP com números em vez de palpites.
          const countBy = (keyOf) => {
            const set = new Set();
            for (const id in shapeIndex) set.add(keyOf(shapeIndex[id]));
            return set.size;
          };
          if (useGeojson) {
            console.info(
              `[CP] ${lines.features.length} linhas de ${LINES_GEOJSON} · ` +
                `${stations.features.length} estações` +
                (beforeFilter !== stations.features.length
                  ? ` (de ${beforeFilter}, filtradas a ${STATION_MAX_DIST_M} m das linhas)`
                  : ""),
            );
            return true;
          }

          console.info(
            `[CP] ${lines.features.length} geometrias de ${Object.keys(shapeIndex).length} shapes ` +
              `· ${stations.features.length} estações · SHAPE_GROUP="${SHAPE_GROUP}". ` +
              `Alternativas: por route=${countBy((m) => (m.route_ids && m.route_ids[0]) || "?")}, ` +
              `por route_type=${countBy((m) => {
                const r = routesById.get((m.route_ids && m.route_ids[0]) || "");
                return r && r.route_type != null ? r.route_type : "?";
              })}, ` +
              `por nome de linha=${countBy((m) => {
                const r = routesById.get((m.route_ids && m.route_ids[0]) || "");
                return (r && (r.route_short_name || r.route_long_name)) || "?";
              })}.`,
          );
          return true;
        });
      })
      .catch((err) => {
        console.error("[CP] bundle indisponível:", err && err.message);
        loading = null; // deixa tentar outra vez se a camada for ligada de novo
        throw err;
      });
    return loading;
  }

  // ═══ MARCADOR DAS ESTAÇÕES ═════════════════════════════════════════════
  // Diâmetros idênticos aos do círculo anterior (raio 2,5/3,5/5/8 →
  // 5/7/10/16 px). Sem logótipo, mantém-se o círculo.
  const STATION_ICON = "cp-logo-icon";
  const STATION_LOGO = "/imagens/lig-logos/cp.svg";
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
  function ensureIcons() {
    if (!window.MapaIcones || !map) return Promise.resolve(false);
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
  function applySelection(sel) {
    const layer = map && map.getLayer(L_POINTS);
    if (!layer) return;
    const mine = sel && sel.op === VIEW_GROUP ? sel : null;
    const expr = window.MapaSelecao
      ? window.MapaSelecao.matchExpr(mine, ["stop_id", "name"])
      : false;
    const green = (window.MapaSelecao && window.MapaSelecao.GREEN) || "#22C55E";
    try {
      if (layer.type === "symbol") {
        map.setLayoutProperty(L_POINTS, "icon-image", [
          "case",
          expr,
          STATION_ICON_SEL,
          STATION_ICON,
        ]);
      } else {
        map.setPaintProperty(L_POINTS, "circle-color", [
          "case",
          expr,
          green,
          "#FFFFFF",
        ]);
      }
    } catch (e) {
      console.warn("[CP] selecção falhou:", e && e.message);
    }
  }

  function stationLayerDef() {
    if (iconReady && window.MapaIcones) {
      return {
        id: L_POINTS,
        type: "symbol",
        source: SRC_STATIONS,
        minzoom: STATIONS_MINZOOM,
        layout: {
          "icon-image": STATION_ICON,
          "icon-size": window.MapaIcones.sizeExpr([
            [8, 12],
            [12, 15],
            [15, 20],
            [18, 30],
          ]),
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: { "icon-opacity": STATION_FADE },
      };
    }
    return {
      id: L_POINTS,
      type: "circle",
      source: SRC_STATIONS,
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

  // ═══ CAMADAS ═══════════════════════════════════════════════════════════
  function addLayers() {
    if (!map || !lines || !stations) return;
    try {
      if (!map.getSource(SRC_LINES))
        map.addSource(SRC_LINES, { type: "geojson", data: lines });
      if (!map.getSource(SRC_STATIONS))
        map.addSource(SRC_STATIONS, { type: "geojson", data: stations });
    } catch (e) {
      console.warn("[CP] fontes falharam:", e && e.message);
      return;
    }

    // 1. Borda preta. Ao contrário do MTS e do Metro, onde o casing é um
    // contorno largo, aqui são apenas 2 px a mais do que o traço branco.
    if (!map.getLayer(L_CASING)) {
      addLayerBelow(
        {
          id: L_CASING,
          type: "line",
          source: SRC_LINES,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#000000",
            "line-width": LINE_WIDTH(LINE_BORDER),
            // Opaca: é ela que dá contraste ao branco, não pode ser translúcida.
            "line-opacity": 1,
          },
        },
        BELOW_ID,
      );
    }

    // 2. Traço branco por cima da borda.
    if (!map.getLayer(L_COLOR)) {
      addLayerBelow(
        {
          id: L_COLOR,
          type: "line",
          source: SRC_LINES,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": LINE_COLOR,
            "line-width": LINE_WIDTH(0),
            // A opacidade é constante: quem faz o fade é a largura, como no
            // Metro. Duas rampas ao mesmo tempo davam um desvanecimento duplo.
            "line-opacity": 1.0,
          },
        },
        BELOW_ID,
      );
    }

    // 3. Estações — logótipo com fundo branco (mapa-icones.js).
    if (!map.getLayer(L_POINTS)) {
      addLayerBelow(stationLayerDef(), BELOW_ID);
    }

    // 4. Nomes. Mesmo par de fontes das etiquetas do Metro — é o que existe no
    // glyph set deste estilo.
    if (!map.getLayer(L_LABELS)) {
      try {
        map.addLayer({
          id: L_LABELS,
          type: "symbol",
          source: SRC_STATIONS,
          minzoom: LABEL_MINZOOM,
          layout: {
            "text-field": ["get", "name"],
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
      } catch (e) {
        console.warn("[CP] etiquetas falharam:", e && e.message);
      }
    }

    watchLayerOrder();
    applyTheme();
    attachClicks();
    refreshSharedFilter();
    // Selecção: aplica já o estado actual e volta a aplicar sempre que muda.
    if (window.MapaSelecao && !map._ltSelCp) {
      map._ltSelCp = true;
      window.MapaSelecao.register(applySelection);
    } else if (window.MapaSelecao) {
      applySelection(window.MapaSelecao.current());
    }
    applyVisibility(isOn());
  }

  // A expressão exclui as partilhadas dos pontos e das etiquetas.
  function applySharedFilter() {
    if (!map) return;
    const expr = sharedIds.length
      ? ["!", ["in", ["get", "stop_id"], ["literal", sharedIds]]]
      : null;
    for (const id of [L_POINTS, L_LABELS]) {
      if (!map.getLayer(id)) continue;
      try {
        map.setFilter(id, expr);
      } catch (e) {
        console.warn("[CP] filtro das partilhadas:", e && e.message);
      }
    }
  }

  function refreshSharedFilter() {
    if (!map || !window.GtfsHorarios || !window.GtfsHorarios.sharedFertagusCp) {
      applySharedFilter();
      return;
    }
    // Sem risco de ciclo: o sharedFertagusCp() lê o getStations(), que devolve
    // sempre a lista completa — é só a CAMADA que é filtrada.
    window.GtfsHorarios.sharedFertagusCp()
      .then((shared) => {
        const ids = [];
        shared.forEach((v) => {
          if (v && v.stopId != null) ids.push(String(v.stopId));
        });
        sharedIds = ids;
        applySharedFilter();
      })
      .catch(() => applySharedFilter());
  }

  function applyTheme() {
    if (!map || !map.getLayer(L_LABELS)) return;
    const dark = document.documentElement.classList.contains("dark");
    try {
      map.setPaintProperty(
        L_LABELS,
        "text-color",
        dark ? "#e2e8f0" : "#1e293b",
      );
      map.setPaintProperty(
        L_LABELS,
        "text-halo-color",
        dark ? "#09090b" : "#ffffff",
      );
    } catch (_) {}
  }

  function watchLayerOrder() {
    if (!map || map._ltCpOrder) return;
    map._ltCpOrder = true;
    const check = () => flushLayerOrder();
    map.on("styledata", check);
    map.on("load", check);
  }

  function attachClicks() {
    if (!map || map._ltCpClick) return;
    map._ltCpClick = true;
    map.on("click", L_POINTS, (e) => {
      const f = e.features && e.features[0];
      if (!f) return;
      const stopId = f.properties && f.properties.stop_id;
      if (!stopId) return;
      // Por stop_id directo: as estações do mapa SÃO as paragens do bundle.
      if (window.GtfsHorarios && window.GtfsHorarios.openStop) {
        window.GtfsHorarios.openStop(VIEW_GROUP, stopId, {
          name: f.properties.name,
        });
      } else {
        console.warn("[CP] window.GtfsHorarios em falta");
      }
    });
    map.on("mouseenter", L_POINTS, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", L_POINTS, () => {
      map.getCanvas().style.cursor = "";
    });
  }

  // ═══ VISIBILIDADE ══════════════════════════════════════════════════════
  function isOn() {
    return !window.MapaView || window.MapaView.isVisible(VIEW_GROUP);
  }

  function applyVisibility(on) {
    if (!map) return;
    const v = on ? "visible" : "none";
    LAYERS.forEach((id) => {
      if (map.getLayer(id)) {
        try {
          map.setLayoutProperty(id, "visibility", v);
        } catch (_) {}
      }
    });
    // Esconder a camada fecha a sheet, mas só se for a do CP.
    if (
      !on &&
      window.GtfsHorarios &&
      window.GtfsHorarios.operator() === VIEW_GROUP
    )
      window.GtfsHorarios.close();
  }

  // Os dados só são descarregados quando a camada é vista pela primeira vez —
  // um feed nacional tem geometrias grandes e não vale a pena pagá-las a quem
  // mantém a camada desligada.
  function ensureLoaded() {
    return load()
      .then(() => {
        if (map && map.isStyleLoaded()) addLayers();
        else if (map) map.once("styledata", addLayers);
      })
      .catch(() => {});
  }

  function onVisibilityChange(vis) {
    const on = vis.has(VIEW_GROUP);
    if (on && !lines) ensureLoaded();
    else applyVisibility(on);
  }

  // ═══ ARRANQUE ══════════════════════════════════════════════════════════
  function whenMapaView(cb) {
    if (window.MapaView) return cb(window.MapaView);
    const t = setInterval(() => {
      if (window.MapaView) {
        clearInterval(t);
        cb(window.MapaView);
      }
    }, 20);
  }

  function init(m) {
    map = m;
    whenMapaView((MV) => {
      if (MV.register) {
        MV.register(VIEW_GROUP, {
          label: "CP (Comboios de Portugal)",
          dot: CP_COLOR,
          defaultOn: true,
        });
      }
      MV.onChange(onVisibilityChange);
    });
    map.on("styledata", () => {
      if (lines) applyTheme();
    });
    // Sem MapaView (ou sem register), carrega directamente.
    if (!window.MapaView) ensureLoaded();
  }

  function patchMapaRender() {
    if (!window.MapaRender) return false;
    if (window.MapaRender._cpPatched) return true;
    const orig = window.MapaRender.setMap;
    window.MapaRender.setMap = function (m) {
      if (orig) orig.call(this, m);
      init(m);
    };
    window.MapaRender._cpPatched = true;
    return true;
  }
  if (!patchMapaRender()) {
    const t = setInterval(() => {
      if (patchMapaRender()) clearInterval(t);
    }, 20);
  }

  window.MapaCP = {
    ensureLoaded,
    // Ids escondidos por serem partilhados com a Fertagus.
    getSharedIds: () => sharedIds.slice(),
    refreshSharedFilter,
    isOn,
    // Todas as paragens do bundle (país inteiro).
    getStops: () => Array.from(stopsById.values()),
    // Só as que estão desenhadas: agrupadas por estação e dentro do âmbito das
    // linhas. É esta a lista que a pesquisa usa, para não oferecer estações que
    // não existem no mapa.
    getStations: () =>
      stations
        ? stations.features.map((f) => ({
            stop_id: f.properties.stop_id,
            name: f.properties.name,
            lines: f.properties.lines,
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
          }))
        : [],
    getLines: () => (lines ? lines.features.slice() : []),
    _internals: { pickShapes, bboxSpan, SHAPE_GROUP, SHAPE_PICK },
  };
})();

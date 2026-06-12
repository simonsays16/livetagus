/**
 * gtfs-output.js
 * Camada de EXTENSÃO GTFS-RT do contrato público da LiveTagus API.
 *
 * REGRA DE OURO — RETROCOMPATIBILIDADE TOTAL:
 * ─────────────────────────────────────────────────────────────────────────────
 * Este módulo NUNCA remove nem altera a semântica de campos legados.
 * "SituacaoComboio" e todos os seus estados textuais saem EXATAMENTE como o
 * motor antigo os produz. A decoração é NÃO-DESTRUTIVA: trabalha sobre cópias
 * rasas (o OUTPUT_CACHE em memória nunca é mutado) e apenas ACRESCENTA:
 *
 *   • objeto de topo `gtfs_realtime`  (trip/vehicle/status/position)
 *   • por nó: `stop_id` + sub-objetos `arrival` / `departure` (delay, time)
 *
 * FUSÃO GPS ⇄ FALLBACK:
 *   GPS fresco (Geo.isGpsFresh)  → position snapada à via, bearing tangencial,
 *                                  current_status da máquina de estados,
 *                                  atrasos em rota CINEMÁTICOS (delays-rt).
 *   GPS ausente/velho (fallback) → gtfs_realtime preenchido com os metadados
 *                                  do motor de estimativa legado e sinalizado
 *                                  com source:"legacy_estimate", is_snapped:false.
 */

"use strict";

const DWELL_S = 60; // dwell técnico UQE 3500 (partida = chegada + 60 s)

// ─── REFERÊNCIAS INJETADAS ───────────────────────────────────────────────────

let _Geo = null; // gtfs-geo.js
let _DelaysRT = null; // delays-rt.js
let _parseSmartTime = null; // parseSmartTime do index.js (dia operacional)
let _getRichById = null; // (id) => richInfo (RICH_SCHEDULE + extras dinâmicos)
let _getDepartureById = null; // (id) => trip de partidas (DEPARTURE_SCHEDULE)

// Mapas de stop_id (ft_stations_detailed.json): "campolide" → "11060004"
let STOP_ID_BY_KEY = {};
let STOP_ID_BY_APINAME = {};

const STATION_ORDER = [
  "setubal",
  "palmela",
  "venda_do_alcaide",
  "pinhal_novo",
  "penalva",
  "coina",
  "fogueteiro",
  "foros_de_amora",
  "corroios",
  "pragal",
  "campolide",
  "sete_rios",
  "entrecampos",
  "roma_areeiro",
];

const nameToKey = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/**
 * @param {object} ctx {
 *   Geo, DelaysRT, parseSmartTime,
 *   stationsDetailed: Array (ft_stations_detailed.json),
 *   getRichById:      (id) => richInfo | null,
 *   getDepartureById: (id) => departureTrip | null
 * }
 */
const init = (ctx) => {
  _Geo = ctx.Geo;
  _DelaysRT = ctx.DelaysRT;
  _parseSmartTime = ctx.parseSmartTime;
  _getRichById = ctx.getRichById || (() => null);
  _getDepartureById = ctx.getDepartureById || (() => null);

  STOP_ID_BY_KEY = {};
  STOP_ID_BY_APINAME = {};
  for (const s of ctx.stationsDetailed || []) {
    const key = nameToKey(s.n);
    STOP_ID_BY_KEY[key] = String(s.id);
    STOP_ID_BY_APINAME[String(s.n).toUpperCase()] = String(s.id);
  }
  console.log(
    `[GTFS-OUT] Inicializado: ${Object.keys(STOP_ID_BY_KEY).length} stop_ids mapeados.`,
  );
};

// ─── NORMALIZAÇÃO DE IDENTIFICADORES TML ─────────────────────────────────────

/** "[15]14281" → "14281" */
const cleanVehicleId = (raw) => String(raw || "").replace(/^\[\d+\]/, "");

/**
 * Extrai o nº de SERVIÇO do trip_id da TML.
 * Formatos observados: "[H47YT][15]3278", "[Z7SSD][42]2533_0_1|3|1|1900".
 * Regra: último bloco "[NN]" seguido dos dígitos até `_` ou `|`.
 */
const serviceFromTripId = (tripId) => {
  const m = String(tripId || "").match(/\]\[\d+\](\d+)/);
  return m ? m[1] : null;
};

/**
 * Resolve um veículo TML → { trainId, direction, route, tml } para o
 * Geo.ingestTmlPayload. Devolve null (com LOG DESCRITIVO) quando os
 * identificadores não têm correspondência na tabela estática de percursos —
 * o ping é ignorado e o comboio continua servido pelo fallback legado.
 */
const resolveTmlVehicle = (veh) => {
  const tripId = String(veh.trip_id || "").trim();
  const vehicleId = String(veh.vehicle_id || "").trim();

  // O nº de serviço vem do trip_id (join key correta); o vehicle_id é apenas
  // a composição física e serve de fallback de último recurso.
  const serviceId = cleanVehicleId(vehicleId) || serviceFromTripId(tripId);
  if (!serviceId) {
    console.warn(
      `[GTFS-RT] Veículo TML sem identificador utilizável ` +
        `(trip_id="${tripId}", vehicle_id="${vehicleId}") — ping ignorado.`,
    );
    return null;
  }

  const rich = _getRichById(serviceId);
  if (!rich) {
    console.warn(
      `[GTFS-RT] Serviço "${serviceId}" (trip_id="${tripId}", ` +
        `vehicle_id="${vehicleId}") sem correspondência no horário estático ` +
        `(RICH_SCHEDULE/extras) — telemetria descartada, comboio fica em fallback.`,
    );
    return null;
  }

  const route = buildRouteFromRich(rich, serviceId);
  if (!route || route.length === 0) {
    console.warn(
      `[GTFS-RT] Serviço "${serviceId}": horário estático sem estações ` +
        `utilizáveis — telemetria descartada.`,
    );
    return null;
  }

  return {
    trainId: serviceId,
    direction: rich.direction === "margem" ? "margem" : "lisboa",
    route,
    tml: {
      trip_id: tripId,
      vehicle_id: vehicleId,
      received_at: veh.received_at,
    },
  };
};

/**
 * Constrói o percurso [{key, arrivalMs, departureMs}] (ordenado pelo sentido)
 * a partir do horário estático: chegadas do RICH_SCHEDULE + partidas do
 * DEPARTURE_SCHEDULE quando existem.
 */
const buildRouteFromRich = (rich, trainId, now = new Date()) => {
  if (!rich || !_parseSmartTime) return null;
  const ordered =
    rich.direction === "margem" ? [...STATION_ORDER].reverse() : STATION_ORDER;
  const dep = _getDepartureById(trainId);

  const route = [];
  for (const key of ordered) {
    const arrStr = rich[key];
    if (arrStr == null || String(arrStr).trim() === "") continue;
    const arr = _parseSmartTime(String(arrStr), now);
    if (!arr) continue;
    let departureMs = arr.getTime();
    if (dep && dep[key]) {
      const d = _parseSmartTime(String(dep[key]), now);
      if (d) departureMs = d.getTime();
    }
    route.push({ key, arrivalMs: arr.getTime(), departureMs });
  }
  return route;
};

// Guarda os metadados TML do último ping aceite (trip_id/vehicle_id crus).
const TML_META = {}; // { trainId: { trip_id, vehicle_id } }
const rememberTmlMeta = (trainId, tml) => {
  if (trainId && tml) TML_META[trainId] = tml;
};

// ─── DECORAÇÃO DE UM COMBOIO (extensão gtfs_realtime + nós) ──────────────────

const toUnixS = (timeStr, now) => {
  if (!timeStr || typeof timeStr !== "string" || timeStr.startsWith("HH"))
    return null;
  const d = _parseSmartTime(timeStr, now);
  return d ? Math.floor(d.getTime() / 1000) : null;
};

const stopIdForNode = (node) => {
  const nome = String(node.NomeEstacao || "")
    .toUpperCase()
    .replace(/-A$/, "")
    .trim();
  return STOP_ID_BY_APINAME[nome] || STOP_ID_BY_KEY[nameToKey(nome)] || null;
};

/**
 * Decora um trainOutput LEGADO (produzido por processTrain/extras) com a
 * camada GTFS-RT. Devolve uma CÓPIA — o objeto original não é tocado.
 *
 * @param {object} train  trainOutput do OUTPUT_CACHE / EXTRA_TRAINS_CACHE
 * @param {object} opts   { now?: Date }
 */
const decorateTrain = (train, opts = {}) => {
  try {
    if (!train || typeof train !== "object" || !train.NodesPassagemComboio)
      return train;

    const now = opts.now instanceof Date ? opts.now : new Date();
    const nowMs = now.getTime();
    const trainId = String(
      train["id-comboio"] != null ? train["id-comboio"] : train.id,
    );

    const nodes = train.NodesPassagemComboio;
    const nextIdx = nodes.findIndex((n) => !n.ComboioPassou);

    // ── Fonte: GPS fresco vs estimativa legada ──
    const gpsFresh = !!(_Geo && _Geo.isGpsFresh(trainId, nowMs));
    const veh = gpsFresh ? _Geo.getVehicle(trainId) : null;

    // ── Atraso dinâmico em rota (cinemática pura) p/ os nós futuros ──
    // Quando há GPS, o atraso projetado da PRÓXIMA estação substitui o atraso
    // estático e propaga-se aos nós seguintes (mesma filosofia do motor
    // legado, que arrasta currentDelay). Clamp a ≥0: nunca antes do horário.
    let dynDelayS = null;
    if (gpsFresh && _DelaysRT && nextIdx >= 0) {
      const nextKey = nameToKey(
        String(nodes[nextIdx].NomeEstacao || "").replace(/-A$/, ""),
      );
      const rich = _getRichById(trainId);
      const route = rich ? buildRouteFromRich(rich, trainId, now) : null;
      if (route) {
        const ir = _DelaysRT.computeInRoute(trainId, {
          nextStationKey: nextKey,
          route,
          now: nowMs,
        });
        if (ir) dynDelayS = Math.max(0, ir.inRouteDelayS);
      }
    }

    // ── Extensão dos nós: stop_id + arrival/departure ──
    const newNodes = nodes.map((node, i) => {
      const n = { ...node };
      const sid = stopIdForNode(node);
      if (sid) n.stop_id = sid;

      const schedS = toUnixS(node.HoraProgramada, now);

      if (node.ComboioPassou) {
        // Nó já passado: tempos REAIS medidos pelo motor legado.
        const realS = toUnixS(node.HoraReal, now) ?? schedS;
        const delay = typeof node.AtrasoReal === "number" ? node.AtrasoReal : 0;
        if (realS != null) {
          n.arrival = { delay, time: realS };
          n.departure = { delay, time: realS + DWELL_S };
        }
      } else if (schedS != null) {
        // Nó futuro: dinâmico (GPS) ou estático (HoraPrevista legado).
        let delay;
        if (dynDelayS != null) {
          delay = dynDelayS;
        } else {
          const prevS = toUnixS(node.HoraPrevista, now);
          delay = prevS != null ? Math.max(0, prevS - schedS) : 0;
        }
        n.arrival = { delay, time: schedS + delay };
        n.departure = { delay, time: schedS + delay + DWELL_S };
      }
      return n;
    });

    // ── Bloco gtfs_realtime ──
    const tml = TML_META[trainId] || {};
    const activeNode = nextIdx >= 0 ? newNodes[nextIdx] : null;

    let gtfs;
    if (gpsFresh && veh && veh.lastPing) {
      gtfs = {
        trip_id: tml.trip_id || null,
        vehicle_id: tml.vehicle_id || `[15]${trainId}`,
        current_status: veh.status ? veh.status.current : "IN_TRANSIT_TO",
        current_stop_sequence: veh.status ? veh.status.routeIdx : nextIdx,
        active_stop_id:
          (veh.status && veh.status.stopKey
            ? STOP_ID_BY_KEY[veh.status.stopKey]
            : null) ||
          (activeNode && activeNode.stop_id) ||
          null,
        timestamp: Math.floor(veh.lastPing.ts / 1000),
        position: {
          latitude: veh.lastPing.lat, // coordenadas JÁ projetadas na via
          longitude: veh.lastPing.lng,
          bearing:
            veh.bearing != null ? Math.round(veh.bearing * 10) / 10 : null,
          is_snapped: true,
          source: "tml_gps",
        },
      };
    } else {
      // FALLBACK: metadados do motor de estimativa legado, devidamente
      // sinalizados. Sem coordenadas (não inventamos posição no servidor).
      gtfs = {
        trip_id: tml.trip_id || null,
        vehicle_id: tml.vehicle_id || `[15]${trainId}`,
        current_status: nextIdx >= 0 ? "IN_TRANSIT_TO" : null,
        current_stop_sequence: nextIdx >= 0 ? nextIdx : newNodes.length,
        active_stop_id: (activeNode && activeNode.stop_id) || null,
        timestamp: Math.floor(nowMs / 1000),
        position: {
          latitude: null,
          longitude: null,
          bearing: null,
          is_snapped: false,
          source: "legacy_estimate", // estimativa do pipeline estático
        },
      };
    }

    return { ...train, gtfs_realtime: gtfs, NodesPassagemComboio: newNodes };
  } catch (e) {
    console.error(
      "[GTFS-OUT] decorateTrain falhou (a servir legado):",
      e.message,
    );
    return train; // nunca quebra o contrato antigo
  }
};

/**
 * Decora o OUTPUT_CACHE inteiro para o /fertagus, sem o mutar.
 * Chaves reservadas (futureTrains/extratrains/abnormalRoutes) passam intactas;
 * os extras dentro de `extratrains` também são decorados.
 */
const decorateOutputCache = (cache, opts = {}) => {
  const out = {};
  for (const [id, val] of Object.entries(cache || {})) {
    if (id === "extratrains" && val && typeof val === "object") {
      const extras = {};
      for (const [eid, t] of Object.entries(val))
        extras[eid] = decorateTrain(t, opts);
      out[id] = extras;
    } else if (id === "futureTrains" || id === "abnormalRoutes") {
      out[id] = val;
    } else {
      out[id] = decorateTrain(val, opts);
    }
  }
  return out;
};

/**
 * Atraso dinâmico em rota (s) de um comboio NUMA estação concreta — usado
 * pelo /estacao para substituir o atraso estático. Devolve null quando não
 * há GPS fresco / percurso resolvível (→ o caller mantém o valor legado).
 */
const dynamicStationDelayS = (trainId, stationKey, now = Date.now()) => {
  try {
    if (!_Geo || !_DelaysRT || !_Geo.isGpsFresh(trainId, now)) return null;
    const rich = _getRichById(String(trainId));
    if (!rich) return null;
    const route = buildRouteFromRich(rich, String(trainId), new Date(now));
    if (!route) return null;

    const veh = _Geo.getVehicle(String(trainId));
    const nextKey =
      veh && veh.status && veh.status.stopKey ? veh.status.stopKey : null;

    const r =
      nextKey === stationKey
        ? _DelaysRT.computeInRoute(String(trainId), {
            nextStationKey: stationKey,
            route,
            now,
          })
        : _DelaysRT.computeEtaToStation(String(trainId), {
            targetKey: stationKey,
            route,
            now,
          });

    return r && typeof r.inRouteDelayS === "number"
      ? Math.max(0, r.inRouteDelayS)
      : null;
  } catch (e) {
    console.error("[GTFS-OUT] dynamicStationDelayS:", e.message);
    return null;
  }
};

module.exports = {
  init,
  resolveTmlVehicle,
  rememberTmlMeta,
  decorateTrain,
  decorateOutputCache,
  dynamicStationDelayS,
  buildRouteFromRich,
  // expostos para testes
  _serviceFromTripId: serviceFromTripId,
  _cleanVehicleId: cleanVehicleId,
};

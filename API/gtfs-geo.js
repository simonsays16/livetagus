/**
 * gtfs-geo.js
 * Processamento geoespacial GTFS-RT para a LiveTagus API.
 *
 * RESPONSABILIDADES
 * ─────────────────────────────────────────────────────────────────────────────
 *  • Ingerir o payload bruto da TML (filtra agency_id "15" — Fertagus).
 *  • Higienizar cada ping GPS: dedup, outliers, saltos abruptos.
 *  • SNAP TO LINE: projetar a coordenada ruidosa sobre a geometria real da
 *    via férrea (fertagus_line_detailed.json) com turf.nearestPointOnLine.
 *  • Recalcular o RUMO (bearing) pela TANGENTE da própria linha (±20 m),
 *    orientado pelo sentido de marcha — o bearing nativo da TML é ignorado.
 *  • Calcular a velocidade ponto-a-ponto AO LONGO DA LINHA (não em linha
 *    reta), capada ao teto físico da UQE 3500 (140 km/h).
 *  • Alimentar a máquina de estados (vehicle-status.js) e o motor de
 *    atrasos (delays-rt.js).
 *
 * NOTA SOBRE FALLBACK
 * ─────────────────────────────────────────────────────────────────────────────
 * Este módulo NÃO substitui o processTrain/ghosts/futureTrains do index.js.
 * Quando o GPS de um comboio falha (sem pings frescos), isGpsFresh() devolve
 * false e o caller deve continuar a servir o cálculo estático antigo.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const turf = require("@turf/turf");

const VehicleStatus = require("./vehicle-status.js");
const DelaysRT = require("./delays-rt.js");

// ─── CONSTANTES ──────────────────────────────────────────────────────────────

const AGENCY_ID = "15"; // Fertagus — tudo o resto é ignorado.

const VMAX_MPS = 140 / 3.6; // 38.89 m/s — teto físico UQE 3500
const OUTLIER_SPEED_MPS = VMAX_MPS * 1.5; // salto implica >210 km/h → lixo
const MAX_SNAP_DIST_KM = 0.5; // ping a >500 m da via → não é um comboio na linha
const BEARING_MIN_MOVE_M = 5; // filtro de jitter: só roda se andou >5 m
const TANGENT_STEP_KM = 0.02; // ±20 m para a tangente da linha
const SPEED_WINDOW_MS = 30000; // janela p/ velocidade efetiva recente
const GPS_FRESH_MS = 20000; // sem ping há >20 s → fallback estático
const HISTORY_MAX = 12; // ring buffer de pings por veículo

// Ordem física Sul → Norte (km crescente "lisboa" é validado por feature).
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

// ─── ESTADO DO MÓDULO ────────────────────────────────────────────────────────

let lineFeatures = []; // Array<Feature<LineString>>
let featureLenKm = []; // comprimento de cada feature
let featureForwardIsLisboa = {}; // { idx: bool|null } km crescente = sul→norte?
let stations = {}; // { key: { key,nome,center:{lng,lat}, proj, entrances } }
let initialized = false;

// Estado por veículo:
// { lastPing:{ts,km,featureIdx,lng,lat}, bearing, speedMps, history:[],
//   status: <vehicle-status state>, lastValidMoveTs }
const VEHICLES = {};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Normaliza "Foros de Amora" / "SETÚBAL" → "foros_de_amora" / "setubal". */
const nameToKey = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** Extrai LineStrings de qualquer formato GeoJSON razoável. */
const extractLineStrings = (geojson) => {
  const out = [];
  const pushGeom = (geom, props) => {
    if (!geom) return;
    if (geom.type === "LineString") {
      out.push(turf.lineString(geom.coordinates, props || {}));
    } else if (geom.type === "MultiLineString") {
      for (const coords of geom.coordinates) {
        out.push(turf.lineString(coords, props || {}));
      }
    }
  };
  if (!geojson) return out;
  if (Array.isArray(geojson.features)) {
    for (const f of geojson.features) pushGeom(f.geometry, f.properties);
  } else if (geojson.type === "Feature") {
    pushGeom(geojson.geometry, geojson.properties);
  } else if (geojson.type) {
    pushGeom(geojson, {});
  }
  return out;
};

/** Projeta um ponto [lng,lat] na feature mais próxima da via. */
const projectOnLine = (lng, lat) => {
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  const pt = turf.point([lng, lat]);
  let best = null;
  lineFeatures.forEach((feature, idx) => {
    try {
      const np = turf.nearestPointOnLine(feature, pt, { units: "kilometers" });
      if (!best || np.properties.dist < best.distKm) {
        best = {
          featureIdx: idx,
          distKm: np.properties.dist, // distância perpendicular à via
          km: np.properties.location, // posição AO LONGO da via
          lng: np.geometry.coordinates[0],
          lat: np.geometry.coordinates[1],
        };
      }
    } catch (_) {
      /* coordenadas degeneradas → ignora a feature */
    }
  });
  return best;
};

/**
 * Rumo tangencial da via no km dado, orientado pelo sentido de marcha.
 *  direction "lisboa"  → segue o sentido sul→norte da linha;
 *  direction "margem"  → inverte (+180º).
 */
const tangentBearing = (featureIdx, km, direction) => {
  const feature = lineFeatures[featureIdx];
  if (!feature) return null;
  const len = featureLenKm[featureIdx];

  let kmA = km - TANGENT_STEP_KM;
  let kmB = km + TANGENT_STEP_KM;
  if (kmA < 0) {
    kmA = 0;
    kmB = Math.min(len, 2 * TANGENT_STEP_KM);
  }
  if (kmB > len) {
    kmB = len;
    kmA = Math.max(0, len - 2 * TANGENT_STEP_KM);
  }

  const pA = turf.along(feature, kmA, { units: "kilometers" });
  const pB = turf.along(feature, kmB, { units: "kilometers" });
  const tangentInc = turf.bearing(pA, pB); // sentido de km CRESCENTE

  let forwardIsLisboa = featureForwardIsLisboa[featureIdx];
  if (forwardIsLisboa == null) {
    // Fallback grosseiro: norte = lisboa, pela latitude da tangente.
    forwardIsLisboa = pB.geometry.coordinates[1] >= pA.geometry.coordinates[1];
  }

  const goingLisboa = direction !== "margem";
  const b = goingLisboa === forwardIsLisboa ? tangentInc : tangentInc + 180;
  return (b + 360) % 360;
};

// ─── INICIALIZAÇÃO ───────────────────────────────────────────────────────────

/**
 * @param {string|object} lineSrc     caminho ou objeto GeoJSON da via
 * @param {string|object} stationsSrc caminho ou array do ft_stations_detailed
 */
const init = (lineSrc, stationsSrc) => {
  const lineJson =
    typeof lineSrc === "string"
      ? JSON.parse(fs.readFileSync(path.resolve(lineSrc), "utf8"))
      : lineSrc;
  const stationsJson =
    typeof stationsSrc === "string"
      ? JSON.parse(fs.readFileSync(path.resolve(stationsSrc), "utf8"))
      : stationsSrc;

  lineFeatures = extractLineStrings(lineJson);
  if (lineFeatures.length === 0) {
    throw new Error("[GTFS-GEO] Geometria da via vazia/ilegível.");
  }
  featureLenKm = lineFeatures.map((f) =>
    turf.length(f, { units: "kilometers" }),
  );

  // Estações: projetar centro + entradas na via.
  stations = {};
  for (const s of stationsJson) {
    const key = nameToKey(s.n);
    const center = { lat: s.c[0], lng: s.c[1] };
    const proj = projectOnLine(center.lng, center.lat);

    const projEntrance = (e) => {
      if (!Array.isArray(e) || e.length < 2) return null;
      const p = projectOnLine(e[1], e[0]); // ficheiro guarda [lat, lng]
      if (!p || !proj) return p;
      // Sanidade: entrada projetada a >1.5 km do centro na via → dado suspeito
      // (ex: north da Palmela no ficheiro). Clampa a ±150 m do centro.
      if (p.featureIdx !== proj.featureIdx || Math.abs(p.km - proj.km) > 1.5) {
        const sign = p.km >= proj.km ? 1 : -1;
        return { ...proj, km: proj.km + sign * 0.15 };
      }
      return p;
    };

    stations[key] = {
      key,
      nome: s.n,
      id: s.id,
      center,
      proj, // { featureIdx, km, lng, lat }
      entrances: {
        north: projEntrance(s.entrances && s.entrances.north),
        south: projEntrance(s.entrances && s.entrances.south),
      },
    };
  }

  // Orientação de cada feature (km crescente = lisboa?), via ordem das estações.
  featureForwardIsLisboa = {};
  const orderIdx = {};
  STATION_ORDER.forEach((k, i) => (orderIdx[k] = i));
  const byFeature = {};
  for (const key of Object.keys(stations)) {
    const p = stations[key].proj;
    if (!p || orderIdx[key] == null) continue;
    (byFeature[p.featureIdx] = byFeature[p.featureIdx] || []).push({
      km: p.km,
      oi: orderIdx[key],
    });
  }
  for (const idx of Object.keys(byFeature)) {
    const arr = byFeature[idx];
    if (arr.length < 2) {
      featureForwardIsLisboa[idx] = null;
      continue;
    }
    let lo = arr[0],
      hi = arr[0];
    for (const s of arr) {
      if (s.km < lo.km) lo = s;
      if (s.km > hi.km) hi = s;
    }
    featureForwardIsLisboa[idx] = hi.oi > lo.oi;
  }

  VehicleStatus.init({ stations, STATION_ORDER });
  DelaysRT.init(module.exports); // injeta o geo no motor de atrasos
  initialized = true;
  console.log(
    `[GTFS-GEO] Inicializado: ${lineFeatures.length} feature(s), ` +
      `${Object.keys(stations).length} estações projetadas.`,
  );
};

// ─── INGESTÃO DE PINGS ───────────────────────────────────────────────────────

/**
 * Processa UM ping GPS já identificado (trainId + sentido + horário).
 *
 * @param {object} p {
 *   trainId:    string  — nº de serviço (ex: "14297")
 *   latitude:   number
 *   longitude:  number
 *   receivedAt: number  — timestamp ms do ping
 *   direction:  "lisboa"|"margem"
 *   route:      Array<{key, arrivalMs, departureMs}> — horário do comboio,
 *               ordenado pelo sentido de marcha (injetado pelo index.js a
 *               partir do RICH_SCHEDULE/DEPARTURE_SCHEDULE).
 * }
 * @returns {object|null} estado atualizado do veículo, ou null se descartado.
 */
const processPing = (p) => {
  if (!initialized) return null;

  try {
    const { trainId, latitude, longitude, receivedAt, direction, route } = p;
    if (!trainId) return null;

    const v = (VEHICLES[trainId] = VEHICLES[trainId] || {
      lastPing: null,
      bearing: null,
      speedMps: 0,
      history: [],
      status: VehicleStatus.createState(direction, route),
      lastValidMoveTs: 0,
    });

    // [EXCEÇÃO] Telemetria duplicada: mesmo timestamp (ou retrocesso no tempo).
    if (v.lastPing && receivedAt <= v.lastPing.ts) return null;

    // [EXCEÇÃO] FIX REPETIDO: a TML reenvia o último fix quando não há
    // atualização nesse tick (coordenadas BRUTAS idênticas, received_at novo).
    // Ignorar SEM consumir o relógio (lastPing.ts fica no fix anterior): assim
    // o dt do próximo fix REAL é o tempo verdadeiro decorrido e a velocidade
    // sai correta — antes, isto gerava velocidades 2-3× reais e outliers.
    if (
      v.lastPing &&
      latitude === v.lastPing.rawLat &&
      longitude === v.lastPing.rawLng
    ) {
      return null;
    }

    const snap = projectOnLine(longitude, latitude);

    // [EXCEÇÃO] Ping ausente/degenerado ou demasiado longe da via.
    if (!snap || snap.distKm > MAX_SNAP_DIST_KM) {
      // Não esmaga o estado: o último ponto válido continua a servir.
      return null;
    }

    // Velocidade ponto-a-ponto AO LONGO da via + rejeição de outliers.
    let movedM = 0;
    let isReseed = false;
    if (v.lastPing) {
      const dtS = (receivedAt - v.lastPing.ts) / 1000;
      if (dtS <= 0) return null;

      if (snap.featureIdx === v.lastPing.featureIdx) {
        movedM = Math.abs(snap.km - v.lastPing.km) * 1000;
      } else {
        // Mudou de feature: usa distância geodésica como aproximação.
        movedM =
          turf.distance(
            turf.point([v.lastPing.lng, v.lastPing.lat]),
            turf.point([snap.lng, snap.lat]),
            { units: "kilometers" },
          ) * 1000;
      }

      const impliedMps = movedM / dtS;

      // [EXCEÇÃO] Salto abrupto de coordenadas: fisicamente impossível.
      if (impliedMps > OUTLIER_SPEED_MPS) {
        v.outlierStreak = (v.outlierStreak || 0) + 1;

        // RE-SEED: 3 fixes consecutivos "impossíveis" face ao último ponto
        // aceite = o comboio ESTÁ mesmo na posição nova (re-aquisição de GPS
        // à saída de túnel — Pragal/Campolide — ou gap longo do feed).
        // Re-ancorar sem velocidade em vez de bloquear o tracking até o dt
        // diluir (era a causa das caudas 3486→1905→...→210 km/h nos logs).
        if (v.outlierStreak >= 3) {
          console.warn(
            `[GTFS-GEO] Re-seed (${trainId}): 3 outliers consecutivos — ` +
              `a re-ancorar posição (${(impliedMps * 3.6).toFixed(0)} km/h implícitos).`,
          );
          isReseed = true;
          v.outlierStreak = 0;
          v.history = []; // velocidade efetiva recomeça do zero
          v.speedMps = 0;
        } else {
          // Log só na 1ª rejeição da streak (evita spam nos logs).
          if (v.outlierStreak === 1) {
            console.warn(
              `[GTFS-GEO] Outlier descartado (${trainId}): ` +
                `${(impliedMps * 3.6).toFixed(0)} km/h implícitos.`,
            );
          }
          return null;
        }
      } else {
        v.outlierStreak = 0;
      }

      // Velocidade instantânea capada ao teto físico da UQE 3500.
      if (!isReseed) v.speedMps = Math.min(impliedMps, VMAX_MPS);
    }

    // Rumo tangencial — filtro de jitter: só atualiza se andou >5 m.
    if (!v.lastPing || movedM > BEARING_MIN_MOVE_M || v.bearing == null) {
      const b = tangentBearing(snap.featureIdx, snap.km, direction);
      if (b != null) v.bearing = b;
      if (movedM > BEARING_MIN_MOVE_M) v.lastValidMoveTs = receivedAt;
    }

    // Atualiza ring buffer (para velocidade efetiva recente do delays-rt).
    v.history.push({
      ts: receivedAt,
      km: snap.km,
      featureIdx: snap.featureIdx,
    });
    if (v.history.length > HISTORY_MAX) v.history.shift();

    v.lastPing = {
      ts: receivedAt,
      rawLat: latitude,
      rawLng: longitude,
      ...snap,
    };

    // Máquina de estados GTFS-RT (gera eventos de chegada/partida).
    const events = VehicleStatus.update(v.status, {
      km: snap.km,
      featureIdx: snap.featureIdx,
      speedMps: v.speedMps,
      ts: receivedAt,
      direction,
    });

    // Eventos → motor de atrasos.
    for (const ev of events) {
      if (ev.type === "incoming" || ev.type === "stopped") {
        DelaysRT.recordArrival(trainId, ev.stationKey, ev.ts, route);
      } else if (ev.type === "departed") {
        DelaysRT.recordDeparture(trainId, ev.stationKey, ev.ts, route);
      }
    }

    return {
      trainId,
      latitude: snap.lat,
      longitude: snap.lng,
      bearing: v.bearing,
      speedMps: v.speedMps,
      currentStatus: v.status.current, // IN_TRANSIT_TO | INCOMING_AT | STOPPED_AT
      stopId: v.status.stopKey, // estação de referência do estado
      events,
    };
  } catch (e) {
    console.error("[GTFS-GEO] Erro a processar ping:", e.message);
    return null;
  }
};

/**
 * Ingere o payload BRUTO da TML (json.data) e processa só a Fertagus.
 * resolveTrain(vehicle) → { trainId, direction, route } | null
 * (o index.js resolve o nº de serviço a partir do trip_id e injeta o horário).
 */
const ingestTmlPayload = (tmlData, resolveTrain, receivedAt = Date.now()) => {
  if (!Array.isArray(tmlData)) return [];
  const out = [];
  for (const veh of tmlData) {
    try {
      if (!veh || veh.agency_id !== AGENCY_ID) continue; // só Fertagus
      if (typeof veh.latitude !== "number" || typeof veh.longitude !== "number")
        continue;

      const meta = resolveTrain ? resolveTrain(veh) : null;
      if (!meta || !meta.trainId) continue;

      // bearing e current_status nativos da TML são IGNORADOS por contrato.
      const r = processPing({
        trainId: String(meta.trainId),
        latitude: veh.latitude,
        longitude: veh.longitude,
        // TIMESTAMP REAL da telemetria: received_at (ms) da TML. O Date.now()
        // do poll dava dt errado — fixes repetidos (TML sem atualização nesse
        // tick) consumiam relógio e o movimento acumulado de 6s era dividido
        // por 3s → velocidades 2-3× reais → outliers em catadupa.
        receivedAt:
          typeof veh.received_at === "number" && veh.received_at > 0
            ? veh.received_at
            : veh.timestamp
              ? veh.timestamp * 1000
              : receivedAt,
        direction: meta.direction,
        route: meta.route,
      });
      if (r) out.push(r);
    } catch (e) {
      console.error("[GTFS-GEO] Veículo ignorado:", e.message);
    }
  }
  return out;
};

// ─── INTERFACE P/ DELAYS-RT E FALLBACK ───────────────────────────────────────

/** GPS fresco? false → o caller usa o cálculo estático antigo (fallback). */
const isGpsFresh = (trainId, now = Date.now()) => {
  const v = VEHICLES[trainId];
  return !!(v && v.lastPing && now - v.lastPing.ts <= GPS_FRESH_MS);
};

/** Velocidade efetiva recente (m/s) — janela ~30 s, capada a 140 km/h. */
const effectiveSpeedMps = (trainId, now = Date.now()) => {
  const v = VEHICLES[trainId];
  if (!v || v.history.length < 2) return v ? v.speedMps : 0;

  const recent = v.history.filter((h) => now - h.ts <= SPEED_WINDOW_MS);
  if (recent.length < 2) return v.speedMps;

  const a = recent[0];
  const b = recent[recent.length - 1];
  if (a.featureIdx !== b.featureIdx) return v.speedMps;

  const dtS = (b.ts - a.ts) / 1000;
  if (dtS <= 0) return v.speedMps;
  const mps = (Math.abs(b.km - a.km) * 1000) / dtS;
  return Math.min(mps, VMAX_MPS);
};

/** Distância restante (m) ao longo da via até à estação dada. */
const remainingDistanceM = (trainId, stationKey) => {
  const v = VEHICLES[trainId];
  const st = stations[stationKey];
  if (!v || !v.lastPing || !st || !st.proj) return null;
  if (v.lastPing.featureIdx !== st.proj.featureIdx) return null;

  // turf.lineSliceAlong mede a fatia exata da via entre os dois kms.
  try {
    const feature = lineFeatures[v.lastPing.featureIdx];
    const a = Math.min(v.lastPing.km, st.proj.km);
    const b = Math.max(v.lastPing.km, st.proj.km);
    if (b - a < 1e-6) return 0;
    const slice = turf.lineSliceAlong(feature, a, b, { units: "kilometers" });
    return turf.length(slice, { units: "kilometers" }) * 1000;
  } catch (_) {
    return Math.abs(st.proj.km - v.lastPing.km) * 1000;
  }
};

const getVehicle = (trainId) => VEHICLES[trainId] || null;
const removeVehicle = (trainId) => {
  delete VEHICLES[trainId];
};

const liveVehicleCount = (now = Date.now()) =>
  Object.keys(VEHICLES).filter((id) => isGpsFresh(id, now)).length;

module.exports = {
  init,
  processPing,
  ingestTmlPayload,
  isGpsFresh,
  effectiveSpeedMps,
  remainingDistanceM,
  getVehicle,
  removeVehicle,
  liveVehicleCount,
  // expostos para testes
  _projectOnLine: projectOnLine,
  _tangentBearing: tangentBearing,
  _nameToKey: nameToKey,
  _stations: () => stations,
  VMAX_MPS,
};

/**
 * jump-guard.js
 * Filtro de SALTOS de localização dos comboios (feed TML) — v7.0.0.
 *
 * PROBLEMA
 * ─────────────────────────────────────────────────────────────────────────────
 * O GPS da TML às vezes "teletransporta" um comboio: um fix aparece a km de
 * distância e o seguinte volta ao sítio certo. No mapa o comboio fica aos
 * saltos de um lado para o outro.
 *
 * REGRA (pedida)
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. Fix novo MUITO longe do último aceite (salto) → NÃO é aceite. A API
 *      mostra uma posição "falsa": um bocadinho mais à frente no sentido em
 *      que o comboio vinha (ou no mesmo sítio, se estava parado).
 *   2. Fix seguinte:
 *        • outra vez muito longe do último aceite → o salto era verdadeiro
 *          (saída do túnel, gap do feed…) → aceita a posição nova;
 *        • perto → o salto era lixo → segue normal com o fix novo.
 *
 * "Fix seguinte" = fix com timestamp NOVO. Repetições do mesmo fix (a TML
 * devolve o mesmo ponto em vários polls de 3 s) não contam como confirmação:
 * enquanto não há fix novo, continua a ser servida a posição falsa.
 *
 * Módulo PURO (sem rede/ficheiros). Estado por id de veículo (nº de serviço).
 */

"use strict";

// Salto = distância grande E velocidade implícita impossível (>210 km/h, o
// mesmo teto do gtfs-geo). As duas condições evitam marcar ruído de poucos
// metros com dt pequeno.
const JUMP_MIN_DIST_M = 300;
const JUMP_SPEED_MPS = (140 / 3.6) * 1.5; // 58.3 m/s = 210 km/h

// "Um bocadinho mais à frente": avanço máximo da posição falsa.
const HOLD_MAX_ADVANCE_M = 150;
// Abaixo disto o comboio é considerado parado → posição falsa = mesmo sítio.
const MIN_MOVING_MPS = 1;

const STATE = {}; // id → { lat, lng, ts, vLat, vLng, pending, shown }

const R_EARTH_M = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;

/** Distância geodésica (m) — haversine. */
const distanceM = (lat1, lng1, lat2, lng2) => {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
};

/** Posição falsa: último ponto aceite + velocidade × dt, capado. */
const heldPosition = (s, ts) => {
  const dtS = Math.max(0, (ts - s.ts) / 1000);
  if (!s.vLat && !s.vLng) return { lat: s.lat, lng: s.lng };
  const nLat = s.lat + s.vLat * dtS;
  const nLng = s.lng + s.vLng * dtS;
  const adv = distanceM(s.lat, s.lng, nLat, nLng);
  if (adv <= HOLD_MAX_ADVANCE_M) return { lat: nLat, lng: nLng };
  const f = HOLD_MAX_ADVANCE_M / adv;
  return { lat: s.lat + (nLat - s.lat) * f, lng: s.lng + (nLng - s.lng) * f };
};

const accept = (s, lat, lng, ts, keepVelocity) => {
  if (keepVelocity && s.ts != null && ts > s.ts) {
    const dtS = (ts - s.ts) / 1000;
    const vLat = (lat - s.lat) / dtS;
    const vLng = (lng - s.lng) / dtS;
    const speed = distanceM(s.lat, s.lng, lat, lng) / dtS;
    s.vLat = speed >= MIN_MOVING_MPS ? vLat : 0;
    s.vLng = speed >= MIN_MOVING_MPS ? vLng : 0;
  } else {
    s.vLat = 0;
    s.vLng = 0;
  }
  s.lat = lat;
  s.lng = lng;
  s.ts = ts;
  s.pending = false;
  s.shown = { lat, lng };
};

/**
 * @param {string} id   nº do comboio (vehicle_id sem prefixo)
 * @param {number} lat
 * @param {number} lng
 * @param {number} ts   timestamp do fix (ms)
 * @returns {{lat:number, lng:number, kind:"normal"|"held"|"jump_accepted"|"repeat"}}
 *   normal        → fix aceite (posição real)
 *   held          → salto por confirmar: lat/lng = posição falsa
 *   jump_accepted → 2.º fix longe: a posição nova passa a valer (re-ancorar)
 *   repeat        → mesmo fix de antes: devolve o que já estava a ser mostrado
 */
const check = (id, lat, lng, ts) => {
  const key = String(id);
  let s = STATE[key];
  if (!s) {
    s = STATE[key] = {};
    accept(s, lat, lng, ts, false);
    return { lat, lng, kind: "normal" };
  }

  // Mesmo fix (ou mais antigo): nada de novo. Mantém o que estava a mostrar.
  if (!(ts > s.ts) || (s.pending && s.pendingTs != null && ts <= s.pendingTs)) {
    return {
      lat: s.shown.lat,
      lng: s.shown.lng,
      kind: s.pending ? "held" : "repeat",
    };
  }

  const d = distanceM(s.lat, s.lng, lat, lng);
  const dtS = (ts - s.ts) / 1000;
  const isJump = d > JUMP_MIN_DIST_M && d / dtS > JUMP_SPEED_MPS;

  if (!isJump) {
    accept(s, lat, lng, ts, !s.pending);
    return { lat, lng, kind: "normal" };
  }

  if (!s.pending) {
    // 1.º salto: segura. Mostra a posição falsa.
    s.pending = true;
    s.pendingTs = ts;
    s.shown = heldPosition(s, ts);
    return { lat: s.shown.lat, lng: s.shown.lng, kind: "held" };
  }

  // 2.º fix (novo) outra vez longe → o salto era real: aceita.
  accept(s, lat, lng, ts, false);
  return { lat, lng, kind: "jump_accepted" };
};

const forget = (id) => {
  delete STATE[String(id)];
};
const reset = () => {
  for (const k of Object.keys(STATE)) delete STATE[k];
};

module.exports = {
  check,
  forget,
  reset,
  distanceM,
  JUMP_MIN_DIST_M,
  JUMP_SPEED_MPS,
  HOLD_MAX_ADVANCE_M,
};

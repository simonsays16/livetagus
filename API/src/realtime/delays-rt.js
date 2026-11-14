/**
 * delays-rt.js
 * Motor de cálculo de atrasos GTFS-RT para a LiveTagus API.
 *
 * [v7.0.0] O ATRASO SÓ É CALCULADO EM ESTAÇÃO — NUNCA DURANTE A VIAGEM:
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. ARRIVAL DELAY    — ao ENTRAR na estação (INCOMING_AT/STOPPED_AT):
 *                        received_at − hora programada de CHEGADA ao nó.
 *  2. DEPARTURE DELAY  — ao SAIR da estação (IN_TRANSIT_TO):
 *                        received_at − hora programada de PARTIDA.
 *  Em ambos: desconto fixo (DELAY_DISCOUNT_S) e nunca negativo.
 *
 * [v7.2] NADA É CALCULADO ENTRE ESTAÇÕES:
 * ─────────────────────────────────────────────────────────────────────────────
 *  • O atraso atual = o do ÚLTIMO evento medido em estação. Não muda enquanto
 *    o comboio anda (sem velocidade, sem cinemática, sem distâncias).
 *  • As estações futuras recebem esse MESMO atraso (já não há projeção de
 *    "recuperação de folga" troço a troço — era um cálculo entre estações).
 *  • ÚNICA exceção — PARAGEM TÉCNICA DE COINA: nos comboios Setúbal → Lisboa
 *    o horário tem ~3 min de paragem técnica em Coina. Um comboio atrasado não
 *    a cumpre e recupera até 3 min. Enquanto ainda não partiu de Coina, Coina
 *    e as estações seguintes ficam com max(0, atraso − 3 min). Depois de
 *    partir de Coina vale o atraso real medido nessa partida.
 *  Comboios na lista delay-block.js (nº com horário errado) não têm cálculo.
 *
 * FALLBACK:
 * ─────────────────────────────────────────────────────────────────────────────
 *   Este módulo NÃO altera o sistema antigo (cálculo estático, ghost trains,
 *   future checks). shouldUseFallback() diz ao index.js quando o GPS está
 *   indisponível — nesse caso o pipeline legado serve os dados como sempre.
 */

"use strict";

// [v7] Desconto fixo aplicado a TODOS os atrasos medidos em estação.
const DELAY_DISCOUNT_S = 60;

// [v7.2] Recuperação máxima na paragem técnica de Coina (Setúbal → Lisboa).
const COINA_TECH_RECOVERY_S = 3 * 60;

const DelayBlock = require("./delay-block.js");

// ─── ESTADO ──────────────────────────────────────────────────────────────────

// { [trainId]: { arrivals:{key:{ts,rawS,delayS}}, departures:{...},
//                last:{type,stationKey,ts,rawS,delayS}, lastInRoute } }
const DELAYS = {};

// Referências injetadas (evita dependência circular com gtfs-geo.js).
let _geo = null;
const init = (geoModule) => {
  _geo = geoModule;
};

const ensure = (trainId) =>
  (DELAYS[trainId] = DELAYS[trainId] || {
    arrivals: {},
    departures: {},
    last: null,
    lastInRoute: null,
  });

// [v7] Regista uma medição em estação: desconto de 60 s, nunca negativo,
// verificação "atraso_impossivel" e atualização do último evento.
const storeEvent = (d, trainId, type, stationKey, receivedAt, schedMs) => {
  const rawS = Math.round((receivedAt - schedMs) / 1000);
  const delayS = Math.max(0, rawS - DELAY_DISCOUNT_S);
  const ev = { ts: receivedAt, rawS, delayS };
  DelayBlock.checkStationDelay(trainId, stationKey, rawS);
  if (!d.last || receivedAt >= d.last.ts) {
    d.last = { type, stationKey, ...ev };
  }
  return ev;
};

const findRouteEntry = (route, stationKey) =>
  Array.isArray(route) ? route.find((r) => r.key === stationKey) : null;

// ─── 1 & 2. ATRASOS DE CHEGADA E PARTIDA (eventos da máquina de estados) ─────

/**
 * Chamado quando o veículo transita para INCOMING_AT ou STOPPED_AT.
 * Compara o timestamp do ping com a hora programada de chegada ao nó.
 * Idempotente por estação (o 1º evento — INCOMING_AT — fixa o valor).
 */
// [v7.1] Paragem técnica de Coina: os comboios Setúbal → Lisboa param ~3 min
// em Coina, mas o horário só tem a hora de partida (chegada = partida). Medir a
// chegada daria um "adiantamento" falso de ~3 min. Só a PARTIDA conta.
const isCoinaTechnicalStop = (stationKey, route) =>
  stationKey === "coina" &&
  Array.isArray(route) &&
  route.length > 0 &&
  route[0].key === "setubal"; // percurso sentido Lisboa com origem em Setúbal

const recordArrival = (trainId, stationKey, receivedAt, route) => {
  try {
    const d = ensure(trainId);
    if (d.arrivals[stationKey]) return d.arrivals[stationKey]; // já medido
    if (isCoinaTechnicalStop(stationKey, route)) return null;

    const entry = findRouteEntry(route, stationKey);
    if (!entry || typeof entry.arrivalMs !== "number") return null;

    d.arrivals[stationKey] = storeEvent(
      d,
      trainId,
      "arrival",
      stationKey,
      receivedAt,
      entry.arrivalMs,
    );
    return d.arrivals[stationKey];
  } catch (e) {
    console.error("[DELAYS-RT] recordArrival:", e.message);
    return null;
  }
};

/**
 * Chamado quando o veículo SAI da estação (STOPPED_AT/INCOMING_AT →
 * IN_TRANSIT_TO). Compara com a hora programada de PARTIDA.
 */
const recordDeparture = (trainId, stationKey, receivedAt, route) => {
  try {
    const d = ensure(trainId);
    if (d.departures[stationKey]) return d.departures[stationKey];

    const entry = findRouteEntry(route, stationKey);
    const schedMs =
      entry && typeof entry.departureMs === "number"
        ? entry.departureMs
        : entry && typeof entry.arrivalMs === "number"
          ? entry.arrivalMs
          : null;
    if (schedMs == null) return null;

    d.departures[stationKey] = storeEvent(
      d,
      trainId,
      "departure",
      stationKey,
      receivedAt,
      schedMs,
    );
    return d.departures[stationKey];
  } catch (e) {
    console.error("[DELAYS-RT] recordDeparture:", e.message);
    return null;
  }
};

// ─── 3. CINEMÁTICA PURA: TEMPO MÍNIMO P/ PERCORRER D E PARAR ─────────────────

// ─── 3. ATRASO ATUAL (último evento em estação) ─────────────────────────────

/**
 * [v7.2] Paragem técnica de Coina: aplica-se à estação `stationKey` se o
 * comboio é Setúbal → Lisboa, a estação é Coina ou depois, e o comboio AINDA
 * NÃO partiu de Coina (último evento medido antes de Coina).
 */
const coinaRecoveryApplies = (d, route, stationKey) => {
  if (!Array.isArray(route) || !route.length) return false;
  if (route[0].key !== "setubal") return false; // só Setúbal → Lisboa
  const ci = route.findIndex((r) => r.key === "coina");
  if (ci < 0) return false;
  const ti = route.findIndex((r) => r.key === stationKey);
  if (ti < ci) return false; // estação antes de Coina
  if (d.departures.coina) return false; // já partiu: vale o atraso real
  const li = route.findIndex((r) => r.key === d.last.stationKey);
  return li >= 0 && li < ci;
};

/**
 * Atraso (s) de um comboio numa estação do percurso: o do último evento em
 * estação, com a regra de Coina. Nada depende da posição entre estações.
 * @returns {object|null} null = sem GPS fresco, comboio bloqueado, ou ainda
 *   sem nenhum evento medido → o caller mantém o fallback, como antes.
 */
const delayAtStation = (trainId, stationKey, route, now) => {
  if (!_geo) throw new Error("geo não injetado (init)");
  if (!_geo.isGpsFresh(trainId, now)) return null; // → fallback estático
  if (DelayBlock.isBlocked(trainId)) return null; // sem cálculo (lista)

  const d = DELAYS[trainId];
  if (!d || !d.last) return null; // ainda não passou nenhuma estação

  const entry = findRouteEntry(route, stationKey);
  if (!entry || typeof entry.arrivalMs !== "number") return null;

  let delayS = d.last.delayS;
  const coina = coinaRecoveryApplies(d, route, stationKey);
  if (coina) delayS = Math.max(0, delayS - COINA_TECH_RECOVERY_S);

  return {
    etaMs: entry.arrivalMs + delayS * 1000,
    inRouteDelayS: delayS,
    source: coina ? "station_event_coina" : "station_event",
    lastEventType: d.last.type,
    lastEventStation: d.last.stationKey,
  };
};

/**
 * Atraso para a PRÓXIMA estação. Mantém o nome/assinatura antigos (usado pelo
 * gtfs-output e, através dele, pelo /estacao e pelo map-authority).
 */
const computeInRoute = (
  trainId,
  { nextStationKey, route, now = Date.now() },
) => {
  try {
    const r = delayAtStation(trainId, nextStationKey, route, now);
    if (r && DELAYS[trainId]) {
      DELAYS[trainId].lastInRoute = { ...r, ts: now, stationKey: nextStationKey };
    }
    return r;
  } catch (e) {
    console.error("[DELAYS-RT] computeInRoute:", e.message);
    return null;
  }
};

/**
 * Atraso para uma estação MAIS À FRENTE: o mesmo atraso atual (sem projeções
 * entre estações), com a regra de Coina.
 */
const computeEtaToStation = (
  trainId,
  { targetKey, route, now = Date.now() },
) => {
  try {
    return delayAtStation(trainId, targetKey, route, now);
  } catch (e) {
    console.error("[DELAYS-RT] computeEtaToStation:", e.message);
    return null;
  }
};

// ─── FALLBACK ────────────────────────────────────────────────────────────────

/**
 * true → o index.js deve usar o pipeline LEGADO (cálculo estático, ghost
 * trains, future checks) para este comboio. O sistema antigo permanece
 * intacto; o GPS é uma camada por cima que se desliga sozinha.
 */
const shouldUseFallback = (trainId, now = Date.now()) =>
  !_geo || !_geo.isGpsFresh(trainId, now);

// ─── LEITURA / LIMPEZA ───────────────────────────────────────────────────────

const getDelays = (trainId) => DELAYS[trainId] || null;
const cleanupTrain = (trainId) => {
  delete DELAYS[trainId];
};
// [v7] Reset diário (04:00): medições de ontem não podem bloquear as de hoje
// (as medições são idempotentes por estação — a 1.ª fica).
const resetAll = () => {
  for (const k of Object.keys(DELAYS)) delete DELAYS[k];
};

module.exports = {
  init,
  recordArrival,
  recordDeparture,
  computeInRoute,
  computeEtaToStation,
  shouldUseFallback,
  getDelays,
  cleanupTrain,
  resetAll,
  DELAY_DISCOUNT_S,
  COINA_TECH_RECOVERY_S,
};

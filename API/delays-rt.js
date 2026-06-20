/**
 * delays-rt.js
 * Motor de cálculo de atrasos GTFS-RT para a LiveTagus API.
 *
 * TRÊS TIPOS DE ATRASO:
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. ARRIVAL DELAY    — no instante da transição p/ INCOMING_AT/STOPPED_AT,
 *                        received_at − hora programada de CHEGADA ao nó.
 *  2. DEPARTURE DELAY  — no instante da transição p/ IN_TRANSIT_TO (saída),
 *                        received_at − hora programada de PARTIDA.
 *  3. IN-ROUTE DELAY   — ETA dinâmico via cinemática pura da UQE 3500 +
 *                        modelo de progresso proporcional do horário.
 *
 * MODELO CINEMÁTICO (UQE 3500 — ficha técnica):
 * ─────────────────────────────────────────────────────────────────────────────
 *   Vmax = 140 km/h (38.89 m/s) | a = 0.9 m/s² | d = 0.9 m/s² (serviço)
 *   Dwell técnico = 60 000 ms (fecho automático 1 min após abertura).
 *
 *   Sem limites de velocidade da via conhecidos, o ETA é o tempo FÍSICO
 *   mínimo: acelerar a 0.9 m/s², cruzar a Vmax se houver espaço, e travar a
 *   0.9 m/s² até parar no ponto zero da estação. Se a distância for curta,
 *   a curva é TRIANGULAR (trava antes de atingir Vmax); caso contrário é
 *   TRAPEZOIDAL.
 *
 * FALLBACK:
 * ─────────────────────────────────────────────────────────────────────────────
 *   Este módulo NÃO altera o sistema antigo (cálculo estático, ghost trains,
 *   future checks). shouldUseFallback() diz ao index.js quando o GPS está
 *   indisponível — nesse caso o pipeline legado serve os dados como sempre.
 */

"use strict";

// ─── CONSTANTES DA FICHA TÉCNICA (UQE 3500) ─────────────────────────────────

const VMAX_MPS = 140 / 3.6; // 38.888... m/s
const ACCEL_MPS2 = 0.9; // 0 → 40 km/h (assumida constante p/ o modelo)
const DECEL_MPS2 = 0.9; // frenagem de serviço
const DWELL_MS = 60000; // tempo mínimo estacionário teórico na plataforma

// ─── [TÚNEL DA PONTE] TROÇO SEM COBERTURA GPS ───────────────────────────────
// Entre Campolide e Pragal o comboio atravessa o túnel/Ponte 25 de Abril, onde
// o GPS deixa de atualizar. Sem pings novos, o motor lê velocidade ~0 e infla
// o atraso (pensa que está parado). Neste troço NÃO calculamos atraso por GPS:
// congelamos o último atraso conhecido até o comboio sair do túnel e voltar a
// reportar posição. Aplica-se nos dois sentidos.
const TUNNEL_SEGMENT = new Set(["campolide", "pragal"]);
const isTunnelSegment = (fromKey, toKey) =>
  TUNNEL_SEGMENT.has(fromKey) && TUNNEL_SEGMENT.has(toKey);

// ─── ESTADO ──────────────────────────────────────────────────────────────────

// { [trainId]: { arrivals:{key:{ts,delayS}}, departures:{...}, lastInRoute } }
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
    lastInRoute: null,
  });

// No congelamento do túnel, mantemos o atraso herdado mas projetamos um etaMs
// simples: hora de chegada planeada + último atraso conhecido.
const entryArrivalOr = (route, stationKey, lastInRoute, now) => {
  const e = findRouteEntry(route, stationKey);
  if (e && typeof e.arrivalMs === "number") {
    return e.arrivalMs + lastInRoute.inRouteDelayS * 1000;
  }
  return lastInRoute.etaMs || now;
};

const findRouteEntry = (route, stationKey) =>
  Array.isArray(route) ? route.find((r) => r.key === stationKey) : null;

// ─── 1 & 2. ATRASOS DE CHEGADA E PARTIDA (eventos da máquina de estados) ─────

/**
 * Chamado quando o veículo transita para INCOMING_AT ou STOPPED_AT.
 * Compara o timestamp do ping com a hora programada de chegada ao nó.
 * Idempotente por estação (o 1º evento — INCOMING_AT — fixa o valor).
 */
const recordArrival = (trainId, stationKey, receivedAt, route) => {
  try {
    const d = ensure(trainId);
    if (d.arrivals[stationKey]) return d.arrivals[stationKey]; // já medido

    const entry = findRouteEntry(route, stationKey);
    if (!entry || typeof entry.arrivalMs !== "number") return null;

    const delayS = Math.round((receivedAt - entry.arrivalMs) / 1000);
    d.arrivals[stationKey] = { ts: receivedAt, delayS };
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

    const delayS = Math.round((receivedAt - schedMs) / 1000);
    d.departures[stationKey] = { ts: receivedAt, delayS };
    return d.departures[stationKey];
  } catch (e) {
    console.error("[DELAYS-RT] recordDeparture:", e.message);
    return null;
  }
};

// ─── 3. CINEMÁTICA PURA: TEMPO MÍNIMO P/ PERCORRER D E PARAR ─────────────────

/**
 * Tempo (s) para percorrer `distM` metros partindo a `v0` m/s e TERMINAR
 * PARADO (v=0) no destino, sob as leis da UQE 3500.
 *
 *   • Curva TRAPEZOIDAL: acelera até Vmax, cruza, trava a 0.9 m/s².
 *   • Curva TRIANGULAR: a distância não chega para atingir Vmax — o pico de
 *     velocidade vp resolve  (vp²−v0²)/2a + vp²/2d = D.
 *   • Se v0 já excede o que é travável em D, devolve a melhor aproximação
 *     (t = 2D / v0): o comboio vai "passar" o ponto — caso degenerado.
 */
const kinematicRunTimeS = (v0, distM) => {
  const D = Math.max(0, distM);
  if (D === 0) return 0;
  const v = Math.min(Math.max(v0 || 0, 0), VMAX_MPS);
  const a = ACCEL_MPS2;
  const d = DECEL_MPS2;

  // Espaço necessário para travar de v até 0.
  const brakeFromV0 = (v * v) / (2 * d);
  if (brakeFromV0 >= D) {
    // Já dentro da curva de travagem — aproximação de velocidade média v/2.
    return (2 * D) / Math.max(v, 0.1);
  }

  const dAccel = (VMAX_MPS * VMAX_MPS - v * v) / (2 * a); // v → Vmax
  const dBrake = (VMAX_MPS * VMAX_MPS) / (2 * d); // Vmax → 0

  if (dAccel + dBrake <= D) {
    // TRAPEZOIDAL: há espaço para cruzar a Vmax.
    const tAccel = (VMAX_MPS - v) / a;
    const tCruise = (D - dAccel - dBrake) / VMAX_MPS;
    const tBrake = VMAX_MPS / d;
    return tAccel + tCruise + tBrake;
  }

  // TRIANGULAR: trava antes de atingir a velocidade de cruzeiro.
  const vp = Math.sqrt((2 * a * d * D + d * v * v) / (a + d));
  return (vp - v) / a + vp / d;
};

// ─── 3. ATRASO EM ROTA + ETA DINÂMICO ────────────────────────────────────────

/**
 * Calcula o ETA dinâmico à próxima estação e o atraso em rota projetado.
 *
 * @param {string} trainId
 * @param {object} args {
 *   nextStationKey: string,
 *   route:          Array<{key, arrivalMs, departureMs}>,
 *   now:            number (ms)
 * }
 * @returns {object|null} {
 *   etaMs, etaKinematicMs, etaProportionalMs,
 *   inRouteDelayS, remainingM, effectiveSpeedMps, source
 * }
 */
const computeInRoute = (
  trainId,
  { nextStationKey, route, now = Date.now() },
) => {
  try {
    if (!_geo) throw new Error("geo não injetado (init)");
    if (!_geo.isGpsFresh(trainId, now)) return null; // → fallback estático

    // [TÚNEL DA PONTE] Se o troço atual é Campolide↔Pragal, não confiamos no
    // GPS (sem cobertura no túnel). Congela o último atraso conhecido; nunca
    // inventa atraso novo a partir de uma velocidade falsamente nula.
    {
      const idxNext = route
        ? route.findIndex((r) => r.key === nextStationKey)
        : -1;
      const fromKey = idxNext > 0 ? route[idxNext - 1].key : null;
      if (fromKey && isTunnelSegment(fromKey, nextStationKey)) {
        const d = ensure(trainId);
        if (d.lastInRoute && typeof d.lastInRoute.inRouteDelayS === "number") {
          return {
            ...d.lastInRoute,
            etaMs: entryArrivalOr(route, nextStationKey, d.lastInRoute, now),
            frozen: true, // sinaliza: atraso herdado, não recalculado
            source: "tunnel_frozen",
          };
        }
        return null; // sem histórico → cai no fallback estático (horário)
      }
    }

    const remainingM = _geo.remainingDistanceM(trainId, nextStationKey);
    if (remainingM == null) return null;

    const entry = findRouteEntry(route, nextStationKey);
    if (!entry || typeof entry.arrivalMs !== "number") return null;

    // Velocidade Efetiva Recente — distância na linha entre os últimos pings
    // válidos / tempo decorrido, capada ao teto físico (140 km/h).
    const vEff = Math.min(_geo.effectiveSpeedMps(trainId, now), VMAX_MPS);

    // (a) ETA FÍSICO — cinemática pura da UQE 3500 (curva trapezoidal ou
    //     triangular, terminando parado no ponto zero da estação).
    const etaKinematicMs = now + kinematicRunTimeS(vEff, remainingM) * 1000;

    // (b) MODELO DE PROGRESSO PROPORCIONAL DO HORÁRIO — distância física real
    //     percorrida vs tempo planeado consumido no troço atual. O ritmo
    //     observado (pace) extrapola o tempo restante do troço.
    let etaProportionalMs = null;
    const d = ensure(trainId);
    const idx = route ? route.findIndex((r) => r.key === nextStationKey) : -1;
    const prev = idx > 0 ? route[idx - 1] : null;
    const dep = prev ? d.departures[prev.key] : null;

    if (prev && dep && typeof prev.departureMs === "number") {
      const segSchedMs = entry.arrivalMs - prev.departureMs; // tempo planeado
      const prevRemainM = _geo.remainingDistanceM(trainId, prev.key);
      if (segSchedMs > 0 && prevRemainM != null) {
        const segTotalM = prevRemainM + remainingM; // distância física do troço
        if (segTotalM > 50) {
          const fracDist = Math.min(Math.max(prevRemainM / segTotalM, 0.02), 1);
          const elapsedMs = now - dep.ts;
          const pace = elapsedMs / (fracDist * segSchedMs); // 1 = a horas
          const remainPlannedMs = (1 - fracDist) * segSchedMs;
          etaProportionalMs = now + remainPlannedMs * Math.max(pace, 0.5);
        }
      }
    }

    // ETA final: o cinemático é o LIMITE FÍSICO INFERIOR (nunca se chega mais
    // depressa do que a física permite); o proporcional reflete o ritmo real.
    const etaMs =
      etaProportionalMs != null
        ? Math.max(etaKinematicMs, etaProportionalMs)
        : etaKinematicMs;

    const inRouteDelayS = Math.round((etaMs - entry.arrivalMs) / 1000);

    const result = {
      etaMs,
      etaKinematicMs,
      etaProportionalMs,
      inRouteDelayS,
      remainingM,
      effectiveSpeedMps: vEff,
      source: "gps",
    };
    d.lastInRoute = { ...result, ts: now, stationKey: nextStationKey };
    return result;
  } catch (e) {
    console.error("[DELAYS-RT] computeInRoute:", e.message);
    return null;
  }
};

/**
 * ETA acumulado a uma estação MAIS À FRENTE no percurso: soma os troços
 * intermédios (cinemática a partir de paragem, v0=0) + dwell técnico de
 * 60 s por paragem intermédia.
 */
const computeEtaToStation = (
  trainId,
  { targetKey, route, now = Date.now() },
) => {
  try {
    if (!_geo || !Array.isArray(route)) return null;
    const state = _geo.getVehicle(trainId);
    if (!state || !state.status) return null;

    const startIdx = state.status.routeIdx;
    const targetIdx = route.findIndex((r) => r.key === targetKey);
    if (targetIdx < startIdx || startIdx < 0) return null;

    // Troço atual (com velocidade efetiva real).
    const first = computeInRoute(trainId, {
      nextStationKey: route[startIdx].key,
      route,
      now,
    });
    if (!first) return null;
    let etaMs = first.etaMs;

    // Troços seguintes: arranque parado (v0=0) + dwell técnico por paragem.
    for (let i = startIdx; i < targetIdx; i++) {
      const a = route[i];
      const b = route[i + 1];
      const dA = _geo.remainingDistanceM(trainId, a.key);
      const dB = _geo.remainingDistanceM(trainId, b.key);
      if (dA == null || dB == null) return null;
      const segM = Math.abs(dB - dA);
      etaMs += DWELL_MS + kinematicRunTimeS(0, segM) * 1000;
    }

    const entry = route[targetIdx];
    const delayS =
      typeof entry.arrivalMs === "number"
        ? Math.round((etaMs - entry.arrivalMs) / 1000)
        : null;
    return { etaMs, inRouteDelayS: delayS, source: "gps" };
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

module.exports = {
  init,
  recordArrival,
  recordDeparture,
  computeInRoute,
  computeEtaToStation,
  shouldUseFallback,
  getDelays,
  cleanupTrain,
  kinematicRunTimeS, // exposto para testes
  VMAX_MPS,
  ACCEL_MPS2,
  DECEL_MPS2,
  DWELL_MS,
};

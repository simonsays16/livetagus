/**
 * vehicle-status.js
 * Máquina de estados GTFS-RT (VehicleStopStatus) para a LiveTagus API.
 *
 * ESTADOS (padrão GTFS-RT):
 * ─────────────────────────────────────────────────────────────────────────────
 *   IN_TRANSIT_TO  — em linha aberta; stop de referência = PRÓXIMA estação.
 *   INCOMING_AT    — o ponto projetado cruzou o limite de ENTRADA da estação
 *                    correspondente ao sentido de marcha.
 *   STOPPED_AT     — dentro do perímetro da plataforma com velocidade ≈ 0.
 *
 * REGRA DE ORIENTAÇÃO DAS ENTRADAS:
 * ─────────────────────────────────────────────────────────────────────────────
 *   Sentido Norte/Lisboa (sul→norte):  ENTRADA = entrances.south
 *                                      SAÍDA   = entrances.north
 *   Sentido Sul/Margem  (norte→sul):   ENTRADA = entrances.north
 *                                      SAÍDA   = entrances.south
 *
 * ANTI-FALSO ARRANQUE:
 * ─────────────────────────────────────────────────────────────────────────────
 *   STOPPED_AT só transita de volta para IN_TRANSIT_TO quando a coordenada
 *   projetada ULTRAPASSA FISICAMENTE o ponto de saída da estação. Ruído de
 *   GPS dentro da plataforma (que simula movimento) nunca dispara a partida.
 *
 * O módulo é puro em relação ao tempo/rede: recebe amostras já snapadas à
 * linha (km ao longo da via) vindas do gtfs-geo.js e emite eventos
 * { type: incoming|stopped|departed, stationKey, ts } para o delays-rt.js.
 */

"use strict";

// ─── CONSTANTES ──────────────────────────────────────────────────────────────

const STOPPED_SPEED_MPS = 0.5; // ponto-a-ponto ≈ 0 → considerado parado
const DEFAULT_HALF_PLATFORM_KM = 0.15; // perímetro quando falta uma entrada

// ─── ESTADO DO MÓDULO ────────────────────────────────────────────────────────

let STATIONS = {}; // injetado pelo gtfs-geo.js (estações + projeções na via)
let STATION_ORDER = [];

const init = (ctx) => {
  STATIONS = ctx.stations || {};
  STATION_ORDER = ctx.STATION_ORDER || [];
};

// ─── GEOMETRIA DA ESTAÇÃO NO SENTIDO DE MARCHA ───────────────────────────────

/**
 * Devolve { entryKm, exitKm, centerKm, featureIdx } para a estação no sentido
 * dado, com a convenção de orientação acima. Garante entryKm "antes" do
 * exitKm na direção de viagem (sinal tratado pelo caller via travelSign).
 */
const stationBounds = (stationKey, direction) => {
  const st = STATIONS[stationKey];
  if (!st || !st.proj) return null;

  const center = st.proj;
  const north = st.entrances && st.entrances.north;
  const south = st.entrances && st.entrances.south;

  const fallback = (sign) => ({
    ...center,
    km: center.km + sign * DEFAULT_HALF_PLATFORM_KM,
  });

  // No referencial da LINHA não sabemos se km crescente é norte; mas as
  // projeções das entradas já vivem nesse referencial. Determinamos entrada e
  // saída pelo PAR (north,south) — quem está "antes" na direção de viagem é a
  // entrada. A regra norte/sul do contrato fica garantida porque a entrada
  // sul está fisicamente antes da norte para quem viaja para norte, e
  // vice-versa.
  const a = north && north.featureIdx === center.featureIdx ? north : null;
  const b = south && south.featureIdx === center.featureIdx ? south : null;

  let lowKm, highKm;
  if (a && b) {
    lowKm = Math.min(a.km, b.km);
    highKm = Math.max(a.km, b.km);
  } else if (a || b) {
    const e = a || b;
    lowKm = Math.min(e.km, center.km - DEFAULT_HALF_PLATFORM_KM);
    highKm = Math.max(e.km, center.km + DEFAULT_HALF_PLATFORM_KM);
  } else {
    lowKm = fallback(-1).km;
    highKm = fallback(1).km;
  }

  // [v7] Perímetro degenerado (terminais: Roma-Areeiro e Setúbal têm as duas
  // entradas projetadas no MESMO ponto, com o centro fora delas). Sem isto a
  // entrada e a saída coincidiam: o comboio "chegava" à estação de origem no
  // instante em que partia e "partia" do terminal no instante em que chegava,
  // gerando eventos falsos. Alarga o perímetro para incluir a plataforma.
  if (
    center.km < lowKm ||
    center.km > highKm ||
    highKm - lowKm < DEFAULT_HALF_PLATFORM_KM / 3
  ) {
    lowKm = Math.min(lowKm, center.km - DEFAULT_HALF_PLATFORM_KM);
    highKm = Math.max(highKm, center.km + DEFAULT_HALF_PLATFORM_KM);
  }

  return {
    featureIdx: center.featureIdx,
    centerKm: center.km,
    lowKm, // limite com km menor
    highKm, // limite com km maior
  };
};

// ─── ESTADO POR VEÍCULO ──────────────────────────────────────────────────────

/**
 * Cria o estado da máquina para um comboio.
 * @param {"lisboa"|"margem"} direction
 * @param {Array<{key, arrivalMs, departureMs}>} route — estações pela ordem
 *        de circulação. A primeira não-visitada passa a ser o stop alvo.
 */
const createState = (direction, route) => ({
  current: "IN_TRANSIT_TO",
  direction: direction === "margem" ? "margem" : "lisboa",
  route: Array.isArray(route) ? route.map((r) => ({ ...r })) : [],
  routeIdx: 0, // índice da PRÓXIMA estação (stop de referência)
  stopKey: Array.isArray(route) && route[0] ? route[0].key : null,
  travelSign: 0, // +1 se km cresce no sentido de marcha, -1 caso contrário
  lastKm: null,
  resync: true, // [v7] 1.ª amostra: sincronizar sem gerar eventos
});

/**
 * [v7] RE-SINCRONIZAÇÃO SEM EVENTOS
 * Na 1.ª amostra de um comboio (arranque do servidor a meio da viagem, comboio
 * que só aparece no feed a meio) e depois de um salto de GPS confirmado, o
 * comboio NÃO foi visto a chegar às estações que já ficaram para trás. Antes,
 * a máquina "passava" essas estações uma a uma com a hora ATUAL, e isso gerava
 * atrasos falsos enormes. Agora:
 *   • estações já ultrapassadas → avançadas em silêncio (sem eventos);
 *   • se a amostra está DENTRO de uma estação → STOPPED_AT nessa estação, sem
 *     chegada (a hora real de chegada não foi vista); a PARTIDA, essa sim, é
 *     medida quando ele sair.
 * Precisa do sinal esperado do km no sentido declarado (s.expectedSign). Sem
 * ele (0), não re-sincroniza e segue o fluxo normal.
 */
const resyncSilently = (state, s) => {
  const sign = s.expectedSign;
  if (sign !== 1 && sign !== -1) return false;
  if (!state.travelSign) state.travelSign = sign;

  while (state.routeIdx < state.route.length) {
    const target = state.route[state.routeIdx];
    const bounds = stationBounds(target.key, state.direction);
    if (!bounds || bounds.featureIdx !== s.featureIdx) break;
    const entryKm = sign > 0 ? bounds.lowKm : bounds.highKm;
    const exitKm = sign > 0 ? bounds.highKm : bounds.lowKm;
    const beyond = (km, ref) => (sign > 0 ? km > ref : km < ref);
    const reached = (km, ref) => (sign > 0 ? km >= ref : km <= ref);

    if (beyond(s.km, exitKm)) {
      advance(state); // já passou: sem eventos
      continue;
    }
    if (reached(s.km, entryKm)) {
      state.current = "STOPPED_AT"; // dentro da estação: só mede a partida
      state.stopKey = target.key;
    }
    break;
  }
  return true;
};

/** Sinal de progresso (km crescente ou decrescente) inferido das amostras. */
const inferTravelSign = (state, km) => {
  if (state.lastKm == null) return state.travelSign || 0;
  const d = km - state.lastKm;
  if (Math.abs(d) * 1000 < 3) return state.travelSign || 0; // ruído
  return d > 0 ? 1 : -1;
};

/**
 * Atualiza a máquina com uma amostra snapada.
 * @param {object} state  criado por createState()
 * @param {object} s      { km, featureIdx, speedMps, ts }
 * @returns {Array} eventos emitidos nesta amostra
 */
const update = (state, s) => {
  const events = [];
  if (!state || !s || typeof s.km !== "number") return events;

  // [v7] 1.ª amostra / pós-salto: sincroniza sem eventos e termina aqui.
  if (state.resync) {
    state.resync = false;
    const isFirst = state.lastKm == null;
    state.lastKm = s.km;
    if (resyncSilently(state, s)) return events;
    if (!isFirst) return events;
    // Sem sinal esperado na 1.ª amostra → fluxo antigo (abaixo).
    state.lastKm = null;
  }

  const sign = inferTravelSign(state, s.km);
  if (sign !== 0) state.travelSign = sign;
  state.lastKm = s.km;

  // [v7] A andar CONTRA o sentido do horário (ex: a chegar à estação de
  // origem para começar o serviço, ou ruído de GPS parado): não há chegadas
  // nem partidas deste percurso. Se persistir (3 amostras), volta ao início
  // do percurso e re-sincroniza quando retomar — assim a partida da estação
  // onde inverteu é medida a sério.
  const exp = s.expectedSign;
  if (
    (exp === 1 || exp === -1) &&
    state.travelSign &&
    state.travelSign !== exp
  ) {
    state.againstCount = (state.againstCount || 0) + 1;
    if (state.againstCount >= 3) {
      state.againstCount = 0;
      state.routeIdx = 0;
      state.current = "IN_TRANSIT_TO";
      state.stopKey = state.route[0] ? state.route[0].key : null;
      state.resync = true;
    }
    return events;
  }
  state.againstCount = 0;

  const target = state.route[state.routeIdx];
  if (!target) return events; // percurso esgotado (terminal alcançado)

  const bounds = stationBounds(target.key, state.direction);
  if (!bounds || bounds.featureIdx !== s.featureIdx) return events;

  const trav = state.travelSign || 1;
  // Limite de ENTRADA = o bound que se cruza primeiro no sentido de marcha;
  // limite de SAÍDA = o oposto. (Equivale a: entrada sul p/ sentido norte.)
  const entryKm = trav > 0 ? bounds.lowKm : bounds.highKm;
  const exitKm = trav > 0 ? bounds.highKm : bounds.lowKm;

  const passed = (km, ref) => (trav > 0 ? km >= ref : km <= ref);
  const insidePerimeter =
    s.km >= Math.min(bounds.lowKm, bounds.highKm) &&
    s.km <= Math.max(bounds.lowKm, bounds.highKm);

  switch (state.current) {
    case "IN_TRANSIT_TO": {
      // Disparo IMEDIATO ao cruzar o ponto de entrada do sentido de marcha.
      if (passed(s.km, entryKm)) {
        state.current = "INCOMING_AT";
        state.stopKey = target.key;
        events.push({ type: "incoming", stationKey: target.key, ts: s.ts });
        // Pode já estar parado dentro do perímetro (ping esparso).
        if (insidePerimeter && s.speedMps <= STOPPED_SPEED_MPS) {
          state.current = "STOPPED_AT";
          events.push({ type: "stopped", stationKey: target.key, ts: s.ts });
        }
      }
      break;
    }

    case "INCOMING_AT": {
      // Velocidade ponto-a-ponto cai p/ ≈0 dentro da plataforma → STOPPED_AT.
      if (insidePerimeter && s.speedMps <= STOPPED_SPEED_MPS) {
        state.current = "STOPPED_AT";
        events.push({ type: "stopped", stationKey: target.key, ts: s.ts });
        break;
      }
      // Passagem SEM paragem (comboio não para nesta estação / quartos):
      // cruzou a saída sem nunca ficar a 0 → partida direta.
      if (passed(s.km, exitKm)) {
        events.push({ type: "departed", stationKey: target.key, ts: s.ts });
        advance(state);
      }
      break;
    }

    case "STOPPED_AT": {
      // ANTI-FALSO ARRANQUE: só sai quando ULTRAPASSA fisicamente o ponto de
      // saída. Velocidade ≠ 0 dentro do perímetro é tratada como ruído.
      if (passed(s.km, exitKm)) {
        state.current = "IN_TRANSIT_TO";
        events.push({ type: "departed", stationKey: target.key, ts: s.ts });
        advance(state);
      }
      break;
    }
  }

  return events;
};

/** Avança o stop de referência para a próxima estação do percurso. */
const advance = (state) => {
  state.routeIdx += 1;
  const next = state.route[state.routeIdx];
  state.current = "IN_TRANSIT_TO";
  state.stopKey = next ? next.key : null;
};

module.exports = {
  init,
  createState,
  update,
  stationBounds, // exposto para testes
  STOPPED_SPEED_MPS,
};

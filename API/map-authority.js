"use strict";
// map-authority.js — Autoridade do MAPA / posição dos comboios.
// GPS autonomy + resposta /fertagus por GPS + camada de ghost trains (99xxx).
// Estado dos fantasmas encapsulado aqui (GHOST_ID_SEQ / REVERSED_ID_MAP /
// GHOST_TRAIN_REGISTRY). Deps estáveis via require directo; a OUTPUT_CACHE
// (reatribuída no motor) NUNCA é capturada — é recebida por argumento.
const Geo = require("./src/realtime/gtfs-geo.js");
const GtfsOutput = require("./src/output/gtfs-output.js");
const DelayBlock = require("./src/realtime/delay-block.js");
const DelaysRT = require("./src/realtime/delays-rt.js");
const { parseSmartTime } = require("./dates.js");
const {
  STATION_MAP_IP_TO_JSON,
  STATION_MAP_JSON_TO_IP,
  GPS_CALCULATIONS_ENABLED,
  GPS_AUTONOMOUS_MODE,
  DIRECTION_DETECTION_ENABLED,
} = require("./config.js");

const applyGpsAutonomy = (trainOutput, trainId, richInfo, nowObj) => {
  if (!GPS_CALCULATIONS_ENABLED) return; // [ENVIO URGENTE] só posição no mapa
  if (!GPS_AUTONOMOUS_MODE) return;
  try {
    if (!Geo.isGpsFresh(String(trainId))) return; // sem GPS → fluxo IP normal

    // ── [GPS AUTONOMY] PASSAGENS POR POSIÇÃO ──────────────────────────────
    // A IP não está a marcar ComboioPassou; inferimos pela posição snapped:
    // toda a estação que ficou PARA TRÁS no sentido de marcha está passada.
    // Cobre também reinícios do servidor a meio da viagem.
    const veh = Geo.getVehicle(String(trainId));
    const stationsProj = Geo._stations();
    if (veh && veh.lastPing && stationsProj) {
      // Sentido de marcha em termos de km da linha: compara a projeção da
      // primeira e da última estação do trajeto deste comboio.
      const routeKeys = (trainOutput.NodesPassagemComboio || [])
        .map((n) => {
          const nm = (n.NomeEstacao || "").toUpperCase().replace(/-A$/, "");
          return STATION_MAP_IP_TO_JSON[nm];
        })
        .filter((k) => k && stationsProj[k] && stationsProj[k].proj);

      if (routeKeys.length >= 2) {
        const kmFirst = stationsProj[routeKeys[0]].proj.km;
        const kmLast = stationsProj[routeKeys[routeKeys.length - 1]].proj.km;
        const dirSign = kmLast >= kmFirst ? 1 : -1;
        const PASSED_MARGIN_KM = 0.1; // 100 m depois da estação = passou

        for (const node of trainOutput.NodesPassagemComboio || []) {
          if (node.ComboioPassou) continue; // já marcado pela IP — não tocar
          const nm = (node.NomeEstacao || "").toUpperCase().replace(/-A$/, "");
          const key = STATION_MAP_IP_TO_JSON[nm];
          const st = key && stationsProj[key];
          if (!st || !st.proj) continue;
          if (st.proj.featureIdx !== veh.lastPing.featureIdx) continue;

          // Estação atrás do comboio (no sentido de marcha) com folga de 100 m.
          const aheadKm = (st.proj.km - veh.lastPing.km) * dirSign;
          if (aheadKm < -PASSED_MARGIN_KM) {
            node.ComboioPassou = true;
          }
        }
      }
    }

    trainOutput.Live = true;
    trainOutput.AtrasoDinamico = true;

    const now = nowObj.getTime();
    let maxDelayMins = 0;

    for (const node of trainOutput.NodesPassagemComboio || []) {
      if (node.ComboioPassou) continue; // passados ficam como a IP os deixou

      const nomeUpper = (node.NomeEstacao || "")
        .toUpperCase()
        .replace(/-A$/, "");
      const key = STATION_MAP_IP_TO_JSON[nomeUpper];
      if (!key || richInfo[key] == null) continue;

      const delayS = GtfsOutput.dynamicStationDelayS(String(trainId), key, now);
      if (delayS == null) continue; // sem atraso medido p/ esta estação

      // [v7.1] HoraPrevista = hora de PARTIDA programada do nó (HoraProgramada,
      // que vem do horário de partidas) + atraso. Antes partia da hora de
      // CHEGADA (richInfo) — 1 min mais cedo — e a previsão podia ficar ANTES
      // da partida programada, a mostrar menos 1 min de atraso.
      const progStr =
        node.HoraProgramada && !String(node.HoraProgramada).startsWith("HH")
          ? String(node.HoraProgramada)
          : String(richInfo[key]);
      const prog = parseSmartTime(progStr, nowObj);
      if (!prog) continue;
      // Nunca antes da partida programada.
      const prev = new Date(prog.getTime() + Math.max(0, delayS) * 1000);
      const hh = String(prev.getHours()).padStart(2, "0");
      const mm = String(prev.getMinutes()).padStart(2, "0");
      const ss = String(prev.getSeconds()).padStart(2, "0");
      node.HoraPrevista = `${hh}:${mm}:${ss}`;

      maxDelayMins = Math.max(maxDelayMins, Math.round(delayS / 60));
    }

    // SituacaoComboio coerente com o atraso cinemático (não o da IP),
    // sem pisar estados fortes (SUPRIMIDO etc.).
    const sit = (trainOutput.SituacaoComboio || "").toUpperCase();
    if (!sit.includes("SUPRIMIDO")) {
      trainOutput.SituacaoComboio =
        maxDelayMins >= 1
          ? `Circula com atraso de ${maxDelayMins} min.`
          : "Em circulação";
    }
  } catch (e) {
    console.error(`[GPS-AUTONOMY] ${trainId}:`, e.message);
  }
};

// ─── [GPS AUTONOMY] FILTRO DO /fertagus ─────────────────────────────────────
// Em modo autónomo, o endpoint serve APENAS os comboios que existem na TML
// com GPS fresco — a verdade é o GPS, não o estado herdado da IP.
// Chaves reservadas (futureTrains/extratrains/abnormalRoutes) passam sempre.
const RESERVED_OUTPUT_KEYS = new Set([
  "futureTrains",
  "extratrains",
  "abnormalRoutes",
]);

// [GPS-ÚNICO] A TML é a fonte de verdade: QUALQUER comboio com GPS fresco
// aparece SEMPRE e nunca é removido por lógica de supressão/ghost a montante.
// A única transformação permitida é a troca de número por sentido invertido
// (ID fantasma 99xxx). Construímos a resposta A PARTIR da lista de veículos
// vivos da TML, não filtrando o OUTPUT_CACHE — assim, qualquer "delete" feito
// no pipeline deixa de afetar o que é servido (o comboio continua na TML e
// reaparece de imediato). O cache só ENRIQUECE (nós, atrasos) quando existe.
const buildGpsLiveResponse = (cache) => {
  try {
    const liveIds = Geo.liveVehicleIds();
    // Feed TML vazio/em baixo → devolve o cache tal como está (não inventamos
    // nem escondemos nada por culpa da TML).
    if (liveIds.length === 0) return cache;

    const out = {};
    // 1) Chaves reservadas (futureTrains/extratrains/abnormalRoutes) passam.
    for (const k of RESERVED_OUTPUT_KEYS) {
      if (cache[k] !== undefined) out[k] = cache[k];
    }

    // 2) Um comboio cujo número foi reatribuído por sentido invertido aparece
    //    SÓ com o ID fantasma — o número original (errado) é omitido. Mapa
    //    inverso fantasma→original para sabermos quais omitir.
    const rerouted = new Set(); // IDs originais que viraram fantasma
    for (const origId of REVERSED_ID_MAP.keys()) rerouted.add(String(origId));

    // 3) Todo o veículo vivo na TML entra. Se já está no cache, usa-se esse
    //    objeto (rico). Se não, constrói-se um placeholder mínimo (o comboio
    //    existe fisicamente; mais vale mostrá-lo sem nós do que escondê-lo).
    for (const id of liveIds) {
      const idStr = String(id);
      if (RESERVED_OUTPUT_KEYS.has(idStr)) continue;
      if (rerouted.has(idStr)) continue; // número errado: só entra o fantasma

      if (cache[idStr] !== undefined) {
        out[idStr] = cache[idStr];
      } else if (GHOST_TRAIN_REGISTRY.has(idStr)) {
        // Fantasma sem entrada no cache ainda → gera o output agora.
        const g = buildGhostTrainOutput(idStr, new Date());
        if (g) out[idStr] = g;
      } else {
        // Veículo vivo sem qualquer dado: placeholder mínimo, mas visível.
        out[idStr] = {
          "id-comboio": idStr,
          Live: true,
          SemDados: true,
          Operador: "FERTAGUS",
          SituacaoComboio: "Em circulação",
          NodesPassagemComboio: [],
        };
      }
    }

    return out;
  } catch (e) {
    console.error("[GPS-AUTONOMY] buildGpsLiveResponse:", e.message);
    return cache; // fail-safe: nunca degradar o endpoint
  }
};

// --- PROCESSAMENTO ---
// ─── [SENTIDO INVERTIDO] v7: DETEÇÃO POR ESTAÇÕES + LIGAÇÃO A HORÁRIO ───────
// O sentido real é decidido SÓ pelas estações por onde o comboio passa: o
// primeiro par de estações consecutivas distintas (ex: Coina → Fogueteiro =
// sentido Lisboa). Se contradiz o sentido do horário do número que a TML
// declara, o número está errado. Então:
//   1. o número entra na lista de "sem cálculo de atraso" (delay-block.js);
//   2. procura-se um horário EXISTENTE no sentido real com partida da 1.ª
//      estação do par a no máximo 3 min da hora observada. Se existir e não
//      tiver já um comboio ativo, o comboio passa a usar ESSE número/horário;
//   3. senão, recebe um ID fantasma 99xxx (sem horário) — mecanismo antigo.
// A decisão é memorizada (sem oscilação) e expira com o comboio (30 min sem
// GPS) ou no reset diário das 04:00.

let GHOST_ID_SEQ = 99001;
const REVERSED_ID_MAP = new Map(); // idTML → idFantasma | idHorárioLigado
const GHOST_TRAIN_REGISTRY = new Map(); // idFantasma → { direction, observedTimes, createdAt, sourceTmlId }
const LINKED_TRIPS = new Map(); // idHorárioLigado → { sourceTmlId, createdAt, lastSeenTs, fromKey }

const LINK_MAX_DIFF_MS = 3 * 60 * 1000;

// Ordem física das estações (sul→norte). As chaves de STATION_MAP_JSON_TO_IP
// já estão por esta ordem; o sentido "margem" usa-a invertida.
const STATION_ORDER_KEYS = Object.keys(STATION_MAP_JSON_TO_IP);

// Horários injetados pelo index.js (init): getters, porque são recarregáveis.
let _ctx = {
  getRichSchedule: () => [],
  getDepartureSchedule: () => [],
  getRichById: () => null,
  runsToday: () => true,
};
const init = (ctx = {}) => {
  _ctx = { ..._ctx, ...ctx };
};

// Hora planeada de PARTIDA de um horário numa estação (partidas → chegadas).
const scheduledDepartureMs = (trip, key, nowObj) => {
  const dep = (_ctx.getDepartureSchedule() || []).find(
    (t) => String(t.id) === String(trip.id) && t[key],
  );
  const str = (dep && dep[key]) || trip[key];
  if (!str) return null;
  const d = parseSmartTime(String(str), nowObj);
  return d ? d.getTime() : null;
};

// Um horário "já tem comboio ativo" se um veículo com esse número está vivo na
// TML ou se já foi ligado a outro comboio invertido.
const tripIsTaken = (id) => {
  const idStr = String(id);
  if (Geo.isGpsFresh(idStr)) return true;
  if (LINKED_TRIPS.has(idStr)) return true;
  for (const v of REVERSED_ID_MAP.values())
    if (String(v) === idStr) return true;
  return false;
};

// Procura o horário existente que corresponde ao comboio observado.
// Devolve { id, diffMs, taken } do melhor candidato, ou null.
const findMatchingTrip = (tmlId, pair, nowObj) => {
  let best = null;
  for (const t of _ctx.getRichSchedule() || []) {
    if (String(t.id) === String(tmlId)) continue;
    if (t.direction !== pair.direction) continue;
    if (!t[pair.fromKey]) continue;
    if (!_ctx.runsToday(t, nowObj)) continue;
    const schedMs = scheduledDepartureMs(t, pair.fromKey, nowObj);
    if (schedMs == null) continue;
    const diffMs = Math.abs(pair.fromDepartureTs - schedMs);
    if (diffMs > LINK_MAX_DIFF_MS) continue;
    if (!best || diffMs < best.diffMs) best = { id: String(t.id), diffMs };
  }
  if (best) best.taken = tripIsTaken(best.id);
  return best;
};

// Resolve (e memoiza) o ID a usar para um comboio. Se o sentido real observado
// pelas estações contradiz o sentido do horário, devolve o número do horário
// ligado ou um ID fantasma.
const resolveDirectionalId = (trainId, richInfo, nowObj) => {
  const idStr = String(trainId);
  // [SENTIDO INVERTIDO] Desligado → devolve sempre o número original, intacto.
  if (!DIRECTION_DETECTION_ENABLED) return idStr;
  if (!GPS_CALCULATIONS_ENABLED) return idStr;
  // Já reatribuído nesta viagem → mantém a mesma decisão (sem oscilação).
  if (REVERSED_ID_MAP.has(idStr)) return REVERSED_ID_MAP.get(idStr);
  if (!richInfo || !richInfo.direction) return idStr;
  // Um horário que JÁ recebeu um comboio ligado não é re-avaliado.
  if (LINKED_TRIPS.has(idStr)) return idStr;

  const declared = richInfo.direction === "margem" ? "margem" : "lisboa";
  // Estação de origem do horário declarado (1.ª com hora no sentido dele).
  const ordered =
    declared === "margem"
      ? [...STATION_ORDER_KEYS].reverse()
      : STATION_ORDER_KEYS;
  const originKey = ordered.find((k) => richInfo[k]) || null;

  const pair = Geo.observedFirstPair(idStr, originKey);
  if (!pair) return idStr; // ainda não passou por 2 estações → confia no número

  if (pair.direction === declared) return idStr; // coerente → normal

  // ── DIVERGÊNCIA CONFIRMADA PELAS ESTAÇÕES ──
  DelayBlock.block(idStr, `sentido_invertido: ${pair.fromKey} → ${pair.toKey}`);

  const match = findMatchingTrip(idStr, pair, nowObj);
  if (match && !match.taken) {
    // Estado antigo (parado) desse número, se existir, não pode contaminar o
    // comboio ligado: recomeça limpo (máquina de estados + medições).
    Geo.removeVehicle(match.id);
    DelaysRT.cleanupTrain(match.id);
    REVERSED_ID_MAP.set(idStr, match.id);
    LINKED_TRIPS.set(match.id, {
      sourceTmlId: idStr,
      createdAt: nowObj.getTime(),
      lastSeenTs: nowObj.getTime(),
      fromKey: pair.fromKey,
    });
    console.warn(
      `[SENTIDO INVERTIDO] Comboio TML ${idStr} declara "${declared}" mas passou ` +
        `${pair.fromKey} → ${pair.toKey} ("${pair.direction}"). Ligado ao horário ` +
        `${match.id} (partida de ${pair.fromKey} a ${Math.round(match.diffMs / 1000)} s).`,
    );
    return match.id;
  }

  const ghostId = String(GHOST_ID_SEQ++);
  REVERSED_ID_MAP.set(idStr, ghostId);
  GHOST_TRAIN_REGISTRY.set(ghostId, {
    direction: pair.direction, // sentido REAL observado
    observedTimes: {}, // key → "HH:MM:SS" reais (preenchido à passagem)
    createdAt: nowObj.getTime(),
    sourceTmlId: idStr,
  });
  console.warn(
    `[SENTIDO INVERTIDO] Comboio TML ${idStr} declara "${declared}" mas passou ` +
      `${pair.fromKey} → ${pair.toKey} ("${pair.direction}"). ` +
      (match
        ? `Horário ${match.id} já tem comboio ativo. `
        : `Sem horário a ≤3 min. `) +
      `Reatribuído ao fantasma ${ghostId} (sem horário associado).`,
  );
  return ghostId;
};

// [v7] Ingestão TML: um ping do número original segue para o ID reatribuído,
// já com o sentido e o percurso CERTOS (do horário ligado, ou sem horário no
// caso do fantasma). Antes seguia com o sentido/percurso do número errado.
const rerouteMeta = (meta) => {
  if (!meta || !meta.trainId) return meta;
  const target = REVERSED_ID_MAP.get(String(meta.trainId));
  if (!target) return meta;

  const reg = GHOST_TRAIN_REGISTRY.get(target);
  if (reg) {
    return { ...meta, trainId: target, direction: reg.direction, route: [] };
  }

  const link = LINKED_TRIPS.get(target);
  const rich = _ctx.getRichById(target);
  if (link && rich) {
    const route = GtfsOutput.buildRouteFromRich(rich, target) || [];
    return {
      ...meta,
      trainId: target,
      direction: rich.direction === "margem" ? "margem" : "lisboa",
      route,
    };
  }
  return { ...meta, trainId: target };
};

const isLinkedTrip = (id) => LINKED_TRIPS.has(String(id));

// Constrói/atualiza o trainOutput de um fantasma (99xxx): sem horário, posição
// via GPS, horas reais registadas à passagem, previsão "a horas" (HoraPrevista
// null) para o resto. Não inventa atrasos.
const buildGhostTrainOutput = (ghostId, nowObj) => {
  const reg = GHOST_TRAIN_REGISTRY.get(ghostId);
  if (!reg) return null;

  const dirKeys =
    reg.direction === "margem"
      ? [...STATION_ORDER_KEYS].reverse()
      : STATION_ORDER_KEYS;

  const veh = Geo.getVehicle(ghostId);
  const stationsProj = Geo._stations();

  // Marca de presença: enquanto houver GPS fresco, o fantasma está vivo.
  if (veh && veh.lastPing && Geo.isGpsFresh(ghostId)) {
    reg.lastSeenTs = veh.lastPing.ts;
  }

  let dirSign = 1;
  if (stationsProj) {
    const first = stationsProj[dirKeys[0]] && stationsProj[dirKeys[0]].proj;
    const last =
      stationsProj[dirKeys[dirKeys.length - 1]] &&
      stationsProj[dirKeys[dirKeys.length - 1]].proj;
    if (first && last) dirSign = last.km >= first.km ? 1 : -1;
  }

  const nodes = dirKeys.map((key) => {
    const nomeIP = STATION_MAP_JSON_TO_IP[key] || key;
    let passou = false;

    if (
      veh &&
      veh.lastPing &&
      stationsProj &&
      stationsProj[key] &&
      stationsProj[key].proj &&
      stationsProj[key].proj.featureIdx === veh.lastPing.featureIdx
    ) {
      const aheadKm = (stationsProj[key].proj.km - veh.lastPing.km) * dirSign;
      if (aheadKm < -0.1) passou = true; // 100 m para trás = passou
    }

    if (passou && !reg.observedTimes[key]) {
      const hh = String(nowObj.getHours()).padStart(2, "0");
      const mm = String(nowObj.getMinutes()).padStart(2, "0");
      const ss = String(nowObj.getSeconds()).padStart(2, "0");
      reg.observedTimes[key] = `${hh}:${mm}:${ss}`;
    }

    return {
      NomeEstacao: nomeIP,
      ComboioPassou: passou,
      HoraPrevista: reg.observedTimes[key] || null, // null = horário desconhecido
      Atraso: 0,
    };
  });

  return {
    "id-comboio": ghostId,
    Origem: STATION_MAP_JSON_TO_IP[dirKeys[0]] || dirKeys[0],
    Destino:
      STATION_MAP_JSON_TO_IP[dirKeys[dirKeys.length - 1]] ||
      dirKeys[dirKeys.length - 1],
    Operador: "FERTAGUS",
    TipoServico: "URB|SUBUR",
    Live: true,
    AtrasoDinamico: false, // sem horário → não afirmamos atraso
    SemHorario: true, // flag p/ a app: comboio sem número/horário fiável
    Ocupacao: null,
    SituacaoComboio: "Em circulação",
    NodesPassagemComboio: nodes,
  };
};

// Limpeza de fantasmas: SÓ liberta memória de comboios que já não estão na TML
// há muito tempo (terminaram a viagem). Nunca remove um fantasma que ainda
// tenha GPS — e mantém o mapeamento de número ESTÁVEL durante uma janela larga
// para que, se o comboio reaparecer (paragem longa, túnel), recupere o MESMO
// ID fantasma em vez de receber um número novo.
const GHOST_STALE_MS = 30 * 60 * 1000; // 30 min sem qualquer ping → terminou
const cleanupGhostTrains = (now = Date.now(), outputCache = {}) => {
  // [v7] Ligações a horários: mesma regra (30 min sem GPS → terminou).
  for (const [linkedId, link] of LINKED_TRIPS) {
    if (Geo.isGpsFresh(linkedId, now)) {
      link.lastSeenTs = now;
      continue;
    }
    if (now - (link.lastSeenTs || link.createdAt || 0) > GHOST_STALE_MS) {
      LINKED_TRIPS.delete(linkedId);
      if (REVERSED_ID_MAP.get(link.sourceTmlId) === linkedId) {
        REVERSED_ID_MAP.delete(link.sourceTmlId);
      }
    }
  }
  for (const [ghostId, reg] of GHOST_TRAIN_REGISTRY) {
    if (Geo.isGpsFresh(ghostId, now)) continue; // vivo → nunca mexer
    const lastSeen = reg.lastSeenTs || reg.createdAt || 0;
    if (now - lastSeen > GHOST_STALE_MS) {
      GHOST_TRAIN_REGISTRY.delete(ghostId);
      REVERSED_ID_MAP.delete(reg.sourceTmlId);
      delete outputCache[ghostId];
      Geo.removeVehicle(ghostId);
    }
  }
};

// [v7] Reset diário (04:00): decisões de sentido invertido são do dia.
const resetDay = () => {
  REVERSED_ID_MAP.clear();
  GHOST_TRAIN_REGISTRY.clear();
  LINKED_TRIPS.clear();
};

module.exports = {
  init,
  applyGpsAutonomy,
  buildGpsLiveResponse,
  resolveDirectionalId,
  buildGhostTrainOutput,
  cleanupGhostTrains,
  rerouteMeta,
  isLinkedTrip,
  resetDay,
  getReversedId: (id) => REVERSED_ID_MAP.get(String(id)),
  _findMatchingTrip: findMatchingTrip, // exposto para testes
};

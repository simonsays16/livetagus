"use strict";
// map-authority.js — Autoridade do MAPA / posição dos comboios.
// GPS autonomy + resposta /fertagus por GPS + camada de ghost trains (99xxx).
// Estado dos fantasmas encapsulado aqui (GHOST_ID_SEQ / REVERSED_ID_MAP /
// GHOST_TRAIN_REGISTRY). Deps estáveis via require directo; a OUTPUT_CACHE
// (reatribuída no motor) NUNCA é capturada — é recebida por argumento.
const Geo = require("./src/realtime/gtfs-geo.js");
const GtfsOutput = require("./src/output/gtfs-output.js");
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
      if (delayS == null) continue; // cinemático indisponível p/ esta estação

      // HoraPrevista = HoraProgramada (richInfo) + atraso cinemático
      const prog = parseSmartTime(
        String(richInfo[key]).substring(0, 5),
        nowObj,
      );
      if (!prog) continue;
      const prev = new Date(prog.getTime() + delayS * 1000);
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
// ─── [SENTIDO INVERTIDO] REATRIBUIÇÃO DE ID FANTASMA ────────────────────────
// Quando o número de comboio do feed TML indica um sentido mas o GPS viaja no
// oposto, o número está corrompido (dado errado da TML). Não confiamos no
// horário desse número: atribuímos um ID sintético >= 99001 que NÃO existe na
// base, e o comboio passa a viver SEM horário — só posição + horas reais
// registadas à passagem; previsões sempre "a horas" (nunca afirmamos atraso,
// porque o horário real é desconhecido).

let GHOST_ID_SEQ = 99001;
const REVERSED_ID_MAP = new Map(); // idTML → idFantasma (estável durante a viagem)
const GHOST_TRAIN_REGISTRY = new Map(); // idFantasma → { direction, observedTimes, createdAt, sourceTmlId }

// Ordem física das estações (sul→norte). As chaves de STATION_MAP_JSON_TO_IP
// já estão por esta ordem; o sentido "margem" usa-a invertida.
const STATION_ORDER_KEYS = Object.keys(STATION_MAP_JSON_TO_IP);

// Resolve (e memoiza) o ID a usar para um comboio. Se o sentido real observado
// pelo GPS contradiz o sentido declarado pelo número, devolve um ID fantasma.
const resolveDirectionalId = (trainId, richInfo, nowObj) => {
  const idStr = String(trainId);
  // [SENTIDO INVERTIDO] Desligado → devolve sempre o número original, intacto.
  if (!DIRECTION_DETECTION_ENABLED) return idStr;
  if (!GPS_CALCULATIONS_ENABLED) return idStr;
  // Já reatribuído nesta viagem → mantém o mesmo fantasma (sem oscilação).
  if (REVERSED_ID_MAP.has(idStr)) return REVERSED_ID_MAP.get(idStr);
  if (!richInfo || !richInfo.direction) return idStr;

  const obs = Geo.observedDirection(idStr);
  if (!obs) return idStr; // parado/insuficiente → confia no número

  const declared = richInfo.direction === "margem" ? "margem" : "lisboa";
  if (obs === declared) return idStr; // coerente → normal

  // ── DIVERGÊNCIA CONFIRMADA: criar fantasma ──
  const ghostId = String(GHOST_ID_SEQ++);
  REVERSED_ID_MAP.set(idStr, ghostId);
  GHOST_TRAIN_REGISTRY.set(ghostId, {
    direction: obs, // sentido REAL observado
    observedTimes: {}, // key → "HH:MM:SS" reais (preenchido à passagem)
    createdAt: nowObj.getTime(),
    sourceTmlId: idStr,
  });
  console.warn(
    `[SENTIDO INVERTIDO] Comboio TML ${idStr} declara "${declared}" mas o GPS ` +
      `viaja "${obs}". Reatribuído ao fantasma ${ghostId} (sem horário associado).`,
  );
  return ghostId;
};

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

module.exports = {
  applyGpsAutonomy,
  buildGpsLiveResponse,
  resolveDirectionalId,
  buildGhostTrainOutput,
  cleanupGhostTrains,
  getReversedId: (id) => REVERSED_ID_MAP.get(String(id)),
};

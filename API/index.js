require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");
const fs = require("fs");
const AnalyticsManager = require("./analytics.js");
const DelayManager = require("./delays.js");
const AvisosManager = require("./avisos.js");
const GhostManager = require("./ghosts.js");
const VerifyManager = require("./verify.js");

const app = express();
app.use(cors());

// --- CONFIGURAÇÃO ---
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const API_BASE = process.env.API_BASE;

// Middleware para verificar a API Key
const protectRoute = (req, res, next) => {
  const userKey = req.headers["x-api-key"];

  if (!userKey || userKey !== API_KEY) {
    return res.status(403).json({
      error: "Acesso negado",
      message:
        "API de uso exclusivo da livetagus.pt. o acesso não autorizado é restrito e monitorizado.",
      documentation_url:
        "https://github.com/simonsays16/livetagus?tab=readme-ov-file#important-note-about-the-api",
    });
  }
  next();
};

// Mapeamento de nomes
const STATION_MAP_JSON_TO_IP = {
  setubal: "SETÚBAL",
  palmela: "PALMELA",
  venda_do_alcaide: "VENDA DO ALCAIDE",
  pinhal_novo: "PINHAL NOVO",
  penalva: "PENALVA",
  coina: "COINA",
  fogueteiro: "FOGUETEIRO",
  foros_de_amora: "FOROS DE AMORA",
  corroios: "CORROIOS",
  pragal: "PRAGAL",
  campolide: "CAMPOLIDE",
  sete_rios: "SETE RIOS",
  entrecampos: "ENTRECAMPOS",
  roma_areeiro: "ROMA-AREEIRO",
};

const STATION_MAP_IP_TO_JSON = Object.entries(STATION_MAP_JSON_TO_IP).reduce(
  (acc, [k, v]) => {
    acc[v] = k;
    return acc;
  },
  {},
);

// IDs Fixos para Fallback Offline
const STATION_IDS_FIXED = {
  SETÚBAL: 9468122,
  PALMELA: 9468098,
  "VENDA DO ALCAIDE": 9468049,
  "PINHAL NOVO": 9468007,
  PENALVA: 9417095,
  COINA: 9417236,
  FOGUETEIRO: 9417186,
  "FOROS DE AMORA": 9417152,
  CORROIOS: 9417137,
  PRAGAL: 9417087,
  CAMPOLIDE: 9467033,
  "SETE RIOS": 9466076,
  ENTRECAMPOS: 9466050,
  "ROMA-AREEIRO": 9466035,
};

// Ordem Sul -> Norte
const STATION_ORDER_LISBOA = [
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

// Ordem Norte -> Sul (Inversa)
const STATION_ORDER_MARGEM = [...STATION_ORDER_LISBOA].reverse();

// FIX #6: Cache-Control e Pragma forçam a IP (e qualquer CDN/proxy intermédio)
// a retornar sempre uma resposta fresca.
const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.infraestruturasdeportugal.pt/",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

// --- BASE DE DADOS OFFLINE ---
let RICH_SCHEDULE = [];
let DEPARTURE_SCHEDULE = [];
let HOLIDAYS = {};

const loadFile = (filenames, direction) => {
  for (const filename of filenames) {
    const p = path.join(__dirname, filename);
    if (fs.existsSync(p)) {
      try {
        const raw = JSON.parse(fs.readFileSync(p, "utf8"));
        let trips = raw.trips || raw;
        trips = trips.map((t) => ({
          ...t,
          direction: direction,
          id: String(t.id),
        }));
        console.log(
          `[LOAD SUCCESS] ${filename} carregado. (${trips.length} viagens)`,
        );
        return trips;
      } catch (e) {
        console.error(`[LOAD ERROR] Erro ao ler ${filename}:`, e.message);
      }
    }
  }
  return [];
};

const loadDataFiles = () => {
  try {
    console.log("------------------------------------------------");
    console.log("[INIT] A iniciar carregamento de dados...");

    const hPath = path.join(__dirname, "feriados.json");
    if (fs.existsSync(hPath)) {
      HOLIDAYS = JSON.parse(fs.readFileSync(hPath, "utf8"));
    }

    const arrLisboa = loadFile(
      ["fertagus_sentido_lisboa_chegada.json"],
      "lisboa",
    );
    const arrMargem = loadFile(
      ["fertagus_sentido_margem_chegadas.json"],
      "margem",
    );
    RICH_SCHEDULE = [...arrLisboa, ...arrMargem];

    const depLisboa = loadFile(
      ["fertagus_sentido_lisboa_partida.json"],
      "lisboa",
    );
    const depMargem = loadFile(
      ["fertagus_sentido_margem_partida.json"],
      "margem",
    );
    DEPARTURE_SCHEDULE = [...depLisboa, ...depMargem];

    console.log(
      `[INIT] Memória: ${RICH_SCHEDULE.length} Chegadas | ${DEPARTURE_SCHEDULE.length} Partidas`,
    );
    console.log("------------------------------------------------");
  } catch (e) {
    console.error("[INIT FATAL] Erro:", e);
  }
};

loadDataFiles();

// --- MEMÓRIA ---
let OUTPUT_CACHE = {};
let TRAIN_MEMORY = {}; // { [id]: { history: {}, lastDelay: 0, nextWakeUp: 0, lastResult: null } }
let FUTURE_TRAINS_CACHE = {};
let IS_CYCLE_RUNNING = false;
let OFFLINE_NULL_COUNTS = {}; // { [trainId]: number } - Contador de respostas nulas consecutivas no checkOfflineTrains

// --- DATE & SCHEDULE HELPERS ---

const formatDateStr = (d) => {
  const pad = (n) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const getOperationalInfo = (now = new Date()) => {
  const d = new Date(now.getTime());
  const hour = d.getHours();

  // Dia operacional Fertagus (05h - 02h30)
  if (hour < 5) {
    d.setDate(d.getDate() - 1);
  }

  const dateStr = formatDateStr(d);
  const dayOfWeek = d.getDay();
  const isHoliday = !!HOLIDAYS[dateStr];
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  return {
    operationalDateStr: dateStr,
    isWeekendOrHoliday: isHoliday || isWeekend,
  };
};

const parseSmartTime = (timeStr, now = new Date()) => {
  if (!timeStr) return null;
  const parts = timeStr.split(":");
  const h = parseInt(parts[0]);
  const m = parseInt(parts[1]);
  const s = parts[2] ? parseInt(parts[2]) : 0;

  const d = new Date(now);
  d.setHours(h, m, s, 0);

  const nowH = now.getHours();

  // FIX #2: madrugada (ex: 01h) e o comboio é da noite anterior (ex: 23h).
  if (nowH < 5 && h >= 18) {
    d.setDate(d.getDate() - 1);
  }
  // FIX #3: noite (ex: 23h) e o comboio é de madrugada (ex: 00h-04h) → dia seguinte.
  else if (nowH >= 20 && h < 5) {
    d.setDate(d.getDate() + 1);
  }
  // noite (ex: 22h) e o comboio é da manhã/tarde (ex: 06h-15h), é no dia seguinte.
  else if (nowH >= 18 && h < 16) {
    d.setDate(d.getDate() + 1);
  }

  return d;
};

const formatTimeHHMMSS = (d) => {
  const pad = (n) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const subtractMinutes = (timeStr, minutes) => {
  const [h, m] = timeStr.split(":").map(Number);
  let date = new Date();
  date.setHours(h, m, 0, 0);

  const totalSeconds = Math.round(minutes * 60);
  date.setSeconds(date.getSeconds() - totalSeconds);

  const pad = (n) => n.toString().padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

let IP_CONSECUTIVE_ERRORS = 0;
let IP_IS_DOWN = false;

// --- FETCHING ---

const fetchDetails = async (tid, dateStr) => {
  const url = `${API_BASE}/horarios-ncombio/${tid}/${dateStr}`;
  try {
    const r = await fetch(url, { headers: FETCH_HEADERS, timeout: 10000 });
    if (!r.ok) return null;
    const j = await r.json();
    IP_CONSECUTIVE_ERRORS = 0;
    IP_IS_DOWN = false;

    const response = j.response;

    // FIX: Deteção de resposta totalmente nula da IP (bug intermitente)
    // Em vez de marcar imediatamente como SUPRIMIDO, sinalizamos para que
    // processTrain e checkOfflineTrains decidam com base no contexto.
    if (response) {
      const isAllNull =
        response.DataHoraDestino === null &&
        response.DataHoraOrigem === null &&
        response.Destino === null &&
        response.DuracaoViagem === null &&
        response.NodesPassagemComboio === null &&
        response.Operador === null &&
        response.Origem === null &&
        response.SituacaoComboio === null &&
        response.TipoServico === null;

      if (isAllNull) {
        response._isAllNull = true;
      }
    }

    return response;
  } catch (e) {
    IP_CONSECUTIVE_ERRORS++;

    if (IP_CONSECUTIVE_ERRORS > 10) {
      if (!IP_IS_DOWN)
        console.error(
          `[ALERTA FATAL] Servidores da IP em baixo detectados! (${e.message})`,
        );
      IP_IS_DOWN = true;
    }

    return null;
  }
};

// --- INICIALIZAÇÃO DO GHOST MANAGER ---
// Injetamos as referências após a definição de fetchDetails e TRAIN_MEMORY.
// Usamos closures para garantir que o GhostManager acede sempre ao estado atual,
// mesmo quando FUTURE_TRAINS_CACHE é reassigned (FUTURE_TRAINS_CACHE = results).
GhostManager.init(
  fetchDetails,
  () => TRAIN_MEMORY,
  (id, value) => {
    FUTURE_TRAINS_CACHE[id] = value;
  },
);

// --- TURNAROUND PREDICTION ---

const isRushHourFrequency = (scheduledTime, direction) => {
  const [h, m] = scheduledTime.split(":").map(Number);
  const currentTotalMinutes = h * 60 + m;

  const neighbors = DEPARTURE_SCHEDULE.filter(
    (t) => t.direction === direction && t.roma_areeiro,
  );

  return neighbors.some((t) => {
    const [nh, nm] = t.roma_areeiro.split(":").map(Number);
    const neighborTotalMinutes = nh * 60 + nm;
    const diff = Math.abs(currentTotalMinutes - neighborTotalMinutes);
    return diff > 0 && diff <= 10;
  });
};

const checkTurnaroundDelay = (
  currentTrainId,
  scheduledDepartureStr,
  nowObj,
) => {
  // 1. Restrição: Só funciona durante frequências de 10 minutos (Hora de Ponta)
  if (!isRushHourFrequency(scheduledDepartureStr, "margem")) return null;

  // O comboio chega planeadamente 7 minutos antes da partida.
  const incomingArrivalStr = subtractMinutes(scheduledDepartureStr, 7);

  const incomingTrainStatic = RICH_SCHEDULE.find(
    (t) =>
      t.direction === "lisboa" &&
      t.roma_areeiro &&
      t.roma_areeiro.startsWith(incomingArrivalStr),
  );

  if (!incomingTrainStatic) return null;

  const incomingTrainLive = OUTPUT_CACHE[String(incomingTrainStatic.id)];

  if (incomingTrainLive && incomingTrainLive.NodesPassagemComboio) {
    const arrivalNode = incomingTrainLive.NodesPassagemComboio.find(
      (n) => n.NomeEstacao.toUpperCase() === "ROMA-AREEIRO",
    );

    if (arrivalNode) {
      const predictedArrivalStr = arrivalNode.HoraPrevista;
      const predictedArrivalDate = parseSmartTime(predictedArrivalStr, nowObj);
      const scheduledDepartureDate = parseSmartTime(
        scheduledDepartureStr,
        nowObj,
      );

      if (predictedArrivalDate && scheduledDepartureDate) {
        const minTurnaroundMs = 3 * 60 * 1000;
        const minDepartureDate = new Date(
          predictedArrivalDate.getTime() + minTurnaroundMs,
        );

        if (minDepartureDate > scheduledDepartureDate) {
          const delaySeconds = Math.floor(
            (minDepartureDate.getTime() - scheduledDepartureDate.getTime()) /
              1000,
          );
          if (delaySeconds > 100) {
            return {
              delaySeconds: delaySeconds,
              predictedDeparture: formatTimeHHMMSS(minDepartureDate),
            };
          }
        }
      }
    }
  }
  return null;
};

// --- FUTURE TRAIN CHECK ---
const checkOfflineTrains = async () => {
  if (typeof isSystemInSleepMode === "function" && isSystemInSleepMode()) {
    console.log(
      `[SLEEP MODE] ${new Date().toLocaleTimeString()} - A dormir. Verificação de comboios futuros suspensa.`,
    );
    return;
  }

  console.log(
    `[FUTURE CHECK] ${new Date().toLocaleTimeString()} - A iniciar atualização de estados futuros...`,
  );

  const now = new Date();
  const nowMs = now.getTime();

  // Data de calendário para consultar as alterações do dia
  const todayDateStr = formatDateStr(now);

  // Garantir que a string 'futureTrains' não é confundida com o ID de um comboio ativo
  const activeIds = Object.keys(OUTPUT_CACHE).filter(
    (k) => k !== "futureTrains",
  );

  // 2. Mapeamento e Identificação dos Comboios do Dia (horário base)
  const baseCandidates = RICH_SCHEDULE.map((t) => {
    let startStr =
      t.direction === "lisboa" ? t.setubal || t.coina : t.roma_areeiro;
    let endStr =
      t.direction === "lisboa" ? t.roma_areeiro : t.setubal || t.coina;

    if (!startStr || !endStr) return null;

    const startObj = parseSmartTime(startStr, now);
    const endObj = parseSmartTime(endStr, now);

    if (!startObj || !endObj) return null;

    return { ...t, startObj, endObj };
  }).filter((t) => {
    if (!t) return false;

    // Ignorar se o comboio já estiver a circular (está nas mãos do ciclo de 10s)
    if (activeIds.includes(String(t.id))) return false;

    // Ignorar anomalias tratadas pelo sistema Ghost
    if (GhostManager.GHOST_SUPPRESSED.has(String(t.id))) return false;
    if (GhostManager.GHOST_TRAINS[String(t.id)]) return false;

    // Verificar calendário (dias úteis vs fins de semana/feriados)
    const trainOpInfo = getOperationalInfo(t.startObj);
    const isTrainWeekendOrHoliday = trainOpInfo.isWeekendOrHoliday;

    const hType = parseInt(t.horario);
    if (hType === 1) return true;
    if (isTrainWeekendOrHoliday && hType === 2) return true;
    if (!isTrainWeekendOrHoliday && hType === 0) return true;
    return false;
  });

  // Adicionar comboios de substituição (horário base mas novo ID na IP)
  const replacementCandidates = VerifyManager.buildReplacementRichInfoList(
    todayDateStr,
    RICH_SCHEDULE,
  )
    .map((t) => {
      const startStr =
        t.direction === "lisboa" ? t.setubal || t.coina : t.roma_areeiro;
      const endStr =
        t.direction === "lisboa" ? t.roma_areeiro : t.setubal || t.coina;

      if (!startStr || !endStr) return null;

      const startObj = parseSmartTime(startStr, now);
      const endObj = parseSmartTime(endStr, now);

      if (!startObj || !endObj) return null;

      return { ...t, startObj, endObj };
    })
    .filter(Boolean)
    .filter((t) => {
      // Excluir se o comboio de substituição já está a circular
      if (activeIds.includes(String(t.id))) return false;
      if (GhostManager.GHOST_SUPPRESSED.has(String(t.id))) return false;
      if (GhostManager.GHOST_TRAINS[String(t.id)]) return false;
      return true;
    });

  // Adicionar comboios extra (especiais, não existem no horário base)
  const extraCandidates = VerifyManager.buildExtraRichInfoList(todayDateStr)
    .map((t) => {
      const startStr =
        t.direction === "lisboa" ? t.setubal || t.coina : t.roma_areeiro;
      if (!startStr) return null;

      const startObj = parseSmartTime(startStr, now);
      if (!startObj) return null;

      // Fim sintético: +3h desde a partida (cobertura conservadora)
      const endObj = new Date(startObj.getTime() + 3 * 60 * 60 * 1000);

      return { ...t, startObj, endObj };
    })
    .filter(Boolean)
    .filter((t) => {
      if (activeIds.includes(String(t.id))) return false;
      if (GhostManager.GHOST_SUPPRESSED.has(String(t.id))) return false;
      if (GhostManager.GHOST_TRAINS[String(t.id)]) return false;
      return true;
    });

  // Combinar todos os candidatos
  const candidates = [
    ...baseCandidates,
    ...replacementCandidates,
    ...extraCandidates,
  ];

  const results = {};
  const fetchCandidates = [];

  for (const t of candidates) {
    const trainDateStr = formatDateStr(t.startObj);
    const trainId = String(t.id);

    // VERIFY: Supressão programada (obras, eventos) — marcar diretamente sem fetch
    // Apenas para comboios do horário base (não para substituições/extras que já são o resultado correto)
    if (
      !t._isReplacement &&
      !t._isExtra &&
      VerifyManager.isSuppressed(trainId, trainDateStr)
    ) {
      console.log(
        `[VERIFY] Comboio ${trainId} suprimido por alteração programada em ${trainDateStr}.`,
      );
      results[trainId] = "SUPRIMIDO";
      continue;
    }

    // VERIFY: Se este comboio base tem substituição no dia, o original não circula
    if (
      !t._isReplacement &&
      !t._isExtra &&
      VerifyManager.getReplacementId(trainId, trainDateStr)
    ) {
      // O comboio original não está ativo — a substituição já foi adicionada como replacementCandidates
      results[trainId] = "SUPRIMIDO";
      continue;
    }

    // poupança de pedidos à IP retirando comboios realizados
    const safeEndMarginMs = t.endObj.getTime() + 90 * 60000;

    const isFinishedToday =
      FUTURE_TRAINS_CACHE[trainId] === "Realizado" &&
      nowMs > t.startObj.getTime();

    if (nowMs > safeEndMarginMs || isFinishedToday) {
      results[trainId] = "Realizado";
    } else {
      fetchCandidates.push(t);
    }
  }

  // 4. Execução Sequencial Anti-DDoS e Anti-Picos de CPU
  for (const t of fetchCandidates) {
    const trainId = String(t.id);
    try {
      const dateStr = formatDateStr(t.startObj);
      const details = await fetchDetails(trainId, dateStr);

      // NULL GUARD para comboios offline:
      // Respostas totalmente nulas precisam de 5 confirmações consecutivas
      if (details && details._isAllNull) {
        OFFLINE_NULL_COUNTS[trainId] = (OFFLINE_NULL_COUNTS[trainId] || 0) + 1;

        if (OFFLINE_NULL_COUNTS[trainId] < 5) {
          console.log(
            `[NULL GUARD OFFLINE] Comboio ${trainId} resposta nula ${OFFLINE_NULL_COUNTS[trainId]}/5. A manter estado anterior.`,
          );
          results[trainId] = FUTURE_TRAINS_CACHE[trainId] || "Sem Informação";
        } else {
          console.log(
            `[NULL GUARD OFFLINE] Comboio ${trainId} confirmado SUPRIMIDO após ${OFFLINE_NULL_COUNTS[trainId]} respostas nulas.`,
          );
          results[trainId] = "SUPRIMIDO";
        }
      } else if (details && details.SituacaoComboio) {
        // Resposta válida → resetar contador
        OFFLINE_NULL_COUNTS[trainId] = 0;

        const situacao = details.SituacaoComboio.trim() || "Sem Informação";
        const nodes = details.NodesPassagemComboio || [];
        const hasStarted = nodes.some((n) => n.ComboioPassou === true);

        // Prevenir que a IP minta dizendo que um comboio das 17h está "em circulação" às 10h da manhã
        const impliesSpuriousLive =
          !hasStarted &&
          (/em circulação/i.test(situacao) || /a horas/i.test(situacao));

        if (impliesSpuriousLive) {
          results[trainId] = "Sem Informação";
        } else {
          results[trainId] = situacao;
        }
      } else {
        results[trainId] = FUTURE_TRAINS_CACHE[trainId] || "Sem Informação";
      }
    } catch (error) {
      console.error(
        `[FUTURE CHECK] Erro de rede isolado no comboio ${t.id}:`,
        error.message,
      );
      results[trainId] = FUTURE_TRAINS_CACHE[trainId] || "Sem Informação";
    }

    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  // 5. Atualização Segura da Memória Global
  FUTURE_TRAINS_CACHE = results;

  // Re-injetar os Ghost Suppressed para garantir que nunca mais regressam à vida
  for (const ghostId of GhostManager.GHOST_SUPPRESSED) {
    FUTURE_TRAINS_CACHE[ghostId] = "SUPRIMIDO";
  }

  // Limpar contadores de nulos para comboios que já não são candidatos
  const candidateIds = new Set(candidates.map((t) => String(t.id)));
  for (const id of Object.keys(OFFLINE_NULL_COUNTS)) {
    if (!candidateIds.has(id)) {
      delete OFFLINE_NULL_COUNTS[id];
    }
  }

  console.log(
    `[FUTURE CHECK] Concluído às ${new Date().toLocaleTimeString()}. Analisados: ${candidates.length} | Pedidos à IP: ${fetchCandidates.length}`,
  );
};

// --- PROCESSAMENTO ---
const processTrain = async (richInfo, originDateStr) => {
  const trainId = String(richInfo.id);
  const nowTime = Date.now();
  const nowObj = new Date();
  const direction = richInfo.direction;

  // Inicialização da memória
  if (!TRAIN_MEMORY[trainId]) {
    TRAIN_MEMORY[trainId] = {
      history: {},
      lastDelay: 0,
      nextWakeUp: 0,
      lastResult: null,
      isFetching: false,
      nullResponseCount: 0,
    };
  }
  const mem = TRAIN_MEMORY[trainId];

  if (nowTime < mem.nextWakeUp && mem.lastResult) {
    return mem.lastResult;
  }

  const richKey = richInfo.roma_areeiro
    ? richInfo.roma_areeiro.substring(0, 5)
    : null;
  let departureTrip = null;
  if (richKey) {
    departureTrip = DEPARTURE_SCHEDULE.find(
      (t) =>
        t.roma_areeiro &&
        t.roma_areeiro === richKey &&
        t.direction === direction,
    );
  }

  const details = await fetchDetails(trainId, originDateStr);
  // NULL GUARD: Proteção contra respostas totalmente nulas da IP
  // A IP devolve por vezes tudo null mesmo com o comboio em circulação (bug).
  if (details && details._isAllNull) {
    const wasLive = mem.lastResult && mem.lastResult.Live === true;

    if (wasLive) {
      // CASO 1: Comboio estava Live → ignorar resposta nula, congelar dados
      console.log(
        `[NULL GUARD] Comboio ${trainId} está Live mas IP devolveu resposta nula. Dados congelados até ao próximo ciclo.`,
      );
      return mem.lastResult;
    }

    // CASO 2: Comboio NÃO estava Live → contar respostas nulas consecutivas
    mem.nullResponseCount = (mem.nullResponseCount || 0) + 1;

    if (mem.nullResponseCount < 5) {
      console.log(
        `[NULL GUARD] Comboio ${trainId} resposta nula ${mem.nullResponseCount}/5. A aguardar confirmação.`,
      );
      // Se já temos dados anteriores, mantemos congelados
      if (mem.lastResult) return mem.lastResult;
      // Caso contrário, não temos dados para devolver — ignoramos este ciclo
      return null;
    }

    // CASO 3: 5 respostas nulas consecutivas → confirmar SUPRIMIDO
    console.log(
      `[NULL GUARD] Comboio ${trainId} confirmado SUPRIMIDO após ${mem.nullResponseCount} respostas nulas consecutivas.`,
    );
    details.SituacaoComboio = "SUPRIMIDO";
  } else if (details && !details._isAllNull) {
    // Resposta válida → resetar contador de nulos
    mem.nullResponseCount = 0;
  }

  let isLive = false;
  let situacao = details?.SituacaoComboio || "Sem dados IP";
  let nodes = details?.NodesPassagemComboio || [];
  let duracao = details?.DuracaoViagem || "--:--";
  let operador = details?.Operador || "FERTAGUS";
  let origemIp =
    details?.Origem ||
    (direction === "lisboa"
      ? richInfo.service === 0
        ? "COINA"
        : "SETÚBAL"
      : "ROMA-AREEIRO");
  let destinoIp =
    details?.Destino ||
    (direction === "lisboa"
      ? "ROMA-AREEIRO"
      : richInfo.service === 0
        ? "COINA"
        : "SETÚBAL");

  if (nodes.length > 0) {
    isLive = nodes.some((n) => n.ComboioPassou === true);
  } else {
    const orderToUse =
      direction === "lisboa" ? STATION_ORDER_LISBOA : STATION_ORDER_MARGEM;
    orderToUse.forEach((key) => {
      const time = richInfo[key];
      if (time) {
        const ipName = STATION_MAP_JSON_TO_IP[key];
        nodes.push({
          ComboioPassou: false,
          HoraProgramada: time,
          NodeID: STATION_IDS_FIXED[ipName] || 0,
          NomeEstacao: ipName,
          Observacoes: "",
        });
      }
    });
  }

  // --- 1. EXTRAÇÃO INTELIGENTE DE ATRASOS DA IP ---
  let ipReportedDelay = 0;

  // A) Extração do texto SituacaoComboio (ex: "Circula com atraso de 15 min.")
  if (situacao.toLowerCase().includes("atraso")) {
    const match = situacao.match(/(\d+)\s*min/i);
    if (match) {
      ipReportedDelay = parseInt(match[1], 10) * 60;
    }
  }

  // B) Extração profunda das Observacoes do próximo nó não passado
  const firstUnpassed = nodes.find((n) => !n.ComboioPassou);
  if (firstUnpassed && firstUnpassed.Observacoes) {
    const match = firstUnpassed.Observacoes.match(
      /Hora Prevista:\s*(\d{2}:\d{2})/i,
    );
    if (match) {
      const hpStr = match[1];

      let horaChegadaProgStr = firstUnpassed.HoraProgramada;
      const stationKeyProg =
        STATION_MAP_IP_TO_JSON[firstUnpassed.NomeEstacao.toUpperCase()];
      if (stationKeyProg && richInfo[stationKeyProg]) {
        horaChegadaProgStr = richInfo[stationKeyProg];
      }
      if (horaChegadaProgStr?.length === 5) horaChegadaProgStr += ":00";

      const progDate = parseSmartTime(horaChegadaProgStr, nowObj);
      const prevDate = parseSmartTime(hpStr + ":00", nowObj);

      if (progDate && prevDate) {
        const diffS = Math.floor(
          (prevDate.getTime() - progDate.getTime()) / 1000,
        );
        if (diffS > ipReportedDelay) ipReportedDelay = diffS;
      }
    }
  }

  let turnaroundDelay = 0;
  if (direction === "margem") {
    const scheduledRoma = departureTrip
      ? departureTrip.roma_areeiro
      : richInfo.roma_areeiro?.substring(0, 5);
    if (scheduledRoma) {
      const prediction = checkTurnaroundDelay(trainId, scheduledRoma, nowObj);
      if (prediction) {
        turnaroundDelay = prediction.delaySeconds;
      }
    }
  }

  const pragalNodeId = STATION_IDS_FIXED["PRAGAL"];
  let pragalPassed =
    nodes.some(
      (n) =>
        n.NomeEstacao.toUpperCase() === "PRAGAL" && n.ComboioPassou === true,
    ) || !!mem.history[pragalNodeId];

  const corroiosNodeId = STATION_IDS_FIXED["CORROIOS"];
  let corroiosPassed =
    nodes.some(
      (n) =>
        n.NomeEstacao.toUpperCase() === "CORROIOS" && n.ComboioPassou === true,
    ) || !!mem.history[corroiosNodeId];

  const penalvaNodeId = STATION_IDS_FIXED["PENALVA"];
  let penalvaPassed =
    nodes.some(
      (n) =>
        n.NomeEstacao.toUpperCase() === "PENALVA" && n.ComboioPassou === true,
    ) || !!mem.history[penalvaNodeId];

  if (isLive) {
    const lastNode = nodes[nodes.length - 1];
    if (lastNode && lastNode.ComboioPassou) {
      const isEnd =
        (direction === "lisboa" &&
          lastNode.NomeEstacao.toUpperCase().includes("ROMA")) ||
        (direction === "margem" &&
          (lastNode.NomeEstacao.toUpperCase().includes("COINA") ||
            lastNode.NomeEstacao.toUpperCase().includes("SETÚBAL")));
      if (isEnd) {
        if (!mem.history[lastNode.NodeID]) {
          const lastKey =
            STATION_MAP_IP_TO_JSON[lastNode.NomeEstacao.toUpperCase()];
          if (lastKey) {
            AnalyticsManager.recordArrival(
              trainId,
              lastKey,
              direction,
              Date.now(),
              turnaroundDelay > 0,
            );
          }
        }
        AnalyticsManager.cleanupTrain(trainId);
        FUTURE_TRAINS_CACHE[trainId] = "Realizado";
        delete TRAIN_MEMORY[trainId];
        return null;
      }
    }
  }

  const displayDate = originDateStr.split("-").reverse().join("/");
  const refTrip = departureTrip || richInfo;
  let headerOrigem =
    direction === "lisboa"
      ? refTrip.setubal || refTrip.coina
      : refTrip.roma_areeiro;
  let headerDestino =
    direction === "lisboa"
      ? refTrip.roma_areeiro
      : refTrip.setubal || refTrip.coina;

  const trainOutput = {
    "id-comboio": trainId,
    DataHoraDestino: `${displayDate} ${headerDestino?.substring(0, 5) ?? "--:--"}`,
    DataHoraOrigem: `${displayDate} ${headerOrigem?.substring(0, 5) ?? "--:--"}`,
    Destino: destinoIp,
    DuracaoViagem: duracao,
    Operador: operador,
    Origem: origemIp,
    TipoServico: "URB|SUBUR",
    Live: isLive,
    Ocupacao: richInfo.ocupacao,
    NodesPassagemComboio: [],
    AtrasoCalculado: 0,
    SituacaoComboio: situacao,
  };

  // --- 2. A LEI DO MAIOR ATRASO ---
  let currentDelay = Math.max(
    mem.lastDelay || 0,
    turnaroundDelay,
    ipReportedDelay,
  );
  let newStationPassed = false;
  let lastPassageRealTime = null;

  let capturedNextDelay = false;
  let nextStationTotalDelay = currentDelay;

  nodes.forEach((node) => {
    const passed = node.ComboioPassou;

    const isNewlyPassed = passed && !mem.history[node.NodeID];
    if (isNewlyPassed) {
      newStationPassed = true;
      lastPassageRealTime = mem.history[node.NodeID] || Date.now();
    }

    const stationKey = STATION_MAP_IP_TO_JSON[node.NomeEstacao.toUpperCase()];

    let horaChegadaProgStr =
      stationKey && richInfo[stationKey]
        ? richInfo[stationKey]
        : node.HoraProgramada;
    if (horaChegadaProgStr?.length === 5) horaChegadaProgStr += ":00";
    const dateChegadaProg = parseSmartTime(horaChegadaProgStr, nowObj);

    let horaPartidaProgStr =
      stationKey && departureTrip && departureTrip[stationKey]
        ? departureTrip[stationKey]
        : horaChegadaProgStr;
    if (horaPartidaProgStr?.length === 5) horaPartidaProgStr += ":00";
    const datePartidaProg = parseSmartTime(horaPartidaProgStr, nowObj);

    let horaRealStr = "HH:MM:SS";
    let atrasoNode = 0;

    if (passed) {
      let timestamp = mem.history[node.NodeID] || Date.now();
      mem.history[node.NodeID] = timestamp;
      horaRealStr = formatTimeHHMMSS(new Date(timestamp));

      if (dateChegadaProg) {
        const rawDelay =
          Math.floor((timestamp - dateChegadaProg.getTime()) / 1000) - 15;

        atrasoNode = Math.max(0, rawDelay);

        if (ipReportedDelay > atrasoNode + 350) {
          currentDelay = ipReportedDelay;
        } else {
          currentDelay = atrasoNode;
        }
      }

      if (
        isNewlyPassed &&
        node.NomeEstacao.toUpperCase() === "PRAGAL" &&
        direction === "margem"
      ) {
        pragalPassed = true;
      }

      if (
        isNewlyPassed &&
        node.NomeEstacao.toUpperCase() === "CORROIOS" &&
        direction === "margem"
      ) {
        corroiosPassed = true;
      }

      if (
        isNewlyPassed &&
        node.NomeEstacao.toUpperCase() === "PENALVA" &&
        direction === "margem"
      ) {
        penalvaPassed = true;
      }

      if (isNewlyPassed && stationKey && dateChegadaProg) {
        AnalyticsManager.recordArrival(
          trainId,
          stationKey,
          direction,
          timestamp,
          turnaroundDelay > 0,
        );
      }
    }

    const { isWeekendOrHoliday } = getOperationalInfo(nowObj);
    let bridgeAdjustment = DelayManager.getStructuralDelay(
      stationKey,
      direction,
      {
        pragalPassed,
        corroiosPassed,
        penalvaPassed,
        now: nowObj,
        isWeekendOrHoliday,
      },
    );
    let horaPrevistaFinal = horaPartidaProgStr;

    if (!passed && !capturedNextDelay) {
      nextStationTotalDelay = currentDelay + bridgeAdjustment;
      capturedNextDelay = true;
    }

    if (datePartidaProg && !passed) {
      const rawPredictedMs =
        datePartidaProg.getTime() + (currentDelay + bridgeAdjustment) * 1000;

      const clampedMs = DelayManager.clampToScheduled(
        rawPredictedMs,
        datePartidaProg.getTime(),
      );
      horaPrevistaFinal = formatTimeHHMMSS(new Date(clampedMs));
    }

    if (!passed && stationKey && dateChegadaProg) {
      const rawArrivalMs =
        dateChegadaProg.getTime() + (currentDelay + bridgeAdjustment) * 1000;
      const predictedArrivalMs = DelayManager.clampToScheduled(
        rawArrivalMs,
        dateChegadaProg.getTime(),
      );
      AnalyticsManager.tryRecordSnapshot(
        trainId,
        stationKey,
        direction,
        predictedArrivalMs,
        nowObj.getTime(),
        turnaroundDelay > 0,
        isLive,
      );
    }

    trainOutput.NodesPassagemComboio.push({
      ComboioPassou: passed,
      HoraProgramada: horaPartidaProgStr,
      HoraReal: passed ? horaRealStr : "HH:MM:SS",
      AtrasoReal: passed ? atrasoNode : 0,
      HoraPrevista: passed ? horaRealStr : horaPrevistaFinal,
      EstacaoID: node.NodeID,
      NomeEstacao: node.NomeEstacao.replace(/-A$/, ""),
    });
  });

  // cooldown de 1min para reduzir pedidos a IP
  if (newStationPassed && lastPassageRealTime) {
    mem.nextWakeUp = lastPassageRealTime + 60000;
  }

  // --- SITUAÇÃO DO COMBOIO ---
  if (!situacao.toUpperCase().includes("SUPRIMIDO")) {
    const displayDelayMins = Math.floor(nextStationTotalDelay / 60);

    if (displayDelayMins >= 1) {
      trainOutput.SituacaoComboio = isLive
        ? `Circula com atraso de ${displayDelayMins} min.`
        : `Previsto atraso de ${displayDelayMins} min.`;
    } else {
      trainOutput.SituacaoComboio = isLive ? "Em circulação" : "Programado";
    }
  }

  // =========================================================================
  // GHOST TRAIN DETECTION
  if (isLive && !situacao.toUpperCase().includes("SUPRIMIDO")) {
    const nextUnvisited = trainOutput.NodesPassagemComboio.find(
      (n) => !n.ComboioPassou,
    );

    if (
      nextUnvisited &&
      nextUnvisited.HoraPrevista &&
      nextUnvisited.HoraPrevista !== "HH:MM:SS"
    ) {
      const nextExpectedDate = parseSmartTime(
        nextUnvisited.HoraPrevista.substring(0, 5),
        nowObj,
      );

      if (nextExpectedDate) {
        const minutesLate = (nowTime - nextExpectedDate.getTime()) / 60000;

        if (minutesLate >= 15) {
          console.log(
            `[GHOST] Stage 2: Comboio ${trainId} a ${minutesLate.toFixed(1)} min ` +
              `sem chegar a "${nextUnvisited.NomeEstacao}". A remover da API pública.`,
          );
          const passedCount = trainOutput.NodesPassagemComboio.filter(
            (n) => n.ComboioPassou,
          ).length;
          GhostManager.initiateGhostMonitoring(
            trainId,
            richInfo,
            originDateStr,
            nextExpectedDate,
            passedCount,
          );
          delete OUTPUT_CACHE[trainId];
          mem.lastResult = null;
          return null;
        } else if (minutesLate >= 5) {
          console.log(
            `[GHOST] Stage 1: Comboio ${trainId} com possível perturbação ` +
              `(${minutesLate.toFixed(1)} min sem progressão em "${nextUnvisited.NomeEstacao}").`,
          );
          trainOutput.SituacaoComboio = "Possível Perturbação";
        }
      }
    }
  }

  trainOutput.AtrasoCalculado = currentDelay;
  mem.lastDelay = currentDelay;
  mem.lastResult = trainOutput;

  return trainOutput;
};

// --- LOOP PRINCIPAL ---
const updateCycle = async () => {
  const now = new Date();
  const todayDateStr = formatDateStr(now); // Data calendário para consultar alterações

  // 1. Filtrar os comboios que nos interessam agora (horário base)
  const activeRichTrains = RICH_SCHEDULE.map((t) => {
    let startStr =
      t.direction === "lisboa" ? t.setubal || t.coina : t.roma_areeiro;
    let endStr =
      t.direction === "lisboa" ? t.roma_areeiro : t.setubal || t.coina;

    if (!startStr || !endStr) return null;

    const start = parseSmartTime(startStr, now);
    const end = parseSmartTime(endStr, now);
    if (!start || !end) return null;

    return {
      ...t,
      startObj: start,
      endObj: end,
      originDateStr: formatDateStr(start),
    };
  }).filter((t) => {
    if (!t) return false;

    // Ignorar comboios geridos pelo sistema Ghost
    if (
      GhostManager.GHOST_TRAINS[String(t.id)] ||
      GhostManager.GHOST_SUPPRESSED.has(String(t.id))
    ) {
      return false;
    }

    // VERIFY: Ignorar comboios suprimidos por obras/eventos programados
    if (VerifyManager.isSuppressed(String(t.id), formatDateStr(t.startObj))) {
      return false;
    }

    // VERIFY: Ignorar comboios cujo ID foi substituído (o substituto será adicionado abaixo)
    if (
      VerifyManager.getReplacementId(String(t.id), formatDateStr(t.startObj))
    ) {
      return false;
    }

    const isBeingTracked = !!TRAIN_MEMORY[String(t.id)];

    const trainOpInfo = getOperationalInfo(t.startObj);
    const isTrainWeekendOrHoliday = trainOpInfo.isWeekendOrHoliday;

    const hType = parseInt(t.horario);
    let matchesDay =
      hType === 1 ||
      (isTrainWeekendOrHoliday && hType === 2) ||
      (!isTrainWeekendOrHoliday && hType === 0);
    if (!matchesDay) return false;

    const nowTime = now.getTime();
    const isInsideWindow =
      nowTime >= t.startObj.getTime() - 20 * 60000 &&
      nowTime <= t.endObj.getTime() + 120 * 60000;

    const isAlreadyFinished =
      FUTURE_TRAINS_CACHE[String(t.id)] === "Realizado" &&
      nowTime > t.startObj.getTime();

    return (!isAlreadyFinished && isInsideWindow) || isBeingTracked;
  });

  // Adicionar comboios de substituição ao ciclo ativo
  const replacements = VerifyManager.buildReplacementRichInfoList(
    todayDateStr,
    RICH_SCHEDULE,
  );
  for (const r of replacements) {
    const startStr =
      r.direction === "lisboa" ? r.setubal || r.coina : r.roma_areeiro;
    const endStr =
      r.direction === "lisboa" ? r.roma_areeiro : r.setubal || r.coina;
    if (!startStr || !endStr) continue;

    const start = parseSmartTime(startStr, now);
    const end = parseSmartTime(endStr, now);
    if (!start || !end) continue;

    if (
      GhostManager.GHOST_TRAINS[String(r.id)] ||
      GhostManager.GHOST_SUPPRESSED.has(String(r.id))
    )
      continue;

    const nowTime = now.getTime();
    const isInsideWindow =
      nowTime >= start.getTime() - 20 * 60000 &&
      nowTime <= end.getTime() + 120 * 60000;
    const isBeingTracked = !!TRAIN_MEMORY[String(r.id)];
    const isAlreadyFinished =
      FUTURE_TRAINS_CACHE[String(r.id)] === "Realizado" &&
      nowTime > start.getTime();

    if ((!isAlreadyFinished && isInsideWindow) || isBeingTracked) {
      activeRichTrains.push({
        ...r,
        startObj: start,
        endObj: end,
        originDateStr: formatDateStr(start),
      });
    }
  }

  // Adicionar comboios extra ao ciclo ativo
  const extras = VerifyManager.buildExtraRichInfoList(todayDateStr);
  for (const e of extras) {
    const startStr =
      e.direction === "lisboa" ? e.setubal || e.coina : e.roma_areeiro;
    if (!startStr) continue;

    const start = parseSmartTime(startStr, now);
    if (!start) continue;

    if (
      GhostManager.GHOST_TRAINS[String(e.id)] ||
      GhostManager.GHOST_SUPPRESSED.has(String(e.id))
    )
      continue;

    // Fim sintético: +3h desde a partida
    const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);

    const nowTime = now.getTime();
    const isInsideWindow =
      nowTime >= start.getTime() - 20 * 60000 &&
      nowTime <= end.getTime() + 120 * 60000;
    const isBeingTracked = !!TRAIN_MEMORY[String(e.id)];

    if (isInsideWindow || isBeingTracked) {
      activeRichTrains.push({
        ...e,
        startObj: start,
        endObj: end,
        originDateStr: formatDateStr(start),
      });
    }
  }

  // -------------------------------------------------------------------------
  // 2. PROTEÇÃO ANTI-DDOS: Distribuição de pedidos ao longo de 8 segundos
  // -------------------------------------------------------------------------
  const spreadWindowMs = 8000;
  const staggerMs =
    activeRichTrains.length > 0
      ? Math.floor(spreadWindowMs / activeRichTrains.length)
      : 0;

  activeRichTrains.forEach((t, index) => {
    const trainId = String(t.id);

    if (!TRAIN_MEMORY[trainId]) {
      TRAIN_MEMORY[trainId] = {
        history: {},
        lastDelay: 0,
        nextWakeUp: 0,
        lastResult: null,
        isFetching: false,
        nullResponseCount: 0,
      };
    }

    if (TRAIN_MEMORY[trainId].isFetching) return;

    TRAIN_MEMORY[trainId].isFetching = true;

    setTimeout(async () => {
      try {
        const r = await processTrain(t, t.originDateStr);
        if (r) {
          OUTPUT_CACHE[trainId] = r;
        } else {
          delete OUTPUT_CACHE[trainId];
        }
      } catch (e) {
        console.error(
          `[UPDATE CYCLE] Erro a processar o comboio ${trainId}:`,
          e.message,
        );
      } finally {
        if (TRAIN_MEMORY[trainId]) {
          TRAIN_MEMORY[trainId].isFetching = false;
        }
        OUTPUT_CACHE.futureTrains = FUTURE_TRAINS_CACHE;
      }
    }, index * staggerMs);
  });

  // -------------------------------------------------------------------------
  // 3. LIMPEZA DE LIXO (GARBAGE COLLECTION)
  // -------------------------------------------------------------------------

  const nowMs = now.getTime();

  // Limpar Ghost Suppressed expirados (delegado ao GhostManager)
  GhostManager.cleanupExpiredGhosts(now, RICH_SCHEDULE, parseSmartTime);

  // Auto-heal: limpar estados obsoletos da FUTURE_TRAINS_CACHE
  for (const [trainId, cachedStatus] of Object.entries(FUTURE_TRAINS_CACHE)) {
    // Comboios de substituição e extra não têm entrada no RICH_SCHEDULE — ignorar
    const entry = RICH_SCHEDULE.find((t) => String(t.id) === trainId);
    if (!entry) continue;

    const startStr =
      entry.direction === "lisboa"
        ? entry.setubal || entry.coina
        : entry.roma_areeiro;
    const endStr =
      entry.direction === "lisboa"
        ? entry.roma_areeiro
        : entry.setubal || entry.coina;
    if (!startStr || !endStr) continue;

    const startDate = parseSmartTime(startStr.substring(0, 5), now);
    const endDate = parseSmartTime(endStr.substring(0, 5), now);

    // AUTO-HEAL: Se a cache diz "Realizado/Suprimido", mas a partida de HOJE ainda não aconteceu,
    // é lixo do dia anterior — apagar e deixar o próximo checkOfflineTrains reavaliar.
    if (
      (cachedStatus === "Realizado" || cachedStatus === "SUPRIMIDO") &&
      startDate &&
      nowMs < startDate.getTime()
    ) {
      FUTURE_TRAINS_CACHE[trainId] = "Sem Informação";
      continue;
    }

    if (cachedStatus === "Realizado" || cachedStatus === "SUPRIMIDO") continue;

    if (endDate && nowMs > endDate.getTime()) {
      FUTURE_TRAINS_CACHE[trainId] = "Realizado";
    }
  }
};

// --- DEEP SLEEP MODE ---
const isSystemInSleepMode = () => {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();

  if ((h === 2 && m >= 30) || h === 3 || h === 4) {
    const hasActiveTrains = Object.keys(TRAIN_MEMORY).length > 0;

    if (!hasActiveTrains) {
      return true;
    } else {
      console.log(
        `[SLEEP OVERRIDE] São ${h}:${m} mas ainda há comboios ativos na linha! API continua a funcionar.`,
      );
    }
  }
  return false;
};

// --- TICKER (10 SEGUNDOS) ---
const scheduleNextTick = () => {
  const now = new Date();
  const seconds = now.getSeconds();
  const ms = now.getMilliseconds();
  const nextTarget = (Math.floor(seconds / 10) + 1) * 10;
  const delay = (nextTarget - seconds) * 1000 - ms;

  setTimeout(async () => {
    if (isSystemInSleepMode()) {
      OUTPUT_CACHE = { futureTrains: FUTURE_TRAINS_CACHE };
      scheduleNextTick();
      return;
    }

    if (!IS_CYCLE_RUNNING) {
      IS_CYCLE_RUNNING = true;
      try {
        await updateCycle();
      } finally {
        IS_CYCLE_RUNNING = false;
      }
    }
    scheduleNextTick();
  }, delay || 10000);
};

// --- ROUTES ---

app.get("/fertagus", protectRoute, (req, res) => {
  if (IP_IS_DOWN) {
    return res.status(503).json({
      error: "IP_DOWN",
      status: "offline",
      message: "Infraestruturas de Portugal Incontactável",
    });
  }

  res.json(OUTPUT_CACHE);
});

app.get("/stats", (req, res) => {
  res.json(AnalyticsManager.getStats());
});

app.get("/avisos", (req, res) => {
  res.json(AvisosManager.getAvisos());
});

app.get("/", (req, res) =>
  res.json({
    status: "online",
    version: "4.9.24",
    aviso:
      "Pedimos que não uses o nosso endpoint diretamente! Verifica toda as informações e código no github.",
    operational: getOperationalInfo(),
    ghost: {
      monitoring: Object.keys(GhostManager.GHOST_TRAINS).length,
      suppressed: GhostManager.GHOST_SUPPRESSED.size,
    },
    changes: {
      today: VerifyManager.getChangesForDate(formatDateStr(new Date())),
    },
  }),
);

app.listen(PORT, () => {
  console.log(`LiveTagus API v4.9.24 ativa na porta ${PORT}`);
  console.log(`Endpoint /fertagus protegido com API_KEY.`);
  checkOfflineTrains();
  updateCycle();
  scheduleNextTick();

  setInterval(checkOfflineTrains, 15 * 60 * 1000);
});

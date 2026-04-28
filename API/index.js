require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { exec } = require("child_process");
const AnalyticsManager = require("./analytics.js");
const DelayManager = require("./delays.js");
const AvisosManager = require("./avisos.js");
const GhostManager = require("./ghosts.js");
const VerifyManager = require("./verify.js");
const StationPoller = require("./station-poller.js");
const ExtrasHelpers = require("./extras-helpers.js");

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
let EXTRA_TRAINS_CACHE = {}; // { [id]: extraTrainOutput }
let DYNAMIC_EXTRA_SCHEDULE = {}; // { [id]: richInfo }

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
let LAST_RECOVERY_PING = 0;

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

// --- PROCURAR DE EXTRAS ──────────────────────────────────────────
const buildExtraTrainOutput = ExtrasHelpers.buildExtraTrainOutput;
const buildSyntheticRichInfoFromDetails = (trainId, details, stationEntry) =>
  ExtrasHelpers.buildSyntheticRichInfo(
    trainId,
    details,
    stationEntry,
    STATION_MAP_IP_TO_JSON,
  );
const startDateFromStationEntry = ExtrasHelpers.startDateFromStationEntry;

// --- FUTURE TRAIN CHECK (v2: PROCURA DINÂMICA) ──────────────────────────────────
//
// alteraçoes:
// A versão antiga fazia um pedido INDIVIDUAL por comboio (+-80/ciclo). Esta
// versão faz +-5-10 pedidos à estação de Corroios e resolve o estado
// de quase todos os comboios num único batch. recorre a pedidos individuais para:
//   Comboios no JSON mas ausentes da IP → supressão planeada (5 nulls → SUPRIMIDO)
//   comboios na IP mas ausentes do JSON → descoberta de extras
//
const checkOfflineTrains = async () => {
  if (typeof isSystemInSleepMode === "function" && isSystemInSleepMode()) {
    console.log(
      `[SLEEP MODE] ${new Date().toLocaleTimeString()} - A dormir. Verificação de comboios futuros suspensa.`,
    );
    return;
  }

  if (IP_IS_DOWN) {
    console.log("[CIRCUIT BREAKER] Offline Check cancelado. IP em baixo.");
    return;
  }

  console.log(
    `[FUTURE CHECK v2] ${new Date().toLocaleTimeString()} - A iniciar (station-poll)...`,
  );

  const now = new Date();
  const nowMs = now.getTime();
  const todayDateStr = formatDateStr(now);

  // POLL À ESTAÇÃO DE CORROIOS
  let stationMap;
  try {
    stationMap = await StationPoller.pollAllWindows(now);
  } catch (e) {
    console.error(
      "[FUTURE CHECK v2] Falha crítica no station-poll:",
      e.message,
    );
    return;
  }
  console.log(
    `[FUTURE CHECK v2] Station-poll: ${stationMap.size} comboios FERTAGUS descobertos.`,
  );

  // CANDIDATOS DO HORÁRIO BASE + SUBSTITUIÇÕES + EXTRAS MANUAIS
  const activeIds = Object.keys(OUTPUT_CACHE).filter(
    (k) => k !== "futureTrains" && k !== "extratrains",
  );

  const baseCandidates = RICH_SCHEDULE.map((t) => {
    const startStr =
      t.direction === "lisboa" ? t.setubal || t.coina : t.roma_areeiro;
    const endStr =
      t.direction === "lisboa" ? t.roma_areeiro : t.setubal || t.coina;
    if (!startStr || !endStr) return null;

    const startObj = parseSmartTime(startStr, now);
    const endObj = parseSmartTime(endStr, now);
    if (!startObj || !endObj) return null;

    return { ...t, startObj, endObj };
  }).filter((t) => {
    if (!t) return false;
    if (activeIds.includes(String(t.id))) return false;
    if (GhostManager.GHOST_SUPPRESSED.has(String(t.id))) return false;
    if (GhostManager.GHOST_TRAINS[String(t.id)]) return false;

    const trainOpInfo = getOperationalInfo(t.startObj);
    const isTrainWeekendOrHoliday = trainOpInfo.isWeekendOrHoliday;

    const hType = parseInt(t.horario);
    if (hType === 1) return true;
    if (isTrainWeekendOrHoliday && hType === 2) return true;
    if (!isTrainWeekendOrHoliday && hType === 0) return true;
    return false;
  });

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
      if (activeIds.includes(String(t.id))) return false;
      if (GhostManager.GHOST_SUPPRESSED.has(String(t.id))) return false;
      if (GhostManager.GHOST_TRAINS[String(t.id)]) return false;
      return true;
    });

  const manualExtraCandidates = VerifyManager.buildExtraRichInfoList(
    todayDateStr,
  )
    .map((t) => {
      const startStr =
        t.direction === "lisboa" ? t.setubal || t.coina : t.roma_areeiro;
      if (!startStr) return null;
      const startObj = parseSmartTime(startStr, now);
      if (!startObj) return null;
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

  const candidates = [
    ...baseCandidates,
    ...replacementCandidates,
    ...manualExtraCandidates,
  ];

  const results = {};
  const toIndividualCheck = [];

  // RESOLVER ESTADO DE CADA CANDIDATO
  for (const t of candidates) {
    const trainId = String(t.id);
    const trainDateStr = formatDateStr(t.startObj);

    // Supressões programadas pelo VerifyManager (exemplo obras)
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

    if (
      !t._isReplacement &&
      !t._isExtra &&
      VerifyManager.getReplacementId(trainId, trainDateStr)
    ) {
      results[trainId] = "SUPRIMIDO";
      continue;
    }

    const safeEndMarginMs = t.endObj.getTime() + 90 * 60000;
    const isFinishedToday =
      FUTURE_TRAINS_CACHE[trainId] === "Realizado" &&
      nowMs > t.startObj.getTime();

    if (nowMs > safeEndMarginMs || isFinishedToday) {
      results[trainId] = "Realizado";
      continue;
    }

    // Consultar o station-poll
    const stationEntry = stationMap.get(trainId);

    // 5 NULLS --> SUPRIMIDO

    if (!stationEntry) {
      toIndividualCheck.push(t);
      continue;
    }

    if (/SUPRIMIDO/i.test(stationEntry.observacoes)) {
      if (FUTURE_TRAINS_CACHE[trainId] === "SUPRIMIDO") {
        results[trainId] = "SUPRIMIDO";
        continue;
      }
      toIndividualCheck.push({ ...t, _stationPollSuppressed: true });
      continue;
    }
    results[trainId] = "Programado";
  }

  // CONFIRMAÇÃO INDIVIDUAL
  // Cada comboio é verificado até 5 vezes consecutivas neste ciclo.
  // Se todas as respostas forem nulas → SUPRIMIDO imediato.
  // Se alguma responder com dados válidos → usar esse resultado.
  // Isto resolve o estado num único ciclo de 15 min em vez de 75 min.
  for (const t of toIndividualCheck) {
    const trainId = String(t.id);
    const tag = t._stationPollSuppressed
      ? "[CROSS VALIDATE]"
      : "[NULL GUARD OFFLINE]";

    const MAX_RETRIES = 5;
    let resolved = false;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const dateStr = formatDateStr(t.startObj);
        const details = await fetchDetails(trainId, dateStr);

        if (details && details._isAllNull) {
          console.log(
            `${tag} Comboio ${trainId} resposta nula ${attempt}/${MAX_RETRIES}. A aguardar confirmação.`,
          );

          if (attempt < MAX_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, 1200));
            continue; // tenta novamente
          }

          // Chegou à 5ª tentativa nula → SUPRIMIDO
          console.log(
            `${tag} Comboio ${trainId} confirmado SUPRIMIDO após ${MAX_RETRIES} respostas nulas consecutivas.`,
          );
          results[trainId] = "SUPRIMIDO";
          GhostManager.GHOST_SUPPRESSED.add(trainId);
          resolved = true;
          break;
        } else if (details && details.SituacaoComboio) {
          const situacao = details.SituacaoComboio.trim() || "Sem Informação";
          const nodes = details.NodesPassagemComboio || [];
          const hasStarted = nodes.some((n) => n.ComboioPassou === true);

          const impliesSpuriousLive =
            !hasStarted &&
            (/em circulação/i.test(situacao) || /a horas/i.test(situacao));

          if (impliesSpuriousLive) {
            results[trainId] = "Sem Informação";
          } else {
            results[trainId] = situacao;
            if (t._stationPollSuppressed && !/SUPRIMIDO/i.test(situacao)) {
              console.warn(
                `${tag} Station-poll disse SUPRIMIDO para ${trainId} mas IP individual responde "${situacao}". Confiando no individual.`,
              );
            }
          }
          resolved = true;
          break;
        } else {
          // Resposta null/undefined (erro de rede ou estrutura inesperada)
          results[trainId] = FUTURE_TRAINS_CACHE[trainId] || "Sem Informação";
          resolved = true;
          break;
        }
      } catch (error) {
        console.error(
          `${tag} Erro isolado no comboio ${trainId} (tentativa ${attempt}):`,
          error.message,
        );
        results[trainId] = FUTURE_TRAINS_CACHE[trainId] || "Sem Informação";
        resolved = true;
        break;
      }
    }

    if (!resolved) {
      results[trainId] = FUTURE_TRAINS_CACHE[trainId] || "Sem Informação";
    }

    // Delay entre comboios diferentes (não entre tentativas do mesmo)
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  // DESCOBERTA DE EXTRAS (IDs na IP mas AUSENTES do JSON base)
  const jsonBaseIds = new Set(RICH_SCHEDULE.map((t) => String(t.id)));
  const manualExtraIds = new Set(
    manualExtraCandidates.map((t) => String(t.id)),
  );
  const replacementIds = new Set(
    replacementCandidates.map((t) => String(t.id)),
  );
  const knownIds = new Set([
    ...jsonBaseIds,
    ...manualExtraIds,
    ...replacementIds,
  ]);

  let newExtrasDiscovered = 0;
  let extrasRefreshed = 0;

  for (const [trainId, stationEntry] of stationMap) {
    if (knownIds.has(trainId)) continue;
    if (activeIds.includes(trainId)) continue;
    if (GhostManager.GHOST_SUPPRESSED.has(trainId)) continue;
    if (GhostManager.GHOST_TRAINS[trainId]) continue;

    const existing = EXTRA_TRAINS_CACHE[trainId];
    const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

    if (
      existing &&
      existing._lastUpdate &&
      nowMs - existing._lastUpdate < REFRESH_THRESHOLD_MS
    ) {
      if (
        /SUPRIMIDO/i.test(stationEntry.observacoes) &&
        existing.SituacaoComboio !== "SUPRIMIDO"
      ) {
        existing.SituacaoComboio = "SUPRIMIDO";
        existing._lastUpdate = nowMs;
      }
      continue;
    }

    // Fetch individual para obter os nodes completos
    let dateStr = formatDateStr(startDateFromStationEntry(stationEntry, now));

    try {
      const details = await fetchDetails(trainId, dateStr);

      if (!details || details._isAllNull) {
        console.warn(
          `[EXTRA DISCOVERY] Comboio ${trainId} apareceu no station-poll mas fetch individual devolveu nulo. A ignorar neste ciclo.`,
        );
        continue;
      }

      const extraOutput = buildExtraTrainOutput(trainId, details, stationEntry);
      if (!extraOutput) continue;

      EXTRA_TRAINS_CACHE[trainId] = { ...extraOutput, _lastUpdate: nowMs };
      const syntheticRich = buildSyntheticRichInfoFromDetails(
        trainId,
        details,
        stationEntry,
      );
      if (syntheticRich) {
        DYNAMIC_EXTRA_SCHEDULE[trainId] = syntheticRich;
      }

      if (existing) {
        extrasRefreshed++;
      } else {
        newExtrasDiscovered++;
        console.log(
          `[EXTRA DISCOVERY] Comboio ${trainId} descoberto ` +
            `(${extraOutput.Origem} → ${extraOutput.Destino}, ${extraOutput.SituacaoComboio}).`,
        );
      }
    } catch (e) {
      console.error(
        `[EXTRA DISCOVERY] Falha ao obter detalhes de ${trainId}:`,
        e.message,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  // LIMPEZA DE EXTRAS ANTIOGS
  for (const trainId of Object.keys(EXTRA_TRAINS_CACHE)) {
    const extra = EXTRA_TRAINS_CACHE[trainId];
    const stillInPoll = stationMap.has(trainId);

    if (stillInPoll) continue;
    if (activeIds.includes(trainId)) continue;

    let isOld = false;
    if (extra.DataHoraDestino && extra.DataHoraDestino.includes(" ")) {
      const destTime = extra.DataHoraDestino.split(" ")[1]?.substring(0, 5);
      if (destTime) {
        const endDate = parseSmartTime(destTime, now);
        if (endDate && nowMs > endDate.getTime() + 2 * 60 * 60 * 1000) {
          isOld = true;
        }
      }
    }

    if (extra._lastUpdate && nowMs - extra._lastUpdate > 4 * 60 * 60 * 1000) {
      isOld = true;
    }

    if (isOld) {
      delete EXTRA_TRAINS_CACHE[trainId];
      delete DYNAMIC_EXTRA_SCHEDULE[trainId];
      console.log(
        `[EXTRA DISCOVERY] Comboio extra ${trainId} removido da cache (expirado).`,
      );
    }
  }

  // ATUALIZAÇÃO SEGURA DA MEMÓRIA GLOBAL
  FUTURE_TRAINS_CACHE = results;

  for (const ghostId of GhostManager.GHOST_SUPPRESSED) {
    FUTURE_TRAINS_CACHE[ghostId] = "SUPRIMIDO";
  }

  const candidateIds = new Set(candidates.map((t) => String(t.id)));

  StationPoller.cleanupCache(now);

  console.log(
    `[FUTURE CHECK v2] Concluído às ${new Date().toLocaleTimeString()}. ` +
      `Candidatos: ${candidates.length} | ` +
      `Station-poll hits: ${candidates.length - toIndividualCheck.length} | ` +
      `Individuais: ${toIndividualCheck.length} | ` +
      `Extras ativos: ${Object.keys(EXTRA_TRAINS_CACHE).length} ` +
      `(+${newExtrasDiscovered} novos, ${extrasRefreshed} refresh)`,
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
    FUTURE_TRAINS_CACHE[trainId] = "SUPRIMIDO";
    GhostManager.GHOST_SUPPRESSED.add(trainId);
    delete TRAIN_MEMORY[trainId];
    return null;
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
          Math.floor((timestamp - dateChegadaProg.getTime()) / 1000) - 25;

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

  // cooldown inteligente, ativa 2 min 30s antes da hora prevista de chegada
  const nextUnvisitedNode = trainOutput.NodesPassagemComboio.find(
    (n) => !n.ComboioPassou,
  );

  if (
    nextUnvisitedNode &&
    nextUnvisitedNode.HoraPrevista &&
    nextUnvisitedNode.HoraPrevista !== "HH:MM:SS"
  ) {
    const nextExpectedDate = parseSmartTime(
      nextUnvisitedNode.HoraPrevista.substring(0, 5),
      nowObj,
    );

    if (nextExpectedDate) {
      const msUntilNext = nextExpectedDate.getTime() - nowTime;

      if (msUntilNext > 2 * 60000 + 30000) {
        mem.nextWakeUp = nextExpectedDate.getTime() - 2 * 60000 + 30000;
      } else if (msUntilNext < 0) {
        mem.nextWakeUp = nowTime + 15000;
      } else {
        mem.nextWakeUp = nowTime + 15000;
      }
    } else {
      mem.nextWakeUp = nowTime + 15000;
    }
  } else if (!isLive) {
    mem.nextWakeUp = nowTime + 60000;
  } else {
    mem.nextWakeUp = nowTime + 15000;
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
  const todayDateStr = formatDateStr(now);
  if (IP_IS_DOWN) {
    const nowMs = Date.now();
    if (nowMs - LAST_RECOVERY_PING > 120000) {
      LAST_RECOVERY_PING = nowMs;
      console.log(
        "[CIRCUIT BREAKER] IP em baixo. A enviar ping de recuperação...",
      );
      fetchDetails(String(14205), formatDateStr(new Date())).catch(() => {});
    }
    // abortar, ip continua em baixo
    return;
  }

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
      nowTime >= t.startObj.getTime() - 5 * 60000 &&
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
      nowTime >= start.getTime() - 5 * 60000 &&
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
      nowTime >= start.getTime() - 5 * 60000 &&
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

  // ─── EXTRAS DINÂMICOS (descobertos pelo station-poller) ──────────────────
  // Promove extras descobertos dinamicamente ao mesmo tracking live que os
  // comboios do horário base. Quando começam a andar, aparecem em OUTPUT_CACHE
  // com histórico, atrasos, ghost detection, etc. O campo `extratrains` na
  // resposta da API continua a listar os pré-live para a app saber que existem.
  const alreadyActiveIds = new Set(activeRichTrains.map((t) => String(t.id)));
  for (const e of Object.values(DYNAMIC_EXTRA_SCHEDULE)) {
    const trainId = String(e.id);

    // Não duplicar se já foi adicionado via RICH_SCHEDULE/replacements/extras manuais
    if (alreadyActiveIds.has(trainId)) continue;

    const startStr =
      e.direction === "lisboa" ? e.setubal || e.coina : e.roma_areeiro;
    if (!startStr) continue;

    const start = parseSmartTime(startStr, now);
    if (!start) continue;

    if (
      GhostManager.GHOST_TRAINS[trainId] ||
      GhostManager.GHOST_SUPPRESSED.has(trainId)
    )
      continue;

    const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
    const nowTime = now.getTime();
    const isInsideWindow =
      nowTime >= start.getTime() - 5 * 60000 &&
      nowTime <= end.getTime() + 120 * 60000;
    const isBeingTracked = !!TRAIN_MEMORY[trainId];

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
          // Se este comboio já está a andar (Live) e estava em EXTRA_TRAINS_CACHE,
          // remover o duplicado "pré-live" dos extras — a partir de agora a app
          // vai vê-lo como comboio normal em OUTPUT_CACHE[trainId].
          if (r.Live && EXTRA_TRAINS_CACHE[trainId]) {
            delete EXTRA_TRAINS_CACHE[trainId];
          }
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
        OUTPUT_CACHE.extratrains = EXTRA_TRAINS_CACHE;
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
      if (
        cachedStatus === "SUPRIMIDO" &&
        GhostManager.GHOST_SUPPRESSED.has(trainId)
      ) {
        continue;
      }
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

// --- TICKER (15 SEGUNDOS) ---
const scheduleNextTick = () => {
  const now = new Date();
  const seconds = now.getSeconds();
  const ms = now.getMilliseconds();
  const nextTarget = (Math.floor(seconds / 15) + 1) * 15;
  const delay = (nextTarget - seconds) * 1000 - ms;

  setTimeout(async () => {
    if (isSystemInSleepMode()) {
      OUTPUT_CACHE = {
        futureTrains: FUTURE_TRAINS_CACHE,
        extratrains: EXTRA_TRAINS_CACHE,
      };
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
  }, delay || 15000);
};

// Admin management

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const ADMIN_ROUTE = process.env.ADMIN_ROUTE;

const adminAuth = (req, res, next) => {
  const userAdminKey = req.headers["x-admin-key"];

  if (!userAdminKey || userAdminKey !== ADMIN_API_KEY) {
    return res.status(401).json({ error: "Não autorizado" });
  }
  next();
};

// check
app.get(`${ADMIN_ROUTE}/ping`, adminAuth, (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// vitais server
app.get(`${ADMIN_ROUTE}/vitals`, adminAuth, (req, res) => {
  res.json({
    uptime: os.uptime(),
    freemem: os.freemem(),
    totalmem: os.totalmem(),
    loadavg: os.loadavg(),
    cpus: os.cpus().length,
    node_version: process.version,
    platform: os.platform(),
  });
});

// Avisos
app.get(`${ADMIN_ROUTE}/avisos`, adminAuth, (req, res) => {
  try {
    const data = fs.readFileSync(path.join(__dirname, "avisos.json"), "utf8");
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: "Erro ao ler avisos.json" });
  }
});

app.post(`${ADMIN_ROUTE}/avisos`, adminAuth, express.json(), (req, res) => {
  try {
    const newAvisos = req.body;
    fs.writeFileSync(
      path.join(__dirname, "avisos.json"),
      JSON.stringify(newAvisos, null, 2),
    );
    res.json({ success: true, message: "Avisos atualizados com sucesso" });
  } catch (err) {
    res.status(500).json({ error: "Erro ao gravar avisos.json" });
  }
});

// Processos de gestão api
app.get(`${ADMIN_ROUTE}/pm2`, adminAuth, (req, res) => {
  exec("pm2 jlist", (err, stdout) => {
    if (err) return res.status(500).json({ error: "Erro ao executar PM2" });
    try {
      res.json(JSON.parse(stdout));
    } catch (e) {
      res.status(500).json({ error: "Erro ao processar dados do PM2" });
    }
  });
});

// açoes pm2 (restart stop start)
app.post(`${ADMIN_ROUTE}/pm2-action`, adminAuth, express.json(), (req, res) => {
  const { action, process: procName } = req.body;
  const allowedActions = ["restart", "stop", "start"];

  if (!allowedActions.includes(action)) {
    return res.status(400).json({ error: "Ação não permitida" });
  }

  // --- command injection protection ---
  if (!procName || !/^[a-zA-Z0-9_\-]+$/.test(procName)) {
    return res.status(400).json({ error: "Nome de processo inválido/crazy." });
  }

  exec(`pm2 ${action} ${procName}`, (err) => {
    if (err)
      return res
        .status(500)
        .json({ error: `Erro ao executar ${action} no ${procName}` });
    res.json({ success: true, message: `${procName} ${action}ed` });
  });
});

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
    version: "4.10.3",
    aviso:
      "Pedimos que não uses o nosso endpoint diretamente! Verifica toda as informações e código no github.",
    operational: getOperationalInfo(),
    ghost: {
      monitoring: Object.keys(GhostManager.GHOST_TRAINS).length,
      suppressed: GhostManager.GHOST_SUPPRESSED.size,
    },
    extras: {
      active: Object.keys(EXTRA_TRAINS_CACHE).length,
      tracked: Object.keys(DYNAMIC_EXTRA_SCHEDULE).length,
    },
    changes: {
      today: VerifyManager.getChangesForDate(formatDateStr(new Date())),
    },
  }),
);

app.listen(PORT, () => {
  console.log(`LiveTagus API v4.10.3 ativa na porta ${PORT}`);
  console.log(`Endpoint /fertagus protegido com API_KEY.`);
  checkOfflineTrains();
  updateCycle();
  scheduleNextTick();

  setInterval(checkOfflineTrains, 15 * 60 * 1000); // considerar troca para 20 -> poupados cerca de 2000 pedidos por dia
});

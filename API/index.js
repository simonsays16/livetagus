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
const EstacaoEndpoint = require("./estacao-endpoint.js");
const GetLocation = require("./get-location.js");
const Geo = require("./gtfs-geo.js");
const DelaysRT = require("./delays-rt.js");
const GtfsOutput = require("./gtfs-output.js");
const ServiceDayManager = require("./serviceDayManager.js");
Geo.init("./fertagus_line_detailed.json", "./ft_stations_detailed.json");

const app = express();
app.use(cors());

// --- CONFIGURAÇÃO ---
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const API_BASE = process.env.API_BASE;
const IP_BLOCKED = true;

// Middleware para verificar a API Key
const protectRoute = (req, res, next) => {
  const userKey = req.headers["x-api-key"];

  if (!userKey || userKey !== API_KEY) {
    const htmlResponse = `
<!doctype html>
<html lang="pt-PT">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>403 | Acesso Restrito - LiveTagus</title>
    <link rel="shortcut icon" href="https://livetagus.pt/imagens/favicon-96x96.png" type="image/x-icon" />
    <meta name="robots" content="noindex, nofollow" />
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
    <script>
      tailwind.config = {
        darkMode: 'media', // Adapta-se automaticamente ao tema do sistema do utilizador
        theme: {
          extend: {
            fontFamily: { sans: ['Inter', 'sans-serif'] }
          }
        }
      }
    </script>
    <style>
      @keyframes float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-10px); }
      }
      .animate-float {
        animation: float 6s ease-in-out infinite;
      }
    </style>
  </head>

  <body class="bg-white text-zinc-900 dark:bg-[#09090b] dark:text-white overflow-hidden transition-colors duration-500 flex flex-col min-h-screen selection:bg-red-500/30">
    <main class="flex-grow flex flex-col items-center justify-center px-6 relative">
      
      <div class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vw] h-[60vh] bg-red-500/5 dark:bg-red-900/10 rounded-full blur-[120px] pointer-events-none z-0"></div>

      <div class="relative z-10 text-center max-w-2xl w-full">
        <h1 class="text-[120px] md:text-[180px] font-thin leading-none tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-zinc-300 to-transparent dark:from-zinc-700 dark:to-transparent select-none animate-float">
          403
        </h1>

        <h2 class="text-2xl md:text-4xl font-light tracking-tight mb-4 mt-[-20px]">
          Acesso Restrito.
        </h2>

        <p class="text-zinc-500 dark:text-zinc-400 font-light mb-10 text-lg leading-relaxed">
          A API é de uso exclusivo da <span class="font-medium text-zinc-900 dark:text-zinc-200">livetagus.pt</span>.
          <br />
          O acesso não autorizado é bloqueado e monitorizado.
        </p>

        <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a href="https://github.com/simonsays16/livetagus?tab=readme-ov-file#important-note-about-the-api"
             target="_blank" 
             rel="noopener noreferrer"
             class="inline-flex items-center w-72 sm:w-auto justify-center px-8 py-4 border border-zinc-200 dark:border-white/20 text-zinc-900 dark:text-white hover:bg-zinc-100 dark:hover:bg-white/5 font-medium text-sm uppercase tracking-widest transition-all rounded-sm group">
            Ver Código
            <span class="ml-2 group-hover:translate-x-1 transition-transform">
              →
            </span>
          </a>
          
          <a href="https://livetagus.pt/"
             class="inline-flex items-center w-72 sm:w-auto justify-center px-8 py-4 border border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white font-medium text-sm uppercase tracking-widest transition-all rounded-sm group">
            <span class="mr-2 group-hover:-translate-x-1 transition-transform">
              ←
            </span>
            Voltar à LiveTagus
          </a>
        </div>
      </div>
    </main>
  </body>
</html>
    `;

    return res.status(403).send(htmlResponse);
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
let ABNORMAL_ROUTES_CACHE = {}; // [TRAJETO ANORMAL] { [id]: { skipped: [...] } }

// --- SUPRESSÃO ATIVA (poupança de pedidos) ---
// Comboios suprimidos DURANTE a janela ativa. Distinto de GHOST_SUPPRESSED
// (que fica reservado ao ghost Stage 3 — comboios imobilizados sem anúncio).
// Enquanto suprimido e dentro da janela: NÃO entra no OUTPUT_CACHE; aparece
// apenas no FUTURE_TRAINS_CACHE como "SUPRIMIDO"; é re-verificado de 10 em 10
// min em vez de 15s. Se recuperar → volta ao fluxo normal (output + 15s).
// Extras suprimidos são removidos por completo da API.
let SUPPRESSED_ACTIVE = new Set();
const SUPPRESSED_RECHECK_MS = 10 * 60 * 1000;

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
  const nowH = now.getHours();

  // Fix: Basear sempre no dia operacional (05h00 às 02h30)
  // Se ainda não são 05h00, o dia operacional começou "ontem"
  if (nowH < 5) {
    d.setDate(d.getDate() - 1);
  }
  // Se a hora do comboio for de madrugada (00h-04h),
  // ele pertence ao dia civil seguinte do atual dia operacional.
  if (h < 5) {
    d.setDate(d.getDate() + 1);
  }
  d.setHours(h, m, s, 0);

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
  // PROVISORIO
  if (IP_BLOCKED) return null;

  const url = `${API_BASE}/horarios-ncombio/${tid}/${dateStr}`;
  try {
    const r = await fetch(url, { headers: FETCH_HEADERS, timeout: 10000 });
    if (!r.ok) {
      throw new Error(`HTTP Error ${r.status}`);
    }

    const j = await r.json();
    IP_CONSECUTIVE_ERRORS = 0;
    IP_IS_DOWN = false;

    const response = j.response;
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

      if (isAllNull) response._isAllNull = true;
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
  Geo,
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
const detectAbnormalRoute = ExtrasHelpers.detectAbnormalRoute; // [TRAJETO ANORMAL]
const detectAbnormalFromTerminus = ExtrasHelpers.detectAbnormalFromTerminus; // [TRAJETO ANORMAL]

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

  if (IP_IS_DOWN || IP_BLOCKED) {
    console.log(
      "[CIRCUIT BREAKER] Offline Check cancelado. IP em baixo ou bloqueada.",
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
  // Usar a data operacional garante que os ficheiros JSON das 00h às 02h30 são lidos corretamente
  const opInfo = getOperationalInfo(now);
  const opDateStr = opInfo.operationalDateStr;

  // POLL À ESTAÇÃO DE CORROIOS
  let stationMap;
  try {
    // provisorio stationMap = await StationPoller.pollAllWindows(now);
    stationMap = IP_BLOCKED
      ? new Map()
      : await StationPoller.pollAllWindows(now);
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
    (k) =>
      k !== "futureTrains" && k !== "extratrains" && k !== "abnormalRoutes",
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
    if (SUPPRESSED_ACTIVE.has(String(t.id))) return false;
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
    opDateStr,
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
      if (SUPPRESSED_ACTIVE.has(String(t.id))) return false;
      if (GhostManager.GHOST_SUPPRESSED.has(String(t.id))) return false;
      if (GhostManager.GHOST_TRAINS[String(t.id)]) return false;
      return true;
    });

  const manualExtraCandidates = VerifyManager.buildExtraRichInfoList(opDateStr)
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
      if (SUPPRESSED_ACTIVE.has(String(t.id))) return false;
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
      // O station-poll (campo Observacoes da estação de Corroios) é a fonte
      // AUTORITATIVA para SUPRIMIDO — o parseStationResponse já o trata como
      // tal em todo o módulo. Confiamos diretamente, em vez de exigir uma
      // confirmação individual por comboio. Isto poupa um fetch individual por
      // cada suprimido.
      if (t._isExtra) {
        // Extra suprimido → sai por completo da API (não aparece na app sem
        // entrada; o utilizador já não o esperava). Basta removê-lo.
        delete EXTRA_TRAINS_CACHE[trainId];
        delete DYNAMIC_EXTRA_SCHEDULE[trainId];
        delete OUTPUT_CACHE[trainId];
        SUPPRESSED_ACTIVE.delete(trainId);
        continue;
      }
      // Comboio base → entra em supressão ativa (10 min entre verificações).
      // Fica visível no FUTURE como SUPRIMIDO; o updateCycle/processTrain trata
      // do re-check espaçado e da eventual recuperação.
      results[trainId] = "SUPRIMIDO";
      SUPPRESSED_ACTIVE.add(trainId);
      continue;
    }
    // [TRAJETO ANORMAL] Deteção por terminus a partir do station-poll, ANTES
    // de o comboio circular. Apanha percursos cortados nos extremos (ex:
    // termina no Pragal/Coina, ou arranca a meio) sem fetch individual.
    if (!t._isExtra) {
      const abnTerm = detectAbnormalFromTerminus(
        t,
        stationEntry.origem,
        stationEntry.destino,
        STATION_MAP_IP_TO_JSON,
        STATION_MAP_JSON_TO_IP,
      );
      if (abnTerm.isAbnormal) {
        ABNORMAL_ROUTES_CACHE[trainId] = { skipped: abnTerm.skipped };
      } else {
        delete ABNORMAL_ROUTES_CACHE[trainId];
      }
    }

    results[trainId] = "Programado";
  }

  // CONFIRMAÇÃO INDIVIDUAL
  // Cada comboio é verificado até 5 vezes consecutivas neste ciclo.
  // Se todas as respostas forem nulas → SUPRIMIDO imediato.
  // Se alguma responder com dados válidos → usar esse resultado.
  // Isto resolve o estado num único ciclo de 15 min em vez de 75 min.
  for (const t of toIndividualCheck) {
    // FIX: Se a IP caiu durante os pedidos anteriores deste loop, pára o mini-DDoS!
    if (IP_IS_DOWN) {
      console.log(
        `[CIRCUIT BREAKER] IP em baixo. A abortar as ${toIndividualCheck.length} verificações individuais.`,
      );
      break;
    }
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

        // Tratamos tanto o objeto "all-null" como uma resposta null/undefined
        // (response: null, HTTP não-200, ou erro de estrutura) como resposta
        // NULA. Antes, o response: null fazia curto-circuito para o fallback da
        // cache e nunca chegava à lógica "5 nulls → SUPRIMIDO".
        if (!details || details._isAllNull) {
          if (IP_IS_DOWN) {
            console.log(
              `${tag} Comboio ${trainId} abortado. IP caiu no processo.`,
            );
            results[trainId] = FUTURE_TRAINS_CACHE[trainId] || "Sem Informação";
            resolved = true;
            break;
          }

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
          if (t._isExtra) {
            delete EXTRA_TRAINS_CACHE[trainId];
            delete DYNAMIC_EXTRA_SCHEDULE[trainId];
            delete OUTPUT_CACHE[trainId];
            SUPPRESSED_ACTIVE.delete(trainId);
          } else {
            results[trainId] = "SUPRIMIDO";
            SUPPRESSED_ACTIVE.add(trainId);
          }
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
          } else if (/SUPRIMIDO/i.test(situacao)) {
            // IP confirma supressão no check individual.
            if (t._isExtra) {
              delete EXTRA_TRAINS_CACHE[trainId];
              delete DYNAMIC_EXTRA_SCHEDULE[trainId];
              delete OUTPUT_CACHE[trainId];
              SUPPRESSED_ACTIVE.delete(trainId);
            } else {
              results[trainId] = "SUPRIMIDO";
              SUPPRESSED_ACTIVE.add(trainId);
            }
          } else {
            results[trainId] = situacao;
            if (t._stationPollSuppressed && !/SUPRIMIDO/i.test(situacao)) {
              console.warn(
                `${tag} Station-poll disse SUPRIMIDO para ${trainId} mas IP individual responde "${situacao}". Confiando no individual.`,
              );
            }
          }

          // [TRAJETO ANORMAL] Deteção a partir dos nós reais da IP (pré-live).
          if (nodes.length > 0 && !/SUPRIMIDO/i.test(situacao)) {
            const abn = detectAbnormalRoute(
              t,
              nodes,
              STATION_MAP_IP_TO_JSON,
              STATION_MAP_JSON_TO_IP,
            );
            if (abn.isAbnormal) {
              ABNORMAL_ROUTES_CACHE[trainId] = { skipped: abn.skipped };
            } else {
              delete ABNORMAL_ROUTES_CACHE[trainId];
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
    if (SUPPRESSED_ACTIVE.has(trainId)) continue;
    if (GhostManager.GHOST_SUPPRESSED.has(trainId)) continue;
    if (GhostManager.GHOST_TRAINS[trainId]) continue;

    // Extra suprimido → não cria entrada nenhuma (e remove qualquer resíduo).
    // Sem entrada na API, o extra não aparece na app; como o utilizador já não
    // o esperava, basta deixá-lo de fora.
    if (/SUPRIMIDO/i.test(stationEntry.observacoes)) {
      delete EXTRA_TRAINS_CACHE[trainId];
      delete DYNAMIC_EXTRA_SCHEDULE[trainId];
      delete OUTPUT_CACHE[trainId];
      continue;
    }

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

  // [TRAJETO ANORMAL] Desvios DECLARADOS no changes.json (obras planeadas).
  // Cobre os comboios resolvidos via station-poll, para os quais não há nós da
  // IP — a app fica informada do desvio mesmo antes de o comboio circular.
  for (const t of candidates) {
    const trainId = String(t.id);
    const trainDateStr = formatDateStr(t.startObj);
    const declared = VerifyManager.getAbnormalStations(trainId, trainDateStr);
    if (declared && declared.length > 0) {
      ABNORMAL_ROUTES_CACHE[trainId] = {
        skipped: declared.map((key) => ({
          key,
          nome: STATION_MAP_JSON_TO_IP[key] || key,
          hora: t[key] != null ? String(t[key]).substring(0, 5) : null,
        })),
      };
    }
  }

  // ATUALIZAÇÃO SEGURA DA MEMÓRIA GLOBAL
  FUTURE_TRAINS_CACHE = results;

  // [TRAJETO ANORMAL] GC: remover desvios de comboios já realizados/inexistentes.
  for (const id of Object.keys(ABNORMAL_ROUTES_CACHE)) {
    const status = FUTURE_TRAINS_CACHE[id];
    const stillLive = !!OUTPUT_CACHE[id];
    const stillExtra = !!EXTRA_TRAINS_CACHE[id];
    if (
      !stillLive &&
      !stillExtra &&
      (status === "Realizado" || status === "SUPRIMIDO")
    ) {
      delete ABNORMAL_ROUTES_CACHE[id];
    }
  }

  for (const ghostId of GhostManager.GHOST_SUPPRESSED) {
    FUTURE_TRAINS_CACHE[ghostId] = "SUPRIMIDO";
  }

  // Suprimidos ativos: garantir que continuam marcados no FUTURE mesmo tendo
  // sido excluídos dos candidatos (poupança). A recuperação é decidida pelo
  // gate de 10 min em processTrain, que remove o id deste Set ao retomar.
  for (const supId of SUPPRESSED_ACTIVE) {
    FUTURE_TRAINS_CACHE[supId] = "SUPRIMIDO";
  }

  // FIX: Sincronizar a cache global servida pela API imediatamente, para que
  // o /fertagus nunca responda vazio mesmo que o updateCycle ainda não tenha
  // corrido (ou não haja comboios ativos a preencher o bloco `finally`).
  OUTPUT_CACHE.futureTrains = FUTURE_TRAINS_CACHE;
  OUTPUT_CACHE.extratrains = EXTRA_TRAINS_CACHE;
  OUTPUT_CACHE.abnormalRoutes = ABNORMAL_ROUTES_CACHE;

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

// --- SUPRESSÃO ATIVA ---
// Coloca um comboio em modo "suprimido ativo": fora do OUTPUT_CACHE, marcado
// no FUTURE_TRAINS_CACHE (só comboios base; extras são removidos por completo),
// e re-verificado de 10 em 10 min. Devolve sempre null (não há output a servir).
const enterActiveSuppression = (richInfo, mem, isExtra) => {
  const trainId = String(richInfo.id);
  const nowTime = Date.now();

  delete OUTPUT_CACHE[trainId];

  if (isExtra) {
    // Extra suprimido → desaparece por completo da API (sem entrada nenhuma).
    delete EXTRA_TRAINS_CACHE[trainId];
    delete DYNAMIC_EXTRA_SCHEDULE[trainId];
    delete FUTURE_TRAINS_CACHE[trainId];
    SUPPRESSED_ACTIVE.delete(trainId);
  } else {
    // Comboio base → fica visível no FUTURE como SUPRIMIDO.
    FUTURE_TRAINS_CACHE[trainId] = "SUPRIMIDO";
    SUPPRESSED_ACTIVE.add(trainId);
  }

  mem.suppressedUntil = nowTime + SUPPRESSED_RECHECK_MS;
  mem.suppressedEndMs = richInfo.endObj ? richInfo.endObj.getTime() : nowTime;
  mem.suppressedIsExtra = !!isExtra;
  mem.lastResult = null;
  mem.lastDelay = 0;
  mem.nullResponseCount = 0;
  return null;
};

// ─── [GPS AUTONOMY] MODO AUTÓNOMO DA IP ─────────────────────────────────────
// Qualquer comboio com GPS fresco na TML é FORÇADO a Live:true e as
// HoraPrevista dos nós futuros são recalculadas pelo motor cinemático
// (posição real na linha), ignorando os atrasos da IP.
// [ENVIO URGENTE] Cálculos por GPS DESLIGADOS — demasiado instáveis. O GPS
// fica APENAS a alimentar a posição no mapa (ingestTmlPayload no poller).
// Não recalcula atrasos, não infere passagens, não reatribui números por
// sentido. Religar gradualmente quando estabilizar.
const GPS_CALCULATIONS_ENABLED = true;

const GPS_AUTONOMOUS_MODE = true; // ← desligar quando a IP normalizar

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
  if (!GPS_CALCULATIONS_ENABLED) return idStr; // [ENVIO URGENTE] sem reatribuição
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
const cleanupGhostTrains = (now = Date.now()) => {
  for (const [ghostId, reg] of GHOST_TRAIN_REGISTRY) {
    if (Geo.isGpsFresh(ghostId, now)) continue; // vivo → nunca mexer
    const lastSeen = reg.lastSeenTs || reg.createdAt || 0;
    if (now - lastSeen > GHOST_STALE_MS) {
      GHOST_TRAIN_REGISTRY.delete(ghostId);
      REVERSED_ID_MAP.delete(reg.sourceTmlId);
      delete OUTPUT_CACHE[ghostId];
      Geo.removeVehicle(ghostId);
    }
  }
};

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

  // [SENTIDO INVERTIDO] Antes de tudo: o número do comboio bate com o sentido
  // real do GPS? Se não, este número está corrompido — trata como fantasma
  // sem horário e não o processes pelo horário (errado) deste ID.
  const effectiveId = resolveDirectionalId(trainId, richInfo, nowObj);
  if (effectiveId !== trainId) {
    const ghostOut = buildGhostTrainOutput(effectiveId, nowObj);
    if (ghostOut) {
      OUTPUT_CACHE[effectiveId] = ghostOut;
      delete OUTPUT_CACHE[trainId]; // o número errado não deve aparecer
      mem.lastResult = null;
      return ghostOut;
    }
  }

  const isExtraTrain = !!(richInfo._isExtra || richInfo._isDynamicExtra);

  // ─── SUPRESSÃO ATIVA: re-verificação espaçada (10 min, não 15s) ───
  // Se o station-poll/checkOfflineTrains marcou este comboio como suprimido,
  // sincronizamos o gate aqui (primeira passagem por processTrain).
  if (SUPPRESSED_ACTIVE.has(trainId) && !mem.suppressedUntil) {
    mem.suppressedUntil = nowTime + SUPPRESSED_RECHECK_MS;
    mem.suppressedEndMs = richInfo.endObj ? richInfo.endObj.getTime() : nowTime;
    mem.suppressedIsExtra = isExtraTrain;
    delete OUTPUT_CACHE[trainId];
  }
  if (mem.suppressedUntil) {
    // Janela ativa terminou → larga tudo e limpa memória.
    if (nowTime > (mem.suppressedEndMs || 0)) {
      SUPPRESSED_ACTIVE.delete(trainId);
      delete OUTPUT_CACHE[trainId];
      delete TRAIN_MEMORY[trainId];
      return null;
    }
    // Ainda dentro do intervalo de 10 min → não faz fetch nenhum.
    if (nowTime < mem.suppressedUntil) {
      delete OUTPUT_CACHE[trainId];
      return null;
    }
    // Intervalo expirou → segue para o fetch e reavaliação (bloco SUPRESSÃO A).
  }

  if (nowTime < mem.nextWakeUp && mem.lastResult) {
    return mem.lastResult;
  }

  const richKey =
    !isExtraTrain && richInfo.roma_areeiro
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

  // ─── SUPRESSÃO ATIVA (A): reavaliação após o intervalo de 10 min ───
  // Só corre quando o gate de supressão expirou (mem.suppressedUntil definido e
  // já passámos o crivo do gate no topo). Decide se continua suprimido ou se
  // recuperou. Tem de vir ANTES da null-guard: caso contrário uma resposta nula
  // entraria na contagem 1/5 e reativaria a verificação de 15s.
  if (mem.suppressedUntil) {
    const valid =
      details &&
      !details._isAllNull &&
      Array.isArray(details.NodesPassagemComboio) &&
      details.NodesPassagemComboio.length > 0;
    const stillSuppressed =
      !valid || /SUPRIMIDO/i.test(details?.SituacaoComboio || "");

    if (stillSuppressed) {
      // Continua suprimido → renova o gate de 10 min, sem servir output.
      return enterActiveSuppression(richInfo, mem, mem.suppressedIsExtra);
    }

    // Recuperou → limpa o estado de supressão e volta ao fluxo normal (15s).
    console.log(
      `[SUPRESSÃO] Comboio ${trainId} retomou circulação. De volta ao fluxo normal (output + 15s).`,
    );
    mem.suppressedUntil = null;
    mem.suppressedEndMs = null;
    mem.suppressedIsExtra = false;
    SUPPRESSED_ACTIVE.delete(trainId);
    mem.nullResponseCount = 0;
    if (FUTURE_TRAINS_CACHE[trainId] === "SUPRIMIDO") {
      FUTURE_TRAINS_CACHE[trainId] = "Sem Informação";
    }
    // Segue para o processamento normal abaixo.
  }

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

    // CASO 3: 5 respostas nulas consecutivas → confirmar SUPRIMIDO.
    // Em vez de o atirar para GHOST_SUPPRESSED (reservado a imobilizados), entra
    // em modo de supressão ativa: re-verificação espaçada de 10 em 10 min.
    console.log(
      `[NULL GUARD] Comboio ${trainId} confirmado SUPRIMIDO após ${mem.nullResponseCount} respostas nulas consecutivas. A espaçar verificações para 10 min.`,
    );
    return enterActiveSuppression(richInfo, mem, isExtraTrain);
  } else if (details && !details._isAllNull) {
    // Resposta válida → resetar contador de nulos
    mem.nullResponseCount = 0;
  }

  // ─── SUPRESSÃO ATIVA (C): primeira deteção via SituacaoComboio ───
  // A IP devolve nós mas marca o comboio como SUPRIMIDO. Antes, o código
  // construía output normal e re-verificava de 15 em 15s — pedidos inúteis
  // durante toda a janela ativa. Agora entra logo em modo supressão (10 min).
  if (
    !mem.suppressedUntil &&
    details &&
    details.SituacaoComboio &&
    /SUPRIMIDO/i.test(details.SituacaoComboio)
  ) {
    console.log(
      `[SUPRESSÃO] Comboio ${trainId} marcado SUPRIMIDO pela IP. A espaçar verificações para 10 min.`,
    );
    return enterActiveSuppression(richInfo, mem, isExtraTrain);
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

  // Paragem técnica de Coina: comboios Setúbal→Lisboa recuperam até 3 min de
  // atraso enquanto aguardam a partida programada. A recuperação aplica-se às
  // previsões de Coina e estações seguintes até o comboio efectivamente passar.
  const isSetubalOrigin = direction === "lisboa" && !!richInfo.setubal;
  const coinaNodeId = STATION_IDS_FIXED["COINA"];
  let coinaPassed =
    nodes.some(
      (n) =>
        n.NomeEstacao.toUpperCase() === "COINA" && n.ComboioPassou === true,
    ) || !!mem.history[coinaNodeId];

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
        GhostManager.notifyProgress(trainId);
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
    direction: direction,
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

    const stationKey =
      STATION_MAP_IP_TO_JSON[node.NomeEstacao.toUpperCase().replace(/-A$/, "")];

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

      // Paragem técnica de Coina: quando o comboio passa Coina, o atraso real
      // é medido e passa a ser usado para as estações seguintes sem recuperação.
      if (
        isNewlyPassed &&
        node.NomeEstacao.toUpperCase() === "COINA" &&
        direction === "lisboa"
      ) {
        coinaPassed = true;
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
    let bridgeAdjustment =
      DelayManager.getStructuralDelay(stationKey, direction, {
        pragalPassed,
        corroiosPassed,
        penalvaPassed,
        now: nowObj,
        isWeekendOrHoliday,
      }) +
      DelayManager.getCoinaRecovery(
        stationKey,
        direction,
        isSetubalOrigin,
        coinaPassed,
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

        if (minutesLate >= 5) {
          const verdict = GhostManager.gpsVerdict(trainId);

          if (verdict === "moving") {
            // GHOST FALSO: a IP parou de marcar passagens, mas a TML mostra o
            // comboio a andar. Protege-o (watchlist) e a API passa a servi-lo
            // com base no GPS — atrasos cinemáticos via decorate/AtrasoDinamico.
            GhostManager.protect(trainId);
            trainOutput.SituacaoComboio = "Em circulação";
            trainOutput.AtrasoDinamico = true;
          } else if (minutesLate >= 15 || verdict === "absent") {
            // Stage 2: ou pelos 15 min clássicos, ou ESCALADA IMEDIATA —
            // o feed TML está vivo e este comboio NÃO existe lá (se o feed
            // estiver vazio, verdict é "unknown" e não escala).
            console.log(
              `[GHOST] Stage 2: Comboio ${trainId} (${minutesLate.toFixed(1)} min ` +
                `sem progressão${verdict === "absent" ? ", ausente da TML com feed vivo — escalada imediata" : ""}). ` +
                `A remover da API pública.`,
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
          } else {
            console.log(
              `[GHOST] Stage 1: Comboio ${trainId} com possível perturbação ` +
                `(${minutesLate.toFixed(1)} min sem progressão em "${nextUnvisited.NomeEstacao}").`,
            );
            trainOutput.SituacaoComboio = "Possível Perturbação";
          }
        }
      }
    }
  }

  // ─── [TRAJETO ANORMAL] DETEÇÃO DE DESVIOS ───────────────────────────────
  // Compara os nós REAIS da IP com o trajeto normal previsto (JSON base ou
  // _expectedRoute para extras). Usa details.NodesPassagemComboio (e não o
  // array sintético construído a partir do richInfo quando a IP não devolve
  // nós) para nunca gerar falsos positivos. Estações em falta = saltadas.
  const ipNodesForRoute =
    details && Array.isArray(details.NodesPassagemComboio)
      ? details.NodesPassagemComboio
      : null;

  if (ipNodesForRoute && !situacao.toUpperCase().includes("SUPRIMIDO")) {
    const abnormal = detectAbnormalRoute(
      richInfo,
      ipNodesForRoute,
      STATION_MAP_IP_TO_JSON,
      STATION_MAP_JSON_TO_IP,
    );
    if (abnormal.isAbnormal) {
      trainOutput._isAbnormalRoute = true;
      trainOutput._skippedStations = abnormal.skipped;
      ABNORMAL_ROUTES_CACHE[trainId] = { skipped: abnormal.skipped };
    } else {
      delete ABNORMAL_ROUTES_CACHE[trainId];
    }
  }
  // ─── [/TRAJETO ANORMAL] ─────────────────────────────────────────────────

  trainOutput.AtrasoCalculado = currentDelay;
  mem.lastDelay = currentDelay;
  mem.lastResult = trainOutput;

  applyGpsAutonomy(trainOutput, trainId, richInfo, nowObj);

  return trainOutput;
};

// --- LOOP PRINCIPAL ---
const updateCycle = async () => {
  const now = new Date();
  const opInfo = getOperationalInfo(now);
  const opDateStr = opInfo.operationalDateStr;
  if (IP_IS_DOWN || IP_BLOCKED) {
    const nowMs = Date.now();
    // Só tenta o ping de recuperação se não for um bloqueio intencional
    if (!IP_BLOCKED && nowMs - LAST_RECOVERY_PING > 120000) {
      LAST_RECOVERY_PING = nowMs;
      console.log(
        "[CIRCUIT BREAKER] IP em baixo. A enviar ping de recuperação...",
      );
      fetchDetails(String(14205), formatDateStr(new Date())).catch(() => {});
    }
    // Se o modo autónomo não estiver ativo, aborta
    if (!GPS_AUTONOMOUS_MODE) {
      return;
    }
  }

  // FIX: Injetar as chaves base no início do ciclo, garantindo que a estrutura
  // servida pela API existe mesmo que activeRichTrains fique vazio (o bloco
  // `finally` do loop não corre nesse caso).
  OUTPUT_CACHE.futureTrains = FUTURE_TRAINS_CACHE;
  OUTPUT_CACHE.extratrains = EXTRA_TRAINS_CACHE;
  OUTPUT_CACHE.abnormalRoutes = ABNORMAL_ROUTES_CACHE;

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
    opDateStr,
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
  const extras = VerifyManager.buildExtraRichInfoList(opDateStr);
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
    TRAIN_MEMORY[trainId].opDateStr = opDateStr;
    TRAIN_MEMORY[trainId].activeEndMs = t.endObj.getTime() + 120 * 60000;

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
        OUTPUT_CACHE.abnormalRoutes = ABNORMAL_ROUTES_CACHE; // [TRAJETO ANORMAL]
      }
    }, index * staggerMs);
  });

  // -------------------------------------------------------------------------
  // 3. LIMPEZA DE LIXO (GARBAGE COLLECTION)
  // -------------------------------------------------------------------------

  const nowMs = now.getTime();

  // Limpar Ghost Suppressed expirados (delegado ao GhostManager)
  GhostManager.cleanupExpiredGhosts(now, RICH_SCHEDULE, parseSmartTime);
  cleanupGhostTrains(nowMs); // [SENTIDO INVERTIDO] fantasmas 99xxx terminados
  for (const id of Object.keys(TRAIN_MEMORY)) {
    const m = TRAIN_MEMORY[id];
    if (m.isFetching) continue;
    const staleDay = m.opDateStr && m.opDateStr !== opDateStr;
    const windowEnded = m.activeEndMs && nowMs > m.activeEndMs;
    if (staleDay || windowEnded) {
      delete TRAIN_MEMORY[id];
      delete OUTPUT_CACHE[id];
      SUPPRESSED_ACTIVE.delete(id);
    }
  }

  // Remover órfãos do OUTPUT_CACHE: entradas de comboios que já não têm memória
  // ativa nem estão entre os extras (e não são as chaves reservadas da API).
  const RESERVED_KEYS = ["futureTrains", "extratrains", "abnormalRoutes"];
  for (const id of Object.keys(OUTPUT_CACHE)) {
    if (RESERVED_KEYS.includes(id)) continue;
    if (!TRAIN_MEMORY[id] && !EXTRA_TRAINS_CACHE[id]) {
      delete OUTPUT_CACHE[id];
    }
  }

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
        (GhostManager.GHOST_SUPPRESSED.has(trainId) ||
          SUPPRESSED_ACTIVE.has(trainId))
      ) {
        continue;
      }
      FUTURE_TRAINS_CACHE[trainId] = "Sem Informação";
      continue;
    }

    if (cachedStatus === "Realizado" || cachedStatus === "SUPRIMIDO") continue;

    if (endDate && nowMs > endDate.getTime()) {
      FUTURE_TRAINS_CACHE[trainId] = "Realizado";
      GhostManager.notifyProgress(trainId);
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
        abnormalRoutes: ABNORMAL_ROUTES_CACHE, // [TRAJETO ANORMAL]
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
    if (
      !newAvisos ||
      typeof newAvisos !== "object" ||
      Array.isArray(newAvisos)
    ) {
      return res
        .status(400)
        .json({ error: "Payload inválido: esperado objeto JSON." });
    }
    const target = path.join(__dirname, "avisos.json");
    const tmp = path.join(__dirname, `.avisos.json.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(newAvisos, null, 2), "utf8");
    fs.renameSync(tmp, target);
    if (typeof AvisosManager.reload === "function") {
      AvisosManager.reload();
    }
    res.json({ success: true, message: "Avisos atualizados com sucesso" });
  } catch (err) {
    console.error("[ADMIN /avisos] Erro a gravar:", err.message);
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

// keeping old support while app gets adjusted
// ENPOINT WITH DEPRECATED WARNING
app.get("/fertagus", protectRoute, (req, res) => {
  if (IP_IS_DOWN && !GPS_AUTONOMOUS_MODE) {
    return res.status(503).json({
      error: "IP_DOWN",
      status: "offline",
      message: "Infraestruturas de Portugal Incontactável",
    });
  }

  if (GPS_AUTONOMOUS_MODE) {
    return res.json(buildGpsLiveResponse(OUTPUT_CACHE));
  }

  res.json(OUTPUT_CACHE);
});

app.get("/estacao/:id", protectRoute, (req, res) => {
  if (IP_IS_DOWN) {
    return res.status(503).json({
      error: "IP_DOWN",
      status: "offline",
      message: "Infraestruturas de Portugal Incontactável",
    });
  }

  const station = EstacaoEndpoint.resolveStation(req.params.id);
  if (!station) {
    return res.status(404).json({
      error: "ESTACAO_DESCONHECIDA",
      message:
        "ID inválido. Usa o EstacaoID numérico da IP (ex: 9417236 = Coina).",
      estacoes: EstacaoEndpoint.listStations(),
    });
  }

  const payload = EstacaoEndpoint.buildStationPayload(station, {
    OUTPUT_CACHE,
    EXTRA_TRAINS_CACHE,
    GtfsOutput,
    FUTURE_TRAINS_CACHE,
    ABNORMAL_ROUTES_CACHE,
    RICH_SCHEDULE,
    DYNAMIC_EXTRA_SCHEDULE,
    parseSmartTime,
    now: new Date(),
    ipDown: IP_IS_DOWN,
    operationalDate: getOperationalInfo().operationalDateStr,
    limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
  });

  res.json(payload);
});

app.get("/estacoes", protectRoute, (req, res) => {
  res.json({ estacoes: EstacaoEndpoint.listStations() });
});

app.get("/mapa", protectRoute, (req, res) => {
  res.json(GetLocation.getMapData());
});

app.get("/stats", (req, res) => {
  res.json(AnalyticsManager.getStats());
});

app.get("/avisos", (req, res) => {
  res.json(AvisosManager.getAvisos());
});

// --- VERSION 2 | GTFS-RT COMPLIANT ---

// Ainda precisa de protectRoute!!

const LIVETAGUS_ENDPOINTS_BASE = "/v2/fertagus/";

app.get(`${LIVETAGUS_ENDPOINTS_BASE}feed`, (req, res) => {
  if (IP_IS_DOWN && !GPS_AUTONOMOUS_MODE) {
    return res.status(503).json({
      error: "IP_DOWN",
      status: "offline",
      message: "Infraestruturas de Portugal Incontactável",
    });
  }
  res.json(GtfsOutput.decorateOutputCache(OUTPUT_CACHE));
});

app.get(`${LIVETAGUS_ENDPOINTS_BASE}service-day/:date`, (req, res) => {
  const { status, body } = ServiceDayManager.resolveServiceDay(
    req.params.date,
    new Date(),
  );
  res.status(status).json(body);
});

app.get(`${LIVETAGUS_ENDPOINTS_BASE}trips/:id`, (req, res) => {
  if (IP_IS_DOWN && !GPS_AUTONOMOUS_MODE) {
    return res.status(503).json({
      error: "IP_DOWN",
      status: "offline",
      message: "Infraestruturas de Portugal Incontactável",
    });
  }

  const tripId = req.params.id;

  // 1. Evitar que o cliente aceda às chaves reservadas da cache global
  const RESERVED_KEYS = ["futureTrains", "extratrains", "abnormalRoutes"];
  if (RESERVED_KEYS.includes(tripId)) {
    return res.status(404).json({ error: "TRIP_NOT_LIVE_OR_UNKNOWN" });
  }

  // 2. Procurar o comboio no OUTPUT_CACHE ou nos Extras (caso ainda não esteja Live)
  let train = OUTPUT_CACHE[tripId];
  if (!train && EXTRA_TRAINS_CACHE && EXTRA_TRAINS_CACHE[tripId]) {
    train = EXTRA_TRAINS_CACHE[tripId];
  }

  // 3. Se não existir, devolver 404
  if (!train) {
    return res.status(404).json({
      error: "TRIP_NOT_LIVE_OR_UNKNOWN",
      message: "O serviço não está ativo de momento ou o ID é inválido.",
    });
  }

  // 4. Se existir, decora APENAS este comboio com os dados GTFS-RT e envia
  const decoratedTrip = GtfsOutput.decorateTrain(train);
  res.json(decoratedTrip);
});

app.get(`${LIVETAGUS_ENDPOINTS_BASE}stops/:id`, (req, res) => {
  if (IP_IS_DOWN && !GPS_AUTONOMOUS_MODE) {
    return res.status(503).json({
      error: "IP_DOWN",
      status: "offline",
      message: "Infraestruturas de Portugal Incontactável",
    });
  }

  const station = EstacaoEndpoint.resolveStation(req.params.id);
  if (!station) {
    return res.status(404).json({
      error: "STOP_UNKNOWN",
      message:
        "ID inválido. Usa o EstacaoID numérico da IP (ex: 9417236 = Coina).",
      estacoes: EstacaoEndpoint.listStations(),
    });
  }

  const payload = EstacaoEndpoint.buildStationPayload(station, {
    OUTPUT_CACHE,
    EXTRA_TRAINS_CACHE,
    GtfsOutput,
    FUTURE_TRAINS_CACHE,
    ABNORMAL_ROUTES_CACHE,
    RICH_SCHEDULE,
    DYNAMIC_EXTRA_SCHEDULE,
    parseSmartTime,
    now: new Date(),
    ipDown: IP_IS_DOWN,
    operationalDate: getOperationalInfo().operationalDateStr,
    limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
  });

  res.json(payload);
});

// todas as estações
app.get(`${LIVETAGUS_ENDPOINTS_BASE}stops`, (req, res) => {
  res.json({ estacoes: EstacaoEndpoint.listStations() });
});

// apenas localização e bearing dos comboios para poupar recursos
app.get(`${LIVETAGUS_ENDPOINTS_BASE}vehicle-positions`, (req, res) => {
  if (IP_IS_DOWN && !GPS_AUTONOMOUS_MODE) {
    return res.status(503).json({
      error: "IP_DOWN",
      status: "offline",
    });
  }

  const mapPayload = {};
  const RESERVED_KEYS = ["futureTrains", "extratrains", "abnormalRoutes"];

  for (const [id, train] of Object.entries(OUTPUT_CACHE)) {
    if (RESERVED_KEYS.includes(id)) continue;

    const dec = GtfsOutput.decorateTrain(train);

    // Filtra apenas comboios com GPS fresco e projetado na linha
    if (dec.gtfs_realtime?.position?.is_snapped) {
      mapPayload[id] = {
        lat: dec.gtfs_realtime.position.latitude,
        lng: dec.gtfs_realtime.position.longitude,
        bearing: dec.gtfs_realtime.position.bearing,
        // Velocidade em metros por segundo (standard GTFS)
        // speed: dec.gtfs_realtime.position.speed, (NOT PROD READY)
      };
    }
  }

  res.json(mapPayload);
});

// avisos ativos na linha. OLD "/avisos"
app.get(`${LIVETAGUS_ENDPOINTS_BASE}alerts`, (req, res) => {
  res.json(AvisosManager.getAvisos());
});

// --- GENEREAL ---

app.get("/", (req, res) =>
  res.json({
    status: "online",
    version: "b6.2.1",
    aviso:
      "Pedimos que não uses o nosso endpoint diretamente! Verifica toda as informações e código no github.",
    operational: getOperationalInfo(),
    ghost: {
      monitoring: Object.keys(GhostManager.GHOST_TRAINS).length,
      suppressed: GhostManager.GHOST_SUPPRESSED.size,
    },
    suppressed_active: SUPPRESSED_ACTIVE.size,
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
  console.log(`LiveTagus API vb6.2.1 ativa na porta ${PORT}`);
  console.log(`Endpoint /fertagus protegido com API_KEY.`);

  // NÃO usar await aqui: checkOfflineTrains() faz station-poll com timeouts
  // longos e, se a IP estiver lenta/inacessível, bloquearia o arranque do
  // motor (updateCycle/scheduleNextTick) → /fertagus serviria {} para sempre.
  // Disparamos em paralelo, tal como na versão estável.
  checkOfflineTrains();
  updateCycle();
  scheduleNextTick();
  try {
    Geo.init(
      path.join(__dirname, "fertagus_line_detailed.json"),
      path.join(__dirname, "ft_stations_detailed.json"),
    );
    GtfsOutput.init({
      Geo,
      DelaysRT,
      parseSmartTime,
      stationsDetailed: JSON.parse(
        fs.readFileSync(
          path.join(__dirname, "ft_stations_detailed.json"),
          "utf8",
        ),
      ),
      getRichById: (id) =>
        RICH_SCHEDULE.find((t) => String(t.id) === String(id)) ||
        DYNAMIC_EXTRA_SCHEDULE[String(id)] ||
        null,
      getDepartureById: (id) =>
        DEPARTURE_SCHEDULE.find((t) => String(t.id) === String(id)) || null,
    });
  } catch (e) {
    // GTFS-RT é camada opcional: sem geometria, a API serve só o legado.
    console.error(
      "[GTFS-RT] Init falhou — a servir apenas pipeline legada:",
      e.message,
    );
  }
  GetLocation.init((data) => {
    // Ingestão TML → snap/bearing/estados/atrasos. resolveTmlVehicle loga
    // claramente trip_id/vehicle_id sem correspondência (ping descartado,
    // comboio fica em fallback estático).
    Geo.ingestTmlPayload(data, (veh) => {
      const meta = GtfsOutput.resolveTmlVehicle(veh);
      if (!meta) return meta;
      GtfsOutput.rememberTmlMeta(meta.trainId, meta.tml);
      // [SENTIDO INVERTIDO] Se este número foi reatribuído a um fantasma,
      // encaminha o ping para o ID fantasma — é lá que a posição é acumulada.
      const rerouted = REVERSED_ID_MAP.get(String(meta.trainId));
      if (rerouted) return { ...meta, trainId: rerouted };
      return meta;
    });
  });

  // ServiceDayManager: restaura cache do disco, faz warm-up imediato e
  // agenda o cron diário das 04:00. RICH_SCHEDULE/HOLIDAYS via getters
  // (sobrevivem a reloads do loadDataFiles).
  ServiceDayManager.init({
    getRichSchedule: () => RICH_SCHEDULE,
    getHolidays: () => HOLIDAYS,
    VerifyManager,
    // PROVISORIO
    StationPoller: IP_BLOCKED
      ? {
          pollFutureDay: async () => {
            throw new Error("IP_BLOCKED");
          },
        }
      : StationPoller,
    ExtrasHelpers,
    STATION_MAP_IP_TO_JSON,
    stationsDetailed: JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "ft_stations_detailed.json"),
        "utf8",
      ),
    ),

    // Snapshot do Motor Live para a fusão do dia de hoje (getters: as caches
    // globais são reassigned, nunca passar referências diretas).
    getLiveState: () => ({
      FUTURE_TRAINS_CACHE,
      OUTPUT_CACHE,
      EXTRA_TRAINS_CACHE,
      DYNAMIC_EXTRA_SCHEDULE,
      ABNORMAL_ROUTES_CACHE,
    }),
    STATION_MAP_JSON_TO_IP,
    dir: __dirname,
  });

  setInterval(checkOfflineTrains, 15 * 60 * 1000); // considerar troca para 20 -> poupados cerca de 2000 pedidos por dia
});

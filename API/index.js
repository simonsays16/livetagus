require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");
const fs = require("fs");
const AnalyticsManager = require("./analytics.js");
const DelayManager = require("./delays.js");
const AvisosManager = require("./avisos.js");

const app = express();
app.use(cors());

// --- CONFIGURAÇÃO ---
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;

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

const API_BASE = "https://www.infraestruturasdeportugal.pt/negocios-e-servicos";

// FIX #6: Cache-Control e Pragma forçam a IP (e qualquer CDN/proxy intermédio)
// a retornar sempre uma resposta fresca. Sem estes headers, o servidor Node pode
// receber respostas em cache enquanto o browser (que envia no-cache nativamente)
// já veria dados atualizados — causando o delay de propagação de 1-3 min observado.
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

// --- GHOST TRAIN STATE ---
//
// Sistema de deteção e gestão de comboios parados sem anúncio oficial.
//
// GHOST_TRAINS: comboios removidos da API pública em monitorização de fundo
// (Stage 2: 30-60 min sem progressão na próxima estação prevista).
// Verificados de minuto a minuto para detetar retoma de circulação.
// Estrutura: { [trainId]: { richInfo, originDateStr, nextStationExpected: Date,
//                           intervalHandle, lastPassedCount } }
//
// GHOST_SUPPRESSED: comboios confirmados como suprimidos ao vivo (Stage 3: 60+ min).
// Excluídos de OUTPUT_CACHE e checkOfflineTrains.
// Mantidos em FUTURE_TRAINS_CACHE como "SUPRIMIDO" para tratamento correto pela app.
let GHOST_TRAINS = {};
let GHOST_SUPPRESSED = new Set();

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

// DEPRECATED: getTemporaryDelayAdjustment foi substituída por DelayManager.getStructuralDelay()
// em delays.js. A nova função cobre os três troços da Margem Sul com suporte a hora de ponta.
// Ver: delays.js → getStructuralDelay(stationKey, direction, { pragalPassed, penalvaPassed, now })

let IP_CONSECUTIVE_ERRORS = 0; // ADICIONA ESTA LINHA
let IP_IS_DOWN = false; // ADICIONA ESTA LINHA

// --- FETCHING ---

const fetchDetails = async (tid, dateStr) => {
  const url = `${API_BASE}/horarios-ncombio/${tid}/${dateStr}`;
  try {
    const r = await fetch(url, { headers: FETCH_HEADERS, timeout: 14000 });
    if (!r.ok) return null;
    const j = await r.json();
    IP_CONSECUTIVE_ERRORS = 0;
    IP_IS_DOWN = false;

    return j.response;
  } catch (e) {
    IP_CONSECUTIVE_ERRORS++;

    // Se 10 chamadas seguidas falharem (aprox. 1 a 2 batches), assumimos queda geral da IP
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
        // Tempo mínimo de paragem técnica Fertagus: 3 minutos.
        const minTurnaroundMs = 3 * 60 * 1000; // DIminuido para 3 minutos após extensas análises de precisão
        const minDepartureDate = new Date(
          predictedArrivalDate.getTime() + minTurnaroundMs,
        );

        // Se a chegada real + paragem técnica > partida planeada, prevemos atraso
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
// --- FUTURE TRAIN CHECK ---
const checkOfflineTrains = async () => {
  // 1. Verificação de Repouso Absoluto (Deep Sleep)
  // Se a app estiver a dormir de madrugada, não acordamos a máquina nem chateamos a IP.
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

  // Garantir que a string 'futureTrains' não é confundida com o ID de um comboio ativo
  const activeIds = Object.keys(OUTPUT_CACHE).filter(
    (k) => k !== "futureTrains",
  );

  // 2. Mapeamento e Identificação dos Comboios do Dia
  const candidates = RICH_SCHEDULE.map((t) => {
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
    if (GHOST_SUPPRESSED.has(String(t.id))) return false;
    if (GHOST_TRAINS[String(t.id)]) return false;

    // Verificar calendário (dias úteis vs fins de semana/feriados)
    const trainOpInfo = getOperationalInfo(t.startObj);
    const isTrainWeekendOrHoliday = trainOpInfo.isWeekendOrHoliday;

    const hType = parseInt(t.horario);
    if (hType === 1) return true;
    if (isTrainWeekendOrHoliday && hType === 2) return true;
    if (!isTrainWeekendOrHoliday && hType === 0) return true;
    return false;
  });

  const results = {};
  const fetchCandidates = [];

  // 3. O Filtro de Ressurreição e Poupança de Rede
  for (const t of candidates) {
    const safeEndMarginMs = t.endObj.getTime() + 60 * 60000;

    // Se o ciclo rápido de 10s JÁ deu o comboio como terminado, ou se a margem máxima de atraso já passou:
    if (
      nowMs > safeEndMarginMs ||
      FUTURE_TRAINS_CACHE[String(t.id)] === "Realizado"
    ) {
      // Carimbamos localmente sem gastar chamadas HTTP à IP
      results[String(t.id)] = "Realizado";
    } else {
      // Comboio legítimo que ainda precisa de verificação
      fetchCandidates.push(t);
    }
  }

  // 4. Execução Sequencial Anti-DDoS e Anti-Picos de CPU (Proteção VM Azure)
  // Sem paralelismo. Executamos de forma puramente linear, 1 a 1.
  for (const t of fetchCandidates) {
    try {
      const dateStr = formatDateStr(t.startObj);
      const details = await fetchDetails(String(t.id), dateStr);

      if (details && details.SituacaoComboio) {
        const situacao = details.SituacaoComboio.trim() || "Sem Informação";
        const nodes = details.NodesPassagemComboio || [];
        const hasStarted = nodes.some((n) => n.ComboioPassou === true);

        // Prevenir que a IP minta dizendo que um comboio das 17h está "em circulação" às 10h da manhã
        const impliesSpuriousLive =
          !hasStarted &&
          (/em circulação/i.test(situacao) || /a horas/i.test(situacao));

        if (impliesSpuriousLive) {
          results[String(t.id)] = "Sem Informação";
        } else {
          results[String(t.id)] = situacao;
        }
      } else {
        // Fail-safe: Se a IP não devolver dados estruturados, mantemos a última informação sabida
        results[String(t.id)] =
          FUTURE_TRAINS_CACHE[String(t.id)] || "Sem Informação";
      }
    } catch (error) {
      // Isolamento de erro: se um pedido falhar (ex: socket hang up), os restantes comboios continuam a ser processados
      console.error(
        `[FUTURE CHECK] Erro de rede isolado no comboio ${t.id}:`,
        error.message,
      );
      results[String(t.id)] =
        FUTURE_TRAINS_CACHE[String(t.id)] || "Sem Informação";
    }

    // O SEGREDO DO ANTI-DDOS: Pausa cirúrgica de 300ms após CADA pedido.
    // Garante invisibilidade aos WAFs e limitação orgânica de tráfego (~3 pedidos/segundo).
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  // 5. Atualização Segura da Memória Global
  FUTURE_TRAINS_CACHE = results;

  // Re-injetar os Ghost Suppressed para garantir que nunca mais regressam à vida nesta operação
  for (const ghostId of GHOST_SUPPRESSED) {
    FUTURE_TRAINS_CACHE[ghostId] = "SUPRIMIDO";
  }

  console.log(
    `[FUTURE CHECK] Concluído. Analisados na base de dados: ${candidates.length} | Pedidos à IP efetuados: ${fetchCandidates.length}`,
  );
};

// --- GHOST TRAIN MONITORING ---

/**
 * Inicia a monitorização em background de um comboio parado sem anúncio (Stage 2).
 *
 * O comboio passou pelo menos uma estação (isLive=true) mas ficou imobilizado
 * sem que a IP declare SUPRIMIDO. A LiveTagus retira-o da API pública para não
 * enganar utilizadores e verifica de minuto a minuto se retomou circulação.
 *
 * Timings:
 *   Stage 2 → entrada: 15+ min desde HoraPrevista da próxima estação
 *   Stage 3 → 60+ min desde HoraPrevista da próxima estação (30 min de monitoring)
 */
const initiateGhostMonitoring = (
  trainId,
  richInfo,
  originDateStr,
  nextStationExpectedDate,
  currentPassedCount,
) => {
  // Evita duplicação se já está em monitorização
  if (GHOST_TRAINS[trainId]) return;

  console.log(
    `[GHOST] Stage 2: Comboio ${trainId} removido da API pública. ` +
      `Monitorização background iniciada. ` +
      `Próxima estação esperada: ${nextStationExpectedDate.toLocaleTimeString("pt-PT")}.`,
  );

  const intervalHandle = setInterval(async () => {
    const ghost = GHOST_TRAINS[trainId];
    if (!ghost) return; // Entrada removida externamente — intervalo será limpo

    const minutesLate =
      (Date.now() - ghost.nextStationExpected.getTime()) / 60000;

    // === STAGE 3: 60+ minutos sem progressão ===
    // O comboio passou 30 min em Stage 2 sem retomar → supressão confirmada.
    if (minutesLate >= 60) {
      console.log(
        `[GHOST] Stage 3: Comboio ${trainId} confirmado suprimido ao vivo ` +
          `(${minutesLate.toFixed(1)} min sem progressão). Removido definitivamente da API.`,
      );
      FUTURE_TRAINS_CACHE[String(trainId)] = "SUPRIMIDO";
      GHOST_SUPPRESSED.add(String(trainId));
      clearInterval(ghost.intervalHandle);
      delete GHOST_TRAINS[trainId];
      delete TRAIN_MEMORY[trainId]; // Liberta RAM
      return;
    }

    // --- Verificação de retoma de circulação (minuto a minuto) ---
    try {
      const details = await fetchDetails(trainId, ghost.originDateStr);

      if (details && details.NodesPassagemComboio) {
        // A IP declarou SUPRIMIDO entretanto → Stage 3 imediato, sem esperar 60 min
        if (
          details.SituacaoComboio &&
          details.SituacaoComboio.toUpperCase().includes("SUPRIMIDO")
        ) {
          console.log(
            `[GHOST] Comboio ${trainId} declarado SUPRIMIDO pela IP durante monitorização. Stage 3 imediato.`,
          );
          FUTURE_TRAINS_CACHE[String(trainId)] = "SUPRIMIDO";
          GHOST_SUPPRESSED.add(String(trainId));
          clearInterval(ghost.intervalHandle);
          delete GHOST_TRAINS[trainId];
          delete TRAIN_MEMORY[trainId];
          return;
        }

        const newPassedCount = details.NodesPassagemComboio.filter(
          (n) => n.ComboioPassou,
        ).length;

        // Comboio retomou: passou uma nova estação desde que entrou em Stage 2
        if (newPassedCount > ghost.lastPassedCount) {
          console.log(
            `[GHOST] Comboio ${trainId} retomou circulação ` +
              `(${ghost.lastPassedCount} → ${newPassedCount} estações passadas). ` +
              `Removido da monitorização ghost — o próximo ciclo re-integra na API.`,
          );
          clearInterval(ghost.intervalHandle);
          delete GHOST_TRAINS[trainId];
          // O próximo updateCycle deteta-o dentro da janela e volta a processá-lo.
          return;
        }

        // Atualiza o contador para a próxima verificação
        ghost.lastPassedCount = newPassedCount;
      }
    } catch (e) {
      console.error(
        `[GHOST] Erro na verificação do comboio ${trainId}:`,
        e.message,
      );
    }
  }, 60000); // Verifica de minuto a minuto

  GHOST_TRAINS[trainId] = {
    richInfo,
    originDateStr,
    nextStationExpected: nextStationExpectedDate,
    intervalHandle,
    lastPassedCount: currentPassedCount,
  };
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
      isFetching: false, // Da nossa otimização anti-DDOS
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
          Observacoes: "", // Previne erros ao ler comboios futuros
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

  // B) Extração profunda das Observacoes do próximo nó não passado (ex: "Hora Prevista:02:11")
  const firstUnpassed = nodes.find((n) => !n.ComboioPassou);
  if (firstUnpassed && firstUnpassed.Observacoes) {
    const match = firstUnpassed.Observacoes.match(
      /Hora Prevista:\s*(\d{2}:\d{2})/i,
    );
    if (match) {
      const hpStr = match[1]; // "02:11"

      // Encontrar a hora programada exata, priorizando o estático se possível
      let horaChegadaProgStr = firstUnpassed.HoraProgramada;
      const stationKeyProg =
        STATION_MAP_IP_TO_JSON[firstUnpassed.NomeEstacao.toUpperCase()];
      if (stationKeyProg && richInfo[stationKeyProg]) {
        horaChegadaProgStr = richInfo[stationKeyProg];
      }
      if (horaChegadaProgStr?.length === 5) horaChegadaProgStr += ":00";

      const progDate = parseSmartTime(horaChegadaProgStr, nowObj);
      const prevDate = parseSmartTime(hpStr + ":00", nowObj); // Adiciona :00 para o parseSmartTime não falhar

      if (progDate && prevDate) {
        // Diferença em segundos entre a Hora Programada e a Hora Prevista pela IP
        const diffS = Math.floor(
          (prevDate.getTime() - progDate.getTime()) / 1000,
        );
        // Garante que ficamos sempre com a pior previsão (IP Text vs IP Observações)
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
        // Não reescrevemos aqui o texto, deixamos a sincronização final tratar disso
      }
    }
  }

  const pragalNodeId = STATION_IDS_FIXED["PRAGAL"];
  let pragalPassed =
    nodes.some(
      (n) =>
        n.NomeEstacao.toUpperCase() === "PRAGAL" && n.ComboioPassou === true,
    ) || !!mem.history[pragalNodeId];

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
    DataHoraDestino: `${displayDate} ${headerDestino?.substring(0, 5)}`,
    DataHoraOrigem: `${displayDate} ${headerOrigem?.substring(0, 5)}`,
    Destino: destinoIp,
    DuracaoViagem: duracao,
    Operador: operador,
    Origem: origemIp,
    TipoServico: "URB|SUBUR",
    Live: isLive,
    Ocupacao: richInfo.ocupacao,
    NodesPassagemComboio: [],
    AtrasoCalculado: 0,
    SituacaoComboio: situacao, // Será reescrito no final
  };

  // --- 2. A LEI DO MAIOR ATRASO ---
  // Arranca com o MAIOR valor entre: histórico da memória, turnaround ou declarado pela IP
  let currentDelay = Math.max(
    mem.lastDelay || 0,
    turnaroundDelay,
    ipReportedDelay,
  );
  let newStationPassed = false;
  let lastPassageRealTime = null; // Para resolver a "Cegueira CPU" de latência

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

        // Permite recuperar tempo usando o Math.max(0) - Fim do "Efeito Catraca"
        atrasoNode = Math.max(0, rawDelay);

        // Atraso físico vs Atraso IP: Prevalece sempre o pior cenário a ditar a frente do comboio
        currentDelay = Math.max(atrasoNode, ipReportedDelay, turnaroundDelay);
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
        penalvaPassed,
        now: nowObj,
        isWeekendOrHoliday,
      },
    );
    let horaPrevistaFinal = horaPartidaProgStr;

    // NOVO: Capturar o delay projetado (incluindo delay estrutural) APENAS da primeira estação não passada
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
      NomeEstacao: node.NomeEstacao,
    });
  });

  // O tempo de repouso conta a partir da HORA REAL da passagem, para não criarmos latência artificial
  if (newStationPassed && lastPassageRealTime) {
    mem.nextWakeUp = lastPassageRealTime + 90000;
  }

  // --- 3. SINCRONIZAÇÃO DA SITUAÇÃO DO COMBOIO (TEXTO UI) ---
  if (!situacao.toUpperCase().includes("SUPRIMIDO")) {
    const displayDelayMins = Math.round(nextStationTotalDelay / 60);

    if (displayDelayMins >= 1) {
      // Ajusta o texto dependendo de o comboio já ter iniciado serviço físico ou não
      trainOutput.SituacaoComboio = isLive
        ? `Circula com atraso de ${displayDelayMins} min.`
        : `Previsto atraso de ${displayDelayMins} min.`;
    } else {
      trainOutput.SituacaoComboio = isLive ? "Em circulação" : "Programado";
    }
  }

  // =========================================================================
  // ADDICTION GHOST TRAIN DETECTION
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
          initiateGhostMonitoring(
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
          // O ghost train sobrepõe temporariamente o texto de atraso normal, indicando uma falha detetada
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

  // 1. Filtrar os comboios que nos interessam agora
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

    // Se o comboio está a ser tratado pelo sistema de Ghost Trains (ou seja,
    // parou no meio do nada ou já foi dado como suprimido), ignoramos aqui
    // para não o voltar a injetar na API acidentalmente.
    if (GHOST_TRAINS[String(t.id)] || GHOST_SUPPRESSED.has(String(t.id))) {
      return false;
    }

    const isBeingTracked = !!TRAIN_MEMORY[String(t.id)];

    // Verificação simples de fim de semana/feriado
    const trainOpInfo = getOperationalInfo(t.startObj);
    const isTrainWeekendOrHoliday = trainOpInfo.isWeekendOrHoliday;

    const hType = parseInt(t.horario);
    let matchesDay =
      hType === 1 ||
      (isTrainWeekendOrHoliday && hType === 2) ||
      (!isTrainWeekendOrHoliday && hType === 0);
    if (!matchesDay) return false;

    // A nossa janela de monitorização: 20 min antes de partir até 2 horas depois de chegar
    const nowTime = now.getTime();
    const isInsideWindow =
      nowTime >= t.startObj.getTime() - 20 * 60000 &&
      nowTime <= t.endObj.getTime() + 120 * 60000;

    const isAlreadyFinished = FUTURE_TRAINS_CACHE[String(t.id)] === "Realizado";

    return (!isAlreadyFinished && isInsideWindow) || isBeingTracked;
  });

  // -------------------------------------------------------------------------
  // 2. O CORAÇÃO DO SISTEMA: PROTEÇÃO ANTI-DDOS E OTIMIZAÇÃO DE VM
  // -------------------------------------------------------------------------
  // Em vez de usarmos Promise.all (que bloqueia o servidor e dispara dezenas
  // de pedidos ao mesmo tempo contra a IP), vamos distribuir os pedidos ao
  // longo de 8 segundos. Assim, a IP recebe os pedidos pinga a pinga (parece
  // tráfego humano) e a nossa pequena VM Azure não sofre picos de CPU.

  const spreadWindowMs = 8000; // Janela segura de 8 segundos
  const staggerMs =
    activeRichTrains.length > 0
      ? Math.floor(spreadWindowMs / activeRichTrains.length)
      : 0;

  activeRichTrains.forEach((t, index) => {
    const trainId = String(t.id);

    // Inicializa a memória para este comboio se for a primeira vez que o vemos
    if (!TRAIN_MEMORY[trainId]) {
      TRAIN_MEMORY[trainId] = {
        history: {},
        lastDelay: 0,
        nextWakeUp: 0,
        lastResult: null,
        isFetching: false,
      };
    }

    // Lock individual: Se a IP estiver super lenta e este comboio ainda
    // estiver a carregar desde o ciclo anterior, saltamos à frente!
    // Isto evita encravar o sistema inteiro por causa de um único comboio.
    if (TRAIN_MEMORY[trainId].isFetching) return;

    TRAIN_MEMORY[trainId].isFetching = true;

    // Aqui acontece a magia do espaçamento. Multiplicamos o index pelo atraso calculado.
    setTimeout(async () => {
      try {
        const r = await processTrain(t, t.originDateStr);
        if (r) {
          OUTPUT_CACHE[trainId] = r;
        } else {
          // Retornou null (chegou ao fim da viagem ou entrou em ghost mode), apagamos.
          delete OUTPUT_CACHE[trainId];
        }
      } catch (e) {
        console.error(
          `[UPDATE CYCLE] Erro a processar o comboio ${trainId}:`,
          e.message,
        );
      } finally {
        // Libertamos o lock no fim, quer tenha tido sucesso ou dado erro
        if (TRAIN_MEMORY[trainId]) {
          TRAIN_MEMORY[trainId].isFetching = false;
        }
        // Asseguramos que os estados futuros não se perdem na cache principal
        OUTPUT_CACHE.futureTrains = FUTURE_TRAINS_CACHE;
      }
    }, index * staggerMs);
  });

  // -------------------------------------------------------------------------
  // 3. LIMPEZA DE LIXO (GARBAGE COLLECTION)
  // -------------------------------------------------------------------------

  const nowMs = now.getTime();

  // Limpar comboios fantasmas (Ghost Suppressed) que já passaram da validade.
  for (const ghostId of GHOST_SUPPRESSED) {
    const entry = RICH_SCHEDULE.find((t) => String(t.id) === ghostId);
    if (entry) {
      const endStr =
        entry.direction === "lisboa"
          ? entry.roma_areeiro
          : entry.setubal || entry.coina;
      if (endStr) {
        const endDate = parseSmartTime(endStr.substring(0, 5), now);
        if (endDate && nowMs > endDate.getTime() + 4 * 60 * 60 * 1000) {
          GHOST_SUPPRESSED.delete(ghostId);
        }
      }
    } else {
      GHOST_SUPPRESSED.delete(ghostId);
    }
  }

  // Marcar comboios futuros como "Realizado" assim que a hora de destino passa.
  // Evita que um atraso antigo fique colado no cache até ao próximo varrimento geral.
  for (const [trainId, cachedStatus] of Object.entries(FUTURE_TRAINS_CACHE)) {
    if (cachedStatus === "Realizado" || cachedStatus === "SUPRIMIDO") continue;

    const entry = RICH_SCHEDULE.find((t) => String(t.id) === trainId);
    if (!entry) continue;

    const endStr =
      entry.direction === "lisboa"
        ? entry.roma_areeiro
        : entry.setubal || entry.coina;
    if (!endStr) continue;

    const endDate = parseSmartTime(endStr.substring(0, 5), now);
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
    // só dorme se não existirem comboios na linha
    const hasActiveTrains = Object.keys(TRAIN_MEMORY).length > 0;

    if (!hasActiveTrains) {
      console.log(
        `[SEARCH OFF] API desativada às ${h}:${m}. Future Trains Congelados`,
      );
      return true; // Pode dormir.
    } else {
      console.log(
        `[SLEEP OVERRIDE] São ${h}:${m} mas ainda há comboios ativos na linha! API continua a funcionar.`,
      );
    }
  }
  return false; // Fora do horário de repouso, ou com comboios na linha, trabalha normalmente.
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

// Rota protegida com middleware
app.get("/fertagus", protectRoute, (req, res) => {
  // Se a IP morreu, o backend recusa-se a servir dados obsoletos e avisa a app
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
    version: "4.8.0",
    aviso:
      "Pedimos que não uses o nosso endpoint diretamente! Verifica toda as informações e código no github.",
    operational: getOperationalInfo(),
    ghost: {
      monitoring: Object.keys(GHOST_TRAINS).length,
      suppressed: GHOST_SUPPRESSED.size,
    },
  }),
);

app.listen(PORT, () => {
  console.log(`LiveTagus API v4.8.0 ativa na porta ${PORT}`);
  console.log(`Endpoint /fertagus protegido com API_KEY.`);
  checkOfflineTrains();
  updateCycle();
  scheduleNextTick();

  setInterval(checkOfflineTrains, 15 * 60 * 1000);
});

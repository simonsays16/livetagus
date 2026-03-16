require("dotenv").config(); // Carrega as variáveis do ficheiro .env
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");
const fs = require("fs");
const AnalyticsManager = require("./analytics.js");
const DelayManager = require("./delays.js");

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
  palmela: "PALMELA-A",
  venda_do_alcaide: "VENDA DO ALCAIDE",
  pinhal_novo: "PINHAL NOVO",
  penalva: "PENALVA",
  coina: "COINA",
  fogueteiro: "FOGUETEIRO",
  foros_de_amora: "FOROS DE AMORA",
  corroios: "CORROIOS",
  pragal: "PRAGAL",
  campolide: "CAMPOLIDE-A",
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
  "PALMELA-A": 9468098,
  "VENDA DO ALCAIDE": 9468049,
  "PINHAL NOVO": 9468007,
  PENALVA: 9417095,
  COINA: 9417236,
  FOGUETEIRO: 9417186,
  "FOROS DE AMORA": 9417152,
  CORROIOS: 9417137,
  PRAGAL: 9417087,
  "CAMPOLIDE-A": 9467033,
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

// --- FETCHING ---

const fetchDetails = async (tid, dateStr) => {
  const url = `${API_BASE}/horarios-ncombio/${tid}/${dateStr}`;
  try {
    const r = await fetch(url, { headers: FETCH_HEADERS, timeout: 8000 });
    if (!r.ok) return null;
    const j = await r.json();
    return j.response;
  } catch (e) {
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
          if (delaySeconds > 30) {
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
  console.log(
    `[FUTURE CHECK] ${new Date().toLocaleTimeString()} - A atualizar estados futuros (15m interval)...`,
  );
  const now = new Date();
  const activeIds = Object.keys(OUTPUT_CACHE);

  const candidates = RICH_SCHEDULE.map((t) => {
    let startStr =
      t.direction === "lisboa" ? t.setubal || t.coina : t.roma_areeiro;
    if (!startStr) return null;
    const startObj = parseSmartTime(startStr, now);
    return { ...t, startObj };
  }).filter((t) => {
    if (!t || !t.startObj) return false;
    if (activeIds.includes(String(t.id))) return false;

    // Não re-verificar comboios confirmados como ghost suppressed (Stage 3):
    // já estão no FUTURE_TRAINS_CACHE como SUPRIMIDO e não devem ser sobrescritos.
    if (GHOST_SUPPRESSED.has(String(t.id))) return false;

    // Não re-verificar comboios em monitorização ghost ativa (Stage 2):
    // o initiateGhostMonitoring já faz as verificações de minuto a minuto.
    if (GHOST_TRAINS[String(t.id)]) return false;

    // Avalia o dia específico deste comboio
    const trainOpInfo = getOperationalInfo(t.startObj);
    const isTrainWeekendOrHoliday = trainOpInfo.isWeekendOrHoliday;

    const hType = parseInt(t.horario);
    if (hType === 1) return true;
    if (isTrainWeekendOrHoliday && hType === 2) return true;
    if (!isTrainWeekendOrHoliday && hType === 0) return true;
    return false;
  });

  const results = {};
  const CONCURRENCY = 5;

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const chunk = candidates.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (t) => {
        const dateStr = formatDateStr(t.startObj);
        const details = await fetchDetails(String(t.id), dateStr);
        if (details && details.SituacaoComboio) {
          const situacao = details.SituacaoComboio.trim() || "Sem Informação";
          const nodes = details.NodesPassagemComboio || [];
          const hasStarted = nodes.some((n) => n.ComboioPassou === true);

          // FIX Bug Future Trains: quando a IP declara atrasos de rede, os comboios
          // futuros (que ainda não partiram) podem herdar um SituacaoComboio de
          // "Em circulação" ou "Atrasado", fazendo a app acreditar que já circulam.
          // Se nenhum node foi passado E o estado não é terminal, normaliza para
          // "Sem Informação" para não enganar a app.
          // Só normaliza estados que implicam circulação activa num comboio
          // que ainda não partiu (herança de atraso de rede da IP).
          // "Programado", "SUPRIMIDO" e qualquer estado terminal passam direto.
          const impliesSpuriousLive =
            !hasStarted &&
            (/em circulação/i.test(situacao) || /a horas/i.test(situacao));

          if (impliesSpuriousLive) {
            results[String(t.id)] = "Sem Informação";
          } else {
            results[String(t.id)] = situacao;
          }
        }
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
  }

  FUTURE_TRAINS_CACHE = results;

  // Re-injetar os ghost suppressed após a reconstrução do FUTURE_TRAINS_CACHE
  // para garantir que a app os trata sempre como suprimidos.
  for (const ghostId of GHOST_SUPPRESSED) {
    FUTURE_TRAINS_CACHE[ghostId] = "SUPRIMIDO";
  }
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
 *   Stage 2 → entrada: 30+ min desde HoraPrevista da próxima estação
 *   Stage 3 → 60+ min desde HoraPrevista da próxima estação (30 min de monitoring)
 *
 * @param {string} trainId                - ID do comboio
 * @param {object} richInfo               - Entrada do RICH_SCHEDULE
 * @param {string} originDateStr          - Data operacional (YYYY-MM-DD)
 * @param {Date}   nextStationExpectedDate - HoraPrevista da próxima estação não visitada
 * @param {number} currentPassedCount     - Nº de estações já passadas na deteção
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
    };
  }
  const mem = TRAIN_MEMORY[trainId];

  // FIX nextWakeUp: reduzido de 120 000ms para 60 000ms.
  // O valor anterior criava um período "cego" demasiado longo após cada passagem
  // de estação. Em Roma-Areeiro (primeiro nó sentido Margem), os 120s impediam
  // a deteção da partida durante 2 min — muito acima do intervalo de 10s pretendido.
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
        });
      }
    });
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
        if (!isLive) situacao = "Atraso Previsto (Turnaround)";
      }
    }
  }

  // Determina se o comboio já passou o Pragal (sentido margem).
  // Usado para evitar dupla contagem do atraso da ponte 25 de abril no Corroios
  // e para remover os atrasos do Troço 1 (Foros de Amora, Fogueteiro).
  const pragalNodeId = STATION_IDS_FIXED["PRAGAL"];
  // 'let' (não 'const') porque pode ser atualizado ao vivo dentro do forEach
  let pragalPassed =
    nodes.some(
      (n) =>
        n.NomeEstacao.toUpperCase() === "PRAGAL" && n.ComboioPassou === true,
    ) || !!mem.history[pragalNodeId];

  // Determina se o comboio já passou Penalva (sentido margem).
  // Usado para remover os atrasos do Troço 2 (Penalva → Setúbal).
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
        // FIX Analytics Bug 1: recordArrival para a estação terminal.
        // O forEach nunca corre quando isEnd é true, por isso o registo é feito aqui.
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
        // FIX Bug Future Trains: marca imediatamente como realizado para evitar que a app
        // continue a ver este comboio como "em circulação/atrasado" durante os 15 min
        // até ao próximo checkOfflineTrains. Sem esta linha, o FUTURE_TRAINS_CACHE mantém
        // o status herdado de atrasos de rede declarados pela IP.
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
    SituacaoComboio: situacao,
  };

  let currentDelay = Math.max(mem.lastDelay, turnaroundDelay);
  let newStationPassed = false;

  nodes.forEach((node) => {
    const passed = node.ComboioPassou;

    // isNewlyPassed: primeira vez que este node é marcado como passado
    const isNewlyPassed = passed && !mem.history[node.NodeID];
    if (isNewlyPassed) {
      newStationPassed = true;
    }

    const stationKey = STATION_MAP_IP_TO_JSON[node.NomeEstacao.toUpperCase()];

    // Hora de Chegada Programada (usada para calcular o atraso real vindo da IP)
    let horaChegadaProgStr =
      stationKey && richInfo[stationKey]
        ? richInfo[stationKey]
        : node.HoraProgramada;
    if (horaChegadaProgStr?.length === 5) horaChegadaProgStr += ":00";
    const dateChegadaProg = parseSmartTime(horaChegadaProgStr, nowObj);

    // Hora de Partida Programada (para a previsão final apresentada ao utilizador)
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
          Math.floor((timestamp - dateChegadaProg.getTime()) / 1000) - 15; //Atualização para 15 segunddos para correção de atrasos da API da IP

        // FIX Bug 2 (Roma-Areeiro / deteção tardia): evita inflar o atraso acumulado
        // com a latência de deteção do ciclo. No cenário problemático: ciclo sequencial
        // de ~51s em hora de ponta → comboio que parte de Roma-Areeiro a horas (08:03)
        // é detetado apenas às 08:04:51 → rawDelay ≈ 101s → atraso falso de ~2 min
        // propagado para Entrecampos, Sete Rios, Campolide, etc.
        //
        // Regra: se o delay bruto calculado for inferior ao delay já conhecido
        // (mem.lastDelay), mantém o anterior. Isto nunca mascara atrasos reais:
        // se o comboio genuinamente acelerou, rawDelay seria negativo e
        // mem.lastDelay (sempre >= 0) seria usado corretamente.
        if (isNewlyPassed && rawDelay < mem.lastDelay) {
          atrasoNode = mem.lastDelay;
        } else {
          atrasoNode = rawDelay;
        }
        currentDelay = atrasoNode;
      }

      // FIX Analytics Bug 2: se o Pragal acabou de ser passado neste ciclo,
      // atualiza pragalPassed imediatamente para que o Corroios (processado a seguir)
      // não receba bridgeAdjustment incorretamente na mesma iteração.
      if (
        isNewlyPassed &&
        node.NomeEstacao.toUpperCase() === "PRAGAL" &&
        direction === "margem"
      ) {
        pragalPassed = true;
      }

      // Atualiza penalvaPassed ao vivo: se Penalva acabou de ser passada neste ciclo,
      // as estações seguintes (Pinhal Novo, etc.) não recebem o atraso do Troço 2.
      if (
        isNewlyPassed &&
        node.NomeEstacao.toUpperCase() === "PENALVA" &&
        direction === "margem"
      ) {
        penalvaPassed = true;
      }

      // Analytics: regista chegada real (só na primeira passagem da estação)
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

    // Atraso estrutural calculado pelo DelayManager (bridge + troço 1 + troço 2).
    // Substitui getTemporaryDelayAdjustment — agora cobre os três troços da Margem
    // e distingue hora de ponta. Para estações já passadas o valor é irrelevante
    // (a previsão usa horaRealStr), mas stationKey pode ser null em nós offline sem mapa.
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
    let horaPrevistaFinal = horaPartidaProgStr; // Inicia com a partida teórica

    if (datePartidaProg && !passed) {
      // Previsão = Hora de Partida Planeada + Atraso Acumulado + Ajuste Estrutural
      const rawPredictedMs =
        datePartidaProg.getTime() + (currentDelay + bridgeAdjustment) * 1000;

      // Regra de Segurança (FIX Bug Lógico de Tempo):
      // A previsão apresentada ao utilizador NUNCA pode ser anterior à hora de
      // PARTIDA programada estática. Usar datePartidaProg (não dateChegadaProg)
      // como floor porque é o horário que o utilizador vê no display — o dwell time
      // entre chegada e partida já está embutido nele.
      // Nota: o clamp nos analytics (linha abaixo) usa dateChegadaProg como floor,
      // porque lá a métrica é de chegada — os dois floors têm propósitos distintos.
      const clampedMs = DelayManager.clampToScheduled(
        rawPredictedMs,
        datePartidaProg.getTime(),
      );
      horaPrevistaFinal = formatTimeHHMMSS(new Date(clampedMs));
    }

    // Analytics: captura snapshot da previsão para estações ainda não passadas.
    if (!passed && stationKey && dateChegadaProg) {
      // Usa o mesmo clamp da HoraPrevista para que a métrica de precisão seja coerente
      // com o que é apresentado ao utilizador.
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
      HoraProgramada: horaPartidaProgStr, // Passamos a mostrar a partida programada
      HoraReal: passed ? horaRealStr : "HH:MM:SS",
      AtrasoReal: passed ? atrasoNode : 0,
      HoraPrevista: passed ? horaRealStr : horaPrevistaFinal,
      EstacaoID: node.NodeID,
      NomeEstacao: node.NomeEstacao,
    });
  });

  // FIX #6: nextWakeUp reduzido de 120 000ms para 90 000ms.
  if (newStationPassed) {
    mem.nextWakeUp = Date.now() + 90000;
  }

  // =========================================================================
  // ADDICTION GHOST TRAIN DETECTION
  //
  // Aplica-se apenas a comboios live não declarados suprimidos pela IP.
  // Deteta comboios imobilizados sem anúncio e aplica cancelamento gradual.
  //
  // Stage 1 (5–29 min): SituacaoComboio = "Possível Perturbação"
  //   → comboio permanece visível na API com aviso para a app mostrar
  //
  // Stage 2 (30–59 min): comboio removido da OUTPUT_CACHE pública
  //   → monitorização background de minuto a minuto (máx. 30 min)
  //   → se retomar circulação, o próximo updateCycle re-integra-o
  //
  // Stage 3 (60+ min): supressão confirmada
  //   → FUTURE_TRAINS_CACHE["id"] = "SUPRIMIDO"
  //   → GHOST_SUPPRESSED garante exclusão permanente nesta sessão operacional
  //   → TRAIN_MEMORY limpo para libertar RAM
  // =========================================================================
  if (isLive && !situacao.toUpperCase().includes("SUPRIMIDO")) {
    const nextUnvisited = trainOutput.NodesPassagemComboio.find(
      (n) => !n.ComboioPassou,
    );

    if (
      nextUnvisited &&
      nextUnvisited.HoraPrevista &&
      nextUnvisited.HoraPrevista !== "HH:MM:SS"
    ) {
      // HoraPrevista dos nós não passados está em formato HH:MM:SS — extrai HH:MM
      const nextExpectedDate = parseSmartTime(
        nextUnvisited.HoraPrevista.substring(0, 5),
        nowObj,
      );

      if (nextExpectedDate) {
        const minutesLate = (nowTime - nextExpectedDate.getTime()) / 60000;

        if (minutesLate >= 30) {
          // === STAGE 2 ===
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
          // Remove imediatamente da cache pública para não servir dados obsoletos
          // em requests que cheguem antes do fim deste ciclo updateCycle.
          delete OUTPUT_CACHE[trainId];
          mem.lastResult = null;
          return null;
        } else if (minutesLate >= 5) {
          // === STAGE 1 ===
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
  mem.lastResult = trainOutput; // Guarda o resultado correto no próprio comboio
  return trainOutput;
};

// --- LOOP PRINCIPAL ---
const updateCycle = async () => {
  const now = new Date();

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

    // FIX Paralelização: excluir comboios em monitorização ghost (Stage 2) e
    // confirmados suprimidos (Stage 3). Sem este filtro, o updateCycle re-adicionaria
    // à OUTPUT_CACHE um comboio que o ghost system acabou de remover.
    if (GHOST_TRAINS[String(t.id)] || GHOST_SUPPRESSED.has(String(t.id))) {
      return false;
    }

    const isBeingTracked = !!TRAIN_MEMORY[String(t.id)];

    // Avalia se o dia específico deste comboio é de fim de semana/feriado.
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
      nowTime >= t.startObj.getTime() - 45 * 60000 &&
      nowTime <= t.endObj.getTime() + 120 * 60000;

    return isInsideWindow || isBeingTracked;
  });

  const newOutput = {};

  // FIX Bug 1 (Roma-Areeiro / paralelização):
  // O ciclo original processava os comboios sequencialmente com await + 50ms gap.
  // Em hora de ponta (33 comboios ativos), cada ciclo demorava ~51s — 5× o intervalo
  // pretendido de 10s. O IS_CYCLE_RUNNING impedia sobreposição, fazendo com que todos
  // os ticks intermédios fossem ignorados. Resultado: polling efetivo de ~51s,
  // com deteção da partida em Roma-Areeiro sistematicamente atrasada.
  //
  // Solução: processamento em batches paralelos de 6. Com fetches de ~1.5s cada:
  //   33 comboios ÷ 6 por batch × 1.5s ≈ 9s por ciclo → respeita o intervalo de 10s.
  const BATCH_SIZE = 6;
  for (let i = 0; i < activeRichTrains.length; i += BATCH_SIZE) {
    const batch = activeRichTrains.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((t) => processTrain(t, t.originDateStr)),
    );
    results.forEach((r) => {
      if (r) newOutput[r["id-comboio"]] = r;
    });
  }

  // --- Limpeza de estados obsoletos no FUTURE_TRAINS_CACHE ---
  //
  // checkOfflineTrains corre de 15 em 15 minutos. Um comboio pode terminar a
  // viagem entre duas verificações com um estado de atraso ainda em cache
  // (ex: "Atraso 9 min" copiado às 10:40, comboio termina às 10:45, próxima
  // verificação só às 10:55 → durante 10 min o cache mente ao cliente).
  //
  // Esta lógica corre a cada 10 segundos e marca "Realizado" assim que a hora
  // de chegada ao destino final já passou, sem precisar de chamada à API IP.
  // O GHOST_SUPPRESSED não é tocado aqui — esses têm o seu próprio ciclo.
  const nowMs = now.getTime();
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

  OUTPUT_CACHE = { ...newOutput, futureTrains: FUTURE_TRAINS_CACHE };

  // --- Limpeza periódica do GHOST_SUPPRESSED ---
  // Remove entradas de comboios cujo horário de fim já passou há mais de 4 horas,
  // evitando que o Set cresça indefinidamente ao longo de dias de serviço.
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
};

// --- TICKER (10 SEGUNDOS) ---
const scheduleNextTick = () => {
  const now = new Date();
  const seconds = now.getSeconds();
  const ms = now.getMilliseconds();
  const nextTarget = (Math.floor(seconds / 10) + 1) * 10;
  const delay = (nextTarget - seconds) * 1000 - ms;

  setTimeout(async () => {
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
app.get("/fertagus", protectRoute, (req, res) => res.json(OUTPUT_CACHE));

// Rota pública de estatísticas de precisão das previsões
app.get("/stats", (req, res) => {
  res.json(AnalyticsManager.getStats());
});

app.get("/", (req, res) =>
  res.json({
    status: "online",
    version: "4.5.5",
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
  console.log(`LiveTagus API v4.5.5 ativa na porta ${PORT}`);
  console.log(`Endpoint /fertagus protegido com API_KEY.`);
  checkOfflineTrains();
  updateCycle();
  scheduleNextTick();

  setInterval(checkOfflineTrains, 15 * 60 * 1000);
});

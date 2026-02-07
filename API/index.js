const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());

// --- CONFIGURAÇÃO ---
const PORT = process.env.PORT || 3000;

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
const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.infraestruturasdeportugal.pt/",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
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
let TRAIN_MEMORY = {}; // { [id]: { history: {}, lastDelay: 0, nextWakeUp: 0 } }
let FUTURE_TRAINS_CACHE = {};

// --- DATE & SCHEDULE HELPERS ---

const formatDateStr = (d) => {
  const pad = (n) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const getOperationalInfo = (now = new Date()) => {
  const d = new Date(now.getTime());
  const hour = d.getHours();

  // Dia operacional Fertagus (05h - 02h30)
  if (hour < 3) {
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

  if (nowH < 5 && h >= 18) {
    d.setDate(d.getDate() - 1);
  } else if (nowH >= 20 && h < 5) {
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

const getTemporaryDelayAdjustment = (stationName, direction) => {
  const targetStations = ["PRAGAL", "CORROIOS"];
  if (
    direction === "margem" &&
    targetStations.includes(stationName.toUpperCase())
  ) {
    return 90; // 90 segundos = 1min 30s
  }
  return 0;
};

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
        // Tempo mínimo de paragem técnica Fertagus: 4 minutos e 30 segundos.
        const minTurnaroundMs = 4.5 * 60 * 1000;
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
  const { isWeekendOrHoliday } = getOperationalInfo(now);
  const activeIds = Object.keys(OUTPUT_CACHE);

  const candidates = RICH_SCHEDULE.filter((t) => {
    if (activeIds.includes(String(t.id))) return false;
    const hType = parseInt(t.horario);
    if (hType === 1) return true;
    if (isWeekendOrHoliday && hType === 2) return true;
    if (!isWeekendOrHoliday && hType === 0) return true;
    return false;
  });

  const results = {};
  const CONCURRENCY = 5;

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const chunk = candidates.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (t) => {
        let startStr =
          t.direction === "lisboa" ? t.setubal || t.coina : t.roma_areeiro;
        if (!startStr) return;
        const startDate = parseSmartTime(startStr, now);
        if (!startDate) return;
        const dateStr = formatDateStr(startDate);
        const details = await fetchDetails(String(t.id), dateStr);
        if (details && details.SituacaoComboio) {
          results[String(t.id)] =
            details.SituacaoComboio.trim() || "Sem Informação";
        }
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
  }
  FUTURE_TRAINS_CACHE = results;
};

// --- PROCESSAMENTO ---
const processTrain = async (richInfo, originDateStr) => {
  const trainId = String(richInfo.id);
  const nowTime = Date.now();
  const nowObj = new Date();
  const direction = richInfo.direction;

  if (!TRAIN_MEMORY[trainId]) {
    TRAIN_MEMORY[trainId] = { history: {}, lastDelay: 0, nextWakeUp: 0 };
  }
  const mem = TRAIN_MEMORY[trainId];

  if (nowTime < mem.nextWakeUp && OUTPUT_CACHE[trainId]) {
    return OUTPUT_CACHE[trainId];
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

    if (passed && !mem.history[node.NodeID]) {
      newStationPassed = true;
    }

    const stationKey = STATION_MAP_IP_TO_JSON[node.NomeEstacao.toUpperCase()];
    let horaChegadaProgStr =
      stationKey && richInfo[stationKey]
        ? richInfo[stationKey]
        : node.HoraProgramada;
    if (horaChegadaProgStr?.length === 5) horaChegadaProgStr += ":00";

    const dateChegadaProg = parseSmartTime(horaChegadaProgStr, nowObj);
    let horaRealStr = "HH:MM:SS";
    let atrasoNode = 0;

    if (passed) {
      let timestamp = mem.history[node.NodeID] || Date.now();
      mem.history[node.NodeID] = timestamp;
      horaRealStr = formatTimeHHMMSS(new Date(timestamp));
      if (dateChegadaProg) {
        atrasoNode =
          Math.floor((timestamp - dateChegadaProg.getTime()) / 1000) - 15;
        currentDelay = atrasoNode;
      }
    }

    let bridgeAdjustment = getTemporaryDelayAdjustment(
      node.NomeEstacao,
      direction,
    );
    let horaPrevistaFinal = horaChegadaProgStr;

    if (dateChegadaProg && !passed) {
      horaPrevistaFinal = formatTimeHHMMSS(
        new Date(
          dateChegadaProg.getTime() + (currentDelay + bridgeAdjustment) * 1000,
        ),
      );
    }

    trainOutput.NodesPassagemComboio.push({
      ComboioPassou: passed,
      HoraProgramada: horaChegadaProgStr,
      HoraReal: passed ? horaRealStr : "HH:MM:SS",
      AtrasoReal: passed ? atrasoNode : 0,
      HoraPrevista: passed ? horaRealStr : horaPrevistaFinal,
      EstacaoID: node.NodeID,
      NomeEstacao: node.NomeEstacao,
    });
  });

  if (newStationPassed) {
    mem.nextWakeUp = Date.now() + 120000;
  }

  trainOutput.AtrasoCalculado = currentDelay;
  mem.lastDelay = currentDelay;
  return trainOutput;
};

// --- LOOP PRINCIPAL ---
const updateCycle = async () => {
  const now = new Date();
  const { isWeekendOrHoliday } = getOperationalInfo(now);

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

    const isBeingTracked = !!TRAIN_MEMORY[String(t.id)];

    const hType = parseInt(t.horario);
    let matchesDay =
      hType === 1 ||
      (isWeekendOrHoliday && hType === 2) ||
      (!isWeekendOrHoliday && hType === 0);
    if (!matchesDay) return false;

    const nowTime = now.getTime();
    const isInsideWindow =
      nowTime >= t.startObj.getTime() - 45 * 60000 &&
      nowTime <= t.endObj.getTime() + 120 * 60000;

    return isInsideWindow || isBeingTracked;
  });

  const newOutput = {};
  for (const t of activeRichTrains) {
    const result = await processTrain(t, t.originDateStr);
    if (result) newOutput[result["id-comboio"]] = result;
    await new Promise((r) => setTimeout(r, 50));
  }

  OUTPUT_CACHE = { ...newOutput, futureTrains: FUTURE_TRAINS_CACHE };
};

// --- TICKER (10 SEGUNDOS) ---
const scheduleNextTick = () => {
  const now = new Date();
  const seconds = now.getSeconds();
  const ms = now.getMilliseconds();
  const nextTarget = (Math.floor(seconds / 10) + 1) * 10;
  const delay = (nextTarget - seconds) * 1000 - ms;

  setTimeout(() => {
    updateCycle();
    scheduleNextTick();
  }, delay || 10000);
};

// --- ROUTES ---
app.get("/fertagus", (req, res) => res.json(OUTPUT_CACHE));
app.get("/", (req, res) =>
  res.json({
    status: "online",
    version: "4.3.4",
    aviso: "pedimos que não use o nosso endpoint, verifica o código no github",
    operational: getOperationalInfo(),
  }),
);

app.listen(PORT, () => {
  console.log(`LiveTagus API v4.3.2 ativa na porta ${PORT}`);
  checkOfflineTrains();
  updateCycle();
  scheduleNextTick();

  setInterval(checkOfflineTrains, 15 * 60 * 1000);
});

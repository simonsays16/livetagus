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
    } else {
      console.warn(`[LOAD WARN] Ficheiro não encontrado: ${filename}`);
    }
  }
  return [];
};

const loadDataFiles = () => {
  try {
    console.log("------------------------------------------------");
    console.log("[INIT] A iniciar carregamento de dados...");

    // Carregar Chegadas (Rich)
    const arrLisboa = loadFile(
      ["horarios_comboio_passou_fertagus_sentido_lisboa.json"],
      "lisboa",
    );
    const arrMargem = loadFile(
      ["horarios_comboio_passou_fertagus_sentido_margem.json"],
      "margem",
    );
    RICH_SCHEDULE = [...arrLisboa, ...arrMargem];

    // Carregar Partidas (Display)
    const depLisboa = loadFile(
      ["fertagus_semana_sentido_lisboa.json"],
      "lisboa",
    );
    const depMargem = loadFile(
      ["fertagus_semana_sentido_margem.json"],
      "margem",
    );
    DEPARTURE_SCHEDULE = [...depLisboa, ...depMargem];

    console.log(
      `[INIT] Total em memória: ${RICH_SCHEDULE.length} (Chegadas) | ${DEPARTURE_SCHEDULE.length} (Partidas)`,
    );
    console.log("------------------------------------------------");
  } catch (e) {
    console.error("[INIT FATAL] Erro:", e);
  }
};

loadDataFiles();

// --- MEMÓRIA ---
let OUTPUT_CACHE = {};
let TRAIN_MEMORY = {};
let FUTURE_TRAINS_CACHE = {}; // Cache para estados de comboios futuros (offline)

// --- DATE HELPERS (SMART) ---

const formatDateStr = (d) => {
  const pad = (n) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

  // Lógica de Rollover
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

const addSeconds = (dObj, seconds) => {
  if (!(dObj instanceof Date) || isNaN(dObj)) {
    console.error("[ERRO DATE] addSeconds recebeu objeto inválido:", dObj);
    return "00:00:00";
  }
  const newD = new Date(dObj.getTime() + seconds * 1000);
  return formatTimeHHMMSS(newD);
};

const subtractMinutes = (timeStr, minutes) => {
  const [h, m] = timeStr.split(":").map(Number);
  let date = new Date();
  date.setHours(h, m, 0, 0);
  date.setMinutes(date.getMinutes() - minutes);
  const pad = (n) => n.toString().padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// --- FETCHING ---
const fetchDetails = async (tid, dateStr) => {
  const url = `${API_BASE}/horarios-ncombio/${tid}/${dateStr}`;
  try {
    const r = await fetch(url, { headers: FETCH_HEADERS, timeout: 8000 });
    if (!r.ok) {
      // console.log(`[API ERROR] ${tid}: HTTP ${r.status}`);
      return null;
    }
    const j = await r.json();
    return j.response;
  } catch (e) {
    // console.log(`[FETCH FAIL] ${tid}: ${e.message}`);
    return null;
  }
};

// --- TURNAROUND PREDICTION ---
const checkTurnaroundDelay = (
  currentTrainId,
  scheduledDepartureStr,
  nowObj,
) => {
  const [h, m] = scheduledDepartureStr.split(":").map(Number);
  const timeVal = h * 100 + m;

  if (timeVal < 600 || timeVal > 2230) return null;

  // Turnaround atualizado para 4 minutos
  const incomingArrivalStr = subtractMinutes(scheduledDepartureStr, 4);

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
        // Adicionar 4 minutos à chegada prevista
        const minTurnaroundMs = 4 * 60 * 1000;
        const minDepartureDate = new Date(
          predictedArrivalDate.getTime() + minTurnaroundMs,
        );

        if (minDepartureDate > scheduledDepartureDate) {
          const delaySeconds = Math.floor(
            (minDepartureDate.getTime() - scheduledDepartureDate.getTime()) /
              1000,
          );

          if (delaySeconds > 60) {
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
    `[FUTURE CHECK] ${new Date().toLocaleTimeString()} - A verificar estado de comboios futuros...`,
  );
  const now = new Date();

  // Obter IDs que JÁ estão a ser seguidos no ciclo principal para ignorar
  const activeIds = Object.keys(OUTPUT_CACHE);

  // Filtrar todos os comboios do dia que NÃO estão ativos
  // Consideramos apenas comboios cujo início é hoje (ou ontem se for rollover de madrugada)
  // Para simplificar e garantir cobertura, verificamos TODOS no RICH_SCHEDULE que não estejam no activeIds
  // e cuja data de operação seja relevante.

  const candidates = RICH_SCHEDULE.filter((t) => {
    if (activeIds.includes(String(t.id))) return false;
    // Otimização: Verificar apenas comboios nas próximas 4-6 horas ou passados recentes?
    // O user pediu "todos os comboios do dia". Vamos verificar todos para garantir o estado "Suprimido".
    return true;
  });

  console.log(
    `[FUTURE CHECK] ${candidates.length} comboios candidatos a verificação.`,
  );

  const results = {};
  const CONCURRENCY = 5; // Limitar pedidos simultâneos

  // Helper para processar em chunks
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const chunk = candidates.slice(i, i + CONCURRENCY);

    await Promise.all(
      chunk.map(async (t) => {
        // Determinar data correta
        let startStr =
          t.direction === "lisboa" ? t.setubal || t.coina : t.roma_areeiro;
        if (!startStr) return;

        const startDate = parseSmartTime(startStr, now);
        if (!startDate) return;

        const dateStr = formatDateStr(startDate);
        const trainId = String(t.id);

        // Fetch Status Only
        const details = await fetchDetails(trainId, dateStr);

        if (details && details.SituacaoComboio) {
          // Guardar apenas se for relevante (Programado, Suprimido, Atrasado...)
          // Normalizamos a string
          let status = details.SituacaoComboio.trim();
          if (status) {
            results[trainId] = status;
          } else {
            results[trainId] = "Sem Informação";
          }
        } else {
          // Se não devolver nada, assumimos "Sem dados" ou implicitamente "Programado" se a API da IP falhar?
          // Vamos não incluir no mapa se falhar o fetch, para o frontend assumir default (offline/programado)
        }
      }),
    );

    // Pequena pausa para não matar a API
    await new Promise((r) => setTimeout(r, 100));
  }

  FUTURE_TRAINS_CACHE = results;
  console.log(
    `[FUTURE CHECK] Concluído. ${Object.keys(results).length} estados obtidos.`,
  );
};

// --- PROCESSAMENTO ---
const processTrain = async (richInfo, originDateStr) => {
  const trainId = String(richInfo.id);
  const now = Date.now();
  const nowObj = new Date();
  const direction = richInfo.direction;

  if (!TRAIN_MEMORY[trainId])
    TRAIN_MEMORY[trainId] = { history: {}, lastDelay: 0, nextWakeUp: 0 };
  const mem = TRAIN_MEMORY[trainId];

  if (now < mem.nextWakeUp && OUTPUT_CACHE[trainId])
    return OUTPUT_CACHE[trainId];

  // Encontrar Partida (Display)
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

  // Fetch IP
  const details = await fetchDetails(trainId, originDateStr);

  let isLive = false;
  let situacao = "Sem dados IP";
  let nodes = [];
  let duracao = "--:--";
  let operador = "FERTAGUS";
  let origemIp = "FERTAGUS";
  let destinoIp = "FERTAGUS";

  if (direction === "lisboa") {
    origemIp = richInfo.service === 0 ? "COINA" : "SETÚBAL";
    destinoIp = "ROMA-AREEIRO";
  } else {
    origemIp = "ROMA-AREEIRO";
    destinoIp = richInfo.service === 0 ? "COINA" : "SETÚBAL";
  }

  if (details) {
    situacao = details.SituacaoComboio || "";
    duracao = details.DuracaoViagem || "--:--";
    operador = details.Operador || operador;
    if (details.Origem) origemIp = details.Origem;
    if (details.Destino) destinoIp = details.Destino;

    if (
      details.NodesPassagemComboio &&
      details.NodesPassagemComboio.length > 0
    ) {
      nodes = details.NodesPassagemComboio;
      isLive = nodes.some((n) => n.ComboioPassou === true);
    }
  }

  // --- TURNAROUND LOGIC (PREVISÃO DE ARRASTAMENTO) ---
  let turnaroundDelay = 0;

  if (nodes.length === 0) {
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

  if (direction === "margem") {
    const scheduledRoma = departureTrip
      ? departureTrip.roma_areeiro
      : richInfo.roma_areeiro
        ? richInfo.roma_areeiro.substring(0, 5)
        : null;

    if (scheduledRoma) {
      const prediction = checkTurnaroundDelay(trainId, scheduledRoma, nowObj);

      if (prediction) {
        turnaroundDelay = prediction.delaySeconds;
        if (!isLive) {
          situacao = "Atraso Previsto (Turnaround)";
        }
      }
    }
  }

  if (isLive) {
    const lastNode = nodes[nodes.length - 1];
    let isFinished = false;
    if (lastNode && lastNode.ComboioPassou) {
      if (
        direction === "lisboa" &&
        lastNode.NomeEstacao.toUpperCase().includes("ROMA")
      )
        isFinished = true;
      if (
        direction === "margem" &&
        (lastNode.NomeEstacao.toUpperCase().includes("COINA") ||
          lastNode.NomeEstacao.toUpperCase().includes("SETÚBAL"))
      )
        isFinished = true;
    }
    if (isFinished) {
      delete TRAIN_MEMORY[trainId];
      return null;
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

  if (headerOrigem && headerOrigem.length > 5)
    headerOrigem = headerOrigem.substring(0, 5);
  if (headerDestino && headerDestino.length > 5)
    headerDestino = headerDestino.substring(0, 5);

  const trainOutput = {
    "id-comboio": trainId,
    DataHoraDestino: `${displayDate} ${headerDestino}`,
    DataHoraOrigem: `${displayDate} ${headerOrigem}`,
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

  let currentDelay = mem.lastDelay;

  if (turnaroundDelay > currentDelay) {
    currentDelay = turnaroundDelay;
    trainOutput.AtrasoCalculado = turnaroundDelay;
    if (turnaroundDelay > 60) isLive = true;
    trainOutput.Live = isLive;
  }

  let nextStationIndex = -1;

  nodes.forEach((node, idx) => {
    const passed = node.ComboioPassou;
    const stationKey = STATION_MAP_IP_TO_JSON[node.NomeEstacao.toUpperCase()];

    let horaChegadaProgStr = "00:00:00";
    if (stationKey && richInfo[stationKey]) {
      horaChegadaProgStr = richInfo[stationKey];
      if (horaChegadaProgStr.length === 5) horaChegadaProgStr += ":00";
    } else {
      horaChegadaProgStr =
        node.HoraProgramada.length === 5
          ? `${node.HoraProgramada}:30`
          : node.HoraProgramada;
    }

    let horaPartidaProgStr = null;
    if (stationKey && departureTrip && departureTrip[stationKey]) {
      horaPartidaProgStr = departureTrip[stationKey];
      if (horaPartidaProgStr.length === 5) horaPartidaProgStr += ":00";
    }
    if (!horaPartidaProgStr) horaPartidaProgStr = horaChegadaProgStr;

    const dateChegadaProg = parseSmartTime(horaChegadaProgStr, nowObj);
    const datePartidaProg = parseSmartTime(horaPartidaProgStr, nowObj);

    let horaRealStr = "HH:MM:SS";
    let atrasoNode = 0;

    if (passed) {
      let timestamp = mem.history[node.NodeID];
      if (!timestamp) {
        timestamp = Date.now();
        mem.history[node.NodeID] = timestamp;
      }
      const dr = new Date(timestamp);
      horaRealStr = formatTimeHHMMSS(dr);

      if (dateChegadaProg) {
        let diff = Math.floor((timestamp - dateChegadaProg.getTime()) / 1000);
        diff -= 15;
        atrasoNode = diff;
        currentDelay = diff;
      }
    } else {
      if (nextStationIndex === -1) nextStationIndex = idx;
    }

    let horaPrevistaFinal = horaPartidaProgStr;

    if (dateChegadaProg && datePartidaProg) {
      const estimativaChegadaMs =
        dateChegadaProg.getTime() + currentDelay * 1000;
      const partidaPublicaMs = datePartidaProg.getTime();

      if (estimativaChegadaMs > partidaPublicaMs) {
        const estimatedArrivalDate = new Date(estimativaChegadaMs);
        horaPrevistaFinal = formatTimeHHMMSS(estimatedArrivalDate);
      }
    }

    trainOutput.NodesPassagemComboio.push({
      ComboioPassou: passed,
      HoraProgramada: horaPartidaProgStr,
      HoraChegadaProgramada: horaChegadaProgStr,
      HoraReal: passed ? horaRealStr : "HH:MM:SS",
      AtrasoReal: passed ? atrasoNode : 0,
      HoraPrevista: passed ? horaRealStr : horaPrevistaFinal,
      EstacaoID: node.NodeID,
      NomeEstacao: node.NomeEstacao,
      Observacoes: node.Observacoes || "",
    });
  });

  trainOutput.AtrasoCalculado = currentDelay;
  mem.lastDelay = currentDelay;

  if (isLive && nextStationIndex !== -1) {
    const nextNode = trainOutput.NodesPassagemComboio[nextStationIndex];
    const nextDate = parseSmartTime(nextNode.HoraPrevista, nowObj);
    if (nextDate) {
      const wakeUp = nextDate.getTime() - 60000;
      if (wakeUp > now + 30000) mem.nextWakeUp = wakeUp;
      else mem.nextWakeUp = 0;
    }
  }

  return trainOutput;
};

// --- LOOP PRINCIPAL ---
const updateCycle = async () => {
  const now = new Date();
  // console.log(`[LOOP START] ${now.toLocaleTimeString()} - Filtro de Comboios...`);

  // Verificar se é hora de checkar comboios futuros (30 em 30 minutos. XX:00 ou XX:30)
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();

  if ((minutes === 0 || minutes === 30) && seconds < 35) {
    // Chamada sem await para não bloquear o ciclo principal
    checkOfflineTrains().catch((err) =>
      console.error("[FUTURE CHECK ERR]", err),
    );
  }

  const activeRichTrains = RICH_SCHEDULE.map((t) => {
    let startStr, endStr;
    if (t.direction === "lisboa") {
      startStr = t.setubal || t.coina;
      endStr = t.roma_areeiro;
    } else {
      startStr = t.roma_areeiro;
      endStr = t.setubal || t.coina;
    }

    if (!startStr || !endStr) return null;

    const start = parseSmartTime(startStr, now);
    const end = parseSmartTime(endStr, now);

    if (!start || !end) return null;

    const originDateStr = formatDateStr(start);
    return { ...t, startObj: start, endObj: end, originDateStr };
  }).filter((t) => {
    if (!t) return false;
    const windowStart = t.startObj.getTime() - 45 * 60000;
    const windowEnd = t.endObj.getTime() + 90 * 60000;
    return now.getTime() >= windowStart && now.getTime() <= windowEnd;
  });

  const newOutput = {};
  let count = 0;

  for (const t of activeRichTrains) {
    const result = await processTrain(t, t.originDateStr);
    if (result) {
      newOutput[result["id-comboio"]] = result;
      count++;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  OUTPUT_CACHE = {
    ...newOutput,
    futureTrains: FUTURE_TRAINS_CACHE, // Anexar cache de futuros ao output principal
  };

  console.log(`[LOOP END] ${count} comboios atualizados.`);
};

// --- TICKER ---
const scheduleNextTick = () => {
  const now = new Date();
  const s = now.getSeconds();
  const ms = now.getMilliseconds();
  let targetS = s < 30 ? 30 : 60;
  let delay = targetS * 1000 - (s * 1000 + ms) + 1000;
  setTimeout(() => {
    updateCycle();
    scheduleNextTick();
  }, delay);
};

app.get("/fertagus", (req, res) => res.json(OUTPUT_CACHE));
app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "API LiveTagus a Funcionar Corretamente na Azure",
    version: "3.0.2",
    timestamp: new Date().toISOString(),
  });
});
app.use((req, res) => {
  res.status(404).json({
    status: "error",
    code: 404,
    message: "Ups! Perdeste te? Vai para o nosso site https://livetagus.pt",
  });
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
  // Run initial future check on boot
  checkOfflineTrains();
  updateCycle();
  scheduleNextTick();
});

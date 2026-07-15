"use strict";
// routes.js — Todas as rotas Express + middlewares (protectRoute/adminAuth).
// Recebe um ctx com os managers/helpers e um getState() que devolve as caches
// ATUAIS do motor (elas são reatribuídas, por isso nunca se capturam por ref).
const express = require("express");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { API_KEY, ADMIN_API_KEY, ADMIN_ROUTE, GPS_AUTONOMOUS_MODE } = require("./config.js");

module.exports = function registerRoutes(app, ctx) {
  const {
    AvisosManager, EstacaoEndpoint, GtfsOutput, ServiceDayManager,
    AnalyticsManager, GhostManager, VerifyManager, GetLocation, MapAuthority,
    parseSmartTime, getOperationalInfo, formatDateStr, getState,
  } = ctx;
  const buildGpsLiveResponse = MapAuthority.buildGpsLiveResponse;

  // Estado reatribuível: refrescado a cada request. Seguro porque os handlers
  // lêem o estado de forma SÍNCRONA no topo (não há await entre isto e a leitura).
  let OUTPUT_CACHE, EXTRA_TRAINS_CACHE, FUTURE_TRAINS_CACHE,
    ABNORMAL_ROUTES_CACHE, RICH_SCHEDULE, DYNAMIC_EXTRA_SCHEDULE,
    SUPPRESSED_ACTIVE, IP_IS_DOWN;
  app.use((req, res, next) => {
    ({
      OUTPUT_CACHE, EXTRA_TRAINS_CACHE, FUTURE_TRAINS_CACHE,
      ABNORMAL_ROUTES_CACHE, RICH_SCHEDULE, DYNAMIC_EXTRA_SCHEDULE,
      SUPPRESSED_ACTIVE, IP_IS_DOWN,
    } = getState());
    next();
  });

  // --- MIDDLEWARE: API KEY ---
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

  // --- MIDDLEWARE: ADMIN ---
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
    version: "b6.2.5",
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
};

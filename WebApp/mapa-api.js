/*
 * mapa-api.js
 * Integração com a API livetagus (4.10) e fallback offline com base
 * nos JSONs de horários.
 */

(function () {
  "use strict";

  // ─── CACHES DE DADOS OFFLINE ─────────────────────────────────────────
  let schedLisboa = null;
  let schedMargem = null;
  let holidays = null;
  let changesCache = null;

  // ─── CHANGES MANAGER ─────────────────────────────────────────────────
  async function loadChanges() {
    if (changesCache !== null) return changesCache;
    try {
      const res = await fetch(MAPA.CHANGES_JSON + "?t=" + Date.now());
      if (!res.ok) throw new Error("HTTP " + res.status);
      changesCache = await res.json();
    } catch (e) {
      console.warn("[MapaApi] changes.json indisponível:", e.message);
      changesCache = { changes: [] };
    }
    return changesCache;
  }

  function getOperationalDateIso() {
    const d = new Date();
    if (d.getHours() < 5) d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  async function getActiveChange() {
    const data = await loadChanges();
    const todayStr = getOperationalDateIso();
    return (
      (data.changes || []).find((c) => {
        const [start, end] = c.targetDates || [];
        return start && end && todayStr >= start && todayStr <= end;
      }) || null
    );
  }

  // ─── HOLIDAYS / WEEKEND ──────────────────────────────────────────────
  async function loadHolidays() {
    if (holidays !== null) return holidays;
    try {
      const res = await fetch(MAPA.HOLIDAYS_JSON + "?t=" + Date.now());
      if (!res.ok) throw new Error("HTTP " + res.status);
      holidays = await res.json();
    } catch (e) {
      holidays = {};
    }
    return holidays;
  }

  function isWeekendOrHoliday(date) {
    const d = new Date(date);
    if (d.getHours() < 5) d.setDate(d.getDate() - 1);
    const day = d.getDay();
    if (day === 0 || day === 6) return true;
    if (holidays) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return !!holidays[`${y}-${m}-${dd}`];
    }
    return false;
  }

  // ─── LOAD DATA OFFLINE ───────────────────────────────────────────────
  async function loadOfflineData() {
    const tasks = [];
    if (!schedLisboa) {
      tasks.push(
        fetch(MAPA.LISBOA_JSON)
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            schedLisboa = j;
          })
          .catch((e) => console.warn("[MapaApi] Lisboa JSON:", e.message)),
      );
    }
    if (!schedMargem) {
      tasks.push(
        fetch(MAPA.MARGEM_JSON)
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            schedMargem = j;
          })
          .catch((e) => console.warn("[MapaApi] Margem JSON:", e.message)),
      );
    }
    tasks.push(loadHolidays());
    tasks.push(loadChanges());
    await Promise.all(tasks);
  }

  // ─── DIRECTION ─────────────────────────────────────────────────────────
  function inferDirection(train) {
    const nodes = train.nodes || train.NodesPassagemComboio || [];
    const firstName = (
      (nodes[0] && nodes[0].NomeEstacao) ||
      train.Origem ||
      train.origem ||
      ""
    ).toUpperCase();
    return /ROMA/.test(firstName) ? "margem" : "lisboa";
  }

  // ─── OFFLINE: SYNTHESIZE TRAINS ──────────────────────────────────────
  function buildOfflineTrains(opts = {}) {
    const allForToday = !!opts.allForToday;
    const trains = [];
    const now = new Date();
    const nowTs = now.getTime();
    const isSpecialDay = isWeekendOrHoliday(now);

    const sources = [
      {
        data: schedLisboa,
        direction: "lisboa",
        order: MAPA.STATION_ORDER.slice(),
      },
      {
        data: schedMargem,
        direction: "margem",
        order: MAPA.STATION_ORDER.slice().reverse(),
      },
    ];

    for (const src of sources) {
      if (!src.data || !src.data.trips) continue;
      for (const trip of src.data.trips) {
        const hType = parseInt(trip.horario, 10);
        if (hType === 0 && isSpecialDay) continue;
        if (hType === 2 && !isSpecialDay) continue;

        const stops = [];
        for (const key of src.order) {
          const timeStr = trip[key];
          if (!timeStr) continue;
          const station = MAPA.STATION_BY_KEY[key];
          if (!station) continue;
          const d = window.MapaGeo.parseTimeHHMMSS(timeStr + ":00", now);
          if (!d) continue;
          stops.push({
            station,
            timeStr: timeStr + ":00",
            ts: d.getTime(),
          });
        }
        if (stops.length < 2) continue;

        if (!allForToday) {
          const startTs = stops[0].ts - 3 * 60 * 1000;
          const endTs = stops[stops.length - 1].ts + 3 * 60 * 1000;
          if (nowTs < startTs || nowTs > endTs) continue;
        } else {
          // Só mantém comboios cuja chegada final ainda não passou há muito
          const lastTs = stops[stops.length - 1].ts;
          if (nowTs > lastTs + 5 * 60 * 1000) continue;
        }

        const nodes = stops.map((s) => ({
          ComboioPassou: nowTs >= s.ts,
          HoraProgramada: s.timeStr,
          HoraReal: nowTs >= s.ts ? s.timeStr : "HH:MM:SS",
          AtrasoReal: 0,
          HoraPrevista: s.timeStr,
          EstacaoID: s.station.apiId,
          NomeEstacao: s.station.apiName,
        }));

        const carriages = isSpecialDay ? 4 : trip.carruagens || 4;
        const occupancy = isSpecialDay ? null : trip.ocupacao;

        const origem = stops[0].station.name;
        const destino = stops[stops.length - 1].station.name;

        trains.push({
          id: String(trip.id),
          numero: String(trip.id),
          origem,
          destino,
          operador: "FERTAGUS",
          nodes,
          dotStatus: "gray",
          statusText: "Horário Programado",
          delayMin: 0,
          isLive: false,
          isSuppressed: false,
          isOffline: true,
          isExtra: false,
          carriages,
          occupancy,
          direction: src.direction,
        });
      }
    }
    return trains;
  }

  // ─── ONLINE: PROCESS API TRAIN ────────────────────────────────────
  function processApiTrain(apiTrain, activeChange, isSpecialDay, isExtraTrain) {
    const nodes = apiTrain.NodesPassagemComboio || [];
    if (nodes.length === 0) return null;

    const id = String(apiTrain["id-comboio"]);
    const suppressed =
      (apiTrain.SituacaoComboio || "").toUpperCase().includes("SUPRIMIDO") ||
      (activeChange &&
        activeChange.suppressed &&
        activeChange.suppressed.map(String).includes(id));
    const isPerturbacao = /poss.{0,2}vel perturba/i.test(
      apiTrain.SituacaoComboio || "",
    );

    let delayMin = 0;
    const firstFuture =
      nodes.find((n) => !n.ComboioPassou) || nodes[nodes.length - 1];
    if (firstFuture) {
      const prog = window.MapaGeo.parseTimeHHMMSS(firstFuture.HoraProgramada);
      const prev = window.MapaGeo.parseTimeHHMMSS(firstFuture.HoraPrevista);
      if (prog && prev) {
        delayMin = Math.floor((prev.getTime() - prog.getTime()) / 60000);
      }
    }

    let dotStatus = "green";
    let statusText = "A Horas";
    if (suppressed) {
      dotStatus = "red";
      statusText = "Suprimido";
    } else if (isPerturbacao) {
      dotStatus = "orange";
      statusText = "Possível Perturbação";
    } else if (delayMin > 0) {
      dotStatus = "yellow";
      statusText = `Atraso ${delayMin} min`;
    } else if (apiTrain.Live) {
      dotStatus = "green";
      statusText = "A Horas";
    } else {
      dotStatus = "green";
      statusText = "Programado";
    }

    const origemStation = MAPA.resolveStationByApiName(apiTrain.Origem);
    const destinoStation = MAPA.resolveStationByApiName(apiTrain.Destino);
    const origem = origemStation ? origemStation.name : apiTrain.Origem || "—";
    const destino = destinoStation
      ? destinoStation.name
      : apiTrain.Destino || "—";

    let carriages = 4;
    let occupancy = null;
    const dbTrip = findDbTrip(id);
    if (dbTrip && !isExtraTrain) {
      carriages = isSpecialDay ? 4 : dbTrip.carruagens || 4;
      occupancy = isSpecialDay ? null : dbTrip.ocupacao;
    }
    if (isSpecialDay) {
      carriages = 4;
      occupancy = null;
    }
    if (isExtraTrain) {
      occupancy = apiTrain.Ocupacao != null ? apiTrain.Ocupacao : null;
    }

    const direction = inferDirection({ nodes, Origem: apiTrain.Origem });

    return {
      id,
      numero: id,
      origem,
      destino,
      operador: apiTrain.Operador || "FERTAGUS",
      nodes,
      dotStatus,
      statusText,
      delayMin: Math.max(0, delayMin),
      isLive: !!apiTrain.Live,
      isSuppressed: suppressed,
      isOffline: false,
      isExtra: !!isExtraTrain,
      carriages,
      occupancy,
      direction,
      situacao: apiTrain.SituacaoComboio || "",
    };
  }

  function findDbTrip(id) {
    const sources = [schedLisboa, schedMargem];
    for (const src of sources) {
      if (!src || !src.trips) continue;
      const match = src.trips.find((t) => String(t.id) === String(id));
      if (match) return match;
    }
    return null;
  }

  // ─── PUBLIC: FETCH LIVE TRAINS ───────────────────────────────────────
  async function fetchLiveTrains() {
    await loadOfflineData();
    const activeChange = await getActiveChange();
    const isSpecialDay = isWeekendOrHoliday(new Date());

    try {
      const res = await fetch(MAPA.API_URL + "?t=" + Date.now(), {
        method: "GET",
        headers: {
          "x-api-key": MAPA.API_KEY,
          Accept: "application/json",
        },
        cache: "no-store",
      });

      if (res.status === 503) {
        return emptyResult({ apiDown: true, error: "API_DOWN_503" });
      }
      if (!res.ok) throw new Error("HTTP " + res.status);

      const data = await res.json();
      if (data && data.error === "IP_DOWN") {
        return emptyResult({ apiDown: true, error: "IP_DOWN" });
      }

      const futureTrains = data.futureTrains || {};
      const extrasMap = data.extratrains || {};

      // Comboios ativos = top-level com id-comboio (excluindo auxiliares)
      const activeApi = Object.values(data).filter(
        (v) =>
          v &&
          typeof v === "object" &&
          v["id-comboio"] &&
          Array.isArray(v.NodesPassagemComboio),
      );
      const extrasApi = Object.values(extrasMap).filter(
        (v) =>
          v &&
          typeof v === "object" &&
          v["id-comboio"] &&
          Array.isArray(v.NodesPassagemComboio),
      );

      const activeProcessed = activeApi
        .map((t) => processApiTrain(t, activeChange, isSpecialDay, false))
        .filter(Boolean);
      const extrasProcessed = extrasApi
        .map((t) => processApiTrain(t, activeChange, isSpecialDay, true))
        .filter(Boolean);

      // Extras já promovidos aparecem em activeApi — deduplicar
      const activeIds = new Set(activeProcessed.map((t) => t.id));
      const extrasDedup = extrasProcessed.filter((t) => !activeIds.has(t.id));

      const allTrains = [...activeProcessed, ...extrasDedup];

      // Mapa: apenas Live:true, sem suprimidos
      const trainsForMap = allTrains.filter(
        (t) => t.isLive === true && !t.isSuppressed,
      );

      // Listagens: ativos + extras + horário offline (dedupe por id)
      const offlineAll = buildOfflineTrains({ allForToday: true });
      const seen = new Set();
      const trainsForList = [];
      for (const t of [...allTrains, ...offlineAll]) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        trainsForList.push(t);
      }

      return {
        trainsForMap,
        trainsForList,
        futureTrains,
        apiDown: false,
        error: null,
      };
    } catch (e) {
      console.warn("[MapaApi] fetch falhou:", e.message);
      return emptyResult({ apiDown: false, error: e.message });
    }
  }

  function emptyResult(meta) {
    return {
      trainsForMap: [],
      trainsForList: buildOfflineTrains({ allForToday: true }),
      futureTrains: {},
      apiDown: !!meta.apiDown,
      error: meta.error || null,
    };
  }

  // ─── EXPORT ──────────────────────────────────────────────────────────
  window.MapaApi = {
    fetchLiveTrains,
    loadOfflineData,
    buildOfflineTrains,
    isWeekendOrHoliday,
    getActiveChange,
    _findDbTrip: findDbTrip,
    _processApiTrain: processApiTrain,
    _inferDirection: inferDirection,
  };
})();

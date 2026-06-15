/**
 * serviceDayManager.js
 * Gestor de DIAS DE SERVIÇO FUTUROS da LiveTagus API.
 *
 * v2 — FONTE DE VERDADE: IP (descoberta: a API da IP aceita janelas futuras!)
 * ─────────────────────────────────────────────────────────────────────────────
 * O warm-up das 04:00 varre o dia operacional completo de cada data futura na
 * estação de Corroios (StationPoller.pollFutureDay) e CRUZA a expectativa
 * local (horário base + feriados) com a realidade da IP:
 *
 *   • Programado  — está no horário base E veio na resposta da IP sem flag.
 *   • Suprimido¹  — deveria circular mas NÃO veio na resposta da IP.
 *   • Suprimido²  — veio na IP mas com Observacoes contendo "SUPRIMIDO".
 *   • Extra       — veio na IP mas NÃO existe no horário base local.
 *
 * O changes.json (verify.js) NÃO desaparece: é a ÚLTIMA CAMADA DE
 * SOBREPOSIÇÃO (overlay) aplicada DEPOIS do cruzamento — força supressões
 * quando a IP é lenta a refletir greves anunciadas, e é a única fonte dos
 * abnormal_routes (Corroios não chega para saber se o terminus foi cortado).
 *
 * FAIL-SAFE: se o pollFutureDay falhar (IP em baixo / cobertura incompleta),
 * o dia é construído pelo método antigo 100% ESTÁTICO — nunca um 500.
 *
 * OBJETIVO
 * ─────────────────────────────────────────────────────────────────────────────
 * Pré-calcular, validar e cachear a grelha operacional PREVISTA para os
 * próximos 7 dias (rolling window), aliviando o processamento em tempo real.
 * Serve o endpoint público:  GET /v2/fertagus/service-day/:date  (YYYY-MM-DD)
 *
 * ARQUITETURA
 * ─────────────────────────────────────────────────────────────────────────────
 *  • CRON DIÁRIO ÀS 04:00 — timer nativo (setTimeout recursivo, imune a drift
 *    e a mudanças de hora): recalcula D+1..D+7. O DIA CORRENTE é EXCLUÍDO do
 *    warm-up: o motor live (updateCycle/checkOfflineTrains/FUTURE_TRAINS_CACHE)
 *    continua a ser a única fonte dinâmica de hoje — este módulo é apenas a
 *    fundação estática preditiva dos dias seguintes.
 *  • CACHE EM MEMÓRIA + PERSISTÊNCIA em service-days.json (write atómico
 *    tmp+rename) → resiliente a reboots/PM2 restarts.
 *  • FAIL-SAFE: se o warm-up falhar (JSON corrompido, exceção), o endpoint
 *    recalcula o dia ON-THE-FLY dentro de try/catch. Só em último caso (até o
 *    recálculo falhar) devolve o fallback mínimo — NUNCA um 500.
 *
 * FONTES CRUZADAS POR DIA
 * ─────────────────────────────────────────────────────────────────────────────
 *  • feriados.json + dia da semana  → isWeekendOrHoliday → grelha base
 *    (horario: 1 = todos os dias | 0 = úteis | 2 = FDS/feriado).
 *  • verify.js (changes.json)       → supressões à cabeça ("Suprimido"),
 *    substituições, extras programados e abnormal_routes declarados.
 *
 * ESTADOS PERMITIDOS no future_train_array (contrato v2):
 *   "Programado" | "Realizado" | "Suprimido"
 *   (Nota: capitalização "Suprimido" é a do contrato v2; distinta do
 *    "SUPRIMIDO" interno da pipeline live — conversão feita aqui.)
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ─── CONSTANTES ──────────────────────────────────────────────────────────────

const WINDOW_DAYS = 7; // D+1 .. D+7
const CRON_HOUR = 1; // hora do warm-up diário
const PERSIST_FILE = "service-days.json";
const DAY_COOLDOWN_MS = 2000; // pausa entre dias no warm-up (anti-rajada IP)

// ─── REFERÊNCIAS INJETADAS ───────────────────────────────────────────────────

let _getRichSchedule = () => []; // () => RICH_SCHEDULE
let _getHolidays = () => ({}); // () => HOLIDAYS (feriados.json em memória)
let _Verify = null; // verify.js
let _StationPoller = null; // station-poller.js (pollFutureDay)
let _getLiveState = null; // () => snapshot do Motor Live (caches de hoje)
let _ExtrasHelpers = null; // extras-helpers.js (detectAbnormalFromTerminus)
let _stationMapIpToJson = {}; // "SETÚBAL" → "setubal" (deteção por terminus)
let _stopIdByKey = {}; // "campolide" → "11060004" (stop_ids GTFS)
let _stationMapJsonToIp = {}; // p/ nomes legíveis nos abnormal_routes

// ─── ESTADO ──────────────────────────────────────────────────────────────────

// { [dateStr]: payload }  — payload exatamente como sai no endpoint (CASO A)
let DAY_CACHE = {};
let cronTimer = null;
let persistPath = null;

// ─── HELPERS DE DATA ─────────────────────────────────────────────────────────

const pad2 = (n) => String(n).padStart(2, "0");
const fmtDate = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Valida "YYYY-MM-DD" E que a data existe no calendário (ex: 2026-02-30 ✗). */
const isValidDateStr = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
  );
};

const dateFromStr = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setHours(12, 0, 0, 0); // meio-dia: imune a DST nos cálculos de +1 dia
  return dt;
};

/** Hoje em termos de DIA OPERACIONAL (05h–02h30): antes das 05h ainda é ontem. */
const operationalToday = (now = new Date()) => {
  const d = new Date(now);
  if (d.getHours() < 5) d.setDate(d.getDate() - 1);
  d.setHours(12, 0, 0, 0);
  return d;
};

/** Feriado oficial OU sábado/domingo (cálculo barato — usado em todos os casos). */
const computeIsWeekendOrHoliday = (dateStr) => {
  const HOLIDAYS = _getHolidays() || {};
  if (HOLIDAYS[dateStr]) return true;
  const dow = dateFromStr(dateStr).getDay();
  return dow === 0 || dow === 6;
};

// ─── EXTRAÇÃO DE ALTERAÇÕES FILTRADA POR DATA-ALVO ───────────────────────────
// Fonte primária: verify.js (getChangesForDate já aceita a dateStr exata).
// Fallback: leitura DIRETA do changes.json com a mesma semântica de range —
// garante que a previsão dos 7 dias é 100% local/estática mesmo que o
// VerifyManager não esteja injetado ou rebente.

const _dateInRange = (dateStr, targetDates) => {
  if (!Array.isArray(targetDates) || targetDates.length === 0) return false;
  if (targetDates.length === 1) return targetDates[0] === dateStr;
  return (
    dateStr >= targetDates[0] && dateStr <= targetDates[targetDates.length - 1]
  );
};

/** Lê o changes.json do disco e filtra os blocos pela data-alvo do loop. */
const readChangesDirect = (dateStr) => {
  const result = {
    suppressed: new Set(),
    replacements: {},
    extras: [],
    abnormal: {},
  };
  try {
    const p = path.join(
      persistPath ? path.dirname(persistPath) : __dirname,
      "changes.json",
    );
    if (!fs.existsSync(p)) return result;
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    const blocks = Array.isArray(data.changes) ? data.changes : [];

    for (const block of blocks) {
      // INJEÇÃO DE DATA-ALVO: só blocos cujo range cobre a dateStr em análise.
      if (!_dateInRange(dateStr, block.targetDates)) continue;

      if (Array.isArray(block.suppressed)) {
        block.suppressed.forEach((id) => result.suppressed.add(String(id)));
      }
      if (block.replacements && typeof block.replacements === "object") {
        for (const [o, n] of Object.entries(block.replacements)) {
          result.replacements[String(o)] = String(n);
        }
      }
      if (Array.isArray(block.extras)) {
        block.extras.forEach((e) => result.extras.push(e));
      }
      if (block.abnormal && typeof block.abnormal === "object") {
        for (const [id, sts] of Object.entries(block.abnormal)) {
          if (Array.isArray(sts)) result.abnormal[String(id)] = sts.map(String);
        }
      }
    }
  } catch (e) {
    console.error(
      `[SERVICE-DAY] changes.json ilegível no fallback direto (${dateStr}):`,
      e.message,
    );
  }
  return result;
};

/** Alterações para a data-alvo: verify.js primeiro, leitura direta depois. */
const getChangesFor = (dateStr) => {
  if (_Verify && typeof _Verify.getChangesForDate === "function") {
    try {
      return _Verify.getChangesForDate(dateStr);
    } catch (e) {
      console.error(
        `[SERVICE-DAY] verify.getChangesForDate falhou (${dateStr}) — fallback direto:`,
        e.message,
      );
    }
  }
  return readChangesDirect(dateStr);
};

// ─── OVERLAY DO changes.json (última camada de sobreposição) ─────────────────

/**
 * Aplica as regras manuais do changes.json POR CIMA da grelha já construída
 * (estática ou cruzada com a IP). É a camada final: permite forçar supressões
 * quando a IP é lenta a refletir greves anunciadas, e é a fonte ÚNICA dos
 * abnormal_routes (o poll a Corroios não revela cortes de terminus).
 * MUTA `acc` ({ future_train_array, extra_trains, extra_trains_details }).
 */
const applyChangesOverlay = (dateStr, acc, richById) => {
  const changes = getChangesFor(dateStr);
  const { future_train_array, extra_trains, extra_trains_details } = acc;

  // SUPRESSÕES manuais: prevalecem SEMPRE sobre o que a IP disse.
  for (const id of changes.suppressed) {
    if (future_train_array[id] !== undefined)
      future_train_array[id] = "Suprimido";
  }

  // SUBSTITUIÇÕES: original "Suprimido"; novo ID circula. Se o cruzamento
  // com a IP já tinha apanhado o novo ID como "extra", retiramo-lo da lista
  // de extras — é uma substituição declarada, não um reforço.
  for (const [origId, newId] of Object.entries(changes.replacements)) {
    if (future_train_array[origId] !== undefined)
      future_train_array[origId] = "Suprimido";
    future_train_array[String(newId)] = "Programado";
    const i = extra_trains.indexOf(String(newId));
    if (i !== -1) {
      extra_trains.splice(i, 1);
      delete extra_trains_details[String(newId)];
    }
  }

  // EXTRAS manuais: adiciona/enriquece (a IP pode ainda não os listar).
  for (const e of changes.extras) {
    if (!e || !e.id) continue;
    const id = String(e.id);
    future_train_array[id] = "Programado";
    if (!extra_trains.includes(id)) extra_trains.push(id);
    extra_trains_details[id] = {
      ...(extra_trains_details[id] || {}),
      origin: e.origin || extra_trains_details[id]?.origin || null,
      departure: e.departure || extra_trains_details[id]?.departure || null,
      direction:
        String(e.origin || "").toLowerCase() === "roma_areeiro"
          ? "margem"
          : extra_trains_details[id]?.direction || "lisboa",
      expectedRoute: Array.isArray(e.expectedRoute) ? e.expectedRoute : null,
      source: "changes.json",
    };
  }

  // ABNORMAL ROUTES: MERGE entre os já presentes em `acc` (vindos do Motor
  // Live de hoje, ou vazios nos dias futuros) e os DECLARADOS no changes.json.
  // O changes.json prevalece (substitui a entrada do mesmo id). Regras:
  //   • só comboios que circulam nesse dia (não "Suprimido"/ausentes);
  //   • horas das estações saltadas vêm do horário base.
  const circulates = (id) => {
    const s = future_train_array[String(id)];
    return s !== undefined && s !== "Suprimido";
  };
  const declaredIds = new Set(Object.keys(changes.abnormal).map(String));
  const abnormal_routes = (acc.abnormal_routes || []).filter(
    (a) => a && circulates(a.id) && !declaredIds.has(String(a.id)),
  );
  for (const [id, stations] of Object.entries(changes.abnormal)) {
    if (!circulates(id)) continue;
    const rich = richById.get(String(id));
    abnormal_routes.push({
      id: String(id),
      skipped: stations.map((key) => ({
        key,
        nome: _stationMapJsonToIp[key] || key,
        hora:
          rich && rich[key] != null ? String(rich[key]).substring(0, 5) : null,
      })),
      source: "changes.json",
    });
  }

  acc.abnormal_routes = abnormal_routes;
  acc.replacements = { ...changes.replacements };
  return acc;
};

// ─── CONSTRUÇÃO DO PAYLOAD DE UM DIA ─────────────────────────────────────────

/** IDs do horário base que DEVERIAM circular nesse dia (expectativa local). */
const expectedBaseIds = (isWeekendOrHoliday) => {
  const ids = new Set();
  for (const t of _getRichSchedule()) {
    const hType = parseInt(t.horario);
    const runs =
      hType === 1 ||
      (isWeekendOrHoliday && hType === 2) ||
      (!isWeekendOrHoliday && hType === 0);
    if (runs) ids.add(String(t.id));
  }
  return ids;
};

/**
 * [FALLBACK ESTÁTICO] Método antigo, 100% local e síncrono: horário base +
 * feriados + changes.json. Usado quando a IP está em baixo / cobertura
 * incompleta, e no recálculo on-the-fly do endpoint (não disparamos 11
 * pedidos à IP por causa de um GET de um cliente).
 */
const buildDayPayloadStatic = (dateStr, verifiedAtMs = Date.now()) => {
  if (_ipBlocked) return buildDayPayloadStatic(dateStr, nowMs);
  const isWeekendOrHoliday = computeIsWeekendOrHoliday(dateStr);
  const richById = new Map();
  for (const t of _getRichSchedule()) richById.set(String(t.id), t);

  const future_train_array = {};
  for (const id of expectedBaseIds(isWeekendOrHoliday)) {
    future_train_array[id] = "Programado";
  }

  const acc = applyChangesOverlay(
    dateStr,
    { future_train_array, extra_trains: [], extra_trains_details: {} },
    richById,
  );

  return {
    date: dateStr,
    verified: true,
    last_verified: verifiedAtMs,
    isWeekendOrHoliday,
    source: "static_fallback", // grelha construída SEM confirmação da IP
    ip_polled: false,
    abnormal_routes: acc.abnormal_routes,
    extra_trains: acc.extra_trains,
    extra_trains_details: acc.extra_trains_details,
    replacements: acc.replacements,
    future_train_array: acc.future_train_array,
  };
};

/**
 * [v2 — ASSÍNCRONO] Constrói o dia cruzando a EXPECTATIVA LOCAL (horário base
 * filtrado por feriados.json) com a REALIDADE DA IP (pollFutureDay a Corroios).
 *
 * MOTOR DE CRUZAMENTO AUTOMÁTICO:
 *   • Programado   — no horário base E na resposta da IP (sem "SUPRIMIDO").
 *   • Suprimido ¹  — no horário base mas AUSENTE da resposta da IP
 *                    (a IP retirou-o do sistema: obras/greve).
 *   • Suprimido ²  — veio da IP com Observacoes a conter "SUPRIMIDO".
 *   • Extra        — veio da IP mas NÃO existe no horário base local
 *                    → "Programado" + injetado em extra_trains.
 *
 * Depois do cruzamento aplica-se o overlay do changes.json (ver acima).
 * Se o poll falhar → fallback estático elegante (nunca propaga o erro).
 */
const buildDayPayload = async (dateStr, verifiedAtMs = Date.now()) => {
  const isWeekendOrHoliday = computeIsWeekendOrHoliday(dateStr);

  // 1) EXPECTATIVA LOCAL — o que o horário base diz que devia circular.
  const expected = expectedBaseIds(isWeekendOrHoliday);
  const richById = new Map();
  for (const t of _getRichSchedule()) richById.set(String(t.id), t);

  // 2) REALIDADE DA IP — varrimento do dia operacional completo em Corroios.
  let ipMap;
  try {
    if (!_StationPoller || typeof _StationPoller.pollFutureDay !== "function") {
      throw new Error("StationPoller.pollFutureDay indisponível");
    }
    ipMap = await _StationPoller.pollFutureDay(dateStr);
    if (!(ipMap instanceof Map) || ipMap.size === 0) {
      // Dia inteiro sem um único comboio Fertagus é implausível — tratar
      // como falha (evita marcar a grelha toda como Suprimido por engano).
      throw new Error("poll devolveu 0 comboios — resposta implausível");
    }
  } catch (e) {
    console.warn(
      `[SERVICE-DAY] pollFutureDay(${dateStr}) falhou (${e.message}) — fallback estático.`,
    );
    return buildDayPayloadStatic(dateStr, verifiedAtMs);
  }

  // 3) MOTOR DE CRUZAMENTO.
  const future_train_array = {};
  const extra_trains = [];
  const extra_trains_details = {};

  for (const id of expected) {
    const entry = ipMap.get(id);
    if (!entry) {
      // Suprimido¹: a IP removeu-o do sistema para este dia.
      future_train_array[id] = "Suprimido";
    } else if (/SUPRIMIDO/i.test(entry.observacoes || "")) {
      // Suprimido²: a IP lista-o explicitamente como suprimido.
      future_train_array[id] = "Suprimido";
    } else {
      future_train_array[id] = "Programado";
    }
  }

  for (const [id, entry] of ipMap) {
    if (expected.has(id)) continue; // já cruzado acima

    if (/SUPRIMIDO/i.test(entry.observacoes || "")) {
      // Extra que a própria IP já suprimiu: regista-se o estado, mas não
      // entra na lista de extras (o utilizador nunca o esperou).
      future_train_array[id] = "Suprimido";
      continue;
    }

    // Extra automático: existe na IP, não existe no horário base.
    future_train_array[id] = "Programado";
    extra_trains.push(id);
    extra_trains_details[id] = {
      origin: entry.origem || null,
      destination: entry.destino || null,
      departure: entry.scheduledTime || null, // hora de passagem em Corroios
      direction: entry.direction || "lisboa",
      expectedRoute: null,
      source: "ip_discovery",
    };
  }

  // 3b) [PARIDADE COM HOJE] ABNORMAL ROUTES por TERMINUS: o poll a Corroios
  //     traz a origem/destino REAIS de cada comboio futuro — exatamente a
  //     mesma inferência que o checkOfflineTrains faz para hoje
  //     (detectAbnormalFromTerminus). Apanha percursos cortados nos extremos
  //     (ex: SETÚBAL→PRAGAL em vez de SETÚBAL→ROMA) dias antes de circular.
  //     Estações intermédias saltadas continuam a vir só do changes.json.
  const abnormal_routes = [];
  if (_ExtrasHelpers && Object.keys(_stationMapIpToJson).length > 0) {
    for (const id of expected) {
      if (future_train_array[id] !== "Programado") continue;
      const entry = ipMap.get(id);
      const rich = richById.get(id);
      if (!entry || !rich) continue;

      try {
        const abn = _ExtrasHelpers.detectAbnormalFromTerminus(
          rich,
          entry.origem,
          entry.destino,
          _stationMapIpToJson,
          _stationMapJsonToIp,
        );
        if (abn.isAbnormal) {
          abnormal_routes.push({
            id: String(id),
            skipped: abn.skipped, // já vem com {key, nome, hora}
            source: "ip_terminus",
          });
        }
      } catch (e) {
        // Deteção é best-effort: nunca derruba a construção do dia.
        console.warn(
          `[SERVICE-DAY] detectAbnormalFromTerminus(${id}/${dateStr}) falhou:`,
          e.message,
        );
      }
    }
  }

  // 4) OVERLAY changes.json — última palavra (supressões manuais, extras
  //    manuais, substituições e abnormal_routes declarados; faz MERGE com os
  //    detetados por terminus acima — declarado substitui o mesmo id).
  const acc = applyChangesOverlay(
    dateStr,
    { future_train_array, extra_trains, extra_trains_details, abnormal_routes },
    richById,
  );

  return {
    date: dateStr,
    verified: true,
    last_verified: verifiedAtMs,
    isWeekendOrHoliday,
    source: "ip_crossref", // grelha CONFIRMADA pela IP
    ip_polled: true,
    abnormal_routes: acc.abnormal_routes,
    extra_trains: acc.extra_trains,
    extra_trains_details: acc.extra_trains_details,
    replacements: acc.replacements,
    future_train_array: acc.future_train_array,
  };
};

// ─── DIA DE HOJE: FUSÃO COM O MOTOR LIVE ─────────────────────────────────────

/**
 * Constrói a grelha de HOJE fundindo três camadas, por esta ordem:
 *
 *   1. HORÁRIO BASE      → todos os IDs esperados como "Programado".
 *   2. MOTOR LIVE        → estado dinâmico REAL já descoberto pelo index.js:
 *        • FUTURE_TRAINS_CACHE  → "SUPRIMIDO"→Suprimido, "Realizado"→Realizado
 *        • EXTRA_TRAINS_CACHE / DYNAMIC_EXTRA_SCHEDULE → extras descobertos
 *          pelo station-poller dinâmico (entram como extras + Programado)
 *        • ABNORMAL_ROUTES_CACHE → desvios detetados em tempo real pela IP
 *        • OUTPUT_CACHE (não-reservados) → comboios a circular AGORA
 *   3. changes.json      → overlay manual, prevalece SEMPRE (greves
 *      anunciadas que a IP/live ainda não refletem).
 *
 * 100% leitura de memória (zero rede) → performance de cache hit; o snapshot
 * vem por getter injetado (getLiveState) para apanhar sempre as referências
 * atuais (FUTURE_TRAINS_CACHE é reassigned no checkOfflineTrains).
 */
const buildTodayPayload = (dateStr, verifiedAtMs = Date.now()) => {
  if (!_getLiveState) {
    // Sem ligação ao Motor Live (testes/standalone) → estático honesto.
    return buildDayPayloadStatic(dateStr, verifiedAtMs);
  }

  const live = _getLiveState() || {};
  const FUTURE = live.FUTURE_TRAINS_CACHE || {};
  const OUTPUT = live.OUTPUT_CACHE || {};
  const EXTRAS = live.EXTRA_TRAINS_CACHE || {};
  const DYN = live.DYNAMIC_EXTRA_SCHEDULE || {};
  const ABNORMAL = live.ABNORMAL_ROUTES_CACHE || {};

  const RESERVED = new Set(["futureTrains", "extratrains", "abnormalRoutes"]);
  const isWeekendOrHoliday = computeIsWeekendOrHoliday(dateStr);
  const richById = new Map();
  for (const t of _getRichSchedule()) richById.set(String(t.id), t);

  // 1) BASE — expectativa local.
  const baseIds = expectedBaseIds(isWeekendOrHoliday);
  const future_train_array = {};
  for (const id of baseIds) future_train_array[id] = "Programado";

  // 2a) ESTADOS do Motor Live (contrato v2: Programado/Realizado/Suprimido).
  for (const [id, estado] of Object.entries(FUTURE)) {
    if (RESERVED.has(id)) continue;
    if (/SUPRIMIDO/i.test(String(estado))) {
      future_train_array[id] = "Suprimido";
    } else if (estado === "Realizado") {
      future_train_array[id] = "Realizado";
    } else if (future_train_array[id] === undefined) {
      // ID que o live conhece mas não está no base (substituições efémeras).
      future_train_array[id] = "Programado";
    }
  }

  // 2b) COMBOIOS A CIRCULAR AGORA → Programado + lista informativa live_now.
  const live_now = [];
  for (const id of Object.keys(OUTPUT)) {
    if (RESERVED.has(id)) continue;
    live_now.push(id);
    if (future_train_array[id] !== "Realizado") {
      future_train_array[id] = "Programado";
    }
  }

  // 2c) EXTRAS dinâmicos descobertos pelo live (pré-live e promovidos).
  const extra_trains = [];
  const extra_trains_details = {};
  const dynIds = new Set([...Object.keys(EXTRAS), ...Object.keys(DYN)]);
  for (const id of dynIds) {
    if (baseIds.has(id)) continue; // pertence ao horário base, não é extra
    if (future_train_array[id] === "Suprimido") continue;

    if (future_train_array[id] === undefined) {
      future_train_array[id] = "Programado";
    }
    extra_trains.push(id);

    // Horário simplificado a partir do richInfo sintético do live.
    const rich = DYN[id];
    let origin = null;
    let departure = null;
    if (rich) {
      const order =
        rich.direction === "margem"
          ? [...STATION_ORDER_KEYS].reverse()
          : STATION_ORDER_KEYS;
      for (const key of order) {
        if (rich[key]) {
          origin = key;
          departure = String(rich[key]).substring(0, 5);
          break;
        }
      }
    }
    extra_trains_details[id] = {
      origin,
      departure,
      direction: rich ? rich.direction : null,
      expectedRoute: null,
      source: "live_discovery",
    };
  }

  // 2d) ABNORMAL ROUTES em tempo real (skipped já vem com key/nome/hora).
  const abnormal_routes = [];
  for (const [id, info] of Object.entries(ABNORMAL)) {
    const state = future_train_array[String(id)];
    if (state === undefined || state === "Suprimido") continue;
    abnormal_routes.push({
      id: String(id),
      skipped: (info && info.skipped) || [],
      source: "live_engine",
    });
  }

  // 3) OVERLAY manual — última palavra (faz MERGE dos abnormal_routes).
  const acc = applyChangesOverlay(
    dateStr,
    { future_train_array, extra_trains, extra_trains_details, abnormal_routes },
    richById,
  );

  return {
    date: dateStr,
    verified: true,
    last_verified: verifiedAtMs,
    isWeekendOrHoliday,
    source: "live_engine", // fusão base + estado dinâmico real do index.js
    ip_polled: true,
    live_now,
    abnormal_routes: acc.abnormal_routes,
    extra_trains: acc.extra_trains,
    extra_trains_details: acc.extra_trains_details,
    replacements: acc.replacements,
    future_train_array: acc.future_train_array,
  };
};

// Micro-memo de hoje (15 s): a app faz refresh agressivo; a fusão é barata
// mas não precisa de correr mais do que o ciclo do próprio motor live.
let TODAY_MEMO = { dateStr: null, ts: 0, body: null };
const TODAY_MEMO_TTL_MS = 15000;

// Ordem física da linha (para inferir origem/partida dos extras dinâmicos).
const STATION_ORDER_KEYS = [
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

// ─── PERSISTÊNCIA (resiliência a reboots) ────────────────────────────────────

const persist = () => {
  if (!persistPath) return;
  try {
    const tmp = `${persistPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(DAY_CACHE, null, 2), "utf8");
    fs.renameSync(tmp, persistPath); // write atómico
  } catch (e) {
    console.error("[SERVICE-DAY] Falha a persistir cache:", e.message);
  }
};

const restore = () => {
  if (!persistPath || !fs.existsSync(persistPath)) return;
  try {
    const raw = fs.readFileSync(persistPath, "utf8");
    const data = raw.trim() === "" ? {} : JSON.parse(raw);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      DAY_CACHE = data;
      console.log(
        `[SERVICE-DAY] Cache restaurada do disco: ${Object.keys(DAY_CACHE).length} dia(s).`,
      );
    }
  } catch (e) {
    // Ficheiro corrompido → ignora; o próximo warm-up (ou o fail-safe
    // on-the-fly do endpoint) reconstrói tudo.
    console.error(
      "[SERVICE-DAY] service-days.json corrompido — ignorado:",
      e.message,
    );
    DAY_CACHE = {};
  }
};

// ─── WARM-UP (tarefa das 04:00) ──────────────────────────────────────────────

/**
 * Recalcula D+1..D+7. Cada dia é isolado em try/catch: a corrupção de um
 * bloco do changes.json não derruba os restantes dias nem a tarefa.
 */
const warmUp = async (now = new Date()) => {
  const startedMs = Date.now();
  const today = operationalToday(now);
  const next = {};
  let ok = 0;
  let failed = 0;

  // SEQUENCIAL (for...of + await): cada dia faz ~11 pedidos à IP; processar
  // em paralelo seriam ~80 pedidos de rajada → risco de bloqueio na firewall.
  for (let i = 1; i <= WINDOW_DAYS; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateStr = fmtDate(d);

    try {
      // buildDayPayload já tem fallback estático interno se a IP falhar —
      // este try/catch só apanha corrupção de fontes locais.
      next[dateStr] = await buildDayPayload(dateStr, startedMs);
      ok++;
    } catch (e) {
      failed++;
      console.error(`[SERVICE-DAY] Warm-up falhou para ${dateStr}:`, e.message);
      // Mantém a versão anterior do dia se existir (stale > nada).
      if (DAY_CACHE[dateStr]) next[dateStr] = DAY_CACHE[dateStr];
    }

    // COOLDOWN entre dias (anti-rajada na IP).
    if (i < WINDOW_DAYS) {
      await new Promise((r) => setTimeout(r, DAY_COOLDOWN_MS));
    }
  }

  DAY_CACHE = next; // substituição atómica (dias fora da janela caem = GC)
  persist();

  const viaIp = Object.values(next).filter((p) => p.ip_polled).length;
  console.log(
    `[SERVICE-DAY] Warm-up concluído às ${new Date().toLocaleTimeString("pt-PT")}: ` +
      `${ok} dia(s) ok (${viaIp} via IP, ${ok - viaIp} estáticos), ${failed} falha(s).`,
  );
};

/** Agenda a próxima execução às 04:00 (recursivo — sem drift acumulado). */
const scheduleCron = () => {
  const now = new Date();
  const next = new Date(now);
  next.setHours(CRON_HOUR, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);

  const delay = next.getTime() - now.getTime();
  if (cronTimer) clearTimeout(cronTimer); // init repetido não duplica timers
  cronTimer = setTimeout(async () => {
    try {
      await warmUp();
    } catch (e) {
      // Nunca deixar o cron morrer: o endpoint tem fail-safe on-the-fly.
      console.error("[SERVICE-DAY] Warm-up das 04:00 rebentou:", e.message);
    }
    scheduleCron();
  }, delay);
  // O timer não deve impedir o processo de terminar (graceful shutdown/PM2).
  if (cronTimer.unref) cronTimer.unref();

  console.log(
    `[SERVICE-DAY] Próximo warm-up agendado para ${next.toLocaleString("pt-PT")}.`,
  );
};

// ─── INIT ────────────────────────────────────────────────────────────────────

/**
 * @param {object} ctx {
 *   getRichSchedule:      () => RICH_SCHEDULE,
 *   getHolidays:          () => HOLIDAYS,
 *   VerifyManager:        require("./verify.js"),
 *   STATION_MAP_JSON_TO_IP: { setubal:"SETÚBAL", ... },
 *   dir:                  __dirname (para o ficheiro de persistência)
 * }
 */
const init = (ctx) => {
  _getRichSchedule = ctx.getRichSchedule || _getRichSchedule;
  _getHolidays = ctx.getHolidays || _getHolidays;
  _Verify = ctx.VerifyManager || null;
  _StationPoller = ctx.StationPoller || null;
  _getLiveState = ctx.getLiveState || null;
  _ExtrasHelpers = ctx.ExtrasHelpers || null;
  _stationMapIpToJson = ctx.STATION_MAP_IP_TO_JSON || {};
  // stop_ids GTFS a partir do ft_stations_detailed.json (key normalizada → id)
  _stopIdByKey = {};
  for (const s of ctx.stationsDetailed || []) {
    const key = String(s.n || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    _stopIdByKey[key] = String(s.id);
  }
  TODAY_MEMO = { dateStr: null, ts: 0, body: null }; // init limpa o memo
  _stationMapJsonToIp = ctx.STATION_MAP_JSON_TO_IP || {};
  persistPath = path.join(ctx.dir || __dirname, PERSIST_FILE);

  restore(); // resiliência a reboot
  // Aquecimento imediato no boot (fire-and-forget: não bloqueia o arranque
  // do servidor — mesma filosofia do checkOfflineTrains no index.js).
  warmUp().catch((e) =>
    console.error("[SERVICE-DAY] Warm-up de boot falhou:", e.message),
  );
  scheduleCron(); // e agenda o ciclo diário

  return module.exports;
};

const stop = () => {
  if (cronTimer) clearTimeout(cronTimer);
  cronTimer = null;
};

// ─── FORMATO GTFS-RT (FeedMessage) ───────────────────────────────────────────

/**
 * Converte o payload interno num FeedMessage GTFS-RT (JSON), uniforme para
 * hoje e dias futuros. Mapeamento de estados → TripDescriptor:
 *   "Programado"/"Realizado" → SCHEDULED | "Suprimido" → CANCELED
 *   extras (ip_discovery/live/changes) → ADDED
 * Trajetos anormais → stop_time_update com schedule_relationship: SKIPPED.
 * O payload interno completo segue no campo de extensão `service_day`
 * (extensões são permitidas pelo standard; é a ponte de transição da app —
 * o /fertagus legado fica 100% intocado).
 */
const toGtfsRtFeed = (payload) => {
  const startDate = String(payload.date || "").replace(/-/g, ""); // YYYYMMDD
  const tsMs =
    typeof payload.last_verified === "number"
      ? payload.last_verified
      : Date.now();

  const extras = new Set(payload.extra_trains || []);
  const abnormalById = {};
  for (const a of payload.abnormal_routes || []) {
    abnormalById[String(a.id)] = a;
  }

  const entity = [];
  for (const [id, estado] of Object.entries(payload.future_train_array || {})) {
    const schedule_relationship =
      estado === "Suprimido"
        ? "CANCELED"
        : extras.has(id)
          ? "ADDED"
          : "SCHEDULED";

    const trip_update = {
      trip: {
        trip_id: String(id),
        start_date: startDate,
        schedule_relationship,
      },
    };

    // Estações saltadas → StopTimeUpdate SKIPPED (stop_id GTFS quando mapeado).
    const abn = abnormalById[String(id)];
    if (abn && Array.isArray(abn.skipped) && abn.skipped.length > 0) {
      trip_update.stop_time_update = abn.skipped.map((s) => ({
        stop_id: _stopIdByKey[s.key] || s.key,
        schedule_relationship: "SKIPPED",
      }));
    }

    entity.push({ id: String(id), trip_update });
  }

  return {
    header: {
      gtfs_realtime_version: "2.0",
      incrementality: "FULL_DATASET",
      timestamp: Math.floor(tsMs / 1000),
    },
    entity,
    // LEGACY (transição da app).
    //service_day: payload,
  };
};

// ─── RESOLUÇÃO DE UM PEDIDO (lógica do endpoint) ─────────────────────────────

/**
 * Resolve a resposta para uma data. Devolve { status, body } — o route
 * handler só faz res.status(status).json(body).
 *
 * CASO A (dentro da janela D+1..D+7): payload completo da cache; em cache
 *         miss (cron falhou) → recálculo on-the-fly (fail-safe).
 * CASO HOJE: o motor live é dono do dia — devolve recálculo estático
 *         on-the-fly sinalizado com source:"live_engine" (a verdade dinâmica
 *         contínua vive no /fertagus → futureTrains).
 * CASO B (além da janela, ou no passado): fallback ultra-rápido —
 *         verified:false, last_verified:false, só isWeekendOrHoliday.
 */
const resolveServiceDay = (dateStr, now = new Date()) => {
  // Validação do parâmetro.
  if (!isValidDateStr(dateStr)) {
    return {
      status: 400,
      body: {
        error: "DATA_INVALIDA",
        message: "Formato esperado: YYYY-MM-DD (data real do calendário).",
      },
    };
  }

  const today = operationalToday(now);
  const todayStr = fmtDate(today);
  const reqDate = dateFromStr(dateStr);
  const diffDays = Math.round((reqDate.getTime() - today.getTime()) / 86400000);

  // ── CASO B: passado ou além dos 7 dias → resposta mínima, sem grelha. ──
  if (diffDays < 0 || diffDays > WINDOW_DAYS) {
    return {
      status: 200,
      body: toGtfsRtFeed({
        date: dateStr,
        verified: false,
        last_verified: false,
        isWeekendOrHoliday: computeIsWeekendOrHoliday(dateStr),
      }),
    };
  }

  // ── CASO HOJE: fusão Base + Motor Live + changes.json. ──
  if (dateStr === todayStr) {
    try {
      // Micro-cache de 15 s (alinha com o ticker do motor live).
      if (
        TODAY_MEMO.dateStr === dateStr &&
        Date.now() - TODAY_MEMO.ts < TODAY_MEMO_TTL_MS
      ) {
        return { status: 200, body: TODAY_MEMO.body };
      }
      const body = toGtfsRtFeed(buildTodayPayload(dateStr, Date.now()));
      TODAY_MEMO = { dateStr, ts: Date.now(), body };
      return { status: 200, body };
    } catch (e) {
      console.error("[SERVICE-DAY] Fusão live de hoje falhou:", e.message);
      // Fail-safe: estático (base + changes.json) > resposta mínima > 500.
      try {
        const body = toGtfsRtFeed(buildDayPayloadStatic(dateStr, Date.now()));
        return { status: 200, body };
      } catch (e2) {
        return {
          status: 200,
          body: toGtfsRtFeed({
            date: dateStr,
            verified: false,
            last_verified: false,
            isWeekendOrHoliday: computeIsWeekendOrHoliday(dateStr),
          }),
        };
      }
    }
  }

  // ── CASO A: dentro da janela de verificação. ──
  const cached = DAY_CACHE[dateStr];
  if (cached) return { status: 200, body: toGtfsRtFeed(cached) };

  // FAIL-SAFE: cache miss (warm-up falhou / reboot sem persistência) →
  // recalcular on-the-fly em vez de devolver 500.
  console.warn(
    `[SERVICE-DAY] Cache miss para ${dateStr} (dentro da janela) — recálculo on-the-fly.`,
  );
  try {
    // FAIL-SAFE on-the-fly = método ESTÁTICO: um GET de cliente nunca deve
    // disparar 11 pedidos à IP. O cron das 04:00 repara depois com dados IP.
    const inner = buildDayPayloadStatic(dateStr, Date.now());
    DAY_CACHE[dateStr] = inner; // auto-repara a cache (até ao próximo warm-up)
    persist();
    return { status: 200, body: toGtfsRtFeed(inner) };
  } catch (e) {
    // Último recurso: até o recálculo falhou (JSON corrompido). Resposta
    // degradada mas NUNCA um 500 ao cliente.
    console.error(
      `[SERVICE-DAY] Fail-safe on-the-fly falhou para ${dateStr}:`,
      e.message,
    );
    return {
      status: 200,
      body: toGtfsRtFeed({
        date: dateStr,
        verified: false,
        last_verified: false,
        isWeekendOrHoliday: computeIsWeekendOrHoliday(dateStr),
      }),
    };
  }
};

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  init,
  stop,
  warmUp,
  resolveServiceDay,
  buildDayPayload, // assíncrono (cruzamento IP) — exposto para testes
  buildDayPayloadStatic, // fallback 100% local — exposto para testes
  buildTodayPayload, // fusão com o Motor Live — exposto para testes
  toGtfsRtFeed, // formatação GTFS-RT — exposto para testes
  _isValidDateStr: isValidDateStr,
  _cache: () => DAY_CACHE,
  WINDOW_DAYS,
};

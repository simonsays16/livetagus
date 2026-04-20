/**
 * station-poller.js
 * Módulo de DESCOBERTA DINÂMICA de comboios para a LiveTagus API.
 *
 * CONTEXTO:
 * ─────────────────────────────────────────────────────────────────────────────
 * A abordagem antiga (checkOfflineTrains) fazia um pedido INDIVIDUAL à IP
 * para cada comboio listado no horário JSON (~80 pedidos/ciclo). Isto era:
 *
 *   a) Ineficiente   — 80+ pedidos a cada 15 min vs. 6-10 pedidos agregados.
 *   b) Inflexível    — não detectava comboios que existem na IP mas não no JSON
 *                      (comboios extra adicionados por obras, eventos, etc.).
 *   c) Cego a SUPRIMIDOS — só conseguia detectar supressões quando a IP
 *                          devolvia resposta totalmente nula (frágil).
 *
 * NOVO MODELO:
 * ─────────────────────────────────────────────────────────────────────────────
 * Em vez de consultar cada comboio, consultamos a ESTAÇÃO de Corroios em
 * janelas de 2h. Porquê Corroios? Porque TODOS os comboios da Fertagus
 * (Lisboa ↔ Margem Sul) passam obrigatoriamente por Corroios. Numa única
 * resposta obtemos:
 *
 *   • A lista completa de IDs de comboios FERTAGUS que a IP conhece.
 *   • O campo Observacoes que contém "SUPRIMIDO" para supressões planeadas.
 *   • Ambos os sentidos (origem/destino) num único pedido.
 *
 * JANELAS:
 * ─────────────────────────────────────────────────────────────────────────────
 * A API da IP limita o número de comboios devolvidos por pedido, portanto
 * janelas maiores que 2h podem truncar resultados. Alinhamos as janelas em
 * horas pares (00, 02, 04, ...) e cobrimos desde (agora - lookback) até ao
 * fim do dia operacional.
 *
 * LOOKBACK:
 * ─────────────────────────────────────────────────────────────────────────────
 * Incluímos 30min de lookback para apanhar comboios atrasados que ainda não
 * passaram pela janela anterior. Evitamos repolling de janelas > 60 min no
 * passado (os comboios já terminaram).
 *
 * CACHE:
 * ─────────────────────────────────────────────────────────────────────────────
 * Cada janela é cacheada em memória por 10 min. Isto evita chamadas
 * repetidas quando o checkOfflineTrains corre (a cada 15 min) e deixa a
 * cache expirar entre ciclos para garantir dados frescos.
 */

"use strict";

const fetch = require("node-fetch");

// ─── CONSTANTES ──────────────────────────────────────────────────────────────

const CORROIOS_NODE_ID = 9417137;
const STATION_API_BASE = process.env.API_BASE_STATION;
const SERVICE_FILTER_RAW = "URB|SUBUR, ESPECIAL";
const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.infraestruturasdeportugal.pt/",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const WINDOW_SIZE_MS = 2 * 60 * 60 * 1000;
const LOOKBACK_MS = 30 * 60 * 1000;
const MAX_PAST_WINDOW_MS = 60 * 60 * 1000;
const INTER_REQUEST_DELAY_MS = 1200;

// ─── CACHE EM MEMÓRIA ────────────────────────────────────────────────────────

/**
 * WINDOW_CACHE: { [cacheKey]: { ts: number, trains: Array } }
 * cacheKey = `${startDateTimeStr}|${endDateTimeStr}` (minuto exato).
 */
const WINDOW_CACHE = {};

// ─── HELPERS DE FORMATAÇÃO ───────────────────────────────────────────────────

const pad2 = (n) => n.toString().padStart(2, "0");
const formatDate = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const formatTimeHM = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const formatDateTimeForApi = (d) => `${formatDate(d)} ${formatTimeHM(d)}`;

const buildUrl = (startDateTimeStr, endDateTimeStr) => {
  const startEnc = encodeURIComponent(startDateTimeStr);
  const endEnc = encodeURIComponent(endDateTimeStr);
  const filterEnc = encodeURIComponent(SERVICE_FILTER_RAW);
  return `${STATION_API_BASE}/${CORROIOS_NODE_ID}/${startEnc}/${endEnc}/${filterEnc}`;
};

// ─── PARSING DA RESPOSTA ─────────────────────────────────────────────────────

const inferDirection = (origemNome) => {
  if (!origemNome) return "lisboa";
  return /ROMA/i.test(origemNome) ? "margem" : "lisboa";
};

const parseStationResponse = (json) => {
  if (!json || !Array.isArray(json.response)) return [];

  const map = {};

  for (const group of json.response) {
    const rows = group?.NodesComboioTabelsPartidasChegadas;
    if (!Array.isArray(rows)) continue;

    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      if (!row.Operador || row.Operador.toUpperCase() !== "FERTAGUS") continue;

      const rawId = row.NComboio1 != null ? row.NComboio1 : row.NComboio2;
      if (rawId == null) continue;
      const trainId = String(rawId);

      const origemNome = row.NomeEstacaoOrigem || "";
      const destinoNome = row.NomeEstacaoDestino || "";
      const direction = inferDirection(origemNome);
      const observacoes = (row.Observacoes || "").trim();

      if (!map[trainId]) {
        map[trainId] = {
          id: trainId,
          operador: row.Operador,
          origem: origemNome,
          destino: destinoNome,
          estacaoOrigemId: row.EstacaoOrigem,
          estacaoDestinoId: row.EstacaoDestino,
          direction,
          scheduledTime: row.DataHoraPartidaChegada, // "HH:MM"
          scheduledDateTime: row.DataHoraPartidaChegada_ToOrderBy,
          dataRealizacao: row.DataRealizacao, // "DD-MM-YYYY"
          observacoes,
          tipoServico: row.TipoServico,
          comboioPassou: !!row.ComboioPassou,
        };
      } else {
        // Merge: SUPRIMIDO em qualquer uma das rows prevalece.
        if (/SUPRIMIDO/i.test(observacoes)) {
          map[trainId].observacoes = "SUPRIMIDO";
        } else if (!map[trainId].observacoes && observacoes) {
          map[trainId].observacoes = observacoes;
        }
        // Se em alguma row o comboio já passou, preservar esse sinal.
        if (row.ComboioPassou) map[trainId].comboioPassou = true;
      }
    }
  }

  return Object.values(map);
};

// ─── FETCH DE UMA JANELA ─────────────────────────────────────────────────────

const fetchWindow = async (startDateTimeStr, endDateTimeStr) => {
  const cacheKey = `${startDateTimeStr}|${endDateTimeStr}`;
  const cached = WINDOW_CACHE[cacheKey];

  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.trains;
  }

  const url = buildUrl(startDateTimeStr, endDateTimeStr);

  try {
    const r = await fetch(url, { headers: FETCH_HEADERS, timeout: 10000 });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const trains = parseStationResponse(j);
    WINDOW_CACHE[cacheKey] = { ts: Date.now(), trains };
    return trains;
  } catch (e) {
    console.warn(
      `[STATION POLLER] Erro a buscar janela ${startDateTimeStr} → ${endDateTimeStr}: ${e.message}`,
    );
    return cached ? cached.trains : [];
  }
};

// ─── GERAÇÃO DE JANELAS ──────────────────────────────────────────────────────

const buildPollWindows = (now = new Date()) => {
  const windows = [];
  const opStart = new Date(now);
  opStart.setHours(5, 0, 0, 0);
  const opEnd = new Date(now);
  opEnd.setHours(2, 30, 0, 0);

  if (now.getHours() < 5) {
    opStart.setDate(opStart.getDate() - 1);
  } else {
    opEnd.setDate(opEnd.getDate() + 1);
  }

  let anchor = new Date(now.getTime() - LOOKBACK_MS);
  const anchorHour = Math.floor(anchor.getHours() / 2) * 2;
  anchor.setHours(anchorHour, 0, 0, 0);

  if (anchor < opStart) anchor = new Date(opStart);

  let cursor = new Date(anchor);
  const nowMs = now.getTime();
  const cutoffPastMs = nowMs - MAX_PAST_WINDOW_MS;

  while (cursor < opEnd) {
    const winStart = new Date(cursor);
    const winEnd = new Date(cursor.getTime() + WINDOW_SIZE_MS);
    if (winEnd.getTime() < cutoffPastMs) {
      cursor = winEnd;
      continue;
    }

    windows.push({
      startStr: formatDateTimeForApi(winStart),
      endStr: formatDateTimeForApi(winEnd),
      startDate: winStart,
      endDate: winEnd,
    });

    cursor = winEnd;
  }

  return windows;
};

// ─── POLL AGREGADO ───────────────────────────────────────────────────────────

const pollAllWindows = async (now = new Date()) => {
  const windows = buildPollWindows(now);
  const allTrains = new Map();

  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    const trains = await fetchWindow(w.startStr, w.endStr);

    for (const t of trains) {
      const existing = allTrains.get(t.id);
      if (!existing) {
        allTrains.set(t.id, t);
      } else {
        if (
          /SUPRIMIDO/i.test(t.observacoes) &&
          !/SUPRIMIDO/i.test(existing.observacoes)
        ) {
          existing.observacoes = "SUPRIMIDO";
        }
        if (t.comboioPassou) existing.comboioPassou = true;
      }
    }
    if (i < windows.length - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, INTER_REQUEST_DELAY_MS),
      );
    }
  }

  return allTrains;
};

// ─── LIMPEZA DA CACHE ────────────────────────────────────────────────────────

const cleanupCache = (now = new Date()) => {
  const opDate = new Date(now);
  if (opDate.getHours() < 5) opDate.setDate(opDate.getDate() - 1);
  const opDateStr = formatDate(opDate);
  const nextDate = new Date(opDate);
  nextDate.setDate(nextDate.getDate() + 1);
  const nextDateStr = formatDate(nextDate);

  for (const key of Object.keys(WINDOW_CACHE)) {
    if (!key.startsWith(opDateStr) && !key.startsWith(nextDateStr)) {
      delete WINDOW_CACHE[key];
    }
  }
};

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  pollAllWindows,
  buildPollWindows,
  fetchWindow,
  parseStationResponse,
  cleanupCache,
  CORROIOS_NODE_ID,
  _WINDOW_CACHE: WINDOW_CACHE, // testes
};

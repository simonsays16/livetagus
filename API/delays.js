/**
 * delays.js
 * Módulo de gestão de atrasos estruturais para a LiveTagus API.
 *
 * CONTEXTO:
 * ─────────────────────────────────────────────────────────────────────────────
 * Atrasos estruturais são atrasos recorrentes causados por problemas de
 * infraestrutura não declarados oficialmente pelas Infraestruturas de Portugal
 * (IP). Este módulo centraliza toda a lógica de compensação para que o index.js
 * se mantenha limpo e esta lógica seja isolada e testável.
 *
 * TROÇOS COBERTOS (Sentido Margem Sul):
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │ Roma-Areeiro → Entrecampos → Sete Rios → Campolide                   │
 *   │   [Sem ajuste — troço Lisboa antes da ponte]                         │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │ Pragal + Foguetiro → BRIDGE DELAY   (+1:30 min / +1:45 ponta)        │
 *   │   [Remoção: após comboio passar no Pragal]                           │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │ Corroios + Foros → TROÇO 1  (+2:30 min / +2:45 ponta)                │
 *   │   [Remoção: após comboio passar no Pragal]                           │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │ Coina                                                                │
 *   │   [Sem ajuste — ponto de interseção neutro]                          │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │ Penalva → Pinhal Novo → Venda do Alcaide → Palmela → Setúbal         │
 *   │   → TROÇO 2  (+2:30 min / +2:45 ponta)                               │
 *   │   [Remoção: após comboio passar em Penalva]                          │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * AVISO (DEPRECATION WARNING):
 * ─────────────────────────────────────────────────────────────────────────────
 * Este ficheiro será descontinuado com a introdução dos adjusts, ficheiro json
 * que irá contar não só com atrasos estruturais como também troços em que é
 * possível recuperar atrasos. Assim, o ficheiro delays.js (atual) será
 * substituido por adjusts.js e adjusts.json
 */

"use strict";

// ─── CONSTANTES DE ATRASO ─────────────────────────────────────────────────────

/** Atraso de Ponte: Pragal + Fogueteiro (sentido Margem). */
const BRIDGE_DELAY_BASE_S = 1 * 60 + 30; // 1 min 30 seg
const BRIDGE_DELAY_PEAK_S = 1 * 60 + 45; // 1 min 45 seg

/** Troço 1 Pós-Pragal: Corroios e Foros (sentido Margem). */
const TROCO1_DELAY_BASE_S = 2 * 60 + 30; // 2 min 30 seg
const TROCO1_DELAY_PEAK_S = 2 * 60 + 45; // 2 min 45 seg

/** Troço 2 Pós-Coina: Penalva e restantes até Setúbal (sentido Margem). */
const TROCO2_DELAY_BASE_S = 2 * 60 + 30; // 2 min 00 seg
const TROCO2_DELAY_PEAK_S = 2 * 60 + 45; // 2 min 30 seg

// ─── GRUPO DE ESTAÇÕES ───────────────────────────────────────────────────────

const BRIDGE_STATIONS = new Set(["pragal", "fogueteiro"]);
const TROCO1_STATIONS = new Set(["corroios", "foros_de_amora"]);
const TROCO2_STATIONS = new Set(["penalva", "pinhal_novo"]);

// ─── HORAS DE PONTA ────────────────────────────────────────────────────────────

const PEAK_WINDOWS = [
  { start: 7 * 60, end: 9 * 60 + 30 }, // 07:00 – 09:30
  { start: 17 * 60, end: 19 * 60 + 30 }, // 17:00 – 19:30
];

const isPeakHour = (now = new Date(), isWeekendOrHoliday = false) => {
  if (isWeekendOrHoliday) return false;
  const dayOfWeek = now.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  const totalMinutes = now.getHours() * 60 + now.getMinutes();
  return PEAK_WINDOWS.some(
    ({ start, end }) => totalMinutes >= start && totalMinutes <= end,
  );
};

// ─── FUNÇÕES DE ATRASO INDIVIDUAIS ───────────────────────────────────────────

const getBridgeDelay = (
  stationKey,
  direction,
  pragalPassed = false,
  now = new Date(),
  isWeekendOrHoliday = false,
) => {
  if (direction !== "margem") return 0;
  if (!BRIDGE_STATIONS.has(stationKey)) return 0;

  // Corroios: apenas antes de o comboio cruzar a ponte.
  if (stationKey === "corroios" && pragalPassed) return 0;

  return isPeakHour(now, isWeekendOrHoliday)
    ? BRIDGE_DELAY_PEAK_S
    : BRIDGE_DELAY_BASE_S;
};

const getTroco1Delay = (
  stationKey,
  direction,
  corroiosPassed = false,
  now = new Date(),
  isWeekendOrHoliday = false,
) => {
  if (direction !== "margem") return 0;
  if (!TROCO1_STATIONS.has(stationKey)) return 0;
  if (corroiosPassed) return 0;

  return isPeakHour(now, isWeekendOrHoliday)
    ? TROCO1_DELAY_PEAK_S
    : TROCO1_DELAY_BASE_S;
};

const getTroco2Delay = (
  stationKey,
  direction,
  penalvaPassed = false,
  now = new Date(),
  isWeekendOrHoliday = false,
) => {
  if (direction !== "margem") return 0;
  if (!TROCO2_STATIONS.has(stationKey)) return 0;
  if (penalvaPassed) return 0;

  return isPeakHour(now, isWeekendOrHoliday)
    ? TROCO2_DELAY_PEAK_S
    : TROCO2_DELAY_BASE_S;
};

// ─── FUNÇÃO PRINCIPAL ─────────────────────────────────────────────────────────

const getStructuralDelay = (
  stationKey,
  direction,
  {
    pragalPassed = false,
    penalvaPassed = false,
    now = new Date(),
    isWeekendOrHoliday = false,
  } = {},
) => {
  if (direction !== "margem") return 0;
  if (!stationKey || typeof stationKey !== "string") return 0;

  return (
    getBridgeDelay(
      stationKey,
      direction,
      pragalPassed,
      now,
      isWeekendOrHoliday,
    ) +
    getTroco1Delay(
      stationKey,
      direction,
      pragalPassed,
      now,
      isWeekendOrHoliday,
    ) +
    getTroco2Delay(
      stationKey,
      direction,
      penalvaPassed,
      now,
      isWeekendOrHoliday,
    )
  );
};

// ─── NUNCA CHEGAR ANTES ───────────────────────────────────────────────────────

const clampToScheduled = (predictedMs, scheduledMs) => {
  if (typeof predictedMs !== "number" || typeof scheduledMs !== "number") {
    // Fail-safe: se os tipos forem inválidos, devolve o valor previsto sem alterar.
    return predictedMs;
  }
  return Math.max(predictedMs, scheduledMs);
};

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
  isPeakHour,
  getBridgeDelay,
  getTroco1Delay,
  getTroco2Delay,
  getStructuralDelay,
  clampToScheduled,
};

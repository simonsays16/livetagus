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
 *   │ Pragal + Corroios + Foros → BRIDGE DELAY   (+1:30 min / +2:00 ponta) │
 *   │   [Remoção: após comboio passar no Pragal]                           │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │ Fogueteiro → TROÇO 1  (+1:45 min / +2:15 ponta)                      │
 *   │   [Remoção: após comboio passar no Pragal]                           │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │ Coina                                                                │
 *   │   [Sem ajuste — ponto de interseção neutro]                          │
 *   ├──────────────────────────────────────────────────────────────────────┤
 *   │ Penalva → Pinhal Novo → Venda do Alcaide → Palmela → Setúbal         │
 *   │   → TROÇO 2  (+2:00 min / +2:30 ponta)                               │
 *   │   [Remoção: após comboio passar em Penalva]                          │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * REGRA DE SEGURANÇA (clampToScheduled):
 *   A previsão final NUNCA pode ser anterior ao horário programado estático.
 *   Evita o bug onde cálculos acumulados resultam num horário "melhor que o previsto".
 *
 * INTEGRAÇÃO com index.js:
 *   const DelayManager = require("./delays.js");
 *   // No loop de nodes (estações não passadas):
 *   const structuralDelay = DelayManager.getStructuralDelay(stationKey, direction, {
 *     pragalPassed, penalvaPassed, now: nowObj
 *   });
 *   // Na construção da hora prevista:
 *   const rawMs = datePartidaProg.getTime() + (currentDelay + structuralDelay) * 1000;
 *   const clampedMs = DelayManager.clampToScheduled(rawMs, dateChegadaProg.getTime());
 *   horaPrevistaFinal = formatTimeHHMMSS(new Date(clampedMs));
 *
 * EXPORTS:
 *   isPeakHour(now)                                            → boolean
 *   getBridgeDelay(stationKey, direction, pragalPassed, now)   → number (segundos)
 *   getTroco1Delay(stationKey, direction, pragalPassed, now)   → number (segundos)
 *   getTroco2Delay(stationKey, direction, penalvaPassed, now)  → number (segundos)
 *   getStructuralDelay(stationKey, direction, opts)            → number (segundos)
 *   clampToScheduled(predictedMs, scheduledMs)                 → number (ms)
 */

"use strict";

// ─── CONSTANTES DE ATRASO ─────────────────────────────────────────────────────

/** Atraso de Ponte: Pragal + Corroios (sentido Margem). */
const BRIDGE_DELAY_BASE_S = 0; //1 * 60 + 30; // 1 min 30 seg
const BRIDGE_DELAY_PEAK_S = 0; //2 * 60; // 2 min 00 seg
// const BRIDGE_DELAY_PEAK_S_AFTERNOON = 3 * 60 + 45; // 3 min 45 seg

/** Troço 1 Pós-Pragal: Fogueteiro (sentido Margem). */
const TROCO1_DELAY_BASE_S = 0; //1 * 60 + 45; // 1 min 45 seg
const TROCO1_DELAY_PEAK_S = 0; //2 * 60 + 15; // 2 min 15 seg
// const TROCO1_DELAY_PEAK_S_AFTERNOON = 2 * 60 + 40; // 2 min 40 seg

/** Troço 2 Pós-Coina: Penalva e restantes até Setúbal (sentido Margem). */
const TROCO2_DELAY_BASE_S = 2 * 60; // 2 min 00 seg
const TROCO2_DELAY_PEAK_S = 2 * 60 + 30; // 2 min 30 seg

// ─── ESTAÇÕES POR GRUPO ───────────────────────────────────────────────────────

/**
 * Estações afetadas pelo atraso de Ponte 25 de Abril.
 * Pragal recebe sempre o ajuste (comboio ainda não cruzou a ponte).
 * Corroios recebe o ajuste APENAS enquanto o Pragal não foi passado —
 * após a passagem no Pragal, o delay da ponte já está capturado no
 * atraso real medido, pelo que somá-lo novamente causaria dupla contagem.
 */
const BRIDGE_STATIONS = new Set(["pragal", "corroios", "foros_de_amora"]);

/**
 * Estações do Troço 1 (entre a Ponte e Coina).
 * Afetadas pelas mesmas condições de infraestrutura que causam o atraso de ponte,
 * mas com magnitude diferente (1 min vs 2 min).
 * Removido pelo mesmo gatilho que o bridge delay: passagem no Pragal.
 */
const TROCO1_STATIONS = new Set(["fogueteiro"]);

/**
 * Estações do Troço 2 (linha de Setúbal, pós-Coina).
 * Inclui Penalva (estação de referência para remoção) + todas as seguintes.
 * Removido quando o comboio passa em Penalva.
 */
const TROCO2_STATIONS = new Set([
  "penalva",
  "pinhal_novo",
  "venda_do_alcaide",
  "palmela",
  "setubal",
]);

// ─── HORA DE PONTA ────────────────────────────────────────────────────────────

/**
 * Janelas de hora de ponta em minutos desde meia-noite.
 * Aplica-se apenas a dias úteis (segunda a sexta).
 * Nota: a verificação de feriados é da responsabilidade do caller se necessário;
 * esta função apenas verifica o dia da semana.
 */
const PEAK_WINDOWS = [
  { start: 7 * 60, end: 9 * 60 + 30 }, // 07:00 – 09:30
  { start: 17 * 60, end: 19 * 60 + 30 }, // 17:00 – 19:30
];

/**
 * Determina se o momento indicado é hora de ponta.
 *
 * @param   {Date}    [now=new Date()]              Momento a avaliar.
 * @param   {boolean} [isWeekendOrHoliday=false]    Passar getOperationalInfo(now).isWeekendOrHoliday.
 *                                                   Necessário para feriados em dias de semana
 *                                                   (ex: 25 de Abril numa segunda-feira), onde
 *                                                   dayOfWeek seria 1 mas o serviço é de fim-de-semana.
 * @returns {boolean}                                true se for hora de ponta num dia útil não-feriado.
 *
 * @example
 * isPeakHour(new Date("2024-01-15T08:00:00"), false); // segunda-feira 08h → true
 * isPeakHour(new Date("2024-01-15T08:00:00"), true);  // feriado 08h       → false
 * isPeakHour(new Date("2024-01-13T08:00:00"), false); // sábado 08h        → false
 * isPeakHour(new Date("2024-01-15T10:00:00"), false); // segunda-feira 10h → false
 */
const isPeakHour = (now = new Date(), isWeekendOrHoliday = false) => {
  // Feriados em dias de semana não têm hora de ponta (serviço equiparado a fim-de-semana)
  if (isWeekendOrHoliday) return false;
  const dayOfWeek = now.getDay();
  // 0 = Domingo, 6 = Sábado — fins de semana nunca são hora de ponta
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  const totalMinutes = now.getHours() * 60 + now.getMinutes();
  return PEAK_WINDOWS.some(
    ({ start, end }) => totalMinutes >= start && totalMinutes <= end,
  );
};

// ─── FUNÇÕES DE ATRASO INDIVIDUAIS ───────────────────────────────────────────
// Exportadas individualmente para permitir testes unitários isolados.
// Em produção, usa getStructuralDelay() que agrega as três.

/**
 * Atraso de Ponte 25 de Abril.
 * Aplica-se ao Pragal e ao Corroios (enquanto Pragal não passou) no sentido Margem.
 *
 * @param   {string}  stationKey    Chave JSON da estação (ex: 'pragal').
 * @param   {string}  direction     Sentido do comboio: 'lisboa' | 'margem'.
 * @param   {boolean} pragalPassed  true se o comboio já passou no Pragal.
 * @param   {Date}    [now]         Momento atual (para cálculo de hora de ponta).
 * @returns {number}                Atraso em segundos a adicionar.
 */
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

/**
 * Atraso do Troço 1 (Foros de Amora e Fogueteiro).
 * Remove-se quando o comboio passa no Pragal.
 *
 * @param   {string}  stationKey    Chave JSON da estação.
 * @param   {string}  direction     'lisboa' | 'margem'.
 * @param   {boolean} pragalPassed  true se o comboio já passou no Pragal.
 * @param   {Date}    [now]         Momento atual.
 * @returns {number}                Atraso em segundos.
 */
const getTroco1Delay = (
  stationKey,
  direction,
  pragalPassed = false,
  now = new Date(),
  isWeekendOrHoliday = false,
) => {
  if (direction !== "margem") return 0;
  if (!TROCO1_STATIONS.has(stationKey)) return 0;
  if (pragalPassed) return 0;

  return isPeakHour(now, isWeekendOrHoliday)
    ? TROCO1_DELAY_PEAK_S
    : TROCO1_DELAY_BASE_S;
};

/**
 * Atraso do Troço 2 (Penalva e seguintes até Setúbal).
 * Remove-se quando o comboio passa em Penalva.
 *
 * @param   {string}  stationKey     Chave JSON da estação.
 * @param   {string}  direction      'lisboa' | 'margem'.
 * @param   {boolean} penalvaPassed  true se o comboio já passou em Penalva.
 * @param   {Date}    [now]          Momento atual.
 * @returns {number}                 Atraso em segundos.
 */
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

/**
 * Calcula o atraso estrutural total para uma estação não passada.
 * Agrega os três troços sem dupla contagem.
 *
 * Esta é a única função que o index.js deve chamar no loop de nodes.
 * As funções individuais acima são exportadas apenas para testes unitários.
 *
 * @param   {string}  stationKey    Chave JSON da estação (ex: 'corroios').
 * @param   {string}  direction     'lisboa' | 'margem'.
 * @param   {object}  [opts]        Opções de estado do comboio.
 * @param   {boolean} [opts.pragalPassed=false]   O comboio já passou no Pragal?
 * @param   {boolean} [opts.penalvaPassed=false]  O comboio já passou em Penalva?
 * @param   {Date}    [opts.now=new Date()]        Momento atual.
 * @returns {number}                               Total de segundos de atraso estrutural.
 *
 * @example
 * // Pragal, hora de ponta, Pragal não passou → 150s (bridge)
 * getStructuralDelay("pragal", "margem", { now: peakDate });
 *
 * @example
 * // Corroios, hora normal, Pragal não passou → 120s (bridge)
 * getStructuralDelay("corroios", "margem", { pragalPassed: false });
 *
 * @example
 * // Corroios, hora normal, Pragal já passou → 0s (removido)
 * getStructuralDelay("corroios", "margem", { pragalPassed: true });
 *
 * @example
 * // Fogueteiro, hora de ponta, Pragal não passou → 90s (troço 1)
 * getStructuralDelay("fogueteiro", "margem", { now: peakDate });
 *
 * @example
 * // Penalva, hora de ponta, Penalva não passou → 150s (troço 2)
 * getStructuralDelay("penalva", "margem", { now: peakDate });
 *
 * @example
 * // Penalva, hora de ponta, Penalva já passou → 0s (removido)
 * getStructuralDelay("penalva", "margem", { penalvaPassed: true, now: peakDate });
 *
 * @example
 * // Qualquer estação sentido Lisboa → sempre 0
 * getStructuralDelay("pragal", "lisboa"); // 0
 */
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

// ─── REGRA DE SEGURANÇA ───────────────────────────────────────────────────────

/**
 * Garante que a previsão nunca é anterior ao horário programado estático.
 *
 * Bug que resolve: cálculos acumulados (turnaround + bridge + currentDelay)
 * podem em casos raros resultar numa hora prevista anterior à programada —
 * especialmente no Corroios sentido Lisboa quando o delay acumulado do sentido
 * oposto é incorretamente arrastado para o sentido de retorno.
 *
 * Regra: se predictedMs < scheduledMs → forçar predictedMs = scheduledMs (0 atraso).
 *
 * @param   {number} predictedMs   Timestamp previsto de chegada/partida (ms).
 * @param   {number} scheduledMs   Timestamp programado estático (ms).
 * @returns {number}               O maior dos dois valores (ms).
 *
 * @example
 * clampToScheduled(t - 5000, t); // → t        (previsto era 5s antes → corrigido)
 * clampToScheduled(t + 3000, t); // → t + 3000  (previsto é 3s depois → mantido)
 * clampToScheduled(t,         t); // → t        (igual → mantido)
 */
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

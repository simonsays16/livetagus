/**
 * delay-block.js
 * Lista de comboios para os quais NÃO se calcula atraso — v7.0.0.
 *
 * Um nº de comboio entra na lista quando um dos parâmetros abaixo mostra que o
 * horário associado a esse número não corresponde ao comboio real (número
 * errado no feed TML). A partir daí, para esse número, o motor de atrasos por
 * GPS devolve sempre "sem cálculo" (null → a API mantém o valor de fallback).
 *
 * A lista é REINICIADA TODOS OS DIAS ÀS 04:00 (os números repetem-se de dia
 * para dia; um número errado hoje pode estar certo amanhã). Antes, um número
 * bloqueado ficava assim até o servidor reiniciar.
 *
 * PARÂMETROS
 * ─────────────────────────────────────────────────────────────────────────────
 *   • "sentido_invertido"  — o comboio passa as estações no sentido contrário
 *                            ao do horário do seu número (map-authority.js).
 *   • "atraso_impossivel"  — numa chegada/partida a estação, a diferença para
 *                            o horário é absurda: adiantado mais de 8 min, ou
 *                            atrasado mais de 120 min. Um comboio real não
 *                            parte 8 min antes da hora; isto indica horário
 *                            errado para este número.
 *   (O antigo critério "anda aos saltos" deixou de existir: os saltos de GPS
 *    são agora corrigidos na origem pelo jump-guard.js.)
 */

"use strict";

const EARLY_LIMIT_S = -8 * 60;
const LATE_LIMIT_S = 120 * 60;

const BLOCKED = new Map(); // id → { reason, since }

const block = (trainId, reason) => {
  const id = String(trainId);
  if (BLOCKED.has(id)) return false;
  BLOCKED.set(id, { reason, since: Date.now() });
  console.warn(
    `[ATRASOS] Comboio ${id} sem cálculo de atraso até às 04:00 (${reason}).`,
  );
  return true;
};

const isBlocked = (trainId) => BLOCKED.has(String(trainId));

/** Parâmetro "atraso_impossivel". rawS = hora real − hora planeada (s). */
const checkStationDelay = (trainId, stationKey, rawS) => {
  if (typeof rawS !== "number" || !Number.isFinite(rawS)) return false;
  if (rawS < EARLY_LIMIT_S || rawS > LATE_LIMIT_S) {
    return block(
      trainId,
      `atraso_impossivel: ${Math.round(rawS / 60)} min em ${stationKey}`,
    );
  }
  return false;
};

const reset = () => {
  const n = BLOCKED.size;
  BLOCKED.clear();
  return n;
};

const list = () =>
  Array.from(BLOCKED.entries()).map(([id, v]) => ({ id, ...v }));

module.exports = {
  block,
  isBlocked,
  checkStationDelay,
  reset,
  list,
  EARLY_LIMIT_S,
  LATE_LIMIT_S,
};

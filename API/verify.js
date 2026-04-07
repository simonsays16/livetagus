/**
 * verify.js
 * Sistema de verificação e aplicação de alterações ao horário da LiveTagus.
 *
 * Objetivo:
 * Lê o ficheiro changes.json para adicionar seguintes cenários:
 *
 *   1. SUPRESSÕES — Comboios que a IP não irá marcar como SUPRIMIDO
 *      (ex: obras planeadas, serviço cancelado sem aviso na API).
 *      O FutureTrains marca-os diretamente como "SUPRIMIDO" sem fazer fetch.
 *
 *   2. SUBSTITUIÇÕES — Comboios cujo ID na IP muda durante obras
 *      (ex: 14305 → 34201). O sistema usa o horário base de 14305 mas faz
 *      fetch à IP com o ID 34201. Ambos, updateCycle e checkOfflineTrains,
 *      recebem um richInfo sintético com o novo ID.
 *
 *   3. COMBOIOS EXTRA — Novos comboios que não existem no horário base
 *      (ex: comboios especiais para eventos). São processados via processTrain
 *      exatamente como um comboio normal, com os dados reais da IP.
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ─── ESTADO ──────────────────────────────────────────────────────────────────

let CHANGES = [];

// ─── CARREGAMENTO ─────────────────────────────────────────────────────────────

const reloadChanges = () => {
  try {
    const p = path.join(__dirname, "changes.json");
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, "utf8"));
      CHANGES = Array.isArray(data.changes) ? data.changes : [];
      console.log(
        `[VERIFY] changes.json carregado. ${CHANGES.length} bloco(s) de alterações.`,
      );
    } else {
      console.warn(
        "[VERIFY] changes.json não encontrado. Sem alterações ativas.",
      );
      CHANGES = [];
    }
  } catch (e) {
    console.error("[VERIFY] Erro ao carregar changes.json:", e.message);
    CHANGES = [];
  }
};

reloadChanges();

const _dateInRange = (dateStr, targetDates) => {
  if (!Array.isArray(targetDates) || targetDates.length === 0) return false;
  if (targetDates.length === 1) return targetDates[0] === dateStr;
  // Range: aplica do primeiro ao último elemento, inclusive
  return (
    dateStr >= targetDates[0] && dateStr <= targetDates[targetDates.length - 1]
  );
};

const getChangesForDate = (dateStr) => {
  const result = {
    suppressed: new Set(), // Set de IDs suprimidos
    replacements: {}, // { originalId: newId }
    extras: [], // [ { id, origin, departure } ]
  };

  for (const block of CHANGES) {
    if (!_dateInRange(dateStr, block.targetDates)) continue;

    if (Array.isArray(block.suppressed)) {
      block.suppressed.forEach((id) => result.suppressed.add(String(id)));
    }

    if (block.replacements && typeof block.replacements === "object") {
      for (const [origId, newId] of Object.entries(block.replacements)) {
        result.replacements[String(origId)] = String(newId);
      }
    }

    if (Array.isArray(block.extras)) {
      block.extras.forEach((e) => result.extras.push(e));
    }
  }

  return result;
};

// ─── API PÚBLICA ──────────────────────────────────────────────────────────────

const isSuppressed = (trainId, dateStr) => {
  const changes = getChangesForDate(dateStr);
  return changes.suppressed.has(String(trainId));
};

const getReplacementId = (trainId, dateStr) => {
  const changes = getChangesForDate(dateStr);
  return changes.replacements[String(trainId)] || null;
};

const buildReplacementRichInfoList = (dateStr, RICH_SCHEDULE) => {
  const changes = getChangesForDate(dateStr);
  const result = [];

  for (const [origId, newId] of Object.entries(changes.replacements)) {
    const originalRich = RICH_SCHEDULE.find((t) => String(t.id) === origId);

    if (!originalRich) {
      console.warn(
        `[VERIFY] Substituição: comboio original ${origId} não encontrado no horário base.`,
      );
      continue;
    }

    // Cópia do richInfo original com o novo ID e flags identificativos
    result.push({
      ...originalRich,
      id: String(newId),
      horario: 1, // Sempre corre neste dia (já filtrado por changes.json)
      _isReplacement: true,
      _replacesId: String(origId),
    });
  }

  return result;
};

const buildExtraRichInfoList = (dateStr) => {
  const changes = getChangesForDate(dateStr);
  if (changes.extras.length === 0) return [];

  return changes.extras
    .map((extra) => {
      if (!extra.id || !extra.origin || !extra.departure) {
        console.warn("[VERIFY] Extra inválido (faltam campos):", extra);
        return null;
      }

      const id = String(extra.id);
      const origin = String(extra.origin).toLowerCase();
      const departure = String(extra.departure); // "HH:MM"

      // Direção com base na estação de origem
      const direction = origin === "roma_areeiro" ? "margem" : "lisboa";

      // richInfo mínimo: processTrain usa os dados da IP para os nodes reais
      const richInfo = {
        id,
        direction,
        horario: 1, // Sempre corre (filtrado pelo changes.json)
        carruagens: null,
        service: direction === "lisboa" ? 0 : 1,
        ocupacao: null,
        _isExtra: true,

        // Inicializar todas as estações a null
        setubal: null,
        palmela: null,
        venda_do_alcaide: null,
        pinhal_novo: null,
        penalva: null,
        coina: null,
        fogueteiro: null,
        foros_de_amora: null,
        corroios: null,
        pragal: null,
        campolide: null,
        sete_rios: null,
        entrecampos: null,
        roma_areeiro: null,
      };

      // Definir hora de partida na estação de origem
      const departureWithSeconds =
        departure.length === 5 ? departure + ":00" : departure;
      richInfo[origin] = departureWithSeconds;

      return richInfo;
    })
    .filter(Boolean);
};

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
  reloadChanges,
  getChangesForDate,
  isSuppressed,
  getReplacementId,
  buildReplacementRichInfoList,
  buildExtraRichInfoList,
};

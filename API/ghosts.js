/**
 * ghosts.js
 * Sistema de gestão de Ghost Trains para a LiveTagus API.
 *
 * Objetivo:
 * Deteta e gere comboios que ficaram imobilizados sem anúncio oficial da IP.
 * Este módulo foi extraído do index.js para manter separação de responsabilidades.
 *
 * ESTADOS:
 *   Stage 1 → Possível Perturbação (5–14 min sem progressão)
 *             Ainda visível na API, com aviso.
 *
 *   Stage 2 → Ghost Monitoring (15+ min sem progressão)
 *             Removido da API pública. Monitorizado em background cada 60s.
 *
 *   Stage 3 → Suprimido ao Vivo (60+ min sem progressão, ou IP declarou SUPRIMIDO)
 *             Excluído permanentemente da API e de todos os ciclos.
 *             Assinalado em FUTURE_TRAINS_CACHE como "SUPRIMIDO".
 */

"use strict";

// ─── ESTADO ──────────────────────────────────────────────────────────────────

const GHOST_TRAINS = {};
const GHOST_SUPPRESSED = new Set();

// ─── REFERÊNCIAS INJETADAS ────────────────────────────────────────────────────

let _fetchDetails = null;
let _getTrainMemory = null;
let _setFutureCache = null;

// ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────────

const init = (fetchDetailsFn, getTrainMemoryFn, setFutureCacheFn) => {
  _fetchDetails = fetchDetailsFn;
  _getTrainMemory = getTrainMemoryFn;
  _setFutureCache = setFutureCacheFn;
};

// ─── LÓGICA PRINCIPAL ─────────────────────────────────────────────────────────

const initiateGhostMonitoring = (
  trainId,
  richInfo,
  originDateStr,
  nextStationExpectedDate,
  currentPassedCount,
) => {
  // Evita duplicação se já está em monitorização
  if (GHOST_TRAINS[trainId]) return;

  console.log(
    `[GHOST] Stage 2: Comboio ${trainId} removido da API pública. ` +
      `Monitorização background iniciada. ` +
      `Próxima estação esperada: ${nextStationExpectedDate.toLocaleTimeString("pt-PT")}.`,
  );

  const intervalHandle = setInterval(async () => {
    const ghost = GHOST_TRAINS[trainId];
    if (!ghost) return; // Entrada removida externamente — intervalo será limpo

    const minutesLate =
      (Date.now() - ghost.nextStationExpected.getTime()) / 60000;

    // === STAGE 3: 60+ minutos sem progressão ===
    if (minutesLate >= 60) {
      console.log(
        `[GHOST] Stage 3: Comboio ${trainId} confirmado suprimido ao vivo ` +
          `(${minutesLate.toFixed(1)} min sem progressão). Removido definitivamente da API.`,
      );
      _setFutureCache(String(trainId), "SUPRIMIDO");
      GHOST_SUPPRESSED.add(String(trainId));
      clearInterval(ghost.intervalHandle);
      delete GHOST_TRAINS[trainId];
      const TRAIN_MEMORY = _getTrainMemory();
      delete TRAIN_MEMORY[trainId]; // Liberta RAM
      return;
    }

    // --- Verificação de retoma de circulação (minuto a minuto) ---
    try {
      const details = await _fetchDetails(trainId, ghost.originDateStr);

      if (details && details.NodesPassagemComboio) {
        // A IP declarou SUPRIMIDO entretanto → Stage 3 imediato
        if (
          details.SituacaoComboio &&
          details.SituacaoComboio.toUpperCase().includes("SUPRIMIDO")
        ) {
          console.log(
            `[GHOST] Comboio ${trainId} declarado SUPRIMIDO pela IP durante monitorização. Stage 3 imediato.`,
          );
          _setFutureCache(String(trainId), "SUPRIMIDO");
          GHOST_SUPPRESSED.add(String(trainId));
          clearInterval(ghost.intervalHandle);
          delete GHOST_TRAINS[trainId];
          const TRAIN_MEMORY = _getTrainMemory();
          delete TRAIN_MEMORY[trainId];
          return;
        }

        const newPassedCount = details.NodesPassagemComboio.filter(
          (n) => n.ComboioPassou,
        ).length;

        // Comboio retomou: passou uma nova estação desde que entrou em Stage 2
        if (newPassedCount > ghost.lastPassedCount) {
          console.log(
            `[GHOST] Comboio ${trainId} retomou circulação ` +
              `(${ghost.lastPassedCount} → ${newPassedCount} estações passadas). ` +
              `Removido da monitorização ghost — o próximo ciclo re-integra na API.`,
          );
          clearInterval(ghost.intervalHandle);
          delete GHOST_TRAINS[trainId];
          // O próximo updateCycle deteta-o dentro da janela e volta a processá-lo.
          return;
        }

        // Atualiza o contador para a próxima verificação
        ghost.lastPassedCount = newPassedCount;
      }
    } catch (e) {
      console.error(
        `[GHOST] Erro na verificação do comboio ${trainId}:`,
        e.message,
      );
    }
  }, 60000); // Verifica de minuto a minuto

  GHOST_TRAINS[trainId] = {
    richInfo,
    originDateStr,
    nextStationExpected: nextStationExpectedDate,
    intervalHandle,
    lastPassedCount: currentPassedCount,
  };
};

// ─── LIMPEZA ──────────────────────────────────────────────────────────────────

const cleanupExpiredGhosts = (now, RICH_SCHEDULE, parseSmartTime) => {
  const nowMs = now.getTime();

  for (const ghostId of GHOST_SUPPRESSED) {
    const entry = RICH_SCHEDULE.find((t) => String(t.id) === ghostId);
    if (entry) {
      const endStr =
        entry.direction === "lisboa"
          ? entry.roma_areeiro
          : entry.setubal || entry.coina;
      if (endStr) {
        const endDate = parseSmartTime(endStr.substring(0, 5), now);
        if (endDate && nowMs > endDate.getTime() + 4 * 60 * 60 * 1000) {
          GHOST_SUPPRESSED.delete(ghostId);
        }
      }
    } else {
      // ID não existe no horário base — provavelmente comboio de substituição
      // Limpamos após 6h para garantir que não fica preso indefinidamente
      GHOST_SUPPRESSED.delete(ghostId);
    }
  }
};

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
  GHOST_TRAINS,
  GHOST_SUPPRESSED,
  init,
  initiateGhostMonitoring,
  cleanupExpiredGhosts,
};

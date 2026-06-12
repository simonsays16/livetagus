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
let _Geo = null;

// ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────────

const init = (
  fetchDetailsFn,
  getTrainMemoryFn,
  setFutureCacheFn,
  geoModule,
) => {
  _fetchDetails = fetchDetailsFn;
  _getTrainMemory = getTrainMemoryFn;
  _setFutureCache = setFutureCacheFn;
  _Geo = geoModule;
};

// ─── GPS WATCHLIST ────────────────────────────────────────────────────────────
// Comboios que a IP "perdeu" (sem progressão de nós) mas que a TML mostra em
// movimento. Enquanto cá estiverem, não podem re-entrar em ghost. O watcher
// consome o snapshot TML já mantido pelo get-location (poll 3s) via _Geo —
// não faz fetches próprios.

const GPS_WATCHLIST = new Map(); // trainId → { lastKm, lastFeatureIdx, lastMoveTs }
let WATCHER_HANDLE = null;
const WATCH_INTERVAL_MS = 30000;
const WATCH_STALL_MS = 15 * 60 * 1000; // 15 min parado → perde a proteção

const addToWatchlist = (trainId) => {
  const id = String(trainId);
  if (GPS_WATCHLIST.has(id)) return;
  const v = _Geo && _Geo.getVehicle(id);
  GPS_WATCHLIST.set(id, {
    lastKm: v?.lastPing?.km ?? null,
    lastFeatureIdx: v?.lastPing?.featureIdx ?? null,
    lastMoveTs: Date.now(),
  });
  console.log(
    `[GHOST] ${id} em GPS-watchlist (IP sem progressão, TML mostra movimento).`,
  );
  startWatcher();
};

const startWatcher = () => {
  if (WATCHER_HANDLE) return;
  WATCHER_HANDLE = setInterval(() => {
    if (GPS_WATCHLIST.size === 0) {
      clearInterval(WATCHER_HANDLE);
      WATCHER_HANDLE = null;
      console.log("[GHOST] GPS-watchlist vazia — watcher desligado.");
      return;
    }
    const now = Date.now();
    for (const [id, w] of GPS_WATCHLIST) {
      const v = _Geo && _Geo.getVehicle(id);
      if (v?.lastPing && _Geo.isGpsFresh(id, now)) {
        const moved =
          w.lastKm == null ||
          v.lastPing.featureIdx !== w.lastFeatureIdx ||
          Math.abs(v.lastPing.km - w.lastKm) * 1000 > 50;
        if (moved) {
          w.lastKm = v.lastPing.km;
          w.lastFeatureIdx = v.lastPing.featureIdx;
          w.lastMoveTs = now;
        }
      }
      // Parado >15 min (ou sem GPS) → perde a proteção; o fluxo ghost normal
      // pode voltar a apanhá-lo no próximo ciclo.
      if (now - w.lastMoveTs > WATCH_STALL_MS) {
        GPS_WATCHLIST.delete(id);
        console.log(
          `[GHOST] ${id} removido da GPS-watchlist (parou de se mover).`,
        );
      }
    }
  }, WATCH_INTERVAL_MS);
  WATCHER_HANDLE.unref?.();
};

// Chamado pelo index quando o comboio progride de estação ou fica Realizado.
const notifyProgress = (trainId) => {
  const id = String(trainId);
  if (GPS_WATCHLIST.delete(id)) {
    console.log(
      `[GHOST] ${id} saiu da GPS-watchlist (progressão/Realizado na IP).`,
    );
  }
};

// ─── VEREDICTO GPS (decisão Stage 1) ─────────────────────────────────────────
// "moving"  → GPS fresco e a andar → ghost FALSO (problema da IP)
// "absent"  → feed TML vivo mas este comboio não existe lá → supressão real provável
// "unknown" → feed vazio ou sem dados → não inferir nada (fluxo antigo)
const gpsVerdict = (trainId, now = Date.now()) => {
  if (!_Geo || typeof _Geo.isGpsFresh !== "function") return "unknown";
  const id = String(trainId);
  const feedAlive =
    typeof _Geo.liveVehicleCount === "function" &&
    _Geo.liveVehicleCount(now) > 0;

  if (_Geo.isGpsFresh(id, now) && _Geo.effectiveSpeedMps(id, now) > 1.4) {
    return "moving";
  }
  if (!_Geo.isGpsFresh(id, now) && feedAlive) return "absent";
  return "unknown";
};

// Proteção explícita (chamada pelo index quando o veredicto é "moving").
const protect = (trainId) => addToWatchlist(trainId);

// Há pelo menos um ghost falso ativo → a API está em modo "GPS manda".
const isGpsAuthority = () => GPS_WATCHLIST.size > 0;

// ─── LÓGICA PRINCIPAL ─────────────────────────────────────────────────────────

// Distância (m) percorrida na linha desde a âncora do ghost. null = sem dados.
const movedSinceAnchorM = (trainId, ghost) => {
  if (!_Geo || typeof _Geo.getVehicle !== "function") return null;
  const v = _Geo.getVehicle(String(trainId));
  if (!v || !v.lastPing) return null;
  if (!_Geo.isGpsFresh(String(trainId))) return null; // ping velho não conta

  if (ghost.anchorKm == null) {
    // Primeira leitura GPS desde que entrou em ghost → ancorar agora.
    ghost.anchorKm = v.lastPing.km;
    ghost.anchorFeatureIdx = v.lastPing.featureIdx;
    return 0;
  }
  // Mudou de feature da linha → moveu-se de certeza.
  if (v.lastPing.featureIdx !== ghost.anchorFeatureIdx) return Infinity;
  return Math.abs(v.lastPing.km - ghost.anchorKm) * 1000;
};

const GPS_ALIVE_THRESHOLD_M = 50; // acima disto não é erro de gps, comboio anda

const initiateGhostMonitoring = (
  trainId,
  richInfo,
  originDateStr,
  nextStationExpectedDate,
  currentPassedCount,
) => {
  // Evita duplicação se já está em monitorização
  if (GHOST_TRAINS[trainId]) return;

  if (GPS_WATCHLIST.has(String(trainId))) return; // protegido — TML mostra-o a andar

  // Veto imediato: GPS fresco com velocidade real → não é ghost, é a IP
  // que deixou de marcar passagens. ~1.4 m/s = 5 km/h.
  if (_Geo && typeof _Geo.effectiveSpeedMps === "function") {
    if (
      _Geo.isGpsFresh(String(trainId)) &&
      _Geo.effectiveSpeedMps(String(trainId)) > 1.4
    ) {
      console.log(
        `[GHOST] Stage 2 RECUSADO para ${trainId}: GPS mostra o comboio em andamento ` +
          `(${(_Geo.effectiveSpeedMps(String(trainId)) * 3.6).toFixed(0)} km/h).`,
      );
      addToWatchlist(trainId);
      return;
    }
  }

  console.log(
    `[GHOST] Stage 2: Comboio ${trainId} removido da API pública. ` +
      `Monitorização background iniciada. ` +
      `Próxima estação esperada: ${nextStationExpectedDate.toLocaleTimeString("pt-PT")}.`,
  );

  const intervalHandle = setInterval(async () => {
    const ghost = GHOST_TRAINS[trainId];
    if (!ghost) return; // Entrada removida externamente — intervalo será limpo

    // === VETO GPS: a IP pode ter parado de marcar "ComboioPassou", mas se a
    // posição real continua a avançar na linha, o comboio EXISTE. Liberta-o
    // do ghost monitoring — o próximo updateCycle re-integra na API e o
    // cálculo de atrasos por localização volta a ser servido. ===
    const movedM = movedSinceAnchorM(trainId, ghost);
    if (movedM != null && movedM > GPS_ALIVE_THRESHOLD_M) {
      console.log(
        `[GHOST] Comboio ${trainId} VIVO por GPS: moveu-se ${movedM === Infinity ? ">1 troço" : movedM.toFixed(0) + " m"} ` +
          `na linha desde a entrada em ghost (IP sem progressão de nós). ` +
          `Removido da monitorização — re-integra no próximo ciclo.`,
      );
      clearInterval(ghost.intervalHandle);
      delete GHOST_TRAINS[trainId];
      addToWatchlist(trainId);
      return;
    }

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

  // Âncora GPS no momento da entrada em ghost (se já houver posição snapped).
  let anchorKm = null,
    anchorFeatureIdx = null;
  if (_Geo && typeof _Geo.getVehicle === "function") {
    const v = _Geo.getVehicle(String(trainId));
    if (v && v.lastPing) {
      anchorKm = v.lastPing.km;
      anchorFeatureIdx = v.lastPing.featureIdx;
    }
  }

  GHOST_TRAINS[trainId] = {
    richInfo,
    originDateStr,
    nextStationExpected: nextStationExpectedDate,
    intervalHandle,
    lastPassedCount: currentPassedCount,
    anchorKm,
    anchorFeatureIdx,
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
  GPS_WATCHLIST,
  init,
  initiateGhostMonitoring,
  cleanupExpiredGhosts,
  notifyProgress,
  gpsVerdict,
  protect,
  isGpsAuthority,
};

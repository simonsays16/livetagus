/**
 * analytics.js
 * Sistema de analytics para medir a precisão das previsões LiveTagus.
 *
 * METODOLOGIA:
 * ─────────────────────────────────────────────────────────────────────────────
 * Para cada comboio em tracking real (isLive = true), é guardado um SNAPSHOT
 * da previsão de chegada calculada quando a chegada prevista está entre
 * 5 e 10 minutos de distância (janela "média distância").
 *
 * Esta janela foi escolhida deliberadamente para excluir:
 *   • Previsões capturadas imediatamente antes da chegada (< 5 min), que são
 *     trivialmente precisas pois o comboio já passou a estação anterior.
 *   • Previsões muito distantes (> 10 min), onde não há dados en-route.
 *
 * CÁLCULO DO DELTA:
 *   predictedArrivalMs = scheduledArrivalMs (chegada JSON) + delay_seconds × 1000
 *   delta = horaReal − predictedArrivalMs
 *   (negativo = chegou mais cedo que o previsto, positivo = chegou mais tarde)
 *
 * NOTA sobre dwell times (chegada → partida):
 *   Não é necessária uma tabela de dwell times porque:
 *   predictedArrivalMs = dateChegadaProg + atrasoAcumulado
 *   Este cálculo é direto a partir do scheduledArrival, sem precisar da partida.
 *
 * EXCLUSÕES:
 *   • Estações de partida sem previsão: Setúbal e Coina (sentido Lisboa),
 *     Roma-Areeiro (sentido Margem) — exceto quando turnaround prediction ativo.
 *   • Discrepâncias > 5 minutos: comboio parado por motivo desconhecido.
 *   • Comboios sem dados em tempo real (isLive = false), exceto Roma-Areeiro
 *     sentido Margem com turnaround.
 *
 * INTEGRAÇÃO com index.js:
 *   AnalyticsManager.tryRecordSnapshot(...)  → chamado para nodes !passed
 *   AnalyticsManager.recordArrival(...)      → chamado quando node é newly passed
 *   AnalyticsManager.cleanupTrain(trainId)   → chamado ao remover da memória
 *   AnalyticsManager.getStats()              → chamado pelo endpoint /stats
 */

// ─── CONFIGURAÇÃO ─────────────────────────────────────────────────────────────

/** Janela de captura: snapshot quando chegada prevista está entre 5 e 10 min. */
const SNAPSHOT_MIN_MS = 5 * 60 * 1000;
const SNAPSHOT_MAX_MS = 10 * 60 * 1000;

/** Discrepância máxima aceite: > 5 min = paragem inesperada, ignorado. */
const MAX_DELTA_SEC = 5 * 60;

/** Número mínimo de amostras para não ser marcado como "baixa confiança". */
const LOW_CONFIDENCE_THRESHOLD = 20;

/** Número máximo de medições em memória (≈ 1 a 2 dias de operação). */
const MAX_MEASUREMENTS = 10000;

/**
 * Estações que devem ser excluídas por serem terminais de partida sem previsão.
 * Exceção: roma_areeiro no sentido margem COM turnaround activo.
 */
const EXCLUDED_DEPARTURE_STATIONS = {
  lisboa: new Set(["setubal", "coina"]),
  margem: new Set(["roma_areeiro"]),
};

/** Nomes de display para as estações. */
const STATION_DISPLAY_NAMES = {
  setubal: "Setúbal",
  palmela: "Palmela",
  venda_do_alcaide: "Venda do Alcaide",
  pinhal_novo: "Pinhal Novo",
  penalva: "Penalva",
  coina: "Coina",
  fogueteiro: "Fogueteiro",
  foros_de_amora: "Foros de Amora",
  corroios: "Corroios",
  pragal: "Pragal",
  campolide: "Campolide",
  sete_rios: "Sete Rios",
  entrecampos: "Entrecampos",
  roma_areeiro: "Roma-Areeiro",
};

// ─── MÓDULO PRINCIPAL ─────────────────────────────────────────────────────────

const AnalyticsManager = {
  /**
   * Snapshots ativos: { [trainId]: { [stationKey]: SnapshotRecord } }
   * SnapshotRecord: { predictedArrivalMs, snapshotTime, hasTurnaround }
   */
  snapshots: {},

  /** Medições completadas. Cada medição: { trainId, stationKey, direction, deltaSeconds, ... } */
  measurements: [],

  /** Cache dos stats computados para não re-calcular a cada request. */
  _cache: null,
  _cacheTime: 0,
  CACHE_TTL_MS: 60 * 1000, // recalcula no máximo 1x por minuto

  // ─── HELPERS ───────────────────────────────────────────────────────────────

  /**
   * Verifica se a estação deve ser excluída para este sentido.
   * Roma-Areeiro sentido Margem com turnaround ativo é a única exceção.
   */
  _shouldExclude(stationKey, direction, hasTurnaround) {
    const excluded = EXCLUDED_DEPARTURE_STATIONS[direction];
    if (!excluded || !excluded.has(stationKey)) return false;
    if (
      stationKey === "roma_areeiro" &&
      direction === "margem" &&
      hasTurnaround
    )
      return false;
    return true;
  },

  // ─── API PÚBLICA ───────────────────────────────────────────────────────────

  /**
   * Tenta registar um snapshot da previsão para uma estação ainda não passada.
   * Apenas uma vez por comboio/estação, dentro da janela 5–10 min.
   *
   * @param {string}  trainId             ID do comboio
   * @param {string}  stationKey          Chave JSON da estação (ex: 'pragal')
   * @param {string}  direction           'lisboa' | 'margem'
   * @param {number}  predictedArrivalMs  Timestamp previsto de chegada
   *                                      = dateChegadaProg + (delay + bridge) * 1000
   * @param {number}  nowMs               Timestamp atual (Date.now())
   * @param {boolean} hasTurnaround       Se turnaround prediction está ativo
   * @param {boolean} isLive              Se o comboio tem dados en-route
   */
  tryRecordSnapshot(
    trainId,
    stationKey,
    direction,
    predictedArrivalMs,
    nowMs,
    hasTurnaround,
    isLive,
  ) {
    if (this._shouldExclude(stationKey, direction, hasTurnaround)) return;

    // Apenas rastrear comboios en-route, exceto Roma-Areeiro com turnaround
    const isTurnaroundSpecialCase =
      stationKey === "roma_areeiro" && direction === "margem" && hasTurnaround;
    if (!isLive && !isTurnaroundSpecialCase) return;

    // Já existe snapshot para esta estação neste comboio
    if (this.snapshots[trainId]?.[stationKey]) return;

    const remainingMs = predictedArrivalMs - nowMs;
    if (remainingMs < SNAPSHOT_MIN_MS || remainingMs > SNAPSHOT_MAX_MS) return;

    if (!this.snapshots[trainId]) this.snapshots[trainId] = {};
    this.snapshots[trainId][stationKey] = {
      predictedArrivalMs,
      snapshotTime: nowMs,
      hasTurnaround,
    };
  },

  /**
   * Regista a chegada real de um comboio a uma estação.
   * Compara com o snapshot guardado e cria uma medição.
   * Apenas deve ser chamado na PRIMEIRA passagem (isNewlyPassed).
   *
   * @param {string}  trainId          ID do comboio
   * @param {string}  stationKey       Chave JSON da estação
   * @param {string}  direction        'lisboa' | 'margem'
   * @param {number}  actualArrivalMs  Timestamp real de chegada (mem.history[NodeID])
   * @param {boolean} hasTurnaround    Se turnaround prediction estava ativo
   */
  recordArrival(
    trainId,
    stationKey,
    direction,
    actualArrivalMs,
    hasTurnaround,
  ) {
    const snap = this.snapshots[trainId]?.[stationKey];
    if (!snap) return; // Sem snapshot, nada a comparar

    const deltaMs = actualArrivalMs - snap.predictedArrivalMs;
    const deltaSeconds = Math.round(deltaMs / 1000);

    // Filtrar outliers: > 5 min de diferença indica evento fora do normal
    if (Math.abs(deltaSeconds) > MAX_DELTA_SEC) {
      delete this.snapshots[trainId][stationKey];
      return;
    }

    this.measurements.push({
      trainId: String(trainId),
      stationKey,
      direction,
      deltaSeconds,
      snapshotTime: snap.snapshotTime,
      isTurnaround: snap.hasTurnaround && stationKey === "roma_areeiro",
      ts: Date.now(),
    });

    // Manter apenas as últimas MAX_MEASUREMENTS medições
    if (this.measurements.length > MAX_MEASUREMENTS) {
      this.measurements.shift();
    }

    // Invalidar cache ao ter novos dados
    this._cache = null;

    delete this.snapshots[trainId][stationKey];
  },

  /**
   * Remove todos os snapshots pendentes de um comboio que terminou a viagem.
   * Deve ser chamado antes de apagar o comboio da TRAIN_MEMORY.
   */
  cleanupTrain(trainId) {
    delete this.snapshots[trainId];
  },

  // ─── COMPUTAÇÃO DE ESTATÍSTICAS ────────────────────────────────────────────

  /**
   * Computa as estatísticas a partir do array de medições.
   * "A horas" = |delta| ≤ 60 segundos.
   * Todos os Object.entries / Object.values têm null-guards defensivos.
   */
  _computeStats() {
    const measurements = Array.isArray(this.measurements)
      ? this.measurements
      : [];

    // Agrupar deltas por sentido e por estação
    const byStation = {}; // { 'lisboa:pragal': { direction, stationKey, deltas[] } }
    const byDirection = { lisboa: [], margem: [] };

    measurements.forEach((m) => {
      if (!m || typeof m !== "object") return;
      const { stationKey, direction, deltaSeconds } = m;
      if (!stationKey || !direction || typeof deltaSeconds !== "number") return;

      const key = `${direction}:${stationKey}`;
      if (!byStation[key])
        byStation[key] = { direction, stationKey, deltas: [] };
      byStation[key].deltas.push(deltaSeconds);

      if (byDirection[direction]) byDirection[direction].push(deltaSeconds);
    });

    /**
     * Calcula métricas a partir de um array de deltas (em segundos).
     * Devolve null se não houver dados.
     */
    const summarize = (deltas) => {
      if (!Array.isArray(deltas) || deltas.length === 0) return null;
      const count = deltas.length;
      const onTime = deltas.filter((d) => Math.abs(d) <= 60).length;
      const sum = deltas.reduce((a, b) => a + b, 0);
      return {
        accuracy: Math.round((onTime / count) * 100),
        avgDelaySec: Math.round(sum / count),
        count,
        lowConfidence: count < LOW_CONFIDENCE_THRESHOLD,
      };
    };

    // Stats por estação
    const stations = { lisboa: {}, margem: {} };
    Object.values(byStation || {}).forEach((entry) => {
      if (!entry) return;
      const { direction, stationKey, deltas } = entry;
      if (!direction || !stationKey || !Array.isArray(deltas)) return;
      const s = summarize(deltas);
      if (s && stations[direction]) {
        stations[direction][stationKey] = {
          ...s,
          name: STATION_DISPLAY_NAMES[stationKey] || stationKey,
        };
      }
    });

    // Stats por sentido
    const directions = {};
    ["lisboa", "margem"].forEach((dir) => {
      const s = summarize(byDirection[dir] || []);
      if (s) directions[dir] = s;
    });

    // Stats globais
    const allDeltas = measurements
      .filter((m) => m && typeof m.deltaSeconds === "number")
      .map((m) => m.deltaSeconds);
    const overall = summarize(allDeltas) || {
      accuracy: null,
      avgDelaySec: null,
      count: 0,
      lowConfidence: true,
    };

    return {
      overall,
      directions,
      stations,
      totalMeasurements: measurements.length,
      lastUpdated: Date.now(),
    };
  },

  /**
   * Devolve as estatísticas com cache de CACHE_TTL_MS.
   * Método principal — chamado pelo endpoint /stats no index.js.
   */
  getStats() {
    const now = Date.now();
    if (this._cache && now - this._cacheTime < this.CACHE_TTL_MS) {
      return this._cache;
    }
    this._cache = this._computeStats();
    this._cacheTime = now;
    return this._cache;
  },

  /**
   * Alias de getStats() para compatibilidade com versões anteriores do index.js
   * que possam chamar getStatusReport() em vez de getStats().
   */
  getStatusReport() {
    return this.getStats();
  },
};

module.exports = AnalyticsManager;

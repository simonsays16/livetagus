/**
 * app-timefilter.js
 * Filtro de hora/dia de partida ou chegada para a app.
 *
 * SUBSTITUI o antigo indicador "ponto + última atualização": o botão passa a
 * abrir um painel onde o utilizador escolhe a hora e o dia. O estado de
 * ligação (online / offline / erro) passou para a auréola do botão de refresh.
 *
 * REGRA DE OURO — NÃO REGRESSÃO:
 * ─────────────────────────────────────────────────────────────────────────────
 * Enquanto o filtro estiver INATIVO (estado inicial, "Partir Agora"), este
 * módulo NÃO interfere em nada: o loadData() segue exatamente o caminho antigo
 * (API → reconciliador, ou buildOfflineTrainList()). Só quando o utilizador
 * aplica um filtro é que a lista passa a ser construída aqui.
 *
 * DIA DIFERENTE DE HOJE → SEMPRE OFFLINE (decisão de produto, temporária):
 * a API só devolve o dia operacional corrente, por isso qualquer outro dia é
 * servido a partir dos JSON estáticos, com o estado forçado a "offline".
 *
 * Depende de: app-config.js (FERTAGUS_STATIONS, DB_*, isWeekendOrHoliday,
 *             activeTab, fertagusOrigin, fertagusDest)
 */

(function () {
  "use strict";

  // Quantos comboios já partidos manter acima do escolhido, para dar contexto.
  const CONTEXT_BEFORE = 2;
  // Limite de dias para a frente que o utilizador pode escolher.
  const MAX_DAYS_AHEAD = 90;

  // ─── ESTADO ────────────────────────────────────────────────────────────────

  const state = {
    active: false, // false → app comporta-se exatamente como antes
    mode: "dep", // "dep" (partir) | "arr" (chegar)
    time: "08:00", // HH:MM alvo
    dateStr: null, // YYYY-MM-DD alvo
    panelOpen: false,
  };

  // ─── HELPERS DE DATA ───────────────────────────────────────────────────────

  const pad = (n) => String(n).padStart(2, "0");

  function ymd(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** Dia operacional de hoje (antes das 03:00 ainda é "ontem"). */
  function todayYMD() {
    const d = new Date();
    if (d.getHours() < 3) d.setDate(d.getDate() - 1);
    return ymd(d);
  }

  function maxYMD() {
    const d = new Date();
    d.setDate(d.getDate() + MAX_DAYS_AHEAD);
    return ymd(d);
  }

  function nowHM() {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /**
   * Converte "HH:MM" numa Date no dia operacional indicado.
   * Horas antes das 03:00 pertencem ao dia CIVIL seguinte (serviço da
   * madrugada), coerente com getOperationalDate() do app-config.js.
   */
  function timeOnDate(hhmm, dateStr) {
    if (!hhmm || !dateStr) return null;
    const [Y, M, D] = dateStr.split("-").map(Number);
    const [h, m] = String(hhmm).split(":").map(Number);
    if (isNaN(Y) || isNaN(h)) return null;
    const d = new Date(Y, M - 1, D, h, m, 0, 0);
    if (h < 3) d.setDate(d.getDate() + 1);
    return d;
  }

  function isOtherDay() {
    return state.active && state.dateStr && state.dateStr !== todayYMD();
  }

  /** Data-alvo completa (Date) do filtro atual. */
  function targetDate() {
    return timeOnDate(state.time, state.dateStr || todayYMD());
  }

  // ─── ETIQUETA DO BOTÃO ─────────────────────────────────────────────────────

  function dayLabel(dateStr) {
    const t = todayYMD();
    if (dateStr === t) return null; // hoje → não mostra o dia
    const [Y, M, D] = dateStr.split("-").map(Number);
    const d = new Date(Y, M - 1, D);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (dateStr === ymd(tomorrow)) return "Amanhã";
    return d
      .toLocaleDateString("pt-PT", { day: "2-digit", month: "short" })
      .replace(".", "");
  }

  function label() {
    if (!state.active) return "Partir Agora";
    const verbo = state.mode === "arr" ? "Chegar" : "Partir";
    const dia = dayLabel(state.dateStr);
    return dia ? `${dia} · ${state.time}` : `${verbo} ${state.time}`;
  }

  // ─── CONSTRUÇÃO DA LISTA PARA UM DIA ───────────────────────────────────────

  /**
   * Constrói o dia COMPLETO (sem cortar os já partidos) a partir dos JSON
   * estáticos, no mesmo formato de buildOfflineTrainList() — para que
   * _makeCard/_patchCard/openDetails funcionem sem alterações.
   */
  function buildDayList(dateStr) {
    const db = activeTab === "lisboa" ? DB_LISBOA : DB_MARGEM;
    if (!db || !db.trips) return [];

    const dstInfo = FERTAGUS_STATIONS.find((s) => s.key === fertagusDest);
    if (!dstInfo) return [];

    const [Y, M, D] = dateStr.split("-").map(Number);
    const isSpecial = isWeekendOrHoliday(new Date(Y, M - 1, D));

    return db.trips
      .filter((trip) => {
        if (!trip[fertagusOrigin] || !trip[fertagusDest]) return false;
        const hType = parseInt(trip.horario);
        if (hType === 1) return true; // diário
        if (hType === 0 && !isSpecial) return true; // só dias úteis
        if (hType === 2 && isSpecial) return true; // só FDS/feriado
        return false;
      })
      .map((trip) => {
        const dep = timeOnDate(trip[fertagusOrigin], dateStr);
        const arr = timeOnDate(trip[fertagusDest], dateStr);
        if (!dep || !arr || arr <= dep) return null;

        let originLabel = "FERTAGUS";
        if (trip.setubal) originLabel = "SETÚBAL";
        else if (trip.coina) originLabel = "COINA";

        return {
          id: trip.id,
          num: trip.id,
          op: originLabel,
          time: trip[fertagusOrigin],
          secTime: null,
          dest: dstInfo.name,
          status: "OFFLINE",
          arr: trip[fertagusDest],
          dotStatus: "gray",
          pulse: false,
          isLive: false,
          isSuppressed: false,
          carriages: isSpecial ? 4 : trip.carruagens,
          occupancy: isSpecial ? null : trip.ocupacao,
          context: null,
          isPassed: false,
          isEffectiveFuture: true,
          rawTime: dep,
          effectiveDate: dep,
          fullSchedule: null,
          isAbnormalRoute: false,
          skippedStations: [],
          isOffline: true,
          _arrDate: arr, // interno: usado no modo "Chegar"
        };
      })
      .filter((t) => t !== null)
      .sort((a, b) => a.effectiveDate - b.effectiveDate);
  }

  /** Data de chegada de um comboio (live ou offline). */
  function arrivalOf(t) {
    if (t._arrDate instanceof Date) return t._arrDate;
    if (!t.arr || typeof window.parseTimeStr !== "function") return null;
    return window.parseTimeStr(t.arr);
  }

  /**
   * Índice do comboio-alvo:
   *   "dep" → o primeiro que parte À HORA ou DEPOIS
   *   "arr" → o último que chega ATÉ à hora
   */
  function anchorIndex(list, target, mode) {
    if (!list.length || !target) return 0;
    if (mode === "arr") {
      let idx = -1;
      for (let i = 0; i < list.length; i++) {
        const a = arrivalOf(list[i]);
        if (a && a <= target) idx = i;
      }
      return idx === -1 ? 0 : idx;
    }
    const idx = list.findIndex(
      (t) => t.effectiveDate && t.effectiveDate >= target,
    );
    return idx === -1 ? list.length - 1 : idx;
  }

  /**
   * Reancora uma lista à hora escolhida: marca como passados os anteriores,
   * corta o excesso do início (mantendo CONTEXT_BEFORE para dar contexto) e
   * devolve CÓPIAS — a lista original nunca é mutada.
   */
  function anchor(list) {
    if (!Array.isArray(list) || !list.length) return list || [];
    const target = targetDate();
    if (!target) return list;

    const idx = anchorIndex(list, target, state.mode);
    const start = Math.max(0, idx - CONTEXT_BEFORE);

    return list.slice(start).map((t, i) => {
      const globalIdx = start + i;
      return Object.assign({}, t, {
        isPassed: globalIdx < idx,
        isEffectiveFuture: globalIdx >= idx && !t.isSuppressed,
      });
    });
  }

  /** Lista final quando o filtro está ativo. */
  function buildFiltered() {
    return anchor(buildDayList(state.dateStr || todayYMD()));
  }

  // ─── PAINEL ────────────────────────────────────────────────────────────────

  function $(id) {
    return document.getElementById(id);
  }

  function refreshButtonLabel() {
    const el = $("tf-btn-label");
    if (el) el.textContent = label();
    const btn = $("btn-time-filter");
    if (btn) {
      btn.setAttribute(
        "aria-label",
        state.active
          ? `Filtro ativo: ${label()}. Tocar para alterar.`
          : "Escolher hora de partida ou chegada",
      );
      btn.classList.toggle("tf-on", state.active);
    }
  }

  function openPanel() {
    const panel = $("time-filter-panel");
    if (!panel) return;
    // Ao abrir sem filtro ativo, parte da hora atual / hoje.
    if (!state.active) {
      state.time = nowHM();
      state.dateStr = todayYMD();
      state.mode = "dep";
    }
    panel.classList.remove("hidden");
    requestAnimationFrame(() => {
      panel.classList.remove("opacity-0");
    });
    state.panelOpen = true;
    if (window.lucide) lucide.createIcons();
  }

  function closePanel() {
    const panel = $("time-filter-panel");
    if (!panel) return;
    panel.classList.add("opacity-0");
    state.panelOpen = false;
    setTimeout(() => {
      if (!state.panelOpen) panel.classList.add("hidden");
    }, 200);
  }

  function togglePanel() {
    if (state.panelOpen) closePanel();
    else openPanel();
  }

  // ─── APLICAR / LIMPAR ──────────────────────────────────────────────────────

  function apply() {
    state.active = true;
    if (!state.dateStr) state.dateStr = todayYMD();
    if (!state.time) state.time = nowHM();
    refreshButtonLabel();
    closePanel();
    if (typeof window.sa_event === "function")
      window.sa_event("app_time_filter_apply");
    rerender();
  }

  function reset() {
    state.active = false;
    state.mode = "dep";
    state.time = nowHM();
    state.dateStr = todayYMD();
    refreshButtonLabel();
    closePanel();
    if (typeof window.sa_event === "function")
      window.sa_event("app_time_filter_reset");
    rerender();
  }

  /**
   * Re-renderiza segundo o estado atual.
   *  • filtro inativo  → volta ao caminho normal (loadData), intocado
   *  • filtro ativo    → lista estática do dia escolhido, estado "offline"
   */
  function rerender() {
    if (!state.active) {
      window.hasScrolledNext = false;
      if (typeof loadData === "function") loadData(false);
      return;
    }
    const list = buildFiltered();
    if (typeof displayLimit !== "undefined") displayLimit = 10;
    window.hasScrolledNext = false;
    if (typeof renderList === "function") renderList(list);
    if (typeof setStatus === "function") setStatus("offline");
  }

  // ─── LIGAÇÃO À SEARCHBAR (planear-searchbar.js) ────────────────────────
  // O painel é servido pelo componente partilhado, montado em #lt-searchbar
  // com data-theme="app" (estilo do app.html), data-stations="false" (as
  // estações vivem no cabeçalho da página) e data-reset="true" (botão Agora).
  // O componente emite "lt:search"; nós tratamos e cancelamos, para que ele
  // não navegue para lado nenhum.

  function bind() {
    const btn = $("btn-time-filter");
    if (btn && !btn.dataset.tfBound) {
      btn.dataset.tfBound = "1";
      btn.addEventListener("click", togglePanel);
    }
    refreshButtonLabel();
  }

  document.addEventListener("lt:search", function (e) {
    // Impede a navegação do componente: aqui o tratamento é local.
    e.preventDefault();
    const d = e.detail || {};

    // As estações vêm SEMPRE do cabeçalho da app, nunca da searchbar
    // (o bloco de estações está oculto nesta montagem).
    state.mode = d.mode === "arr" ? "arr" : "dep";
    if (d.timeStr) state.time = d.timeStr;
    if (d.dateStr) {
      let v = d.dateStr;
      if (v < todayYMD()) v = todayYMD();
      if (v > maxYMD()) v = maxYMD();
      state.dateStr = v;
    }
    apply();
  });

  document.addEventListener("lt:reset", function (e) {
    e.preventDefault();
    reset();
  });

  // ─── LINKS PARTILHADOS (fragmento #) ───────────────────────────────────
  /**
   * Lê os parâmetros do fragmento e aplica-os ANTES do primeiro render.
   * Formato: /app#org=corroios&dst=roma_areeiro&date=2026-09-15&mode=dep&time=08:28
   *
   * A searchbar também lê o fragmento (data-read-url), mas apenas para
   * pré-preencher os seus campos: com data-autosearch="false" ela nunca
   * emite sozinha, pelo que sem isto o link chegava e não activava nada.
   *
   * Devolve true se alguma coisa foi aplicada.
   */
  function applyHash() {
    const raw =
      typeof location !== "undefined" &&
      location.hash &&
      location.hash.length > 1
        ? location.hash.slice(1)
        : "";
    if (!raw) return false;

    let p;
    try {
      p = new URLSearchParams(raw);
    } catch (e) {
      return false;
    }

    let changed = false;
    const isStation = (k) =>
      !!k && FERTAGUS_STATIONS.some((st) => st.key === k);

    // ── Estações ──
    const org = p.get("org");
    const dst = p.get("dst");
    if (isStation(org) && isStation(dst) && org !== dst) {
      fertagusOrigin = org;
      fertagusDest = dst;
      activeTab = calculateDirection(org, dst);
      changed = true;
    }

    // ── Hora / dia / modo ──
    const time = p.get("time");
    const date = p.get("date");
    const mode = p.get("mode");
    const timeOk = /^\d{1,2}:\d{2}$/.test(time || "");
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date || "");

    if (timeOk || dateOk) {
      state.mode = mode === "arr" ? "arr" : "dep";
      state.time = timeOk ? time : nowHM();
      let d = dateOk ? date : todayYMD();
      if (d < todayYMD()) d = todayYMD();
      if (d > maxYMD()) d = maxYMD();
      state.dateStr = d;
      state.active = true;
      changed = true;
    }

    if (changed) refreshButtonLabel();
    return changed;
  }

  // ─── API PÚBLICA ───────────────────────────────────────────────────────────

  window.TimeFilter = {
    state,
    bind,
    applyHash,
    isActive: () => state.active,
    isOtherDay,
    label,
    targetDate,
    buildDayList,
    buildFiltered,
    anchor,
    apply,
    reset,
    openPanel,
    closePanel,
    togglePanel,
    refreshButtonLabel,
    /** Chamado pelo switchTab/troca de estações: reconstrói se estiver ativo. */
    refresh: rerender,
    _todayYMD: todayYMD,
    _timeOnDate: timeOnDate,
    _anchorIndex: anchorIndex,
  };
})();

/**
 * planear-searchbar.js  (injetável)
 * Barra de pesquisa de viagens LiveTagus. Auto-monta em qualquer elemento com
 * id="lt-searchbar" (ou [data-lt-searchbar]) e pode ser colocada tanto na
 * página do planeador como na página inicial.
 *
 * Modos (via dataset do elemento de montagem):
 *   data-inline="true"   → emite CustomEvent("lt:search") em vez de navegar
 *                          (usado na própria página do planeador).
 *   data-target="/planear" → destino da navegação quando NÃO é inline.
 *   data-read-url="true" → lê o estado inicial dos parâmetros do URL.
 *   data-compact="true"  → esconde os controlos de data/hora (widget leve).
 *
 * Conforme CSP (script-src 'self'): zero JS inline, estilos injetados via <style>
 * (permitido por style-src 'unsafe-inline'). Sem dependências externas.
 *
 * Contrato de pesquisa:
 *   detail = { org, dst, dateStr:"YYYY-MM-DD", mode:"dep"|"arr", timeStr:"HH:MM", scroll }
 */
(function () {
  "use strict";

  const STATIONS = [
    { key: "setubal", name: "Setúbal" },
    { key: "palmela", name: "Palmela" },
    { key: "venda_do_alcaide", name: "Venda do Alcaide" },
    { key: "pinhal_novo", name: "Pinhal Novo" },
    { key: "penalva", name: "Penalva" },
    { key: "coina", name: "Coina" },
    { key: "fogueteiro", name: "Fogueteiro" },
    { key: "foros_de_amora", name: "Foros de Amora" },
    { key: "corroios", name: "Corroios" },
    { key: "pragal", name: "Pragal" },
    { key: "campolide", name: "Campolide" },
    { key: "sete_rios", name: "Sete Rios" },
    { key: "entrecampos", name: "Entrecampos" },
    { key: "roma_areeiro", name: "Roma-Areeiro" },
  ];
  const IS_STATION = (k) => STATIONS.some((s) => s.key === k);
  const MAX_MONTHS_AHEAD = 3;

  // ─── PREFERÊNCIAS (Horário Inteligente → fallback ft_org/ft_dst) ─────────
  function ls(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }
  function smartConfigured() {
    return (
      ls("smart_enabled") === "true" &&
      IS_STATION(ls("smart_lisboa_org")) &&
      IS_STATION(ls("smart_lisboa_dest")) &&
      IS_STATION(ls("smart_margem_org")) &&
      IS_STATION(ls("smart_margem_dest"))
    );
  }
  /** Estações preferidas a mostrar no topo dos dropdowns. */
  function preferredKeys() {
    let keys = [];
    if (smartConfigured()) {
      keys = [
        ls("smart_lisboa_org"),
        ls("smart_lisboa_dest"),
        ls("smart_margem_org"),
        ls("smart_margem_dest"),
      ];
    } else {
      keys = [ls("ft_org"), ls("ft_dst")];
    }
    const seen = new Set();
    return keys.filter((k) => IS_STATION(k) && !seen.has(k) && seen.add(k));
  }

  // ─── HELPERS DE DATA ────────────────────────────────────────────────────
  function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  }
  function todayYMD() {
    return ymd(new Date());
  }
  function maxYMD() {
    const d = new Date();
    d.setMonth(d.getMonth() + MAX_MONTHS_AHEAD);
    return ymd(d);
  }
  function ymdToDate(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function clampYMD(s) {
    if (s < todayYMD()) return todayYMD();
    if (s > maxYMD()) return maxYMD();
    return s;
  }
  function nowHM() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function shiftDay(s, delta) {
    const d = ymdToDate(s);
    d.setDate(d.getDate() + delta);
    return clampYMD(ymd(d));
  }
  function fmtDateLabel(s) {
    if (s === todayYMD()) return "Hoje";
    if (s === shiftDay(todayYMD(), 1) && s !== todayYMD()) return "Amanhã";
    const d = ymdToDate(s);
    const txt = d.toLocaleDateString("pt-PT", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }
  function shiftTime(hm, deltaMin) {
    let [h, m] = hm.split(":").map(Number);
    let total = h * 60 + m + deltaMin;
    if (total < 0) total = 0;
    if (total > 23 * 60 + 59) total = 23 * 60 + 59;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }

  // ─── ESTILOS (injetados uma vez) ────────────────────────────────────────
  // Linguagem visual alinhada com a página das estações (partidas.js / estacao.html):
  // fio de 1px, cantos quase rectos, micro-maiúsculas espaçadas, mono para números.
  function injectStyle() {
    if (document.getElementById("lt-sb-style")) return;
    const st = document.createElement("style");
    st.id = "lt-sb-style";
    st.textContent = `
.lt-sb{font-family:"Inter",-apple-system,BlinkMacSystemFont,sans-serif;-webkit-tap-highlight-color:transparent}
.lt-sb *{box-sizing:border-box}

/* Micro-etiqueta editorial */
.lt-sb-lbl{display:block;font-size:9px;font-weight:800;letter-spacing:.3em;text-transform:uppercase;color:rgb(161,161,170);line-height:1}
html.dark .lt-sb-lbl{color:rgb(113,113,122)}

/* ─── Estações ─────────────────────────────────────────────────────────── */
.lt-sb-stations{position:relative}
.lt-sb-field{position:relative;padding:0 3.4rem .9rem 0;border-bottom:1px solid rgb(228,228,231);transition:border-color .25s ease}
html.dark .lt-sb-field{border-bottom-color:rgb(39,39,42)}
.lt-sb-field + .lt-sb-field{padding-top:1.5rem}
.lt-sb-field:focus-within{border-bottom-color:rgb(24,24,27)}
html.dark .lt-sb-field:focus-within{border-bottom-color:rgb(244,244,245)}
.lt-sb-select{appearance:none;-webkit-appearance:none;background:transparent;border:0;outline:none;padding:.45rem 0 0;margin:0;width:100%;cursor:pointer;font-family:inherit;font-size:1.5rem;font-weight:300;letter-spacing:-.035em;line-height:1.15;color:rgb(24,24,27);text-overflow:ellipsis;white-space:nowrap;overflow:hidden;border-radius:0}
html.dark .lt-sb-select{color:#fff}
@media(min-width:640px){.lt-sb-select{font-size:1.75rem}}
.lt-sb-select option{background-color:#fff;color:#18181b;font-size:15px}
html.dark .lt-sb-select option{background-color:#09090b;color:#fafafa}
.lt-sb-select optgroup{background-color:#fff;color:#71717a;font-weight:700}
html.dark .lt-sb-select optgroup{background-color:#09090b;color:#a1a1aa}
.lt-sb-chev{position:absolute;right:3.4rem;bottom:1.05rem;color:rgb(212,212,216);pointer-events:none;transition:color .2s ease}
html.dark .lt-sb-chev{color:rgb(63,63,70)}
.lt-sb-field:hover .lt-sb-chev{color:rgb(113,113,122)}

/* Botão de troca — encostado ao eixo direito, entre os dois campos */
.lt-sb-swap{position:absolute;right:0;top:50%;transform:translateY(-50%);width:42px;height:42px;display:flex;align-items:center;justify-content:center;border:1px solid rgb(228,228,231);border-radius:999px;background:#fff;color:rgb(113,113,122);cursor:pointer;z-index:2;transition:color .2s ease,border-color .2s ease,transform .2s ease}
html.dark .lt-sb-swap{background:#09090b;border-color:rgb(39,39,42);color:rgb(161,161,170)}
.lt-sb-swap:hover{color:rgb(24,24,27);border-color:rgb(161,161,170)}
html.dark .lt-sb-swap:hover{color:#fff;border-color:rgb(82,82,91)}
.lt-sb-swap:active{transform:translateY(-50%) scale(.92)}

/* ─── Linhas de controlo (data / hora) ─────────────────────────────────── */
.lt-sb-row{display:flex;align-items:center;gap:.4rem}
.lt-sb-step{width:36px;height:38px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border:1px solid rgb(228,228,231);border-radius:2px;background:transparent;color:rgb(113,113,122);cursor:pointer;transition:all .2s ease}
html.dark .lt-sb-step{border-color:rgb(39,39,42);color:rgb(161,161,170)}
.lt-sb-step:hover{border-color:rgb(24,24,27);color:rgb(24,24,27)}
html.dark .lt-sb-step:hover{border-color:rgb(244,244,245);color:#fff}
.lt-sb-step:active{transform:scale(.94)}
.lt-sb-step.off{opacity:.28;pointer-events:none}

.lt-sb-val{position:relative;flex:1;min-width:0;height:38px;display:flex;align-items:center;justify-content:center;gap:.5rem;border:1px solid rgb(228,228,231);border-radius:2px;background:transparent;cursor:pointer;transition:border-color .2s ease}
html.dark .lt-sb-val{border-color:rgb(39,39,42)}
.lt-sb-val:hover{border-color:rgb(161,161,170)}
html.dark .lt-sb-val:hover{border-color:rgb(82,82,91)}
.lt-sb-val-txt{font-size:10px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:rgb(24,24,27);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
html.dark .lt-sb-val-txt{color:rgb(244,244,245)}
.lt-sb-val-mono{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:14px;font-weight:400;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:rgb(24,24,27)}
html.dark .lt-sb-val-mono{color:#fff}
.lt-sb-badge{font-size:8px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#3b82f6;padding-left:.1rem}
.lt-sb-badge.hidden{display:none}

/* Alternador Partir / Chegar — padrão .ltp-dir da página das estações */
.lt-sb-toggle{display:flex;flex-shrink:0}
.lt-sb-mode{padding:0 .7rem;height:38px;font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;border:1px solid rgb(228,228,231);background:transparent;color:rgb(113,113,122);cursor:pointer;transition:all .2s ease}
html.dark .lt-sb-mode{border-color:rgb(39,39,42);color:rgb(161,161,170)}
.lt-sb-mode:first-child{border-radius:2px 0 0 2px}
.lt-sb-mode:last-child{border-radius:0 2px 2px 0;margin-left:-1px}
.lt-sb-mode[aria-pressed="true"]{background:rgb(24,24,27);border-color:rgb(24,24,27);color:#fff;z-index:1}
html.dark .lt-sb-mode[aria-pressed="true"]{background:rgb(244,244,245);border-color:rgb(244,244,245);color:rgb(9,9,11)}

/* Picker nativo sobreposto e invisível */
.lt-native-overlay{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;border:0;padding:0;margin:0;-webkit-appearance:none;appearance:none;background:transparent}

/* ─── Acção ────────────────────────────────────────────────────────────── */
.lt-sb-cta{width:100%;padding:1.15rem 1rem;display:flex;align-items:center;justify-content:center;gap:.9rem;border:0;border-radius:2px;background:rgb(24,24,27);color:#fff;font-family:inherit;font-size:10px;font-weight:800;letter-spacing:.28em;text-transform:uppercase;cursor:pointer;transition:background-color .2s ease,transform .12s ease}
html.dark .lt-sb-cta{background:rgb(244,244,245);color:rgb(9,9,11)}
.lt-sb-cta:hover{background:rgb(63,63,70)}
html.dark .lt-sb-cta:hover{background:rgb(212,212,216)}
.lt-sb-cta:active{transform:scale(.99)}

@media(prefers-reduced-motion:reduce){.lt-sb-swap,.lt-sb-step,.lt-sb-cta{transition:none!important}}
`;
    document.head.appendChild(st);
  }

  // ─── SVGs (inline, currentColor) ────────────────────────────────────────
  const svg = {
    swap: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M7 4v16"/><path d="m3 8 4-4 4 4"/><path d="M17 20V4"/><path d="m21 16-4 4-4-4"/></svg>`,
    chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="m6 9 6 6 6-6"/></svg>`,
    left: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="m15 18-6-6 6-6"/></svg>`,
    right: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="m9 18 6-6-6-6"/></svg>`,
    minus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M5 12h14"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 5v14M5 12h14"/></svg>`,
    arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`,
  };

  // ─── COMPONENTE ─────────────────────────────────────────────────────────
  function mount(root) {
    if (!root || root.dataset.ltMounted === "1") return;
    root.dataset.ltMounted = "1";
    injectStyle();

    const inline = root.dataset.inline === "true";
    const compact = root.dataset.compact === "true";
    const target = root.dataset.target || "/planear";
    const readUrl = root.dataset.readUrl === "true";

    // ── Estado inicial ──
    const url = new URLSearchParams(readUrl ? location.search : "");
    const smartOrg = smartConfigured() ? ls("smart_lisboa_org") : null;
    const smartDst = smartConfigured() ? ls("smart_lisboa_dest") : null;

    const pick = (a, b) => (IS_STATION(a) ? a : b);
    const state = {
      org: pick(
        root.dataset.org || url.get("org"),
        pick(smartOrg, pick(ls("ft_org"), "corroios")),
      ),
      dst: pick(
        root.dataset.dst || url.get("dst"),
        pick(smartDst, pick(ls("ft_dst"), "roma_areeiro")),
      ),
      dateStr: clampYMD(root.dataset.date || url.get("date") || todayYMD()),
      mode: (root.dataset.mode || url.get("mode")) === "arr" ? "arr" : "dep",
      timeStr: root.dataset.time || url.get("time") || nowHM(),
    };
    if (state.org === state.dst) {
      const alt = STATIONS.find((s) => s.key !== state.org);
      state.dst = alt ? alt.key : "roma_areeiro";
    }

    // ── HTML base ──
    root.classList.add("lt-sb");
    root.innerHTML = `
      <div class="lt-sb-stations">
        <div class="lt-sb-field">
          <span class="lt-sb-lbl">De</span>
          <select data-lt="org" class="lt-sb-select" aria-label="Estação de partida"></select>
          <span class="lt-sb-chev">${svg.chevron}</span>
        </div>

        <button data-lt="swap" class="lt-sb-swap" type="button" aria-label="Trocar partida e destino">${svg.swap}</button>

        <div class="lt-sb-field">
          <span class="lt-sb-lbl">Para</span>
          <select data-lt="dst" class="lt-sb-select" aria-label="Estação de destino"></select>
          <span class="lt-sb-chev">${svg.chevron}</span>
        </div>
      </div>

      <div data-lt="datetime" class="${compact ? "hidden" : ""}" style="${compact ? "" : "margin-top:2rem"}">
        <div style="display:flex;flex-direction:column;gap:1.4rem">
          <div>
            <span class="lt-sb-lbl" style="margin-bottom:.6rem">Data</span>
            <div class="lt-sb-row">
              <button data-lt="day-prev" class="lt-sb-step" type="button" aria-label="Dia anterior">${svg.left}</button>
              <div class="lt-sb-val">
                <button data-lt="day-label" type="button" style="all:unset;cursor:pointer;display:flex;align-items:center;gap:.45rem;padding:0 .6rem;min-width:0">
                  <span data-lt="day-text" class="lt-sb-val-txt">${fmtDateLabel(state.dateStr)}</span>
                  <span data-lt="day-badge" class="lt-sb-badge hidden"></span>
                </button>
                <input data-lt="day-input" type="date" class="lt-native-overlay" min="${todayYMD()}" max="${maxYMD()}" value="${state.dateStr}" aria-label="Escolher data" />
              </div>
              <button data-lt="day-next" class="lt-sb-step" type="button" aria-label="Dia seguinte">${svg.right}</button>
            </div>
          </div>

          <div>
            <span class="lt-sb-lbl" style="margin-bottom:.6rem">Hora</span>
            <div class="lt-sb-row">
              <div class="lt-sb-toggle">
                <button data-lt="mode-dep" class="lt-sb-mode" type="button" aria-pressed="true">Partir</button>
                <button data-lt="mode-arr" class="lt-sb-mode" type="button" aria-pressed="false">Chegar</button>
              </div>
              <button data-lt="time-minus" class="lt-sb-step" type="button" aria-label="Menos 10 minutos">${svg.minus}</button>
              <div class="lt-sb-val">
                <button data-lt="time-label" type="button" style="all:unset;cursor:pointer;padding:0 .5rem">
                  <span data-lt="time-text" class="lt-sb-val-mono">${state.timeStr}</span>
                </button>
                <input data-lt="time-input" type="time" class="lt-native-overlay" value="${state.timeStr}" aria-label="Escolher hora" />
              </div>
              <button data-lt="time-plus" class="lt-sb-step" type="button" aria-label="Mais 10 minutos">${svg.plus}</button>
            </div>
          </div>
        </div>
      </div>

      <button data-lt="submit" class="lt-sb-cta" type="button" style="margin-top:2rem">
        <span>Pesquisar viagens</span>
        ${svg.arrow}
      </button>`;

    // ── Referências ──
    const $ = (sel) => root.querySelector(`[data-lt="${sel}"]`);
    const orgSel = $("org");
    const dstSel = $("dst");
    const dayText = $("day-text");
    const dayBadge = $("day-badge");
    const dayInput = $("day-input");
    const dayPrev = $("day-prev");
    const dayNext = $("day-next");
    const timeText = $("time-text");
    const timeInput = $("time-input");
    const modeDep = $("mode-dep");
    const modeArr = $("mode-arr");

    // ── Opções dos selects (com grupo Preferidas) ──
    const optHTML = (key, selected) =>
      `<option value="${key}"${key === selected ? " selected" : ""}>${
        STATIONS.find((s) => s.key === key).name
      }</option>`;

    function buildSelect(sel, selectedKey, excludeKey) {
      const prefList = preferredKeys().filter((k) => k !== excludeKey);
      let html = "";
      if (prefList.length) {
        html +=
          `<optgroup label="Preferidas">` +
          prefList.map((k) => optHTML(k, selectedKey)).join("") +
          `</optgroup>`;
      }
      html +=
        `<optgroup label="Todas as estações">` +
        STATIONS.filter((s) => s.key !== excludeKey)
          .map((s) => optHTML(s.key, selectedKey))
          .join("") +
        `</optgroup>`;
      sel.innerHTML = html;
      sel.value = selectedKey;
    }

    function refreshSelects() {
      buildSelect(orgSel, state.org, null);
      // destino não pode ser igual à origem
      if (state.dst === state.org) {
        const alt =
          preferredKeys().find((k) => k !== state.org) ||
          STATIONS.find((s) => s.key !== state.org).key;
        state.dst = alt;
      }
      buildSelect(dstSel, state.dst, state.org);
    }

    // ── Feriados (para etiqueta de fim de semana / feriado) ──
    let feriados = null;
    function refreshDayBadge() {
      dayText.textContent = fmtDateLabel(state.dateStr);
      dayInput.value = state.dateStr;
      const d = ymdToDate(state.dateStr);
      const wd = d.getDay();
      const holiday = feriados ? feriados[state.dateStr] : null;
      let label = null;
      if (holiday && holiday !== "FDS") label = "Feriado";
      else if (wd === 0 || wd === 6 || holiday === "FDS") label = "Fim de semana";
      if (label) {
        dayBadge.textContent = label;
        dayBadge.classList.remove("hidden");
      } else {
        dayBadge.textContent = "";
        dayBadge.classList.add("hidden");
      }
      dayPrev.classList.toggle("off", state.dateStr <= todayYMD());
      dayNext.classList.toggle("off", state.dateStr >= maxYMD());
    }
    fetch("./json/feriados.json")
      .then((r) => (r.ok ? r.json() : {}))
      .then((j) => {
        feriados = j;
        refreshDayBadge();
      })
      .catch(() => {});

    function refreshMode() {
      modeDep.setAttribute("aria-pressed", state.mode === "dep" ? "true" : "false");
      modeArr.setAttribute("aria-pressed", state.mode === "arr" ? "true" : "false");
    }
    function refreshTime() {
      timeText.textContent = state.timeStr;
      timeInput.value = state.timeStr;
    }

    // ── Emissão / Navegação ──
    let emitTimer = null;
    function detail(scroll) {
      return {
        org: state.org,
        dst: state.dst,
        dateStr: state.dateStr,
        mode: state.mode,
        timeStr: state.timeStr,
        scroll: scroll,
      };
    }
    function emit(scroll) {
      const ev = new CustomEvent("lt:search", {
        detail: detail(scroll),
        cancelable: true,
        bubbles: true,
      });
      const notPrevented = document.dispatchEvent(ev);
      // Se nenhum handler in-page tratou (não fez preventDefault) e não é inline,
      // navegamos para a página do planeador com os dados no URL.
      if (notPrevented && !inline) navigate();
    }
    function navigate() {
      const p = new URLSearchParams({
        org: state.org,
        dst: state.dst,
        date: state.dateStr,
        mode: state.mode,
        time: state.timeStr,
      });
      location.href = `${target}?${p.toString()}`;
    }
    function liveEmit() {
      if (!inline) return; // na página inicial só pesquisa ao carregar no botão
      clearTimeout(emitTimer);
      emitTimer = setTimeout(() => emit(false), 250);
    }

    // ── Listeners ──
    orgSel.addEventListener("change", () => {
      state.org = orgSel.value;
      if (state.dst === state.org) {
        const alt =
          preferredKeys().find((k) => k !== state.org) ||
          STATIONS.find((s) => s.key !== state.org).key;
        state.dst = alt;
      }
      buildSelect(dstSel, state.dst, state.org);
      liveEmit();
    });
    dstSel.addEventListener("change", () => {
      state.dst = dstSel.value;
      liveEmit();
    });
    $("swap").addEventListener("click", () => {
      const tmp = state.org;
      state.org = state.dst;
      state.dst = tmp;
      refreshSelects();
      liveEmit();
    });

    dayPrev.addEventListener("click", () => {
      state.dateStr = shiftDay(state.dateStr, -1);
      refreshDayBadge();
      liveEmit();
    });
    dayNext.addEventListener("click", () => {
      state.dateStr = shiftDay(state.dateStr, 1);
      refreshDayBadge();
      liveEmit();
    });
    $("day-label").addEventListener("click", () => {
      if (typeof dayInput.showPicker === "function") {
        try {
          dayInput.showPicker();
        } catch (e) {
          dayInput.focus();
        }
      }
    });
    dayInput.addEventListener("change", () => {
      if (dayInput.value) {
        state.dateStr = clampYMD(dayInput.value);
        refreshDayBadge();
        liveEmit();
      }
    });

    modeDep.addEventListener("click", () => {
      state.mode = "dep";
      refreshMode();
      liveEmit();
    });
    modeArr.addEventListener("click", () => {
      state.mode = "arr";
      refreshMode();
      liveEmit();
    });
    $("time-minus").addEventListener("click", () => {
      state.timeStr = shiftTime(state.timeStr, -10);
      refreshTime();
      liveEmit();
    });
    $("time-plus").addEventListener("click", () => {
      state.timeStr = shiftTime(state.timeStr, 10);
      refreshTime();
      liveEmit();
    });
    $("time-label").addEventListener("click", () => {
      if (typeof timeInput.showPicker === "function") {
        try {
          timeInput.showPicker();
        } catch (e) {
          timeInput.focus();
        }
      }
    });
    timeInput.addEventListener("change", () => {
      if (timeInput.value) {
        state.timeStr = timeInput.value;
        refreshTime();
        liveEmit();
      }
    });

    $("submit").addEventListener("click", () => {
      if (typeof window.sa_event === "function")
        window.sa_event("planear_search_submit");
      emit(true);
    });

    // ── Render inicial ──
    refreshSelects();
    refreshDayBadge();
    refreshMode();
    refreshTime();

    // Na página do planeador, dispara a pesquisa inicial automaticamente.
    if (inline) {
      requestAnimationFrame(() => emit(false));
    }

    // API pública mínima
    root.LTSearchBar = {
      getState: () => Object.assign({}, state),
      search: () => emit(true),
    };
  }

  function mountAll() {
    const nodes = document.querySelectorAll("#lt-searchbar, [data-lt-searchbar]");
    nodes.forEach(mount);
  }

  window.LTSearchBar = { mount, mountAll };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAll);
  } else {
    mountAll();
  }
})();

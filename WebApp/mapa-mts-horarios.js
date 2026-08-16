/**
 * mapa-mts-horarios.js · LiveTagus (mapa)
 * Modal de PRÓXIMAS PARTIDAS de uma estação do Metro Sul do Tejo (MTS).
 *
 * Espelha o visual/UX do mapa-station.js (Fertagus) — reaproveita a sheet
 * #details-panel/#details-backdrop, drag-to-close e o mesmo estilo zinc — mas
 * os dados são HORÁRIO ESTÁTICO (GTFS) carregado de /geojson/mts-horarios.json,
 * não há tempo real. Marca: logótipo + "Metro Sul do Tejo".
 *
 * Formato do JSON (compacto):
 *   stations[stop_id].dep[line][dir][service] = [minutos-desde-meia-noite...]
 *   (minutos podem passar de 1440 para partidas pós-meia-noite, ex. 1470=24:30)
 *   service ∈ {DS_inverno, DS_verao, SAB, DOM}; resolvido por data (ver pickService).
 *
 * API: window.MtsHorarios.open(station) | close() | isOpen() | refresh()
 *   station = { id, name, lines, line_colors }
 */

(function () {
  "use strict";

  const DATA_URL = "/json/mts-horarios.json";
  const LOGO = "/imagens/lig-logos/mts.svg";
  const SHOW = 14; // nº de partidas a mostrar
  let SCH = null; // schedule carregado
  let loading = null; // promessa de fetch

  let panel, backdrop;
  let currentStation = null;
  let tick = null; // intervalo de atualização do countdown

  // Drag state
  let dragActive = false,
    dragStartY = 0,
    dragLastY = 0,
    dragStartTs = 0;

  function ensureElements() {
    if (panel && backdrop) return;
    panel = document.getElementById("details-panel");
    backdrop = document.getElementById("details-backdrop");
    if (!panel || !backdrop)
      console.error("[MtsHorarios] Elementos DOM ausentes");
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function injectStyles() {
    if (document.getElementById("lt-mts-hor-styles")) return;
    const css = `
    .mts-pill{display:inline-flex;align-items:center;justify-content:center;
      min-width:22px;height:22px;padding:0 6px;border-radius:6px;
      font-size:12px;font-weight:800;line-height:1;letter-spacing:.02em;}
    .mts-dep-row{display:flex;align-items:center;gap:14px;padding:13px 4px;
      border-bottom:1px solid rgba(0,0,0,.06);}
    .dark .mts-dep-row{border-bottom-color:rgba(255,255,255,.06);}
    .mts-eta{font-variant-numeric:tabular-nums;}
    `;
    const el = document.createElement("style");
    el.id = "lt-mts-hor-styles";
    el.innerHTML = css;
    document.head.appendChild(el);
  }

  // ─── DADOS ───────────────────────────────────────────────────────────
  function loadData() {
    if (SCH) return Promise.resolve(SCH);
    if (loading) return loading;
    loading = fetch(DATA_URL)
      .then((r) => r.json())
      .then((j) => {
        SCH = j;
        return j;
      })
      .catch((e) => {
        console.error("[MtsHorarios] Erro ao carregar horários:", e);
        return null;
      });
    return loading;
  }

  // Data local (Europe/Lisbon) -> {ymd:"YYYYMMDD", dow:0-6(0=Dom), min:0-1439}
  function lisbonNow() {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Lisbon",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    });
    const p = {};
    for (const x of fmt.formatToParts(new Date())) p[x.type] = x.value;
    const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    let hh = parseInt(p.hour, 10);
    if (hh === 24) hh = 0;
    return {
      ymd: p.year + p.month + p.day,
      dow: dowMap[p.weekday],
      min: hh * 60 + parseInt(p.minute, 10),
    };
  }

  // YYYYMMDD - n dias
  function ymdMinus(ymd, n) {
    const d = new Date(
      +ymd.slice(0, 4),
      +ymd.slice(4, 6) - 1,
      +ymd.slice(6, 8),
    );
    d.setDate(d.getDate() - n);
    const z = (v) => String(v).padStart(2, "0");
    return "" + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate());
  }

  // Serviço ativo numa data: feriado/domingo->DOM, sáb->SAB, seg-sex->DS por época
  function pickService(ymd, dow) {
    if (SCH.domDates && SCH.domDates.indexOf(ymd) !== -1) return "DOM";
    if (dow === 0) return "DOM";
    if (dow === 6) return "SAB";
    const v = SCH.season_verao || [];
    if (v.length === 2 && ymd >= v[0] && ymd <= v[1]) return "DS_verao";
    return "DS_inverno";
  }

  // Lista de próximas partidas para a estação (merge de todas as linhas/sentidos)
  function upcoming(stopId) {
    const st = SCH.stations[String(stopId)];
    if (!st || !st.dep) return [];
    const now = lisbonNow();
    const svcToday = pickService(now.ymd, now.dow);
    const yYmd = ymdMinus(now.ymd, 1);
    const yDow = (now.dow + 6) % 7;
    const svcYest = pickService(yYmd, yDow);

    const list = [];
    for (const line in st.dep) {
      for (const dir in st.dep[line]) {
        const dest = (SCH.lines[line].dirs || {})[dir] || "";
        const block = st.dep[line][dir];
        // hoje: offset = t (t>=1440 => madrugada do dia seguinte)
        (block[svcToday] || []).forEach((t) => {
          if (t >= now.min) list.push({ off: t, line, dest });
        });
        // madrugada de hoje vinda do serviço de ontem (t>=1440 -> off=t-1440)
        (block[svcYest] || []).forEach((t) => {
          if (t >= 1440) {
            const off = t - 1440;
            if (off >= now.min) list.push({ off, line, dest });
          }
        });
      }
    }
    list.sort((a, b) => a.off - b.off);
    // dedupe defensivo
    const seen = new Set();
    const out = [];
    for (const d of list) {
      const k = d.off + "|" + d.line + "|" + d.dest;
      if (seen.has(k)) continue;
      seen.add(k);
      d.eta = d.off - now.min;
      out.push(d);
      if (out.length >= SHOW) break;
    }
    return out;
  }

  function fmtClock(off) {
    const m = off % 1440;
    return (
      String(Math.floor(m / 60)).padStart(2, "0") +
      ":" +
      String(m % 60).padStart(2, "0")
    );
  }
  function fmtEta(eta) {
    if (eta <= 0) return { big: "agora", small: "" };
    if (eta < 60) return { big: String(eta), small: "min" };
    const h = Math.floor(eta / 60),
      m = eta % 60;
    return { big: h + "h" + (m ? String(m).padStart(2, "0") : ""), small: "" };
  }

  function lineColor(line) {
    const l = SCH.lines[line] || {};
    return { bg: l.color || "#000", fg: l.text || "#fff" };
  }

  // ─── HTML ────────────────────────────────────────────────────────────
  function depListHtml(stopId) {
    const deps = upcoming(stopId);
    if (!deps.length) {
      return `
        <div class="px-1 py-16 text-center">
          <i data-lucide="moon" class="w-8 h-8 mx-auto text-zinc-300 dark:text-zinc-700"></i>
          <p class="text-sm text-zinc-500 mt-3">Sem partidas para já.</p>
          <p class="text-[11px] text-zinc-400 mt-1">O serviço retoma de madrugada.</p>
        </div>`;
    }
    return deps
      .map((d) => {
        const c = lineColor(d.line);
        const eta = fmtEta(d.eta);
        return `
        <div class="mts-dep-row">
          <span class="mts-pill" style="background:${c.bg};color:${c.fg};">${escapeHtml(d.line)}</span>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-zinc-900 dark:text-white truncate">${escapeHtml(d.dest)}</p>
            <p class="text-[11px] uppercase tracking-[0.15em] text-zinc-400 dark:text-zinc-500 mt-0.5">${fmtClock(d.off)}</p>
          </div>
          <div class="text-right shrink-0 mts-eta">
            <span class="text-xl font-light text-zinc-900 dark:text-white">${eta.big}</span>${eta.small ? `<span class="text-[10px] text-zinc-400 ml-0.5">${eta.small}</span>` : ""}
          </div>
        </div>`;
      })
      .join("");
  }

  function shellHtml(station) {
    const linePills = (station.lines || [])
      .map((l) => {
        const c = lineColor(l);
        return `<span class="mts-pill" style="background:${c.bg};color:${c.fg};">${escapeHtml(l)}</span>`;
      })
      .join("");
    return `
      <div class="flex flex-col h-full bg-white dark:bg-[#09090b]">
        <div class="dp-handle md:hidden shrink-0" data-drag-area="1" aria-hidden="true">
          <div class="dp-handle-pill"></div>
        </div>

        <div class="dp-header relative shrink-0 px-6 pt-3 md:pt-safe-ios md:pt-5 pb-5 border-b border-zinc-100 dark:border-zinc-900" data-drag-area="1">
          <button data-mts-action="close"
            class="absolute right-4 top-3 md:top-5 w-10 h-10 flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
            aria-label="Fechar">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>

          <div class="flex items-center gap-2 mb-3">
            <img src="${LOGO}" alt="MTS" class="w-5 h-5 object-contain" onerror="this.style.display='none'">
            <span class="text-[9px] font-bold tracking-[0.3em] uppercase text-zinc-500 dark:text-zinc-400">Metro Sul do Tejo</span>
            <span class="h-px flex-1 max-w-16 bg-zinc-200 dark:bg-zinc-800"></span>
          </div>
          <div class="flex items-center gap-3">
            <h2 class="text-3xl font-light tracking-tighter text-zinc-900 dark:text-white leading-[1.05]">
              ${escapeHtml(station.name)}
            </h2>
            <div class="flex items-center gap-1.5 shrink-0">${linePills}</div>
          </div>
          <p class="text-[11px] uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-500 mt-2">Próximas Partidas</p>
        </div>

        <div class="flex-1 overflow-y-auto px-5 pt-3 pb-2" data-details-scroll="1">
          <div data-mts-list="1">${depListHtml(station.id)}</div>
          <div class="px-1 py-6 text-center">
            <p class="text-[9px] leading-relaxed text-zinc-400 dark:text-zinc-600 tracking-wide max-w-xs mx-auto">
              Horário oficial MTS. Os tempos são programados e podem variar do serviço real.
            </p>
          </div>
        </div>
      </div>`;
  }

  function renderList() {
    if (!currentStation || !panel) return;
    const host = panel.querySelector("[data-mts-list]");
    if (host) host.innerHTML = depListHtml(currentStation.id);
    if (window.lucide) window.lucide.createIcons();
  }

  // ─── DRAG (swipe down -> fechar) ─────────────────────────────────────
  function pointerY(e) {
    if (e.touches && e.touches.length) return e.touches[0].clientY;
    if (e.changedTouches && e.changedTouches.length)
      return e.changedTouches[0].clientY;
    return e.clientY || 0;
  }
  function isDragArea(t) {
    let el = t;
    while (el && el !== panel) {
      if (el.dataset && el.dataset.dragArea === "1") return true;
      if (el.dataset && el.dataset.detailsScroll === "1") return false;
      el = el.parentElement;
    }
    return false;
  }
  function onDown(e) {
    if (!currentStation || !isDragArea(e.target)) return;
    if (window.matchMedia("(min-width: 768px)").matches) return;
    dragActive = true;
    dragStartY = dragLastY = pointerY(e);
    dragStartTs = Date.now();
    panel.style.transition = "none";
  }
  function onMove(e) {
    if (!dragActive) return;
    const y = pointerY(e);
    dragLastY = y;
    const dy = Math.max(0, y - dragStartY);
    panel.style.transform = `translateY(${dy}px)`;
    if (backdrop && !backdrop.classList.contains("hidden"))
      backdrop.style.opacity = String(Math.max(0, 1 - dy / 300));
  }
  function onUp() {
    if (!dragActive) return;
    dragActive = false;
    const dy = dragLastY - dragStartY;
    const dt = Date.now() - dragStartTs;
    const v = dt > 0 ? dy / dt : 0;
    panel.style.transition = "";
    panel.style.transform = "";
    if (backdrop) backdrop.style.opacity = "";
    if (dy > 110 || (v > 0.6 && dy > 40)) close();
  }
  function attachDrag() {
    if (!panel) return;
    panel.addEventListener("touchstart", onDown, { passive: true });
    panel.addEventListener("touchmove", onMove, { passive: true });
    panel.addEventListener("touchend", onUp, { passive: true });
    panel.addEventListener("touchcancel", onUp, { passive: true });
    panel.addEventListener("pointerdown", onDown);
    panel.addEventListener("pointermove", onMove);
    panel.addEventListener("pointerup", onUp);
    panel.addEventListener("pointercancel", onUp);
  }
  function detachDrag() {
    if (!panel) return;
    panel.removeEventListener("touchstart", onDown);
    panel.removeEventListener("touchmove", onMove);
    panel.removeEventListener("touchend", onUp);
    panel.removeEventListener("touchcancel", onUp);
    panel.removeEventListener("pointerdown", onDown);
    panel.removeEventListener("pointermove", onMove);
    panel.removeEventListener("pointerup", onUp);
    panel.removeEventListener("pointercancel", onUp);
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }
  function onBackdrop() {
    close();
  }

  // ─── PÚBLICO ─────────────────────────────────────────────────────────
  function open(station) {
    if (!station) return;
    injectStyles();
    ensureElements();
    if (!panel || !backdrop) return;

    // Fechar outras sheets que partilham o painel.
    if (window.MapaStation && window.MapaStation.isOpen())
      window.MapaStation.close({ silent: true });
    if (window.MapaDetails && window.MapaDetails.isOpen())
      window.MapaDetails.close();
    if (window.MapaCM && window.MapaCM.isOpen()) window.MapaCM.close();

    loadData().then((sch) => {
      if (!sch) return;
      currentStation = station;

      panel.innerHTML = shellHtml(station);
      panel
        .querySelectorAll("[data-mts-action='close']")
        .forEach((b) => b.addEventListener("click", () => close()));

      const sc = panel.querySelector('[data-details-scroll="1"]');
      if (sc) sc.scrollTop = 0;

      panel.dataset.state = "mts";
      panel.classList.remove("translate-y-full");
      panel.classList.add("translate-y-0");
      backdrop.classList.remove("hidden", "opacity-0", "pointer-events-none");
      backdrop.classList.add("opacity-100");

      document.addEventListener("keydown", onKey);
      backdrop.addEventListener("click", onBackdrop);
      attachDrag();

      if (window.lucide) window.lucide.createIcons();

      // Atualiza o countdown periodicamente.
      if (tick) clearInterval(tick);
      tick = setInterval(renderList, 30000);
    });
  }

  function close() {
    ensureElements();
    if (!panel || !backdrop) return;
    if (tick) {
      clearInterval(tick);
      tick = null;
    }
    panel.classList.add("translate-y-full");
    panel.classList.remove("translate-y-0");
    panel.dataset.state = "closed";
    backdrop.classList.add("opacity-0", "pointer-events-none");
    backdrop.classList.remove("opacity-100");
    backdrop.removeEventListener("click", onBackdrop);
    document.removeEventListener("keydown", onKey);
    detachDrag();
    const wasStation = currentStation;
    currentStation = null;
    setTimeout(() => {
      backdrop.classList.add("hidden");
      if (wasStation && panel.dataset.state === "closed") panel.innerHTML = "";
    }, 320);
  }

  function isOpen() {
    return !!currentStation;
  }
  function refresh() {
    if (isOpen()) renderList();
  }

  window.MtsHorarios = { open, close, isOpen, refresh };
})();

/**
 * mapa-station.js  ·  LiveTagus (mapa)
 * Modal de detalhes de uma ESTAÇÃO no mapa: próximas partidas por sentido.
 *
 * v3 (2026-06): a renderização das partidas passou para o módulo PARTILHADO
 * window.Partidas (partidas.js) — o mesmo usado na página /estacao. Aqui ficam
 * apenas: gestão da sheet (#details-panel/#details-backdrop reaproveitados do
 * mapa-details), drag-to-close, e a ponte de clique no comboio:
 *   • Comboio AO VIVO  → abre o detalhe rico do mapa (MapaDetails) com o objeto
 *     completo (nós + geo) resolvido a partir da fonte de comboios do mapa.
 *   • Não-vivo (extra/programado/suprimido) → o Partidas trata (sheet própria
 *     com o percurso via /fertagus ou via JSON de horários).
 *
 * Edge cases (manutenção, IP/API offline, modo offline, trajetos anormais, sem
 * partidas) são todos tratados dentro do Partidas.
 */

(function () {
  "use strict";

  let panel, backdrop;
  let currentStation = null;
  let partidasCtrl = null;
  let trainsSource = null; // () => Array (comboios processados do mapa)

  // Drag state
  let dragActive = false;
  let dragStartY = 0;
  let dragLastY = 0;
  let dragStartTs = 0;

  function ensureElements() {
    if (panel && backdrop) return;
    panel = document.getElementById("details-panel");
    backdrop = document.getElementById("details-backdrop");
    if (!panel || !backdrop)
      console.error("[MapaStation] Elementos DOM ausentes");
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ─── SHELL DO PAINEL ─────────────────────────────────────────────────
  function shellHtml(station) {
    return `
      <div class="flex flex-col h-full bg-white dark:bg-[#09090b]">
        <div class="dp-handle md:hidden shrink-0" data-drag-area="1" aria-hidden="true">
          <div class="dp-handle-pill"></div>
        </div>

        <div class="dp-header relative shrink-0 px-6 pt-3 md:pt-safe-ios md:pt-5 pb-5 border-b border-zinc-100 dark:border-zinc-900" data-drag-area="1">
          <button data-details-action="close"
            class="absolute right-4 top-3 md:top-5 w-10 h-10 flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
            aria-label="Fechar">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>

          <div class="flex items-center gap-2 mb-3">
            <span class="text-[9px] font-bold tracking-[0.3em] uppercase text-blue-600 dark:text-blue-400">Estação</span>
            <span class="h-px flex-1 max-w-16 bg-zinc-200 dark:bg-zinc-800"></span>
          </div>
          <h2 class="text-3xl font-light tracking-tighter text-zinc-900 dark:text-white leading-[1.05]">
            ${escapeHtml(station.name)}
          </h2>
          <p class="text-[11px] uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-500 mt-2">Próximas Partidas</p>
        </div>

        <div class="flex-1 overflow-y-auto px-5 pt-5 pb-2" data-details-scroll="1">
          <div data-ltp-mount="1"></div>
          <div class="px-1 py-6 text-center">
            <p class="text-[9px] leading-relaxed text-zinc-400 dark:text-zinc-600 tracking-wide max-w-xs mx-auto">
              Partidas ao vivo ou previstas no horário. Os dados podem variar em função da Fertagus/Infraestruturas de Portugal.
            </p>
          </div>
          <a href="/estacao/${escapeHtml(String(station.name).toLowerCase())}?tab=ligacoes"
            class="w-[calc(100%-1rem)] mx-auto mb-6 py-4 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-[0.25em] border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors rounded-md">
            Ver Ligações na Estação
          </a>
        </div>
      </div>`;
  }

  // ─── CLIQUE NUM COMBOIO AO VIVO (caso 1) ─────────────────────────────
  function onLiveTrain(dep) {
    const src = trainsSource && trainsSource();
    const full = Array.isArray(src)
      ? src.find((t) => String(t.id) === String(dep.id))
      : null;
    // Fecha este modal em silêncio (sem recenter) — o MapaDetails aplica o seu foco.
    close({ silent: true });
    setTimeout(() => {
      if (full && window.MapaDetails) {
        window.MapaDetails.open(full);
      } else {
        // Fallback: deep-link por hash (o mapa abre o comboio se existir).
        window.location.href = `/mapa#${encodeURIComponent(dep.id)}`;
      }
    }, 180);
  }

  function mountPartidas() {
    const host = panel.querySelector("[data-ltp-mount]");
    if (!host || !window.Partidas) return;
    if (partidasCtrl) {
      try {
        partidasCtrl.destroy();
      } catch (_) {}
      partidasCtrl = null;
    }
    partidasCtrl = window.Partidas.mount({
      container: host,
      station: currentStation,
      context: "map",
      autoRefresh: 0, // o mapa controla via refresh()
      detectMaintenance: true, // mostra aviso de manutenção se ativo
      onLiveTrain,
    });
  }

  // ─── DRAG GESTURES (swipe down → fechar) ─────────────────────────────
  function pointerY(e) {
    if (e.touches && e.touches.length) return e.touches[0].clientY;
    if (e.changedTouches && e.changedTouches.length)
      return e.changedTouches[0].clientY;
    return e.clientY || 0;
  }
  function isDragAreaTarget(target) {
    let el = target;
    while (el && el !== panel) {
      if (el.dataset && el.dataset.dragArea === "1") return true;
      if (el.dataset && el.dataset.detailsScroll === "1") return false;
      el = el.parentElement;
    }
    return false;
  }
  function onPointerDown(e) {
    if (!currentStation) return;
    if (!isDragAreaTarget(e.target)) return;
    if (window.matchMedia("(min-width: 768px)").matches) return;
    dragActive = true;
    dragStartY = pointerY(e);
    dragLastY = dragStartY;
    dragStartTs = Date.now();
    panel.style.transition = "none";
  }
  function onPointerMove(e) {
    if (!dragActive) return;
    const y = pointerY(e);
    dragLastY = y;
    const dy = Math.max(0, y - dragStartY);
    panel.style.transform = `translateY(${dy}px)`;
    if (backdrop && !backdrop.classList.contains("hidden")) {
      backdrop.style.opacity = String(Math.max(0, 1 - dy / 300));
    }
  }
  function onPointerUp() {
    if (!dragActive) return;
    dragActive = false;
    const dy = dragLastY - dragStartY;
    const dt = Date.now() - dragStartTs;
    const velocity = dt > 0 ? dy / dt : 0;
    panel.style.transition = "";
    panel.style.transform = "";
    if (backdrop) backdrop.style.opacity = "";
    if (dy > 110 || (velocity > 0.6 && dy > 40)) close();
  }
  function attachDragHandlers() {
    if (!panel) return;
    panel.addEventListener("touchstart", onPointerDown, { passive: true });
    panel.addEventListener("touchmove", onPointerMove, { passive: true });
    panel.addEventListener("touchend", onPointerUp, { passive: true });
    panel.addEventListener("touchcancel", onPointerUp, { passive: true });
    panel.addEventListener("pointerdown", onPointerDown);
    panel.addEventListener("pointermove", onPointerMove);
    panel.addEventListener("pointerup", onPointerUp);
    panel.addEventListener("pointercancel", onPointerUp);
  }
  function detachDragHandlers() {
    if (!panel) return;
    panel.removeEventListener("touchstart", onPointerDown);
    panel.removeEventListener("touchmove", onPointerMove);
    panel.removeEventListener("touchend", onPointerUp);
    panel.removeEventListener("touchcancel", onPointerUp);
    panel.removeEventListener("pointerdown", onPointerDown);
    panel.removeEventListener("pointermove", onPointerMove);
    panel.removeEventListener("pointerup", onPointerUp);
    panel.removeEventListener("pointercancel", onPointerUp);
  }

  // ─── EVENTOS DO SHELL ────────────────────────────────────────────────
  function attachShellListeners() {
    panel.querySelectorAll("[data-details-action='close']").forEach((b) => {
      b.addEventListener("click", () => close());
    });
  }

  // ─── AÇÕES PÚBLICAS ──────────────────────────────────────────────────
  function open(station) {
    if (window.MapaCM && window.MapaCM.isOpen()) window.MapaCM.close();
    ensureElements();
    if (!panel || !backdrop || !station) return;

    if (window.MapaDetails && window.MapaDetails.isOpen())
      window.MapaDetails.close();

    currentStation = station;
    if (window.MapaRender) window.MapaRender.focusStation(station);

    panel.innerHTML = shellHtml(station);
    attachShellListeners();
    mountPartidas();

    const sc = panel.querySelector('[data-details-scroll="1"]');
    if (sc) sc.scrollTop = 0;

    panel.dataset.state = "station";
    panel.classList.remove("translate-y-full");
    panel.classList.add("translate-y-0");
    backdrop.classList.remove("hidden", "opacity-0", "pointer-events-none");
    backdrop.classList.add("opacity-100");

    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", onBackdropClick);
    attachDragHandlers();

    if (window.lucide) window.lucide.createIcons();
  }

  function onBackdropClick() {
    close();
  }

  function close(opts) {
    ensureElements();
    if (!panel || !backdrop) return;
    const silent = !!(opts && opts.silent);

    if (partidasCtrl) {
      try {
        partidasCtrl.destroy();
      } catch (_) {}
      partidasCtrl = null;
    }
    if (window.Partidas && window.Partidas.closeSheet)
      window.Partidas.closeSheet();

    panel.classList.add("translate-y-full");
    panel.classList.remove("translate-y-0");
    panel.dataset.state = "closed";
    backdrop.classList.add("opacity-0", "pointer-events-none");
    backdrop.classList.remove("opacity-100");

    backdrop.removeEventListener("click", onBackdropClick);
    document.removeEventListener("keydown", onKey);
    detachDragHandlers();

    setTimeout(() => {
      backdrop.classList.add("hidden");
      if (currentStation !== null && panel.dataset.state === "closed")
        panel.innerHTML = "";
    }, 320);
    currentStation = null;

    //if (!silent && window.MapaRender) window.MapaRender.showWholeLine();
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }
  function isOpen() {
    return !!currentStation;
  }
  function refresh() {
    if (!isOpen() || !partidasCtrl) return;
    partidasCtrl.refresh(false);
  }
  function setTrainsSource(fn) {
    trainsSource = fn;
  }

  window.MapaStation = { open, close, isOpen, refresh, setTrainsSource };
})();

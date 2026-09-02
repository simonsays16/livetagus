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
  // Hora (epoch ms) a partir da qual as partidas interessam. Vem de quem abre o
  // painel — por exemplo, o percurso de um comboio da CP que faz ligação aqui:
  // só as partidas que a pessoa consegue apanhar à chegada.
  let currentFrom = null;
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

  // ─── TROCA PARA A CP ─────────────────────────────────────────────────
  // Nas estações que a Fertagus partilha com a CP, um botão ao lado da cruz
  // para saltar para o painel da CP. O cruzamento vem do mapa-gtfs-horarios.js,
  // que já cruza o ligacoes.json com as estações da CP desenhadas no mapa.
  const CP_LOGO = "/imagens/lig-logos/cp.svg";

  function cpStationFor(station) {
    if (!station || !window.GtfsHorarios || !window.GtfsHorarios.cpStationFor)
      return null;
    try {
      return window.GtfsHorarios.cpStationFor(station.name) || null;
    } catch (_) {
      return null;
    }
  }

  // O cruzamento Fertagus/CP depende do ligacoes.json e das estações da CP,
  // ambos assíncronos. Se ainda não estiverem prontos quando a sheet abre, o
  // botão é inserido depois — em vez de simplesmente não existir, que era o que
  // acontecia a quem clicasse numa estação sem nunca ter aberto outro painel.
  function refreshSwapCp(station) {
    if (!panel || !station || !window.GtfsHorarios) return;
    const fn = window.GtfsHorarios.sharedFertagusCp;
    if (typeof fn !== "function") return;
    fn()
      .then(() => {
        // A sheet pode ter fechado ou mudado de estação entretanto.
        if (!panel || currentStation !== station) return;
        const header = panel.querySelector(".dp-header");
        if (!header) return;
        const existe = header.querySelector("[data-details-action='swap-cp']");
        const html = swapCpHtml(station);
        if (!html) {
          if (existe) existe.remove();
          return;
        }
        if (existe) return;
        header.insertAdjacentHTML("afterbegin", html);
        attachShellListeners();
      })
      .catch(() => {});
  }

  function swapCpHtml(station) {
    const cp = cpStationFor(station);
    if (!cp) return "";
    return `<button type="button" class="ltg-swap" data-details-action="swap-cp"
        title="Ver ${escapeHtml(station.name)} na CP"
        aria-label="Trocar para a estação ${escapeHtml(station.name)} da CP">
        <img src="${CP_LOGO}" alt="" data-swap-logo></button>`;
  }

  // Mesmo bloco de estilos que o mapa-gtfs-horarios.js injecta: o id partilhado
  // faz com que só o primeiro a chegar o escreva.
  function injectSwapStyles() {
    if (document.getElementById("lt-swap-styles")) return;
    const el = document.createElement("style");
    el.id = "lt-swap-styles";
    el.textContent = `
    .ltg-swap{position:absolute;right:3.5rem;top:.75rem;width:40px;height:40px;
      display:inline-flex;align-items:center;justify-content:center;padding:0;
      border-radius:9999px;border:1px solid rgba(0,0,0,.55);background:#fff;
      cursor:pointer;transition:transform .12s ease,box-shadow .16s ease;}
    html.dark .ltg-swap{border-color:rgba(255,255,255,.5);}
    .ltg-swap img{width:20px;height:20px;object-fit:contain;display:block;}
    .ltg-swap:hover{box-shadow:0 2px 10px rgba(0,0,0,.18);}
    .ltg-swap:active{transform:scale(.9);}
    .ltg-swap:focus-visible{outline:2px solid rgb(59 130 246);outline-offset:2px;}
    @media (min-width:768px){.ltg-swap{top:1.25rem;}}`;
    document.head.appendChild(el);
  }

  // ─── SHELL DO PAINEL ─────────────────────────────────────────────────
  function shellHtml(station) {
    return `
      <div class="flex flex-col h-full bg-white dark:bg-[#09090b]">
        <div class="dp-handle md:hidden shrink-0" data-drag-area="1" aria-hidden="true">
          <div class="dp-handle-pill"></div>
        </div>

        <div class="dp-header relative shrink-0 px-6 pt-3 md:pt-safe-ios md:pt-5 pb-5 border-b border-zinc-100 dark:border-zinc-900" data-drag-area="1">
          ${swapCpHtml(station)}
          <button data-details-action="close"
            class="absolute right-4 top-3 md:top-5 w-10 h-10 flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
            aria-label="Fechar">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>

          <div class="flex items-center gap-2 mb-3">
            <img src="./imagens/lig-logos/fertagus.png" alt="MTS" class="w-5 h-5 object-contain" onerror="this.style.display='none'">
            <span class="text-[9px] font-bold tracking-[0.3em] uppercase text-blue-600 dark:text-blue-400">Fertagus</span>
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
      fromTime: currentFrom,
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
    // Pode ser chamado duas vezes (a segunda ao inserir o botão da CP), por
    // isso cada botão é marcado depois de ligado.
    panel.querySelectorAll("[data-details-action='close']").forEach((b) => {
      if (b.dataset.bound === "1") return;
      b.dataset.bound = "1";
      b.addEventListener("click", () => close());
    });
    panel.querySelectorAll("[data-details-action='swap-cp']").forEach((b) => {
      if (b.dataset.bound === "1") return;
      b.dataset.bound = "1";
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const cp = cpStationFor(currentStation);
        if (!cp) return;
        close({ silent: true });
        setTimeout(() => {
          if (window.GtfsHorarios)
            window.GtfsHorarios.openStop("cp", cp.stopId, { name: cp.name });
        }, 140);
      });
    });
    // Sem onerror inline (CSP): sem logótipo, o botão sairia vazio.
    panel.querySelectorAll("[data-swap-logo]").forEach((img) => {
      img.addEventListener(
        "error",
        function () {
          const b = this.closest(".ltg-swap");
          if (b) b.remove();
        },
        { once: true },
      );
    });
  }

  // ─── AÇÕES PÚBLICAS ──────────────────────────────────────────────────
  function open(station, opts) {
    currentFrom =
      opts && typeof opts.fromTime === "number" && isFinite(opts.fromTime)
        ? opts.fromTime
        : null;
    if (window.MapaCM && window.MapaCM.isOpen()) window.MapaCM.close();
    injectSwapStyles();
    ensureElements();
    if (!panel || !backdrop || !station) return;

    if (window.MapaDetails && window.MapaDetails.isOpen())
      window.MapaDetails.close();

    currentStation = station;
    // Pinta de verde o círculo desta estação. Directo, e não à espera de que o
    // mapa-selecao.js envolva este método: o envolvimento depende da ordem de
    // carregamento dos scripts e é resolvido por polling.
    if (window.MapaSelecao)
      window.MapaSelecao.set({
        op: "fertagus",
        id: station.id != null ? station.id : null,
        name: station.name || null,
        lng: typeof station.lng === "number" ? station.lng : null,
        lat: typeof station.lat === "number" ? station.lat : null,
      });
    if (window.MapaRender) window.MapaRender.focusStation(station);

    panel.innerHTML = shellHtml(station);
    attachShellListeners();
    refreshSwapCp(station);
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

    // Tira o verde da estação. Tem de ser AQUI e não no window.MapaStation.close:
    // o X, o Escape, o clique no fundo e o arrasto chamam esta função local
    // directamente, sem passar pela propriedade exportada — que é a única coisa
    // que o mapa-selecao.js consegue envolver de fora.
    if (window.MapaSelecao) window.MapaSelecao.clear();

    if (partidasCtrl) {
      try {
        partidasCtrl.destroy();
      } catch (_) {}
      partidasCtrl = null;
    }
    if (window.Partidas && window.Partidas.closeSheet)
      window.Partidas.closeSheet();
    // O filtro é de quem abriu esta vez: não pode sobreviver ao fecho.
    currentFrom = null;

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

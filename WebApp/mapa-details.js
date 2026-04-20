/**
 * mapa-details.js
 * Painel de detalhes de um COMBOIO.
 */

(function () {
  "use strict";

  let panel, backdrop;
  let currentTrainId = null;

  function ensureElements() {
    if (panel && backdrop) return;
    panel = document.getElementById("details-panel");
    backdrop = document.getElementById("details-backdrop");
    if (!panel || !backdrop) {
      console.error("[MapaDetails] Elementos DOM ausentes");
    }
  }

  // ─── HELPERS ─────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function statusChipHtml(train) {
    const ring = MAPA.STATUS_COLORS[train.dotStatus] || MAPA.STATUS_COLORS.gray;
    const pulse = train.dotStatus === "orange" || train.dotStatus === "red";
    return `
      <div class="inline-flex items-center gap-2 px-3 py-1.5 border border-zinc-200 dark:border-zinc-800 rounded-full bg-white/40 dark:bg-zinc-900/40 backdrop-blur">
        <span class="block w-1.5 h-1.5 rounded-full ${pulse ? "animate-pulse" : ""}" style="background-color:${ring}; box-shadow:0 0 6px ${ring}"></span>
        <span class="text-[9px] font-bold tracking-[0.2em] uppercase text-zinc-700 dark:text-zinc-300">${escapeHtml(train.statusText)}</span>
      </div>`;
  }

  function occupancyBlockHtml(train) {
    if (train.occupancy == null) {
      return `
        <div class="flex flex-col">
          <span class="text-[9px] uppercase tracking-[0.2em] text-zinc-400 mb-1.5">Ocupação</span>
          <span class="text-[11px] text-zinc-500 italic">Apenas em horas de ponta</span>
        </div>`;
    }
    const fill = window.MapaRender._carriageFillColor(train);
    return `
      <div class="flex flex-col">
        <span class="text-[9px] uppercase tracking-[0.2em] text-zinc-400 mb-1.5">Ocupação</span>
        <div class="flex items-baseline gap-1.5">
          <span class="font-mono text-2xl font-light tracking-tighter text-zinc-900 dark:text-white leading-none">${train.occupancy}</span>
          <span class="text-[10px] text-zinc-400 font-medium">%</span>
        </div>
        <div class="mt-2 h-[2px] bg-zinc-100 dark:bg-zinc-900 overflow-hidden">
          <div style="width:${Math.min(100, train.occupancy)}%; background-color:${fill}; height:100%; transition:width .4s ease;"></div>
        </div>
      </div>`;
  }

  function carriagesBlockHtml(train) {
    const count = train.carriages || 4;
    const filled = window.MapaRender._filledCarriages(train);
    const fill = window.MapaRender._carriageFillColor(train);
    const blocks = [];
    for (let i = 0; i < count; i++) {
      const on = i < filled;
      blocks.push(
        `<div class="h-1.5 flex-1" style="background-color:${on ? fill : "rgba(161,161,170,.25)"}"></div>`,
      );
    }
    return `
      <div class="flex flex-col">
        <span class="text-[9px] uppercase tracking-[0.2em] text-zinc-400 mb-1.5">Carruagens</span>
        <div class="flex items-baseline gap-1.5">
          <span class="font-mono text-2xl font-light tracking-tighter text-zinc-900 dark:text-white leading-none">${count}</span>
          <span class="text-[10px] text-zinc-400 font-medium">unid.</span>
        </div>
        <div class="mt-2 flex gap-[2px]">${blocks.join("")}</div>
      </div>`;
  }

  /**
   * Timeline de estações. Calcula atraso POR NÓ (HoraPrevista vs HoraProgramada),
   * não através do SituacaoComboio — consistente com o modal da estação.
   */
  function timelineHtml(train) {
    const nodes = train.nodes || [];
    if (!nodes.length) {
      return `<p class="text-[10px] text-zinc-400 italic text-center py-8">Sem paragens registadas.</p>`;
    }
    const items = nodes.map((n, i) => {
      const station = MAPA.resolveStationByApiName(n.NomeEstacao);
      const name = station ? station.name : n.NomeEstacao;
      const passed = n.ComboioPassou;
      const isCurrent = !passed && (i === 0 || nodes[i - 1].ComboioPassou);

      const scheduled = (n.HoraProgramada || "").substring(0, 5);
      const predicted = (n.HoraPrevista || "").substring(0, 5);
      const hasDelay =
        scheduled &&
        predicted &&
        !predicted.startsWith("HH") &&
        predicted !== scheduled &&
        !train.isSuppressed;
      const showTime = hasDelay ? predicted : scheduled;
      const subTime = hasDelay ? scheduled : "";

      let dotCls =
        "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950";
      let timeCls = "text-zinc-400";
      let nameCls = "text-zinc-500 dark:text-zinc-500";
      if (passed) {
        dotCls =
          "border-zinc-400 bg-zinc-400 dark:border-zinc-600 dark:bg-zinc-600";
        timeCls = "text-zinc-500";
        nameCls = "text-zinc-400 dark:text-zinc-600 line-through";
      } else if (isCurrent) {
        dotCls = "border-blue-500 bg-blue-500 ring-4 ring-blue-500/20";
        timeCls = hasDelay
          ? "text-amber-600 dark:text-amber-400 font-semibold"
          : "text-blue-600 dark:text-blue-400 font-semibold";
        nameCls = "text-zinc-900 dark:text-white font-semibold";
      }

      const label = isCurrent
        ? `<span class="text-[8px] tracking-[0.25em] uppercase text-blue-500 mt-1 block">Próxima</span>`
        : i === 0
          ? `<span class="text-[8px] tracking-[0.25em] uppercase text-zinc-400 mt-1 block">Partida</span>`
          : i === nodes.length - 1
            ? `<span class="text-[8px] tracking-[0.25em] uppercase text-zinc-400 mt-1 block">Chegada</span>`
            : "";

      return `
        <div class="relative flex items-start gap-5 pb-7 last:pb-0">
          <div class="w-12 text-right shrink-0 flex flex-col items-end">
            <span class="font-mono text-sm ${timeCls} leading-none">${showTime || "--:--"}</span>
            ${subTime ? `<span class="text-[9px] text-zinc-400 line-through mt-1 font-mono">${subTime}</span>` : ""}
          </div>
          <div class="relative shrink-0 pt-[5px]">
            <div class="w-2.5 h-2.5 rounded-full border ${dotCls} relative z-10"></div>
          </div>
          <div class="flex-1 pt-0.5">
            <h4 class="text-[13px] uppercase tracking-wide ${nameCls} leading-tight">${escapeHtml(name)}</h4>
            ${label}
          </div>
        </div>`;
    });

    return `
      <div class="relative">
        <div class="absolute left-[calc(3rem+20px+5px)] top-2 bottom-6 w-px bg-zinc-200 dark:bg-zinc-800"></div>
        ${items.join("")}
      </div>`;
  }

  // ─── PAINEL COMPLETO ─────────────────────────────────────────────────

  function buildContent(train) {
    const firstNode = train.nodes && train.nodes[0];
    const lastNode = train.nodes && train.nodes[train.nodes.length - 1];
    const departTime =
      (firstNode &&
        (firstNode.HoraPrevista || firstNode.HoraProgramada || "").substring(
          0,
          5,
        )) ||
      "--:--";
    const arriveTime =
      (lastNode &&
        (lastNode.HoraPrevista || lastNode.HoraProgramada || "").substring(
          0,
          5,
        )) ||
      "--:--";

    return `
      <div class="flex flex-col h-full max-h-[85dvh] md:max-h-[80dvh] bg-white dark:bg-[#09090b]">
        <!-- HEADER -->
        <div class="relative shrink-0 px-6 pt-safe-ios pt-5 pb-6 border-b border-zinc-100 dark:border-zinc-900">
          <button
            data-details-action="close"
            class="absolute right-4 top-5 w-10 h-10 flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
            aria-label="Fechar">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>

          <div class="flex items-center gap-2 mb-4">
            <span class="text-[9px] font-bold tracking-[0.3em] uppercase text-blue-600 dark:text-blue-400">Fertagus</span>
            ${train.isExtra ? `<span class="text-[9px] font-bold tracking-[0.3em] uppercase text-blue-500 border border-blue-500/30 px-2 py-0.5">Extra</span>` : ""}
            <span class="h-px flex-1 max-w-16 bg-zinc-200 dark:bg-zinc-800"></span>
            <span class="text-[9px] font-mono tracking-wider text-zinc-400">#${escapeHtml(train.numero)}</span>
          </div>

          <h2 class="text-3xl font-light tracking-tighter text-zinc-900 dark:text-white leading-[1.05]">
            ${escapeHtml(train.destino)}
          </h2>
          <p class="text-[11px] uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-500 mt-2">
            De <span class="text-zinc-700 dark:text-zinc-300">${escapeHtml(train.origem)}</span>
          </p>

          <div class="mt-6 flex items-end justify-between gap-4 flex-wrap">
            <div class="flex items-end gap-5">
              <div class="flex flex-col">
                <span class="text-[8px] uppercase tracking-[0.25em] text-zinc-400 mb-1">Partida</span>
                <span class="font-mono text-2xl font-light tracking-tighter text-zinc-900 dark:text-white leading-none">${departTime}</span>
              </div>
              <div class="text-zinc-300 dark:text-zinc-700 text-sm font-light mb-0.5">→</div>
              <div class="flex flex-col">
                <span class="text-[8px] uppercase tracking-[0.25em] text-zinc-400 mb-1">Chegada</span>
                <span class="font-mono text-2xl font-light tracking-tighter text-zinc-900 dark:text-white leading-none">${arriveTime}</span>
              </div>
            </div>
            ${statusChipHtml(train)}
          </div>

          ${
            train.isSuppressed
              ? `<div class="mt-5 border-t border-zinc-100 dark:border-zinc-900 pt-4 flex items-start gap-3">
                   <i data-lucide="ban" class="w-4 h-4 text-red-500 shrink-0 mt-0.5"></i>
                   <p class="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                     Este comboio foi <strong class="text-red-500">suprimido</strong>. Consulte alternativas junto da Fertagus.
                   </p>
                 </div>`
              : ""
          }
          ${
            train.isOffline
              ? `<div class="mt-5 border-t border-zinc-100 dark:border-zinc-900 pt-4 flex items-start gap-3">
                   <i data-lucide="wifi-off" class="w-4 h-4 text-zinc-400 shrink-0 mt-0.5"></i>
                   <p class="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-500">
                     Dados em tempo real indisponíveis. A mostrar horário programado.
                   </p>
                 </div>`
              : ""
          }
          ${
            !train.isLive && !train.isOffline && !train.isSuppressed
              ? `<div class="mt-5 border-t border-zinc-100 dark:border-zinc-900 pt-4 flex items-start gap-3">
                   <i data-lucide="clock" class="w-4 h-4 text-zinc-400 shrink-0 mt-0.5"></i>
                   <p class="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-500">
                     Comboio ainda não iniciou o percurso em tempo real.
                   </p>
                 </div>`
              : ""
          }
        </div>

        <!-- MÉTRICAS -->
        <div class="shrink-0 px-6 py-6 border-b border-zinc-100 dark:border-zinc-900 grid grid-cols-2 gap-6">
          ${carriagesBlockHtml(train)}
          ${occupancyBlockHtml(train)}
        </div>

        ${
          train.occupancy != null
            ? `<div class="shrink-0 px-6 pt-3 pb-4 border-b border-zinc-100 dark:border-zinc-900">
                 <p class="text-[9px] leading-relaxed text-zinc-400 dark:text-zinc-500 tracking-wide">
                   Estimativa de lotação baseada no histórico oficial da Fertagus, não em tempo real.
                 </p>
               </div>`
            : ""
        }

        <!-- TIMELINE -->
        <div class="flex-1 overflow-y-auto px-6 py-7" data-details-scroll="1">
          <div class="flex items-center gap-3 mb-6">
            <span class="text-[9px] uppercase tracking-[0.3em] font-bold text-zinc-900 dark:text-white">Percurso</span>
            <span class="h-px flex-1 bg-zinc-200 dark:bg-zinc-800"></span>
            <span class="text-[9px] uppercase tracking-[0.2em] text-zinc-400">${(train.nodes || []).length} paragens</span>
          </div>
          ${timelineHtml(train)}

          <button
            data-details-action="close"
            class="w-full mt-10 py-4 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-[0.25em] border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
            Fechar
          </button>
          <div class="h-4 pb-safe-ios"></div>
        </div>
      </div>`;
  }

  // ─── ACÇÕES ──────────────────────────────────────────────────────────

  function open(train) {
    ensureElements();
    if (!panel || !backdrop || !train) return;
    // Se o station modal estiver aberto, fechamo-lo primeiro
    if (window.MapaStation && window.MapaStation.isOpen()) {
      window.MapaStation.close();
    }
    currentTrainId = train.id;
    // Ativa o tracking da câmera (apenas se for live, para não focar offline no meio do nada)
    if (window.MapaRender && train.isLive) {
      window.MapaRender.startTracking(train.id);
    }
    panel.innerHTML = buildContent(train);
    panel.querySelectorAll("[data-details-action='close']").forEach((b) => {
      b.addEventListener("click", close);
    });
    backdrop.addEventListener("click", close, { once: true });
    document.addEventListener("keydown", onKey);

    panel.classList.remove("translate-y-full");
    panel.classList.add("translate-y-0");
    backdrop.classList.remove("hidden", "opacity-0", "pointer-events-none");
    backdrop.classList.add("opacity-100");

    if (window.lucide) window.lucide.createIcons();
  }

  function close() {
    ensureElements();
    if (!panel || !backdrop) return;
    panel.classList.add("translate-y-full");
    panel.classList.remove("translate-y-0");
    backdrop.classList.add("opacity-0", "pointer-events-none");
    backdrop.classList.remove("opacity-100");
    setTimeout(() => {
      backdrop.classList.add("hidden");
      if (currentTrainId !== null) panel.innerHTML = "";
    }, 320);
    currentTrainId = null;
    if (window.MapaRender) window.MapaRender.recenterTracking();
    document.removeEventListener("keydown", onKey);
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  function isOpen() {
    return !!currentTrainId;
  }

  function refresh(train) {
    if (!isOpen() || !train || train.id !== currentTrainId) return;

    // 1. Capturar o scroll atual
    const scrollContainer = panel.querySelector('[data-details-scroll="1"]');
    const currentScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

    // 2. Substituir o HTML
    panel.innerHTML = buildContent(train);

    // 3. Restaurar o scroll no novo contentor
    const newScrollContainer = panel.querySelector('[data-details-scroll="1"]');
    if (newScrollContainer) newScrollContainer.scrollTop = currentScrollTop;

    // 4. Ligar eventos e ícones
    panel.querySelectorAll("[data-details-action='close']").forEach((b) => {
      b.addEventListener("click", close);
    });
    if (window.lucide) window.lucide.createIcons();
  }

  window.MapaDetails = {
    open,
    close,
    isOpen,
    refresh,
    getCurrentId: () => currentTrainId,
  };
})();

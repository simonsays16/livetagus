/**
 * mapa-details.js
 * Painel de detalhes de um comboio, em bottom sheet com 2 estados:
 *   • "mini"      — mostra dados essenciais
 *   • "expanded"  — mostra também a timeline das estações
 */

(function () {
  "use strict";

  let panel, backdrop;
  let currentTrainId = null;
  let currentState = "closed"; // 'closed' | 'mini' | 'expanded'
  let dragActive = false;
  let dragStartY = 0;
  let dragLastY = 0;
  let dragStartState = null;
  let dragStartHeightPx = 0;
  let dragPointerId = null;

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

  function isMobile() {
    return window.innerWidth < 768;
  }

  function trainShareUrl(train) {
    try {
      const base = window.location.origin + window.location.pathname;
      return `${base}#${encodeURIComponent(train.id)}`;
    } catch (_) {
      return `https://livetagus.pt/mapa#${train.id}`;
    }
  }

  // ─── BUILDERS DE BLOCOS ──────────────────────────────────────────────

  function statusChipHtml(train) {
    const ring = MAPA.STATUS_COLORS[train.dotStatus] || MAPA.STATUS_COLORS.gray;
    const pulse = train.dotStatus === "orange" || train.dotStatus === "red";
    return `
      <div class="inline-flex items-center gap-2 px-3 py-1.5 border border-zinc-200 dark:border-zinc-800 rounded-full bg-white/40 dark:bg-zinc-900/40 backdrop-blur">
        <span class="block w-1.5 h-1.5 rounded-full ${pulse ? "animate-pulse" : ""}" style="background-color:${ring}; box-shadow:0 0 6px ${ring}"></span>
        <span class="text-[9px] font-bold tracking-[0.2em] uppercase text-zinc-700 dark:text-zinc-300">${escapeHtml(train.statusText)}</span>
      </div>`;
  }

  function nextStationName(train) {
    const nodes = train.nodes || [];
    for (let i = 0; i < nodes.length; i++) {
      if (!nodes[i].ComboioPassou) {
        const station = MAPA.resolveStationByApiName(nodes[i].NomeEstacao);
        return station ? station.name : nodes[i].NomeEstacao;
      }
    }
    return null;
  }

  /** Carruagens + ocupação compactados numa célula. */
  function combinedCarriagesHtml(train) {
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
    const occupancyPart =
      train.occupancy != null
        ? ` / <span style="color:${fill}">${train.occupancy}%</span>`
        : "";
    return `
      <div class="flex flex-col">
        <span class="text-[9px] uppercase tracking-[0.2em] text-zinc-400 mb-1.5">Carruagens</span>
        <span class="text-[11px] text-zinc-500 font-medium leading-none">${count} unid.${occupancyPart}</span>
        <div class="mt-2 flex gap-[2px]">${blocks.join("")}</div>
      </div>`;
  }

  /** Status chip, para a coluna direita do mini. */
  function statusNextStationHtml(train) {
    const ring = MAPA.STATUS_COLORS[train.dotStatus] || MAPA.STATUS_COLORS.gray;
    const pulse = train.dotStatus === "orange" || train.dotStatus === "red";
    return `
      <div class="flex items-center">
        <div class="inline-flex items-center gap-2 px-3 py-1.5 border border-zinc-200 dark:border-zinc-800 rounded-full bg-white/40 dark:bg-zinc-900/40 backdrop-blur">
          <span class="block w-1.5 h-1.5 rounded-full ${pulse ? "animate-pulse" : ""}" style="background-color:${ring}; box-shadow:0 0 6px ${ring}"></span>
          <span class="text-[9px] font-bold tracking-[0.2em] uppercase text-zinc-700 dark:text-zinc-300">${escapeHtml(train.statusText)}</span>
        </div>
      </div>`;
  }

  /** Timeline detalhada das estações (modo expanded). */
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

      const scheduled = (n.HoraProgramada || n.HoraPrevista || "").substring(
        0,
        5,
      );
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
    const isFollow =
      window.MapaRender &&
      window.MapaRender.isFollowModeActive &&
      window.MapaRender.isFollowModeActive(train.id);
    const followColor = isFollow
      ? "text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10"
      : "text-zinc-400 hover:text-zinc-900 dark:hover:text-white";
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

    // Localização REAL (TML via /mapa) vs ESTIMADA (cálculo do mapa-geo).
    const hasRealPosition = !!(
      window.MapaRender &&
      typeof window.MapaRender.isRealPosition === "function" &&
      window.MapaRender.isRealPosition(train.id)
    );

    return `
      <div class="flex flex-col h-full bg-white dark:bg-[#09090b]">

        <!-- DRAG HANDLE (visível em mobile) -->
        <div class="dp-handle md:hidden shrink-0" data-drag-area="1" aria-hidden="true">
          <div class="dp-handle-pill"></div>
        </div>

        <!-- HEADER COMPACTO -->
        <div class="dp-header relative shrink-0 px-6 pt-3 md:pt-safe-ios md:pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-900" data-drag-area="1">
          <div class="absolute right-3 flex items-center gap-1" style="top:35px">
            <!--<button
              data-details-action="follow"
              class="w-9 h-9 flex items-center justify-center transition-colors rounded-full ${followColor}"
              aria-label="Seguir condução">
              <i data-lucide="locate-fixed" class="w-[18px] h-[18px]"></i>
            </button>-->
            <button
              data-details-action="share"
              class="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors rounded-full"
              aria-label="Partilhar comboio">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"
                   viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" x2="12" y1="2" y2="15"/>
              </svg>
            </button>
            <button
              data-details-action="close"
              class="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors rounded-full"
              aria-label="Fechar">
              <i data-lucide="x" class="w-5 h-5"></i>
            </button>
          </div>

          <div class="flex items-center gap-2 mb-2 pr-24">
            <span class="text-[9px] font-bold tracking-[0.3em] uppercase text-blue-600 dark:text-blue-400">Fertagus</span>
            ${train.isExtra ? `<span class="text-[9px] font-bold tracking-[0.3em] uppercase text-blue-500 border border-blue-500/30 px-2 py-0.5">Extra</span>` : ""}
            <span class="h-px flex-1 max-w-12 bg-zinc-200 dark:bg-zinc-800"></span>
            <span class="text-[9px] font-mono tracking-wider text-zinc-400">#${escapeHtml(train.numero)}</span>
          </div>

          <h2 class="text-[22px] md:text-2xl font-light tracking-tighter text-zinc-900 dark:text-white leading-tight pr-24">
            ${escapeHtml(train.destino)} <span class="font-mono text-base font-light text-zinc-400 tracking-tight">${arriveTime}</span>
          </h2>
          <p class="text-[10px] uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-500 mt-1.5">
            De <span class="text-zinc-700 dark:text-zinc-300">${escapeHtml(train.origem)}</span>
            <span class="font-mono text-[10px] text-zinc-400 normal-case tracking-tight ml-1">${departTime}</span>
          </p>
        </div>

        <!-- MINI CONTENT (sempre visível) -->
        <div class="dp-mini-content shrink-0 px-6 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-900" data-drag-area="1">
          <div class="grid grid-cols-2 gap-5">
            ${combinedCarriagesHtml(train)}
            ${statusNextStationHtml(train)}
          </div>

          <!-- ORIGEM DA LOCALIZAÇÃO (real TML vs estimada) -->
          <div class="mt-3 flex items-center gap-1.5">
            <i data-lucide="${hasRealPosition ? "satellite-dish" : "route"}"
               class="w-3 h-3 ${hasRealPosition ? "text-emerald-500" : "text-zinc-400"} shrink-0"></i>
            <span class="text-[9px] font-medium uppercase tracking-[0.2em] ${hasRealPosition ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500"}">
              ${hasRealPosition ? "Localização Real do Comboio <b>(NOVO)</b>" : "Localização do Comboio Estimada"}
            </span>
          </div>

          ${
            train.isSuppressed
              ? `<div class="mt-4 flex items-start gap-2 p-3 rounded-sm bg-red-500/5 border border-red-500/20">
                   <i data-lucide="ban" class="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5"></i>
                   <p class="text-[10px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                     Comboio <strong class="text-red-500">suprimido</strong>. Consulte a Fertagus.
                   </p>
                 </div>`
              : ""
          }
          ${
            train.isOffline
              ? `<div class="mt-4 flex items-start gap-2 p-3 rounded-sm bg-zinc-500/5 border border-zinc-500/20">
                   <i data-lucide="wifi-off" class="w-3.5 h-3.5 text-zinc-400 shrink-0 mt-0.5"></i>
                   <p class="text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-500">
                     Dados ao vivo indisponíveis · horário programado.
                   </p>
                 </div>`
              : ""
          }
        </div>

        <!-- BOTÃO EXPANDIR / COLAPSAR -->
        <div class="dp-toggle-wrap shrink-0">
          <button
            data-details-action="toggle-expand"
            class="dp-toggle w-full py-3 flex items-center justify-center gap-2 text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors border-b border-zinc-100 dark:border-zinc-900"
            aria-label="Mostrar todas as paragens">
            <span data-toggle-text>Mais detalhes</span>
            <svg class="dp-toggle-chevron" xmlns="http://www.w3.org/2000/svg" width="14" height="14"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        </div>

        <!-- EXPANDED CONTENT (só visível em state="expanded") -->
        <div class="dp-expanded-content flex-1 overflow-y-auto px-6 py-6" data-details-scroll="1">
          <div class="flex items-center gap-3 mb-5">
            <span class="text-[9px] uppercase tracking-[0.3em] font-bold text-zinc-900 dark:text-white">Percurso</span>
            <span class="h-px flex-1 bg-zinc-200 dark:bg-zinc-800"></span>
            <span class="text-[9px] uppercase tracking-[0.2em] text-zinc-400">${(train.nodes || []).length} paragens</span>
          </div>
          ${timelineHtml(train)}
          <div class="h-4 pb-safe-ios"></div>
        </div>
      </div>`;
  }

  // ─── DRAG GESTURES ───────────────────────────────────────────────────

  function pointerY(e) {
    if (e.touches && e.touches.length) return e.touches[0].clientY;
    if (e.changedTouches && e.changedTouches.length)
      return e.changedTouches[0].clientY;
    return e.clientY;
  }

  function isDragAreaTarget(target) {
    let el = target;
    while (el && el !== panel) {
      if (el.matches && el.matches("button, a, input, [data-no-drag]"))
        return false;
      if (el.dataset && el.dataset.dragArea === "1") return true;
      el = el.parentElement;
    }
    return false;
  }

  function onPointerDown(e) {
    if (!isMobile()) return;
    if (!panel || currentState === "closed") return;
    if (!isDragAreaTarget(e.target)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;

    dragActive = true;
    dragStartY = pointerY(e);
    dragLastY = dragStartY;
    dragStartState = currentState;
    dragStartHeightPx = panel.getBoundingClientRect().height;
    dragPointerId = e.pointerId != null ? e.pointerId : null;

    panel.style.transition = "none";
    if (dragPointerId != null && panel.setPointerCapture) {
      try {
        panel.setPointerCapture(dragPointerId);
      } catch (_) {}
    }
  }

  function onPointerMove(e) {
    if (!dragActive) return;
    const y = pointerY(e);
    dragLastY = y;
    const dy = y - dragStartY;
    const vh = window.innerHeight;
    const miniTarget = Math.min(vh * 0.36, 310);
    const expandedTarget = vh * 0.92;

    if (dragStartState === "mini") {
      if (dy >= 0) {
        // Drag down: translateY com leve amortecimento depois de 180px
        const damp = dy < 180 ? dy : 180 + (dy - 180) * 0.4;
        panel.style.transform = `translateY(${damp}px)`;
        panel.style.height = `${dragStartHeightPx}px`;
      } else {
        // Drag up: aumenta altura até max ~expanded
        const grow = Math.min(-dy, expandedTarget - dragStartHeightPx);
        panel.style.transform = "";
        panel.style.height = `${dragStartHeightPx + grow}px`;
      }
    } else {
      // Started expanded
      if (dy >= 0) {
        // Drag down: encolhe altura até mini, depois translateY
        const shrinkable = dragStartHeightPx - miniTarget;
        if (dy <= shrinkable) {
          panel.style.transform = "";
          panel.style.height = `${dragStartHeightPx - dy}px`;
        } else {
          const extra = dy - shrinkable;
          const damp = extra < 180 ? extra : 180 + (extra - 180) * 0.4;
          panel.style.transform = `translateY(${damp}px)`;
          panel.style.height = `${miniTarget}px`;
        }
      } else {
        // Drag up em expanded — não faz sentido, ignora
        panel.style.transform = "";
        panel.style.height = `${dragStartHeightPx}px`;
      }
    }
  }

  function onPointerUp(e) {
    if (!dragActive) return;
    const dy = (e ? pointerY(e) : dragLastY) - dragStartY;
    dragActive = false;
    if (dragPointerId != null && panel.releasePointerCapture) {
      try {
        panel.releasePointerCapture(dragPointerId);
      } catch (_) {}
    }
    dragPointerId = null;

    // Limpa estilos inline para que CSS transitions tomem conta
    panel.style.transition = "";
    panel.style.transform = "";
    panel.style.height = "";

    const THRESH_TOGGLE = 70;
    const THRESH_CLOSE = 110;

    if (dragStartState === "mini") {
      if (dy < -THRESH_TOGGLE) {
        setState("expanded");
      } else if (dy > THRESH_CLOSE) {
        close();
      } else {
        setState("mini"); // snap back
      }
    } else if (dragStartState === "expanded") {
      const vh = window.innerHeight;
      const totalSwipeDown = dy;
      if (totalSwipeDown > vh * 0.55) {
        close();
      } else if (totalSwipeDown > THRESH_TOGGLE) {
        setState("mini");
      } else {
        setState("expanded");
      }
    }
  }

  function attachDragHandlers() {
    if (!panel) return;
    panel.addEventListener("pointerdown", onPointerDown);
    panel.addEventListener("pointermove", onPointerMove);
    panel.addEventListener("pointerup", onPointerUp);
    panel.addEventListener("pointercancel", onPointerUp);
  }

  // ─── ACÇÕES / EVENT HANDLERS ─────────────────────────────────────────

  function attachInteractions() {
    panel.querySelectorAll("[data-details-action='close']").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        close();
      });
    });
    panel.querySelectorAll("[data-details-action='share']").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        shareCurrent();
      });
    });

    // NOVO: Ação de follow mode
    panel.querySelectorAll("[data-details-action='follow']").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const train = getCurrentTrain();
        if (train && window.MapaRender) {
          const isActive = window.MapaRender.toggleFollowMode(train);
          if (isActive) {
            b.classList.remove(
              "text-zinc-400",
              "hover:text-zinc-900",
              "dark:hover:text-white",
            );
            b.classList.add(
              "text-blue-500",
              "dark:text-blue-400",
              "bg-blue-50",
              "dark:bg-blue-500/10",
            );
            setState("mini"); // Força o painel a ficar reduzido
          } else {
            b.classList.add(
              "text-zinc-400",
              "hover:text-zinc-900",
              "dark:hover:text-white",
            );
            b.classList.remove(
              "text-blue-500",
              "dark:text-blue-400",
              "bg-blue-50",
              "dark:bg-blue-500/10",
            );
          }
        }
      });
    });

    panel
      .querySelectorAll("[data-details-action='toggle-expand']")
      .forEach((b) => {
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          setState(currentState === "expanded" ? "mini" : "expanded");
        });
      });
  }

  function shareCurrent() {
    const train = getCurrentTrain();
    if (!train) return;
    const url = trainShareUrl(train);
    const payload = {
      title: `Fertagus #${train.numero || train.id}`,
      text: `Comboio Fertagus ${train.origem || ""} → ${train.destino || ""} (#${train.numero || train.id}) no LiveTagus`,
      url,
    };
    if (navigator.share) {
      navigator.share(payload).catch((err) => {
        if (err && err.name === "AbortError") return;
        fallbackCopy(url);
      });
    } else {
      fallbackCopy(url);
    }
  }

  function fallbackCopy(url) {
    if (window.MapaShare && window.MapaShare._copyToClipboard) {
      window.MapaShare._copyToClipboard(url).then((ok) => {
        if (ok && window.MapaShare.showToast) {
          window.MapaShare.showToast("Link Copiado!");
        }
      });
    }
  }

  function getCurrentTrain() {
    if (!currentTrainId) return null;
    if (window.MapaRender && window.MapaRender.getMarkers) {
      const m = window.MapaRender.getMarkers().get(currentTrainId);
      if (m && m.train) return m.train;
    }
    return null;
  }

  function setState(newState) {
    if (!panel) return;
    if (newState !== "mini" && newState !== "expanded") return;

    // NOVO: Se o utilizador expandir manualmente a sheet, paramos de o obrigar a "conduzir"
    if (
      newState === "expanded" &&
      window.MapaRender &&
      window.MapaRender.isFollowModeActive &&
      window.MapaRender.isFollowModeActive(currentTrainId)
    ) {
      window.MapaRender.toggleFollowMode(getCurrentTrain());
      const b = panel.querySelector('[data-details-action="follow"]');
      if (b) {
        b.classList.add(
          "text-zinc-400",
          "hover:text-zinc-900",
          "dark:hover:text-white",
        );
        b.classList.remove(
          "text-blue-500",
          "dark:text-blue-400",
          "bg-blue-50",
          "dark:bg-blue-500/10",
        );
      }
    }

    currentState = newState;
    panel.dataset.state = newState;
    panel.classList.remove("translate-y-full");
    panel.classList.add("translate-y-0");

    const chev = panel.querySelector(".dp-toggle-chevron");
    const text = panel.querySelector("[data-toggle-text]");
    if (chev) {
      chev.style.transform =
        newState === "expanded" ? "rotate(180deg)" : "rotate(0deg)";
    }
    if (text) {
      text.textContent =
        newState === "expanded" ? "Menos detalhes" : "Mais detalhes";
    }

    if (newState === "expanded") {
      const sc = panel.querySelector('[data-details-scroll="1"]');
      if (sc) sc.scrollTop = 0;
    }

    if (window.MapaRender && window.MapaRender.isRouteFocused()) {
      const t = getCurrentTrain();
      if (t) window.MapaRender.startRouteFocus(t);
    }
  }

  function open(train, opts) {
    ensureElements();
    if (!panel || !backdrop || !train) return;
    if (window.MapaStation && window.MapaStation.isOpen()) {
      window.MapaStation.close({ silent: true });
    }
    currentTrainId = train.id;
    const initialState = (opts && opts.state) || "mini";
    panel.innerHTML = buildContent(train);
    panel.dataset.state = initialState;
    currentState = initialState;

    attachInteractions();
    attachDragHandlers();

    // Reset do scroll
    const sc = panel.querySelector('[data-details-scroll="1"]');
    if (sc) sc.scrollTop = 0;

    panel.classList.remove("translate-y-full");
    panel.classList.add("translate-y-0");

    backdrop.classList.remove("hidden");
    // Em mobile, no estado mini queremos backdrop SUBTIL (ou nenhum) para
    // o mapa continuar legível atrás. Em expanded, escurece mais.
    updateBackdropForState();

    backdrop.addEventListener("click", onBackdropClick);
    document.addEventListener("keydown", onKey);

    // Iniciar route focus
    if (window.MapaRender) {
      window.MapaRender.startRouteFocus(train);
    }

    // Chevron / texto inicial
    setStateInternal(initialState);

    if (window.lucide) window.lucide.createIcons();
  }

  function setStateInternal(s) {
    // Aplica visualmente o estado SEM disparar novo route focus
    // (já foi feito no open). Reutiliza apenas o lado visual de setState.
    panel.dataset.state = s;
    currentState = s;
    const chev = panel.querySelector(".dp-toggle-chevron");
    const text = panel.querySelector("[data-toggle-text]");
    if (chev) {
      chev.style.transform =
        s === "expanded" ? "rotate(180deg)" : "rotate(0deg)";
    }
    if (text) {
      text.textContent = s === "expanded" ? "Menos detalhes" : "Mais detalhes";
    }
    updateBackdropForState();
  }

  function updateBackdropForState() {
    if (!backdrop) return;
    if (currentState === "expanded") {
      backdrop.classList.remove("opacity-0", "pointer-events-none");
      backdrop.classList.add("opacity-100");
      backdrop.dataset.intensity = "strong";
    } else {
      // mini → não escurece para deixar o mapa visível
      backdrop.classList.add("opacity-0", "pointer-events-none");
      backdrop.classList.remove("opacity-100");
      backdrop.dataset.intensity = "soft";
    }
  }

  function onBackdropClick() {
    close();
  }

  function close() {
    ensureElements();
    if (!panel || !backdrop) return;
    panel.classList.add("translate-y-full");
    panel.classList.remove("translate-y-0");
    panel.dataset.state = "closed";
    currentState = "closed";
    backdrop.classList.add("opacity-0", "pointer-events-none");
    backdrop.classList.remove("opacity-100");

    backdrop.removeEventListener("click", onBackdropClick);
    document.removeEventListener("keydown", onKey);

    setTimeout(() => {
      backdrop.classList.add("hidden");
      if (currentTrainId !== null && currentState === "closed") {
        panel.innerHTML = "";
      }
    }, 360);

    currentTrainId = null;
    if (window.MapaRender) {
      window.MapaRender.endRouteFocus();
      window.MapaRender.showWholeLine();
    }
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  function isOpen() {
    return !!currentTrainId;
  }

  function getCurrentId() {
    return currentTrainId;
  }

  function getModalState() {
    return currentState;
  }

  function refresh(train) {
    if (!isOpen() || !train || train.id !== currentTrainId) return;
    // Captura scroll
    const sc = panel.querySelector('[data-details-scroll="1"]');
    const top = sc ? sc.scrollTop : 0;

    // Recria o conteúdo mas preserva o estado actual
    const prevState = currentState;
    panel.innerHTML = buildContent(train);
    panel.dataset.state = prevState;
    currentState = prevState;

    attachInteractions();
    attachDragHandlers();
    setStateInternal(prevState);

    const newSc = panel.querySelector('[data-details-scroll="1"]');
    if (newSc) newSc.scrollTop = top;
    if (window.lucide) window.lucide.createIcons();
  }

  window.MapaDetails = {
    open,
    close,
    isOpen,
    refresh,
    getCurrentId,
    getModalState,
    setState,
  };
})();

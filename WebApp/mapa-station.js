/**
 * mapa-station.js
 * Modal de detalhes de uma ESTAÇÃO: mostra as próximas partidas.
 */

(function () {
  "use strict";

  // Reutilizamos os mesmos elementos DOM do details-panel/backdrop para
  // evitar sobreposições visuais — só um painel pode estar aberto de cada vez.
  let panel, backdrop;
  let currentStation = null;
  let directionFilter = { lisboa: true, margem: true };
  let trainsSource = null; // callback () => Array

  function ensureElements() {
    if (panel && backdrop) return;
    panel = document.getElementById("details-panel");
    backdrop = document.getElementById("details-backdrop");
    if (!panel || !backdrop) {
      console.error("[MapaStation] Elementos DOM ausentes");
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

  /**
   * Calcula o atraso em minutos NA ESTAÇÃO específica, comparando
   * HoraPrevista e HoraProgramada do nó correspondente.
   * IGNORA deliberadamente o texto SituacaoComboio — esse refere-se ao
   * próximo nó não passado e pode estar errado para a estação que o
   * utilizador está a ver.
   */
  function stationDelayMinutes(train, stationApiId) {
    const nodes = train.nodes || [];
    const node = nodes.find(
      (n) => String(n.EstacaoID) === String(stationApiId),
    );
    if (!node) return null;
    const prog = window.MapaGeo.parseTimeHHMMSS(node.HoraProgramada);
    const prev = window.MapaGeo.parseTimeHHMMSS(node.HoraPrevista);
    if (!prog || !prev) return null;
    return Math.floor((prev.getTime() - prog.getTime()) / 60000);
  }

  /**
   * Hora prevista de partida/passagem para a estação, em formato HH:MM.
   * Devolve null se o nó não existir ou se não tivermos uma hora válida.
   */
  function stationScheduledTime(train, stationApiId) {
    const nodes = train.nodes || [];
    const node = nodes.find(
      (n) => String(n.EstacaoID) === String(stationApiId),
    );
    if (!node) return null;
    const prevStr = (node.HoraPrevista || "").substring(0, 5);
    const progStr = (node.HoraProgramada || "").substring(0, 5);
    // Evita devolver "HH:MM" sentinela
    if (prevStr && !prevStr.startsWith("HH")) return prevStr;
    if (progStr && !progStr.startsWith("HH")) return progStr;
    return null;
  }

  function stationNodeTs(train, stationApiId) {
    const nodes = train.nodes || [];
    const node = nodes.find(
      (n) => String(n.EstacaoID) === String(stationApiId),
    );
    if (!node) return Infinity;
    const d =
      window.MapaGeo.parseTimeHHMMSS(node.HoraPrevista) ||
      window.MapaGeo.parseTimeHHMMSS(node.HoraProgramada);
    return d ? d.getTime() : Infinity;
  }

  /**
   * Filtro principal: trains que passam nesta estação e ainda não passaram.
   * Aplica também o filtro de sentido activo.
   */
  function filterTrainsForStation(allTrains, station) {
    if (!station || !Array.isArray(allTrains)) return [];
    const now = Date.now();
    return allTrains
      .filter((t) => {
        // Filtro de direção
        if (!directionFilter.lisboa && t.direction === "lisboa") return false;
        if (!directionFilter.margem && t.direction === "margem") return false;

        // Tem de passar nesta estação
        const node = (t.nodes || []).find(
          (n) => String(n.EstacaoID) === String(station.apiId),
        );
        if (!node) return false;

        // Ainda não passou pela estação (ou passou há menos de 2 min,
        // para dar tempo de atualização)
        if (node.ComboioPassou) {
          const pts = stationNodeTs(t, station.apiId);
          if (pts && Date.now() - pts > 2 * 60 * 1000) return false;
        }

        // Se suprimido, ainda mostra enquanto a hora programada não passou +5 min
        if (t.isSuppressed) {
          const ts = stationNodeTs(t, station.apiId);
          if (ts !== Infinity && now > ts + 5 * 60 * 1000) return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          stationNodeTs(a, station.apiId) - stationNodeTs(b, station.apiId),
      )
      .slice(0, 10);
  }

  // ─── RENDER DE UM CARTÃO DE COMBOIO ──────────────────────────────────

  function trainRowHtml(train, station) {
    const time = stationScheduledTime(train, station.apiId);
    const delayMin = stationDelayMinutes(train, station.apiId);

    const ring = MAPA.STATUS_COLORS[train.dotStatus] || MAPA.STATUS_COLORS.gray;
    const pulse = train.dotStatus === "orange" || train.dotStatus === "red";
    const carCount = train.carriages || 4;
    const occ = train.occupancy;
    const fill = window.MapaRender
      ? window.MapaRender._carriageFillColor(train)
      : "#3b82f6";
    const filled = window.MapaRender
      ? window.MapaRender._filledCarriages(train)
      : carCount;

    // Mini-barra de carruagens (horizontal)
    const bars = [];
    for (let i = 0; i < carCount; i++) {
      const on = i < filled;
      bars.push(
        `<div class="h-[4px] flex-1 rounded-[1px]"
               style="background-color:${on ? fill : "rgba(161,161,170,.25)"}"></div>`,
      );
    }

    // Badge textual (direita): LIVE / OFFLINE / EXTRA / SUPRIMIDO
    let badge = "";
    if (train.isSuppressed) {
      badge = `<span class="text-[9px] font-bold tracking-[0.18em] uppercase text-red-500">Suprimido</span>`;
    } else if (train.isLive) {
      badge = `<span class="text-[9px] font-bold tracking-[0.18em] uppercase text-emerald-600 dark:text-emerald-400">Ao Vivo</span>`;
    } else if (train.isExtra) {
      badge = `<span class="text-[9px] font-bold tracking-[0.18em] uppercase text-blue-500">Extra</span>`;
    } else if (train.isOffline) {
      badge = `<span class="text-[9px] font-bold tracking-[0.18em] uppercase text-zinc-400">Programado</span>`;
    } else {
      badge = `<span class="text-[9px] font-bold tracking-[0.18em] uppercase text-zinc-500">${escapeHtml(train.statusText || "")}</span>`;
    }

    // Bloco de atraso (se > 0 e não suprimido)
    let delayTag = "";
    if (!train.isSuppressed && delayMin != null) {
      if (delayMin >= 1) {
        delayTag = `
          <span class="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
            <i data-lucide="clock" class="w-3 h-3"></i>
            +${delayMin} min
          </span>`;
      } else if (delayMin <= -1) {
        delayTag = `
          <span class="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
            <i data-lucide="clock" class="w-3 h-3"></i>
            ${delayMin} min
          </span>`;
      }
    }

    const occText = occ == null ? "Sem dados" : `${occ}% ocupação`;

    return `
      <div class="group w-full px-5 py-4 border-b border-zinc-100 dark:border-zinc-900 last:border-b-0 active:bg-zinc-50 dark:active:bg-zinc-900/50 transition-colors cursor-pointer"
           data-station-row="1" data-train-id="${escapeHtml(train.id)}">

        <!-- Linha 1: hora grande + estado + badge -->
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-baseline gap-3 min-w-0">
            <span class="font-mono text-2xl font-light tracking-tighter text-zinc-900 dark:text-white leading-none tabular-nums">
              ${time || "--:--"}
            </span>
            <span class="block w-1.5 h-1.5 rounded-full ${pulse ? "animate-pulse" : ""} shrink-0"
                  style="background-color:${ring}; box-shadow: 0 0 6px ${ring}"></span>
            ${delayTag}
          </div>
          <div class="shrink-0 flex items-center gap-2 text-right">
            ${
              train.isLive
                ? `
            <button data-station-locate="${escapeHtml(train.id)}"
                    class="p-1 -mr-1 text-zinc-400 hover:text-blue-500 active:scale-95 transition-all"
                    title="Focar e seguir no mapa" aria-label="Focar no mapa">
              <i data-lucide="locate-fixed" class="w-[18px] h-[18px]"></i>
            </button>
            `
                : ""
            }
            <div>${badge}</div>
          </div>
        </div>

        <!-- Linha 2: origem → destino + número -->
        <div class="mt-2 flex items-center justify-between gap-3">
          <p class="text-[10px] uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-500 truncate min-w-0">
            <span class="text-zinc-400 dark:text-zinc-600">${escapeHtml(train.origem || "—")}</span>
            <span class="mx-1.5 text-zinc-300 dark:text-zinc-700">→</span>
            <span class="text-zinc-700 dark:text-zinc-300">${escapeHtml(train.destino || "—")}</span>
          </p>
          <span class="font-mono text-[10px] text-zinc-400 tabular-nums shrink-0">#${escapeHtml(train.numero || train.id)}</span>
        </div>

        <!-- Linha 3: carruagens (barra fina) + ocupação textual -->
        <div class="mt-3 flex items-center gap-3">
          <div class="flex gap-[2px] flex-1 min-w-0">${bars.join("")}</div>
          <span class="text-[9px] uppercase tracking-wider text-zinc-400 shrink-0">
            ${carCount} carr · ${escapeHtml(occText)}
          </span>
        </div>

        <!-- Acção (apenas visível em hover ou toque) -->
        <div class="mt-3 flex justify-end">
          <button data-station-open-details="${escapeHtml(train.id)}"
                  class="text-[9px] font-bold tracking-[0.22em] uppercase text-blue-500 hover:text-blue-400 flex items-center gap-1.5 active:scale-95 transition-transform">
            Ver detalhes
            <i data-lucide="arrow-right" class="w-3 h-3"></i>
          </button>
        </div>
      </div>`;
  }

  // ─── RENDER DO PAINEL ────────────────────────────────────────────────

  function buildContent(station, trainsForStation) {
    const empty =
      trainsForStation.length === 0
        ? `
        <div class="px-6 py-12 text-center">
          <i data-lucide="moon-star" class="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto mb-4"></i>
          <p class="text-[11px] uppercase tracking-[0.22em] text-zinc-400">
            Sem próximas partidas
          </p>
          <p class="text-[10px] text-zinc-400 dark:text-zinc-600 mt-2 font-light">
            Experimenta reativar os filtros de sentido acima.
          </p>
        </div>`
        : "";

    const rows = trainsForStation.map((t) => trainRowHtml(t, station)).join("");

    return `
      <div class="flex flex-col h-full max-h-[85dvh] md:max-h-[80dvh] bg-white dark:bg-[#09090b]">
        <!-- HEADER -->
        <div class="relative shrink-0 px-6 pt-safe-ios pt-5 pb-5 border-b border-zinc-100 dark:border-zinc-900">
          <button
            data-details-action="close"
            class="absolute right-4 top-5 w-10 h-10 flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
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
          <p class="text-[11px] uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-500 mt-2">
            Próximas Partidas
          </p>

          <!-- Filtros de sentido -->
          <div class="mt-5 flex items-center gap-2">
            <button data-station-dir="lisboa"
                    aria-pressed="${directionFilter.lisboa}"
                    class="flex-1 px-3 py-2.5 text-[9px] font-bold tracking-[0.2em] uppercase border transition-all
                           ${
                             directionFilter.lisboa
                               ? "border-zinc-900 dark:border-white bg-zinc-900 dark:bg-white text-white dark:text-zinc-900"
                               : "border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-500 hover:border-zinc-300 dark:hover:border-zinc-700"
                           }">
              Sentido Lisboa
            </button>
            <button data-station-dir="margem"
                    aria-pressed="${directionFilter.margem}"
                    class="flex-1 px-3 py-2.5 text-[9px] font-bold tracking-[0.2em] uppercase border transition-all
                           ${
                             directionFilter.margem
                               ? "border-zinc-900 dark:border-white bg-zinc-900 dark:bg-white text-white dark:text-zinc-900"
                               : "border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-500 hover:border-zinc-300 dark:hover:border-zinc-700"
                           }">
              Sentido Margem
            </button>
          </div>
        </div>

        <!-- LISTA DE COMBOIOS -->
        <div class="flex-1 overflow-y-auto" data-details-scroll="1">
          ${rows}
          ${empty}

          <div class="px-6 py-6 text-center">
            <p class="text-[9px] leading-relaxed text-zinc-400 dark:text-zinc-600 tracking-wide max-w-xs mx-auto">
              Partidas ao vivo ou previstas no horário. Os dados podem variar
              em função da Fertagus/Infraestruturas de Portugal.
            </p>
          </div>

          <button
            data-details-action="close"
            class="w-[calc(100%-3rem)] mx-6 mb-6 py-4 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-[0.25em] border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
            Fechar
          </button>
        </div>
      </div>`;
  }

  // ─── AÇÕES ───────────────────────────────────────────────────────────

  function render() {
    if (!currentStation) return;
    const source = trainsSource && trainsSource();
    const trains = Array.isArray(source) ? source : [];
    const filtered = filterTrainsForStation(trains, currentStation);

    // 1. Capturar o scroll atual
    const scrollContainer = panel.querySelector('[data-details-scroll="1"]');
    const currentScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

    // 2. Substituir o HTML
    panel.innerHTML = buildContent(currentStation, filtered);

    // 3. Restaurar o scroll no novo contentor
    const newScrollContainer = panel.querySelector('[data-details-scroll="1"]');
    if (newScrollContainer) newScrollContainer.scrollTop = currentScrollTop;

    // 4. Ligar eventos e ícones
    attachListeners();
    if (window.lucide) window.lucide.createIcons();
  }

  function attachListeners() {
    // Fechar
    panel.querySelectorAll("[data-details-action='close']").forEach((b) => {
      b.addEventListener("click", close);
    });
    // Toggle de direção
    panel.querySelectorAll("[data-station-dir]").forEach((b) => {
      b.addEventListener("click", () => {
        const dir = b.dataset.stationDir;
        directionFilter[dir] = !directionFilter[dir];
        // Nunca desligar AMBOS — pelo menos um sentido tem de estar ativo
        if (!directionFilter.lisboa && !directionFilter.margem) {
          directionFilter[dir] = true;
        }
        render();
      });
    });
    // Botão Locate (Mira)
    panel.querySelectorAll("[data-station-locate]").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation(); // Impede de abrir o modal de detalhes!
        const id = b.dataset.stationLocate;
        close(); // Fecha o modal da estação
        if (window.MapaRender) window.MapaRender.startTrackingTrain(id);
      });
    });
    // Abrir detalhes (da row inteira OU do botão "Ver detalhes")
    panel.querySelectorAll("[data-station-open-details]").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = b.dataset.stationOpenDetails;
        openDetailsFor(id);
      });
    });
    panel.querySelectorAll("[data-station-row]").forEach((row) => {
      row.addEventListener("click", () => {
        openDetailsFor(row.dataset.trainId);
      });
    });
  }

  function openDetailsFor(trainId) {
    const source = trainsSource && trainsSource();
    if (!Array.isArray(source)) return;
    const train = source.find((t) => String(t.id) === String(trainId));
    if (train && window.MapaDetails) {
      // Fecha o modal da estação antes de abrir o do comboio para não
      // empilhar dois layers iguais.
      close();
      setTimeout(() => window.MapaDetails.open(train), 200);
    }
  }

  function open(station) {
    ensureElements();
    if (!panel || !backdrop || !station) return;
    currentStation = station;
    if (window.MapaRender) window.MapaRender.focusStation(station);
    render();

    panel.classList.remove("translate-y-full");
    panel.classList.add("translate-y-0");
    backdrop.classList.remove("hidden", "opacity-0", "pointer-events-none");
    backdrop.classList.add("opacity-100");

    // ESC fecha, backdrop fecha
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", close, { once: true });

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
      // Só limpa o painel se ele ainda for o nosso (não foi substituído
      // por mapa-details entretanto)
      if (currentStation !== null) panel.innerHTML = "";
    }, 320);
    currentStation = null;
    if (window.MapaRender) window.MapaRender.recenterTracking();
    document.removeEventListener("keydown", onKey);
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  function isOpen() {
    return !!currentStation;
  }

  function refresh() {
    if (!isOpen()) return;
    render();
  }

  function setTrainsSource(fn) {
    trainsSource = fn;
  }

  window.MapaStation = {
    open,
    close,
    isOpen,
    refresh,
    setTrainsSource,
    _filterTrainsForStation: filterTrainsForStation,
    _stationDelayMinutes: stationDelayMinutes,
    _stationScheduledTime: stationScheduledTime,
  };
})();

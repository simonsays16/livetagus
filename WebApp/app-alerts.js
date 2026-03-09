/**
 * app-alerts.js
 * Sistema de alertas: carregamento, validação, geração de HTML e gestão.
 * Depende de: app-config.js
 *
 * NOTA CSP: Os botões gerados por generateHTML usam data-action em vez de
 * onclick inline. O despacho das ações é feito pela delegação em app-init.js.
 */

const AlertsManager = {
  fetch: async () => {
    try {
      const res = await fetch(API_ALERTS + "?t=" + Date.now());
      if (!res.ok) return [];
      const data = await res.json();
      return Object.values(data);
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  parseDatePT: (str) => {
    if (!str || typeof str !== "string" || !str.includes("/")) return null;
    const [d, m, y] = str.split("/");
    const date = new Date(y, m - 1, d);
    date.setHours(0, 0, 0, 0);
    return date;
  },

  isActive: (alert) => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    if (alert.datainicio && alert.datainicio.trim() !== "") {
      const start = AlertsManager.parseDatePT(alert.datainicio);
      if (start && now < start) return false;
    }

    if (alert.datafim && alert.datafim.trim() !== "") {
      const end = AlertsManager.parseDatePT(alert.datafim);
      if (end && now > end) return false;
    }
    return true;
  },

  checkSudoku: (trains) => {
    if (!trains || trains.length === 0) return null;

    let nextTrain = trains.find((t) => t.isEffectiveFuture && !t.isSuppressed);
    if (!nextTrain) nextTrain = trains.find((t) => !t.isSuppressed);
    if (!nextTrain) nextTrain = trains[0];

    if (nextTrain) {
      return {
        id: "sudoku-promo",
        tipo: "informacao",
        nome: "Tempo de Espera?",
        mensagem: "Aborrecido? Joga Sudoku!",
        textolink: "Jogar",
        isSudoku: true,
        icon: "gamepad-2",
        trainId: nextTrain.id,
        trainDest: nextTrain.dest,
      };
    }
    return null;
  },

  checkPWA: () => {
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    const dismissed = sessionStorage.getItem("pwa_dismissed");

    if (!isStandalone && !dismissed) {
      return null; // Desativação para maior partilha momentânea do jogo de sudoku
    }
    return null;
  },

  /**
   * Gera o HTML do slider de alertas.
   * IMPORTANTE: Usa data-action em vez de onclick para conformidade com CSP.
   * O despacho das ações é feito pela delegação de eventos em app-init.js.
   */
  generateHTML: (alerts) => {
    if (!alerts || alerts.length === 0) return "";

    let html =
      '<div id="alerts-dynamic-container" class="mt-4 mb-1 relative group w-full animate-fade-in">';
    html +=
      '<div id="alerts-slider" class="w-full flex flex-nowrap gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-hide py-1">';

    alerts.forEach((alert, index) => {
      const isWarning = alert.tipo === "aviso";

      const bgColor = isWarning
        ? "bg-amber-500/10 dark:bg-amber-500/5"
        : "bg-white/90 dark:bg-zinc-800/40";
      const borderColor = isWarning
        ? "border-amber-500/30"
        : "border-black/5 dark:border-white/5";
      const iconColor = isWarning ? "text-amber-500" : "text-blue-500";
      const lucideIcon = alert.icon
        ? alert.icon
        : isWarning
          ? "alert-triangle"
          : "info";

      // Botão de ação — usa data-action em vez de onclick
      let actionHtml = "";
      if (alert.isPWA) {
        actionHtml = `<button data-action="install-pwa" class="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-wider text-white bg-blue-600 px-3 py-1.5 rounded transition-colors shadow-sm active:scale-95">Instalar</button>`;
      } else if (alert.link && alert.link !== "#" && !alert.isSudoku) {
        const txt = alert.textolink || "Ver";
        actionHtml = `<a href="${alert.link}" target="_blank" class="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-wider text-blue-500 border border-blue-500/30 px-3 py-1.5 rounded transition-colors active:scale-95">${txt}</a>`;
      } else if (alert.isSudoku) {
        actionHtml = `<a href="./sudoku.html" class="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-wider text-white bg-[var(--accent,#3b82f6)] px-3 py-1.5 rounded transition-transform active:scale-95 shadow-sm">Jogar</a>`;
      }

      html += `
        <div id="alert-${index}" class="w-full flex-none snap-center h-16 ${bgColor} backdrop-blur-sm border ${borderColor} rounded-xl px-4 flex items-center gap-3 shadow-sm relative pr-10">
          <div class="shrink-0">
            <i data-lucide="${lucideIcon}" class="w-5 h-5 ${iconColor}"></i>
          </div>
          <div class="flex-1 min-w-0 flex flex-col justify-center pr-2">
            <h3 class="text-xs font-bold text-zinc-800 dark:text-zinc-200 leading-none truncate mb-1">${alert.nome}</h3>
            <p class="text-[10px] text-zinc-500 dark:text-zinc-400 leading-tight line-clamp-2">${alert.mensagem}</p>
          </div>
          <div class="flex items-center self-center">
            ${actionHtml}
          </div>
          <button
            data-action="dismiss-alert"
            data-alert-index="${index}"
            data-alert-id="${alert.id}"
            class="absolute top-2 right-2 p-1.5 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors z-10"
            aria-label="Fechar aviso">
            <i data-lucide="x" class="w-3 h-3"></i>
          </button>
        </div>
      `;
    });

    html += "</div>"; // Fecha Slider Track

    if (alerts.length > 1) {
      html +=
        '<div id="alerts-pagination" class="flex justify-center gap-1 mt-1.5">';
      alerts.forEach((_, i) => {
        const activeClass =
          i === 0 ? "bg-blue-500 w-3" : "bg-zinc-300 dark:bg-zinc-700 w-1.5";
        html += `<div class="h-1.5 rounded-full transition-all duration-300 ${activeClass}" data-index="${i}"></div>`;
      });
      html += "</div>";
    }

    html += "</div>"; // Fecha Container Principal
    return html;
  },

  dismiss: (index, id) => {
    const el = document.getElementById(`alert-${index}`);
    if (el) el.remove();
    if (id === "pwa-install") sessionStorage.setItem("pwa_dismissed", "true");
    const container = document.getElementById("alerts-slider");
    if (!container || container.children.length === 0) {
      const wrapper = document.getElementById("alerts-dynamic-container");
      if (wrapper) wrapper.remove();
    } else {
      const dots = document.getElementById("alerts-pagination");
      if (dots && dots.lastChild) dots.lastChild.remove();
    }
  },
};

async function updateAlertsSystem(trainList) {
  let tempAlerts = [];
  const pwa = AlertsManager.checkPWA();
  if (pwa) tempAlerts.push(pwa);
  const sudoku = AlertsManager.checkSudoku(trainList);
  if (sudoku) tempAlerts.push(sudoku);
  const external = await AlertsManager.fetch();
  external.forEach((alert) => {
    if (AlertsManager.isActive(alert)) {
      tempAlerts.push(alert);
    }
  });
  tempAlerts.sort((a, b) => {
    if (a.tipo === "aviso" && b.tipo !== "aviso") return -1;
    if (a.tipo !== "aviso" && b.tipo === "aviso") return 1;
    return 0;
  });
  activeAlerts = tempAlerts;
}

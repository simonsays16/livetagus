/**
 * app-init.js
 * Inicialização da app e configuração de todos os event listeners.
 *
 *  1. Carrega preferências do localStorage (síncrono, <1ms)
 *  2. Remove "hidden" do #next-train-header ANTES de qualquer render
 *     → o espaço fica reservado desde o início; só opacity muda depois
 *  3. Faz fetch dos JSON locais (SW cache → resposta <10ms mesmo offline)
 *  4. Renderiza imediatamente os cartões com status "OFFLINE" via buildOfflineTrainList()
 *     → o utilizador vê os comboios ANTES de qualquer chamada à API
 *  5. Inicia o fetch à API em paralelo; quando responde, o reconciliador
 *     patcha apenas os campos dinâmicos (status, horas, dot) → ZERO CLS
 *
 * Depende de: app-config.js, app-settings.js, app-alerts.js,
 *             app-trains.js, app-ui.js
 */

async function init() {
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) {
    document.body.classList.add("is-ios");
  }

  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }

  setupPWA();
  loadSettings();

  const savedOrg = localStorage.getItem("ft_org");
  const savedDest = localStorage.getItem("ft_dst");
  if (savedOrg) fertagusOrigin = savedOrg;
  if (savedDest) fertagusDest = savedDest;

  // ── RESERVA DE ESPAÇO PARA O CABEÇALHO DO PRÓXIMO COMBOIO ──────────
  // Remove a classe "hidden" (display:none) ANTES de qualquer paint,
  // para que o espaço esteja sempre reservado. Apenas opacity muda depois.
  // Isto elimina o CLS causado pelo header fixo que crescia ao aparecer.
  const nextHeader = document.getElementById("next-train-header");
  if (nextHeader) {
    nextHeader.classList.remove("hidden");
    // Mantém invisível até haver dados
    if (!nextHeader.classList.contains("opacity-0")) {
      nextHeader.classList.add("opacity-0");
    }
  }

  // Aguarda que o menu.js construa o DOM do menu
  setTimeout(injectCustomMenuElements, 100);

  // ── CARREGAMENTO DOS JSON LOCAIS (SW cache, quasi-instantâneo) ──────
  try {
    const [resLisboa, resMargem, resFeriados] = await Promise.all([
      fetch("./json/fertagus_sentido_lisboa.json"),
      fetch("./json/fertagus_sentido_margem.json"),
      fetch("./json/feriados.json"),
    ]);
    if (resLisboa.ok) DB_LISBOA = await resLisboa.json();
    if (resMargem.ok) DB_MARGEM = await resMargem.json();
    if (resFeriados.ok) FERIADOS_DB = await resFeriados.json();
  } catch (e) {
    console.error("DB Load Error:", e);
    DB_LISBOA = { trips: [] };
    DB_MARGEM = { trips: [] };
    FERIADOS_DB = {};
  }

  // ── HORÁRIO INTELIGENTE ─────────────────────────────────────────────
  let targetTab = "lisboa";
  if (typeof _isSmartConfigured === "function" && _isSmartConfigured()) {
    const detected = _detectSmartTab();
    targetTab = detected || localStorage.getItem("ft_tab") || "lisboa";
  } else {
    const savedTab = localStorage.getItem("ft_tab");
    if (savedTab) targetTab = savedTab;
  }

  activeTab = targetTab;
  loadStationPrefs(activeTab);

  // Popula os selects iniciais
  populateOriginSelect();
  populateDestSelect(fertagusOrigin);

  const orgSel = document.getElementById("sel-origin");
  const dstSel = document.getElementById("sel-dest");
  if (orgSel) orgSel.value = fertagusOrigin;
  if (dstSel) dstSel.value = fertagusDest;

  // ── PRÉ-RENDERIZAÇÃO OFFLINE IMEDIATA ──────────────────────────────
  // Os JSON estão em cache no SW → buildOfflineTrainList() é síncrono.
  // Renderiza cartões com status "OFFLINE" antes de qualquer fetch à API.
  // Quando a API responder, o reconciliador faz patch in-place → ZERO CLS.
  const offlineList =
    typeof buildOfflineTrainList === "function" ? buildOfflineTrainList() : [];

  if (offlineList.length > 0) {
    renderList(offlineList);
    setStatus("offline");
  }

  // ── DADOS EM TEMPO REAL (fetch à API) ───────────────────────────────
  // updateAppState() chama loadData() que faz o fetch e reconcilia o DOM.
  updateAppState();

  // Refresh automático a cada 30 segundos
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(() => {
    if (!isLoading) loadData(true);
  }, 30000);

  // Countdown do próximo comboio a cada 1 segundo
  if (nextTrainInterval) clearInterval(nextTrainInterval);
  nextTrainInterval = setInterval(updateNextCountdown, 1000);

  if (window.lucide) lucide.createIcons();
}

// ─── PONTO DE ENTRADA ─────────────────────────────────────────────────

window.onload = function () {
  init();
};

// ─── LISTENERS ESTÁTICOS ──────────────────────────────────────────────
// Executados aqui porque o script é "defer" e o DOM já está pronto.

(function setupStaticListeners() {
  const selOrigin = document.getElementById("sel-origin");
  if (selOrigin) selOrigin.addEventListener("change", handleOriginChange);

  const btnSwap = document.getElementById("btn-swap");
  if (btnSwap) btnSwap.addEventListener("click", swapStations);

  const selDest = document.getElementById("sel-dest");
  if (selDest) selDest.addEventListener("change", handleDestChange);

  const loadMoreBtn = document.getElementById("load-more-btn");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", function () {
      displayLimit += 10;
      renderList(currentTrainList);
    });
  }

  const backdrop = document.getElementById("modal-backdrop");
  if (backdrop) backdrop.addEventListener("click", closeDetails);
})();

// ─── DELEGAÇÃO DE EVENTOS (elementos dinâmicos) ───────────────────────

document.body.addEventListener("click", function (e) {
  const el = e.target.closest("[data-action]");
  if (!el) return;

  const action = el.dataset.action;
  switch (action) {
    case "open-details":
      openDetails(el.dataset.trainId);
      break;
    case "close-details":
      closeDetails();
      break;
    case "dismiss-ip-popup":
      dismissIpDownPopup();
      break;
    case "dismiss-alert":
      AlertsManager.dismiss(
        parseInt(el.dataset.alertIndex, 10),
        el.dataset.alertId,
      );
      break;
    case "install-pwa":
      installPWA();
      break;
    case "play-sudoku":
      sa_event("sudoku_started_alertbtn");
      break;
    case "open-sudoku-btm":
      sa_event("sudoku_started_btm");
      break;
    case " topbtnapp_sudoku":
      sa_event("sudoku_started_topbtnapp");
      break;
    case " topbtnapp_paragem":
      sa_event("paragem_clicked_topbtnapp");
      break;
    case "go-offline":
      sa_event("offline_schedules_forced");
      break;
    case "open-smart-menu":
      const menuTrigger = document.getElementById("menu-trigger");
      if (menuTrigger) menuTrigger.click();
      sa_event("topbtnapp_clicked");
      break;
    case "sudoku-offline":
      sa_event("sudoku-offline-play");
      break;
    default:
      break;
  }
});

// Selects da viagem
document.body.addEventListener("change", function (e) {
  const id = e.target.id;
  if (id === "sel-origin") handleOriginChange();
  else if (id === "sel-dest") handleDestChange();
});

// ─── RETOMA APÓS BACKGROUND ───────────────────────────────────────────

let lastBackgroundTime = 0;

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    lastBackgroundTime = Date.now();
  } else if (document.visibilityState === "visible") {
    // Reload após 1 hora em background (dados muito desatualizados)
    if (lastBackgroundTime > 0 && Date.now() - lastBackgroundTime > 3600000) {
      window.location.reload();
      return;
    }

    if (typeof updateOfflineUI === "function") updateOfflineUI();

    if (navigator.onLine) {
      if (typeof loadData === "function" && !isLoading) loadData(true);
      if (typeof updateNextCountdown === "function") updateNextCountdown();
    }
  }
});

// Fallback para browsers antigos que não suportam visibilitychange
window.addEventListener("focus", () => {
  if (navigator.onLine && typeof updateOfflineUI === "function") {
    updateOfflineUI();
  }
});

/**
 * app-init.js
 * Inicialização da app e configuração de todos os event listeners.
 *
 * Este ficheiro substitui TODOS os atributos onclick/onchange que existiam
 * no HTML original, através de dois mecanismos:
 *
 * 1. addEventListener direto — para elementos estáticos com ID conhecidos
 *    (sel-origin, sel-dest, btn-swap, load-more-btn, modal-backdrop)
 *
 * 2. Delegação de eventos no document.body — para elementos gerados
 *    dinamicamente (cards de comboio, alertas, modal de detalhes)
 *    usando o atributo data-action.
 *
 * Depende de: app-config.js, app-settings.js, app-alerts.js,
 *             app-trains.js, app-ui.js
 */

// ─── INICIALIZAÇÃO PRINCIPAL ──────────────────────────────────────────────────

async function init() {
  // Impede o browser de restaurar o scroll no reload
  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }

  setupPWA();
  loadSettings();

  const savedOrg = localStorage.getItem("ft_org");
  const savedDest = localStorage.getItem("ft_dst");

  if (savedOrg) fertagusOrigin = savedOrg;
  if (savedDest) fertagusDest = savedDest;

  // Aguarda que o menu.js construa o DOM do menu (pequeno timeout de segurança)
  setTimeout(injectCustomMenuElements, 100);

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

  // Determina o tab inicial:
  // 1. Se o Horário Inteligente estiver configurado, usa-o para detetar o sentido.
  // 2. Se a deteção não encontrar uma janela ativa, mantém o último tab guardado.
  // 3. Caso contrário, usa "lisboa" como default.
  let targetTab = "lisboa";
  if (typeof _isSmartConfigured === "function" && _isSmartConfigured()) {
    const detected = _detectSmartTab();
    // Deteção bem-sucedida → usa o sentido correto; fora de janelas → mantém o último tab
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

  // Garante que os valores dos selects correspondem ao estado
  const orgSel = document.getElementById("sel-origin");
  const dstSel = document.getElementById("sel-dest");
  if (orgSel) orgSel.value = fertagusOrigin;
  if (dstSel) dstSel.value = fertagusDest;

  updateAppState();

  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(() => {
    if (!isLoading) loadData(true);
  }, 30000);

  if (nextTrainInterval) clearInterval(nextTrainInterval);
  nextTrainInterval = setInterval(updateNextCountdown, 1000);

  if (window.lucide) lucide.createIcons();
}

// ─── PONTO DE ENTRADA ─────────────────────────────────────────────────────────

// Mantém o window.onload original para preservar o comportamento de timing
window.onload = function () {
  init();
};

// ─── EVENT LISTENERS ESTÁTICOS ────────────────────────────────────────────────
// Substituem os atributos onchange/onclick que foram removidos do HTML.
// Executados aqui porque o script é "defer" e o DOM está pronto.

(function setupStaticListeners() {
  // Select de Partida
  const selOrigin = document.getElementById("sel-origin");
  if (selOrigin) {
    selOrigin.addEventListener("change", handleOriginChange);
  }

  // Botão de Troca de Estações
  const btnSwap = document.getElementById("btn-swap");
  if (btnSwap) {
    btnSwap.addEventListener("click", swapStations);
  }

  // Select de Destino
  const selDest = document.getElementById("sel-dest");
  if (selDest) {
    selDest.addEventListener("change", handleDestChange);
  }

  // Botão "Ver Mais Comboios"
  const loadMoreBtn = document.getElementById("load-more-btn");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", function () {
      displayLimit += 10;
      renderList(currentTrainList);
    });
  }

  // Backdrop do Modal (fechar ao clicar fora)
  const backdrop = document.getElementById("modal-backdrop");
  if (backdrop) {
    backdrop.addEventListener("click", closeDetails);
  }
})();

// ─── DELEGAÇÃO DE EVENTOS (elementos gerados dinamicamente) ──────────────────
// Trata de todos os data-action gerados pelo AlertsManager, renderList e
// openDetails, evitando inline onclick em conteúdo dinâmico.

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

    case "open-spotify":
      sa_event("spotify_suggestion_opened");
      break;

    case "go-offline":
      sa_event("offline_schedules_forced");
      break;

    case "sudoku-offline":
      sa_event("sudoku-offline-play");
      break;

    default:
      break;
  }
});

// Delegação para os selects dos elementos principais da app.
document.body.addEventListener("change", function (e) {
  const id = e.target.id;
  if (id === "sel-origin") {
    handleOriginChange();
  } else if (id === "sel-dest") {
    handleDestChange();
  }
});

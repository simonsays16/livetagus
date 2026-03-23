/**
 * app-ui.js
 * Toda a lógica de UI: renderização da lista de comboios, modal de detalhes,
 * selects de estações, status, tabs e ações do utilizador.
 * Depende de: app-config.js, app-alerts.js, app-trains.js
 *
 * NOTA CSP: Os botões gerados dinamicamente (openDetails, closeDetails, loadMore)
 * usam data-action em vez de onclick. O despacho é feito em app-init.js.
 */

// ─── COUNTDOWN & STATUS ───────────────────────────────────────────────────────

window.updateNextCountdown = function () {
  if (!nextTrainDate) {
    document
      .getElementById("next-train-header")
      .classList.add("opacity-0", "hidden");
    return;
  }
  const now = new Date();
  let diff = Math.floor((nextTrainDate - now) / 1000);
  if (diff < 0) diff = 0;
  const min = Math.floor(diff / 60);
  const sec = Math.floor((diff % 60) / 10) * 10;
  document.getElementById("countdown-display").innerText =
    `${min} min ${sec.toString().padStart(2, "0")} s`;
  if (min > 100)
    document.getElementById("countdown-display").innerText = `AMANHÃ`;
  const header = document.getElementById("next-train-header");
  header.classList.remove("hidden");
  requestAnimationFrame(() => header.classList.remove("opacity-0"));
};

window.setStatus = function (s, msg) {
  const ping = document.getElementById("status-ping"),
    icon = document.getElementById("refresh-icon-menu");
  const lastUpd = document.getElementById("last-updated");

  if (s === "loading") {
    if (icon) icon.classList.add("animate-spin");
  } else if (s === "error" || s === "offline") {
    if (ping)
      ping.className =
        "relative inline-flex h-1.5 w-1.5 rounded-full " +
        (s === "offline" ? "bg-zinc-500" : "bg-red-500");
    if (lastUpd) lastUpd.innerText = "Offline";
    if (icon) icon.classList.remove("animate-spin");
  } else {
    if (ping)
      ping.className =
        "relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500 dot-ping";
    if (lastUpd)
      lastUpd.innerText = new Date()
        .toLocaleTimeString("pt-PT")
        .substring(0, 5);
    if (icon) icon.classList.remove("animate-spin");
  }
};

// ─── CARREGAMENTO DE DADOS ────────────────────────────────────────────────────

window.loadData = async function (silent = false) {
  if (isLoading) return;
  isLoading = true;
  if (!silent) setStatus("loading", "A atualizar...");

  try {
    if (!silent) await new Promise((r) => setTimeout(r, 300));
    const data = await getTrains();
    await updateAlertsSystem(data);
    renderList(data);
    if (data.length > 0) setStatus("success");
    else if (activeTab === "lisboa") setStatus("offline", "Sem Dados");
    else setStatus("success", "Online");
  } catch (e) {
    console.error(e);
    setStatus("error");
  } finally {
    isLoading = false;
    if (window.lucide) lucide.createIcons();
  }
};

window.manualRefresh = function () {
  console.log("manual refresh");
  focusOnContent();
  loadData(false);
};

// ─── TABS & ESTADO ────────────────────────────────────────────────────────────

window.switchTab = function (t) {
  if (t !== activeTab) {
    const oldOrg = fertagusOrigin;
    fertagusOrigin = fertagusDest;
    fertagusDest = oldOrg;
  }

  activeTab = t;

  document.getElementById("ambient-light").className =
    `fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full blur-[120px] pointer-events-none transition-colors duration-1000 bg-blue-500/10`;

  populateOriginSelect();
  populateDestSelect(fertagusOrigin);
  validateRoute();
  saveState();

  document.getElementById("train-list").innerHTML = "";
  window.hasScrolledNext = false;
  document.getElementById("next-train-header").classList.add("hidden");

  loadData(false);
};

window.saveState = function () {
  localStorage.setItem("ft_org", fertagusOrigin);
  localStorage.setItem("ft_dst", fertagusDest);
  localStorage.setItem("ft_tab", activeTab);
};

// ─── SELECTS DE ESTAÇÕES ──────────────────────────────────────────────────────

window.populateOriginSelect = function () {
  const orgSel = document.getElementById("sel-origin");
  const dstSel = document.getElementById("sel-dest");

  if (!orgSel || !dstSel) return;

  let options = [];
  if (activeTab === "lisboa") {
    options = FERTAGUS_STATIONS.slice(0, FERTAGUS_STATIONS.length);
  } else {
    options = FERTAGUS_STATIONS.slice().reverse();
  }

  const createOpts = (list) =>
    list.map((s) => `<option value="${s.key}">${s.name}</option>`).join("");

  orgSel.innerHTML = createOpts(options);

  if (options.find((o) => o.key === fertagusOrigin)) {
    orgSel.value = fertagusOrigin;
  } else {
    orgSel.value = activeTab === "lisboa" ? "setubal" : "roma_areeiro";
    fertagusOrigin = orgSel.value;
  }

  updateDestinationOptions();
};

window.updateDestinationOptions = function () {
  const destSel = document.getElementById("sel-dest");
  if (!destSel) return;

  const orgIdx = FERTAGUS_STATIONS.findIndex((s) => s.key === fertagusOrigin);

  let validDestinations = [];
  if (activeTab === "lisboa") {
    validDestinations = FERTAGUS_STATIONS.slice(orgIdx + 1);
  } else {
    validDestinations = FERTAGUS_STATIONS.slice(0, orgIdx).reverse();
  }

  destSel.innerHTML = validDestinations
    .map((s) => `<option value="${s.key}">${s.name}</option>`)
    .join("");

  if (validDestinations.find((o) => o.key === fertagusDest)) {
    destSel.value = fertagusDest;
  } else {
    if (validDestinations.length > 0) {
      destSel.value = validDestinations[0].key;
      fertagusDest = destSel.value;
    }
  }
};

window.populateDestSelect = function (currentOrigin) {
  const dstSel = document.getElementById("sel-dest");
  if (!dstSel) return;

  const validDests = FERTAGUS_STATIONS.filter((s) => s.key !== currentOrigin);
  dstSel.innerHTML = validDests
    .map((s) => `<option value="${s.key}">${s.name}</option>`)
    .join("");

  if (validDests.find((s) => s.key === fertagusDest)) {
    dstSel.value = fertagusDest;
  } else {
    if (validDests.length > 0) {
      fertagusDest = validDests[0].key;
      dstSel.value = fertagusDest;
    }
  }
};

// Aliases para compatibilidade com menu.js e código legado
window.updateStations = function () {
  handleOriginChange();
};
window.updateStationLabels = function () {}; // no-op, UI usa selects

// ─── HANDLERS DE ALTERAÇÃO DE ESTAÇÃO ────────────────────────────────────────

window.handleOriginChange = function () {
  const orgSel = document.getElementById("sel-origin");
  if (!orgSel) return;

  fertagusOrigin = orgSel.value;

  populateDestSelect(fertagusOrigin);

  if (fertagusDest === fertagusOrigin) {
    const dstSel = document.getElementById("sel-dest");
    if (dstSel && dstSel.options.length > 0) {
      fertagusDest = dstSel.options[0].value;
      dstSel.value = fertagusDest;
    }
  } else {
    const dstSel = document.getElementById("sel-dest");
    if (dstSel) dstSel.value = fertagusDest;
  }

  updateAppState();
  setTimeout(focusOnContent, 1000);
};

window.handleDestChange = function () {
  const dstSel = document.getElementById("sel-dest");
  if (!dstSel) return;
  fertagusDest = dstSel.value;
  updateAppState();
};

window.swapStations = function () {
  const temp = fertagusOrigin;
  fertagusOrigin = fertagusDest;
  fertagusDest = temp;

  const orgSel = document.getElementById("sel-origin");
  if (orgSel) orgSel.value = fertagusOrigin;

  populateDestSelect(fertagusOrigin);

  const dstSel = document.getElementById("sel-dest");
  if (dstSel) dstSel.value = fertagusDest;

  updateAppState();
};

window.validateRoute = function () {
  return true;
};

function updateAppState() {
  const newDirection = calculateDirection(fertagusOrigin, fertagusDest);
  if (newDirection !== activeTab) {
    activeTab = newDirection;
  }
  saveState();
  loadData();
  setTimeout(() => {
    focusOnContent();
  }, 800);
}

// ─── MODAL DE DETALHES ────────────────────────────────────────────────────────

/**
 * Abre o modal de detalhes de um comboio.
 * NOTA CSP: O botão de fechar usa data-action="close-details".
 */
function openDetails(trainId) {
  sa_event("open_details_train");
  const t = currentTrainList.find((train) => train.id == trainId);
  if (!t) return;
  let occColorClass = "text-emerald-500",
    barColorClass = "bg-emerald-500";
  if (t.occupancy > 85) {
    occColorClass = "text-red-500";
    barColorClass = "bg-red-500";
  } else if (t.occupancy > 50) {
    occColorClass = "text-yellow-500";
    barColorClass = "bg-yellow-500";
  }

  let carsHtml = "";
  const count = t.carriages || 4;
  const filledCount = t.occupancy
    ? Math.round((t.occupancy / 100) * count)
    : count;
  if (t.occupancy !== null && t.occupancy !== undefined) {
    for (let c = 0; c < count; c++) {
      const isFilled = c < filledCount;
      const color = isFilled ? barColorClass : "bg-zinc-700/50";
      carsHtml += `<div class="h-2 flex-1 rounded-sm ${color} transition-all"></div>`;
    }
  } else {
    for (let c = 0; c < count; c++) {
      carsHtml += `<div class="h-2 flex-1 rounded-sm bg-zinc-700/50 border border-zinc-600/30"></div>`;
    }
  }

  let timelineHtml = "";
  if (t.fullSchedule) {
    t.fullSchedule.forEach((node, i) => {
      const isPassed = node.ComboioPassou;
      const isNext =
        !isPassed && (i === 0 || t.fullSchedule[i - 1].ComboioPassou);
      const dotColor = isPassed
        ? "bg-zinc-700 border-zinc-700"
        : isNext
          ? "bg-blue-500 border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.4)]"
          : "bg-zinc-800 border-zinc-600";
      const textColor = isPassed
        ? "text-zinc-600"
        : isNext
          ? "text-zinc-600 font-bold dark:text-zinc-200"
          : "text-zinc-500";
      const timeColor = isPassed
        ? "text-zinc-700"
        : isNext
          ? "text-blue-400 font-bold"
          : "text-zinc-500";
      const scheduledTime = node.HoraProgramada.substring(0, 5);
      const predictedTime = node.HoraPrevista
        ? node.HoraPrevista.substring(0, 5)
        : scheduledTime;
      let timeDisplay = scheduledTime;
      let subTime = "";
      if (predictedTime !== scheduledTime && !t.isSuppressed) {
        timeDisplay = predictedTime;
        subTime = scheduledTime;
      }
      timelineHtml += `
        <div class="relative z-10 flex items-center mb-8 last:mb-0 group">
          <div class="w-14 text-right mr-6 flex-shrink-0 flex flex-col items-end">
            <span class="font-mono text-sm ${timeColor} leading-none">${timeDisplay}</span>
            ${subTime ? `<span class="text-[9px] text-zinc-700 line-through decoration-zinc-700/50 mt-0.5">${subTime}</span>` : ""}
          </div>
          <div class="w-3 h-3 rounded-full border-2 ${dotColor} flex-shrink-0 transition-all group-hover:scale-110 z-20 relative"></div>
          <div class="ml-6 flex-1">
            <h4 class="text-sm ${textColor}">${node.NomeEstacao}</h4>
            ${isPassed ? "" : isNext ? '<span class="text-[9px] text-blue-500 uppercase tracking-wider font-bold animate-pulse block mt-0.5">Próxima</span>' : ""}
          </div>
        </div>`;
    });
  } else {
    const currentDB = activeTab === "lisboa" ? DB_LISBOA : DB_MARGEM;
    const dbTrain = currentDB.trips.find((trip) => trip.id == t.id);
    if (dbTrain) {
      const stations = FERTAGUS_STATIONS.filter((st) => dbTrain[st.key]);
      let stationsToRender =
        activeTab === "margem" ? [...stations].reverse() : stations;
      stationsToRender.forEach((st) => {
        const time = dbTrain[st.key];
        if (time) {
          timelineHtml += `
            <div class="relative z-10 flex items-center mb-8 last:mb-0">
              <div class="w-14 text-right mr-6 flex-shrink-0">
                <span class="font-mono text-sm text-zinc-500 leading-none">${time}</span>
              </div>
              <div class="w-3 h-3 rounded-full border-2 bg-zinc-800 border-zinc-600 flex-shrink-0 z-20 relative"></div>
              <div class="ml-6 flex-1">
                <h4 class="text-sm text-zinc-400">${st.name}</h4>
              </div>
            </div>`;
        }
      });
    }
  }

  const fullContent = `
    <div class="flex flex-col h-full bg-[#09090b]">
      <!-- Header Sticky -->
      <div class="relative z-20 backdrop-blur-md border-b border-white/5 pt-6 pb-6 px-6 shadow-xl bg-zinc-50 dark:bg-zinc-900/65">
        <button data-action="close-details" class="absolute top-5 right-5 p-2 bg-white/5 hover:bg-white/10 rounded-full text-zinc-400 hover:text-white transition-all">
          <i data-lucide="x" class="w-5 h-5"></i>
        </button>
        <div class="flex flex-col gap-6">
          <div>
            <div class="flex items-center gap-2 mb-2">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase tracking-wider">Fertagus</span>
              <span class="font-mono text-xs text-zinc-600 dark:text-zinc-400">#${t.num}</span>
            </div>
            <div class="flex justify-between items-end">
              <h2 class="text-2xl font-bold tracking-tight leading-none text-zinc-900 dark:text-zinc-100">${t.dest}</h2>
              <div class="text-right">
                <span class="text-3xl font-mono font-bold tracking-tighter leading-none text-zinc-900 dark:text-zinc-100">${t.time}</span>
                ${t.secTime ? `<span class="block text-xs text-zinc-600 dark:text-zinc-400 line-through text-right mt-0.5 font-mono">${t.secTime}</span>` : ""}
              </div>
            </div>
            <div class="flex items-center justify-between mt-3">
              <span class="text-xs text-zinc-500 dark:text-zinc-400">De <span class="font-medium text-zinc-400 dark:text-zinc-300">${t.op === "FERTAGUS" ? (activeTab === "lisboa" ? "Setúbal/Coina" : "Roma-Areeiro") : t.op}</span></span>
              <div class="flex items-center gap-2 px-2 py-1 rounded-full bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">
                <div class="w-1.5 h-1.5 rounded-full ${t.dotStatus === "green" ? "bg-emerald-500" : t.dotStatus === "yellow" ? "bg-yellow-500" : "bg-red-500"} animate-pulse"></div>
                <span class="text-[10px] font-bold uppercase text-zinc-500 dark:text-zinc-300 leading-none">${t.status}</span>
              </div>
            </div>
          </div>
          <!-- Stats Grid -->
          <div class="grid grid-cols-2 gap-3">
            <div class="rounded-xl p-3 border border-black/5 dark:border-white/5 flex flex-col justify-between min-h-[70px] bg-white/50 dark:bg-zinc-800/40">
              <span class="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Carruagens</span>
              <div class="flex items-end gap-1 mt-1">
                <span class="text-2xl font-mono font-bold leading-none text-zinc-900 dark:text-zinc-100">${t.carriages}</span>
                <span class="text-[10px] text-zinc-500 mb-0.5">unid.</span>
              </div>
            </div>
            <div class="rounded-xl p-3 border border-black/5 dark:border-white/5 flex flex-col justify-between min-h-[70px] bg-white/50 dark:bg-zinc-800/40">
              <span class="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Ocupação</span>
              <div class="flex items-end gap-1 mt-1">
                ${t.occupancy !== null ? `<span class="text-2xl font-mono font-bold ${occColorClass} leading-none">${t.occupancy}%</span>` : `<span class="text-[11px] text-zinc-600 italic">Apenas Hora de Ponta</span>`}
              </div>
            </div>
          </div>
          ${t.occupancy !== null ? `<div class="hidden flex gap-1.5 w-full mt-1">${carsHtml}</div>` : ""}
          <p style="margin-top: -14px" class="text-[9px] text-zinc-500 dark:text-zinc-400 leading-relaxed ${t.occupancy !== null ? "" : "hidden"}">
            Estimativa de Lotação: Os dados baseiam-se no histórico oficial da Fertagus e <b>não</b> em tempo real. 
            <a class="underline" target="_blank" href="https://www.fertagus.pt/Fertagus-pt/Viajar/Comunicados-e-Campanhas/Nova-oferta-de-comboios-duplos-e-simples-20-de-janeiro-25" aria-label="Site Oficial da Fertagus, Tabela de Ocupação">
              Vê a Fonte da Informação
            </a>
          </p>
        </div>
        
      </div>
      <!-- Scrollable Timeline -->
      <div class="flex-grow overflow-y-auto px-6 py-8 relative bg-zinc-50 dark:bg-[#09090b]">
        <!--<div class="absolute left-[85px] top-0 bottom-0 w-[1px] bg-zinc-300 dark:bg-zinc-800"></div>-->
        ${timelineHtml}
        <div class="h-12"></div>
      </div>
    </div>
  `;

  const modal = document.getElementById("train-details-modal");
  modal.innerHTML = fullContent;
  const backdrop = document.getElementById("modal-backdrop");
  modal.classList.remove("translate-y-full");
  backdrop.classList.remove("hidden");
  setTimeout(() => backdrop.classList.remove("opacity-0"), 10);
  if (window.lucide) lucide.createIcons();
}

function closeDetails() {
  const modal = document.getElementById("train-details-modal");
  const backdrop = document.getElementById("modal-backdrop");
  modal.classList.add("translate-y-full");
  backdrop.classList.add("opacity-0");
  setTimeout(() => backdrop.classList.add("hidden"), 300);
}

// ─── RENDERIZAÇÃO DA LISTA DE COMBOIOS ────────────────────────────────────────

window.renderList = function (list) {
  const container = document.getElementById("train-list");
  const loadMoreBtn = document.getElementById("load-more-btn");
  currentTrainList = list;
  container.innerHTML = "";

  // 1. POP-UP DE BLOQUEIO TOTAL (FALHA DA IP)
  let ipModal = document.getElementById("ip-down-modal");

  if (window.apiIsDown) {
    if (!ipModal) {
      // Cria e injeta o pop-up a cobrir a app inteira
      ipModal = document.createElement("div");
      ipModal.id = "ip-down-modal";
      ipModal.className =
        "fixed inset-0 z-[100] flex items-center justify-center bg-white/80 dark:bg-[#09090b]/80 backdrop-blur-md animate-fade-in px-6";

      ipModal.innerHTML = `
        <div class="bg-white dark:bg-zinc-900 border border-red-500/70 shadow-2xl rounded-3xl p-6 md:p-8 max-w-sm w-full text-center flex flex-col items-center">
          
          <div class="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-5">
            <i data-lucide="server-crash" class="w-8 h-8 text-red-500 animate-pulse"></i>
          </div>
          
          <h2 class="text-xl font-bold text-zinc-900 dark:text-white mb-2 leading-tight">Falha na Infraestruturas de Portugal</h2>
          
          <p class="text-xs text-zinc-500 dark:text-zinc-400 mb-6 leading-relaxed">
            Os servidores com informações de circulação da <b>IP</b> foram abaixo. A infraestrutura da LiveTagus encontra-se 100% operacional, mas sem a fonte oficial não conseguimos obter a localização dos comboios. Isto <b>não</b> significa que os comboios estejam com perturbações na circulação!
          </p>
          
          <a data-action="go-offline" href="./horarios" class="w-full py-3.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold tracking-widest uppercase transition-all active:scale-95 shadow-lg shadow-red-500/20">
            Ver Horários Offline
          </a>

          <a data-action="sudoku-offline" href="./sudoku" class="mt-6 w-full py-3.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold tracking-widest uppercase transition-all active:scale-95 shadow-lg shadow-red-500/20">
            Aproveitar e Jogar Sudoku
          </a>
          
          <div class="flex items-center gap-2 mt-5 text-[10px] text-zinc-400">
            <span class="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-ping"></span>
            A tentar religar automaticamente...
          </div>
          
        </div>
      `;
      document.body.appendChild(ipModal);
      if (window.lucide) lucide.createIcons();
    }
    // Aborta a renderização da lista para não fazer nada por trás do modal
    return;
  } else {
    // Se a IP recuperou, remove o modal automaticamente
    if (ipModal) ipModal.remove();
  }

  if (!list || !list.length) {
    container.innerHTML = `<div class="h-60 flex flex-col items-center justify-center text-zinc-500 gap-3"><i data-lucide="train-track" class="w-10 h-10 opacity-20"></i><p class="text-xs tracking-wider uppercase font-medium">Sem comboios próximos<br><a class="text-center underline underline-offset-2" data-action="go-offline" href="./horarios">Vê Horários Offline</a></p></div>`;
    if (window.lucide) lucide.createIcons();
    loadMoreBtn.classList.add("hidden");
    nextTrainDate = null;
    updateNextCountdown();
    return;
  }

  const visibleList = list.slice(0, displayLimit);
  if (list.length > displayLimit) loadMoreBtn.classList.remove("hidden");
  else loadMoreBtn.classList.add("hidden");

  const colorText = "text-blue-500 dark:text-blue-400";
  let nextTrainIndex = list.findIndex(
    (t) => t.isEffectiveFuture && !t.isSuppressed,
  );
  if (nextTrainIndex === -1 && list.some((t) => !t.isSuppressed))
    nextTrainIndex = list.length - 1;
  if (nextTrainIndex === -1) nextTrainIndex = 0;

  nextTrainDate = list[nextTrainIndex]?.effectiveDate;
  updateNextCountdown();

  const dividerHTML = `
    <div class="flex items-center gap-4 py-4 opacity-80 scroll-mt-[180px]" id="next-divider">
      <div class="flex-1 h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50"></div>
      <span class="text-[0.65rem] font-extrabold uppercase tracking-[0.2em] text-blue-500 whitespace-nowrap">Próximo Comboio</span>
      <div class="flex-1 h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50"></div>
    </div>
  `;

  visibleList.forEach((t, i) => {
    const cardId = `train-${t.id}`;
    const isNext = i === nextTrainIndex;
    const isPassed = i < nextTrainIndex;

    if (isNext) {
      container.insertAdjacentHTML("beforeend", dividerHTML);
      const alertsHTML = AlertsManager.generateHTML(activeAlerts);
      if (alertsHTML) container.insertAdjacentHTML("beforeend", alertsHTML);
    }

    let dotClass = "bg-zinc-400 dark:bg-zinc-600",
      glowColor = "rgba(59, 130, 246, 0.5)";
    if (t.dotStatus === "green") {
      dotClass = "bg-emerald-500";
      glowColor = "rgba(16, 185, 129, 0.5)";
    } else if (t.dotStatus === "yellow") {
      dotClass = "bg-amber-500";
      glowColor = "rgba(245, 158, 11, 0.5)";
    } else if (t.dotStatus === "red") {
      dotClass = "bg-red-500";
      glowColor = "rgba(239, 68, 68, 0.5)";
    }

    dotClass += ` shadow-[0_0_8px_${glowColor}]`;
    let pulseStyle =
      t.dotStatus !== "gray" ? `style="--dot-color-glow: ${glowColor}"` : "";
    if (t.dotStatus !== "gray") dotClass += " dot-ping";

    const opacityClass = isPassed
      ? "opacity-60 grayscale-[0.5]"
      : "opacity-100";
    const timeClass = t.isSuppressed
      ? "line-through text-zinc-500 opacity-70"
      : "";
    const arrClass = t.isSuppressed ? "opacity-0" : "";
    const statusTextClass = t.isSuppressed
      ? "text-red-500 font-bold"
      : t.status.includes("Atraso")
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-zinc-500 dark:text-zinc-400";

    let carsHtml = "";
    if (t.carriages) {
      const occ = t.occupancy !== null ? t.occupancy : 0;
      let fillColor =
        occ === 0
          ? "bg-blue-500"
          : occ > 85
            ? "bg-red-500"
            : occ > 50
              ? "bg-yellow-500"
              : "bg-emerald-500";
      const wrapperWidth = t.carriages === 8 ? "w-full" : "w-1/2";
      const filledCount = t.occupancy
        ? Math.round((t.occupancy / 100) * t.carriages)
        : t.carriages;
      let blocks = "";
      for (let c = 0; c < t.carriages; c++) {
        const colorClass =
          c < filledCount ? fillColor : "bg-zinc-300 dark:bg-zinc-700";
        blocks += `<div class="h-[6px] rounded-[2px] transition-all duration-300 ease-out flex-1 ${colorClass} opacity-90"></div>`;
      }
      carsHtml = `<div class="flex justify-center w-full mt-3"><div class="flex gap-1 h-1.5 ${wrapperWidth}">${blocks}</div></div>`;
    }

    let contextHtml = "";
    if (t.context) {
      contextHtml = `
        <div class="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 w-full text-[9px] text-zinc-500">
          <div class="flex items-center justify-end gap-1 opacity-60">
            ${t.context.prev ? `<span class="truncate max-w-[70px]">${t.context.prev.name}</span><span>-</span>` : ""}
          </div>
          <div class="flex flex-col items-center text-zinc-700 dark:text-zinc-300 font-bold scale-110 justify-self-center min-w-[80px]">
            <span>${t.context.curr.name}</span>
          </div>
          <div class="flex items-center justify-start gap-1 opacity-60">
            ${t.context.next ? `<span>-</span><span class="truncate max-w-[70px]">${t.context.next.name}</span>` : ""}
          </div>
        </div>`;
    }

    // NOTA CSP: Botão "Ver Detalhes" usa data-action em vez de onclick
    const innerHTML = `
      <div class="flex justify-between items-start mb-2">
        <div class="flex flex-col">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-[9px] font-bold px-2 py-0.5 rounded-full border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 text-zinc-500 dark:text-zinc-400 tracking-wider uppercase">${t.op}</span>
            <span class="text-[9px] font-mono text-zinc-400 dark:text-zinc-500">#${t.num}</span>
          </div>
          <div class="flex items-baseline gap-2">
            <span class="font-mono text-4xl font-medium tracking-tighter leading-none ${timeClass} text-zinc-900 dark:text-zinc-100">${t.time}</span>
            ${t.secTime ? `<span class="text-[0.55em] line-through opacity-60 font-medium ml-2 text-zinc-500 align-baseline font-mono text-sm">${t.secTime}</span>` : ""}
          </div>
        </div>
        <div class="flex flex-col items-end">
          <h3 class="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide text-right truncate max-w-[100px]">${t.dest}</h3>
          <div class="flex items-baseline mt-1 ${arrClass}">
            <span class="text-[10px] text-zinc-600 dark:text-zinc-500 mr-1">Chegada</span>
            <span style="font-size:1.125rem;line-height:1.75rem" class="font-mono text-lg font-medium ${colorText}">${t.arr}</span>
          </div>
        </div>
      </div>
      <div class="flex items-center justify-between gap-2 mb-1">
        <div class="flex items-center gap-2">
          <div class="w-1.5 h-1.5 rounded-full ${dotClass}" ${pulseStyle}></div>
          <span class="text-[0.65rem] uppercase tracking-wide font-medium ${statusTextClass}">${t.status}</span>
        </div>
        <button
          data-action="open-details"
          data-train-id="${t.id}"
          class="text-[10px] font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 underline decoration-zinc-300 dark:decoration-zinc-700 underline-offset-2 transition-colors">
          Ver Detalhes
        </button>
      </div>
      ${carsHtml}
      ${contextHtml}
    `;

    const card = document.createElement("div");
    card.id = cardId;
    card.setAttribute("data-id", cardId);
    card.className = `bg-white/90 dark:bg-zinc-800/40 backdrop-blur-sm border border-black/5 dark:border-white/5 shadow-sm rounded-2xl p-5 relative overflow-hidden group ${opacityClass}`;
    card.innerHTML = innerHTML;
    container.appendChild(card);
  });

  if (!window.hasScrolledNext && nextTrainIndex !== -1) {
    setTimeout(() => {
      const el = document.getElementById("alerts-dynamic-container");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      window.hasScrolledNext = true;
    }, 800);
  }

  if (activeAlerts.length > 1) {
    const dots = document.querySelectorAll("#alerts-pagination div");
    const slider = document.getElementById("alerts-slider");
    if (slider && dots) {
      slider.onscroll = () => {
        const scrollLeft = slider.scrollLeft;
        const width = slider.offsetWidth;
        const index = Math.round(scrollLeft / width);
        dots.forEach((d, i) => {
          d.className =
            i === index
              ? "bg-blue-500 w-3 h-1.5 rounded-full transition-all duration-300"
              : "bg-zinc-300 dark:bg-zinc-700 w-1.5 h-1.5 rounded-full transition-all duration-300";
        });
      };
    }
  }
};

window.loadMore = function () {
  displayLimit += 10;
  renderList(currentTrainList);
};

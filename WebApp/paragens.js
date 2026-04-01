/**
 * paragens.js
 * Gestão de paragens favoritas e interligação com a API da Carris Metropolitana.
 */

document.addEventListener("DOMContentLoaded", () => {
  const CM_API_BASE = "https://api.carrismetropolitana.pt/v2";
  const STORAGE_KEY = "cm_saved_stops";
  const REFRESH_INTERVAL = 30000;
  const form = document.getElementById("add-stop-form");
  const container = document.getElementById("stops-container");
  const refreshBtn = document.getElementById("refresh-stops-btn");
  let savedStops = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];

  // --- INICIALIZAÇÃO ---
  lucide.createIcons();
  renderStops();
  injectCustomMenuElements();

  // Auto-Refresh silencioso 30s 30s
  setInterval(updateAllStopsData, REFRESH_INTERVAL);

  // --- EVENT LISTENERS ---
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const idInput = document.getElementById("stop-id");
    const nameInput = document.getElementById("stop-name");

    const stopId = idInput.value.trim();
    const stopName = nameInput.value.trim();

    if (stopId && stopName) {
      addStop(stopId, stopName);
      idInput.value = "";
      nameInput.value = "";
    }
  });

  refreshBtn.addEventListener("click", () => {
    const icon = refreshBtn.querySelector("i");
    icon.classList.add("animate-spin");
    updateAllStopsData().finally(() => {
      setTimeout(() => icon.classList.remove("animate-spin"), 500);
    });
  });

  container.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action='delete-stop']");
    if (btn) {
      const idToDelete = btn.dataset.id;
      removeStop(idToDelete);
    }
  });

  // --- LÓGICA CORE ---

  function addStop(id, name) {
    if (savedStops.find((s) => s.id === id && s.name === name)) return;

    savedStops.push({ id, name, addedAt: Date.now() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedStops));
    renderStops();
  }

  function removeStop(id) {
    savedStops = savedStops.filter((s) => s.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedStops));
    renderStops();
  }

  // --- RENDERIZAÇÃO DA UI ---

  function renderStops() {
    container.innerHTML = "";

    if (savedStops.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 border border-dashed border-zinc-200 dark:border-zinc-800">
          <p class="text-xs text-zinc-400">Ainda não guardou nenhuma paragem.</p>
        </div>
      `;
      return;
    }

    savedStops.forEach((stop) => {
      const stopEl = document.createElement("div");
      stopEl.className =
        "border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#09090b] relative overflow-hidden group";

      stopEl.innerHTML = `
        <div class="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/30">
          <div>
            <h3 class="text-sm font-semibold text-zinc-900 dark:text-white uppercase tracking-wider">${stop.name}</h3>
            <p class="text-[10px] text-zinc-500 tracking-widest mt-0.5">ID: ${stop.id}</p>
          </div>
          <button data-action="delete-stop" data-id="${stop.id}" class="text-zinc-300 hover:text-red-500 transition-colors p-2 -mr-2" aria-label="Apagar">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
        <div id="results-${stop.id}" class="flex flex-col">
          <div class="p-6 flex justify-center">
            <div class="w-4 h-4 border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-white rounded-full animate-spin"></div>
          </div>
        </div>
      `;

      container.appendChild(stopEl);
    });

    lucide.createIcons();
    updateAllStopsData();
  }

  // --- FETCHING E PROCESSAMENTO ---

  async function updateAllStopsData() {
    const promises = savedStops.map((stop) => fetchArrivalsForStop(stop.id));
    await Promise.all(promises);
  }

  async function fetchArrivalsForStop(stopId) {
    const resultsContainer = document.getElementById(`results-${stopId}`);
    if (!resultsContainer) return;

    try {
      const res = await fetch(`${CM_API_BASE}/arrivals/by_stop/${stopId}`, {
        cache: "no-store",
      });

      if (!res.ok) throw new Error("API Indisponível");

      const data = await res.json();
      const nowUnix = Math.floor(Date.now() / 1000);

      // Processar e Filtrar Autocarros
      const futureBuses = data
        .map((bus) => {
          // Usar tempo estimado se existir, senão o programado, cor diferente
          const timeUnix =
            bus.estimated_arrival_unix || bus.scheduled_arrival_unix;
          return { ...bus, timeUnix };
        })
        .filter((bus) => bus.timeUnix >= nowUnix - 30)
        .sort((a, b) => a.timeUnix - b.timeUnix)
        .slice(0, 5);

      drawResults(resultsContainer, futureBuses);
    } catch (error) {
      console.error(`Erro ao carregar paragem ${stopId}:`, error);
      resultsContainer.innerHTML = `
        <div class="p-5 flex items-center gap-3 text-red-500/80">
          <i data-lucide="wifi-off" class="w-4 h-4 shrink-0"></i>
          <p class="text-[10px] uppercase tracking-wider font-semibold">Sem ligação aos servidores da Carris.</p>
        </div>
      `;
      lucide.createIcons();
    }
  }

  function drawResults(container, buses) {
    if (buses.length === 0) {
      container.innerHTML = `
        <div class="p-6 text-center">
          <p class="text-xs text-zinc-400">Sem previsões para as próximas horas.</p>
        </div>
      `;
      return;
    }

    const nowUnix = Math.floor(Date.now() / 1000);
    let html = "";

    buses.forEach((bus, index) => {
      // Cálculo do tempo restante
      const diffMins = Math.floor((bus.timeUnix - nowUnix) / 60);
      const live = bus.timeUnix;
      let timeStr = "";
      let timeClass = "text-zinc-900 dark:text-white font-bold";
      let pulseHtml = "";

      if (diffMins <= 0) {
        timeStr = "A CHEGAR";
        timeClass = "text-green-600 dark:text-green-400 font-bold";
        pulseHtml = `<span class="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse mr-1.5"></span>`;
      } else if (diffMins < 60) {
        timeStr = `${diffMins} min`;
      } else {
        // Mais de uma hora, mostra a hora absoluta
        const d = new Date(bus.timeUnix * 1000);
        timeStr = d.toLocaleTimeString("pt-PT", {
          hour: "2-digit",
          minute: "2-digit",
        });
        timeClass = "text-zinc-500 font-medium";
      }

      // Estilo de Lista (com border-b exceto no último)
      const borderClass =
        index === buses.length - 1
          ? ""
          : "border-b border-zinc-100 dark:border-zinc-800";

      html += `
        <div class="px-5 py-3.5 flex items-center justify-between ${borderClass} hover:bg-zinc-50/50 dark:hover:bg-zinc-900/20 transition-colors">
          <div class="flex items-center gap-4 truncate pr-4">
            <div class="bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-2 py-1 min-w-[3rem] text-center shrink-0">
              <span class="text-[10px] font-bold tracking-widest">${bus.line_id}</span>
            </div>
            <p class="text-sm text-zinc-700 dark:text-zinc-300 truncate font-medium">
              ${bus.headsign}
            </p>
          </div>
          
          <div class="flex items-center shrink-0 text-right">
            ${pulseHtml}
            <p class="text-xs uppercase tracking-widest ${timeClass}">${timeStr}</p>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }
});

// copiado de app, a ser removido
function injectCustomMenuElements() {
  const menuOverlay = document.getElementById("menu-overlay");
  const settingsTemplate = document.getElementById("menu-settings-template");

  if (menuOverlay && settingsTemplate) {
    const nav = menuOverlay.querySelector("nav");
    if (nav) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = settingsTemplate.innerHTML;
      nav.parentNode.insertBefore(wrapper, nav.nextSibling);
      const smartContainer = wrapper.querySelector("#smart-schedule-section");
      if (smartContainer) {
        renderSmartSection(smartContainer);
      }

      settingsTemplate.remove();
    }
  }

  const header = document.querySelector("#global-nav header");
  const trigger = document.getElementById("menu-trigger");

  if (header && trigger && !document.getElementById("menu-controls-wrapper")) {
    const wrapper = document.createElement("div");
    wrapper.id = "menu-controls-wrapper";
    wrapper.className = "flex items-center gap-1";
    header.insertBefore(wrapper, trigger);

    const mobilityBtn = document.createElement("button");
    mobilityBtn.id = "mobility-trigger";
    mobilityBtn.className =
      "p-2 rounded-full transition-colors text-zinc-900 dark:text-white group relative";
    mobilityBtn.setAttribute("aria-label", "Ferramentas Inteligentes");

    mobilityBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-waypoints-icon lucide-waypoints w-5 h-5 transition-transform group-active:scale-90">
        <path d="m10.586 5.414-5.172 5.172"/><path d="m18.586 13.414-5.172 5.172"/><path d="M6 12h12"/><circle cx="12" cy="20" r="2"/><circle cx="12" cy="4" r="2"/><circle cx="20" cy="12" r="2"/><circle cx="4" cy="12" r="2"/>
      </svg>
      <span id="mobility-badge-ping" class="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-500 rounded-full animate-ping"></span>
      <span id="mobility-badge" class="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-500 rounded-full"></span>
    `;
    wrapper.appendChild(mobilityBtn);

    wrapper.appendChild(trigger);

    const popover = document.createElement("div");
    popover.id = "mobility-popover";
    popover.className =
      "absolute top-16 right-4 w-64 bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl hidden origin-top-right transition-all duration-300 transform scale-95 opacity-0 z-50 overflow-hidden";

    popover.innerHTML = `
      <div class="px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
        <p class="text-[9px] font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
          Mobilidade Intermodal 
        </p>
      </div>
      
      <div class="flex flex-col">
        
        <a href="./app" class="w-full flex items-center gap-4 px-4 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-left group/btn relative">
          <i data-lucide="train-track" class="w-4 h-4 text-zinc-900 dark:text-white group-hover/btn:scale-110 transition-transform duration-300"></i>
          
          <div class="flex-1">
            <p class="text-sm font-medium text-zinc-900 dark:text-white leading-none">Fertagus tempo real</p>
            <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 font-light tracking-wide">Verifica a circulação da Fertagus</p>
          </div>
          
          <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 group-hover/btn:translate-x-1 transition-transform"></i>
        </a>
        
        <div class="h-px w-full bg-zinc-100 dark:bg-zinc-800"></div>
        
        <a href="./paragens" class="w-full flex items-center gap-4 px-4 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-left group/btn relative">
          <i data-lucide="train-track" class="w-4 h-4 text-zinc-900 dark:text-white group-hover/btn:scale-110 transition-transform duration-300"></i>
          
          <div class="flex-1">
            <p class="text-sm font-medium text-zinc-900 dark:text-white leading-none">Fertagus Tempo Real</p>
            <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 font-light tracking-wide">Verifica a circulação da Fertagus</p>
          </div>
          
          <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 group-hover/btn:translate-x-1 transition-transform"></i>
        </a>

      </div>
    `;

    document.getElementById("global-nav").appendChild(popover);
    mobilityBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = popover.classList.contains("hidden");
      const badgePing = document.getElementById("mobility-badge-ping");
      const badgeSolid = document.getElementById("mobility-badge");
      if (badgePing) badgePing.remove();
      if (badgeSolid) badgeSolid.remove();

      if (isHidden) {
        popover.classList.remove("hidden");
        requestAnimationFrame(() => {
          popover.classList.remove("scale-95", "opacity-0");
          popover.classList.add("scale-100", "opacity-100");
        });
      } else {
        popover.classList.remove("scale-100", "opacity-100");
        popover.classList.add("scale-95", "opacity-0");
        setTimeout(() => popover.classList.add("hidden"), 200);
      }
    });

    // Fechar modal ao clicar em qualquer sítio fora
    document.addEventListener("click", (e) => {
      if (
        !popover.classList.contains("hidden") &&
        !popover.contains(e.target) &&
        !mobilityBtn.contains(e.target)
      ) {
        popover.classList.remove("scale-100", "opacity-100");
        popover.classList.add("scale-95", "opacity-0");
        setTimeout(() => popover.classList.add("hidden"), 200);
      }
    });

    if (window.lucide) lucide.createIcons();
  }

  const footer = document.getElementById("global-footer");
  if (footer) {
    const p = document.createElement("p");
    p.className =
      "text-[0.6rem] text-center text-zinc-500 dark:text-zinc-400 mb-6 opacity-60 block w-full px-4";
    p.innerText =
      "Atenção: Os horários e estado de circulação podem sofrer alterações sem aviso prévio. Esteja na paragem à hora programada.";
    footer.insertBefore(p, footer.firstChild);
  }
}

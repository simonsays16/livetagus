/**
 * app-settings.js
 * Gestão de tema, definições de utilizador, PWA e injeção de elementos no menu.
 * Depende de: app-config.js
 */

// ─── TEMA ─────────────────────────────────────────────────────────────────────

window.setTheme = function (mode) {
  currentTheme = mode;
  localStorage.setItem("theme", mode);
  applyTheme();
};

window.matchMedia("(prefers-color-scheme: dark)").addEventListener(
  "change",
  () => {
    if (currentTheme === "system") applyTheme();
  },
);

window.applyTheme = function () {
  let effectiveDark = false;
  if (currentTheme === "system") {
    effectiveDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  } else {
    effectiveDark = currentTheme === "dark";
  }
  isDarkMode = effectiveDark;

  if (isDarkMode) {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }

  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.classList.remove(
      "font-bold",
      "text-black",
      "dark:text-white",
      "bg-black/5",
      "dark:bg-white/10",
    );
    if (btn.dataset.mode === currentTheme) {
      btn.classList.add(
        "font-bold",
        "text-black",
        "dark:text-white",
        "bg-black/5",
        "dark:bg-white/10",
      );
    }
  });

  const navLogo = document.getElementById("nav-logo");
  const footerLogo = document.getElementById("footer-logo");
  const netlifyBadgeMenu = document.getElementById("netlify-badge-menu");
  const netlifyBadgeFooter = document.getElementById("netlify-badge-footer");

  const logoLight = "./imagens/logotransparente.svg";
  const logoDark = "./imagens/icon.svg";
  const badgeDark =
    "https://www.netlify.com/img/global/badges/netlify-dark.svg";
  const badgeLight =
    "https://www.netlify.com/img/global/badges/netlify-light.svg";

  if (isDarkMode) {
    if (navLogo) navLogo.src = logoDark;
    if (footerLogo) footerLogo.src = logoDark;
    if (netlifyBadgeMenu) netlifyBadgeMenu.src = badgeDark;
    if (netlifyBadgeFooter) netlifyBadgeFooter.src = badgeDark;
  } else {
    if (navLogo) navLogo.src = logoLight;
    if (footerLogo) footerLogo.src = logoLight;
    if (netlifyBadgeMenu) netlifyBadgeMenu.src = badgeLight;
    if (netlifyBadgeFooter) netlifyBadgeFooter.src = badgeLight;
  }
};

// ─── DEFINIÇÕES ───────────────────────────────────────────────────────────────

window.loadSettings = function () {
  const savedTheme = localStorage.getItem("theme");
  setTheme(savedTheme || "system");

  enableRegularStations =
    localStorage.getItem("enable_regular") === "true";
  enableSmartSchedule = localStorage.getItem("enable_smart") === "true";

  const savedSync = localStorage.getItem("pref_sync_stations");
  syncStations = savedSync === "false" ? false : true;

  updateSettingsToggles();
};

window.loadStationPrefs = function (direction) {
  if (!enableRegularStations) return;
  const savedOrg = localStorage.getItem(`pref_${direction}_org`);
  const savedDest = localStorage.getItem(`pref_${direction}_dest`);

  if (savedOrg && FERTAGUS_STATIONS.find((s) => s.key === savedOrg))
    fertagusOrigin = savedOrg;
  if (savedDest && FERTAGUS_STATIONS.find((s) => s.key === savedDest))
    fertagusDest = savedDest;
};

window.saveStationPrefs = function () {
  if (!enableRegularStations) return;
  localStorage.setItem(`pref_${activeTab}_org`, fertagusOrigin);
  localStorage.setItem(`pref_${activeTab}_dest`, fertagusDest);

  if (syncStations) {
    const otherTab = activeTab === "lisboa" ? "margem" : "lisboa";
    localStorage.setItem(`pref_${otherTab}_org`, fertagusDest);
    localStorage.setItem(`pref_${otherTab}_dest`, fertagusOrigin);
  }
};

window.populateSettingsUI = function () {
  const optsLisboa = FERTAGUS_STATIONS.map(
    (s) => `<option value="${s.key}">${s.name}</option>`,
  ).join("");

  const ids = [
    "set-lisboa-org",
    "set-lisboa-dest",
    "set-margem-org",
    "set-margem-dest",
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = optsLisboa;
  });

  const setVal = (id, key, def) => {
    const el = document.getElementById(id);
    if (el) el.value = localStorage.getItem(key) || def;
  };

  setVal("set-lisboa-org", "pref_lisboa_org", "setubal");
  setVal("set-lisboa-dest", "pref_lisboa_dest", "roma_areeiro");
  setVal("set-margem-org", "pref_margem_org", "roma_areeiro");
  setVal("set-margem-dest", "pref_margem_dest", "setubal");

  setVal("smart-morning", "pref_morning", "lisboa");
  setVal("smart-afternoon", "pref_afternoon", "margem");

  updateSyncUI();
};

window.toggleRegularStations = function () {
  enableRegularStations = !enableRegularStations;
  localStorage.setItem("enable_regular", enableRegularStations);
  updateSettingsToggles();
};

window.toggleSmartSchedule = function () {
  enableSmartSchedule = !enableSmartSchedule;
  localStorage.setItem("enable_smart", enableSmartSchedule);
  updateSettingsToggles();
};

window.toggleSyncStations = function () {
  syncStations = !syncStations;
  localStorage.setItem("pref_sync_stations", syncStations);
  updateSyncUI();
};

window.updateSettingsToggles = function () {
  updateToggleVisual(
    "toggle-regular",
    "regular-stations-content",
    enableRegularStations,
  );
  updateToggleVisual(
    "toggle-smart",
    "smart-schedule-content",
    enableSmartSchedule,
  );
};

function updateToggleVisual(btnId, contentId, isEnabled) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const dot = btn.querySelector(".toggle-dot");
  const content = document.getElementById(contentId);

  if (isEnabled) {
    btn.classList.remove("bg-zinc-600");
    btn.classList.add("bg-blue-600");
    dot.classList.remove("translate-x-0");
    dot.classList.add(
      btnId === "btn-sync-stations" ? "translate-x-3" : "translate-x-5",
    );
    content.classList.remove("opacity-50", "pointer-events-none");
  } else {
    btn.classList.add("bg-zinc-600");
    btn.classList.remove("bg-blue-600");
    dot.classList.add("translate-x-0");
    dot.classList.remove(
      btnId === "btn-sync-stations" ? "translate-x-3" : "translate-x-5",
    );
    content.classList.add("opacity-50", "pointer-events-none");
  }
}

window.updateSyncUI = function () {
  const btn = document.getElementById("btn-sync-stations");
  if (!btn) return;
  const dot = btn.querySelector("div");
  const margemGroup = document.getElementById("settings-margem-group");

  if (syncStations) {
    btn.classList.add("bg-blue-600");
    btn.classList.remove("bg-zinc-600");
    dot.classList.add("translate-x-3");
    dot.classList.remove("translate-x-0");
    if (margemGroup) margemGroup.classList.add("hidden");
  } else {
    btn.classList.add("bg-zinc-600");
    btn.classList.remove("bg-blue-600");
    dot.classList.add("translate-x-0");
    dot.classList.remove("translate-x-3");
    if (margemGroup) margemGroup.classList.remove("hidden");
  }
};

window.saveRegularStations = function () {
  const lOrg = document.getElementById("set-lisboa-org").value;
  const lDest = document.getElementById("set-lisboa-dest").value;
  const mOrg = document.getElementById("set-margem-org").value;
  const mDest = document.getElementById("set-margem-dest").value;

  localStorage.setItem("pref_lisboa_org", lOrg);
  localStorage.setItem("pref_lisboa_dest", lDest);

  if (syncStations) {
    localStorage.setItem("pref_margem_org", lDest);
    localStorage.setItem("pref_margem_dest", lOrg);
  } else {
    localStorage.setItem("pref_margem_org", mOrg);
    localStorage.setItem("pref_margem_dest", mDest);
  }
};

window.saveSmartSchedule = function () {
  const morn = document.getElementById("smart-morning").value;
  const aft = document.getElementById("smart-afternoon").value;
  localStorage.setItem("pref_morning", morn);
  localStorage.setItem("pref_afternoon", aft);
};

// ─── PWA ──────────────────────────────────────────────────────────────────────

window.setupPWA = function () {
  const iconUrl = new URL("./imagens/icon.svg", window.location.href).href;
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify({
          name: "LiveTagus",
          short_name: "LiveTagus",
          display: "standalone",
          background_color: "#09090b",
          theme_color: "#09090b",
          orientation: "portrait",
          icons: [{ src: iconUrl, sizes: "512x512", type: "image/svg+xml" }],
        }),
      ],
      { type: "application/json" },
    ),
  );
  document.head.appendChild(link);

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    updateAlertsSystem(currentTrainList).then(() => {
      renderList(currentTrainList);
    });
  });
};

window.installPWA = async function () {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    AlertsManager.dismiss(null, "pwa-install");
  }
};

// ─── INJEÇÃO NO MENU ──────────────────────────────────────────────────────────

/**
 * Injeta os elementos customizados (definições, botão de refresh, aviso legal)
 * no menu gerado pelo menu.js.
 * Chamada com setTimeout(100) a partir do init() para garantir que o menu.js
 * já construiu o DOM do menu.
 */
function injectCustomMenuElements() {
  // 1. Injeta as Definições
  const menuOverlay = document.getElementById("menu-overlay");
  const settingsTemplate = document.getElementById("menu-settings-template");

  if (menuOverlay && settingsTemplate) {
    const nav = menuOverlay.querySelector("nav");
    if (nav) {
      const container = document.createElement("div");
      container.innerHTML = settingsTemplate.innerHTML;
      nav.parentNode.insertBefore(container, nav.nextSibling);

      populateSettingsUI();

      // Adiciona os event listeners aos elementos injetados pelo template
      // (feito aqui em vez de inline para conformidade com CSP)
      const addL = (id, evt, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(evt, fn);
      };

      addL("toggle-regular", "click", toggleRegularStations);
      addL("toggle-smart", "click", toggleSmartSchedule);
      addL("btn-sync-stations", "click", toggleSyncStations);
      addL("set-lisboa-org", "change", saveRegularStations);
      addL("set-lisboa-dest", "change", saveRegularStations);
      addL("set-margem-org", "change", saveRegularStations);
      addL("set-margem-dest", "change", saveRegularStations);
      addL("smart-morning", "change", saveSmartSchedule);
      addL("smart-afternoon", "change", saveSmartSchedule);

      // Remove o template para não deixar IDs duplicados no DOM
      settingsTemplate.remove();
    }
  }

  // 2. Injeta o botão de Refresh no header do menu (à esquerda do trigger)
  const header = document.querySelector("#global-nav header");
  const trigger = document.getElementById("menu-trigger");

  if (header && trigger && !document.getElementById("menu-controls-wrapper")) {
    const wrapper = document.createElement("div");
    wrapper.id = "menu-controls-wrapper";
    wrapper.className = "flex items-center gap-1";

    header.insertBefore(wrapper, trigger);
    wrapper.appendChild(trigger);

    const btn = document.createElement("button");
    btn.addEventListener("click", manualRefresh);
    btn.className =
      "p-2 rounded-full transition-colors text-zinc-900 dark:text-white group";
    btn.setAttribute("aria-label", "Atualizar");
    btn.innerHTML = `<i data-lucide="refresh-cw" id="refresh-icon-menu" class="w-5 h-5 transition-transform group-active:scale-90"></i>`;

    wrapper.insertBefore(btn, trigger);

    if (window.lucide) lucide.createIcons();
  }

  // 3. Injeta o aviso legal no footer
  const footer = document.getElementById("global-footer");
  if (footer) {
    const p = document.createElement("p");
    p.className =
      "text-[0.6rem] text-center text-zinc-500 dark:text-zinc-400 mb-6 opacity-60 block w-full px-4";
    p.innerText =
      "Atenção: Os horários e estado de circulação podem sofrer alterações sem aviso prévio. Esteja na estação à hora programada.";
    footer.insertBefore(p, footer.firstChild);
  }
}

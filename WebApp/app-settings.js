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

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (currentTheme === "system") applyTheme();
  });

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
    btn.classList.remove("font-bold", "text-black", "dark:text-white");
    if (btn.dataset.mode === currentTheme) {
      btn.classList.add("font-bold", "text-black", "dark:text-white");
    }
  });

  const navLogo = document.getElementById("nav-logo");
  const footerLogo = document.getElementById("footer-logo");
  const netlifyBadgeMenu = document.getElementById("netlify-badge-menu");
  const netlifyBadgeFooter = document.getElementById("netlify-badge-footer");

  const logoLight = "./imagens/logotransparente.svg";
  const logoDark = "./imagens/icon.svg";
  const badgeDark = "./imagens/netlify-dark.svg";
  const badgeLight = "./imagens/netlify-light.svg";

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

  // Compatibilidade retroativa: migrar chaves antigas se existirem
  _migrateOldSettings();

  enableSmartSchedule = _isSmartConfigured();
  enableRegularStations = enableSmartSchedule;
};

window.loadStationPrefs = function (direction) {
  if (!_isSmartConfigured()) return;
  const savedOrg = localStorage.getItem(`smart_${direction}_org`);
  const savedDest = localStorage.getItem(`smart_${direction}_dest`);

  if (savedOrg && FERTAGUS_STATIONS.find((s) => s.key === savedOrg))
    fertagusOrigin = savedOrg;
  if (savedDest && FERTAGUS_STATIONS.find((s) => s.key === savedDest))
    fertagusDest = savedDest;
};

// Compatibilidade: não faz nada no novo sistema (o wizard gere as estações)
window.saveStationPrefs = function () {};

function _migrateOldSettings() {
  // Se existiam configurações do sistema antigo mas não do novo, ignora-as silenciosamente.
  // As chaves antigas ficam no localStorage até serem limpas manualmente.
}

// ─── HORÁRIO INTELIGENTE — ESTADO DO WIZARD ───────────────────────────────────

let _wizActive = false; // wizard está a ser exibido
let _wizEditing = false; // a editar configuração existente
let _wizStep = 1; // 1, 2 ou 3

// Escolhas do utilizador (em memória durante o wizard)
let _wizSame = true; // mesmas estações invertidas?
let _wizLOrg = null; // Lisboa: partida
let _wizLDest = null; // Lisboa: destino
let _wizMOrg = null; // Margem: partida
let _wizMDest = null; // Margem: destino
let _wizLFrom = "07:00"; // Lisboa: a partir de
let _wizLTo = ""; // Lisboa: até (vazio = sem limite)
let _wizMFrom = "16:00"; // Margem: a partir de
let _wizMTo = ""; // Margem: até (vazio = sem limite)

// ─── FUNÇÕES PÚBLICAS ─────────────────────────────────────────────────────────

/**
 * Verifica se o Horário Inteligente está completamente configurado.
 * Exposta globalmente para uso em app-init.js.
 */
window._isSmartConfigured = function () {
  return (
    localStorage.getItem("smart_enabled") === "true" &&
    !!localStorage.getItem("smart_lisboa_org") &&
    !!localStorage.getItem("smart_lisboa_dest") &&
    !!localStorage.getItem("smart_margem_org") &&
    !!localStorage.getItem("smart_margem_dest") &&
    !!localStorage.getItem("smart_lisboa_from") &&
    !!localStorage.getItem("smart_margem_from")
  );
};

/**
 * Deteta qual o sentido ativo com base na hora atual e nas janelas configuradas.
 * Retorna "lisboa", "margem" ou null (fora de qualquer janela).
 * As horas antes das 05:00 são normalizadas para +24h (dia operacional 05:00–02:00).
 */
window._detectSmartTab = function () {
  if (!_isSmartConfigured()) return null;

  const now = new Date();
  let nowMins = now.getHours() * 60 + now.getMinutes();
  // Horas de madrugada (00:00–04:59) pertencem ao dia operacional anterior
  if (nowMins < 5 * 60) nowMins += 24 * 60;

  function parseMins(str) {
    if (!str) return null;
    const [h, m] = str.split(":").map(Number);
    let mins = h * 60 + (m || 0);
    if (mins < 5 * 60) mins += 24 * 60;
    return mins;
  }

  function inWindow(fromStr, toStr) {
    const from = parseMins(fromStr);
    if (from === null) return false;
    if (!toStr) return nowMins >= from; // apenas "a partir de"
    const to = parseMins(toStr);
    if (to === null) return nowMins >= from;
    return nowMins >= from && nowMins < to;
  }

  const lFrom = localStorage.getItem("smart_lisboa_from") || "";
  const lTo = localStorage.getItem("smart_lisboa_to") || "";
  const mFrom = localStorage.getItem("smart_margem_from") || "";
  const mTo = localStorage.getItem("smart_margem_to") || "";

  // Verificar janela autalmente aberta
  const isLisboa = inWindow(lFrom, lTo);
  const isMargem = inWindow(mFrom, mTo);

  // A: so está dentro de uma das janelas
  if (isLisboa && !isMargem) return "lisboa";
  if (isMargem && !isLisboa) return "margem";

  // B: as tuas janelas estão ativas (sobreposição porque faltam horas de fim)
  if (isLisboa && isMargem) {
    // comparar qual começou mais tarde
    if (lFrom > mFrom) {
      return "lisboa";
    } else {
      return "margem";
    }
  }

  // nenhuma
  return null;
};

// ─── HELPERS INTERNOS ─────────────────────────────────────────────────────────

/** Slots de tempo: 05:00 às 02:00 (inclusive), de 30 em 30 minutos. */
function _timeSlots() {
  const slots = [];
  for (let h = 5; h <= 23; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  for (let h = 0; h <= 2; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    if (h < 2) slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
}

/** Gera as <option> de um select de hora. */
function _timeSelectOpts(selected, allowEmpty, emptyLabel) {
  let html = allowEmpty ? `<option value="">${emptyLabel || "—"}</option>` : "";
  _timeSlots().forEach((s) => {
    const sel = s === selected ? " selected" : "";
    html += `<option value="${s}"${sel}>${s}</option>`;
  });
  return html;
}

/** Opções de origem para sentido Lisboa (índice < destino). */
function _lisbOrgOpts(selected) {
  return FERTAGUS_STATIONS.slice(0, -1)
    .map(
      (s) =>
        `<option value="${s.key}"${s.key === selected ? " selected" : ""}>${s.name}</option>`,
    )
    .join("");
}

/** Opções de destino para sentido Lisboa dado a origem. */
function _lisbDestOpts(orgKey, selected) {
  const orgIdx = FERTAGUS_STATIONS.findIndex((s) => s.key === orgKey);
  if (orgIdx < 0) return "";
  return FERTAGUS_STATIONS.slice(orgIdx + 1)
    .map(
      (s) =>
        `<option value="${s.key}"${s.key === selected ? " selected" : ""}>${s.name}</option>`,
    )
    .join("");
}

/** Opções de origem para sentido Margem (índice > destino), exibidas invertidas. */
function _margOrgOpts(selected) {
  return [...FERTAGUS_STATIONS]
    .slice(1)
    .reverse()
    .map(
      (s) =>
        `<option value="${s.key}"${s.key === selected ? " selected" : ""}>${s.name}</option>`,
    )
    .join("");
}

/** Opções de destino para sentido Margem dado a origem, exibidas invertidas. */
function _margDestOpts(orgKey, selected) {
  const orgIdx = FERTAGUS_STATIONS.findIndex((s) => s.key === orgKey);
  if (orgIdx < 0) return "";
  return [...FERTAGUS_STATIONS]
    .slice(0, orgIdx)
    .reverse()
    .map(
      (s) =>
        `<option value="${s.key}"${s.key === selected ? " selected" : ""}>${s.name}</option>`,
    )
    .join("");
}

function _stationName(key) {
  const s = FERTAGUS_STATIONS.find((s) => s.key === key);
  return s ? s.name : key || "—";
}

function _formatTimeLabel(from, to) {
  if (!from) return "Não definido";
  if (!to) return `A partir das ${from}`;
  return `${from} – ${to}`;
}

/** Classe base dos <select> dentro do wizard/definições. */
const _SC =
  "bg-white/50 dark:bg-black/30 border border-black/5 dark:border-white/10 rounded-lg p-2 text-xs w-full text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500/40";

// ─── CONSTRUÇÃO DO HTML ───────────────────────────────────────────────────────

function _buildInfoHTML() {
  return `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold tracking-widest text-zinc-500 uppercase">Horário Inteligente</span>
        <span class="text-[9px] bg-blue-500/10 text-blue-500 border border-blue-500/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Novo</span>
      </div>

      <div class="bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 border border-black/5 dark:border-white/5 space-y-3">
        <div class="flex gap-3 items-start">
          <div class="shrink-0 w-9 h-9 rounded-xl bg-blue-500/10 dark:bg-blue-500/15 flex items-center justify-center">
            <i data-lucide="zap" class="w-4 h-4 text-blue-500"></i>
          </div>
          <div class="min-w-0">
            <p class="text-xs font-semibold text-zinc-900 dark:text-zinc-100 mb-1 leading-snug">A app abre no sentido certo, à hora certa.</p>
            <p class="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">Configura as tuas estações e horários habituais e a app muda automaticamente de sentido sem teres de tocar em nada.</p>
          </div>
        </div>

        <div class="flex flex-col gap-1.5 pt-1 border-t border-black/5 dark:border-white/10">
          <div class="flex items-center gap-2 text-[10px] text-zinc-400">
            <i data-lucide="arrow-right-left" class="w-3 h-3 shrink-0 text-zinc-400"></i>
            <span>Manhã sentido Lisboa, tarde sentido Margem, ou o contrário.</span>
          </div>
          <div class="flex items-center gap-2 text-[10px] text-zinc-400">
            <i data-lucide="lock" class="w-3 h-3 shrink-0 text-zinc-400"></i>
            <span>Os dados ficam apenas no teu dispositivo. Nunca os partilhamos.</span>
          </div>
        </div>
      </div>

      <button id="smart-start-btn"
        class="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white text-sm font-bold transition-all shadow-sm shadow-blue-500/20 flex items-center justify-center gap-2">
        <i data-lucide="settings-2" class="w-4 h-4"></i>
        Configurar Horário Inteligente
      </button>
    </div>`;
}

function _buildWizardHTML() {
  const stepTitles = ["O teu percurso", "As tuas estações", "Os teus horários"];
  const title = stepTitles[_wizStep - 1];
  const pct = Math.round((_wizStep / 3) * 100);

  let stepContent = "";
  if (_wizStep === 1) stepContent = _buildStep1HTML();
  else if (_wizStep === 2) stepContent = _buildStep2HTML();
  else stepContent = _buildStep3HTML();

  const backLabel = _wizStep === 1 ? "Cancelar" : "Voltar";
  const nextBtn =
    _wizStep < 3
      ? `<button id="smart-next-btn" class="flex-1 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white text-sm font-bold transition-all shadow-sm shadow-blue-500/15">Continuar</button>`
      : `<button id="smart-confirm-btn" class="flex-1 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white text-sm font-bold transition-all shadow-sm shadow-blue-500/15 flex items-center justify-center gap-1.5"><i data-lucide="check" class="w-3.5 h-3.5"></i>Confirmar e Aplicar</button>`;

  return `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold tracking-widest text-zinc-500 uppercase">Horário Inteligente</span>
        <span class="text-[9px] text-zinc-400 font-mono">Passo ${_wizStep} de 3</span>
      </div>

      <div class="h-1 bg-zinc-200 dark:bg-zinc-700/60 rounded-full overflow-hidden">
        <div class="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out" style="width:${pct}%"></div>
      </div>

      <p class="text-sm font-bold text-zinc-900 dark:text-zinc-100">${title}</p>

      ${stepContent}

      <div class="flex gap-2 pt-1">
        <button id="smart-back-btn"
          class="flex-none py-2.5 px-4 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-400 text-sm font-medium active:scale-[0.98] transition-all">
          ${backLabel}
        </button>
        ${nextBtn}
      </div>
    </div>`;
}

function _buildStep1HTML() {
  const yesActive = _wizSame;
  const noActive = !_wizSame;

  return `
    <div class="space-y-3">
      <p class="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
        As estações de partida e destino são as mesmas nos dois sentidos (apenas invertidas)?
        <br><span class="text-zinc-400 dark:text-zinc-500">Ex: Corroios → Roma-Areeiro / Roma-Areeiro → Corroios</span>
      </p>

      <button id="wiz-same-yes"
        class="w-full p-3.5 rounded-xl border-2 text-left transition-all active:scale-[0.98] ${yesActive ? "border-blue-500 bg-blue-500/8 dark:bg-blue-500/10" : "border-zinc-200 dark:border-white/10 hover:border-zinc-300 dark:hover:border-white/20"}">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg ${yesActive ? "bg-blue-500" : "bg-zinc-200 dark:bg-zinc-700"} flex items-center justify-center shrink-0 transition-colors">
            <i data-lucide="repeat-2" class="w-4 h-4 ${yesActive ? "text-white" : "text-zinc-400"}"></i>
          </div>
          <div>
            <p class="text-sm font-bold text-zinc-900 dark:text-zinc-100">Sim, as mesmas (invertidas)</p>
            <p class="text-[10px] text-zinc-500 mt-0.5">Uso as mesmas estações em ambas as direções.</p>
          </div>
          ${yesActive ? '<i data-lucide="check-circle-2" class="w-4 h-4 text-blue-500 ml-auto shrink-0"></i>' : ""}
        </div>
      </button>

      <button id="wiz-same-no"
        class="w-full p-3.5 rounded-xl border-2 text-left transition-all active:scale-[0.98] ${noActive ? "border-blue-500 bg-blue-500/8 dark:bg-blue-500/10" : "border-zinc-200 dark:border-white/10 hover:border-zinc-300 dark:hover:border-white/20"}">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg ${noActive ? "bg-blue-500" : "bg-zinc-200 dark:bg-zinc-700"} flex items-center justify-center shrink-0 transition-colors">
            <i data-lucide="shuffle" class="w-4 h-4 ${noActive ? "text-white" : "text-zinc-400"}"></i>
          </div>
          <div>
            <p class="text-sm font-bold text-zinc-900 dark:text-zinc-100">Não, são diferentes</p>
            <p class="text-[10px] text-zinc-500 mt-0.5">Uso estações distintas consoante o sentido.</p>
          </div>
          ${noActive ? '<i data-lucide="check-circle-2" class="w-4 h-4 text-blue-500 ml-auto shrink-0"></i>' : ""}
        </div>
      </button>
    </div>`;
}

function _buildStep2HTML() {
  // Garante valores válidos antes de renderizar
  if (!_wizLOrg) _wizLOrg = "corroios";
  const orgIdx = FERTAGUS_STATIONS.findIndex((s) => s.key === _wizLOrg);
  const destIdx = FERTAGUS_STATIONS.findIndex((s) => s.key === _wizLDest);
  if (destIdx <= orgIdx || !_wizLDest) {
    _wizLDest = FERTAGUS_STATIONS[orgIdx + 1]?.key || "roma_areeiro";
  }

  if (_wizSame) {
    // Margem = inverso automático
    _wizMOrg = _wizLDest;
    _wizMDest = _wizLOrg;
  } else {
    if (!_wizMOrg) _wizMOrg = "roma_areeiro";
    const mOrgIdx = FERTAGUS_STATIONS.findIndex((s) => s.key === _wizMOrg);
    const mDestIdx = FERTAGUS_STATIONS.findIndex((s) => s.key === _wizMDest);
    if (mDestIdx >= mOrgIdx || !_wizMDest) {
      _wizMDest = FERTAGUS_STATIONS[mOrgIdx - 1]?.key || "corroios";
    }
  }

  const lisbSection = `
    <div class="bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 space-y-3 border border-black/5 dark:border-white/5">
      <p class="text-[9px] uppercase font-bold tracking-wider text-zinc-500 flex items-center gap-2">
        <span class="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block"></span>
        Sentido Lisboa
      </p>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="text-[9px] text-zinc-400 uppercase tracking-wider mb-1 block">Partida</label>
          <select id="wiz-lisb-org" class="${_SC}">
            ${_lisbOrgOpts(_wizLOrg)}
          </select>
        </div>
        <div>
          <label class="text-[9px] text-zinc-400 uppercase tracking-wider mb-1 block">Destino</label>
          <select id="wiz-lisb-dest" class="${_SC}">
            ${_lisbDestOpts(_wizLOrg, _wizLDest)}
          </select>
        </div>
      </div>
    </div>`;

  let margSection;
  if (_wizSame) {
    // Prévia apenas — não editável
    margSection = `
      <div class="bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 space-y-3 border border-black/5 dark:border-white/5 opacity-60">
        <div class="flex items-center justify-between">
          <p class="text-[9px] uppercase font-bold tracking-wider text-zinc-500 flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-zinc-400 inline-block"></span>
            Sentido Margem
          </p>
          <span class="text-[9px] text-zinc-400">automático</span>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-[9px] text-zinc-400 uppercase tracking-wider mb-1 block">Partida</label>
            <div class="bg-white/50 dark:bg-black/20 border border-black/5 dark:border-white/10 rounded-lg p-2 text-xs text-zinc-700 dark:text-zinc-300 truncate">
              ${_stationName(_wizMOrg)}
            </div>
          </div>
          <div>
            <label class="text-[9px] text-zinc-400 uppercase tracking-wider mb-1 block">Destino</label>
            <div class="bg-white/50 dark:bg-black/20 border border-black/5 dark:border-white/10 rounded-lg p-2 text-xs text-zinc-700 dark:text-zinc-300 truncate">
              ${_stationName(_wizMDest)}
            </div>
          </div>
        </div>
      </div>`;
  } else {
    margSection = `
      <div class="bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 space-y-3 border border-black/5 dark:border-white/5">
        <p class="text-[9px] uppercase font-bold tracking-wider text-zinc-500 flex items-center gap-2">
          <span class="w-1.5 h-1.5 rounded-full bg-zinc-400 inline-block"></span>
          Sentido Margem
        </p>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-[9px] text-zinc-400 uppercase tracking-wider mb-1 block">Partida</label>
            <select id="wiz-marg-org" class="${_SC}">
              ${_margOrgOpts(_wizMOrg)}
            </select>
          </div>
          <div>
            <label class="text-[9px] text-zinc-400 uppercase tracking-wider mb-1 block">Destino</label>
            <select id="wiz-marg-dest" class="${_SC}">
              ${_margDestOpts(_wizMOrg, _wizMDest)}
            </select>
          </div>
        </div>
      </div>`;
  }

  const hint = _wizSame
    ? `<p class="text-[10px] text-zinc-400 flex items-start gap-1.5"><i data-lucide="info" class="w-3 h-3 shrink-0 mt-0.5"></i>O sentido Margem é configurado automaticamente como o inverso do sentido Lisboa.</p>`
    : `<p class="text-[10px] text-zinc-400 flex items-start gap-1.5"><i data-lucide="info" class="w-3 h-3 shrink-0 mt-0.5"></i>Só são apresentadas viagens válidas para cada sentido.</p>`;

  return `
    <div class="space-y-3">
      ${hint}
      ${lisbSection}
      ${margSection}
    </div>`;
}

function _buildStep3HTML() {
  const lOrg = _stationName(_wizLOrg);
  const lDest = _stationName(_wizLDest);
  const mOrg = _stationName(_wizMOrg);
  const mDest = _stationName(_wizMDest);

  return `
    <div class="space-y-3">
      <p class="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
        Define quando a app deve mostrar cada sentido.
        O campo <strong class="text-zinc-600 dark:text-zinc-300">Até às</strong> é opcional — podes deixar apenas "a partir de".
      </p>

      <!-- Lisboa -->
      <div class="bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 space-y-3 border border-black/5 dark:border-white/5">
        <div class="flex items-center justify-between">
          <p class="text-[9px] uppercase font-bold tracking-wider text-zinc-500 flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block"></span>
            Sentido Lisboa
          </p>
          <span class="text-[9px] text-zinc-400 font-medium truncate max-w-[110px]">${lOrg} → ${lDest}</span>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-[9px] text-zinc-400 uppercase tracking-wider mb-1 block">A partir das</label>
            <select id="wiz-lisb-from" class="${_SC}">
              ${_timeSelectOpts(_wizLFrom, false)}
            </select>
          </div>
          <div>
            <label class="text-[9px] text-zinc-400 uppercase tracking-wider mb-1 block">Até às (opcional)</label>
            <select id="wiz-lisb-to" class="${_SC}">
              ${_timeSelectOpts(_wizLTo, true, "Sem limite")}
            </select>
          </div>
        </div>
      </div>

      <!-- Margem -->
      <div class="bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 space-y-3 border border-black/5 dark:border-white/5">
        <div class="flex items-center justify-between">
          <p class="text-[9px] uppercase font-bold tracking-wider text-zinc-500 flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-zinc-400 inline-block"></span>
            Sentido Margem
          </p>
          <span class="text-[9px] text-zinc-400 font-medium truncate max-w-[110px]">${mOrg} → ${mDest}</span>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-[9px] text-zinc-400 uppercase tracking-wider mb-1 block">A partir das</label>
            <select id="wiz-marg-from" class="${_SC}">
              ${_timeSelectOpts(_wizMFrom, false)}
            </select>
          </div>
          <div>
            <label class="text-[9px] text-zinc-400 uppercase tracking-wider mb-1 block">Até às (opcional)</label>
            <select id="wiz-marg-to" class="${_SC}">
              ${_timeSelectOpts(_wizMTo, true, "Sem limite")}
            </select>
          </div>
        </div>
      </div>
    </div>`;
}

function _buildSummaryHTML() {
  const lOrg = localStorage.getItem("smart_lisboa_org") || "";
  const lDest = localStorage.getItem("smart_lisboa_dest") || "";
  const mOrg = localStorage.getItem("smart_margem_org") || "";
  const mDest = localStorage.getItem("smart_margem_dest") || "";
  const lFrom = localStorage.getItem("smart_lisboa_from") || "";
  const lTo = localStorage.getItem("smart_lisboa_to") || "";
  const mFrom = localStorage.getItem("smart_margem_from") || "";
  const mTo = localStorage.getItem("smart_margem_to") || "";

  const activeDir = _detectSmartTab(); // null | "lisboa" | "margem"

  const lActive = activeDir === "lisboa";
  const mActive = activeDir === "margem";

  const lCard = `
    <div class="bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 border ${lActive ? "border-blue-500/40 ring-1 ring-blue-500/20" : "border-black/5 dark:border-white/5"} transition-all">
      <div class="flex items-center justify-between mb-2">
        <p class="text-[9px] uppercase font-bold tracking-wider text-zinc-500 flex items-center gap-2">
          <span class="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block"></span>
          Sentido Lisboa
        </p>
        ${lActive ? '<span class="text-[9px] bg-blue-500/10 text-blue-500 border border-blue-500/25 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1"><span class="w-1 h-1 rounded-full bg-blue-500 inline-block animate-pulse"></span>Agora</span>' : ""}
      </div>
      <p class="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">${_stationName(lOrg)} → ${_stationName(lDest)}</p>
      <p class="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1">
        <i data-lucide="clock" class="w-3 h-3"></i>
        ${_formatTimeLabel(lFrom, lTo)}
      </p>
    </div>`;

  const mCard = `
    <div class="bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 border ${mActive ? "border-zinc-400/40 ring-1 ring-zinc-400/20" : "border-black/5 dark:border-white/5"} transition-all">
      <div class="flex items-center justify-between mb-2">
        <p class="text-[9px] uppercase font-bold tracking-wider text-zinc-500 flex items-center gap-2">
          <span class="w-1.5 h-1.5 rounded-full bg-zinc-400 inline-block"></span>
          Sentido Margem
        </p>
        ${mActive ? '<span class="text-[9px] bg-zinc-200 dark:bg-white/5 text-zinc-600 dark:text-zinc-400 border border-black/10 dark:border-white/15 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1"><span class="w-1 h-1 rounded-full bg-zinc-500 inline-block animate-pulse"></span>Agora</span>' : ""}
      </div>
      <p class="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">${_stationName(mOrg)} → ${_stationName(mDest)}</p>
      <p class="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1">
        <i data-lucide="clock" class="w-3 h-3"></i>
        ${_formatTimeLabel(mFrom, mTo)}
      </p>
    </div>`;

  return `
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold tracking-widest text-zinc-500 uppercase">Horário Inteligente</span>
        <div class="flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full bg-green-500 inline-block animate-pulse"></span>
          <span class="text-[9px] text-green-500 font-bold uppercase tracking-wider">Ativo</span>
        </div>
      </div>

      ${lCard}
      ${mCard}

      <div class="flex gap-2 pt-1">
        <button id="smart-edit-btn"
          class="flex-1 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-400 text-sm font-medium active:scale-[0.98] transition-all flex items-center justify-center gap-1.5">
          <i data-lucide="pencil" class="w-3.5 h-3.5"></i>Editar
        </button>
        <button id="smart-disable-btn"
          class="py-2.5 px-4 rounded-xl border border-red-500/20 text-red-500 dark:text-red-400 text-sm font-medium active:scale-[0.98] transition-all flex items-center gap-1.5">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>Desativar
        </button>
      </div>
    </div>`;
}

// ─── RENDER PRINCIPAL ─────────────────────────────────────────────────────────

function renderSmartSection(container) {
  if (!container) return;

  if (_wizActive) {
    container.innerHTML = _buildWizardHTML();
  } else if (_isSmartConfigured()) {
    container.innerHTML = _buildSummaryHTML();
  } else {
    container.innerHTML = _buildInfoHTML();
  }

  _attachSmartListeners(container);
  if (window.lucide) lucide.createIcons();
}

// ─── EVENT LISTENERS DO WIZARD ────────────────────────────────────────────────

function _attachSmartListeners(container) {
  const q = (id) => container.querySelector(`#${id}`);
  const on = (id, evt, fn) => {
    const el = q(id);
    if (el) el.addEventListener(evt, fn);
  };

  // ── Estado: Info ──────────────────────────────────────────────────────────

  on("smart-start-btn", "click", () => {
    // Inicializa o wizard com os valores atuais ou defaults
    const curDir = calculateDirection(fertagusOrigin, fertagusDest);
    if (curDir === "lisboa") {
      _wizLOrg = fertagusOrigin;
      _wizLDest = fertagusDest;
      _wizMOrg = fertagusDest;
      _wizMDest = fertagusOrigin;
    } else {
      _wizLOrg = fertagusDest;
      _wizLDest = fertagusOrigin;
      _wizMOrg = fertagusOrigin;
      _wizMDest = fertagusDest;
    }
    // Garante que os valores para Lisboa são válidos
    const lo = FERTAGUS_STATIONS.findIndex((s) => s.key === _wizLOrg);
    const ld = FERTAGUS_STATIONS.findIndex((s) => s.key === _wizLDest);
    if (lo < 0 || ld <= lo) {
      _wizLOrg = "corroios";
      _wizLDest = "roma_areeiro";
      _wizMOrg = "roma_areeiro";
      _wizMDest = "corroios";
    }
    _wizSame = true;
    _wizLFrom = "07:00";
    _wizLTo = "";
    _wizMFrom = "16:00";
    _wizMTo = "";
    _wizStep = 1;
    _wizActive = true;
    _wizEditing = false;
    renderSmartSection(container);
  });

  // ── Estado: Resumo ────────────────────────────────────────────────────────

  on("smart-edit-btn", "click", () => {
    _wizLOrg = localStorage.getItem("smart_lisboa_org") || "corroios";
    _wizLDest = localStorage.getItem("smart_lisboa_dest") || "roma_areeiro";
    _wizMOrg = localStorage.getItem("smart_margem_org") || "roma_areeiro";
    _wizMDest = localStorage.getItem("smart_margem_dest") || "corroios";
    _wizSame = localStorage.getItem("smart_same_stations") !== "false";
    _wizLFrom = localStorage.getItem("smart_lisboa_from") || "07:00";
    _wizLTo = localStorage.getItem("smart_lisboa_to") || "";
    _wizMFrom = localStorage.getItem("smart_margem_from") || "16:00";
    _wizMTo = localStorage.getItem("smart_margem_to") || "";
    _wizStep = 1;
    _wizActive = true;
    _wizEditing = true;
    renderSmartSection(container);
  });

  on("smart-disable-btn", "click", () => {
    [
      "smart_enabled",
      "smart_same_stations",
      "smart_lisboa_org",
      "smart_lisboa_dest",
      "smart_margem_org",
      "smart_margem_dest",
      "smart_lisboa_from",
      "smart_lisboa_to",
      "smart_margem_from",
      "smart_margem_to",
    ].forEach((k) => localStorage.removeItem(k));
    enableSmartSchedule = false;
    enableRegularStations = false;
    _wizActive = false;
    _wizEditing = false;
    _wizStep = 1;
    renderSmartSection(container);
  });

  // ── Wizard Passo 1 ────────────────────────────────────────────────────────

  on("wiz-same-yes", "click", () => {
    _wizSame = true;
    renderSmartSection(container);
  });

  on("wiz-same-no", "click", () => {
    _wizSame = false;
    renderSmartSection(container);
  });

  // ── Wizard Passo 2 — selects Lisboa ───────────────────────────────────────

  on("wiz-lisb-org", "change", () => {
    const sel = q("wiz-lisb-org");
    if (!sel) return;
    _wizLOrg = sel.value;
    // Valida destino: tem de ser depois da origem
    const orgIdx = FERTAGUS_STATIONS.findIndex((s) => s.key === _wizLOrg);
    const destIdx = FERTAGUS_STATIONS.findIndex((s) => s.key === _wizLDest);
    if (destIdx <= orgIdx) {
      _wizLDest = FERTAGUS_STATIONS[orgIdx + 1]?.key || null;
    }
    if (_wizSame) {
      _wizMOrg = _wizLDest;
      _wizMDest = _wizLOrg;
    }
    renderSmartSection(container);
  });

  on("wiz-lisb-dest", "change", () => {
    const sel = q("wiz-lisb-dest");
    if (!sel) return;
    _wizLDest = sel.value;
    if (_wizSame) {
      _wizMOrg = _wizLDest;
      _wizMDest = _wizLOrg;
    }
    renderSmartSection(container);
  });

  // ── Wizard Passo 2 — selects Margem ───────────────────────────────────────

  on("wiz-marg-org", "change", () => {
    const sel = q("wiz-marg-org");
    if (!sel) return;
    _wizMOrg = sel.value;
    // Valida destino: tem de ser antes da origem (sentido Margem)
    const orgIdx = FERTAGUS_STATIONS.findIndex((s) => s.key === _wizMOrg);
    const destIdx = FERTAGUS_STATIONS.findIndex((s) => s.key === _wizMDest);
    if (destIdx >= orgIdx) {
      _wizMDest = FERTAGUS_STATIONS[orgIdx - 1]?.key || null;
    }
    renderSmartSection(container);
  });

  on("wiz-marg-dest", "change", () => {
    const sel = q("wiz-marg-dest");
    if (!sel) return;
    _wizMDest = sel.value;
  });

  // ── Wizard Passo 3 — leitura imediata (sem re-render) ─────────────────────

  on("wiz-lisb-from", "change", () => {
    const sel = q("wiz-lisb-from");
    if (sel) _wizLFrom = sel.value;
  });
  on("wiz-lisb-to", "change", () => {
    const sel = q("wiz-lisb-to");
    if (sel) _wizLTo = sel.value;
  });
  on("wiz-marg-from", "change", () => {
    const sel = q("wiz-marg-from");
    if (sel) _wizMFrom = sel.value;
  });
  on("wiz-marg-to", "change", () => {
    const sel = q("wiz-marg-to");
    if (sel) _wizMTo = sel.value;
  });

  // ── Navegação ─────────────────────────────────────────────────────────────

  on("smart-back-btn", "click", () => {
    if (_wizStep === 1) {
      _wizActive = false;
      _wizEditing = false;
    } else {
      // Guarda valores do passo atual antes de recuar
      _readCurrentStepValues(container);
      _wizStep--;
    }
    renderSmartSection(container);
  });

  on("smart-next-btn", "click", () => {
    _readCurrentStepValues(container);
    _wizStep++;
    renderSmartSection(container);
  });

  on("smart-confirm-btn", "click", () => {
    _readCurrentStepValues(container);
    _saveAndApplySmart(container);
    sa_event("ativou_smart_tab");
  });
}

/** Lê os valores dos selects do passo atual para o estado do wizard. */
function _readCurrentStepValues(container) {
  const q = (id) => container.querySelector(`#${id}`);

  if (_wizStep === 2) {
    const lo = q("wiz-lisb-org");
    const ld = q("wiz-lisb-dest");
    if (lo) _wizLOrg = lo.value;
    if (ld) _wizLDest = ld.value;
    if (!_wizSame) {
      const mo = q("wiz-marg-org");
      const md = q("wiz-marg-dest");
      if (mo) _wizMOrg = mo.value;
      if (md) _wizMDest = md.value;
    } else {
      _wizMOrg = _wizLDest;
      _wizMDest = _wizLOrg;
    }
  } else if (_wizStep === 3) {
    const lf = q("wiz-lisb-from");
    const lt = q("wiz-lisb-to");
    const mf = q("wiz-marg-from");
    const mt = q("wiz-marg-to");
    if (lf) _wizLFrom = lf.value;
    if (lt) _wizLTo = lt.value;
    if (mf) _wizMFrom = mf.value;
    if (mt) _wizMTo = mt.value;
  }
}

function _saveAndApplySmart(container) {
  // Persiste no localStorage
  localStorage.setItem("smart_enabled", "true");
  localStorage.setItem("smart_same_stations", _wizSame ? "true" : "false");
  localStorage.setItem("smart_lisboa_org", _wizLOrg || "");
  localStorage.setItem("smart_lisboa_dest", _wizLDest || "");
  localStorage.setItem("smart_margem_org", _wizMOrg || "");
  localStorage.setItem("smart_margem_dest", _wizMDest || "");
  localStorage.setItem("smart_lisboa_from", _wizLFrom || "");
  localStorage.setItem("smart_lisboa_to", _wizLTo || "");
  localStorage.setItem("smart_margem_from", _wizMFrom || "");
  localStorage.setItem("smart_margem_to", _wizMTo || "");

  enableSmartSchedule = true;
  enableRegularStations = true;
  _wizActive = false;
  _wizEditing = false;

  // Aplica imediatamente se dentro de uma janela configurada
  const detected = _detectSmartTab();
  if (detected) {
    activeTab = detected;
    localStorage.setItem("ft_tab", activeTab);
    loadStationPrefs(activeTab);

    if (typeof populateOriginSelect === "function") populateOriginSelect();
    if (typeof populateDestSelect === "function")
      populateDestSelect(fertagusOrigin);

    const orgSel = document.getElementById("sel-origin");
    const dstSel = document.getElementById("sel-dest");
    if (orgSel) orgSel.value = fertagusOrigin;
    if (dstSel) dstSel.value = fertagusDest;

    if (typeof updateAppState === "function") updateAppState();
  }

  renderSmartSection(container);
}

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
  // é ios?
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  // ios apenas popup de como instalar
  if (isIOS) {
    sa_event("pwa_install_ios_clicked");
    showIOSInstallModal();
    AlertsManager.dismiss(null, "pwa-install");
    return;
  }

  // normal para Android / Chrome
  if (deferredPrompt) {
    sa_event("pwa_install_clicked");
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;

    if (outcome === "accepted") {
      sa_event("pwa_install_accepted");
    }

    AlertsManager.dismiss(null, "pwa-install");
  } else {
    alert(
      "Para instalar, usa as opções do teu navegador ('Adicionar ao Ecrã Principal').",
    );
    AlertsManager.dismiss(null, "pwa-install");
  }
};

// ─── modal de como instalar em ios ──────────────────────────────────────────────
function showIOSInstallModal() {
  let modal = document.getElementById("ios-install-modal");
  const backdrop = document.getElementById("modal-backdrop");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "ios-install-modal";
    modal.className =
      "fixed inset-x-0 bottom-0 h-auto max-h-[85vh] bg-white/95 dark:bg-[#09090b]/95 backdrop-blur-xl border-t border-black/5 dark:border-white/10 rounded-t-[2rem] z-50 transform translate-y-full transition-transform duration-300 flex flex-col shadow-2xl p-6 pb-10";

    modal.innerHTML = `
      <div class="relative w-full">
        <button id="close-ios-modal" class="absolute -top-2 right-0 p-2 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full text-zinc-500 dark:text-zinc-400 transition-all">
          <i data-lucide="x" class="w-5 h-5"></i>
        </button>
        
        <div class="flex flex-col items-center mt-2">
          <div class="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center mb-4 border border-blue-500/20 shadow-inner">
            <i data-lucide="download" class="w-8 h-8 text-blue-500"></i>
          </div>
          
          <h2 class="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 mb-2">Instalar no iPhone</h2>
          
          <div class="w-full bg-amber-500/10 dark:bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-5 flex items-start gap-3">
            <i data-lucide="alert-triangle" class="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-500 mt-0.5"></i>
            <p class="text-xs text-amber-800 dark:text-amber-400 leading-relaxed font-medium">
              Aviso: Tens de abrir este site no <b>Safari</b>. A instalação não funciona no Chrome, Instagram ou outras apps.
            </p>
          </div>

          <div class="w-full space-y-4">
            <div class="flex items-center gap-4 bg-zinc-100 dark:bg-zinc-800/50 p-3.5 rounded-xl border border-black/5 dark:border-white/5">
              <div class="w-8 h-8 shrink-0 bg-white dark:bg-zinc-700 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-600 flex items-center justify-center">
                <i data-lucide="share" class="w-4 h-4 text-blue-500"></i>
              </div>
              <p class="text-sm font-medium text-zinc-700 dark:text-zinc-300 leading-tight">
                1. Toca no botão <b>Partilhar</b> na barra inferior do Safari, ou superior dependendo da tua versão.
              </p>
            </div>
            
            <div class="flex items-center gap-4 bg-zinc-100 dark:bg-zinc-800/50 p-3.5 rounded-xl border border-black/5 dark:border-white/5">
              <div class="w-8 h-8 shrink-0 bg-white dark:bg-zinc-700 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-600 flex items-center justify-center">
                <i data-lucide="square-plus" class="w-4 h-4 text-zinc-900 dark:text-white"></i>
              </div>
              <p class="text-sm font-medium text-zinc-700 dark:text-zinc-300 leading-tight">
                2. Desliza para baixo e escolhe <b>"Adicionar ao Ecrã Principal"</b>. Esta pode estar escondida em "Mais Opções"!
              </p>
            </div>
          </div>
          
          <button id="understood-ios-modal" class="w-full mt-6 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-bold tracking-widest uppercase transition-all shadow-md shadow-blue-500/20">
            Percebido
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeModal = () => {
      modal.classList.add("translate-y-full");
      backdrop.classList.add("opacity-0");
      setTimeout(() => backdrop.classList.add("hidden"), 300);
    };

    document
      .getElementById("close-ios-modal")
      .addEventListener("click", closeModal);
    document
      .getElementById("understood-ios-modal")
      .addEventListener("click", closeModal);
  }

  if (window.lucide) lucide.createIcons();

  if (backdrop) {
    backdrop.classList.remove("hidden");
    setTimeout(() => backdrop.classList.remove("opacity-0"), 10);
  }
  setTimeout(() => modal.classList.remove("translate-y-full"), 10);
}

// ─── INJEÇÃO NO MENU ──────────────────────────────────────────────────────────

if (menuOverlay) {
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isPWA = window.matchMedia("(display-mode: standalone)").matches;
  if (isIOS && isPWA) {
    const existingPT =
      parseFloat(window.getComputedStyle(menuOverlay).paddingTop) || 0;
    if (existingPT < 20) {
      menuOverlay.style.paddingTop = "pt-24 mt-12";
    }
  }
}
const settingsTemplate = document.getElementById("menu-settings-template");

function injectCustomMenuElements() {
  // injeta as Definições (Horário Inteligente) no menu principal
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

  // botões do header (intermodais e refresh)
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
    const btn = document.createElement("button");
    btn.addEventListener("click", manualRefresh);
    btn.className =
      "p-2 rounded-full transition-colors text-zinc-900 dark:text-white group";
    btn.setAttribute("aria-label", "Atualizar");
    btn.innerHTML = `<i data-lucide="refresh-cw" id="refresh-icon-menu" class="w-5 h-5 transition-transform group-active:scale-90"></i>`;
    wrapper.appendChild(btn);
    wrapper.appendChild(trigger);
    const popover = document.createElement("div");
    popover.id = "mobility-popover";
    popover.className =
      "absolute top-16 right-4 w-64 bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl hidden origin-top-right transition-all duration-300 transform scale-95 opacity-0 z-50 overflow-hidden";

    popover.innerHTML = `
      <div class="px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
        <p class="text-[9px] font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
          Mobilidade & Smart
        </p>
      </div>
      
      <div class="flex flex-col">
        
        <button data-action="open-smart-menu" class="w-full flex items-center gap-4 px-4 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-left group/btn relative">
          <i data-lucide="zap" class="w-4 h-4 text-zinc-900 dark:text-white group-hover/btn:scale-110 transition-transform duration-300"></i>
          
          <div class="flex-1">
            <p class="text-sm font-medium text-zinc-900 dark:text-white leading-none">Horário Inteligente</p>
            <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 font-light tracking-wide">A tua viagem diária</p>
          </div>
          
          <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 group-hover/btn:translate-x-1 transition-transform"></i>
        </button>
        
        <div class="h-px w-full bg-zinc-100 dark:bg-zinc-800"></div>
        
        <a href="./paragens" data-action="topbtnapp_paragem" class="w-full flex items-center gap-4 px-4 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-left group/btn relative">
          <i data-lucide="bus" class="w-4 h-4 text-zinc-900 dark:text-white group-hover/btn:scale-110 transition-transform duration-300"></i>
          
          <div class="flex-1">
            <p class="text-sm font-medium text-zinc-900 dark:text-white leading-none">A Minha Paragem (BETA)</p>
            <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 font-light tracking-wide">Apanhas autocarro para a estação?</p>
          </div>
          
          <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 group-hover/btn:translate-x-1 transition-transform"></i>
        </a>

        <div class="h-px w-full bg-zinc-100 dark:bg-zinc-800"></div>
        
        <a href="./sudoku" data-action="topbtnapp_sudoku" class="w-full flex items-center gap-4 px-4 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-left group/btn relative">
          <i data-lucide="gamepad-2" class="w-4 h-4 text-zinc-900 dark:text-white group-hover/btn:scale-110 transition-transform duration-300"></i>
          
          <div class="flex-1">
            <p class="text-sm font-medium text-zinc-900 dark:text-white leading-none">Jogo de Sudoku</p>
            <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 font-light tracking-wide">Tempo extra? Joga Sudoku</p>
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

  // aviso no footer
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

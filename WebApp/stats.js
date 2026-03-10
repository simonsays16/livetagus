/**
 * stats.js
 * Página de Estatísticas LiveTagus — Precisão das Previsões
 *
 * Fetches /stats from the API and renders accuracy metrics.
 * No framework dependencies — pure vanilla JS.
 */

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const API_STATS = "https://api.livetagus.pt/stats";
const REFRESH_INTERVAL_MS = 60 * 1000; // 60 segundos

/**
 * Ordem das estações para display em cada sentido.
 * As terminais de partida (excluídas das métricas) são omitidas intencionalmente.
 */
const STATION_ORDER_LISBOA = [
  "palmela",
  "venda_do_alcaide",
  "pinhal_novo",
  "penalva",
  "fogueteiro",
  "foros_de_amora",
  "corroios",
  "pragal",
  "campolide",
  "sete_rios",
  "entrecampos",
  "roma_areeiro",
];

const STATION_ORDER_MARGEM = [
  "entrecampos",
  "sete_rios",
  "campolide",
  "pragal",
  "corroios",
  "foros_de_amora",
  "fogueteiro",
  "coina",
  "penalva",
  "pinhal_novo",
  "venda_do_alcaide",
  "palmela",
  "setubal",
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * Devolve as classes CSS de cor conforme a precisão percentual.
 * ≥ 90% → verde | 75–89% → amarelo | < 75% → vermelho
 */
function accColor(pct) {
  if (pct === null || pct === undefined) return { text: "text-zinc-400", bar: "bar-green", ring: "ring-green" };
  if (pct >= 90) return { text: "acc-green",  bar: "bar-green",  ring: "ring-green"  };
  if (pct >= 75) return { text: "acc-yellow", bar: "bar-yellow", ring: "ring-yellow" };
  return            { text: "acc-red",    bar: "bar-red",    ring: "ring-red"    };
}

/**
 * Formata a percentagem ou "—" se não houver dados.
 */
function fmt(pct) {
  return pct !== null && pct !== undefined ? pct + "%" : "—";
}

/**
 * Formata um delta em segundos para display amigável.
 * Ex: +12 s | −4 s | — 
 */
function fmtDelta(sec) {
  if (sec === null || sec === undefined) return "—";
  const abs = Math.abs(sec);
  const sign = sec >= 0 ? "+" : "−";
  if (abs < 60) return `${sign}${abs} s`;
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return s === 0 ? `${sign}${m} min` : `${sign}${m} min ${s} s`;
}

/**
 * Formata timestamp epoch em hora legível (HH:MM:SS).
 */
function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ─── RENDER FUNCTIONS ─────────────────────────────────────────────────────────

/**
 * Renderiza o cartão "Precisão Global".
 */
function renderOverall(overall) {
  const skel = document.getElementById("overall-skeleton");
  const content = document.getElementById("overall-content");
  if (!skel || !content) return;

  const pct = overall.accuracy;
  const color = accColor(pct);

  const pctEl = document.getElementById("overall-pct");
  const barEl = document.getElementById("overall-bar");
  const delayEl = document.getElementById("overall-delay");
  const countEl = document.getElementById("overall-count");

  if (pctEl) {
    pctEl.textContent = fmt(pct);
    pctEl.className = `font-mono text-5xl font-bold leading-none ${color.text}`;
  }
  if (barEl) {
    barEl.className = `h-full bar-fill rounded-full ${color.bar}`;
    // Trigger animation: set width after small delay
    setTimeout(() => { barEl.style.width = (pct ?? 0) + "%"; }, 50);
  }
  if (delayEl) {
    delayEl.textContent =
      overall.avgDelaySec !== null
        ? `atraso médio: ${fmtDelta(overall.avgDelaySec)}`
        : "sem dados de atraso";
  }
  if (countEl) {
    countEl.textContent =
      overall.count > 0
        ? `${overall.count.toLocaleString("pt-PT")} amostras`
        : "0 amostras";
  }

  // Border colour
  content.className = content.className.replace(/border-\S+/g, "");
  content.classList.add(`border-${color.bar === "bar-green" ? "green" : color.bar === "bar-yellow" ? "yellow" : "red"}-500/20`, "border");

  skel.classList.add("hidden");
  content.classList.remove("hidden");
}

/**
 * Renderiza um cartão de sentido (Lisboa / Margem).
 */
function renderDirection(dir, stats) {
  const skel = document.getElementById(`dir-${dir}-skeleton`);
  const content = document.getElementById(`dir-${dir}-content`);
  if (!skel || !content) return;

  if (!stats) {
    skel.classList.add("hidden");
    content.innerHTML = `<p class="text-xs text-zinc-400 p-4 text-center">Sem dados suficientes</p>`;
    content.classList.remove("hidden");
    return;
  }

  const pct = stats.accuracy;
  const color = accColor(pct);

  const pctEl  = document.getElementById(`dir-${dir}-pct`);
  const barEl  = document.getElementById(`dir-${dir}-bar`);
  const delEl  = document.getElementById(`dir-${dir}-delay`);
  const cntEl  = document.getElementById(`dir-${dir}-count`);

  if (pctEl) {
    pctEl.textContent = fmt(pct);
    pctEl.className = `font-mono text-2xl font-bold ${color.text}`;
  }
  if (barEl) {
    barEl.className = `h-full bar-fill rounded-full ${color.bar}`;
    setTimeout(() => { barEl.style.width = (pct ?? 0) + "%"; }, 80);
  }
  if (delEl) delEl.textContent = stats.avgDelaySec !== null ? fmtDelta(stats.avgDelaySec) : "—";
  if (cntEl) cntEl.textContent = stats.count ? `${stats.count.toLocaleString("pt-PT")} amostras` : "—";

  skel.classList.add("hidden");
  content.classList.remove("hidden");
}

/**
 * Gera o HTML de um card de estação individual.
 */
function stationCardHTML(key, data) {
  const pct = data ? data.accuracy : null;
  const color = accColor(pct);

  const name = data ? data.name : key;
  const delay = data ? fmtDelta(data.avgDelaySec) : "—";
  const count = data ? data.count : 0;
  const pctStr = data ? fmt(pct) : "—";
  const noData = !data || count === 0;
  const isLowConf = data && data.lowConfidence;

  const baseCard = "relative rounded-xl border border-black/5 dark:border-white/5 bg-white/90 dark:bg-zinc-800/40 backdrop-blur-sm px-4 py-3 shadow-sm";
  const barW = pct !== null ? pct : 0;

  // Low confidence badge
  const lowConfBadge = isLowConf
    ? `<span class="text-[8px] font-bold uppercase tracking-wider text-amber-400 border border-amber-400/30 rounded px-1.5 py-0.5 ml-2 leading-none">baixa confiança</span>`
    : "";

  if (noData) {
    return `
      <div class="${baseCard} opacity-40">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-zinc-500 dark:text-zinc-400">${name}</span>
          <span class="text-xs font-mono text-zinc-400">sem dados</span>
        </div>
      </div>`;
  }

  return `
    <div class="${baseCard}">
      <div class="flex items-center gap-3">
        <!-- Accuracy pct -->
        <div class="shrink-0 w-14 text-right">
          <span class="font-mono text-base font-bold ${color.text}">${pctStr}</span>
        </div>
        <!-- Station name + bar -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center mb-1.5">
            <span class="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate">${name}</span>
            ${lowConfBadge}
          </div>
          <div class="h-1 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
            <div class="${color.bar} h-full rounded-full bar-fill" style="width:${barW}%"></div>
          </div>
        </div>
        <!-- Avg delay + count -->
        <div class="shrink-0 text-right">
          <div class="font-mono text-xs text-zinc-400">${delay}</div>
          <div class="font-mono text-[9px] text-zinc-500 opacity-60">${count} amostras</div>
        </div>
      </div>
    </div>`;
}

/**
 * Renderiza a lista de estações para um sentido.
 */
function renderStations(dir, stationsData, order) {
  const skel = document.getElementById(`stations-${dir}-skeleton`);
  const container = document.getElementById(`stations-${dir}`);
  if (!skel || !container) return;

  let html = "";
  order.forEach((key) => {
    const data = stationsData?.[key] || null;
    html += stationCardHTML(key, data);
  });

  container.innerHTML = html;
  skel.classList.add("hidden");
  container.classList.remove("hidden");

  // Trigger bar animations after insert
  requestAnimationFrame(() => {
    container.querySelectorAll(".bar-fill").forEach((el) => {
      // width already set via inline style in stationCardHTML
    });
  });
}

/**
 * Renderiza toda a página com os dados da API.
 */
function renderStats(data) {
  renderOverall(data.overall);
  renderDirection("lisboa", data.directions?.lisboa);
  renderDirection("margem", data.directions?.margem);
  renderStations("lisboa", data.stations?.lisboa, STATION_ORDER_LISBOA);
  renderStations("margem", data.stations?.margem, STATION_ORDER_MARGEM);

  // Show methodology note
  const meth = document.getElementById("methodology");
  if (meth) meth.classList.remove("hidden");

  // Update status bar
  const lastRefresh = document.getElementById("last-refresh");
  if (lastRefresh) {
    lastRefresh.textContent = `Atualizado às ${fmtTime(data.lastUpdated)} · ${data.totalMeasurements.toLocaleString("pt-PT")} medições totais`;
  }
}

// ─── LOADING STATE ────────────────────────────────────────────────────────────

function showError(msg) {
  const lastRefresh = document.getElementById("last-refresh");
  if (lastRefresh) lastRefresh.textContent = "Erro ao carregar dados — a tentar novamente...";

  // Show error inside overall card
  const skel = document.getElementById("overall-skeleton");
  const content = document.getElementById("overall-content");
  if (skel && content) {
    skel.classList.add("hidden");
    content.className = "rounded-2xl border border-red-500/20 bg-white/90 dark:bg-zinc-800/40 p-6";
    content.innerHTML = `
      <div class="flex items-center gap-3 text-red-400">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        </svg>
        <span class="text-sm font-medium">${msg}</span>
      </div>`;
    content.classList.remove("hidden");
  }
}

// ─── REFRESH COUNTDOWN ───────────────────────────────────────────────────────

let refreshCountdown = REFRESH_INTERVAL_MS / 1000;
let countdownInterval = null;

function startCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  refreshCountdown = REFRESH_INTERVAL_MS / 1000;
  const el = document.getElementById("next-refresh");

  countdownInterval = setInterval(() => {
    refreshCountdown -= 1;
    if (el) el.textContent = refreshCountdown > 0 ? `próxima atualização em ${refreshCountdown}s` : "";
    if (refreshCountdown <= 0) clearInterval(countdownInterval);
  }, 1000);
}

// ─── MAIN FETCH LOOP ─────────────────────────────────────────────────────────

async function loadStats() {
  try {
    const res = await fetch(API_STATS + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.overall.count === 0) {
      // API online but no measurements yet (server just restarted)
      const lastRefresh = document.getElementById("last-refresh");
      if (lastRefresh) lastRefresh.textContent = "A recolher dados — sem medições ainda. Volta mais tarde.";
      // Still render (shows zeros / no-data state)
    }

    renderStats(data);
    startCountdown();

    // Re-init lucide icons that may have been injected into the DOM
    if (window.lucide) lucide.createIcons();

  } catch (e) {
    console.error("Stats fetch error:", e);
    showError("Não foi possível carregar as estatísticas. Verifica a ligação.");
    startCountdown();
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", function () {
  loadStats();
  setInterval(loadStats, REFRESH_INTERVAL_MS);

  // Re-init lucide icons after menu.js runs
  setTimeout(() => { if (window.lucide) lucide.createIcons(); }, 200);
});

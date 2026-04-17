/**
 * app-ui.js
 * Toda a lógica de UI: renderização da lista de comboios, modal de detalhes,
 * selects de estações, status, tabs e ações do utilizador.
 * Depende de: app-config.js, app-alerts.js, app-trains.js
 */

// HELPERS: CONSTRUÇÃO DE HTML DOS CARTÕES
/** Classe + glow do ponto de estado. */
function _dotInfo(t) {
  if (t.isOffline) {
    return { cls: "bg-zinc-500 dark:bg-zinc-600", style: "" };
  }
  const map = {
    green: { cls: "bg-emerald-500", glow: "rgba(16,185,129,0.5)" },
    yellow: { cls: "bg-amber-500", glow: "rgba(245,158,11,0.5)" },
    red: { cls: "bg-red-500", glow: "rgba(239,68,68,0.5)" },
    orange: { cls: "bg-orange-500", glow: "rgba(249,115,22,0.5)" },
  };
  const m = map[t.dotStatus];
  if (!m) return { cls: "bg-zinc-400 dark:bg-zinc-600", style: "" };
  const pingCls = t.pulse ? ` shadow-[0_0_8px_${m.glow}] dot-ping` : "";
  return {
    cls: m.cls + pingCls,
    style: t.pulse ? `style="--dot-color-glow:${m.glow}"` : "",
  };
}

/** Classe CSS do texto de estado. */
function _statusCls(t) {
  if (t.isOffline) return "text-zinc-400 dark:text-zinc-500 italic";
  if (t.isSuppressed) return "text-red-500 font-bold";
  if ((t.status || "").includes("Atraso"))
    return "text-yellow-600 dark:text-yellow-400";
  return "text-zinc-500 dark:text-zinc-400";
}

/** HTML das barras de carruagens. offline com cores apenas quando têm ocupaçao de resto cinzento*/
function _carsHtml(t) {
  if (!t.carriages) return "";
  const occ = t.occupancy;
  let fill;
  if (t.occupancy != null) {
    fill =
      occ === 0
        ? "bg-blue-500"
        : occ > 85
          ? "bg-red-500"
          : occ > 50
            ? "bg-yellow-500"
            : "bg-emerald-500";
  } else if (t.isOffline) {
    fill = "bg-zinc-400 dark:bg-zinc-600";
  } else {
    fill = "bg-blue-500";
  }

  const filled = t.occupancy
    ? Math.round((t.occupancy / 100) * t.carriages)
    : t.carriages;
  const w = t.carriages === 8 ? "w-full" : "w-1/2";
  let blocks = "";
  for (let c = 0; c < t.carriages; c++) {
    blocks += `<div class="h-[6px] rounded-[2px] transition-all duration-300 ease-out flex-1 ${c < filled ? fill : "bg-zinc-300 dark:bg-zinc-700"} opacity-90"></div>`;
  }
  return `<div class="flex justify-center w-full mt-3"><div class="flex gap-1 h-1.5 ${w}">${blocks}</div></div>`;
}

/** HTML do contexto de posição do comboio. */
function _ctxHtml(t) {
  if (!t.context) return "";
  const { prev, curr, next } = t.context;
  return `
    <div class="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 w-full text-[9px] text-zinc-500">
      <div class="flex items-center justify-end gap-1 opacity-60">
        ${prev ? `<span class="truncate max-w-[70px]">${prev.name}</span><span>-</span>` : ""}
      </div>
      <div class="flex flex-col items-center text-zinc-700 dark:text-zinc-300 font-bold scale-110 justify-self-center min-w-[80px]">
        <span>${curr.name}</span>
      </div>
      <div class="flex items-center justify-start gap-1 opacity-60">
        ${next ? `<span>-</span><span class="truncate max-w-[70px]">${next.name}</span>` : ""}
      </div>
    </div>`;
}

/**
 * Gera o innerHTML completo de um cartão.
 * Cada campo dinâmico tem data-field para permitir _patchCard sem re-render.
 */
function _cardInnerHTML(t) {
  const { cls: dotCls, style: dotStyle } = _dotInfo(t);
  const timeCls = t.isSuppressed ? "line-through text-zinc-500 opacity-70" : "";
  const arrHideCls = t.isSuppressed ? "opacity-0" : "";
  const colorText = "text-blue-500 dark:text-blue-400";

  return `
    <div class="flex justify-between items-start mb-2">
      <div class="flex flex-col">
        <div class="flex items-center gap-2 mb-1">
          <span data-field="op" class="text-[9px] font-bold px-2 py-0.5 rounded-full border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 text-zinc-500 dark:text-zinc-400 tracking-wider uppercase">${t.op}</span>
          <span class="text-[9px] font-mono text-zinc-400 dark:text-zinc-500">#${t.num}</span>
        </div>
        <div class="flex items-baseline gap-2">
          <span data-field="time" class="font-mono text-4xl font-medium tracking-tighter leading-none ${timeCls} text-zinc-900 dark:text-zinc-100">${t.time}</span>
          <span data-field="sectime" class="text-[0.55em] line-through opacity-60 font-medium ml-2 text-zinc-500 align-baseline font-mono text-sm ${t.secTime ? "" : "hidden"}">${t.secTime || ""}</span>
        </div>
      </div>
      <div class="flex flex-col items-end">
        <h3 data-field="dest" class="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide text-right truncate max-w-[100px]">${t.dest}</h3>
        <div data-field="arr-wrap" class="flex items-baseline mt-1 ${arrHideCls}">
          <span class="text-[10px] text-zinc-600 dark:text-zinc-500 mr-1">Chegada</span>
          <span data-field="arr" style="font-size:1.125rem;line-height:1.75rem" class="font-mono text-lg font-medium ${colorText}">${t.arr}</span>
        </div>
      </div>
    </div>
    <div class="flex items-center justify-between gap-2 mb-1">
      <div class="flex items-center gap-2">
        <div data-field="dot" class="w-1.5 h-1.5 rounded-full ${dotCls}" ${dotStyle}></div>
        <span data-field="status" class="text-[0.65rem] uppercase tracking-wide font-medium ${_statusCls(t)}">${t.status}</span>
      </div>
      <button
        data-action="open-details"
        data-train-id="${t.id}"
        class="text-[10px] font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 underline decoration-zinc-300 dark:decoration-zinc-700 underline-offset-2 transition-colors">
        Ver Detalhes
      </button>
    </div>
    <div data-field="cars">${_carsHtml(t)}</div>
    <div data-field="ctx">${_ctxHtml(t)}</div>
  `;
}

/** Cria um elemento DOM completo de cartão de comboio. */
function _makeCard(t, isPassed) {
  const opCls = isPassed ? "opacity-60 grayscale-[0.5]" : "opacity-100";
  const el = document.createElement("div");
  el.id = `train-${t.id}`;
  el.dataset.key = `card-${t.id}`;
  el.className = `bg-white/90 dark:bg-zinc-800/40 backdrop-blur-sm border border-black/5 dark:border-white/5 shadow-sm rounded-2xl p-5 relative overflow-hidden group ${opCls}`;
  el.innerHTML = _cardInnerHTML(t);
  return el;
}

/**
 * Atualiza apenas os campos dinâmicos de um cartão existente.
 * Não toca no DOM fora desses campos.
 */
function _patchCard(el, t, isPassed) {
  const opCls = isPassed ? "opacity-60 grayscale-[0.5]" : "opacity-100";
  el.className = `bg-white/90 dark:bg-zinc-800/40 backdrop-blur-sm border border-black/5 dark:border-white/5 shadow-sm rounded-2xl p-5 relative overflow-hidden group ${opCls}`;

  const { cls: dotCls, style: dotStyle } = _dotInfo(t);
  const dot = el.querySelector("[data-field='dot']");
  if (dot) {
    dot.className = `w-1.5 h-1.5 rounded-full ${dotCls}`;
    const m = dotStyle.match(/style="([^"]*)"/);
    if (m) dot.setAttribute("style", m[1]);
    else dot.removeAttribute("style");
  }

  const opEl = el.querySelector("[data-field='op']");
  if (opEl) opEl.textContent = t.op;

  const destEl = el.querySelector("[data-field='dest']");
  if (destEl) destEl.textContent = t.dest;

  const statusEl = el.querySelector("[data-field='status']");
  if (statusEl) {
    statusEl.className = `text-[0.65rem] uppercase tracking-wide font-medium ${_statusCls(t)}`;
    statusEl.innerHTML = t.status;
  }

  const timeEl = el.querySelector("[data-field='time']");
  if (timeEl) {
    const timeCls = t.isSuppressed
      ? "line-through text-zinc-500 opacity-70"
      : "";
    timeEl.className = `font-mono text-4xl font-medium tracking-tighter leading-none ${timeCls} text-zinc-900 dark:text-zinc-100`;
    timeEl.textContent = t.time;
  }

  const secEl = el.querySelector("[data-field='sectime']");
  if (secEl) {
    if (t.secTime) {
      secEl.textContent = t.secTime;
      secEl.classList.remove("hidden");
    } else {
      secEl.textContent = "";
      secEl.classList.add("hidden");
    }
  }

  const arrEl = el.querySelector("[data-field='arr']");
  if (arrEl) arrEl.textContent = t.arr;

  const arrWrap = el.querySelector("[data-field='arr-wrap']");
  if (arrWrap)
    arrWrap.className = `flex items-baseline mt-1 ${t.isSuppressed ? "opacity-0" : ""}`;

  const carsEl = el.querySelector("[data-field='cars']");
  if (carsEl) carsEl.innerHTML = _carsHtml(t);

  const ctxEl = el.querySelector("[data-field='ctx']");
  if (ctxEl) ctxEl.innerHTML = _ctxHtml(t);
}

// ═══════════════════════════════════════════════════════════════════════
// RECONCILIADOR DOM
// ═══════════════════════════════════════════════════════════════════════

/**
 * Cria um elemento DOM para um item da sequência desejada.
 * Tipos suportados: "divider", "alerts", "card".
 */
function _makeItem(item) {
  if (item.type === "divider") {
    const el = document.createElement("div");
    el.dataset.key = "__divider__";
    el.className = "flex items-center gap-4 py-4 opacity-80";
    el.innerHTML = `
      <div class="flex-1 h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50"></div>
      <span class="text-[0.65rem] font-extrabold uppercase tracking-[0.2em] text-blue-500 whitespace-nowrap">Próximo Comboio</span>
      <div class="flex-1 h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50"></div>
    `;
    return el;
  }

  if (item.type === "alerts") {
    const html = AlertsManager.generateHTML(item.alerts);
    if (!html) {
      const el = document.createElement("div");
      el.dataset.key = "__alerts__";
      el.style.display = "none";
      return el;
    }
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const inner = tmp.firstElementChild;
    if (inner) {
      inner.dataset.key = "__alerts__";
      return inner;
    }
    const el = document.createElement("div");
    el.dataset.key = "__alerts__";
    return el;
  }

  // type === "card"
  return _makeCard(item.t, item.isPassed);
}

/** Actualiza o conteúdo de um elemento existente. */
function _updateItem(el, item) {
  if (item.type === "divider") return; // estático

  if (item.type === "alerts") {
    const html = AlertsManager.generateHTML(item.alerts);
    if (!html) {
      el.style.display = "none";
      return;
    }
    el.removeAttribute("style");
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const inner = tmp.firstElementChild;
    if (inner) {
      el.className = inner.className;
      el.id = inner.id || el.id;
      el.innerHTML = inner.innerHTML;
    }
    _initAlertsPagination();
    return;
  }

  // type === "card"
  _patchCard(el, item.t, item.isPassed);
}

/**
 * Reconcilia o DOM de `container` com a sequência `desired`.
 *
 * Algoritmo (percurso inverso com anchor):
 *   1. Colecta elementos existentes por data-key
 *   2. Remove chaves ausentes da sequência desejada
 *   3. Percorre desired de trás para a frente, usando insertBefore(el, anchor)
 *      → elementos já na posição correcta não são movidos (ZERO CLS)
 */
function _reconcile(container, desired) {
  // 1. Mapa dos elementos existentes
  const existing = new Map();
  container.querySelectorAll("[data-key]").forEach((el) => {
    existing.set(el.dataset.key, el);
  });

  // 2. Remove elementos obsoletos
  const desiredKeys = new Set(desired.map((d) => d.key));
  existing.forEach((el, key) => {
    if (!desiredKeys.has(key)) {
      el.remove();
      existing.delete(key);
    }
  });

  // 3. Insere/move/actualiza em sentido inverso
  let anchor = null;
  for (let i = desired.length - 1; i >= 0; i--) {
    const item = desired[i];
    let el = existing.get(item.key);

    if (el) {
      _updateItem(el, item);
      // Só move se não estiver na posição correcta
      const shouldBefore = anchor; // el deve ser imediatamente antes do anchor
      const isCorrect = shouldBefore
        ? el.nextElementSibling === shouldBefore
        : el === container.lastElementChild;
      if (!isCorrect) container.insertBefore(el, anchor);
    } else {
      el = _makeItem(item);
      container.insertBefore(el, anchor);
    }
    anchor = el;
  }
}

/** Inicializa scroll de paginação do slider de alertas. */
function _initAlertsPagination() {
  const slider = document.getElementById("alerts-slider");
  const dots = document.querySelectorAll("#alerts-pagination div");
  if (!slider || !dots.length) return;
  slider.onscroll = () => {
    const idx = Math.round(slider.scrollLeft / slider.offsetWidth);
    dots.forEach((d, i) => {
      d.className =
        i === idx
          ? "bg-blue-500 w-3 h-1.5 rounded-full transition-all duration-300"
          : "bg-zinc-300 dark:bg-zinc-700 w-1.5 h-1.5 rounded-full transition-all duration-300";
    });
  };
}

// ═══════════════════════════════════════════════════════════════════════
// LISTA OFFLINE (a partir do JSON em cache)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Constrói uma lista de comboios a partir do JSON local (sem API).
 * Status = "OFFLINE", ponto cinzento, sem dados em tempo real.
 * Deve ser chamada imediatamente após carregar os JSON do SW cache,
 * ANTES de qualquer fetch à API — garante que os cartões aparecem
 * instantaneamente e o reconciliador pode depois patchar in-place.
 */
window.buildOfflineTrainList = function () {
  const currentDB = activeTab === "lisboa" ? DB_LISBOA : DB_MARGEM;
  if (!currentDB || !currentDB.trips) return [];

  const orgInfo = FERTAGUS_STATIONS.find((s) => s.key === fertagusOrigin);
  const dstInfo = FERTAGUS_STATIONS.find((s) => s.key === fertagusDest);
  if (!orgInfo || !dstInfo) return [];

  const now = new Date();

  return currentDB.trips
    .filter((trip) => {
      if (!trip[fertagusOrigin] || !trip[fertagusDest]) return false;
      const trainDate = window.parseTimeStr(trip[fertagusOrigin]);
      const destDate = window.parseTimeStr(trip[fertagusDest]);
      if (!trainDate || !destDate || trainDate >= destDate) return false;

      const opDate = new Date(trainDate);
      if (opDate.getHours() < 5) opDate.setDate(opDate.getDate() - 1);
      const isWknd = isWeekendOrHoliday(opDate);
      const hType = parseInt(trip.horario);
      if (hType === 1) return true;
      if (hType === 0 && !isWknd) return true;
      if (hType === 2 && isWknd) return true;
      return false;
    })
    .map((trip) => {
      const scheduledDate = window.parseTimeStr(trip[fertagusOrigin]);
      if (!scheduledDate || scheduledDate < now) return null;

      const opDate = new Date(scheduledDate);
      if (opDate.getHours() < 5) opDate.setDate(opDate.getDate() - 1);
      const isSpecial = isWeekendOrHoliday(opDate);

      let originLabel = "FERTAGUS";
      if (trip.setubal) originLabel = "SETÚBAL";
      else if (trip.coina) originLabel = "COINA";

      return {
        id: trip.id,
        num: trip.id,
        op: originLabel,
        time: trip[fertagusOrigin],
        secTime: null,
        dest: dstInfo.name,
        status: "OFFLINE",
        arr: trip[fertagusDest],
        dotStatus: "gray",
        pulse: false,
        isLive: false,
        isSuppressed: false,
        carriages: isSpecial ? 4 : trip.carruagens,
        occupancy: isSpecial ? null : trip.ocupacao,
        context: null,
        isPassed: false,
        isEffectiveFuture: true,
        rawTime: scheduledDate,
        effectiveDate: scheduledDate,
        fullSchedule: null,
        isOffline: true,
      };
    })
    .filter((t) => t !== null)
    .sort((a, b) => a.effectiveDate - b.effectiveDate);
};

// ═══════════════════════════════════════════════════════════════════════
// COUNTDOWN & STATUS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Actualiza o contador regressivo do próximo comboio.
 * USA APENAS opacity — nunca display:none/block — para evitar CLS no header fixo.
 * O espaço do header está sempre reservado (ver app.html: sem classe "hidden").
 */
window.updateNextCountdown = function () {
  const header = document.getElementById("next-train-header");
  const display = document.getElementById("countdown-display");
  if (!header || !display) return;

  if (!nextTrainDate) {
    // Torna invisível mas mantém o espaço reservado
    header.classList.add("opacity-0");
    return;
  }

  const now = new Date();
  let diff = Math.floor((nextTrainDate - now) / 1000);
  if (diff < 0) diff = 0;
  const min = Math.floor(diff / 60);
  const sec = Math.floor((diff % 60) / 10) * 10;
  display.innerText =
    min > 100 ? "AMANHÃ" : `${min} min ${sec.toString().padStart(2, "0")} s`;

  header.classList.remove("opacity-0");
};

window.setStatus = function (s) {
  const ping = document.getElementById("status-ping");
  const icon = document.getElementById("refresh-icon-menu");
  const lastUpd = document.getElementById("last-updated");

  if (s === "loading") {
    if (icon) icon.classList.add("animate-spin");
  } else if (s === "error" || s === "offline") {
    if (ping)
      ping.className = `relative inline-flex h-1.5 w-1.5 rounded-full ${s === "offline" ? "bg-zinc-500" : "bg-red-500"}`;
    if (lastUpd) lastUpd.innerText = "Offline";
    if (icon) icon.classList.remove("animate-spin");
  } else {
    // success
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

// ═══════════════════════════════════════════════════════════════════════
// CARREGAMENTO DE DADOS
// ═══════════════════════════════════════════════════════════════════════

window.loadData = async function (silent = false) {
  if (isLoading) return;
  isLoading = true;
  if (!silent) setStatus("loading");

  try {
    if (!silent) await new Promise((r) => setTimeout(r, 300));
    const data = await getTrains();

    // erro de rede
    if (data === null) {
      setStatus("offline");
      renderList(buildOfflineTrainList());
      return;
    }

    // API marcada como em baixo → popup de aviso + lista offline
    if (window.apiIsDown) {
      renderList(buildOfflineTrainList());
      setStatus("offline");
      showIpDownPopup();
      return;
    }

    await updateAlertsSystem(data);
    renderList(data);

    if (data.length > 0) setStatus("success");
    else setStatus("offline");
  } catch (e) {
    console.error("[loadData]", e);
    setStatus("error");
  } finally {
    isLoading = false;
    if (window.lucide) lucide.createIcons();
  }
};

window.manualRefresh = function () {
  focusOnContent();
  loadData(false);
};

// ═══════════════════════════════════════════════════════════════════════
// TABS & ESTADO
// ═══════════════════════════════════════════════════════════════════════

window.switchTab = function (t) {
  if (t !== activeTab) {
    const tmp = fertagusOrigin;
    fertagusOrigin = fertagusDest;
    fertagusDest = tmp;
  }
  activeTab = t;

  document.getElementById("ambient-light").className =
    "fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full blur-[120px] pointer-events-none transition-colors duration-1000 bg-blue-500/10";

  populateOriginSelect();
  populateDestSelect(fertagusOrigin);
  validateRoute();
  saveState();

  // Remove apenas os elementos geridos pelo reconciliador
  const container = document.getElementById("train-list");
  if (container)
    container.querySelectorAll("[data-key]").forEach((el) => el.remove());

  window.hasScrolledNext = false;
  // Só esconde com opacity (sem display:none → sem CLS)
  const header = document.getElementById("next-train-header");
  if (header) header.classList.add("opacity-0");

  loadData(false);
};

window.saveState = function () {
  localStorage.setItem("ft_org", fertagusOrigin);
  localStorage.setItem("ft_dst", fertagusDest);
  localStorage.setItem("ft_tab", activeTab);
};

// ═══════════════════════════════════════════════════════════════════════
// SELECTS DE ESTAÇÕES
// ═══════════════════════════════════════════════════════════════════════

window.populateOriginSelect = function () {
  const orgSel = document.getElementById("sel-origin");
  const dstSel = document.getElementById("sel-dest");
  if (!orgSel || !dstSel) return;

  const options =
    activeTab === "lisboa"
      ? FERTAGUS_STATIONS.slice()
      : FERTAGUS_STATIONS.slice().reverse();

  orgSel.innerHTML = options
    .map((s) => `<option value="${s.key}">${s.name}</option>`)
    .join("");

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
  const valid =
    activeTab === "lisboa"
      ? FERTAGUS_STATIONS.slice(orgIdx + 1)
      : FERTAGUS_STATIONS.slice(0, orgIdx).reverse();

  destSel.innerHTML = valid
    .map((s) => `<option value="${s.key}">${s.name}</option>`)
    .join("");

  if (valid.find((o) => o.key === fertagusDest)) {
    destSel.value = fertagusDest;
  } else if (valid.length > 0) {
    destSel.value = valid[0].key;
    fertagusDest = destSel.value;
  }
};

window.populateDestSelect = function (currentOrigin) {
  const dstSel = document.getElementById("sel-dest");
  if (!dstSel) return;

  const valid = FERTAGUS_STATIONS.filter((s) => s.key !== currentOrigin);
  dstSel.innerHTML = valid
    .map((s) => `<option value="${s.key}">${s.name}</option>`)
    .join("");

  if (valid.find((s) => s.key === fertagusDest)) {
    dstSel.value = fertagusDest;
  } else if (valid.length > 0) {
    fertagusDest = valid[0].key;
    dstSel.value = fertagusDest;
  }
};

window.updateStations = function () {
  handleOriginChange();
};
window.updateStationLabels = function () {}; // no-op

// ─── HANDLERS ─────────────────────────────────────────────────────────

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
  const tmp = fertagusOrigin;
  fertagusOrigin = fertagusDest;
  fertagusDest = tmp;
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
  const newDir = calculateDirection(fertagusOrigin, fertagusDest);
  if (newDir !== activeTab) activeTab = newDir;
  saveState();
  loadData();
  setTimeout(focusOnContent, 800);
}

// ═══════════════════════════════════════════════════════════════════════
// MODAL DE DETALHES
// ═══════════════════════════════════════════════════════════════════════

function openDetails(trainId) {
  sa_event("open_details_train");
  const t = currentTrainList.find((tr) => tr.id == trainId);
  if (!t) return;

  // ── Barras de ocupação ─────────────────────────────────────────────
  let occCls = "text-emerald-500",
    barCls = "bg-emerald-500";
  if (t.occupancy > 85) {
    occCls = "text-red-500";
    barCls = "bg-red-500";
  } else if (t.occupancy > 50) {
    occCls = "text-yellow-500";
    barCls = "bg-yellow-500";
  }

  const count = t.carriages || 4;
  const filledCount = t.occupancy
    ? Math.round((t.occupancy / 100) * count)
    : count;
  let carsHtml = "";
  if (t.occupancy != null) {
    for (let c = 0; c < count; c++) {
      carsHtml += `<div class="h-2 flex-1 rounded-sm ${c < filledCount ? barCls : "bg-zinc-700/50"} transition-all"></div>`;
    }
  } else {
    for (let c = 0; c < count; c++) {
      carsHtml += `<div class="h-2 flex-1 rounded-sm bg-zinc-700/50 border border-zinc-600/30"></div>`;
    }
  }

  // ── Timeline ───────────────────────────────────────────────────────
  let timelineHtml = "";

  if (t.fullSchedule && t.fullSchedule.length > 0) {
    // Modo online: dados reais da API
    t.fullSchedule.forEach((node, i) => {
      const passed = node.ComboioPassou;
      const isNext =
        !passed && (i === 0 || t.fullSchedule[i - 1].ComboioPassou);
      const dotColor = passed
        ? "bg-zinc-700 border-zinc-700"
        : isNext
          ? "bg-blue-500 border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.4)]"
          : "bg-zinc-800 border-zinc-600";
      const textColor = passed
        ? "text-zinc-600"
        : isNext
          ? "text-zinc-600 font-bold dark:text-zinc-200"
          : "text-zinc-500";
      const timeColor = passed
        ? "text-zinc-700"
        : isNext
          ? "text-blue-400 font-bold"
          : "text-zinc-500";
      const sched = node.HoraProgramada.substring(0, 5);
      const pred = node.HoraPrevista
        ? node.HoraPrevista.substring(0, 5)
        : sched;
      const showTime = pred !== sched && !t.isSuppressed ? pred : sched;
      const subTime = pred !== sched && !t.isSuppressed ? sched : "";
      timelineHtml += `
        <div class="relative z-10 flex items-center mb-8 last:mb-0 group">
          <div class="w-14 text-right mr-6 flex-shrink-0 flex flex-col items-end">
            <span class="font-mono text-sm ${timeColor} leading-none">${showTime}</span>
            ${subTime ? `<span class="text-[9px] text-zinc-700 line-through decoration-zinc-700/50 mt-0.5">${subTime}</span>` : ""}
          </div>
          <div class="w-3 h-3 rounded-full border-2 ${dotColor} flex-shrink-0 transition-all group-hover:scale-110 z-20 relative"></div>
          <div class="ml-6 flex-1">
            <h4 class="text-sm ${textColor}">${node.NomeEstacao}</h4>
            ${passed ? "" : isNext ? '<span class="text-[9px] text-blue-500 uppercase tracking-wider font-bold animate-pulse block mt-0.5">Próxima</span>' : ""}
          </div>
        </div>`;
    });
  } else {
    // Modo offline: usa JSON local para a timeline
    if (t.isOffline) {
      timelineHtml += `
        <div class="flex items-center gap-2 mb-6 px-3 py-2.5 rounded-xl bg-zinc-800/60 border border-white/5">
          <span class="w-1.5 h-1.5 rounded-full bg-zinc-500 shrink-0 animate-pulse"></span>
          <p class="text-[10px] text-zinc-400 leading-relaxed">Horário programado. Estado em tempo real indisponível sem ligação à internet.</p>
        </div>`;
    }
    const currentDB = activeTab === "lisboa" ? DB_LISBOA : DB_MARGEM;
    const dbTrain = currentDB
      ? currentDB.trips.find((tr) => tr.id == t.id)
      : null;
    if (dbTrain) {
      const stations = FERTAGUS_STATIONS.filter((st) => dbTrain[st.key]);
      const ordered =
        activeTab === "margem" ? [...stations].reverse() : stations;
      ordered.forEach((st) => {
        const time = dbTrain[st.key];
        if (!time) return;
        const isOrigin = st.key === fertagusOrigin;
        const isDest = st.key === fertagusDest;
        const hlCls =
          isOrigin || isDest ? "text-blue-400 font-bold" : "text-zinc-500";
        const dotCls =
          isOrigin || isDest
            ? "bg-blue-500/30 border-blue-500/50"
            : "bg-zinc-800 border-zinc-600";
        timelineHtml += `
          <div class="relative z-10 flex items-center mb-8 last:mb-0">
            <div class="w-14 text-right mr-6 flex-shrink-0">
              <span class="font-mono text-sm ${hlCls} leading-none">${time}</span>
            </div>
            <div class="w-3 h-3 rounded-full border-2 ${dotCls} flex-shrink-0 z-20 relative"></div>
            <div class="ml-6 flex-1">
              <h4 class="text-sm ${isDest || isOrigin ? "text-zinc-300" : "text-zinc-400"}">${st.name}</h4>
              ${isOrigin ? '<span class="text-[9px] text-zinc-500 uppercase tracking-wider block mt-0.5">Partida</span>' : ""}
              ${isDest ? '<span class="text-[9px] text-zinc-500 uppercase tracking-wider block mt-0.5">Chegada</span>' : ""}
            </div>
          </div>`;
      });
    }
  }

  // ── Dot do modal ───────────────────────────────────────────────────
  const modalDot = t.isOffline
    ? "bg-zinc-500"
    : t.dotStatus === "green"
      ? "bg-emerald-500"
      : t.dotStatus === "yellow"
        ? "bg-yellow-500"
        : t.dotStatus === "orange"
          ? "bg-orange-500"
          : "bg-red-500";

  const fullContent = `
    <div class="flex flex-col h-full bg-[#09090b]">
      <div class="relative z-20 backdrop-blur-md border-b border-white/5 pb-6 px-6 shadow-xl bg-zinc-50 dark:bg-zinc-900/65" style="padding-top: max(1.5rem, calc(0.5rem + env(safe-area-inset-top)));">
        <button data-action="close-details" class="absolute right-5 p-2 bg-white/5 hover:bg-white/10 rounded-full text-zinc-400 hover:text-white transition-all" style="top: max(1.25rem, calc(0.25rem + env(safe-area-inset-top)));">
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
                <div class="w-1.5 h-1.5 rounded-full ${modalDot} animate-pulse"></div>
                <span class="text-[10px] font-bold uppercase text-zinc-500 dark:text-zinc-300 leading-none">${t.status}</span>
              </div>
            </div>
          </div>
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
                ${
                  t.occupancy != null
                    ? `<span class="text-2xl font-mono font-bold ${occCls} leading-none">${t.occupancy}%</span>`
                    : `<span class="text-[11px] text-zinc-600 italic">Apenas Hora de Ponta</span>`
                }
              </div>
            </div>
          </div>
          ${t.occupancy != null ? `<div class="flex gap-1.5 w-full mt-1">${carsHtml}</div>` : ""}
          <p style="margin-top:-14px" class="text-[9px] text-zinc-500 dark:text-zinc-400 leading-relaxed ${t.occupancy != null ? "" : "hidden"}">
            Estimativa de Lotação: Os dados baseiam-se no histórico oficial da Fertagus e <b>não</b> em tempo real.
            <a class="underline" target="_blank" href="https://www.fertagus.pt/Fertagus-pt/Viajar/Comunicados-e-Campanhas/Nova-oferta-de-comboios-duplos-e-simples-20-de-janeiro-25">Vê a Fonte da Informação</a>
          </p>
        </div>
      </div>
      <div class="flex-grow overflow-y-auto px-6 py-8 relative bg-zinc-50 dark:bg-[#09090b]">
        ${timelineHtml}
        <button
          data-action="close-details"
          class="w-full mt-6 mb-2 py-3.5 flex items-center justify-center gap-2 text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 active:scale-[0.98] transition-all border border-zinc-200 dark:border-zinc-700 rounded-xs">
          <i data-lucide="x" class="w-4 h-4"></i>
          Fechar Detalhes
        </button>
        <div class="h-8"></div>
      </div>
    </div>
  `;

  const modal = document.getElementById("train-details-modal");
  const backdrop = document.getElementById("modal-backdrop");
  modal.innerHTML = fullContent;
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

// POPUP "IP EM BAIXO" (+ossilel remover)

let ipPopupDismissed = false;

function showIpDownPopup() {
  if (ipPopupDismissed) return;
  if (document.getElementById("ip-down-popup")) return;

  const overlay = document.createElement("div");
  overlay.id = "ip-down-popup";
  overlay.className =
    "fixed inset-0 z-[100] flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-fade-in px-6";

  overlay.innerHTML = `
    <div class="bg-white dark:bg-zinc-900 border border-red-500/70 shadow-2xl rounded-3xl p-6 md:p-8 max-w-sm w-full text-center flex flex-col items-center">
      <div class="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-5">
        <i data-lucide="server-crash" class="w-8 h-8 text-red-500 animate-pulse"></i>
      </div>
      <h2 class="text-xl font-bold text-zinc-900 dark:text-white mb-2 leading-tight">Falha na Infraestruturas de Portugal</h2>
      <p class="text-xs text-zinc-500 dark:text-zinc-400 mb-6 leading-relaxed">
        Os servidores com informações de circulação da <b>IP</b> foram abaixo. A infraestrutura da LiveTagus encontra-se 100% operacional, mas sem a fonte oficial não conseguimos obter a localização dos comboios. Isto <b>não</b> significa que os comboios estejam com perturbações na circulação!
      </p>
      <button data-action="dismiss-ip-popup" class="w-full py-3.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold tracking-widest uppercase transition-all active:scale-95 shadow-lg shadow-red-500/20 mb-3">
        Entendido
      </button>
      <a data-action="go-offline" href="./horarios" class="w-full py-3.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 text-sm font-bold tracking-widest uppercase transition-all active:scale-95 text-center">
        Ver Horários Offline
      </a>
      <a data-action="sudoku-offline" href="./sudoku" class="mt-3 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 underline underline-offset-2 transition-colors">
        Aproveitar e Jogar Sudoku
      </a>
      <div class="flex items-center gap-2 mt-5 text-[10px] text-zinc-400">
        <span class="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-ping"></span>
        A tentar religar automaticamente...
      </div>
    </div>
  `;

  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) dismissIpDownPopup();
  });

  document.body.appendChild(overlay);
  if (window.lucide) lucide.createIcons();
}

window.dismissIpDownPopup = function () {
  const popup = document.getElementById("ip-down-popup");
  if (popup) {
    popup.style.opacity = "0";
    popup.style.transition = "opacity 0.3s ease";
    setTimeout(() => popup.remove(), 300);
  }
  ipPopupDismissed = true;
};

// ═══════════════════════════════════════════════════════════════════════
// RENDERIZAÇÃO DA LISTA (CLS-FREE via reconciliador)
// ═══════════════════════════════════════════════════════════════════════

window.renderList = function (list) {
  const container = document.getElementById("train-list");
  const loadMoreBtn = document.getElementById("load-more-btn");
  currentTrainList = list;

  // ── 0. Limpa popup "API em baixo" quando a API volta ───────────────
  const ipPopup = document.getElementById("ip-down-popup");
  if (!window.apiIsDown && ipPopup) {
    ipPopup.remove();
    ipPopupDismissed = false;
  }

  // ── 1. Lista vazia ─────────────────────────────────────────────────
  if (!list || !list.length) {
    // Remove todos os elementos geridos pelo reconciliador
    container.querySelectorAll("[data-key]").forEach((el) => el.remove());
    // Remove qualquer estado vazio anterior (sem data-key)
    [...container.children].forEach((el) => {
      if (!el.dataset.key) el.remove();
    });
    container.innerHTML = `
      <div class="h-60 flex flex-col items-center justify-center text-zinc-500 gap-3">
        <i data-lucide="train-track" class="w-10 h-10 opacity-20"></i>
        <p class="text-xs tracking-wider uppercase font-medium text-center">
          Sem comboios próximos<br>
          <a class="underline underline-offset-2" data-action="go-offline" href="./horarios">Vê Horários Offline</a>
        </p>
      </div>`;
    if (window.lucide) lucide.createIcons();
    loadMoreBtn.classList.add("hidden");
    nextTrainDate = null;
    updateNextCountdown();
    return;
  }

  // ── 2. Limite de exibição ──────────────────────────────────────────
  const visibleList = list.slice(0, displayLimit);
  if (list.length > displayLimit) loadMoreBtn.classList.remove("hidden");
  else loadMoreBtn.classList.add("hidden");

  // ── 3. Índice do próximo comboio ───────────────────────────────────
  let nextIdx = list.findIndex((t) => t.isEffectiveFuture && !t.isSuppressed);
  if (nextIdx === -1 && list.some((t) => !t.isSuppressed))
    nextIdx = list.length - 1;
  if (nextIdx === -1) nextIdx = 0;
  nextTrainDate = list[nextIdx]?.effectiveDate;
  updateNextCountdown();

  // ── 4. Sequência desejada ──────────────────────────────────────────
  // O divisor e os alertas fazem SEMPRE parte da sequência, na posição correcta.
  // O reconciliador garante que elementos já existentes não são movidos.
  const desired = [];
  visibleList.forEach((t, i) => {
    if (i === nextIdx) {
      desired.push({ key: "__divider__", type: "divider" });
      // Inclui sempre o slot de alertas (mesmo vazio), para reservar a posição
      desired.push({ key: "__alerts__", type: "alerts", alerts: activeAlerts });
    }
    desired.push({
      key: `card-${t.id}`,
      type: "card",
      t,
      isPassed: i < nextIdx,
    });
  });

  // ── 5. Remove conteúdo não-gerido (estado vazio, etc.) ────────────
  [...container.children].forEach((el) => {
    if (!el.dataset.key) el.remove();
  });

  // ── 6. Reconcilia o DOM (zero CLS) ────────────────────────────────
  _reconcile(container, desired);

  // ── 7. Scroll automático (só na primeira carga) ───────────────────
  if (!window.hasScrolledNext && nextIdx !== -1) {
    setTimeout(() => {
      const target =
        document.getElementById("alerts-dynamic-container") ||
        document.querySelector("[data-key='__divider__']");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      window.hasScrolledNext = true;
    }, 800);
  }

  // ── 8. Ícones Lucide ──────────────────────────────────────────────
  if (window.lucide) lucide.createIcons();
};

window.loadMore = function () {
  displayLimit += 10;
  renderList(currentTrainList);
};

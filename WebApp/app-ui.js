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
  let fill = "#3b82f6";
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
  if (typeof occ === "string") {
    for (let c = 0; c < t.carriages; c++) {
      blocks += `<div class="h-[6px] rounded-[2px] transition-all duration-300 ease-out flex-1 bg-blue-500 opacity-90"></div>`;
    }
  } else {
    for (let c = 0; c < t.carriages; c++) {
      blocks += `<div class="h-[6px] rounded-[2px] transition-all duration-300 ease-out flex-1 ${c < filled ? fill : "bg-zinc-300 dark:bg-zinc-700"} opacity-90"></div>`;
    }
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

/** [TRAJETO ANORMAL] Banner inferior do cartão para comboios desviados. */
function _abnormalHtml(t) {
  if (!t.isAbnormalRoute) return "";

  // Usamos os trueOrigin/Dest calculados, com fallback para os nomes formatados antigos caso algo falhe
  const org = t.trueOrigin || t.op;
  const dst = t.trueDest || t.dest;

  return `
    <div class="mt-4 bg-amber-500/10 dark:bg-amber-500/5 backdrop-blur-sm border border-amber-500/30 rounded-xl px-4 py-3 flex items-center gap-3 shadow-sm">
  <div class="shrink-0">
    <i data-lucide="alert-triangle" class="w-5 h-5 text-amber-500"></i>
  </div>
  <div class="flex-1 min-w-0 flex flex-col justify-center pr-2">
    <h3 class="text-xs font-bold text-zinc-800 dark:text-zinc-200 leading-none truncate mb-1">Trajeto Anormal</h3>
    <p class="text-[10px] text-zinc-500 dark:text-zinc-400 leading-tight truncate">
      ${org} <span class="mx-0.5">&rarr;</span> ${dst}
    </p>
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
  const isAlert = ["yellow", "orange", "red"].includes(t.dotStatus);
  const containerCls = isAlert
    ? "flex flex-col items-end gap-2.5"
    : "flex flex-row items-center gap-3";

  return `
    <div class="flex justify-between items-start mb-2">
      <div class="flex flex-col">
        <div class="flex items-center gap-2 mb-1">
          <span data-field="op" class="text-[9px] font-bold px-2 py-0.5 rounded-full border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 text-zinc-500 dark:text-zinc-400 tracking-wider uppercase">${t.dest}</span>
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
    <div class="flex items-start justify-between gap-2 mb-1">
      <div class="flex items-center gap-2 mt-1">
        <div data-field="dot" class="w-1.5 h-1.5 rounded-full ${dotCls}" ${dotStyle}></div>
        <span data-field="status" class="text-[0.65rem] uppercase tracking-wide font-medium ${_statusCls(t)}">${t.status}</span>
      </div>
      
      <div data-field="btn-container" class="${containerCls}">
        <a
          data-field="map-btn"
          data-action="open-map"
          href="/mapa#${t.id}&${fertagusOrigin}&${fertagusDest}"
          class="${t.isLive ? "block" : "hidden"} text-[10px] font-bold text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 transition-colors py-1">
          Ver no Mapa
        </a>

        <button
          data-action="open-details"
          data-train-id="${t.id}"
          class="text-[10px] font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 underline decoration-zinc-300 dark:decoration-zinc-700 underline-offset-2 transition-colors py-1">
          Ver Detalhes
        </button>
      </div>
    </div>
    <div data-field="cars">${_carsHtml(t)}</div>
    <div data-field="occnote">${typeof OccAdvisor !== "undefined" ? OccAdvisor.noteHtml(t) : ""}</div>
    <div data-field="ctx">${_ctxHtml(t)}</div>
    <div data-field="abnormal">${_abnormalHtml(t)}</div>
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

  const btnContainer = el.querySelector("[data-field='btn-container']");
  if (btnContainer) {
    const isAlert = ["yellow", "orange", "red"].includes(t.dotStatus);
    btnContainer.className = isAlert
      ? "flex flex-col items-end gap-2.5"
      : "flex flex-row items-center gap-3";
  }

  const mapBtn = el.querySelector("[data-field='map-btn']");
  if (mapBtn) {
    if (t.isLive) {
      mapBtn.classList.remove("hidden");
      mapBtn.classList.add("block");
      mapBtn.href = `/mapa#${t.id}&${fertagusOrigin}&${fertagusDest}`;
    } else {
      mapBtn.classList.add("hidden");
    }
  }

  const carsEl = el.querySelector("[data-field='cars']");
  if (carsEl) carsEl.innerHTML = _carsHtml(t);

  // Aviso de ocupação: recalculado a cada render, tem de ser repintado aqui
  // ou fica preso ao estado do primeiro desenho do cartão.
  const occEl = el.querySelector("[data-field='occnote']");
  if (occEl) {
    const html =
      typeof OccAdvisor !== "undefined" ? OccAdvisor.noteHtml(t) : "";
    if (occEl.innerHTML !== html) occEl.innerHTML = html;
  }

  const ctxEl = el.querySelector("[data-field='ctx']");
  if (ctxEl) ctxEl.innerHTML = _ctxHtml(t);

  // [TRAJETO ANORMAL]
  const abEl = el.querySelector("[data-field='abnormal']");
  if (abEl) abEl.innerHTML = _abnormalHtml(t);
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
        isAbnormalRoute: false, // [TRAJETO ANORMAL]
        skippedStations: [], //    [TRAJETO ANORMAL]
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
  // A pílula do countdown é o único elemento que desvanece: o cabeçalho
  // aloja agora o botão de refresh e o de filtro, sempre visíveis.
  const pill =
    document.getElementById("next-countdown-pill") ||
    document.getElementById("next-train-header");
  const display = document.getElementById("countdown-display");
  if (!pill || !display) return;

  if (!nextTrainDate) {
    // Torna invisível mas mantém o espaço reservado
    pill.classList.add("opacity-0");
    return;
  }

  const now = new Date();
  let diff = Math.floor((nextTrainDate - now) / 1000);
  if (diff < 0) diff = 0;
  const min = Math.floor(diff / 60);
  const sec = Math.floor((diff % 60) / 10) * 10;
  display.innerText =
    min > 60 ? "+ 1h" : `${min} min ${sec.toString().padStart(2, "0")} s`;

  pill.classList.remove("opacity-0");
};

/**
 * Estado da ligação, agora comunicado pela AURÉOLA à volta do botão de refresh
 * (o antigo ponto + "última atualização" deu lugar ao botão de filtro de hora):
 *   cinzenta → offline / horário estático
 *   verde    → dados em tempo real
 *   amarela  → a API respondeu com erro
 * A hora da última atualização passou para o tooltip do próprio botão.
 */
const AURA_COLORS = {
  offline: { ring: "rgb(161,161,170)", glow: "transparent", live: false },
  success: {
    ring: "rgb(16,185,129)",
    glow: "rgba(16,185,129,0.45)",
    live: true,
  },
  error: {
    ring: "rgb(245,158,11)",
    glow: "rgba(245,158,11,0.45)",
    live: false,
  },
};

window.setStatus = function (s) {
  const ping = document.getElementById("status-ping"); // legado (pode não existir)
  const icon = document.getElementById("refresh-icon-menu");
  const lastUpd = document.getElementById("last-updated"); // legado
  const btn = document.getElementById("btn-manual-refresh");

  const paintAura = (key, title) => {
    if (!btn) return;
    const c = AURA_COLORS[key] || AURA_COLORS.offline;
    btn.style.setProperty("--aura", c.ring);
    btn.style.setProperty("--aura-glow", c.glow);
    btn.classList.toggle("aura-live", c.live);
    btn.setAttribute("title", title);
    btn.setAttribute("aria-label", title);
  };

  if (s === "loading") {
    if (icon) icon.classList.add("animate-spin");
    return; // mantém a cor anterior enquanto carrega
  }

  if (icon) icon.classList.remove("animate-spin");

  if (s === "offline") {
    if (ping)
      ping.className =
        "relative inline-flex h-1.5 w-1.5 rounded-full bg-zinc-500";
    if (lastUpd) lastUpd.innerText = "Offline";
    paintAura(
      "offline",
      typeof TimeFilter !== "undefined" && TimeFilter.isOtherDay()
        ? "Horário programado — sem tempo real"
        : "Offline — a mostrar horário programado",
    );
  } else if (s === "error") {
    if (ping)
      ping.className =
        "relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500";
    if (lastUpd) lastUpd.innerText = "Offline";
    paintAura("error", "A API devolveu um erro — toca para tentar de novo");
  } else {
    // success
    const hora = new Date().toLocaleTimeString("pt-PT").substring(0, 5);
    if (ping)
      ping.className =
        "relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500 dot-ping";
    if (lastUpd) lastUpd.innerText = hora;
    paintAura("success", `Em tempo real · atualizado às ${hora}`);
  }
};

// ═══════════════════════════════════════════════════════════════════════
// CARREGAMENTO DE DADOS
// ═══════════════════════════════════════════════════════════════════════

window.loadData = async function (silent = false) {
  if (isLoading) return;

  // ── FILTRO DE HORA ATIVO ────────────────────────────────────────────
  // A lista passa a vir do horário estático do dia escolhido. Não se toca
  // na API: ela só serve o dia operacional corrente em tempo real.
  // (Com o filtro INATIVO nada disto corre — caminho original intacto.)
  if (typeof TimeFilter !== "undefined" && TimeFilter.isActive()) {
    // Outro dia: a API só serve o dia operacional corrente, por isso a lista
    // vem do horário estático e o estado é forçado a offline.
    if (TimeFilter.isOtherDay()) {
      isLoading = true;
      try {
        renderList(TimeFilter.buildFiltered());
        setStatus("offline");
      } catch (e) {
        console.error("[loadData/filtro]", e);
        setStatus("error");
      } finally {
        isLoading = false;
        if (window.lucide) lucide.createIcons();
      }
      return;
    }
    // Hoje: segue o caminho normal (tempo real incluído) e só se reancora a
    // lista à hora escolhida — não se perde estado nem atrasos em direto.
  }

  isLoading = true;
  if (!silent) setStatus("loading");

  try {
    if (!silent) await new Promise((r) => setTimeout(r, 300));
    const data = await getTrains();

    // erro de rede
    if (data === null) {
      setStatus("offline");
      renderList(
        typeof TimeFilter !== "undefined" && TimeFilter.isActive()
          ? TimeFilter.buildFiltered()
          : buildOfflineTrainList(),
      );
      return;
    }

    // API marcada como em baixo → popup de aviso + lista offline
    if (window.apiIsDown) {
      renderList(
        typeof TimeFilter !== "undefined" && TimeFilter.isActive()
          ? TimeFilter.buildFiltered()
          : buildOfflineTrainList(),
      );
      setStatus("offline");
      showIpDownPopup();
      return;
    }

    await updateAlertsSystem(data);

    // Filtro para hoje: reancora a lista à hora escolhida, preservando os
    // dados em tempo real (estado, atrasos, ocupação) de cada comboio.
    const lista =
      typeof TimeFilter !== "undefined" && TimeFilter.isActive()
        ? TimeFilter.anchor(data)
        : data;
    renderList(lista);

    if (lista.length > 0) setStatus("success");
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
  const pill = document.getElementById("next-countdown-pill");
  if (pill) pill.classList.add("opacity-0");

  // Com filtro de hora ativo, reconstrói para o novo sentido em vez de
  // ir à API (que só serve o dia corrente / tempo real).
  if (typeof TimeFilter !== "undefined" && TimeFilter.isActive()) {
    TimeFilter.refresh();
    return;
  }

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
// PAINEL DE DETALHES — módulo partilhado (detalhes-comboio.js), o mesmo do
// mapa e das páginas das estações. Aqui fica só a tradução do comboio da app
// para o formato do painel.
// ═══════════════════════════════════════════════════════════════════════

const _normEst = (v) =>
  String(v == null ? "" : v)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/-A$/, "")
    .trim();

function _estacaoPorNome(nome) {
  const n = _normEst(nome);
  return FERTAGUS_STATIONS.find((s) => _normEst(s.name) === n) || null;
}

// "HH:MM" → minutos desde a meia-noite.
function _minDe(hhmm) {
  const [h, m] = String(hhmm || "")
    .split(":")
    .map(Number);
  return isFinite(h) && isFinite(m) ? h * 60 + m : null;
}

// Percurso do comboio no formato da API (NodesPassagemComboio), com as
// estações saltadas (trajeto anormal) intercaladas como NaoPassa.
function _nosDoComboio(t) {
  const dirOrder =
    activeTab === "margem"
      ? [...FERTAGUS_STATIONS].reverse()
      : FERTAGUS_STATIONS;
  const skips = (Array.isArray(t.skippedStations) ? t.skippedStations : [])
    .map((sk) => {
      const info = FERTAGUS_STATIONS.find((s) => s.key === sk.key);
      return {
        key: sk.key,
        name: info ? info.name : sk.nome || sk.key,
        hora: sk.hora || "",
        order: dirOrder.findIndex((s) => s.key === sk.key),
      };
    })
    .filter((s) => s.order >= 0)
    .sort((a, b) => a.order - b.order);
  const noSaltado = (sk, passou) => ({
    NaoPassa: true,
    ComboioPassou: !!passou,
    HoraProgramada: sk.hora ? String(sk.hora).substring(0, 5) + ":00" : "",
    HoraPrevista: "",
    NomeEstacao: sk.name,
  });

  // 1) Com dados da API: o percurso real.
  if (t.fullSchedule && t.fullSchedule.length) {
    const out = [];
    let p = 0;
    let passouAnt = false;
    t.fullSchedule.forEach((node) => {
      const st = _estacaoPorNome(node.NomeEstacao);
      const ordem = st ? dirOrder.findIndex((s) => s.key === st.key) : -1;
      while (p < skips.length && ordem >= 0 && skips[p].order < ordem) {
        out.push(noSaltado(skips[p++], passouAnt));
      }
      out.push(node);
      passouAnt = !!node.ComboioPassou;
    });
    while (p < skips.length) out.push(noSaltado(skips[p++], passouAnt));
    return out;
  }

  // 2) Sem API (offline ou comboio futuro): o horário dos JSON. "Já passou"
  // conta a partir da hora na estação de origem escolhida (effectiveDate),
  // o que também serve os comboios de outro dia do filtro de horas.
  const currentDB = activeTab === "lisboa" ? DB_LISBOA : DB_MARGEM;
  const trip =
    currentDB && currentDB.trips
      ? currentDB.trips.find((tr) => tr.id == t.id)
      : null;
  if (!trip) return [];
  const skipKeys = new Map(skips.map((sk) => [sk.key, sk]));
  const base =
    t.effectiveDate instanceof Date ? t.effectiveDate.getTime() : null;
  const baseMin = _minDe(trip[fertagusOrigin] || t.time);
  const agora = Date.now();
  const out = [];
  dirOrder.forEach((st) => {
    const hora = trip[st.key];
    if (!hora) return;
    let passou = false;
    const m = _minDe(hora);
    if (base != null && baseMin != null && m != null) {
      let d = m - baseMin;
      if (d < -720) d += 1440;
      if (d > 720) d -= 1440;
      passou = base + d * 60000 <= agora;
    }
    if (skipKeys.has(st.key)) {
      out.push(noSaltado({ name: st.name, hora }, passou));
      return;
    }
    out.push({
      ComboioPassou: passou,
      HoraProgramada: hora + ":00",
      HoraReal: "HH:MM:SS",
      AtrasoReal: 0,
      HoraPrevista: hora + ":00",
      EstacaoID: st.id,
      NomeEstacao: st.name,
    });
  });
  return out;
}

function _comboioParaPainel(t) {
  if (!t) return null;
  const nodes = _nosDoComboio(t);
  const servidas = nodes.filter((n) => !n.NaoPassa);
  const nomeDe = (n) => {
    if (!n) return null;
    const st = _estacaoPorNome(n.NomeEstacao);
    return st ? st.name : n.NomeEstacao;
  };
  return {
    id: String(t.id),
    numero: t.num || t.id,
    origem: nomeDe(servidas[0]) || t.trueOrigin || "—",
    destino: nomeDe(servidas[servidas.length - 1]) || t.trueDest || t.dest,
    nodes,
    carriages: t.carriages || 4,
    occupancy: t.occupancy,
    dotStatus: t.isOffline ? "gray" : t.dotStatus || "gray",
    statusText: t.status || "",
    live: !!t.isLive,
    isExtra: !!(t.isExtra || t.op === "EXTRA"),
    isSuppressed: !!t.isSuppressed,
    isOffline: !!t.isOffline,
    semMapa: true,
  };
}

let _painelDetalhes = null;

function _getPainel() {
  if (_painelDetalhes) return _painelDetalhes;
  const DC = window.DetalhesComboio;
  if (!DC) return null;
  _painelDetalhes = DC.create({
    panelId: "details-panel",
    backdropId: "details-backdrop",
    autoMount: true,
    zIndex: 60, // acima do cabeçalho fixo (z-50), abaixo do modal iOS (z-100)
    defaultState: "expanded",
    stationName: (apiName) => {
      const st = _estacaoPorNome(apiName);
      return st ? st.name : String(apiName || "").replace(/-A$/, "");
    },
    // Só os comboios em circulação existem no mapa.
    mapUrl: (tr) => (tr.live ? "/mapa#" + encodeURIComponent(tr.id) : null),
    shareUrl: (tr) =>
      tr.live
        ? `${window.location.origin}/mapa#${encodeURIComponent(tr.id)}`
        : window.location.href,
    // A versão mais fresca do comboio, depois de cada actualização da lista.
    getLiveTrain: (id) =>
      _comboioParaPainel(
        (currentTrainList || []).find((tr) => String(tr.id) === String(id)),
      ),
    // As ligações aparecem como no mapa; aqui ainda não abrem nada.
    ligacoes: {
      unavailable: true,
      load: () => DC.carregarLigacoes(),
      list: (nome) => DC.ligacoesDaEstacao(nome),
    },
  });
  return _painelDetalhes;
}

function openDetails(trainId) {
  sa_event("open_details_train");
  const t = currentTrainList.find((tr) => tr.id == trainId);
  if (!t) return;
  const painel = _getPainel();
  if (!painel) return;
  painel.open(_comboioParaPainel(t));
}

function closeDetails() {
  if (_painelDetalhes && _painelDetalhes.isOpen()) _painelDetalhes.close();
}

// Com o painel aberto, cada actualização da lista actualiza-o também.
function _refrescarPainel() {
  if (!_painelDetalhes || !_painelDetalhes.isOpen()) return;
  const id = _painelDetalhes.getCurrentId();
  const t = currentTrainList.find((tr) => String(tr.id) === String(id));
  if (t) _painelDetalhes.refresh(_comboioParaPainel(t));
}

// POPUP "IP EM BAIXO" (+ossilel remover)

let ipPopupDismissed = false;

function showIpDownPopup() {
  // COMUNICADO REMOVIDO.
  // Esta função mostrava um ecrã inteiro com o comunicado sobre o bloqueio da
  // fonte de dados (junho). O tempo real está reposto e o texto ficou
  // desatualizado, pelo que deixou de aparecer.
  //
  // Mantém-se como stub de propósito: continua a ser chamada pelo loadData()
  // e o botão data-action="dismiss-ip-popup" ainda existe na delegação de
  // eventos do app-init.js. Removê-la por completo obrigaria a mexer nesses
  // dois sítios sem ganho nenhum.
  //
  // A app já degrada bem sem ela: sem API, renderiza o horário estático e a
  // auréola do refresh fica cinzenta (ou amarela, se a API devolver erro).
  return;
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

  // ── 1. Lista vazia (erro -> forçar refresh)
  if (!list || !list.length) {
    // anti loop indinito de refresh
    const reloadCount = parseInt(
      sessionStorage.getItem("livetagus_empty_reload") || "0",
      10,
    );
    if (reloadCount < 1) {
      sessionStorage.setItem(
        "livetagus_empty_reload",
        (reloadCount + 1).toString(),
      );
      window.location.reload();
      return;
    }
    sessionStorage.removeItem("livetagus_empty_reload");
    container.querySelectorAll("[data-key]").forEach((el) => el.remove());
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

  // tudo bem agora, limpar contador
  sessionStorage.removeItem("livetagus_empty_reload");

  // ── 2. Índice do próximo comboio ───────────────────────────────────
  let nextIdx = list.findIndex((t) => t.isEffectiveFuture && !t.isSuppressed);
  if (nextIdx === -1 && list.some((t) => !t.isSuppressed))
    nextIdx = list.length - 1;
  if (nextIdx === -1) nextIdx = 0;
  nextTrainDate = list[nextIdx]?.effectiveDate;
  updateNextCountdown();

  // ── 3. Avisos de ocupação ──────────────────────────────────────────
  // Anota o comboio cheio e as alternativas mais confortáveis. A janela
  // visível é esticada para que a alternativa seguinte apareça mesmo que
  // caia para lá do limite de exibição — de nada serve sugeri-la escondida.
  let limit = displayLimit;
  if (typeof OccAdvisor !== "undefined") {
    const adv = OccAdvisor.annotate(list, nextIdx);
    if (adv.laterIdx > -1) limit = Math.max(limit, adv.laterIdx + 1);
  }

  // ── 4. Limite de exibição ──────────────────────────────────────────
  const visibleList = list.slice(0, limit);
  if (list.length > limit) loadMoreBtn.classList.remove("hidden");
  else loadMoreBtn.classList.add("hidden");

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

  // ── 9. Painel de detalhes aberto acompanha a lista ─────────────────
  _refrescarPainel();
};
window.loadMore = function () {
  displayLimit += 10;
  renderList(currentTrainList);
};

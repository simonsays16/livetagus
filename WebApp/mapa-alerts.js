/**
 * mapa-alerts.js
 * Sistema de avisos da página do mapa ao vivo (Fertagus · LiveTagus).
 *
 * Liga o endpoint /avisos (MAPA.ALERTS_URL) ao mapa:
 *   • Botão flutuante por cima da legenda:
 *       - laranja + ícone de aviso  → existe ≥1 aviso (tipo "aviso")
 *       - preto/branco + ícone "i"  → só existem informações
 *       - escondido                 → não há nada
 *   • Popup central (scroll + setas ↑/↓) com todos os avisos/informações.
 *   • Modo de Manutenção: enquanto a API marcar manutenção, o mapa fica
 *     PROIBIDO de pedir ao /fertagus (a API alucina nesse período). Mostra
 *     um popup bloqueante com o texto da manutenção e dois botões:
 *       - "Mapa Offline"      → força o mapa para modo offline (horários)
 *       - "Horários Offline"  → navega para /horarios
 *
 * Depende de: mapa-config.js (MAPA.ALERTS_URL, MAPA.HORARIOS_URL, …)
 * Coordena-se com mapa.js via callbacks (onEnterOffline / onForceOffline /
 * onExitOffline) — este módulo nunca toca diretamente no /fertagus.
 */

(function () {
  "use strict";

  // ─── ÍCONES (SVG inline → independentes do set de ícones) ────────────
  const SVG = {
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    chevronUp:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
    chevronDown:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    external:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>',
    serverCrash:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 10H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M6 14H4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-2"/><path d="M6 6h.01"/><path d="M6 18h.01"/><path d="m13 6-4 6h6l-4 6"/></svg>',
  };

  // ─── ESTADO ──────────────────────────────────────────────────────────
  let cb = {};
  let state = { alerts: [], mode: null, maintenance: false };
  let pollId = null;
  let bound = false;
  let escHandler = null;
  let keyNavHandler = null;

  // ─── HELPERS ─────────────────────────────────────────────────────────
  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function parseDatePT(str) {
    if (!str || typeof str !== "string" || !str.includes("/")) return null;
    const parts = str.trim().split(" ");
    const dmy = parts[0].split("/");
    if (dmy.length < 3) return null;
    const d = parseInt(dmy[0], 10);
    const m = parseInt(dmy[1], 10);
    const y = parseInt(dmy[2], 10);
    if (!d || !m || !y) return null;
    const date = new Date(y, m - 1, d);
    if (parts[1]) {
      const t = parts[1].split(":");
      date.setHours(parseInt(t[0] || 0, 10), parseInt(t[1] || 0, 10), 0, 0);
    } else {
      date.setHours(0, 0, 0, 0);
    }
    return isNaN(date.getTime()) ? null : date;
  }

  function isMaintenanceActive(mode) {
    if (!mode || typeof mode !== "object") return false;
    const flag = [mode.maintance, mode.maintenance].some(
      (v) => v === true || String(v).toLowerCase() === "true",
    );
    let within = false;
    const s = parseDatePT(mode.datainicio);
    const e = parseDatePT(mode.datafim);
    if (s && e) {
      const now = new Date();
      within = now >= s && now <= e;
    }
    return flag || within;
  }

  // ─── FETCH ───────────────────────────────────────────────────────────
  async function fetchAvisos() {
    try {
      const res = await fetch(MAPA.ALERTS_URL + "?t=" + Date.now(), {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const mode = data && data.mode ? data.mode : null;
      const alerts = [];
      for (const k in data) {
        if (k === "mode") continue;
        const v = data[k];
        if (v && typeof v === "object" && (v.nome || v.mensagem)) {
          alerts.push(v);
        }
      }
      // Avisos primeiro, informações depois.
      alerts.sort((a, b) => {
        const aw = a.tipo === "aviso" ? 0 : 1;
        const bw = b.tipo === "aviso" ? 0 : 1;
        return aw - bw;
      });
      return { alerts, mode };
    } catch (e) {
      console.warn("[MapaAlerts] /avisos indisponível:", e.message);
      return { alerts: [], mode: null };
    }
  }

  // ─── BOTÃO FLUTUANTE ─────────────────────────────────────────────────
  function renderButton() {
    const btn = document.getElementById("btn-alerts");
    if (!btn) return;

    const total = state.alerts.length;
    if (total === 0) {
      btn.classList.add("lt-hidden");
      btn.setAttribute("aria-hidden", "true");
      btn.innerHTML = "";
      return;
    }

    const avisos = state.alerts.filter((a) => a.tipo === "aviso").length;
    const hasAviso = avisos > 0;

    btn.classList.remove("lt-hidden");
    btn.removeAttribute("aria-hidden");
    btn.classList.toggle("lt-state-aviso", hasAviso);
    btn.setAttribute(
      "aria-label",
      hasAviso ? "Ver avisos importantes" : "Ver informações",
    );

    const badge =
      hasAviso && avisos > 0
        ? `<span class="lt-alert-badge">${avisos}</span>`
        : "";
    btn.innerHTML = (hasAviso ? SVG.warn : SVG.info) + badge;
  }

  // ─── POPUP DE AVISOS ─────────────────────────────────────────────────
  function buildItem(alert) {
    const isAviso = alert.tipo === "aviso";
    const item = el(
      "div",
      "lt-item " + (isAviso ? "lt-item--aviso" : "lt-item--info"),
    );

    const icon = el("div", "lt-item-icon", isAviso ? SVG.warn : SVG.info);

    const main = el("div", "lt-item-main");

    const top = el("div", "lt-item-top");
    const title = el("h3", "lt-item-title");
    title.textContent = alert.nome || (isAviso ? "Aviso" : "Informação");
    top.appendChild(title);
    if (alert.origem && String(alert.origem).trim() !== "") {
      const chip = el("span", "lt-item-origem");
      chip.textContent = alert.origem;
      top.appendChild(chip);
    }
    main.appendChild(top);

    const msg = el("p", "lt-item-msg", alert.mensagem || "");
    // Liga os <a> embebidos na mensagem em separador novo e estiliza-os.
    msg.querySelectorAll("a").forEach((a) => {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });
    main.appendChild(msg);

    const link = alert.link && alert.link !== "#" ? alert.link : null;
    if (link) {
      const txt =
        alert.textolink && alert.textolink.trim() ? alert.textolink : "Ver";
      const action = el("a", "lt-item-action center", txt + " " + SVG.external);
      action.href = link;
      action.target = "_blank";
      action.rel = "noopener noreferrer";
      main.appendChild(action);
    }

    item.appendChild(icon);
    item.appendChild(main);
    return item;
  }

  function closeModal() {
    const backdrop = document.getElementById("lt-alerts-backdrop");
    if (!backdrop) return;
    backdrop.classList.remove("lt-open");
    if (escHandler) {
      document.removeEventListener("keydown", escHandler);
      escHandler = null;
    }
    if (keyNavHandler) {
      document.removeEventListener("keydown", keyNavHandler);
      keyNavHandler = null;
    }
    setTimeout(() => backdrop.remove(), 260);
  }

  function openModal() {
    if (state.alerts.length === 0) return;
    if (document.getElementById("lt-alerts-backdrop")) return;

    const hasAviso = state.alerts.some((a) => a.tipo === "aviso");

    const backdrop = el("div", "lt-modal-backdrop");
    backdrop.id = "lt-alerts-backdrop";

    const modal = el("div", "lt-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", hasAviso ? "Avisos" : "Informações");

    // Header
    const head = el("div", "lt-modal-head");
    head.appendChild(
      el(
        "span",
        "lt-modal-head-icon " + (hasAviso ? "lt-tone-aviso" : "lt-tone-info"),
        hasAviso ? SVG.warn : SVG.info,
      ),
    );
    const titleTxt = hasAviso ? "Avisos" : "Informações";
    head.appendChild(el("span", "lt-modal-title", titleTxt));
    const closeBtn = el("button", "lt-modal-close", SVG.x);
    closeBtn.setAttribute("aria-label", "Fechar");
    closeBtn.addEventListener("click", closeModal);
    head.appendChild(closeBtn);

    // Body
    const body = el("div", "lt-modal-body");
    body.setAttribute("data-lt-scroll", "");
    state.alerts.forEach((a) => body.appendChild(buildItem(a)));

    // Footer (setas ↑/↓ — só visível quando há overflow)
    const foot = el("div", "lt-modal-foot");
    const upBtn = el("button", "lt-nav-btn", SVG.chevronUp);
    upBtn.setAttribute("aria-label", "Para cima");
    const downBtn = el("button", "lt-nav-btn", SVG.chevronDown);
    downBtn.setAttribute("aria-label", "Para baixo");
    foot.appendChild(upBtn);
    foot.appendChild(downBtn);

    modal.appendChild(head);
    modal.appendChild(body);
    modal.appendChild(foot);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    // Scroll helpers
    const step = () => Math.max(120, Math.round(body.clientHeight * 0.8));
    const syncNav = () => {
      const scrollable = body.scrollHeight - body.clientHeight > 2;
      modal.classList.toggle("lt-scrollable", scrollable);
      upBtn.disabled = body.scrollTop <= 1;
      downBtn.disabled =
        body.scrollTop >= body.scrollHeight - body.clientHeight - 1;
    };
    upBtn.addEventListener("click", () =>
      body.scrollBy({ top: -step(), behavior: "smooth" }),
    );
    downBtn.addEventListener("click", () =>
      body.scrollBy({ top: step(), behavior: "smooth" }),
    );
    body.addEventListener("scroll", syncNav, { passive: true });

    // Fechar: backdrop + Esc
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeModal();
    });
    escHandler = (e) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", escHandler);

    // Navegação por teclado ↑/↓
    keyNavHandler = (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        body.scrollBy({ top: step(), behavior: "smooth" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        body.scrollBy({ top: -step(), behavior: "smooth" });
      }
    };
    document.addEventListener("keydown", keyNavHandler);

    // Animar entrada
    requestAnimationFrame(() => {
      backdrop.classList.add("lt-open");
      syncNav();
    });
  }

  // ─── POPUP DE MANUTENÇÃO ─────────────────────────────────────────────
  function showMaintenance(mode) {
    if (document.getElementById("lt-maint")) return;
    const m = mode || {};

    const overlay = el("div", "lt-maint");
    overlay.id = "lt-maint";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const inner = el("div", "lt-maint-inner");
    inner.appendChild(el("div", "lt-maint-icon", SVG.serverCrash));

    const title = el("h1", "lt-maint-title");
    title.textContent = m.titulo || "Manutenção";
    inner.appendChild(title);

    inner.appendChild(el("div", "lt-maint-text", m.texto || ""));

    const actions = el("div", "lt-maint-actions");

    const offlineBtn = el("button", "lt-maint-btn lt-maint-btn--primary");
    offlineBtn.type = "button";
    offlineBtn.textContent = "Mapa Offline";
    offlineBtn.addEventListener("click", () => {
      hideMaintenance();
      if (typeof cb.onForceOffline === "function") cb.onForceOffline();
    });
    actions.appendChild(offlineBtn);

    const horariosBtn = el("a", "lt-maint-btn lt-maint-btn--ghost");
    horariosBtn.href = (MAPA && MAPA.HORARIOS_URL) || "./horarios";
    horariosBtn.textContent = "Horários Offline";
    actions.appendChild(horariosBtn);

    inner.appendChild(actions);
    overlay.appendChild(inner);
    document.body.appendChild(overlay);

    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => overlay.classList.add("lt-open"));
  }

  function hideMaintenance() {
    const overlay = document.getElementById("lt-maint");
    if (!overlay) return;
    overlay.classList.remove("lt-open");
    document.body.style.overflow = "";
    setTimeout(() => overlay.remove(), 500);
  }

  // ─── CICLO DE ATUALIZAÇÃO ────────────────────────────────────────────
  async function refresh() {
    const { alerts, mode } = await fetchAvisos();
    state.alerts = alerts;
    state.mode = mode;

    const wasMaint = state.maintenance;
    state.maintenance = isMaintenanceActive(mode);

    renderButton();

    if (state.maintenance && !wasMaint) {
      // Entra em manutenção → bloqueia /fertagus e mostra popup.
      if (typeof cb.onEnterOffline === "function") cb.onEnterOffline();
      showMaintenance(mode);
    } else if (!state.maintenance && wasMaint) {
      // Saiu da manutenção → retoma o modo ao vivo.
      hideMaintenance();
      if (typeof cb.onExitOffline === "function") cb.onExitOffline();
    } else if (state.maintenance && wasMaint) {
      // Continua em manutenção: atualiza o texto se o popup estiver aberto.
      const txt = document.querySelector("#lt-maint .lt-maint-text");
      const ttl = document.querySelector("#lt-maint .lt-maint-title");
      if (txt && mode) txt.innerHTML = mode.texto || "";
      if (ttl && mode) ttl.textContent = mode.titulo || "Manutenção";
    }

    return state.maintenance;
  }

  function startPolling() {
    if (pollId) return;
    const ms = (MAPA && MAPA.ALERTS_REFRESH_MS) || 90_000;
    pollId = setInterval(refresh, ms);
  }

  function stopPolling() {
    if (pollId) {
      clearInterval(pollId);
      pollId = null;
    }
  }

  // ─── INIT ────────────────────────────────────────────────────────────
  async function init(callbacks) {
    cb = callbacks || {};

    const btn = document.getElementById("btn-alerts");
    if (btn && !bound) {
      bound = true;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openModal();
      });
    }

    // Primeiro fetch — síncrono o suficiente para o mapa decidir o modo
    // antes do primeiro pedido ao /fertagus.
    await refresh();
    startPolling();

    // Pausa/retoma o polling com a visibilidade do separador.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopPolling();
      } else {
        refresh();
        startPolling();
      }
    });

    return { maintenance: state.maintenance };
  }

  // ─── EXPORT ──────────────────────────────────────────────────────────
  window.MapaAlerts = {
    init,
    refresh,
    openModal,
    closeModal,
    isMaintenance: () => state.maintenance,
    getAlerts: () => state.alerts.slice(),
    _parseDatePT: parseDatePT,
    _isMaintenanceActive: isMaintenanceActive,
  };
})();

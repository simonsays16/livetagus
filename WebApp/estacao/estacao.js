/**
 * estacao/estacao.js
 * Página de detalhe de uma estação Fertagus.
 *
 * v3 (2026-06): as PARTIDAS passaram para o módulo PARTILHADO window.Partidas
 * (partidas.js), o mesmo usado no modal do mapa. Esta página fica responsável
 * por: routing/resolução da estação, cabeçalho, separadores, bloco de AVISOS,
 * separador de LIGAÇÕES (intermodais) e o menu de ferramentas. O separador
 * Fertagus apenas monta o Partidas no seu contentor.
 *
 * Comportamento de clique no comboio (gerido pelo Partidas):
 *   1. Ao vivo            → /mapa#{id-comboio}
 *   2. Extra, não-vivo    → /fertagus (percurso real)
 *   3. Normal, não-vivo   → JSON de horários (percurso programado)
 *
 * Edge cases (manutenção, IP/API offline, modo offline, trajetos anormais)
 * são tratados dentro do Partidas.
 */

(function () {
  "use strict";

  // ═══ CONFIGURAÇÃO ═════════════════════════════════════════════════════
  const API_AVISOS = "https://api.livetagus.pt/avisos/";
  const PATH_LIGACOES = "/json/ligacoes_atualizado.json";

  // ═══ ESTAÇÕES ═════════════════════════════════════════════════════════
  const STATIONS = [
    { key: "setubal", name: "Setúbal", apiName: "SETÚBAL", apiId: 9468122 },
    { key: "palmela", name: "Palmela", apiName: "PALMELA", apiId: 9468098 },
    {
      key: "venda_do_alcaide",
      name: "Venda do Alcaide",
      apiName: "VENDA DO ALCAIDE",
      apiId: 9468049,
    },
    {
      key: "pinhal_novo",
      name: "Pinhal Novo",
      apiName: "PINHAL NOVO",
      apiId: 9468007,
    },
    { key: "penalva", name: "Penalva", apiName: "PENALVA", apiId: 9417095 },
    { key: "coina", name: "Coina", apiName: "COINA", apiId: 9417236 },
    {
      key: "fogueteiro",
      name: "Fogueteiro",
      apiName: "FOGUETEIRO",
      apiId: 9417186,
    },
    {
      key: "foros_de_amora",
      name: "Foros de Amora",
      apiName: "FOROS DE AMORA",
      apiId: 9417152,
    },
    { key: "corroios", name: "Corroios", apiName: "CORROIOS", apiId: 9417137 },
    { key: "pragal", name: "Pragal", apiName: "PRAGAL", apiId: 9417087 },
    {
      key: "campolide",
      name: "Campolide",
      apiName: "CAMPOLIDE",
      apiId: 9467033,
    },
    {
      key: "sete_rios",
      name: "Sete Rios",
      apiName: "SETE RIOS",
      apiId: 9466076,
    },
    {
      key: "entrecampos",
      name: "Entrecampos",
      apiName: "ENTRECAMPOS",
      apiId: 9466050,
    },
    {
      key: "roma_areeiro",
      name: "Roma-Areeiro",
      apiName: "ROMA-AREEIRO",
      apiId: 9466035,
    },
  ];

  const OPERATORS = [
    {
      key: "cm",
      label: "Carris Metropolitana",
      icon: "bus",
      interactive: true,
    },
    {
      key: "mts",
      label: "MTS · Metro Transportes do Sul",
      icon: "train-front-tunnel",
    },
    { key: "cp", label: "CP · Comboios de Portugal", icon: "train-track" },
    { key: "metro", label: "Metro de Lisboa", icon: "train-front-tunnel" },
    { key: "carris", label: "Carris", icon: "bus" },
    { key: "tcb", label: "TCB · Barreiro", icon: "bus" },
    { key: "re", label: "Rede Expresso", icon: "bus" },
  ];

  // ═══ HELPERS ══════════════════════════════════════════════════════════
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function normalize(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }
  function parseDatePT(str) {
    if (!str || typeof str !== "string" || !str.includes("/")) return null;
    const parts = str.trim().split(" ");
    const [d, m, y] = parts[0].split("/");
    const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    if (parts[1]) {
      const [hh, mm] = parts[1].split(":");
      date.setHours(parseInt(hh) || 0, parseInt(mm) || 0, 0, 0);
    } else {
      date.setHours(0, 0, 0, 0);
    }
    return date;
  }

  // ═══ ESTADO ═══════════════════════════════════════════════════════════
  const state = {
    station: null,
    activeTab: "fertagus",
    ligacoesData: {},
    avisos: [],
    avisoIdx: 0,
    cmDropdownOpen: false,
    cmFetched: new Map(),
    partidasCtrl: null,
  };

  // ═══ LOADERS ══════════════════════════════════════════════════════════
  async function loadJson(path) {
    try {
      const res = await fetch(path);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }
  async function loadLigacoes() {
    state.ligacoesData = (await loadJson(PATH_LIGACOES)) || {};
  }
  async function loadAvisos() {
    try {
      const res = await fetch(API_AVISOS + "?t=" + Date.now());
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.mode) delete data.mode;
      const all = Object.values(data || {});
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const filtered = all.filter((a) => {
        if (!a || (!a.nome && !a.mensagem)) return false;
        if (a.datainicio && a.datainicio.trim()) {
          const start = parseDatePT(a.datainicio);
          if (start && now < start) return false;
        }
        if (a.datafim && a.datafim.trim()) {
          const end = parseDatePT(a.datafim);
          if (end && now > end) return false;
        }
        return true;
      });
      const rank = (t) => (t === "aviso" ? 0 : 1);
      const numId = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
      };
      filtered.sort((a, b) => {
        const r = rank(a.tipo) - rank(b.tipo);
        if (r !== 0) return r;
        const ai = numId(a.id);
        const bi = numId(b.id);
        if (ai !== bi) return ai - bi;
        return String(a.id || "").localeCompare(String(b.id || ""));
      });
      state.avisos = filtered;
    } catch (e) {
      state.avisos = [];
    }
  }

  // ═══ RENDER: HEADER ═══════════════════════════════════════════════════
  function renderHeader() {
    const el = document.getElementById("stn-header");
    if (!el || !state.station) return;
    const station = state.station;
    el.innerHTML = `
      <div class="max-w-3xl mx-auto fade-in">
        <!--<p class="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-400 dark:text-zinc-500 mb-3">
          Estação Fertagus
        </p>-->
        <h1 class="text-4xl md:text-6xl">${escapeHtml(station.name)}</h1>
        <div class="w-10 h-[2px] bg-zinc-900 dark:bg-white mt-4"></div>
      </div>`;
  }

  // ═══ RENDER: TABS ═════════════════════════════════════════════════════
  function renderTabs() {
    const el = document.getElementById("stn-tabs");
    if (!el) return;
    el.innerHTML = `
      <button class="stn-tab" role="tab" data-tab="fertagus" aria-selected="${state.activeTab === "fertagus"}">Fertagus</button>
      <button class="stn-tab" role="tab" data-tab="ligacoes" aria-selected="${state.activeTab === "ligacoes"}">Ligações</button>`;
    el.querySelectorAll(".stn-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        if (tab === state.activeTab) return;
        state.activeTab = tab;

        const urlTabValue = tab === "fertagus" ? "partidas" : "ligacoes";
        // evento para o Simple Analytics
        if (typeof window.sa_event === "function") {
          window.sa_event(`click_tab_${urlTabValue}`);
        }
        // Atualizar endereço
        const url = new URL(window.location);
        url.searchParams.set("tab", urlTabValue);
        window.history.pushState({ tab: state.activeTab }, "", url.toString());

        renderTabs();
        renderContent();
      });
    });
  }

  // ═══ RENDER: CONTENT ROUTER ═══════════════════════════════════════════
  function renderContent() {
    const el = document.getElementById("stn-content");
    if (!el) return;

    // Ao sair do separador Fertagus, destrói o controlador do Partidas.
    if (state.activeTab !== "fertagus" && state.partidasCtrl) {
      try {
        state.partidasCtrl.destroy();
      } catch (_) {}
      state.partidasCtrl = null;
    }

    if (state.activeTab === "fertagus") renderFertagusTab(el);
    else renderLigacoesTab(el);

    const footnote = document.getElementById("stn-footnote");
    if (footnote) footnote.classList.remove("hidden");
    if (window.lucide) window.lucide.createIcons();
  }

  // ═══ RENDER: FERTAGUS TAB (avisos + Partidas partilhado) ══════════════
  function renderFertagusTab(container) {
    container.innerHTML = `
      <div id="stn-avisos">${renderAvisosBlock()}</div>
      <div id="stn-departures"></div>`;
    attachAvisoListeners(container);

    const host = document.getElementById("stn-departures");
    if (state.partidasCtrl) {
      try {
        state.partidasCtrl.destroy();
      } catch (_) {}
      state.partidasCtrl = null;
    }
    if (host && window.Partidas) {
      state.partidasCtrl = window.Partidas.mount({
        container: host,
        station: {
          apiId: state.station.apiId,
          key: state.station.key,
          name: state.station.name,
        },
        context: "page",
        autoRefresh: 30000,
        detectMaintenance: true,
        // Caso 1 (ao vivo) — default do Partidas: navega para /mapa#{id}.
      });
    }
    if (window.lucide) window.lucide.createIcons();
  }

  // ═══ RENDER: AVISOS (SLIDER) ══════════════════════════════════════════
  function renderAvisosBlock() {
    const list = state.avisos || [];
    if (list.length === 0) return "";
    if (state.avisoIdx >= list.length || state.avisoIdx < 0) state.avisoIdx = 0;

    const slides = list
      .map((a) => {
        const tipo = a.tipo === "aviso" ? "aviso" : "info";
        const icon = a.icon || (tipo === "aviso" ? "alert-triangle" : "info");
        const iconColor = tipo === "aviso" ? "text-amber-500" : "text-blue-500";
        let link = "";
        if (a.link && a.link !== "#" && a.link.trim()) {
          link = `
            <a href="${escapeHtml(a.link)}" target="_blank" rel="noopener" class="aviso-cta">
              ${escapeHtml(a.textolink || "Ver")}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </a>`;
        }
        return `
          <div class="aviso-slide">
            <div class="alert-card" data-type="${tipo}">
              <i data-lucide="${escapeHtml(icon)}" class="w-4 h-4 shrink-0 mt-0.5 ${iconColor} stroke-[1.6]"></i>
              <div class="min-w-0 flex-1">
                <p class="text-[11px] font-bold uppercase tracking-wider leading-tight mb-1 text-zinc-900 dark:text-zinc-100">
                  ${escapeHtml(a.nome || "")}
                </p>
                <p class="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">${a.mensagem || ""}</p>
                ${link}
              </div>
            </div>
          </div>`;
      })
      .join("");

    const dots = list
      .map(
        (_, i) =>
          `<button class="aviso-dot${i === state.avisoIdx ? " active" : ""}" data-aviso-dot="${i}" aria-label="Aviso ${i + 1}"></button>`,
      )
      .join("");

    const showNav = list.length > 1;
    const navHtml = showNav
      ? `
        <div class="aviso-nav">
          <div class="aviso-dots">${dots}</div>
          <div class="aviso-arrows">
            <span class="aviso-counter" data-aviso-counter>${state.avisoIdx + 1}/${list.length}</span>
            <button class="aviso-arrow" data-aviso-prev aria-label="Aviso anterior">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button class="aviso-arrow" data-aviso-next aria-label="Próximo aviso">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>`
      : "";

    return `
      <div class="aviso-slider fade-in">
        <div class="aviso-track" data-aviso-track>
          <div class="aviso-rail" data-aviso-rail style="transform:translateX(-${state.avisoIdx * 100}%)">
            ${slides}
          </div>
        </div>
        ${navHtml}
      </div>`;
  }

  function attachAvisoListeners(container) {
    const list = state.avisos || [];
    if (list.length <= 1) return;
    const rail = container.querySelector("[data-aviso-rail]");
    const track = container.querySelector("[data-aviso-track]");
    if (!rail || !track) return;

    const updateUi = () => {
      rail.style.transform = `translateX(-${state.avisoIdx * 100}%)`;
      container
        .querySelectorAll("[data-aviso-dot]")
        .forEach((d) =>
          d.classList.toggle(
            "active",
            Number(d.dataset.avisoDot) === state.avisoIdx,
          ),
        );
      const counter = container.querySelector("[data-aviso-counter]");
      if (counter) counter.textContent = `${state.avisoIdx + 1}/${list.length}`;
    };
    const go = (i) => {
      const n = list.length;
      state.avisoIdx = ((i % n) + n) % n;
      updateUi();
    };

    const prevBtn = container.querySelector("[data-aviso-prev]");
    const nextBtn = container.querySelector("[data-aviso-next]");
    if (prevBtn)
      prevBtn.addEventListener("click", () => go(state.avisoIdx - 1));
    if (nextBtn)
      nextBtn.addEventListener("click", () => go(state.avisoIdx + 1));
    container
      .querySelectorAll("[data-aviso-dot]")
      .forEach((d) =>
        d.addEventListener("click", () => go(Number(d.dataset.avisoDot))),
      );

    let startX = null,
      startY = null,
      swiping = false;
    track.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length !== 1) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        swiping = true;
      },
      { passive: true },
    );
    track.addEventListener(
      "touchmove",
      (e) => {
        if (!swiping || startX == null) return;
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;
        if (Math.abs(dy) > Math.abs(dx)) swiping = false;
      },
      { passive: true },
    );
    track.addEventListener(
      "touchend",
      (e) => {
        if (!swiping || startX == null) return;
        const dx = (e.changedTouches[0]?.clientX ?? startX) - startX;
        swiping = false;
        startX = null;
        startY = null;
        if (Math.abs(dx) < 40) return;
        go(dx < 0 ? state.avisoIdx + 1 : state.avisoIdx - 1);
      },
      { passive: true },
    );
  }

  // ═══ RENDER: LIGAÇÕES TAB ═════════════════════════════════════════════
  function renderLigacoesTab(container) {
    const stationData = state.ligacoesData[String(state.station.apiId)];
    const ligacoes = stationData ? stationData.ligacoes || {} : {};

    let html = "";
    let hasAny = false;

    for (const op of OPERATORS) {
      const items = ligacoes[op.key];
      if (!items || items.length === 0) continue;
      hasAny = true;

      let logoImg = "";
      if (op.key === "cm") {
        logoImg = `
          <img src="/imagens/lig-logos/cm-light.svg" alt="Logo ${escapeHtml(op.label)}" class="w-4 h-4 object-contain shrink-0 cm-light" />
          <img src="/imagens/lig-logos/cm-dark.svg" alt="Logo ${escapeHtml(op.label)}" class="w-4 h-4 object-contain shrink-0 cm-dark" />`;
      } else {
        logoImg = `<img src="/imagens/lig-logos/${escapeHtml(op.key)}.svg" alt="Logo ${escapeHtml(op.label)}" class="w-4 h-4 object-contain shrink-0" />`;
      }

      html += `
        <section class="op-section fade-in">
          <div class="mb-4">
            <span class="op-pill">${logoImg}${escapeHtml(op.label)}</span>
          </div>
          ${op.interactive ? renderCMStops(items) : renderInfoLines(items, op.label, op.key, state.station.apiId)}
        </section>`;
    }

    if (!hasAny) {
      html = `
        <div class="py-16 text-center fade-in">
          <i data-lucide="map-pin-off" class="w-9 h-9 text-zinc-300 dark:text-zinc-700 mx-auto mb-5 stroke-[1.2]"></i>
          <p class="text-[11px] uppercase tracking-[0.25em] text-zinc-400 font-bold">Sem ligações disponíveis</p>
          <p class="text-[11px] text-zinc-400 dark:text-zinc-600 mt-3 font-light max-w-xs mx-auto">
            Esta estação ainda não tem ligações intermodais registadas.
          </p>
        </div>`;
    }

    container.innerHTML = html;
    attachCMListeners(container);
  }

  function renderInfoLines(items, opLabel, opKey, stationApiId) {
    const lines = items.filter((i) => i && i.line);

    let rowsHtml = "";
    if (lines.length === 0) {
      rowsHtml = `
        <div class="info-line text-zinc-400">
          <i data-lucide="check" class="w-3 h-3 text-zinc-300 dark:text-zinc-700 shrink-0"></i>
          <span>Ligação disponível</span>
        </div>`;
    } else {
      rowsHtml = lines
        .map(
          (l) => `
            <div class="info-line">
              <i data-lucide="arrow-right" class="w-3 h-3 text-zinc-300 dark:text-zinc-700 shrink-0"></i>
              <span>${escapeHtml(l.line)}</span>
            </div>`,
        )
        .join("");
    }

    let cpButton = "";
    if (opKey === "cp" && stationApiId) {
      const explicitCode = items.find((i) => i && i.code)?.code;
      const cpId =
        explicitCode || String(stationApiId).replace(/^(\d{2})(\d+)/, "$1-$2");
      const cpLink = `https://www.cp.pt/pt/pesquisa-estacao-detalhe/${cpId}`;
      cpButton = `
        <a href="${cpLink}" target="_blank" rel="noopener" class="w-full flex items-center justify-between px-5 py-3 text-[10px] uppercase tracking-[0.2em] font-bold text-[#388344] hover:opacity-75 border-b border-zinc-100 dark:border-zinc-800 transition-opacity">
          <span class="flex items-center gap-2.5">
            <span class="w-3.5 h-3.5"></span>
            Ver Tempo Real CP
            <span class="fixed w-2 h-2 bg-[#388344] rounded-full animate-ping"></span>
            <span class="fixed w-2 h-2 bg-[#388344] rounded-full"></span>
          </span>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-external-link"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
        </a>`;
    }

    return `<div class="op-card">${cpButton}${rowsHtml}</div>`;
  }

  function renderCMStops(stops) {
    const arr = Array.isArray(stops) ? stops : [];
    if (arr.length === 0) return "";

    const stopsHtml = arr.map((stop) => renderCMSingleStop(stop)).join("");
    if (arr.length <= 2) return stopsHtml;

    const total = arr.length;
    return `
      <div class="cm-dropdown">
        <button class="cm-dropdown-toggle" data-cm-dropdown-toggle aria-expanded="${state.cmDropdownOpen ? "true" : "false"}">
          <div class="flex-1 min-w-0">
            <p class="text-[11px] font-bold uppercase tracking-wider text-zinc-900 dark:text-white leading-snug mb-1">
              ${total} paragens próximas
            </p>
            <p class="text-[9px] font-mono tracking-wider text-zinc-400">Carris Metropolitana</p>
          </div>
          <i data-lucide="chevron-down" class="w-4 h-4 text-zinc-400 chevron shrink-0${state.cmDropdownOpen ? " rotated" : ""}"></i>
        </button>
        <div class="cm-dropdown-body${state.cmDropdownOpen ? " open" : ""}" data-cm-dropdown-body>
          ${stopsHtml}
        </div>
      </div>`;
  }

  function renderCMSingleStop(stop) {
    const uniq = [];
    const seen = new Set();
    for (const l of stop.lines || []) {
      if (l && l["line-id"] && !seen.has(l["line-id"])) {
        seen.add(l["line-id"]);
        uniq.push(l);
      }
    }
    const pills = uniq
      .map((l) => {
        const color = l["route-color"] || "#111";
        return `<span class="line-pill" style="background:${color}">${escapeHtml(l["line-name"])}</span>`;
      })
      .join(" ");

    const gmaps = stop.gmapslink
      ? `<a href="${escapeHtml(stop.gmapslink)}" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 mt-3 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">
          <i data-lucide="map-pin" class="w-3 h-3"></i>
          Abrir no Maps
        </a>`
      : "";

    return `
      <div class="op-card">
        <button class="op-toggle" data-cm-stop="${escapeHtml(stop.id)}">
          <div class="flex-1 min-w-0">
            <p class="text-[11px] font-bold uppercase tracking-wider text-zinc-900 dark:text-white leading-snug mb-1">
              ${escapeHtml(stop.name)}
            </p>
            <p class="text-[9px] font-mono tracking-wider text-zinc-400 mb-2">Paragem #${escapeHtml(stop.id)}</p>
            <div class="flex flex-wrap gap-1.5">${pills}</div>
            ${gmaps}
          </div>
          <i data-lucide="chevron-down" class="w-4 h-4 text-zinc-400 chevron shrink-0 mt-1" data-cm-chevron="${escapeHtml(stop.id)}"></i>
        </button>
        <div class="arrivals-panel" data-cm-panel="${escapeHtml(stop.id)}">
          <div data-cm-content="${escapeHtml(stop.id)}"></div>
        </div>
      </div>`;
  }

  function attachCMListeners(container) {
    container.querySelectorAll("[data-cm-dropdown-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const body = container.querySelector("[data-cm-dropdown-body]");
        const chev = btn.querySelector(".chevron");
        if (!body) return;
        const willOpen = !body.classList.contains("open");
        body.classList.toggle("open", willOpen);
        if (chev) chev.classList.toggle("rotated", willOpen);
        btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
        state.cmDropdownOpen = willOpen;
      });
    });

    container.querySelectorAll("[data-cm-stop]").forEach((btn) => {
      const stopId = btn.dataset.cmStop;
      btn.addEventListener("click", () => {
        const panel = container.querySelector(
          `[data-cm-panel="${CSS.escape(stopId)}"]`,
        );
        const chev = container.querySelector(
          `[data-cm-chevron="${CSS.escape(stopId)}"]`,
        );
        if (!panel) return;
        const open = panel.classList.contains("open");
        if (open) {
          panel.classList.remove("open");
          if (chev) chev.classList.remove("rotated");
        } else {
          panel.classList.add("open");
          if (chev) chev.classList.add("rotated");
          if (!state.cmFetched.has(stopId)) {
            state.cmFetched.set(stopId, true);
            renderCMSkeleton(stopId, container);
            fetchCMArrivals(stopId, container);
          }
        }
      });
    });
  }

  function renderCMSkeleton(stopId, container) {
    const target = container.querySelector(
      `[data-cm-content="${CSS.escape(stopId)}"]`,
    );
    if (!target) return;
    let html = "";
    for (let i = 0; i < 4; i++) {
      html += `
        <div class="arrival-row">
          <div class="flex items-center gap-3 flex-1 min-w-0">
            <span class="skel" style="width:42px;height:20px;border-radius:3px"></span>
            <span class="skel" style="width:55%;height:11px"></span>
          </div>
          <span class="skel" style="width:42px;height:11px"></span>
        </div>`;
    }
    target.innerHTML = html;
  }

  async function fetchCMArrivals(stopId, container) {
    const target = container.querySelector(
      `[data-cm-content="${CSS.escape(stopId)}"]`,
    );
    if (!target) return;
    try {
      const res = await fetch(
        `https://api.carrismetropolitana.pt/v2/arrivals/by_stop/${encodeURIComponent(stopId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const now = Math.floor(Date.now() / 1000);
      const buses = (Array.isArray(data) ? data : [])
        .map((b) => ({
          ...b,
          ts: b.estimated_arrival_unix || b.scheduled_arrival_unix,
          live: !!b.estimated_arrival_unix,
        }))
        .filter((b) => b.ts >= now - 30)
        .sort((a, b) => a.ts - b.ts)
        .slice(0, 6);

      if (buses.length === 0) {
        target.innerHTML = `
          <div class="arrival-row justify-center">
            <span class="text-[10px] uppercase tracking-[0.2em] text-zinc-400 font-bold">Sem previsões</span>
          </div>`;
        if (window.lucide) window.lucide.createIcons();
        return;
      }

      const rows = buses
        .map((b) => {
          const diff = Math.floor((b.ts - now) / 60);
          let timeStr, timeCls;
          if (diff <= 0) {
            timeStr = "A chegar";
            timeCls = "text-emerald-600 dark:text-emerald-400 font-extrabold";
          } else if (diff < 60) {
            timeStr = `${diff} min`;
            timeCls = "font-bold";
          } else {
            const d = new Date(b.ts * 1000);
            timeStr = d.toLocaleTimeString("pt-PT", {
              hour: "2-digit",
              minute: "2-digit",
            });
            timeCls = "font-medium";
          }
          const colour = b.route_color
            ? `#${String(b.route_color).replace("#", "")}`
            : "#111";
          const liveDot = b.live
            ? `<span class="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2 animate-pulse"></span>`
            : "";
          return `
            <div class="arrival-row">
              <div class="flex items-center gap-3 flex-1 min-w-0">
                <span class="line-pill" style="background:${colour};min-width:38px;text-align:center">${escapeHtml(b.line_id)}</span>
                <span class="truncate text-zinc-600 dark:text-zinc-400 text-[12px]">${escapeHtml(b.headsign || "—")}</span>
              </div>
              <div class="flex items-center shrink-0">
                ${liveDot}
                <span class="text-[10px] uppercase tracking-[0.15em] ${timeCls}">${escapeHtml(timeStr)}${b.live ? "" : " <span class='text-zinc-400 normal-case font-light'>(prog.)</span>"}</span>
              </div>
            </div>`;
        })
        .join("");

      const refreshBtn = `
        <button class="w-full py-3 text-[9px] uppercase tracking-[0.25em] font-bold text-zinc-400 hover:text-zinc-900 dark:hover:text-white border-t border-zinc-100 dark:border-zinc-900 transition-colors" data-cm-refresh="${escapeHtml(stopId)}">
          <i data-lucide="refresh-cw" class="w-3 h-3 inline-block mr-1.5 -mt-0.5"></i>
          Atualizar
        </button>`;
      target.innerHTML = rows + refreshBtn;

      const rb = target.querySelector(`[data-cm-refresh]`);
      if (rb) {
        rb.addEventListener("click", () => {
          renderCMSkeleton(stopId, container);
          fetchCMArrivals(stopId, container);
        });
      }
      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      target.innerHTML = `
        <div class="arrival-row justify-center gap-2 text-zinc-400">
          <i data-lucide="wifi-off" class="w-3.5 h-3.5"></i>
          <span class="text-[10px] uppercase tracking-[0.2em] font-bold">Sem ligação ao servidor</span>
        </div>`;
      if (window.lucide) window.lucide.createIcons();
    }
  }

  // ═══ ROUTING & STATION RESOLUTION ════════════════════════════════════
  function extractSlug() {
    const path = window.location.pathname.replace(/\/+$/, "");
    const parts = path.split("/").filter(Boolean);
    const idx = parts.indexOf("estacao");
    let slug = idx !== -1 ? parts[idx + 1] : parts[parts.length - 1];
    if (!slug) return null;
    try {
      slug = decodeURIComponent(slug);
    } catch (_) {}
    return slug.toLowerCase().trim();
  }

  function findStationBySlug(slug) {
    const norm = normalize(slug);
    if (!norm) return null;
    let match = STATIONS.find((s) => normalize(s.name) === norm);
    if (match) return match;
    return STATIONS.find((s) => {
      const sn = normalize(s.name);
      return sn.includes(norm) || norm.includes(sn);
    });
  }

  // Estilo integrado e discreto para os botões do cabeçalho da app
  const btnClass =
    "p-2 rounded-full transition-colors text-zinc-900 dark:text-white group relative";

  // ── BOTÃO DE PARTILHA ──────────────────────────────────────────
  const shareBtn = document.createElement("button");
  shareBtn.id = "app-header-share-trigger";
  shareBtn.className = btnClass;
  shareBtn.setAttribute("aria-label", "Partilhar aplicação");
  shareBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"
           viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
           class="w-5 h-5">
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
        <polyline points="16 6 12 2 8 6"/>
        <line x1="12" x2="12" y1="2" y2="15"/>
      </svg>
    `;

  // Lógica do clique de partilha (com fallback automático para o clipboard do footer)
  shareBtn.addEventListener("click", async () => {
    if (typeof sa_event === "function") sa_event("header_share_button");
    const shareData = {
      title: "LiveTagus",
      text: "Olha a nova aplicação web para ver a fertagus em tempo real! Gratuita e sem anúncios!",
      url: "https://livetagus.pt",
    };
    if (
      navigator.share &&
      (!navigator.canShare || navigator.canShare(shareData))
    ) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        if (err.name === "AbortError") return;
      }
    }
    const footerShare = document.getElementById("footer-share-btn");
    if (footerShare) footerShare.click();
  });

  // ═══ POPOVER (menu de ferramentas inteligentes) ═══════════════════════
  function injectMenuExtras() {
    const header = document.querySelector("#global-nav header");
    const trigger = document.getElementById("menu-trigger");
    if (!header || !trigger) return;
    if (document.getElementById("menu-controls-wrapper")) return;

    const wrapper = document.createElement("div");
    wrapper.id = "menu-controls-wrapper";
    wrapper.className = "flex items-center gap-1";
    header.insertBefore(wrapper, trigger);

    const btn = document.createElement("button");
    btn.id = "mobility-trigger";
    btn.className =
      "p-2 rounded-full transition-colors text-zinc-900 dark:text-white group relative";
    btn.setAttribute("aria-label", "Ferramentas Inteligentes");
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layout-grid">
        <rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`;
    wrapper.appendChild(btn);
    wrapper.appendChild(trigger);

    const popover = document.createElement("div");
    popover.id = "mobility-popover";
    popover.className =
      "fixed top-16 right-4 w-70 bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl hidden origin-top-right transition-all duration-300 transform scale-95 opacity-0 z-50 overflow-hidden";

    popover.innerHTML = `
      <div class="px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
        <p class="text-[9px] font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">Mobilidade & Smart</p>
      </div>
      <div class="flex flex-col">
        <a href="/app" class="w-full flex items-center gap-4 px-4 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-left">
          <i data-lucide="train-track" class="w-4 h-4 text-zinc-900 dark:text-white"></i>
          <div class="flex-1">
            <p class="text-sm font-medium text-zinc-900 dark:text-white leading-none">Fertagus tempo real</p>
            <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 font-light tracking-wide">Lista e próximas partidas</p>
          </div>
          <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600"></i>
        </a>
        <div class="h-px w-full bg-zinc-100 dark:bg-zinc-800"></div>
        <a href="/mapa" data-action="topbtnapp_mapa" class="w-full flex items-center gap-4 px-4 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-left">
          <i data-lucide="map" class="w-4 h-4 text-zinc-900 dark:text-white"></i>
          <div class="flex-1">
            <p class="text-sm font-medium text-zinc-900 dark:text-white leading-none">Mapa Tempo Real</p>
            <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 font-light tracking-wide">Estimativa de localização dos comboios</p>
          </div>
          <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600"></i>
        </a>
        <div class="h-px w-full bg-zinc-100 dark:bg-zinc-800"></div>
        <a href="/paragens" class="w-full flex items-center gap-4 px-4 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-left">
          <i data-lucide="bus" class="w-4 h-4 text-zinc-900 dark:text-white"></i>
          <div class="flex-1">
            <p class="text-sm font-medium text-zinc-900 dark:text-white leading-none">A Minha Paragem (BETA)</p>
            <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 font-light tracking-wide">Autocarros para a estação</p>
          </div>
          <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600"></i>
        </a>
        <div class="h-px w-full bg-zinc-100 dark:bg-zinc-800"></div>
        <a href="/sudoku" class="w-full flex items-center gap-4 px-4 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-left">
          <i data-lucide="gamepad-2" class="w-4 h-4 text-zinc-900 dark:text-white"></i>
          <div class="flex-1">
            <p class="text-sm font-medium text-zinc-900 dark:text-white leading-none">Jogo de Sudoku</p>
            <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 font-light tracking-wide">Tempo extra? Joga.</p>
          </div>
          <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600"></i>
        </a>
      </div>`;
    document.getElementById("global-nav").appendChild(popover);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const hidden = popover.classList.contains("hidden");
      if (hidden) {
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
    document.addEventListener("click", (e) => {
      if (
        !popover.classList.contains("hidden") &&
        !popover.contains(e.target) &&
        !btn.contains(e.target)
      ) {
        popover.classList.remove("scale-100", "opacity-100");
        popover.classList.add("scale-95", "opacity-0");
        setTimeout(() => popover.classList.add("hidden"), 200);
      }
    });
    if (window.lucide) window.lucide.createIcons();
  }

  // ═══ NETWORK / VISIBILIDADE ═══════════════════════════════════════════
  function refreshDepartures() {
    if (state.activeTab === "fertagus" && state.partidasCtrl) {
      state.partidasCtrl.refresh(false);
    }
  }
  function attachNetworkListeners() {
    window.addEventListener("online", refreshDepartures);
    window.addEventListener("offline", refreshDepartures);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      refreshDepartures();
    });
  }

  // ═══ BOOT ════════════════════════════════════════════════════════════
  async function boot() {
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS) document.body.classList.add("is-ios");

    const slug = extractSlug();
    if (!slug || slug === "estacao") {
      window.location.replace("/estacao/");
      return;
    }
    const station = findStationBySlug(slug);
    if (!station) {
      window.location.replace("/estacao/");
      return;
    }
    state.station = station;

    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get("tab");
    if (tabParam === "ligacoes") {
      state.activeTab = "ligacoes";
    } else if (tabParam === "partidas") {
      state.activeTab = "fertagus"; // tab "fertagus"
    }

    document.title = `${station.name} | LiveTagus`;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute(
        "content",
        `Próximas partidas em tempo real e ligações intermodais na estação ${station.name}.`,
      );
    }
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", `${station.name} | LiveTagus`);

    setTimeout(injectMenuExtras, 120);

    renderHeader();
    renderTabs();

    // Avisos + ligações em paralelo; só depois render (1 mount do Partidas).
    await Promise.all([loadLigacoes(), loadAvisos()]);
    renderContent();

    attachNetworkListeners();

    if (window.lucide) window.lucide.createIcons();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

window.addEventListener("popstate", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const tabParam = urlParams.get("tab");
  const novaTab = tabParam === "ligacoes" ? "ligacoes" : "fertagus";

  if (state.activeTab !== novaTab) {
    state.activeTab = novaTab;
    renderTabs();
    renderContent();
  }
});

/**
 * estacao/index.js
 * Página seletora de estações Fertagus.
 *
 * Apresenta a lista das 14 estações agrupadas por zona geográfica, com pesquisa
 * incremental. Cada linha encaminha para `/estacao/{slug}` onde o utilizador vê
 * as próximas partidas em tempo real e as ligações intermodais.
 *
 * Estilo: tipográfico, minimalista (Massimo Dutti/Zara), consistente com o
 * resto do projeto LiveTagus.
 */

(function () {
  "use strict";

  // ─── ESTADO E DADOS EXTERNOS ──────────────────────────────────────────
  let ligacoesData = {};

  // Ordem lógica de exibição dos operadores se existirem vários
  const OP_ORDER = ["cp", "metro", "carris", "cm", "mts", "tcb", "re"];

  // ─── ESTAÇÕES ─────────────────────────────────────────────────────────
  // Adicionado o apiId para cruzar com as ligações no JSON
  const STATIONS = [
    // Norte — Lisboa
    {
      key: "roma_areeiro",
      name: "Roma-Areeiro",
      zone: "lisboa",
      apiId: "9466035",
    },
    {
      key: "entrecampos",
      name: "Entrecampos",
      zone: "lisboa",
      apiId: "9466050",
    },
    { key: "sete_rios", name: "Sete Rios", zone: "lisboa", apiId: "9466076" },
    { key: "campolide", name: "Campolide", zone: "lisboa", apiId: "9467033" },
    // Travessia (Não tem estações de passageiros na ponte)
    // Sul — Margem
    { key: "pragal", name: "Pragal", zone: "margem", apiId: "9417087" },
    { key: "corroios", name: "Corroios", zone: "margem", apiId: "9417137" },
    {
      key: "foros_de_amora",
      name: "Foros de Amora",
      zone: "margem",
      apiId: "9417152",
    },
    { key: "fogueteiro", name: "Fogueteiro", zone: "margem", apiId: "9417186" },
    { key: "coina", name: "Coina", zone: "margem", apiId: "9417236" },
    { key: "penalva", name: "Penalva", zone: "margem", apiId: "9417095" },
    {
      key: "pinhal_novo",
      name: "Pinhal Novo",
      zone: "margem",
      apiId: "9468007",
    },
    {
      key: "venda_do_alcaide",
      name: "Venda do Alcaide",
      zone: "margem",
      apiId: "9468049",
    },
    { key: "palmela", name: "Palmela", zone: "margem", apiId: "9468098" },
    { key: "setubal", name: "Setúbal", zone: "margem", apiId: "9468122" },
  ];

  const ZONES = {
    lisboa: { label: "Lisboa", index: 1 },
    margem: { label: "Margem Sul", index: 2 },
  };

  // ─── HELPERS ──────────────────────────────────────────────────────────

  function normalize(str) {
    return String(str || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function slugify(name) {
    return normalize(name)
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Busca silenciosa das ligações
  async function loadLigacoes() {
    try {
      const res = await fetch("/json/ligacoes_atualizado.json");
      if (res.ok) {
        ligacoesData = await res.json();
      }
    } catch (e) {
      console.error("Falha ao carregar ligações:", e);
    }
  }

  // ─── RENDER ───────────────────────────────────────────────────────────

  function rowHtml(station, idx) {
    const slug = slugify(station.name);
    const delay = Math.min(idx * 25, 400);

    // Lógica para detetar os operadores e gerar as imagens SVG
    let logosHtml = "";
    if (ligacoesData && ligacoesData[station.apiId]) {
      const stnLigacoes = ligacoesData[station.apiId].ligacoes || {};

      // Filtra os operadores que têm ligações nesta estação
      const activeOps = OP_ORDER.filter(
        (op) => stnLigacoes[op] && stnLigacoes[op].length > 0,
      );

      if (activeOps.length > 0) {
        // Aumentámos as dimensões para w-5 h-5 (20x20px)
        const imgs = activeOps
          .map((op) => {
            if (op === "cm") {
              return `
              <img src="/imagens/lig-logos/cm-light.svg" alt="${escapeHtml(op)}" class="w-5 h-5 object-contain cm-light" />
              <img src="/imagens/lig-logos/cm-dark.svg" alt="${escapeHtml(op)}" class="w-5 h-5 object-contain cm-dark" />
            `;
            }
            return `<img src="/imagens/lig-logos/${escapeHtml(op)}.svg" alt="${escapeHtml(op)}" class="w-5 h-5 object-contain" />`;
          })
          .join("");

        // Sem background, gap maior para respirarem, encostados à direita
        logosHtml = `
          <div class="flex items-center gap-2.5 shrink-0 mr-4 dark:opacity-85 transition-opacity group-hover:opacity-100">
            ${imgs}
          </div>
        `;
      }
    }

    return `
      <a href="/estacao/${slug}" class="stn-row group" style="animation-delay:${delay}ms">
        <span class="stn-name flex-1 min-w-0 pr-4 truncate block">${escapeHtml(station.name)}</span>
        
        ${logosHtml}
        
        <svg class="stn-arrow w-5 h-5 text-zinc-900 dark:text-white shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="5" y1="12" x2="19" y2="12"/>
          <polyline points="12 5 19 12 12 19"/>
        </svg>
      </a>`;
  }

  function sectionHtml(zoneKey, stations, globalIdxStart) {
    const label = (ZONES[zoneKey] || {}).label || zoneKey;
    const rows = stations
      .map((s, i) => rowHtml(s, globalIdxStart + i))
      .join("");
    return `
      <section class="mb-12">
        <div class="flex items-center gap-4 mb-6">
          <span class="zone-tag">${escapeHtml(label)}</span>
          <span class="h-px flex-1 bg-zinc-200 dark:bg-zinc-800"></span>
          <span class="text-[9px] font-mono tracking-wider text-zinc-400">
            ${stations.length.toString().padStart(2, "0")}
          </span>
        </div>
        <div class="space-y-0">${rows}</div>
      </section>`;
  }

  function render(filter) {
    const list = document.getElementById("stn-list");
    if (!list) return;

    const norm = normalize(filter || "");
    const filtered = STATIONS.filter((s) =>
      !norm ? true : normalize(s.name).includes(norm),
    );

    if (filtered.length === 0) {
      list.innerHTML = `
        <div class="py-20 text-center">
          <i data-lucide="search-x" class="w-10 h-10 text-zinc-300 dark:text-zinc-700 mx-auto mb-5 stroke-[1.2]"></i>
          <p class="text-sm text-zinc-500 font-light tracking-tight">
            Nenhuma estação corresponde a esta pesquisa.
          </p>
        </div>`;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    const grouped = {};
    filtered.forEach((s) => {
      if (!grouped[s.zone]) grouped[s.zone] = [];
      grouped[s.zone].push(s);
    });

    const sortedZones = Object.keys(grouped).sort(
      (a, b) => (ZONES[a]?.index || 99) - (ZONES[b]?.index || 99),
    );

    let html = "";
    let counter = 0;
    for (const z of sortedZones) {
      html += sectionHtml(z, grouped[z], counter);
      counter += grouped[z].length;
    }
    list.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();
  }

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
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layout-grid-icon lucide-layout-grid">
        <rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>
        <path d="m10.586 5.414-5.172 5.172"/><path d="m18.586 13.414-5.172 5.172"/><path d="M6 12h12"/><circle cx="12" cy="20" r="2"/><circle cx="12" cy="4" r="2"/><circle cx="20" cy="12" r="2"/><circle cx="4" cy="12" r="2"/>
      </svg>`;
    wrapper.appendChild(btn);
    wrapper.appendChild(trigger);

    const popover = document.createElement("div");
    popover.id = "mobility-popover";
    popover.className =
      "fixed top-16 right-4 w-70 bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl hidden origin-top-right transition-all duration-300 transform scale-95 opacity-0 z-50 overflow-hidden";

    popover.innerHTML = `
      <div class="px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
        <p class="text-[9px] font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
          Mobilidade & Smart
        </p>
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
            <p class="text-sm font-medium text-zinc-900 dark:text-white leading-none">Mapa Tempo Real (BETA)</p>
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

  // ─── BOOT ─────────────────────────────────────────────────────────────

  async function boot() {
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS) document.body.classList.add("is-ios");

    // Renderiza a lista de imediato (sem os logos) para ser instantâneo ao abrir
    setTimeout(injectMenuExtras, 120);
    render("");

    // Pede as ligações assincronamente e re-renderiza quando chegar
    await loadLigacoes();
    const input = document.getElementById("stn-search");
    render(input ? input.value : "");

    if (input) {
      let debounceTimer;
      input.addEventListener("input", (e) => {
        clearTimeout(debounceTimer);
        const v = e.target.value;
        debounceTimer = setTimeout(() => render(v), 60);
      });

      // Tecla Enter abre a primeira correspondência
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        const first = document.querySelector(".stn-row");
        if (first) {
          e.preventDefault();
          window.location.href = first.getAttribute("href");
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

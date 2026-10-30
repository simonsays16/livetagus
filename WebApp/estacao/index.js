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

  // A lista das estações, as zonas e os helpers vêm do menu.js
  // (window.LTEstacoes): é a mesma lista do "Estações ›" do menu.
  const E = window.LTEstacoes;
  const STATIONS = E.LISTA;
  const ZONES = E.ZONAS;
  const normalize = E.normalizar;
  const slugify = E.slug;

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Busca silenciosa das ligações (partilhada com o menu: um só pedido)
  async function loadLigacoes() {
    ligacoesData = (await E.carregarLigacoes()) || {};
  }

  // ─── RENDER ───────────────────────────────────────────────────────────

  function rowHtml(station, idx) {
    const slug = slugify(station.name);
    const delay = Math.min(idx * 25, 400);

    // Lógica para detetar os operadores e gerar as imagens SVG
    let logosHtml = "";
    if (ligacoesData && ligacoesData[station.apiId]) {
      // Operadores com ligação nesta estação
      const activeOps = E.operadores(ligacoesData, station.apiId);

      if (activeOps.length > 0) {
        // w-5 h-5 (20x20px)
        const imgs = E.logosHtml(activeOps, {
          img: "w-5 h-5 object-contain",
          cmLight: "cm-light",
          cmDark: "cm-dark",
        });

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

  // ─── BOOT ─────────────────────────────────────────────────────────────

  async function boot() {
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS) document.body.classList.add("is-ios");

    // Renderiza a lista de imediato (sem os logos) para ser instantâneo ao abrir
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

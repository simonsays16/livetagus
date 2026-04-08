/**
 * paragens-search.js
 * Funcionalidade de pesquisa de paragens: por nome e por linha.
 * Integra com o mapa e lista de paragens guardadas via window.LT (definido em paragens.js).
 *
 * Dependências: paragens.js (window.LT), MapLibre GL (maplibregl), Lucide icons (lucide)
 */

document.addEventListener("DOMContentLoaded", () => {
  // ─── DOM REFS ───
  const searchInput = document.getElementById("map-search-input");
  const searchClear = document.getElementById("map-search-clear");
  const modeNameBtn = document.getElementById("search-mode-name");
  const modeLineBtn = document.getElementById("search-mode-line");
  const resultsPanel = document.getElementById("search-results-panel");
  const resultsList = document.getElementById("search-results-list");
  const resultsCount = document.getElementById("search-results-count");
  const resultsCloseBtn = document.getElementById("search-results-close");
  const btnOpenMap = document.getElementById("btn-open-map");
  const btnCloseMap = document.getElementById("btn-close-map");

  if (!searchInput) return; // UI não presente

  // ─── ESTADO ───
  let searchMode = "line"; // começar por line, erros no nome
  let searchTimeout = null;
  let panelOpen = false;

  // ─── MODO DE PESQUISA ───
  const MODE_ACTIVE = [
    "bg-zinc-900",
    "dark:bg-white",
    "text-white",
    "dark:text-zinc-900",
    "border-zinc-900",
    "dark:border-white",
  ];
  const MODE_INACTIVE = [
    "text-zinc-500",
    "dark:text-zinc-400",
    "border-zinc-200",
    "dark:border-zinc-700",
  ];

  function setMode(mode) {
    searchMode = mode;

    // Reset classes de ambos
    [modeNameBtn, modeLineBtn].forEach((btn) => {
      btn.classList.remove(...MODE_ACTIVE, ...MODE_INACTIVE);
    });

    if (mode === "name") {
      modeNameBtn.classList.add(...MODE_ACTIVE);
      modeLineBtn.classList.add(...MODE_INACTIVE);
      searchInput.placeholder = "Pesquisar por nome da paragem...";
    } else {
      modeLineBtn.classList.add(...MODE_ACTIVE);
      modeNameBtn.classList.add(...MODE_INACTIVE);
      searchInput.placeholder = "Pesquisar por linha (ex: 4001)...";
    }

    const q = searchInput.value.trim();
    if (q) {
      triggerSearch(q);
    }
  }

  modeNameBtn.addEventListener("click", () => setMode("name"));
  modeLineBtn.addEventListener("click", () => setMode("line"));

  // ─── INPUT DE PESQUISA ───
  searchInput.addEventListener("input", (e) => {
    const q = e.target.value;
    searchClear.classList.toggle("hidden", !q);

    clearTimeout(searchTimeout);
    if (!q.trim()) {
      resetSearch();
      return;
    }
    searchTimeout = setTimeout(() => triggerSearch(q.trim()), 280);
  });

  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    searchClear.classList.add("hidden");
    resetSearch();
    searchInput.focus();
  });

  // Fechar painel ao carregar na tecla Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (panelOpen) {
        closePanel();
      }
    }
  });

  // Fechar painel com botão
  if (resultsCloseBtn) {
    resultsCloseBtn.addEventListener("click", () => {
      closePanel();
    });
  }

  // Limpar pesquisa quando o modal fecha
  btnCloseMap.addEventListener("click", () => {
    setTimeout(() => {
      searchInput.value = "";
      searchClear.classList.add("hidden");
      resetSearch();
    }, 350);
  });

  // Garantir filtro limpo quando modal abre
  btnOpenMap.addEventListener("click", () => {
    // Pequeno delay para o mapa estar pronto
    setTimeout(() => {
      resetMapFilter();
    }, 500);
  });

  // ─── LÓGICA DE PESQUISA ───
  function triggerSearch(query) {
    const stopsData = window.LT && window.LT.getStopsData();

    if (!stopsData) {
      // Dados ainda a carregar
      resultsList.innerHTML = `
        <div class="py-10 text-center">
          <div class="w-5 h-5 border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-white rounded-full animate-spin mx-auto mb-3"></div>
          <p class="text-[10px] uppercase tracking-widest text-zinc-400">A carregar dados...</p>
        </div>`;
      openPanel();
      return;
    }

    let results = [];

    if (searchMode === "name") {
      // Pesquisa por nome: normaliza acentos e faz substring match
      const q = normalizeStr(query);
      const digits = query.replace(/\D/g, "");
      results = stopsData
        .filter((s) => {
          const name = normalizeStr(s.n);
          return (
            name.includes(q) || (digits.length > 0 && s.id.includes(digits))
          );
        })
        .slice(0, 60);
    } else {
      // Pesquisa por linha: match parcial no ID da linha
      const lineQ = query.toUpperCase().trim();
      results = stopsData
        .filter((s) => s.l && s.l.some((l) => l.toUpperCase().includes(lineQ)))
        .slice(0, 100);
    }

    // Atualizar mapa com resultados
    const filteredIds = results.map((s) => s.id);
    updateMapFilter(filteredIds, results);

    // Mostrar resultados
    renderResultsList(results, query);
    openPanel();
  }

  function resetSearch() {
    closePanel();
    resetMapFilter();
  }

  // ─── FILTRO DO MAPA ───
  function updateMapFilter(ids, results) {
    const map = window.LT && window.LT.getMapInstance();
    if (!map) return;

    // Aguardar layer estar disponível
    if (!map.getLayer("stops-layer")) {
      map.once("idle", () => updateMapFilter(ids, results));
      return;
    }

    if (ids.length === 0) {
      // Nenhum resultado: esconder todas as paragens CM
      map.setFilter("stops-layer", ["==", ["get", "id"], "__none__"]);
    } else {
      // Mostrar só as paragens filtradas
      map.setFilter("stops-layer", ["in", ["get", "id"], ["literal", ids]]);

      // Fazer pan/zoom para os resultados (se poucos)
      if (ids.length <= 50) {
        const stopsData = window.LT.getStopsData();
        const matching = stopsData.filter((s) => ids.includes(s.id));

        if (matching.length === 1) {
          map.flyTo({
            center: [matching[0].c[1], matching[0].c[0]],
            zoom: 16,
            duration: 700,
          });
        } else if (matching.length > 1 && matching.length <= 30) {
          const lngs = matching.map((s) => s.c[1]);
          const lats = matching.map((s) => s.c[0]);
          map.fitBounds(
            [
              [Math.min(...lngs), Math.min(...lats)],
              [Math.max(...lngs), Math.max(...lats)],
            ],
            { padding: 60, duration: 700, maxZoom: 14 },
          );
        }
      }
    }
  }

  function resetMapFilter() {
    const map = window.LT && window.LT.getMapInstance();
    if (!map || !map.getLayer("stops-layer")) return;
    map.setFilter("stops-layer", null);
    // Restaurar cor normal das paragens
    if (window.LT.updateMapStopsColor) {
      window.LT.updateMapStopsColor();
    }
  }

  // ─── RENDER LISTA DE RESULTADOS ───
  function renderResultsList(results, query) {
    const savedStops = (window.LT && window.LT.getSavedStops()) || [];

    // Atualizar contador
    if (resultsCount) {
      const countText =
        results.length === 0
          ? "Sem resultados"
          : searchMode === "line"
            ? `${results.length} paragem${results.length !== 1 ? "s" : ""} nesta linha`
            : `${results.length} resultado${results.length !== 1 ? "s" : ""}`;
      resultsCount.textContent = countText;
      resultsCount.classList.remove("invisible");
    }

    if (results.length === 0) {
      resultsList.innerHTML = `
        <div class="py-10 text-center">
          <i data-lucide="search-x" class="w-7 h-7 text-zinc-300 dark:text-zinc-700 mx-auto mb-3"></i>
          <p class="text-[10px] uppercase tracking-widest text-zinc-500">Sem resultados para</p>
          <p class="text-xs font-semibold text-zinc-900 dark:text-white mt-1 uppercase tracking-wide">"${escapeHtml(query)}"</p>
          ${
            searchMode === "name"
              ? `<p class="text-[9px] text-zinc-400 mt-2 tracking-wide">Tente também pesquisar por linha</p>`
              : `<p class="text-[9px] text-zinc-400 mt-2 tracking-wide">Exemplo de linha: 4001, 3001...</p>`
          }
        </div>`;
      lucide.createIcons();
      return;
    }

    const itemsHtml = results
      .map((stop) => {
        const isSaved = savedStops.some((s) => s.id === stop.id);
        const lines = stop.l || [];

        // Pills de linhas (max 5 visíveis)
        const visibleLines = lines.slice(0, 5);
        const extraCount = lines.length - visibleLines.length;
        const linePillsHtml = visibleLines
          .map(
            (l) =>
              `<span class="font-mono text-[8px] bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold">${l}</span>`,
          )
          .join("");
        const extraHtml =
          extraCount > 0
            ? `<span class="text-[8px] text-zinc-400 font-medium">+${extraCount}</span>`
            : "";

        return `
          <div class="py-3 flex items-start gap-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
            <div class="flex-1 min-w-0 pt-0.5">
              <p class="text-xs font-semibold text-zinc-900 dark:text-white uppercase tracking-wide leading-tight">${escapeHtml(stop.n)}</p>
              <p class="text-[9px] text-zinc-500 tracking-widest mt-0.5">ID: ${stop.id}</p>
              ${
                lines.length > 0
                  ? `<div class="flex flex-wrap gap-1 mt-1.5">${linePillsHtml}${extraHtml}</div>`
                  : ""
              }
            </div>
            <div class="flex flex-col gap-1.5 shrink-0 items-end">
              <button
                data-result-add="${stop.id}"
                data-result-name="${escapeAttr(stop.n)}"
                data-result-lines="${lines.join(",")}"
                class="text-[9px] font-bold uppercase tracking-widest px-3 py-2 border transition-colors whitespace-nowrap ${
                  isSaved
                    ? "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800 cursor-default"
                    : "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-zinc-900 dark:border-white hover:bg-zinc-700 dark:hover:bg-zinc-200 active:scale-95"
                }"
                ${isSaved ? "disabled" : ""}
              >${isSaved ? "✓ GUARDADA" : "+ GUARDAR"}</button>
              <button
                data-result-locate="${stop.id}"
                data-result-lng="${stop.c[1]}"
                data-result-lat="${stop.c[0]}"
                class="text-[8px] font-semibold uppercase tracking-widest px-3 py-1.5 border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:border-zinc-500 dark:hover:border-zinc-500 transition-colors whitespace-nowrap active:scale-95"
              >Ver no Mapa</button>
            </div>
          </div>
        `;
      })
      .join("");

    resultsList.innerHTML = itemsHtml;
    lucide.createIcons();
  }

  // ─── AÇÕES NOS RESULTADOS ───
  resultsList.addEventListener("click", (e) => {
    // Guardar paragem
    const addBtn = e.target.closest("[data-result-add]");
    if (addBtn && !addBtn.disabled) {
      const id = addBtn.dataset.resultAdd;
      const name = addBtn.dataset.resultName;
      const lines = addBtn.dataset.resultLines
        ? addBtn.dataset.resultLines.split(",").filter(Boolean)
        : [];

      if (window.LT && window.LT.addStop) {
        const success = window.LT.addStop(id, name, lines);
        if (success) {
          // Visual feedback
          addBtn.innerHTML = "✓ GUARDADA";
          addBtn.disabled = true;
          addBtn.className = addBtn.className.replace(
            "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-zinc-900 dark:border-white hover:bg-zinc-700 dark:hover:bg-zinc-200 active:scale-95",
            "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800 cursor-default",
          );
          // Fechar modal após breve delay
          setTimeout(() => {
            if (window.LT.closeMapModal) window.LT.closeMapModal();
          }, 700);
        }
      }
      return;
    }

    // Localizar no mapa
    const locateBtn = e.target.closest("[data-result-locate]");
    if (locateBtn) {
      const lng = parseFloat(locateBtn.dataset.resultLng);
      const lat = parseFloat(locateBtn.dataset.resultLat);
      const map = window.LT && window.LT.getMapInstance();

      if (map) {
        map.flyTo({ center: [lng, lat], zoom: 17, duration: 900 });
        // Fechar o painel para ver o mapa
        closePanel();
      }
    }
  });

  // ─── PAINEL UI ───
  function openPanel() {
    if (!panelOpen) {
      resultsPanel.classList.remove("panel-hidden");
      resultsPanel.classList.add("panel-visible");
      panelOpen = true;
    }
  }

  function closePanel() {
    if (panelOpen) {
      resultsPanel.classList.remove("panel-visible");
      resultsPanel.classList.add("panel-hidden");
      panelOpen = false;
      if (resultsCount) {
        resultsCount.classList.add("invisible");
      }
    }
  }

  // ─── UTILITÁRIOS ───

  /**
   * Normaliza uma string removendo acentos e convertendo para lowercase.
   * Permite pesquisa sem acentos em português.
   */
  function normalizeStr(str) {
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(str) {
    return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
});

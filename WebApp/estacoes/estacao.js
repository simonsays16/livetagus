/**
 * estacoes.js
 * Página dinâmica de Estações Fertagus — Ligações Intermodais e Tempo Real CM.
 *
 * Roteamento: /estacao/<slug> → lê slug do pathname, faz match com ligacoes_atualizado.json
 * Funcionalidades:
 *   - Renderiza secções por operador (Fertagus, CM, CP, MTS, Metro Lisboa, Carris, TCB, Rede Expresso)
 *   - Fetch tempo real da API Carris Metropolitana ao expandir card de paragem CM
 *   - Skeleton loaders enquanto carrega
 */

document.addEventListener("DOMContentLoaded", async () => {
  // ─── CONFIG ───
  const CM_API_BASE = "https://api.carrismetropolitana.pt/v2";
  const LIGACOES_PATH = "/json/ligacoes_atualizado.json";
  const STOPS_FT_PATH = "/json/stops_ft.json";
  const FERTAGUS_LISBOA_PATH = "/json/fertagus_sentido_lisboa.json";
  const FERTAGUS_MARGEM_PATH = "/json/fertagus_sentido_margem.json";

  const headerEl = document.getElementById("station-header");
  const contentEl = document.getElementById("station-content");

  // ─── 1. EXTRAIR SLUG DO URL ───
  const slug = extractSlug();
  if (!slug) {
    renderNotFound("Nenhuma estação especificada.");
    return;
  }

  // ─── 2. CARREGAR JSON DE LIGAÇÕES ───
  let ligacoesData;
  try {
    const res = await fetch(LIGACOES_PATH);
    if (!res.ok) throw new Error("JSON não encontrado");
    ligacoesData = await res.json();
  } catch (err) {
    console.error("Erro a carregar ligações:", err);
    renderNotFound("Erro ao carregar dados das estações.");
    return;
  }

  // ─── 3. ENCONTRAR A ESTAÇÃO ───
  const station = findStation(ligacoesData, slug);
  if (!station) {
    renderNotFound(`Estação "${slug}" não encontrada.`);
    return;
  }

  // ─── 4. ATUALIZAR TÍTULO DA PÁGINA ───
  document.title = `${station.name} | LiveTagus`;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) {
    metaDesc.setAttribute(
      "content",
      `Ligações intermodais e tempos de espera em tempo real na estação ${station.name}.`,
    );
  }

  // ─── 5. RENDERIZAR HEADER ───
  renderHeader(station.name);

  // ─── 6. RENDERIZAR CONTEÚDO POR OPERADOR ───
  renderStationContent(station.data.ligacoes, station.name);

  // Recriar ícones Lucide
  if (window.lucide) lucide.createIcons();
});

// ═══════════════════════════════════════════
//  FUNÇÕES DE ROTEAMENTO
// ═══════════════════════════════════════════

/**
 * Extrai o slug do pathname.
 * Ex: /estacao/corroios → "corroios"
 *     /estacao/foros-da-amora → "foros-da-amora"
 */
function extractSlug() {
  const path = window.location.pathname.replace(/\/+$/, ""); // remover trailing slash
  const parts = path.split("/");
  // Esperamos: ["", "estacao", "slug"]
  const idx = parts.indexOf("estacao");
  if (idx !== -1 && parts[idx + 1]) {
    return decodeURIComponent(parts[idx + 1])
      .toLowerCase()
      .trim();
  }
  // Fallback: último segmento
  const last = parts[parts.length - 1];
  return last ? decodeURIComponent(last).toLowerCase().trim() : null;
}

/**
 * Normaliza string para comparação: remove acentos, lowercase, substitui espaços por hífens.
 */
function normalizeStr(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Procura a estação no JSON de ligações, fazendo match normalizado com o slug.
 */
function findStation(data, slug) {
  const normalizedSlug = normalizeStr(slug);

  for (const [nodeId, stationData] of Object.entries(data)) {
    const normalizedName = normalizeStr(stationData.name);
    if (normalizedName === normalizedSlug) {
      return { nodeId, name: stationData.name, data: stationData };
    }
  }

  // Fallback: match parcial
  for (const [nodeId, stationData] of Object.entries(data)) {
    const normalizedName = normalizeStr(stationData.name);
    if (
      normalizedName.includes(normalizedSlug) ||
      normalizedSlug.includes(normalizedName)
    ) {
      return { nodeId, name: stationData.name, data: stationData };
    }
  }

  return null;
}

// ═══════════════════════════════════════════
//  RENDERIZAÇÃO
// ═══════════════════════════════════════════

function renderHeader(name) {
  const headerEl = document.getElementById("station-header");
  headerEl.innerHTML = `
    <p class="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500 mb-2">Ligações na Estação</p>
    <h1 class="text-3xl md:text-4xl font-light tracking-tighter leading-tight">
      <span class="font-bold">${name.toUpperCase()}</span>
    </h1>
    <div class="w-12 h-[2px] bg-zinc-900 dark:bg-white mt-4"></div>
  `;
}

function renderNotFound(message) {
  const headerEl = document.getElementById("station-header");
  const contentEl = document.getElementById("station-content");

  headerEl.innerHTML = "";
  contentEl.innerHTML = `
    <div class="not-found-container">
      <i data-lucide="map-pin-off" class="w-10 h-10 text-zinc-300 dark:text-zinc-700"></i>
      <p class="text-sm text-zinc-500 font-medium">${message}</p>
      <a href="/" class="mt-4 inline-block px-6 py-3 border border-zinc-900 dark:border-white text-zinc-900 dark:text-white text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
        Voltar ao Início
      </a>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
}

/**
 * Renderiza todo o conteúdo da estação, dividido por operador.
 */
function renderStationContent(ligacoes, stationName) {
  const contentEl = document.getElementById("station-content");
  contentEl.innerHTML = "";

  // Ordem de renderização dos operadores
  const operatorOrder = [
    {
      key: "cm",
      label: "Carris Metropolitana",
      icon: "bus",
      renderFn: renderCMSection,
    },
    {
      key: "mts",
      label: "MTS - Metro Transportes do Sul",
      icon: "train-front-tunnel",
      renderFn: renderInfoSection,
    },
    {
      key: "cp",
      label: "CP - Comboios de Portugal",
      icon: "train-track",
      renderFn: renderInfoSection,
    },
    {
      key: "metro",
      label: "Metro de Lisboa",
      icon: "train-front-tunnel",
      renderFn: renderInfoSection,
    },
    {
      key: "carris",
      label: "Carris",
      icon: "bus",
      renderFn: renderInfoSection,
    },
    {
      key: "tcb", // endpoint TCB realtime: https://backend.tcbarreiro.pt/api/bus-stops/000095?locale=pt-PT
      label: "TCB - Barreiro",
      icon: "bus",
      renderFn: renderInfoSection,
    },
    {
      key: "re",
      label: "Rede Expresso",
      icon: "bus",
      renderFn: renderInfoSection,
    },
  ];

  let hasContent = false;

  operatorOrder.forEach(({ key, label, icon, renderFn }) => {
    if (!ligacoes[key] || ligacoes[key].length === 0) return;
    hasContent = true;

    const section = document.createElement("section");
    section.className = "mb-10";

    // Operator badge
    const badge = document.createElement("div");
    badge.className = "mb-5";
    badge.innerHTML = `
      <span class="operator-badge">
        <i data-lucide="${icon}" class="w-3 h-3"></i>
        ${label}
      </span>
    `;
    section.appendChild(badge);

    // Render the section content
    renderFn(section, ligacoes[key], label);
    contentEl.appendChild(section);
  });

  if (!hasContent) {
    contentEl.innerHTML = `
      <div class="text-center py-16">
        <p class="text-sm text-zinc-400">Sem dados de ligações para esta estação.</p>
      </div>
    `;
  }

  if (window.lucide) lucide.createIcons();
}

// ─── SECÇÃO CARRIS METROPOLITANA (Interativa, tempo real) ───

function renderCMSection(container, stops) {
  stops.forEach((stop) => {
    const card = document.createElement("div");
    card.className = "stop-card mb-3";

    // Recolher todas as linhas únicas desta paragem
    const uniqueLines = [];
    const seenLines = new Set();
    stop.lines.forEach((l) => {
      if (!seenLines.has(l["line-id"])) {
        seenLines.add(l["line-id"]);
        uniqueLines.push(l);
      }
    });

    // Pills de linhas
    const linePills = uniqueLines
      .map((l) => {
        const color = l["route-color"] || "#111";
        return `<span class="line-pill" style="background:${color};color:#fff;">${l["line-name"]}</span>`;
      })
      .join("");

    // Google Maps link
    const gmapsHtml = stop.gmapslink
      ? `<a href="${stop.gmapslink}" target="_blank" rel="noopener" class="gmaps-link mt-2">
           <i data-lucide="map-pin" class="w-3 h-3"></i> Abrir no Google Maps
         </a>`
      : "";

    card.innerHTML = `
      <button class="w-full text-left px-4 py-4 flex items-start justify-between gap-3 cursor-pointer group" data-stop-toggle="${stop.id}">
        <div class="flex-1 min-w-0">
          <p class="text-xs font-semibold uppercase tracking-wider text-zinc-900 dark:text-white leading-snug">${stop.name}</p>
          <p class="text-[10px] text-zinc-400 tracking-widest mt-1">ID: ${stop.id}</p>
          <div class="flex flex-wrap gap-1.5 mt-3">${linePills}</div>
          ${gmapsHtml}
        </div>
        <div class="pt-1 shrink-0">
          <i data-lucide="chevron-down" class="w-4 h-4 text-zinc-400 chevron-icon" id="chevron-${stop.id}"></i>
        </div>
      </button>
      <div class="arrivals-panel" id="arrivals-${stop.id}">
        <div class="border-t" style="border-color:var(--border-light);">
          <div id="arrivals-content-${stop.id}"></div>
        </div>
      </div>
    `;

    // Click handler: expand/collapse + fetch
    const toggleBtn = card.querySelector(`[data-stop-toggle="${stop.id}"]`);
    let hasLoaded = false;

    toggleBtn.addEventListener("click", () => {
      const panel = document.getElementById(`arrivals-${stop.id}`);
      const chevron = document.getElementById(`chevron-${stop.id}`);
      const isOpen = panel.classList.contains("open");

      if (isOpen) {
        panel.classList.remove("open");
        chevron.classList.remove("rotated");
      } else {
        panel.classList.add("open");
        chevron.classList.add("rotated");

        if (!hasLoaded) {
          hasLoaded = true;
          renderSkeletonArrivals(stop.id);
          fetchCMArrivals(stop.id);
        }
      }
    });

    container.appendChild(card);
  });
}

// ─── SECÇÃO INFORMATIVA (CP, MTS, Metro, Carris, TCB, RE) ───

function renderInfoSection(container, items, label) {
  const card = document.createElement("div");
  card.className = "stop-card";

  // Filtrar: 1º item é geralmente metadata { type, operator }, restantes são linhas
  const lines = items.filter((item) => item.line);
  const meta = items.find((item) => item.operator);

  let html = '<div class="px-4 py-3">';

  if (lines.length > 0) {
    lines.forEach((item) => {
      html += `<div class="info-line-item flex items-center gap-3">
        <i data-lucide="arrow-right" class="w-3 h-3 text-zinc-300 dark:text-zinc-600 shrink-0"></i>
        <span>${item.line}</span>
      </div>`;
    });
  } else {
    // Apenas metadata, sem linhas específicas
    const operatorName = meta ? meta.operator : label;
    html += `<div class="info-line-item">
      <span class="text-zinc-400">Ligação disponível — ${operatorName}</span>
    </div>`;
  }

  html += "</div>";
  card.innerHTML = html;
  container.appendChild(card);
}

// ═══════════════════════════════════════════
//  TEMPO REAL — CARRIS METROPOLITANA
// ═══════════════════════════════════════════

function renderSkeletonArrivals(stopId) {
  const el = document.getElementById(`arrivals-content-${stopId}`);
  if (!el) return;

  let html = "";
  for (let i = 0; i < 4; i++) {
    html += `
      <div class="arrival-row">
        <div class="flex items-center gap-3 flex-1">
          <div class="skeleton" style="width:48px;height:26px;"></div>
          <div class="skeleton" style="width:60%;height:14px;"></div>
        </div>
        <div class="skeleton" style="width:50px;height:14px;"></div>
      </div>
    `;
  }
  el.innerHTML = html;
}

async function fetchCMArrivals(stopId) {
  const el = document.getElementById(`arrivals-content-${stopId}`);
  if (!el) return;

  try {
    const res = await fetch(
      `https://api.carrismetropolitana.pt/v2/arrivals/by_stop/${stopId}`,
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error("API indisponível");

    const data = await res.json();
    const nowUnix = Math.floor(Date.now() / 1000);

    const futureBuses = data
      .map((bus) => ({
        ...bus,
        timeUnix: bus.estimated_arrival_unix || bus.scheduled_arrival_unix,
        live: !!bus.estimated_arrival_unix,
      }))
      .filter((bus) => bus.timeUnix >= nowUnix - 30)
      .sort((a, b) => a.timeUnix - b.timeUnix)
      .slice(0, 6);

    renderArrivals(el, futureBuses);
  } catch (err) {
    console.error(`Erro ao buscar chegadas para ${stopId}:`, err);
    el.innerHTML = `
      <div class="arrival-row" style="justify-content:center;gap:8px;color:var(--text-tertiary);">
        <i data-lucide="wifi-off" class="w-4 h-4"></i>
        <span class="text-[10px] uppercase tracking-wider font-semibold">Sem ligação ao servidor</span>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
  }
}

function renderArrivals(container, buses) {
  if (buses.length === 0) {
    container.innerHTML = `
      <div class="arrival-row" style="justify-content:center;">
        <span class="text-xs text-zinc-400 font-medium">Sem previsões para as próximas horas.</span>
      </div>
    `;
    return;
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  let html = "";

  buses.forEach((bus) => {
    const diffMins = Math.floor((bus.timeUnix - nowUnix) / 60);
    let timeStr = "";
    let timeClass = "font-bold";
    let pulseHtml = "";
    let progHtml = "";

    if (diffMins <= 0) {
      timeStr = "A CHEGAR";
      timeClass = "font-extrabold";
      pulseHtml = `<span class="w-1.5 h-1.5 rounded-full animate-pulse mr-1.5 shrink-0" style="background:var(--green);"></span>`;
      timeClass += " color-green";
    } else if (diffMins < 60) {
      timeStr = `${diffMins} min`;
    } else {
      const d = new Date(bus.timeUnix * 1000);
      timeStr = d.toLocaleTimeString("pt-PT", {
        hour: "2-digit",
        minute: "2-digit",
      });
      timeClass = "font-medium";
    }

    if (!bus.live) {
      progHtml = `<span class="text-[9px] text-zinc-400 font-normal mr-1">(prog.)</span>`;
    }

    const lineColor = bus.route_color
      ? `#${bus.route_color.replace("#", "")}`
      : "#111";

    html += `
      <div class="arrival-row">
        <div class="flex items-center gap-3 truncate pr-3 flex-1 min-w-0">
          <span class="line-pill shrink-0" style="background:${lineColor};color:#fff;min-width:44px;text-align:center;">${bus.line_id}</span>
          <span class="text-xs text-zinc-600 dark:text-zinc-400 truncate font-medium">${bus.headsign || "—"}</span>
        </div>
        <div class="flex items-center shrink-0">
          ${bus.live ? '<span class="w-1.5 h-1.5 rounded-full animate-pulse mr-1.5 shrink-0" style="background:var(--green);"></span>' : ""}
          <span class="text-[10px] uppercase tracking-widest ${timeClass}" ${diffMins <= 0 ? 'style="color:var(--green);"' : ""}>
            ${progHtml}${timeStr}
          </span>
        </div>
      </div>
    `;
  });

  // Botão para atualizar
  html += `
    <button class="w-full py-2.5 text-[9px] uppercase tracking-[0.15em] font-semibold text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors border-t" style="border-color:var(--border-light);" data-refresh-stop="${buses[0]?.stop_id || ""}">
      <i data-lucide="refresh-cw" class="w-3 h-3 inline-block mr-1 align-[-2px]"></i> Atualizar
    </button>
  `;

  container.innerHTML = html;

  // Listener para refresh
  const refreshBtn = container.querySelector("[data-refresh-stop]");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const stopId = refreshBtn
        .closest(".stop-card")
        ?.querySelector("[data-stop-toggle]")?.dataset.stopToggle;
      if (stopId) {
        renderSkeletonArrivals(stopId);
        fetchCMArrivals(stopId);
      }
    });
  }

  if (window.lucide) lucide.createIcons();
}

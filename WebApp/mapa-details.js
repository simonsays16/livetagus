/**
 * mapa-details.js
 * Painel de detalhes de um comboio, em bottom sheet com 2 estados:
 *   • "mini"      — mostra dados essenciais
 *   • "expanded"  — mostra também a timeline das estações
 */

(function () {
  "use strict";

  let panel, backdrop;
  let currentTrainId = null;
  let currentState = "closed"; // 'closed' | 'mini' | 'expanded'
  let dragActive = false;
  let dragStartY = 0;
  let dragLastY = 0;
  let dragStartState = null;
  let dragStartHeightPx = 0;
  let dragPointerId = null;

  function ensureElements() {
    if (panel && backdrop) return;
    panel = document.getElementById("details-panel");
    backdrop = document.getElementById("details-backdrop");
    if (!panel || !backdrop) {
      console.error("[MapaDetails] Elementos DOM ausentes");
    }
  }

  // ─── HELPERS ─────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isMobile() {
    return window.innerWidth < 768;
  }

  function trainShareUrl(train) {
    try {
      const base = window.location.origin + window.location.pathname;
      return `${base}#${encodeURIComponent(train.id)}`;
    } catch (_) {
      return `https://livetagus.pt/mapa#${train.id}`;
    }
  }

  // ─── BUILDERS DE BLOCOS ──────────────────────────────────────────────

  function statusChipHtml(train) {
    const ring = MAPA.STATUS_COLORS[train.dotStatus] || MAPA.STATUS_COLORS.gray;
    const pulse = train.dotStatus === "orange" || train.dotStatus === "red";
    return `
      <div class="inline-flex items-center gap-2 px-3 py-1.5 border border-zinc-200 dark:border-zinc-800 rounded-full bg-white/40 dark:bg-zinc-900/40 backdrop-blur">
        <span class="block w-1.5 h-1.5 rounded-full ${pulse ? "animate-pulse" : ""}" style="background-color:${ring}; box-shadow:0 0 6px ${ring}"></span>
        <span class="text-[9px] font-bold tracking-[0.2em] uppercase text-zinc-700 dark:text-zinc-300">${escapeHtml(train.statusText)}</span>
      </div>`;
  }

  function nextStationName(train) {
    const nodes = train.nodes || [];
    for (let i = 0; i < nodes.length; i++) {
      if (!nodes[i].ComboioPassou) {
        const station = MAPA.resolveStationByApiName(nodes[i].NomeEstacao);
        return station ? station.name : nodes[i].NomeEstacao;
      }
    }
    return null;
  }

  /** Carruagens + ocupação compactados numa célula. */
  function combinedCarriagesHtml(train) {
    const count = train.carriages || 4;
    const filled = window.MapaRender._filledCarriages(train);
    const fill = window.MapaRender._carriageFillColor(train);
    const blocks = [];
    for (let i = 0; i < count; i++) {
      const on = i < filled;
      blocks.push(
        `<div class="h-1.5 flex-1" style="background-color:${on ? fill : "rgba(161,161,170,.25)"}"></div>`,
      );
    }
    const occupancyPart =
      train.occupancy != null
        ? ` / <span style="color:${fill}">${train.occupancy}%</span>`
        : "";
    return `
      <div class="flex flex-col">
        <span class="text-[9px] uppercase tracking-[0.2em] text-zinc-400 mb-1.5">Carruagens</span>
        <span class="text-[11px] text-zinc-500 font-medium leading-none">${count} unid.${occupancyPart}</span>
        <div class="mt-2 flex gap-[2px]">${blocks.join("")}</div>
      </div>`;
  }

  /** Status chip, para a coluna direita do mini. */
  function statusNextStationHtml(train) {
    const ring = MAPA.STATUS_COLORS[train.dotStatus] || MAPA.STATUS_COLORS.gray;
    const pulse = train.dotStatus === "orange" || train.dotStatus === "red";
    return `
      <div class="flex items-center">
        <div class="inline-flex items-center gap-2 px-3 py-1.5 border border-zinc-200 dark:border-zinc-800 rounded-full bg-white/40 dark:bg-zinc-900/40 backdrop-blur">
          <span class="block w-1.5 h-1.5 rounded-full ${pulse ? "animate-pulse" : ""}" style="background-color:${ring}; box-shadow:0 0 6px ${ring}"></span>
          <span class="text-[9px] font-bold tracking-[0.2em] uppercase text-zinc-700 dark:text-zinc-300">${escapeHtml(train.statusText)}</span>
        </div>
      </div>`;
  }

  /** Timeline detalhada das estações (modo expanded). */
  // ─── TIMELINE ────────────────────────────────────────────────────────
  //
  // No mesmo formato do painel dos intermodais: trilho à esquerda, nome ao
  // meio, hora encostada à direita. As estações já passadas ficam fechadas
  // numa linha só — são as que menos interessam e, a meio do percurso,
  // empurravam a próxima estação para fora do ecrã.
  //
  // Antes da hora, um botão por cada ligação intermodal da estação. Abre o
  // painel desse operador já filtrado pela hora a que o comboio lá chega:
  // o que interessa ali é o que se apanha à saída, não o horário todo.

  // Estado da linha "Ver paragens anteriores", por comboio. Sobrevive aos
  // refresh() de 15 em 15 s, que redesenham o painel inteiro.
  const passadasAbertas = new Set();

  const LIG_LOGO = {
    ml: { src: "/imagens/lig-logos/metro.svg", nome: "Metro de Lisboa" },
    mts: { src: "/imagens/lig-logos/mts.svg", nome: "Metro Sul do Tejo" },
    cp: { src: "/imagens/lig-logos/cp.svg", nome: "CP" },
  };

  function horaDoNo(n) {
    const prog = (n.HoraProgramada || n.HoraPrevista || "").substring(0, 5);
    const prev = (n.HoraPrevista || "").substring(0, 5);
    const atraso =
      prog && prev && !prev.startsWith("HH") && prev !== prog;
    return { mostrar: atraso ? prev : prog, riscada: atraso ? prog : "", atraso };
  }

  // A hora de chegada como epoch, para o filtro dos outros painéis. Usa a
  // prevista quando existe: é a que vale para quem vai lá mudar de comboio.
  function chegadaEpoch(n) {
    const str = n.HoraPrevista && !n.HoraPrevista.startsWith("HH")
      ? n.HoraPrevista
      : n.HoraProgramada;
    if (!str) return null;
    if (window.MapaGeo && window.MapaGeo.parseTimeHHMMSS) {
      try {
        const d = window.MapaGeo.parseTimeHHMMSS(str);
        if (d && isFinite(d.getTime())) return d.getTime();
      } catch (_) {}
    }
    const [h, m, sg] = str.split(":").map(Number);
    if (!isFinite(h) || !isFinite(m)) return null;
    const d = new Date();
    d.setHours(h, m, sg || 0, 0);
    return d.getTime();
  }

  function ligacoesHtml(nomeEstacao, n) {
    const G = window.GtfsHorarios;
    if (!G || typeof G.interchangesFor !== "function") return "";
    let alvos = [];
    try {
      alvos = G.interchangesFor(nomeEstacao) || [];
    } catch (_) {
      return "";
    }
    const ts = chegadaEpoch(n);
    return alvos
      .filter((a) => LIG_LOGO[a.op])
      .map((a) => {
        const l = LIG_LOGO[a.op];
        return `<button type="button" class="dp-lig" data-dp-lig="1"
          data-op="${a.op}" data-name="${escapeHtml(a.name || "")}"
          data-stop="${escapeHtml(a.stopId || "")}" data-ts="${ts || ""}"
          title="${escapeHtml(l.nome)} a partir da chegada"
          aria-label="Ver ${escapeHtml(l.nome)} em ${escapeHtml(a.name || nomeEstacao)} a partir da chegada">
          <img src="${l.src}" alt="" data-dp-lig-img></button>`;
      })
      .join("");
  }

  function linhaHtml(train, n, i, nodes, opts) {
    const station = MAPA.resolveStationByApiName(n.NomeEstacao);
    const nome = station ? station.name : n.NomeEstacao;
    const passou = n.ComboioPassou;
    const proxima = !passou && (i === 0 || nodes[i - 1].ComboioPassou);
    const h = horaDoNo(n);
    const atraso = h.atraso && !train.isSuppressed;

    const trilho = [
      "dp-rail",
      i === 0 ? "is-first" : "",
      i === nodes.length - 1 ? "is-last" : "",
      !passou ? "is-todo" : "",
      proxima ? "is-from" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const bola = [
      "dp-dot",
      passou ? "is-past" : "",
      proxima ? "is-next" : "",
      !passou && !proxima ? "is-on" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const etiqueta = proxima
      ? `<span class="dp-tag is-next">Próxima</span>`
      : i === nodes.length - 1
        ? `<span class="dp-tag">Chegada</span>`
        : i === 0
          ? `<span class="dp-tag">Partida</span>`
          : "";

    // Ligações só onde ainda há viagem a fazer: numa estação já passada o
    // filtro "a partir da chegada" não filtrava nada.
    const lig = !passou && !opts.semLigacoes ? ligacoesHtml(nome, n) : "";

    return `
      <div class="dp-row ${passou ? "is-past" : ""} ${proxima ? "is-next" : ""}">
        <span class="${trilho}"><span class="${bola}"></span></span>
        <div class="dp-name">
          <p class="dp-nm">${escapeHtml(nome)}</p>
          ${etiqueta}
        </div>
        ${lig ? `<div class="dp-ligs">${lig}</div>` : ""}
        <div class="dp-time">
          <span class="dp-t ${atraso ? "is-late" : ""} ${proxima ? "is-next" : ""}">${h.mostrar || "--:--"}</span>
          ${atraso && h.riscada ? `<span class="dp-t-old">${h.riscada}</span>` : ""}
        </div>
      </div>`;
  }

  function timelineHtml(train) {
    const nodes = train.nodes || [];
    if (!nodes.length) {
      return `<p class="text-[10px] text-zinc-400 italic text-center py-8">Sem paragens registadas.</p>`;
    }
    ensureTimelineStyles();

    const passadas = [];
    const resto = [];
    nodes.forEach((n, i) => (n.ComboioPassou ? passadas : resto).push(i));

    const aberto = passadasAbertas.has(train.id);
    let html = "";
    if (passadas.length) {
      html += `
        <button type="button" class="dp-past-toggle" data-dp-past="1"
          aria-expanded="${aberto ? "true" : "false"}">
          <span>${aberto ? "Esconder" : "Ver"} paragens anteriores
            <span class="dp-past-n">${passadas.length}</span></span>
          <svg class="dp-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="m18 15-6-6-6 6"/></svg>
        </button>`;
      if (aberto) {
        html += `<div class="dp-past">${passadas
          .map((i) => linhaHtml(train, nodes[i], i, nodes, { semLigacoes: true }))
          .join("")}</div>`;
      }
    }
    html += resto.map((i) => linhaHtml(train, nodes[i], i, nodes, {})).join("");
    return `<div class="dp-tl">${html}</div>`;
  }

  function ensureTimelineStyles() {
    if (document.getElementById("lt-dp-tl-styles")) return;
    const el = document.createElement("style");
    el.id = "lt-dp-tl-styles";
    el.textContent = `
    .dp-tl{--dp-line:#3b82f6}
    .dp-row{display:flex;align-items:center;gap:12px;padding:10px 2px;
      border-bottom:1px solid rgba(0,0,0,.06);min-height:48px}
    html.dark .dp-row{border-bottom-color:rgba(255,255,255,.05)}
    .dp-row:last-child{border-bottom:0}
    .dp-rail{position:relative;width:14px;flex-shrink:0;align-self:stretch;
      display:flex;align-items:center;justify-content:center;margin:-10px 0}
    .dp-rail::before{content:"";position:absolute;top:0;bottom:0;width:2px;background:rgba(0,0,0,.1)}
    html.dark .dp-rail::before{background:rgba(255,255,255,.12)}
    .dp-rail.is-todo::before{background:var(--dp-line)}
    .dp-rail.is-from::before{top:50%}
    .dp-rail.is-first::before{top:50%}
    .dp-rail.is-last::before{bottom:50%}
    .dp-dot{position:relative;z-index:1;width:9px;height:9px;border-radius:999px;
      background:#fff;border:2px solid var(--dp-line)}
    html.dark .dp-dot{background:#09090b}
    .dp-dot.is-past{background:rgb(161,161,170);border-color:rgb(161,161,170)}
    html.dark .dp-dot.is-past{background:rgb(82,82,91);border-color:rgb(82,82,91)}
    .dp-dot.is-next{width:12px;height:12px;background:var(--dp-line);
      box-shadow:0 0 0 4px rgba(59,130,246,.18)}
    .dp-name{flex:1;min-width:0}
    .dp-nm{font-size:13px;font-weight:500;color:rgb(24,24,27);white-space:nowrap;
      overflow:hidden;text-overflow:ellipsis;letter-spacing:.01em}
    html.dark .dp-nm{color:#fff}
    .dp-row.is-next .dp-nm{font-weight:700}
    .dp-row.is-past .dp-nm{color:rgb(161,161,170);text-decoration:line-through;text-decoration-thickness:.5px}
    .dp-tag{display:block;margin-top:2px;font-size:8px;font-weight:700;letter-spacing:.24em;
      text-transform:uppercase;color:rgb(161,161,170)}
    .dp-tag.is-next{color:var(--dp-line)}
    .dp-ligs{display:flex;align-items:center;gap:4px;flex-shrink:0}
    .dp-lig{width:26px;height:26px;padding:0;display:inline-flex;align-items:center;justify-content:center;
      border-radius:999px;border:1px solid rgba(0,0,0,.55);background:#fff;cursor:pointer;
      transition:transform .12s ease,box-shadow .16s ease}
    html.dark .dp-lig{border-color:rgba(255,255,255,.4)}
    .dp-lig img{width:15px;height:15px;object-fit:contain;display:block}
    .dp-lig:hover{box-shadow:0 2px 8px rgba(0,0,0,.16)}
    .dp-lig:active{transform:scale(.9)}
    .dp-lig:focus-visible{outline:2px solid var(--dp-line);outline-offset:2px}
    .dp-time{flex-shrink:0;min-width:3.2rem;display:flex;flex-direction:column;align-items:flex-end}
    .dp-t{font-size:14px;font-variant-numeric:tabular-nums;color:rgb(82,82,91)}
    html.dark .dp-t{color:rgb(212,212,216)}
    .dp-t.is-next{color:var(--dp-line);font-weight:600}
    .dp-t.is-late{color:rgb(217,119,6);font-weight:600}
    html.dark .dp-t.is-late{color:rgb(251,191,36)}
    .dp-row.is-past .dp-t{color:rgb(161,161,170)}
    .dp-t-old{font-size:9px;color:rgb(161,161,170);text-decoration:line-through;
      font-variant-numeric:tabular-nums;margin-top:1px}
    .dp-past-toggle{display:flex;align-items:center;justify-content:space-between;width:100%;
      padding:11px 2px;margin-bottom:2px;background:none;border:0;
      border-bottom:1px dashed rgba(0,0,0,.12);font:inherit;cursor:pointer;
      font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:rgb(113,113,122)}
    html.dark .dp-past-toggle{border-bottom-color:rgba(255,255,255,.1);color:rgb(161,161,170)}
    .dp-past-toggle:hover{color:rgb(24,24,27)}
    html.dark .dp-past-toggle:hover{color:#fff}
    .dp-past-n{display:inline-block;margin-left:.4rem;padding:1px 6px;border-radius:999px;
      background:rgba(0,0,0,.06);font-size:9px;letter-spacing:.05em}
    html.dark .dp-past-n{background:rgba(255,255,255,.08)}
    .dp-chev{transition:transform .2s ease}
    .dp-past-toggle[aria-expanded="false"] .dp-chev{transform:rotate(180deg)}
    .dp-past{padding-bottom:4px;border-bottom:1px dashed rgba(0,0,0,.12)}
    html.dark .dp-past{border-bottom-color:rgba(255,255,255,.1)}`;
    document.head.appendChild(el);
  }

  // ─── PAINEL COMPLETO ─────────────────────────────────────────────────

  function buildContent(train) {
    ultimoComboio = train;
    const isFollow =
      window.MapaRender &&
      window.MapaRender.isFollowModeActive &&
      window.MapaRender.isFollowModeActive(train.id);
    const followColor = isFollow
      ? "text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10"
      : "text-zinc-400 hover:text-zinc-900 dark:hover:text-white";
    const firstNode = train.nodes && train.nodes[0];
    const lastNode = train.nodes && train.nodes[train.nodes.length - 1];
    const departTime =
      (firstNode &&
        (firstNode.HoraPrevista || firstNode.HoraProgramada || "").substring(
          0,
          5,
        )) ||
      "--:--";
    const arriveTime =
      (lastNode &&
        (lastNode.HoraPrevista || lastNode.HoraProgramada || "").substring(
          0,
          5,
        )) ||
      "--:--";

    // Localização REAL (TML via /mapa) vs ESTIMADA (cálculo do mapa-geo).
    const hasRealPosition = !!(
      window.MapaRender &&
      typeof window.MapaRender.isRealPosition === "function" &&
      window.MapaRender.isRealPosition(train.id)
    );

    return `
      <div class="flex flex-col h-full bg-white dark:bg-[#09090b]">

        <!-- DRAG HANDLE (visível em mobile) -->
        <div class="dp-handle md:hidden shrink-0" data-drag-area="1" aria-hidden="true">
          <div class="dp-handle-pill"></div>
        </div>

        <!-- HEADER COMPACTO -->
        <div class="dp-header relative shrink-0 px-6 pt-3 md:pt-safe-ios md:pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-900" data-drag-area="1">
          <div class="absolute right-3 flex items-center gap-1" style="top:35px">
            <!--<button
              data-details-action="follow"
              class="w-9 h-9 flex items-center justify-center transition-colors rounded-full ${followColor}"
              aria-label="Seguir condução">
              <i data-lucide="locate-fixed" class="w-[18px] h-[18px]"></i>
            </button>-->
            <button
              data-details-action="share"
              class="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors rounded-full"
              aria-label="Partilhar comboio">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"
                   viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" x2="12" y1="2" y2="15"/>
              </svg>
            </button>
            <button
              data-details-action="close"
              class="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors rounded-full"
              aria-label="Fechar">
              <i data-lucide="x" class="w-5 h-5"></i>
            </button>
          </div>

          <div class="flex items-center gap-2 mb-2 pr-24">
            <span class="text-[9px] font-bold tracking-[0.3em] uppercase text-blue-600 dark:text-blue-400">Fertagus</span>
            ${train.isExtra ? `<span class="text-[9px] font-bold tracking-[0.3em] uppercase text-blue-500 border border-blue-500/30 px-2 py-0.5">Extra</span>` : ""}
            <span class="h-px flex-1 max-w-12 bg-zinc-200 dark:bg-zinc-800"></span>
            <span class="text-[9px] font-mono tracking-wider text-zinc-400">#${escapeHtml(train.numero)}</span>
          </div>

          <h2 class="text-[22px] md:text-2xl font-light tracking-tighter text-zinc-900 dark:text-white leading-tight pr-24">
            ${escapeHtml(train.destino)} <span class="font-mono text-base font-light text-zinc-400 tracking-tight">${arriveTime}</span>
          </h2>
          <p class="text-[10px] uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-500 mt-1.5">
            De <span class="text-zinc-700 dark:text-zinc-300">${escapeHtml(train.origem)}</span>
            <span class="font-mono text-[10px] text-zinc-400 normal-case tracking-tight ml-1">${departTime}</span>
          </p>
        </div>

        <!-- MINI CONTENT (sempre visível) -->
        <div class="dp-mini-content shrink-0 px-6 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-900" data-drag-area="1">
          <div class="grid grid-cols-2 gap-5">
            ${combinedCarriagesHtml(train)}
            ${statusNextStationHtml(train)}
          </div>

          <!-- ORIGEM DA LOCALIZAÇÃO (real TML vs estimada) -->
          <div class="mt-3 flex items-center gap-1.5">
            <i data-lucide="${hasRealPosition ? "satellite-dish" : "route"}"
               class="w-3 h-3 ${hasRealPosition ? "text-emerald-500" : "text-zinc-400"} shrink-0"></i>
            <span class="text-[9px] font-medium uppercase tracking-[0.2em] ${hasRealPosition ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500"}">
              ${hasRealPosition ? "Localização Real do Comboio" : "Localização do Comboio Estimada"}
            </span>
          </div>

          ${
            train.isSuppressed
              ? `<div class="mt-4 flex items-start gap-2 p-3 rounded-sm bg-red-500/5 border border-red-500/20">
                   <i data-lucide="ban" class="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5"></i>
                   <p class="text-[10px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                     Comboio <strong class="text-red-500">suprimido</strong>. Consulte a Fertagus.
                   </p>
                 </div>`
              : ""
          }
          ${
            train.isOffline
              ? `<div class="mt-4 flex items-start gap-2 p-3 rounded-sm bg-zinc-500/5 border border-zinc-500/20">
                   <i data-lucide="wifi-off" class="w-3.5 h-3.5 text-zinc-400 shrink-0 mt-0.5"></i>
                   <p class="text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-500">
                     Dados ao vivo indisponíveis · horário programado.
                   </p>
                 </div>`
              : ""
          }
        </div>

        <!-- BOTÃO EXPANDIR / COLAPSAR -->
        <div class="dp-toggle-wrap shrink-0">
          <button
            data-details-action="toggle-expand"
            class="dp-toggle w-full py-3 flex items-center justify-center gap-2 text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors border-b border-zinc-100 dark:border-zinc-900"
            aria-label="Mostrar todas as paragens">
            <span data-toggle-text>Mais detalhes</span>
            <svg class="dp-toggle-chevron" xmlns="http://www.w3.org/2000/svg" width="14" height="14"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        </div>

        <!-- EXPANDED CONTENT (só visível em state="expanded") -->
        <div class="dp-expanded-content flex-1 overflow-y-auto px-6 py-6" data-details-scroll="1">
          <div class="flex items-center gap-3 mb-5">
            <span class="text-[9px] uppercase tracking-[0.3em] font-bold text-zinc-900 dark:text-white">Percurso</span>
            <span class="h-px flex-1 bg-zinc-200 dark:bg-zinc-800"></span>
            <span class="text-[9px] uppercase tracking-[0.2em] text-zinc-400">${(train.nodes || []).length} paragens</span>
          </div>
          ${timelineHtml(train)}
          <div class="h-4 pb-safe-ios"></div>
        </div>
      </div>`;
  }

  // ─── DRAG GESTURES ───────────────────────────────────────────────────

  function pointerY(e) {
    if (e.touches && e.touches.length) return e.touches[0].clientY;
    if (e.changedTouches && e.changedTouches.length)
      return e.changedTouches[0].clientY;
    return e.clientY;
  }

  function isDragAreaTarget(target) {
    let el = target;
    while (el && el !== panel) {
      if (el.matches && el.matches("button, a, input, [data-no-drag]"))
        return false;
      if (el.dataset && el.dataset.dragArea === "1") return true;
      el = el.parentElement;
    }
    return false;
  }

  function onPointerDown(e) {
    if (!isMobile()) return;
    if (!panel || currentState === "closed") return;
    if (!isDragAreaTarget(e.target)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;

    dragActive = true;
    dragStartY = pointerY(e);
    dragLastY = dragStartY;
    dragStartState = currentState;
    dragStartHeightPx = panel.getBoundingClientRect().height;
    dragPointerId = e.pointerId != null ? e.pointerId : null;

    panel.style.transition = "none";
    if (dragPointerId != null && panel.setPointerCapture) {
      try {
        panel.setPointerCapture(dragPointerId);
      } catch (_) {}
    }
  }

  function onPointerMove(e) {
    if (!dragActive) return;
    const y = pointerY(e);
    dragLastY = y;
    const dy = y - dragStartY;
    const vh = window.innerHeight;
    const miniTarget = Math.min(vh * 0.36, 310);
    const expandedTarget = vh * 0.92;

    if (dragStartState === "mini") {
      if (dy >= 0) {
        // Drag down: translateY com leve amortecimento depois de 180px
        const damp = dy < 180 ? dy : 180 + (dy - 180) * 0.4;
        panel.style.transform = `translateY(${damp}px)`;
        panel.style.height = `${dragStartHeightPx}px`;
      } else {
        // Drag up: aumenta altura até max ~expanded
        const grow = Math.min(-dy, expandedTarget - dragStartHeightPx);
        panel.style.transform = "";
        panel.style.height = `${dragStartHeightPx + grow}px`;
      }
    } else {
      // Started expanded
      if (dy >= 0) {
        // Drag down: encolhe altura até mini, depois translateY
        const shrinkable = dragStartHeightPx - miniTarget;
        if (dy <= shrinkable) {
          panel.style.transform = "";
          panel.style.height = `${dragStartHeightPx - dy}px`;
        } else {
          const extra = dy - shrinkable;
          const damp = extra < 180 ? extra : 180 + (extra - 180) * 0.4;
          panel.style.transform = `translateY(${damp}px)`;
          panel.style.height = `${miniTarget}px`;
        }
      } else {
        // Drag up em expanded — não faz sentido, ignora
        panel.style.transform = "";
        panel.style.height = `${dragStartHeightPx}px`;
      }
    }
  }

  function onPointerUp(e) {
    if (!dragActive) return;
    const dy = (e ? pointerY(e) : dragLastY) - dragStartY;
    dragActive = false;
    if (dragPointerId != null && panel.releasePointerCapture) {
      try {
        panel.releasePointerCapture(dragPointerId);
      } catch (_) {}
    }
    dragPointerId = null;

    // Limpa estilos inline para que CSS transitions tomem conta
    panel.style.transition = "";
    panel.style.transform = "";
    panel.style.height = "";

    const THRESH_TOGGLE = 70;
    const THRESH_CLOSE = 110;

    if (dragStartState === "mini") {
      if (dy < -THRESH_TOGGLE) {
        setState("expanded");
      } else if (dy > THRESH_CLOSE) {
        close();
      } else {
        setState("mini"); // snap back
      }
    } else if (dragStartState === "expanded") {
      const vh = window.innerHeight;
      const totalSwipeDown = dy;
      if (totalSwipeDown > vh * 0.55) {
        close();
      } else if (totalSwipeDown > THRESH_TOGGLE) {
        setState("mini");
      } else {
        setState("expanded");
      }
    }
  }

  function attachDragHandlers() {
    if (!panel) return;
    panel.addEventListener("pointerdown", onPointerDown);
    panel.addEventListener("pointermove", onPointerMove);
    panel.addEventListener("pointerup", onPointerUp);
    panel.addEventListener("pointercancel", onPointerUp);
  }

  // ─── ACÇÕES / EVENT HANDLERS ─────────────────────────────────────────

  function attachInteractions() {
    panel.querySelectorAll("[data-details-action='close']").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        close();
      });
    });
    panel.querySelectorAll("[data-details-action='share']").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        shareCurrent();
      });
    });

    // NOVO: Ação de follow mode
    panel.querySelectorAll("[data-details-action='follow']").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const train = getCurrentTrain();
        if (train && window.MapaRender) {
          const isActive = window.MapaRender.toggleFollowMode(train);
          if (isActive) {
            b.classList.remove(
              "text-zinc-400",
              "hover:text-zinc-900",
              "dark:hover:text-white",
            );
            b.classList.add(
              "text-blue-500",
              "dark:text-blue-400",
              "bg-blue-50",
              "dark:bg-blue-500/10",
            );
            setState("mini"); // Força o painel a ficar reduzido
          } else {
            b.classList.add(
              "text-zinc-400",
              "hover:text-zinc-900",
              "dark:hover:text-white",
            );
            b.classList.remove(
              "text-blue-500",
              "dark:text-blue-400",
              "bg-blue-50",
              "dark:bg-blue-500/10",
            );
          }
        }
      });
    });

    panel
      .querySelectorAll("[data-details-action='toggle-expand']")
      .forEach((b) => {
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          setState(currentState === "expanded" ? "mini" : "expanded");
        });
      });

    // "Ver paragens anteriores": abre e fecha sem perder a posição do scroll.
    panel.querySelectorAll("[data-dp-past]").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const train = getCurrentTrain();
        if (!train) return;
        if (passadasAbertas.has(train.id)) passadasAbertas.delete(train.id);
        else passadasAbertas.add(train.id);
        refresh(train);
      });
    });

    // Ligação intermodal: fecha este painel e abre o do outro operador, já
    // filtrado pela hora de chegada do comboio àquela estação.
    panel.querySelectorAll("[data-dp-lig]").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const G = window.GtfsHorarios;
        if (!G) return;
        const op = b.dataset.op;
        const nome = b.dataset.name;
        const stop = b.dataset.stop;
        const ts = Number(b.dataset.ts);
        const opts = { fromTime: isFinite(ts) && ts > 0 ? ts : undefined, name: nome };
        close();
        setTimeout(() => {
          if (stop) G.openStop(op, stop, opts);
          else G.open({ name: nome }, Object.assign({ operator: op }, opts));
        }, 140);
      });
    });

    // Sem onerror inline (CSP): um logótipo em falta tira o botão, em vez de
    // deixar um círculo vazio a pedir para ser tocado.
    panel.querySelectorAll("[data-dp-lig-img]").forEach((img) => {
      img.addEventListener(
        "error",
        function () {
          const b = this.closest(".dp-lig");
          if (b) b.remove();
        },
        { once: true },
      );
    });
  }

  function shareCurrent() {
    const train = getCurrentTrain();
    if (!train) return;
    const url = trainShareUrl(train);
    const payload = {
      title: `Fertagus #${train.numero || train.id}`,
      text: `Comboio Fertagus ${train.origem || ""} → ${train.destino || ""} (#${train.numero || train.id}) no LiveTagus`,
      url,
    };
    if (navigator.share) {
      navigator.share(payload).catch((err) => {
        if (err && err.name === "AbortError") return;
        fallbackCopy(url);
      });
    } else {
      fallbackCopy(url);
    }
  }

  function fallbackCopy(url) {
    if (window.MapaShare && window.MapaShare._copyToClipboard) {
      window.MapaShare._copyToClipboard(url).then((ok) => {
        if (ok && window.MapaShare.showToast) {
          window.MapaShare.showToast("Link Copiado!");
        }
      });
    }
  }

  // O último comboio desenhado neste painel. Os marcadores são a fonte mais
  // fresca, mas um comboio pode sair do mapa (chegou, ou deixou de vir na API)
  // com o painel ainda aberto — e aí os botões deixavam de responder.
  let ultimoComboio = null;

  function getCurrentTrain() {
    if (!currentTrainId) return null;
    if (window.MapaRender && window.MapaRender.getMarkers) {
      const m = window.MapaRender.getMarkers().get(currentTrainId);
      if (m && m.train) return m.train;
    }
    return ultimoComboio && ultimoComboio.id === currentTrainId
      ? ultimoComboio
      : null;
  }

  function setState(newState) {
    if (!panel) return;
    if (newState !== "mini" && newState !== "expanded") return;

    // NOVO: Se o utilizador expandir manualmente a sheet, paramos de o obrigar a "conduzir"
    if (
      newState === "expanded" &&
      window.MapaRender &&
      window.MapaRender.isFollowModeActive &&
      window.MapaRender.isFollowModeActive(currentTrainId)
    ) {
      window.MapaRender.toggleFollowMode(getCurrentTrain());
      const b = panel.querySelector('[data-details-action="follow"]');
      if (b) {
        b.classList.add(
          "text-zinc-400",
          "hover:text-zinc-900",
          "dark:hover:text-white",
        );
        b.classList.remove(
          "text-blue-500",
          "dark:text-blue-400",
          "bg-blue-50",
          "dark:bg-blue-500/10",
        );
      }
    }

    currentState = newState;
    panel.dataset.state = newState;
    panel.classList.remove("translate-y-full");
    panel.classList.add("translate-y-0");

    const chev = panel.querySelector(".dp-toggle-chevron");
    const text = panel.querySelector("[data-toggle-text]");
    if (chev) {
      chev.style.transform =
        newState === "expanded" ? "rotate(180deg)" : "rotate(0deg)";
    }
    if (text) {
      text.textContent =
        newState === "expanded" ? "Menos detalhes" : "Mais detalhes";
    }

    if (newState === "expanded") {
      const sc = panel.querySelector('[data-details-scroll="1"]');
      if (sc) sc.scrollTop = 0;
    }

    if (window.MapaRender && window.MapaRender.isRouteFocused()) {
      const t = getCurrentTrain();
      if (t) window.MapaRender.startRouteFocus(t);
    }
  }

  function open(train, opts) {
    if (window.MapaCM && window.MapaCM.isOpen()) window.MapaCM.close();
    ensureElements();
    if (!panel || !backdrop || !train) return;
    if (window.MapaStation && window.MapaStation.isOpen()) {
      window.MapaStation.close({ silent: true });
    }
    currentTrainId = train.id;
    const initialState = (opts && opts.state) || "mini";
    panel.innerHTML = buildContent(train);
    panel.dataset.state = initialState;
    currentState = initialState;

    attachInteractions();
    attachDragHandlers();

    // Os botões intermodais dependem do ficheiro de ligações. Se ainda não
    // estiver carregado (ninguém abriu um painel do Metro ou da CP antes),
    // o painel abre sem eles e redesenha-se quando chegar — em vez de os
    // botões simplesmente não existirem.
    const G = window.GtfsHorarios;
    if (G && typeof G.loadLigacoes === "function") {
      const id = train.id;
      G.loadLigacoes()
        .then(() => {
          if (isOpen() && currentTrainId === id) refresh(getCurrentTrain() || train);
        })
        .catch(() => {});
    }

    // Reset do scroll
    const sc = panel.querySelector('[data-details-scroll="1"]');
    if (sc) sc.scrollTop = 0;

    panel.classList.remove("translate-y-full");
    panel.classList.add("translate-y-0");

    backdrop.classList.remove("hidden");
    // Em mobile, no estado mini queremos backdrop SUBTIL (ou nenhum) para
    // o mapa continuar legível atrás. Em expanded, escurece mais.
    updateBackdropForState();

    backdrop.addEventListener("click", onBackdropClick);
    document.addEventListener("keydown", onKey);

    // Iniciar route focus
    if (window.MapaRender) {
      window.MapaRender.startRouteFocus(train);
    }

    // Chevron / texto inicial
    setStateInternal(initialState);

    if (window.lucide) window.lucide.createIcons();
  }

  function setStateInternal(s) {
    // Aplica visualmente o estado SEM disparar novo route focus
    // (já foi feito no open). Reutiliza apenas o lado visual de setState.
    panel.dataset.state = s;
    currentState = s;
    const chev = panel.querySelector(".dp-toggle-chevron");
    const text = panel.querySelector("[data-toggle-text]");
    if (chev) {
      chev.style.transform =
        s === "expanded" ? "rotate(180deg)" : "rotate(0deg)";
    }
    if (text) {
      text.textContent = s === "expanded" ? "Menos detalhes" : "Mais detalhes";
    }
    updateBackdropForState();
  }

  function updateBackdropForState() {
    if (!backdrop) return;
    if (currentState === "expanded") {
      backdrop.classList.remove("opacity-0", "pointer-events-none");
      backdrop.classList.add("opacity-100");
      backdrop.dataset.intensity = "strong";
    } else {
      // mini → não escurece para deixar o mapa visível
      backdrop.classList.add("opacity-0", "pointer-events-none");
      backdrop.classList.remove("opacity-100");
      backdrop.dataset.intensity = "soft";
    }
  }

  function onBackdropClick() {
    close();
  }

  function close() {
    ensureElements();
    if (!panel || !backdrop) return;
    panel.classList.add("translate-y-full");
    panel.classList.remove("translate-y-0");
    panel.dataset.state = "closed";
    currentState = "closed";
    backdrop.classList.add("opacity-0", "pointer-events-none");
    backdrop.classList.remove("opacity-100");

    backdrop.removeEventListener("click", onBackdropClick);
    document.removeEventListener("keydown", onKey);

    setTimeout(() => {
      backdrop.classList.add("hidden");
      if (currentTrainId !== null && currentState === "closed") {
        panel.innerHTML = "";
      }
    }, 360);

    currentTrainId = null;
    if (window.MapaRender) {
      window.MapaRender.endRouteFocus();
      window.MapaRender.showWholeLine();
    }
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  function isOpen() {
    return !!currentTrainId;
  }

  function getCurrentId() {
    return currentTrainId;
  }

  function getModalState() {
    return currentState;
  }

  function refresh(train) {
    if (!isOpen() || !train || train.id !== currentTrainId) return;
    // Captura scroll
    const sc = panel.querySelector('[data-details-scroll="1"]');
    const top = sc ? sc.scrollTop : 0;

    // Recria o conteúdo mas preserva o estado actual
    const prevState = currentState;
    panel.innerHTML = buildContent(train);
    panel.dataset.state = prevState;
    currentState = prevState;

    attachInteractions();
    attachDragHandlers();
    setStateInternal(prevState);

    const newSc = panel.querySelector('[data-details-scroll="1"]');
    if (newSc) newSc.scrollTop = top;
    if (window.lucide) window.lucide.createIcons();
  }

  window.MapaDetails = {
    open,
    close,
    isOpen,
    refresh,
    getCurrentId,
    getModalState,
    setState,
  };
})();

/**
 * detalhes-comboio.js · LiveTagus
 * ─────────────────────────────────────────────────────────────────────────────
 * Painel de detalhes de um comboio Fertagus — MÓDULO PARTILHADO.
 *
 * Um só painel para todas as páginas. A base é o painel do mapa (era o
 * mapa-details.js), que é o único terminado: bottom sheet em mobile com dois
 * estados ("mini" e "expanded", arrastável), painel lateral em desktop, vidro,
 * cabeçalho com destino/origem, carruagens + ocupação, estado, e o percurso
 * com as ligações intermodais de cada estação.
 *
 * O que muda de página para página entra por "ganchos" (create(cfg)). Sem um
 * gancho, a funcionalidade simplesmente não aparece:
 *
 *   panelId / backdropId  ids do painel e do fundo (por omissão os do mapa:
 *                         "details-panel" / "details-backdrop")
 *   autoMount             true → cria o painel e o fundo se não existirem e
 *                         injeta o CSS do invólucro (páginas sem o mapa.html)
 *   stationName(apiName)  nome bonito de uma estação (ex: "ROMA-AREEIRO")
 *   statusColors          { green, yellow, orange, red, gray }
 *   carriages(train)      { filled, fill } — carruagens pintadas e cor
 *   positionSource(train) "real" | "estimated" | null (null = sem linha)
 *   follow                { isActive(id), toggle(train) }  (só mapa)
 *   routeFocus            { start(train), end(), isFocused() } (só mapa)
 *   mapUrl(train)         URL para ver o comboio no mapa (botão "Ver no mapa")
 *   shareUrl(train)       URL a partilhar
 *   getLiveTrain(id)      versão mais fresca do comboio (refresh/acções)
 *   beforeOpen()          fecha outros painéis que partilhem o mesmo DOM
 *   ligacoes              { load(), list(nome) → [{op,name,stopId}],
 *                           open(alvo) }  — ligações que funcionam
 *                         ou { unavailable: true, load(), list(nome) } —
 *                           os logótipos aparecem mas, ao tocar, um aviso
 *                           diz que ainda não estão disponíveis aqui
 *   defaultState          "mini" | "expanded" (por omissão "mini")
 *   zIndex                só com autoMount: camada do painel e do fundo
 *                         (ex.: acima de um cabeçalho fixo da página)
 *
 * API da instância: open(train, {state}) · close() · isOpen() · refresh(train)
 *                   getCurrentId() · getModalState() · setState(s)
 *
 * O "train" tem o formato do mapa: { id, numero, origem, destino, nodes
 * (NodesPassagemComboio), carriages, occupancy, dotStatus, statusText,
 * isExtra, isSuppressed, isOffline }. Um nó com NaoPassa: true é uma estação
 * do trajeto normal que este comboio salta (trajeto anormal): aparece riscada,
 * com "Não passa nesta estação". Com semMapa: true (comboio sem marcador,
 * ex.: programado aberto a partir de uma estação) não há seguir, foco do
 * percurso nem linha de localização.
 */

(function () {
  "use strict";
  if (window.DetalhesComboio) return;

  // ─── HELPERS ───────────────────────────────────────────────────────────

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

  const STATUS_COLORS_DEFAULT = {
    green: "#10b981",
    yellow: "#f59e0b",
    orange: "#f97316",
    red: "#ef4444",
    gray: "#71717a",
  };

  const OCCUPANCY_COLORS_DEFAULT = {
    empty: "#3b82f6",
    low: "#10b981",
    medium: "#eab308",
    high: "#ef4444",
    default: "#3b82f6",
    offline: "#71717a",
  };

  // Mesmo critério do mapa-render: a sigla não diz quantas carruagens vão
  // cheias, por isso conta como "sem número" (todas pintadas a azul).
  function carriagesDefault(train) {
    const n = train.carriages || 4;
    const o = train.occupancy;
    const occ = typeof o === "number" && Number.isFinite(o) ? o : null;
    const c =
      (window.MAPA && window.MAPA.OCCUPANCY_COLORS) || OCCUPANCY_COLORS_DEFAULT;
    let fill;
    if (train.isOffline && train.occupancy == null) fill = c.offline;
    else if (occ == null) fill = c.default;
    else if (occ === 0) fill = c.empty;
    else if (occ <= 50) fill = c.low;
    else if (occ <= 85) fill = c.medium;
    else fill = c.high;
    return { filled: occ == null ? n : Math.round((occ / 100) * n), fill };
  }

  function stationNameDefault(apiName) {
    if (
      window.MAPA &&
      typeof window.MAPA.resolveStationByApiName === "function"
    ) {
      const s = window.MAPA.resolveStationByApiName(apiName);
      if (s) return s.name;
    }
    if (
      window.Partidas &&
      typeof window.Partidas.resolveStationByApiName === "function"
    ) {
      const s = window.Partidas.resolveStationByApiName(apiName);
      if (s) return s.name;
    }
    return String(apiName || "").replace(/-A$/, "");
  }

  const LIG_LOGO = {
    ml: { src: "/assets/img/logos/metro.png", nome: "Metro de Lisboa" },
    mts: { src: "/assets/img/logos/mts.png", nome: "Metro Sul do Tejo" },
    cp: { src: "/assets/img/logos/cp.png", nome: "CP" },
    cm: {
      src: "/assets/img/logos/cm-light.svg",
      nome: "Carris Metropolitana",
    },
  };

  function horaDoNo(n) {
    const prog = (n.HoraProgramada || n.HoraPrevista || "").substring(0, 5);
    const prev = (n.HoraPrevista || "").substring(0, 5);
    const atraso = prog && prev && !prev.startsWith("HH") && prev !== prog;
    return {
      mostrar: atraso ? prev : prog,
      riscada: atraso ? prog : "",
      atraso,
    };
  }

  // A hora de chegada como epoch, para o filtro dos outros painéis. Usa a
  // prevista quando existe: é a que vale para quem vai lá mudar de comboio.
  function chegadaEpoch(n) {
    const str =
      n.HoraPrevista && !n.HoraPrevista.startsWith("HH")
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

  // ─── CSS ───────────────────────────────────────────────────────────────

  // Percurso (igual em todas as páginas).
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
    .dp-row.is-past .dp-nm{color:var(--lt-ink-3);text-decoration:line-through;text-decoration-thickness:.5px}
    .dp-tag{display:block;margin-top:2px;font-size:8px;font-weight:700;letter-spacing:.24em;
      text-transform:uppercase;color:var(--lt-ink-3)}
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
    .dp-t{font-size:14px;font-variant-numeric:tabular-nums;color:var(--lt-ink-2)}
    html.dark .dp-t{color:var(--lt-ink-2)}
    .dp-t.is-next{color:var(--dp-line);font-weight:600}
    .dp-t.is-late{color:rgb(217,119,6);font-weight:600}
    html.dark .dp-t.is-late{color:rgb(251,191,36)}
    .dp-row.is-past .dp-t{color:var(--lt-ink-3)}
    .dp-row.is-skip .dp-nm,.dp-row.is-skip .dp-t{color:var(--lt-ink-3);text-decoration:line-through;
      text-decoration-color:rgba(245,158,11,.7)}
    .dp-dot.is-skip{background:transparent;border-color:rgba(245,158,11,.75)}
    .dp-tag.is-skip{color:#b45309}
    html.dark .dp-tag.is-skip{color:#f59e0b}
    .dp-t-old{font-size:9px;color:var(--lt-ink-3);text-decoration:line-through;
      font-variant-numeric:tabular-nums;margin-top:1px}
    .dp-past-toggle{display:flex;align-items:center;justify-content:space-between;width:100%;
      padding:11px 2px;margin-bottom:2px;background:none;border:0;
      border-bottom:1px dashed rgba(0,0,0,.12);font:inherit;cursor:pointer;
      font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--lt-ink-3)}
    html.dark .dp-past-toggle{border-bottom-color:rgba(255,255,255,.1);color:var(--lt-ink-3)}
    .dp-past-toggle:hover{color:rgb(24,24,27)}
    html.dark .dp-past-toggle:hover{color:#fff}
    .dp-past-n{display:inline-block;margin-left:.4rem;padding:1px 6px;border-radius:999px;
      background:rgba(0,0,0,.06);font-size:9px;letter-spacing:.05em}
    html.dark .dp-past-n{background:rgba(255,255,255,.08)}
    .dp-chev{transition:transform .2s ease}
    .dp-past-toggle[aria-expanded="false"] .dp-chev{transform:rotate(180deg)}
    .dp-past{padding-bottom:4px;border-bottom:1px dashed rgba(0,0,0,.12)}
    html.dark .dp-past{border-bottom-color:rgba(255,255,255,.1)}
    .dp-lig.is-na{opacity:.55}
    .dp-pill{position:absolute;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));
      z-index:5;transform:translate(-50%,8px);opacity:0;pointer-events:none;
      max-width:calc(100% - 32px);padding:8px 14px;border-radius:999px;
      background:rgba(24,24,27,.92);color:#fff;font-size:11px;font-weight:600;
      letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      box-shadow:0 6px 20px -6px rgba(0,0,0,.4);transition:opacity .18s ease,transform .18s ease}
    html.dark .dp-pill{background:rgba(250,250,250,.94);color:#09090b}
    .dp-pill.is-on{opacity:1;transform:translate(-50%,0)}`;
    document.head.appendChild(el);
  }

  // Invólucro do painel (só para páginas sem o CSS do mapa.html). É uma cópia
  // das regras do #details-panel do mapa.html: o painel tem de ser IGUAL.
  function ensureShellStyles(panelId, backdropId, zIndex) {
    const id = "lt-dp-shell-styles-" + panelId;
    if (document.getElementById(id)) return;
    const P = "#" + panelId;
    const B = "#" + backdropId;
    const el = document.createElement("style");
    el.id = id;
    el.textContent = `
    ${P}{transition:transform .36s cubic-bezier(.22,.61,.36,1),height .32s cubic-bezier(.22,.61,.36,1);
      overscroll-behavior:contain;-webkit-overflow-scrolling:touch;will-change:transform,height;
      overflow-y:auto!important}
    ${B}{transition:opacity .3s ease}
    ${zIndex != null ? `${P},${B}{z-index:${Number(zIndex)}}` : ""}
    @media (max-width:767.98px){
      ${P}{left:0;right:0;bottom:0;height:50dvh;max-height:92dvh}
      ${P}[data-state="mini"]{height:clamp(250px,36dvh,310px)}
      ${P}[data-state="expanded"]{height:92dvh}
      ${P}[data-state="closed"]{height:clamp(250px,36dvh,310px)}
      ${P}[data-state="mini"] .dp-expanded-content{display:none}
    }
    @media (min-width:768px){
      ${P}{left:auto;right:2rem;bottom:2rem;top:auto;width:440px;max-height:80dvh;height:auto}
      ${P}[data-state="mini"],${P}[data-state="expanded"]{height:auto}
      ${P}[data-state="closed"]{transform:translateY(calc(100% + 4rem))!important;pointer-events:none}
      ${P} .dp-expanded-content{display:block}
      ${P} .dp-toggle-wrap{display:none}
      ${P} .dp-handle{display:none}
    }
    ${P} .dp-handle{height:22px;display:flex;align-items:center;justify-content:center;cursor:grab;
      touch-action:none;user-select:none;-webkit-user-select:none}
    ${P} .dp-handle:active{cursor:grabbing}
    @media (min-width:768px){${P} .dp-handle{display:none}}
    ${P} .dp-handle-pill{width:38px;height:4px;border-radius:999px;background:var(--lt-line-strong);
      transition:background .2s ease}
    ${P} .dp-header,${P} .dp-mini-content{touch-action:none}
    ${P} .dp-toggle-chevron{transition:transform .28s cubic-bezier(.22,.61,.36,1);transform:rotate(0deg)}
    ${P} [data-details-scroll]{scrollbar-width:thin;scrollbar-color:rgba(161,161,170,.25) transparent}
    ${P} [data-details-scroll]::-webkit-scrollbar{width:4px}
    ${P} [data-details-scroll]::-webkit-scrollbar-thumb{background:rgba(161,161,170,.25);border-radius:2px}
    body.is-ios ${P} .pb-safe-ios{padding-bottom:env(safe-area-inset-bottom)}
    @media (prefers-reduced-motion:reduce){
      ${P},${P} .dp-toggle-chevron{animation:none!important;transition:none!important}
    }
    ${P}{
      --lt-glass:rgba(250,250,251,.74);--lt-edge:rgba(255,255,255,.75);
      --lt-shadow:0 -12px 40px -14px rgba(0,0,0,.28);--lt-blur:blur(28px) saturate(175%);
      --lt-ink:#09090b;--lt-ink-2:#27272a;--lt-ink-3:#52525b;
      --lt-line:rgba(9,9,11,.09);--lt-line-strong:rgba(9,9,11,.2);--lt-hover:rgba(9,9,11,.045);
      color:var(--lt-ink)}
    html.dark ${P}{
      --lt-glass:rgba(20,20,24,.74);--lt-edge:rgba(255,255,255,.09);
      --lt-shadow:0 -12px 40px -14px rgba(0,0,0,.7);--lt-blur:blur(28px) saturate(140%);
      --lt-ink:#fafafa;--lt-ink-2:#e4e4e7;--lt-ink-3:#a1a1aa;
      --lt-line:rgba(255,255,255,.08);--lt-line-strong:rgba(255,255,255,.22);--lt-hover:rgba(255,255,255,.05)}
    @supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
      ${P}{--lt-glass:rgba(250,250,251,.97)} html.dark ${P}{--lt-glass:rgba(20,20,24,.97)}
    }
    @media (prefers-reduced-transparency:reduce){
      ${P}{--lt-glass:rgba(250,250,251,.97)} html.dark ${P}{--lt-glass:rgba(20,20,24,.97)}
    }
    ${P}.lt-glass{background:var(--lt-glass);-webkit-backdrop-filter:var(--lt-blur);backdrop-filter:var(--lt-blur)}
    @media (max-width:767.98px){
      ${P}.lt-glass{border:0;border-top:1px solid var(--lt-edge);border-radius:20px 20px 0 0;box-shadow:var(--lt-shadow)}
    }
    @media (min-width:768px){
      ${P}.lt-glass{border:1px solid var(--lt-edge);border-radius:18px;
        box-shadow:0 24px 60px -24px rgba(0,0,0,.35),0 2px 8px rgba(0,0,0,.06)}
      html.dark ${P}.lt-glass{box-shadow:0 24px 60px -20px rgba(0,0,0,.8),0 2px 8px rgba(0,0,0,.4)}
    }
    html:not(.dark) ${P} :is(.text-zinc-400,.text-zinc-500,.text-zinc-600,.text-gray-400,.text-gray-500){color:var(--lt-ink-3)}
    html:not(.dark) ${P} :is(.text-zinc-700,.text-zinc-800){color:var(--lt-ink-2)}
    html.dark ${P} :is(.dark\\:text-zinc-400,.dark\\:text-zinc-500,.dark\\:text-zinc-600,.dark\\:text-zinc-700){color:var(--lt-ink-3)}
    html.dark ${P} :is(.dark\\:text-zinc-300,.dark\\:text-zinc-200){color:var(--lt-ink-2)}
    html.dark ${P} :is(.text-zinc-400,.text-zinc-500,.text-zinc-600):not([class*="dark:text-"]){color:var(--lt-ink-3)}
    html:not(.dark) ${P} :is(.hover\\:text-zinc-900,.hover\\:text-zinc-700):hover{color:var(--lt-ink)}
    html.dark ${P} .dark\\:hover\\:text-white:hover{color:var(--lt-ink)}
    html:not(.dark) ${P} :is(.border-zinc-100,.border-zinc-200){border-color:var(--lt-line)}
    html.dark ${P} :is(.dark\\:border-zinc-800,.dark\\:border-zinc-900){border-color:var(--lt-line)}
    html:not(.dark) ${P} :is(.text-blue-600,.text-blue-500){color:#1d4ed8}
    html:not(.dark) ${P} :is(.text-emerald-500,.text-emerald-600,.text-green-600){color:#046c4e}
    html:not(.dark) ${P} :is(.dp-tag.is-next,.dp-t.is-next){color:#1d4ed8}
    html.dark ${P} :is(.dp-tag.is-next,.dp-t.is-next){color:#60a5fa}
    ${P} .lt-occ{color:var(--occ);font-weight:700}
    html:not(.dark) ${P} .lt-occ{color:color-mix(in srgb,var(--occ) 55%,#000)}
    html.dark ${P} .lt-occ{color:color-mix(in srgb,var(--occ) 72%,#fff)}`;
    document.head.appendChild(el);
  }

  // ═══ LIGAÇÕES DA FERTAGUS (páginas sem o mapa) ═══════════════════════════
  // O mesmo ficheiro que o mapa e a página da estação usam. Devolve, por
  // estação, os operadores com ligação, já com os códigos dos logótipos.
  const LIGACOES_JSON = "/data/json/ligacoes_atualizado.json";
  const LIG_TIPO_OP = { metro: "ml", mts: "mts", cp: "cp", cm: "cm" };
  let ligMapa = null;
  let ligPromessa = null;

  function normEstacao(v) {
    return String(v == null ? "" : v)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/-A$/, "")
      .replace(/[^A-Z0-9]+/g, " ")
      .trim();
  }

  function carregarLigacoes() {
    if (ligMapa) return Promise.resolve(ligMapa);
    if (ligPromessa) return ligPromessa;
    ligPromessa = fetch(LIGACOES_JSON)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const m = new Map();
        for (const id in data || {}) {
          const e = data[id];
          if (!e || !e.name || !e.ligacoes) continue;
          const tipos = Object.keys(e.ligacoes).filter(
            (t) => (e.ligacoes[t] || []).length && LIG_TIPO_OP[t],
          );
          if (tipos.length) m.set(normEstacao(e.name), tipos);
        }
        ligMapa = m;
        return m;
      })
      .catch(() => {
        ligMapa = new Map();
        return ligMapa;
      });
    return ligPromessa;
  }

  function ligacoesDaEstacao(nome) {
    if (!ligMapa) return [];
    return (ligMapa.get(normEstacao(nome)) || []).map((t) => ({
      op: LIG_TIPO_OP[t],
      name: nome,
    }));
  }

  // ═══ INSTÂNCIA ══════════════════════════════════════════════════════════

  function create(cfg) {
    cfg = cfg || {};
    const panelId = cfg.panelId || "details-panel";
    const backdropId = cfg.backdropId || "details-backdrop";
    const stationName = cfg.stationName || stationNameDefault;
    const statusColors = cfg.statusColors || STATUS_COLORS_DEFAULT;
    const carriagesOf = cfg.carriages || carriagesDefault;
    const lig = cfg.ligacoes || null;

    let panel, backdrop;
    let currentTrainId = null;
    let currentState = "closed"; // 'closed' | 'mini' | 'expanded'
    let dragActive = false;
    let dragStartY = 0;
    let dragLastY = 0;
    let dragStartState = null;
    let dragStartHeightPx = 0;
    let dragPointerId = null;
    let dragAttached = false;
    let pillTimer = null;

    // Estado da linha "Ver paragens anteriores", por comboio. Sobrevive aos
    // refresh() periódicos, que redesenham o painel inteiro.
    const passadasAbertas = new Set();

    // O último comboio desenhado neste painel. A fonte "viva" (getLiveTrain)
    // é a mais fresca, mas um comboio pode deixar de vir na API com o painel
    // ainda aberto — e aí os botões deixavam de responder.
    let ultimoComboio = null;

    function ensureElements() {
      if (panel && backdrop) return;
      panel = document.getElementById(panelId);
      backdrop = document.getElementById(backdropId);
      if ((!panel || !backdrop) && cfg.autoMount) {
        if (!backdrop) {
          backdrop = document.createElement("div");
          backdrop.id = backdropId;
          backdrop.className =
            "hidden fixed inset-0 z-30 bg-black/40 opacity-0 pointer-events-none";
          document.body.appendChild(backdrop);
        }
        if (!panel) {
          panel = document.createElement("div");
          panel.id = panelId;
          panel.className =
            "lt-glass fixed z-30 translate-y-full overflow-hidden";
          panel.dataset.state = "closed";
          panel.setAttribute("role", "dialog");
          panel.setAttribute("aria-modal", "true");
          document.body.appendChild(panel);
        }
      }
      if (cfg.autoMount) ensureShellStyles(panelId, backdropId, cfg.zIndex);
      if (!panel || !backdrop) {
        console.error("[DetalhesComboio] Elementos DOM ausentes");
      }
    }

    function shareUrlOf(train) {
      if (typeof cfg.shareUrl === "function") return cfg.shareUrl(train);
      try {
        const base = window.location.origin + window.location.pathname;
        return `${base}#${encodeURIComponent(train.id)}`;
      } catch (_) {
        return `https://livetagus.pt/mapa#${train.id}`;
      }
    }

    // ─── BUILDERS DE BLOCOS ──────────────────────────────────────────────

    /** Carruagens + ocupação compactados numa célula. */
    function combinedCarriagesHtml(train) {
      const count = train.carriages || 4;
      const c = carriagesOf(train);
      const filled = c.filled;
      const fill = c.fill;
      const blocks = [];
      for (let i = 0; i < count; i++) {
        const on = i < filled;
        blocks.push(
          `<div class="h-1.5 flex-1" style="background-color:${on ? fill : "rgba(161,161,170,.25)"}"></div>`,
        );
      }
      const LABELS = {
        MB: "Muito Baixa",
        B: "Baixa",
        M: "Média",
        A: "Média Alta",
        MA: "Muito Alta",
      };
      const occ = train.occupancy;
      let occupancyPart = "";
      if (occ != null) {
        // As carruagens ficam azuis com a sigla; o texto mantém a cor do nível.
        const SIGLA_COR = {
          MB: "#10b981",
          B: "#22c55e",
          M: "#eab308",
          A: "#f97316",
          MA: "#ef4444",
        };
        const cor = typeof occ === "string" ? SIGLA_COR[occ] || fill : fill;
        const txt = typeof occ === "string" ? LABELS[occ] || occ : `${occ}%`;
        occupancyPart = ` / <span class="lt-occ" style="--occ:${cor}">${txt}</span>`;
      }
      return `
      <div class="flex flex-col">
        <span class="text-[11px] text-zinc-500 font-medium leading-none">${count} carruagens${occupancyPart}</span>
        <div class="mt-2 flex gap-[2px]">${blocks.join("")}</div>
      </div>`;
    }

    /** Status chip, para a coluna direita do mini. */
    function statusNextStationHtml(train) {
      const ring = statusColors[train.dotStatus] || statusColors.gray;
      const pulse = train.dotStatus === "orange" || train.dotStatus === "red";
      return `
      <div class="flex items-center">
        <div class="inline-flex items-center gap-2 px-3 py-1.5 border border-zinc-200 dark:border-zinc-800 rounded-full bg-white/40 dark:bg-zinc-900/40 backdrop-blur">
          <span class="block w-1.5 h-1.5 rounded-full ${pulse ? "animate-pulse" : ""}" style="background-color:${ring}; box-shadow:0 0 6px ${ring}"></span>
          <span class="text-[9px] font-bold tracking-[0.2em] uppercase text-zinc-700 dark:text-zinc-300">${escapeHtml(train.statusText)}</span>
        </div>
      </div>`;
    }

    // ─── TIMELINE ──────────────────────────────────────────────────────
    //
    // Trilho à esquerda, nome ao meio, hora encostada à direita. As estações
    // já passadas ficam fechadas numa linha só — são as que menos interessam
    // e, a meio do percurso, empurravam a próxima estação para fora do ecrã.
    //
    // Antes da hora, um botão por cada ligação intermodal da estação. No mapa
    // abre o painel desse operador já filtrado pela hora de chegada; fora do
    // mapa (por agora) mostra só que ainda não está disponível.

    function ligacoesHtml(nomeEstacao, n) {
      if (!lig || typeof lig.list !== "function") return "";
      let alvos = [];
      try {
        alvos = lig.list(nomeEstacao) || [];
      } catch (_) {
        alvos = [];
      }
      if (!alvos.length) return "";
      const ts = chegadaEpoch(n);
      const na = !!lig.unavailable;
      return alvos
        .filter((a) => LIG_LOGO[a.op])
        .map((a) => {
          const l = LIG_LOGO[a.op];
          return `<button type="button" class="dp-lig${na ? " is-na" : ""}" data-dp-lig="1"
          data-op="${a.op}" data-name="${escapeHtml(a.name || "")}"
          data-stop="${escapeHtml(a.stopId || "")}" data-ts="${ts || ""}"
          title="${escapeHtml(l.nome)}${na ? " · ainda não disponível aqui" : " a partir da chegada"}"
          aria-label="${na ? `${escapeHtml(l.nome)} em ${escapeHtml(a.name || nomeEstacao)} (ainda não disponível aqui)` : `Ver ${escapeHtml(l.nome)} em ${escapeHtml(a.name || nomeEstacao)} a partir da chegada`}">
          <img src="${l.src}" alt="" data-dp-lig-img></button>`;
        })
        .join("");
    }

    function linhaHtml(train, n, i, nodes, opts) {
      const nome = stationName(n.NomeEstacao) || n.NomeEstacao;
      const passou = n.ComboioPassou;
      // As estações saltadas (NaoPassa) não contam para "próxima", "partida"
      // nem "chegada": só as servidas.
      let ant = null;
      for (let k = i - 1; k >= 0; k--) {
        if (!nodes[k].NaoPassa) {
          ant = nodes[k];
          break;
        }
      }
      const servidas = nodes.filter((x) => !x.NaoPassa);
      const proxima = !n.NaoPassa && !passou && (!ant || ant.ComboioPassou);
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

      if (n.NaoPassa) {
        return `
      <div class="dp-row is-skip">
        <span class="${trilho}"><span class="dp-dot is-skip"></span></span>
        <div class="dp-name">
          <p class="dp-nm">${escapeHtml(nome)}</p>
          <span class="dp-tag is-skip">Não passa nesta estação</span>
        </div>
        <div class="dp-time"><span class="dp-t">${h.mostrar || "--:--"}</span></div>
      </div>`;
      }

      const etiqueta = proxima
        ? `<span class="dp-tag is-next">Próxima</span>`
        : n === servidas[servidas.length - 1]
          ? `<span class="dp-tag">Chegada</span>`
          : n === servidas[0]
            ? `<span class="dp-tag">Partida</span>`
            : "";

      // Ligações só onde ainda há viagem a fazer: numa estação já passada o
      // filtro "a partir da chegada" não filtrava nada.
      const ligs = !passou && !opts.semLigacoes ? ligacoesHtml(nome, n) : "";

      return `
      <div class="dp-row ${passou ? "is-past" : ""} ${proxima ? "is-next" : ""}">
        <span class="${trilho}"><span class="${bola}"></span></span>
        <div class="dp-name">
          <p class="dp-nm">${escapeHtml(nome)}</p>
          ${etiqueta}
        </div>
        ${ligs ? `<div class="dp-ligs">${ligs}</div>` : ""}
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
            .map((i) =>
              linhaHtml(train, nodes[i], i, nodes, { semLigacoes: true }),
            )
            .join("")}</div>`;
        }
      }
      html += resto
        .map((i) => linhaHtml(train, nodes[i], i, nodes, {}))
        .join("");
      return `<div class="dp-tl">${html}</div>`;
    }

    // ─── PAINEL COMPLETO ───────────────────────────────────────────────

    function followActive(id) {
      return !!(cfg.follow && cfg.follow.isActive(id));
    }

    // O foco do percurso só existe para comboios que estão no mapa; e só se
    // desfaz se tiver sido feito.
    let focoAtivo = false;
    function focar(train) {
      if (!cfg.routeFocus || !train) return;
      // Sem marcador: largar o foco de um comboio anterior, se houver.
      if (train.semMapa) return desfocar();
      cfg.routeFocus.start(train);
      focoAtivo = true;
    }
    function desfocar() {
      if (!cfg.routeFocus || !focoAtivo) return;
      focoAtivo = false;
      cfg.routeFocus.end();
    }

    function positionHtml(train) {
      if (typeof cfg.positionSource !== "function" || train.semMapa) return "";
      const src = cfg.positionSource(train);
      if (src !== "real" && src !== "estimated") return "";
      const real = src === "real";
      return `
          <!-- ORIGEM DA LOCALIZAÇÃO (real TML vs estimada) -->
          <div class="mt-3 flex items-center gap-1.5">
            <i data-lucide="${real ? "satellite-dish" : "route"}"
               class="w-3 h-3 ${real ? "text-emerald-500" : "text-zinc-400"} shrink-0"></i>
            <span class="text-[9px] font-medium uppercase tracking-[0.2em] ${real ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500"}">
              ${real ? "Localização Real do Comboio" : "Localização do Comboio Estimada"}
            </span>
          </div>`;
    }

    function buildContent(train) {
      ultimoComboio = train;
      const isFollow = followActive(train.id);
      const followColor = isFollow
        ? "text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10"
        : "text-zinc-400 hover:text-zinc-900 dark:hover:text-white";
      const servidas = (train.nodes || []).filter((n) => !n.NaoPassa);
      const firstNode = servidas[0];
      const lastNode = servidas[servidas.length - 1];
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
      const mapUrl =
        typeof cfg.mapUrl === "function" ? cfg.mapUrl(train) : null;

      return `
    <div class="lt-shell flex flex-col h-full">

        <!-- DRAG HANDLE (visível em mobile) -->
        <div class="dp-handle md:hidden shrink-0" data-drag-area="1" aria-hidden="true">
          <div class="dp-handle-pill"></div>
        </div>

        <!-- HEADER COMPACTO -->
        <div class="dp-header relative shrink-0 px-6 pt-3 md:pt-safe-ios md:pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-900" data-drag-area="1">
          <div class="absolute right-3 flex items-center gap-1" style="top:35px">
            ${
              cfg.follow && !train.semMapa
                ? `<button
              data-details-action="follow"
              class="md:hidden w-9 h-9 flex items-center justify-center transition-colors rounded-full ${followColor}"
              aria-label="Seguir condução">
              <i data-lucide="locate-fixed" class="w-[18px] h-[18px]"></i>
            </button>`
                : ""
            }
            ${
              mapUrl
                ? `<a
              href="${escapeHtml(mapUrl)}"
              data-details-action="map"
              class="w-9 h-9 flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors rounded-full"
              aria-label="Ver no mapa" title="Ver no mapa">
              <i data-lucide="map" class="w-[18px] h-[18px]"></i>
            </a>`
                : ""
            }
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
${positionHtml(train)}
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
          ${timelineHtml(train)}
          <div class="h-4 pb-safe-ios"></div>
        </div>
      </div>`;
    }

    // ─── DRAG GESTURES ─────────────────────────────────────────────────

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
      // O #details-panel é o MESMO elemento entre aberturas (no mapa é
      // partilhado com outros painéis): os listeners só se ligam uma vez.
      if (!panel || dragAttached) return;
      dragAttached = true;
      panel.addEventListener("pointerdown", onPointerDown);
      panel.addEventListener("pointermove", onPointerMove);
      panel.addEventListener("pointerup", onPointerUp);
      panel.addEventListener("pointercancel", onPointerUp);
    }

    // ─── AVISO (pill) ──────────────────────────────────────────────────

    function showPill(text) {
      if (!panel) return;
      let pill = panel.querySelector("[data-dp-pill]");
      if (!pill) {
        pill = document.createElement("div");
        pill.className = "dp-pill";
        pill.setAttribute("data-dp-pill", "1");
        pill.setAttribute("role", "status");
        pill.setAttribute("aria-live", "polite");
        panel.appendChild(pill);
      }
      pill.textContent = text;
      // força o reflow para a transição repetir em toques seguidos
      void pill.offsetWidth;
      pill.classList.add("is-on");
      if (pillTimer) clearTimeout(pillTimer);
      pillTimer = setTimeout(() => pill.classList.remove("is-on"), 2200);
    }

    // ─── ACÇÕES / EVENT HANDLERS ───────────────────────────────────────

    function setFollowButton(b, on) {
      const OFF = [
        "text-zinc-400",
        "hover:text-zinc-900",
        "dark:hover:text-white",
      ];
      const ON = [
        "text-blue-500",
        "dark:text-blue-400",
        "bg-blue-50",
        "dark:bg-blue-500/10",
      ];
      if (on) {
        b.classList.remove(...OFF);
        b.classList.add(...ON);
      } else {
        b.classList.add(...OFF);
        b.classList.remove(...ON);
      }
    }

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

      // Seguir o comboio (só onde há mapa).
      panel.querySelectorAll("[data-details-action='follow']").forEach((b) => {
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          const train = getCurrentTrain();
          if (!train || !cfg.follow) return;
          const isActive = cfg.follow.toggle(train);
          setFollowButton(b, !!isActive);
          if (isActive) setState("mini"); // Força o painel a ficar reduzido
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

      // Ligação intermodal.
      panel.querySelectorAll("[data-dp-lig]").forEach((b) => {
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!lig) return;
          if (lig.unavailable || typeof lig.open !== "function") {
            showPill("Ligações ainda não disponíveis aqui · abre no mapa");
            return;
          }
          const ts = Number(b.dataset.ts);
          const alvo = {
            op: b.dataset.op,
            name: b.dataset.name,
            stopId: b.dataset.stop,
            fromTime: isFinite(ts) && ts > 0 ? ts : undefined,
          };
          close();
          setTimeout(() => lig.open(alvo), 140);
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
      const url = shareUrlOf(train);
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
        return;
      }
      // Fora do mapa: área de transferência + o mesmo pill do painel.
      try {
        navigator.clipboard
          .writeText(url)
          .then(() => showPill("Link copiado"))
          .catch(() => {});
      } catch (_) {}
    }

    function getCurrentTrain() {
      if (!currentTrainId) return null;
      if (typeof cfg.getLiveTrain === "function") {
        const t = cfg.getLiveTrain(currentTrainId);
        if (t) return t;
      }
      return ultimoComboio && ultimoComboio.id === currentTrainId
        ? ultimoComboio
        : null;
    }

    function applyStateVisuals(s) {
      panel.dataset.state = s;
      currentState = s;
      const chev = panel.querySelector(".dp-toggle-chevron");
      const text = panel.querySelector("[data-toggle-text]");
      if (chev) {
        chev.style.transform =
          s === "expanded" ? "rotate(180deg)" : "rotate(0deg)";
      }
      if (text) {
        text.textContent =
          s === "expanded" ? "Menos detalhes" : "Mais detalhes";
      }
    }

    function setState(newState) {
      if (!panel) return;
      if (newState !== "mini" && newState !== "expanded") return;

      // Se o utilizador expandir manualmente a sheet, deixa de o "conduzir".
      if (newState === "expanded" && followActive(currentTrainId)) {
        cfg.follow.toggle(getCurrentTrain());
        const b = panel.querySelector('[data-details-action="follow"]');
        if (b) setFollowButton(b, false);
      }

      applyStateVisuals(newState);
      panel.classList.remove("translate-y-full");
      panel.classList.add("translate-y-0");

      if (newState === "expanded") {
        const sc = panel.querySelector('[data-details-scroll="1"]');
        if (sc) sc.scrollTop = 0;
      }

      if (cfg.routeFocus && cfg.routeFocus.isFocused())
        focar(getCurrentTrain());
    }

    function open(train, opts) {
      if (typeof cfg.beforeOpen === "function") cfg.beforeOpen();
      ensureElements();
      if (!panel || !backdrop || !train) return;
      currentTrainId = train.id;
      const initialState = (opts && opts.state) || cfg.defaultState || "mini";
      panel.innerHTML = buildContent(train);
      panel.dataset.state = initialState;
      currentState = initialState;

      attachInteractions();
      attachDragHandlers();

      // Os botões intermodais dependem do ficheiro de ligações. Se ainda não
      // estiver carregado, o painel abre sem eles e redesenha-se quando chegar
      // — em vez de os botões simplesmente não existirem.
      if (lig && typeof lig.load === "function") {
        const id = train.id;
        Promise.resolve()
          .then(() => lig.load())
          .then(() => {
            if (isOpen() && currentTrainId === id)
              refresh(getCurrentTrain() || train);
          })
          .catch(() => {});
      }

      // Reset do scroll
      const sc = panel.querySelector('[data-details-scroll="1"]');
      if (sc) sc.scrollTop = 0;

      panel.classList.remove("translate-y-full");
      panel.classList.add("translate-y-0");

      backdrop.classList.remove("hidden");
      // Em mini o fundo não escurece nem bloqueia (o que está atrás continua
      // utilizável); em expanded escurece.
      updateBackdropForState();

      backdrop.addEventListener("click", onBackdropClick);
      document.addEventListener("keydown", onKey);

      focar(train);

      // Chevron / texto inicial
      setStateInternal(initialState);

      if (window.lucide) window.lucide.createIcons();
    }

    function setStateInternal(s) {
      // Aplica visualmente o estado SEM disparar novo route focus.
      applyStateVisuals(s);
      updateBackdropForState();
    }

    function updateBackdropForState() {
      if (!backdrop) return;
      if (currentState === "expanded") {
        backdrop.classList.remove("pointer-events-none", "rounded-t-2xl");
        backdrop.classList.add("md:opacity-100", "rounded-none");
        backdrop.dataset.intensity = "soft";
      } else {
        backdrop.classList.add("pointer-events-none", "rounded-t-2xl");
        backdrop.classList.remove("md:opacity-100", "rounded-none");
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
      desfocar();
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

    return {
      open,
      close,
      isOpen,
      refresh,
      getCurrentId,
      getModalState,
      setState,
    };
  }

  window.DetalhesComboio = {
    create,
    carregarLigacoes, // → Promise; depois disso, ligacoesDaEstacao(nome)
    ligacoesDaEstacao, // → [{ op, name }] para o gancho ligacoes.list
  };
})();

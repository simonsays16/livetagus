/**
 * mapa-search.js · LiveTagus (mapa)
 * ─────────────────────────────────────────────────────────────────────────────
 * Pesquisa de ESTAÇÕES e PARAGENS no mapa, com filtro por operador.
 *
 * Botão flutuante (estilo "glass") logo ABAIXO do hambúrguer do menu. Ao tocar
 * abre um overlay de pesquisa (campo + chips de operador + resultados). Ao
 * escolher um resultado, abre a MESMA sheet de partidas que o clique no mapa:
 *
 *   • Guardadas → window.MapaCM.open(stop)            (as do utilizador, 1º)
 *   • Fertagus  → window.MapaStation.open(station)   (station = MAPA.STATIONS[i])
 *   • Metro ML  → window.GtfsHorarios.open(props, { operator: "ml" })
 *   • Metro Sul → window.GtfsHorarios.open(props, { operator: "mts" })
 *   • Carris    → window.MapaCM.open(stop)            (paragens verificadas)
 *
 * Cada resultado é identificado pelo LOGÓTIPO do operador (não pelo nome), com
 * o glifo genérico como fallback se a imagem não carregar.
 *
 * Auto-contido: fontes de dados lidas diretamente (MAPA.STATIONS já é global,
 * MTS e Metro de Lisboa via /geojson, Carris via window.MapaCM.getStops(),
 * guardadas via window.MapaGuardadas.getStops()). Sem dependências de
 * classes Tailwind não compiladas — todo o CSS é injetado aqui (mesmo padrão
 * do mapa-metro-lisboa.js / mapa-mts-horarios.js). CSP-safe: só addEventListener.
 *
 * Inclusão:  <script src="./mapa-search.js" defer></script>  (depois do mapa-cm.js)
 */

(function () {
  "use strict";
  if (window.MapaSearch) return;

  // ═══ CONFIG / FONTES ═════════════════════════════════════════════════════════
  const MTS_STATIONS_PATH = "/geojson/mts-stations.geojson";
  const ML_STATIONS_PATH = "/geojson/estacoes-metro.geojson";
  const MAX_RESULTS = 60;

  // ── FAVORITOS ──────────────────────────────────────────────────────────────
  // Paragens Carris vão para a MESMA chave da página /paragens, com a mesma
  // forma e o mesmo limite, para as duas páginas verem a mesma lista.
  const CM_SAVED_KEY = "cm_saved_stops"; // igual ao STORAGE_KEY do paragens.js
  const CM_MAX = 10; // igual ao MAX_STOPS do paragens.js
  // Estações de comboio/metro não cabem nessa estrutura (não têm id Carris nem
  // carreiras), por isso têm chave própria.
  const STATIONS_SAVED_KEY = "lt_saved_stations";

  // Cores oficiais das linhas do Metro de Lisboa (iguais ao mapa-metro-lisboa.js).
  const ML_LINE_COLORS = {
    Azul: "#4E84C4",
    Amarela: "#F4BC18",
    Verde: "#00AAA6",
    Vermelha: "#DF096F",
  };

  // Metadados por operador: logótipo (o que identifica a linha no resultado),
  // cor da bolinha, e glifo de reserva se a imagem falhar.
  const OPERATORS = {
    guardadas: {
      label: "Guardadas",
      dot: "#FFDD00",
      glyph: "bus",
      logo: "/imagens/lig-logos/cm-light.svg",
      logoDark: "/imagens/lig-logos/cm-dark.svg",
      star: true,
    },
    fertagus: {
      label: "Fertagus",
      dot: "#7c3aed",
      glyph: "rail",
      logo: "/imagens/lig-logos/fertagus.png",
    },
    ml: {
      label: "Metro Lisboa",
      dot: "#e2231a",
      glyph: "metro",
      logo: "/imagens/lig-logos/metro.svg",
    },
    mts: {
      label: "Metro Sul",
      dot: "#6cc24a",
      glyph: "metro",
      logo: "/imagens/lig-logos/mts.svg",
    },
    cm: {
      label: "Carris Metropolitana",
      dot: "#f5b700",
      glyph: "bus",
      logo: "/imagens/lig-logos/cm-light.svg",
      logoDark: "/imagens/lig-logos/cm-dark.svg",
    },
  };
  // As guardadas são do utilizador → primeiro nas sugestões.
  const OP_ORDER = { guardadas: 0, fertagus: 1, ml: 2, mts: 3, cm: 4 };

  // ═══ ÍCONES INLINE (independentes do lucide) ═════════════════════════════════
  const SVG_SEARCH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
  const SVG_X = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
  const SVG_CHEVRON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;
  const GLYPH_RAIL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="15" rx="4"/><path d="M5 12h14"/><path d="M9 18l-2 3"/><path d="M15 18l2 3"/><circle cx="9" cy="15" r="0.9" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="0.9" fill="currentColor" stroke="none"/></svg>`;
  const GLYPH_BUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="3"/><path d="M3 11h18"/><path d="M7 17v2.2"/><path d="M17 17v2.2"/><circle cx="7.5" cy="14" r="0.9" fill="currentColor" stroke="none"/><circle cx="16.5" cy="14" r="0.9" fill="currentColor" stroke="none"/></svg>`;
  const GLYPH_METRO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19 12 5l8 14"/><path d="M8.5 12.2 12 18l3.5-5.8"/></svg>`;
  const SVG_STAR = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="m12 3.6 2.5 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.1 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>`;
  // Mesma forma, mas com fill/stroke controlados por CSS: contorno quando não
  // está guardado, preenchida a amarelo quando está.
  const SVG_STAR_TOGGLE = `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3.1 2.72 5.78 6.03.87-4.37 4.3 1.04 6.05L12 17.24l-5.42 2.86 1.04-6.05-4.37-4.3 6.03-.87z"/></svg>`;
  function glyphFor(kind) {
    if (kind === "bus") return GLYPH_BUS;
    if (kind === "metro") return GLYPH_METRO;
    return GLYPH_RAIL;
  }

  // ═══ HELPERS ════════════════════════════════════════════════════════════════
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function norm(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }
  function normColor(c) {
    if (!c) return "#18181b";
    const s = String(c).trim();
    return s.startsWith("#") ? s : "#" + s.replace(/^#/, "");
  }
  function isMobile() {
    return !window.matchMedia("(min-width: 768px)").matches;
  }

  // ═══ ESTILOS ══════════════════════════════════════════════════════════════════
  function injectStyles() {
    if (document.getElementById("lt-search-styles")) return;
    const css = `
    /* Botão flutuante (glass) — alinhado sob o hambúrguer */
    .lt-search-btn {
      position: fixed; right: .75rem;
      top: calc(env(safe-area-inset-top, 0px) + 4.75rem);
      z-index: 15; width: 42px; height: 42px;
      display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid rgba(228,228,231,.5);
      background: rgba(255,255,255,.8);
      -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
      border-radius: 9999px; box-shadow: 0 1px 2px rgba(0,0,0,.06);
      color: #18181b; cursor: pointer;
      transition: box-shadow .2s ease, transform .15s ease, background .2s ease;
    }
    html.dark .lt-search-btn {
      border-color: rgba(255,255,255,.06);
      background: rgba(9,9,11,.8); color: #fff;
    }
    .lt-search-btn:hover { box-shadow: 0 4px 16px rgba(0,0,0,.12); }
    html.dark .lt-search-btn:hover { box-shadow: 0 4px 16px rgba(0,0,0,.5); }
    .lt-search-btn:active { transform: scale(.94); }
    .lt-search-btn svg { width: 1.15rem; height: 1.15rem; }

    /* Overlay */
    .lt-search-overlay {
      position: fixed; inset: 0; z-index: 60;
      background: rgba(9,9,11,.42);
      -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
      opacity: 0; pointer-events: none;
      transition: opacity .28s cubic-bezier(.16,1,.3,1);
    }
    .lt-search-overlay.lt-open { opacity: 1; pointer-events: auto; }

    .lt-search-sheet {
      position: absolute; top: 0; left: 0; right: 0;
      display: flex; flex-direction: column;
      max-height: 88dvh; overflow: hidden;
      background: #fff;
      /* Cantos arredondados em baixo em vez de um corte a régua com uma borda
         — no telemóvel a borda reta lia-se como uma barra solta. */
      border-radius: 0 0 16px 16px;
      box-shadow: 0 24px 48px -12px rgba(0,0,0,.35);
      padding-top: env(safe-area-inset-top, 0px);
      transform: translateY(-14px); opacity: 0;
      transition: transform .34s cubic-bezier(.16,1,.3,1), opacity .28s ease;
    }
    html.dark .lt-search-sheet { background: #09090b; }
    .lt-search-overlay.lt-open .lt-search-sheet { transform: translateY(0); opacity: 1; }

    @media (min-width: 768px) {
      .lt-search-sheet {
        left: 50%; right: auto; transform: translate(-50%, -14px);
        width: 560px; max-width: calc(100vw - 2rem);
        margin-top: 6vh; border-radius: 14px;
        border: 1px solid rgb(228 228 231); overflow: hidden;
        max-height: 78dvh;
      }
      html.dark .lt-search-sheet { border-color: rgb(24 24 27); }
      .lt-search-overlay.lt-open .lt-search-sheet { transform: translate(-50%, 0); }
    }

    /* Aviso curto (limite de paragens guardadas, por ex.) */
    .lt-search-toast {
      position: absolute; left: 50%; bottom: .875rem; z-index: 2;
      transform: translate(-50%, 8px); opacity: 0; pointer-events: none;
      max-width: calc(100% - 2rem); text-align: center;
      padding: .5rem .8rem; border-radius: 8px;
      background: #18181b; color: #fff;
      font-size: 11px; letter-spacing: .02em; line-height: 1.35;
      box-shadow: 0 8px 24px -8px rgba(0,0,0,.5);
      transition: opacity .2s ease, transform .2s ease;
    }
    html.dark .lt-search-toast { background: #fafafa; color: #18181b; }
    .lt-search-toast.is-on { opacity: 1; transform: translate(-50%, 0); }

    /* Cabeçalho: campo + cancelar */
    .lt-search-head {
      display: flex; align-items: center; gap: .625rem;
      /* .5rem + os 4px de topo dos filtros = os .75rem originais */
      padding: 1rem 1rem .5rem;
    }
    .lt-search-field {
      flex: 1; display: flex; align-items: center; gap: .625rem;
      height: 44px; padding: 0 .875rem;
      border: 1px solid rgb(228 228 231); border-radius: 10px;
      background: #fafafa; transition: border-color .18s ease, background .18s ease;
    }
    html.dark .lt-search-field { border-color: rgb(39 39 42); background: #131316; }
    .lt-search-field.is-focus { border-color: #18181b; background: #fff; }
    html.dark .lt-search-field.is-focus { border-color: #fff; background: #09090b; }
    .lt-search-field > svg { width: 1.05rem; height: 1.05rem; color: #a1a1aa; flex-shrink: 0; }
    .lt-search-input {
      flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
      font-family: inherit; font-size: 16px; color: #18181b;
      letter-spacing: -.01em;
    }
    html.dark .lt-search-input { color: #fff; }
    .lt-search-input::placeholder { color: #a1a1aa; }
    .lt-search-clear {
      display: none; align-items: center; justify-content: center;
      width: 22px; height: 22px; border: 0; padding: 0; cursor: pointer;
      border-radius: 9999px; background: rgba(0,0,0,.06); color: #52525b; flex-shrink: 0;
    }
    html.dark .lt-search-clear { background: rgba(255,255,255,.1); color: #d4d4d8; }
    .lt-search-clear.is-on { display: inline-flex; }
    .lt-search-clear svg { width: .7rem; height: .7rem; }
    .lt-search-cancel {
      border: 0; background: transparent; cursor: pointer; padding: .25rem .25rem;
      font-family: inherit; font-size: 11px; font-weight: 700; letter-spacing: .12em;
      text-transform: uppercase; color: #71717a; white-space: nowrap;
      transition: color .15s ease;
    }
    .lt-search-cancel:hover { color: #18181b; }
    html.dark .lt-search-cancel:hover { color: #fff; }

    /* Chips de operador */
    .lt-search-filters {
      display: flex; align-items: center; gap: .5rem;
      /* Não encolhe quando a sheet chega ao max-height: a encolher, esmagava
         os chips e cortava-os. */
      flex: 0 0 auto;
      /* O overflow-y: hidden abaixo recorta no limite da caixa. Sem folga em
         cima, o rebordo dos chips (e o anel de foco) ficava cortado — a linha
         parecia não ter topo. Os 4px de cima são compensados no .lt-search-head,
         para o espaçamento total ficar igual. */
      padding: 4px 1rem .875rem;
      /* Com overflow-x: auto, deixar o eixo Y em visible fá-lo computar para
         auto — e qualquer filho mais alto do que a linha punha uma barra
         vertical. Fica hidden, agora com folga. */
      overflow-x: auto; overflow-y: hidden;
      -webkit-overflow-scrolling: touch;
      -ms-overflow-style: none; scrollbar-width: none;
    }
    .lt-search-filters::-webkit-scrollbar { display: none; width: 0; height: 0; }
    .lt-chip {
      display: inline-flex; align-items: center; justify-content: center;
      /* box-sizing explícito: a altura não pode depender de o build do
         Tailwind trazer ou não o preflight. align-self fixa o chip
         independentemente do contentor. */
      box-sizing: border-box; align-self: center;
      gap: .4rem; flex: 0 0 auto;
      /* Altura fixa em vez de depender do conteúdo: os chips têm conteúdos
         diferentes (nada, logótipo, estrela) e ficavam com alturas diferentes. */
      height: 32px; min-height: 32px; max-height: 32px;
      padding: 0 .75rem; cursor: pointer;
      border: 1px solid rgb(228 228 231); border-radius: 9999px;
      background: transparent; color: #71717a;
      font-family: inherit; font-size: 10px; font-weight: 700; line-height: 1;
      letter-spacing: .12em; text-transform: uppercase; white-space: nowrap;
      transition: background .16s ease, color .16s ease, border-color .16s ease;
    }
    /* Nada dentro do chip pode crescer nem encolher. */
    .lt-chip > * { flex-shrink: 0; }
    html.dark .lt-chip { border-color: rgb(39 39 42); color: #a1a1aa; }
    .lt-chip:hover { color: #18181b; }
    html.dark .lt-chip:hover { color: #fff; }
    .lt-chip .lt-chip-logo { width: 14px; height: 14px; object-fit: contain; display: block; }
    .lt-chip .lt-chip-star {
      width: 13px; height: 13px; display: inline-flex; color: #eab308;
    }
    /* Sem esta regra o SVG assumia o tamanho por omissão e esticava o chip. */
    .lt-chip .lt-chip-star svg { width: 100%; height: 100%; display: block; }
    /* Anel de foco por dentro: um outline por fora era recortado pelo
       overflow da linha. */
    .lt-chip:focus-visible { outline: 2px solid #3b82f6; outline-offset: -3px; }
    .lt-chip.is-on { background: #18181b; color: #fff; border-color: #18181b; }
    html.dark .lt-chip.is-on { background: #fff; color: #18181b; border-color: #fff; }

    /* Resultados */
    .lt-search-results {
      flex: 1; overflow-y: auto;
      /* Sem isto, um nome comprido empurrava a linha para fora e o browser
         punha uma barra horizontal no fundo da lista. */
      overflow-x: hidden;
      -webkit-overflow-scrolling: touch;
      border-top: 1px solid rgb(244 244 245);
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
    html.dark .lt-search-results { border-top-color: rgb(24 24 27); }
    .lt-search-hint {
      padding: .875rem 1.25rem .5rem;
      font-size: 9px; font-weight: 700; letter-spacing: .28em; text-transform: uppercase;
      color: #a1a1aa;
    }

    /* A linha é um contentor (não um botão): tem DOIS alvos independentes,
       abrir e guardar. Um <button> dentro de outro é HTML inválido. */
    .lt-sr-row {
      display: flex; align-items: stretch; width: 100%; min-width: 0;
      border-bottom: 1px solid rgb(244 244 245);
      transition: background .14s ease;
    }
    html.dark .lt-sr-row { border-bottom-color: rgb(24 24 27); }
    .lt-sr-row:hover, .lt-sr-row.is-active { background: #fafafa; }
    html.dark .lt-sr-row:hover, html.dark .lt-sr-row.is-active { background: #131316; }

    .lt-sr-hit {
      flex: 1; min-width: 0;
      display: flex; align-items: center; gap: .875rem;
      padding: .8rem .35rem .8rem 1.25rem;
      cursor: pointer; text-align: left; background: transparent; border: 0;
      font-family: inherit; color: inherit;
    }
    .lt-sr-hit:focus-visible, .lt-sr-fav:focus-visible {
      outline: 2px solid #3b82f6; outline-offset: -3px;
    }

    /* Estrela de favorito: alvo de 44px, amarela quando guardado. */
    .lt-sr-fav {
      flex-shrink: 0; width: 44px; padding: 0; border: 0; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; color: #d4d4d8;
      transition: color .16s ease, transform .12s ease;
    }
    html.dark .lt-sr-fav { color: #3f3f46; }
    .lt-sr-fav svg {
      width: 1.05rem; height: 1.05rem; display: block;
      fill: none; stroke: currentColor; stroke-width: 1.7;
    }
    .lt-sr-fav:hover { color: #a1a1aa; }
    .lt-sr-fav:active { transform: scale(.86); }
    .lt-sr-fav.is-on { color: #eab308; }
    .lt-sr-fav.is-on svg { fill: currentColor; stroke: currentColor; }

    .lt-sr-ic {
      position: relative; flex-shrink: 0;
      width: 38px; height: 38px; border-radius: 10px;
      display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid rgb(228 228 231); color: #3f3f46; background: #fff;
    }
    html.dark .lt-sr-ic { border-color: rgb(39 39 42); color: #d4d4d8; background: #0d0d10; }
    .lt-sr-ic svg { width: 1.1rem; height: 1.1rem; }

    /* Logótipo do operador dentro do quadrado do resultado */
    .lt-sr-logo {
      width: 22px; height: 22px; object-fit: contain; display: block;
    }
    .lt-sr-ic .lt-sr-glyph { display: none; }
    .lt-sr-ic.is-fallback .lt-sr-logo { display: none; }
    .lt-sr-ic.is-fallback .lt-sr-glyph { display: inline-flex; }
    .lt-logo-light { display: block; }
    .lt-logo-dark { display: none; }
    html.dark .lt-logo-light { display: none; }
    html.dark .lt-logo-dark { display: block; }
    /* Selo de "guardada" no canto do quadrado */
    .lt-sr-star {
      position: absolute; right: -3px; top: -3px;
      width: 14px; height: 14px; border-radius: 9999px;
      display: inline-flex; align-items: center; justify-content: center;
      background: #FFDD00; color: #18181b; border: 2px solid #fff;
    }
    html.dark .lt-sr-star { border-color: #09090b; }
    .lt-sr-star svg { width: 8px; height: 8px; }

    /* display:block é o que faz o overflow/ellipsis funcionar — em elementos
       inline (eram <span>) o overflow:hidden não tem efeito e o nome comprido
       esticava a linha toda. */
    .lt-sr-main { flex: 1; min-width: 0; display: block; overflow: hidden; }
    .lt-sr-name {
      display: block; max-width: 100%;
      font-size: 15px; font-weight: 500; letter-spacing: -.01em;
      color: #18181b; line-height: 1.2;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    html.dark .lt-sr-name { color: #fff; }
    .lt-sr-sub {
      display: flex; align-items: center; gap: .45rem; margin-top: .3rem;
      flex-wrap: nowrap; overflow: hidden; min-width: 0; max-width: 100%;
    }
    .lt-sr-tag {
      font-size: 9px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
      color: #71717a; flex-shrink: 0;
    }
    .lt-sr-ctx {
      display: block; flex: 1 1 auto;
      font-size: 10px; color: #a1a1aa; letter-spacing: .02em;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
    }
    .lt-sr-pills { display: inline-flex; gap: .28rem; flex-shrink: 0; }
    .lt-sr-pill {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 18px; height: 16px; padding: 0 4px; border-radius: 4px;
      font-size: 9px; font-weight: 800; line-height: 1; letter-spacing: .01em;
    }
    .lt-sr-chev { flex-shrink: 0; color: #d4d4d8; }
    html.dark .lt-sr-chev { color: #52525b; }
    .lt-sr-chev svg { width: 1rem; height: 1rem; }

    .lt-sr-empty { padding: 3.5rem 1.5rem; text-align: center; }
    .lt-sr-empty .lt-sr-empty-ic {
      width: 44px; height: 44px; margin: 0 auto .75rem;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 9999px; border: 1px solid rgb(228 228 231); color: #a1a1aa;
    }
    html.dark .lt-sr-empty .lt-sr-empty-ic { border-color: rgb(39 39 42); }
    .lt-sr-empty .lt-sr-empty-ic svg { width: 1.2rem; height: 1.2rem; }
    .lt-sr-empty p { font-size: 13px; color: #71717a; }
    .lt-sr-empty p.small { font-size: 11px; color: #a1a1aa; margin-top: .35rem; }

    @media (prefers-reduced-motion: reduce) {
      .lt-search-overlay, .lt-search-sheet, .lt-search-toast,
      .lt-sr-fav { transition: none !important; }
    }`;
    const el = document.createElement("style");
    el.id = "lt-search-styles";
    el.innerHTML = css;
    document.head.appendChild(el);
  }

  // ═══ FAVORITOS ═══════════════════════════════════════════════════════════════
  function readList(key) {
    try {
      const raw = window.localStorage.getItem(key);
      const val = raw ? JSON.parse(raw) : null;
      return Array.isArray(val) ? val : [];
    } catch (e) {
      console.warn("[MapaSearch] localStorage ilegível:", e && e.message);
      return [];
    }
  }
  function writeList(key, list) {
    try {
      window.localStorage.setItem(key, JSON.stringify(list));
      return true;
    } catch (e) {
      console.warn("[MapaSearch] não foi possível guardar:", e && e.message);
      return false;
    }
  }

  // Lido uma vez por render, em vez de a cada linha.
  function favSets() {
    const cm = new Set(readList(CM_SAVED_KEY).map((x) => String(x && x.id)));
    const st = new Set(
      readList(STATIONS_SAVED_KEY).map((x) => `${x && x.op}:${x && x.id}`),
    );
    return { cm, st };
  }

  function isFav(item, sets) {
    if (!item.fav) return false;
    return item.fav.store === "cm"
      ? sets.cm.has(String(item.fav.id))
      : sets.st.has(`${item.fav.op}:${item.fav.id}`);
  }

  function hasFavourites() {
    return (
      readList(CM_SAVED_KEY).length > 0 || readList(STATIONS_SAVED_KEY).length > 0
    );
  }

  // Avisa quem mostra as guardadas no mapa (mapa-guardadas.js) e a página
  // /paragens noutro separador.
  function notifySaved() {
    try {
      window.dispatchEvent(new Event("lt:saved-stops-changed"));
    } catch (_) {}
    if (window.MapaGuardadas && window.MapaGuardadas.refresh)
      window.MapaGuardadas.refresh();
  }

  // → { saved: boolean, message?: string }
  function toggleFav(item) {
    const fav = item.fav;
    if (!fav) return { saved: false };

    if (fav.store === "cm") {
      // Mesma chave, mesma forma e mesmo limite da página /paragens, para as
      // duas verem exactamente a mesma lista.
      const list = readList(CM_SAVED_KEY);
      const i = list.findIndex((x) => String(x && x.id) === String(fav.id));
      if (i >= 0) {
        list.splice(i, 1);
        writeList(CM_SAVED_KEY, list);
        notifySaved();
        return { saved: false };
      }
      if (list.length >= CM_MAX) {
        return {
          saved: false,
          message: `Já tens ${CM_MAX} paragens guardadas. Remove uma em Paragens.`,
        };
      }
      list.push({
        id: String(fav.id),
        name: fav.name,
        addedAt: Date.now(),
        availableLines: fav.lines || [],
        hiddenLines: [],
      });
      if (!writeList(CM_SAVED_KEY, list))
        return { saved: false, message: "Não foi possível guardar." };
      notifySaved();
      return { saved: true };
    }

    const list = readList(STATIONS_SAVED_KEY);
    const i = list.findIndex(
      (x) => x && x.op === fav.op && String(x.id) === String(fav.id),
    );
    if (i >= 0) {
      list.splice(i, 1);
      writeList(STATIONS_SAVED_KEY, list);
      return { saved: false };
    }
    list.push({
      op: fav.op,
      id: String(fav.id),
      name: fav.name,
      addedAt: Date.now(),
    });
    if (!writeList(STATIONS_SAVED_KEY, list))
      return { saved: false, message: "Não foi possível guardar." };
    return { saved: true };
  }

  // ═══ ÍNDICE DE PESQUISA ══════════════════════════════════════════════════════
  let mtsCache = null; // Array de items MTS (fetch cacheado)
  let mtsPromise = null;
  let mlCache = null; // Array de items Metro de Lisboa
  let mlPromise = null;

  // Abre a sheet de partidas GTFS (Metro de Lisboa / Metro Sul). Recentra
  // primeiro, para o painel abrir já sobre a estação certa.
  function openGtfsStation(op, props, lat, lng) {
    if (
      lat != null &&
      lng != null &&
      window.MapaRender &&
      window.MapaRender.focusStation
    ) {
      window.MapaRender.focusStation({ lat, lng });
    }
    if (window.GtfsHorarios) {
      window.GtfsHorarios.open(props, { operator: op });
      return;
    }
    // Fallback para os aliases antigos.
    const legacy = op === "ml" ? window.MlHorarios : window.MtsHorarios;
    if (legacy) legacy.open(props);
    else console.warn("[MapaSearch] módulo de horários GTFS em falta");
  }

  function pointOf(feature) {
    const g = feature && feature.geometry;
    if (g && g.type === "Point" && Array.isArray(g.coordinates))
      return { lng: g.coordinates[0], lat: g.coordinates[1] };
    return { lng: null, lat: null };
  }

  // "[Azul, Vermelha]" → [{ label:"Azul", bg:"#4E84C4" }, …]
  function mlLinePills(linhaStr) {
    const raw = String(linhaStr == null ? "" : linhaStr).replace(/[[\]]/g, "");
    const out = [];
    for (const part of raw.split(",")) {
      const name = part.trim();
      if (!name) continue;
      const key = Object.keys(ML_LINE_COLORS).find(
        (k) => norm(k) === norm(name),
      );
      out.push({
        label: name,
        bg: key ? ML_LINE_COLORS[key] : OPERATORS.ml.dot,
        fg: "#fff",
      });
    }
    return out;
  }

  function ensureMl() {
    if (mlCache) return Promise.resolve(mlCache);
    if (mlPromise) return mlPromise;
    mlPromise = fetch(ML_STATIONS_PATH)
      .then((r) => (r.ok ? r.json() : null))
      .then((gj) => {
        const out = [];
        for (const f of (gj && gj.features) || []) {
          const p = (f && f.properties) || {};
          const name = p.nome_destino;
          if (!name) continue;
          const { lat, lng } = pointOf(f);
          const pills = mlLinePills(p.linha);
          // O objecto passado à sheet é o properties do geojson — a mesma coisa
          // que o clique no mapa entrega, para o comportamento ser idêntico.
          const props = {
            nome_destino: name,
            id_destino: p.id_destino,
            linha: p.linha,
          };
          out.push({
            op: "ml",
            name: String(name),
            ctx: p.zone_id ? `Zona ${p.zone_id}` : "",
            pills: pills.slice(0, 2),
            blob: norm(name) + " " + norm(String(p.linha || "")),
            lat,
            lng,
            fav: {
              store: "st",
              op: "ml",
              id: p.id_destino || norm(name),
              name: String(name),
            },
            run: () => openGtfsStation("ml", props, lat, lng),
          });
        }
        mlCache = out;
        return out;
      })
      .catch((e) => {
        console.warn("[MapaSearch] Metro de Lisboa indisponível:", e && e.message);
        mlCache = [];
        return mlCache;
      });
    return mlPromise;
  }

  function ensureSources() {
    return Promise.all([ensureMts(), ensureMl()]);
  }

  function ensureMts() {
    if (mtsCache) return Promise.resolve(mtsCache);
    if (mtsPromise) return mtsPromise;
    mtsPromise = fetch(MTS_STATIONS_PATH)
      .then((r) => (r.ok ? r.json() : null))
      .then((gj) => {
        const out = [];
        const feats = (gj && gj.features) || [];
        for (const f of feats) {
          const p = (f && f.properties) || {};
          if (!p.id || !p.name) continue;
          let lines = p.lines;
          let colors = p.line_colors;
          if (typeof lines === "string") {
            try {
              lines = JSON.parse(lines);
            } catch (_) {
              lines = [];
            }
          }
          if (typeof colors === "string") {
            try {
              colors = JSON.parse(colors);
            } catch (_) {
              colors = [];
            }
          }
          lines = Array.isArray(lines) ? lines : [];
          colors = Array.isArray(colors) ? colors : [];
          let lng = null;
          let lat = null;
          const g = f.geometry;
          if (g && g.type === "Point" && Array.isArray(g.coordinates)) {
            lng = g.coordinates[0];
            lat = g.coordinates[1];
          }
          const station = {
            id: p.id,
            name: p.name,
            lines,
            line_colors: colors,
          };
          const pills = lines.map((l, i) => {
            const bg = normColor(colors[i] || OPERATORS.mts.dot);
            return { label: String(l), bg, fg: "#fff" };
          });
          out.push({
            op: "mts",
            name: p.name,
            ctx: "",
            pills: pills.slice(0, 3),
            blob: norm(p.name),
            lat,
            lng,
            fav: { store: "st", op: "mts", id: p.id, name: p.name },
            run: () => openGtfsStation("mts", station, lat, lng),
          });
        }
        mtsCache = out;
        return out;
      })
      .catch((e) => {
        console.warn("[MapaSearch] MTS indisponível:", e && e.message);
        mtsCache = [];
        return mtsCache;
      });
    return mtsPromise;
  }

  // As estações da Fertagus usam lat/lng; os fallbacks cobrem formatos antigos.
  function stationLatLng(s) {
    if (typeof s.lat === "number" && typeof s.lng === "number")
      return { lat: s.lat, lng: s.lng };
    if (Array.isArray(s.coordinates) && s.coordinates.length === 2)
      return { lat: s.coordinates[1], lng: s.coordinates[0] };
    if (Array.isArray(s.coords) && s.coords.length === 2)
      return { lat: s.coords[0], lng: s.coords[1] };
    return { lat: null, lng: null };
  }

  function fertagusItems() {
    const stations = (window.MAPA && window.MAPA.STATIONS) || [];
    return stations.map((s) => ({
      op: "fertagus",
      name: s.name,
      ctx: "",
      pills: [],
      blob: norm(s.name),
      ...stationLatLng(s),
      fav: {
        store: "st",
        op: "fertagus",
        id: s.id != null ? s.id : norm(s.name),
        name: s.name,
      },
      run: () => {
        if (window.MapaStation) window.MapaStation.open(s);
      },
    }));
  }

  // Ids das carreiras, no formato que o paragens.js guarda em availableLines.
  function cmLineIds(stop) {
    const out = [];
    const seen = new Set();
    for (const l of stop.lines || []) {
      const id = l && l["line-id"];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(String(id));
    }
    // Paragens vindas do catálogo (fora da área verificada) só trazem os nomes.
    if (!out.length && Array.isArray(stop.lineNames))
      for (const l of stop.lineNames) if (l) out.push(String(l));
    return out;
  }

  // Linhas únicas de uma paragem CM (id/nome/cor), preservando ordem.
  function cmLines(stop) {
    const out = [];
    const seen = new Set();
    for (const l of stop.lines || []) {
      const id = l && l["line-id"];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        label: String(l["line-name"] != null ? l["line-name"] : id),
        bg: normColor(l["route-color"]),
        fg: "#fff",
      });
    }
    return out;
  }

  function cmItems() {
    const stops =
      window.MapaCM && typeof window.MapaCM.getStops === "function"
        ? window.MapaCM.getStops()
        : [];
    return stops.map((stop) => ({
      op: "cm",
      name: stop.name,
      ctx: stop.station || "",
      pills: cmLines(stop).slice(0, 3),
      blob: norm(stop.name) + " " + norm(stop.station || ""),
      lat: Array.isArray(stop.location) ? stop.location[0] : null,
      lng: Array.isArray(stop.location) ? stop.location[1] : null,
      fav: {
        store: "cm",
        id: stop.id,
        name: stop.name,
        lines: cmLineIds(stop),
      },
      run: () => {
        if (window.MapaCM) window.MapaCM.open(stop);
      },
    }));
  }

  // Paragens guardadas pelo utilizador na página /paragens (mapa-guardadas.js).
  function guardadasItems() {
    const stops =
      window.MapaGuardadas && typeof window.MapaGuardadas.getStops === "function"
        ? window.MapaGuardadas.getStops()
        : [];
    return stops.map((stop) => ({
      op: "guardadas",
      name: stop.name,
      ctx: stop.station || `#${stop.id}`,
      pills: cmLines(stop).slice(0, 3),
      // O utilizador pode ter renomeado a paragem em /paragens; o nome oficial
      // fica no blob para continuar a encontrá-la pelos dois.
      blob:
        norm(stop.name) +
        " " +
        norm(stop.officialName || "") +
        " " +
        String(stop.id),
      lat: Array.isArray(stop.location) ? stop.location[0] : null,
      lng: Array.isArray(stop.location) ? stop.location[1] : null,
      fav: {
        store: "cm",
        id: stop.id,
        name: stop.name,
        lines: cmLineIds(stop),
      },
      run: () => {
        if (window.MapaGuardadas) window.MapaGuardadas.open(stop);
        else if (window.MapaCM) window.MapaCM.open(stop);
      },
    }));
  }

  function buildIndex() {
    // Guardadas / Fertagus / Carris são síncronos; MTS e Metro de Lisboa vêm do
    // cache (já resolvidos no open).
    const guardadas = guardadasItems();
    // Uma paragem guardada que também esteja na camada Carris apareceria duas
    // vezes; fica só a versão "guardada".
    const seen = new Set(guardadas.map((i) => String(i.fav.id)));
    const cm = cmItems().filter((i) => !seen.has(String(i.fav.id)));
    return [].concat(
      guardadas,
      fertagusItems(),
      mlCache || [],
      mtsCache || [],
      cm,
    );
  }

  // ═══ PESQUISA / RANKING ══════════════════════════════════════════════════════
  function scoreItem(item, q) {
    const name = norm(item.name);
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    // início de palavra
    const words = name.split(/[\s\-/]+/);
    if (words.some((w) => w.startsWith(q))) return 2;
    if (name.indexOf(q) !== -1) return 3;
    if (item.blob.indexOf(q) !== -1) return 4;
    return -1;
  }

  function query(items, q, filter) {
    let pool = items;
    if (filter === "guardadas") {
      // "Guardadas" são as do utilizador em qualquer operador: as paragens
      // Carris guardadas e as estações marcadas com estrela.
      pool = pool.filter((i) => i.op === "guardadas" || isFav(i, favCache));
    } else if (filter !== "all") {
      pool = pool.filter((i) => i.op === filter);
    }
    if (!q) return suggestionList(pool);
    const scored = [];
    for (const it of pool) {
      const sc = scoreItem(it, q);
      if (sc >= 0) scored.push({ it, sc });
    }
    scored.sort((a, b) => {
      if (a.sc !== b.sc) return a.sc - b.sc;
      const op = OP_ORDER[a.it.op] - OP_ORDER[b.it.op];
      if (op !== 0) return op;
      return norm(a.it.name).localeCompare(norm(b.it.name));
    });
    return scored.slice(0, MAX_RESULTS).map((x) => x.it);
  }

  // Sem termo de pesquisa, ordenar tudo por operador e cortar aos 60 enchia a
  // lista com um só operador — o Metro de Lisboa tem 56 estações, e o Metro Sul
  // e a Carris ficavam de fora. Cada operador passa a ter quota; as guardadas
  // não têm limite, porque são poucas e são as do utilizador.
  function suggestionList(pool) {
    const groups = new Map();
    for (const it of pool) {
      if (!groups.has(it.op)) groups.set(it.op, []);
      groups.get(it.op).push(it);
    }
    for (const list of groups.values())
      list.sort((a, b) => norm(a.name).localeCompare(norm(b.name)));

    const ops = Array.from(groups.keys()).sort(
      (a, b) => (OP_ORDER[a] == null ? 99 : OP_ORDER[a]) - (OP_ORDER[b] == null ? 99 : OP_ORDER[b]),
    );

    const out = (groups.get("guardadas") || []).slice(0, MAX_RESULTS);
    const rest = ops.filter((op) => op !== "guardadas");
    if (!rest.length) return out;

    const quota = Math.max(
      1,
      Math.floor(Math.max(0, MAX_RESULTS - out.length) / rest.length),
    );
    const used = new Map();
    for (const op of rest) {
      const take = groups.get(op).slice(0, quota);
      used.set(op, take.length);
      out.push(...take);
    }
    // Sobras (dos operadores com menos elementos do que a quota) distribuídas
    // uma a uma e à vez: assim nenhum operador absorve sozinho o espaço que os
    // outros não usaram.
    let progressed = true;
    while (out.length < MAX_RESULTS && progressed) {
      progressed = false;
      for (const op of rest) {
        if (out.length >= MAX_RESULTS) break;
        const list = groups.get(op);
        const from = used.get(op) || 0;
        if (from >= list.length) continue;
        out.push(list[from]);
        used.set(op, from + 1);
        progressed = true;
      }
    }
    return out.slice(0, MAX_RESULTS);
  }

  function sortDefault(a, b) {
    const op = OP_ORDER[a.op] - OP_ORDER[b.op];
    if (op !== 0) return op;
    return norm(a.name).localeCompare(norm(b.name));
  }

  // ═══ RENDER DOS RESULTADOS ════════════════════════════════════════════════════
  function pillsHtml(pills) {
    if (!pills || !pills.length) return "";
    const inner = pills
      .map(
        (p) =>
          `<span class="lt-sr-pill" style="background:${escapeHtml(
            p.bg,
          )};color:${escapeHtml(p.fg)}">${escapeHtml(p.label)}</span>`,
      )
      .join("");
    return `<span class="lt-sr-pills">${inner}</span>`;
  }

  // Logótipo do operador. Alguns têm variante clara/escura (Carris); a troca é
  // feita por CSS, para acompanhar o tema sem JS.
  function logoHtml(meta, cls) {
    if (!meta.logo) return "";
    if (meta.logoDark) {
      return (
        `<img class="${cls} lt-logo-light" src="${escapeHtml(meta.logo)}" alt="" data-lt-logo>` +
        `<img class="${cls} lt-logo-dark" src="${escapeHtml(meta.logoDark)}" alt="" data-lt-logo>`
      );
    }
    return `<img class="${cls}" src="${escapeHtml(meta.logo)}" alt="" data-lt-logo>`;
  }

  function rowHtml(item, idx) {
    const meta = OPERATORS[item.op] || {};
    const ctx = item.ctx
      ? `<span class="lt-sr-ctx">· ${escapeHtml(item.ctx)}</span>`
      : "";
    // O operador é identificado pelo logótipo; o glifo só aparece se a imagem
    // não carregar (ver hookLogos). A bolinha de cor saiu — com o logótipo era
    // informação repetida. A cor de cada operador continua a servir de recurso
    // para as pills (OPERATORS[op].dot).
    const badge = meta.star
      ? `<span class="lt-sr-star" title="Paragem guardada">${SVG_STAR}</span>`
      : "";
    const on = isFav(item, favCache);
    const star = item.fav
      ? `<button type="button" class="lt-sr-fav${on ? " is-on" : ""}"
            data-fav="${idx}" aria-pressed="${on ? "true" : "false"}"
            title="${on ? "Remover dos guardados" : "Guardar"}"
            aria-label="${on ? "Remover" : "Guardar"} ${escapeHtml(item.name)}"
          >${SVG_STAR_TOGGLE}</button>`
      : "";
    return `
      <div class="lt-sr-row" data-idx="${idx}">
        <button type="button" class="lt-sr-hit" data-open="${idx}">
          <span class="lt-sr-ic">
            ${logoHtml(meta, "lt-sr-logo")}
            <span class="lt-sr-glyph">${glyphFor(meta.glyph)}</span>
            ${badge}
          </span>
          <span class="lt-sr-main">
            <span class="lt-sr-name">${escapeHtml(item.name)}</span>
            <span class="lt-sr-sub">
              ${pillsHtml(item.pills)}
              ${ctx}
            </span>
          </span>
          <span class="lt-sr-chev">${SVG_CHEVRON}</span>
        </button>
        ${star}
      </div>`;
  }

  // Sem onerror inline (CSP): se o logótipo falhar, o quadrado passa a mostrar
  // o glifo genérico.
  function hookLogos(root) {
    root.querySelectorAll("[data-lt-logo]").forEach((img) => {
      const fail = () => {
        const box = img.closest(".lt-sr-ic") || img.closest(".lt-chip");
        if (box) box.classList.add("is-fallback");
        img.style.display = "none";
      };
      if (img.complete && img.naturalWidth === 0) fail();
      else img.addEventListener("error", fail, { once: true });
    });
  }

  function emptyHtml(q) {
    return `
      <div class="lt-sr-empty">
        <span class="lt-sr-empty-ic">${SVG_SEARCH}</span>
        <p>Sem resultados para "${escapeHtml(q)}".</p>
        <p class="small">Tenta outro nome ou muda o operador.</p>
      </div>`;
  }

  // ═══ UI / ESTADO ══════════════════════════════════════════════════════════════
  let overlay = null;
  let sheet = null;
  let inputEl = null;
  let fieldEl = null;
  let clearEl = null;
  let resultsEl = null;
  let filtersEl = null;
  let btnEl = null;

  let curFilter = "all";
  // true = o filtro foi escolhido pelo código (abrir nos guardados), não pelo
  // utilizador. Nesse caso, começar a escrever volta a pesquisar tudo.
  let filterAuto = false;
  let curResults = []; // items atualmente mostrados (para o clique/Enter)
  let isOpen = false;
  let favCache = { cm: new Set(), st: new Set() }; // recalculado a cada render
  let toastEl = null;
  let toastTimer = null;

  function buildOverlay() {
    overlay = document.createElement("div");
    overlay.className = "lt-search-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Pesquisar estações e paragens");

    const chips = [["all", "Todos"]]
      .concat(Object.keys(OPERATORS).map((k) => [k, OPERATORS[k].label]))
      .map(([k, lbl]) => {
        let mark = "";
        if (k !== "all") {
          const meta = OPERATORS[k];
          mark = meta.star
            ? `<span class="lt-chip-star">${SVG_STAR}</span>`
            : logoHtml(meta, "lt-chip-logo");
        }
        return `<button type="button" class="lt-chip${
          k === curFilter ? " is-on" : ""
        }" data-filter="${k}">${mark}${escapeHtml(lbl)}</button>`;
      })
      .join("");

    sheet = document.createElement("div");
    sheet.className = "lt-search-sheet";
    sheet.innerHTML = `
      <div class="lt-search-head">
        <div class="lt-search-field" data-search-field>
          ${SVG_SEARCH}
          <input class="lt-search-input" type="text" inputmode="search"
            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
            placeholder="Estação ou paragem" aria-label="Pesquisar estação ou paragem" />
          <button type="button" class="lt-search-clear" aria-label="Limpar">${SVG_X}</button>
        </div>
        <button type="button" class="lt-search-cancel" data-search-cancel>Fechar</button>
      </div>
      <div class="lt-search-filters">${chips}</div>
      <div class="lt-search-results" role="listbox"></div>`;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    hookLogos(sheet);

    fieldEl = sheet.querySelector("[data-search-field]");
    inputEl = sheet.querySelector(".lt-search-input");
    clearEl = sheet.querySelector(".lt-search-clear");
    resultsEl = sheet.querySelector(".lt-search-results");
    filtersEl = sheet.querySelector(".lt-search-filters");

    // Cancelar / backdrop
    sheet
      .querySelector("[data-search-cancel]")
      .addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    // Foco visual do campo
    inputEl.addEventListener("focus", () => fieldEl.classList.add("is-focus"));
    inputEl.addEventListener("blur", () => fieldEl.classList.remove("is-focus"));

    // Input
    inputEl.addEventListener("input", () => {
      clearEl.classList.toggle("is-on", inputEl.value.length > 0);
      // A pesquisa abre nos guardados, mas escrever é sinal de que se procura
      // algo que ainda não está guardado — volta a "Todos". Se o filtro foi
      // escolhido à mão, respeita-se.
      if (filterAuto && inputEl.value.trim()) {
        curFilter = "all";
        filterAuto = false;
        syncChips();
      }
      render();
    });
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && curResults.length) {
        e.preventDefault();
        choose(curResults[0]);
      } else if (e.key === "Escape") {
        close();
      }
    });

    clearEl.addEventListener("click", () => {
      inputEl.value = "";
      clearEl.classList.remove("is-on");
      inputEl.focus();
      render();
    });

    // Limpar tudo (Escape com texto) mantém-se a cargo do close().

    // Chips
    filtersEl.querySelectorAll("[data-filter]").forEach((chip) => {
      chip.addEventListener("click", () => {
        curFilter = chip.getAttribute("data-filter");
        filterAuto = false; // escolha explícita: passa a mandar sobre a nossa
        syncChips();
        render();
      });
    });

    // Delegação do clique nos resultados: a estrela primeiro, porque está
    // dentro da linha e não deve abrir a sheet.
    resultsEl.addEventListener("click", (e) => {
      const favBtn = e.target.closest("[data-fav]");
      if (favBtn) {
        e.preventDefault();
        e.stopPropagation();
        onFavClick(favBtn);
        return;
      }
      const hit = e.target.closest("[data-open]");
      if (!hit) return;
      const item = curResults[parseInt(hit.getAttribute("data-open"), 10)];
      if (item) choose(item);
    });
  }

  // Alterna o favorito e actualiza só o botão — sem redesenhar a lista, para
  // não perder o scroll nem o foco.
  function onFavClick(btn) {
    const item = curResults[parseInt(btn.getAttribute("data-fav"), 10)];
    if (!item) return;
    const res = toggleFav(item);
    if (res.message) {
      toast(res.message);
      return;
    }
    btn.classList.toggle("is-on", res.saved);
    btn.setAttribute("aria-pressed", res.saved ? "true" : "false");
    btn.setAttribute("title", res.saved ? "Remover dos guardados" : "Guardar");
    btn.setAttribute(
      "aria-label",
      `${res.saved ? "Remover" : "Guardar"} ${item.name}`,
    );
    favCache = favSets();
    if (typeof window.sa_event === "function") {
      try {
        window.sa_event(res.saved ? "map_search_fav_add" : "map_search_fav_remove", {
          op: item.op,
        });
      } catch (_) {}
    }
  }

  function toast(message) {
    if (!sheet) return;
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "lt-search-toast";
      toastEl.setAttribute("role", "status");
      sheet.appendChild(toastEl);
    }
    toastEl.textContent = message;
    requestAnimationFrame(() => toastEl.classList.add("is-on"));
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 2600);
  }

  // Põe o chip certo activo e traz-lo à vista quando a linha tem scroll.
  function syncChips() {
    if (!filtersEl) return;
    filtersEl.querySelectorAll("[data-filter]").forEach((c) => {
      c.classList.toggle("is-on", c.getAttribute("data-filter") === curFilter);
    });
    scrollChipIntoView();
  }

  // Traz o chip activo à vista SÓ na horizontal. O scrollIntoView do browser
  // mexe também no eixo vertical e, como a linha é um scrollport
  // (overflow-y: hidden), isso deslocava os chips para cima e cortava-lhes o
  // topo — visível sobretudo no chip selecionado, que tem fundo sólido.
  function scrollChipIntoView() {
    const active = filtersEl && filtersEl.querySelector(".lt-chip.is-on");
    if (!active) return;
    const left = active.offsetLeft;
    const width = active.offsetWidth;
    const view = filtersEl.scrollLeft;
    const vw = filtersEl.clientWidth;
    const pad = 12;
    if (left < view + pad) filtersEl.scrollLeft = Math.max(0, left - pad);
    else if (left + width > view + vw - pad)
      filtersEl.scrollLeft = left + width - vw + pad;
    filtersEl.scrollTop = 0; // nunca deslocado na vertical
  }

  function render() {
    if (!resultsEl) return;
    const q = norm(inputEl.value);
    favCache = favSets();
    const index = buildIndex();
    curResults = query(index, q, curFilter);

    if (!curResults.length) {
      resultsEl.innerHTML = q
        ? emptyHtml(inputEl.value)
        : `<div class="lt-sr-empty"><p>Nada disponível de momento.</p></div>`;
      return;
    }

    const hint = q ? "" : `<p class="lt-search-hint">Sugestões</p>`;
    resultsEl.innerHTML =
      hint + curResults.map((it, i) => rowHtml(it, i)).join("");
    hookLogos(resultsEl);
    resultsEl.scrollTop = 0;
  }

  function choose(item) {
    if (!item) return;
    if (typeof window.sa_event === "function") {
      try {
        window.sa_event("map_search_select", { op: item.op });
      } catch (_) {}
    }
    if (inputEl) inputEl.blur();
    close();
    // Deixa o overlay começar a fechar antes de abrir a sheet (partilham z alto).
    setTimeout(() => {
      try {
        item.run();
      } catch (e) {
        console.warn("[MapaSearch] abrir resultado falhou:", e && e.message);
      }
    }, 140);
  }

  // ═══ ABRIR / FECHAR ═══════════════════════════════════════════════════════════
  function open() {
    if (isOpen) return;
    // Decidido ANTES de construir o overlay, para o chip certo já nascer activo.
    // Se não houver nada guardado, abrir em "Guardadas" mostrava uma lista
    // vazia — nesse caso abre em "Todos".
    curFilter = hasFavourites() ? "guardadas" : "all";
    filterAuto = curFilter !== "all";
    if (!overlay) buildOverlay();
    else syncChips();
    isOpen = true;
    if (btnEl) btnEl.setAttribute("aria-expanded", "true");
    if (typeof window.sa_event === "function") {
      try {
        window.sa_event("map_search_open");
      } catch (_) {}
    }

    // Garante MTS e Metro de Lisboa carregados antes do primeiro render
    // (guardadas/Fertagus/Carris já são sincronos).
    ensureSources().then(() => {
      if (isOpen) render();
    });
    // As paragens guardadas dependem do catálogo Carris, que também é assíncrono.
    if (window.MapaGuardadas && window.MapaGuardadas.refresh) {
      window.MapaGuardadas.refresh().then(() => {
        if (isOpen) render();
      });
    }
    render();

    requestAnimationFrame(() => overlay.classList.add("lt-open"));
    document.addEventListener("keydown", onKey);

    // No telemóvel NÃO se dá foco: abriria o teclado por cima dos resultados,
    // logo a seguir a tocar na lupa. Quem quiser escrever toca no campo.
    // No desktop o foco não abre teclado nenhum, por isso mantém-se.
    if (!isMobile()) {
      setTimeout(() => {
        if (inputEl) inputEl.focus({ preventScroll: true });
      }, 60);
    }
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    // O campo fica limpo para a próxima abertura arrancar nos guardados sem
    // uma pesquisa antiga a filtrar por cima.
    if (inputEl) {
      inputEl.value = "";
      if (clearEl) clearEl.classList.remove("is-on");
    }
    if (btnEl) btnEl.setAttribute("aria-expanded", "false");
    if (overlay) overlay.classList.remove("lt-open");
    document.removeEventListener("keydown", onKey);
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  // ═══ BOTÃO FLUTUANTE ══════════════════════════════════════════════════════════
  function positionButton() {
    if (!btnEl) return;
    const header = document.querySelector("#global-nav header");
    if (!header) return;
    const r = header.getBoundingClientRect();
    if (!r || r.bottom <= 0) return;
    let top = r.bottom + 12;
    // O botão "perto de mim" (mapa-perto.js) ocupa o lugar de cima na pilha;
    // se existir, a pesquisa fica logo abaixo dele.
    const near = document.getElementById("lt-near-btn");
    if (near) top += (near.offsetHeight || 42) + 8;
    btnEl.style.top = Math.round(top) + "px";
  }

  function injectButton() {
    const host =
      document.querySelector(".mapa-container") ||
      document.getElementById("map")?.parentElement ||
      document.body;
    if (!host || document.getElementById("lt-search-btn")) return;

    btnEl = document.createElement("button");
    btnEl.id = "lt-search-btn";
    btnEl.className = "lt-search-btn";
    btnEl.type = "button";
    btnEl.setAttribute("aria-label", "Pesquisar estações e paragens");
    btnEl.setAttribute("aria-haspopup", "dialog");
    btnEl.setAttribute("aria-expanded", "false");
    btnEl.innerHTML = SVG_SEARCH;
    btnEl.addEventListener("click", (e) => {
      e.stopPropagation();
      open();
    });
    host.appendChild(btnEl);

    // O header (nav-tools) é injetado de forma assíncrona → reposiciona quando
    // estiver pronto, e em cada resize.
    positionButton();
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      positionButton();
      if (document.querySelector("#global-nav header") || tries > 40) {
        clearInterval(iv);
        positionButton();
      }
    }, 120);
    window.addEventListener("resize", positionButton);
    window.addEventListener("orientationchange", () =>
      setTimeout(positionButton, 250),
    );
  }

  function boot() {
    injectStyles();
    injectButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  // API mínima (integração/debug). O index() é o que o mapa-perto.js consome
  // para não duplicar o carregamento das fontes de dados; ensureSources()
  // garante que o MTS e o Metro já vieram.
  window.MapaSearch = {
    open,
    close,
    reposition: positionButton,
    index: buildIndex,
    ensureSources,
    operators: OPERATORS,
    logoHtml,
    hookLogos,
    pillsHtml,
    glyphFor,
    norm,
    _render: render,
  };
})();

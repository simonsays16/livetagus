/**
 * mapa-perto.js · LiveTagus (mapa)
 * "Perto de mim": ajuda a escolher o transporte mais próximo.
 *
 * PRIVACIDADE — a regra que manda neste ficheiro:
 * A localização é obtida pelo navigator.geolocation e usada SÓ no dispositivo.
 * Não é enviada para lado nenhum, não entra em nenhum fetch, em nenhum URL, em
 * nenhum evento de analytics, e não é guardada em localStorage. Vive em memória
 * enquanto a página está aberta e desaparece com ela. Todo o cálculo de
 * distâncias é feito aqui (haversine). Se alguma vez for preciso mexer neste
 * módulo, é esta a linha que não se atravessa.
 *
 * Fluxo:
 *   Passo 1 — Na primeira utilização, um aviso explica que vai ser pedida
 *     autorização para a localização exata, com um interruptor para localizar
 *     automaticamente sempre que o mapa abrir.
 *   Passo 2 — Com a posição obtida, a lista das estações/paragens do mapa
 *     dentro do raio (500 m por omissão), com um slider de 100 m a 5 km no
 *     topo. A estação da Fertagus mais próxima aparece SEMPRE em primeiro
 *     lugar, mesmo que esteja fora do raio.
 *
 * Com "localizar automaticamente" ligado, ao abrir o mapa a posição é obtida,
 * o mapa aproxima-se e a lista abre sozinha (se nada de mais importante estiver
 * a acontecer: link partilhado, mapa já mexido, outro painel aberto).
 *
 * O painel é uma bottom-sheet com o mesmo vidro do #details-panel: sobe de
 * baixo, tem dois tamanhos (mini/expandido) e fecha-se a arrastar para baixo.
 * Em mini o mapa continua utilizável por cima; em desktop fica no canto
 * inferior direito, como os outros painéis.
 *
 * As fontes de dados são as do mapa-search.js (window.MapaSearch.index()), por
 * isso cobre exactamente o que está no mapa: Fertagus, Metro de Lisboa, Metro
 * Sul do Tejo, as paragens Carris das ligações e as guardadas. Tocar num
 * resultado abre a sheet do operador respectivo.
 *
 * API: window.MapaPerto.open() | close() | locate() | isOpen() | position()
 *
 * Inclusão: <script src="./mapa-perto.js" defer></script> (depois do mapa-search.js)
 */

(function () {
  "use strict";
  if (window.MapaPerto) return;

  // ═══ CONFIGURAÇÃO ══════════════════════════════════════════════════════
  const KEY_INTRO = "lt_geo_intro"; // aviso do passo 1 já mostrado
  const KEY_AUTO = "lt_geo_auto"; // localizar ao abrir o mapa
  const KEY_RANGE = "lt_near_range"; // último raio escolhido
  // NUNCA se guardam coordenadas em nenhuma destas chaves.

  // Passos do slider: mais resolução perto, que é onde a diferença conta.
  const RANGES = [100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000];
  const DEFAULT_RANGE = 500;
  const MAX_ITEMS = 40; // a 5 km a lista fica enorme

  // Área servida pela app, com folga. Se a posição cair fora disto, o
  // enquadramento automático não acontece: voar para o Porto mostraria um mapa
  // vazio, o que é pior do que ficar onde se estava.
  const AREA = { minLat: 38.2, maxLat: 39.1, minLng: -9.65, maxLng: -8.45 };
  const AUTO_ZOOM = 14; // perto o suficiente para as paragens aparecerem (min. 13)

  const GEO_OPTS = {
    enableHighAccuracy: true, // localização exata, como pedido
    timeout: 12000,
    maximumAge: 30000, // aceita uma leitura recente em vez de novo fix
  };

  // ═══ ESTADO ════════════════════════════════════════════════════════════
  let overlay = null;
  let sheet = null;
  let bodyEl = null;
  let btnEl = null;
  let isOpen = false;
  let busy = false;
  let position = null; // { lat, lng, accuracy } — só em memória
  let range = DEFAULT_RANGE;
  let lastFocus = null;
  let sheetState = "mini"; // 'mini' | 'expanded' (só conta em mobile)
  // O enquadramento automático é uma cortesia de arranque, não um comando: só
  // acontece uma vez, e só se o utilizador ainda não tiver mexido no mapa.
  let autoFrameDone = false;
  let userMovedMap = false;

  // ═══ PREFERÊNCIAS ══════════════════════════════════════════════════════
  function pref(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }
  function setPref(key, val) {
    try {
      window.localStorage.setItem(key, val);
    } catch (_) {}
  }
  const introDone = () => pref(KEY_INTRO) === "1";
  const autoOn = () => pref(KEY_AUTO) === "1";

  function loadRange() {
    const v = parseInt(pref(KEY_RANGE) || "", 10);
    range = RANGES.indexOf(v) >= 0 ? v : DEFAULT_RANGE;
  }

  // ═══ UTILITÁRIOS ═══════════════════════════════════════════════════════
  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Haversine, em metros. Tudo local — nenhuma API de geocoding envolvida.
  function distance(aLat, aLng, bLat, bLng) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const dLat = (bLat - aLat) * toRad;
    const dLng = (bLng - aLng) * toRad;
    const s1 = Math.sin(dLat / 2);
    const s2 = Math.sin(dLng / 2);
    const h =
      s1 * s1 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * s2 * s2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function fmtDistance(m) {
    if (m < 1000) return `${Math.round(m / 10) * 10} m`;
    return `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace(".", ",")} km`;
  }
  function fmtRange(m) {
    return m < 1000
      ? `${m} m`
      : `${(m / 1000).toFixed(1).replace(".0", "")} km`;
  }
  // ═══ ÍCONES ════════════════════════════════════════════════════════════
  const SVG_NEAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="19" height="19"><path d="M12 2v2m0 16v2M2 12h2m16 0h2"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>`;
  const SVG_X = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
  const SVG_SHIELD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>`;
  const SVG_CHEV = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lt-np-chev"><path d="m9 18 6-6-6-6"/></svg>`;

  // ═══ ESTILOS ═══════════════════════════════════════════════════════════
  function injectStyles() {
    if (document.getElementById("lt-near-styles")) return;
    const css = `
    .lt-near-btn {
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
    html.dark .lt-near-btn {
      border-color: rgba(255,255,255,.06);
      background: rgba(9,9,11,.8); color: #fff;
    }
    .lt-near-btn:hover { box-shadow: 0 4px 12px rgba(0,0,0,.1); }
    .lt-near-btn:active { transform: scale(.94); }
    .lt-near-btn.is-busy { color: #3b82f6; }
    .lt-near-btn.is-on { color: #16a34a; }

    /* Fundo: transparente e sem apanhar toques enquanto a sheet está em
       mini (o mapa por cima continua a funcionar, como no comboio em mini);
       escurece e fecha ao toque quando expandida. */
    /* z 35: por cima dos painéis do mapa (#details-panel, z 30) e por baixo
       do menu (overlay z 40, cabeçalho z 50). */
    .lt-near-overlay {
      position: fixed; inset: 0; z-index: 35;
      background: rgba(0,0,0,0); pointer-events: none;
      transition: background .3s ease;
    }
    @media (max-width: 767.98px) {
      .lt-near-overlay.lt-open[data-state="expanded"] {
        background: rgba(0,0,0,.4); pointer-events: auto;
      }
    }

    /* Bottom-sheet com o vidro do #details-panel (mesmos valores). */
    .lt-near-sheet {
      --lt-glass: rgba(250,250,251,.74); --lt-edge: rgba(255,255,255,.75);
      --lt-shadow: 0 -12px 40px -14px rgba(0,0,0,.28);
      --lt-blur: blur(28px) saturate(175%);
      --lt-line: rgba(9,9,11,.09); --lt-line-strong: rgba(9,9,11,.2);
      --lt-card: rgba(255,255,255,.55); --lt-card-line: rgba(255,255,255,.85);
      --lt-hover: rgba(9,9,11,.045);
      position: absolute; left: 0; right: 0; bottom: 0;
      display: flex; flex-direction: column;
      max-height: clamp(320px, 56dvh, 520px); overflow: hidden;
      background: var(--lt-glass);
      -webkit-backdrop-filter: var(--lt-blur); backdrop-filter: var(--lt-blur);
      border-top: 1px solid var(--lt-edge);
      border-radius: 20px 20px 0 0;
      box-shadow: var(--lt-shadow);
      padding-bottom: env(safe-area-inset-bottom, 0px);
      pointer-events: auto; visibility: hidden;
      transform: translateY(100%);
      transition: transform .36s cubic-bezier(.22,.61,.36,1),
        max-height .32s cubic-bezier(.22,.61,.36,1), visibility 0s linear .36s;
      will-change: transform;
    }
    html.dark .lt-near-sheet {
      --lt-glass: rgba(20,20,24,.74); --lt-edge: rgba(255,255,255,.09);
      --lt-shadow: 0 -12px 40px -14px rgba(0,0,0,.7);
      --lt-blur: blur(28px) saturate(140%);
      --lt-line: rgba(255,255,255,.08); --lt-line-strong: rgba(255,255,255,.22);
      --lt-card: rgba(255,255,255,.045); --lt-card-line: rgba(255,255,255,.07);
      --lt-hover: rgba(255,255,255,.05);
    }
    @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
      .lt-near-sheet { --lt-glass: rgba(250,250,251,.97); }
      html.dark .lt-near-sheet { --lt-glass: rgba(20,20,24,.97); }
    }
    @media (prefers-reduced-transparency: reduce) {
      .lt-near-sheet { --lt-glass: rgba(250,250,251,.97); }
      html.dark .lt-near-sheet { --lt-glass: rgba(20,20,24,.97); }
    }
    .lt-near-overlay.lt-open .lt-near-sheet {
      transform: translateY(0); visibility: visible;
      transition: transform .36s cubic-bezier(.22,.61,.36,1),
        max-height .32s cubic-bezier(.22,.61,.36,1), visibility 0s;
    }
    .lt-near-overlay[data-state="expanded"] .lt-near-sheet { max-height: 92dvh; }

    /* Pega do topo (só mobile), igual à do painel de detalhes. */
    .lt-np-handle {
      flex: 0 0 auto; height: 22px; display: flex; align-items: center;
      justify-content: center; cursor: grab; touch-action: none;
      user-select: none; -webkit-user-select: none;
    }
    .lt-np-handle:active { cursor: grabbing; }
    .lt-np-handle-pill {
      width: 38px; height: 4px; border-radius: 999px;
      background: var(--lt-line-strong);
    }

    @media (min-width: 768px) {
      .lt-near-sheet {
        left: auto; right: 2rem; bottom: 2rem; width: 440px;
        max-height: 80dvh; padding-bottom: 0;
        border: 1px solid var(--lt-edge); border-radius: 18px;
        box-shadow: 0 24px 60px -24px rgba(0,0,0,.35), 0 2px 8px rgba(0,0,0,.06);
        transform: translateY(calc(100% + 4rem));
      }
      html.dark .lt-near-sheet {
        box-shadow: 0 24px 60px -20px rgba(0,0,0,.8), 0 2px 8px rgba(0,0,0,.4);
      }
      .lt-near-overlay[data-state="expanded"] .lt-near-sheet { max-height: 80dvh; }
      .lt-np-handle { display: none; }
    }

    .lt-np-head {
      display: flex; align-items: flex-start; gap: .75rem;
      padding: .35rem 1.25rem 1rem; touch-action: none;
    }
    @media (min-width: 768px) { .lt-np-head { padding-top: 1.15rem; touch-action: auto; } }
    .lt-np-head-main { flex: 1; min-width: 0; }
    .lt-np-kicker {
      font-size: 9px; font-weight: 800; letter-spacing: .3em;
      text-transform: uppercase; color: #a1a1aa;
    }
    .lt-np-title {
      font-size: 22px; font-weight: 300; letter-spacing: -.02em;
      color: #18181b; margin-top: .35rem; line-height: 1.15;
    }
    html.dark .lt-np-title { color: #fff; }
    .lt-np-sub {
      font-size: 12px; color: #71717a; margin-top: .4rem; line-height: 1.45;
    }
    .lt-np-close {
      flex-shrink: 0; width: 34px; height: 34px; border: 0; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; color: #a1a1aa; cursor: pointer; border-radius: 9999px;
    }
    .lt-np-close:hover { color: #18181b; }
    html.dark .lt-np-close:hover { color: #fff; }

    /* Passo 1 — aviso de privacidade */
    .lt-np-intro { padding: 0 1.25rem 1.25rem; }
    .lt-np-note {
      display: flex; gap: .7rem; align-items: flex-start;
      padding: .8rem .9rem; border-radius: 10px;
      background: var(--lt-card); border: 1px solid var(--lt-card-line);
      font-size: 12px; line-height: 1.5; color: #52525b;
    }
    html.dark .lt-np-note { color: #a1a1aa; }
    .lt-np-note svg { width: 18px; height: 18px; flex-shrink: 0; color: #16a34a; margin-top: 1px; }
    .lt-np-toggle {
      display: flex; align-items: center; gap: .65rem; margin-top: .9rem;
      padding: .7rem .25rem; cursor: pointer;
      font-size: 13px; color: #3f3f46;
    }
    html.dark .lt-np-toggle { color: #d4d4d8; }
    .lt-np-toggle input { width: 17px; height: 17px; flex-shrink: 0; accent-color: #16a34a; }
    /* O mesmo interruptor do aviso inicial, agora também por baixo da lista:
       depois da primeira vez o aviso não volta a aparecer, e sem isto não havia
       forma de mudar de ideias. */
    .lt-np-toggle-foot {
      margin: .35rem 1.25rem 0; padding: .85rem .9rem;
      border-radius: 10px; border: 1px solid var(--lt-card-line);
      background: var(--lt-card); font-size: 12px; align-items: flex-start;
    }
    .lt-np-toggle-sub { color: #a1a1aa; font-size: 11px; }
    .lt-np-actions { display: flex; gap: .5rem; margin-top: .35rem; }
    .lt-np-btn {
      flex: 1; height: 44px; border-radius: 10px; cursor: pointer;
      font-family: inherit; font-size: 11px; font-weight: 800;
      letter-spacing: .16em; text-transform: uppercase;
      border: 1px solid #18181b; background: #18181b; color: #fff;
      transition: opacity .16s ease;
    }
    html.dark .lt-np-btn { background: #fafafa; border-color: #fafafa; color: #18181b; }
    .lt-np-btn:hover { opacity: .85; }
    .lt-np-btn.is-ghost {
      background: transparent; color: #71717a; border-color: rgb(228 228 231);
      flex: 0 0 auto; padding: 0 1.1rem;
    }
    html.dark .lt-np-btn.is-ghost { background: transparent; color: #a1a1aa; border-color: rgb(39 39 42); }

    /* Passo 2 — slider do raio */
    .lt-np-range {
      padding: 0 1.25rem 1rem; border-bottom: 1px solid var(--lt-line);
    }
    .lt-np-range-top {
      display: flex; align-items: baseline; justify-content: space-between;
      gap: .5rem; margin-bottom: .55rem;
    }
    .lt-np-range-label {
      font-size: 9px; font-weight: 800; letter-spacing: .22em;
      text-transform: uppercase; color: #a1a1aa;
    }
    .lt-np-range-value {
      font-size: 15px; font-weight: 500; color: #18181b;
      font-variant-numeric: tabular-nums;
    }
    html.dark .lt-np-range-value { color: #fff; }
    .lt-np-slider { width: 100%; margin: 0; accent-color: #18181b; height: 24px; }
    html.dark .lt-np-slider { accent-color: #fafafa; }
    .lt-np-range-ends {
      display: flex; justify-content: space-between;
      font-size: 9px; color: #a1a1aa; letter-spacing: .08em;
    }

    /* Passo 2 — lista */
    /* O corpo é o único filho da sheet e tem de ser ele a coluna flexível.
       Sem isto o .lt-np-list ficava com flex:1 dentro de um pai que não era
       flex, a lista crescia à vontade e o overflow:hidden da sheet cortava-a
       — não havia scroll nenhum com muitos resultados. */
    .lt-near-sheet > [data-np-body] {
      display: flex; flex-direction: column; flex: 1; min-height: 0;
    }
    /* min-height:0 é o que permite a um filho flex encolher abaixo do conteúdo
       e, com isso, ganhar scroll próprio. */
    .lt-np-list {
      flex: 1 1 auto; min-height: 0;
      overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch;
      overscroll-behavior: contain;
    }
    /* O cabeçalho e o cursor do raio ficam fixos. O interruptor e o rodapé
       vão dentro do scroll, a seguir à lista: na sheet mini não sobrava
       altura para eles e para mais de duas paragens. */
    .lt-np-head, .lt-np-range { flex: 0 0 auto; }
    .lt-np-row {
      display: flex; align-items: center; gap: .875rem; width: 100%; min-width: 0;
      padding: .8rem 1.25rem; cursor: pointer; text-align: left;
      background: transparent; border: 0; border-bottom: 1px solid var(--lt-line);
      font-family: inherit; color: inherit; transition: background .14s ease;
    }
    .lt-np-row:hover { background: var(--lt-hover); }
    .lt-np-row:focus-visible { outline: 2px solid #3b82f6; outline-offset: -3px; }
    .lt-np-ic {
      position: relative; flex-shrink: 0; width: 38px; height: 38px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 10px; background: var(--lt-card); color: #52525b;
      border: 1px solid var(--lt-card-line);
    }
    html.dark .lt-np-ic { color: #a1a1aa; }
    .lt-np-ic img { width: 22px; height: 22px; object-fit: contain; display: block; }
    .lt-np-ic .lt-sr-glyph { display: none; }
    .lt-np-ic.is-fallback img { display: none; }
    .lt-np-ic.is-fallback .lt-sr-glyph { display: inline-flex; }
    .lt-np-ic svg { width: 1.1rem; height: 1.1rem; }
    .lt-np-main { flex: 1; min-width: 0; display: block; overflow: hidden; }
    /* O selo fica FORA do elemento que corta com "…", senão desaparecia com o
       nome em ecrãs estreitos — e é ele que explica porque a linha está ali. */
    .lt-np-title-row {
      display: flex; align-items: center; gap: .4rem; min-width: 0;
    }
    .lt-np-name {
      display: block; flex: 0 1 auto; max-width: 100%;
      font-size: 15px; font-weight: 500; letter-spacing: -.01em;
      color: #18181b; line-height: 1.2;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    html.dark .lt-np-name { color: #fff; }
    .lt-np-meta {
      display: flex; align-items: center; gap: .45rem; margin-top: .3rem;
      overflow: hidden; min-width: 0;
    }
    .lt-np-walk {
      font-size: 10px; color: #a1a1aa; letter-spacing: .02em;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .lt-np-dist {
      flex-shrink: 0; text-align: right;
      font-size: 14px; font-weight: 500; color: #18181b;
      font-variant-numeric: tabular-nums;
    }
    html.dark .lt-np-dist { color: #fff; }
    .lt-np-chev { width: 14px; height: 14px; flex-shrink: 0; opacity: .25; }
    .lt-np-flag {
      display: inline-block; flex-shrink: 0; padding: 1px 5px;
      border-radius: 4px; background: #ecfdf5; color: #15803d;
      font-size: 8px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase;
      vertical-align: middle;
    }
    html.dark .lt-np-flag { background: rgba(22,163,74,.16); color: #4ade80; }

    .lt-np-state { padding: 3rem 1.5rem; text-align: center; }
    .lt-np-state p { font-size: 13px; color: #71717a; line-height: 1.5; }
    .lt-np-state p + p { margin-top: .5rem; font-size: 11px; color: #a1a1aa; }
    .lt-np-spin {
      width: 20px; height: 20px; margin: 0 auto 1rem;
      border: 2px solid rgba(0,0,0,.12); border-top-color: rgba(0,0,0,.45);
      border-radius: 9999px; animation: lt-np-rot .7s linear infinite;
    }
    html.dark .lt-np-spin { border-color: rgba(255,255,255,.16); border-top-color: rgba(255,255,255,.6); }
    @keyframes lt-np-rot { to { transform: rotate(360deg); } }
    .lt-np-foot {
      padding: .9rem 1.25rem 1.1rem; text-align: center;
      font-size: 9px; line-height: 1.6; color: #a1a1aa; letter-spacing: .02em;
    }
    @media (prefers-reduced-motion: reduce) {
      .lt-near-overlay, .lt-near-overlay .lt-near-sheet, .lt-np-row { transition: none !important; }
      .lt-np-spin { animation-duration: 2s; }
    }`;
    const el = document.createElement("style");
    el.id = "lt-near-styles";
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ═══ MARCADOR "ESTÁS AQUI" ═════════════════════════════════════════════
  // Desenhado a partir da posição em memória. Nada é persistido.
  const SRC = "lt-me";
  const L_DOT = "lt-me-dot";
  const L_HALO = "lt-me-halo";
  let map = null;

  function meCollection() {
    if (!position) return { type: "FeatureCollection", features: [] };
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [position.lng, position.lat],
          },
          properties: {},
        },
      ],
    };
  }

  function pushMe() {
    if (!map) return;
    try {
      if (!map.getSource(SRC))
        map.addSource(SRC, { type: "geojson", data: meCollection() });
      if (!map.getLayer(L_HALO))
        map.addLayer({
          id: L_HALO,
          type: "circle",
          source: SRC,
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              10,
              12,
              16,
              22,
            ],
            "circle-color": "#3b82f6",
            "circle-opacity": 0.18,
            "circle-blur": 0.3,
          },
        });
      if (!map.getLayer(L_DOT))
        map.addLayer({
          id: L_DOT,
          type: "circle",
          source: SRC,
          paint: {
            "circle-radius": 6,
            "circle-color": "#3b82f6",
            "circle-stroke-width": 2.5,
            "circle-stroke-color": "#ffffff",
          },
        });
      const src = map.getSource(SRC);
      if (src && src.setData) src.setData(meCollection());
    } catch (_) {}
  }

  function foraDaArea() {
    return (
      !position ||
      position.lat < AREA.minLat ||
      position.lat > AREA.maxLat ||
      position.lng < AREA.minLng ||
      position.lng > AREA.maxLng
    );
  }

  // Leva o mapa até à zona do utilizador.
  //
  // Há dois casos, e as regras são diferentes de propósito:
  //   arranque → não foi pedido, por isso desiste à mínima suspeita de que a
  //     pessoa já está a ver outra coisa;
  //   toque no botão → foi pedido, por isso obedece sempre. Aproxima com o
  //     desvio do painel, senão a posição ficava por baixo da sheet.
  //
  // Em qualquer dos casos, fora da área servida não vale a pena: o mapa não tem
  // dados lá e mostrar um ecrã vazio é pior do que ficar onde se estava.
  // Regras do arranque (uma só vez, e só se nada mais importante estiver a
  // acontecer). Devolve true se o arranque pode mexer no mapa / abrir a lista.
  function arranquePermitido() {
    if (autoFrameDone || !autoOn()) return false;
    autoFrameDone = true; // mesmo que desista abaixo: isto é de arranque
    // Um deep link a um comboio ou estação manda mais do que a localização.
    if (window.location.hash && window.location.hash.length > 1) return false;
    // Se já mexeu no mapa, mexeu por alguma razão.
    if (userMovedMap) return false;
    // Uma sheet aberta significa que já está a ver outra coisa.
    if (
      (window.MapaStation && window.MapaStation.isOpen()) ||
      (window.MapaDetails && window.MapaDetails.isOpen()) ||
      (window.GtfsHorarios && window.GtfsHorarios.isOpen()) ||
      (window.MapaCM && window.MapaCM.isOpen())
    )
      return false;
    return !foraDaArea();
  }

  function frameUser(manual) {
    if (!map || !position) return;
    if (!manual && !arranquePermitido()) return;
    if (foraDaArea()) {
      console.info(
        "[MapaPerto] fora da área servida; o mapa fica onde estava.",
      );
      return;
    }
    try {
      if (manual && window.MapaRender && window.MapaRender.focusStation) {
        // Reaproveita o enquadramento das estações: já aproxima e já
        // compensa o espaço que o painel ocupa.
        window.MapaRender.focusStation({
          lat: position.lat,
          lng: position.lng,
        });
        return;
      }
      map.easeTo({
        center: [position.lng, position.lat],
        zoom: Math.max(map.getZoom(), AUTO_ZOOM),
        duration: 900,
        essential: true,
      });
    } catch (_) {}
  }

  function patchMapaRender() {
    if (!window.MapaRender) return false;
    if (window.MapaRender._pertoPatched) return true;
    const orig = window.MapaRender.setMap;
    window.MapaRender.setMap = function (m) {
      if (orig) orig.call(this, m);
      map = m;
      // Qualquer gesto do utilizador cancela o enquadramento automático que
      // ainda esteja para vir: a posição pode demorar segundos a chegar, e a
      // essa altura ele já pode estar a olhar para outro sítio.
      map.on("movestart", (e) => {
        if (e && e.originalEvent) userMovedMap = true;
      });
      if (position) {
        if (map.isStyleLoaded()) pushMe();
        else map.once("styledata", pushMe);
      }
      map.on("styledata", () => {
        if (position) pushMe();
      });
      // Auto: se o utilizador ligou, a posição é obtida ao abrir o mapa. Não
      // abre o popup — só deixa a resposta pronta e marca onde ele está.
      if (autoOn() && introDone()) {
        setTimeout(() => locate({ silent: true, arranque: true }), 800);
      }
    };
    window.MapaRender._pertoPatched = true;
    return true;
  }

  // ═══ GEOLOCALIZAÇÃO ════════════════════════════════════════════════════
  function geoErrorText(err) {
    if (!err) return { title: "Não foi possível obter a localização." };
    if (err.code === 1)
      return {
        title: "Autorização recusada.",
        hint: "Podes voltar a permitir nas definições de localização do navegador, para este site.",
      };
    if (err.code === 3)
      return {
        title: "A localização demorou demasiado.",
        hint: "Em espaços fechados o sinal é fraco. Tenta outra vez ou aproxima-te de uma janela.",
      };
    return {
      title: "Não foi possível obter a localização.",
      hint: "O dispositivo não devolveu uma posição.",
    };
  }

  // opts.silent = não abre o popup por si (modo automático)
  // opts.arranque = é o pedido feito ao abrir o mapa: se as regras do arranque
  //   deixarem, abre a lista e aproxima o mapa (o open() trata das duas coisas)
  function locate(opts) {
    const silent = !!(opts && opts.silent);
    const arranque = !!(opts && opts.arranque);
    if (!navigator.geolocation) {
      if (!silent)
        renderState(
          "Este navegador não suporta localização.",
          "Podes usar a pesquisa para encontrar uma estação.",
        );
      return;
    }
    if (window.isSecureContext === false) {
      if (!silent)
        renderState(
          "A localização exige uma ligação segura (HTTPS).",
          "Em http o navegador bloqueia o pedido.",
        );
      return;
    }

    busy = true;
    syncButton();
    if (!silent) renderLoading();

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        busy = false;
        // Só o que é preciso, e só em memória.
        position = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        syncButton();
        pushMe();
        if (arranque) {
          if (!isOpen && arranquePermitido()) open();
          return;
        }
        // Silencioso sem arranque: o interruptor foi ligado com a lista aberta.
        // Com o popup aberto e não silencioso foi um toque no botão.
        frameUser(!silent);
        // O de arranque (silencioso) só aproxima o mapa: não precisa do índice
        // nem do motor da pesquisa. Com o popup aberto, carrega-o se ainda não
        // estiver (mapa-search.js) e espera pelas fontes assíncronas (MTS,
        // Metro), que podem ainda não estar prontas.
        if (silent) return;
        garantirPesquisa()
          .then(() =>
            window.MapaSearch && window.MapaSearch.ensureSources
              ? window.MapaSearch.ensureSources()
              : null,
          )
          .catch(() => {})
          .then(() => {
            if (isOpen) renderResults();
          });
      },
      (err) => {
        busy = false;
        syncButton();
        if (!silent) {
          const t = geoErrorText(err);
          renderState(t.title, t.hint, true);
        }
      },
      GEO_OPTS,
    );
  }

  // O índice e os logótipos vêm do motor da pesquisa, que só é descarregado
  // quando é preciso (mapa-search.js → window.LTPesquisa).
  function garantirPesquisa() {
    if (window.MapaSearch) return Promise.resolve(window.MapaSearch);
    return window.LTPesquisa
      ? window.LTPesquisa.carregar()
      : Promise.resolve(null);
  }

  // ═══ CÁLCULO DA LISTA ══════════════════════════════════════════════════
  // A Fertagus mais próxima entra sempre, mesmo fora do raio — é a espinha
  // dorsal da app e é a resposta que o utilizador quase sempre quer.
  function nearby() {
    if (!position) return { list: [], fertagus: null, withinCount: 0 };
    const index =
      window.MapaSearch && window.MapaSearch.index
        ? window.MapaSearch.index()
        : [];

    const withDist = [];
    for (const item of index) {
      if (typeof item.lat !== "number" || typeof item.lng !== "number")
        continue;
      const d = distance(position.lat, position.lng, item.lat, item.lng);
      withDist.push({ item, d });
    }
    withDist.sort((a, b) => a.d - b.d);

    // "guardadas" são paragens Carris; o operador de facto continua a ser o CM.
    const fertagus = withDist.find((x) => x.item.op === "fertagus") || null;

    const within = withDist.filter((x) => x.d <= range);
    const out = [];
    if (fertagus) out.push({ ...fertagus, pinned: true });
    for (const x of within) {
      if (fertagus && x.item === fertagus.item) continue;
      out.push(x);
      if (out.length >= MAX_ITEMS) break;
    }
    return { list: out, fertagus, withinCount: within.length };
  }

  // ═══ RENDER ════════════════════════════════════════════════════════════
  function headHtml(title, sub) {
    return `
      <div class="lt-np-head">
        <div class="lt-np-head-main">
          <p class="lt-np-kicker">Perto de mim</p>
          <h2 class="lt-np-title">${escapeHtml(title)}</h2>
          ${sub ? `<p class="lt-np-sub">${sub}</p>` : ""}
        </div>
        <button type="button" class="lt-np-close" data-np="close" aria-label="Fechar">${SVG_X}</button>
      </div>`;
  }

  // Passo 1
  function renderIntro() {
    bodyEl.innerHTML =
      headHtml(
        "Ver o que tenho à volta",
        "Vamos pedir ao teu navegador autorização para usar a <strong>localização exata</strong> do dispositivo.",
      ) +
      `<div class="lt-np-intro">
        <div class="lt-np-note">
          ${SVG_SHIELD}
          <span>A tua localização é usada <strong>apenas neste dispositivo</strong>, para medir a distância às paragens. Não é enviada para nenhum servidor, não é guardada e desaparece quando fechas a página.</span>
        </div>
        <label class="lt-np-toggle">
          <input type="checkbox" data-np="auto" ${autoOn() ? "checked" : ""}>
          <span>Localizar automaticamente sempre que abrir o mapa</span>
        </label>
        <div class="lt-np-actions">
          <button type="button" class="lt-np-btn is-ghost" data-np="close">Agora não</button>
          <button type="button" class="lt-np-btn" data-np="allow">Permitir localização</button>
        </div>
      </div>`;
  }

  function renderLoading(title, msg, hint) {
    bodyEl.innerHTML =
      headHtml(title || "A obter a localização…", "") +
      `<div class="lt-np-state" role="status">
        <div class="lt-np-spin"></div>
        <p>${escapeHtml(msg || "A pedir a posição ao dispositivo.")}</p>
        ${hint === "" ? "" : `<p>${escapeHtml(hint || "Em espaços fechados pode levar alguns segundos.")}</p>`}
      </div>`;
  }

  function renderState(title, hint, retry) {
    bodyEl.innerHTML =
      headHtml(title, "") +
      `<div class="lt-np-state" role="status">
        <p>${escapeHtml(hint || "")}</p>
      </div>` +
      (retry
        ? `<div class="lt-np-intro"><div class="lt-np-actions">
             <button type="button" class="lt-np-btn is-ghost" data-np="close">Fechar</button>
             <button type="button" class="lt-np-btn" data-np="allow">Tentar de novo</button>
           </div></div>`
        : "");
  }

  function rowHtml(entry, idx) {
    const item = entry.item;
    const S = window.MapaSearch || {};
    const meta = (S.operators && S.operators[item.op]) || {};
    const logo = S.logoHtml ? S.logoHtml(meta, "") : "";
    const glyph = S.glyphFor ? S.glyphFor(meta.glyph) : "";
    const pills = S.pillsHtml ? S.pillsHtml(item.pills) : "";
    // O selo só faz sentido quando explica algo: esta linha está acima do raio
    // porque a Fertagus aparece sempre. Dentro do raio é um resultado normal e
    // o logótipo já diz que é Fertagus.
    const flag =
      entry.pinned && entry.d > range
        ? `<span class="lt-np-flag">Mais próxima</span>`
        : "";
    // Sem estimativa de tempo a pé: a distância é em linha reta e o tempo que
    // se calculava a partir dela dava uma precisão que não existe.
    const meta2 = item.ctx || "";
    return `
      <button type="button" class="lt-np-row" data-np-open="${idx}">
        <span class="lt-np-ic">${logo}<span class="lt-sr-glyph">${glyph}</span></span>
        <span class="lt-np-main">
          <span class="lt-np-title-row">
            <span class="lt-np-name">${escapeHtml(item.name)}</span>
            ${flag}
          </span>
          ${
            pills || meta2
              ? `<span class="lt-np-meta">${pills}${meta2 ? `<span class="lt-np-walk">${escapeHtml(meta2)}</span>` : ""}</span>`
              : ""
          }
        </span>
        <span class="lt-np-dist">${escapeHtml(fmtDistance(entry.d))}</span>
        ${SVG_CHEV}
      </button>`;
  }

  let curList = [];

  function renderResults() {
    const res = nearby();
    curList = res.list;
    const idx = Math.max(0, RANGES.indexOf(range));
    const accuracy =
      position && position.accuracy
        ? ` · precisão ±${Math.round(position.accuracy)} m`
        : "";

    const listHtml = curList.length
      ? curList.map(rowHtml).join("")
      : `<div class="lt-np-state"><p>Nada dentro de ${escapeHtml(fmtRange(range))}.</p><p>Aumenta o raio no cursor acima.</p></div>`;

    bodyEl.innerHTML =
      headHtml(
        res.withinCount === 0 && res.fertagus
          ? "Nada por perto"
          : `${res.withinCount} ${res.withinCount === 1 ? "paragem" : "paragens"} à volta`,
        "",
      ) +
      `<div class="lt-np-range">
        <div class="lt-np-range-top">
          <span class="lt-np-range-label">Raio</span>
          <span class="lt-np-range-value" data-np-range-value>${escapeHtml(fmtRange(range))}</span>
        </div>
        <input type="range" class="lt-np-slider" data-np="range"
          min="0" max="${RANGES.length - 1}" step="1" value="${idx}"
          aria-label="Raio de procura" aria-valuetext="${escapeHtml(fmtRange(range))}">
        <div class="lt-np-range-ends"><span>${fmtRange(RANGES[0])}</span><span>${fmtRange(RANGES[RANGES.length - 1])}</span></div>
      </div>
      <div class="lt-np-list"><div data-np-rows>${listHtml}</div>
      <label class="lt-np-toggle lt-np-toggle-foot">
        <input type="checkbox" data-np="auto" ${autoOn() ? "checked" : ""}>
        <span>Localizar automaticamente ao abrir o mapa<br>
          <span class="lt-np-toggle-sub">Com isto ligado, o mapa abre já na tua zona com esta lista.</span>
        </span>
      </label>
      <p class="lt-np-foot">Distância em linha reta a partir do teu dispositivo${escapeHtml(accuracy)}. A localização não sai daqui.</p></div>`;

    if (window.MapaSearch && window.MapaSearch.hookLogos)
      window.MapaSearch.hookLogos(bodyEl);
  }

  // Só a lista e o valor mudam ao arrastar o cursor — não redesenha o slider,
  // senão perde-se o arrasto a meio.
  function updateRange(newRange) {
    range = newRange;
    setPref(KEY_RANGE, String(range));
    const res = nearby();
    curList = res.list;
    const valueEl = bodyEl.querySelector("[data-np-range-value]");
    if (valueEl) valueEl.textContent = fmtRange(range);
    const slider = bodyEl.querySelector('[data-np="range"]');
    if (slider) slider.setAttribute("aria-valuetext", fmtRange(range));
    const titleEl = bodyEl.querySelector(".lt-np-title");
    if (titleEl)
      titleEl.textContent =
        res.withinCount === 0 && res.fertagus
          ? "Nada por perto"
          : `${res.withinCount} ${res.withinCount === 1 ? "paragem" : "paragens"} à volta`;
    const listEl = bodyEl.querySelector("[data-np-rows]");
    if (listEl) {
      listEl.innerHTML = curList.length
        ? curList.map(rowHtml).join("")
        : `<div class="lt-np-state"><p>Nada dentro de ${escapeHtml(fmtRange(range))}.</p><p>Aumenta o raio no cursor acima.</p></div>`;
      if (window.MapaSearch && window.MapaSearch.hookLogos)
        window.MapaSearch.hookLogos(listEl);
    }
  }

  // ═══ INTERAÇÃO ═════════════════════════════════════════════════════════
  function onSheetClick(e) {
    const openBtn = e.target.closest("[data-np-open]");
    if (openBtn) {
      const entry = curList[parseInt(openBtn.getAttribute("data-np-open"), 10)];
      if (entry && entry.item && typeof entry.item.run === "function") {
        close();
        setTimeout(() => entry.item.run(), 120);
      }
      return;
    }
    const act = e.target.closest("[data-np]");
    if (!act) return;
    const kind = act.getAttribute("data-np");
    if (kind === "close") return close();
    if (kind === "allow") {
      // O interruptor do passo 1 é lido antes de pedir a autorização.
      const toggle = bodyEl.querySelector('[data-np="auto"]');
      if (toggle) setPref(KEY_AUTO, toggle.checked ? "1" : "0");
      setPref(KEY_INTRO, "1");
      locate();
    }
  }

  // O interruptor existe em dois sítios (aviso inicial e rodapé dos
  // resultados). Guardar aqui cobre os dois, e o "Permitir" volta a ler o
  // estado na mesma — não faz mal.
  function onSheetChange(e) {
    const el = e.target;
    if (!el || !el.getAttribute || el.getAttribute("data-np") !== "auto")
      return;
    setPref(KEY_AUTO, el.checked ? "1" : "0");
    // Ligar com a autorização já dada e sem posição em memória: vai buscá-la
    // agora, para o efeito ser imediato em vez de só no próximo arranque.
    if (el.checked && introDone() && !position) locate({ silent: true });
  }

  function onSheetInput(e) {
    const el = e.target;
    if (el && el.getAttribute && el.getAttribute("data-np") === "range") {
      const i = parseInt(el.value, 10);
      if (RANGES[i] != null) updateRange(RANGES[i]);
    }
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  // ═══ SHEET ═════════════════════════════════════════════════════════════
  function setSheetState(s) {
    sheetState = s;
    if (overlay) overlay.dataset.state = s;
  }

  // ─── Arrasto (só mobile), com as regras do painel de detalhes ────────
  // Pega ou cabeçalho: para cima expande; para baixo encolhe (expandida) ou
  // fecha (mini). A lista em si faz scroll normal e nunca arrasta a sheet.
  let drag = null;
  const isDesktop = () => window.matchMedia("(min-width: 768px)").matches;
  const pointerY = (e) =>
    e.touches && e.touches[0]
      ? e.touches[0].clientY
      : e.changedTouches && e.changedTouches[0]
        ? e.changedTouches[0].clientY
        : e.clientY;
  function onDragStart(e) {
    if (!isOpen || isDesktop() || drag) return;
    const t = e.target;
    if (!t.closest || !t.closest(".lt-np-handle, .lt-np-head")) return;
    if (t.closest("button, input, a, label")) return;
    const y = pointerY(e);
    drag = { y0: y, y: y, t0: Date.now(), moved: false };
    sheet.style.transition = "none";
  }
  function onDragMove(e) {
    if (!drag) return;
    const y = pointerY(e);
    if (typeof y !== "number") return;
    drag.y = y;
    const dy = y - drag.y0;
    if (Math.abs(dy) > 4) drag.moved = true;
    // Para baixo segue o dedo; para cima resiste (a expansão é no fim).
    sheet.style.transform = `translateY(${dy > 0 ? dy : dy * 0.2}px)`;
  }
  function onDragEnd() {
    if (!drag) return;
    const dy = drag.y - drag.y0;
    const dt = Date.now() - drag.t0;
    const v = dt > 0 ? dy / dt : 0;
    drag = null;
    sheet.style.transition = "";
    sheet.style.transform = "";
    if (dy < -60 || v < -0.6) {
      setSheetState("expanded");
    } else if (dy > 110 || (v > 0.6 && dy > 40)) {
      if (sheetState === "expanded" && dy < window.innerHeight * 0.45)
        setSheetState("mini");
      else close();
    }
  }

  // Outro painel (estação, comboio, paragem…) a abrir por cima fecha esta
  // sheet: todos usam o #details-panel, que fica por baixo dela.
  function watchDetailsPanel() {
    const dp = document.getElementById("details-panel");
    if (!dp || dp._ltNearWatch || !window.MutationObserver) return;
    dp._ltNearWatch = true;
    new MutationObserver(() => {
      const st = dp.getAttribute("data-state");
      if (isOpen && st && st !== "closed") close();
    }).observe(dp, { attributes: true, attributeFilter: ["data-state"] });
  }

  function build() {
    overlay = document.createElement("div");
    overlay.className = "lt-near-overlay";
    overlay.innerHTML = `<div class="lt-near-sheet" role="dialog" aria-modal="false" aria-label="Transportes perto de mim"><div class="lt-np-handle" aria-hidden="true"><div class="lt-np-handle-pill"></div></div><div data-np-body></div></div>`;
    document.body.appendChild(overlay);
    sheet = overlay.querySelector(".lt-near-sheet");
    bodyEl = overlay.querySelector("[data-np-body]");
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    sheet.addEventListener("click", onSheetClick);
    sheet.addEventListener("input", onSheetInput);
    sheet.addEventListener("change", onSheetChange);
    sheet.addEventListener("touchstart", onDragStart, { passive: true });
    sheet.addEventListener("touchmove", onDragMove, { passive: true });
    sheet.addEventListener("touchend", onDragEnd, { passive: true });
    sheet.addEventListener("touchcancel", onDragEnd, { passive: true });
    sheet.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") onDragStart(e);
    });
    window.addEventListener("pointermove", (e) => {
      if (drag && e.pointerType !== "touch") onDragMove(e);
    });
    window.addEventListener("pointerup", (e) => {
      if (drag && e.pointerType !== "touch") onDragEnd(e);
    });
  }

  function open() {
    injectStyles();
    if (!overlay) build();
    if (isOpen) return;
    isOpen = true;
    lastFocus = document.activeElement;
    loadRange();
    watchDetailsPanel();
    setSheetState("mini");
    overlay.classList.add("lt-open");
    document.addEventListener("keydown", onKey);
    if (btnEl) btnEl.setAttribute("aria-expanded", "true");

    // Passo 1 na primeira vez; depois, se já houver posição em memória, a lista
    // aparece de imediato.
    if (!introDone()) renderIntro();
    else if (position) {
      // Posição já em memória: mostra a lista (assim que o motor da pesquisa
      // e as fontes assíncronas — Metro, MTS — estiverem prontos) e aproxima.
      renderLoading(
        "A procurar paragens…",
        "A carregar as paragens do mapa.",
        "",
      );
      garantirPesquisa()
        .then(() =>
          window.MapaSearch && window.MapaSearch.ensureSources
            ? window.MapaSearch.ensureSources()
            : null,
        )
        .catch(() => {})
        .then(() => {
          if (isOpen) renderResults();
        });
      frameUser(true);
    } else locate();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    drag = null;
    if (sheet) {
      sheet.style.transition = "";
      sheet.style.transform = "";
    }
    overlay.classList.remove("lt-open");
    document.removeEventListener("keydown", onKey);
    if (btnEl) btnEl.setAttribute("aria-expanded", "false");
    if (lastFocus && lastFocus.focus) {
      try {
        lastFocus.focus({ preventScroll: true });
      } catch (_) {}
    }
  }

  // ═══ BOTÃO ═════════════════════════════════════════════════════════════
  function syncButton() {
    if (!btnEl) return;
    btnEl.classList.toggle("is-busy", busy);
    btnEl.classList.toggle("is-on", !busy && !!position);
    btnEl.setAttribute(
      "aria-label",
      busy
        ? "A obter localização"
        : position
          ? "Transportes perto de mim (localização obtida)"
          : "Ver transportes perto de mim",
    );
  }

  // Pilha de botões flutuantes do canto superior direito, de cima para baixo.
  // Um só sítio a decidir a ordem e as posições: antes cada módulo posicionava
  // o seu e tinha de saber da existência dos outros.
  const STACK = ["btn-mapview", "lt-near-btn", "lt-search-btn"];
  const STACK_GAP = 8;

  // A pilha começa logo por baixo do botão do menu, à mesma distância que o
  // separa do botão de partilha (o gap do #nav-actions), e os botões da pilha
  // ficam com esse mesmo espaço entre si.
  function layoutStack() {
    const header = document.querySelector("#global-nav header");
    if (!header) return;
    const trig = document.getElementById("menu-trigger");
    const share = document.getElementById("nav-share-trigger");
    const r = (trig || header).getBoundingClientRect();
    if (!r || r.bottom <= 0) return;
    let gap = STACK_GAP;
    if (trig && share) {
      const g =
        trig.getBoundingClientRect().left - share.getBoundingClientRect().right;
      if (g > 0 && g < 40) gap = g;
    }
    let top = trig ? r.bottom + gap : r.bottom + 12;
    for (const id of STACK) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.style.top = Math.round(top) + "px";
      top += (el.offsetHeight || 42) + gap;
    }
    // O menu das camadas alinha por baixo do seu próprio botão.
    const eye = document.getElementById("btn-mapview");
    const menu = document.getElementById("mapview-menu");
    if (eye && menu) {
      menu.style.top =
        Math.round(
          parseFloat(eye.style.top || 0) + (eye.offsetHeight || 42) + 6,
        ) + "px";
    }
  }

  function positionButton() {
    layoutStack();
  }

  function injectButton() {
    const host =
      document.querySelector(".mapa-container") ||
      (document.getElementById("map") &&
        document.getElementById("map").parentElement) ||
      document.body;
    if (!host || document.getElementById("lt-near-btn")) return;

    btnEl = document.createElement("button");
    btnEl.id = "lt-near-btn";
    btnEl.className = "lt-near-btn";
    btnEl.type = "button";
    btnEl.setAttribute("aria-haspopup", "dialog");
    btnEl.setAttribute("aria-expanded", "false");
    btnEl.innerHTML = SVG_NEAR;
    btnEl.addEventListener("click", (e) => {
      e.stopPropagation();
      open();
    });
    host.appendChild(btnEl);
    syncButton();

    // O header é injetado de forma assíncrona → reposiciona quando aparecer.
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
    loadRange();
    if (!patchMapaRender()) {
      const t = setInterval(() => {
        if (patchMapaRender()) clearInterval(t);
      }, 20);
    }
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();

  window.MapaPerto = {
    // Chamado pelos outros módulos quando acrescentam ou removem um botão.
    layout: layoutStack,
    open,
    close,
    locate,
    isOpen: () => isOpen,
    state: () => (isOpen ? sheetState : "closed"),
    // Devolve uma cópia, para nada de fora poder alterar a posição guardada.
    position: () => (position ? Object.assign({}, position) : null),
    // Esquece a posição e o marcador (sem tocar nas preferências).
    forget: () => {
      position = null;
      syncButton();
      pushMe();
    },
    _internals: { distance, nearby, RANGES, fmtDistance, frameUser },
  };
})();

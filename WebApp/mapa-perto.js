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
  const WALK_M_PER_MIN = 80; // ~4,8 km/h

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
  function fmtWalk(m) {
    const min = Math.max(1, Math.round(m / WALK_M_PER_MIN));
    return min < 60 ? `${min} min a pé` : `${Math.round(min / 60)} h a pé`;
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

    .lt-near-overlay {
      position: fixed; inset: 0; z-index: 60;
      background: rgba(9,9,11,.42);
      -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
      opacity: 0; pointer-events: none; transition: opacity .22s ease;
    }
    .lt-near-overlay.lt-open { opacity: 1; pointer-events: auto; }

    .lt-near-sheet {
      position: absolute; top: 0; left: 0; right: 0;
      display: flex; flex-direction: column;
      max-height: 88dvh; overflow: hidden;
      background: #fff; border-radius: 0 0 16px 16px;
      box-shadow: 0 24px 48px -12px rgba(0,0,0,.35);
      padding-top: env(safe-area-inset-top, 0px);
      transform: translateY(-14px); opacity: 0;
      transition: transform .34s cubic-bezier(.16,1,.3,1), opacity .28s ease;
    }
    html.dark .lt-near-sheet { background: #09090b; }
    .lt-near-overlay.lt-open .lt-near-sheet { transform: translateY(0); opacity: 1; }
    @media (min-width: 768px) {
      .lt-near-sheet {
        top: 4.5rem; left: 50%; right: auto; width: 440px;
        transform: translate(-50%, -12px); border-radius: 14px;
        border: 1px solid rgb(228 228 231);
      }
      html.dark .lt-near-sheet { border-color: rgb(24 24 27); }
      .lt-near-overlay.lt-open .lt-near-sheet { transform: translate(-50%, 0); }
    }

    .lt-np-head {
      display: flex; align-items: flex-start; gap: .75rem;
      padding: 1.15rem 1.25rem 1rem;
    }
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
      background: #fafafa; border: 1px solid rgb(244 244 245);
      font-size: 12px; line-height: 1.5; color: #52525b;
    }
    html.dark .lt-np-note { background: #131316; border-color: rgb(24 24 27); color: #a1a1aa; }
    .lt-np-note svg { width: 18px; height: 18px; flex-shrink: 0; color: #16a34a; margin-top: 1px; }
    .lt-np-toggle {
      display: flex; align-items: center; gap: .65rem; margin-top: .9rem;
      padding: .7rem .25rem; cursor: pointer;
      font-size: 13px; color: #3f3f46;
    }
    html.dark .lt-np-toggle { color: #d4d4d8; }
    .lt-np-toggle input { width: 17px; height: 17px; flex-shrink: 0; accent-color: #16a34a; }
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
      padding: 0 1.25rem 1rem; border-bottom: 1px solid rgb(244 244 245);
    }
    html.dark .lt-np-range { border-bottom-color: rgb(24 24 27); }
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
    .lt-np-list { flex: 1; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; }
    .lt-np-row {
      display: flex; align-items: center; gap: .875rem; width: 100%; min-width: 0;
      padding: .8rem 1.25rem; cursor: pointer; text-align: left;
      background: transparent; border: 0; border-bottom: 1px solid rgb(244 244 245);
      font-family: inherit; color: inherit; transition: background .14s ease;
    }
    html.dark .lt-np-row { border-bottom-color: rgb(24 24 27); }
    .lt-np-row:hover { background: #fafafa; }
    html.dark .lt-np-row:hover { background: #131316; }
    .lt-np-row:focus-visible { outline: 2px solid #3b82f6; outline-offset: -3px; }
    .lt-np-ic {
      position: relative; flex-shrink: 0; width: 38px; height: 38px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 10px; background: #f4f4f5; color: #52525b;
    }
    html.dark .lt-np-ic { background: #18181b; color: #a1a1aa; }
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
      .lt-near-overlay, .lt-near-sheet, .lt-np-row { transition: none !important; }
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

  function patchMapaRender() {
    if (!window.MapaRender) return false;
    if (window.MapaRender._pertoPatched) return true;
    const orig = window.MapaRender.setMap;
    window.MapaRender.setMap = function (m) {
      if (orig) orig.call(this, m);
      map = m;
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
        setTimeout(() => locate({ silent: true }), 800);
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

  // opts.silent = não abre o popup (modo automático)
  function locate(opts) {
    const silent = !!(opts && opts.silent);
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
        // As fontes assíncronas (MTS, Metro) podem ainda não estar prontas.
        const ready =
          window.MapaSearch && window.MapaSearch.ensureSources
            ? window.MapaSearch.ensureSources()
            : Promise.resolve();
        ready.then(() => {
          if (!silent) renderResults();
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

  function renderLoading() {
    bodyEl.innerHTML =
      headHtml("A obter a localização…", "") +
      `<div class="lt-np-state" role="status">
        <div class="lt-np-spin"></div>
        <p>A pedir a posição ao dispositivo.</p>
        <p>Em espaços fechados pode levar alguns segundos.</p>
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
    const meta2 = [fmtWalk(entry.d), item.ctx].filter(Boolean).join(" · ");
    return `
      <button type="button" class="lt-np-row" data-np-open="${idx}">
        <span class="lt-np-ic">${logo}<span class="lt-sr-glyph">${glyph}</span></span>
        <span class="lt-np-main">
          <span class="lt-np-title-row">
            <span class="lt-np-name">${escapeHtml(item.name)}</span>
            ${flag}
          </span>
          <span class="lt-np-meta">${pills}<span class="lt-np-walk">${escapeHtml(meta2)}</span></span>
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
      <div class="lt-np-list">${listHtml}</div>
      <p class="lt-np-foot">Distância em linha reta a partir do teu dispositivo${escapeHtml(accuracy)}. A localização não sai do teu disppositivo.</p>`;

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
    const listEl = bodyEl.querySelector(".lt-np-list");
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
  function build() {
    overlay = document.createElement("div");
    overlay.className = "lt-near-overlay";
    overlay.innerHTML = `<div class="lt-near-sheet" role="dialog" aria-modal="true" aria-label="Transportes perto de mim"><div data-np-body></div></div>`;
    document.body.appendChild(overlay);
    sheet = overlay.querySelector(".lt-near-sheet");
    bodyEl = overlay.querySelector("[data-np-body]");
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    sheet.addEventListener("click", onSheetClick);
    sheet.addEventListener("input", onSheetInput);
  }

  function open() {
    injectStyles();
    if (!overlay) build();
    if (isOpen) return;
    isOpen = true;
    lastFocus = document.activeElement;
    loadRange();
    overlay.classList.add("lt-open");
    document.addEventListener("keydown", onKey);
    if (btnEl) btnEl.setAttribute("aria-expanded", "true");

    // Passo 1 na primeira vez; depois, se já houver posição em memória, a lista
    // aparece de imediato.
    if (!introDone()) renderIntro();
    else if (position) renderResults();
    else locate();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
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

  function positionButton() {
    if (!btnEl) return;
    const header = document.querySelector("#global-nav header");
    if (!header) return;
    const r = header.getBoundingClientRect();
    if (!r || r.bottom <= 0) return;
    btnEl.style.top = Math.round(r.bottom + 12) + "px";
    // A pesquisa fica abaixo deste botão.
    if (window.MapaSearch && window.MapaSearch.reposition)
      window.MapaSearch.reposition();
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
    open,
    close,
    locate,
    isOpen: () => isOpen,
    // Devolve uma cópia, para nada de fora poder alterar a posição guardada.
    position: () => (position ? Object.assign({}, position) : null),
    // Esquece a posição e o marcador (sem tocar nas preferências).
    forget: () => {
      position = null;
      syncButton();
      pushMe();
    },
    _internals: { distance, nearby, RANGES, fmtDistance, fmtWalk },
  };
})();

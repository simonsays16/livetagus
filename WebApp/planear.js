/**
 * planear.js
 * Planeador de viagens LiveTagus (Fertagus).
 * Reage ao evento "lt:search" emitido por planear-searchbar.js e renderiza os
 * resultados (partidas), com cartões idênticos aos da app (app.html / app-ui.js),
 * ocupação por carruagem, detalhes de viagem e sugestões de conforto.
 *
 * Sem dependências externas. Conforme CSP (script-src 'self'): zero JS inline,
 * todos os handlers via addEventListener / delegação.
 */
(function () {
  "use strict";

  // ─── ESTAÇÕES (ordem física Sul → Norte / Margem → Lisboa) ──────────────
  const STATIONS = [
    { key: "setubal", name: "Setúbal" },
    { key: "palmela", name: "Palmela" },
    { key: "venda_do_alcaide", name: "Venda do Alcaide" },
    { key: "pinhal_novo", name: "Pinhal Novo" },
    { key: "penalva", name: "Penalva" },
    { key: "coina", name: "Coina" },
    { key: "fogueteiro", name: "Fogueteiro" },
    { key: "foros_de_amora", name: "Foros de Amora" },
    { key: "corroios", name: "Corroios" },
    { key: "pragal", name: "Pragal" },
    { key: "campolide", name: "Campolide" },
    { key: "sete_rios", name: "Sete Rios" },
    { key: "entrecampos", name: "Entrecampos" },
    { key: "roma_areeiro", name: "Roma-Areeiro" },
  ];
  const NAME_OF = (key) => (STATIONS.find((s) => s.key === key) || {}).name || key;
  const IDX_OF = (key) => STATIONS.findIndex((s) => s.key === key);

  // Estações onde a ocupação em hora de ponta justifica sugerir alternativas.
  // Aplica-se apenas ao SENTIDO LISBOA (embarque nestas estações a caminho de Lisboa).
  const SUGGEST_ORIGINS = new Set([
    "foros_de_amora",
    "corroios",
    "pragal",
    "sete_rios",
    "campolide",
  ]);
  // Acima deste valor, a viagem é considerada cheia e procuramos alternativas.
  const OCC_THRESHOLD = 85;
  // Uma alternativa só é sugerida se ficar ABAIXO deste valor de ocupação.
  const COMFORT_MAX = 75;
  const MAX_MONTHS_AHEAD = 3;

  // ─── ESTADO ─────────────────────────────────────────────────────────────
  let DB_LISBOA = null;
  let DB_MARGEM = null;
  let FERIADOS = {};
  let currentPlan = []; // lista de viagens atualmente renderizada
  let displayLimit = 8;
  let lastQuery = null;

  // Promessa que resolve quando os JSON locais estiverem carregados.
  const dbReady = (async function loadDB() {
    try {
      const [l, m, f] = await Promise.all([
        fetch("./json/fertagus_sentido_lisboa.json"),
        fetch("./json/fertagus_sentido_margem.json"),
        fetch("./json/feriados.json"),
      ]);
      if (l.ok) DB_LISBOA = await l.json();
      if (m.ok) DB_MARGEM = await m.json();
      if (f.ok) FERIADOS = await f.json();
    } catch (e) {
      console.error("[planear] Erro a carregar horários:", e);
      DB_LISBOA = { trips: [] };
      DB_MARGEM = { trips: [] };
      FERIADOS = {};
    }
  })();

  // ─── HELPERS DE DATA/HORA ───────────────────────────────────────────────
  function ymdToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  }

  /** Date à meia-noite local da data YMD (evita saltos de fuso). */
  function ymdToDate(ymd) {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  /**
   * Converte "HH:MM" num Date ancorado na data operacional `ymd`.
   * Horas de madrugada (< 03:00) pertencem ao dia civil seguinte.
   */
  function timeOnDate(hhmm, ymd) {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(":").map(Number);
    const base = ymdToDate(ymd);
    if (h < 3) base.setDate(base.getDate() + 1);
    base.setHours(h, m, 0, 0);
    return base;
  }

  function isSpecialDay(ymd) {
    const d = ymdToDate(ymd);
    const wd = d.getDay();
    if (wd === 0 || wd === 6) return true;
    return !!FERIADOS[ymd];
  }

  function dayTypeLabel(ymd) {
    const d = ymdToDate(ymd);
    const wd = d.getDay();
    const holiday = FERIADOS[ymd];
    if (holiday && holiday !== "FDS") return holiday; // nome do feriado
    if (wd === 0 || wd === 6 || holiday === "FDS") return "Fim de semana";
    return "Dia útil";
  }

  function tripMatchesDay(horario, special) {
    const h = parseInt(horario, 10);
    if (h === 1) return true;
    if (h === 0 && !special) return true;
    if (h === 2 && special) return true;
    return false;
  }

  function directionOf(orgKey, dstKey) {
    return IDX_OF(orgKey) < IDX_OF(dstKey) ? "lisboa" : "margem";
  }

  function fmtHM(d) {
    return d
      ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
      : "--:--";
  }

  // ─── CONSTRUÇÃO DA LISTA DE VIAGENS ─────────────────────────────────────
  function buildTrips(org, dst, ymd) {
    const dir = directionOf(org, dst);
    const db = dir === "lisboa" ? DB_LISBOA : DB_MARGEM;
    if (!db || !db.trips) return [];
    const special = isSpecialDay(ymd);

    return db.trips
      .filter((t) => t[org] && t[dst] && tripMatchesDay(t.horario, special))
      .map((t) => {
        const dep = timeOnDate(t[org], ymd);
        const arr = timeOnDate(t[dst], ymd);
        if (!dep || !arr || dep >= arr) return null;
        const durationMin = Math.round((arr - dep) / 60000);
        return {
          id: t.id,
          num: t.id,
          origin: NAME_OF(org),
          originKey: org,
          dest: NAME_OF(dst),
          destKey: dst,
          time: t[org],
          arr: t[dst],
          depDate: dep,
          arrDate: arr,
          durationMin,
          carriages: special ? 4 : t.carruagens,
          occupancy: special ? null : t.ocupacao,
          direction: dir,
          horario: t.horario,
          raw: t,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.depDate - b.depDate);
  }

  // ─── SELEÇÃO DO MELHOR COMBOIO ──────────────────────────────────────────
  function pickTargetIndex(trips, mode, target) {
    if (!trips.length) return -1;
    if (mode === "arr") {
      // Quer chegar até `target`: último comboio que chega a horas.
      let idx = -1;
      for (let i = 0; i < trips.length; i++) {
        if (trips[i].arrDate <= target) idx = i;
        else break;
      }
      return idx === -1 ? 0 : idx;
    }
    // Partida: primeiro comboio a partir da hora pretendida.
    for (let i = 0; i < trips.length; i++) {
      if (trips[i].depDate >= target) return i;
    }
    return trips.length - 1;
  }

  // ─── ESTILOS ────────────────────────────────────────────────────────────
  // Linguagem visual da página das estações (partidas.js / estacao.html):
  // fio de 1px, faixa de acento à esquerda, mono tabular para horas,
  // micro-maiúsculas espaçadas para etiquetas.
  function injectStyle() {
    if (document.getElementById("lt-pl-style")) return;
    const st = document.createElement("style");
    st.id = "lt-pl-style";
    st.textContent = `
.lt-pl{font-family:"Inter",-apple-system,BlinkMacSystemFont,sans-serif;-webkit-tap-highlight-color:transparent}
.lt-pl-fade{animation:lt-pl-fade .4s ease both}
@keyframes lt-pl-fade{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}

/* ─── Cabeçalho do resultado ───────────────────────────────────────────── */
.lt-pl-route{display:flex;align-items:baseline;flex-wrap:wrap;gap:.5rem .7rem;margin-bottom:.7rem}
.lt-pl-route-stn{font-size:1.35rem;font-weight:300;letter-spacing:-.035em;line-height:1.1;color:rgb(24,24,27)}
html.dark .lt-pl-route-stn{color:#fff}
.lt-pl-route-sep{font-size:1rem;color:rgb(212,212,216)}
html.dark .lt-pl-route-sep{color:rgb(63,63,70)}
.lt-pl-meta{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem .65rem;font-size:9px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:rgb(161,161,170)}
.lt-pl-meta-dot{width:3px;height:3px;border-radius:999px;background:rgb(212,212,216)}
html.dark .lt-pl-meta-dot{background:rgb(63,63,70)}
.lt-pl-meta-flag{color:#3b82f6}

.lt-pl-head{display:flex;align-items:center;gap:.75rem;margin:1.75rem 0 .9rem}
.lt-pl-head-lbl{font-size:9px;font-weight:800;letter-spacing:.3em;text-transform:uppercase;color:rgb(113,113,122);white-space:nowrap}
html.dark .lt-pl-head-lbl{color:rgb(161,161,170)}
.lt-pl-head-rule{height:1px;flex:1;background:rgb(228,228,231)}
html.dark .lt-pl-head-rule{background:rgb(39,39,42)}
.lt-pl-head-count{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;color:rgb(161,161,170);font-variant-numeric:tabular-nums}

/* ─── Cartão de viagem ─────────────────────────────────────────────────── */
.lt-pl-card{position:relative;display:block;width:100%;text-align:left;padding:1.15rem 1.15rem 1.15rem 1.5rem;margin-bottom:.6rem;border:1px solid rgb(244,244,245);border-radius:10px;background:rgba(255,255,255,.6);cursor:pointer;overflow:hidden;font-family:inherit;color:inherit;transition:border-color .2s ease,transform .15s ease,box-shadow .2s ease}
html.dark .lt-pl-card{border-color:rgb(24,24,27);background:rgba(24,24,27,.25)}
.lt-pl-card:hover{border-color:rgb(212,212,216);box-shadow:0 6px 22px -16px rgba(0,0,0,.5)}
html.dark .lt-pl-card:hover{border-color:rgb(63,63,70)}
.lt-pl-card:active{transform:scale(.992)}
.lt-pl-card.best{border-color:rgb(161,161,170)}
html.dark .lt-pl-card.best{border-color:rgb(82,82,91)}

.lt-pl-accent{position:absolute;left:0;top:0;bottom:0;width:3px;background:#10b981}
.lt-pl-accent[data-occ="yellow"]{background:#f59e0b}
.lt-pl-accent[data-occ="red"]{background:#ef4444}
.lt-pl-accent[data-occ="none"]{background:#d4d4d8}
html.dark .lt-pl-accent[data-occ="none"]{background:#3f3f46}

.lt-pl-r1{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem}
.lt-pl-times{display:flex;align-items:baseline;gap:.5rem;min-width:0}
.lt-pl-time{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:1.9rem;font-weight:300;letter-spacing:-.045em;line-height:1;font-variant-numeric:tabular-nums;color:rgb(24,24,27)}
html.dark .lt-pl-time{color:#fff}
.lt-pl-dash{width:14px;height:1px;background:rgb(212,212,216);flex-shrink:0;align-self:center}
html.dark .lt-pl-dash{background:rgb(63,63,70)}
.lt-pl-time-arr{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:1.15rem;font-weight:300;letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums;color:rgb(113,113,122)}
html.dark .lt-pl-time-arr{color:rgb(161,161,170)}
.lt-pl-r1r{display:flex;flex-direction:column;align-items:flex-end;gap:.35rem;flex-shrink:0}
.lt-pl-tag{font-size:8px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:rgb(24,24,27);white-space:nowrap}
html.dark .lt-pl-tag{color:#fff}
.lt-pl-num{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;font-variant-numeric:tabular-nums;color:rgb(161,161,170)}

.lt-pl-r2{display:flex;align-items:center;gap:.7rem;margin-top:1rem}
.lt-pl-bar{display:flex;gap:2px;flex:1;min-width:0;max-width:150px}
.lt-pl-bar span{height:4px;flex:1;border-radius:1px}
.lt-pl-cars-txt{font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgb(161,161,170);white-space:nowrap}
.lt-pl-dur{margin-left:auto;font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:rgb(161,161,170);white-space:nowrap}

/* ─── Notas (ocupação / conforto) ──────────────────────────────────────── */
.lt-pl-note{margin-top:.85rem;padding:.7rem .8rem;border-radius:8px;font-size:10px;line-height:1.5;display:flex;align-items:flex-start;gap:.6rem}
.lt-pl-note svg{flex-shrink:0;margin-top:1px}
.lt-pl-note b{display:block;font-size:9px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;margin-bottom:.2rem}
.lt-pl-note.warn{border:1px solid rgba(245,158,11,.35);background:rgba(245,158,11,.07);color:rgb(146,64,14)}
html.dark .lt-pl-note.warn{color:rgb(252,211,77)}
.lt-pl-note.good{border:1px solid rgba(16,185,129,.35);background:rgba(16,185,129,.06);color:rgb(6,95,70)}
html.dark .lt-pl-note.good{color:rgb(110,231,183)}

/* ─── Ver mais / vazio ─────────────────────────────────────────────────── */
.lt-pl-more{width:100%;margin-top:.4rem;padding:1rem;border:1px solid rgb(228,228,231);border-radius:2px;background:transparent;font-family:inherit;font-size:9px;font-weight:800;letter-spacing:.28em;text-transform:uppercase;color:rgb(113,113,122);cursor:pointer;transition:all .2s ease}
html.dark .lt-pl-more{border-color:rgb(39,39,42);color:rgb(161,161,170)}
.lt-pl-more:hover{border-color:rgb(24,24,27);color:rgb(24,24,27)}
html.dark .lt-pl-more:hover{border-color:rgb(244,244,245);color:#fff}
.lt-pl-empty{padding:4rem 1rem;text-align:center}
.lt-pl-empty-t{font-size:10px;font-weight:800;letter-spacing:.28em;text-transform:uppercase;color:rgb(161,161,170)}
.lt-pl-empty-s{font-size:12px;font-weight:300;line-height:1.7;color:rgb(161,161,170);max-width:20rem;margin:.9rem auto 0}
html.dark .lt-pl-empty-s{color:rgb(82,82,91)}

/* ─── Painel de detalhe ────────────────────────────────────────────────── */
.lt-pl-bd{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .3s ease}
.lt-pl-bd.open{opacity:1;pointer-events:auto}
.lt-pl-sheet{position:fixed;z-index:2147483001;left:0;right:0;bottom:0;max-height:88vh;background:#fff;border-radius:20px 20px 0 0;box-shadow:0 -10px 40px -12px rgba(0,0,0,.4);transform:translateY(100%);transition:transform .38s cubic-bezier(.22,.61,.36,1);display:flex;flex-direction:column;overflow:hidden;padding-bottom:env(safe-area-inset-bottom,0)}
html.dark .lt-pl-sheet{background:#09090b}
.lt-pl-sheet.open{transform:translateY(0)}
@media(min-width:768px){.lt-pl-sheet{left:50%;right:auto;bottom:auto;top:50%;width:440px;max-height:82vh;border-radius:16px;transform:translate(-50%,-46%) scale(.98);opacity:0;transition:opacity .25s ease,transform .25s ease}.lt-pl-sheet.open{transform:translate(-50%,-50%) scale(1);opacity:1}}
.lt-pl-grab{padding:.7rem 0 .2rem;display:flex;justify-content:center;flex-shrink:0;cursor:grab}
@media(min-width:768px){.lt-pl-grab{display:none}}
.lt-pl-grab span{width:36px;height:4px;border-radius:99px;background:rgb(212,212,216)}
html.dark .lt-pl-grab span{background:rgb(63,63,70)}
.lt-pl-sh-head{position:relative;padding:.5rem 1.4rem 1.2rem;border-bottom:1px solid rgb(244,244,245);flex-shrink:0}
html.dark .lt-pl-sh-head{border-bottom-color:rgb(24,24,27)}
.lt-pl-sh-close{position:absolute;right:1rem;top:.5rem;width:38px;height:38px;display:flex;align-items:center;justify-content:center;color:rgb(161,161,170);background:transparent;border:0;cursor:pointer}
.lt-pl-sh-close:hover{color:rgb(24,24,27)}
html.dark .lt-pl-sh-close:hover{color:#fff}
.lt-pl-sh-body{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:1.3rem 1.4rem 2.2rem}

/* Ficha de dados no detalhe */
.lt-pl-facts{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid rgb(244,244,245);border-radius:8px;overflow:hidden;margin-bottom:1.6rem}
html.dark .lt-pl-facts{border-color:rgb(24,24,27)}
.lt-pl-fact{padding:.9rem 1rem}
.lt-pl-fact + .lt-pl-fact{border-left:1px solid rgb(244,244,245)}
html.dark .lt-pl-fact + .lt-pl-fact{border-left-color:rgb(24,24,27)}
.lt-pl-fact-lbl{font-size:8px;font-weight:800;letter-spacing:.24em;text-transform:uppercase;color:rgb(161,161,170);display:block;margin-bottom:.45rem}
.lt-pl-fact-val{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:1.3rem;font-weight:300;letter-spacing:-.03em;font-variant-numeric:tabular-nums;color:rgb(24,24,27)}
html.dark .lt-pl-fact-val{color:#fff}
.lt-pl-fact-val.green{color:#059669}
html.dark .lt-pl-fact-val.green{color:#34d399}
.lt-pl-fact-val.yellow{color:#d97706}
html.dark .lt-pl-fact-val.yellow{color:#fbbf24}
.lt-pl-fact-val.red{color:#dc2626}
html.dark .lt-pl-fact-val.red{color:#f87171}

/* Percurso */
.lt-pl-stop{display:grid;grid-template-columns:auto 14px 1fr;align-items:center;gap:.8rem;padding:.5rem 0;position:relative}
.lt-pl-stop-time{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:13px;font-variant-numeric:tabular-nums;color:rgb(161,161,170)}
.lt-pl-stop-dot{width:9px;height:9px;border-radius:50%;border:2px solid rgb(228,228,231);background:#fff;z-index:1;justify-self:center}
html.dark .lt-pl-stop-dot{background:#09090b;border-color:rgb(39,39,42)}
.lt-pl-stop-name{font-size:13px;color:rgb(161,161,170);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lt-pl-stop.on .lt-pl-stop-time{color:rgb(82,82,91)}
html.dark .lt-pl-stop.on .lt-pl-stop-time{color:rgb(161,161,170)}
.lt-pl-stop.on .lt-pl-stop-name{color:rgb(39,39,42)}
html.dark .lt-pl-stop.on .lt-pl-stop-name{color:rgb(212,212,216)}
.lt-pl-stop.on .lt-pl-stop-dot{border-color:rgb(161,161,170)}
.lt-pl-stop.end .lt-pl-stop-time,.lt-pl-stop.end .lt-pl-stop-name{color:rgb(24,24,27);font-weight:600}
html.dark .lt-pl-stop.end .lt-pl-stop-time,html.dark .lt-pl-stop.end .lt-pl-stop-name{color:#fff}
.lt-pl-stop.end .lt-pl-stop-dot{background:rgb(24,24,27);border-color:rgb(24,24,27)}
html.dark .lt-pl-stop.end .lt-pl-stop-dot{background:#fff;border-color:#fff}
.lt-pl-stop.off .lt-pl-stop-time,.lt-pl-stop.off .lt-pl-stop-name{color:rgb(212,212,216)}
html.dark .lt-pl-stop.off .lt-pl-stop-time,html.dark .lt-pl-stop.off .lt-pl-stop-name{color:rgb(63,63,70)}
.lt-pl-line{position:absolute;left:0;top:0;bottom:0;width:1px;background:rgb(228,228,231)}
html.dark .lt-pl-line{background:rgb(39,39,42)}
@media(prefers-reduced-motion:reduce){.lt-pl-fade,.lt-pl-card,.lt-pl-sheet{animation:none!important;transition:none!important}}
`;
    document.head.appendChild(st);
  }

  // ─── SVGs ───────────────────────────────────────────────────────────────
  const SVG = {
    up: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="m18 15-6-6-6 6"/></svg>`,
    down: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="m6 9 6 6 6-6"/></svg>`,
    alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  };

  // ─── OCUPAÇÃO ───────────────────────────────────────────────────────────
  // Mesmos limiares de app-ui.js: >85 vermelho, >50 amarelo, resto verde.
  function occLevel(t) {
    const occ = t.occupancy;
    if (occ == null) return "none";
    if (occ > 85) return "red";
    if (occ > 50) return "yellow";
    return "green";
  }
  const OCC_HEX = {
    green: "#10b981",
    yellow: "#f59e0b",
    red: "#ef4444",
    none: "#d4d4d8",
  };

  function carsHtml(t) {
    const n = t.carriages || 4;
    const lvl = occLevel(t);
    const filled =
      t.occupancy != null ? Math.round((t.occupancy / 100) * n) : 0;
    let bars = "";
    for (let c = 0; c < n; c++) {
      const on = t.occupancy != null && c < filled;
      bars += `<span style="background:${on ? OCC_HEX[lvl] : "currentColor"};${on ? "" : "opacity:.16"}"></span>`;
    }
    const txt =
      `${n} carr.` + (t.occupancy != null ? ` · ${Math.round(t.occupancy)}%` : "");
    return `<div class="lt-pl-bar">${bars}</div><span class="lt-pl-cars-txt">${txt}</span>`;
  }

  // ─── SUGESTÕES DE CONFORTO ──────────────────────────────────────────────
  // Procura, a partir do comboio escolhido, o PRIMEIRO comboio (em cada
  // direcção temporal) cuja ocupação fique abaixo de COMFORT_MAX. A busca
  // percorre a lista toda — a alternativa tanto pode ser o comboio imediato
  // como estar cinco partidas mais atrás.
  function findComfort(trips, fromIdx, step) {
    for (let i = fromIdx + step; i >= 0 && i < trips.length; i += step) {
      const t = trips[i];
      if (t.occupancy != null && t.occupancy < COMFORT_MAX) return i;
    }
    return -1;
  }

  function comfortNote(t, best, gapTrains, earlier) {
    const minutes = Math.abs(
      Math.round((t.depDate - best.depDate) / 60000),
    );
    const when = earlier ? "mais cedo" : "mais tarde";
    const side = earlier ? "antes" : "depois";
    const trains =
      gapTrains === 1 ? "1 comboio " + side : `${gapTrains} comboios ${side}`;
    return `
      <div class="lt-pl-note good">
        ${earlier ? SVG.up : SVG.down}
        <div>
          <b>Viagem mais confortável</b>
          ${minutes} min ${when} · ${trains} · ${Math.round(t.occupancy)}% de ocupação
        </div>
      </div>`;
  }

  function crowdedNote(best, hasAlt) {
    return `
      <div class="lt-pl-note warn">
        ${SVG.alert}
        <div>
          <b>Ocupação elevada</b>
          ${Math.round(best.occupancy)}% de ocupação nesta partida.${
            hasAlt ? " Vê as alternativas assinaladas a verde." : ""
          }
        </div>
      </div>`;
  }

  // ─── CARTÃO ─────────────────────────────────────────────────────────────
  function cardHTML(t, opts) {
    const lvl = occLevel(t);
    const tag = opts.isBest
      ? `<span class="lt-pl-tag">Melhor opção</span>`
      : opts.comfort
        ? `<span class="lt-pl-tag" style="color:#059669">Alternativa</span>`
        : "";
    return `
      <span class="lt-pl-accent" data-occ="${lvl}"></span>
      <div class="lt-pl-r1">
        <div class="lt-pl-times">
          <span class="lt-pl-time">${t.time}</span>
          <span class="lt-pl-dash"></span>
          <span class="lt-pl-time-arr">${t.arr}</span>
        </div>
        <div class="lt-pl-r1r">
          ${tag}
          <span class="lt-pl-num">#${t.num}</span>
        </div>
      </div>
      <div class="lt-pl-r2">
        ${carsHtml(t)}
        <span class="lt-pl-dur">${t.durationMin} min</span>
      </div>
      ${opts.note || ""}`;
  }

  function makeCard(t, opts) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "lt-pl-card lt-pl-fade" + (opts.isBest ? " best" : "");
    el.dataset.action = "plan-details";
    el.dataset.id = t.id;
    el.setAttribute(
      "aria-label",
      `Comboio das ${t.time}, chega às ${t.arr}. Ver detalhes.`,
    );
    el.innerHTML = cardHTML(t, opts);
    return el;
  }

  // ─── RENDER PRINCIPAL ───────────────────────────────────────────────────
  function render() {
    const q = lastQuery;
    const list = document.getElementById("planear-results");
    const summary = document.getElementById("planear-summary");
    const loadMore = document.getElementById("planear-load-more");
    if (!list || !q) return;

    list.innerHTML = "";
    list.classList.add("lt-pl");

    // ── Estado vazio ──
    if (!currentPlan.length) {
      summary.innerHTML = "";
      if (loadMore) loadMore.classList.add("hidden");
      list.innerHTML = `
        <div class="lt-pl-empty">
          <p class="lt-pl-empty-t">Sem comboios</p>
          <p class="lt-pl-empty-s">Não há ligação directa entre estas estações na data escolhida. Verifica as estações e o dia.</p>
        </div>`;
      return;
    }

    const targetIdx = q.targetIdx;
    const best = currentPlan[targetIdx];

    // ── Sumário: rota + meta ──
    const dir = directionOf(q.org, q.dst);
    const dateD = ymdToDate(q.dateStr);
    const dateLbl = dateD.toLocaleDateString("pt-PT", {
      weekday: "long",
      day: "2-digit",
      month: "long",
    });
    const dirLbl = dir === "lisboa" ? "Sentido Lisboa" : "Sentido Margem Sul";
    const dtLbl = dayTypeLabel(q.dateStr);
    const isSpecial = dtLbl !== "Dia útil";
    summary.classList.add("lt-pl");
    summary.innerHTML = `
      <div class="lt-pl-route">
        <span class="lt-pl-route-stn">${NAME_OF(q.org)}</span>
        <span class="lt-pl-route-sep">→</span>
        <span class="lt-pl-route-stn">${NAME_OF(q.dst)}</span>
      </div>
      <div class="lt-pl-meta">
        <span>${dirLbl}</span>
        <span class="lt-pl-meta-dot"></span>
        <span style="text-transform:none;letter-spacing:.06em;font-weight:500">${dateLbl.charAt(0).toUpperCase() + dateLbl.slice(1)}</span>
        <span class="lt-pl-meta-dot"></span>
        <span class="${isSpecial ? "lt-pl-meta-flag" : ""}">${dtLbl}</span>
      </div>`;

    // ── Alternativas mais confortáveis ──
    const qualifies =
      dir === "lisboa" &&
      SUGGEST_ORIGINS.has(q.org) &&
      best &&
      best.occupancy != null;
    const crowded = qualifies && best.occupancy > OCC_THRESHOLD;
    let earlierIdx = -1;
    let laterIdx = -1;
    if (crowded) {
      earlierIdx = findComfort(currentPlan, targetIdx, -1);
      laterIdx = findComfort(currentPlan, targetIdx, 1);
    }

    // ── Janela de comboios a exibir ──
    // Garante que ambas as alternativas ficam visíveis, por muito distantes
    // que estejam do comboio escolhido.
    let start = Math.max(0, targetIdx - 1);
    if (earlierIdx >= 0) start = Math.min(start, earlierIdx);
    let end = start + displayLimit;
    if (laterIdx >= 0) end = Math.max(end, laterIdx + 1);
    const slice = currentPlan.slice(start, end);

    slice.forEach((t, i) => {
      const globalIdx = start + i;
      const isBest = globalIdx === targetIdx;
      const isEarlier = globalIdx === earlierIdx;
      const isLater = globalIdx === laterIdx;
      let note = "";
      if (isBest && crowded) {
        note = crowdedNote(best, earlierIdx >= 0 || laterIdx >= 0);
      } else if (isEarlier || isLater) {
        note = comfortNote(
          t,
          best,
          Math.abs(globalIdx - targetIdx),
          isEarlier,
        );
      }
      list.appendChild(
        makeCard(t, { isBest, note, comfort: isEarlier || isLater }),
      );
    });

    // ── Cabeçalho da lista (contagem) ──
    const head = document.getElementById("planear-list-head");
    if (head) {
      head.classList.add("lt-pl");
      head.innerHTML = `
        <div class="lt-pl-head">
          <span class="lt-pl-head-lbl">Partidas</span>
          <span class="lt-pl-head-rule"></span>
          <span class="lt-pl-head-count">${slice.length}/${currentPlan.length}</span>
        </div>`;
    }

    // ── Ver mais ──
    if (loadMore) {
      if (end < currentPlan.length) loadMore.classList.remove("hidden");
      else loadMore.classList.add("hidden");
    }
  }

  // ─── DETALHE (painel deslizante) ────────────────────────────────────────
  function openDetails(id) {
    const t = currentPlan.find((x) => String(x.id) === String(id));
    if (!t) return;
    if (typeof window.sa_event === "function")
      window.sa_event("planear_open_details");

    const sheet = document.getElementById("train-details-modal");
    const backdrop = document.getElementById("modal-backdrop");
    if (!sheet || !backdrop) return;

    const lvl = occLevel(t);
    const occTxt =
      t.occupancy != null ? `${Math.round(t.occupancy)}%` : "s/ dados";
    const occCls = lvl === "none" ? "" : ` ${lvl}`;

    // Percurso completo do comboio, na data escolhida
    const dir = t.direction;
    const ordered = dir === "margem" ? [...STATIONS].reverse() : STATIONS.slice();
    const oIdx = IDX_OF(t.originKey);
    const dIdx = IDX_OF(t.destKey);
    let stops = "";
    ordered.forEach((s) => {
      const time = t.raw[s.key];
      if (!time) return;
      const i = IDX_OF(s.key);
      const isEnd = s.key === t.originKey || s.key === t.destKey;
      const between =
        dir === "lisboa" ? i > oIdx && i < dIdx : i < oIdx && i > dIdx;
      const cls = isEnd ? "end" : between ? "on" : "off";
      stops += `
        <div class="lt-pl-stop ${cls}">
          <span class="lt-pl-stop-time">${time}</span>
          <span class="lt-pl-stop-dot"></span>
          <span class="lt-pl-stop-name">${s.name}</span>
        </div>`;
    });

    sheet.className = "lt-pl-sheet lt-pl";
    sheet.innerHTML = `
      <div class="lt-pl-grab"><span></span></div>
      <div class="lt-pl-sh-head">
        <button class="lt-pl-sh-close" data-action="plan-close-details" type="button" aria-label="Fechar">${SVG.close}</button>
        <div class="lt-pl-meta" style="margin-bottom:.65rem">
          <span>Fertagus</span>
          <span class="lt-pl-meta-dot"></span>
          <span class="lt-pl-num">#${t.num}</span>
        </div>
        <div class="lt-pl-times">
          <span class="lt-pl-time">${t.time}</span>
          <span class="lt-pl-dash"></span>
          <span class="lt-pl-time-arr">${t.arr}</span>
        </div>
        <div class="lt-pl-meta" style="margin-top:.7rem">
          <span style="text-transform:none;letter-spacing:.06em;font-weight:500">${t.origin} → ${t.dest}</span>
          <span class="lt-pl-meta-dot"></span>
          <span>${t.durationMin} min</span>
        </div>
      </div>
      <div class="lt-pl-sh-body">
        <div class="lt-pl-facts">
          <div class="lt-pl-fact">
            <span class="lt-pl-fact-lbl">Carruagens</span>
            <span class="lt-pl-fact-val">${t.carriages || 4}</span>
          </div>
          <div class="lt-pl-fact">
            <span class="lt-pl-fact-lbl">Ocupação</span>
            <span class="lt-pl-fact-val${occCls}">${occTxt}</span>
          </div>
        </div>
        <div class="lt-pl-r2" style="margin:0 0 1.8rem">${carsHtml(t)}</div>
        <div class="lt-pl-head" style="margin-top:0">
          <span class="lt-pl-head-lbl">Percurso</span>
          <span class="lt-pl-head-rule"></span>
        </div>
        <div style="position:relative;padding-left:2px">
          ${stops}
        </div>
      </div>`;

    backdrop.className = "lt-pl-bd";
    // força reflow para a transição arrancar
    void backdrop.offsetWidth;
    backdrop.classList.add("open");
    requestAnimationFrame(() => sheet.classList.add("open"));
    document.body.style.overflow = "hidden";
  }

  function closeDetails() {
    const sheet = document.getElementById("train-details-modal");
    const backdrop = document.getElementById("modal-backdrop");
    if (sheet) {
      sheet.style.transform = "";
      sheet.style.transition = "";
      sheet.classList.remove("open");
    }
    if (backdrop) backdrop.classList.remove("open");
    document.body.style.overflow = "";
  }

  // ─── EXECUTAR PESQUISA ──────────────────────────────────────────────────
  async function plan(detail) {
    await dbReady;
    const org = detail.org;
    const dst = detail.dst;
    let dateStr = detail.dateStr || ymdToday();
    const mode = detail.mode === "arr" ? "arr" : "dep";
    const timeStr = detail.timeStr || fmtHM(new Date());

    if (!org || !dst || org === dst) {
      currentPlan = [];
      lastQuery = { org, dst, dateStr, mode, timeStr, targetIdx: -1 };
      displayLimit = 8;
      render();
      return;
    }

    // Clamp da data a [hoje, hoje+3 meses]
    const today = ymdToday();
    const maxD = new Date();
    maxD.setMonth(maxD.getMonth() + MAX_MONTHS_AHEAD);
    if (dateStr < today) dateStr = today;
    const maxStr = `${maxD.getFullYear()}-${String(maxD.getMonth() + 1).padStart(2, "0")}-${String(maxD.getDate()).padStart(2, "0")}`;
    if (dateStr > maxStr) dateStr = maxStr;

    const trips = buildTrips(org, dst, dateStr);
    const target = timeOnDate(timeStr, dateStr);
    const targetIdx = pickTargetIndex(trips, mode, target);

    currentPlan = trips;
    displayLimit = 8;
    lastQuery = { org, dst, dateStr, mode, timeStr, targetIdx };
    render();

    // Scroll suave para os resultados
    const anchor = document.getElementById("planear-summary");
    if (anchor && detail.scroll !== false) {
      setTimeout(
        () => anchor.scrollIntoView({ behavior: "smooth", block: "start" }),
        150,
      );
    }
  }

  // ─── LISTENERS ──────────────────────────────────────────────────────────
  injectStyle();

  document.addEventListener("lt:search", function (e) {
    e.preventDefault(); // sinaliza à searchbar que há handler in-page (não navega)
    plan(e.detail || {});
  });

  document.addEventListener("click", function (e) {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;
    if (action === "plan-details") {
      openDetails(el.dataset.id);
    } else if (action === "plan-close-details") {
      closeDetails();
    } else if (action === "plan-load-more") {
      displayLimit += 8;
      render();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    const sheet = document.getElementById("train-details-modal");
    if (sheet && sheet.classList.contains("open")) closeDetails();
  });

  // Fecho do painel pelo fundo escurecido
  function bindBackdrop() {
    const backdrop = document.getElementById("modal-backdrop");
    if (backdrop) backdrop.addEventListener("click", closeDetails);
  }

  // Gesto de arrastar para fechar (mobile)
  function bindDrag() {
    const sheet = document.getElementById("train-details-modal");
    if (!sheet) return;
    let startY = 0,
      currentY = 0,
      dragging = false,
      scrolling = false;
    sheet.addEventListener(
      "touchstart",
      (e) => {
        startY = e.touches[0].clientY;
        dragging = false;
        scrolling = false;
      },
      { passive: true },
    );
    sheet.addEventListener(
      "touchmove",
      (e) => {
        const dy = e.touches[0].clientY - startY;
        const scrollArea = sheet.querySelector(".lt-pl-sh-body");
        const inScroll = scrollArea && scrollArea.contains(e.target);
        if (!dragging && !scrolling) {
          if (inScroll && scrollArea.scrollTop > 0) scrolling = true;
          else if (inScroll && dy < 0) scrolling = true;
          else if (dy > 0) {
            dragging = true;
            sheet.style.transition = "none";
          }
        }
        if (dragging && dy > 0) {
          currentY = dy;
          sheet.style.transform = `translateY(${dy}px)`;
          if (e.cancelable) e.preventDefault();
        }
      },
      { passive: false },
    );
    sheet.addEventListener("touchend", () => {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = "";
      if (currentY > 120) closeDetails();
      else sheet.style.transform = "";
      currentY = 0;
    });
  }

  function bindStatic() {
    bindBackdrop();
    bindDrag();
    const lm = document.getElementById("planear-load-more");
    if (lm)
      lm.addEventListener("click", function () {
        displayLimit += 8;
        render();
      });
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", bindStatic);
  else bindStatic();
})();

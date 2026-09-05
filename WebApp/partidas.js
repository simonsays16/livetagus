/**
 * partidas.js  ·  LiveTagus
 * ─────────────────────────────────────────────────────────────────────────────
 * Vista PARTILHADA de partidas por estação. É usada em DOIS sítios:
 *   • Página de estação  (/estacao/{slug})  → estacao.js monta-a no separador Fertagus.
 *   • Modal do mapa       (/mapa)            → mapa-station.js monta-a no painel.
 *
 * Centralizar aqui significa: um único sítio para mexer no visual / debug das
 * partidas, em vez de manter duas implementações.
 *
 * Dados:
 *   • Fonte primária: endpoint magro  GET /estacao/{apiId}  (partidas ao vivo já
 *     separadas por sentido, 1 nó por comboio, futureTrains só com estado).
 *   • Enriquecimento/timetable: horários JSON locais (programados futuros) — para
 *     cobrir comboios ainda fora da janela ao vivo do motor. Estado dos
 *     programados vem de futureTrains (SUPRIMIDO/Realizado/…).
 *   • Fallback total: se o endpoint falha (IP down / API down / offline) usa só os
 *     JSON locais. Tudo cacheado pelo Service Worker → funciona offline.
 *
 * Clique num comboio (3 casos pedidos):
 *   1. Ao vivo            → opts.onLiveTrain(dep)  (página: /mapa#{id}; mapa: abre detalhe).
 *   2. Extra, não-vivo    → GET /fertagus, lê NodesPassagemComboio reais → percurso.
 *   3. Normal, não-vivo   → constrói o percurso a partir dos JSON de horários.
 *
 * Edge cases preparados: manutenção, IP offline, API LiveTagus offline, modo
 * offline do browser, trajetos anormais (comboio não para aqui), sem partidas.
 *
 * Auto-contido: injeta o próprio CSS (.ltp-*) e cria a própria sheet de detalhe
 * (não depende do CSS da página nem de DOM específico). Mobile-first, iOS+Android.
 */

(function () {
  "use strict";
  if (window.Partidas) return; // idempotente

  // ═══ CONFIG ═══════════════════════════════════════════════════════════════
  const API_BASE = "https://api.livetagus.pt";
  //const API_BASE = "http://localhost:3000";
  const API_KEY = "KoKi30rVWuwkF9lqKL6j4mb0VMg3dIXWs6QDHZ3de0G8lC5qvu";
  const EP_ESTACAO = (apiId) => `${API_BASE}/estacao/${apiId}?t=${Date.now()}`;
  const EP_FERTAGUS = `${API_BASE}/fertagus`;
  const EP_AVISOS = `${API_BASE}/avisos/`;

  const PATH_LISBOA = "/json/fertagus_sentido_lisboa.json";
  const PATH_MARGEM = "/json/fertagus_sentido_margem.json";
  const PATH_HOLIDAYS = "/json/feriados.json";
  const PATH_CHANGES = "/json/changes.json";

  const MAX_LIST = 40; // limite do que se MOSTRA (ambos os sentidos juntos)
  // O modelo guarda mais do que se mostra. Com um filtro "a partir das XX:XX"
  // activo, as primeiras 40 do dia podem ser todas anteriores a essa hora e a
  // lista sairia vazia — o corte tem de ser feito DEPOIS de filtrar.
  const MAX_MODEL = 160;
  // Margem de transbordo, em minutos. A zero mostra as partidas a partir da
  // hora de chegada, à letra. Qualquer valor acima disso é um palpite sobre
  // quanto tempo se leva a mudar de cais, e varia de estação para estação.
  const TRANSFER_MARGIN_MIN = 0;

  // ═══ ESTAÇÕES (Sul → Norte) ════════════════════════════════════════════════
  const STATIONS = [
    { key: "setubal", name: "Setúbal", apiName: "SETÚBAL", apiId: 9468122 },
    { key: "palmela", name: "Palmela", apiName: "PALMELA", apiId: 9468098 },
    {
      key: "venda_do_alcaide",
      name: "Venda do Alcaide",
      apiName: "VENDA DO ALCAIDE",
      apiId: 9468049,
    },
    {
      key: "pinhal_novo",
      name: "Pinhal Novo",
      apiName: "PINHAL NOVO",
      apiId: 9468007,
    },
    { key: "penalva", name: "Penalva", apiName: "PENALVA", apiId: 9417095 },
    { key: "coina", name: "Coina", apiName: "COINA", apiId: 9417236 },
    {
      key: "fogueteiro",
      name: "Fogueteiro",
      apiName: "FOGUETEIRO",
      apiId: 9417186,
    },
    {
      key: "foros_de_amora",
      name: "Foros de Amora",
      apiName: "FOROS DE AMORA",
      apiId: 9417152,
    },
    { key: "corroios", name: "Corroios", apiName: "CORROIOS", apiId: 9417137 },
    { key: "pragal", name: "Pragal", apiName: "PRAGAL", apiId: 9417087 },
    {
      key: "campolide",
      name: "Campolide",
      apiName: "CAMPOLIDE",
      apiId: 9467033,
    },
    {
      key: "sete_rios",
      name: "Sete Rios",
      apiName: "SETE RIOS",
      apiId: 9466076,
    },
    {
      key: "entrecampos",
      name: "Entrecampos",
      apiName: "ENTRECAMPOS",
      apiId: 9466050,
    },
    {
      key: "roma_areeiro",
      name: "Roma-Areeiro",
      apiName: "ROMA-AREEIRO",
      apiId: 9466035,
    },
  ];
  const ORDER_KEYS = STATIONS.map((s) => s.key);
  const BY_KEY = Object.fromEntries(STATIONS.map((s) => [s.key, s]));
  const BY_API_ID = Object.fromEntries(
    STATIONS.map((s) => [String(s.apiId), s]),
  );

  // ── DESTINOS ──────────────────────────────────────────────────────────────
  // O sentido deixou de ser "Lisboa / Margem" e passou a ser o destino real:
  // Lisboa, Coina e Setúbal. A linha tem dois términos a sul, e a maioria dos
  // comboios fica em Coina — dizer só "margem" escondia essa diferença, que é
  // exactamente a que faz alguém perder ou não perder o comboio.
  //
  // As STATIONS estão ordenadas de Setúbal (0) a Roma-Areeiro (13), por isso a
  // posição na linha diz tudo o que é preciso.
  const COINA_IDX = 5; // ORDER_KEYS: setubal, palmela, venda_do_alcaide, pinhal_novo, penalva, coina, …

  // "lisboa" | "setubal" | "coina" | "margem" (retorno curto antes de Coina)
  function destGroup(dep) {
    if (!dep) return null;
    if (dep.direction !== "margem") return "lisboa";
    const st = resolveStationByName(dep.destino);
    const i = st ? ORDER_KEYS.indexOf(st.key) : -1;
    if (i < 0) return "margem";
    if (i === COINA_IDX) return "coina";
    return i < COINA_IDX ? "setubal" : "margem";
  }

  // ── LIGAÇÕES NAS ESTAÇÕES ────────────────────────────────────────────────
  // O percurso mostra, à frente de cada estação, os logótipos dos operadores
  // com que se pode fazer ligação ali. Vem do mesmo ficheiro que o mapa usa.
  const LIGACOES_JSON = "/json/ligacoes_atualizado.json";
  // Um tipo sem logótipo conhecido simplesmente não aparece; e se o ficheiro
  // não existir, a imagem é removida (ver bindLigacaoLogos).
  const LIG_LOGOS = {
    metro: { src: "/imagens/lig-logos/metro.svg", nome: "Metro de Lisboa" },
    mts: { src: "/imagens/lig-logos/mts.svg", nome: "Metro Sul do Tejo" },
    cp: { src: "/imagens/lig-logos/cp.svg", nome: "CP" },
    cm: { src: "/imagens/lig-logos/cm-light.svg", nome: "Carris Metropolitana" },
    carris: { src: "/imagens/lig-logos/carris.svg", nome: "Carris" },
    re: { src: "/imagens/lig-logos/rede-expressos.svg", nome: "Rede Expressos" },
    tcb: { src: "/imagens/lig-logos/tcb.svg", nome: "TCB" },
  };

  let ligacoesPorEstacao = null; // Map(chaveEstacao → ["metro","cm",…])
  let ligacoesPromise = null;

  function loadLigacoes() {
    if (ligacoesPorEstacao) return Promise.resolve(ligacoesPorEstacao);
    if (ligacoesPromise) return ligacoesPromise;
    ligacoesPromise = fetch(LIGACOES_JSON)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const m = new Map();
        for (const id in data || {}) {
          const e = data[id];
          if (!e || !e.name || !e.ligacoes) continue;
          const st = resolveStationByName(e.name);
          if (!st) continue;
          m.set(
            st.key,
            Object.keys(e.ligacoes).filter((t) => (e.ligacoes[t] || []).length),
          );
        }
        ligacoesRaw = data || {};
        ligacoesPorEstacao = m;
        return m;
      })
      .catch((err) => {
        console.warn("[Partidas] ligações indisponíveis:", err && err.message);
        ligacoesPorEstacao = new Map();
        return ligacoesPorEstacao;
      });
    return ligacoesPromise;
  }

  // Os logótipos ficam encostados à direita da linha e são um BOTÃO: abrem a
  // lista de ligações daquela estação, de onde se pode saltar para o mapa.
  function ligacoesHtml(stationKey, stationName) {
    if (!ligacoesPorEstacao || !stationKey) return "";
    const tipos = (ligacoesPorEstacao.get(stationKey) || []).filter(
      (t) => LIG_LOGOS[t],
    );
    if (!tipos.length) return "";
    const imgs = tipos
      .map(
        (t) =>
          `<img class="ltp-lig-logo" src="${esc(LIG_LOGOS[t].src)}" alt="${esc(LIG_LOGOS[t].nome)}" data-ltp-lig>`,
      )
      .join("");
    // Uma pastilha com contorno e seta: sem isto, os logótipos liam-se como
    // decoração e ninguém percebia que se podia carregar neles.
    return `<button type="button" class="ltp-lig" data-ltp-lig-open="${esc(stationKey)}"
      data-ltp-lig-name="${esc(stationName || "")}"
      title="Ligações em ${esc(stationName || "")}"
      aria-label="Ver ligações em ${esc(stationName || "")}">${imgs}<svg class="ltp-lig-seta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="9" height="9"><path d="m9 18 6-6-6-6"/></svg></button>`;
  }

  // Sem onerror inline (CSP): um logótipo em falta desaparece em vez de deixar
  // o ícone partido do browser.
  function bindLigacaoLogos(root) {
    (root || document).querySelectorAll("[data-ltp-lig]").forEach((img) => {
      img.addEventListener("error", function () { this.remove(); }, { once: true });
    });
  }

  // ── VISTA DE LIGAÇÕES ────────────────────────────────────────────────────
  // O que se pode apanhar numa estação, e — quando o mapa está por perto — a
  // possibilidade de abrir cada paragem lá.
  let ligacoesRaw = null; // o JSON tal como veio, para os nomes das linhas

  // Comparar nomes de estação sem depender de acentos, maiúsculas ou hífenes.
  function normNome(v) {
    return String(v == null ? "" : v)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  const LIG_ORDEM = ["cp", "metro", "mts", "cm", "carris", "tcb", "re"];

  function linhasDe(entrada) {
    return (entrada || [])
      .map((x) => x && x.line)
      .filter(Boolean);
  }

  // Paragens que se podem abrir no mapa a partir daqui. Só existem quando os
  // módulos do mapa estão carregados — na página /estacao a lista é informativa.
  function alvosNoMapa(tipo, nomeEstacao) {
    const out = [];
    if (tipo === "cm" && window.MapaCM && window.MapaCM.getStops) {
      const alvo = normNome(nomeEstacao);
      for (const st of window.MapaCM.getStops() || []) {
        if (normNome(st.station || "") !== alvo) continue;
        out.push({ label: st.name, run: () => window.MapaCM.open(st) });
      }
      return out;
    }
    if (window.GtfsHorarios && window.GtfsHorarios.interchangesFor) {
      const op = tipo === "metro" ? "ml" : tipo;
      for (const x of window.GtfsHorarios.interchangesFor(nomeEstacao)) {
        if (x.op !== op) continue;
        out.push({
          label: x.name,
          run: () =>
            x.stopId
              ? window.GtfsHorarios.openStop(x.op, x.stopId, { name: x.name })
              : window.GtfsHorarios.open({ name: x.name }, { operator: x.op }),
        });
      }
    }
    return out;
  }

  function renderLigacoes(stationKey, nomeEstacao) {
    const st = BY_KEY[stationKey];
    const nome = nomeEstacao || (st ? st.name : "");
    let id = null;
    for (const k in ligacoesRaw || {}) {
      if (normNome((ligacoesRaw[k] || {}).name || "") === normNome(nome)) {
        id = k;
        break;
      }
    }
    const lig = (id && ligacoesRaw[id] && ligacoesRaw[id].ligacoes) || {};
    const tipos = LIG_ORDEM.filter((t) => (lig[t] || []).length);

    const blocos = tipos
      .map((t, i) => {
        const meta = LIG_LOGOS[t] || { nome: t, src: "" };
        const linhas = linhasDe(lig[t]);
        const alvos = alvosNoMapa(t, nome);
        return `<div class="ltp-lg-bloco">
          <div class="ltp-lg-cab">
            ${meta.src ? `<img class="ltp-lig-logo" src="${esc(meta.src)}" alt="" data-ltp-lig>` : ""}
            <span class="ltp-lg-op">${esc(meta.nome)}</span>
          </div>
          ${
            linhas.length
              ? `<p class="ltp-lg-linhas">${linhas.map(esc).join(" · ")}</p>`
              : ""
          }
          ${alvos
            .map(
              (a, j) =>
                `<button type="button" class="ltp-lg-alvo" data-ltp-lg-go="${i}:${j}">
                   <span>${esc(a.label)}</span>
                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="m9 18 6-6-6-6"/></svg>
                 </button>`,
            )
            .join("")}
        </div>`;
      })
      .join("");

    return {
      html: `
        <div class="ltp-sh-head inline" style="position:relative">
          <button class="ltp-back" data-ltp-lg-back>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="m15 18-6-6 6-6"/></svg>
            <span>Percurso</span></button>
          <p class="ltp-sh-title">${esc(nome)}</p>
          <p class="ltp-sh-sub">Ligações nesta estação</p>
        </div>
        <div class="ltp-sh-body">
          ${blocos || `<p style="font-size:11px;color:rgb(161,161,170)">Sem ligações registadas.</p>`}
          ${
            tipos.some((t) => alvosNoMapa(t, nome).length)
              ? ""
              : `<p class="ltp-lg-nota">Abre o mapa para ver estas paragens.</p>`
          }
        </div>`,
      // A ordem das secções e dos alvos é a mesma do HTML: o índice "i:j" do
      // botão devolve o alvo certo sem precisar de guardar nada no DOM.
      alvos: tipos.map((t) => alvosNoMapa(t, nome)),
    };
  }

  function resolveStationByApiId(id) {
    return BY_API_ID[String(id)] || null;
  }
  function resolveStationByApiName(name) {
    if (!name) return null;
    const up = String(name).toUpperCase().replace(/-A$/, "").trim();
    let m = STATIONS.find((s) => s.apiName === up);
    if (m) return m;
    const norm = (x) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return STATIONS.find((s) => norm(s.apiName) === norm(up)) || null;
  }
  function resolveStationByName(name) {
    if (!name) return null;
    const norm = (x) =>
      String(x || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    const n = norm(name);
    let m = STATIONS.find((s) => norm(s.name) === n);
    if (m) return m;
    return (
      STATIONS.find(
        (s) => norm(s.name).includes(n) || n.includes(norm(s.name)),
      ) || null
    );
  }
  function listStations() {
    return STATIONS.map((s) => ({ id: s.apiId, key: s.key, name: s.name }));
  }

  // ═══ HELPERS ═══════════════════════════════════════════════════════════════
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Parser com semântica de dia operacional Fertagus (05h00 → 02h30).
  function parseTimeHHMMSS(timeStr, now) {
    if (!timeStr || typeof timeStr !== "string") return null;
    if (timeStr.startsWith("HH")) return null;
    const parts = timeStr.split(":");
    if (parts.length < 2) return null;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const s = parts[2] ? parseInt(parts[2], 10) : 0;
    if (isNaN(h) || isNaN(m)) return null;
    const ref = now instanceof Date ? new Date(now) : new Date();
    const d = new Date(ref);
    d.setHours(h, m, s, 0);
    const nowH = ref.getHours();
    if (nowH < 5 && h >= 18) d.setDate(d.getDate() - 1);
    else if (nowH >= 20 && h < 5) d.setDate(d.getDate() + 1);
    else if (nowH >= 18 && h < 16) d.setDate(d.getDate() + 1);
    return d;
  }
  function nodeTimeStr(node) {
    if (!node) return null;
    const prev = (node.HoraPrevista || "").substring(0, 5);
    const prog = (node.HoraProgramada || "").substring(0, 5);
    if (prev && !prev.startsWith("HH")) return prev;
    if (prog && !prog.startsWith("HH")) return prog;
    return null;
  }
  function nodeTs(node) {
    if (!node) return Infinity;
    const d =
      parseTimeHHMMSS(node.HoraPrevista) ||
      parseTimeHHMMSS(node.HoraProgramada);
    return d ? d.getTime() : Infinity;
  }
  function nodeDelayMin(node) {
    if (!node) return null;
    if (node.ComboioPassou && typeof node.AtrasoReal === "number") {
      return Math.floor(node.AtrasoReal / 60);
    }
    const prog = parseTimeHHMMSS(node.HoraProgramada);
    const prev = parseTimeHHMMSS(node.HoraPrevista);
    if (!prog || !prev) return null;
    return Math.floor((prev.getTime() - prog.getTime()) / 60000);
  }
  function getOperationalDateIso() {
    const d = new Date();
    if (d.getHours() < 5) d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }
  function isOperationalSpecialDay(ts, holidays) {
    const d = new Date(ts);
    const h = d.getHours();
    const m = d.getMinutes();
    if (h < 2 || (h === 2 && m < 30)) d.setDate(d.getDate() - 1);
    const day = d.getDay();
    if (day === 0 || day === 6) return true;
    const y = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return !!(holidays && holidays[`${y}-${mm}-${dd}`]);
  }

  // ═══ DADOS ESTÁTICOS (cache de módulo) ══════════════════════════════════════
  const staticCache = {
    lisboa: null,
    margem: null,
    holidays: null,
    changes: null,
    loaded: false,
  };
  async function loadJson(path) {
    try {
      const r = await fetch(path);
      if (!r.ok) return null;
      return await r.json();
    } catch (_) {
      return null;
    }
  }
  async function ensureStatic() {
    if (staticCache.loaded) return staticCache;
    const [l, m, h, c] = await Promise.all([
      loadJson(PATH_LISBOA),
      loadJson(PATH_MARGEM),
      loadJson(PATH_HOLIDAYS),
      loadJson(PATH_CHANGES),
    ]);
    staticCache.lisboa = l;
    staticCache.margem = m;
    staticCache.holidays = h || {};
    staticCache.changes = c || { changes: [] };
    staticCache.loaded = true;
    return staticCache;
  }
  function getActiveChange() {
    const today = getOperationalDateIso();
    const list = (staticCache.changes && staticCache.changes.changes) || [];
    return (
      list.find((c) => {
        const dates = c.targetDates || [];
        if (dates.length === 0) return false;
        if (dates.length === 1) return today === dates[0];
        return today >= dates[0] && today <= dates[dates.length - 1];
      }) || null
    );
  }
  function findTripById(id) {
    const all = [
      ...((staticCache.lisboa && staticCache.lisboa.trips) || []),
      ...((staticCache.margem && staticCache.margem.trips) || []),
    ];
    return all.find((t) => String(t.id) === String(id)) || null;
  }

  // Constrói partidas PROGRAMADAS (futuras) que servem ESTA estação, a partir
  // dos JSON. Usado como timetable e como fallback offline total.
  function buildOfflineForStation(station) {
    const out = [];
    const now = new Date();
    const nowTs = now.getTime();
    const activeChange = getActiveChange();
    const forceSup = new Set(
      activeChange ? (activeChange.suppressed || []).map(String) : [],
    );
    const sources = [
      {
        data: staticCache.lisboa,
        direction: "lisboa",
        order: ORDER_KEYS.slice(),
      },
      {
        data: staticCache.margem,
        direction: "margem",
        order: ORDER_KEYS.slice().reverse(),
      },
    ];
    for (const src of sources) {
      if (!src.data || !Array.isArray(src.data.trips)) continue;
      for (const trip of src.data.trips) {
        const hType = parseInt(trip.horario, 10);
        const stops = [];
        for (const key of src.order) {
          const t = trip[key];
          if (!t) continue;
          const st = BY_KEY[key];
          if (!st) continue;
          const d = parseTimeHHMMSS(t + ":00", now);
          if (!d) continue;
          stops.push({ st, key, timeStr: t + ":00", ts: d.getTime() });
        }
        if (stops.length < 2) continue;

        const special = isOperationalSpecialDay(
          stops[0].ts,
          staticCache.holidays,
        );
        if (hType === 0 && special) continue;
        if (hType === 2 && !special) continue;

        // Só interessa se servir ESTA estação e ainda não passou aqui (futuro).
        const sNode = stops.find((s) => s.key === station.key);
        if (!sNode) continue;
        if (nowTs >= sNode.ts) continue; // só futuros (passou nesta estação)

        const id = String(trip.id);
        const suppressed = forceSup.has(id);
        out.push({
          id,
          numero: id,
          origem: stops[0].st.name,
          destino: stops[stops.length - 1].st.name,
          direction: src.direction,
          live: false,
          extra: false,
          offline: true,
          suppressed,
          shortened: false,
          abnormal: false,
          skipped: [],
          perturbacao: false,
          statusText: suppressed ? "Suprimido" : "Programado",
          dotStatus: suppressed ? "red" : "gray",
          delayMin: 0,
          occupancy: special
            ? null
            : trip.ocupacao != null
              ? trip.ocupacao
              : null,
          carriages: special ? 4 : trip.carruagens || 4,
          timeStr: sNode.timeStr.substring(0, 5),
          ts: sNode.ts,
          node: {
            ComboioPassou: false,
            HoraProgramada: sNode.timeStr,
            HoraReal: "HH:MM:SS",
            AtrasoReal: 0,
            HoraPrevista: sNode.timeStr,
            EstacaoID: station.apiId,
            NomeEstacao: station.apiName,
          },
        });
      }
    }
    return out;
  }

  // ═══ NORMALIZAÇÃO DO ENDPOINT /estacao/{id} ═════════════════════════════════
  function depFromEndpoint(t) {
    const node =
      t.NodePassagem ||
      (t.NodesPassagemComboio && t.NodesPassagemComboio[0]) ||
      null;
    const sit = (t.SituacaoComboio || "").toString();
    const suppressed = /SUPRIMIDO/i.test(sit);
    const perturbacao = /perturba/i.test(sit);
    const delayMin =
      typeof t.AtrasoEstacao === "number"
        ? Math.floor(t.AtrasoEstacao / 60)
        : nodeDelayMin(node);

    let dotStatus = "green";
    let statusText = "A Horas";
    const extra = !t.Live && /extra/i.test(sit) ? true : false; // raramente marcado; refinado abaixo
    if (suppressed) {
      dotStatus = "red";
      statusText = "Suprimido";
    } else if (perturbacao) {
      dotStatus = "orange";
      statusText = "Possível Perturbação";
    } else if (delayMin != null && delayMin >= 1) {
      dotStatus = "yellow";
      statusText = `Atraso ${delayMin} min`;
    } else if (t.Live) {
      dotStatus = "green";
      statusText = "A Horas";
    } else {
      dotStatus = "green";
      statusText = "Programado";
    }

    const orig = resolveStationByApiName(t.Origem);
    const dest = resolveStationByApiName(t.Destino);
    return {
      id: String(t["id-comboio"]),
      numero: String(t["id-comboio"]),
      origem: orig ? orig.name : t.Origem || "—",
      destino: dest ? dest.name : t.Destino || "—",
      direction: t.direction === "margem" ? "margem" : "lisboa",
      live: !!t.Live,
      extra,
      offline: false,
      suppressed,
      perturbacao,
      statusText,
      dotStatus,
      delayMin: delayMin != null ? delayMin : 0,
      occupancy: special ? null : t.Ocupacao != null ? t.Ocupacao : null,
      carriages: t.Carruagens != null ? t.Carruagens : 4,
      timeStr: node ? nodeTimeStr(node) || "--:--" : "--:--",
      ts: node ? nodeTs(node) : Infinity,
      node,
      raw: t,
      abnormal: !!t._isAbnormalRoute,
      shortened: false,
      skipped: Array.isArray(t._skippedStations) ? t._skippedStations : [],
    };
  }

  // ═══ FETCH DA ESTAÇÃO (endpoint + merge + offline) ══════════════════════════
  // Devolve { lisboa:[], margem:[], futureTrains:{}, abnormalRoutes:{},
  //           ok, ipDown, offline }
  async function fetchStationModel(station) {
    await ensureStatic();

    const model = {
      items: [],
      futureTrains: {},
      abnormalRoutes: {},
      ok: false,
      ipDown: false,
      offline: !navigator.onLine,
    };

    let live = [];
    let endpointOk = false;

    try {
      const res = await fetch(EP_ESTACAO(station.apiId), {
        method: "GET",
        headers: { "x-api-key": API_KEY, Accept: "application/json" },
        cache: "no-store",
      });
      if (res.status === 503) {
        model.ipDown = true;
      } else if (res.ok) {
        // PROVISORIO
        //const data = await res.json();
        if (data && data.error) {
          if (data.error === "IP_DOWN") model.ipDown = true;
        } else {
          endpointOk = true;
          model.ok = true;
          model.offline = false;
          model.futureTrains = data.futureTrains || {};
          model.abnormalRoutes = data.abnormalRoutes || {};
          const lis = Array.isArray(data.lisboa) ? data.lisboa : [];
          const mar = Array.isArray(data.margem) ? data.margem : [];
          live = [...lis, ...mar].map(depFromEndpoint);
          // Marca extras: comboios não vivos cujo id não existe no horário base.
          live.forEach((d) => {
            if (!d.live && !findTripById(d.id)) d.extra = true;
          });
        }
      }
    } catch (_) {
      // rede falhou → fallback offline
    }

    // Base = horário programado (timetable). Live sobrepõe-se por id.
    const base = new Map();
    for (const o of buildOfflineForStation(station)) base.set(o.id, o);
    for (const d of live) base.set(d.id, d); // live ganha

    // futureTrains (estado) para os que NÃO são live.
    for (const dep of base.values()) {
      if (dep.live) continue;
      const status = model.futureTrains[dep.id];
      if (!status) continue;
      const up = String(status).toUpperCase();
      if (up.includes("SUPRIMIDO")) {
        dep.suppressed = true;
        dep.dotStatus = "red";
        dep.statusText = "Suprimido";
      } else if (status === "Realizado") {
        dep._drop = true;
      } else if (/perturba/i.test(status)) {
        dep.perturbacao = true;
        dep.dotStatus = "orange";
        dep.statusText = "Possível Perturbação";
      } else if (/atraso/i.test(status)) {
        const mm = status.match(/(\d+)/);
        if (mm) {
          dep.delayMin = parseInt(mm[1], 10);
          dep.dotStatus = "yellow";
          dep.statusText = `Atraso ${dep.delayMin} min`;
        }
      }
    }

    // TRAJETO ANORMAL — nunca esconder. abnormalRoutes lista comboios desviados.
    //   • Se SALTA esta estação        → "Não para aqui" (shortened).
    //   • Se passa aqui mas salta OUTRAS → "Trajeto anormal" (abnormal).
    // Aplica-se a comboios live E não-vivos (programados/futuros), para que o
    // aviso apareça mesmo fora da janela ao vivo, tal como na app.
    for (const [id, info] of Object.entries(model.abnormalRoutes || {})) {
      const dep = base.get(String(id));
      if (!dep) continue;
      const skipped = Array.isArray(info && info.skipped) ? info.skipped : [];
      dep.abnormal = true;
      dep.skipped = skipped;
      const skipsHere = skipped.some((s) => s && s.key === station.key);
      if (skipsHere) {
        dep.shortened = true;
        dep.dotStatus = "red";
        dep.statusText = "Não para aqui";
      }
    }

    // Lista única ordenada por hora (sem separação por sentido).
    model.items = Array.from(base.values())
      .filter((d) => !d._drop)
      .sort((a, b) => a.ts - b.ts)
      .slice(0, MAX_MODEL);
    if (!endpointOk && !navigator.onLine) model.offline = true;
    return model;
  }

  // ═══ DETEÇÃO DE MANUTENÇÃO (opcional) ═══════════════════════════════════════
  async function fetchMaintenance() {
    try {
      const r = await fetch(EP_AVISOS + "?t=" + Date.now());
      if (!r.ok) return null;
      const data = await r.json();
      const mode = data && data.mode;
      if (!mode) return null;
      const active =
        mode.maintance === true ||
        mode.maintance === "true" ||
        mode.maintenance === true ||
        mode.maintenance === "true";
      // datas (DD/MM/YYYY [HH:MM]) — se presentes, respeita a janela
      const parsePT = (s, end) => {
        if (!s) return null;
        const mm = String(s)
          .trim()
          .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
        if (!mm) return null;
        const d = new Date(
          +mm[3],
          +mm[2] - 1,
          +mm[1],
          mm[4] != null ? +mm[4] : end ? 23 : 0,
          mm[5] != null ? +mm[5] : end ? 59 : 0,
        );
        return d;
      };
      let within = false;
      if (mode.datainicio && mode.datafim) {
        const a = parsePT(mode.datainicio, false),
          b = parsePT(mode.datafim, true);
        const now = new Date();
        if (a && b && now >= a && now <= b) within = true;
      }
      if (active || within) return mode;
      return null;
    } catch (_) {
      return null;
    }
  }

  // ═══ CSS INJETADO (.ltp-*) ══════════════════════════════════════════════════
  const SVG_CLOCK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  const SVG_X_SMALL =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" width="12" height="12"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  function fmtHM(ts) {
    const d = new Date(ts);
    return (
      String(d.getHours()).padStart(2, "0") +
      ":" +
      String(d.getMinutes()).padStart(2, "0")
    );
  }

  function injectStyles() {
    if (document.getElementById("ltp-styles")) return;
    const css = `
.ltp-wrap{font-family:"Inter",-apple-system,BlinkMacSystemFont,sans-serif;-webkit-tap-highlight-color:transparent}
.ltp-fade{animation:ltp-fade .4s ease both}
@keyframes ltp-fade{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}

/* Filtro de sentido */
.ltp-filter{display:flex;gap:.5rem;margin-bottom:1.5rem}
.ltp-dir{flex:1;padding:.7rem .5rem;font-size:9px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;border:1px solid rgb(228,228,231);background:transparent;color:rgb(113,113,122);cursor:pointer;transition:all .2s ease;border-radius:2px}
html.dark .ltp-dir{border-color:rgb(39,39,42);color:rgb(161,161,170)}
.ltp-dir[aria-pressed="true"]{background:rgb(24,24,27);border-color:rgb(24,24,27);color:#fff}
html.dark .ltp-dir[aria-pressed="true"]{background:rgb(244,244,245);border-color:rgb(244,244,245);color:rgb(9,9,11)}
/* Segundo nível de Coina: mesma selecção, mas apertada. O anel distingue-o do
   primeiro toque sem precisar de ler o texto. */
.ltp-dir-strict{box-shadow:0 0 0 2px rgba(24,24,27,.25)}
html.dark .ltp-dir-strict{box-shadow:0 0 0 2px rgba(244,244,245,.3)}
/* Três destinos em vez de dois: os nomes são curtos, mas o Setúbal não pode
   partir a linha em ecrãs estreitos. */
.ltp-dir{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media (max-width:360px){.ltp-dir{letter-spacing:.12em;padding-left:.25rem;padding-right:.25rem}}

/* Cabeçalho de grupo por sentido */
.ltp-group{margin-bottom:2rem}
.ltp-group-head{display:flex;align-items:center;gap:.75rem;margin:0 0 .85rem}
.ltp-group-label{font-size:9px;font-weight:800;letter-spacing:.3em;text-transform:uppercase;color:rgb(113,113,122);white-space:nowrap}
html.dark .ltp-group-label{color:rgb(161,161,170)}
.ltp-group-rule{height:1px;flex:1;background:rgb(228,228,231)}
html.dark .ltp-group-rule{background:rgb(39,39,42)}
.ltp-group-count{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;color:rgb(161,161,170);font-variant-numeric:tabular-nums}

/* Cartão de comboio — separação clara entre comboios */
.ltp-card{display:block;text-decoration:none;color:inherit;position:relative;padding:1rem 1.1rem;margin-bottom:.6rem;border:1px solid rgb(244,244,245);border-radius:10px;background:rgba(255,255,255,.6);transition:border-color .2s ease,transform .15s ease,box-shadow .2s ease;cursor:pointer;overflow:hidden}
html.dark .ltp-card{border-color:rgb(24,24,27);background:rgba(24,24,27,.25)}
.ltp-card:hover{border-color:rgb(212,212,216);box-shadow:0 6px 22px -16px rgba(0,0,0,.5)}
html.dark .ltp-card:hover{border-color:rgb(63,63,70)}
.ltp-card:active{transform:scale(.992)}
.ltp-card.sup{opacity:.62}
.ltp-accent{position:absolute;left:0;top:0;bottom:0;width:3px;background:#10b981}
.ltp-accent[data-status="yellow"]{background:#f59e0b}
.ltp-accent[data-status="orange"]{background:#f97316}
.ltp-accent[data-status="red"]{background:#ef4444}
.ltp-accent[data-status="gray"]{background:#d4d4d8}
html.dark .ltp-accent[data-status="gray"]{background:#3f3f46}

.ltp-row1{display:flex;align-items:baseline;justify-content:space-between;gap:.75rem;padding-left:.55rem}
.ltp-list{display:block}
.ltp-r1{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;padding-left:.55rem}
.ltp-r1r{display:flex;flex-direction:column;align-items:flex-end;gap:.3rem;flex-shrink:0}
.ltp-dir-tag{font-size:8px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:rgb(161,161,170)}
html.dark .ltp-dir-tag{color:rgb(113,113,122)}
.ltp-time{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:1.9rem;font-weight:300;letter-spacing:-.04em;line-height:1;font-variant-numeric:tabular-nums;color:rgb(24,24,27)}
html.dark .ltp-time{color:#fff}
.ltp-time.sup{text-decoration:line-through;opacity:.6}
.ltp-prog{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;color:rgb(161,161,170);text-decoration:line-through;margin-left:.4rem;font-variant-numeric:tabular-nums}
.ltp-badge{font-size:9px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;white-space:nowrap}
.ltp-badge.live{color:#059669}
html.dark .ltp-badge.live{color:#34d399}
.ltp-badge.sup{color:#ef4444}
.ltp-badge.extra{color:#3b82f6}
.ltp-badge.warn{color:#f97316}
.ltp-badge.prog{color:rgb(161,161,170)}
.ltp-badge.delay{color:#d97706}
html.dark .ltp-badge.delay{color:#fbbf24}
.ltp-live-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#10b981;margin-right:5px;vertical-align:middle}
.ltp-live-dot.pulse{animation:ltp-pulse 1.7s ease-in-out infinite}
@keyframes ltp-pulse{0%,100%{box-shadow:0 0 0 0 rgba(16,185,129,.5)}50%{box-shadow:0 0 0 5px rgba(16,185,129,0)}}

/* Destino em destaque (info mais importante) */
.ltp-dest{padding-left:.55rem;margin-top:.55rem;display:flex;align-items:baseline;gap:.5rem}
.ltp-dest-arrow{font-size:13px;color:rgb(212,212,216)}
html.dark .ltp-dest-arrow{color:rgb(63,63,70)}
.ltp-dest-name{font-size:1.05rem;font-weight:500;letter-spacing:-.01em;color:rgb(24,24,27);line-height:1.1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
html.dark .ltp-dest-name{color:rgb(244,244,245)}
.ltp-via{padding-left:.55rem;margin-top:.25rem;font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:rgb(161,161,170);display:flex;align-items:center;justify-content:space-between;gap:.5rem}
.ltp-num{font-family:"JetBrains Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}

/* Ocupação / carruagens */
.ltp-cars{display:flex;align-items:center;gap:.6rem;padding-left:.55rem;margin-top:.75rem}
.ltp-cars-bar{display:flex;gap:2px;flex:1;min-width:0}
.ltp-cars-bar span{height:4px;flex:1;border-radius:1px}
.ltp-cars-txt{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:rgb(161,161,170);white-space:nowrap}

/* Aviso de trajeto anormal */
.ltp-warn{display:flex;align-items:flex-start;gap:.5rem;margin:.7rem 0 0 .55rem;padding:.55rem .7rem;border-radius:8px;font-size:10px;line-height:1.4;font-weight:500}
.ltp-warn svg{flex-shrink:0;margin-top:1px}
.ltp-warn.abn{border:1px solid rgba(245,158,11,.35);background:rgba(245,158,11,.08);color:rgb(146,64,14)}
html.dark .ltp-warn.abn{color:rgb(252,211,77)}
.ltp-warn.enc{border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.07);color:rgb(153,27,27)}
html.dark .ltp-warn.enc{color:rgb(252,165,165)}
.ltp-warn b{font-weight:700}
.ltp-foot{margin-top:.5rem;font-size:10px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:rgb(161,161,170);text-align:center;min-height:1em}

/* Banners de estado */
.ltp-bar{display:flex;align-items:center;gap:.6rem;padding:.6rem 1rem;margin-bottom:1.25rem;font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:rgb(82,82,91);background:rgba(244,244,245,.7);border:1px solid rgb(228,228,231);border-radius:8px}
.ltp-bar-from{color:rgb(29,78,216);background:rgba(59,130,246,.08);border-color:rgba(59,130,246,.35)}
html.dark .ltp-bar-from{color:rgb(147,197,253);background:rgba(59,130,246,.12);border-color:rgba(59,130,246,.3)}
.ltp-bar-from span{flex:1;min-width:0}
.ltp-from-x{flex-shrink:0;width:26px;height:26px;margin:-.3rem -.5rem -.3rem 0;display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;color:inherit;opacity:.7;cursor:pointer;border-radius:9999px}
.ltp-from-x:hover{opacity:1;background:rgba(59,130,246,.14)}
html.dark .ltp-bar{color:rgb(212,212,216);background:rgba(24,24,27,.6);border-color:rgb(39,39,42)}

/* Vazio / manutenção */
.ltp-empty{padding:3.5rem 1rem;text-align:center}
.ltp-empty-t{font-size:11px;font-weight:800;letter-spacing:.25em;text-transform:uppercase;color:rgb(161,161,170)}
.ltp-empty-s{font-size:11px;font-weight:300;line-height:1.6;color:rgb(161,161,170);max-width:20rem;margin:.75rem auto 0}
html.dark .ltp-empty-s{color:rgb(82,82,91)}
.ltp-maint{padding:1.25rem;border:1px solid rgba(249,115,22,.3);background:rgba(249,115,22,.05);border-radius:10px}

/* Skeleton */
.ltp-skel{background:linear-gradient(90deg,rgb(244,244,245) 0%,rgb(228,228,231) 50%,rgb(244,244,245) 100%);background-size:200% 100%;animation:ltp-skel 1.6s ease-in-out infinite;border-radius:8px}
html.dark .ltp-skel{background:linear-gradient(90deg,rgb(24,24,27) 0%,rgb(39,39,42) 50%,rgb(24,24,27) 100%);background-size:200% 100%}
@keyframes ltp-skel{0%,100%{opacity:1}50%{opacity:.45}}

/* ─── SHEET DE DETALHE (percurso) ─── */
.ltp-bd{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .3s ease}
.ltp-bd.open{opacity:1;pointer-events:auto}
.ltp-sheet{position:fixed;z-index:2147483001;left:0;right:0;bottom:0;max-height:88vh;background:#fff;border-radius:20px 20px 0 0;box-shadow:0 -10px 40px -12px rgba(0,0,0,.4);transform:translateY(100%);transition:transform .38s cubic-bezier(.22,.61,.36,1);display:flex;flex-direction:column;overflow:hidden;padding-bottom:env(safe-area-inset-bottom,0)}
html.dark .ltp-sheet{background:#09090b}
.ltp-sheet.open{transform:translateY(0)}
@media(min-width:768px){.ltp-sheet{left:50%;right:auto;bottom:auto;top:50%;width:440px;max-height:82vh;border-radius:16px;transform:translate(-50%,-46%) scale(.98);opacity:0;transition:opacity .25s ease,transform .25s ease}.ltp-sheet.open{transform:translate(-50%,-50%) scale(1);opacity:1}}
.ltp-grab{padding:.7rem 0 .2rem;display:flex;justify-content:center;flex-shrink:0;cursor:grab}
@media(min-width:768px){.ltp-grab{display:none}}
.ltp-grab span{width:36px;height:4px;border-radius:99px;background:rgb(212,212,216)}
html.dark .ltp-grab span{background:rgb(63,63,70)}
.ltp-sh-head{padding:.5rem 1.4rem 1.1rem;border-bottom:1px solid rgb(244,244,245);flex-shrink:0}
/* No mesmo painel não há sheet: sem margens laterais próprias e com o botão de
   voltar em vez da cruz. */
.ltp-sh-head.inline{padding:0 0 1rem}
.ltp-back{display:inline-flex;align-items:center;gap:6px;background:none;border:0;padding:0;margin-bottom:.7rem;font:inherit;font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:rgb(113,113,122);cursor:pointer}
.ltp-back:hover{color:rgb(9,9,11)}
.ltp-sh-title{font-size:18px;font-weight:300;letter-spacing:-.02em;color:rgb(24,24,27)}
html.dark .ltp-sh-title{color:#fff}
.ltp-sh-sub{font-size:9px;font-weight:800;letter-spacing:.24em;text-transform:uppercase;color:rgb(161,161,170);margin-top:.3rem}
.ltp-lg-bloco{padding:.85rem 0;border-bottom:1px solid rgb(244,244,245)}
html.dark .ltp-lg-bloco{border-bottom-color:rgb(24,24,27)}
.ltp-lg-bloco:last-child{border-bottom:0}
.ltp-lg-cab{display:flex;align-items:center;gap:.5rem}
.ltp-lg-op{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:rgb(63,63,70)}
html.dark .ltp-lg-op{color:rgb(212,212,216)}
.ltp-lg-linhas{font-size:12px;color:rgb(113,113,122);margin-top:.35rem;line-height:1.5}
.ltp-lg-alvo{display:flex;align-items:center;justify-content:space-between;gap:.6rem;width:100%;margin-top:.5rem;padding:.55rem .7rem;border:1px solid rgb(228,228,231);border-radius:8px;background:none;font:inherit;font-size:13px;color:rgb(24,24,27);cursor:pointer}
html.dark .ltp-lg-alvo{border-color:rgb(39,39,42);color:#fff}
.ltp-lg-alvo:hover{background:rgba(0,0,0,.03)}
html.dark .ltp-lg-alvo:hover{background:rgba(255,255,255,.05)}
.ltp-lg-alvo svg{opacity:.4;flex-shrink:0}
.ltp-lg-nota{font-size:10px;color:rgb(161,161,170);margin-top:.9rem}
/* Cabeçalho da lista de paragens: título à esquerda, resumo à direita. */
.ltp-pc-cab{display:flex;align-items:baseline;justify-content:space-between;gap:.75rem;margin-bottom:.35rem}
.ltp-pc-tit{font-size:9px;font-weight:800;letter-spacing:.28em;text-transform:uppercase;color:rgb(161,161,170)}
.ltp-pc-res{font-size:11px;color:rgb(113,113,122);font-variant-numeric:tabular-nums}
.ltp-pc-dica{font-size:10px;color:rgb(161,161,170);margin-bottom:.75rem;line-height:1.4}
/* A lista ganha respiro e uma linha de base para as horas alinharem. */
.ltp-pc-lista{margin-top:.5rem}
.ltp-stop-time{font-variant-numeric:tabular-nums;text-align:right}
html.dark .ltp-back:hover{color:#fff}
.ltp-route .ltp-sh-body{padding:1.2rem 0 .5rem;overflow:visible}
html.dark .ltp-sh-head{border-bottom-color:rgb(24,24,27)}
.ltp-sh-close{position:absolute;right:1rem;top:.9rem;width:38px;height:38px;display:flex;align-items:center;justify-content:center;color:rgb(161,161,170);background:transparent;border:0;cursor:pointer}
.ltp-sh-body{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:1.2rem 1.4rem 2rem}
.ltp-stop{display:grid;grid-template-columns:3.2rem 16px 1fr auto auto;align-items:center;gap:.75rem;padding:.5rem 0;position:relative}
/* O trilho vive DENTRO da coluna do ponto, e não numa posição calculada à mão:
   assim fica sempre alinhado com as bolas, seja qual for a largura das horas. */
.ltp-stop-dot{position:relative;justify-self:center}
.ltp-stop-dot::before{content:"";position:absolute;left:50%;top:-1.1rem;bottom:-1.1rem;width:2px;margin-left:-1px;background:rgb(228,228,231);z-index:-1}
html.dark .ltp-stop-dot::before{background:rgb(39,39,42)}
.ltp-stop.todo .ltp-stop-dot::before{background:var(--ltp-trip,#10b981)}
.ltp-stop.first .ltp-stop-dot::before{top:50%}
.ltp-stop.last .ltp-stop-dot::before{bottom:50%}
.ltp-stop.todo .ltp-stop-dot{border-color:var(--ltp-trip,#10b981)}
/* Origem e destino com mais peso: são as pontas da viagem. */
.ltp-stop.first .ltp-stop-dot,.ltp-stop.last .ltp-stop-dot{width:11px;height:11px;border-width:2.5px}
.ltp-stop.first .ltp-nm,.ltp-stop.last .ltp-nm{font-weight:600}
/* Logótipos das ligações, à frente do nome. */
/* Última coluna da linha: sempre no extremo direito, mesmo quando não há
   atraso a mostrar na coluna anterior. */
.ltp-lig{display:inline-flex;align-items:center;gap:4px;justify-self:end;padding:3px 5px 3px 6px;margin:0;border:1px solid rgb(228,228,231);background:#fff;cursor:pointer;border-radius:999px;color:rgb(113,113,122);transition:border-color .15s ease,box-shadow .15s ease,transform .1s ease}
html.dark .ltp-lig{background:rgb(24,24,27);border-color:rgb(39,39,42)}
.ltp-lig:hover{border-color:rgb(161,161,170);box-shadow:0 1px 6px rgba(0,0,0,.1)}
.ltp-lig:active{transform:scale(.94)}
.ltp-lig:focus-visible{outline:2px solid #3b82f6;outline-offset:2px}
.ltp-lig-seta{flex-shrink:0;opacity:.55;margin-left:1px}
.ltp-stop.past .ltp-lig{opacity:.5}
.ltp-lig-logo{width:14px;height:14px;object-fit:contain;display:block;border-radius:3px;background:#fff;padding:1px;box-shadow:0 0 0 1px rgba(0,0,0,.12)}
.ltp-stop.past .ltp-lig{opacity:.45}
.ltp-stop-time{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:13px;font-variant-numeric:tabular-nums;color:rgb(82,82,91)}
html.dark .ltp-stop-time{color:rgb(161,161,170)}
.ltp-stop-dot{width:9px;height:9px;border-radius:50%;border:2px solid rgb(212,212,216);background:#fff;z-index:1}
html.dark .ltp-stop-dot{background:#09090b;border-color:rgb(63,63,70)}
.ltp-stop-name{font-size:13px;color:rgb(39,39,42);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
/* O risco é só no texto: sem isto, atravessava também os logótipos. */
.ltp-stop.past .ltp-stop-name{text-decoration:none}
.ltp-stop.past .ltp-stop-name>span.ltp-lig{text-decoration:none}
html.dark .ltp-stop-name{color:rgb(212,212,216)}
.ltp-stop-delay{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;font-weight:700}
.ltp-stop.past .ltp-stop-time{color:rgb(161,161,170);text-decoration:line-through;text-decoration-thickness:.5px}
.ltp-stop.past .ltp-stop-name{color:rgb(161,161,170)}
.ltp-stop.past .ltp-stop-name .ltp-nm{text-decoration:line-through;text-decoration-thickness:.5px}
html.dark .ltp-stop.past .ltp-stop-name,html.dark .ltp-stop.past .ltp-stop-time{color:rgb(82,82,91)}
.ltp-stop.past .ltp-stop-dot{background:rgb(161,161,170);border-color:rgb(161,161,170)}
.ltp-stop.cur .ltp-stop-dot{background:#10b981;border-color:#10b981;box-shadow:0 0 0 4px rgba(16,185,129,.18)}
/* Depois da estação seleccionada: o resto do percurso de quem está a ler. */
.ltp-stop.after .ltp-stop-dot{background:#3b82f6;border-color:#3b82f6}
.ltp-stop.after .ltp-stop-name{color:rgb(24,24,27)}
html.dark .ltp-stop.after .ltp-stop-name{color:rgb(228,228,231)}
.ltp-stop.cur .ltp-stop-name{color:rgb(24,24,27);font-weight:700}
html.dark .ltp-stop.cur .ltp-stop-name{color:#fff}
.ltp-stop.skip{opacity:.85}
.ltp-stop.skip .ltp-stop-time,.ltp-stop.skip .ltp-nm{color:rgb(161,161,170);text-decoration:line-through;text-decoration-color:rgba(245,158,11,.6)}
.ltp-stop.skip .ltp-stop-dot{background:transparent;border-color:rgba(245,158,11,.6)}
.ltp-stop-skip{font-size:8px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#f59e0b;white-space:nowrap}
@media(prefers-reduced-motion:reduce){.ltp-live-dot.pulse,.ltp-skel{animation:none!important}}
`;
    const tag = document.createElement("style");
    tag.id = "ltp-styles";
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  // ═══ RENDER ════════════════════════════════════════════════════════════════
  const SVG_ALERT = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  const SVG_WIFI = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12" y2="20"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`;
  const SVG_SERVER = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`;
  const SVG_MOON = `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 5h4"/><path d="M20 3v4"/><path d="M21.17 11A8 8 0 1 1 13 2.83"/></svg>`;
  const SVG_WRENCH = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;

  function carBars(dep, noNet) {
    const occ = dep.occupancy;
    const n = dep.carriages || 4;
    let fill = "#3b82f6";
    if (noNet && occ == null) fill = "#71717a";
    else if (occ != null && occ > 85) fill = "#ef4444";
    else if (occ != null && occ > 50) fill = "#f59e0b";
    else if (occ != null) fill = "#10b981";
    const filled = occ != null ? Math.round((occ / 100) * n) : n;
    let s = "";
    for (let i = 0; i < n; i++)
      s += `<span style="background-color:${i < filled ? fill : "rgba(161,161,170,.25)"}"></span>`;
    return { bars: s, n, occ };
  }

  function badgeHtml(dep) {
    if (dep.shortened) return `<span class="ltp-badge sup">Não Para</span>`;
    if (dep.suppressed) return `<span class="ltp-badge sup">Suprimido</span>`;
    if (dep.perturbacao)
      return `<span class="ltp-badge warn">Perturbação</span>`;
    if (dep.delayMin >= 1)
      return `<span class="ltp-badge delay">+${dep.delayMin} min</span>`;
    if (dep.live)
      return `<span class="ltp-badge live"><span class="ltp-live-dot pulse"></span>A Horas</span>`;
    if (dep.extra) return `<span class="ltp-badge extra">Extra</span>`;
    return `<span class="ltp-badge prog">Programado</span>`;
  }

  // Aviso inline POR comboio (baseado no _abnormalHtml da app). Nunca números.
  function warnHtml(dep) {
    if (dep.shortened) {
      return `<div class="ltp-warn enc">${SVG_ALERT}<div>Devido a obras, este comboio <b>não para nesta estação</b> hoje.</div></div>`;
    }
    if (dep.abnormal) {
      const stationName = (s) => {
        const st = resolveStationByApiName(s);
        return st ? st.name : s;
      };
      const sk = (dep.skipped || [])
        .map((s) => (s && s.nome ? stationName(s.nome) : ""))
        .filter(Boolean);
      const list = sk.slice(0, 4).join(", ");
      const extra = list ? ` · não para em <b>${esc(list)}</b>` : "";
      return `<div class="ltp-warn abn">${SVG_ALERT}<div><b>Trajeto anormal</b>${extra}</div></div>`;
    }
    return "";
  }

  const dirLabel = (d) => (d === "margem" ? "Sent. Margem" : "Sent. Lisboa");

  // innerHTML de um cartão (sem o elemento raiz — o reconciliador gere a raiz).
  function cardInner(dep, noNet) {
    const { bars, n, occ } = carBars(dep, noNet);
    const status = dep.dotStatus || "gray";
    const timeCls = dep.suppressed || dep.shortened ? " sup" : "";
    let prog = "";
    const node = dep.node;
    if (!dep.suppressed && !dep.shortened && dep.delayMin >= 1 && node) {
      const p = (node.HoraProgramada || "").substring(0, 5);
      if (p && !p.startsWith("HH") && p !== dep.timeStr)
        prog = `<span class="ltp-prog">${esc(p)}</span>`;
    }
    return `
      <span class="ltp-accent" data-status="${status}"></span>
      <div class="ltp-r1">
        <div style="min-width:0"><span class="ltp-time${timeCls}">${esc(dep.timeStr || "--:--")}</span>${prog}</div>
        <div class="ltp-r1r">
          <span class="ltp-dir-tag">${dirLabel(dep.direction)}</span>
          ${badgeHtml(dep)}
        </div>
      </div>
      <div class="ltp-dest">
        <span class="ltp-dest-arrow">→</span>
        <span class="ltp-dest-name">${esc(dep.destino || "—")}</span>
      </div>
      <div class="ltp-via">
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">de ${esc(dep.origem || "—")}</span>
        <span class="ltp-num">#${esc(dep.numero || dep.id)}</span>
      </div>
      <div class="ltp-cars">
        <div class="ltp-cars-bar">${bars}</div>
        <span class="ltp-cars-txt">${n} carr${occ != null ? ` · ${occ}%` : ""}</span>
      </div>
      ${warnHtml(dep)}`;
  }

  // Assinatura dos campos visíveis → o reconciliador só re-renderiza se mudar.
  function depSig(dep, noNet) {
    return [
      dep.timeStr,
      dep.dotStatus,
      dep.statusText,
      dep.delayMin,
      dep.occupancy,
      dep.carriages,
      dep.destino,
      dep.origem,
      dep.live ? 1 : 0,
      dep.suppressed ? 1 : 0,
      dep.shortened ? 1 : 0,
      dep.abnormal ? 1 : 0,
      (dep.skipped || []).length,
      dep.extra ? 1 : 0,
      dep.direction,
      noNet ? 1 : 0,
    ].join("|");
  }
  function rootClass(dep) {
    return "ltp-card" + (dep.suppressed || dep.shortened ? " sup" : "");
  }

  // ─── Cartão: criar / patch (in-place) ───────────────────────────────────────
  function makeCard(dep, noNet) {
    const el = document.createElement("a");
    el.href = "#";
    el.dataset.key = "ltp-" + dep.id;
    el.dataset.ltpTrain = dep.id;
    el.className = rootClass(dep) + " ltp-fade";
    el.innerHTML = cardInner(dep, noNet);
    el._sig = depSig(dep, noNet);
    return el;
  }
  function patchCard(el, dep, noNet) {
    const sig = depSig(dep, noNet);
    if (el._sig === sig) return; // nada mudou → não toca no DOM
    el.className = rootClass(dep); // sem ltp-fade no patch (sem flicker)
    el.innerHTML = cardInner(dep, noNet);
    el._sig = sig;
  }

  // ─── Reconciliador da lista (deps já filtrados e ordenados por hora) ─────────
  function reconcileList(listEl, deps, noNet) {
    listEl.querySelectorAll(".ltp-skelrow").forEach((e) => e.remove());

    if (deps.length === 0) {
      listEl.querySelectorAll("[data-key]").forEach((e) => {
        if (e.dataset.key !== "__empty__") e.remove();
      });
      if (!listEl.querySelector("[data-key='__empty__']")) {
        const e = document.createElement("div");
        e.dataset.key = "__empty__";
        e.className = "ltp-empty ltp-fade";
        e.innerHTML = `<div style="color:rgb(212,212,216);margin-bottom:1.1rem">${SVG_MOON}</div>
          <p class="ltp-empty-t">Sem próximas partidas</p>
          <p class="ltp-empty-s">${noNet ? "Sem dados em tempo real — liga-te à internet." : "Verifica os filtros de sentido ou tenta mais tarde."}</p>`;
        listEl.appendChild(e);
      }
      return;
    }
    const emptyNode = listEl.querySelector("[data-key='__empty__']");
    if (emptyNode) emptyNode.remove();

    const existing = new Map();
    listEl
      .querySelectorAll("[data-key]")
      .forEach((el) => existing.set(el.dataset.key, el));
    const desiredKeys = new Set(deps.map((d) => "ltp-" + d.id));
    existing.forEach((el, key) => {
      if (!desiredKeys.has(key)) {
        el.remove();
        existing.delete(key);
      }
    });

    let anchor = null;
    for (let i = deps.length - 1; i >= 0; i--) {
      const dep = deps[i];
      const key = "ltp-" + dep.id;
      let el = existing.get(key);
      if (el) {
        patchCard(el, dep, noNet);
        const correct = anchor
          ? el.nextElementSibling === anchor
          : el === listEl.lastElementChild;
        if (!correct) listEl.insertBefore(el, anchor);
      } else {
        el = makeCard(dep, noNet);
        listEl.insertBefore(el, anchor);
      }
      anchor = el;
    }
  }

  // ═══ SHEET DE DETALHE (singleton) ═══════════════════════════════════════════
  let sheetEl = null,
    bdEl = null,
    sheetScrollY = 0;
  function ensureSheet() {
    if (sheetEl && bdEl) return;
    bdEl = document.createElement("div");
    bdEl.className = "ltp-bd";
    sheetEl = document.createElement("div");
    sheetEl.className = "ltp-sheet";
    sheetEl.setAttribute("role", "dialog");
    sheetEl.setAttribute("aria-modal", "true");
    document.body.appendChild(bdEl);
    document.body.appendChild(sheetEl);
    bdEl.addEventListener("click", closeSheet);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && sheetEl.classList.contains("open"))
        closeSheet();
    });
  }
  function lockScroll() {
    sheetScrollY = window.scrollY || window.pageYOffset || 0;
    const b = document.body.style;
    b.position = "fixed";
    b.top = `-${sheetScrollY}px`;
    b.left = "0";
    b.right = "0";
    b.width = "100%";
  }
  function unlockScroll() {
    const b = document.body.style;
    b.position = "";
    b.top = "";
    b.left = "";
    b.right = "";
    b.width = "";
    window.scrollTo(0, sheetScrollY);
  }
  function openSheet(html) {
    ensureSheet();
    sheetEl.innerHTML = html;
    bdEl.classList.add("open");
    requestAnimationFrame(() => sheetEl.classList.add("open"));
    lockScroll();
    sheetEl
      .querySelectorAll("[data-ltp-sheet-close]")
      .forEach((b) => b.addEventListener("click", closeSheet));
    attachSheetSwipe();
    if (window.lucide)
      try {
        window.lucide.createIcons();
      } catch (_) {}
  }
  function closeSheet() {
    if (!sheetEl) return;
    sheetEl.classList.remove("open");
    bdEl.classList.remove("open");
    unlockScroll();
    setTimeout(() => {
      if (!sheetEl.classList.contains("open")) sheetEl.innerHTML = "";
    }, 420);
  }
  function attachSheetSwipe() {
    if (window.matchMedia("(min-width:768px)").matches) return;
    let startY = null,
      dragY = 0,
      startT = 0,
      allow = false;
    const onStart = (e) => {
      if (e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      startT = Date.now();
      dragY = 0;
      const body = sheetEl.querySelector(".ltp-sh-body");
      allow = !body || body.scrollTop <= 0;
      sheetEl.style.transition = "none";
    };
    const onMove = (e) => {
      if (startY == null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy < 0) {
        dragY = dy / 5;
      } else if (allow) {
        dragY = dy;
      } else return;
      sheetEl.style.transform = `translateY(${dragY}px)`;
      bdEl.style.opacity = String(Math.max(0, 1 - dragY / 400));
    };
    const onEnd = () => {
      if (startY == null) return;
      const dt = Math.max(1, Date.now() - startT);
      sheetEl.style.transition = "";
      bdEl.style.opacity = "";
      if (dragY > 110 || dragY / dt > 0.5) {
        sheetEl.style.transform = "";
        closeSheet();
      } else sheetEl.style.transform = "";
      startY = null;
    };
    sheetEl.addEventListener("touchstart", onStart, { passive: true });
    sheetEl.addEventListener("touchmove", onMove, { passive: true });
    sheetEl.addEventListener("touchend", onEnd, { passive: true });
    sheetEl.addEventListener("touchcancel", onEnd, { passive: true });
  }

  // Render do percurso (cases 2 e 3) numa sheet.
  function renderRouteSheet(dep, nodes, station, inline) {
    const noNet = !navigator.onLine;
    const { bars, n, occ } = carBars(dep, noNet);
    const stationApiId = station ? String(station.apiId) : null;

    // [TRAJETO ANORMAL] estações saltadas → intercalar na posição física da
    // linha, riscadas (tal como na app). Funciona quer venham nos nodes (do
    // horário) quer os nodes reais já as omitam (IP).
    const dirOrder =
      dep.direction === "margem"
        ? ORDER_KEYS.slice().reverse()
        : ORDER_KEYS.slice();
    const orderIdx = (key) => dirOrder.indexOf(key);
    const skips = (Array.isArray(dep.skipped) ? dep.skipped : [])
      .map((sk) => {
        const st =
          sk && sk.key
            ? BY_KEY[sk.key]
            : resolveStationByApiName(sk && sk.nome);
        const key = st ? st.key : sk && sk.key;
        return {
          key,
          name: st ? st.name : (sk && (sk.nome || sk.key)) || "",
          hora: (sk && sk.hora) || "--:--",
          order: orderIdx(key),
        };
      })
      .filter((s) => s.order >= 0)
      .sort((a, b) => a.order - b.order);
    const skipKeys = new Set(skips.map((s) => s.key));

    const renderSkip = (s) =>
      `<div class="ltp-stop skip">
          <span class="ltp-stop-time">${esc(s.hora || "--:--")}</span>
          <span class="ltp-stop-dot"></span>
          <span class="ltp-stop-name"><span class="ltp-nm">${esc(s.name)}</span></span>
          <span class="ltp-stop-skip">Não passa</span>
        </div>`;

    let skipPtr = 0;
    let stops = "";
    let restante = false; // já apanhámos a primeira estação por passar?
    // Depois da estação onde a pessoa está, o que vem é a viagem DELA. Essas
    // ficam com a bola azul: o trilho colorido diz o que falta ao comboio, a
    // bola azul diz o que falta a quem o vai apanhar aqui.
    let depoisDaMinha = false;
    const listaNodes = nodes || [];
    listaNodes.forEach((nd, idx) => {
      const st = resolveStationByApiName(nd.NomeEstacao);
      const servedOrder = st ? orderIdx(st.key) : -1;
      // Intercalar saltadas (que não vêm nos nodes) ANTES desta servida.
      while (
        skipPtr < skips.length &&
        servedOrder >= 0 &&
        skips[skipPtr].order < servedOrder
      ) {
        stops += renderSkip(skips[skipPtr]);
        skipPtr++;
      }
      // Se o próprio nó é uma estação saltada (veio do horário) → riscar.
      if (st && skipKeys.has(st.key)) {
        stops += renderSkip({
          name: st.name,
          hora: nodeTimeStr(nd) || "--:--",
        });
        if (skipPtr < skips.length && skips[skipPtr].key === st.key) skipPtr++;
        return;
      }
      const time = nodeTimeStr(nd) || "--:--";
      const past = !!nd.ComboioPassou;
      const cur =
        stationApiId && String(nd.EstacaoID) === stationApiId && !past;
      const dly = nodeDelayMin(nd);
      let dh = "";
      if (!dep.suppressed && dly != null && dly >= 1)
        dh = `<span class="ltp-stop-delay" style="color:#d97706">+${dly}</span>`;
      else if (!dep.suppressed && dly != null && dly <= -1)
        dh = `<span class="ltp-stop-delay" style="color:#059669">${dly}</span>`;
      const nm = st ? st.name : (nd.NomeEstacao || "").replace(/-A$/, "");
      // A cor acompanha o que FALTA fazer: assim que aparece a primeira
      // estação por passar, o trilho acende até ao fim.
      if (!past) restante = true;
      const minhaViagem = depoisDaMinha;
      if (cur) depoisDaMinha = true; // a partir da SEGUINTE
      const ponta =
        idx === 0 ? "first" : idx === listaNodes.length - 1 ? "last" : "";
      stops += `<div class="ltp-stop ${past ? "past" : ""} ${cur ? "cur" : ""} ${
        restante ? "todo" : ""
      } ${minhaViagem ? "after" : ""} ${ponta}">
          <span class="ltp-stop-time">${esc(time)}</span>
          <span class="ltp-stop-dot"></span>
          <span class="ltp-stop-name"><span class="ltp-nm">${esc(nm)}</span></span>
          ${dh}
          ${ligacoesHtml(st && st.key, nm)}
        </div>`;
    });
    // Saltadas que sobram (cortadas no fim do trajeto).
    while (skipPtr < skips.length) {
      stops += renderSkip(skips[skipPtr]);
      skipPtr++;
    }

    let bCls = "prog",
      bTxt = "Programado";
    if (dep.shortened) {
      bCls = "sup";
      bTxt = "Não para aqui";
    } else if (dep.suppressed) {
      bCls = "sup";
      bTxt = "Suprimido";
    } else if (dep.extra) {
      bCls = "extra";
      bTxt = "Extra";
    } else if (dep.delayMin >= 1) {
      bCls = "delay";
      bTxt = `Atraso ${dep.delayMin} min`;
    }

    const ACCENT = {
      green: "#10b981",
      yellow: "#f59e0b",
      orange: "#f97316",
      red: "#ef4444",
      gray: "#d4d4d8",
    };
    const cor = ACCENT[dep.dotStatus] || ACCENT.green;
    // Resumo curto no topo da lista: quantas paragens e a que horas chega.
    const nParagens = listaNodes.length;
    const chegada = nParagens
      ? nodeTimeStr(listaNodes[nParagens - 1])
      : null;
    const resumo = nParagens
      ? `${nParagens} ${nParagens === 1 ? "paragem" : "paragens"}${
          chegada ? ` · chega às ${chegada}` : ""
        }`
      : "";
    const temLigacoes = /data-ltp-lig-open/.test(stops);

    return `
      ${inline ? "" : `<div class="ltp-grab" data-ltp-grab><span></span></div>`}
      <div class="ltp-sh-head ${inline ? "inline" : ""}" style="position:relative">
        ${
          inline
            ? `<button class="ltp-back" data-ltp-route-back>
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="m15 18-6-6 6-6"/></svg>
                 <span>Partidas</span></button>`
            : `<button class="ltp-sh-close" data-ltp-sheet-close aria-label="Fechar">
                 <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
               </button>`
        }
        <div style="display:flex;align-items:baseline;gap:.6rem;margin-bottom:.55rem">
          <span class="ltp-num" style="font-size:11px;color:rgb(161,161,170)">#${esc(dep.numero || dep.id)}</span>
          <span class="ltp-badge ${bCls}">${esc(bTxt)}</span>
        </div>
        <h2 style="font-size:1.35rem;font-weight:300;letter-spacing:-.02em;line-height:1.1;color:inherit">
          ${esc(dep.origem || "—")} <span style="color:rgb(161,161,170);margin:0 .3rem">→</span> ${esc(dep.destino || "—")}
        </h2>
        <div class="ltp-cars" style="padding-left:0;margin-top:.9rem">
          <div class="ltp-cars-bar">${bars}</div>
          <span class="ltp-cars-txt">${n} carr${occ != null ? ` · ${occ}% ocup.` : ""}</span>
        </div>
        ${warnHtml(dep)}
      </div>
      <div class="ltp-sh-body" style="--ltp-trip:${esc(cor)}">
        <div class="ltp-pc-cab">
          <span class="ltp-pc-tit">Percurso</span>
          ${resumo ? `<span class="ltp-pc-res">${esc(resumo)}</span>` : ""}
        </div>
        ${
          temLigacoes
            ? `<p class="ltp-pc-dica">Toca nos logótipos para ver as ligações de cada estação.</p>`
            : ""
        }
        <div class="ltp-pc-lista">
          ${stops || `<p style="font-size:11px;color:rgb(161,161,170)">Sem paragens disponíveis.</p>`}
        </div>
      </div>`;
  }

  // Resolve o percurso completo conforme o caso (2 ou 3) e abre a sheet.
  async function openTrainDetail(dep, station, onRoute) {
    // 2) Extra não-vivo → /fertagus
    // 3) Normal não-vivo → JSON de horários
    let nodes = null;
    if (dep.extra) {
      try {
        const r = await fetch(EP_FERTAGUS + "?t=" + Date.now(), {
          headers: { "x-api-key": API_KEY, Accept: "application/json" },
          cache: "no-store",
        });
        if (r.ok) {
          const data = await r.json();
          const extras = data.extratrains || {};
          const found = extras[dep.id] || data[dep.id];
          if (found && Array.isArray(found.NodesPassagemComboio))
            nodes = found.NodesPassagemComboio;
        }
      } catch (_) {}
    }
    if (!nodes) {
      // Normal (ou extra sem resposta): construir a partir do JSON.
      const trip = findTripById(dep.id);
      if (trip) {
        const dir = dep.direction;
        const order =
          dir === "margem" ? ORDER_KEYS.slice().reverse() : ORDER_KEYS.slice();
        const now = new Date();
        nodes = [];
        for (const key of order) {
          const t = trip[key];
          if (!t) continue;
          const st = BY_KEY[key];
          if (!st) continue;
          const ts = parseTimeHHMMSS(t + ":00", now);
          nodes.push({
            ComboioPassou: ts ? Date.now() >= ts.getTime() : false,
            HoraProgramada: t + ":00",
            HoraReal: "HH:MM:SS",
            AtrasoReal: 0,
            HoraPrevista: t + ":00",
            EstacaoID: st.apiId,
            NomeEstacao: st.apiName,
          });
        }
      }
    }
    if (!nodes && dep.node) nodes = [dep.node];
    // As ligações são precisas para desenhar os logótipos; se falharem, o
    // percurso aparece na mesma, só sem eles.
    await loadLigacoes();
    const html = renderRouteSheet(dep, nodes || [], station, !!onRoute);
    // Com callback, o percurso substitui o conteúdo do painel — como acontece
    // no Metro, no MTS e na CP. Sem callback (quem ainda chame isto por fora),
    // mantém-se a sheet antiga.
    if (onRoute) onRoute(html);
    else openSheet(html);
  }


  // Ao trocar de vista, o painel tem de voltar ao topo. O elemento que faz
  // scroll não é sempre o mesmo — no mapa é a sheet, na página /estacao é a
  // própria janela, e o #details-panel também tem overflow próprio — por isso
  // sobe-se a árvore a repor todos os que rolam.
  function scrollAoTopo(el) {
    let n = el;
    let saltos = 0;
    while (n && n.nodeType === 1 && saltos < 12) {
      if (n.scrollTop > 0) n.scrollTop = 0;
      n = n.parentElement;
      saltos++;
    }
    try {
      if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: "auto" });
    } catch (_) {}
  }

  // ═══ CONTROLLER / MOUNT ═════════════════════════════════════════════════════
  // Compatibilidade com quem ainda passa { lisboa, margem }.
  function initialDest(df) {
    if (!df) return null;
    const l = df.lisboa !== false;
    const m = df.margem !== false;
    if (l && !m) return "lisboa";
    if (m && !l) return "coina"; // sul, no sentido lato
    return null;
  }

  const DEST_BTNS = [
    { id: "lisboa", label: "Lisboa" },
    { id: "coina", label: "Coina" },
    { id: "setubal", label: "Setúbal" },
  ];

  // Que botões fazem sentido nesta estação.
  //
  // Nas estações a sul de Coina — Penalva, Pinhal Novo, Venda do Alcaide,
  // Palmela e Setúbal — o botão Coina não filtra nada de útil: dali para sul o
  // único destino é Setúbal, e um comboio que TERMINE em Coina vai no sentido
  // de Lisboa, portanto já está no botão Lisboa. Ficam só Lisboa e Setúbal.
  function destBtnsFor(station) {
    const i = station ? ORDER_KEYS.indexOf(station.key) : -1;
    if (i >= 0 && i < COINA_IDX)
      return DEST_BTNS.filter((b) => b.id !== "coina");
    return DEST_BTNS;
  }

  function mount(opts) {
    injectStyles();
    const container = opts.container;
    if (!container) throw new Error("Partidas.mount: container em falta");
    const station =
      opts.station && opts.station.apiId
        ? opts.station
        : resolveStationByName(opts.station && opts.station.name);
    if (!station) throw new Error("Partidas.mount: estação inválida");

    const ctrl = {
      station,
      model: null,
      maintenanceMode: null,
      // Um destino selecionado de cada vez (null = todos). O "strict" só tem
      // significado em Coina, que é o único com dois níveis: primeiro toque =
      // tudo o que vai para sul, segundo = só os que terminam em Coina.
      dest: null, // ajustado logo abaixo, quando os botões já são conhecidos
      destStrict: false,
      btns: destBtnsFor(station),
      // Filtro "a partir de": epoch em ms, ou null. Vem de quem abriu o painel
      // — por exemplo, ao tocar na ligação à Fertagus a meio de uma viagem da
      // CP, para mostrar só o que se apanha à chegada.
      fromTs:
        typeof opts.fromTime === "number" && isFinite(opts.fromTime)
          ? opts.fromTime + TRANSFER_MARGIN_MIN * 60000
          : null,
      // Percurso a ocupar o painel, em vez da lista de partidas.
      routeHtml: null,
      _routeBuilt: false,
      // Ligações de uma estação do percurso, um nível acima deste.
      ligacoes: null,
      _ligBuilt: false,
      _timer: null,
      _destroyed: false,
      _built: false,
      _maintBuilt: false,
    };
    container.classList.add("ltp-wrap");

    function onLive(dep) {
      if (typeof opts.onLiveTrain === "function") return opts.onLiveTrain(dep);
      // Default (página): deep-link para o mapa.
      window.location.href = `/mapa#${encodeURIComponent(dep.id)}`;
    }

    function handleClick(dep) {
      if (!dep) return;
      if (dep.live) return onLive(dep); // caso 1
      // Casos 2/3: o percurso substitui a lista no MESMO painel, com um botão
      // para voltar — em vez de abrir uma segunda sheet por cima.
      return openTrainDetail(dep, station, showRoute);
    }

    function showRoute(html) {
      if (ctrl._destroyed) return;
      ctrl.routeHtml = html;
      ctrl._built = false; // a lista vai ter de ser reconstruída ao voltar
      paintRoute();
    }

    function backToList() {
      ctrl.routeHtml = null;
      ctrl._routeBuilt = false;
      ctrl.ligacoes = null;
      ctrl._ligBuilt = false;
      paint();
      scrollAoTopo(container);
    }

    function paintRoute() {
      container.innerHTML = `<div class="ltp-wrap ltp-route">${ctrl.routeHtml}</div>`;
      ctrl._routeBuilt = true;
      const b = container.querySelector("[data-ltp-route-back]");
      if (b) b.addEventListener("click", backToList);
      // Logótipos de uma estação → lista de ligações dessa estação.
      container.querySelectorAll("[data-ltp-lig-open]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          abrirLigacoes(
            btn.getAttribute("data-ltp-lig-open"),
            btn.getAttribute("data-ltp-lig-name"),
          );
        });
      });
      bindLigacaoLogos(container);
      scrollAoTopo(container);
    }

    function abrirLigacoes(stationKey, nome) {
      const r = renderLigacoes(stationKey, nome);
      ctrl.ligacoes = r;
      ctrl._ligBuilt = false;
      paintLigacoes();
    }

    function paintLigacoes() {
      container.innerHTML = `<div class="ltp-wrap ltp-route">${ctrl.ligacoes.html}</div>`;
      ctrl._ligBuilt = true;
      const b = container.querySelector("[data-ltp-lg-back]");
      if (b)
        b.addEventListener("click", () => {
          ctrl.ligacoes = null;
          ctrl._ligBuilt = false;
          ctrl._routeBuilt = false;
          paint();
        });
      container.querySelectorAll("[data-ltp-lg-go]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const [i, j] = btn.getAttribute("data-ltp-lg-go").split(":").map(Number);
          const alvo = ((ctrl.ligacoes.alvos || [])[i] || [])[j];
          if (!alvo) return;
          // Abrir a paragem no mapa fecha este painel: quem manda passa a ser
          // a sheet do outro operador.
          if (window.MapaStation && window.MapaStation.isOpen())
            window.MapaStation.close({ silent: true });
          setTimeout(() => alvo.run(), 140);
        });
      });
      bindLigacaoLogos(container);
      scrollAoTopo(container);
    }

    // Sequência desejada (lista única ordenada por hora, conforme filtro).
    // Um comboio passa o filtro se:
    //   Lisboa   → vai para norte
    //   Coina    → vai para sul (Coina, Setúbal ou retorno curto)
    //   Coina²   → termina mesmo em Coina
    //   Setúbal  → termina em Setúbal ou para lá dele
    function matchesDest(d) {
      if (!ctrl.dest) return true;
      const g = destGroup(d);
      if (ctrl.dest === "lisboa") return g === "lisboa";
      if (ctrl.dest === "setubal") return g === "setubal";
      // coina
      return ctrl.destStrict ? g === "coina" : g !== "lisboa";
    }

    function desiredDeps() {
      const m = ctrl.model;
      if (!m) return [];
      let out = m.items.filter(matchesDest);
      // O filtro de hora é aplicado ANTES do corte, senão as 40 primeiras do
      // dia podiam ser todas anteriores à hora pedida.
      if (ctrl.fromTs) out = out.filter((d) => d.ts >= ctrl.fromTs);
      return out.slice(0, MAX_LIST);
    }

    function buildShell() {
      container.innerHTML = `
        <div class="ltp-wrap">
          <div data-ltp-from></div>
          <div data-ltp-state></div>
          <div class="ltp-filter" role="group" aria-label="Filtrar por destino">
            ${ctrl.btns.map(
              (b) =>
                `<button class="ltp-dir" data-ltp-dir-btn="${b.id}" aria-pressed="false">
                   <span data-ltp-dir-label>${esc(b.label)}</span>
                 </button>`,
            ).join("")}
          </div>
          <div class="ltp-list" data-ltp-list></div>
          <div class="ltp-foot" data-ltp-foot></div>
        </div>`;

      // Cruz da barra "a partir de": volta a mostrar tudo.
      container.addEventListener("click", (e) => {
        if (!e.target.closest("[data-ltp-from-clear]")) return;
        ctrl.fromTs = null;
        updateFromBar();
        paint();
      });

      // Filtro — toggle + reconciliar (sem rebuild).
      container.querySelectorAll("[data-ltp-dir-btn]").forEach((b) => {
        b.addEventListener("click", () => {
          const d = b.dataset.ltpDirBtn;
          if (ctrl.dest !== d) {
            // Carregar num destino selecciona-o, não acumula com o anterior.
            ctrl.dest = d;
            ctrl.destStrict = false;
          } else if (d === "coina" && !ctrl.destStrict) {
            // Segundo toque seguido em Coina: só os que terminam lá.
            ctrl.destStrict = true;
          } else {
            // Terceiro toque (ou segundo nos outros): volta a mostrar tudo, para
            // haver sempre saída pelo mesmo botão.
            ctrl.dest = null;
            ctrl.destStrict = false;
          }
          paint();
        });
      });

      // Clique nos cartões — delegação (1 listener, sobrevive ao reconcile).
      const listEl = container.querySelector("[data-ltp-list]");
      listEl.addEventListener("click", (e) => {
        const card = e.target.closest("[data-ltp-train]");
        if (!card) return;
        e.preventDefault();
        const id = card.dataset.ltpTrain;
        const dep = (ctrl.model ? ctrl.model.items : []).find(
          (x) => String(x.id) === String(id),
        );
        handleClick(dep);
      });

      // Skeleton inicial
      let sk = "";
      for (let i = 0; i < 4; i++)
        sk += `<div class="ltp-skel ltp-skelrow" style="height:104px;margin-bottom:.6rem"></div>`;
      listEl.innerHTML = sk;
      ctrl._built = true;
    }

    // Barra "Partidas a partir das XX:XX". Só aparece se a hora ainda estiver
    // à frente: filtrar por uma hora já passada não esconde nada, e a barra
    // seria ruído.
    function updateFromBar() {
      const el = container.querySelector("[data-ltp-from]");
      if (!el) return;
      const activo = ctrl.fromTs && ctrl.fromTs > Date.now() + 60000;
      const html = activo
        ? `<div class="ltp-bar ltp-bar-from">
             ${SVG_CLOCK}
             <span>Partidas a partir das ${fmtHM(ctrl.fromTs)}</span>
             <button type="button" class="ltp-from-x" data-ltp-from-clear="1"
               aria-label="Mostrar todas as partidas" title="Mostrar todas">${SVG_X_SMALL}</button>
           </div>`
        : "";
      if (el.innerHTML !== html) el.innerHTML = html;
    }

    function updateState() {
      const stateEl = container.querySelector("[data-ltp-state]");
      if (!stateEl) return;
      const m = ctrl.model;
      let html = "";
      if (m && m.offline)
        html = `<div class="ltp-bar">${SVG_WIFI}<span>Sem ligação · Horário programado</span></div>`;
      else if (m && m.ipDown)
        html = `<div class="ltp-bar">${SVG_SERVER}<span>Informação em Tempo Real Indisponível - Visite o Mapa</span></div>`;
      if (stateEl.innerHTML !== html) stateEl.innerHTML = html;
    }
    function updateFilterPressed() {
      container.querySelectorAll("[data-ltp-dir-btn]").forEach((b) => {
        const id = b.dataset.ltpDirBtn;
        const escolhido = ctrl.dest === id;
        // O primeiro toque em Coina mostra tudo o que vai para sul, o que
        // inclui os comboios para Setúbal — por isso o Setúbal também aparece
        // aceso. Não é o destino escolhido, é um destino incluído: carregar
        // nele aperta para só Setúbal, em vez de desligar.
        const incluido =
          id === "setubal" && ctrl.dest === "coina" && !ctrl.destStrict;
        const on = escolhido || incluido;
        // O estado restrito tem de se ver: sem isto os dois níveis de Coina
        // eram indistinguíveis e o segundo toque parecia não fazer nada.
        const strict = escolhido && id === "coina" && ctrl.destStrict;
        const lbl = b.querySelector("[data-ltp-dir-label]");
        if (lbl) {
          const txt = strict ? "Só Coina" : DEST_BTNS.find((x) => x.id === id).label;
          if (lbl.textContent !== txt) lbl.textContent = txt;
        }
        b.classList.toggle("ltp-dir-strict", !!strict);
        b.classList.toggle("ltp-dir-incluido", !!incluido);
        const nome = DEST_BTNS.find((x) => x.id === id).label;
        b.setAttribute(
          "title",
          incluido
            ? "Incluído no sentido sul · toca para ver só Setúbal"
            : escolhido
              ? strict
                ? "A mostrar só os que terminam em Coina · toca para ver todos"
                : id === "coina"
                  ? "A mostrar tudo para sul · toca para ver só os que terminam em Coina"
                  : "A mostrar só " + nome + " · toca para ver todos"
              : "Ver só " + nome,
        );
        const v = on ? "true" : "false";
        if (b.getAttribute("aria-pressed") !== v)
          b.setAttribute("aria-pressed", v);
      });
    }

    function paintMaintenance() {
      const mode = ctrl.maintenanceMode;
      container.innerHTML = `
        <div class="ltp-wrap ltp-fade">
          <div class="ltp-maint">
            <div style="display:flex;align-items:center;gap:.7rem;margin-bottom:.9rem;color:#f97316">
              ${SVG_WRENCH}
              <h3 style="font-size:.95rem;font-weight:700;color:inherit">${esc(mode.titulo || "Manutenção")}</h3>
            </div>
            <div style="font-size:11px;line-height:1.6;color:rgb(113,113,122)">${mode.texto || "Serviço temporariamente em manutenção."}</div>
          </div>
        </div>`;
      ctrl._built = false; // próximo paint normal reconstrói o shell
      ctrl._maintBuilt = true;
    }

    function paint() {
      if (ctrl._destroyed) return;
      if (ctrl.ligacoes) {
        if (!ctrl._ligBuilt) paintLigacoes();
        return;
      }
      if (ctrl.routeHtml) {
        if (!ctrl._routeBuilt) paintRoute();
        return;
      }
      if (ctrl.maintenanceMode) {
        if (!ctrl._maintBuilt) paintMaintenance();
        return;
      }
      ctrl._maintBuilt = false;
      if (!ctrl._built) buildShell();

      updateFromBar();
      updateState();
      updateFilterPressed();

      const noNet = !!(ctrl.model && (ctrl.model.offline || ctrl.model.ipDown));
      const deps = desiredDeps();
      const listEl = container.querySelector("[data-ltp-list]");
      if (listEl) reconcileList(listEl, deps, noNet);

      const footEl = container.querySelector("[data-ltp-foot]");
      if (footEl) {
        const txt = deps.length
          ? `${deps.length} ${deps.length === 1 ? "partida" : "partidas"}`
          : "";
        if (footEl.textContent !== txt) footEl.textContent = txt;
      }

      // Lista vazia por causa do filtro é diferente de não haver serviço: a
      // pessoa tem de perceber que o botão para ver tudo está ali em cima.
      if (!deps.length && ctrl.fromTs && listEl) {
        const total = (ctrl.model ? ctrl.model.items : []).filter(
          matchesDest,
        ).length;
        listEl.innerHTML = `<div class="ltp-empty">
          <p class="ltp-empty-t">Sem partidas depois das ${esc(fmtHM(ctrl.fromTs))}</p>
          <p class="ltp-empty-s">${
            total
              ? "Há partidas mais cedo. Fecha o aviso em cima para as ver."
              : "Não há mais partidas hoje a partir desta estação."
          }</p></div>`;
      }
    }

    async function refresh(showSkeleton) {
      if (ctrl._destroyed) return;
      if (showSkeleton && !ctrl._built && !ctrl.maintenanceMode) buildShell();
      // Manutenção tem prioridade (se a deteção estiver ativa).
      if (opts.detectMaintenance) {
        const mode = await fetchMaintenance();
        if (ctrl._destroyed) return;
        ctrl.maintenanceMode = mode || null;
        if (mode) {
          paint();
          return;
        }
      }
      const model = await fetchStationModel(station);
      if (ctrl._destroyed) return;
      ctrl.model = model;
      paint();
    }

    function destroy() {
      ctrl._destroyed = true;
      if (ctrl._timer) clearInterval(ctrl._timer);
      ctrl._timer = null;
    }

    // Auto-refresh opcional (página). O mapa controla via ctrl.refresh().
    const autoMs = opts.autoRefresh == null ? 30000 : opts.autoRefresh;
    // O directionFilter antigo pode pedir "sul", que nas estações a sul de
    // Coina não tem botão: aí o equivalente é Setúbal.
    ctrl.dest = initialDest(opts.directionFilter);
    if (ctrl.dest && !ctrl.btns.some((b) => b.id === ctrl.dest))
      ctrl.dest = ctrl.dest === "coina" ? "setubal" : null;

    if (autoMs > 0) {
      ctrl._timer = setInterval(() => {
        if (document.hidden) return;
        // Com o percurso aberto, actualizar em silêncio: um repaint da lista
        // por cima dele tirava a pessoa de onde estava.
        if (ctrl.routeHtml || ctrl.ligacoes) return;
        refresh(false);
      }, autoMs);
    }

    loadLigacoes(); // em paralelo: só é preciso ao abrir um percurso
    buildShell();
    refresh(false);

    ctrl.refresh = refresh;
    ctrl.backToList = backToList;
    ctrl.destroy = destroy;
    ctrl.paint = paint;
    ctrl.el = container;
    // Permite acender ou apagar o filtro sem voltar a montar o painel.
    ctrl.setFromTime = function (ts) {
      ctrl.fromTs =
        typeof ts === "number" && isFinite(ts)
          ? ts + TRANSFER_MARGIN_MIN * 60000
          : null;
      if (ctrl._built) {
        updateFromBar();
        paint();
      }
    };
    return ctrl;
  }

  // ═══ API PÚBLICA ════════════════════════════════════════════════════════════
  window.Partidas = {
    mount,
    STATIONS,
    resolveStationByApiId,
    resolveStationByApiName,
    resolveStationByName,
    listStations,
    closeSheet,
    // utilitários expostos para testes/integração
    _fetchStationModel: fetchStationModel,
    _buildOfflineForStation: buildOfflineForStation,
    _depFromEndpoint: depFromEndpoint,
    _parseTimeHHMMSS: parseTimeHHMMSS,
    _ensureStatic: ensureStatic,
  };
})();

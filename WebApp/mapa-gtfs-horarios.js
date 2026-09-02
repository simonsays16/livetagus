/**
 * mapa-gtfs-horarios.js · LiveTagus (mapa)
 * Painel UNIFICADO de próximas partidas para operadores servidos por bundles
 * gtfs-departures: Metro de Lisboa e Metro Transportes do Sul (MTS).
 *
 * Substitui o mapa-mts-horarios.js (que lia o /json/mts-horarios.json feito à
 * mão). Toda a informação passa a vir do bundle — nada é hardcoded por
 * operador além do slug da agência:
 *
 *   /resources/data/gtfs/<slug>-gtfs-departures/
 *     manifest.json          → nome da agência, mapa de recursos, data do feed
 *     routes.json            → cor/nome das linhas (pills)
 *     calendar.json          → dias em que cada service_id circula
 *     stops/index.json       → estações servidas, coordenadas, ficheiro do shard
 *     stops/<id>.json        → partidas dessa paragem (o "board")
 *     patterns/index.json    → variantes de percurso
 *     patterns/<id>.json     → sequência de paragens + horários de cada viagem
 *
 * O nome da agência (manifest) resolve o logótipo; a pasta do bundle é
 * slugify(nome) + "-gtfs-departures", tal como o gtfs-departures a escreve.
 * As shapes do GTFS são IGNORADAS de propósito — a geometria no mapa vem dos
 * /geojson próprios (metro-shape / mts-shape).
 *
 * Vistas (pilha de navegação dentro da MESMA sheet, com botão "voltar"):
 *   estação  → próximas partidas   → clicar numa partida abre a viagem
 *   viagem   → percurso completo   → clicar numa paragem abre ESSA estação
 *
 * A estação em foco recebe a bola verde partilhada (window.MapaSelecao).
 *
 * API:
 *   window.GtfsHorarios.open(station, { operator })  station de geojson (ML/MTS)
 *   window.GtfsHorarios.openStop(op, stopId)         directo por stop_id
 *   window.GtfsHorarios.close() | isOpen() | refresh()
 *   window.GtfsHorarios.audit(op, geojsonUrl)        verifica nomes vs bundle
 *   window.MtsHorarios / window.MlHorarios           aliases retrocompatíveis
 */

(function () {
  "use strict";

  // ═══════════════════════════════════════════════════════════════════
  //  CONFIGURAÇÃO
  // ═══════════════════════════════════════════════════════════════════

  const BUNDLE_BASE = "/resources/data/gtfs";
  const LOGO_DIR = "/imagens/lig-logos";
  const SHOW = 14; // nº de partidas listadas
  const TICK_MS = 30000; // recálculo dos contadores

  // Só o slug da agência é preciso: a pasta é slug + "-gtfs-departures".
  const OPERATORS = {
    mts: { slug: "metro-transportes-do-sul", label: "Metro Sul do Tejo" },
    ml: { slug: "metropolitano-de-lisboa-e-p-e", label: "Metro de Lisboa" },
    cp: { slug: "cp-comboios-de-portugal", label: "CP" },
  };

  // Nome da agência → ficheiro do logótipo. A chave é o slug do nome que vem
  // no manifest, por isso um operador novo só precisa de uma linha aqui.
  const LOGO_ALIASES = {
    "metro-transportes-do-sul": "mts.svg",
    "metropolitano-de-lisboa-e-p-e": "metro.svg",
    "cp-comboios-de-portugal": "cp.svg",
    fertagus: "fertagus.png",
  };

  // ── LIGAÇÕES À FERTAGUS ────────────────────────────────────────────────────
  // O /json/ligacoes_atualizado.json é indexado pelo id de estação da IP/CP,
  // que é exactamente o que a CP usa nos seus stop_id — por isso a CP casa por
  // id. O Metro e o MTS não têm esse id, e casam por nome: os nomes das suas
  // estações não são iguais aos da Fertagus (Jardim Zoológico é Sete Rios, e
  // Roma e Areeiro são duas estações de metro para uma só da Fertagus).
  const LIGACOES_JSON = "/json/ligacoes_atualizado.json";
  const FERTAGUS_LOGO = "/imagens/lig-logos/fertagus.png";
  const LINK_BY_NAME = {
    mts: {
      pragal: "9417087",
      corroios: "9417137",
    },
    ml: {
      "jardim zoologico": "9466076", // Sete Rios
      "entre campos": "9466050", // Entrecampos
      roma: "9466035", // Roma-Areeiro
      areeiro: "9466035",
    },
  };

  // Estações onde o código no feed da CP não é o mesmo que o código da IP
  // usado no ligacoes.json. São a mesma estação, com dois números diferentes.
  // Chave: código do feed da CP (só dígitos). Valor: chave no ligacoes.json.
  const CP_ID_ALIASES = {
    9460004: "9467033", // Campolide  (CP 94_60004 · IP 9467033)
    9468080: "9468098", // Palmela    (CP 94_68080 · IP 9468098)
  };

  // Código de 7 dígitos de uma paragem da CP, já com as equivalências
  // aplicadas. As paragens de plataforma trazem sufixo ("94_60004_1"), por
  // isso ficam só os primeiros 7 dígitos.
  function cpIpId(stopId) {
    const digits = String(stopId == null ? "" : stopId).replace(/\D/g, "");
    if (digits.length < 7) return null;
    const id = digits.slice(0, 7);
    return CP_ID_ALIASES[id] || id;
  }

  // Tempo real da CP: https://www.cp.pt/pt/pesquisa-estacao-detalhe/94-66035
  // O 94-66035 é o stop_id 9466035 partido a seguir aos dois primeiros dígitos.
  const CP_REALTIME_BASE = "https://www.cp.pt/pt/pesquisa-estacao-detalhe/";
  const CP_ID_LEN = 7; // código nacional: 94 + 5 dígitos
  function cpRealtimeUrl(stopId) {
    // As paragens de plataforma trazem sufixo ("9466050_1"). Limpar os
    // não-dígitos transformava o sufixo em dígito e dava 94-660501; ficam só
    // os 7 primeiros, que são o código da estação.
    const digits = String(stopId == null ? "" : stopId).replace(/\D/g, "");
    if (digits.length < CP_ID_LEN) return null;
    const id = digits.slice(0, CP_ID_LEN);
    return CP_REALTIME_BASE + id.slice(0, 2) + "-" + id.slice(2);
  }

  // Estações cujo nome no geojson não bate com o stop_name do GTFS.
  // Usa GtfsHorarios.audit(op, urlDoGeojson) para descobrir as que faltam.
  const STATION_ALIASES = {
    ml: {},
    mts: {},
    cp: {}, // o CP abre por stop_id directo, por isso não precisa de aliases
  };

  // ═══════════════════════════════════════════════════════════════════
  //  UTILITÁRIOS
  // ═══════════════════════════════════════════════════════════════════

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Mesmas regras do slugify() do gtfs-departures, para o nome da agência
  // resolver a pasta do bundle e o logótipo.
  function slugify(name) {
    const base = String(name == null ? "" : name).trim();
    if (!base) return "gtfs";
    const slug = base
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug || "gtfs";
  }

  // Normalização para comparar nomes de estação (acentos, pontuação, "/").
  function norm(s) {
    return String(s == null ? "" : s)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  // "25:30:00" → 91800. Aceita "H:MM:SS" (o GTFS permite) e nunca corta às 24h.
  function timeToSec(t) {
    if (t == null) return null;
    const m = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(String(t).trim());
    if (!m) return null;
    return +m[1] * 3600 + +m[2] * 60 + (m[3] ? +m[3] : 0);
  }

  function secToClock(sec) {
    const s = ((sec % 86400) + 86400) % 86400;
    return (
      String(Math.floor(s / 3600)).padStart(2, "0") +
      ":" +
      String(Math.floor((s % 3600) / 60)).padStart(2, "0")
    );
  }

  // Contagem decrescente só na próxima hora. A partir daí a hora da partida diz
  // mais do que "3h20" — é o que o Google Maps faz, e é o que uma pessoa quer
  // saber quando o comboio ainda está longe.
  const ETA_LIMIT_SEC = 3600;

  function fmtEta(sec, at) {
    const min = Math.floor(sec / 60);
    if (min <= 0) return { big: "agora", small: "", isClock: false };
    if (sec < ETA_LIMIT_SEC) return { big: String(min), small: "min", isClock: false };
    return { big: secToClock(at), small: "", isClock: true };
  }

  // Agora em Europe/Lisbon → { ymd:"YYYYMMDD", dow:0-6 (0=Dom), sec }
  function lisbonNow() {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Lisbon",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hour12: false,
    });
    const p = {};
    for (const part of fmt.formatToParts(new Date())) p[part.type] = part.value;
    const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    let hh = parseInt(p.hour, 10);
    if (hh === 24) hh = 0; // en-GB devolve 24 à meia-noite
    return {
      ymd: p.year + p.month + p.day,
      dow: dowMap[p.weekday],
      sec: hh * 3600 + parseInt(p.minute, 10) * 60 + parseInt(p.second, 10),
    };
  }

  function ymdShift(ymd, days) {
    const d = new Date(
      Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)),
    );
    d.setUTCDate(d.getUTCDate() + days);
    const z = (v) => String(v).padStart(2, "0");
    return (
      "" + d.getUTCFullYear() + z(d.getUTCMonth() + 1) + z(d.getUTCDate())
    );
  }

  function fmtFeedDate(iso) {
    if (!iso) return "";
    const d = String(iso).slice(0, 10).split("-");
    return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : "";
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CLIENTE DOS BUNDLES  (carregamento lazy + cache por operador)
  // ═══════════════════════════════════════════════════════════════════

  const bundles = new Map(); // op -> bundle
  const pending = new Map(); // op -> Promise
  let ligacoes = null; // { <idIP>: { name, ligacoes } }
  let ligacoesPromise = null;

  function loadLigacoes() {
    if (ligacoes) return Promise.resolve(ligacoes);
    if (ligacoesPromise) return ligacoesPromise;
    ligacoesPromise = getJSON(LIGACOES_JSON)
      .then((data) => {
        ligacoes = data || {};
        return ligacoes;
      })
      .catch((e) => {
        console.warn("[GtfsHorarios] ligações indisponíveis:", e && e.message);
        ligacoes = {};
        return ligacoes;
      });
    return ligacoesPromise;
  }

  // Estações que a Fertagus e a CP partilham: as chaves do ligacoes.json são
  // ids da IP/CP, por isso basta cruzá-las com as estações da CP QUE ESTÃO
  // DESENHADAS no mapa. Assim o símbolo da CP só aparece onde a CP realmente
  // pára e está visível, em vez de em todas as 14 estações da Fertagus.
  // → Map(nomeFertagusNormalizado → { stopId, name, fertagus })
  let sharedPromise = null;
  function sharedFertagusCp() {
    return loadLigacoes().then(() => {
      const out = new Map();
      const stations =
        window.MapaCP && typeof window.MapaCP.getStations === "function"
          ? window.MapaCP.getStations()
          : [];
      const byId = new Map();
      for (const st of stations) {
        const id = cpIpId(st.stop_id);
        if (id) byId.set(id, st);
      }
      for (const id in ligacoes) {
        const hit = byId.get(id);
        if (!hit) continue;
        const nome = ligacoes[id].name || "";
        out.set(norm(nome), { stopId: hit.stop_id, name: hit.name, fertagus: nome });
      }
      // Preenche sempre a cache: o cpStationFor() é síncrono e é chamado pelo
      // mapa-station.js ao abrir a sheet da Fertagus. Antes só era preenchida
      // dentro do loadBundle(), portanto quem clicasse numa estação da Fertagus
      // sem nunca ter aberto um painel do Metro ou da CP não via o botão.
      sharedCache = out;
      return out;
    });
  }

  // Versão síncrona, para quem já tem os dados carregados.
  let sharedCache = null;
  function cpStationFor(fertagusName) {
    if (!sharedCache) return null;
    return sharedCache.get(norm(fertagusName)) || null;
  }

  // Devolve o nome da estação Fertagus que serve esta paragem, ou null.
  function fertagusLinkFor(op, stopId, stopName) {
    if (!ligacoes) return null;
    let key = null;
    if (op === "cp") {
      key = cpIpId(stopId);
      if (key && !ligacoes[key]) key = null;
    } else {
      const table = LINK_BY_NAME[op];
      if (table) key = table[norm(stopName)] || null;
    }
    if (!key || !ligacoes[key]) return null;
    return ligacoes[key].name || null;
  }

  function getJSON(url) {
    return fetch(url, { credentials: "same-origin" }).then((r) => {
      if (!r.ok) throw new Error(`${r.status} em ${url}`);
      return r.json();
    });
  }

  function logoFor(agencyName) {
    const slug = slugify(agencyName);
    if (LOGO_ALIASES[slug]) return `${LOGO_DIR}/${LOGO_ALIASES[slug]}`;
    if (slug.indexOf("sul") !== -1 && slug.indexOf("metro") !== -1)
      return `${LOGO_DIR}/mts.svg`;
    if (slug.indexOf("metropolitano") !== -1 || slug.indexOf("metro-de-lisboa") !== -1)
      return `${LOGO_DIR}/metro.svg`;
    return `${LOGO_DIR}/${slug}.svg`; // palpite; o onerror esconde se não existir
  }

  function loadBundle(op) {
    if (bundles.has(op)) return Promise.resolve(bundles.get(op));
    if (pending.has(op)) return pending.get(op);

    const cfg = OPERATORS[op];
    if (!cfg) return Promise.reject(new Error(`Operador desconhecido: ${op}`));
    const base = `${BUNDLE_BASE}/${cfg.slug}-gtfs-departures`;

    // As ligações são carregadas em paralelo com o bundle: são precisas logo
    // que se abra uma viagem.
    loadLigacoes();
    sharedFertagusCp();

    const p = getJSON(`${base}/manifest.json`)
      .then((manifest) => {
        const res = manifest.resources || {};
        return Promise.all([
          getJSON(`${base}/${res.stops_index || "stops/index.json"}`),
          getJSON(`${base}/${res.calendar || "calendar.json"}`).catch(() => ({})),
          getJSON(`${base}/${res.routes || "routes.json"}`).catch(() => []),
        ]).then(([stops, calendar, routes]) => {
          const agencyName =
            (manifest.agencies && manifest.agencies[0]
              ? manifest.agencies[0].agency_name
              : null) || cfg.label;

          const bundle = {
            op,
            base,
            manifest,
            resources: res,
            agencyName,
            logo: logoFor(agencyName),
            feedDate: fmtFeedDate(manifest.source && manifest.source.downloaded_at),
            stops,
            calendar: calendar || {},
            routes: new Map((routes || []).map((r) => [r.route_id, r])),
            byId: new Map(),
            byName: new Map(),
            byParent: new Map(),
            boards: new Map(), // file -> departures[]
            patternsIndex: null,
            patterns: new Map(), // file -> record
          };

          for (const key in stops) {
            const e = stops[key];
            bundle.byId.set(e.stop_id, e);
            const n = norm(e.stop_name);
            if (!bundle.byName.has(n)) bundle.byName.set(n, []);
            bundle.byName.get(n).push(e);
            if (e.parent_station) {
              if (!bundle.byParent.has(e.parent_station))
                bundle.byParent.set(e.parent_station, []);
              bundle.byParent.get(e.parent_station).push(e);
            }
          }

          bundles.set(op, bundle);
          pending.delete(op);
          return bundle;
        });
      })
      .catch((err) => {
        pending.delete(op);
        console.error(`[GtfsHorarios] Bundle "${op}" indisponível:`, err.message);
        throw err;
      });

    pending.set(op, p);
    return p;
  }

  function loadBoard(bundle, entry) {
    if (bundle.boards.has(entry.file))
      return Promise.resolve(bundle.boards.get(entry.file));
    return getJSON(`${bundle.base}/${entry.file}`).then((board) => {
      bundle.boards.set(entry.file, board);
      return board;
    });
  }

  function loadPatternsIndex(bundle) {
    if (bundle.patternsIndex) return Promise.resolve(bundle.patternsIndex);
    const path = bundle.resources.patterns_index || "patterns/index.json";
    return getJSON(`${bundle.base}/${path}`).then((idx) => {
      bundle.patternsIndex = idx;
      return idx;
    });
  }

  function loadPattern(bundle, patternId) {
    return loadPatternsIndex(bundle).then((idx) => {
      const meta = idx[patternId];
      if (!meta) throw new Error(`pattern ${patternId} não existe no índice`);
      if (bundle.patterns.has(meta.file))
        return { meta, record: bundle.patterns.get(meta.file) };
      return getJSON(`${bundle.base}/${meta.file}`).then((record) => {
        bundle.patterns.set(meta.file, record);
        return { meta, record };
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  RESOLUÇÃO ESTAÇÃO (geojson) → PARAGENS (GTFS)
  // ═══════════════════════════════════════════════════════════════════

  // Os ids dos geojson (MTS "1", Metro "RB") não são stop_ids do GTFS, por isso
  // a ligação faz-se pelo NOME, e uma estação pode corresponder a várias
  // paragens (uma por plataforma/sentido, agrupadas por parent_station).
  function resolveStops(bundle, station) {
    const seeds = findSeeds(bundle, station);
    if (!seeds.length) return { entries: [], primary: null };

    const seed = seeds[0];
    let entries;
    if (seed.parent_station && bundle.byParent.has(seed.parent_station)) {
      entries = bundle.byParent.get(seed.parent_station);
    } else {
      entries = bundle.byName.get(norm(seed.stop_name)) || seeds;
    }
    return { entries: entries.slice(), primary: seed };
  }

  function findSeeds(bundle, station) {
    // 1. stop_id directo (quando o geojson já traz o id do GTFS)
    if (station.stopId && bundle.byId.has(station.stopId))
      return [bundle.byId.get(station.stopId)];
    if (station.id && bundle.byId.has(String(station.id)))
      return [bundle.byId.get(String(station.id))];

    const alias = (STATION_ALIASES[bundle.op] || {})[norm(station.name)];
    const candidates = [];
    if (alias) candidates.push(norm(alias));
    candidates.push(norm(station.name));

    // 2. variantes: "Colégio Militar/Luz" → "colegio militar luz" | "colegio militar"
    const raw = String(station.name || "");
    if (raw.indexOf("/") !== -1) {
      candidates.push(norm(raw.split("/")[0]));
      candidates.push(norm(raw.replace(/\//g, " ")));
    }
    if (raw.indexOf("(") !== -1) candidates.push(norm(raw.replace(/\(.*?\)/g, "")));

    for (const c of candidates) {
      if (c && bundle.byName.has(c)) return bundle.byName.get(c);
    }

    // 3. último recurso: prefixo (cobre "Alameda" vs "Alameda - Plataforma 1")
    const target = norm(station.name);
    if (target) {
      const hits = [];
      for (const [n, list] of bundle.byName) {
        if (n === target || n.indexOf(target + " ") === 0 || target.indexOf(n + " ") === 0)
          hits.push(...list);
      }
      if (hits.length) return hits;
    }
    return [];
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CALENDÁRIO
  // ═══════════════════════════════════════════════════════════════════

  const DAYS = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  // Este service_id circula neste dia? Ordem: excepções primeiro (é o que o
  // calendar_dates.txt significa), depois a validade, depois o flag semanal.
  function serviceRunsOn(bundle, serviceId, ymd, dow) {
    const svc = bundle.calendar[serviceId];
    if (!svc) return true; // service_id desconhecido: mostrar em vez de esconder
    if (svc.removed_dates && svc.removed_dates.indexOf(ymd) !== -1) return false;
    if (svc.added_dates && svc.added_dates.indexOf(ymd) !== -1) return true;

    const hasWeekly = DAYS.some((d) => svc[d] != null);
    if (!hasWeekly) return false; // feed só com calendar_dates: sem excepção, não corre

    if (svc.start_date && ymd < svc.start_date) return false;
    if (svc.end_date && ymd > svc.end_date) return false;
    return Number(svc[DAYS[dow]]) === 1;
  }

  const DAY_ABBR = {
    monday: "Seg",
    tuesday: "Ter",
    wednesday: "Qua",
    thursday: "Qui",
    friday: "Sex",
    saturday: "Sáb",
    sunday: "Dom",
  };

  function serviceLabel(bundle, serviceId) {
    const svc = bundle.calendar[serviceId];
    if (!svc) return "";
    const order = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];
    const on = order.filter((d) => Number(svc[d]) === 1);
    if (!on.length)
      return svc.added_dates && svc.added_dates.length ? "Datas específicas" : "";
    if (on.length === 7) return "Todos os dias";
    if (on.join() === "monday,tuesday,wednesday,thursday,friday")
      return "Dias úteis";
    if (on.join() === "saturday,sunday") return "Fim de semana";
    return on.map((d) => DAY_ABBR[d]).join(" · ");
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PRÓXIMAS PARTIDAS
  // ═══════════════════════════════════════════════════════════════════

  // Junta os boards de todas as paragens da estação. Um horário >= 24:00:00
  // pertence ao dia de serviço anterior, por isso o dia de ontem é considerado
  // também — é o que faz as partidas da madrugada aparecerem às 00:30.
  // allowRoutes: Set de route_id, ou null para todas. O filtro tem de ser
  // aplicado ANTES do limite — filtrar depois de cortar às 14 podia devolver
  // zero partidas de uma linha que afinal tem muitas.
  function collectUpcoming(bundle, entries, limit, allowRoutes) {
    const now = lisbonNow();
    const yYmd = ymdShift(now.ymd, -1);
    const yDow = (now.dow + 6) % 7;
    const out = [];

    for (const entry of entries) {
      const board = bundle.boards.get(entry.file);
      if (!board) continue;
      for (const dep of board) {
        if (allowRoutes && !allowRoutes.has(dep.route_id)) continue;
        const sec = timeToSec(dep.departure_time);
        if (sec == null) continue;

        if (sec >= now.sec && serviceRunsOn(bundle, dep.service_id, now.ymd, now.dow)) {
          out.push(makeDep(dep, entry, sec, now.sec, now.ymd));
        }
        if (sec >= 86400) {
          const off = sec - 86400; // madrugada de hoje, serviço de ontem
          if (off >= now.sec && serviceRunsOn(bundle, dep.service_id, yYmd, yDow)) {
            out.push(makeDep(dep, entry, off, now.sec, yYmd));
          }
        }
      }
    }

    out.sort((a, b) => a.at - b.at);

    // O mesmo trip_id repete-se em feeds com frequencies.txt, por isso a chave
    // inclui a hora e a paragem.
    const seen = new Set();
    const list = [];
    for (const d of out) {
      const k = `${d.stopId}|${d.trip_id}|${d.at}`;
      if (seen.has(k)) continue;
      seen.add(k);
      list.push(d);
      if (list.length >= limit) break;
    }
    return list;
  }

  function makeDep(dep, entry, at, nowSec, serviceYmd) {
    return {
      trip_id: dep.trip_id,
      route_id: dep.route_id,
      route_short_name: dep.route_short_name,
      trip_headsign: dep.trip_headsign,
      direction_id: dep.direction_id,
      departure_time: dep.departure_time,
      stop_sequence: dep.stop_sequence,
      service_id: dep.service_id,
      pattern_id: dep.pattern_id,
      frequency_based: !!dep.frequency_based,
      exact_times: dep.exact_times,
      stopId: entry.stop_id,
      at, // segundos desde a meia-noite de HOJE
      eta: at - nowSec,
      serviceYmd,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  //  VIAGEM (pattern + deslocamento por frequência)
  // ═══════════════════════════════════════════════════════════════════

  // Num feed com frequencies.txt o pattern guarda os horários do TEMPLATE
  // (ex. 06:30), não os da partida expandida que o utilizador tocou. O desvio
  // entre os dois aplica-se a todas as paragens da viagem.
  function tripTimeline(record, dep) {
    const trip =
      record.trips.find((t) => t.trip_id === dep.trip_id) || record.trips[0];
    if (!trip) return null;

    const names = new Map(
      (record.stop_sequence || []).map((s) => [s.stop_id, s.stop_name]),
    );

    const boarding =
      trip.stop_times.find((st) => st.stop_sequence === dep.stop_sequence) ||
      trip.stop_times.find((st) => st.stop_id === dep.stopId) ||
      trip.stop_times[0];

    const templ = timeToSec(
      boarding ? boarding.departure_time || boarding.arrival_time : null,
    );
    const actual = timeToSec(dep.departure_time);
    const delta = templ != null && actual != null ? actual - templ : 0;

    const stops = trip.stop_times.map((st) => {
      const base = timeToSec(st.departure_time || st.arrival_time);
      return {
        stop_id: st.stop_id,
        stop_name: names.get(st.stop_id) || st.stop_id,
        stop_sequence: st.stop_sequence,
        at: base == null ? null : base + delta,
        isBoarding: !!boarding && st.stop_sequence === boarding.stop_sequence,
      };
    });

    return { trip, stops, delta, shifted: delta !== 0 };
  }

  // ═══════════════════════════════════════════════════════════════════
  //  ESTILOS  (o Tailwind do site é pré-compilado, por isso tudo o que é
  //  novo vive aqui em CSS próprio; as classes zinc reutilizadas já existem)
  // ═══════════════════════════════════════════════════════════════════

  // Botão de troca de operador. Fica num bloco à parte, com id próprio, porque
  // o mapa-station.js injecta exactamente o mesmo — quem chegar primeiro ganha
  // e o segundo não faz nada.
  function injectSwapStyles() {
    if (document.getElementById("lt-swap-styles")) return;
    const el = document.createElement("style");
    el.id = "lt-swap-styles";
    el.textContent = `
    .ltg-swap{position:absolute;right:3.5rem;top:.75rem;width:40px;height:40px;
      display:inline-flex;align-items:center;justify-content:center;padding:0;
      border-radius:9999px;border:1px solid rgba(0,0,0,.55);background:#fff;
      cursor:pointer;transition:transform .12s ease,box-shadow .16s ease;}
    html.dark .ltg-swap{border-color:rgba(255,255,255,.5);}
    .ltg-swap img{width:20px;height:20px;object-fit:contain;display:block;}
    .ltg-swap:hover{box-shadow:0 2px 10px rgba(0,0,0,.18);}
    .ltg-swap:active{transform:scale(.9);}
    .ltg-swap:focus-visible{outline:2px solid rgb(59 130 246);outline-offset:2px;}
    @media (min-width:768px){.ltg-swap{top:1.25rem;}}`;
    document.head.appendChild(el);
  }

  function injectStyles() {
    injectSwapStyles();
    if (document.getElementById("lt-gtfs-hor-styles")) return;
    const css = `
    .ltg-pill{display:inline-flex;align-items:center;justify-content:center;
      min-width:22px;height:22px;padding:0 6px;border-radius:6px;max-width:8.5rem;
      font-size:12px;font-weight:800;line-height:1;letter-spacing:.02em;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .ltg-row{display:flex;align-items:center;gap:0;padding:0 4px;width:100%;
      text-align:left;background:none;border:0;border-bottom:1px solid rgba(0,0,0,.06);
      font:inherit;color:inherit;cursor:pointer;
      transition:background-color .15s ease;}
    /* As linhas de partidas continuam a ser botões inteiros. */
    button.ltg-row{gap:14px;padding:13px 4px;}
    html.dark .ltg-row{border-bottom-color:rgba(255,255,255,.06);}
    .ltg-row:hover{background:rgba(0,0,0,.025);}
    html.dark .ltg-row:hover{background:rgba(255,255,255,.035);}
    .ltg-row:active{background:rgba(0,0,0,.05);}
    .ltg-row[disabled]{cursor:default;background:none;}
    .ltg-row:focus-visible{outline:2px solid rgb(59 130 246);outline-offset:-2px;}
    .ltg-eta{font-variant-numeric:tabular-nums;}
    /* Filtros de linha */
    .ltg-lines{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:12px;}
    .ltg-linebtn{padding:3px 8px;border-radius:4px;border:1px solid;font:inherit;
      font-size:10px;font-weight:800;letter-spacing:.08em;line-height:1.2;
      cursor:pointer;max-width:11rem;overflow:hidden;text-overflow:ellipsis;
      white-space:nowrap;transition:opacity .15s ease,background-color .15s ease;}
    .ltg-linebtn.is-dim{opacity:.35;}
    .ltg-linebtn:hover{opacity:1;}
    .ltg-linebtn:focus-visible,.ltg-linereset:focus-visible{
      outline:2px solid rgb(59 130 246);outline-offset:2px;}
    .ltg-linereset{padding:3px 6px;background:none;border:0;font:inherit;
      font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;
      color:rgb(161 161 170);cursor:pointer;}
    .ltg-linereset:hover{color:rgb(9 9 11);}
    .ltg-ext{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;
      border-radius:999px;border:1px solid rgba(0,0,0,.18);text-decoration:none;
      font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
      color:rgb(63 63 70);transition:border-color .15s ease,color .15s ease;}
    html.dark .ltg-ext{border-color:rgba(255,255,255,.2);color:rgb(212 212 216);}
    .ltg-ext:hover{border-color:rgba(0,0,0,.5);color:rgb(9 9 11);}
    html.dark .ltg-ext:hover{border-color:rgba(255,255,255,.5);color:#fff;}
    .ltg-ext-ic{width:11px;height:11px;flex-shrink:0;}
    html.dark .ltg-linereset:hover{color:#fff;}
    .ltg-chev{width:14px;height:14px;flex-shrink:0;opacity:.28;}
    .ltg-back{display:inline-flex;align-items:center;gap:6px;background:none;border:0;
      padding:0;margin:0 0 10px;font:inherit;cursor:pointer;color:rgb(113 113 122);
      font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;
      transition:color .15s ease;}
    .ltg-back:hover{color:rgb(9 9 11);}
    html.dark .ltg-back:hover{color:#fff;}
    .ltg-back svg{width:13px;height:13px;}
    /* Trilho da viagem: a sequência é a informação, por isso é desenhada. */
    .ltg-rail{position:relative;width:14px;flex-shrink:0;align-self:stretch;
      display:flex;align-items:center;justify-content:center;}
    /* Base cinzenta do trilho. As classes is-first/is-last são explícitas em
       vez de :first-child porque a lista pode ter uma nota antes das linhas —
       com :first-child o traço sobrava por cima do primeiro ponto. */
    .ltg-rail::before{content:"";position:absolute;top:0;bottom:0;width:2px;
      background:rgba(0,0,0,.1);}
    html.dark .ltg-rail::before{background:rgba(255,255,255,.12);}
    .ltg-rail.is-first::before{top:50%;}
    .ltg-rail.is-last::before{bottom:50%;}
    /* Sobreposição a cor da linha, do embarque até ao destino. */
    .ltg-rail.is-trip::after{content:"";position:absolute;top:0;bottom:0;
      width:2px;background:var(--ltg-line,rgba(0,0,0,.1));border-radius:2px;}
    .ltg-rail.is-from::after{top:50%;}
    .ltg-rail.is-last.is-trip::after{bottom:50%;}
    .ltg-dot{position:relative;z-index:1;width:7px;height:7px;border-radius:999px;
      background:rgb(212 212 216);}
    html.dark .ltg-dot{background:rgb(63 63 70);}
    .ltg-dot.is-on{background:var(--ltg-line,rgb(212 212 216));}
    .ltg-dot.is-end{width:9px;height:9px;box-shadow:0 0 0 2px #fff;}
    html.dark .ltg-dot.is-end{box-shadow:0 0 0 2px #09090b;}
    .ltg-dot-here{width:11px;height:11px;background:var(--ltg-line,rgb(212 212 216));
      box-shadow:0 0 0 3px rgba(255,255,255,1);}
    html.dark .ltg-dot-here{box-shadow:0 0 0 3px #09090b;}
    /* Linha da viagem: contentor + alvo de toque, para o botão de ligação
       poder ser um botão a sério ao lado. */
    .ltg-hit{display:flex;align-items:center;gap:14px;flex:1;min-width:0;
      padding:13px 4px;background:none;border:0;font:inherit;color:inherit;
      text-align:left;cursor:pointer;}
    .ltg-hit[disabled]{cursor:default;}
    .ltg-hit:focus-visible{outline:2px solid rgb(59 130 246);outline-offset:-2px;}
    /* Botão redondo com o logótipo do operador de ligação. */
    .ltg-link{flex-shrink:0;width:30px;height:30px;margin-left:6px;padding:0;
      display:inline-flex;align-items:center;justify-content:center;
      border-radius:999px;border:1px solid rgba(0,0,0,.55);background:#fff;
      cursor:pointer;transition:transform .12s ease,box-shadow .16s ease;}
    .ltg-link img{width:18px;height:18px;object-fit:contain;display:block;}
    .ltg-link:hover{box-shadow:0 2px 8px rgba(0,0,0,.16);}
    .ltg-link:active{transform:scale(.9);}
    .ltg-link:focus-visible{outline:2px solid rgb(59 130 246);outline-offset:2px;}
    .ltg-badge{display:inline-block;padding:2px 6px;border-radius:4px;
      font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
      background:rgba(0,0,0,.05);color:rgb(113 113 122);}
    html.dark .ltg-badge{background:rgba(255,255,255,.07);color:rgb(161 161 170);}
    .ltg-spin{width:18px;height:18px;border:2px solid rgba(0,0,0,.12);
      border-top-color:rgba(0,0,0,.45);border-radius:999px;margin:0 auto;
      animation:ltg-rot .7s linear infinite;}
    html.dark .ltg-spin{border-color:rgba(255,255,255,.16);border-top-color:rgba(255,255,255,.6);}
    @keyframes ltg-rot{to{transform:rotate(360deg);}}
    @media (prefers-reduced-motion: reduce){
      .ltg-spin{animation-duration:2s;}
      .ltg-row{transition:none;}
    }
    `;
    const el = document.createElement("style");
    el.id = "lt-gtfs-hor-styles";
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  ESTADO DA SHEET
  // ═══════════════════════════════════════════════════════════════════

  let panel, backdrop;
  let stack = []; // pilha de vistas; o topo é o que está no ecrã
  let tick = null;
  let dragActive = false,
    dragStartY = 0,
    dragLastY = 0,
    dragStartTs = 0;

  function ensureElements() {
    if (panel && backdrop) return;
    panel = document.getElementById("details-panel");
    backdrop = document.getElementById("details-backdrop");
    if (!panel || !backdrop)
      console.error("[GtfsHorarios] Elementos DOM ausentes");
  }

  function top() {
    return stack.length ? stack[stack.length - 1] : null;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  HTML
  // ═══════════════════════════════════════════════════════════════════

  const ICON_X =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="w-5 h-5"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const ICON_BACK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
  const ICON_CHEV =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="ltg-chev"><path d="m9 18 6-6-6-6"/></svg>';
  const ICON_EXT =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ltg-ext-ic"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
  const ICON_MOON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-8 h-8 mx-auto text-zinc-300 dark:text-zinc-700"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

  function routeStyle(bundle, routeId) {
    const r = bundle.routes.get(routeId) || {};
    const bg = r.route_color ? `#${r.route_color}` : "#18181b";
    const fg = r.route_text_color ? `#${r.route_text_color}` : "#ffffff";
    return { bg, fg, label: r.route_short_name || r.route_long_name || routeId };
  }

  // Um feed nacional tem muitas route_id com o MESMO nome de linha (a CP tem
  // dezenas de "Sintra", uma por relação origem-destino). Sem agrupar, uma
  // estação aparecia com a mesma pill repetida dezenas de vezes. A chave é o
  // nome normalizado; cada grupo guarda todas as route_id que lhe pertencem,
  // que é o que o filtro precisa.
  function activeLineOf(view) {
    if (!view || !view.activeLine || !view.lines) return null;
    return view.lines.find((l) => l.key === view.activeLine) || null;
  }

  function stationLines(bundle, entries) {
    const byLabel = new Map();
    for (const e of entries || []) {
      for (const rid of e.route_ids || []) {
        const st = routeStyle(bundle, rid);
        const key = norm(st.label);
        if (!key) continue;
        if (!byLabel.has(key))
          byLabel.set(key, { key, label: st.label, bg: st.bg, fg: st.fg, routeIds: [] });
        byLabel.get(key).routeIds.push(rid);
      }
    }
    // Ordem determinista: o índice não garante nenhuma.
    return Array.from(byLabel.values()).sort((a, b) =>
      a.label.localeCompare(b.label, "pt"),
    );
  }

  function pillHtml(bundle, routeId, labelOverride) {
    const s = routeStyle(bundle, routeId);
    const label = labelOverride || s.label;
    return `<span class="ltg-pill" style="background:${s.bg};color:${s.fg};">${escapeHtml(label)}</span>`;
  }

  function shellHtml(inner) {
    return `
      <div class="flex flex-col h-full bg-white dark:bg-[#09090b]">
        <div class="dp-handle md:hidden shrink-0" data-drag-area="1" aria-hidden="true">
          <div class="dp-handle-pill"></div>
        </div>
        ${inner}
      </div>`;
  }

  // Uma linha só → pill estática, como antes. Duas ou mais → filtros.
  function lineFilterHtml(view) {
    const lines = (view && view.lines) || [];
    if (lines.length < 2) return "";
    const active = view.activeLine;
    const chips = lines
      .map((l) => {
        const on = active === l.key;
        const dim = active && !on;
        const style = on
          ? `background:${l.bg};color:${l.fg};border-color:${l.bg}`
          : `background:transparent;color:${l.bg};border-color:${l.bg}`;
        return `<button type="button" class="ltg-linebtn${dim ? " is-dim" : ""}"
          data-ltg-line="${escapeHtml(l.key)}" aria-pressed="${on ? "true" : "false"}"
          title="${on ? "Mostrar todas" : "Ver só " + escapeHtml(l.label)}"
          style="${style}">${escapeHtml(l.label)}</button>`;
      })
      .join("");
    const reset = active
      ? `<button type="button" class="ltg-linereset" data-ltg-line-reset="1">Todas</button>`
      : "";
    // data-no-drag: sem isto, tocar num filtro no telemóvel começava a arrastar
    // a sheet, porque o cabeçalho inteiro é área de arrasto.
    return `<div class="ltg-lines" data-no-drag="1">${chips}${reset}</div>`;
  }

  function headerHtml(bundle, opts) {
    const back = opts.back
      ? `<button class="ltg-back" data-ltg-action="back">${ICON_BACK}<span>${escapeHtml(opts.back)}</span></button>`
      : "";
    const pills = (opts.pills || []).join("");
    return `
      <div class="dp-header relative shrink-0 px-6 pt-3 md:pt-safe-ios md:pt-5 pb-5 border-b border-zinc-100 dark:border-zinc-900" data-drag-area="1">
        ${opts.swap || ""}
        <button data-ltg-action="close"
          class="absolute right-4 top-3 md:top-5 w-10 h-10 flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
          aria-label="Fechar">${ICON_X}</button>

        <div class="flex items-center gap-2 mb-3">
          <img src="${escapeHtml(bundle.logo)}" alt="" class="w-5 h-5 object-contain" data-ltg-logo="1">
          <span class="text-[9px] font-bold tracking-[0.3em] uppercase text-zinc-500 dark:text-zinc-400">${escapeHtml(bundle.agencyName)}</span>
          <span class="h-px flex-1 max-w-16 bg-zinc-200 dark:bg-zinc-800"></span>
        </div>
        ${back}
        <div class="flex items-center gap-3">
          <h2 class="text-3xl font-light tracking-tighter text-zinc-900 dark:text-white leading-[1.05]">${escapeHtml(opts.title)}</h2>
          ${pills ? `<div class="flex items-center gap-1.5 shrink-0">${pills}</div>` : ""}
        </div>
        <p class="text-[11px] uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-500 mt-2">${escapeHtml(opts.subtitle)}</p>
        ${opts.filters || ""}
      </div>`;
  }

  // Os horários que mostramos para a CP são os programados. O tempo real está
  // no site da CP, e o id da estação no GTFS é o mesmo que o site usa.
  function realtimeHtml(bundle, view) {
    if (!bundle || bundle.op !== "cp" || !view.primary) return "";
    // O parent_station é o código da estação; o stop_id pode ser da plataforma.
    const url = cpRealtimeUrl(
      view.primary.parent_station || view.primary.stop_id,
    );
    if (!url) return "";
    return `<div class="ltg-lines" data-no-drag="1">
      <a class="ltg-ext" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
        Tempo real na CP ${ICON_EXT}</a></div>`;
  }

  function bodyHtml(inner, footnote) {
    return `
      <div class="flex-1 overflow-y-auto px-5 pt-3 pb-2" data-details-scroll="1">
        <div data-ltg-body="1">${inner}</div>
        <div class="px-1 py-6 text-center">
          <p class="text-[9px] leading-relaxed text-zinc-400 dark:text-zinc-600 tracking-wide max-w-xs mx-auto">${escapeHtml(footnote)}</p>
        </div>
      </div>`;
  }

  function loadingHtml(msg) {
    return `<div class="px-1 py-16 text-center">
      <div class="ltg-spin"></div>
      <p class="text-sm text-zinc-500 mt-4">${escapeHtml(msg)}</p>
    </div>`;
  }

  function messageHtml(title, detail) {
    return `<div class="px-1 py-16 text-center">
      ${ICON_MOON}
      <p class="text-sm text-zinc-500 mt-3">${escapeHtml(title)}</p>
      ${detail ? `<p class="text-[11px] text-zinc-400 mt-1">${escapeHtml(detail)}</p>` : ""}
    </div>`;
  }

  // ─── Lista de partidas ───────────────────────────────────────────────
  function depListHtml(bundle, view) {
    const active = activeLineOf(view);
    const deps = collectUpcoming(
      bundle,
      view.entries,
      SHOW,
      active ? new Set(active.routeIds) : null,
    );
    if (!deps.length) {
      return active
        ? messageHtml(
            `Sem partidas em ${active.label}.`,
            "Toca em Todas para ver as outras linhas.",
          )
        : messageHtml(
            "Sem partidas para já.",
            "O serviço retoma no próximo dia de circulação.",
          );
    }
    view.deps = deps; // guardado para o clique resolver o índice
    return deps
      .map((d, i) => {
        const eta = fmtEta(d.eta, d.at);
        const svc = serviceLabel(bundle, d.service_id);
        // Com a hora já em destaque, repeti-la na linha de baixo era ruído.
        const meta = [eta.isClock ? "" : secToClock(d.at), svc]
          .filter(Boolean)
          .join(" · ");
        return `
        <button class="ltg-row" data-ltg-action="trip" data-ltg-i="${i}" aria-label="Ver viagem de ${escapeHtml(d.trip_headsign || "")} às ${secToClock(d.at)}">
          ${pillHtml(bundle, d.route_id, d.route_short_name)}
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-zinc-900 dark:text-white truncate">${escapeHtml(d.trip_headsign || routeStyle(bundle, d.route_id).label)}</p>
            <p class="text-[11px] uppercase tracking-[0.15em] text-zinc-400 dark:text-zinc-500 mt-0.5">${escapeHtml(meta)}</p>
          </div>
          <div class="text-right shrink-0 ltg-eta">
            <span class="${eta.isClock ? "text-lg" : "text-xl"} font-light text-zinc-900 dark:text-white">${eta.big}</span>${eta.small ? `<span class="text-[10px] text-zinc-400 ml-0.5">${eta.small}</span>` : ""}
          </div>
          ${ICON_CHEV}
        </button>`;
      })
      .join("");
  }

  // ─── Percurso de uma viagem ──────────────────────────────────────────
  function tripListHtml(bundle, view) {
    const tl = view.timeline;
    if (!tl) return messageHtml("Percurso indisponível.", "");
    const colour = routeStyle(bundle, view.routeId).bg;
    // Do embarque até ao destino, o trilho fica da cor da linha: é a parte da
    // viagem que a pessoa vai mesmo fazer. O que fica acima do embarque
    // continua cinzento.
    const from = tl.stops.findIndex((x) => x.isBoarding);
    const last = tl.stops.length - 1;

    return (
      (tl.shifted
        ? `<p class="text-[10px] text-zinc-400 dark:text-zinc-600 mb-2">Horários calculados a partir da frequência publicada.</p>`
        : "") +
      tl.stops
        .map((s, i) => {
          const here = s.isBoarding;
          const onTrip = from >= 0 && i >= from;
          const rail = [
            "ltg-rail",
            i === 0 ? "is-first" : "",
            i === last ? "is-last" : "",
            onTrip ? "is-trip" : "",
            here ? "is-from" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const dot = [
            "ltg-dot",
            here ? "ltg-dot-here" : "",
            onTrip ? "is-on" : "",
            onTrip && i === last ? "is-end" : "",
          ]
            .filter(Boolean)
            .join(" ");

          // Botão redondo com o logótipo da Fertagus nas paragens que fazem
          // ligação. A linha é um <div>: um <button> dentro de outro é HTML
          // inválido e o clique deixava de funcionar.
          const fert = fertagusLinkFor(bundle.op, s.stop_id, s.stop_name);
          // A hora de chegada a ESTA paragem viaja com o botão: a sheet da
          // Fertagus abre a mostrar só o que se apanha a partir dela.
          const chegada = s.at == null ? "" : ` data-ltg-fertagus-at="${s.at}"`;
          const action = fert
            ? `<button type="button" class="ltg-link" data-ltg-fertagus="${escapeHtml(fert)}"${chegada}
                 title="Ligação à Fertagus: ${escapeHtml(fert)}${s.at == null ? "" : " · chegada às " + secToClock(s.at)}"
                 aria-label="Abrir a estação ${escapeHtml(fert)} da Fertagus">
                 <img src="${FERTAGUS_LOGO}" alt="" data-ltg-logo></button>`
            : here
              ? ""
              : ICON_CHEV;

          return `
        <div class="ltg-row" style="--ltg-line:${escapeHtml(colour)}">
          <button class="ltg-hit" data-ltg-action="stop" data-ltg-i="${i}"${here ? " disabled" : ""}>
            <span class="${rail}"><span class="${dot}"></span></span>
            <div class="flex-1 min-w-0">
              <p class="text-sm ${here ? "font-semibold" : "font-medium"} text-zinc-900 dark:text-white truncate">${escapeHtml(s.stop_name)}</p>
              ${here ? `<p class="text-[10px] uppercase tracking-[0.15em] text-zinc-400 mt-0.5">Aqui</p>` : ""}
            </div>
            <span class="text-sm ltg-eta ${here ? "text-zinc-900 dark:text-white font-medium" : "text-zinc-500 dark:text-zinc-400"}">${s.at == null ? "--:--" : secToClock(s.at)}</span>
          </button>
          ${action}
        </div>`;
        })
        .join("")
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════════

  function render() {
    const view = top();
    if (!view || !panel) return;
    const bundle = view.bundle;
    const hasBack = stack.length > 1;

    let header, body, footnote;

    if (view.kind === "stop") {
      const lines = view.lines || [];
      // Com duas ou mais linhas as pills descem para a fila de filtros; com uma
      // só fica ao lado do título, como sempre esteve.
      const pills =
        lines.length === 1
          ? [pillHtml(bundle, lines[0].routeIds[0], lines[0].label)]
          : [];
      const active = activeLineOf(view);
      // Estação partilhada com a Fertagus: botão ao lado da cruz para trocar
      // de operador sem fechar e voltar a abrir.
      const paraFertagus =
        view.primary &&
        fertagusLinkFor(bundle.op, view.primary.stop_id, view.name);
      header = headerHtml(bundle, {
        swap: paraFertagus
          ? `<button type="button" class="ltg-swap" data-ltg-swap="${escapeHtml(paraFertagus)}"
               title="Ver ${escapeHtml(paraFertagus)} na Fertagus"
               aria-label="Trocar para a estação ${escapeHtml(paraFertagus)} da Fertagus">
               <img src="${FERTAGUS_LOGO}" alt="" data-ltg-logo></button>`
          : "",
        title: view.name,
        subtitle: active
          ? `Próximas partidas · ${active.label}`
          : "Próximas partidas",
        pills,
        filters: lineFilterHtml(view) + realtimeHtml(bundle, view),
        back: hasBack ? "Voltar" : null,
      });
      body =
        view.state === "loading"
          ? loadingHtml("A carregar horário…")
          : view.state === "error"
            ? messageHtml("Horário indisponível.", view.error || "")
            : view.state === "unmatched"
              ? messageHtml(
                  "Esta estação não está no horário publicado.",
                  view.name,
                )
              : depListHtml(bundle, view);
      footnote = `Horário oficial ${bundle.agencyName}${bundle.feedDate ? ` · dados de ${bundle.feedDate}` : ""}. Os tempos são programados e podem variar do serviço real.`;
    } else {
      const svc = serviceLabel(bundle, view.dep.service_id);
      header = headerHtml(bundle, {
        title: view.dep.trip_headsign || routeStyle(bundle, view.routeId).label,
        subtitle: [
          "Viagem",
          secToClock(view.dep.at),
          svc,
          view.timeline ? `${view.timeline.stops.length} paragens` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        pills: [pillHtml(bundle, view.routeId, view.dep.route_short_name)],
        back: "Voltar",
      });
      body =
        view.state === "loading"
          ? loadingHtml("A carregar percurso…")
          : view.state === "error"
            ? messageHtml("Percurso indisponível.", view.error || "")
            : tripListHtml(bundle, view);
      footnote =
        "Toca numa paragem para ver as próximas partidas dessa estação.";
    }

    panel.innerHTML = shellHtml(header + bodyHtml(body, footnote));
    hookLogo();
    const sc = panel.querySelector('[data-details-scroll="1"]');
    if (sc) sc.scrollTop = view.scrollTop || 0;
    // O corpo é novo a cada render, mas o #details-panel e os antepassados dele
    // também rolam, e esses sobrevivem. Sem os repor, trocar de vista deixava a
    // pessoa a meio da lista anterior.
    if (!view.scrollTop) scrollAoTopo(panel);
  }

  // Qual é o elemento que faz scroll depende do sítio: o painel tem overflow
  // próprio, a sheet interior também, e na página é a janela. Sobe-se a árvore.
  function scrollAoTopo(el) {
    let n = el;
    let saltos = 0;
    while (n && n.nodeType === 1 && saltos < 12) {
      if (n.scrollTop > 0) n.scrollTop = 0;
      n = n.parentElement;
      saltos++;
    }
  }

  // Sem onerror inline (CSP): o handler é ligado aqui. São vários — o do
  // cabeçalho e o de cada botão de ligação à Fertagus.
  function hookLogo(root) {
    (root || panel).querySelectorAll("[data-ltg-logo]").forEach((img) => {
      img.addEventListener(
        "error",
        function () {
          this.style.display = "none";
          // Sem logótipo o botão ficaria um círculo vazio.
          const btn = this.closest(".ltg-link");
          if (btn) btn.remove();
        },
        { once: true },
      );
    });
  }

  // Só a lista é redesenhada no tick, para não perder o scroll.
  function renderList() {
    const view = top();
    if (!view || !panel || view.kind !== "stop" || view.state !== "ready") return;
    const host = panel.querySelector("[data-ltg-body]");
    if (host) host.innerHTML = depListHtml(view.bundle, view);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  NAVEGAÇÃO
  // ═══════════════════════════════════════════════════════════════════

  function rememberScroll() {
    const view = top();
    if (!view || !panel) return;
    const sc = panel.querySelector('[data-details-scroll="1"]');
    if (sc) view.scrollTop = sc.scrollTop;
  }

  function pushStopView(bundle, station, opts) {
    const resolved = resolveStops(bundle, station);
    const view = {
      kind: "stop",
      bundle,
      name:
        (resolved.primary && resolved.primary.stop_name) ||
        station.name ||
        "Estação",
      entries: resolved.entries,
      primary: resolved.primary,
      routeIds: [],
      lines: [],
      activeLine: null,
      state: resolved.entries.length ? "loading" : "unmatched",
      scrollTop: 0,
    };

    if (resolved.entries.length) {
      const ids = new Set();
      resolved.entries.forEach((e) =>
        (e.route_ids || []).forEach((r) => ids.add(r)),
      );
      view.routeIds = Array.from(ids);
      view.lines = stationLines(bundle, resolved.entries);
    } else {
      console.warn(
        `[GtfsHorarios] "${station.name}" não corresponde a nenhuma paragem do bundle "${bundle.op}". Corre GtfsHorarios.audit("${bundle.op}", "<geojson>") e acrescenta um alias.`,
      );
    }

    rememberScroll();
    if (opts && opts.replace) stack = [view];
    else stack.push(view);
    render();

    if (!resolved.entries.length) return Promise.resolve(view);

    // Bola verde na estação que está a ser vista (mapa-selecao.js).
    if (resolved.primary && resolved.primary.coordinates) {
      const c = resolved.primary.coordinates;
      if (window.MapaSelecao)
        window.MapaSelecao.set({
          lng: c[0],
          lat: c[1],
          op: bundle.op,
          // Três identificadores porque as camadas do mapa não usam todas o
          // mesmo: o CP tem stop_id, o geojson do Metro tem id_destino e o do
          // MTS tem id. O matchExpr compara todos contra todos.
          stopId: resolved.primary.stop_id,
          id: station.id != null ? station.id : resolved.primary.stop_id,
          name: station.name || resolved.primary.stop_name,
        });
      if (opts && opts.recenter && window.MapaRender && window.MapaRender.focusStation)
        window.MapaRender.focusStation({ lng: c[0], lat: c[1] });
    }

    return Promise.all(resolved.entries.map((e) => loadBoard(bundle, e)))
      .then(() => {
        view.state = "ready";
        if (top() === view) render();
        return view;
      })
      .catch((err) => {
        view.state = "error";
        view.error = err.message;
        if (top() === view) render();
      });
  }

  function pushTripView(dep) {
    const parent = top();
    if (!parent) return;
    const bundle = parent.bundle;
    if (!dep.pattern_id) {
      console.warn("[GtfsHorarios] partida sem pattern_id");
      return;
    }
    const view = {
      kind: "trip",
      bundle,
      dep,
      routeId: dep.route_id,
      timeline: null,
      state: "loading",
      scrollTop: 0,
    };
    rememberScroll();
    stack.push(view);
    render();

    loadPattern(bundle, dep.pattern_id)
      .then(({ record }) => {
        view.timeline = tripTimeline(record, dep);
        view.state = view.timeline ? "ready" : "error";
        if (top() === view) render();
      })
      .catch((err) => {
        view.state = "error";
        view.error = err.message;
        if (top() === view) render();
      });
  }

  function back() {
    if (stack.length <= 1) return close();
    stack.pop();
    // Também ao voltar: trocar de vista devolve sempre ao topo. A posição
    // guardada continua a servir os redesenhos no mesmo sítio — filtro de linha
    // e actualização dos minutos —, que não podem saltar.
    const v = top();
    if (v) v.scrollTop = 0;
    render();
  }

  // ═══════════════════════════════════════════════════════════════════
  //  EVENTOS
  // ═══════════════════════════════════════════════════════════════════

  function onPanelClick(e) {
    if (!e.target.closest) return;
    const view0 = top();

    // Filtros de linha primeiro: estão dentro do cabeçalho, que também tem o
    // botão de fechar.
    const lineBtn = e.target.closest("[data-ltg-line]");
    if (lineBtn && panel.contains(lineBtn) && view0) {
      const key = lineBtn.getAttribute("data-ltg-line");
      view0.activeLine = view0.activeLine === key ? null : key; // toca outra vez → todas
      rememberScroll();
      render();
      return;
    }
    if (e.target.closest("[data-ltg-line-reset]") && view0) {
      view0.activeLine = null;
      rememberScroll();
      render();
      return;
    }

    // Trocar para a Fertagus a partir do cabeçalho.
    const swapBtn = e.target.closest("[data-ltg-swap]");
    if (swapBtn && panel.contains(swapBtn)) {
      e.preventDefault();
      e.stopPropagation();
      openFertagus(swapBtn.getAttribute("data-ltg-swap"));
      return;
    }

    // Ligação à Fertagus: abre a sheet da estação correspondente.
    const fertBtn = e.target.closest("[data-ltg-fertagus]");
    if (fertBtn && panel.contains(fertBtn)) {
      e.preventDefault();
      e.stopPropagation();
      const at = parseInt(fertBtn.getAttribute("data-ltg-fertagus-at") || "", 10);
      openFertagus(fertBtn.getAttribute("data-ltg-fertagus"), at);
      return;
    }

    const btn = e.target.closest("[data-ltg-action]");
    if (!btn || !panel.contains(btn)) return;
    const action = btn.getAttribute("data-ltg-action");
    const view = top();

    if (action === "close") return close();
    if (action === "back") return back();
    if (!view) return;

    if (action === "trip" && view.kind === "stop" && view.deps) {
      const dep = view.deps[Number(btn.getAttribute("data-ltg-i"))];
      if (dep) pushTripView(dep);
      return;
    }
    if (action === "stop" && view.kind === "trip" && view.timeline) {
      const s = view.timeline.stops[Number(btn.getAttribute("data-ltg-i"))];
      if (!s) return;
      const entry = view.bundle.byId.get(s.stop_id);
      openStop(view.bundle.op, s.stop_id, {
        recenter: true,
        name: (entry && entry.stop_name) || s.stop_name,
      });
    }
  }

  // O nome vem do ligacoes_atualizado.json e pode não bater ao carácter com o
  // do MAPA.STATIONS ("Roma Areeiro" vs "Roma-Areeiro"), por isso compara-se
  // normalizado.
  // atSec: hora de chegada em segundos do dia de HOJE (a mesma escala do
  // lisbonNow().sec), ou NaN se não houver. Converte-se para epoch pela
  // diferença até agora, o que evita depender do fuso do dispositivo: os dois
  // valores estão na mesma escala, e a diferença é tempo real decorrido.
  function openFertagus(name, atSec) {
    const stations = (window.MAPA && window.MAPA.STATIONS) || [];
    const target = norm(name);
    const station =
      stations.find((st) => norm(st.name) === target) ||
      stations.find((st) => norm(st.apiName || "") === target) ||
      null;
    if (!station) {
      console.warn(`[GtfsHorarios] estação Fertagus "${name}" não encontrada.`);
      return;
    }
    let fromTime = null;
    if (typeof atSec === "number" && isFinite(atSec)) {
      const ts = Date.now() + (atSec - lisbonNow().sec) * 1000;
      // Uma chegada já passada não filtra nada; passar o valor só poria um
      // aviso inútil por cima da lista.
      if (ts > Date.now() + 60000) fromTime = ts;
    }
    close();
    setTimeout(() => {
      if (window.MapaStation) window.MapaStation.open(station, { fromTime });
    }, 140);
  }

  function onKey(e) {
    if (e.key === "Escape") close();
    else if (e.key === "Backspace" && stack.length > 1) {
      e.preventDefault();
      back();
    }
  }
  function onBackdrop() {
    close();
  }

  // ─── Drag (swipe down → fechar) ──────────────────────────────────────
  function pointerY(e) {
    if (e.touches && e.touches.length) return e.touches[0].clientY;
    if (e.changedTouches && e.changedTouches.length)
      return e.changedTouches[0].clientY;
    return e.clientY || 0;
  }
  function isDragArea(t) {
    let el = t;
    while (el && el !== panel) {
      if (el.dataset && el.dataset.noDrag === "1") return false;
      if (el.dataset && el.dataset.dragArea === "1") return true;
      if (el.dataset && el.dataset.detailsScroll === "1") return false;
      el = el.parentElement;
    }
    return false;
  }
  function onDown(e) {
    if (!stack.length || !isDragArea(e.target)) return;
    if (window.matchMedia("(min-width: 768px)").matches) return;
    dragActive = true;
    dragStartY = dragLastY = pointerY(e);
    dragStartTs = Date.now();
    panel.style.transition = "none";
  }
  function onMove(e) {
    if (!dragActive) return;
    const y = pointerY(e);
    dragLastY = y;
    const dy = Math.max(0, y - dragStartY);
    panel.style.transform = `translateY(${dy}px)`;
    if (backdrop && !backdrop.classList.contains("hidden"))
      backdrop.style.opacity = String(Math.max(0, 1 - dy / 300));
  }
  function onUp() {
    if (!dragActive) return;
    dragActive = false;
    const dy = dragLastY - dragStartY;
    const dt = Date.now() - dragStartTs;
    const v = dt > 0 ? dy / dt : 0;
    panel.style.transition = "";
    panel.style.transform = "";
    if (backdrop) backdrop.style.opacity = "";
    if (dy > 110 || (v > 0.6 && dy > 40)) close();
  }
  function attachHandlers() {
    if (!panel) return;
    panel.addEventListener("click", onPanelClick);
    panel.addEventListener("touchstart", onDown, { passive: true });
    panel.addEventListener("touchmove", onMove, { passive: true });
    panel.addEventListener("touchend", onUp, { passive: true });
    panel.addEventListener("touchcancel", onUp, { passive: true });
    panel.addEventListener("pointerdown", onDown);
    panel.addEventListener("pointermove", onMove);
    panel.addEventListener("pointerup", onUp);
    panel.addEventListener("pointercancel", onUp);
    document.addEventListener("keydown", onKey);
    if (backdrop) backdrop.addEventListener("click", onBackdrop);
  }
  function detachHandlers() {
    if (!panel) return;
    panel.removeEventListener("click", onPanelClick);
    panel.removeEventListener("touchstart", onDown);
    panel.removeEventListener("touchmove", onMove);
    panel.removeEventListener("touchend", onUp);
    panel.removeEventListener("touchcancel", onUp);
    panel.removeEventListener("pointerdown", onDown);
    panel.removeEventListener("pointermove", onMove);
    panel.removeEventListener("pointerup", onUp);
    panel.removeEventListener("pointercancel", onUp);
    document.removeEventListener("keydown", onKey);
    if (backdrop) backdrop.removeEventListener("click", onBackdrop);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  API PÚBLICA
  // ═══════════════════════════════════════════════════════════════════

  // Aceita as duas formas de estação que os geojson do mapa produzem.
  function normalizeStation(raw, op) {
    if (!raw) return null;
    const name = raw.name || raw.nome_destino || raw.stop_name || "";
    const detected =
      op ||
      raw.operator ||
      (raw.nome_destino || raw.id_destino || raw.linha ? "ml" : null) ||
      (raw.lines || raw.line_colors ? "mts" : null);
    return {
      op: detected,
      id: raw.id != null ? raw.id : raw.id_destino,
      stopId: raw.stop_id || null,
      name: String(name).trim(),
    };
  }

  function showSheet() {
    panel.dataset.state = "station";
    panel.classList.remove("translate-y-full");
    panel.classList.add("translate-y-0");
    backdrop.classList.remove("hidden", "opacity-0", "pointer-events-none");
    backdrop.classList.add("opacity-100");
    if (tick) clearInterval(tick);
    tick = setInterval(renderList, TICK_MS);
  }

  function closeOtherSheets() {
    if (window.MapaStation && window.MapaStation.isOpen())
      window.MapaStation.close({ silent: true });
    if (window.MapaDetails && window.MapaDetails.isOpen())
      window.MapaDetails.close();
    if (window.MapaCM && window.MapaCM.isOpen()) window.MapaCM.close();
  }

  function open(rawStation, opts) {
    const station = normalizeStation(rawStation, opts && opts.operator);
    if (!station || !station.op) {
      console.warn("[GtfsHorarios] operador não identificado", rawStation);
      return;
    }
    injectStyles();
    ensureElements();
    if (!panel || !backdrop) return;
    closeOtherSheets();

    const fresh = !stack.length;
    return loadBundle(station.op)
      .then((bundle) => {
        if (fresh) {
          stack = [];
          attachHandlers();
          showSheet();
        }
        return pushStopView(bundle, station, {
          replace: true,
          recenter: !!(opts && opts.recenter),
        });
      })
      .catch(() => {
        // Bundle em falta: a sheet abre com a mensagem em vez de falhar em silêncio.
        if (fresh) {
          stack = [
            {
              kind: "stop",
              bundle: {
                op: station.op,
                agencyName: OPERATORS[station.op].label,
                logo: `${LOGO_DIR}/${OPERATORS[station.op].slug}.svg`,
                routes: new Map(),
                calendar: {},
                feedDate: "",
              },
              name: station.name || "Estação",
              entries: [],
              routeIds: [],
              state: "error",
              error: "Não foi possível carregar o horário deste operador.",
              scrollTop: 0,
            },
          ];
          attachHandlers();
          showSheet();
          render();
        }
      });
  }

  function openStop(op, stopId, opts) {
    injectStyles();
    ensureElements();
    if (!panel || !backdrop) return;
    return loadBundle(op).then((bundle) => {
      const entry = bundle.byId.get(String(stopId));
      const station = {
        op,
        stopId: String(stopId),
        name: (entry && entry.stop_name) || (opts && opts.name) || "Estação",
      };
      if (!stack.length) {
        closeOtherSheets();
        attachHandlers();
        showSheet();
      }
      return pushStopView(bundle, station, {
        replace: false,
        recenter: !!(opts && opts.recenter),
      });
    });
  }

  function close() {
    ensureElements();
    if (!panel || !backdrop) return;
    if (tick) {
      clearInterval(tick);
      tick = null;
    }
    const had = stack.length > 0;
    stack = [];
    if (window.MapaSelecao) window.MapaSelecao.clear();
    panel.classList.add("translate-y-full");
    panel.classList.remove("translate-y-0");
    panel.dataset.state = "closed";
    backdrop.classList.add("opacity-0", "pointer-events-none");
    backdrop.classList.remove("opacity-100");
    detachHandlers();
    setTimeout(() => {
      backdrop.classList.add("hidden");
      if (had && panel.dataset.state === "closed") panel.innerHTML = "";
    }, 320);
  }

  function isOpen() {
    return stack.length > 0;
  }

  // Qual operador está no painel — o botão do olho usa isto para só fechar a
  // sheet quando esconde a camada correspondente.
  function operator() {
    const v = top();
    return v && v.bundle ? v.bundle.op : null;
  }

  function refresh() {
    if (isOpen()) renderList();
  }

  // Verificação de nomes: lista as estações do geojson que não casam com o
  // bundle, para preencher STATION_ALIASES.
  function audit(op, geojsonUrl) {
    return Promise.all([loadBundle(op), getJSON(geojsonUrl)]).then(
      ([bundle, gj]) => {
        const ok = [];
        const miss = [];
        (gj.features || []).forEach((f) => {
          const st = normalizeStation(f.properties, op);
          const r = resolveStops(bundle, st);
          (r.entries.length ? ok : miss).push({
            geojson: st.name,
            gtfs: r.primary ? r.primary.stop_name : null,
            paragens: r.entries.length,
          });
        });
        console.log(
          `[GtfsHorarios] audit "${op}": ${ok.length} encontradas, ${miss.length} sem correspondência`,
        );
        if (miss.length) console.table(miss);
        return { ok, miss };
      },
    );
  }

  window.GtfsHorarios = {
    // Cruzamento Fertagus/CP, para o mapa-render.js e o mapa-station.js.
    sharedFertagusCp,
    cpStationFor,
    open,
    openStop,
    close,
    isOpen,
    operator,
    refresh,
    audit,
    // Expostos para testes e para inspecção na consola.
    _internals: {
      timeToSec,
      secToClock,
      lisbonNow,
      ymdShift,
      norm,
      slugify,
      logoFor,
      fertagusLinkFor,
      cpRealtimeUrl,
      cpIpId,
      loadLigacoes,
      sharedFertagusCp,
      serviceRunsOn,
      serviceLabel,
      resolveStops,
      stationLines,
      collectUpcoming,
      tripTimeline,
      loadBundle,
      loadBoard,
      loadPattern,
      OPERATORS,
    },
  };

  // Aliases retrocompatíveis: mapa-mts.js e mapa-search.js continuam a chamar
  // window.MtsHorarios.open(station) sem alterações.
  window.MtsHorarios = {
    open: (st) => open(st, { operator: "mts" }),
    close,
    isOpen,
    operator,
    refresh,
  };
  window.MlHorarios = {
    open: (st) => open(st, { operator: "ml" }),
    close,
    isOpen,
    operator,
    refresh,
  };
})();

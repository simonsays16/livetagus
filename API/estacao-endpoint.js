/**
 * estacao-endpoint.js
 * Construtor do payload do endpoint GET /estacao/:id da LiveTagus API.
 *
 * OBJETIVO
 * ─────────────────────────────────────────────────────────────────────────────
 * Servir, por estação (identificada pelo EstacaoID numérico da IP), apenas o
 * que essa estação precisa, em vez de obrigar o cliente a descarregar o
 * /fertagus inteiro (todos os comboios com o array de nós completo) e a filtrar
 * tudo no browser — que é o que o estacao.js fazia até agora.
 *
 * O QUE DEVOLVE
 * ─────────────────────────────────────────────────────────────────────────────
 *   {
 *     "estacao":  { id, key, nome },
 *     "lisboa":   [ <comboioAoVivo>, ... ],   // partidas FUTURAS sentido Lisboa
 *     "margem":   [ <comboioAoVivo>, ... ],   // partidas FUTURAS sentido Margem
 *     "futureTrains":  { "<id>": "<estado>", ... },   // só o ESTADO (string)
 *     "abnormalRoutes": { "<id>": { skipped:[...], estado } },  // trajetos anormais
 *     "meta": { operationalDate, generatedAt, ipDown, counts }
 *   }
 *
 * Cada <comboioAoVivo> traz SÓ os dados específicos do comboio PARA ESTA estação:
 * os metadados do comboio (id-comboio, Origem, Destino, Live, Ocupacao, ...) e
 * UM único nó — o nó desta estação. O atraso é lido diretamente desse nó
 * (AtrasoReal quando já passou; HoraPrevista − HoraProgramada quando ainda não).
 *
 * REGRAS / EDGE CASES (alinhadas com app, mapa-station.js e estacao.js)
 * ─────────────────────────────────────────────────────────────────────────────
 *   • Só FUTUROS: nós com ComboioPassou=true são excluídos das listas ao vivo
 *     (a partida já aconteceu nesta estação).
 *   • TRAJETO ANORMAL (saltos/truncagem): um comboio que normalmente serviria
 *     esta estação mas que, por obras, NÃO passa aqui, é retirado das listas e
 *     do futureTrains desta estação e listado em abnormalRoutes (para o cliente
 *     poder avisar "hoje não para aqui").
 *   • Comboio que simplesmente não tem nó nesta estação (nunca a serve) é
 *     ignorado — não polui o output.
 *   • SUPRIMIDOS aparecem apenas em futureTrains com estado "SUPRIMIDO"
 *     (nunca entram nas listas ao vivo).
 *   • futureTrains é restringido aos comboios cujo trajeto NORMAL inclui esta
 *     estação (caso contrário cada estação herdaria a lista global inteira).
 *   • Extras (EXTRA_TRAINS_CACHE) entram nas listas se servirem a estação; os
 *     seus nós são normalizados para o formato-padrão (têm menos campos).
 *
 * Este módulo é PURO: não toca em ficheiros nem na rede. Recebe um `ctx` com as
 * referências do estado vivo do index.js e devolve o payload. Isto mantém o
 * index.js limpo e o endpoint testável de forma isolada.
 */

"use strict";

// ─── TABELA CANÓNICA DE ESTAÇÕES (Sul → Norte) ──────────────────────────────
// Idêntica à de estacao.js / STATION_IDS_FIXED do index.js. Mantida aqui para
// o módulo ser standalone na resolução de estação, sentido e ordem da linha.
const STATIONS = [
  { key: "setubal", nome: "Setúbal", apiName: "SETÚBAL", apiId: 9468122 },
  { key: "palmela", nome: "Palmela", apiName: "PALMELA", apiId: 9468098 },
  { key: "venda_do_alcaide", nome: "Venda do Alcaide", apiName: "VENDA DO ALCAIDE", apiId: 9468049 },
  { key: "pinhal_novo", nome: "Pinhal Novo", apiName: "PINHAL NOVO", apiId: 9468007 },
  { key: "penalva", nome: "Penalva", apiName: "PENALVA", apiId: 9417095 },
  { key: "coina", nome: "Coina", apiName: "COINA", apiId: 9417236 },
  { key: "fogueteiro", nome: "Fogueteiro", apiName: "FOGUETEIRO", apiId: 9417186 },
  { key: "foros_de_amora", nome: "Foros de Amora", apiName: "FOROS DE AMORA", apiId: 9417152 },
  { key: "corroios", nome: "Corroios", apiName: "CORROIOS", apiId: 9417137 },
  { key: "pragal", nome: "Pragal", apiName: "PRAGAL", apiId: 9417087 },
  { key: "campolide", nome: "Campolide", apiName: "CAMPOLIDE", apiId: 9467033 },
  { key: "sete_rios", nome: "Sete Rios", apiName: "SETE RIOS", apiId: 9466076 },
  { key: "entrecampos", nome: "Entrecampos", apiName: "ENTRECAMPOS", apiId: 9466050 },
  { key: "roma_areeiro", nome: "Roma-Areeiro", apiName: "ROMA-AREEIRO", apiId: 9466035 },
];

// Índice da estação na ordem física da linha (sentido Lisboa). Usado para
// inferir o sentido de um comboio a partir dos seus nós (primeiro vs último).
const ORDER_INDEX = STATIONS.reduce((acc, s, i) => {
  acc[s.apiId] = i;
  acc[s.apiName] = i;
  return acc;
}, {});

const STATION_BY_API_ID = STATIONS.reduce((acc, s) => {
  acc[String(s.apiId)] = s;
  return acc;
}, {});

// Chaves reservadas do OUTPUT_CACHE que NÃO são comboios.
const RESERVED_KEYS = new Set(["futureTrains", "extratrains", "abnormalRoutes"]);

// Limites e tolerâncias
const DEFAULT_LIMIT = 30; // partidas por sentido (limite generoso de segurança)

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const stripA = (s) => String(s == null ? "" : s).toUpperCase().replace(/-A$/, "").trim();

/** Resolve a estação a partir do EstacaoID numérico (string ou número). */
function resolveStation(id) {
  if (id == null) return null;
  const s = STATION_BY_API_ID[String(id).trim()];
  return s || null;
}

/** Lista compacta de estações (para o endpoint índice e mensagens de erro). */
function listStations() {
  return STATIONS.map((s) => ({ id: s.apiId, key: s.key, nome: s.nome }));
}

/**
 * Converte "HH:MM" / "HH:MM:SS" num timestamp, com a mesma semântica de dia
 * operacional usada no index.js (parseSmartTime injetado via ctx). Devolve null
 * para placeholders ("HH:MM:SS") ou strings vazias.
 */
function toTs(parseSmartTime, str, now) {
  if (!str || typeof str !== "string") return null;
  if (str.startsWith("HH")) return null;
  const d = parseSmartTime(str, now);
  return d ? d.getTime() : null;
}

/** Timestamp do nó (HoraPrevista tem prioridade; cai para HoraProgramada). */
function nodeTs(parseSmartTime, node, now) {
  if (!node) return Infinity;
  const t =
    toTs(parseSmartTime, node.HoraPrevista, now) ??
    toTs(parseSmartTime, node.HoraProgramada, now);
  return t == null ? Infinity : t;
}

/**
 * Atraso (em SEGUNDOS) lido DO NÓ desta estação:
 *   • já passou  → AtrasoReal medido.
 *   • ainda não  → HoraPrevista − HoraProgramada (segundos).
 */
function stationDelaySeconds(parseSmartTime, node, now) {
  if (!node) return 0;
  if (node.ComboioPassou && typeof node.AtrasoReal === "number") {
    return Math.max(0, node.AtrasoReal);
  }
  const prog = toTs(parseSmartTime, node.HoraProgramada, now);
  const prev = toTs(parseSmartTime, node.HoraPrevista, now);
  if (prog != null && prev != null) {
    return Math.round((prev - prog) / 1000);
  }
  return 0;
}

/**
 * Normaliza um nó para o formato-padrão da API. Necessário porque os nós dos
 * extras (buildExtraTrainOutput) só trazem ComboioPassou / HoraPrevista /
 * EstacaoID / NomeEstacao — faltam HoraProgramada, HoraReal e AtrasoReal.
 */
function normalizeNode(node) {
  const passou = !!node.ComboioPassou;
  const prevista = node.HoraPrevista || node.HoraProgramada || "HH:MM:SS";
  const programada = node.HoraProgramada || node.HoraPrevista || "HH:MM:SS";
  return {
    ComboioPassou: passou,
    HoraProgramada: programada,
    HoraReal: passou ? node.HoraReal || prevista : "HH:MM:SS",
    AtrasoReal: typeof node.AtrasoReal === "number" ? node.AtrasoReal : 0,
    HoraPrevista: prevista,
    EstacaoID: node.EstacaoID,
    NomeEstacao: stripA(node.NomeEstacao),
  };
}

/** Encontra o nó de uma estação dentro do array de nós de um comboio. */
function findStationNode(train, apiId) {
  const nodes = train && train.NodesPassagemComboio ? train.NodesPassagemComboio : [];
  return nodes.find((n) => n && String(n.EstacaoID) === String(apiId)) || null;
}

/**
 * Infere o sentido de um comboio:
 *   1. campo `direction` se existir (o index.js pode injetá-lo no trainOutput);
 *   2. ordem dos nós na linha (primeiro vs último nó reconhecido);
 *   3. fallback: Origem contém "ROMA" → margem.
 */
function resolveDirection(train) {
  if (train && (train.direction === "lisboa" || train.direction === "margem")) {
    return train.direction;
  }
  const nodes = (train && train.NodesPassagemComboio) || [];
  let firstIdx = null;
  let lastIdx = null;
  for (const n of nodes) {
    const idx =
      ORDER_INDEX[String(n.EstacaoID)] != null
        ? ORDER_INDEX[String(n.EstacaoID)]
        : ORDER_INDEX[stripA(n.NomeEstacao)];
    if (idx == null) continue;
    if (firstIdx === null) firstIdx = idx;
    lastIdx = idx;
  }
  if (firstIdx != null && lastIdx != null && firstIdx !== lastIdx) {
    return firstIdx < lastIdx ? "lisboa" : "margem";
  }
  return /ROMA/i.test((train && train.Origem) || "") ? "margem" : "lisboa";
}

/**
 * Constrói o objeto de saída de um comboio ao vivo, com SÓ o nó desta estação.
 * Mantém os metadados que a app espera. Inclui:
 *   • NodePassagem            → o nó (singular) desta estação, normalizado;
 *   • NodesPassagemComboio    → [NodePassagem] (compatível com o parser atual
 *                               do estacao.js, que procura o nó por EstacaoID);
 *   • AtrasoEstacao           → atraso em segundos, lido do nó (conveniência).
 */
function buildLiveTrain(train, node, direction, parseSmartTime, now) {
  const n = normalizeNode(node);
  const out = {
    "id-comboio": String(train["id-comboio"] != null ? train["id-comboio"] : train.id),
    DataHoraDestino: train.DataHoraDestino || null,
    DataHoraOrigem: train.DataHoraOrigem || null,
    Destino: train.Destino || null,
    DuracaoViagem: train.DuracaoViagem || "--:--",
    Operador: train.Operador || "FERTAGUS",
    Origem: train.Origem || null,
    TipoServico: train.TipoServico || "URB|SUBUR",
    Live: !!train.Live,
    Ocupacao: train.Ocupacao != null ? train.Ocupacao : null,
    SituacaoComboio: train.SituacaoComboio || "Programado",
    direction,
    AtrasoEstacao: stationDelaySeconds(parseSmartTime, n, now),
    NodePassagem: n,
    NodesPassagemComboio: [n],
  };
  // Propaga sinalização de trajeto anormal se o comboio a tiver.
  if (train._isAbnormalRoute) {
    out._isAbnormalRoute = true;
    if (Array.isArray(train._skippedStations)) {
      out._skippedStations = train._skippedStations;
    }
  }
  return out;
}

// ─── CONSTRUÇÃO DO PAYLOAD ───────────────────────────────────────────────────

/**
 * @param {object} station  resultado de resolveStation()
 * @param {object} ctx      {
 *   OUTPUT_CACHE, EXTRA_TRAINS_CACHE, FUTURE_TRAINS_CACHE, ABNORMAL_ROUTES_CACHE,
 *   RICH_SCHEDULE, DYNAMIC_EXTRA_SCHEDULE, parseSmartTime, now, limit, ipDown,
 *   operationalDate
 * }
 */
function buildStationPayload(station, ctx) {
  const {
    OUTPUT_CACHE = {},
    EXTRA_TRAINS_CACHE = {},
    FUTURE_TRAINS_CACHE = {},
    ABNORMAL_ROUTES_CACHE = {},
    RICH_SCHEDULE = [],
    DYNAMIC_EXTRA_SCHEDULE = {},
    parseSmartTime,
    now = new Date(),
    operationalDate = null,
  } = ctx || {};

  const limit =
    Number.isInteger(ctx && ctx.limit) && ctx.limit > 0 && ctx.limit <= 200
      ? ctx.limit
      : DEFAULT_LIMIT;

  const apiId = station.apiId;
  const stationKey = station.key;
  const lisboa = [];
  const margem = [];

  // Conjunto de IDs já colocados nas listas ao vivo (evita duplicados entre
  // OUTPUT_CACHE e EXTRA_TRAINS_CACHE — um extra promovido a "live" existe nos
  // dois sítios durante uma transição).
  const liveIds = new Set();

  // 1) Fonte principal: comboios ativos / programados (OUTPUT_CACHE).
  // 2) Fonte secundária: extras pré-live (EXTRA_TRAINS_CACHE).
  const sources = [];
  for (const [id, train] of Object.entries(OUTPUT_CACHE)) {
    if (RESERVED_KEYS.has(id)) continue;
    if (train && typeof train === "object") sources.push(train);
  }
  for (const train of Object.values(EXTRA_TRAINS_CACHE)) {
    if (train && typeof train === "object") sources.push(train);
  }

  for (const train of sources) {
    const id = String(train["id-comboio"] != null ? train["id-comboio"] : train.id);
    if (!id || liveIds.has(id)) continue;

    // SUPRIMIDO nunca entra nas listas ao vivo (vai só ao futureTrains).
    if (/SUPRIMIDO/i.test(train.SituacaoComboio || "")) continue;

    const node = findStationNode(train, apiId);
    if (!node) continue; // não serve esta estação (ou trajeto truncado)

    // SÓ FUTUROS: se já passou nesta estação, não é uma partida futura.
    if (node.ComboioPassou) continue;

    const direction = resolveDirection(train);
    const liveTrain = buildLiveTrain(train, node, direction, parseSmartTime, now);

    if (direction === "margem") margem.push(liveTrain);
    else lisboa.push(liveTrain);
    liveIds.add(id);
  }

  // Ordenação por hora (na estação) e corte de segurança.
  const sortByNode = (a, b) =>
    nodeTs(parseSmartTime, a.NodePassagem, now) -
    nodeTs(parseSmartTime, b.NodePassagem, now);
  lisboa.sort(sortByNode);
  margem.sort(sortByNode);
  const lisboaOut = lisboa.slice(0, limit);
  const margemOut = margem.slice(0, limit);

  // ─── futureTrains (só o ESTADO) restrito a comboios que servem a estação ──
  // Lookup de richInfo por id (horário base + extras dinâmicos) para decidir
  // pertença à estação. Replacements efémeros não constam → excluídos (seguro).
  const richById = new Map();
  for (const t of RICH_SCHEDULE) richById.set(String(t.id), t);
  for (const [id, t] of Object.entries(DYNAMIC_EXTRA_SCHEDULE)) {
    if (!richById.has(String(id))) richById.set(String(id), t);
  }

  const servesStation = (id) => {
    const rich = richById.get(String(id));
    if (!rich) return false;
    const v = rich[stationKey];
    return v != null && String(v).trim() !== "";
  };

  // Estações saltadas por comboio (trajeto anormal). { id: Set(keys) }
  const skippedByTrain = new Map();
  for (const [id, info] of Object.entries(ABNORMAL_ROUTES_CACHE)) {
    const set = new Set();
    if (info && Array.isArray(info.skipped)) {
      for (const s of info.skipped) if (s && s.key) set.add(s.key);
    }
    skippedByTrain.set(String(id), set);
  }
  const skipsThisStation = (id) => {
    const set = skippedByTrain.get(String(id));
    return !!(set && set.has(stationKey));
  };

  const futureTrains = {};
  const abnormalRoutes = {};

  for (const [id, estado] of Object.entries(FUTURE_TRAINS_CACHE)) {
    if (RESERVED_KEYS.has(id)) continue;
    if (estado === "Realizado") continue; // já terminou — não interessa

    const serve = servesStation(id);

    // Trajeto anormal que CORTA esta estação: o comboio existe mas hoje não
    // para aqui. Mostra-se em abnormalRoutes (não em futureTrains/listas).
    if (serve && skipsThisStation(id)) {
      abnormalRoutes[id] = {
        estado,
        skipped: (ABNORMAL_ROUTES_CACHE[id] &&
          ABNORMAL_ROUTES_CACHE[id].skipped) || [],
      };
      continue;
    }

    if (!serve) continue; // não serve esta estação → fora do futureTrains
    futureTrains[id] = estado;
  }

  // Também expõe trajetos anormais de comboios já LIVE (em OUTPUT_CACHE) que
  // estejam a saltar esta estação, para o cliente poder sinalizar.
  for (const [id, info] of Object.entries(ABNORMAL_ROUTES_CACHE)) {
    if (abnormalRoutes[id]) continue;
    if (!skipsThisStation(id)) continue;
    if (!servesStation(id)) continue;
    abnormalRoutes[id] = {
      estado: FUTURE_TRAINS_CACHE[id] || (OUTPUT_CACHE[id] ? "Em circulação" : null),
      skipped: (info && info.skipped) || [],
    };
  }

  return {
    estacao: { id: station.apiId, key: station.key, nome: station.nome },
    lisboa: lisboaOut,
    margem: margemOut,
    futureTrains,
    abnormalRoutes,
    meta: {
      operationalDate: operationalDate || null,
      generatedAt: Date.now(),
      ipDown: !!(ctx && ctx.ipDown),
      counts: {
        lisboa: lisboaOut.length,
        margem: margemOut.length,
        future: Object.keys(futureTrains).length,
        abnormal: Object.keys(abnormalRoutes).length,
      },
    },
  };
}

module.exports = {
  STATIONS,
  resolveStation,
  listStations,
  buildStationPayload,
  // exportados para testes
  _resolveDirection: resolveDirection,
  _normalizeNode: normalizeNode,
  _stationDelaySeconds: stationDelaySeconds,
};

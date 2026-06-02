/**
 * extras-helpers.js
 * Helpers que transformam a resposta individual da IP (fetchDetails) nas
 * estruturas usadas pelo sistema de descoberta dinâmica de comboios.
 *
 * [TRAJETO ANORMAL] Acrescentado: getExpectedRouteKeys / detectAbnormalRoute,
 * usados para comparar o trajeto normal previsto (JSON base ou injetado nos
 * extras) com as estações reais devolvidas pela IP.
 */

"use strict";

const fixFirstNodeTime = (nodes, dataHoraOrigem) => {
  if (!Array.isArray(nodes) || nodes.length === 0) return nodes;
  if (!dataHoraOrigem || typeof dataHoraOrigem !== "string") return nodes;
  if (!dataHoraOrigem.includes(" ")) return nodes;

  const first = nodes[0];
  if (!first) return nodes;

  const horaProg = first.HoraProgramada || "";
  const isZeroTime =
    horaProg.startsWith("00:00") && !dataHoraOrigem.includes(" 00:00");
  if (!isZeroTime) return nodes;

  const origemTime = dataHoraOrigem.split(" ")[1] || "";
  if (!origemTime) return nodes;

  const newTime =
    origemTime.length > 5 ? origemTime.substring(0, 5) : origemTime;

  const fixed = nodes.map((n) => ({ ...n }));
  fixed[0].HoraProgramada = newTime;
  return fixed;
};

const buildExtraTrainOutput = (trainId, details, stationEntry) => {
  if (!details || !Array.isArray(details.NodesPassagemComboio)) return null;
  if (details.NodesPassagemComboio.length === 0) return null;

  const isSuppressed =
    /SUPRIMIDO/i.test(details.SituacaoComboio || "") ||
    /SUPRIMIDO/i.test(stationEntry?.observacoes || "");

  const fixedNodes = fixFirstNodeTime(
    details.NodesPassagemComboio,
    details.DataHoraOrigem,
  );

  const nodes = fixedNodes.map((n) => {
    let hp = n.HoraProgramada || "";
    if (hp && hp.length === 5) hp += ":00";
    return {
      ComboioPassou: false,
      HoraPrevista: hp,
      EstacaoID: n.NodeID,
      NomeEstacao: (n.NomeEstacao || "").replace(/-A$/, ""),
    };
  });

  return {
    "id-comboio": String(trainId),
    DataHoraOrigem: details.DataHoraOrigem,
    DataHoraDestino: details.DataHoraDestino,
    Origem: details.Origem,
    Destino: details.Destino,
    Operador: details.Operador || "FERTAGUS",
    TipoServico: details.TipoServico || "URB|SUBUR",
    Live: false,
    Ocupacao: null,
    NodesPassagemComboio: nodes,
    SituacaoComboio: isSuppressed ? "SUPRIMIDO" : "Programado",
  };
};

const buildSyntheticRichInfo = (
  trainId,
  details,
  stationEntry,
  STATION_MAP_IP_TO_JSON,
) => {
  if (!details || !Array.isArray(details.NodesPassagemComboio)) return null;
  if (details.NodesPassagemComboio.length === 0) return null;
  if (!STATION_MAP_IP_TO_JSON) return null;

  const direction =
    stationEntry?.direction ||
    (/ROMA/i.test(details.Origem || "") ? "margem" : "lisboa");

  const rich = {
    id: String(trainId),
    horario: 1,
    direction,
    ocupacao: null,
    carruagens: 4,
    service: 1,
    _isExtra: true,
    _isDynamicExtra: true,
  };

  const fixedNodes = fixFirstNodeTime(
    details.NodesPassagemComboio,
    details.DataHoraOrigem,
  );

  for (const node of fixedNodes) {
    const nomeUpper = (node.NomeEstacao || "").toUpperCase().replace(/-A$/, "");
    const key = STATION_MAP_IP_TO_JSON[nomeUpper];
    if (!key) continue;

    let timeStr = node.HoraProgramada || "";
    if (timeStr.length > 5) timeStr = timeStr.substring(0, 5);
    rich[key] = timeStr;
  }

  return rich;
};

const startDateFromStationEntry = (stationEntry, now = new Date()) => {
  const raw = stationEntry?.dataRealizacao;
  if (raw && /^\d{2}-\d{2}-\d{4}$/.test(raw)) {
    const [dd, mm, yyyy] = raw.split("-").map(Number);
    const d = new Date(now);
    d.setFullYear(yyyy, mm - 1, dd);
    d.setHours(12, 0, 0, 0);
    return d;
  }
  return now;
};

// ─── [TRAJETO ANORMAL] DETEÇÃO DE DESVIOS (obras / percursos cortados) ───────
// Ordem física da linha (Sul → Norte). O sentido "margem" usa a ordem inversa.
const STATION_ORDER_BASE = [
  "setubal",
  "palmela",
  "venda_do_alcaide",
  "pinhal_novo",
  "penalva",
  "coina",
  "fogueteiro",
  "foros_de_amora",
  "corroios",
  "pragal",
  "campolide",
  "sete_rios",
  "entrecampos",
  "roma_areeiro",
];

// Devolve as chaves JSON do trajeto NORMAL previsto, já ordenadas pelo sentido.
//  - Comboios regulares: todas as estações do richInfo que têm hora definida.
//  - Comboios extra:      usa richInfo._expectedRoute (trajeto injetado), se existir.
const getExpectedRouteKeys = (richInfo) => {
  if (!richInfo) return [];
  const direction = richInfo.direction === "margem" ? "margem" : "lisboa";
  const ordered =
    direction === "margem"
      ? [...STATION_ORDER_BASE].reverse()
      : STATION_ORDER_BASE;

  // Extras com trajeto previsto injetado têm prioridade.
  if (
    Array.isArray(richInfo._expectedRoute) &&
    richInfo._expectedRoute.length > 0
  ) {
    const inj = new Set(richInfo._expectedRoute.map(String));
    return ordered.filter((k) => inj.has(k));
  }

  return ordered.filter(
    (k) => richInfo[k] != null && String(richInfo[k]).trim() !== "",
  );
};

// Compara o trajeto normal (JSON / injetado) com os nós reais devolvidos pela IP.
// Devolve { isAbnormal, skipped: [{ key, nome, hora }] }, onde "skipped" são as
// estações que constam do trajeto normal mas que a IP NÃO inclui (saltadas ou
// cortadas no início/fim por obras). Sem nós da IP → não infere nada (evita
// falsos positivos quando ainda não há dados em tempo real).
const detectAbnormalRoute = (
  richInfo,
  ipNodes,
  STATION_MAP_IP_TO_JSON,
  STATION_MAP_JSON_TO_IP,
) => {
  const result = { isAbnormal: false, skipped: [] };
  if (!richInfo || !STATION_MAP_IP_TO_JSON) return result;

  const expected = getExpectedRouteKeys(richInfo);
  if (expected.length === 0) return result;

  const servedKeys = new Set();
  if (Array.isArray(ipNodes)) {
    for (const n of ipNodes) {
      const nome = (n.NomeEstacao || "").toUpperCase().replace(/-A$/, "");
      const key = STATION_MAP_IP_TO_JSON[nome];
      if (key) servedKeys.add(key);
    }
  }
  if (servedKeys.size === 0) return result;

  for (const key of expected) {
    if (!servedKeys.has(key)) {
      result.skipped.push({
        key,
        nome: STATION_MAP_JSON_TO_IP ? STATION_MAP_JSON_TO_IP[key] || key : key,
        hora:
          richInfo[key] != null ? String(richInfo[key]).substring(0, 5) : null,
      });
    }
  }

  result.isAbnormal = result.skipped.length > 0;
  return result;
};

// [TRAJETO ANORMAL] Deteção por TERMINUS, a partir do station-poll (Corroios).
// O poll agregado não devolve a lista completa de nós — apenas origem/destino
// reais de cada comboio. Isto basta para apanhar comboios cujo percurso foi
// CORTADO nos extremos (ex: termina no Pragal/Coina em vez de Roma/Setúbal, ou
// arranca a meio da linha), sem qualquer fetch individual à IP. Permite avisar
// com antecedência (pré-live) que o trajeto difere do normal.
//
// originName / destName: NomeEstacaoOrigem / NomeEstacaoDestino do poll.
// Devolve { isAbnormal, skipped:[{key,nome,hora}] }. Estações intermédias
// saltadas NÃO são detetadas por aqui (requerem os nós completos) — apenas
// a truncagem dos extremos.
const detectAbnormalFromTerminus = (
  richInfo,
  originName,
  destName,
  STATION_MAP_IP_TO_JSON,
  STATION_MAP_JSON_TO_IP,
) => {
  const result = { isAbnormal: false, skipped: [] };
  if (!richInfo || !STATION_MAP_IP_TO_JSON) return result;

  const expected = getExpectedRouteKeys(richInfo);
  if (expected.length === 0) return result;

  const norm = (s) => (s || "").toUpperCase().replace(/-A$/, "").trim();
  const originKey = STATION_MAP_IP_TO_JSON[norm(originName)];
  const destKey = STATION_MAP_IP_TO_JSON[norm(destName)];
  if (!originKey || !destKey) return result;

  const oIdx = expected.indexOf(originKey);
  const dIdx = expected.indexOf(destKey);
  // Ambos os extremos têm de pertencer ao trajeto normal e estar pela ordem
  // de circulação (origem antes do destino). Caso contrário, não inferimos.
  if (oIdx === -1 || dIdx === -1 || oIdx > dIdx) return result;

  // Servidas = fatia contígua [origem..destino]. Tudo o resto é saltado.
  const served = new Set(expected.slice(oIdx, dIdx + 1));
  for (const key of expected) {
    if (!served.has(key)) {
      result.skipped.push({
        key,
        nome: STATION_MAP_JSON_TO_IP ? STATION_MAP_JSON_TO_IP[key] || key : key,
        hora:
          richInfo[key] != null ? String(richInfo[key]).substring(0, 5) : null,
      });
    }
  }

  result.isAbnormal = result.skipped.length > 0;
  return result;
};

module.exports = {
  fixFirstNodeTime,
  buildExtraTrainOutput,
  buildSyntheticRichInfo,
  startDateFromStationEntry,
  getExpectedRouteKeys,
  detectAbnormalRoute,
  detectAbnormalFromTerminus,
};

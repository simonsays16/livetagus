/**
 * extras-helpers.js
 * Helpers que transformam a resposta individual da IP (fetchDetails) nas
 * estruturas usadas pelo sistema de descoberta dinâmica de comboios.
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

module.exports = {
  fixFirstNodeTime,
  buildExtraTrainOutput,
  buildSyntheticRichInfo,
  startDateFromStationEntry,
};

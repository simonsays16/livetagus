// =============================================================================
// get-location.js  —  Posições em tempo real dos comboios Fertagus (mapa)
// -----------------------------------------------------------------------------
// A TML passou a expor APENAS a localização das viaturas. Este módulo faz um
// poll de fundo de 3 em 3 segundos ao endpoint de posições da TML, filtra só a
// agência Fertagus ("7NTB1") e mantém em memória um cache leve no formato:
//
//   {
//     "14308": { latitude: 38.660736, longitude: -9.186214 },
//     "14309": { latitude: 38.586900, longitude: -9.055337 },
//     ...
//   }
//
// O endpoint /mapa serve sempre a ÚLTIMA versão do cache (refrescada pelo poller,
// nunca pelo pedido do cliente). Em caso de erro a obter/parsear a resposta da
// TML, o módulo passa a devolver { erro: "down" }.
// =============================================================================
require("dotenv").config();
const fetch = require("node-fetch");

const TML_URL = process.env.API_LOCATION;
const AGENCY_ID = "7NTB1"; // Fertagus
const POLL_INTERVAL_MS = 3000; // refresh de 3 s
const FETCH_TIMEOUT_MS = 2500; // < intervalo, para não acumular pedidos pendurados

// Mantém o estilo do FETCH_HEADERS do index.js: força resposta fresca.
const TML_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

// --- MEMÓRIA ---
let LOCATION_CACHE = {};
let IS_DOWN = true; // arranca "down" até existir a 1ª resposta válida
let pollTimer = null;
let isFetching = false; // evita sobreposição se a TML demorar a responder
let onPayloadCb = null;

// Remove os prefixos entre parênteses rectos do início do identificador.
// A TML mudou o formato da agência de numérico para alfanumérico e alguns
// campos trazem prefixos ENCADEADOS, daí o quantificador no grupo:
//   "[15]14297"           -> "14297"   (formato antigo)
//   "[7NTB1]14308"        -> "14308"   (formato atual)
//   "[2XUL7][7NTB1]3109"  -> "3109"    (trip_id, dois prefixos)
//   "14308"               -> "14308"   (já normalizado, inalterado)
const stripAgencyPrefix = (vehicleId) =>
  String(vehicleId || "").replace(/^(?:\[[^\]]+\])+/, "");

const pollPositions = async () => {
  // Se o poll anterior ainda não terminou, salta este tick (não empilha pedidos).
  if (isFetching) return;
  isFetching = true;

  try {
    const r = await fetch(TML_URL, {
      headers: TML_HEADERS,
      timeout: FETCH_TIMEOUT_MS,
    });

    if (!r.ok) throw new Error(`HTTP Error ${r.status}`);

    const json = await r.json();
    if (!json || !Array.isArray(json.data)) {
      throw new Error("Payload TML inesperado (sem array .data)");
    }

    const next = {};
    for (const v of json.data) {
      if (v.agency_id !== AGENCY_ID) continue;
      if (typeof v.latitude !== "number" || typeof v.longitude !== "number") {
        continue;
      }

      const id = stripAgencyPrefix(v.vehicle_id);
      if (!id) continue;

      next[id] = {
        latitude: v.latitude,
        longitude: v.longitude,
      };
    }

    // Substituição atómica do cache (reflete sempre o último estado da TML;
    // viaturas que desapareceram do feed deixam de constar).
    LOCATION_CACHE = next;
    IS_DOWN = false;

    if (onPayloadCb) {
      try {
        onPayloadCb(json.data, Date.now());
      } catch (e) {
        console.error("[MAPA/TML] Callback GTFS falhou:", e.message);
      }
    }
  } catch (e) {
    IS_DOWN = true;
    console.error("[MAPA/TML] Erro ao obter posições:", e.message);
  } finally {
    isFetching = false;
  }
};

// Arranca o poller de fundo (chamado uma vez no boot do index.js).
const init = (onPayload) => {
  if (typeof onPayload === "function") onPayloadCb = onPayload;
  if (pollTimer) return;
  pollPositions(); // primeira recolha imediata
  pollTimer = setInterval(pollPositions, POLL_INTERVAL_MS);
  console.log(
    `[MAPA] Poller TML ativo (refresh ${POLL_INTERVAL_MS / 1000}s, agência ${AGENCY_ID}).`,
  );
};

// Resposta a servir no endpoint /mapa.
const getMapData = () => (IS_DOWN ? { erro: "down" } : LOCATION_CACHE);

module.exports = { init, getMapData };

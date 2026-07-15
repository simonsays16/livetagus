"use strict";
require("dotenv").config();

// --- CONFIGURAÇÃO ---
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const API_BASE = process.env.API_BASE;
const IP_BLOCKED = true;

// Mapeamento de nomes / ordem / headers
const STATION_MAP_JSON_TO_IP = {
  setubal: "SETÚBAL",
  palmela: "PALMELA",
  venda_do_alcaide: "VENDA DO ALCAIDE",
  pinhal_novo: "PINHAL NOVO",
  penalva: "PENALVA",
  coina: "COINA",
  fogueteiro: "FOGUETEIRO",
  foros_de_amora: "FOROS DE AMORA",
  corroios: "CORROIOS",
  pragal: "PRAGAL",
  campolide: "CAMPOLIDE",
  sete_rios: "SETE RIOS",
  entrecampos: "ENTRECAMPOS",
  roma_areeiro: "ROMA-AREEIRO",
};

const STATION_MAP_IP_TO_JSON = Object.entries(STATION_MAP_JSON_TO_IP).reduce(
  (acc, [k, v]) => {
    acc[v] = k;
    return acc;
  },
  {},
);

// IDs Fixos para Fallback Offline
const STATION_IDS_FIXED = {
  SETÚBAL: 9468122,
  PALMELA: 9468098,
  "VENDA DO ALCAIDE": 9468049,
  "PINHAL NOVO": 9468007,
  PENALVA: 9417095,
  COINA: 9417236,
  FOGUETEIRO: 9417186,
  "FOROS DE AMORA": 9417152,
  CORROIOS: 9417137,
  PRAGAL: 9417087,
  CAMPOLIDE: 9467033,
  "SETE RIOS": 9466076,
  ENTRECAMPOS: 9466050,
  "ROMA-AREEIRO": 9466035,
};

// Ordem Sul -> Norte
const STATION_ORDER_LISBOA = [
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

// Ordem Norte -> Sul (Inversa)
const STATION_ORDER_MARGEM = [...STATION_ORDER_LISBOA].reverse();

// FIX #6: Cache-Control e Pragma forçam a IP (e qualquer CDN/proxy intermédio)
// a retornar sempre uma resposta fresca.
const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.infraestruturasdeportugal.pt/",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

// --- [GPS AUTONOMY] / [SENTIDO INVERTIDO] FLAGS (partilhadas motor+rotas+mapa) ---
// ─── [GPS AUTONOMY] MODO AUTÓNOMO DA IP ─────────────────────────────────────
// Qualquer comboio com GPS fresco na TML é FORÇADO a Live:true e as
// HoraPrevista dos nós futuros são recalculadas pelo motor cinemático
// (posição real na linha), ignorando os atrasos da IP.
// [ENVIO URGENTE] Cálculos por GPS DESLIGADOS — demasiado instáveis. O GPS
// fica APENAS a alimentar a posição no mapa (ingestTmlPayload no poller).
// Não recalcula atrasos, não infere passagens, não reatribui números por
// sentido. Religar gradualmente quando estabilizar.
const GPS_CALCULATIONS_ENABLED = true;

// [SENTIDO INVERTIDO] Interruptor MESTRE da deteção de sentido contrário.
// false = COMPLETAMENTE DESLIGADO: nunca reatribui números, nunca cria
// fantasmas 99xxx, nunca desvia pings. Os comboios mantêm SEMPRE o número e
// sentido originais da IP/horário. Religar só quando a deteção estiver fiável.
const DIRECTION_DETECTION_ENABLED = false;

const GPS_AUTONOMOUS_MODE = true; // desligar quando IP

// Admin
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const ADMIN_ROUTE = process.env.ADMIN_ROUTE;

module.exports = {
  PORT,
  API_KEY,
  API_BASE,
  IP_BLOCKED,
  STATION_MAP_JSON_TO_IP,
  STATION_MAP_IP_TO_JSON,
  STATION_IDS_FIXED,
  STATION_ORDER_LISBOA,
  STATION_ORDER_MARGEM,
  FETCH_HEADERS,
  GPS_CALCULATIONS_ENABLED,
  DIRECTION_DETECTION_ENABLED,
  GPS_AUTONOMOUS_MODE,
  ADMIN_API_KEY,
  ADMIN_ROUTE,
};

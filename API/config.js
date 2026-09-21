"use strict";
require("dotenv").config();
const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");

const az_kv_link = process.env.AZ_KV_LINK;

if (!az_kv_link) {
  throw new Error("[CONFIG] AZ_KV_LINK em falta no ambiente (.env).");
}

const credential = new DefaultAzureCredential();
const client = new SecretClient(az_kv_link, credential);

// --- CONFIGURAÇÃO ---
const IP_BLOCKED = true;

const secrets = {
  PORT: 3000,
  API_KEY: null,
  API_BASE: null,
  ADMIN_API_KEY: null,
  ADMIN_ROUTE: null,
  API_LOCATION: null,
  STATION_API_BASE: null,
};

let VAULT_LOADED = false;
let loadingPromise = null;

const isAbsoluteUrl = (v) => /^https?:\/\//i.test(String(v || ""));

/**
 * Lê TODOS os segredos do Key Vault. Idempotente: chamadas concorrentes
 * partilham a mesma promise, chamadas posteriores são no-op.
 *
 * TEM de ser AWAITED antes de qualquer módulo tocar nos getters abaixo.
 */
async function getKeysFromVault() {
  if (VAULT_LOADED) return secrets;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const wanted = {
      PORT: "PORT",
      API_KEY: "API-KEY",
      API_BASE: "API-BASE",
      ADMIN_API_KEY: "ADMIN-API-KEY",
      ADMIN_ROUTE: "ADMIN-ROUTE",
      API_LOCATION: "API-LOCATION",
      STATION_API_BASE: "STATION-API-BASE",
    };

    const entries = await Promise.all(
      Object.entries(wanted).map(async ([key, secretName]) => {
        try {
          const res = await client.getSecret(secretName);
          return [key, res.value];
        } catch (e) {
          console.error(
            `[CONFIG] Falha a ler o segredo "${secretName}": ${e.message}`,
          );
          return [key, null];
        }
      }),
    );

    for (const [key, value] of entries) {
      if (value != null && value !== "") secrets[key] = value;
    }

    // Fallback: se STATION-API-BASE ainda não existir no vault, reutiliza
    // API_BASE (é o mesmo host da IP). Remover quando o segredo estiver criado.
    if (!secrets.STATION_API_BASE && secrets.API_BASE) {
      secrets.STATION_API_BASE = secrets.API_BASE;
      console.warn(
        "[CONFIG] STATION-API-BASE ausente no vault — a usar API-BASE como fallback.",
      );
    }

    // Validação dura: URLs relativas/nulas rebentam mais tarde dentro do
    // node-fetch com "Only absolute URLs are supported", longe da causa.
    const urlKeys = ["API_BASE", "API_LOCATION", "STATION_API_BASE"];
    const bad = urlKeys.filter((k) => !isAbsoluteUrl(secrets[k]));
    if (bad.length) {
      throw new Error(
        `[CONFIG] Segredos de URL inválidos ou em falta: ${bad.join(", ")}. ` +
          `Têm de ser URLs absolutos (http:// ou https://).`,
      );
    }

    const missing = ["API_KEY", "ADMIN_API_KEY", "ADMIN_ROUTE"].filter(
      (k) => !secrets[k],
    );
    if (missing.length) {
      console.warn(`[CONFIG] Segredos em falta: ${missing.join(", ")}`);
    }

    secrets.PORT = Number(secrets.PORT) || 3000;
    VAULT_LOADED = true;
    console.log("[CONFIG] Segredos carregados do Azure Key Vault.");
    return secrets;
  })();

  try {
    return await loadingPromise;
  } catch (e) {
    loadingPromise = null; // permite retry
    throw e;
  }
}

/** true depois de getKeysFromVault() ter corrido com sucesso. */
const isVaultLoaded = () => VAULT_LOADED;

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
const GPS_CALCULATIONS_ENABLED = true;
const DIRECTION_DETECTION_ENABLED = false;
const GPS_AUTONOMOUS_MODE = true; // desligar quando IP

module.exports = {
  getKeysFromVault,
  isVaultLoaded,
  get PORT() {
    return secrets.PORT;
  },
  get API_KEY() {
    return secrets.API_KEY;
  },
  get API_BASE() {
    return secrets.API_BASE;
  },
  get ADMIN_API_KEY() {
    return secrets.ADMIN_API_KEY;
  },
  get ADMIN_ROUTE() {
    return secrets.ADMIN_ROUTE;
  },
  get API_LOCATION() {
    return secrets.API_LOCATION;
  },
  get STATION_API_BASE() {
    return secrets.STATION_API_BASE;
  },
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
};

/**
 * mapa-config.js
 * Configuração global da página de mapa ao vivo dos comboios Fertagus.
 */

(function () {
  "use strict";

  const MAPA = {
    // ─── API ───────────────────────────────────────────────────────────
    API_URL: "https://api.livetagus.pt/fertagus",
    // API_URL: "http://localhost:3000/fertagus",
    API_KEY: "KoKi30rVWuwkF9lqKL6j4mb0VMg3dIXWs6QDHZ3de0G8lC5qvu",

    // ─── INTERVALOS ────────────────────────────────────────────────────
    API_REFRESH_MS: 30_000, // refresh aos dados da API
    POSITION_UPDATE_MS: 5_000, // reposicionamento dos comboios
    BOARDING_MS: 30_000, // 30 s de embarque em cada paragem

    // ─── MAPA ──────────────────────────────────────────────────────────
    CENTER: [-9.05, 38.65],
    ZOOM: 10,
    MIN_ZOOM: 8,
    MAX_ZOOM: 17,
    ZOOM_DETAIL_CUTOFF: 15, // >= este zoom → vista de carruagens

    MAX_BOUNDS: [
      [-10.0, 38.2],
      [-8.3, 39.0],
    ],

    // ─── PATHS DOS JSON ────────────────────────────────────────────────
    STOPS_JSON: "./json/stops_ft.json",
    LINE_JSON: "./json/fertagus_line.json",
    LISBOA_JSON: "./json/fertagus_sentido_lisboa.json",
    MARGEM_JSON: "./json/fertagus_sentido_margem.json",
    HOLIDAYS_JSON: "./json/feriados.json",
    CHANGES_JSON: "./json/changes.json",

    // ─── PARTILHA (Web Share API + fallback) ───────────────────────────
    SHARE: {
      title: "Mapa ao Vivo · LiveTagus",
      text: "Vê os comboios Fertagus em tempo real no mapa LiveTagus.",
      urlFallback: "https://livetagus.pt/mapa",
      toastDurationMs: 2400,
    },

    // ─── ESTAÇÕES ──────────────────────────────────────────────────────
    // Ordem geográfica Sul → Norte (mesma ordem que na BD).
    STATIONS: [
      {
        key: "setubal",
        name: "Setúbal",
        apiName: "SETÚBAL",
        apiId: 9468122,
        lat: 38.530545,
        lng: -8.884972,
      },
      {
        key: "palmela",
        name: "Palmela",
        apiName: "PALMELA",
        apiId: 9468098,
        lat: 38.571879,
        lng: -8.872821,
      },
      {
        key: "venda_do_alcaide",
        name: "Venda do Alcaide",
        apiName: "VENDA DO ALCAIDE",
        apiId: 9468049,
        lat: 38.605728,
        lng: -8.88824,
      },
      {
        key: "pinhal_novo",
        name: "Pinhal Novo",
        apiName: "PINHAL NOVO",
        apiId: 9468007,
        lat: 38.62997,
        lng: -8.914071,
      },
      {
        key: "penalva",
        name: "Penalva",
        apiName: "PENALVA",
        apiId: 9417095,
        lat: 38.589686,
        lng: -8.995725,
      },
      {
        key: "coina",
        name: "Coina",
        apiName: "COINA",
        apiId: 9417236,
        lat: 38.584603,
        lng: -9.051508,
      },
      {
        key: "fogueteiro",
        name: "Fogueteiro",
        apiName: "FOGUETEIRO",
        apiId: 9417186,
        lat: 38.609899,
        lng: -9.101557,
      },
      {
        key: "foros_de_amora",
        name: "Foros de Amora",
        apiName: "FOROS DE AMORA",
        apiId: 9417152,
        lat: 38.620999,
        lng: -9.129374,
      },
      {
        key: "corroios",
        name: "Corroios",
        apiName: "CORROIOS",
        apiId: 9417137,
        lat: 38.636381,
        lng: -9.15157,
      },
      {
        key: "pragal",
        name: "Pragal",
        apiName: "PRAGAL",
        apiId: 9417087,
        lat: 38.666059,
        lng: -9.179832,
      },
      {
        key: "campolide",
        name: "Campolide",
        apiName: "CAMPOLIDE",
        apiId: 9467033,
        lat: 38.730875,
        lng: -9.169276,
      },
      {
        key: "sete_rios",
        name: "Sete Rios",
        apiName: "SETE RIOS",
        apiId: 9466076,
        lat: 38.740051,
        lng: -9.16695,
      },
      {
        key: "entrecampos",
        name: "Entrecampos",
        apiName: "ENTRECAMPOS",
        apiId: 9466050,
        lat: 38.74454,
        lng: -9.148613,
      },
      {
        key: "roma_areeiro",
        name: "Roma-Areeiro",
        apiName: "ROMA-AREEIRO",
        apiId: 9466035,
        lat: 38.745724,
        lng: -9.134831,
      },
    ],

    // ─── CORES DO ESTADO ───────────────────────────────────────────────
    STATUS_COLORS: {
      green: "#10b981",
      yellow: "#f59e0b",
      orange: "#f97316",
      red: "#ef4444",
      gray: "#71717a",
    },

    OCCUPANCY_COLORS: {
      empty: "#3b82f6",
      low: "#10b981",
      medium: "#eab308",
      high: "#ef4444",
      default: "#3b82f6",
      offline: "#71717a",
      empty_bg: "#d4d4d8",
      empty_bg_dark: "#3f3f46",
    },
  };

  // ─── LOOKUPS ─────────────────────────────────────────────────────────
  MAPA.STATION_BY_API_NAME = Object.fromEntries(
    MAPA.STATIONS.map((s) => [s.apiName, s]),
  );
  MAPA.STATION_BY_API_ID = Object.fromEntries(
    MAPA.STATIONS.map((s) => [s.apiId, s]),
  );
  MAPA.STATION_BY_KEY = Object.fromEntries(
    MAPA.STATIONS.map((s) => [s.key, s]),
  );
  MAPA.STATION_ORDER = MAPA.STATIONS.map((s) => s.key);

  MAPA.resolveStationByApiName = function (rawName) {
    if (!rawName) return null;
    const upper = String(rawName).toUpperCase();
    if (MAPA.STATION_BY_API_NAME[upper]) return MAPA.STATION_BY_API_NAME[upper];
    const norm = upper.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    for (const s of MAPA.STATIONS) {
      const sNorm = s.apiName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (sNorm === norm) return s;
    }
    return null;
  };

  MAPA.resolveStationByApiId = function (apiId) {
    if (apiId == null) return null;
    if (MAPA.STATION_BY_API_ID[apiId]) return MAPA.STATION_BY_API_ID[apiId];
    const str = String(apiId);
    for (const s of MAPA.STATIONS) {
      if (String(s.apiId) === str) return s;
    }
    return null;
  };

  if (typeof window !== "undefined") {
    window.MAPA = MAPA;
  }
})();

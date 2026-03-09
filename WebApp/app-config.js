/**
 * app-config.js
 * Constantes globais, variáveis de estado e funções utilitárias partilhadas.
 * Deve ser carregado ANTES de todos os outros ficheiros app-*.js
 */

// ─── API & CONSTANTES ────────────────────────────────────────────────────────

const PROXY = "https://corsproxy.io/?";
const API_FERTAGUS_NEW = "https://api.livetagus.pt/fertagus/";
const API_ALERTS = "https://api.npoint.io/fe6b8c687169feff5f87";
const CLIENT_API_KEY = "KoKi30rVWuwkF9lqKL6j4mb0VMg3dIXWs6QDHZ3de0G8lC5qvu";

const FERTAGUS_STATIONS = [
  { id: "9468122", key: "setubal", name: "Setúbal" },
  { id: "9468098", key: "palmela", name: "Palmela" },
  { id: "9468049", key: "venda_do_alcaide", name: "Venda do Alcaide" },
  { id: "9468007", key: "pinhal_novo", name: "Pinhal Novo" },
  { id: "9417095", key: "penalva", name: "Penalva" },
  { id: "9417236", key: "coina", name: "Coina" },
  { id: "9417186", key: "fogueteiro", name: "Fogueteiro" },
  { id: "9417152", key: "foros_de_amora", name: "Foros de Amora" },
  { id: "9417137", key: "corroios", name: "Corroios" },
  { id: "9417087", key: "pragal", name: "Pragal" },
  { id: "9467033", key: "campolide", name: "Campolide" },
  { id: "9466076", key: "sete_rios", name: "Sete Rios" },
  { id: "9466050", key: "entrecampos", name: "Entrecampos" },
  { id: "9466035", key: "roma_areeiro", name: "Roma-Areeiro" },
];

// ─── ESTADO DA APLICAÇÃO ─────────────────────────────────────────────────────

let DB_LISBOA = null;
let DB_MARGEM = null;
let FERIADOS_DB = {};
let deferredPrompt;

let activeTab = "lisboa";
let isLoading = false;
let fertagusOrigin = "corroios";
let fertagusDest = "roma_areeiro";
let refreshInterval = null;
let nextTrainInterval = null;
let isDarkMode = true;
let currentTheme;
let currentTrainList = [];
let displayLimit = 10;
let nextTrainDate = null;
let syncStations = true;
let enableRegularStations = false;
let enableSmartSchedule = false;
let activeAlerts = [];

// ─── FUNÇÕES UTILITÁRIAS ──────────────────────────────────────────────────────

/**
 * Calcula o sentido (lisboa/margem) com base nos índices das estações.
 */
function calculateDirection(orgKey, dstKey) {
  const orgIdx = FERTAGUS_STATIONS.findIndex((s) => s.key === orgKey);
  const dstIdx = FERTAGUS_STATIONS.findIndex((s) => s.key === dstKey);
  if (orgIdx === -1 || dstIdx === -1) return "lisboa";
  if (orgIdx < dstIdx) return "lisboa";
  return "margem";
}

/**
 * Faz scroll suave para a área de conteúdo principal (alertas ou divisor).
 */
function focusOnContent() {
  const alerts = document.getElementById("alerts-dynamic-container");
  const divider = document.getElementById("next-divider");
  if (alerts) {
    alerts.scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (divider) {
    divider.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  console.log("focus on content called");
}

/**
 * Converte uma string de hora "HH:MM" para um objeto Date.
 * Avança para o dia seguinte se o horário já passou há mais de 4 horas.
 */
window.parseTimeStr = function (str) {
  if (!str) return null;
  const [h, m] = str.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d < new Date(Date.now() - 4 * 3600000)) d.setDate(d.getDate() + 1);
  return d;
};

/**
 * Adiciona minutos a uma string de hora e devolve a nova hora formatada.
 */
window.addMinutes = function (str, min) {
  const d = parseTimeStr(str);
  if (!d) return "--:--";
  d.setMinutes(d.getMinutes() + min);
  return d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
};

/**
 * Devolve a data operacional atual (antes das 03:00 considera o dia anterior).
 */
function getOperationalDate() {
  const d = new Date();
  if (d.getHours() < 3) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

/**
 * Verifica se uma data é fim de semana ou feriado.
 */
function isWeekendOrHoliday(date) {
  const day = date.getDay();
  const isWeekend = day === 0 || day === 6;
  if (isWeekend) return true;

  if (FERIADOS_DB) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const key = `${y}-${m}-${d}`;
    if (FERIADOS_DB[key]) return true;
  }
  return false;
}

/**
 * Devolve o tipo de dia: 0 = dia útil, 2 = FDS/feriado.
 */
function checkDayType() {
  const date = getOperationalDate();
  if (isWeekendOrHoliday(date)) return 2;
  return 0;
}

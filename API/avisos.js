/**
 * avisos.js
 * Módulo de gestão de avisos para a LiveTagus API.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const avisosPath = path.join(__dirname, "avisos.json");
let avisosCache = {};

function ensureFileExists() {
  if (!fs.existsSync(avisosPath)) {
    console.log("[AVISOS] avisos.json não encontrado. A criar ficheiro vazio.");
    try {
      fs.writeFileSync(avisosPath, JSON.stringify({}, null, 2), "utf8");
    } catch (e) {
      console.error("[AVISOS] Erro ao criar avisos.json:", e.message);
    }
  }
}

function updateAvisos() {
  try {
    if (fs.existsSync(avisosPath)) {
      const data = fs.readFileSync(avisosPath, "utf8");
      avisosCache = data.trim() === "" ? {} : JSON.parse(data);
    } else {
      avisosCache = {};
    }
  } catch (error) {
    console.error("[AVISOS] Erro ao ler avisos.json:", error.message);
    // Não esmagamos a cache: mantém-se o último estado válido.
  }
}

// ─── PARSING DE DATAS ────────────────────────────────────────────────────────
function parseAvisoDate(str, edge = "start") {
  if (typeof str !== "string") return null;
  const trimmed = str.trim();
  if (trimmed === "") return null;

  // Regex tolerante: aceita 1-2 dígitos em dia/mês, 4 em ano, e hora opcional.
  const m = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/,
  );
  if (!m) {
    console.warn(`[AVISOS] Data com formato inválido ignorada: "${str}"`);
    return null;
  }

  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const yyyy = parseInt(m[3], 10);
  const hh = m[4] != null ? parseInt(m[4], 10) : null;
  const min = m[5] != null ? parseInt(m[5], 10) : null;

  // Validação básica de range
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
    console.warn(`[AVISOS] Data fora de range ignorada: "${str}"`);
    return null;
  }

  let d;
  if (hh != null) {
    if (hh < 0 || hh > 23 || min < 0 || min > 59) {
      console.warn(`[AVISOS] Hora fora de range ignorada: "${str}"`);
      return null;
    }
    d = new Date(yyyy, mm - 1, dd, hh, min, 0, 0);
  } else if (edge === "end") {
    // Sem hora explícita no fim → considera o último instante do dia.
    d = new Date(yyyy, mm - 1, dd, 23, 59, 59, 999);
  } else {
    // Sem hora no início → considera 00:00 do dia.
    d = new Date(yyyy, mm - 1, dd, 0, 0, 0, 0);
  }

  // Sanity check: se o JS "corrigir" um dia inválido (ex: 31/02), o mês muda.
  if (
    d.getFullYear() !== yyyy ||
    d.getMonth() !== mm - 1 ||
    d.getDate() !== dd
  ) {
    console.warn(`[AVISOS] Data inexistente no calendário: "${str}"`);
    return null;
  }

  return d;
}

function isActive(item, now) {
  if (!item || typeof item !== "object") return false;

  const start = parseAvisoDate(item.datainicio, "start");
  const end = parseAvisoDate(item.datafim, "end");

  if (start && now.getTime() < start.getTime()) return false;
  if (end && now.getTime() > end.getTime()) return false;

  return true;
}

// ─── FILTRAGEM (apenas avisos ativos para output)

function buildActiveOutput(now = new Date()) {
  const out = {};
  const raw = avisosCache || {};

  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;

    // Bloco especial "mode": manutenção planeada
    if (key === "mode") {
      const maintActive =
        value.maintance === true || value.maintance === "true";
      if (!maintActive) continue;
      if (!isActive(value, now)) continue;
      out.mode = { ...value };
      continue;
    }

    // Aviso normal
    if (!isActive(value, now)) continue;
    out[key] = { ...value };
  }

  return out;
}

// ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────────

ensureFileExists();
updateAvisos();

try {
  if (fs.existsSync(avisosPath)) {
    fs.watch(avisosPath, (eventType) => {
      if (eventType === "change") updateAvisos();
    });
  }
} catch (e) {
  console.warn(
    "[AVISOS] Não foi possível configurar fs.watch para avisos.json:",
    e.message,
  );
}
setInterval(updateAvisos, 60000);

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  getAvisos: () => buildActiveOutput(new Date()),
  getAvisosRaw: () => ({ ...(avisosCache || {}) }),
  reload: () => updateAvisos(),
};

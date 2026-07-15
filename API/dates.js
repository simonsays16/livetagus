"use strict";
// Helpers de data PUROS extraídos do index.js (getOperationalInfo ficou no
// index.js por depender de HOLIDAYS, estado do motor).

const formatDateStr = (d) => {
  const pad = (n) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const parseSmartTime = (timeStr, now = new Date()) => {
  if (!timeStr) return null;
  const parts = timeStr.split(":");
  const h = parseInt(parts[0]);
  const m = parseInt(parts[1]);
  const s = parts[2] ? parseInt(parts[2]) : 0;

  const d = new Date(now);
  const nowH = now.getHours();

  // Fix: Basear sempre no dia operacional (05h00 às 02h30)
  // Se ainda não são 05h00, o dia operacional começou "ontem"
  if (nowH < 5) {
    d.setDate(d.getDate() - 1);
  }
  // Se a hora do comboio for de madrugada (00h-04h),
  // ele pertence ao dia civil seguinte do atual dia operacional.
  if (h < 5) {
    d.setDate(d.getDate() + 1);
  }
  d.setHours(h, m, s, 0);

  return d;
};

const formatTimeHHMMSS = (d) => {
  const pad = (n) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const subtractMinutes = (timeStr, minutes) => {
  const [h, m] = timeStr.split(":").map(Number);
  let date = new Date();
  date.setHours(h, m, 0, 0);

  const totalSeconds = Math.round(minutes * 60);
  date.setSeconds(date.getSeconds() - totalSeconds);

  const pad = (n) => n.toString().padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

module.exports = { formatDateStr, parseSmartTime, formatTimeHHMMSS, subtractMinutes };

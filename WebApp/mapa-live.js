/**
 * mapa-live.js  ·  LiveTagus (mapa)
 * Posições REAIS dos comboios Fertagus via endpoint /mapa (dados TML).
 *
 * O /mapa devolve { "<id-comboio>": { latitude, longitude }, ... } ou
 * { erro: "down" } em falha. Este módulo faz o poll (cadência controlada pelo
 * mapa.js, 5 s) e mantém um cache SÍNCRONO consultável por id de comboio.
 *
 * É um COMPLEMENTO, não um substituto: quando existe posição real para um
 * comboio, o mapa usa-a; caso contrário cai na estimativa do mapa-geo, que
 * fica totalmente intacta como fallback.
 *
 * O bearing (rotação) é derivado do deslocamento entre leituras consecutivas
 * (movimento real). Sem leitura anterior devolve bearing null → o chamador
 * (updateAllPositions) usa o bearing estimado nesse primeiro frame.
 */

(function () {
  "use strict";

  // id-comboio (string) -> { lat, lng, bearing, ts }
  const LIVE = new Map();
  // id-comboio (string) -> { lng, lat, passedAtMove, bad }
  // Saúde do GPS: deteta GPS "congelado" cruzando com o avanço de estações do
  // /fertagus (ver getPosition). NÃO usa tempo — um comboio pode estar mesmo
  // parado (na estação ou retido) e isso deve aparecer ao utilizador.
  const HEALTH = new Map();
  let isDown = false;
  let refreshing = false; // evita polls sobrepostos

  // Backstop longo (NÃO é o detetor de erro): só larga a posição real se a TML
  // ficar muda imenso tempo. O detetor real é o cross-check com o /fertagus.
  const MAX_AGE_MS = 5 * 60 * 1000;
  // Deslocamento mínimo (km) para considerar que o GPS "mexeu".
  const EPS_MOVE_KM = 0.0005; // ~0,5 m (distingue feed vivo de feed congelado)
  // Deslocamento mínimo (km) para recalcular bearing — evita jitter parado.
  const MIN_MOVE_KM = 0.005; // ~5 m

  // ─── HELPERS GEO (usa turf se presente, senão fallback próprio) ──────

  function computeBearing(fromLng, fromLat, toLng, toLat) {
    if (typeof turf !== "undefined") {
      try {
        const b = turf.bearing(
          turf.point([fromLng, fromLat]),
          turf.point([toLng, toLat]),
        );
        return (b + 360) % 360;
      } catch (_) {}
    }
    const toRad = (d) => (d * Math.PI) / 180;
    const toDeg = (r) => (r * 180) / Math.PI;
    const y = Math.sin(toRad(toLng - fromLng)) * Math.cos(toRad(toLat));
    const x =
      Math.cos(toRad(fromLat)) * Math.sin(toRad(toLat)) -
      Math.sin(toRad(fromLat)) *
        Math.cos(toRad(toLat)) *
        Math.cos(toRad(toLng - fromLng));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function distanceKm(aLng, aLat, bLng, bLat) {
    if (typeof turf !== "undefined") {
      try {
        return turf.distance(
          turf.point([aLng, aLat]),
          turf.point([bLng, bLat]),
          { units: "kilometers" },
        );
      } catch (_) {}
    }
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // ─── POLL ────────────────────────────────────────────────────────────

  async function refresh() {
    if (refreshing) return; // não empilha polls
    refreshing = true;
    try {
      await doRefresh();
    } finally {
      refreshing = false;
    }
  }

  async function doRefresh() {
    let payload = null;
    try {
      // Cache-busting + no-store: garantir sempre a versão mais recente.
      const res = await fetch(MAPA.MAP_URL + "?t=" + Date.now(), {
        method: "GET",
        headers: {
          "x-api-key": MAPA.API_KEY,
          Accept: "application/json",
        },
        cache: "no-store",
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      payload = await res.json();
    } catch (e) {
      // Falha de rede → mantém o último cache (o cross-check/backstop decidem).
      isDown = true;
      return;
    }

    if (!payload || typeof payload !== "object" || payload.erro === "down") {
      isDown = true;
      return; // idem: cache antigo expira sozinho e cai-se na estimativa
    }

    isDown = false;
    const now = Date.now();
    const seen = new Set();

    for (const id in payload) {
      if (!Object.prototype.hasOwnProperty.call(payload, id)) continue;
      const p = payload[id];
      if (
        !p ||
        typeof p.latitude !== "number" ||
        typeof p.longitude !== "number"
      ) {
        continue;
      }
      seen.add(id);

      const prev = LIVE.get(id);
      let bearing = prev ? prev.bearing : null;
      if (prev) {
        const moved = distanceKm(prev.lng, prev.lat, p.longitude, p.latitude);
        if (moved >= MIN_MOVE_KM) {
          bearing = computeBearing(prev.lng, prev.lat, p.longitude, p.latitude);
        }
      }

      LIVE.set(id, {
        lat: p.latitude,
        lng: p.longitude,
        bearing,
        ts: now,
      });
    }

    // Comboios que saíram do feed real → removidos do cache (voltam à estimativa).
    for (const id of Array.from(LIVE.keys())) {
      if (!seen.has(id)) {
        LIVE.delete(id);
        HEALTH.delete(id);
      }
    }
  }

  // ─── CONSULTA SÍNCRONA ───────────────────────────────────────────────

  // getPosition(trainId, fertagusPassedCount)
  // fertagusPassedCount = nº de nós já passados no /fertagus (n.ComboioPassou).
  //
  // Regra: um comboio pode estar legitimamente PARADO (GPS não muda) — isso é
  // informação válida e deve aparecer. Só consideramos o GPS MAU se ele estiver
  // congelado E, entretanto, o /fertagus indicar que o comboio avançou ≥1
  // estação (logo, devia ter-se movido). Nesse caso ignoramos o GPS até ele
  // voltar a mexer.
  function getPosition(trainId, fertagusPassedCount) {
    const id = String(trainId);
    const entry = LIVE.get(id);
    if (!entry) return null;
    // Backstop: só largamos a posição real se a TML ficar muda imenso tempo.
    if (Date.now() - entry.ts > MAX_AGE_MS) return null;

    const passed =
      typeof fertagusPassedCount === "number" ? fertagusPassedCount : 0;

    let h = HEALTH.get(id);
    if (!h) {
      h = { lng: entry.lng, lat: entry.lat, passedAtMove: passed, bad: false };
      HEALTH.set(id, h);
      return { lat: entry.lat, lng: entry.lng, bearing: entry.bearing };
    }

    const moved = distanceKm(h.lng, h.lat, entry.lng, entry.lat) > EPS_MOVE_KM;
    if (moved) {
      // GPS vivo → confiar nele e reancorar o ponto de referência.
      h.lng = entry.lng;
      h.lat = entry.lat;
      h.passedAtMove = passed;
      h.bad = false;
    } else if (passed > h.passedAtMove) {
      // GPS congelado mas o /fertagus avançou ≥1 estação → GPS mau.
      h.bad = true;
    }

    if (h.bad) return null; // cai na estimativa até o GPS voltar a mexer
    return { lat: entry.lat, lng: entry.lng, bearing: entry.bearing };
  }

  function hasReal(trainId, fertagusPassedCount) {
    return getPosition(trainId, fertagusPassedCount) != null;
  }

  function isOffline() {
    return isDown;
  }

  window.MapaLive = { refresh, getPosition, hasReal, isOffline };
})();

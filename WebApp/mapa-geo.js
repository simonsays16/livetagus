/**
 * mapa-geo.js
 * Cálculo da posição dos comboios na linha da Fertagus usando Turf.js.
 */

(function () {
  "use strict";

  // Estado interno do módulo ─────────────────────────────────────────────
  let lineFeatures = null; // Array<turf.LineString>
  let stationPositions = null; // { [stationKey]: { featureIdx, locationKm, lng, lat } }
  let initialized = false;
  let featureForwardIsLisboa = {}; // { [featureIdx]: bool | null } — km crescente = sul→norte?

  // ─── HELPERS ─────────────────────────────────────────────────────────

  /**
   * Curva de aceleração mais marcada que o ease-in-out cúbico standard.
   * Usa potência 4 (quartic) → arranque/travagem visivelmente mais lentos
   * que o trajeto a meio. Aproxima melhor o comportamento real do comboio.
   */
  function easeInOut(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;

    // Valores reais baseados na UQE 3500:
    // Demora ~43s a atingir 140km/h a 0.9m/s2.
    // Numa viagem média, isso representa cerca de 25% do tempo total.
    const accelPhase = 0.25;
    const decelPhase = 0.75;

    // Para a matemática bater certo (a distância total ser 1),
    // a velocidade máxima atingida tem de ser um multiplicador constante.
    const vMax = 1 / (1 - accelPhase); // 1.3333...

    if (t < accelPhase) {
      // Fase 1: Aceleração constante a 0.9 m/s²
      // d = 0.5 * a * t^2
      return 0.5 * (vMax / accelPhase) * t * t;
    } else if (t < decelPhase) {
      // Fase 2: Velocidade de cruzeiro constante a 140 km/h
      // A distância já percorrida na Fase 1
      const distPhase1 = 0.5 * vMax * accelPhase;
      return distPhase1 + vMax * (t - accelPhase);
    } else {
      // Fase 3: Travagem constante a 0.9 m/s²
      // Fazemos o inverso da fase de aceleração, vindo do fim (1) para trás
      const tRemaining = 1 - t;
      return 1 - 0.5 * (vMax / accelPhase) * tRemaining * tRemaining;
    }
  }

  function parseTimeHHMMSS(timeStr, now) {
    if (!timeStr || typeof timeStr !== "string") return null;
    if (timeStr.startsWith("HH")) return null; // sentinela "HH:MM:SS" da API
    const parts = timeStr.split(":");
    if (parts.length < 2) return null;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const s = parts[2] ? parseInt(parts[2], 10) : 0;
    if (isNaN(h) || isNaN(m) || isNaN(s)) return null;
    if (h < 0 || h > 27 || m < 0 || m > 59 || s < 0 || s > 59) return null;

    const reference = now instanceof Date ? new Date(now) : new Date();
    const d = new Date(reference);
    d.setHours(h, m, s, 0);

    // Ajuste de fronteira dia operacional (mesma lógica que app-trains.js)
    const nowH = reference.getHours();
    if (nowH < 5 && h >= 18) {
      // madrugada a olhar para comboio da noite anterior
      d.setDate(d.getDate() - 1);
    } else if (nowH >= 20 && h < 5) {
      // noite a olhar para comboio de madrugada
      d.setDate(d.getDate() + 1);
    } else if (nowH >= 18 && h < 16) {
      // noite a olhar para comboio do dia seguinte
      d.setDate(d.getDate() + 1);
    }
    return d;
  }

  /** Calcula o bearing (rotação em graus) entre duas estações. */
  function computeBearing(from, to) {
    if (!from || !to) return 0;
    try {
      const b = turf.bearing(
        turf.point([from.lng, from.lat]),
        turf.point([to.lng, to.lat]),
      );
      return (b + 360) % 360;
    } catch (e) {
      return 0;
    }
  }

  // ─── INICIALIZAÇÃO ───────────────────────────────────────────────────

  function initLineGeometry(geojson) {
    if (!geojson || !Array.isArray(geojson.features)) {
      console.warn("[MapaGeo] GeoJSON inválido, a usar fallback linear");
      lineFeatures = [];
      stationPositions = {};
      featureForwardIsLisboa = {};
      initialized = true;
      return;
    }

    // Normaliza para LineStrings simples (expande MultiLineString)
    lineFeatures = [];
    for (const f of geojson.features) {
      if (!f.geometry) continue;
      if (f.geometry.type === "LineString") {
        lineFeatures.push(
          turf.lineString(f.geometry.coordinates, f.properties || {}),
        );
      } else if (f.geometry.type === "MultiLineString") {
        for (const coords of f.geometry.coordinates) {
          lineFeatures.push(turf.lineString(coords, f.properties || {}));
        }
      }
    }

    if (typeof turf === "undefined") {
      console.error("[MapaGeo] Turf.js não carregado, impossível inicializar");
      stationPositions = {};
      featureForwardIsLisboa = {};
      initialized = true;
      return;
    }

    // Para cada estação, escolhe a feature com o ponto mais próximo.
    stationPositions = {};
    for (const station of MAPA.STATIONS) {
      const pt = turf.point([station.lng, station.lat]);
      let best = null;
      lineFeatures.forEach((feature, idx) => {
        try {
          const np = turf.nearestPointOnLine(feature, pt, {
            units: "kilometers",
          });
          const dist = np.properties.dist;
          if (!best || dist < best.distFromPoint) {
            best = {
              featureIdx: idx,
              distFromPoint: dist,
              locationKm: np.properties.location,
              lng: np.geometry.coordinates[0],
              lat: np.geometry.coordinates[1],
            };
          }
        } catch (e) {
          // nearestPointOnLine pode falhar com coordenadas inválidas; ignora
        }
      });
      stationPositions[station.key] = best || {
        featureIdx: -1,
        distFromPoint: 0,
        locationKm: 0,
        lng: station.lng,
        lat: station.lat,
      };
    }

    // Para cada feature, determina se o sentido de km CRESCENTE corresponde à
    // viagem "lisboa" (sul→norte). Usado para orientar o comboio na linha
    // independentemente do bearing (ruidoso) do GPS.
    featureForwardIsLisboa = {};
    const orderIndex = {};
    (MAPA.STATION_ORDER || []).forEach((key, i) => {
      orderIndex[key] = i; // 0 = mais a sul ... N = mais a norte
    });
    const byFeature = {};
    for (const key in stationPositions) {
      const sp = stationPositions[key];
      if (!sp || sp.featureIdx < 0 || orderIndex[key] == null) continue;
      (byFeature[sp.featureIdx] = byFeature[sp.featureIdx] || []).push({
        km: sp.locationKm,
        oi: orderIndex[key],
      });
    }
    for (const idx in byFeature) {
      const arr = byFeature[idx];
      if (arr.length < 2) {
        featureForwardIsLisboa[idx] = null; // indeterminado → fallback latitude
        continue;
      }
      let lo = arr[0];
      let hi = arr[0];
      for (const s of arr) {
        if (s.km < lo.km) lo = s;
        if (s.km > hi.km) hi = s;
      }
      // km cresce de lo→hi; é "lisboa" se a estação de maior km for mais a norte.
      featureForwardIsLisboa[idx] = hi.oi > lo.oi;
    }

    initialized = true;
  }

  // ─── CÁLCULO DE POSIÇÃO ──────────────────────────────────────────────

  function interpolateAlongLine(stationA, stationB, fraction) {
    const posA = stationPositions[stationA.key];
    const posB = stationPositions[stationB.key];
    const fractionClamped = Math.max(0, Math.min(1, fraction));

    // Caso ideal: estações na mesma feature → slice e along
    if (
      posA &&
      posB &&
      posA.featureIdx >= 0 &&
      posA.featureIdx === posB.featureIdx
    ) {
      try {
        const feature = lineFeatures[posA.featureIdx];
        const startKm = Math.min(posA.locationKm, posB.locationKm);
        const endKm = Math.max(posA.locationKm, posB.locationKm);
        const slice = turf.lineSliceAlong(feature, startKm, endKm, {
          units: "kilometers",
        });
        const sliceLen = turf.length(slice, { units: "kilometers" });
        const reverse = posA.locationKm > posB.locationKm;
        const distKm =
          (reverse ? 1 - fractionClamped : fractionClamped) * sliceLen;
        const pt = turf.along(slice, distKm, { units: "kilometers" });
        const lookAheadStep = 0.01;
        let ptAhead;
        let realBearing;

        if (!reverse) {
          if (distKm + lookAheadStep <= sliceLen) {
            ptAhead = turf.along(slice, distKm + lookAheadStep, {
              units: "kilometers",
            });
            realBearing = turf.bearing(pt, ptAhead);
          } else {
            ptAhead = turf.along(slice, distKm - lookAheadStep, {
              units: "kilometers",
            });
            realBearing = turf.bearing(ptAhead, pt);
          }
        } else {
          if (distKm - lookAheadStep >= 0) {
            ptAhead = turf.along(slice, distKm - lookAheadStep, {
              units: "kilometers",
            });
            realBearing = turf.bearing(pt, ptAhead);
          } else {
            ptAhead = turf.along(slice, distKm + lookAheadStep, {
              units: "kilometers",
            });
            realBearing = turf.bearing(ptAhead, pt);
          }
        }

        return {
          lng: pt.geometry.coordinates[0],
          lat: pt.geometry.coordinates[1],
          bearing: (realBearing + 360) % 360,
        };
      } catch (e) {
        // cai em fallback linear
      }
    }

    // Fallback: interpolação linear entre coordenadas das estações.
    return {
      lng: stationA.lng + (stationB.lng - stationA.lng) * fractionClamped,
      lat: stationA.lat + (stationB.lat - stationA.lat) * fractionClamped,
      bearing: computeBearing(stationA, stationB),
    };
  }

  /**
   * Projeta uma coordenada GPS para o ponto mais próximo SOBRE a linha e
   * devolve o rumo da própria linha nesse ponto, orientado pela direção de
   * viagem ("lisboa" = sul→norte; "margem" = norte→sul). Garante que o comboio
   * fica sempre nos carris e sempre orientado pela linha (estável nas estações).
   * Devolve null se a geometria não estiver pronta.
   */
  function snapToLine(lng, lat, direction) {
    if (!initialized || !lineFeatures || lineFeatures.length === 0) return null;
    if (typeof turf === "undefined") return null;
    if (typeof lng !== "number" || typeof lat !== "number") return null;

    const pt = turf.point([lng, lat]);
    let best = null;
    lineFeatures.forEach((feature, idx) => {
      try {
        const np = turf.nearestPointOnLine(feature, pt, {
          units: "kilometers",
        });
        if (!best || np.properties.dist < best.dist) {
          best = {
            idx,
            dist: np.properties.dist,
            locationKm: np.properties.location,
            lng: np.geometry.coordinates[0],
            lat: np.geometry.coordinates[1],
          };
        }
      } catch (_) {}
    });
    if (!best) return null;

    let bearing = 0;
    try {
      const feature = lineFeatures[best.idx];
      const featLen = turf.length(feature, { units: "kilometers" });
      const step = 0.02; // ~20 m de cada lado para a tangente

      let kmA = best.locationKm - step;
      let kmB = best.locationKm + step;
      if (kmA < 0) {
        kmA = 0;
        kmB = Math.min(featLen, 2 * step);
      }
      if (kmB > featLen) {
        kmB = featLen;
        kmA = Math.max(0, featLen - 2 * step);
      }

      const pA = turf.along(feature, kmA, { units: "kilometers" });
      const pB = turf.along(feature, kmB, { units: "kilometers" });
      // Tangente no sentido de km CRESCENTE.
      const tangentInc = turf.bearing(pA, pB);

      let forwardIsLisboa = featureForwardIsLisboa[best.idx];
      if (forwardIsLisboa == null) {
        // Fallback grosseiro: assume norte = lisboa pela latitude da tangente.
        forwardIsLisboa =
          pB.geometry.coordinates[1] >= pA.geometry.coordinates[1];
      }

      const goingLisboa = direction !== "margem"; // default: lisboa
      bearing = goingLisboa === forwardIsLisboa ? tangentInc : tangentInc + 180;
      bearing = (bearing + 360) % 360;
    } catch (_) {
      bearing = 0;
    }

    return { lng: best.lng, lat: best.lat, bearing };
  }

  /**
   * Devolve o ponto exato da estação na linha (projetado, não o ponto CRS).
   */
  function pointForStation(station) {
    const pos = stationPositions[station.key];
    if (pos && pos.featureIdx >= 0) return { lng: pos.lng, lat: pos.lat };
    return { lng: station.lng, lat: station.lat };
  }

  function findCurrentLeg(nodes) {
    if (!nodes || !nodes.length) return { phase: "invalid" };
    const allDone = nodes.every((n) => n.ComboioPassou);
    if (allDone) {
      return { phase: "done", prevIdx: nodes.length - 1, nextIdx: -1 };
    }
    const nonePassed = nodes.every((n) => !n.ComboioPassou);
    if (nonePassed) {
      return { phase: "before", prevIdx: -1, nextIdx: 0 };
    }
    for (let i = 0; i < nodes.length - 1; i++) {
      if (nodes[i].ComboioPassou && !nodes[i + 1].ComboioPassou) {
        return { phase: "between", prevIdx: i, nextIdx: i + 1 };
      }
    }
    // Estado estranho — fallback
    return {
      phase: "between",
      prevIdx: nodes.length - 2,
      nextIdx: nodes.length - 1,
    };
  }

  /**
   * Quanto tempo o comboio fica parado nesta estação ANTES de partir para
   * o próximo segmento. Para estações iniciais (Setúbal, Coina,
   * Roma-Areeiro) NA POSIÇÃO INICIAL do percurso o tempo é zero — o comboio
   * arranca imediatamente à hora marcada.
   */
  function headBoardingMs(prevStation) {
    if (
      prevStation &&
      MAPA.INITIAL_STATION_KEYS &&
      MAPA.INITIAL_STATION_KEYS.has(prevStation.key)
    ) {
      return 0;
    }
    return MAPA.BOARDING_HEAD_MS;
  }

  function computeTrainPosition(train, now) {
    if (!initialized) return null;
    if (!train) return null;

    const nodes = train.nodes || train.fullSchedule;
    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) return null;

    const reference = now instanceof Date ? new Date(now) : new Date();
    const nowTs = reference.getTime();

    const leg = findCurrentLeg(nodes);

    // ─── CASO: ainda não partiu ──────────────────────────────────────
    if (leg.phase === "before") {
      const first = MAPA.resolveStationByApiName(nodes[0].NomeEstacao);
      const second = MAPA.resolveStationByApiName(
        nodes[1] && nodes[1].NomeEstacao,
      );
      if (!first) return null;

      const pos = second
        ? interpolateAlongLine(first, second, 0)
        : { ...pointForStation(first), bearing: 0 };

      return {
        ...pos,
        bearing:
          pos.bearing !== undefined
            ? pos.bearing
            : second
              ? computeBearing(first, second)
              : 0,
        segment: "before",
        prevStation: null,
        nextStation: first,
        progress: 0,
      };
    }

    // ─── CASO: chegou ao destino ────────────────────────────────────
    if (leg.phase === "done") {
      const last = MAPA.resolveStationByApiName(
        nodes[nodes.length - 1].NomeEstacao,
      );
      if (!last) return null;
      const prev = MAPA.resolveStationByApiName(
        nodes[nodes.length - 2] && nodes[nodes.length - 2].NomeEstacao,
      );

      const pos = prev
        ? interpolateAlongLine(prev, last, 1)
        : { ...pointForStation(last), bearing: 0 };

      return {
        ...pos,
        bearing:
          pos.bearing !== undefined
            ? pos.bearing
            : prev
              ? computeBearing(prev, last)
              : 0,
        segment: "done",
        prevStation: prev,
        nextStation: null,
        progress: 1,
      };
    }

    // ─── CASO: entre dois nós ───────────────────────────────────────
    const prevNode = nodes[leg.prevIdx];
    const nextNode = nodes[leg.nextIdx];
    const prevStation = MAPA.resolveStationByApiName(prevNode.NomeEstacao);
    const nextStation = MAPA.resolveStationByApiName(nextNode.NomeEstacao);
    if (!prevStation || !nextStation) return null;

    const prevRealStr =
      prevNode.HoraReal && !prevNode.HoraReal.startsWith("HH")
        ? prevNode.HoraReal
        : prevNode.HoraPrevista || prevNode.HoraProgramada;
    const nextPredStr =
      nextNode.HoraPrevista && !nextNode.HoraPrevista.startsWith("HH")
        ? nextNode.HoraPrevista
        : nextNode.HoraProgramada;

    const prevReal = parseTimeHHMMSS(prevRealStr, reference);
    const nextPred = parseTimeHHMMSS(nextPredStr, reference);

    // Sem timing válido — comboio estático no último ponto conhecido.
    if (!prevReal || !nextPred) {
      const pos = interpolateAlongLine(prevStation, nextStation, 0);
      return {
        ...pos,
        bearing:
          pos.bearing !== undefined
            ? pos.bearing
            : computeBearing(prevStation, nextStation),
        segment: "boarding",
        prevStation,
        nextStation,
        progress: 0,
      };
    }

    // Calcula os intervalos com timings assimétricos:
    //   • departTs: hora real de chegada à estação A + tempo de embarque
    //   • arriveTs: hora prevista de chegada a B − 20 s (tail boarding)
    const head = headBoardingMs(prevStation);
    const departTs = prevReal.getTime() + head;
    const arriveTs = nextPred.getTime() - MAPA.BOARDING_TAIL_MS;

    // Troço demasiado curto — devolve o ponto médio como aproximação.
    if (arriveTs <= departTs) {
      const pos = interpolateAlongLine(prevStation, nextStation, 0.5);
      return {
        ...pos,
        bearing:
          pos.bearing !== undefined
            ? pos.bearing
            : computeBearing(prevStation, nextStation),
        segment: "moving",
        prevStation,
        nextStation,
        progress: 0.5,
      };
    }

    // Ainda a embarcar em A
    if (nowTs < departTs) {
      const pos = interpolateAlongLine(prevStation, nextStation, 0);
      return {
        ...pos,
        bearing:
          pos.bearing !== undefined
            ? pos.bearing
            : computeBearing(prevStation, nextStation),
        segment: "boarding",
        prevStation,
        nextStation,
        progress: 0,
      };
    }

    // Já chegou (ou está a aproximar-se) a B, mas API ainda não atualizou
    if (nowTs >= arriveTs) {
      const pos = interpolateAlongLine(prevStation, nextStation, 1);
      return {
        ...pos,
        bearing:
          pos.bearing !== undefined
            ? pos.bearing
            : computeBearing(prevStation, nextStation),
        segment: "approaching",
        prevStation,
        nextStation,
        progress: 1,
      };
    }

    // Em movimento — aplica ease-in-out (quartic) ao progresso temporal
    const rawProgress = (nowTs - departTs) / (arriveTs - departTs);
    const easedProgress = easeInOut(rawProgress);
    const pos = interpolateAlongLine(prevStation, nextStation, easedProgress);
    return {
      ...pos,
      bearing:
        pos.bearing !== undefined
          ? pos.bearing
          : computeBearing(prevStation, nextStation),
      segment: "moving",
      prevStation,
      nextStation,
      progress: easedProgress,
    };
  }

  // ─── EXPORT ──────────────────────────────────────────────────────────
  window.MapaGeo = {
    easeInOut,
    parseTimeHHMMSS,
    initLineGeometry,
    computeTrainPosition,
    snapToLine,
    getStationPositions: () => stationPositions,
    getLineFeatures: () => lineFeatures,
    isInitialized: () => initialized,
    // Expostos para testes
    _computeBearing: computeBearing,
    _findCurrentLeg: findCurrentLeg,
    _interpolateAlongLine: interpolateAlongLine,
    _headBoardingMs: headBoardingMs,
  };
})();

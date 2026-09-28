/**
 * turf-lite.js · LiveTagus (mapa)
 * As funções do turf que o mapa usa, sem a biblioteca inteira.
 *
 * O turf.min.js completo são 550 KB de JavaScript (139 KB em rede), e estava
 * no caminho crítico: o mapa-geo.js precisa dele para pôr os comboios da
 * Fertagus no sítio, portanto nada aparecia antes de o telemóvel o
 * descarregar e analisar. Das centenas de funções só se usam estas:
 *
 *   point, lineString, bearing, distance, destination,
 *   along, length, lineSliceAlong, nearestPointOnLine
 *
 * A matemática é a do @turf/turf 7.2.0, copiada passo a passo e pela mesma
 * ordem de operações — os resultados são iguais ao bit, não apenas próximos.
 * O teste compara-os com a biblioteca verdadeira sobre a linha real.
 *
 * Uma função que não esteja aqui REBENTA com uma mensagem clara, em vez de
 * devolver undefined e deixar um comboio no sítio errado sem ninguém saber.
 * Se isso acontecer, é acrescentá-la aqui ou voltar a carregar o turf.
 *
 * O simplify não está: o mapa-cp.js só o usa com LINES_SOURCE = "bundle", e já
 * funciona sem ele (desenha a geometria sem simplificar).
 */

(function () {
  "use strict";
  if (window.turf) return; // o turf verdadeiro já está carregado: fica esse

  // ─── helpers (@turf/helpers, @turf/invariant) ───────────────────────────
  const earthRadius = 63710088e-1;
  const factors = {
    centimeters: earthRadius * 100,
    centimetres: earthRadius * 100,
    degrees: 360 / (2 * Math.PI),
    feet: earthRadius * 3.28084,
    inches: earthRadius * 39.37,
    kilometers: earthRadius / 1e3,
    kilometres: earthRadius / 1e3,
    km: earthRadius / 1e3,
    meters: earthRadius,
    metres: earthRadius,
    miles: earthRadius / 1609.344,
    millimeters: earthRadius * 1e3,
    millimetres: earthRadius * 1e3,
    nauticalmiles: earthRadius / 1852,
    radians: 1,
    yards: earthRadius * 1.0936,
  };

  function degreesToRadians(degrees) {
    const normalisedDegrees = degrees % 360;
    return (normalisedDegrees * Math.PI) / 180;
  }
  function radiansToDegrees(radians) {
    const normalisedRadians = radians % (2 * Math.PI);
    return (normalisedRadians * 180) / Math.PI;
  }
  function radiansToLength(radians, units = "kilometers") {
    const factor = factors[units];
    if (!factor) throw new Error(units + " units is invalid");
    return radians * factor;
  }
  function lengthToRadians(distance, units = "kilometers") {
    const factor = factors[units];
    if (!factor) throw new Error(units + " units is invalid");
    return distance / factor;
  }

  function isNumber(n) {
    return !isNaN(n) && n !== null && !Array.isArray(n);
  }

  function feature(geom, properties, options = {}) {
    const feat = { type: "Feature" };
    if (options.id === 0 || options.id) feat.id = options.id;
    if (options.bbox) feat.bbox = options.bbox;
    feat.properties = properties || {};
    feat.geometry = geom;
    return feat;
  }

  function point(coordinates, properties, options = {}) {
    if (!coordinates) throw new Error("coordinates is required");
    if (!Array.isArray(coordinates))
      throw new Error("coordinates must be an Array");
    if (coordinates.length < 2)
      throw new Error("coordinates must be at least 2 numbers long");
    if (!isNumber(coordinates[0]) || !isNumber(coordinates[1]))
      throw new Error("coordinates must contain numbers");
    return feature({ type: "Point", coordinates }, properties, options);
  }

  function lineString(coordinates, properties, options = {}) {
    if (coordinates.length < 2)
      throw new Error("coordinates must be an array of two or more positions");
    return feature({ type: "LineString", coordinates }, properties, options);
  }

  function getCoord(coord) {
    if (!coord) throw new Error("coord is required");
    if (!Array.isArray(coord)) {
      if (
        coord.type === "Feature" &&
        coord.geometry !== null &&
        coord.geometry.type === "Point"
      )
        return [...coord.geometry.coordinates];
      if (coord.type === "Point") return [...coord.coordinates];
    }
    if (
      Array.isArray(coord) &&
      coord.length >= 2 &&
      !Array.isArray(coord[0]) &&
      !Array.isArray(coord[1])
    )
      return [...coord];
    throw new Error("coord must be GeoJSON Point or an Array of numbers");
  }

  function getCoords(coords) {
    if (Array.isArray(coords)) return coords;
    if (coords.type === "Feature") {
      if (coords.geometry !== null) return coords.geometry.coordinates;
    } else if (coords.coordinates) {
      return coords.coordinates;
    }
    throw new Error(
      "coords must be GeoJSON Feature, Geometry Object or an Array",
    );
  }

  function getGeom(geojson) {
    if (geojson.type === "Feature") return geojson.geometry;
    return geojson;
  }

  // Percorre as LineStrings de qualquer entrada, como o flattenEach do turf:
  // callback(linha, featureIndex, multiFeatureIndex).
  function flattenLines(geojson, callback) {
    const visitar = (geom, featureIndex) => {
      if (!geom) return;
      if (geom.type === "LineString")
        callback(geom.coordinates, featureIndex, 0);
      else if (geom.type === "MultiLineString")
        geom.coordinates.forEach((c, m) => callback(c, featureIndex, m));
      else if (geom.type === "GeometryCollection")
        geom.geometries.forEach((g) => visitar(g, featureIndex));
    };
    if (geojson.type === "FeatureCollection")
      geojson.features.forEach((f, i) => visitar(f.geometry, i));
    else if (geojson.type === "Feature") visitar(geojson.geometry, 0);
    else visitar(geojson, 0);
  }

  // ─── @turf/distance, bearing, destination ───────────────────────────────
  function distance(from, to, options = {}) {
    const coordinates1 = getCoord(from);
    const coordinates2 = getCoord(to);
    const dLat = degreesToRadians(coordinates2[1] - coordinates1[1]);
    const dLon = degreesToRadians(coordinates2[0] - coordinates1[0]);
    const lat1 = degreesToRadians(coordinates1[1]);
    const lat2 = degreesToRadians(coordinates2[1]);
    const a =
      Math.pow(Math.sin(dLat / 2), 2) +
      Math.pow(Math.sin(dLon / 2), 2) * Math.cos(lat1) * Math.cos(lat2);
    return radiansToLength(
      2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)),
      options.units,
    );
  }

  function bearing(start, end, options = {}) {
    if (options.final === true) {
      let bear = bearing(end, start);
      bear = (bear + 180) % 360;
      return bear > 180 ? bear - 360 : bear;
    }
    const coordinates1 = getCoord(start);
    const coordinates2 = getCoord(end);
    const lon1 = degreesToRadians(coordinates1[0]);
    const lon2 = degreesToRadians(coordinates2[0]);
    const lat1 = degreesToRadians(coordinates1[1]);
    const lat2 = degreesToRadians(coordinates2[1]);
    const a = Math.sin(lon2 - lon1) * Math.cos(lat2);
    const b =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
    return radiansToDegrees(Math.atan2(a, b));
  }

  function destination(origin, distanceV, bearingV, options = {}) {
    const coordinates1 = getCoord(origin);
    const longitude1 = degreesToRadians(coordinates1[0]);
    const latitude1 = degreesToRadians(coordinates1[1]);
    const bearingRad = degreesToRadians(bearingV);
    const radians = lengthToRadians(distanceV, options.units);
    const latitude2 = Math.asin(
      Math.sin(latitude1) * Math.cos(radians) +
        Math.cos(latitude1) * Math.sin(radians) * Math.cos(bearingRad),
    );
    const longitude2 =
      longitude1 +
      Math.atan2(
        Math.sin(bearingRad) * Math.sin(radians) * Math.cos(latitude1),
        Math.cos(radians) - Math.sin(latitude1) * Math.sin(latitude2),
      );
    const lng = radiansToDegrees(longitude2);
    const lat = radiansToDegrees(latitude2);
    if (coordinates1[2] !== undefined)
      return point([lng, lat, coordinates1[2]], options.properties);
    return point([lng, lat], options.properties);
  }

  // ─── @turf/along, length, line-slice-along ──────────────────────────────
  function along(line, distanceV, options = {}) {
    const geom = getGeom(line);
    const coords = geom.coordinates;
    let travelled = 0;
    for (let i = 0; i < coords.length; i++) {
      if (distanceV >= travelled && i === coords.length - 1) {
        break;
      } else if (travelled >= distanceV) {
        const overshot = distanceV - travelled;
        if (!overshot) {
          return point(coords[i]);
        } else {
          const direction = bearing(coords[i], coords[i - 1]) - 180;
          return destination(coords[i], overshot, direction, options);
        }
      } else {
        travelled += distance(coords[i], coords[i + 1], options);
      }
    }
    return point(coords[coords.length - 1]);
  }

  function length(geojson, options = {}) {
    let total = 0;
    flattenLines(geojson, (coords) => {
      for (let i = 0; i < coords.length - 1; i++) {
        total += distance(coords[i], coords[i + 1], options);
      }
    });
    return total;
  }

  function lineSliceAlong(line, startDist, stopDist, options = {}) {
    if (
      options === null ||
      typeof options !== "object" ||
      Array.isArray(options)
    )
      throw new Error("options is invalid");
    const { units = "kilometers" } = options;
    let coords;
    const slice = [];
    if (line.type === "Feature") coords = line.geometry.coordinates;
    else if (line.type === "LineString") coords = line.coordinates;
    else throw new Error("input must be a LineString Feature or Geometry");
    const origCoordsLength = coords.length;
    let travelled = 0;
    let overshot, direction, interpolated;
    for (let i = 0; i < coords.length; i++) {
      if (startDist >= travelled && i === coords.length - 1) break;
      else if (travelled > startDist && slice.length === 0) {
        const overshot2 = startDist - travelled;
        if (!overshot2) {
          slice.push(coords[i]);
          return lineString(slice);
        }
        direction = bearing(coords[i], coords[i - 1]) - 180;
        interpolated = destination(coords[i], overshot2, direction, { units });
        slice.push(interpolated.geometry.coordinates);
      }
      if (travelled >= stopDist) {
        overshot = stopDist - travelled;
        if (!overshot) {
          slice.push(coords[i]);
          return lineString(slice);
        }
        direction = bearing(coords[i], coords[i - 1]) - 180;
        interpolated = destination(coords[i], overshot, direction, { units });
        slice.push(interpolated.geometry.coordinates);
        return lineString(slice);
      }
      if (travelled >= startDist) {
        slice.push(coords[i]);
      }
      if (i === coords.length - 1) {
        return lineString(slice);
      }
      travelled += distance(coords[i], coords[i + 1], { units });
    }
    if (travelled < startDist && coords.length === origCoordsLength)
      throw new Error("Start position is beyond line");
    const last = coords[coords.length - 1];
    return lineString([last, last]);
  }

  // ─── @turf/nearest-point-on-line ────────────────────────────────────────
  function dot(v1, v2) {
    return v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  }
  function cross(v1, v2) {
    return [
      v1[1] * v2[2] - v1[2] * v2[1],
      v1[2] * v2[0] - v1[0] * v2[2],
      v1[0] * v2[1] - v1[1] * v2[0],
    ];
  }
  function magnitude(v) {
    return Math.sqrt(Math.pow(v[0], 2) + Math.pow(v[1], 2) + Math.pow(v[2], 2));
  }
  function normalize(v) {
    const mag = magnitude(v);
    return [v[0] / mag, v[1] / mag, v[2] / mag];
  }
  function lngLatToVector(a) {
    const lat = degreesToRadians(a[1]);
    const lng = degreesToRadians(a[0]);
    return [
      Math.cos(lat) * Math.cos(lng),
      Math.cos(lat) * Math.sin(lng),
      Math.sin(lat),
    ];
  }
  function vectorToLngLat(v) {
    const zClamp = Math.min(Math.max(v[2], -1), 1);
    const lat = radiansToDegrees(Math.asin(zClamp));
    const lng = radiansToDegrees(Math.atan2(v[1], v[0]));
    return [lng, lat];
  }
  function nearestPointOnSegment(posA, posB, posC) {
    const A = lngLatToVector(posA);
    const B = lngLatToVector(posB);
    const C = lngLatToVector(posC);
    const segmentAxis = cross(A, B);
    if (segmentAxis[0] === 0 && segmentAxis[1] === 0 && segmentAxis[2] === 0) {
      if (dot(A, B) > 0) return [[...posB], true];
      return [[...posC], false];
    }
    const targetAxis = cross(segmentAxis, C);
    if (targetAxis[0] === 0 && targetAxis[1] === 0 && targetAxis[2] === 0)
      return [[...posB], true];
    const intersectionAxis = cross(targetAxis, segmentAxis);
    const I1 = normalize(intersectionAxis);
    const I2 = [-I1[0], -I1[1], -I1[2]];
    const I = dot(C, I1) > dot(C, I2) ? I1 : I2;
    const segmentAxisNorm = normalize(segmentAxis);
    const cmpAI = dot(cross(A, I), segmentAxisNorm);
    const cmpIB = dot(cross(I, B), segmentAxisNorm);
    if (cmpAI >= 0 && cmpIB >= 0) return [vectorToLngLat(I), false];
    if (dot(A, C) > dot(B, C)) return [[...posA], false];
    return [[...posB], true];
  }

  function nearestPointOnLine(lines, inputPoint, options = {}) {
    if (!lines || !inputPoint)
      throw new Error("lines and inputPoint are required arguments");
    const inputPos = getCoord(inputPoint);
    let closestPt = point([Infinity, Infinity], {
      lineStringIndex: -1,
      segmentIndex: -1,
      totalDistance: -1,
      lineDistance: -1,
      segmentDistance: -1,
      pointDistance: Infinity,
      multiFeatureIndex: -1,
      index: -1,
      location: -1,
      dist: Infinity,
    });
    let totalDistance = 0;
    let lineDistance = 0;
    let currentLineStringIndex = -1;
    flattenLines(lines, (coords, _featureIndex, lineStringIndex) => {
      if (currentLineStringIndex !== lineStringIndex) {
        currentLineStringIndex = lineStringIndex;
        lineDistance = 0;
      }
      for (let i = 0; i < coords.length - 1; i++) {
        const startPos = getCoord(coords[i]);
        const stopPos = getCoord(coords[i + 1]);
        const segmentLength = distance(startPos, stopPos, options);
        let intersectPos;
        let wasEnd;
        if (stopPos[0] === inputPos[0] && stopPos[1] === inputPos[1]) {
          [intersectPos, wasEnd] = [stopPos, true];
        } else if (startPos[0] === inputPos[0] && startPos[1] === inputPos[1]) {
          [intersectPos, wasEnd] = [startPos, false];
        } else {
          [intersectPos, wasEnd] = nearestPointOnSegment(
            startPos,
            stopPos,
            inputPos,
          );
        }
        const pointDistance = distance(inputPoint, intersectPos, options);
        if (pointDistance < closestPt.properties.pointDistance) {
          const segmentDistance = distance(startPos, intersectPos, options);
          closestPt = point(intersectPos, {
            lineStringIndex,
            segmentIndex: wasEnd ? i + 1 : i,
            totalDistance: totalDistance + segmentDistance,
            lineDistance: lineDistance + segmentDistance,
            segmentDistance,
            pointDistance,
            multiFeatureIndex: -1,
            index: -1,
            location: -1,
            dist: Infinity,
          });
          const p = closestPt.properties;
          closestPt.properties = Object.assign({}, p, {
            multiFeatureIndex: p.lineStringIndex,
            index: p.segmentIndex,
            location: p.totalDistance,
            dist: p.pointDistance,
          });
        }
        totalDistance += segmentLength;
        lineDistance += segmentLength;
      }
    });
    return closestPt;
  }

  const impl = {
    point,
    lineString,
    feature,
    bearing,
    distance,
    destination,
    along,
    length,
    lineSliceAlong,
    nearestPointOnLine,
    degreesToRadians,
    radiansToDegrees,
    lengthToRadians,
    radiansToLength,
    getCoord,
    getCoords,
    __lite: true,
  };

  // Uma função em falta rebenta com nome e causa, em vez de devolver undefined.
  window.turf =
    typeof Proxy === "function"
      ? new Proxy(impl, {
          get(alvo, nome) {
            if (nome in alvo) return alvo[nome];
            if (
              typeof nome !== "string" ||
              nome === "then" ||
              nome === "toJSON"
            )
              return undefined;
            return function () {
              throw new Error(
                `turf-lite: turf.${nome} não existe aqui. Acrescenta-a ao turf-lite.js ou volta a carregar o turf completo.`,
              );
            };
          },
        })
      : impl;
})();

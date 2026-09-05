/**
 * mapa-linha.js · LiveTagus (mapa)
 * Geometria da linha da Fertagus: onde estão as coisas AO LONGO dos carris.
 *
 * Serve para desenhar cada carruagem como uma fatia da própria linha, em vez
 * de uma barra recta rodada pelo rumo. Uma barra recta só pode ser recta: em
 * curva, o comboio inteiro toma o ângulo de um ponto só e as carruagens das
 * pontas saem dos carris. Uma fatia da linha acompanha o traçado por
 * construção, porque É o traçado.
 *
 * Tudo assenta num array de distâncias acumuladas construído uma vez:
 *   - projectar(lng, lat) → a que metro da linha está este ponto
 *   - fatia(d0, d1)       → as coordenadas entre dois metros
 *
 * Custos, para a linha real (1134 vértices, 54 km):
 *   - o array acumulado ocupa 9 KB e é construído numa passagem;
 *   - cada fatia é uma pesquisa binária (~10 passos) mais 1 a 3 vértices;
 *   - projectar é O(n), mas com uma pista da posição anterior passa a olhar
 *     só para a vizinhança — e os comboios andam sempre para a frente.
 *
 * API:
 *   MapaLinha.carregar(geojson) → true se ficou pronta
 *   MapaLinha.pronta()
 *   MapaLinha.comprimento()            metros
 *   MapaLinha.projectar(lng, lat, pista?) → { m, dist } | null
 *   MapaLinha.fatia(d0, d1)            → [[lng,lat], …]
 *   MapaLinha.ponto(d)                 → [lng,lat] | null
 */

(function () {
  "use strict";
  if (window.MapaLinha) return;

  const R = 6371000;
  const RAD = Math.PI / 180;

  let pts = null; // Float64Array [lng0, lat0, lng1, lat1, …]
  let acum = null; // Float64Array de distâncias acumuladas, n entradas
  let n = 0;

  // Metros entre dois pontos, em projecção local. A latitude da Fertagus varia
  // meio grau; a aproximação plana erra menos de um metro em 54 km, e poupa a
  // trigonometria toda da fórmula de haversine.
  function metros(lng1, lat1, lng2, lat2) {
    const k = Math.cos(((lat1 + lat2) / 2) * RAD);
    const dx = (lng2 - lng1) * k * RAD * R;
    const dy = (lat2 - lat1) * RAD * R;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function extrairCoords(geojson) {
    if (!geojson) return null;
    const g =
      geojson.type === "FeatureCollection"
        ? (geojson.features || []).map((f) => f && f.geometry).filter(Boolean)[0]
        : geojson.type === "Feature"
          ? geojson.geometry
          : geojson;
    if (!g) return null;
    if (g.type === "LineString") return g.coordinates;
    if (g.type === "MultiLineString") {
      // Junta as partes pela ordem em que vêm. Se o ficheiro alguma vez passar
      // a ter ramais, isto deixa de fazer sentido e é preciso repensar.
      const out = [];
      for (const parte of g.coordinates) out.push(...parte);
      return out;
    }
    return null;
  }

  /**
   * Deita fora vértices que não avançam ou que recuam sobre si próprios.
   *
   * A linha real tem um defeito ao km 2,75 (zona de Sete Rios): avança 4,2 m,
   * volta EXACTAMENTE ao ponto anterior, e segue. Com a barra recta ninguém
   * reparava; com fatias da geometria, uma carruagem que apanhasse esse ponto
   * era desenhada a ir e a vir. Limpar aqui apanha este caso e quaisquer
   * outros iguais que apareçam numa actualização da linha.
   */
  function limpar(coords) {
    const out = [];
    let removidosDup = 0;
    let removidosRecuo = 0;
    for (const c of coords) {
      if (!c || c.length < 2 || !isFinite(c[0]) || !isFinite(c[1])) continue;
      const ult = out[out.length - 1];
      if (ult && metros(ult[0], ult[1], c[0], c[1]) < 0.5) {
        removidosDup++;
        continue; // ponto repetido
      }
      // Recuo: o novo ponto está mais perto do penúltimo do que o último está.
      // É a assinatura de um pico de digitalização.
      const pen = out[out.length - 2];
      if (pen && ult) {
        const aFrente = metros(pen[0], pen[1], c[0], c[1]);
        const passo = metros(pen[0], pen[1], ult[0], ult[1]);
        if (aFrente < passo * 0.5) {
          out.pop(); // o último era o pico: fora
          removidosRecuo++;
        }
      }
      out.push(c);
    }
    if (removidosDup || removidosRecuo) {
      console.info(
        `[MapaLinha] geometria limpa: ${removidosDup} pontos repetidos, ${removidosRecuo} recuos.`,
      );
    }
    return out;
  }

  function carregar(geojson) {
    const bruto = extrairCoords(geojson);
    if (!bruto || bruto.length < 2) {
      console.warn("[MapaLinha] geometria inutilizável.");
      return false;
    }
    const coords = limpar(bruto);
    n = coords.length;
    pts = new Float64Array(n * 2);
    acum = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      pts[i * 2] = coords[i][0];
      pts[i * 2 + 1] = coords[i][1];
      if (i > 0) {
        acum[i] =
          acum[i - 1] +
          metros(pts[i * 2 - 2], pts[i * 2 - 1], pts[i * 2], pts[i * 2 + 1]);
      }
    }
    console.info(
      `[MapaLinha] ${n} vértices · ${(acum[n - 1] / 1000).toFixed(1)} km.`,
    );
    return true;
  }

  const pronta = () => !!acum && n > 1;
  const comprimento = () => (pronta() ? acum[n - 1] : 0);

  // Índice do último vértice a uma distância <= d. Pesquisa binária.
  function indiceEm(d) {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (acum[mid] <= d) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  function ponto(d) {
    if (!pronta()) return null;
    const total = acum[n - 1];
    if (d <= 0) return [pts[0], pts[1]];
    if (d >= total) return [pts[n * 2 - 2], pts[n * 2 - 1]];
    const i = indiceEm(d);
    if (i >= n - 1) return [pts[n * 2 - 2], pts[n * 2 - 1]];
    const seg = acum[i + 1] - acum[i];
    const t = seg > 0 ? (d - acum[i]) / seg : 0;
    return [
      pts[i * 2] + (pts[i * 2 + 2] - pts[i * 2]) * t,
      pts[i * 2 + 1] + (pts[i * 2 + 3] - pts[i * 2 + 1]) * t,
    ];
  }

  /**
   * Coordenadas da linha entre dois metros, pontas incluídas.
   * Devolve sempre pelo menos dois pontos, para dar uma geometria válida.
   */
  function fatia(d0, d1) {
    if (!pronta()) return [];
    const total = acum[n - 1];
    let a = Math.max(0, Math.min(d0, d1));
    let b = Math.min(total, Math.max(d0, d1));
    if (b <= a) b = Math.min(total, a + 0.5);
    const out = [ponto(a)];
    let i = indiceEm(a) + 1;
    while (i < n && acum[i] < b) {
      out.push([pts[i * 2], pts[i * 2 + 1]]);
      i++;
    }
    out.push(ponto(b));
    return out;
  }

  /**
   * A que metro da linha fica este ponto.
   * @param {number} pista  metro aproximado onde procurar primeiro (a posição
   *   anterior do mesmo comboio). Com pista, olha só para ±JANELA metros à
   *   volta; sem ela, percorre a linha toda.
   */
  const JANELA = 1500; // metros de margem à volta da pista

  function projectar(lng, lat, pista) {
    if (!pronta()) return null;
    let iniI = 0;
    let fimI = n - 1;
    if (typeof pista === "number" && isFinite(pista)) {
      iniI = indiceEm(Math.max(0, pista - JANELA));
      fimI = indiceEm(Math.min(acum[n - 1], pista + JANELA)) + 1;
      if (fimI > n - 1) fimI = n - 1;
    }
    let melhorD2 = Infinity;
    let melhorM = 0;
    const k = Math.cos(lat * RAD);
    for (let i = iniI; i < fimI; i++) {
      const ax = pts[i * 2];
      const ay = pts[i * 2 + 1];
      const bx = pts[i * 2 + 2];
      const by = pts[i * 2 + 3];
      // Em graus, com a longitude corrigida pela latitude: as comparações são
      // relativas, por isso não vale a pena converter para metros no ciclo.
      const dx = (bx - ax) * k;
      const dy = by - ay;
      const px = (lng - ax) * k;
      const py = lat - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? (px * dx + py * dy) / len2 : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const cx = px - dx * t;
      const cy = py - dy * t;
      const d2 = cx * cx + cy * cy;
      if (d2 < melhorD2) {
        melhorD2 = d2;
        melhorM = acum[i] + (acum[i + 1] - acum[i]) * t;
      }
    }
    if (melhorD2 === Infinity) return null;
    return { m: melhorM, dist: Math.sqrt(melhorD2) * RAD * R };
  }

  window.MapaLinha = {
    carregar,
    pronta,
    comprimento,
    projectar,
    fatia,
    ponto,
    _internals: { metros, limpar, indiceEm },
  };
})();

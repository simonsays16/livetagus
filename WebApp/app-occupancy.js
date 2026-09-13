/**
 * app-occupancy.js
 * Avisos de ocupação nos cartões de comboio.
 *
 * Portado da antiga página planear.html, que deixou de existir.
 *
 * REGRA:
 *   Quando o comboio escolhido vai acima de OCC_THRESHOLD (85%), procura-se
 *   — em AMBOS os sentidos temporais e a QUALQUER distância — o primeiro
 *   comboio abaixo de COMFORT_MAX (75%). O cheio recebe um aviso âmbar; as
 *   alternativas, um aviso verde com a diferença em minutos, quantos comboios
 *   de distância e a ocupação.
 *
 * ÂMBITO:
 *   Só no Sentido Lisboa e apenas a partir das estações onde a lotação é
 *   efetivamente um problema (SUGGEST_ORIGINS). Fora disso não há avisos.
 *
 * Uma alternativa que já partiu nunca é sugerida: só se propõem comboios que
 * o utilizador ainda consegue apanhar.
 *
 * Depende de: app-config.js (FERTAGUS_STATIONS, fertagusOrigin, activeTab)
 */

(function () {
  "use strict";

  const OCC_THRESHOLD = 85; // acima disto o comboio é considerado cheio
  const COMFORT_MAX = 75; // uma alternativa só conta se ficar abaixo disto

  // Estações onde a lotação em direção a Lisboa justifica sugestões.
  const SUGGEST_ORIGINS = new Set([
    "foros_de_amora",
    "corroios",
    "pragal",
    "sete_rios",
    "campolide",
  ]);

  /** Procura o primeiro comboio abaixo de COMFORT_MAX na direção dada. */
  function findComfort(list, fromIdx, step, now) {
    for (let i = fromIdx + step; i >= 0 && i < list.length; i += step) {
      const t = list[i];
      if (t.isSuppressed) continue;
      if (t.occupancy == null || t.occupancy >= COMFORT_MAX) continue;
      // Nunca sugerir um comboio que já partiu.
      if (t.effectiveDate && now && t.effectiveDate < now) continue;
      return i;
    }
    return -1;
  }

  /**
   * Anota a lista com `_occNote` nos comboios relevantes.
   * Devolve { anchorIdx, earlierIdx, laterIdx } para o chamador poder
   * garantir que as alternativas ficam dentro da janela visível.
   * NÃO cria cópias: escreve `_occNote` nos próprios objetos da lista, que
   * são recriados a cada render.
   */
  function annotate(list, anchorIdx) {
    const empty = { anchorIdx: -1, earlierIdx: -1, laterIdx: -1 };
    if (!Array.isArray(list) || !list.length) return empty;

    // Limpa anotações anteriores (a lista pode ser reaproveitada).
    for (const t of list) if (t._occNote) delete t._occNote;

    // Fora de âmbito: sentido ou estação de partida sem problema de lotação.
    if (activeTab !== "lisboa" || !SUGGEST_ORIGINS.has(fertagusOrigin)) {
      return empty;
    }

    if (anchorIdx < 0 || anchorIdx >= list.length) return empty;
    const best = list[anchorIdx];
    if (!best || best.occupancy == null || best.occupancy <= OCC_THRESHOLD) {
      return empty;
    }

    const now = new Date();
    const earlierIdx = findComfort(list, anchorIdx, -1, now);
    const laterIdx = findComfort(list, anchorIdx, 1, now);

    if (earlierIdx === -1 && laterIdx === -1) {
      // Está cheio mas não há nada melhor — avisa na mesma, sem prometer
      // alternativas que não existem.
      best._occNote = { kind: "crowded", occ: best.occupancy, hasAlt: false };
      return { anchorIdx, earlierIdx, laterIdx };
    }

    best._occNote = { kind: "crowded", occ: best.occupancy, hasAlt: true };

    [
      [earlierIdx, true],
      [laterIdx, false],
    ].forEach(function (pair) {
      const idx = pair[0];
      const earlier = pair[1];
      if (idx === -1) return;
      const t = list[idx];
      const mins = Math.abs(
        Math.round((t.effectiveDate - best.effectiveDate) / 60000),
      );
      t._occNote = {
        kind: "comfort",
        earlier: earlier,
        occ: t.occupancy,
        minutes: mins,
        trains: Math.abs(idx - anchorIdx),
      };
    });

    return { anchorIdx, earlierIdx, laterIdx };
  }

  // ─── HTML DOS AVISOS ───────────────────────────────────────────────────────

  const SVG_UP =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="m18 15-6-6-6 6"/></svg>';
  const SVG_DOWN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="m6 9 6 6 6-6"/></svg>';
  const SVG_ALERT =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/></svg>';

  /**
   * Marcação do aviso. Usa classes .occ-note definidas no input.css, em vez
   * de utilitários Tailwind: várias das combinações necessárias (opacidades
   * de emerald, por exemplo) não constam do output.css compilado e falhavam
   * em silêncio, deixando a caixa sem formatação.
   */
  function noteHtml(t) {
    const n = t && t._occNote;
    if (!n) return "";

    if (n.kind === "crowded") {
      return (
        '<div class="occ-note occ-note--warn">' +
        '<span class="occ-note__icon">' +
        SVG_ALERT +
        "</span>" +
        '<div class="occ-note__body">' +
        '<h4 class="occ-note__title">Ocupação elevada</h4>' +
        '<p class="occ-note__text">' +
        Math.round(n.occ) +
        "% de ocupação prevista." +
        (n.hasAlt ? " Vê as alternativas assinaladas a verde." : "") +
        "</p></div></div>"
      );
    }

    const quando = n.earlier ? "mais cedo" : "mais tarde";
    const lado = n.earlier ? "antes" : "depois";
    const comboios =
      n.trains === 1 ? "1 comboio " + lado : n.trains + " comboios " + lado;

    return (
      '<div class="occ-note occ-note--good">' +
      '<span class="occ-note__icon">' +
      (n.earlier ? SVG_UP : SVG_DOWN) +
      "</span>" +
      '<div class="occ-note__body">' +
      '<h4 class="occ-note__title">Viagem mais confortável</h4>' +
      '<p class="occ-note__text">' +
      n.minutes +
      " min " +
      quando +
      " · " +
      comboios +
      " · " +
      Math.round(n.occ) +
      "% de ocupação</p></div></div>"
    );
  }

  window.OccAdvisor = {
    annotate: annotate,
    noteHtml: noteHtml,
    OCC_THRESHOLD: OCC_THRESHOLD,
    COMFORT_MAX: COMFORT_MAX,
    SUGGEST_ORIGINS: SUGGEST_ORIGINS,
    _findComfort: findComfort,
  };
})();

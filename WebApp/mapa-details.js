/**
 * mapa-details.js
 * Painel de detalhes de um comboio no MAPA, em bottom sheet com 2 estados:
 *   • "mini"      — mostra dados essenciais
 *   • "expanded"  — mostra também a timeline das estações
 *
 * O painel em si vive em detalhes-comboio.js (módulo partilhado por todas as
 * páginas). Aqui fica só a ligação ao mapa: posição real/estimada, seguir o
 * comboio, foco do percurso e ligações intermodais que abrem os painéis do
 * Metro, MTS, CP e Carris. A API pública (window.MapaDetails) mantém-se.
 *
 * Inclusão: <script src="./detalhes-comboio.js" defer></script> ANTES deste.
 */

(function () {
  "use strict";

  if (!window.DetalhesComboio) {
    console.error("[MapaDetails] detalhes-comboio.js não carregado");
    return;
  }

  const R = () => window.MapaRender;

  const painel = window.DetalhesComboio.create({
    panelId: "details-panel",
    backdropId: "details-backdrop",

    stationName: (apiName) => {
      const s = MAPA.resolveStationByApiName(apiName);
      return s ? s.name : apiName;
    },
    statusColors: MAPA.STATUS_COLORS,

    carriages: (train) => ({
      filled: R()._filledCarriages(train),
      fill: R()._carriageFillColor(train),
    }),

    // Localização REAL (TML via /mapa) vs ESTIMADA (cálculo do mapa-geo).
    positionSource: (train) =>
      R() &&
      typeof R().isRealPosition === "function" &&
      R().isRealPosition(train.id)
        ? "real"
        : "estimated",

    follow: {
      isActive: (id) =>
        !!(R() && R().isFollowModeActive && R().isFollowModeActive(id)),
      toggle: (train) => (R() ? R().toggleFollowMode(train) : false),
    },

    routeFocus: {
      start: (train) => {
        if (R()) R().startRouteFocus(train);
      },
      end: () => {
        if (R()) {
          R().endRouteFocus();
          R().showWholeLine();
        }
      },
      isFocused: () => !!(R() && R().isRouteFocused()),
    },

    // Os marcadores são a fonte mais fresca do comboio.
    getLiveTrain: (id) => {
      if (R() && R().getMarkers) {
        const m = R().getMarkers().get(id);
        if (m && m.train) return m.train;
      }
      return null;
    },

    // O #details-panel é partilhado: fecha os outros painéis antes de abrir.
    beforeOpen: () => {
      if (window.MapaCM && window.MapaCM.isOpen()) window.MapaCM.close();
      if (window.MapaStation && window.MapaStation.isOpen()) {
        window.MapaStation.close({ silent: true });
      }
    },

    ligacoes: {
      load: () => {
        const G = window.GtfsHorarios;
        return G && typeof G.loadLigacoes === "function"
          ? G.loadLigacoes()
          : Promise.resolve();
      },
      // Metro, MTS e CP vêm do ficheiro de ligações; a Carris não passa pelo
      // painel dos intermodais: um botão só, que abre todas as paragens da
      // estação de uma vez.
      list: (nomeEstacao) => {
        let alvos = [];
        const G = window.GtfsHorarios;
        if (G && typeof G.interchangesFor === "function") {
          try {
            alvos = G.interchangesFor(nomeEstacao) || [];
          } catch (_) {
            alvos = [];
          }
        }
        const CM = window.MapaCM;
        if (CM && typeof CM.paragensDaEstacao === "function") {
          try {
            if (CM.paragensDaEstacao(nomeEstacao).length) {
              alvos = alvos.concat([{ op: "cm", name: nomeEstacao }]);
            }
          } catch (_) {}
        }
        return alvos;
      },
      // Abre o painel do outro operador, já filtrado pela hora de chegada do
      // comboio àquela estação.
      open: (alvo) => {
        if (alvo.op === "cm") {
          const CM = window.MapaCM;
          if (CM && typeof CM.openEstacao === "function") {
            CM.openEstacao(alvo.name, { fromTime: alvo.fromTime });
          }
          return;
        }
        const G = window.GtfsHorarios;
        if (!G) return;
        // recenter: o mapa aproxima-se da estação do outro operador, com o
        // desvio do painel. Sem isto o painel abria sobre um mapa que ainda
        // mostrava o comboio, e não se via onde era a ligação.
        const opts = {
          fromTime: alvo.fromTime,
          name: alvo.name,
          recenter: true,
        };
        if (alvo.stopId) G.openStop(alvo.op, alvo.stopId, opts);
        else
          G.open(
            { name: alvo.name },
            Object.assign({ operator: alvo.op }, opts),
          );
      },
    },
  });

  window.MapaDetails = painel;
})();

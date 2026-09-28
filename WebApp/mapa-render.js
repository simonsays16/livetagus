/**
 * mapa-render.js
 * Renderização visual do mapa: linha da Fertagus, estações, comboios e
 * cartões de "trajeto restante" para o comboio focado.
 */

(function () {
  "use strict";

  // ─── ESTADO INTERNO ──────────────────────────────────────────────────
  const markers = new Map(); // trainId → entry
  const routeCardMarkers = new Map(); // stationKey → entry
  const routeEndMarkers = [];
  let clickHandler = null;
  let animationFrameId = null;

  let mainMap = null;
  let routeFocusTrainId = null;
  let followModeTrainId = null;
  let routeFocusSignature = "";
  let routeFocusUserDetached = false; // user fez drag/wheel manualmente
  let isFlying = false;

  // Estações em cluster denso (norte) — precisam de slot system.
  const NORTH_CLUSTER = new Set([
    "campolide",
    "sete_rios",
    "entrecampos",
    "roma_areeiro",
  ]);

  const IMPORTANT_STATIONS = new Set([
    "sete_rios",
    "entrecampos",
    "pragal",
    "corroios",
    "coina",
    "pinhal_novo",
    "palmela",
  ]);
  let lastZoomStateWasDetailed = false;

  let userOriginKey = null;
  let userDestKey = null;

  // Função para injetar o filtro que vem do link
  function setUserRouteFilter(origin, dest) {
    userOriginKey = origin;
    userDestKey = dest;
  }

  // ─── HELPERS ─────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function getModalState() {
    if (
      window.MapaDetails &&
      typeof window.MapaDetails.getModalState === "function"
    ) {
      return window.MapaDetails.getModalState();
    }
    if (window.MapaDetails && window.MapaDetails.isOpen()) return "mini";
    if (window.MapaStation && window.MapaStation.isOpen()) return "station";
    return "closed";
  }

  // ─── CÂMERA: PADDING POR ESTADO DO MODAL ─────────────────────────────

  function getRouteFocusPadding() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const isMobile = w < 768;
    const state = getModalState();

    if (isMobile) {
      // Aumentamos o padding do topo para compensar o menu global
      // e a altura do próprio marcador quando fazemos zoom
      const topPad = 130;

      if (state === "expanded") {
        const visibleTop = Math.max(topPad, h * 0.12);
        return {
          top: visibleTop,
          bottom: Math.round(h * 0.85),
          left: 40,
          right: 40,
        };
      }

      if (state === "mini" || state === "station") {
        // Garantimos um mínimo de píxeis (350px ou 400px) para que
        // a margem nunca seja menor do que a altura mínima do painel (320px)
        const bottomPad =
          state === "station"
            ? Math.max(400, Math.round(h * 0.55))
            : Math.max(350, Math.round(h * 0.45));

        return {
          top: topPad,
          bottom: bottomPad,
          left: 40,
          right: 40,
        };
      }

      return { top: topPad, bottom: 120, left: 40, right: 40 };
    }

    // Desktop
    if (state === "mini" || state === "expanded" || state === "station") {
      return { top: 120, bottom: 120, left: 100, right: 500 };
    }
    return { top: 120, bottom: 120, left: 100, right: 100 };
  }

  // ─── CÂMERA: FOCO NO TRAJECTO RESTANTE ───────────────────────────────

  function trainById(id) {
    const entry = markers.get(id);
    return entry ? entry.train : null;
  }

  function remainingNodes(train) {
    return (train && train.nodes ? train.nodes : []).filter(
      (n) => !n.ComboioPassou,
    );
  }

  function applyRouteFocus(train, opts) {
    if (!train || !mainMap) return;
    if (typeof maplibregl === "undefined") return;
    const subtle = opts && opts.subtle;

    // A âncora é onde o comboio está DESENHADO, não um recálculo da posição.
    // O computeTrainPosition pode discordar do marcador — devolve null se o
    // MapaGeo ainda não estiver iniciado, usa um "agora" diferente do da
    // animação, e não sabe da interpolação em curso. Enquadrar por ele fazia
    // o mapa começar na estação seguinte em vez de no comboio.
    const entry = markers.get(train.id);
    let pos = null;
    if (entry && entry.marker && entry.marker.getLngLat) {
      try {
        const ll = entry.marker.getLngLat();
        if (ll && isFinite(ll.lng) && isFinite(ll.lat)) pos = ll;
      } catch (_) {}
    }
    if (!pos && window.MapaGeo) {
      pos = window.MapaGeo.computeTrainPosition(train, new Date());
    }
    if (!pos) return;

    let remaining = remainingNodes(train);
    // Sem estações em falta (comboio no fim do percurso, ou ComboioPassou mal
    // marcado) o enquadramento não pode desistir: fica ao menos o último nó,
    // para haver sempre um par comboio → terminal.
    if (remaining.length === 0) {
      const todos = train.nodes || [];
      if (todos.length) remaining = [todos[todos.length - 1]];
    }

    // Quando há filtro de rota do utilizador, limita o enquadramento
    // entre a posição actual do comboio e a estação de destino do user
    // (não o destino final do comboio).
    if (userDestKey) {
      const destIdx = remaining.findIndex((n) => {
        const st = MAPA.resolveStationByApiId(n.EstacaoID);
        return st && st.key === userDestKey;
      });
      if (destIdx !== -1) {
        remaining = remaining.slice(0, destIdx + 1);
      }
    }

    const bounds = new maplibregl.LngLatBounds(
      [pos.lng, pos.lat],
      [pos.lng, pos.lat],
    );
    let apanhouEstacao = false;
    for (const node of remaining) {
      const st = MAPA.resolveStationByApiId(node.EstacaoID);
      if (st) {
        bounds.extend([st.lng, st.lat]);
        apanhouEstacao = true;
      }
    }
    // Se nenhum nó foi reconhecido, o enquadramento seria um ponto só — e o
    // fitBounds de um ponto salta para o zoom máximo. Melhor ficar pela
    // terminal do percurso, mesmo que venha por nome em vez de id.
    if (!apanhouEstacao && !userDestKey) {
      const todos = train.nodes || [];
      const ult = todos[todos.length - 1];
      const st =
        ult &&
        (MAPA.resolveStationByApiId(ult.EstacaoID) ||
          (MAPA.resolveStationByApiName
            ? MAPA.resolveStationByApiName(ult.NomeEstacao)
            : null));
      if (st) bounds.extend([st.lng, st.lat]);
      else return; // sem par não vale a pena mexer o mapa
    }

    const padding = getRouteFocusPadding();
    const duration = subtle ? 700 : MAPA.ROUTE_FOCUS_DURATION_MS;

    isFlying = true;
    try {
      mainMap.fitBounds(bounds, {
        padding,
        duration,
        maxZoom: MAPA.ROUTE_FOCUS_MAX_ZOOM,
        essential: true,
        linear: false,
      });
    } catch (e) {
      console.warn("[MapaRender] fitBounds falhou:", e.message);
    }
    mainMap.once("moveend", () => {
      isFlying = false;
    });
  }

  function recomputeRouteFocusIfNeeded(train) {
    if (!train || routeFocusTrainId !== train.id) return;
    if (routeFocusUserDetached) return;
    if (followModeTrainId === train.id) return;
    const remaining = remainingNodes(train);
    const sig = remaining.map((n) => n.EstacaoID).join(",");
    const changed = sig !== routeFocusSignature;
    routeFocusSignature = sig;
    if (remaining.length === 0) return;
    // Mudou o conjunto de estações (passou uma) → reaplica com mais ênfase
    applyRouteFocus(train, { subtle: !changed });
  }

  function updateFocusClasses() {
    for (const entry of markers.values()) {
      entry.el.classList.toggle(
        "is-focused",
        routeFocusTrainId === entry.train.id,
      );
    }
  }

  function startRouteFocus(train) {
    if (!train || !mainMap) return;
    routeFocusTrainId = train.id;
    routeFocusSignature = "";
    routeFocusUserDetached = false;
    drawRouteStationCards(train);
    applyRouteFocus(train, { subtle: false });
    try {
      window.history.replaceState(null, null, "#" + train.id);
    } catch (_) {}
    updateFocusClasses();
  }

  function endRouteFocus() {
    routeFocusTrainId = null;
    followModeTrainId = null;
    userOriginKey = null;
    userDestKey = null;
    routeFocusSignature = "";
    routeFocusUserDetached = false;
    clearRouteStationCards();
    try {
      window.history.replaceState(
        null,
        null,
        window.location.pathname + window.location.search,
      );
    } catch (_) {}
    updateFocusClasses();
  }

  function isRouteFocused() {
    return routeFocusTrainId != null;
  }

  function recenterTracking() {
    // Quando um modal fecha mas há um comboio focado, refaz o
    // enquadramento com o novo padding (sem modal).
    if (!mainMap) return;
    if (routeFocusTrainId) {
      const t = trainById(routeFocusTrainId);
      if (t) {
        applyRouteFocus(t, { subtle: true });
      }
    } else {
      // Sem comboio focado → mostra toda a linha
      showWholeLine({ duration: 500 });
    }
  }

  function showWholeLine(opts) {
    if (!mainMap || typeof maplibregl === "undefined") return;
    const bounds = new maplibregl.LngLatBounds(
      [MAPA.STATIONS[0].lng, MAPA.STATIONS[0].lat],
      [MAPA.STATIONS[0].lng, MAPA.STATIONS[0].lat],
    );
    for (const s of MAPA.STATIONS) bounds.extend([s.lng, s.lat]);
    try {
      mainMap.fitBounds(bounds, {
        padding: { top: 80, bottom: 80, left: 50, right: 50 },
        duration: (opts && opts.duration) || 700,
        maxZoom: 11.5,
        essential: true,
      });
    } catch (_) {}
  }

  function focusStation(station) {
    // Limpa qualquer focus em comboio para evitar conflitos visuais.
    if (routeFocusTrainId) endRouteFocus();
    if (!mainMap || !station) return;
    isFlying = true;
    mainMap.flyTo({
      center: [station.lng, station.lat],
      zoom: Math.max(mainMap.getZoom(), 14.5),
      offset: getStationFocusOffset(),
      speed: 1.1,
      essential: true,
    });
    mainMap.once("moveend", () => {
      isFlying = false;
    });
  }

  function getStationFocusOffset() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w < 768) {
      // Estação ligeiramente para cima do centro para deixar espaço ao modal
      return [0, -h * 0.18];
    }
    return [-180, 0]; // empurra centro à esquerda do modal lateral
  }

  // ─── BACKWARD-COMPAT API ─────────────────────────────────────────────
  //
  // startTracking(id), startTrackingTrain(id), stopTracking() continuam
  // a existir e mapeiam para o novo modelo.

  function startTracking(id) {
    const t = trainById(id);
    if (t) startRouteFocus(t);
  }

  function startTrackingTrain(id) {
    return startTracking(id);
  }

  function stopTracking() {
    endRouteFocus();
  }

  // ─── ANIMAÇÃO SUAVE DOS MARKERS ──────────────────────────────────────

  // O ciclo corria a 60 fps para sempre, mesmo com todos os comboios parados:
  // reposicionava cada marcador no sítio onde já estava, a cada frame. Num
  // telemóvel isso mantém o CPU e o compositor acordados e gasta bateria sem
  // mostrar nada de novo. Agora dorme quando todos os deslizes acabaram, e
  // acorda quando chega uma posição nova (acordarCiclo). Os movimentos do mapa
  // não precisam dele: o MapLibre reposiciona os marcadores sozinho.
  // Para voltar ao comportamento antigo: PARAR_QUANDO_QUIETO = false.
  const PARAR_QUANDO_QUIETO = true;

  // Comboios fora do ecrã não são redesenhados a meio do deslize. Com zoom
  // vêem-se dois ou três de vinte, e os outros eram reposicionados a cada
  // frame para ninguém os ver — 95% do trabalho dos marcadores.
  // Para voltar ao comportamento antigo: SALTAR_FORA_DO_ECRA = false.
  const SALTAR_FORA_DO_ECRA = true;

  // A margem tem de cobrir um comboio inteiro: a posição do GPS é a FRENTE,
  // e com a frente fora do ecrã a cauda pode estar dentro. Uma unidade dupla
  // tem 400 m. Também absorve o que o mapa anda entre dois frames num gesto
  // rápido, para um comboio não aparecer já tarde ao entrar no ecrã.
  const MARGEM_VISTA_M = 600;

  // Os limites do ecrã com folga, em graus. null quer dizer "não sei a vista"
  // — e aí trata-se tudo como visível, que é o comportamento antigo e seguro.
  function vistaComMargem() {
    if (!SALTAR_FORA_DO_ECRA || !mainMap) return null;
    let b = null;
    try {
      b = mainMap.getBounds();
    } catch (_) {
      return null;
    }
    if (!b || typeof b.getNorth !== "function") return null;
    const n = b.getNorth();
    const s = b.getSouth();
    const e = b.getEast();
    const w = b.getWest();
    if (![n, s, e, w].every(isFinite)) return null;
    const lat = (n + s) / 2;
    const dLat = Math.max((n - s) * 0.25, MARGEM_VISTA_M / 111320);
    const dLng = Math.max(
      (e - w) * 0.25,
      MARGEM_VISTA_M /
        (111320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180))),
    );
    return { n: n + dLat, s: s - dLat, e: e + dLng, w: w - dLng };
  }

  function naVista(v, lng, lat) {
    return !v || (lat <= v.n && lat >= v.s && lng <= v.e && lng >= v.w);
  }

  function acordarCiclo() {
    if (!animationFrameId)
      animationFrameId = requestAnimationFrame(animateMarkers);
  }

  function animateMarkers(time) {
    const glideMs = MAPA.TRAIN_GLIDE_MS || MAPA.POSITION_UPDATE_MS;
    let algumAMover = false;
    // Uma vez por frame, não uma por comboio.
    const vista = vistaComMargem();
    for (const entry of markers.values()) {
      if (entry.startPos && entry.targetPos) {
        let t = (time - entry.animationStartTime) / glideMs;
        if (t > 1) t = 1;
        // Já no destino e já desenhado lá: não há nada a fazer por ele.
        if (t >= 1 && entry._assente) continue;
        let lng = lerp(entry.startPos.lng, entry.targetPos.lng, t);
        let lat = lerp(entry.startPos.lat, entry.targetPos.lat, t);
        // A posição crua fica guardada: é por ela que se decide se o comboio
        // está perto o suficiente da via para ser encaixado. Se a decisão
        // fosse tomada sobre a posição já encaixada, a distância seria sempre
        // zero e um comboio que se afastasse nunca se soltava. É actualizada
        // mesmo para os comboios fora do ecrã: são duas contas, e o
        // atualizarCarruagens precisa dela fresca.
        entry.rawLngLat = { lng, lat };
        if (t >= 1) {
          // O FIM do deslize aplica-se sempre, visível ou não. É um só frame
          // por deslize, e é o que garante que, ao arrastar o mapa até um
          // comboio mais tarde — com o ciclo já a dormir —, ele está onde deve.
          entry._assente = true;
        } else {
          algumAMover = true;
          // A meio do deslize e fora do ecrã: ninguém o vê. Salta-se o
          // trabalho no DOM — encaixe, reposicionamento, rotação. O comboio
          // seguido nunca é saltado: é a ele que a câmara está presa.
          if (
            vista &&
            followModeTrainId !== entry.train.id &&
            !naVista(vista, lng, lat)
          )
            continue;
        }
        const enc = encaixarNaLinha(entry, lng, lat);
        if (enc) {
          lng = enc[0];
          lat = enc[1];
        }
        entry.marker.setLngLat([lng, lat]);

        // NOVO: Interpolar Rotação em vez de "Snap" a cada 5 segundos
        if (
          entry.startBearing !== undefined &&
          entry.targetBearing !== undefined
        ) {
          const currentBearing = lerp(
            entry.startBearing,
            entry.targetBearing,
            t,
          );
          if (Math.abs((entry.bearing || 0) - currentBearing) > 0.1) {
            applyRotation(entry, currentBearing);
            entry.bearing = currentBearing;
          }
        }

        // NOVO: Prender a Câmara Frame-a-Frame ao Comboio
        if (
          followModeTrainId === entry.train.id &&
          !routeFocusUserDetached &&
          !isFlying &&
          mainMap
        ) {
          mainMap.jumpTo({
            center: [lng, lat],
            // Com o comboio encaixado na linha, a câmara segue a tangente da
            // via, como o sinal de sentido. O rumo do GPS é a corda entre duas
            // posições e, numa curva, a câmara olhava para fora dos carris.
            bearing:
              entry.el.dataset.linha === "1" &&
              typeof entry.linhaBearing === "number"
                ? entry.linhaBearing
                : entry.bearing,
            padding: {
              top: 0,
              bottom: Math.max(300, window.innerHeight * 0.42),
              left: 0,
              right: 0,
            },
          });
        }
      }
    }
    // Ao adormecer, uma última actualização desenha as posições finais.
    if (time - ultimaLinha >= LINHA_UPDATE_MS || !algumAMover) {
      ultimaLinha = time;
      atualizarCarruagens();
    }
    if (PARAR_QUANDO_QUIETO && !algumAMover) {
      animationFrameId = null;
      return;
    }
    animationFrameId = requestAnimationFrame(animateMarkers);
  }

  // ─── ACESSIBILIDADE ──────────────────────────────────────────────────
  function nomeDoComboio(train) {
    const num = train && (train.numero || train.id);
    const dest = train && train.destino;
    let nome = num ? `Comboio ${num}` : "Comboio";
    if (dest) nome += ` para ${dest}`;
    if (train && train.isSuppressed) nome += ", suprimido";
    return nome;
  }

  function tornarAcessivel(el, train) {
    if (!el) return;
    if (el.getAttribute("role") !== "button") el.setAttribute("role", "button");
    if (el.tabIndex !== 0) el.tabIndex = 0;
    const nome = nomeDoComboio(train);
    // Só escreve se mudou: isto corre a cada actualização da API.
    if (el.getAttribute("aria-label") !== nome)
      el.setAttribute("aria-label", nome);
  }

  // O painel de detalhes é um role="dialog" partilhado por quatro módulos
  // (comboio, estação, intermodais, Carris), e tinha dois problemas: não tinha
  // nome, e ficava com aria-modal="true" mesmo fechado — um leitor de ecrã
  // podia tratar a página como se o diálogo estivesse sempre aberto, e o Tab
  // entrava nos botões de um painel fora do ecrã.
  //
  // Um só observador trata disto para todos, incluindo os que não sabem nada
  // de acessibilidade: fechado → aria-hidden e inert; aberto → nome tirado do
  // título que estiver lá dentro. Nenhum dos painéis faz focus() ao abrir, por
  // isso o inert não lhes rouba nada.
  function acessibilidadePainel() {
    const p = document.getElementById("details-panel");
    if (!p || p._ltA11y) return;
    p._ltA11y = true;
    const aplicar = () => {
      const fechado =
        p.classList.contains("translate-y-full") ||
        p.dataset.state === "closed";
      if (fechado) {
        if (p.getAttribute("aria-hidden") !== "true")
          p.setAttribute("aria-hidden", "true");
        if (p.getAttribute("aria-modal") !== null)
          p.removeAttribute("aria-modal");
        if (!p.inert) p.inert = true;
        return;
      }
      if (p.getAttribute("aria-hidden") !== null)
        p.removeAttribute("aria-hidden");
      if (p.getAttribute("aria-modal") !== "true")
        p.setAttribute("aria-modal", "true");
      if (p.inert) p.inert = false;
      const titulo = p.querySelector("h1, h2, h3");
      if (titulo) {
        if (!titulo.id) titulo.id = "lt-painel-titulo";
        if (p.getAttribute("aria-labelledby") !== titulo.id)
          p.setAttribute("aria-labelledby", titulo.id);
        if (p.getAttribute("aria-label") !== null)
          p.removeAttribute("aria-label");
      } else if (p.getAttribute("aria-label") !== "Detalhes") {
        p.removeAttribute("aria-labelledby");
        p.setAttribute("aria-label", "Detalhes");
      }
    };
    try {
      new MutationObserver(aplicar).observe(p, {
        attributes: true,
        attributeFilter: ["class", "data-state"],
        childList: true,
        subtree: true,
      });
    } catch (_) {}
    aplicar();
  }

  // ─── ARRANQUE: A FERTAGUS PRIMEIRO ───────────────────────────────────
  //
  // O mapa só precisa da Fertagus para aparecer. Metro, MTS, CP, Carris e as
  // paragens guardadas arrancavam todos no mesmo instante e competiam com ela
  // pela rede e pela thread principal — JSON para analisar, camadas para
  // criar, logótipos para compor em canvas.
  //
  // Os módulos põem o seu trabalho AUTOMÁTICO de arranque atrás deste portão.
  // Ele abre quando a linha e as estações da Fertagus estão desenhadas e o mapa
  // pintou pela primeira vez. Aí, o que estava à espera corre um a um em
  // momentos livres, para não engasgar as primeiras interacções.
  //
  // Depois de aberto, depois(fn) corre fn na hora: o que o utilizador pede
  // (ligar uma camada, abrir a pesquisa) nunca fica à espera.
  //
  // Dois limites, para nada ficar bloqueado se algo correr mal: 2,5 s depois
  // de as estações estarem desenhadas (os tiles do fundo podem demorar e o
  // "idle" só vem com eles) e 6 s depois de o mapa existir (se a linha nunca
  // chegar a ser desenhada).
  const LTArranque = (function () {
    let aberto = false;
    let fila = [];
    const agendar = (fn) =>
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(fn, { timeout: 1200 })
        : setTimeout(fn, 0);
    function correr(fn) {
      try {
        fn();
      } catch (e) {
        console.error("[LTArranque]", e);
      }
    }
    return {
      depois(fn) {
        if (aberto) correr(fn);
        else fila.push(fn);
      },
      abrir(motivo) {
        if (aberto) return;
        aberto = true;
        this.motivo = motivo;
        const f = fila;
        fila = [];
        for (const fn of f) agendar(() => correr(fn));
      },
      aberto: () => aberto,
      motivo: null,
    };
  })();
  window.LTArranque = LTArranque;

  // ─── CARRUAGENS NA LINHA ─────────────────────────────────────────────
  //
  // Com zoom, cada carruagem é desenhada como uma FATIA da geometria da
  // linha (mapa-linha.js), numa camada da GPU, em vez de uma coluna de divs
  // rodada em bloco. Uma coluna rodada só pode ser recta: numa curva o
  // comboio inteiro tomava o ângulo de um ponto e as carruagens das pontas
  // saíam dos carris. Uma fatia da linha curva por construção, porque É a
  // linha.
  //
  // A posição da API é a FRENTE do comboio: as carruagens estendem-se para
  // trás dela, e o sinal de sentido do marcador HTML fica em cima da posição.
  // O resto do marcador (a coluna de carruagens) é escondido enquanto a camada
  // as desenha; os cliques no corpo do comboio passam a ser apanhados por ela.
  //
  // Para voltar ao comportamento antigo: CARRUAGENS_NA_LINHA = false.
  const CARRUAGENS_NA_LINHA = true;
  // Igual ao que o scaleCarriagesToRealWorld já usava, para o comboio manter
  // o comprimento que tinha. Com fatias da geometria a curva vem dos vértices
  // da linha, não do número de peças, por isso não é preciso subdividir.
  const CARRUAGEM_M = 50;
  const CARRUAGEM_GAP_M = 1.6;
  // A posição da API pode vir desviada da via. Até aqui encaixa-se na linha;
  // para lá disto é um dado mau e fica o desenho antigo, sem inventar.
  const MAX_DESVIO_M = 150;
  // 10 Hz chega: a esta escala o comboio anda dois ou três píxeis entre
  // actualizações. Fazer setData() a cada frame é que pesaria.
  const LINHA_UPDATE_MS = 100;

  const SRC_CARR = "fertagus-carriages";
  const LYR_CARR = "fertagus-carriages-fill";
  const LYR_CARR_CASING = "fertagus-carriages-casing";
  const VAZIO = { type: "FeatureCollection", features: [] };
  let ultimaLinha = 0;
  let carrVazio = true;
  // Resumo do que está desenhado. Se não mudou, não há setData — que é o mais
  // caro de tudo (serializa o GeoJSON, envia ao worker, refaz os tiles e
  // recarrega os buffers da GPU). Antes corria 9 vezes por segundo com os
  // comboios parados.
  let ultimaAssinatura = "";

  // Largura real de 10 m, com mínimo de 6 px — os mesmos números do
  // scaleCarriagesToRealWorld. A 38,6° de latitude, 10 m são
  // 10 × 2^z / 122 340 px; entre pontos a curva é exponencial de base 2,
  // que é como os metros por píxel variam com o zoom.
  const LARGURA_PONTOS = [
    [16, 6],
    [17, 10.71],
    [18, 21.43],
    [20, 85.7],
  ];

  function larguraCarr(extra) {
    const e = ["interpolate", ["exponential", 2], ["zoom"]];
    for (const [z, w] of LARGURA_PONTOS) e.push(z, w + extra);
    return e;
  }

  // ─── VIA DUPLA ───────────────────────────────────────────────────────
  // A linha da Fertagus é via dupla, e dois comboios em sentidos opostos
  // ficavam desenhados um em cima do outro — nos terminais durante minutos.
  // Cada sentido passa a ir para o seu lado do eixo.
  //
  // O afastamento é ESQUEMÁTICO: as vias reais estão a ~4 m e uma carruagem
  // desenhada tem 10 m, portanto a distância real não separava nada. Meia
  // largura de carruagem mais uma folga põe os dois comboios lado a lado.
  //
  // LADO_CIRCULACAO: de que lado do eixo vai cada comboio, visto no sentido
  // em que anda. Confirma no OSM (via ascendente/descendente) — se o comboio
  // aparecer na via errada em relação ao cais, é trocar para "direita".
  const VIA_DUPLA = true;
  const LADO_CIRCULACAO = "esquerda";
  const SINAL_LADO = LADO_CIRCULACAO === "esquerda" ? -1 : 1;
  const FOLGA_VIAS_PX = 0.5;

  // Desvio em píxeis a partir do eixo, por zoom. A camada usa o line-offset
  // (em píxeis, relativo ao sentido da geometria); o marcador HTML usa o
  // mesmo número por uma variável CSS.
  function desvioCarr(sinalExpr) {
    const e = ["interpolate", ["exponential", 2], ["zoom"]];
    for (const [z, w] of LARGURA_PONTOS) {
      e.push(z, ["*", sinalExpr, w / 2 + FOLGA_VIAS_PX]);
    }
    return e;
  }

  // O mesmo em JS, para o marcador. Exponencial de base 2 entre pontos, como
  // a camada — senão o sinal e as carruagens separavam-se a meio de um zoom.
  function desvioPxEm(zoom) {
    const P = LARGURA_PONTOS;
    if (zoom <= P[0][0]) return P[0][1] / 2 + FOLGA_VIAS_PX;
    for (let i = 1; i < P.length; i++) {
      const [z0, w0] = P[i - 1];
      const [z1, w1] = P[i];
      if (zoom <= z1) {
        const t = (Math.pow(2, zoom - z0) - 1) / (Math.pow(2, z1 - z0) - 1);
        return (w0 + (w1 - w0) * t) / 2 + FOLGA_VIAS_PX;
      }
    }
    return P[P.length - 1][1] / 2 + FOLGA_VIAS_PX;
  }

  let ultimoDesvio = null;
  // Uma escrita por zoom, num só elemento — não uma por marcador.
  function atualizarDesvioCss() {
    if (!VIA_DUPLA || !mainMap || typeof mainMap.getContainer !== "function")
      return;
    const px = Math.round(desvioPxEm(mainMap.getZoom()) * 10) / 10;
    if (px === ultimoDesvio) return;
    ultimoDesvio = px;
    try {
      mainMap.getContainer().style.setProperty("--lt-desvio-via", px + "px");
    } catch (_) {}
  }

  // Transformação do corpo do marcador. Em modo linha leva o desvio da via:
  // o translateX vem DEPOIS do rotate, por isso anda no referencial do
  // comboio — o lado dele, perpendicular à via, qualquer que seja o rumo.
  function transformCorpo(entry, rumo) {
    const base = `translate(-50%, -50%) rotate(${rumo}deg)`;
    if (!VIA_DUPLA || entry.el.dataset.linha !== "1") return base;
    return `${base} translateX(calc(var(--lt-desvio-via, 0px) * ${SINAL_LADO}))`;
  }

  function corVazia() {
    try {
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue("--car-empty")
        .trim();
      if (v) return v;
    } catch (_) {}
    return "#3b82f6";
  }

  function carriageLayerDefs() {
    return [
      {
        id: LYR_CARR_CASING,
        type: "line",
        source: SRC_CARR,
        minzoom: MAPA.ZOOM_DETAIL_CUTOFF,
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": "rgba(0,0,0,0.35)",
          "line-width": larguraCarr(1.5),
          ...(VIA_DUPLA ? { "line-offset": desvioCarr(["get", "lado"]) } : {}),
        },
      },
      {
        id: LYR_CARR,
        type: "line",
        source: SRC_CARR,
        minzoom: MAPA.ZOOM_DETAIL_CUTOFF,
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          // Igual ao HTML: as primeiras N carruagens com a cor da ocupação,
          // as restantes com a cor de "vazia".
          "line-color": [
            "case",
            ["==", ["get", "cheia"], 1],
            ["get", "cor"],
            corVazia(),
          ],
          "line-width": larguraCarr(0),
          ...(VIA_DUPLA ? { "line-offset": desvioCarr(["get", "lado"]) } : {}),
        },
      },
    ];
  }

  // As carruagens são desenhadas pela camada; no marcador HTML ficam só o
  // anel, a seta e o wifi. A barra transparente continua a apanhar cliques.
  function injectCarriageCss() {
    if (document.getElementById("lt-carr-linha-css")) return;
    const el = document.createElement("style");
    el.id = "lt-carr-linha-css";
    // Com as carruagens na camada, do marcador HTML sobra só o sinal de
    // sentido. Sem a coluna de carruagens, o corpo passa a ser só esse sinal
    // — e como o corpo está centrado na âncora do marcador, o sinal fica
    // exactamente na posição do GPS, que é a frente do comboio.
    el.textContent =
      `.train-marker[data-linha="1"] .train-cars-wrapper{display:none}` +
      `.train-marker[data-linha="1"] .train-wifi-badge{margin-bottom:0}`;
    document.head.appendChild(el);
  }

  // Os comboios em HTML ficavam sempre por cima de tudo. A camada tem de
  // ficar no topo para o comboio não desaparecer debaixo da estação quando
  // está parado no cais.
  function carruagensAoTopo(map) {
    if (!map) return;
    try {
      if (map.getLayer(LYR_CARR_CASING)) map.moveLayer(LYR_CARR_CASING);
      if (map.getLayer(LYR_CARR)) map.moveLayer(LYR_CARR);
    } catch (_) {}
  }

  function ensureCarriageLayers(map) {
    if (!CARRUAGENS_NA_LINHA || !map) return;
    injectCarriageCss();
    if (!map.getSource(SRC_CARR)) {
      map.addSource(SRC_CARR, { type: "geojson", data: VAZIO });
      carrVazio = true;
    }
    for (const def of carriageLayerDefs()) {
      if (!map.getLayer(def.id)) map.addLayer(def);
    }
    if (!map._ltCarrClick) {
      map._ltCarrClick = true;
      // As zonas curvas ficam fora da barra HTML (transparente) que apanha
      // os cliques; aqui apanham-se esses.
      map.on("click", LYR_CARR, (e) => {
        const f = e.features && e.features[0];
        const entry = f && markers.get(f.properties.id);
        if (entry && typeof clickHandler === "function")
          clickHandler(entry.train);
      });
      // Com o ciclo a dormir, é o fim de cada gesto que actualiza: um comboio
      // que entra no ecrã ao arrastar, ou o zoom que passa o corte. Dispara
      // uma vez por gesto, não por frame. A geometria em si não muda com o
      // zoom — é geográfica —, e o minzoom da camada trata da visibilidade.
      map.on("moveend", () => atualizarCarruagens());
      // O desvio da via é em píxeis e muda com o zoom. O evento "zoom" dispara
      // durante o gesto, para o sinal não se descolar das carruagens; a
      // escrita só acontece quando o valor muda.
      map.on("zoom", atualizarDesvioCss);
      atualizarDesvioCss();
      map.on(
        "mouseenter",
        LYR_CARR,
        () => (map.getCanvas().style.cursor = "pointer"),
      );
      map.on("mouseleave", LYR_CARR, () => (map.getCanvas().style.cursor = ""));
      // A cor de "vazia" vem do CSS e muda com o tema.
      map.on("styledata", () => {
        if (map.getLayer(LYR_CARR)) {
          try {
            map.setPaintProperty(LYR_CARR, "line-color", [
              "case",
              ["==", ["get", "cheia"], 1],
              ["get", "cor"],
              corVazia(),
            ]);
          } catch (_) {}
        }
      });
    }
  }

  // Sentido do comboio ao longo da linha: +1 se avança para metros maiores
  // (Roma-Areeiro → Setúbal), −1 no sentido contrário. Decide-se pelo
  // DESTINO, que está sempre à frente; a estação seguinte falhava quando o
  // comboio estava parado nela. Guarda-se por objecto de comboio, porque
  // só muda quando chegam dados novos.
  function sentido(entry, m) {
    const t = entry.train;
    if (entry._dirTrain === t && entry._dir) return entry._dir;
    let dir = 0;
    const nodes = (t && t.nodes) || [];
    const ult = nodes[nodes.length - 1];
    const st =
      ult &&
      (MAPA.resolveStationByApiId(ult.EstacaoID) ||
        (MAPA.resolveStationByApiName
          ? MAPA.resolveStationByApiName(ult.NomeEstacao)
          : null));
    if (st) {
      const p = window.MapaLinha.projectar(st.lng, st.lat);
      if (p && Math.abs(p.m - m) > 20) dir = p.m > m ? 1 : -1;
    }
    if (!dir) dir = entry._dir || 1;
    entry._dir = dir;
    entry._dirTrain = t;
    return dir;
  }

  // Rumo da linha num ponto, no sentido do comboio (0 = norte, horário — a
  // mesma convenção do applyRotation).
  //
  // O rumo que vinha do GPS é a corda entre duas posições sucessivas: numa
  // curva corta por dentro, e o sinal de sentido apontava para fora dos
  // carris. A tangente da própria linha não tem esse problema. Mede-se entre
  // 12 m para trás e 12 m para a frente, para uma curva apertada não o fazer
  // saltar entre vértices.
  function rumoNaLinha(m, dir) {
    const L = window.MapaLinha;
    let a = L.ponto(m - dir * 12);
    let b = L.ponto(m + dir * 12);
    if (!a || !b) return null;
    let dx = (b[0] - a[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
    let dy = b[1] - a[1];
    // Na ponta da linha as duas projecções podem colapsar no mesmo ponto;
    // aí usa-se só o troço de trás.
    if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) {
      a = L.ponto(m - dir * 24);
      b = L.ponto(m);
      dx = (b[0] - a[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
      dy = b[1] - a[1];
      if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return null;
    }
    return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  }

  // Põe o marcador em cima da linha. O GPS vem desviado da via (dezenas de
  // metros não é raro), e as carruagens já eram desenhadas na projecção —
  // mas o marcador ficava na coordenada crua, com o sinal de sentido ao lado
  // dos carris em vez de na frente do comboio. Custa uma projecção com pista
  // por frame, ~0,5 µs.
  function encaixarNaLinha(entry, lng, lat) {
    if (!CARRUAGENS_NA_LINHA || entry.el.dataset.linha !== "1") return null;
    const L = window.MapaLinha;
    if (!L || !L.pronta()) return null;
    const p = L.projectar(lng, lat, entry.linhaM);
    if (!p || p.dist > MAX_DESVIO_M) return null;
    entry.linhaM = p.m;
    return L.ponto(p.m);
  }

  // Escrever um atributo, mesmo com o mesmo valor, invalida os estilos que
  // dependem dele (o CSS usa [data-linha="1"]). Antes eram 73 escritas por
  // segundo com os comboios parados.
  function definirLinha(entry, v) {
    if (entry.el.dataset.linha === v) return;
    entry.el.dataset.linha = v;
    // O desvio da via entra ou sai do transform: forçar a reescrita, que o
    // rodarCorpo saltaria por o rumo não ter mudado.
    entry._rumoAplicado = undefined;
  }

  // Põe o marcador onde deve estar para o estado actual, SEM depender do
  // ciclo de animação. Com o ciclo a dormir, um comboio já parado que passasse
  // a ser encaixável (ou deixasse de o ser) ficava na posição antiga: o ciclo
  // salta os comboios assentes. Só escreve se a diferença se notar.
  function posicionarMarcador(entry, alvo) {
    if (!alvo) return;
    let atual = null;
    try {
      atual = entry.marker.getLngLat();
    } catch (_) {}
    if (
      atual &&
      window.MapaLinha &&
      window.MapaLinha._internals.metros(
        atual.lng,
        atual.lat,
        alvo[0],
        alvo[1],
      ) < 0.5
    )
      return;
    entry.marker.setLngLat(alvo);
  }

  function corpoDe(entry) {
    // O corpo é guardado para não haver um querySelector por comboio e por
    // actualização. Se o HTML do marcador for refeito, é procurado de novo.
    const b = entry._body;
    if (b && entry.el.contains(b)) return b;
    entry._body = entry.el.querySelector(".train-cars-body");
    return entry._body;
  }

  function rodarCorpo(entry, rumo) {
    // Menos de 0,2° não se vê; poupa a escrita no estilo.
    const antes = entry._rumoAplicado;
    if (typeof antes === "number") {
      const d = Math.abs(antes - rumo) % 360;
      if ((d > 180 ? 360 - d : d) < 0.2) return;
    }
    const body = corpoDe(entry);
    if (body) {
      body.style.transform = transformCorpo(entry, rumo);
      entry._rumoAplicado = rumo;
    }
  }

  function atualizarCarruagens() {
    if (!CARRUAGENS_NA_LINHA || !mainMap) return;
    const L = window.MapaLinha;
    const src = mainMap.getSource(SRC_CARR);
    if (!src || !L || !L.pronta()) return;

    const zoom = mainMap.getZoom();
    if (zoom < MAPA.ZOOM_DETAIL_CUTOFF) {
      if (!carrVazio) {
        src.setData(VAZIO);
        carrVazio = true;
      }
      ultimaAssinatura = "";
      for (const entry of markers.values()) {
        const estavaNaLinha = entry.el.dataset.linha === "1";
        if (estavaNaLinha && entry.rawLngLat) {
          posicionarMarcador(entry, [entry.rawLngLat.lng, entry.rawLngLat.lat]);
        }
        definirLinha(entry, "0");
        entry.linhaBearing = null;
        // Tira o desvio da via do transform.
        if (estavaNaLinha && typeof entry.bearing === "number")
          rodarCorpo(entry, entry.bearing);
      }
      return;
    }

    // A mesma vista com margem do ciclo. Antes usava os limites exactos do
    // ecrã e a posição da frente: com a frente mesmo fora e a cauda dentro,
    // o comboio caía no desenho antigo, uma barra recta a meio do ecrã.
    const vista = vistaComMargem();
    const feats = [];
    const partesAssinatura = [];
    for (const entry of markers.values()) {
      // A posição CRUA, não a do marcador: essa já vem encaixada, e projectá-la
      // daria sempre distância zero.
      let ll = entry.rawLngLat || null;
      if (!ll) {
        try {
          ll = entry.marker.getLngLat();
        } catch (_) {}
      }
      const visivel = ll && naVista(vista, ll.lng, ll.lat);
      const proj = visivel ? L.projectar(ll.lng, ll.lat, entry.linhaM) : null;
      if (!proj || proj.dist > MAX_DESVIO_M) {
        const estavaNaLinha = entry.el.dataset.linha === "1";
        // Primeiro o estado, depois o transform: ao contrário, o transform era
        // escrito ainda com o desvio da via e ficava com ele.
        definirLinha(entry, "0"); // fica o desenho HTML antigo
        if (estavaNaLinha) {
          entry.linhaBearing = null;
          if (typeof entry.bearing === "number")
            rodarCorpo(entry, entry.bearing);
          // Volta à posição do GPS: o encaixe já não se justifica.
          if (ll) posicionarMarcador(entry, [ll.lng, ll.lat]);
        }
        continue;
      }
      entry.linhaM = proj.m;
      const dir = sentido(entry, proj.m);
      const t = entry.train;
      const n = t.carriages || 4;
      const total = n * CARRUAGEM_M;
      const cheias = filledCarriages(t);
      const cor = carriageFillColor(t);
      for (let i = 0; i < n; i++) {
        // A posição que o GPS emite é a FRENTE do comboio, não o meio. As
        // carruagens estendem-se para trás dela: i = 0 é a da frente, colada
        // à posição, e a última fica a `total` metros atrás.
        const a =
          dir > 0 ? proj.m - (i + 1) * CARRUAGEM_M : proj.m + i * CARRUAGEM_M;
        const coords = L.fatia(
          a + CARRUAGEM_GAP_M / 2,
          a + CARRUAGEM_M - CARRUAGEM_GAP_M / 2,
        );
        if (coords.length < 2) continue;
        feats.push({
          type: "Feature",
          // A fatia vai sempre no sentido dos metros a crescer. Um comboio
          // com dir = +1 anda nesse sentido; com −1 anda ao contrário, e o
          // "seu lado" fica do outro lado da geometria.
          properties: {
            id: t.id,
            cheia: i < cheias ? 1 : 0,
            cor,
            lado: SINAL_LADO * dir,
          },
          geometry: { type: "LineString", coordinates: coords },
        });
      }
      // Meio metro de resolução: menos do que isso não se vê em nenhum zoom.
      partesAssinatura.push(
        `${t.id}:${Math.round(proj.m * 2)}:${dir}:${n}:${cheias}:${cor}:${SINAL_LADO}`,
      );
      definirLinha(entry, "1");
      // Com o comboio parado o ciclo não passa por aqui; o encaixe tem de
      // acontecer já. A deslizar, o ciclo faz o mesmo e isto é um no-op.
      posicionarMarcador(entry, L.ponto(proj.m));
      // O sinal de sentido alinha com a linha na posição da frente.
      const rumo = rumoNaLinha(proj.m, dir);
      if (rumo != null) {
        entry.linhaBearing = rumo;
        rodarCorpo(entry, rumo);
      }
    }
    const assinatura = partesAssinatura.join("|");
    if (assinatura === ultimaAssinatura) return; // nada mudou: sem setData
    ultimaAssinatura = assinatura;
    src.setData({ type: "FeatureCollection", features: feats });
    carrVazio = !feats.length;
  }

  // ─── HELPERS DE ESTILO ───────────────────────────────────────────────

  function carriageFillColor(train) {
    const c = MAPA.OCCUPANCY_COLORS;
    if (train.isOffline && train.occupancy == null) return c.offline;
    if (train.occupancy == null) return c.default;
    if (train.occupancy === 0) return c.empty;
    if (train.occupancy <= 50) return c.low;
    if (train.occupancy <= 85) return c.medium;
    return c.high;
  }

  function filledCarriages(train) {
    if (train.occupancy == null) return train.carriages;
    return Math.round((train.occupancy / 100) * train.carriages);
  }

  function ringColor(train) {
    return MAPA.STATUS_COLORS[train.dotStatus] || MAPA.STATUS_COLORS.gray;
  }

  function isPulsing(train) {
    return train.dotStatus === "orange" || train.dotStatus === "red";
  }

  function isAtRest(position) {
    if (!position) return true;
    return position.segment === "boarding" || position.segment === "before";
  }

  // ─── LINHA DA FERTAGUS ────────────────────────────────────────────────

  function drawLine(map, geojson) {
    if (!geojson) return;
    // A mesma geometria que desenha a linha serve para pôr as carruagens nela.
    if (CARRUAGENS_NA_LINHA && window.MapaLinha && !window.MapaLinha.pronta()) {
      window.MapaLinha.carregar(geojson);
    }
    if (!map.getSource("fertagus-line")) {
      map.addSource("fertagus-line", { type: "geojson", data: geojson });
    }
    if (!map.getLayer("fertagus-line-casing")) {
      map.addLayer({
        id: "fertagus-line-casing",
        type: "line",
        source: "fertagus-line",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#1e293b",
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3, 16, 10],
          "line-opacity": 0.35,
        },
      });
    }
    if (!map.getLayer("fertagus-line")) {
      map.addLayer({
        id: "fertagus-line",
        type: "line",
        source: "fertagus-line",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": LINHA_CLARO,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.5, 16, 5],
          "line-opacity": 0.95,
        },
      });
    }
    aplicarTemaLinha(map);
    ensureCarriageLayers(map);
    // O mapa-tema.js dispara "styledata" quando o tema muda, e é também o que
    // acontece numa troca de estilo a sério. Serve para os dois casos.
    if (!map._ltLinhaTema) {
      map._ltLinhaTema = true;
      map.on("styledata", () => aplicarTemaLinha(map));
    }
  }

  // ─── COR DA LINHA CONFORME O TEMA ────────────────────────────────────
  // Só o traço da linha muda: sobre o basemap invertido, preto sobre escuro
  // desaparecia. O casing (o contorno largo e translúcido, #1e293b a 35%)
  // fica como está — é ele que dá volume ao traço nos dois temas.
  const LINHA_CLARO = "#000000";
  const LINHA_ESCURO = "#ffffff";

  function aplicarTemaLinha(map) {
    if (!map || !map.getLayer("fertagus-line")) return;
    const escuro = document.documentElement.classList.contains("dark");
    try {
      map.setPaintProperty(
        "fertagus-line",
        "line-color",
        escuro ? LINHA_ESCURO : LINHA_CLARO,
      );
    } catch (e) {
      console.warn("[MapaRender] cor da linha:", e && e.message);
    }
  }

  // ─── ESTAÇÕES (pontos + labels) ──────────────────────────────────────
  //
  // O marcador da Fertagus são DUAS camadas: um círculo branco com contorno
  // ("fertagus-stations-bg") e, por cima, o logótipo. O logótipo é composto
  // pelo mapa-icones.js com background "none" — se trouxesse fundo próprio
  // ficava um quadrado dentro do círculo.
  //
  // Regra entre as duas: o icon-size é ~68% do DIÂMETRO do círculo, que é
  // 2 × circle-radius. Mais do que isso e o logótipo encosta ao contorno,
  // dando a sensação de não haver círculo nenhum.
  //
  //   zoom   raio   diâmetro   icon-size
  //     6      5       10          7
  //     9      8       16         11
  //    12     16       32         22
  //    15     22       44         30
  //    17     30       60         41
  //
  // Do zoom 12 para cima nada mudou. Abaixo disso o marcador encolhe: com os
  // intermodais escondidos e as linhas a 0 px até ao zoom 10, a Fertagus fica
  // sozinha no mapa e ao tamanho grande tapava metade da margem sul. A partir
  // do 12 volta ao destaque de sempre.

  // ─── SELECÇÃO ────────────────────────────────────────────────────────
  // Sem anel por cima: o círculo branco de fundo passa a verde.
  function selectionColorExpr(sel) {
    const mine = sel && sel.op === "fertagus" ? sel : null;
    const expr = window.MapaSelecao
      ? window.MapaSelecao.matchExpr(mine, ["name", "id"])
      : false;
    const green = (window.MapaSelecao && window.MapaSelecao.GREEN) || "#22C55E";
    return ["case", expr, green, "#ffffff"];
  }

  function applyStationSelection(map, sel) {
    if (!map || !map.getLayer("fertagus-stations-bg")) return;
    try {
      map.setPaintProperty(
        "fertagus-stations-bg",
        "circle-color",
        selectionColorExpr(sel),
      );
    } catch (e) {
      console.warn("[MapaRender] selecção falhou:", e && e.message);
    }
  }

  const FERTAGUS_ICON = "fertagus-logo-icon";
  const FERTAGUS_LOGO = "/imagens/lig-logos/fertagus.png";
  let fertagusIconReady = false;

  // ─── SELO DA CP NAS ESTAÇÕES PARTILHADAS ─────────────────────────────
  // Estações onde a Fertagus e a CP param. O selo aparece ao lado do marcador
  // da Fertagus, mas só quando a camada da CP está ligada e com zoom suficiente
  // — caso contrário anunciava um operador que não está no mapa.
  // O clique continua a abrir a Fertagus: o selo é informação, não um atalho.
  const CP_BADGE_ICON = "cp-badge-icon";
  const CP_BADGE_LOGO = "/imagens/lig-logos/cp.svg";
  const CP_BADGE_LAYER = "fertagus-cp-badge";
  const CP_BADGE_MINZOOM = 13; // igual ao dos restantes intermodais

  function cpBadgeLayerDef() {
    return {
      id: CP_BADGE_LAYER,
      type: "symbol",
      source: "fertagus-stations",
      minzoom: CP_BADGE_MINZOOM,
      // Sem nomes ainda: nada é desenhado até o cruzamento estar feito.
      filter: ["in", ["get", "name"], ["literal", []]],
      layout: {
        "icon-image": CP_BADGE_ICON,
        // Cerca de 45% do marcador da Fertagus.
        "icon-size": window.MapaIcones.sizeExpr([
          [8, 12],
          [12, 15],
          [15, 20],
          [17, 26],
        ]),
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        // icon-translate é em pixéis e não é multiplicado pelo icon-size, o que
        // o torna previsível: encosta o selo à direita do círculo, cujo raio
        // vai de 12 a 30 px.
        "icon-translate": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8,
          ["literal", [18, -8]],
          12,
          ["literal", [23, -10]],
          15,
          ["literal", [31, -14]],
          17,
          ["literal", [42, -19]],
        ],
      },
    };
  }

  function applyCpBadgeVisibility(map) {
    if (!map || !map.getLayer(CP_BADGE_LAYER)) return;
    const on = !window.MapaView || window.MapaView.isVisible("cp");
    try {
      map.setLayoutProperty(
        CP_BADGE_LAYER,
        "visibility",
        on ? "visible" : "none",
      );
    } catch (_) {}
  }

  function refreshCpBadges(map) {
    if (!map || !window.GtfsHorarios || !window.GtfsHorarios.sharedFertagusCp)
      return;
    // Se a camada da CP está desligada, os dados nem sequer são descarregados.
    const on = !window.MapaView || window.MapaView.isVisible("cp");
    if (!on) {
      applyCpBadgeVisibility(map);
      return;
    }
    const ready =
      window.MapaCP && window.MapaCP.ensureLoaded
        ? window.MapaCP.ensureLoaded()
        : Promise.resolve();
    Promise.all([ready, window.MapaIcones ? ensureCpBadgeIcon(map) : false])
      .then(([, iconOk]) => {
        if (!iconOk) return null;
        return window.GtfsHorarios.sharedFertagusCp();
      })
      .then((shared) => {
        if (!shared || !map.getSource("fertagus-stations")) return;
        // O filtro compara pelo nome tal como está no geojson das estações.
        const nomes = [];
        for (const st of window.MAPA && window.MAPA.STATIONS
          ? window.MAPA.STATIONS
          : [])
          if (shared.has(normName(st.name))) nomes.push(st.name);
        if (!map.getLayer(CP_BADGE_LAYER)) map.addLayer(cpBadgeLayerDef());
        map.setFilter(CP_BADGE_LAYER, [
          "in",
          ["get", "name"],
          ["literal", nomes],
        ]);
        applyCpBadgeVisibility(map);
        // Clicar no selo abre a Fertagus, tal como o resto do marcador.
        if (!map._ltCpBadgeClick) {
          map._ltCpBadgeClick = true;
          map.on("click", CP_BADGE_LAYER, onStationFeatureClick);
          map.on("mouseenter", CP_BADGE_LAYER, () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", CP_BADGE_LAYER, () => {
            map.getCanvas().style.cursor = "";
          });
        }
      })
      .catch((e) => console.warn("[MapaRender] selos da CP:", e && e.message));
  }

  function ensureCpBadgeIcon(map) {
    return window.MapaIcones.ensure(map, {
      id: CP_BADGE_ICON,
      url: CP_BADGE_LOGO,
      // Redondo com traço, para ler como um selo ao lado do círculo maior.
      background: "circle",
      padding: 0.18,
    });
  }

  function normName(v) {
    return String(v == null ? "" : v)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  // Círculo branco de fundo. É também o alvo de clique: é um círculo perfeito
  // e já responde antes de o logótipo carregar.
  function stationBackgroundLayerDef() {
    return {
      id: "fertagus-stations-bg",
      type: "circle",
      source: "fertagus-stations",
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          6,
          5,
          9,
          8,
          12,
          16,
          15,
          22,
          17,
          30,
        ],
        // Verde na estação seleccionada. É este círculo que faz de fundo do
        // logótipo, por isso é aqui que a selecção se vê.
        "circle-color": selectionColorExpr(
          window.MapaSelecao && window.MapaSelecao.current(),
        ),
        "circle-stroke-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          6,
          1,
          9,
          1.5,
          15,
          2.5,
        ],
        "circle-stroke-color": "#0f172a",
      },
    };
  }

  function stationLayerDef() {
    if (fertagusIconReady && window.MapaIcones) {
      return {
        id: "fertagus-stations-layer",
        type: "symbol",
        source: "fertagus-stations",
        layout: {
          "icon-image": FERTAGUS_ICON,
          // ~68% do diâmetro do círculo em todos os pontos, para o logótipo
          // não encostar ao contorno nem se perder no branco.
          "icon-size": window.MapaIcones.sizeExpr([
            [6, 7],
            [9, 11],
            [12, 22],
            [15, 30],
            [17, 41],
          ]),
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      };
    }
    // Enquanto o logótipo não chega, esta camada não desenha nada — quem se vê
    // é o círculo branco de baixo. rgba(0,0,0,0) em vez de "transparent", para
    // não depender de o parser de cores aceitar nomes CSS.
    return {
      id: "fertagus-stations-layer",
      type: "circle",
      source: "fertagus-stations",
      paint: { "circle-radius": 0, "circle-color": "rgba(0,0,0,0)" },
    };
  }

  function ensureStationIcon(map) {
    if (fertagusIconReady || !window.MapaIcones) return;
    window.MapaIcones.ensure(map, {
      id: FERTAGUS_ICON,
      url: FERTAGUS_LOGO,
      // Sem fundo: o círculo por baixo já é o fundo branco. Com "none" o
      // icon-size passa a ser exactamente o tamanho do logótipo.
      background: "none",
    }).then((ok) => {
      if (!ok) return; // sem logótipo fica só o círculo branco
      fertagusIconReady = true;
      if (map.getLayer("fertagus-stations-layer"))
        window.MapaIcones.replaceLayer(map, stationLayerDef());
    });
  }

  function onStationFeatureClick(e) {
    const f = e.features && e.features[0];
    if (!f) return;
    const station = MAPA.STATIONS.find(
      (s) => s.name === f.properties.name || s.apiName === f.properties.name,
    );
    if (station && window.MapaStation) window.MapaStation.open(station);
  }

  function drawStations(map, stops) {
    if (!stops) return;
    const features = stops.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.c[1], s.c[0]] },
      properties: { id: s.id, name: s.n },
    }));

    if (!map.getSource("fertagus-stations")) {
      map.addSource("fertagus-stations", {
        type: "geojson",
        data: { type: "FeatureCollection", features },
      });
    }

    // A. Círculo de fundo primeiro. É também o que fica verde na estação
    // seleccionada.
    if (!map.getLayer("fertagus-stations-bg")) {
      map.addLayer(stationBackgroundLayerDef());
      if (window.MapaSelecao && !map._ltSelFertagus) {
        map._ltSelFertagus = true;
        window.MapaSelecao.register((sel) => applyStationSelection(map, sel));
      }
    }

    // B. Logótipo por cima.
    if (!map.getLayer("fertagus-stations-layer")) {
      map.addLayer(stationLayerDef());
      ensureStationIcon(map);
    }

    // C. Nomes no topo.
    if (!map.getLayer("fertagus-stations-labels")) {
      map.addLayer({
        id: "fertagus-stations-labels",
        type: "symbol",
        source: "fertagus-stations",
        minzoom: 11,
        layout: {
          "text-field": ["get", "name"],
          // Uma fonte só: o servidor de glyphs deste estilo devolve 404 para
          // fontstacks combinados. Ver a nota no mapa-icones.js.
          "text-font": (window.MapaIcones && window.MapaIcones.FONT) || [
            "Open Sans Semibold",
          ],
          "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 16, 14],
          // 2,5 em a 14 px dá ~35 px, mais do que os 30 px de raio do círculo
          // ao zoom 17 — o nome fica abaixo do marcador, não por cima.
          "text-offset": [0, 2.5],
          "text-anchor": "top",
          "text-letter-spacing": 0.05,
          "text-transform": "uppercase",
        },
        paint: {
          "text-color": "#0f172a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 2,
          "text-halo-blur": 0.5,
        },
      });
    }

    // D. Interacção no círculo de fundo, não no logótipo: a área de clique é um
    // círculo perfeito e funciona mesmo antes de o ícone carregar.
    map.on("click", "fertagus-stations-bg", onStationFeatureClick);
    // As estações entram depois da linha: as carruagens voltam para cima.
    ensureCarriageLayers(map);
    carruagensAoTopo(map);

    // Selos da CP nas estações partilhadas, e a acompanhar o botão do olho.
    // Atrás do portão: com a camada da CP ligada, isto descarregava a CP
    // inteira ao mesmo tempo que as estações da Fertagus eram desenhadas.
    LTArranque.depois(() => refreshCpBadges(map));

    // A Fertagus está desenhada. O portão abre no primeiro "idle" (o mapa
    // acabou de pintar) ou ao fim de 2,5 s, o que vier primeiro.
    if (!LTArranque.aberto()) {
      const abrir = (m) => LTArranque.abrir(m);
      try {
        map.once("idle", () => abrir("fertagus desenhada"));
      } catch (_) {}
      setTimeout(() => abrir("limite de 2,5 s depois das estações"), 2500);
    }
    if (window.MapaView && !map._ltCpBadgeWatch) {
      map._ltCpBadgeWatch = true;
      // O onChange chama o ouvinte logo ao registar, com o estado actual —
      // era por aqui que a CP inteira escapava ao portão.
      window.MapaView.onChange(() =>
        LTArranque.depois(() => refreshCpBadges(map)),
      );
    }

    map.on("mouseenter", "fertagus-stations-bg", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "fertagus-stations-bg", () => {
      map.getCanvas().style.cursor = "";
    });
  }

  // ─── CARTÕES DE ESTAÇÃO NO TRAJECTO ──────────────────────────────────

  function computeNodeDelayMin(node) {
    if (!node || !window.MapaGeo) return null;
    const prog = window.MapaGeo.parseTimeHHMMSS(node.HoraProgramada);
    const prev = window.MapaGeo.parseTimeHHMMSS(node.HoraPrevista);
    if (!prog || !prev) return null;
    return Math.floor((prev.getTime() - prog.getTime()) / 60000);
  }

  function nodeTimeString(node) {
    if (!node) return "--:--";
    const prev = (node.HoraPrevista || "").substring(0, 5);
    const prog = (node.HoraProgramada || "").substring(0, 5);
    if (prev && !prev.startsWith("HH")) return prev;
    if (prog && !prog.startsWith("HH")) return prog;
    return "--:--";
  }

  function offsetForCard(stationKey, idxInCluster, totalInCluster) {
    // Estações distantes → posicionar acima da estação.
    if (!NORTH_CLUSTER.has(stationKey)) return [0, -10];

    // Cluster norte: spread em 4 quadrantes
    const slot = idxInCluster % 4;
    const offsets = [
      [-58, -14],
      [58, -14],
      [-58, 30],
      [58, 30],
    ];
    return offsets[slot];
  }

  // Resolver problema de cartões sobre estações futuras

  function buildStationCardHtml(station, timeStr, delayMin, isDestination) {
    const onTime = delayMin == null || delayMin < 1;
    const ringHex = onTime ? "#10b981" : "#f59e0b";
    const ringRgb = onTime ? "16,185,129" : "245,158,11";
    const delayBadge = !onTime
      ? `<span class="rsc-delay">+${delayMin} MIN</span>`
      : `<span class="rsc-ontime">A horas</span>`;

    const destTag = isDestination
      ? `<span class="rsc-dest" aria-label="Destino"></span>`
      : "";
    return `
      <div class="rsc-pill" data-station-key="${escapeHtml(station.key)}"
           style="--rsc-ring:${ringHex}; --rsc-glow:rgba(${ringRgb},.35);">
        ${destTag}
        <div class="rsc-row1">
          <span class="rsc-name">${escapeHtml(station.name)}</span>
          <span class="rsc-time">${escapeHtml(timeStr)}</span>
        </div>
        <div class="rsc-row2">${delayBadge}</div>
      </div>`;
  }

  function drawRouteStationCards(train) {
    clearRouteStationCards();
    if (!train || !mainMap || typeof maplibregl === "undefined") return;
    const allRemaining = remainingNodes(train);
    if (allRemaining.length === 0) return;
    let remaining = [];

    // 3. A LÓGICA DO FILTRO:
    // Se o userOriginKey e userDestKey existirem (vieram do link),
    // filtramos TODOS os nós do comboio (mesmo os que já passaram) para mostrar só estes dois.
    if (userOriginKey && userDestKey) {
      // PRIORIDADE 1: LINK (Mostra apenas as duas escolhidas)
      remaining = train.nodes.filter((node) => {
        const st = MAPA.resolveStationByApiId(node.EstacaoID);
        return st && (st.key === userOriginKey || st.key === userDestKey);
      });
    } else {
      // PRIORIDADE 2: NAVEGAÇÃO NORMAL (Respeita o Zoom)
      const currentZoom = mainMap.getZoom();
      lastZoomStateWasDetailed = currentZoom >= 10.8; // O nosso limite de zoom

      remaining = allRemaining.filter((node, idx) => {
        const isDestination = idx === allRemaining.length - 1;
        // Mostra se: for o destino final OR houver zoom suficiente OR for estação importante
        if (isDestination || lastZoomStateWasDetailed) return true;

        const st = MAPA.resolveStationByApiId(node.EstacaoID);
        return st && IMPORTANT_STATIONS.has(st.key);
      });
    }

    if (remaining.length === 0) return;
    let clusterIdx = 0;
    const clusterCount = remaining.filter((n) => {
      const st = MAPA.resolveStationByApiId(n.EstacaoID);
      return st && NORTH_CLUSTER.has(st.key);
    }).length;

    const lastNode = remaining[remaining.length - 1];

    remaining.forEach((node) => {
      const st = MAPA.resolveStationByApiId(node.EstacaoID);
      if (!st) return;
      const inCluster = NORTH_CLUSTER.has(st.key);
      const idx = inCluster ? clusterIdx++ : 0;

      const delayMin = computeNodeDelayMin(node);
      const timeStr = nodeTimeString(node);
      const isDestination = node === lastNode;

      const el = document.createElement("div");
      el.className = ""; // estacao removida
      el.innerHTML = buildStationCardHtml(st, timeStr, delayMin, isDestination);

      const offset = offsetForCard(st.key, idx, clusterCount);
      const m = new maplibregl.Marker({
        element: el,
        anchor: "bottom-right",
        offset: [0, -10],
      })
        .setLngLat([st.lng, st.lat])
        .addTo(mainMap);

      routeCardMarkers.set(st.key, { marker: m, el, station: st, node });
    });
  }

  function updateRouteStationCards(train) {
    if (!train) return;

    let remaining = [];
    if (userOriginKey && userDestKey) {
      remaining = train.nodes.filter((node) => {
        const st = MAPA.resolveStationByApiId(node.EstacaoID);
        return st && (st.key === userOriginKey || st.key === userDestKey);
      });
    } else {
      const allRemaining = remainingNodes(train);
      remaining = allRemaining.filter((node, idx) => {
        const isDestination = idx === allRemaining.length - 1;
        if (isDestination || lastZoomStateWasDetailed) return true;
        const st = MAPA.resolveStationByApiId(node.EstacaoID);
        return st && IMPORTANT_STATIONS.has(st.key);
      });
    }

    const remainingKeys = new Set();
    for (const node of remaining) {
      const st = MAPA.resolveStationByApiId(node.EstacaoID);
      if (!st) continue;
      remainingKeys.add(st.key);
      const entry = routeCardMarkers.get(st.key);
      if (!entry) continue;
      const delayMin = computeNodeDelayMin(node);
      const timeStr = nodeTimeString(node);
      const isDestination = node === remaining[remaining.length - 1];
      entry.el.innerHTML = buildStationCardHtml(
        entry.station,
        timeStr,
        delayMin,
        isDestination,
      );
      entry.node = node;
    }
    // Remove cards de estações já passadas
    for (const [key, entry] of Array.from(routeCardMarkers.entries())) {
      if (!remainingKeys.has(key)) {
        try {
          entry.marker.remove();
        } catch (_) {}
        routeCardMarkers.delete(key);
      }
    }
  }

  function clearRouteStationCards() {
    for (const e of routeCardMarkers.values()) {
      try {
        e.marker.remove();
      } catch (_) {}
    }
    routeCardMarkers.clear();
  }

  // ─── MARKER DOS COMBOIOS ─────────────────────────────────────────────

  function buildMarkerHtml(train) {
    const carCount = train.carriages || 4;
    const filled = filledCarriages(train);
    const fill = carriageFillColor(train);
    const ring = ringColor(train);

    const carriagesHtml = [];
    for (let i = 0; i < carCount; i++) {
      const active = i < filled;
      const bg = active ? fill : "var(--car-empty, #3f3f46)";
      const bc = active ? fill : "var(--car-empty, #3f3f46)";
      carriagesHtml.push(
        `<div class="train-carriage" data-active="${active ? "1" : "0"}"
               style="background-color:${bg}; border-color:${bc};"></div>`,
      );
    }

    const wifiHtml = `
      <svg class="train-wifi" viewBox="0 0 24 18" xmlns="http://www.w3.org/2000/svg"
           style="--wifi-color:${ring};">
        <path class="wifi-arc wifi-arc-3" d="M3 11 Q 12 -1 21 11" />
        <path class="wifi-arc wifi-arc-2" d="M6 13 Q 12 5 18 13" />
        <path class="wifi-arc wifi-arc-1" d="M9 15 Q 12 11 15 15" />
        <circle class="wifi-dot" cx="12" cy="17" r="1.1" />
      </svg>`;

    const frontSvg = `
      <img src="./imagens/front_fertagus.svg" class="train-front-img" alt="" aria-hidden="true"
           data-front-img="1" />
    `;

    const arrowSvg = `
      <svg class="train-arrow-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <polygon points="6,3 21,12 6,21" fill="${ring}"
                 stroke="white" stroke-width="1.8" stroke-linejoin="round" />
      </svg>`;

    return `
      <div class="train-view train-view-icon ${isPulsing(train) ? "pulse" : ""}"
           style="--ring-color:${ring}; --ring-glow:${ring}55;">
        <div class="train-icon-disc">
          <div class="train-ring"></div>
          <div class="train-front">${frontSvg}</div>
        </div>
        <div class="train-arrow" data-at-rest="0">
          ${arrowSvg}
        </div>
      </div>

      <div class="train-view train-view-cars ${isPulsing(train) ? "pulse" : ""}"
           style="--ring-color:${ring};">
        <div class="train-cars-body">
          <div class="train-wifi-badge">${wifiHtml}</div>
          <div class="train-cars-wrapper" data-car-count="${carCount}">
            ${carriagesHtml.join("")}
          </div>
        </div>
      </div>
    `;
  }

  function updateMarkerStyle(entry, train) {
    const el = entry.el;
    const ring = ringColor(train);
    const fill = carriageFillColor(train);
    const filled = filledCarriages(train);

    const iconView = el.querySelector(".train-view-icon");
    const carsView = el.querySelector(".train-view-cars");
    if (iconView) {
      iconView.style.setProperty("--ring-color", ring);
      iconView.style.setProperty("--ring-glow", ring + "55");
      const poly = iconView.querySelector(".train-arrow-svg polygon");
      if (poly) poly.setAttribute("fill", ring);
    }
    if (carsView) {
      carsView.style.setProperty("--ring-color", ring);
      const wifi = carsView.querySelector(".train-wifi");
      if (wifi) wifi.style.setProperty("--wifi-color", ring);
    }

    const carriageEls = el.querySelectorAll(".train-carriage");
    const carCount = train.carriages || 4;
    if (carriageEls.length !== carCount) {
      el.innerHTML = buildMarkerHtml(train);
      ensureFrontFallback(el);
      return;
    }
    carriageEls.forEach((c, i) => {
      const active = i < filled;
      c.dataset.active = active ? "1" : "0";
      c.style.backgroundColor = active ? fill : "";
      c.style.borderColor = active ? fill : "";
    });

    iconView.classList.toggle("pulse", isPulsing(train));
    carsView.classList.toggle("pulse", isPulsing(train));
  }

  /**
   * Liga onerror em JS (em vez de inline) para cumprir CSP.
   */
  function ensureFrontFallback(el) {
    const img = el.querySelector('[data-front-img="1"]');
    if (!img) return;
    img.addEventListener("error", () => {
      const span = document.createElement("span");
      span.className = "train-front-fallback";
      img.replaceWith(span);
    });
  }

  function scaleCarriagesToRealWorld(entry, zoom) {
    if (zoom < MAPA.ZOOM_DETAIL_CUTOFF || !entry.map) return;

    const train = entry.train;
    const carCount = train.carriages || 4;

    const carLengthMeters = 50;
    const carWidthMeters = 10;

    const coords = entry.marker.getLngLat();
    const metersPerPixel =
      (156543.03392 * Math.cos((coords.lat * Math.PI) / 180)) /
      Math.pow(2, zoom);
    const pixelsPerMeter = 1 / metersPerPixel;

    let carLengthPx = carLengthMeters * pixelsPerMeter;
    let carWidthPx = carWidthMeters * pixelsPerMeter;

    carLengthPx = Math.max(carLengthPx, 8);
    carWidthPx = Math.max(carWidthPx, 6);

    const wrapper = entry.el.querySelector(".train-cars-wrapper");
    if (wrapper) {
      const gapPx = Math.max(1, 0.8 * pixelsPerMeter);
      wrapper.style.gap = `${gapPx}px`;
      wrapper.style.padding = "0";
      wrapper.style.width = `${carWidthPx}px`;
    }

    const carriages = entry.el.querySelectorAll(".train-carriage");
    carriages.forEach((c) => {
      c.style.height = `${carLengthPx}px`;
      c.style.width = "100%";
      c.style.flex = "0 0 auto";
    });
  }

  function applyRotation(entry, bearing) {
    const arrow = entry.el.querySelector(".train-arrow");
    const body = entry.el.querySelector(".train-cars-body");

    if (arrow) {
      arrow.style.transform = `translate(-50%, -50%) rotate(${bearing - 90}deg) translateX(30px)`;
    }
    if (body) {
      // Com o comboio encaixado na linha manda o rumo da linha. Sem isto, o
      // animateMarkers repunha o rumo do GPS a cada frame de deslize, e o
      // sinal voltava a desalinhar entre actualizações.
      const b =
        entry.el.dataset.linha === "1" && typeof entry.linhaBearing === "number"
          ? entry.linhaBearing
          : bearing;
      body.style.transform = transformCorpo(entry, b);
      entry._rumoAplicado = b;
    }
  }

  function applyViewState(entry, zoom, position) {
    const isDetail = zoom >= MAPA.ZOOM_DETAIL_CUTOFF;
    entry.el.dataset.view = isDetail ? "cars" : "icon";

    const atRest = isAtRest(position);
    const arrow = entry.el.querySelector(".train-arrow");
    if (arrow) arrow.dataset.atRest = atRest ? "1" : "0";
  }

  // ─── API PÚBLICA: MARKERS ────────────────────────────────────────────

  function upsertTrain(map, train, position, zoom) {
    if (!position) return;
    let entry = markers.get(train.id);
    const now = performance.now();

    if (!entry) {
      const el = document.createElement("div");
      el.className = "train-marker";
      el.innerHTML = buildMarkerHtml(train);
      ensureFrontFallback(el);

      const onPress = (e) => {
        e.stopPropagation();
        userOriginKey = null;
        userDestKey = null;
        if (typeof clickHandler === "function") {
          const currentEntry = markers.get(train.id);
          const freshTrain = currentEntry ? currentEntry.train : train;
          clickHandler(freshTrain);
        }
      };
      el.addEventListener("click", onPress);
      // Teclado: Enter e Espaço abrem o comboio, como um botão.
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPress(e);
        }
      });

      const marker = new maplibregl.Marker({
        element: el,
        anchor: "center",
        rotationAlignment: "map",
        pitchAlignment: "map",
      })
        .setLngLat([position.lng, position.lat])
        .addTo(map);
      tornarAcessivel(el, train);

      entry = {
        marker,
        el,
        train,
        bearing: position.bearing || 0,
        startBearing: position.bearing || 0,
        targetBearing: position.bearing || 0,
        map,
        startPos: { lng: position.lng, lat: position.lat },
        targetPos: { lng: position.lng, lat: position.lat },
        animationStartTime:
          now - (MAPA.TRAIN_GLIDE_MS || MAPA.POSITION_UPDATE_MS || 0),
        _assente: true,
        rawLngLat: { lng: position.lng, lat: position.lat },
        isRealPosition: !!position.isReal,
      };
      markers.set(train.id, entry);

      applyViewState(entry, zoom, position);
      applyRotation(entry, position.bearing || 0);
      scaleCarriagesToRealWorld(entry, zoom);

      if (!animationFrameId) {
        animationFrameId = requestAnimationFrame(animateMarkers);
      }

      // Se este é o comboio focado, atualiza cards e foco
      if (routeFocusTrainId === train.id) {
        drawRouteStationCards(train);
        recomputeRouteFocusIfNeeded(train);
      }

      entry.el.classList.toggle("is-focused", routeFocusTrainId === train.id);
      return;
    }

    entry.map = map;
    tornarAcessivel(entry.el, train);
    // O deslize novo começa onde o comboio ESTÁ — calculado a partir do
    // deslize anterior —, e não onde está desenhado. Um comboio fora do ecrã
    // não é redesenhado (ver animateMarkers); partir da posição desenhada
    // deixava-o para trás, e ao arrastar o mapa até ele vias-o a correr para
    // apanhar o atraso. Para um comboio visível é o mesmo ponto.
    const glideMsU = MAPA.TRAIN_GLIDE_MS || MAPA.POSITION_UPDATE_MS;
    const tAgora =
      entry.startPos && entry.targetPos && glideMsU
        ? Math.max(0, Math.min(1, (now - entry.animationStartTime) / glideMsU))
        : 1;
    let pontoLogico;
    if (entry.startPos && entry.targetPos) {
      pontoLogico = {
        lng: lerp(entry.startPos.lng, entry.targetPos.lng, tAgora),
        lat: lerp(entry.startPos.lat, entry.targetPos.lat, tAgora),
      };
    } else {
      const v = entry.marker.getLngLat();
      pontoLogico = { lng: v.lng, lat: v.lat };
    }
    // O mesmo para o rumo: o valor em entry.bearing é o último APLICADO, que
    // fica parado enquanto o comboio está fora do ecrã.
    const rumoLogico =
      entry.startBearing !== undefined && entry.targetBearing !== undefined
        ? lerp(entry.startBearing, entry.targetBearing, tAgora)
        : entry.bearing || 0;
    entry.startPos = pontoLogico;
    entry.targetPos = { lng: position.lng, lat: position.lat };
    entry.animationStartTime = now;
    // Deslize novo: o ciclo pode estar a dormir, e este comboio volta a mexer.
    entry._assente = false;
    acordarCiclo();

    const newBearing = position.bearing || 0;
    let delta = newBearing - rumoLogico;

    // Contornar bloqueios de 360º para girar sempre pelo caminho mais curto
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    if (Math.abs(delta) > 0.5) {
      entry.startBearing = rumoLogico;
      entry.targetBearing = entry.startBearing + delta;
    } else {
      entry.startBearing = rumoLogico;
      entry.targetBearing = rumoLogico;
    }

    if (
      entry.train.dotStatus !== train.dotStatus ||
      entry.train.occupancy !== train.occupancy ||
      entry.train.carriages !== train.carriages ||
      entry.train.isOffline !== train.isOffline
    ) {
      updateMarkerStyle(entry, train);
    }
    entry.train = train;
    entry.isRealPosition = !!position.isReal;

    applyViewState(entry, zoom, position);
    scaleCarriagesToRealWorld(entry, zoom);

    if (routeFocusTrainId === train.id) {
      updateRouteStationCards(train);
      recomputeRouteFocusIfNeeded(train);
    }
  }

  function onZoomChange(zoom) {
    for (const entry of markers.values()) {
      applyViewState(entry, zoom, null);
      scaleCarriagesToRealWorld(entry, zoom);
    }
    const isDetailed = zoom >= 10.8;
    // Só recalculamos os cartões se o utilizador cruzou a linha de zoom (para não sobrecarregar o browser)
    if (routeFocusTrainId && isDetailed !== lastZoomStateWasDetailed) {
      lastZoomStateWasDetailed = isDetailed;
      const t = trainById(routeFocusTrainId);
      if (t) drawRouteStationCards(t); // Redesenha magicamente as estações em falta!
    }
  }

  function removeTrain(trainId) {
    const entry = markers.get(trainId);
    if (!entry) return;
    try {
      entry.marker.remove();
    } catch (_) {}
    markers.delete(trainId);
  }

  // Indica se o marcador deste comboio está a usar posição REAL (TML) ou
  // a estimativa do mapa-geo. Usado pelo modal de detalhes para o rótulo.
  function isRealPosition(trainId) {
    const entry = markers.get(trainId);
    return !!(entry && entry.isRealPosition);
  }

  function removeMissingTrains(currentIds) {
    const keep = new Set(currentIds);
    for (const id of Array.from(markers.keys())) {
      if (!keep.has(id)) removeTrain(id);
    }
  }

  function removeAllTrains() {
    for (const id of Array.from(markers.keys())) removeTrain(id);
  }

  function setClickHandler(fn) {
    clickHandler = fn;
  }

  function getMarkers() {
    return markers;
  }

  // ─── INTERAÇÃO MANUAL DO USER COM O MAPA ─────────────────────────────
  function setMap(mapInstance) {
    mainMap = mapInstance;
    acessibilidadePainel();
    // Se a linha nunca chegar a ser desenhada (a rede falhou), o resto do mapa
    // não pode ficar à espera para sempre.
    setTimeout(() => LTArranque.abrir("limite de 6 s depois do mapa"), 6000);
    const detachIfUser = (e) => {
      if (!routeFocusTrainId) return;
      if (isFlying) return; // movimento causado pelo nosso fitBounds
      if (e && e.originalEvent) {
        routeFocusUserDetached = true;
        // NOVO: Desativar followMode e repor botão se houver interação mecânica do utilizador (pan, scroll, pitch)
        if (followModeTrainId) {
          followModeTrainId = null;
          const b = document.querySelector('[data-details-action="follow"]');
          if (b) {
            b.classList.remove(
              "text-blue-500",
              "dark:text-blue-400",
              "bg-blue-50",
              "dark:bg-blue-500/10",
            );
            b.classList.add(
              "text-zinc-400",
              "hover:text-zinc-900",
              "dark:hover:text-white",
            );
          }
        }
      }
    };
    mainMap.on("dragstart", detachIfUser);
    mainMap.on("touchstart", detachIfUser);
    mainMap.on("wheel", detachIfUser);
    mainMap.on("rotatestart", detachIfUser);
    mainMap.on("pitchstart", detachIfUser);
  }

  function isFollowModeActive(trainId) {
    return followModeTrainId === trainId;
  }

  function toggleFollowMode(train) {
    if (!mainMap || !train) return false;
    if (followModeTrainId === train.id) {
      // Desativar: Levantar a câmara e restaurar foco 2D.
      followModeTrainId = null;
      mainMap.easeTo({ pitch: 0, duration: 600 });
      applyRouteFocus(train, { subtle: false });
      return false;
    } else {
      // Ativar: Mudar a câmara com inércia para dentro do comboio.
      followModeTrainId = train.id;
      routeFocusTrainId = train.id;
      routeFocusUserDetached = false;
      isFlying = true;

      const entry = markers.get(train.id);
      const pos = entry
        ? { lng: entry.targetPos.lng, lat: entry.targetPos.lat }
        : window.MapaGeo.computeTrainPosition(train, new Date());
      const bearing = entry
        ? entry.targetBearing || entry.bearing || 0
        : pos.bearing || 0;

      mainMap.easeTo({
        center: [pos.lng, pos.lat],
        zoom: 16.8, // Zoom alto e suficiente para as carruagens
        pitch: 65, // Tilted como a visão de um pára-brisas
        bearing: bearing,
        padding: {
          top: 0,
          bottom: Math.max(300, window.innerHeight * 0.42),
          left: 0,
          right: 0,
        },
        duration: 1200,
      });

      mainMap.once("moveend", () => {
        isFlying = false; // liberta a flag e passa a ser atualizado frame-a-frame no jumpTo()
      });
      return true;
    }
  }

  // ─── EXPORT ──────────────────────────────────────────────────────────
  window.MapaRender = {
    setMap,
    // Focus
    toggleFollowMode,
    isFollowModeActive,
    // Novo modelo
    startRouteFocus,
    endRouteFocus,
    isRouteFocused,
    drawRouteStationCards,
    updateRouteStationCards,
    clearRouteStationCards,
    showWholeLine,
    setUserRouteFilter,
    // Compat
    startTracking,
    startTrackingTrain,
    stopTracking,
    focusStation,
    recenterTracking,
    // Render
    drawLine,
    drawStations,
    upsertTrain,
    removeTrain,
    removeMissingTrains,
    removeAllTrains,
    onZoomChange,
    setClickHandler,
    getMarkers,
    isRealPosition,
    _ringColor: ringColor,
    _carriageFillColor: carriageFillColor,
    _atualizarCarruagens: atualizarCarruagens,
    _rumoNaLinha: rumoNaLinha,
    _filledCarriages: filledCarriages,
  };
})();

/**
 * mapa-selecao.js · LiveTagus (mapa)
 * Quem está seleccionado no mapa — e como isso se mostra.
 *
 * Antes este módulo desenhava um anel verde por cima do marcador. Agora não
 * desenha nada: é o FUNDO do próprio marcador que fica verde (o círculo atrás
 * do logótipo da Fertagus, o quadrado atrás dos outros logótipos). Cada camada
 * sabe pintar-se a si própria; este módulo só diz qual é a seleccionada.
 *
 * O modelo é um estado central com subscritores:
 *   - As sheets (Fertagus, Metro, MTS, CP, Carris) chamam set() ao abrir e
 *     clear() ao fechar. A ligação é feita aqui, envolvendo os open/close, para
 *     os outros módulos não precisarem de alterações.
 *   - As camadas chamam register(fn) e recebem a selecção sempre que muda,
 *     incluindo o estado no momento em que se registam. Têm também de voltar a
 *     aplicar depois de recriarem camadas (mudança de tema, troca do círculo
 *     pelo logótipo): o MapLibre não guarda expressões de camadas que
 *     deixaram de existir.
 *
 * O azul é #3b82f6 , o mesmo que quando se seleciona um comboio
 *
 * API:
 *   MapaSelecao.set({ op, id, name, stopId, lng, lat })
 *   MapaSelecao.clear() | current() | operator()
 *   MapaSelecao.register(fn)          → fn(sel|null) a cada mudança
 *   MapaSelecao.matchExpr(sel, props) → expressão que dá true na feature
 *                                       seleccionada
 */

(function () {
  "use strict";
  if (window.MapaSelecao) return;

  const GREEN = "#3b82f6 ";

  let current = null;
  const subscribers = [];

  function notify() {
    for (const fn of subscribers.slice()) {
      try {
        fn(current);
      } catch (e) {
        console.warn("[MapaSelecao] subscritor falhou:", e && e.message);
      }
    }
  }

  function set(sel) {
    if (!sel) return;
    const next = {
      op: sel.op || null,
      id: sel.id != null ? String(sel.id) : null,
      stopId: sel.stopId != null ? String(sel.stopId) : null,
      name: sel.name != null ? String(sel.name) : null,
      lng: typeof sel.lng === "number" ? sel.lng : null,
      lat: typeof sel.lat === "number" ? sel.lat : null,
    };
    if (!next.op || (!next.id && !next.stopId && !next.name)) return;
    if (
      current &&
      current.op === next.op &&
      current.id === next.id &&
      current.stopId === next.stopId &&
      current.name === next.name
    ) {
      return; // nada mudou
    }
    current = next;
    notify();
  }

  function clear() {
    if (!current) return;
    current = null;
    notify();
  }

  function currentSel() {
    return current ? Object.assign({}, current) : null;
  }

  function operator() {
    return current ? current.op : null;
  }

  function register(fn) {
    if (typeof fn !== "function") return function () {};
    subscribers.push(fn);
    try {
      fn(current); // estado inicial, para quem se regista tarde
    } catch (_) {}
    return function () {
      const i = subscribers.indexOf(fn);
      if (i >= 0) subscribers.splice(i, 1);
    };
  }

  /**
   * Expressão que dá true na feature seleccionada.
   * @param {object|null} sel  selecção, já filtrada pelo operador de quem chama
   * @param {string[]} props   propriedades que identificam a feature na camada
   * @returns {Array|boolean}  expressão MapLibre, ou false constante
   *
   * Compara todos os identificadores conhecidos contra todas as propriedades
   * indicadas: cada camada chama a sua estação por um nome diferente (stop_id
   * no bundle, id_destino no geojson do Metro, id no do MTS) e nem sempre é o
   * mesmo campo que a sheet recebeu. O to-string evita falhar quando um dos
   * lados é número e o outro texto.
   */
  function matchExpr(sel, props) {
    if (!sel || !props || !props.length) return false;
    const values = [];
    for (const v of [sel.stopId, sel.id, sel.name]) {
      if (v != null && v !== "" && values.indexOf(String(v)) === -1)
        values.push(String(v));
    }
    if (!values.length) return false;
    const tests = [];
    for (const prop of props) {
      for (const v of values) {
        tests.push(["==", ["to-string", ["get", prop]], v]);
      }
    }
    return tests.length === 1 ? tests[0] : ["any"].concat(tests);
  }

  // ─── LIGAÇÃO ÀS SHEETS ───────────────────────────────────────────────
  //
  // Envolver os open/close evita tocar no mapa-station.js e no mapa-cm.js. O
  // clear() no close é o que garante que o verde sai ao fechar o painel, seja
  // pelo X, pelo Escape, pelo fundo ou arrastando para baixo — todos esses
  // caminhos passam pelo close().
  function wrap(name, method, handler) {
    const mod = window[name];
    if (!mod || typeof mod[method] !== "function") return false;
    const flag = "_sel_" + method;
    if (mod[flag]) return true;
    const orig = mod[method];
    mod[method] = function () {
      const out = orig.apply(this, arguments);
      try {
        handler.apply(null, arguments);
      } catch (_) {}
      return out;
    };
    mod[flag] = true;
    return true;
  }

  const WIRING = [
    [
      "MapaStation",
      "open",
      (st) => {
        if (!st) return;
        set({
          op: "fertagus",
          id: st.id != null ? st.id : null,
          name: st.name || null,
          lng: typeof st.lng === "number" ? st.lng : null,
          lat: typeof st.lat === "number" ? st.lat : null,
        });
      },
    ],
    ["MapaStation", "close", () => clear()],
    [
      "MapaCM",
      "open",
      (stop) => {
        if (!stop) return;
        const loc = Array.isArray(stop.location) ? stop.location : [];
        set({
          op: "cm",
          id: stop.id,
          name: stop.name || null,
          lat: typeof loc[0] === "number" ? loc[0] : null,
          lng: typeof loc[1] === "number" ? loc[1] : null,
        });
      },
    ],
    ["MapaCM", "close", () => clear()],
    // Detalhe de comboio: é um veículo, não uma paragem.
    ["MapaDetails", "open", () => clear()],
  ];

  function wireAll() {
    let missing = 0;
    for (const entry of WIRING) {
      if (!wrap(entry[0], entry[1], entry[2])) missing++;
    }
    return missing === 0;
  }

  if (!wireAll()) {
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (wireAll() || tries > 100) clearInterval(t);
    }, 40);
  }

  window.MapaSelecao = {
    set,
    clear,
    current: currentSel,
    operator,
    register,
    matchExpr,
    GREEN,
  };
})();

/**
 * mapa-icones.js · LiveTagus (mapa)
 * Transforma um logótipo de operador num ícone de mapa com FUNDO BRANCO.
 *
 * Serve as camadas de estações do Metro de Lisboa, do Metro Sul e da CP, que
 * passaram de círculos para símbolos com o logótipo. O fundo branco é composto
 * aqui, desenhado em canvas e registado com map.addImage() — em vez de ficar
 * numa camada de círculos por baixo. Assim é uma camada só, o fundo acompanha
 * o ícone em qualquer zoom, e o logótipo continua legível sobre o mapa escuro
 * (os SVG dos operadores são maioritariamente transparentes e com traço
 * escuro; sem fundo desapareciam).
 *
 * Os logótipos são 1:1, por isso o fundo é um quadrado de cantos arredondados.
 * O ajuste é "contain": um logótipo que não seja quadrado não é esticado.
 *
 * Se a imagem não carregar (ficheiro em falta, formato não suportado), o
 * ensure() devolve false e quem chamou mantém o círculo de sempre — nunca fica
 * um mapa sem estações.
 *
 * API:
 *   MapaIcones.ensure(map, { id, url })      → Promise<boolean>
 *   MapaIcones.sizeExpr([[zoom, diâmetroPx]…]) → expressão para icon-size
 *
 * Inclusão: <script src="./mapa-icones.js" defer></script> (antes dos módulos
 * de camadas: mapa-metro-lisboa.js, mapa-mts.js, mapa-cp.js)
 */

(function () {
  "use strict";
  if (window.MapaIcones) return;

  // Lado do ícone em px CSS. O icon-size das camadas é calculado a partir
  // daqui, para os diâmetros continuarem exactamente os mesmos de antes.
  const BASE = 44;
  // 3x em vez de 2x: os ícones cresceram (a Fertagus chega aos 52 px) e a 2x
  // ficavam a interpolar num ecrã retina.
  const RATIO = 3;
  const PAD = 0.15; // margem interna, em fracção do lado
  const RADIUS = 0.28; // raio dos cantos, em fracção do lado
  const BORDER = "rgba(0,0,0,0.55)"; // mesmo peso visual do traço do círculo

  // A chave inclui o estilo: o mesmo logótipo pode ser composto com fundo
  // quadrado numa camada e sem fundo nenhum noutra.
  const cache = new Map(); // chave -> Promise<ImageData|null>
  const registered = new WeakMap(); // map -> Map(id -> url)

  function roundedRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  function draw(img, style) {
    const side = BASE * RATIO;
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Fundo branco, sempre — independentemente do tema do mapa. Excepto em
    // "none", para quando a camada já tem o seu próprio fundo por baixo (é o
    // caso da Fertagus, que usa um círculo próprio): aí compor um quadrado aqui
    // punha um quadrado dentro do círculo.
    if (style.background !== "none") {
      const inset = 0.5 * RATIO;
      const w = side - inset * 2;
      ctx.fillStyle = style.bgColor;
      if (style.background === "circle") {
        ctx.beginPath();
        ctx.arc(side / 2, side / 2, w / 2, 0, Math.PI * 2);
        ctx.closePath();
      } else {
        roundedRect(ctx, inset, inset, w, w, RADIUS * side);
      }
      ctx.fill();
      if (style.border) {
        ctx.lineWidth = 1 * RATIO;
        ctx.strokeStyle = BORDER;
        ctx.stroke();
      }
    }

    // Logótipo ajustado por "contain", centrado.
    const box = side * (1 - style.padding * 2);
    const nw = img.naturalWidth || img.width || 1;
    const nh = img.naturalHeight || img.height || 1;
    const scale = Math.min(box / nw, box / nh);
    const w = nw * scale;
    const h = nh * scale;
    try {
      ctx.drawImage(img, (side - w) / 2, (side - h) / 2, w, h);
    } catch (_) {
      return null;
    }

    try {
      return ctx.getImageData(0, 0, side, side);
    } catch (_) {
      // Canvas contaminado (imagem de outra origem): sem ícone.
      return null;
    }
  }

  function build(url, style) {
    const key = `${url}|${style.background}|${style.bgColor}|${style.padding}|${style.border}`;
    if (cache.has(key)) return cache.get(key);
    const p = new Promise((resolve) => {
      // Tudo aqui dentro é opcional: um ícone que não se consegue compor não
      // pode derrubar quem está à espera. Sem este try, uma excepção aqui
      // rebentava a cadeia de carregamento da camada inteira.
      let img;
      try {
        img = new Image();
      } catch (_) {
        resolve(null);
        return;
      }
      // Os logótipos são da mesma origem; isto só evita surpresas se algum dia
      // passarem a vir de um CDN.
      img.crossOrigin = "anonymous";
      img.onload = () => {
        // Um SVG sem width/height declarados reporta naturalWidth 0; o
        // drawImage com dimensões explícitas continua a funcionar desde que
        // tenha viewBox, por isso não se desiste aqui.
        resolve(draw(img, style));
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    cache.set(key, p);
    return p;
  }

  // Normaliza as opções de estilo do ícone.
  //   background: "square" (por omissão) | "circle" | "none"
  //   padding:    margem à volta do logótipo, em fracção do lado. Sem fundo, o
  //               valor por omissão é 0 — assim o icon-size da camada passa a
  //               ser exactamente o tamanho do logótipo, sem margens invisíveis
  //               a confundir as contas.
  //   border:     traço escuro à volta do fundo (ignorado em "none")
  //   bgColor:    cor do fundo (branco por omissão). Serve para compor a
  //               variante verde da paragem seleccionada.
  function styleOf(opts) {
    const background = (opts && opts.background) || "square";
    return {
      background,
      bgColor: (opts && opts.bgColor) || "#ffffff",
      padding:
        opts && typeof opts.padding === "number"
          ? opts.padding
          : background === "none"
            ? 0
            : PAD,
      border: !(opts && opts.border === false),
    };
  }

  // Uma mudança de estilo (tema claro/escuro) deita fora as imagens
  // registadas; voltam a ser postas quando isso acontece.
  function watch(map) {
    if (map._ltIconsWatched) return;
    map._ltIconsWatched = true;
    map.on("styledata", () => {
      const mine = registered.get(map);
      if (!mine) return;
      mine.forEach(({ url, style }, id) => {
        try {
          if (map.hasImage && map.hasImage(id)) return;
        } catch (_) {}
        build(url, style).then((data) => {
          if (!data) return;
          try {
            if (!map.hasImage || !map.hasImage(id))
              map.addImage(id, data, { pixelRatio: RATIO });
          } catch (_) {}
        });
      });
    });
  }

  /**
   * Compõe e regista o ícone no mapa.
   * @param {object} opts { id, url, background?, padding?, border? }
   *   background "square" (por omissão) → quadrado branco de cantos
   *     arredondados com traço escuro. É o que serve o Metro, o MTS, a CP e a
   *     Carris, cujas camadas não têm fundo próprio.
   *   background "circle" → o mesmo mas redondo, para quem quer o marcador
   *     circular sem uma segunda camada.
   *   background "none" → só o logótipo, transparente. Para camadas que já
   *     desenham o seu próprio fundo por baixo (a Fertagus tem um círculo em
   *     "fertagus-stations-bg"): compor aqui um fundo punha um quadrado dentro
   *     do círculo.
   * @returns {Promise<boolean>} false se não foi possível — mantém o círculo.
   */
  function ensure(map, opts) {
    const id = opts && opts.id;
    const url = opts && opts.url;
    if (!map || !id || !url) return Promise.resolve(false);

    let mine = registered.get(map);
    if (!mine) {
      mine = new Map();
      registered.set(map, mine);
    }
    const style = styleOf(opts);
    mine.set(id, { url, style });
    watch(map);

    try {
      if (map.hasImage && map.hasImage(id)) return Promise.resolve(true);
    } catch (_) {}

    return build(url, style).catch(() => null).then((data) => {
      if (!data) {
        console.warn(`[MapaIcones] "${url}" não carregou; fica o círculo.`);
        return false;
      }
      try {
        if (!map.hasImage || !map.hasImage(id))
          map.addImage(id, data, { pixelRatio: RATIO });
        return true;
      } catch (e) {
        console.warn("[MapaIcones] addImage falhou:", e && e.message);
        return false;
      }
    });
  }

  /**
   * Converte diâmetros em px para uma expressão de icon-size, para as camadas
   * ficarem exactamente do tamanho que os círculos tinham.
   * @param {Array<[number, number]>} stops [[zoom, diâmetroPx], …]
   */
  function sizeExpr(stops) {
    const expr = ["interpolate", ["linear"], ["zoom"]];
    for (const [zoom, px] of stops) {
      expr.push(zoom, px / BASE);
    }
    return expr;
  }

  /**
   * Substitui uma camada por outra com o MESMO id, mantendo a posição no
   * estilo. Serve para desenhar já o círculo e passar ao logótipo quando o
   * ícone estiver composto, sem esperar. Os handlers registados por id
   * (map.on("click", id, …)) continuam a funcionar, porque a ligação é ao id
   * e não ao objecto da camada.
   */
  function replaceLayer(map, def) {
    if (!map || !def || !def.id) return false;
    let beforeId;
    try {
      const style = map.getStyle && map.getStyle();
      const layers = (style && style.layers) || [];
      const i = layers.findIndex((l) => l.id === def.id);
      if (i >= 0 && layers[i + 1]) beforeId = layers[i + 1].id;
    } catch (_) {}
    try {
      if (map.getLayer(def.id)) map.removeLayer(def.id);
    } catch (_) {}
    try {
      map.addLayer(def, beforeId);
      return true;
    } catch (_) {
      try {
        map.addLayer(def);
        return true;
      } catch (e) {
        console.warn("[MapaIcones] não foi possível trocar", def.id, e && e.message);
        return false;
      }
    }
  }

  // Fontstack das etiquetas. UMA fonte só, de propósito.
  //
  // O estilo vai buscar os glyphs a demotiles.maplibre.org, e o MapLibre pede o
  // fontstack INTEIRO num único caminho, separado por vírgulas:
  //   /font/Open%20Sans%20Semibold,Arial%20Unicode%20MS%20Bold/0-255.pbf → 404
  // Esse servidor tem ficheiros pré-gerados apenas para nomes isolados, por isso
  // qualquer par falha — e um fontstack em falta não desenha texto nenhum, sem
  // erro na consola (só o 404 no separador Network). "Open Sans Semibold" é o
  // que o próprio estilo do demotiles usa, logo é o que existe garantidamente.
  //
  // Se passares para um servidor de glyphs a sério (Maptiler, Protomaps, ou
  // glyphs próprios), aqui é o único sítio a mudar — e aí já podes ter
  // fallbacks a mais de uma fonte.
  const FONT = ["Open Sans Semibold"];

  window.MapaIcones = { ensure, sizeExpr, replaceLayer, BASE, FONT };
})();

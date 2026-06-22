/* ============================================================================
 * train-scrollbar.js  ·  LiveTagus
 * Scrollbar personalizada "comboio na linha", plug-and-play e arrastável.
 *
 * <script src="/train-scrollbar.js" defer></script>   (CSP: script-src 'self')
 *
 * - Auto-injeta CSS + DOM (document.createElement) + lógica.
 * - Esconde a scrollbar nativa (o scroll da página continua a funcionar).
 * - DESKTOP (≥768px): comboio ~24px numa linha fina (carris + travessas),
 *   centrado e alinhado com o #menu-trigger.
 * - MOBILE (<768px): o MESMO comboio mas mais pequeno, sobre um traço fino,
 *   afastado da margem (respeita ecrãs curvos via safe-area-inset).
 * - ARRASTÁVEL (desktop e mobile): agarra o comboio e arrasta para fazer
 *   scroll, como uma scrollbar normal. Só o comboio capta toques; o resto da
 *   página continua a fazer scroll normalmente.
 * - A seta inverte conforme a direção do scroll (baixo / cima / fundo).
 * ========================================================================== */
(function () {
  "use strict";
  if (window.__ltTrainScrollbar) return;
  window.__ltTrainScrollbar = true;

  /* ----------------------------- CONFIG ----------------------------------- */
  const CFG = {
    brand: "#10b981", // cor da marca (Emerald). Azul: "#3b82f6"
    glow: "rgba(16,185,129,.55)", // halo/glow da marca
    frontSrc: "/imagens/front_fertagus.svg", // frente do comboio
    trainSize: 40, // px — comboio (desktop)
    trainSizeMobile: 20, // px — comboio (mobile, mais pequeno)
    railLineGap: 15, // px — distância entre os dois carris (desktop)
    mobileRightPx: 0, // px — afastamento da margem (mobile / ecrãs curvos)
    gapTop: 14, // px — folga abaixo do menu
    gapBottom: 26, // px — folga acima do fundo
    footerPad: 14, // px — não sobrepor o footer
    breakpoint: 768, // px — corte desktop/mobile
    zIndex: 30,
    triggerSel: "#menu-trigger",
    footerSel: "#global-footer",
  };

  const doc = document.documentElement;
  const isDesktop = () => window.innerWidth >= CFG.breakpoint;

  /* ----------------------------- ESTILOS ---------------------------------- */
  function injectCSS() {
    if (document.getElementById("ltts-style")) return;
    const s = document.createElement("style");
    s.id = "ltts-style";
    s.textContent = `
      /* esconder a scrollbar nativa (scroll continua funcional) */
      html { scrollbar-width: none; -ms-overflow-style: none; }
      html::-webkit-scrollbar, body::-webkit-scrollbar { width:0; height:0; display:none; }

      #ltts-root{
        position:fixed; z-index:${CFG.zIndex};
        pointer-events:none;            /* só o comboio é interativo */
        opacity:0; transition:opacity .45s cubic-bezier(.16,1,.3,1);
        --ltts-brand:${CFG.brand}; --ltts-glow:${CFG.glow};
        --ltts-bg:#fff; --ltts-halo:rgba(255,255,255,.85);
        --ltts-tie:rgba(9,9,11,.13); --ltts-line:rgba(9,9,11,.20);
      }
      html.dark #ltts-root{
        --ltts-bg:#09090b; --ltts-halo:rgba(9,9,11,.85);
        --ltts-tie:rgba(255,255,255,.13); --ltts-line:rgba(255,255,255,.20);
      }
      #ltts-root.is-ready{ opacity:1; }

      /* traço/linha */
      .ltts-rail{ position:absolute; inset:0; width:100%; height:100%; display:block; }
      .ltts-tie{ fill:var(--ltts-tie); }
      .ltts-line{ fill:var(--ltts-line); }
      .ltts-track{
        position:absolute; left:50%; top:0; transform:translateX(-50%);
        width:2px; height:100%; border-radius:2px; background:var(--ltts-line);
      }

      /* comboio (tamanho relativo via --ts-size → serve desktop e mobile) */
      .ltts-train{
        position:absolute; left:50%; top:0;
        width:var(--ts-size); height:var(--ts-size);
        --ts-half:calc(var(--ts-size)/2); --ts-gap:calc(var(--ts-size)*0.32);
        transform:translateX(-50%);
        pointer-events:auto; touch-action:none; cursor:grab;
        will-change:transform; /* <-- ALTERADO AQUI */
      }
      .ltts-train.is-drag{ cursor:grabbing; }
      /* área de toque maior (não visível) p/ arrastar com o dedo */
      .ltts-train::before{ content:""; position:absolute; inset:var(--ts-hit,-8px); border-radius:50%; }

      .ltts-disc{ position:absolute; inset:0; }
      .ltts-ring{
        position:absolute; inset:0; border-radius:50%;
        border:2px solid var(--ltts-brand); background:var(--ltts-bg);
        box-shadow:0 0 0 2px var(--ltts-halo), 0 0 12px var(--ltts-glow), 0 1px 4px rgba(0,0,0,.25);
      }
      @media (prefers-reduced-motion: no-preference){
        .ltts-ring{ animation:ltts-pulse 1.8s ease-in-out infinite; }
      }
      @keyframes ltts-pulse{
        0%,100%{ box-shadow:0 0 0 2px var(--ltts-halo), 0 0 12px var(--ltts-glow), 0 1px 4px rgba(0,0,0,.25); }
        50%{ box-shadow:0 0 0 2px var(--ltts-halo), 0 0 0 5px var(--ltts-glow), 0 0 18px var(--ltts-brand), 0 1px 4px rgba(0,0,0,.25); }
      }.ltts-front{ position:absolute; inset:0; object-fit:contain; display:block; transform: scale(0.7); }
      .ltts-fallback{ position:absolute; inset:16%; display:grid; place-items:center; }
      .ltts-fallback svg{ width:100%; height:100%; }

      .ltts-arrow{
        position:absolute; left:50%; top:50%;
        width:calc(var(--ts-size)*0.58); height:calc(var(--ts-size)*0.58);
        transform:translate(-50%,-50%) translateY(calc(var(--ts-half) + var(--ts-gap))) rotate(90deg);
        transition:transform .45s cubic-bezier(.16,1,.3,1);
        filter:drop-shadow(0 1px 2px rgba(0,0,0,.35)); pointer-events:none;
      }
      .ltts-train.is-up .ltts-arrow{
        transform:translate(-50%,-50%) translateY(calc((var(--ts-half) + var(--ts-gap)) * -1)) rotate(-90deg);
      }
      .ltts-arrow svg{ width:100%; height:100%; display:block; }

      @media (prefers-reduced-motion: reduce){
        #ltts-root, .ltts-arrow { transition:none; }
      }
    `;
    document.head.appendChild(s);
  }

  /* ----------------------- SVG da linha (desktop) ------------------------- */
  function buildRailSVG(w) {
    const tieGap = 14,
      tieH = 3,
      tieW = Math.max(14, CFG.railLineGap + 8);
    const railTh = 2,
      cx = w / 2;
    const tieX = cx - tieW / 2;
    const r1 = cx - CFG.railLineGap / 2 - railTh / 2;
    const r2 = cx + CFG.railLineGap / 2 - railTh / 2;
    const uid = "ltts-ties-" + Math.random().toString(36).slice(2, 7);
    return (
      '<svg class="ltts-rail" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<defs><pattern id="' +
      uid +
      '" x="0" y="0" width="' +
      w +
      '" height="' +
      tieGap +
      '" patternUnits="userSpaceOnUse">' +
      '<rect class="ltts-tie" x="' +
      tieX +
      '" y="' +
      (tieGap - tieH) / 2 +
      '" width="' +
      tieW +
      '" height="' +
      tieH +
      '" rx="' +
      tieH / 2 +
      '"></rect></pattern></defs>' +
      '<rect x="0" y="0" width="100%" height="100%" fill="url(#' +
      uid +
      ')"></rect>' +
      '<rect class="ltts-line" x="' +
      r1 +
      '" y="0" width="' +
      railTh +
      '" height="100%" rx="' +
      railTh / 2 +
      '"></rect>' +
      '<rect class="ltts-line" x="' +
      r2 +
      '" y="0" width="' +
      railTh +
      '" height="100%" rx="' +
      railTh / 2 +
      '"></rect>' +
      "</svg>"
    );
  }

  /* ----------------------- comboio (desktop + mobile) --------------------- */
  function buildTrain(sizePx, hitPx) {
    const t = document.createElement("div");
    t.className = "ltts-train";
    t.style.setProperty("--ts-size", sizePx + "px");
    t.style.setProperty("--ts-hit", hitPx + "px");
    t.setAttribute("role", "scrollbar");
    t.setAttribute("aria-label", "Posição na página (arrastável)");
    t.innerHTML =
      '<div class="ltts-disc">' +
      '<span class="ltts-ring"></span>' +
      '<img class="ltts-front" src="' +
      CFG.frontSrc +
      '" alt="" aria-hidden="true">' +
      "</div>" +
      '<div class="ltts-arrow">' +
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<polygon points="6,3 21,12 6,21" style="fill:var(--ltts-brand);stroke:#fff;" stroke-width="1.8" stroke-linejoin="round"></polygon>' +
      "</svg></div>";

    const img = t.querySelector(".ltts-front");
    img.addEventListener("error", () => {
      img.remove();
      const fb = document.createElement("span");
      fb.className = "ltts-fallback";
      fb.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M7 4.5h10a2 2 0 0 1 2 2V15a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 15V6.5a2 2 0 0 1 2-2Z" style="fill:var(--ltts-brand);opacity:.18"></path>' +
        '<path d="M7 4.5h10a2 2 0 0 1 2 2V15a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 15V6.5a2 2 0 0 1 2-2Z" style="stroke:var(--ltts-brand)" stroke-width="1.5"></path>' +
        '<rect x="7.5" y="7.5" width="9" height="4" rx="1" style="fill:var(--ltts-brand)"></rect>' +
        '<circle cx="8.5" cy="14.5" r="1" style="fill:var(--ltts-brand)"></circle>' +
        '<circle cx="15.5" cy="14.5" r="1" style="fill:var(--ltts-brand)"></circle></svg>';
      t.querySelector(".ltts-disc").appendChild(fb);
    });

    attachDrag(t);
    return t;
  }

  /* ------------------------- arrastar (drag) ------------------------------ */
  function attachDrag(handle) {
    let dragging = false;
    const moveTo = (clientY) => {
      const trackH = parseFloat(root.style.height) || 0;
      const span = Math.max(1, trackH - curTrainSize);
      let top = clientY - baseTop - curTrainSize / 2;
      top = Math.min(span, Math.max(0, top));
      const max = Math.max(0, doc.scrollHeight - window.innerHeight);
      window.scrollTo(0, (top / span) * max);
    };
    handle.addEventListener("pointerdown", (e) => {
      dragging = true;
      handle.classList.add("is-drag");
      try {
        handle.setPointerCapture(e.pointerId);
      } catch (_) {}
      document.body.style.userSelect = "none";
      moveTo(e.clientY);
      e.preventDefault();
    });
    handle.addEventListener("pointermove", (e) => {
      if (dragging) {
        moveTo(e.clientY);
        e.preventDefault();
      }
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove("is-drag");
      document.body.style.userSelect = "";
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch (_) {}
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  /* ------------------------------ ESTADO ---------------------------------- */
  let root,
    train,
    mode = null, // 'desktop' | 'mobile'
    builtRailW = 0,
    baseTop = 0,
    lastScroll = 0,
    curTrainSize = CFG.trainSize,
    idleT = null,
    ticking = false,
    started = false;

  const W_DESKTOP = CFG.trainSize + 6;

  function anchor() {
    const trigger = document.querySelector(CFG.triggerSel);
    if (!trigger) return null;
    const line = trigger.querySelector("span") || trigger;
    const lr = line.getBoundingClientRect();
    const header = trigger.closest("header");
    const hb = header
      ? header.getBoundingClientRect().bottom
      : trigger.getBoundingClientRect().bottom;
    if (lr.width === 0 && hb === 0) return null;
    return { centerX: lr.left + lr.width / 2, headerBottom: hb };
  }

  function buildForMode(next) {
    mode = next;
    root.innerHTML = "";
    builtRailW = 0;
    if (mode === "desktop") {
      curTrainSize = CFG.trainSize;
      train = buildTrain(CFG.trainSize, -6); // a linha (SVG) é inserida no layout
      root.appendChild(train);
    } else {
      curTrainSize = CFG.trainSizeMobile;
      const track = document.createElement("div");
      track.className = "ltts-track";
      root.appendChild(track);
      train = buildTrain(CFG.trainSizeMobile, -10);
      root.appendChild(train);
    }
  }

  function ensureRailSVG(w) {
    if (mode !== "desktop") return;
    if (w !== builtRailW) {
      builtRailW = w;
      const old = root.querySelector(".ltts-rail");
      if (old) old.remove();
      root.insertAdjacentHTML("afterbegin", buildRailSVG(w));
    }
  }

  function layout() {
    const want = isDesktop() ? "desktop" : "mobile";
    if (want !== mode) buildForMode(want);

    const a = anchor();
    if (!a) {
      root.classList.remove("is-ready");
      return;
    }
    baseTop = a.headerBottom + CFG.gapTop;

    if (mode === "desktop") {
      const w = W_DESKTOP;
      ensureRailSVG(w);
      root.style.right = "";
      root.style.width = w + "px";
      root.style.left = a.centerX - w / 2 + "px";
    } else {
      const w = curTrainSize + 12;
      root.style.left = "";
      root.style.width = w + "px";
      // afastado da margem + respeita o recorte de ecrãs curvos
      root.style.right = `max(${CFG.mobileRightPx}px, env(safe-area-inset-right, 0px))`;
    }
    root.style.top = baseTop + "px";
    update();
  }

  function setUp(up) {
    if (train) train.classList.toggle("is-up", up);
  }

  function update() {
    const scrollTop = window.scrollY || doc.scrollTop || 0;
    const max = doc.scrollHeight - window.innerHeight;
    if (max <= 4) {
      root.classList.remove("is-ready");
      return;
    }

    // fundo dinâmico: encolhe acima do footer (sem o sobrepor)
    let bottomY = window.innerHeight - CFG.gapBottom;
    const footer = document.querySelector(CFG.footerSel);
    if (footer) {
      const fr = footer.getBoundingClientRect();
      if (fr.top < bottomY)
        bottomY = Math.max(baseTop + 60, fr.top - CFG.footerPad);
    }
    const trackH = Math.max(0, bottomY - baseTop);
    root.style.height = trackH + "px";

    const progress = Math.min(1, Math.max(0, scrollTop / max));
    const yPos = progress * Math.max(0, trackH - curTrainSize);
    train.style.transform = `translate(-50%, ${yPos}px)`;

    // seta: baixo por defeito; cima ao subir ou no fundo
    const atBottom = progress >= 0.992;
    const goingUp = scrollTop < lastScroll - 1;
    const goingDown = scrollTop > lastScroll + 1;
    if (atBottom || goingUp) setUp(true);
    else if (goingDown) setUp(false);
    clearTimeout(idleT);
    if (!atBottom) idleT = setTimeout(() => setUp(false), 700);

    lastScroll = scrollTop;
    if (!root.classList.contains("is-ready")) root.classList.add("is-ready");
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      update();
      ticking = false;
    });
  }

  function start() {
    if (started) return;
    started = true;
    injectCSS();

    root = document.createElement("div");
    root.id = "ltts-root";
    document.body.appendChild(root);

    layout();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", layout, { passive: true });
    window.addEventListener(
      "orientationchange",
      () => setTimeout(layout, 120),
      { passive: true },
    );
    window.addEventListener("load", () => setTimeout(layout, 60), {
      once: true,
    });
  }

  /* -------- esperar que o menu.js injete o #menu-trigger ------------------ */
  function waitForMenu() {
    if (document.querySelector(CFG.triggerSel)) return start();
    let tries = 0;
    const iv = setInterval(() => {
      if (document.querySelector(CFG.triggerSel)) {
        clearInterval(iv);
        start();
      } else if (++tries > 60) clearInterval(iv);
    }, 60);
    const nav = document.getElementById("global-nav");
    if (nav && "MutationObserver" in window) {
      const mo = new MutationObserver(() => {
        if (document.querySelector(CFG.triggerSel)) {
          mo.disconnect();
          clearInterval(iv);
          start();
        }
      });
      mo.observe(nav, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitForMenu);
  } else {
    waitForMenu();
  }
})();

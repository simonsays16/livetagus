/**
 * mapa-search.js · LiveTagus (mapa)
 * ─────────────────────────────────────────────────────────────────────────────
 * Só o BOTÃO da pesquisa. O motor (mapa-search-motor.js, ~36 kB) só é
 * descarregado quando é preciso:
 *   • ao tocar no botão (ou antes, ao passar o rato / pôr o dedo nele, para
 *     a espera não se notar);
 *   • quando o "perto de mim" precisa do índice (window.LTPesquisa.carregar).
 * Quase ninguém pesquisa em cada visita, e os 36 kB estavam no arranque.
 *
 * O botão é igual ao do motor (mesmo id, classe, ícone e CSS). Quando o motor
 * carrega, fica com este botão em vez de criar outro.
 *
 * Inclusão:  <script src="./mapa-search.js" defer></script>  (depois do mapa-cm.js)
 */

(function () {
  "use strict";
  if (window.LTPesquisa) return;

  const MOTOR_SRC = "./mapa-search-motor.js";
  const SVG_SEARCH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;

  // ═══ CARREGAR O MOTOR ═══════════════════════════════════════════════════
  let promessa = null;
  function carregar() {
    if (window.MapaSearch) return Promise.resolve(window.MapaSearch);
    if (!promessa) {
      promessa = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = MOTOR_SRC;
        s.async = true;
        s.onload = () =>
          window.MapaSearch
            ? resolve(window.MapaSearch)
            : reject(new Error("motor carregado sem window.MapaSearch"));
        s.onerror = () => {
          promessa = null; // um toque seguinte tenta outra vez
          s.remove();
          reject(new Error("falhou " + MOTOR_SRC));
        };
        document.head.appendChild(s);
      });
    }
    return promessa;
  }

  // ═══ BOTÃO ═══════════════════════════════════════════════════════════════
  // As mesmas regras do botão no motor (injectStyles), para não mudar nada
  // quando ele carrega e acrescenta as suas.
  function injectStyles() {
    if (document.getElementById("lt-search-btn-styles")) return;
    const st = document.createElement("style");
    st.id = "lt-search-btn-styles";
    st.textContent = `
    .lt-search-btn {
      position: fixed; right: .75rem;
      top: calc(env(safe-area-inset-top, 0px) + 4.75rem);
      z-index: 15; width: 42px; height: 42px;
      display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid rgba(228,228,231,.5);
      background: rgba(255,255,255,.8);
      -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
      border-radius: 9999px; box-shadow: 0 1px 2px rgba(0,0,0,.06);
      color: #18181b; cursor: pointer;
      transition: box-shadow .2s ease, transform .15s ease, background .2s ease;
    }
    html.dark .lt-search-btn {
      border-color: rgba(255,255,255,.06);
      background: rgba(9,9,11,.8); color: #fff;
    }
    .lt-search-btn:hover { box-shadow: 0 4px 16px rgba(0,0,0,.12); }
    html.dark .lt-search-btn:hover { box-shadow: 0 4px 16px rgba(0,0,0,.5); }
    .lt-search-btn:active { transform: scale(.94); }
    .lt-search-btn svg { width: 1.15rem; height: 1.15rem; }
    .lt-search-btn[aria-busy="true"] { cursor: progress; }
    `;
    document.head.appendChild(st);
  }

  let btnEl = null;

  function positionButton() {
    if (!btnEl) return;
    // A pilha de botões é posicionada pelo mapa-perto.js.
    if (window.MapaPerto && window.MapaPerto.layout) {
      window.MapaPerto.layout();
      return;
    }
    const header = document.querySelector("#global-nav header");
    if (!header) return;
    const r = header.getBoundingClientRect();
    if (!r || r.bottom <= 0) return;
    btnEl.style.top = Math.round(r.bottom + 12) + "px";
  }

  function abrir() {
    btnEl.setAttribute("aria-busy", "true");
    carregar()
      .then((S) => {
        btnEl.removeAttribute("aria-busy");
        S.open();
      })
      .catch((e) => {
        btnEl.removeAttribute("aria-busy");
        console.warn("[MapaSearch] pesquisa indisponível:", e && e.message);
      });
  }

  function injectButton() {
    const host =
      document.querySelector(".mapa-container") ||
      (document.getElementById("map") &&
        document.getElementById("map").parentElement) ||
      document.body;
    if (!host || document.getElementById("lt-search-btn")) return;

    btnEl = document.createElement("button");
    btnEl.id = "lt-search-btn";
    btnEl.className = "lt-search-btn";
    btnEl.type = "button";
    btnEl.setAttribute("aria-label", "Pesquisar estações e paragens");
    btnEl.setAttribute("aria-haspopup", "dialog");
    btnEl.setAttribute("aria-expanded", "false");
    btnEl.innerHTML = SVG_SEARCH;
    btnEl.addEventListener("click", (e) => {
      e.stopPropagation();
      abrir();
    });
    // Começa a descarregar assim que se vê intenção de tocar.
    const antecipar = () => {
      carregar().catch(() => {});
    };
    btnEl.addEventListener("pointerenter", antecipar, { once: true });
    btnEl.addEventListener("touchstart", antecipar, {
      once: true,
      passive: true,
    });
    btnEl.addEventListener("focus", antecipar, { once: true });
    host.appendChild(btnEl);

    // O header é injetado de forma assíncrona → reposiciona quando aparecer.
    positionButton();
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      positionButton();
      if (document.querySelector("#global-nav header") || tries > 40) {
        clearInterval(iv);
        positionButton();
      }
    }, 120);
    window.addEventListener("resize", positionButton);
    window.addEventListener("orientationchange", () =>
      setTimeout(positionButton, 250),
    );
  }

  function boot() {
    injectStyles();
    injectButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  window.LTPesquisa = { carregar, abrir: () => btnEl && abrir() };
})();

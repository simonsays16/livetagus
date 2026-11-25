/* Filename: js/menu.js 
   Funções: Menu Global, Footer Global, Definições de Tema, API Status, CSP Compliant snd analitycs
   + Partilha no header (antes no nav-tools.js, que foi apagado)
   + Lista das estações (window.LTEstacoes), usada pelo "Estações ›" do menu e por /estacao/
*/

window.sa_event =
  window.sa_event ||
  function () {
    var a = [].slice.call(arguments);
    window.sa_event.q ? window.sa_event.q.push(a) : (window.sa_event.q = [a]);
  };

document.addEventListener("DOMContentLoaded", () => {
  injectNavigation(); // injetar header
  injectFooter(); // injetar footer
  initTheme(); // verificar tema escuro/claro/auto
  initMenuInteractions(); // interações menu (+ segundo nível "Estações")
  if (window.LTInstall) window.LTInstall.refresh(); // botão "Instalar app" do menu
  initShareButton(); // partilha nativa no footer
  initHeaderShare(); // partilha da página atual no header
  checkApiStatus(); // verificar estado
  updateAppVersion(); // versao sw.js
  //initComingSoonPill();  botão brevemnte
});

// --- BARRA DE NAVEGAÇÃO E MENU LATERAL ---
function injectNavigation() {
  const navContainer = document.getElementById("global-nav");
  if (!navContainer) return;

  const logoSrc = "/imagens/logotransparente.svg";

  /* ===== MUNDIAL 2026 — DECORAÇÃO TEMPORÁRIA (apagar este bloco + style + .mundial-confetti depois do evento) =====
  const mundialCores = ["#046A38", "#DA291C", "#FFE900"];
  let mundialConfetti = "";
  for (let i = 0; i < 16; i++) {
    const cor = mundialCores[i % 3];
    const left = (i * 6.3 + (i % 4) * 4) % 100;
    const dur = (4.5 + (i % 5) * 0.7).toFixed(1);
    const delay = ((i % 8) * 0.5).toFixed(1);
    const size = 6 + (i % 3) * 3;
    const op = (0.4 + (i % 3) * 0.12).toFixed(2);
    if (i % 5 === 0) {
      mundialConfetti += `<span class="mundial-piece mundial-bola" style="left:${left}%;font-size:${size + 8}px;animation-duration:${(+dur + 1.5).toFixed(1)}s;animation-delay:${delay}s;--mundial-op:${op};">⚽</span>`;
    } else {
      const r = i % 2 === 0 ? "2px" : "50%";
      mundialConfetti += `<span class="mundial-piece" style="left:${left}%;width:${size}px;height:${size}px;background:${cor};border-radius:${r};animation-duration:${dur}s;animation-delay:${delay}s;--mundial-op:${op};"></span>`;
    }
  }*/

  // Página atual: "/" → home · "/mapa" → mapa · "/estacao/coina" → estacao
  const key = paginaAtual();
  // No mapa o header é transparente e cada controlo é uma pill de vidro,
  // para se ver o mapa por trás (era o estilo "glass" do nav-tools.js).
  const glass = key === "mapa";

  const BTN_FLAT =
    "p-2 rounded-full transition-colors text-zinc-900 dark:text-white hover:opacity-70";
  const BTN_GLASS =
    "p-2 rounded-full bg-white/80 dark:bg-[#09090b]/80 backdrop-blur-md border border-zinc-200/50 dark:border-white/5 shadow-sm transition-colors text-zinc-900 dark:text-white";
  const HEADER_BAR = glass
    ? "px-3"
    : "px-6 bg-white/80 dark:bg-[#09090b]/80 backdrop-blur-md border-b border-zinc-200/50 dark:border-white/5 supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-[#09090b]/60";
  const TRIGGER_GLASS = glass
    ? " bg-white/80 dark:bg-[#09090b]/80 backdrop-blur-md border border-zinc-200/50 dark:border-white/5 shadow-sm rounded-full py-3.5"
    : "";

  const logoHtml = `
            <a href="/" class="flex items-center gap-3 group" aria-label="Ir para a página inicial">
                <img id="nav-logo" src="${logoSrc}" class="w-8 h-8 opacity-100 transition-opacity object-contain" alt="LiveTagus Logo" width="32" height="32">
                <span class="font-sans font-bold tracking-tighter text-lg text-zinc-900 dark:text-white">LIVETAGUS</span><span id="nav-beta" class="text-xs"> (beta)</span>
            </a>`;

  const SVG_SHARE = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/></svg>`;
  const SVG_CHEV = `<svg class="ltm-chev" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`;
  const SVG_BACK = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>`;

  injectMenuStyles();

  navContainer.innerHTML = `
        <header class="fixed top-0 left-0 w-full z-50 flex justify-between items-center py-4 transition-all duration-500 pt-safe-ios ${HEADER_BAR}">
            ${
              glass
                ? `<div id="nav-logo-pill" class="flex items-center px-3 py-2 rounded-xl bg-white/80 dark:bg-[#09090b]/80 backdrop-blur-md border border-zinc-200/50 dark:border-white/5 shadow-sm">${logoHtml}</div>`
                : logoHtml
            }
            <div id="nav-actions" class="flex items-center gap-2">
                <button id="nav-share-trigger" type="button" class="${glass ? BTN_GLASS : BTN_FLAT}" aria-label="Partilhar esta página">${SVG_SHARE}</button>
                <button id="menu-trigger" type="button" class="flex flex-col items-end gap-1.5 group cursor-pointer p-2 text-zinc-900 dark:text-white${TRIGGER_GLASS}" aria-label="Abrir menu" aria-expanded="false" aria-controls="menu-overlay">
                    <span class="w-8 h-[1.5px] bg-current transition-all duration-300 group-hover:w-10 pointer-events-none"></span>
                    <span class="w-6 h-[1.5px] bg-current transition-all duration-300 group-hover:w-10 pointer-events-none"></span>
                </button>
            </div>
            ${glass ? "" : '<div id="lt-flow" class="lt-flow" aria-hidden="true"><i></i><i></i></div>'}
        </header>

        <div id="menu-overlay" class="fixed inset-0 bg-white dark:bg-[#09090b] z-40 transform translate-y-full transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden" aria-hidden="true" inert>

            <div class="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/5 dark:bg-blue-900/10 rounded-full blur-[120px] pointer-events-none"></div>

            <div class="ltm-track" id="ltm-track">

                <!-- ═══ NÍVEL 1 ═══ -->
                <div class="ltm-panel" id="ltm-main">
                    <nav class="ltm-nav" aria-label="Menu principal">
                        <a href="/" class="menu-link ltm-big" data-page="home">Início</a>
                        <a href="/mapa" class="menu-link ltm-big" data-page="mapa">Mapa</a>
                        <a href="/app" class="menu-link ltm-big" data-page="app">Trajetos</a>
                        <a href="/horarios" class="menu-link ltm-big" data-page="horarios">Horários</a>
                        <button type="button" id="ltm-open-estacoes" class="menu-link ltm-big ltm-more" data-page="estacao" aria-expanded="false" aria-controls="ltm-estacoes">
                            <span>Estações</span>${SVG_CHEV}
                        </button>
                    </nav>

                    <div class="ltm-foot">
                        <div class="ltm-links">
                            <!-- Definições: módulo futuro, ainda sem destino -->
                            <button type="button" id="menu-settings-btn" class="ltm-small" data-action="open-settings">Definições</button>
                            <span class="ltm-sep" aria-hidden="true">·</span>
                            <a href="/sobre" class="menu-link ltm-small" data-page="sobre">Sobre</a>
                            <span class="ltm-sep" aria-hidden="true">·</span>
                            <a href="/sudoku" class="menu-link ltm-small" data-page="sudoku">Sudoku</a>
                            <span class="ltm-sep" aria-hidden="true">·</span>
                            <a href="/paragens" class="menu-link ltm-small" data-page="paragens">Paragens</a>
                            <span class="ltm-sep" aria-hidden="true" data-lt-install-sep hidden>·</span>
                            <!-- Instalar: só aparece quando dá para instalar (window.LTInstall) -->
                            <button type="button" class="ltm-small" data-lt-install hidden>Instalar app</button>
                        </div>
                        <div class="ltm-theme" role="group" aria-label="Aparência">
                            <button type="button" class="theme-btn ltm-theme-btn" data-mode="light">Light</button>
                            <button type="button" class="theme-btn ltm-theme-btn" data-mode="dark">Dark</button>
                            <button type="button" class="theme-btn ltm-theme-btn" data-mode="system">Auto</button>
                        </div>
                        <div class="ltm-status">
                            <span id="api-status-display" class="ltm-status-api">
                                <span id="status-dot" class="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-700"></span>
                                <span id="status-text" class="text-[10px] font-mono text-zinc-500 uppercase tracking-wide">A verificar...</span>
                            </span>
                            <span id="menu-version-display" class="ltm-version">LiveTagus • a verificar versão...</span>
                        </div>
                    </div>
                </div>

                <!-- ═══ NÍVEL 2: ESTAÇÕES ═══ -->
                <div class="ltm-panel" id="ltm-estacoes" aria-label="Estações">
                    <button type="button" id="ltm-back" class="ltm-back">${SVG_BACK}<span>Menu</span></button>
                    <p class="ltm-label ltm-label-top">Rede Fertagus</p>
                    <p class="ltm-title">Estações</p>
                    <div id="ltm-stn-list" class="ltm-stn-list"></div>
                </div>

            </div>
        </div>
    `;

  // --- Marca a página atual (itálico + cor forte, como sempre foi) ---
  const atual = document.querySelector(`#menu-overlay [data-page="${key}"]`);
  if (atual) atual.setAttribute("aria-current", "page");
}

// Página atual a partir do pathname.
function paginaAtual() {
  const p = (window.location.pathname || "/")
    .toLowerCase()
    .replace(/\.html$/, "")
    .replace(/\/+$/, "");
  if (p === "" || p === "/" || p === "/index") return "home";
  const seg = p.split("/").filter(Boolean)[0] || "home";
  if (seg === "estacoes" || seg === "estacao") return "estacao";
  return seg;
}

// ─── ESTILOS DO MENU ───────────────────────────────────────────────────
// Próprios (.ltm-*), para não dependerem do build do Tailwind. Mesmas
// medidas que o menu tinha (text-4xl/6xl, font-light, tracking-tighter).
function injectMenuStyles() {
  if (document.getElementById("ltm-styles")) return;
  const css = `
#menu-overlay{--ltm-ink:#09090b;--ltm-mute:#71717a;--ltm-soft:#52525b;--ltm-line:#e4e4e7}
html.dark #menu-overlay{--ltm-ink:#fafafa;--ltm-mute:#a1a1aa;--ltm-soft:#d4d4d8;--ltm-line:rgba(255,255,255,.1)}
.ltm-track{position:relative;z-index:1;display:flex;width:200%;height:100%;transition:transform .5s cubic-bezier(.16,1,.3,1)}
.ltm-track.is-sub{transform:translateX(-50%)}
.ltm-panel{width:50%;height:100%;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;
  padding:calc(6rem + env(safe-area-inset-top,0px)) max(1.5rem,env(safe-area-inset-right,0px)) calc(2.5rem + env(safe-area-inset-bottom,0px)) max(1.5rem,env(safe-area-inset-left,0px))}
#ltm-main{justify-content:space-between}
.ltm-nav{display:flex;flex-direction:column;align-items:flex-start;gap:.5rem}
.ltm-big,.ltm-med{font-weight:300;text-transform:uppercase;letter-spacing:-.05em;color:var(--ltm-mute);transition:color .2s ease;background:none;border:0;padding:0;text-align:left;cursor:pointer;font-family:inherit}
.ltm-big{font-size:2.25rem;line-height:2.5rem}
.ltm-med{font-size:1.5rem;line-height:2rem}
.ltm-big:hover,.ltm-med:hover,.ltm-big:focus-visible,.ltm-med:focus-visible{color:var(--ltm-ink)}
.menu-link[aria-current="page"]{color:var(--ltm-ink);font-style:italic}
.ltm-more{display:inline-flex;align-items:center;gap:.35rem}
.ltm-chev{width:1.6rem;height:1.6rem;transition:transform .2s ease}
.ltm-more:hover .ltm-chev{transform:translateX(3px)}
.ltm-group{display:flex;flex-direction:column;gap:.25rem;margin:.5rem 0 .25rem}
.ltm-label{font-size:10px;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:var(--ltm-mute)}
.ltm-sub{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:.6rem;row-gap:.15rem}
.ltm-sub .ltm-sep{font-size:1.5rem;line-height:2rem;color:var(--ltm-line)}
.ltm-foot{margin-top:2rem;padding-top:1.75rem;border-top:1px solid var(--ltm-line);display:flex;flex-direction:column;gap:1rem}
.ltm-links,.ltm-theme,.ltm-status{display:flex;flex-wrap:wrap;align-items:center;column-gap:.6rem;row-gap:.4rem}
.ltm-status{flex-direction:column;align-items:flex-start;row-gap:.5rem}
.ltm-small{font-size:.75rem;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:var(--ltm-soft);background:none;border:0;padding:.25rem 0;cursor:pointer;font-family:inherit;transition:color .2s ease}
.ltm-small:hover,.ltm-small:focus-visible{color:var(--ltm-ink)}
.ltm-sep{color:var(--ltm-mute)}
.ltm-theme{column-gap:1rem}
.ltm-theme-btn{font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ltm-mute);background:none;border:0;padding:.25rem 0;cursor:pointer;font-family:inherit;transition:color .2s ease}
.ltm-theme-btn:hover{color:var(--ltm-ink)}
.ltm-theme-btn.font-bold{color:var(--ltm-ink)}
.ltm-status-api{display:inline-flex;align-items:center;gap:.5rem}
.ltm-version{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--ltm-mute)}
.ltm-back{display:inline-flex;align-items:center;gap:.35rem;align-self:flex-start;margin:0 0 1.5rem -.25rem;padding:.35rem .25rem;font-size:.7rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--ltm-soft);background:none;border:0;cursor:pointer;font-family:inherit}
.ltm-back:hover{color:var(--ltm-ink)}
.ltm-label-top{margin-bottom:.4rem}
#ltm-estacoes>*{width:100%;max-width:48rem}
#ltm-estacoes>.ltm-back{width:auto}
.ltm-title{font-size:2.25rem;line-height:2.5rem;font-weight:700;letter-spacing:-.05em;text-transform:uppercase;color:var(--ltm-ink);margin-bottom:1.75rem}
.ltm-zone{display:flex;align-items:center;gap:1rem;margin:1.5rem 0 .25rem}
.ltm-zone:first-child{margin-top:0}
.ltm-zone-line{height:1px;flex:1;background:var(--ltm-line)}
.ltm-zone-n{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;letter-spacing:.05em;color:var(--ltm-mute)}
.ltm-stn{display:flex;align-items:center;gap:.75rem;padding:.8rem 0;border-bottom:1px solid var(--ltm-line);text-decoration:none;transition:padding .3s cubic-bezier(.22,.61,.36,1)}
.ltm-stn-name{flex:1;min-width:0;font-size:1.25rem;line-height:1.2;font-weight:300;letter-spacing:-.025em;color:var(--ltm-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ltm-stn[aria-current="page"] .ltm-stn-name{font-style:italic;font-weight:500}
.ltm-stn-ops{display:flex;align-items:center;gap:.5rem;flex-shrink:0}
.ltm-stn-ops img{width:1rem;height:1rem;object-fit:contain}
html.dark .ltm-stn-ops{opacity:.85}
html.dark .ltm-cm-light,html:not(.dark) .ltm-cm-dark{display:none}
.ltm-stn-arrow{width:1rem;height:1rem;flex-shrink:0;color:var(--ltm-mute);transition:transform .3s ease,color .3s ease}
.ltm-stn:hover{padding-left:.5rem}
.ltm-stn:hover .ltm-stn-arrow{color:var(--ltm-ink);transform:translateX(2px)}
@media (min-width:768px){
  .ltm-panel{padding-left:max(2.5rem,env(safe-area-inset-left,0px));padding-right:max(2.5rem,env(safe-area-inset-right,0px))}
  .ltm-big{font-size:3.75rem;line-height:1}
  .ltm-med,.ltm-sub .ltm-sep{font-size:2.25rem;line-height:2.5rem}
  .ltm-chev{width:2.5rem;height:2.5rem}
  .ltm-title{font-size:3.75rem;line-height:1}
  .ltm-stn-name{font-size:1.75rem}
  .ltm-stn-ops img{width:1.15rem;height:1.15rem}
  .ltm-foot{flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:space-between}
  .ltm-status{flex-basis:100%;flex-direction:row;align-items:center;column-gap:1.25rem}
}
/* Telemóveis pequenos (≤ 359px): o "(beta)" sai para os botões respirarem. */
@media (max-width:359px){#nav-beta{display:none}}
@media (max-height:600px){.ltm-panel{padding-top:calc(5rem + env(safe-area-inset-top,0px))}.ltm-nav{gap:.25rem}.ltm-foot{margin-top:1.25rem;padding-top:1.25rem}}
@media (prefers-reduced-motion:reduce){.ltm-track,.ltm-stn,.ltm-chev{transition:none}}
/* ── Traço de atualização (window.LTFlow) ──────────────────────────────
   Vive sobre a linha que separa o menu da página. Duas metades que crescem
   do centro para as pontas (só transform + opacity): a ponta é a "luz", o
   gradiente atrás dela é o rasto. .lt-flow-erro = laranja fixo. */
.lt-flow{position:absolute;left:0;right:0;bottom:-1px;height:2px;pointer-events:none}
.lt-flow i{position:absolute;top:0;bottom:0;width:50%;opacity:0;transform:scaleX(0);will-change:transform,opacity}
.lt-flow i:first-child{left:0;transform-origin:100% 50%;background:linear-gradient(270deg,rgba(16,185,129,.12) 0%,rgba(16,185,129,.7) 72%,#6ee7b7 100%);box-shadow:0 0 8px rgba(16,185,129,.55)}
.lt-flow i:last-child{right:0;transform-origin:0 50%;background:linear-gradient(90deg,rgba(16,185,129,.12) 0%,rgba(16,185,129,.7) 72%,#6ee7b7 100%);box-shadow:0 0 8px rgba(16,185,129,.55)}
.lt-flow-go i{animation:lt-flow-go 1.5s cubic-bezier(.22,.61,.36,1) both}
@keyframes lt-flow-go{0%{transform:scaleX(0);opacity:1}62%{transform:scaleX(1);opacity:1}100%{transform:scaleX(1);opacity:0}}
.lt-flow.lt-flow-erro i{animation:none;transform:none;opacity:1;background:#f59e0b;box-shadow:0 0 8px rgba(245,158,11,.5);transition:opacity .4s ease}
@media (prefers-reduced-motion:reduce){.lt-flow-go i{animation-name:lt-flow-fade}@keyframes lt-flow-fade{0%{transform:none;opacity:0}30%{transform:none;opacity:1}100%{transform:none;opacity:0}}}
`;
  const tag = document.createElement("style");
  tag.id = "ltm-styles";
  tag.textContent = css;
  document.head.appendChild(tag);
}

// ─── TRAÇO DE ATUALIZAÇÃO (partilhado) ─────────────────────────────────
// Forma única de uma página mostrar que atualizou: o traço que separa o
// menu da página.
//   LTFlow.pulso()        → luz verde do centro para as pontas (atualizou)
//   LTFlow.problema(true) → laranja fixo até problema(false) ou pulso()
// Sem o elemento (cabeçalho do mapa, menu por construir) não faz nada.
window.LTFlow = (function () {
  function el() {
    return document.getElementById("lt-flow");
  }
  function problema(on) {
    const f = el();
    if (!f) return;
    if (on) f.classList.remove("lt-flow-go");
    f.classList.toggle("lt-flow-erro", !!on);
  }
  function pulso() {
    const f = el();
    if (!f) return;
    f.classList.remove("lt-flow-erro", "lt-flow-go");
    void f.offsetWidth; // reinicia a animação
    f.classList.add("lt-flow-go");
  }
  return { pulso: pulso, problema: problema };
})();

// ─── ESTAÇÕES FERTAGUS (lista partilhada) ──────────────────────────────
// Fonte única da lista: o "Estações ›" do menu e a página /estacao/
// (estacao/index.js) desenham a partir daqui. Ordem da linha, de Lisboa a
// Setúbal. apiId cruza com as ligações do ligacoes_atualizado.json.
window.LTEstacoes = (function () {
  const LISTA = [
    {
      key: "roma_areeiro",
      name: "Roma-Areeiro",
      zone: "lisboa",
      apiId: "9466035",
    },
    {
      key: "entrecampos",
      name: "Entrecampos",
      zone: "lisboa",
      apiId: "9466050",
    },
    { key: "sete_rios", name: "Sete Rios", zone: "lisboa", apiId: "9466076" },
    { key: "campolide", name: "Campolide", zone: "lisboa", apiId: "9467033" },
    { key: "pragal", name: "Pragal", zone: "margem", apiId: "9417087" },
    { key: "corroios", name: "Corroios", zone: "margem", apiId: "9417137" },
    {
      key: "foros_de_amora",
      name: "Foros de Amora",
      zone: "margem",
      apiId: "9417152",
    },
    { key: "fogueteiro", name: "Fogueteiro", zone: "margem", apiId: "9417186" },
    { key: "coina", name: "Coina", zone: "margem", apiId: "9417236" },
    { key: "penalva", name: "Penalva", zone: "margem", apiId: "9417095" },
    {
      key: "pinhal_novo",
      name: "Pinhal Novo",
      zone: "margem",
      apiId: "9468007",
    },
    {
      key: "venda_do_alcaide",
      name: "Venda do Alcaide",
      zone: "margem",
      apiId: "9468049",
    },
    { key: "palmela", name: "Palmela", zone: "margem", apiId: "9468098" },
    { key: "setubal", name: "Setúbal", zone: "margem", apiId: "9468122" },
  ];
  const ZONAS = {
    lisboa: { label: "Lisboa", index: 1 },
    margem: { label: "Margem Sul", index: 2 },
  };
  // Ordem dos operadores com ligação, como na página das estações.
  const OPS = ["cp", "metro", "carris", "cm", "mts", "tcb", "re"];

  function normalizar(str) {
    return String(str || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
  }
  function slug(name) {
    return normalizar(name)
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }

  // As ligações só são pedidas quando alguém precisa delas (uma vez).
  let ligacoes = null;
  function carregarLigacoes() {
    if (!ligacoes) {
      // No mapa, o pedido é partilhado com os outros módulos (mapa-config.js).
      ligacoes = (
        window.LTLigacoes
          ? window.LTLigacoes()
          : fetch("/data/json/ligacoes_atualizado.json").then((r) =>
              r.ok ? r.json() : {},
            )
      ).catch(() => {
        ligacoes = null;
        return {};
      });
    }
    return ligacoes;
  }

  // Operadores com ligação numa estação (pela ordem de OPS).
  function operadores(dados, apiId) {
    const lig = (dados && dados[apiId] && dados[apiId].ligacoes) || {};
    return OPS.filter((op) => Array.isArray(lig[op]) && lig[op].length > 0);
  }

  // Logos dos operadores. classes = { img, cmLight, cmDark } para cada página
  // usar o seu próprio CSS.
  function logosHtml(ops, classes) {
    const c = classes || {};
    return ops
      .map((op) =>
        op === "cm"
          ? `<img src="/assets/img/logos/cm-light.svg" alt="Carris Metropolitana" class="${c.img || ""} ${c.cmLight || ""}" /><img src="/assets/img/logos/cm-dark.svg" alt="" aria-hidden="true" class="${c.img || ""} ${c.cmDark || ""}" />`
          : `<img src="/assets/img/logos/${esc(op)}.png" alt="${esc(op)}" class="${c.img || ""}" />`,
      )
      .join("");
  }

  return {
    LISTA,
    ZONAS,
    OPS,
    normalizar,
    slug,
    esc,
    carregarLigacoes,
    operadores,
    logosHtml,
  };
})();

// --- FOOTER GLOBAL ---
function injectFooter() {
  const footerContainer = document.getElementById("global-footer");
  if (!footerContainer) return;

  const logoSrc = "/imagens/logotransparente.svg";
  const githubIcon = `<svg viewBox="0 0 24 24" class="w-9 h-9 fill-current"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>`;

  footerContainer.innerHTML = `
        <footer class="relative z-10 px-6 py-12 bg-zinc-50/50 dark:bg-zinc-900/20 backdrop-blur-sm border-t border-zinc-200 dark:border-white/5 mt-auto">
          <div class="max-w-4xl mx-auto flex flex-col md:flex-row justify-between gap-10">
                
                <div class="space-y-4 md:w-1/2">
                    <div class="flex items-center gap-4">
                        <a href="/" class="inline-block hover:opacity-70 transition-opacity" aria-label="Voltar ao início">
                            <img id="footer-logo" src="${logoSrc}" class="w-10 h-10 opacity-100" alt="LiveTagus" width="40" height="40">
                        </a>
                        
                        <div class="w-px h-8 bg-zinc-300 dark:bg-zinc-700"></div> <div class="flex items-center gap-3 text-black dark:text-white">
                            <a href="https://instagram.com/livetagus" target="_blank" rel="noopener noreferrer" class="hover:opacity-70 transition-opacity" aria-label="Instagram">
                                <svg fill="currentColor" width="20" height="20" viewBox="0 0 24 24"><path d="M12 2C9.2912 2 8.94131 2 7.86907 2.05643C7.03985 2.07241 6.21934 2.22888 5.44244 2.51919C4.78781 2.77878 4.23476 3.11738 3.67043 3.68172C3.11738 4.23476 2.76749 4.78781 2.51919 5.45372C2.27088 6.08578 2.10158 6.80813 2.05643 7.88036C2.01129 8.94131 2 9.27991 2 12C2 14.7088 2 15.0474 2.05643 16.1196C2.10158 17.1919 2.28217 17.9255 2.51919 18.5576C2.77878 19.2122 3.11738 19.7652 3.67043 20.3296C4.23476 20.8826 4.78781 21.2325 5.44244 21.4808C6.08578 21.7291 6.80813 21.8984 7.86907 21.9436C8.94131 21.9887 9.27991 22 12 22C14.7088 22 15.0474 22 16.1196 21.9436C17.1806 21.8984 17.9142 21.7178 18.5463 21.4808C19.2137 21.2306 19.8184 20.8377 20.3183 20.3296C20.8826 19.7652 21.2212 19.2009 21.4695 18.5576C21.7178 17.9142 21.8871 17.1919 21.9436 16.1196C21.9887 15.0587 22 14.7201 22 12C22 9.2912 21.9887 8.9526 21.9436 7.88036C21.9225 7.05065 21.7622 6.23037 21.4695 5.45372C21.2189 4.78649 20.8261 4.18182 20.3183 3.68172C19.754 3.11738 19.2122 2.77878 18.5463 2.51919C17.7686 2.23315 16.9482 2.08051 16.1196 2.06772C15.0474 2.01129 14.7088 2 12 2ZM11.0971 3.80587H12C14.6637 3.80587 14.9797 3.80587 16.0406 3.8623C16.6724 3.8686 17.2985 3.98313 17.8916 4.2009C18.3657 4.38149 18.693 4.59594 19.0429 4.94582C19.3928 5.29571 19.6072 5.63431 19.7991 6.09706C19.9345 6.45824 20.0925 6.97743 20.1377 7.95937C20.1828 9.00903 20.1941 9.32506 20.1941 12C20.1941 14.6637 20.1941 14.9797 20.1377 16.0406C20.1314 16.6724 20.0169 17.2985 19.7991 17.8916C19.6185 18.3657 19.3928 18.693 19.0429 19.0429C18.7043 19.3928 18.3657 19.6072 17.8916 19.7878C17.2992 20.0094 16.6731 20.1278 16.0406 20.1377C14.9797 20.1828 14.6637 20.1941 12 20.1941C9.32506 20.1941 9.00903 20.1941 7.95937 20.1377C7.3238 20.1322 6.69388 20.0177 6.09706 19.7991C5.63431 19.6072 5.307 19.3928 4.94582 19.0429C4.60722 18.7043 4.38149 18.3657 4.2009 17.8916C3.98313 17.2985 3.8686 16.6724 3.8623 16.0406C3.80587 14.9797 3.79458 14.6637 3.79458 12C3.79458 9.32506 3.80587 9.00903 3.85102 7.95937C3.85602 7.32375 3.97057 6.69376 4.18962 6.09706C4.38149 5.63431 4.59594 5.307 4.94582 4.94582C5.29571 4.60722 5.62302 4.38149 6.09706 4.2009C6.69376 3.98185 7.32375 3.86731 7.95937 3.8623C8.87359 3.81716 9.23476 3.80587 11.0971 3.79458V3.80587ZM17.3386 5.46501C17.1815 5.46501 17.0259 5.49596 16.8808 5.55608C16.7356 5.6162 16.6037 5.70433 16.4926 5.81542C16.3815 5.92652 16.2934 6.05841 16.2333 6.20356C16.1732 6.34871 16.1422 6.50429 16.1422 6.6614C16.1422 6.81851 16.1732 6.97408 16.2333 7.11924C16.2934 7.26439 16.3815 7.39628 16.4926 7.50737C16.6037 7.61847 16.7356 7.70659 16.8808 7.76672C17.0259 7.82684 17.1815 7.85779 17.3386 7.85779C17.6559 7.85779 17.9602 7.73174 18.1846 7.50737C18.4089 7.28301 18.535 6.9787 18.535 6.6614C18.535 6.3441 18.4089 6.03979 18.1846 5.81542C17.9602 5.59106 17.6559 5.46501 17.3386 5.46501ZM12 6.86456C11.3256 6.86456 10.6578 6.99739 10.0348 7.25547C9.41169 7.51355 8.84556 7.89182 8.36869 8.36869C7.89182 8.84556 7.51355 9.41169 7.25547 10.0348C6.99739 10.6578 6.86456 11.3256 6.86456 12C6.86456 12.6744 6.99739 13.3422 7.25547 13.9652C7.51355 14.5883 7.89182 15.1544 8.36869 15.6313C8.84556 16.1082 9.41169 16.4864 10.0348 16.7445C10.6578 17.0026 11.3256 17.1354 12 17.1354C13.362 17.1354 14.6682 16.5944 15.6313 15.6313C16.5944 14.6682 17.1354 13.362 17.1354 12C17.1354 10.638 16.5944 9.33178 15.6313 8.36869C14.6682 7.40561 13.362 6.86456 12 6.86456ZM12 8.67043C12.4372 8.67043 12.8702 8.75655 13.2742 8.92388C13.6781 9.0912 14.0452 9.33646 14.3544 9.64564C14.6635 9.95482 14.9088 10.3219 15.0761 10.7258C15.2434 11.1298 15.3296 11.5628 15.3296 12C15.3296 12.4372 15.2434 12.8702 15.0761 13.2742C14.9088 13.6781 14.6635 14.0452 14.3544 14.3544C14.0452 14.6635 13.6781 14.9088 13.2742 15.0761C12.8702 15.2434 12.4372 15.3296 12 15.3296C11.1169 15.3296 10.2701 14.9788 9.64564 14.3544C9.02122 13.7299 8.67043 12.8831 8.67043 12C8.67043 11.1169 9.02122 10.2701 9.64564 9.64564C10.2701 9.02122 11.1169 8.67043 12 8.67043Z"></path></svg>
                            </a>
                            <a href="https://www.facebook.com/people/LiveTagus/61583577115985/" target="_blank" rel="noopener noreferrer" class="hover:opacity-70 transition-opacity" aria-label="Facebook">
                                <svg fill="currentColor" width="20" height="20" viewBox="0 0 24 24"><path d="M23 12C23 5.92487 18.0751 0.999996 12 0.999996C5.92488 0.999996 1 5.92487 1 12C1 17.1588 4.55146 21.4874 9.34266 22.6761V15.3614H7.07438V12H9.34266V10.5516C9.34266 6.80751 11.037 5.07215 14.7128 5.07215C15.4096 5.07215 16.6121 5.20877 17.104 5.34544V8.39261C16.8444 8.36529 16.3935 8.3516 15.8332 8.3516C14.0295 8.3516 13.3326 9.03484 13.3326 10.8112V12H16.9256L16.3084 15.3614H13.3326V22.9194C18.7792 22.2616 23 17.624 23 12Z"></path></svg>
                            </a>
                            <!--<a href="https://bsky.app/profile/livetagus.pt" target="_blank" rel="noopener noreferrer" class="hover:opacity-70 transition-opacity" aria-label="Bluesky">
                                <svg fill="currentColor" width="20" height="20" viewBox="0 0 24 24"><path d="M6.33526 4.37382C8.62822 6.09522 11.0945 9.58551 12.0001 11.4586C12.9056 9.58565 15.3718 6.09519 17.6649 4.37382C19.3193 3.13172 22 2.17066 22 5.22881C22 5.83957 21.6498 10.3595 21.4445 11.0933C20.7306 13.6444 18.1292 14.2951 15.8152 13.9013C19.86 14.5897 20.8889 16.87 18.6668 19.1502C14.4465 23.4809 12.601 18.0636 12.1278 16.6755C12.0412 16.4211 12.0006 16.302 12 16.4033C11.9994 16.302 11.9588 16.4211 11.8721 16.6755C11.3993 18.0636 9.55378 23.481 5.33322 19.1502C3.11103 16.87 4.13995 14.5896 8.18483 13.9013C5.87077 14.2951 3.26934 13.6444 2.55555 11.0933C2.35016 10.3594 2 5.8395 2 5.22881C2 2.17066 4.68074 3.13172 6.33515 4.37382H6.33526Z"></path></svg>
                            </a>-->
                            <button id="footer-share-btn" class="hover:opacity-70 transition-opacity cursor-pointer text-black dark:text-white" aria-label="Partilhar LiveTagus">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-share-icon lucide-share"><path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/></svg>
                            </button>
                        </div>
                    </div>
                    
                    <p class="text-xs text-zinc-500 max-w-xs leading-relaxed mt-2">
                        LiveTagus • <span id="footer-version-display">a verificar versão...</span><br><br>
                        Projeto independente e não oficial. Sem afiliação à Fertagus ou IP. Todos os direitos sobre os dados de circulação pertencem aos respetivos proprietários<br><br>
                        Em caso de dúvida, erro ou sugestão contacte-nos:
                    </p>                    
                    <a href="mailto:geral@livetagus.pt" class="text-xs underline text-zinc-500 hover:text-black dark:hover:text-white transition-colors">geral@livetagus.pt</a>
                    <p class="text-[10px] text-zinc-400 font-mono">
                        Desenvolvido por
                         <a href="https://www.linkedin.com/in/simaopssdias/" target="_blank" aria-label="LinkedIn do Simão Dias/Criado da LiveTagus" class="underline hover:text-black dark:hover:text-white transition-colors">Simão Dias</a>.
                    </p>
                </div>

                <div class="flex flex-col items-end text-right gap-2 md:w-1/2">
                    <span class="text-[10px] uppercase font-bold text-zinc-400 tracking-widest mb-2">Links & Info</span>
                    
                    <a href="/license" class="text-xs text-zinc-500 hover:text-black dark:hover:text-white transition-colors">Licença</a>
                    
                    <!-- PROVISÓRIO
                    <a href="/app" class="text-xs w-full flex justify-end items-center gap-2 text-zinc-500 hover:text-black dark:hover:text-white transition-colors">
                        <span id="status-dot-footer" class="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-700"></span>
                        Tempo Real
                    </a>-->

                    <a href="/mapa" class="text-xs w-full flex justify-end items-center gap-2 text-zinc-500 hover:text-black dark:hover:text-white transition-colors">
                        <span id="status-dot-footer" class="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-700"></span>
                        Tempo Real
                    </a>

                    <!-- PROVISORIO <a href="/sobre" class="text-xs text-zinc-500 hover:text-black dark:hover:text-white transition-colors">Apoia o Projeto</a>-->
                    <a href="/code_of_conduct" class="text-xs text-zinc-500 hover:text-black dark:hover:text-white transition-colors">Código de Conduta</a>
                    <a href="/privacidade" class="text-xs text-zinc-500 hover:text-black dark:hover:text-white transition-colors">Termos & Privacidade</a>
                    <a href="https://status.livetagus.pt/pt-pt" target="_blank" rel="noopener noreferrer" class="text-xs text-zinc-500 hover:text-black dark:hover:text-white transition-colors">Estado dos servidores</a>
                    <a href="/sobre" class="text-xs text-zinc-500 hover:text-black dark:hover:text-white transition-colors">Sobre Nós e Contactos</a>
                    
                    
                    <div class="flex justify-center mt-2">
                      <a href="/sobre?badge" class="opacity-80 hover:opacity-100 transition-opacity">                     
                        <img
                          src="/imagens/badge_coded_in_europe_portugal_margem_sul.svg"
                          alt="Badge saying Coded in Europe, Portugal, Margem Sul"
                          width="140px"
                          height="46.72px"
                        />
                      </a>
                    </div>
                    <div class="flex items-center justify-end gap-3 mt-2">
                        <a href="https://github.com/simonsays16/livetagus" target="_blank" class="text-zinc-400 hover:text-black dark:hover:text-white transition-colors p-1" aria-label="Ver Código no GitHub">
                            ${githubIcon}
                        </a>
                        <a href="https://www.netlify.com" target="_blank" rel="noopener noreferrer" class="flex items-center opacity-85 hover:opacity-100">
                            <img id="netlify-badge-footer" src="/imagens/netlify-light.svg" alt="Deploys by Netlify" width="114" height="51" />
                        </a>
                    </div>
                </div>

            </div>
        </footer>
    `;
}

// --- BOTÃO DE PARTILHA NO HEADER (antes no nav-tools.js) ---
// Partilha SEMPRE a página onde a pessoa está, com a querystring (?…).
// Reaproveita o fluxo do rodapé: partilha nativa → área de transferência
// → execCommand, com a pill "Link Copiado!".
function initHeaderShare() {
  const btn = document.getElementById("nav-share-trigger");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const loc = window.location;
    partilhar(
      loc.origin + loc.pathname + (loc.search || ""),
      "Olha a nova aplicação web para ver a Fertagus em tempo real!",
      "nav_share_button",
    );
  });
}

// --- BOTÃO DE PARTILHA NATIVA (rodapé) ---
function initShareButton() {
  const btn = document.getElementById("footer-share-btn");
  if (!btn) return;
  btn.addEventListener("click", () =>
    partilhar(
      "https://livetagus.pt",
      "Olha a nova aplicação web para ver a fertagus em tempo real! Gratuita e sem anúncios!",
      "native_share_button",
    ),
  );
}

async function partilhar(SHARE_URL, SHARE_TEXT, evento) {
  let pill = document.getElementById("share-pill-notification");
  if (!pill) {
    pill = document.createElement("div");
    pill.id = "share-pill-notification";
    pill.setAttribute("role", "status");
    pill.setAttribute("aria-live", "polite");
    pill.textContent = "Link Copiado!";
    Object.assign(pill.style, {
      position: "fixed",
      bottom: "2rem",
      left: "50%",
      transform: "translateX(-50%) translateY(calc(100% + 2rem))",
      background: "#18181b",
      color: "#ffffff",
      padding: "0.5rem 1.25rem",
      borderRadius: "9999px",
      fontSize: "0.7rem",
      fontWeight: "600",
      letterSpacing: "0.08em",
      fontFamily: "ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace",
      zIndex: "9999",
      opacity: "0",
      pointerEvents: "none",
      whiteSpace: "nowrap",
      boxShadow: "0 4px 24px rgba(0,0,0,0.35)",
      border: "1px solid rgba(255,255,255,0.08)",
      transition:
        "transform 0.35s cubic-bezier(0.16,1,0.3,1), opacity 0.35s ease",
      textTransform: "uppercase",
    });
    document.body.appendChild(pill);
  }

  let pillTimeout;
  function showPill() {
    clearTimeout(pillTimeout);
    pill.style.transform = "translateX(-50%) translateY(0)";
    pill.style.opacity = "1";
    pillTimeout = setTimeout(() => {
      pill.style.transform = "translateX(-50%) translateY(calc(100% + 2rem))";
      pill.style.opacity = "0";
    }, 2200);
  }

  {
    sa_event(evento);
    const shareData = { title: "LiveTagus", text: SHARE_TEXT, url: SHARE_URL };
    if (
      navigator.share &&
      (!navigator.canShare || navigator.canShare(shareData))
    ) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        if (err.name === "AbortError") return;
      }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(SHARE_URL);
        showPill();
        return;
      } catch {}
    }

    try {
      const ta = document.createElement("textarea");
      ta.value = SHARE_URL;
      ta.style.cssText =
        "position:fixed;top:0;left:0;opacity:0;pointer-events:none;";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showPill();
    } catch {}
  }
}

function initMenuInteractions() {
  const trigger = document.getElementById("menu-trigger");
  const overlay = document.getElementById("menu-overlay");
  if (!trigger || !overlay) return;

  const spans = trigger.querySelectorAll("span");
  const track = document.getElementById("ltm-track");
  const main = document.getElementById("ltm-main");
  const sub = document.getElementById("ltm-estacoes");
  const abrirEst = document.getElementById("ltm-open-estacoes");
  const voltar = document.getElementById("ltm-back");
  let isOpen = false;

  // Só o nível visível é focável/legível por leitores de ecrã.
  function nivel(n) {
    const noSub = n === 2;
    if (track) track.classList.toggle("is-sub", noSub);
    if (main) main.inert = noSub;
    if (sub) {
      sub.inert = !noSub;
      sub.setAttribute("aria-hidden", noSub ? "false" : "true");
    }
    if (main) main.setAttribute("aria-hidden", noSub ? "true" : "false");
    if (abrirEst)
      abrirEst.setAttribute("aria-expanded", noSub ? "true" : "false");
  }
  nivel(1);

  function setOpen(open) {
    isOpen = open;
    overlay.inert = !open;
    overlay.setAttribute("aria-hidden", open ? "false" : "true");
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
    trigger.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
    if (open) {
      overlay.classList.remove("translate-y-full");
      spans[0].classList.add("rotate-45", "translate-y-[5px]");
      spans[1].classList.add("-rotate-45", "-translate-y-[4px]", "w-8");
      spans[1].classList.remove("w-6");
      document.body.style.overflow = "hidden";
    } else {
      overlay.classList.add("translate-y-full");
      spans[0].classList.remove("rotate-45", "translate-y-[5px]");
      spans[1].classList.remove("-rotate-45", "-translate-y-[4px]", "w-8");
      spans[1].classList.add("w-6");
      document.body.style.overflow = "";
      // Ao fechar volta sempre ao primeiro nível (depois da animação).
      setTimeout(() => {
        if (!isOpen) nivel(1);
      }, 500);
    }
  }

  trigger.addEventListener("click", () => setOpen(!isOpen));

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !isOpen) return;
    if (track && track.classList.contains("is-sub")) {
      nivel(1);
      if (abrirEst) abrirEst.focus();
    } else {
      setOpen(false);
      trigger.focus();
    }
  });

  if (abrirEst) {
    abrirEst.addEventListener("click", () => {
      desenharEstacoes();
      nivel(2);
      if (voltar) setTimeout(() => voltar.focus({ preventScroll: true }), 60);
      if (typeof sa_event === "function") sa_event("menu_estacoes");
    });
  }
  if (voltar) {
    voltar.addEventListener("click", () => {
      nivel(1);
      if (abrirEst)
        setTimeout(() => abrirEst.focus({ preventScroll: true }), 60);
    });
  }
}

// Lista do segundo nível. Desenha logo com os nomes; os logos dos
// operadores entram quando as ligações chegarem (pedidas uma só vez).
let estacoesDesenhadas = false;
function desenharEstacoes() {
  const host = document.getElementById("ltm-stn-list");
  const E = window.LTEstacoes;
  if (!host || !E) return;
  if (estacoesDesenhadas) return;
  estacoesDesenhadas = true;

  const atual = (window.location.pathname || "")
    .toLowerCase()
    .replace(/\/+$/, "")
    .split("/")[2];

  const SVG_SETA = `<svg class="ltm-stn-arrow" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;

  function html(dados) {
    let out = "";
    for (const z of Object.keys(E.ZONAS).sort(
      (a, b) => E.ZONAS[a].index - E.ZONAS[b].index,
    )) {
      const lista = E.LISTA.filter((s) => s.zone === z);
      out += `<div class="ltm-zone"><span class="ltm-label">${E.esc(E.ZONAS[z].label)}</span><span class="ltm-zone-line"></span><span class="ltm-zone-n">${String(lista.length).padStart(2, "0")}</span></div>`;
      for (const s of lista) {
        const sl = E.slug(s.name);
        const ops = dados ? E.operadores(dados, s.apiId) : [];
        out += `<a href="/estacao/${sl}" class="ltm-stn"${sl === atual ? ' aria-current="page"' : ""}>
            <span class="ltm-stn-name">${E.esc(s.name)}</span>
            ${ops.length ? `<span class="ltm-stn-ops">${E.logosHtml(ops, { cmLight: "ltm-cm-light", cmDark: "ltm-cm-dark" })}</span>` : ""}
            ${SVG_SETA}
          </a>`;
      }
    }
    return out;
  }

  host.innerHTML = html(null);
  E.carregarLigacoes().then((dados) => {
    if (dados && Object.keys(dados).length) host.innerHTML = html(dados);
  });
}

// --- GESTÃO DE TEMA ---
function initTheme() {
  const savedTheme = localStorage.getItem("theme") || "system";
  setTheme(savedTheme);

  // Monitoriza alterações do sistema em tempo real
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (e) => {
      if (localStorage.getItem("theme") === "system") {
        setTheme("system");
      }
    });

  document.body.addEventListener("click", (e) => {
    const themeBtn = e.target.closest(".theme-btn");
    if (themeBtn && themeBtn.dataset.mode) {
      setTheme(themeBtn.dataset.mode);
    }
  });
}

function setTheme(mode) {
  localStorage.setItem("theme", mode);

  // Determina se deve ser escuro com base no modo ou no sistema
  let isDark;
  if (mode === "system") {
    isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  } else {
    isDark = mode === "dark";
  }

  const html = document.documentElement;
  const navLogo = document.getElementById("nav-logo");
  const footerLogo = document.getElementById("footer-logo");
  const netlifyBadgeMenu = document.getElementById("netlify-badge-menu");
  const netlifyBadgeFooter = document.getElementById("netlify-badge-footer");

  const logoLight = "/imagens/logotransparente.svg";
  const logoDark = "/imagens/icon.svg";
  const badgeDark = "/imagens/netlify-dark.svg";
  const badgeLight = "/imagens/netlify-light.svg";

  if (isDark) {
    html.classList.add("dark");
    if (navLogo) navLogo.src = logoDark;
    if (footerLogo) footerLogo.src = logoDark;
    if (netlifyBadgeMenu) netlifyBadgeMenu.src = badgeDark;
    if (netlifyBadgeFooter) netlifyBadgeFooter.src = badgeDark;
  } else {
    html.classList.remove("dark");
    if (navLogo) navLogo.src = logoLight;
    if (footerLogo) footerLogo.src = logoLight;
    if (netlifyBadgeMenu) netlifyBadgeMenu.src = badgeLight;
    if (netlifyBadgeFooter) netlifyBadgeFooter.src = badgeLight;
  }

  // Atualiza estado visual dos botões
  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.classList.remove("font-bold", "text-black", "dark:text-white");
    // O botão deve ficar destacado se o modo for exatamente o guardado
    if (btn.dataset.mode === mode) {
      btn.classList.add("font-bold", "text-black", "dark:text-white");
    }
  });
}

// --- API STATUS ---
async function checkApiStatus() {
  const dot = document.getElementById("status-dot");
  const dot_footer = document.getElementById("status-dot-footer");
  const text = document.getElementById("status-text");

  // menu ainda não foi injetado
  if (!dot || !text) {
    setTimeout(checkApiStatus, 500);
    return;
  }

  const now = new Date();

  /* --- MODO POUPANÇA (COMENTADO PARA TESTES) ---
  const hour = now.getHours();
  BLOQUEIO: Entre as 02:00 e as 05:00 não gastamos recursos
  if (hour >= 2 && hour < 5) {
    dot.className = "w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-700";
    if (dot_footer)
      dot_footer.className = "w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-700"; 
    text.textContent = "Modo Poupança (noite);
    return;
  }
  */

  try {
    const controller = new AbortController();
    // Timeout de 5s para o status check
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch("https://api.livetagus.pt/", {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      const successClass =
        "w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse";

      dot.className = successClass;
      if (dot_footer) dot_footer.className = successClass;

      const timeStr = now.toLocaleTimeString("pt-PT", {
        hour: "2-digit",
        minute: "2-digit",
      });

      text.textContent = `Online • ${timeStr}`;
      text.className =
        "text-[10px] font-mono text-zinc-600 dark:text-zinc-400 font-bold uppercase tracking-wide";
    } else {
      throw new Error("Servidor respondeu com erro");
    }
  } catch (err) {
    const errorClass = "w-2 h-2 rounded-full bg-amber-500/50";

    dot.className = errorClass;
    if (dot_footer) dot_footer.className = errorClass;

    text.textContent = "A ligar ao servidor...";

    // tentar 30 em 30 segundos
    setTimeout(checkApiStatus, 30000);
  }
}

// ─── INSTALAÇÃO DA WEBAPP (window.LTInstall) ───────────────────────────
// Um só sítio decide se a app pode ser instalada, se já está instalada e
// como se instala, em qualquer página que carregue o menu.js:
//   Android / Windows (Chrome, Edge, Samsung Internet) → prompt nativo
//     (beforeinstallprompt);
//   iPhone / iPad → modal com os passos do Safari (o iOS não tem API).
//
// Estados (LTInstall.state()):
//   "app"          a correr DENTRO da app instalada → nada a oferecer
//   "pronta"       o browser deixa instalar agora → botão visível
//   "ios"          iPhone/iPad no browser → botão abre as instruções
//   "a-instalar"   aceitou o prompt, à espera do "appinstalled"
//   "instalada"    instalada neste dispositivo, aberta no browser
//   "indisponivel" o browser não instala (Firefox, Safari no Mac…) ou ainda
//                  não disse nada
//
// Como se sabe se já está instalada (por ordem de confiança):
//   1. display-mode standalone / navigator.standalone → estamos na app;
//   2. beforeinstallprompt → o Chrome só o dispara se NÃO estiver instalada
//      (e se chegar, apaga qualquer marca antiga: foi desinstalada);
//   3. navigator.getInstalledRelatedApps() → Chrome (Android/Windows) com o
//      related_applications do site.webmanifest;
//   4. "appinstalled" → fica marcado em localStorage (lt_pwa_instalada).
// No iOS nada disto existe fora da app (e a app tem armazenamento próprio),
// por isso no browser o botão fica sempre disponível.
//
// Botões: qualquer elemento com [data-lt-install] fica escondido (atributo
// hidden) quando não há nada a oferecer e chama LTInstall.install() ao toque.
// Um [data-lt-install-sep] acompanha-o (o "·" do menu). Para outro
// comportamento, usar LTInstall.onChange(fn) — ver index.js.
(function initInstalacao() {
  if (window.LTInstall) return;

  const KEY = "lt_pwa_instalada";
  const KEY_OLD = "pwa_installed"; // chave antiga do index.js
  const ua = navigator.userAgent || "";
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isIPad =
    /iPad/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const inApp = /FBAN|FBAV|Instagram|Line\/|TikTok|Twitter|LinkedInApp/i.test(
    ua,
  );

  let prompt = null;
  let state = "indisponivel";
  let relacionada = false;
  let aInstalar = false; // aceitou o prompt e ainda não chegou o "appinstalled"
  const ouvintes = [];

  function lerMarca() {
    try {
      return (
        localStorage.getItem(KEY) === "1" ||
        localStorage.getItem(KEY_OLD) === "true"
      );
    } catch (_) {
      return false;
    }
  }
  function marcar(on) {
    try {
      if (on) localStorage.setItem(KEY, "1");
      else {
        localStorage.removeItem(KEY);
        localStorage.removeItem(KEY_OLD);
      }
    } catch (_) {}
  }

  function naApp() {
    const mm = (q) => window.matchMedia && window.matchMedia(q).matches;
    return (
      mm("(display-mode: standalone)") ||
      mm("(display-mode: fullscreen)") ||
      mm("(display-mode: minimal-ui)") ||
      mm("(display-mode: window-controls-overlay)") ||
      window.navigator.standalone === true ||
      document.referrer.indexOf("android-app://") === 0
    );
  }

  function calcular() {
    if (naApp()) return "app";
    if (aInstalar) return "a-instalar";
    if (prompt) return "pronta";
    if (isIOS) return "ios";
    if (relacionada || lerMarca()) return "instalada";
    return "indisponivel";
  }

  function atualizar() {
    const novo = calcular();
    const mudou = novo !== state;
    state = novo;
    sincronizarBotoes();
    if (mudou)
      ouvintes.slice().forEach((fn) => {
        try {
          fn(state);
        } catch (_) {}
      });
  }

  function visivel() {
    return state === "pronta" || state === "ios";
  }

  function sincronizarBotoes() {
    const v = visivel();
    document
      .querySelectorAll("[data-lt-install], [data-lt-install-sep]")
      .forEach((el) => {
        el.hidden = !v;
      });
  }

  // Liga os botões [data-lt-install] (por delegação: serve também para os
  // que forem criados depois, como o do menu).
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-lt-install]");
    if (!b) return;
    e.preventDefault();
    install();
  });

  // Sem <link rel="manifest"> o Chrome nunca oferece a instalação nessa
  // página. Só a página inicial o tinha; passa a haver em todas.
  function garantirManifesto() {
    if (document.querySelector('link[rel="manifest"]')) return;
    const l = document.createElement("link");
    l.rel = "manifest";
    l.href = "/site.webmanifest";
    document.head.appendChild(l);
  }

  // Tem de estar à escuta desde já (o evento pode chegar cedo).
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // o botão é nosso; sem mini-barra do browser
    prompt = e;
    relacionada = false;
    marcar(false); // se o Chrome deixa instalar, não está instalada
    aInstalar = false;
    atualizar();
  });

  window.addEventListener("appinstalled", () => {
    prompt = null;
    aInstalar = false;
    marcar(true);
    atualizar();
    if (typeof window.sa_event === "function") window.sa_event("pwa_installed");
  });

  async function install() {
    if (state === "ios") {
      if (typeof window.sa_event === "function")
        window.sa_event("pwa_install_ios_clicked");
      abrirModalIOS();
      return "ios";
    }
    if (!prompt) return "indisponivel";
    if (typeof window.sa_event === "function")
      window.sa_event("pwa_install_clicked");
    const p = prompt;
    prompt = null; // o prompt só se pode usar uma vez
    let outcome = "dismissed";
    try {
      p.prompt();
      const r = await p.userChoice;
      outcome = (r && r.outcome) || "dismissed";
    } catch (_) {}
    if (outcome === "accepted") {
      if (typeof window.sa_event === "function")
        window.sa_event("pwa_install_accepted");
      aInstalar = true;
      // Rede de segurança: se o "appinstalled" não chegar, dá-se como
      // instalada ao fim de 30 s (era a regra antiga da página inicial).
      setTimeout(() => {
        if (aInstalar) {
          aInstalar = false;
          marcar(true);
          atualizar();
        }
      }, 30000);
    }
    atualizar();
    return outcome;
  }

  // ── Modal do iOS ─────────────────────────────────────────────────────
  const SVG_PART =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="m8 7 4-4 4 4"/><path d="M8 11H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2"/></svg>';
  const SVG_MAIS =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
  const SVG_OK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  const SVG_AVISO =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/></svg>';
  const SVG_X =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  let modal = null;
  let ultimoFoco = null;

  function estilos() {
    if (document.getElementById("lti-styles")) return;
    const css = `
.lti-ov{position:fixed;inset:0;z-index:100;background:rgba(0,0,0,0);pointer-events:none;transition:background .3s ease}
.lti-ov.lti-open{background:rgba(0,0,0,.45);pointer-events:auto}
.lti-sheet{position:absolute;left:0;right:0;bottom:0;max-height:88dvh;overflow-y:auto;overscroll-behavior:contain;
  background:#fff;color:#18181b;border-radius:24px 24px 0 0;border-top:1px solid rgba(0,0,0,.06);
  box-shadow:0 -12px 40px -14px rgba(0,0,0,.35);padding:1.25rem 1.25rem calc(1.5rem + env(safe-area-inset-bottom,0px));
  transform:translateY(100%);visibility:hidden;font-family:inherit;
  transition:transform .36s cubic-bezier(.22,.61,.36,1),visibility 0s linear .36s}
html.dark .lti-sheet{background:#09090b;color:#fafafa;border-top-color:rgba(255,255,255,.08)}
.lti-ov.lti-open .lti-sheet{transform:translateY(0);visibility:visible;transition:transform .36s cubic-bezier(.22,.61,.36,1),visibility 0s}
@media (min-width:640px){.lti-sheet{left:50%;right:auto;bottom:2rem;width:420px;border-radius:20px;border:1px solid rgba(0,0,0,.08);
  transform:translate(-50%,calc(100% + 3rem))}
  html.dark .lti-sheet{border-color:rgba(255,255,255,.08)}
  .lti-ov.lti-open .lti-sheet{transform:translate(-50%,0)}}
.lti-handle{width:38px;height:4px;border-radius:999px;background:rgba(0,0,0,.15);margin:-.5rem auto .75rem}
html.dark .lti-handle{background:rgba(255,255,255,.2)}
@media (min-width:640px){.lti-handle{display:none}}
.lti-head{display:flex;align-items:flex-start;gap:.75rem}
.lti-head-main{flex:1;min-width:0}
.lti-kicker{font-size:9px;font-weight:800;letter-spacing:.3em;text-transform:uppercase;color:#a1a1aa;margin:0}
.lti-title{font-size:22px;font-weight:300;letter-spacing:-.02em;margin:.35rem 0 0;line-height:1.15}
.lti-close{flex-shrink:0;width:34px;height:34px;border:0;padding:0;display:inline-flex;align-items:center;justify-content:center;
  background:transparent;color:#a1a1aa;cursor:pointer;border-radius:999px}
.lti-close:hover{color:inherit}
.lti-warn{display:flex;gap:.65rem;align-items:flex-start;margin-top:1rem;padding:.75rem .85rem;border-radius:12px;
  background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);color:#92400e;font-size:12px;line-height:1.5}
html.dark .lti-warn{color:#fbbf24}
.lti-warn svg{width:18px;height:18px;flex-shrink:0;margin-top:1px}
.lti-steps{list-style:none;margin:1rem 0 0;padding:0;display:flex;flex-direction:column;gap:.6rem}
.lti-step{display:flex;align-items:center;gap:.85rem;padding:.8rem .9rem;border-radius:12px;background:#f4f4f5;border:1px solid rgba(0,0,0,.04);
  font-size:13px;line-height:1.4;color:#3f3f46}
html.dark .lti-step{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.05);color:#d4d4d8}
.lti-ic{width:34px;height:34px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;border-radius:9px;
  background:#fff;border:1px solid rgba(0,0,0,.08);color:#3b82f6}
html.dark .lti-ic{background:#27272a;border-color:rgba(255,255,255,.08)}
.lti-ic svg{width:18px;height:18px}
.lti-n{font-weight:700;color:#18181b;margin-right:.2rem}
html.dark .lti-n{color:#fff}
.lti-btn{display:block;width:100%;margin-top:1.1rem;height:46px;border:0;border-radius:12px;cursor:pointer;font-family:inherit;
  font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;background:#18181b;color:#fff}
html.dark .lti-btn{background:#fafafa;color:#18181b}
.lti-btn:active{transform:scale(.98)}
@media (prefers-reduced-motion:reduce){.lti-ov,.lti-sheet{transition:none!important}}`;
    const el = document.createElement("style");
    el.id = "lti-styles";
    el.textContent = css;
    document.head.appendChild(el);
  }

  function construirModal() {
    estilos();
    const dispositivo = isIPad ? "iPad" : "iPhone";
    modal = document.createElement("div");
    modal.className = "lti-ov";
    modal.innerHTML = `
      <div class="lti-sheet" role="dialog" aria-modal="true" aria-labelledby="lti-title">
        <div class="lti-handle" aria-hidden="true"></div>
        <div class="lti-head">
          <div class="lti-head-main">
            <p class="lti-kicker">Instalar a LiveTagus</p>
            <h2 class="lti-title" id="lti-title">Adicionar ao ecrã principal do ${dispositivo}</h2>
          </div>
          <button type="button" class="lti-close" data-lti="close" aria-label="Fechar">${SVG_X}</button>
        </div>
        <div class="lti-warn">${SVG_AVISO}<span>${
          inApp
            ? "Estás dentro de outra app (Instagram, Facebook…). Abre esta página no <b>Safari</b>: daqui não é possível instalar."
            : "Abre este site no <b>Safari</b>. Dentro de apps como o Instagram ou o Facebook não é possível instalar."
        }</span></div>
        <ol class="lti-steps">
          <li class="lti-step"><span class="lti-ic">${SVG_PART}</span><span><span class="lti-n">1.</span>Toca no botão <b>Partilhar</b>, na barra do Safari (em baixo ou em cima, conforme a versão).</span></li>
          <li class="lti-step"><span class="lti-ic">${SVG_MAIS}</span><span><span class="lti-n">2.</span>Escolhe <b>"Adicionar ao ecrã principal"</b>. Se não aparecer, desliza a lista ou procura em "Mais".</span></li>
          <li class="lti-step"><span class="lti-ic">${SVG_OK}</span><span><span class="lti-n">3.</span>Confirma em <b>"Adicionar"</b>. A LiveTagus fica no ecrã principal, como uma app.</span></li>
        </ol>
        <button type="button" class="lti-btn" data-lti="close">Percebido</button>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => {
      if (
        e.target === modal ||
        (e.target.closest && e.target.closest('[data-lti="close"]'))
      )
        fecharModalIOS();
    });
    // Arrastar para baixo fecha (mobile), como os outros painéis.
    const sheet = modal.querySelector(".lti-sheet");
    let y0 = null;
    let dy = 0;
    sheet.addEventListener(
      "touchstart",
      (e) => {
        if (sheet.scrollTop > 0) return;
        y0 = e.touches[0].clientY;
        dy = 0;
        sheet.style.transition = "none";
      },
      { passive: true },
    );
    sheet.addEventListener(
      "touchmove",
      (e) => {
        if (y0 == null) return;
        dy = Math.max(0, e.touches[0].clientY - y0);
        sheet.style.transform = `translateY(${dy}px)`;
      },
      { passive: true },
    );
    const fim = () => {
      if (y0 == null) return;
      y0 = null;
      sheet.style.transition = "";
      sheet.style.transform = "";
      if (dy > 100) fecharModalIOS();
    };
    sheet.addEventListener("touchend", fim, { passive: true });
    sheet.addEventListener("touchcancel", fim, { passive: true });
  }

  function onKey(e) {
    if (e.key === "Escape") fecharModalIOS();
  }

  function abrirModalIOS() {
    if (!modal) construirModal();
    ultimoFoco = document.activeElement;
    void modal.offsetWidth; // para a transição de entrada correr
    modal.classList.add("lti-open");
    document.addEventListener("keydown", onKey);
    const b = modal.querySelector(".lti-btn");
    if (b)
      setTimeout(() => {
        try {
          b.focus({ preventScroll: true });
        } catch (_) {}
      }, 50);
  }

  function fecharModalIOS() {
    if (!modal || !modal.classList.contains("lti-open")) return;
    modal.classList.remove("lti-open");
    document.removeEventListener("keydown", onKey);
    if (ultimoFoco && ultimoFoco.focus) {
      try {
        ultimoFoco.focus({ preventScroll: true });
      } catch (_) {}
    }
  }

  // ── Arranque ─────────────────────────────────────────────────────────
  function arrancar() {
    garantirManifesto();
    atualizar();
    // Chrome (Android/Windows): pergunta ao sistema se a app já está
    // instalada. Precisa do related_applications no manifesto.
    if (
      !naApp() &&
      !isIOS &&
      typeof navigator.getInstalledRelatedApps === "function"
    ) {
      navigator
        .getInstalledRelatedApps()
        .then((apps) => {
          if (apps && apps.length && !prompt) {
            relacionada = true;
            atualizar();
          }
        })
        .catch(() => {});
    }
    // Entrar/sair do modo app sem recarregar (ex.: "Abrir na app" no desktop).
    if (window.matchMedia) {
      const mq = window.matchMedia("(display-mode: standalone)");
      if (mq.addEventListener) mq.addEventListener("change", atualizar);
    }
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", arrancar, { once: true });
  else arrancar();

  window.LTInstall = {
    state: () => state,
    canInstall: visivel,
    install,
    showIOSHelp: abrirModalIOS,
    isStandalone: naApp,
    // Chamado logo com o estado atual e depois a cada mudança.
    onChange(fn) {
      if (typeof fn !== "function") return;
      ouvintes.push(fn);
      try {
        fn(state);
      } catch (_) {}
    },
    // Para quem cria botões [data-lt-install] depois do arranque.
    refresh: sincronizarBotoes,
  };
})();

// INJEÇÃO DO SISTEMA OFFLINE
(function initOfflineSystem() {
  // Registar Service worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/sw.js")
      // .then(() => console.log("[SW] Registado com sucesso"))
      .catch((err) => console.log("[SW] Falha ao registar:", err));
  }

  // Injetar script Offline
  if (!document.querySelector('script[src="/offline.js"]')) {
    const script = document.createElement("script");
    script.src = "/offline.js";
    script.defer = true;
    document.head.appendChild(script);
  }
})();

// --- ATUALIZAÇÃO DINÂMICA DE VERSÃO ---
async function updateAppVersion() {
  const menuVersionEl = document.getElementById("menu-version-display");
  const footerVersionEl = document.getElementById("footer-version-display");
  const roadmapVersionEl = document.getElementById("roadmap-version-display");

  // versao default
  let version = "v.base";

  try {
    const res = await fetch("/sw.js");
    if (res.ok) {
      const text = await res.text();
      const match = text.match(
        /GLOBAL_VERSION\s*=\s*["']livetagus-(v\.[^"']+)["']/,
      );

      if (match && match[1]) {
        version = match[1];
      }
    }
  } catch (err) {
    console.warn("[App Version] Não foi possível ler a versão do sw.js", err);
  }

  if (menuVersionEl) menuVersionEl.textContent = `LiveTagus • ${version}`;
  if (footerVersionEl) footerVersionEl.textContent = version;
  if (roadmapVersionEl) roadmapVersionEl.textContent = `Versão: ${version}`;
}
// ignorar certas páginas
const ignorePaths = ["/stats", "/404"];
const currentPath = window.location.pathname.toLowerCase();
const shouldIgnoreAnalytics = ignorePaths.some((path) =>
  currentPath.includes(path),
);

if (!shouldIgnoreAnalytics) {
  // 100% privacy-first analytics (Simple Analytics)
  const injectarSA = () => {
    const saScript = document.createElement("script");
    saScript.src = "/api/sa.js";
    saScript.async = true;
    saScript.defer = true;
    saScript.setAttribute("data-collect-dnt", "true");
    saScript.setAttribute("data-api", "/api/sa-events");
    document.head.appendChild(saScript);
  };
  // No mapa, o analytics espera que a Fertagus esteja desenhada (o portão
  // LTArranque do mapa-render.js). Tem de ser no DOMContentLoaded: este
  // ficheiro corre ANTES do mapa-render.js, e o portão ainda não existe
  // nesse momento. Nas outras páginas não há portão e carrega logo.
  // Os eventos disparados entretanto ficam na fila do sa_event (topo do
  // ficheiro), que o Simple Analytics processa quando chega.
  document.addEventListener("DOMContentLoaded", () => {
    if (window.LTArranque) window.LTArranque.depois(injectarSA);
    else injectarSA();
  });
} else {
  window.sa_event = function () {};
}

/* PROVISÓRIO BOTÃO ESTAÇÕES BREVEMENTE
function initComingSoonPill() {
  const btnEstacoes = document.getElementById("btn-menu-estacoes");
  if (!btnEstacoes) return;

  let pill = document.getElementById("coming-soon-pill");
  if (!pill) {
    pill = document.createElement("div");
    pill.id = "coming-soon-pill";
    pill.setAttribute("role", "status");
    pill.setAttribute("aria-live", "polite");
    pill.textContent = "PARTIDAS E LIGAÇÕES POR ESTAÇÃO BREVEMENTE";
    Object.assign(pill.style, {
      position: "fixed",
      bottom: "6rem",
      left: "50%",
      transform: "translateX(-50%) translateY(calc(100% + 2rem))",
      background: "#18181b",
      color: "#ffffff",
      padding: "0.625rem 1.25rem",
      borderRadius: "9999px",
      fontSize: "0.7rem",
      fontWeight: "700",
      letterSpacing: "0.08em",
      fontFamily: "ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace",
      zIndex: "9999",
      opacity: "0",
      pointerEvents: "none",
      whiteSpace: "nowrap",
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      border: "1px solid rgba(255,255,255,0.08)",
      transition:
        "transform 0.35s cubic-bezier(0.16,1,0.3,1), opacity 0.35s ease",
      textTransform: "uppercase",
    });
    document.body.appendChild(pill);
  }

  let pillTimeout;
  btnEstacoes.addEventListener("click", (e) => {
    e.preventDefault();
    clearTimeout(pillTimeout);
    void pill.offsetWidth;

    pill.style.transform = "translateX(-50%) translateY(0)";
    pill.style.opacity = "1";

    pillTimeout = setTimeout(() => {
      pill.style.transform = "translateX(-50%) translateY(calc(100% + 2rem))";
      pill.style.opacity = "0";
    }, 3000);
  });
}*/

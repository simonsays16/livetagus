/**
 * nav-tools.js  ·  LiveTagus
 * ─────────────────────────────────────────────────────────────────────────────
 * Injeta automaticamente, no header (#global-nav), DOIS botões padrão em todas
 * as páginas onde este ficheiro for incluído:
 *
 *   • BOTÃO DE PARTILHA  — partilha SEMPRE o link da página onde o utilizador
 *     está, incluindo as querystrings (?a=b) caso existam. Usa a partilha nativa
 *     (navigator.share) e, em fallback, copia para a área de transferência com
 *     uma pill de confirmação (mesmo estilo do menu.js).
 *
 *   • BOTÃO DE MOBILIDADE — popover com atalhos para as outras ferramentas.
 *     Os itens vêm de um mini-JSON (MENU_ITEMS) com os parâmetros:
 *        titulo, descricao, icon (nome do ícone lucide), link, escondido
 *     "escondido" = chave(s) de página onde o item NÃO aparece, separadas por
 *     ".". É assim que se cumprem as exceções:
 *        1. "Horário Inteligente" é exclusivo da app → escondido = todas as
 *           páginas menos "app".
 *        2. Nunca mostrar o atalho para a própria página → cada item esconde-se
 *           na sua própria página (ex.: "Mapa Tempo Real" tem escondido:"mapa").
 *
 * Auto-contido e idempotente: espera que o menu.js construa o header e só então
 * injeta; não duplica se os botões já existirem. Mantém o estilo dos botões
 * atuais (Tailwind pré-compilado + ícones lucide).
 *
 * Inclusão:  <script src="/nav-tools.js" defer></script>  (depois do menu.js)
 */

(function () {
  "use strict";
  if (window.__navToolsLoaded) return;
  window.__navToolsLoaded = true;

  // ═══════════════════════════════════════════════════════════════════════════
  // MINI-JSON · itens do menu de mobilidade
  //   titulo     → título apresentado
  //   descricao  → subtítulo
  //   icon       → nome do ícone lucide (https://lucide.dev/icons)
  //   link       → destino (navegação) — OU usar "action" para uma ação
  //   action     → valor de data-action (ex.: "open-smart-menu"); alternativa a link
  //   escondido  → páginas onde NÃO aparece, separadas por "." (ver pageKey())
  // ═══════════════════════════════════════════════════════════════════════════
  const MENU_ITEMS = [
    {
      titulo: "APP",
      descricao: "Vê um trajeto especifico",
      icon: "train-track",
      link: "/app",
      escondido: "app",
    },
    {
      titulo: "Horário Inteligente",
      descricao: "A tua Viagem Diária",
      icon: "zap",
      // NÃO é link — dispara a ação delegada da app (app-init.js).
      action: "open-smart-menu",
      // Exclusivo da app → escondido em todas as outras páginas.
      escondido: "home.mapa.paragens.sudoku.estacao.horarios.sobre",
    },
    {
      titulo: "Mapa",
      descricao: "Localização REAL dos comboios",
      icon: "map",
      link: "/mapa",
      escondido: "mapa",
    },
    {
      titulo: "Estações",
      descricao: "Lista de Partidas e Ligações",
      icon: "train-front-tunnel",
      link: "/estacao/",
      escondido: "estacao",
    },
    {
      titulo: "Autocarros (BETA)",
      descricao: "Vais de autocarro para a estação?",
      icon: "bus",
      link: "/paragens",
      escondido: "paragens",
    },
    {
      titulo: "Sudoku",
      descricao: "Tempo extra? Joga.",
      icon: "gamepad-2",
      link: "/sudoku",
      escondido: "sudoku",
    },
  ];

  // Texto da partilha (o URL é sempre o da página atual, ver shareCurrentPage).
  const SHARE_TEXT =
    "Olha a nova aplicação web para ver a Fertagus em tempo real!";

  // ═══════════════════════════════════════════════════════════════════════════
  // ESTILO POR PÁGINA
  //   "flat"  → botões normais; barra do header sólida (predefinição).
  //   "glass" → header transparente e cada controlo é uma "pill" de vidro
  //             (bg-white/80 + backdrop-blur), para SE VER O MAPA por trás.
  // É assim que o mapa mantém o seu formato distinto sem código próprio.
  // ═══════════════════════════════════════════════════════════════════════════
  const PAGE_STYLE = {
    mapa: "glass",
  };

  // Classes dos botões circulares conforme o estilo.
  const BTN_FLAT =
    "p-2 rounded-full transition-colors text-zinc-900 dark:text-white hover:opacity-70";
  const BTN_GLASS = [
    "p-2 rounded-full",
    "bg-white/80 dark:bg-[#09090b]/80",
    "backdrop-blur-md",
    "border border-zinc-200/50 dark:border-white/5",
    "shadow-sm",
    "transition-colors",
    "text-zinc-900 dark:text-white",
  ].join(" ");

  // Classes da barra do header que o estilo "glass" remove (para ficar transparente).
  const HEADER_BAR_CLASSES = [
    "bg-white/80",
    "dark:bg-[#09090b]/80",
    "backdrop-blur-md",
    "border-b",
    "border-zinc-200/50",
    "dark:border-white/5",
    "supports-[backdrop-filter]:bg-white/60",
    "dark:supports-[backdrop-filter]:bg-[#09090b]/60",
  ];

  // ═══ PÁGINA ATUAL ═══════════════════════════════════════════════════════════
  // Devolve a "chave" da página a partir do pathname:
  //   "/" → home · "/mapa" → mapa · "/estacao/coina" → estacao · etc.
  function pageKey() {
    const p = (window.location.pathname || "/")
      .toLowerCase()
      .replace(/\/+$/, "");
    if (p === "" || p === "/" || /^\/index(\.html?)?$/.test(p)) return "home";
    const seg = p.split("/").filter(Boolean)[0] || "home";
    if (seg === "estacoes" || seg === "estacao") return "estacao";
    return seg;
  }

  function isHidden(item, key) {
    if (!item || !item.escondido) return false;
    return String(item.escondido)
      .split(".")
      .map((s) => s.trim())
      .filter(Boolean)
      .includes(key);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ═══ ÍCONES INLINE (botões trigger — independentes do lucide) ════════════════
  const SVG_SHARE = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/></svg>`;
  const SVG_GRID = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`;
  const SVG_CHEVRON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;

  function lucideIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      try {
        window.lucide.createIcons();
      } catch (_) {}
    }
  }

  // ═══ PARTILHA ════════════════════════════════════════════════════════════════
  function ensurePill() {
    let pill = document.getElementById("share-pill-notification");
    if (pill) return pill;
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
    return pill;
  }
  let pillTimeout;
  function showPill(text) {
    const pill = ensurePill();
    if (text) pill.textContent = text;
    clearTimeout(pillTimeout);
    pill.style.transform = "translateX(-50%) translateY(0)";
    pill.style.opacity = "1";
    pillTimeout = setTimeout(() => {
      pill.style.transform = "translateX(-50%) translateY(calc(100% + 2rem))";
      pill.style.opacity = "0";
    }, 2200);
  }

  // Link da PÁGINA ATUAL, com querystring (?…) caso exista.
  function currentPageUrl() {
    const loc = window.location;
    return loc.origin + loc.pathname + (loc.search || "");
  }

  async function shareCurrentPage() {
    if (typeof sa_event === "function") sa_event("nav_share_button");
    const url = currentPageUrl();
    const shareData = { title: "LiveTagus", text: SHARE_TEXT, url };

    if (
      navigator.share &&
      (!navigator.canShare || navigator.canShare(shareData))
    ) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        showPill("Link Copiado!");
        return;
      } catch (_) {}
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.cssText =
        "position:fixed;top:0;left:0;opacity:0;pointer-events:none;";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showPill("Link Copiado!");
    } catch (_) {}
  }

  // ═══ POPOVER DE MOBILIDADE ════════════════════════════════════════════════════
  function buildPopover(items) {
    const popover = document.createElement("div");
    popover.id = "mobility-popover";
    popover.className =
      "fixed top-16 right-4 w-70 bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl hidden origin-top-right transition-all duration-300 transform scale-95 opacity-0 z-50 overflow-hidden";

    const rows = items
      .map((item, i) => {
        const divider =
          i > 0
            ? `<div class="h-px w-full bg-zinc-100 dark:bg-zinc-800"></div>`
            : "";
        const inner = `
            <i data-lucide="${escapeHtml(item.icon || "circle")}" class="w-4 h-4 text-zinc-900 dark:text-white"></i>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-zinc-900 dark:text-white leading-none">${escapeHtml(item.titulo)}</p>
              <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 font-light tracking-wide">${escapeHtml(item.descricao || "")}</p>
            </div>
            ${SVG_CHEVRON}`;
        const cls =
          "w-full flex items-center gap-4 px-4 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-left";
        // Item de AÇÃO (ex.: Horário Inteligente) → <button data-action="…">.
        if (item.action) {
          return `${divider}
          <button type="button" data-action="${escapeHtml(item.action)}" data-nav-tool class="${cls}">${inner}</button>`;
        }
        // Item de NAVEGAÇÃO → <a href="…">.
        return `${divider}
          <a href="${escapeHtml(item.link)}" data-nav-tool class="${cls}">${inner}</a>`;
      })
      .join("");

    popover.innerHTML = `
      <div class="px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
        <p class="text-[9px] font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">Mobilidade & Smart</p>
      </div>
      <div class="flex flex-col">${rows}</div>`;
    return popover;
  }

  function wirePopover(triggerBtn, popover) {
    const open = () => {
      popover.classList.remove("hidden");
      requestAnimationFrame(() => {
        popover.classList.remove("scale-95", "opacity-0");
        popover.classList.add("scale-100", "opacity-100");
      });
    };
    const close = () => {
      popover.classList.remove("scale-100", "opacity-100");
      popover.classList.add("scale-95", "opacity-0");
      setTimeout(() => popover.classList.add("hidden"), 200);
    };
    triggerBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (popover.classList.contains("hidden")) open();
      else close();
    });
    document.addEventListener("click", (e) => {
      if (
        !popover.classList.contains("hidden") &&
        !popover.contains(e.target) &&
        !triggerBtn.contains(e.target)
      ) {
        close();
      }
    });
    // Fecha o popover ao clicar num item; itens de ação deixam o evento
    // borbulhar para a delegação da app (ex.: data-action="open-smart-menu").
    popover.querySelectorAll("[data-nav-tool]").forEach((el) => {
      el.addEventListener("click", () => {
        if (typeof sa_event === "function") sa_event("nav_mobility_click");
        close();
      });
    });
  }

  // ═══ INJEÇÃO ══════════════════════════════════════════════════════════════════
  function inject() {
    const header = document.querySelector("#global-nav header");
    const trigger = document.getElementById("menu-trigger");
    if (!header || !trigger) return false;
    if (document.getElementById("nav-tools-wrapper")) return true; // idempotente

    const key = pageKey();
    const style = PAGE_STYLE[key] || "flat";
    const glass = style === "glass";
    const btnClass = glass ? BTN_GLASS : BTN_FLAT;

    // ── Estilo "glass": header transparente + logo numa pill (para ver o mapa)
    if (glass) {
      HEADER_BAR_CLASSES.forEach((c) => header.classList.remove(c));
      header.classList.remove("px-6");
      header.classList.add("px-3");
      const logoEl = header.firstElementChild;
      if (logoEl && !document.getElementById("nav-logo-pill")) {
        const logoPill = document.createElement("div");
        logoPill.id = "nav-logo-pill";
        logoPill.className = [
          "flex items-center px-3 py-2 rounded-xl",
          "bg-white/80 dark:bg-[#09090b]/80 backdrop-blur-md",
          "border border-zinc-200/50 dark:border-white/5 shadow-sm",
        ].join(" ");
        logoEl.parentNode.insertBefore(logoPill, logoEl);
        logoPill.appendChild(logoEl);
      }
    }

    // Agrupa os botões (partilha + mobilidade + hambúrguer) à direita.
    const wrapper = document.createElement("div");
    wrapper.id = "nav-tools-wrapper";
    wrapper.className = "flex items-center gap-2";
    header.insertBefore(wrapper, trigger);

    // — Botão de Partilha —
    if (!document.getElementById("nav-share-trigger")) {
      const shareBtn = document.createElement("button");
      shareBtn.id = "nav-share-trigger";
      shareBtn.type = "button";
      shareBtn.className = btnClass;
      shareBtn.setAttribute("aria-label", "Partilhar esta página");
      shareBtn.innerHTML = SVG_SHARE;
      shareBtn.addEventListener("click", shareCurrentPage);
      wrapper.appendChild(shareBtn);
    }

    // — Botão de Mobilidade (popover) —
    const items = MENU_ITEMS.filter((it) => !isHidden(it, key));
    if (items.length > 0 && !document.getElementById("mobility-trigger")) {
      const mobBtn = document.createElement("button");
      mobBtn.id = "mobility-trigger";
      mobBtn.type = "button";
      mobBtn.className = btnClass;
      mobBtn.setAttribute("aria-label", "Ferramentas e mobilidade");
      mobBtn.innerHTML = SVG_GRID;
      wrapper.appendChild(mobBtn);

      const popover = buildPopover(items);
      document.getElementById("global-nav").appendChild(popover);
      wirePopover(mobBtn, popover);
    }

    // No estilo "glass" o hambúrguer também ganha pill de vidro.
    if (glass) {
      trigger.classList.add(
        "bg-white/80",
        "dark:bg-[#09090b]/80",
        "backdrop-blur-md",
        "border",
        "border-zinc-200/50",
        "dark:border-white/5",
        "shadow-sm",
        "rounded-full",
        "py-3.5",
      );
    }

    // O hambúrguer fica sempre por último, dentro do mesmo grupo.
    wrapper.appendChild(trigger);

    lucideIcons();
    return true;
  }

  // O menu.js injeta o header de forma assíncrona; tenta até existir.
  function boot() {
    if (inject()) return;
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      if (inject() || tries > 60) clearInterval(iv); // ~6s no máximo
    }, 100);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // API mínima (debug/integração)
  window.NavTools = {
    MENU_ITEMS,
    pageKey,
    share: shareCurrentPage,
    reinject: inject,
  };
})();

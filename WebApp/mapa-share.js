/**
 * mapa-share.js
 * Partilha nativa do dispositivo com fallback para área de transferência +
 * toast pill "Link Copiado!".
 */

(function () {
  "use strict";

  let toastEl = null;
  let toastTimer = null;

  // ─── TOAST PILL ──────────────────────────────────────────────────────

  function ensureToastEl() {
    if (toastEl) return toastEl;
    toastEl = document.createElement("div");
    toastEl.id = "mapa-toast";
    toastEl.setAttribute("role", "status");
    toastEl.setAttribute("aria-live", "polite");
    toastEl.className =
      "fixed z-[9999] left-1/2 -translate-x-1/2 bottom-8 md:bottom-10 " +
      "px-5 py-3 pb-safe-ios " +
      "bg-zinc-900/95 dark:bg-white/95 text-white dark:text-zinc-900 " +
      "text-[11px] font-bold uppercase tracking-[0.2em] rounded-full " +
      "shadow-2xl backdrop-blur-md " +
      "opacity-0 translate-y-4 pointer-events-none " +
      "transition-all duration-300 ease-out";
    toastEl.style.willChange = "opacity, transform";
    document.body.appendChild(toastEl);
    return toastEl;
  }

  function showToast(msg, durationMs) {
    const el = ensureToastEl();
    el.textContent = msg;
    el.classList.remove("opacity-0", "translate-y-4", "pointer-events-none");
    el.classList.add("opacity-100", "translate-y-0");
    if (toastTimer) clearTimeout(toastTimer);
    const d = durationMs || (MAPA.SHARE && MAPA.SHARE.toastDurationMs) || 2400;
    toastTimer = setTimeout(() => {
      el.classList.remove("opacity-100", "translate-y-0");
      el.classList.add("opacity-0", "translate-y-4", "pointer-events-none");
    }, d);
  }

  // ─── COPY FALLBACK ───────────────────────────────────────────────────

  async function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        // cai para execCommand
      }
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  // ─── PARTILHA ────────────────────────────────────────────────────────

  function currentUrl() {
    try {
      return window.location.href || MAPA.SHARE.urlFallback;
    } catch (_) {
      return MAPA.SHARE.urlFallback;
    }
  }

  async function share() {
    const cfg = (MAPA && MAPA.SHARE) || {};
    const url = currentUrl();
    const payload = {
      title: cfg.title || document.title || "LiveTagus",
      text: cfg.text || "",
      url,
    };

    if (navigator.share) {
      try {
        await navigator.share(payload);
        return "native";
      } catch (e) {
        // User aborted — não é erro. Não mostrar toast nesse caso.
        if (e && e.name === "AbortError") return "aborted";
        // Outros erros: cai no fallback
      }
    }

    const ok = await copyToClipboard(url);
    if (ok) {
      showToast("Link Copiado!");
      return "copied";
    }
    showToast("Partilha indisponível");
    return "failed";
  }

  function attachToButton(btn) {
    if (!btn || btn.dataset.shareBound) return;
    btn.dataset.shareBound = "1";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      share();
    });
  }

  window.MapaShare = {
    share,
    showToast,
    attachToButton,
    _copyToClipboard: copyToClipboard,
  };
})();

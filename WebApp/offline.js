/**
 * offline.js
 * Gestão do estado offline da app:
 *  - Intercepção de cliques em links indisponíveis
 *  - Pill de notificação "Indisponível offline"
 *  - Dispatch de network-status-change para o resto da app
 */

// ─── PÁGINAS DISPONÍVEIS OFFLINE ─────────────────────────────────────────────

var OFFLINE_ALLOWED_PATHS = [
  "/",
  "./",
  "index",
  "index.html",
  "app",
  "app.html",
  "horarios",
  "horarios.html",
  "privacidade",
  "privacidade.html",
  "sudoku",
  "sudoku.html",
];
// Apenas paginas estritamente necessárias para navegação

function _isOfflineAvailable(href) {
  if (!href) return true;
  if (
    href.startsWith("#") ||
    href.startsWith("javascript:") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:")
  )
    return true;
  // Links externos bloqueados
  if (href.startsWith("http://") || href.startsWith("https://")) return false;
  // Verifica paths disponíveis
  var clean = href
    .split("?")[0]
    .split("#")[0]
    .replace(/\/+$/, "")
    .toLowerCase();
  return OFFLINE_ALLOWED_PATHS.some(function (p) {
    var pc = p.replace(/\/+$/, "").toLowerCase();
    return (
      clean === pc ||
      clean === "./" + pc ||
      clean === "/" + pc ||
      clean.endsWith("/" + pc)
    );
  });
}

// ─── PILL "INDISPONÍVEL OFFLINE" ──────────────────────────────────────────────

var _pillHideTimeout = null;

function showOfflinePill() {
  var pill = document.getElementById("offline-pill");

  if (!pill) {
    pill = document.createElement("div");
    pill.id = "offline-pill";
    pill.setAttribute("role", "status");
    pill.setAttribute("aria-live", "polite");
    // Posicionado com translate-x via style para não depender de Tailwind
    pill.style.cssText = [
      "position:fixed",
      "bottom:6rem",
      "left:50%",
      "transform:translateX(-50%) translateY(1rem)",
      "z-index:9999",
      "pointer-events:none",
      "user-select:none",
      "background:#18181b",
      "color:#fff",
      "padding:0.625rem 1.25rem",
      "border-radius:9999px",
      "box-shadow:0 8px 32px rgba(0,0,0,0.4)",
      "font-size:0.6875rem",
      "font-weight:700",
      "letter-spacing:0.08em",
      "text-transform:uppercase",
      "display:flex",
      "align-items:center",
      "gap:0.5rem",
      "opacity:0",
      "transition:opacity 0.3s ease, transform 0.3s ease",
      "white-space:nowrap",
    ].join(";");
    pill.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<line x1="2" y1="2" x2="22" y2="22"/>' +
      '<path d="M8.5 16.5a5 5 0 0 1 7 0"/>' +
      '<path d="M2 8.82a15 15 0 0 1 4.17-2.65"/>' +
      '<path d="M10.66 5c1.11-.17 2.24-.17 3.34 0"/>' +
      '<path d="M16.85 8.17A15 15 0 0 1 22 12"/>' +
      '<path d="M5 12.859a10 10 0 0 1 5.17-2.69"/>' +
      '<circle cx="12" cy="20" r="1"/>' +
      "</svg>" +
      "<span>Indisponível offline</span>";
    document.body.appendChild(pill);
  }

  clearTimeout(_pillHideTimeout);
  // Força reflow antes de aplicar a transição
  void pill.offsetWidth;
  pill.style.opacity = "1";
  pill.style.transform = "translateX(-50%) translateY(0)";

  _pillHideTimeout = setTimeout(function () {
    pill.style.opacity = "0";
    pill.style.transform = "translateX(-50%) translateY(1rem)";
  }, 2500);
}
window.showOfflineToast = showOfflinePill;

// ─── INTERCEPÇÃO DE CLIQUES (capture phase) ───────────────────────────────────

document.addEventListener(
  "click",
  function (e) {
    if (navigator.onLine) return;

    var link = e.target.closest("a[href]");
    if (!link) return;

    var href = link.getAttribute("href");
    if (_isOfflineAvailable(href)) return;

    e.preventDefault();
    e.stopPropagation();
    showOfflinePill();
  },
  true, // capture phase
);

// ─── ESTADO DA REDE ───────────────────────────────────────────────────────────

function updateOfflineUI() {
  window.dispatchEvent(
    new CustomEvent("network-status-change", {
      detail: { online: navigator.onLine },
    }),
  );
}

document.addEventListener("DOMContentLoaded", function () {
  updateOfflineUI();
  window.addEventListener("online", updateOfflineUI);
  window.addEventListener("offline", updateOfflineUI);
});

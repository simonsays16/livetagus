/* Filename: offline.js */

document.addEventListener("DOMContentLoaded", () => {
  updateOfflineUI();

  window.addEventListener("online", updateOfflineUI);
  window.addEventListener("offline", updateOfflineUI);
});

function updateOfflineUI() {
  const isOffline = !navigator.onLine;
  const body = document.body;

  // Páginas permitidas offline
  const allowedPages = [
    "index.html",
    "app.html",
    "horarios.html",
    "privacidade.html",
    "/",
  ];

  // Seleciona todos os links
  const links = document.querySelectorAll("a");

  links.forEach((link) => {
    // Ignora links internos como # ou javascript:
    if (!link.getAttribute("href") || link.getAttribute("href").startsWith("#"))
      return;

    const href = link.getAttribute("href");
    const isExternal = href.startsWith("http");
    const isAllowed = allowedPages.some(
      (page) => href.includes(page) || href === "./" || href === "/",
    );

    // Se estiver offline E o link for externo ou não permitido
    if (isOffline && (isExternal || !isAllowed)) {
      link.classList.add("offline-blocked");
      link.style.textDecoration = "line-through";
      link.style.opacity = "0.5";

      // Adiciona listener para bloquear clique e mostrar aviso
      link.onclick = (e) => {
        e.preventDefault();
        showOfflineToast();
      };
    } else {
      // Restaura estado original
      link.classList.remove("offline-blocked");
      link.style.textDecoration = "";
      link.style.opacity = "";
      link.onclick = null; // Remove o bloqueio
    }
  });

  // Dispara evento para a app.html atualizar os alertas
  window.dispatchEvent(
    new CustomEvent("network-status-change", {
      detail: { online: !isOffline },
    }),
  );
}

let toastTimeout;
function showOfflineToast() {
  // Remove toast anterior se existir
  const existing = document.getElementById("offline-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "offline-toast";
  toast.className =
    "fixed bottom-20 left-1/2 -translate-x-1/2 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black px-4 py-2 rounded-full shadow-lg z-50 text-xs font-bold uppercase tracking-wide flex items-center gap-2 animate-fade-in-up";
  toast.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.46 14a2.5 2.5 0 1 1 3.75 3.75"/><path d="M14.05 10.36a6 6 0 0 1 7.21 7.21"/><path d="M17.65 6.74a10 10 0 0 1 14.7 14.7"/><path d="M2 2l20 20"/></svg>
        <span>Sem Internet</span>
    `;

  document.body.appendChild(toast);

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* Filename: index.js */

document.addEventListener("DOMContentLoaded", () => {
  // === GESTOR PWA v8.0 (Lógica Estrita: 30s Wait) ===

  let deferredPrompt;
  const mainBtn = document.getElementById("main-btn");
  const mainBtnText = document.getElementById("main-btn-text");
  const installingMsg = document.getElementById("installing-msg");
  const installedMsg = document.getElementById("installed-msg");
  const browserBtn = document.getElementById("browser-btn");
  const webHint = document.getElementById("web-hint");

  // 1. Deteção Inicial
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone ||
    document.referrer.includes("android-app://");

  if (isStandalone) {
    // DENTRO DA APP: Botão "Ver Tempo Real"
    setupUIForApp();
  } else if (localStorage.getItem("pwa_installed") === "true") {
    // NO BROWSER (Instalada): Nota simples
    setupUIForInstalled();
  }

  // 2. Evento de Prompt de Instalação
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;

    // Se o browser diz que pode instalar, mostramos o botão
    if (!isStandalone) {
      localStorage.removeItem("pwa_installed");
      setupUIForInstall();
    }
  });

  // --- SETUP DE UI ---

  function setupUIForApp() {
    if (mainBtn) {
      mainBtn.classList.remove("hidden");
      // CORREÇÃO DO BUG: Novo ID exclusivo 'status-dot-hero' para não roubar o do footer
      mainBtnText.innerHTML =
        'Ver Tempo Real&nbsp;&nbsp;<span id="status-dot-hero" class="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-700"></span>';

      mainBtn.addEventListener("click", () => {
        window.location.href = "./app.html";
      });
    }

    if (browserBtn) browserBtn.style.display = "none";
    if (webHint) webHint.innerText = "Verifica se há atrasos";
    if (installedMsg) installedMsg.classList.add("hidden");
    if (installingMsg) installingMsg.classList.add("hidden");

    // Lógica para sincronizar a bolinha do botão com a bolinha da API
    setInterval(() => {
      const globalDot = document.getElementById("status-dot"); // Vem do menu superior
      const heroDot = document.getElementById("status-dot-hero");

      if (globalDot && heroDot) {
        heroDot.className = globalDot.className;
      }
    }, 1000);
  }

  function setupUIForInstall() {
    if (mainBtn) {
      mainBtn.classList.remove("hidden");
      mainBtnText.textContent = "Instalar WebApp";
      mainBtn.addEventListener("click", handleInstallClick);
    }

    if (installedMsg) installedMsg.classList.add("hidden");
    if (installingMsg) installingMsg.classList.add("hidden");
    if (browserBtn) browserBtn.style.display = "flex";
    if (webHint) webHint.style.display = "block";
  }

  function setupUIForInstalled() {
    if (mainBtn) mainBtn.classList.add("hidden");
    if (installingMsg) installingMsg.classList.add("hidden");
    if (installedMsg) installedMsg.classList.remove("hidden");

    if (browserBtn) browserBtn.style.display = "flex";
    if (webHint) webHint.style.display = "block";
  }

  // --- LOGICA DE CLIQUE (ESTRITA 30s) ---

  async function handleInstallClick() {
    if (!deferredPrompt) {
      alert(
        "Para instalar: \niOS: Partilhar -> Ecrã Principal\nAndroid: Menu -> Instalar App",
      );
      return;
    }

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === "accepted") {
      if (mainBtn) mainBtn.classList.add("hidden");
      if (installingMsg) installingMsg.classList.remove("hidden");

      setTimeout(() => {
        finishInstallation();
      }, 30000);
    }

    deferredPrompt = null;
  }

  function finishInstallation() {
    localStorage.setItem("pwa_installed", "true");
    if (installingMsg) installingMsg.classList.add("hidden");
    if (installedMsg) installedMsg.classList.remove("hidden");
  }
});

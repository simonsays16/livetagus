/* Filename: index.js */

document.addEventListener("DOMContentLoaded", () => {
  // === BOTÃO PRINCIPAL (instalação) ===
  // A decisão "dá para instalar / já está instalada / estamos na app" é do
  // módulo global window.LTInstall (menu.js). Aqui só se traduz o estado no
  // botão principal e nas mensagens desta página.

  const mainBtn = document.getElementById("main-btn");
  const mainBtnText = document.getElementById("main-btn-text");
  const installingMsg = document.getElementById("installing-msg");
  const installedMsg = document.getElementById("installed-msg");
  const browserBtn = document.getElementById("browser-btn");
  const webHint = document.getElementById("web-hint");

  // === FLAG TEMPORÁRIA: App bloqueada (fonte de dados em baixo desde 12/jun) ===
  // Reverter tudo ao normal = APP_OFFLINE = false
  const APP_OFFLINE = true;

  // App em baixo → esconde "Abrir App" em TODOS os estados (inclui iOS sem prompt)
  if (APP_OFFLINE && browserBtn) browserBtn.style.display = "none";

  // O browser-btn está comentado no index.html: sem esta guarda, a linha
  // rebentava e o resto do gestor (botão de instalar incluído) nunca corria.
  if (browserBtn)
    browserBtn.addEventListener("click", () => sa_event("app_on_browser"));

  const LT = window.LTInstall;
  const isStandalone = LT
    ? LT.isStandalone()
    : window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone;

  if (isStandalone) {
    // DENTRO DA APP: Botão "Ver Tempo Real"
    setupUIForApp();
    return;
  }

  let installClickBound = false;
  if (LT) LT.onChange(applyState);

  function applyState(state) {
    if (state === "pronta" || state === "ios") setupUIForInstall();
    else if (state === "a-instalar") setupUIForInstalling();
    else if (state === "instalada") setupUIForInstalled();
    else setupUIHidden();
  }

  // --- SETUP DE UI ---

  function setupUIForApp() {
    if (mainBtn) {
      mainBtn.classList.remove("hidden");
      // CORREÇÃO DO BUG: Novo ID exclusivo 'status-dot-hero' para não roubar o do footer
      mainBtnText.innerHTML =
        'Ver Tempo Real&nbsp;&nbsp;<span id="status-dot-hero" class="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-700"></span>';

      mainBtn.addEventListener("click", () => {
        // PROVISORIO
        // window.location.href = "./app.html";
        window.location.href = "./mapa";
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
      if (!installClickBound) {
        installClickBound = true;
        mainBtn.addEventListener("click", () => {
          if (window.LTInstall) window.LTInstall.install();
        });
      }
    }

    if (installedMsg) installedMsg.classList.add("hidden");
    if (installingMsg) installingMsg.classList.add("hidden");
    if (browserBtn && !APP_OFFLINE) browserBtn.style.display = "flex";
    if (webHint) webHint.style.display = "block";
  }

  function setupUIForInstalling() {
    if (mainBtn) mainBtn.classList.add("hidden");
    if (installedMsg) installedMsg.classList.add("hidden");
    if (installingMsg) installingMsg.classList.remove("hidden");
  }

  function setupUIForInstalled() {
    if (mainBtn) mainBtn.classList.add("hidden");
    if (installingMsg) installingMsg.classList.add("hidden");
    if (installedMsg) installedMsg.classList.remove("hidden");

    if (browserBtn && !APP_OFFLINE) browserBtn.style.display = "flex";
    if (webHint) webHint.style.display = "block";
  }

  // Browser que não instala (ou que ainda não respondeu): sem botão.
  function setupUIHidden() {
    if (mainBtn) mainBtn.classList.add("hidden");
    if (installingMsg) installingMsg.classList.add("hidden");
    if (installedMsg) installedMsg.classList.add("hidden");
  }
});

(() => {
  const trainTitle = document.getElementById("demo-title");
  const trainBadge = document.getElementById("status-badge");
  const cars = [...document.querySelectorAll(".car-v2")];
  const extras = [...document.querySelectorAll(".extra-v2")];
  const clock = document.getElementById("demo-clock");
  const greeting = document.getElementById("demo-greeting");
  const direction = document.getElementById("demo-direction");

  const scenarios = [
    {
      time: "08:30",
      greet: "Bom dia! Sugestão:",
      dir: "Lisboa",
      train: "short",
      color: "red",
      fill: 4,
      text: "Curto • Cheio",
      badge: "Lotação Esgotada",
      cls: "bg-red-500 text-white",
      dirCls: "bg-blue-600",
    },
    {
      time: "17:45",
      greet: "Boa tarde! Sugestão:",
      dir: "Margem",
      train: "long",
      color: "green",
      fill: 3,
      text: "Longo • Livre",
      badge: "Ocupação Baixa",
      cls: "bg-emerald-500 text-white",
      dirCls: "bg-zinc-800 dark:bg-zinc-700",
    },
  ];

  const colorMap = {
    green: "bg-emerald-500",
    red: "bg-red-500",
  };

  let step = 0;

  function updateDemo() {
    const s = scenarios[step];

    clock.style.opacity = "0";
    direction.style.opacity = "0";

    setTimeout(() => {
      clock.textContent = s.time;
      greeting.textContent = s.greet;
      direction.textContent = s.dir;
      direction.className = `text-[10px] font-bold px-2 py-0.5 rounded text-white uppercase transition-all duration-500 ${s.dirCls}`;
      clock.style.opacity = "1";
      direction.style.opacity = "1";
    }, 300);

    trainTitle.textContent = s.text;
    trainBadge.textContent = s.badge;
    trainBadge.className = `px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider transition-all duration-500 ${s.cls}`;

    extras.forEach((e) => {
      if (s.train === "short") e.classList.add("collapsed");
      else e.classList.remove("collapsed");
    });

    let visibleIdx = 0;
    cars.forEach((c) => {
      c.classList.remove("bg-emerald-500", "bg-red-500", "dimmed-v2");

      if (!c.classList.contains("collapsed")) {
        if (visibleIdx < s.fill) c.classList.add(colorMap[s.color]);
        else c.classList.add("dimmed-v2");
        visibleIdx++;
      } else {
        c.classList.add("dimmed-v2");
      }
    });

    step = (step + 1) % scenarios.length;
  }

  updateDemo();
  setInterval(updateDemo, 2000);
})();

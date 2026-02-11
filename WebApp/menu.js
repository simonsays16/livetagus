/* Filename: js/menu.js 
   Funções: Menu Global, Footer Global, Definições de Tema, API Status
*/

document.addEventListener("DOMContentLoaded", () => {
  injectNavigation();
  injectFooter();
  initTheme();
  initMenuInteractions();
  checkApiStatus(); // Inicia a verificação do status
});

// --- 1. BARRA DE NAVEGAÇÃO E MENU LATERAL ---
function injectNavigation() {
  const navContainer = document.getElementById("global-nav");
  if (!navContainer) return;

  // O src inicial não importa muito pois o initTheme corre logo a seguir e corrige
  const logoSrc = "./imagens/logotransparente.svg";

  const githubIcon = `<svg viewBox="0 0 24 24" class="w-5 h-5 fill-current"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>`;

  navContainer.innerHTML = `
        <header class="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-6 py-4 transition-all duration-500 bg-white/80 dark:bg-[#09090b]/80 backdrop-blur-md border-b border-zinc-200/50 dark:border-white/5 supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-[#09090b]/60">
            
            <a href="./" class="flex items-center gap-3 group" aria-label="Ir para a página inicial">
                <img id="nav-logo" src="${logoSrc}" class="w-8 h-8 opacity-100 transition-opacity object-contain" alt="LiveTagus Logo" width="32" height="32">
                <span class="font-sans font-bold tracking-tighter text-lg text-zinc-900 dark:text-white">LIVETAGUS</span>
            </a>
            
            <button id="menu-trigger" class="flex flex-col items-end gap-1.5 group cursor-pointer p-2 text-zinc-900 dark:text-white" aria-label="Abrir Menu">
                <span class="w-8 h-[1.5px] bg-current transition-all duration-300 group-hover:w-10"></span>
                <span class="w-6 h-[1.5px] bg-current transition-all duration-300 group-hover:w-10"></span>
            </button>
        </header>

        <div id="menu-overlay" class="fixed inset-0 bg-white dark:bg-[#09090b] z-40 transform translate-y-full transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] flex flex-col justify-between pt-24 pb-10 px-6 overflow-hidden overflow-y-auto">
            
            <div class="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/5 dark:bg-blue-900/10 rounded-full blur-[120px] pointer-events-none"></div>

            <nav class="flex flex-col gap-2 relative z-10">
                <a href="./" class="menu-link text-4xl md:text-6xl font-light tracking-tighter text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors uppercase">Início</a>
                <a href="./app.html" class="menu-link text-4xl md:text-6xl font-light tracking-tighter text-black dark:text-white transition-colors uppercase italic">Tempo Real</a>
                <a href="./horarios.html" class="menu-link text-4xl md:text-6xl font-light tracking-tighter text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors uppercase">Horários</a>
                <a href="https://status.livetagus.pt/pt-pt" target="_blank" rel="noopener noreferrer" class="menu-link text-4xl md:text-6xl font-light tracking-tighter text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors uppercase">Estado</a>
                <a href="./sobre.html" class="menu-link text-4xl md:text-6xl font-light tracking-tighter text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors uppercase">Sobre</a>
            </nav>

            <div class="relative z-10 border-t border-zinc-200 dark:border-white/10 pt-8 mt-8 md:pb-0">
                <div class="flex flex-col md:flex-row justify-between items-start md:items-end gap-8">
                    
                    <div class="space-y-4 w-full md:w-auto">
                        <span class="text-xs font-bold tracking-widest text-zinc-500 uppercase">Aparência</span>
                        <div class="flex gap-4">
                            <button onclick="setTheme('light')" class="theme-btn text-sm text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white uppercase tracking-wider transition-colors" data-mode="light">Light</button>
                            <button onclick="setTheme('dark')" class="theme-btn text-sm text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white uppercase tracking-wider transition-colors" data-mode="dark">Dark</button>
                            <button onclick="setTheme('system')" class="theme-btn text-sm text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white uppercase tracking-wider transition-colors" data-mode="system">Auto</button>
                        </div>
                    </div>

                    <div class="flex flex-col items-start gap-3">
                        <p class="text-[10px] text-zinc-600 font-mono mb-0 leading-none">LiveTagus • v.b11.02.2026</p>
                        
                        <div id="api-status-display" class="flex items-center gap-2 mb-1">
                            <span id="status-dot" class="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-700"></span>
                            <span id="status-text" class="text-[10px] font-mono text-zinc-500 uppercase tracking-wide">A verificar...</span>
                        </div>

                        <div class="flex items-center gap-4">
                            <a href="https://github.com/simonsays16/livetagus" target="_blank" class="text-zinc-500 hover:text-black dark:hover:text-white transition-colors" aria-label="GitHub">
                                ${githubIcon}
                            </a>
                            <a href="https://www.netlify.com" target="_blank" aria-label="Alojado na Netlify">
                                <img id="netlify-badge-menu" src="https://www.netlify.com/assets/badges/netlify-badge-color-accent.svg" alt="Deploys by Netlify" class="h-6 w-auto" width="114" height="51" />
                            </a>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    `;
}

// --- 2. FOOTER GLOBAL (Para o fundo das páginas) ---
function injectFooter() {
  const footerContainer = document.getElementById("global-footer");
  if (!footerContainer) return;

  const logoSrc = "./imagens/logotransparente.svg";
  const githubIcon = `<svg viewBox="0 0 24 24" class="w-9 h-9 fill-current"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>`;

  footerContainer.innerHTML = `
        <footer class="relative z-10 px-6 py-12 bg-zinc-50/50 dark:bg-zinc-900/20 backdrop-blur-sm border-t border-zinc-200 dark:border-white/5 mt-auto">
            <div class="max-w-4xl mx-auto flex flex-col md:flex-row justify-between gap-10">
                
                <div class="space-y-4 md:w-1/2">
                    <a href="./" class="inline-block hover:opacity-70 transition-opacity" aria-label="Voltar ao início">
                        <img id="footer-logo" src="${logoSrc}" class="w-10 h-10 opacity-100" alt="LiveTagus" width="40" height="40">
                    </a>
                    
                    <p class="text-xs text-zinc-500 max-w-xs leading-relaxed">
                        LiveTagus • v.b11.02.2026<br><br>
                        Projeto independente e não oficial. Sem afiliação à Fertagus ou IP. Todos os direitos sobre os dados de circulação pertencem aos respetivos proprietários<br><br>
                        Em caso de dúvida, erro ou sugestão contacte-nos:
                    </p>                    
                    <a href="mailto:geral@livetagus.pt" class="text-xs underline text-zinc-500 hover:text-black dark:hover:text-white transition-colors">geral@livetagus.pt</a>
                    <p class="text-[10px] text-zinc-400 font-mono">
                        Desenvolvido por Simão Dias.
                    </p>
                </div>

                <div class="flex flex-col items-end text-right gap-2 md:w-1/2">
                    <span class="text-[10px] uppercase font-bold text-zinc-400 tracking-widest mb-2">Links & Info</span>
                    
                    <a href="./license" class="text-xs text-zinc-500 hover:text-black dark:hover:text-white transition-colors">Licença</a>
                    
                    <a href="./app" class="text-xs w-full flex justify-end items-center gap-2 text-zinc-500 hover:text-black dark:hover:text-white transition-colors">
                        <span id="status-dot-footer" class="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-700"></span>
                        Tempo Real
                    </a>

                    <a href="./sobre" class="text-xs text-zinc-500 hover:text-black dark:hover:text-white transition-colors">Apoia o Projeto</a>
                    <a href="./code_of_conduct" class="text-xs text-zinc-500 hover:text-black dark:hover:text-white transition-colors">Código de Conduta</a>
                    <a href="./privacidade" class="text-xs text-zinc-500 hover:text-black dark:hover:text-white transition-colors">Termos & Privacidade</a>
                    <a href="https://status.livetagus.pt/pt-pt" target="_blank" rel="noopener noreferrer" class="text-xs text-zinc-500 hover:text-black dark:hover:text-white transition-colors">Estado dos servidores</a>
                    <a href="./sobre" class="text-xs text-zinc-500 hover:text-black dark:hover:text-white transition-colors">Sobre Nós e Contactos</a>
                    
                    
                    <div class="flex justify-center mt-2">
                      <a href="./sobre" class="opacity-80 hover:opacity-100 transition-opacity">                     
                        <img
                          src="./imagens/badge_coded_in_europe_portugal_margem_sul.svg"
                          alt="Badge saying Coded in Europe, Portugal"
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
                            <img id="netlify-badge-footer" src="https://www.netlify.com/assets/badges/netlify-badge-color-accent.svg" alt="Deploys by Netlify" width="114" height="51" />
                        </a>
                    </div>
                </div>

            </div>
        </footer>
    `;
}

// --- 3. INTERAÇÕES DO MENU ---
function initMenuInteractions() {
  const trigger = document.getElementById("menu-trigger");
  const overlay = document.getElementById("menu-overlay");

  if (!trigger || !overlay) return;

  const spans = trigger.querySelectorAll("span");
  let isOpen = false;

  trigger.addEventListener("click", () => {
    isOpen = !isOpen;
    if (isOpen) {
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
    }
  });
}

// --- 4. GESTÃO DE TEMA (DARK/LIGHT) ---
function initTheme() {
  const savedTheme = localStorage.getItem("theme") || "system";
  setTheme(savedTheme);

  // Monitoriza alterações do sistema em tempo real
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (e) => {
      // Só aplica a mudança automaticamente se o utilizador estiver em modo 'system'
      if (localStorage.getItem("theme") === "system") {
        setTheme("system");
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

  const logoLight = "./imagens/logotransparente.svg";
  const logoDark = "./imagens/icon.svg";
  const badgeDark =
    "https://www.netlify.com/assets/badges/netlify-badge-dark.svg";
  const badgeLight =
    "https://www.netlify.com/assets/badges/netlify-badge-light.svg";

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

// --- 5. API STATUS CHECKER ---
async function checkApiStatus() {
  const dot = document.getElementById("status-dot");
  const dot_footer = document.getElementById("status-dot-footer");
  const text = document.getElementById("status-text");

  // Se o menu ainda não foi injetado, tenta de novo em breve
  if (!dot || !text) {
    setTimeout(checkApiStatus, 500);
    return;
  }

  const now = new Date();

  // --- MODO POUPANÇA (COMENTADO PARA TESTES) ---
  /* const hour = now.getHours();
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
    // Timeout curto (5s) para o status check
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    // Endpoint raiz, sem API_KEY
    const res = await fetch("https://api.livetagus.pt/", {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      // ONLINE
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
    // OFFLINE
    const errorClass = "w-2 h-2 rounded-full bg-amber-500/50";

    dot.className = errorClass;
    if (dot_footer) dot_footer.className = errorClass;

    text.textContent = "A ligar ao servidor...";

    // Tentativas 30 em 30 segundos
    setTimeout(checkApiStatus, 30000);
  }
}

// INJEÇÃO DO SISTEMA OFFLINE
(function initOfflineSystem() {
  // 1. Registar Service Worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js")
      .then(() => console.log("[SW] Registado com sucesso"))
      .catch((err) => console.log("[SW] Falha ao registar:", err));
  }

  // 2. Injetar Script Offline
  const script = document.createElement("script");
  script.src = "./offline.js";
  script.defer = true;
  document.head.appendChild(script);
})();

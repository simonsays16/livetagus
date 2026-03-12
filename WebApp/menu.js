/* Filename: js/menu.js 
   Funções: Menu Global, Footer Global, Definições de Tema, API Status, CSP Compliant
*/

document.addEventListener("DOMContentLoaded", () => {
  injectNavigation();
  injectFooter();
  initTheme();
  initMenuInteractions();
  checkApiStatus(); // Inicia a verificação do status
  updateAppVersion(); // busca a versão ao sw.js
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
                <span class="w-8 h-[1.5px] bg-current transition-all duration-300 group-hover:w-10 pointer-events-none"></span>
                <span class="w-6 h-[1.5px] bg-current transition-all duration-300 group-hover:w-10 pointer-events-none"></span>
            </button>
        </header>

        <div id="menu-overlay" class="fixed inset-0 bg-white dark:bg-[#09090b] z-40 transform translate-y-full transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] flex flex-col justify-between pt-24 pb-10 px-6 overflow-hidden overflow-y-auto">
            
            <div class="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/5 dark:bg-blue-900/10 rounded-full blur-[120px] pointer-events-none"></div>

            <nav class="flex flex-col gap-2 relative z-10">
                <a href="./" class="menu-link text-4xl md:text-6xl font-light tracking-tighter text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors uppercase">Início</a>
                <a href="./app" class="menu-link text-4xl md:text-6xl font-light tracking-tighter text-black dark:text-white transition-colors uppercase italic">Tempo Real</a>
                <a href="./horarios" class="menu-link text-4xl md:text-6xl font-light tracking-tighter text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors uppercase">Horários</a>
                <a id="btn-menu-estado" href="https://status.livetagus.pt/pt-pt" target="_blank" rel="noopener noreferrer" class="menu-link text-4xl md:text-6xl font-light tracking-tighter text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors uppercase">Estado</a>
                <a id="btn-menu-sobre" href="./sobre" class="menu-link text-4xl md:text-6xl font-light tracking-tighter text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors uppercase">Sobre</a>
            </nav>

            <div class="relative z-10 border-t border-zinc-200 dark:border-white/10 pt-8 mt-8 md:pb-0">
                <div class="flex flex-col md:flex-row justify-between items-start md:items-end gap-8">
                    
                    <div class="space-y-4 w-full md:w-auto">
                        <span class="text-xs font-bold tracking-widest text-zinc-500 uppercase">Aparência</span>
                        <div class="flex gap-4">
                            <button class="theme-btn text-sm text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white uppercase tracking-wider transition-colors" data-mode="light">Light</button>
                            <button class="theme-btn text-sm text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white uppercase tracking-wider transition-colors" data-mode="dark">Dark</button>
                            <button class="theme-btn text-sm text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white uppercase tracking-wider transition-colors" data-mode="system">Auto</button>
                        </div>
                    </div>

                    <div class="flex flex-col items-start gap-3">
                        <p id="menu-version-display" class="text-[10px] text-zinc-600 font-mono mb-0 leading-none">LiveTagus • a verificar versão...</p>
                        
                        <div id="api-status-display" class="flex items-center gap-2 mb-1">
                            <span id="status-dot" class="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-700"></span>
                            <span id="status-text" class="text-[10px] font-mono text-zinc-500 uppercase tracking-wide">A verificar...</span>
                        </div>

                        <div class="flex items-center gap-4">
                            <a href="https://github.com/simonsays16/livetagus" target="_blank" class="text-zinc-500 hover:text-black dark:hover:text-white transition-colors" aria-label="GitHub">
                                ${githubIcon}
                            </a>
                            <a href="https://www.netlify.com" target="_blank" aria-label="Alojado na Netlify">
                                <img id="netlify-badge-menu" src="./imagens/netlify-light.svg" alt="Deploys by Netlify" class="h-6 w-auto" width="114" height="51" />
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
                    <div class="flex items-center gap-4">
                        <a href="./" class="inline-block hover:opacity-70 transition-opacity" aria-label="Voltar ao início">
                            <img id="footer-logo" src="${logoSrc}" class="w-10 h-10 opacity-100" alt="LiveTagus" width="40" height="40">
                        </a>
                        
                        <div class="w-px h-8 bg-zinc-300 dark:bg-zinc-700"></div> <div class="flex items-center gap-3 text-black dark:text-white">
                            <a href="https://instagram.com/livetagus" target="_blank" rel="noopener noreferrer" class="hover:opacity-70 transition-opacity" aria-label="Instagram">
                                <svg fill="currentColor" width="20" height="20" viewBox="0 0 24 24"><path d="M12 2C9.2912 2 8.94131 2 7.86907 2.05643C7.03985 2.07241 6.21934 2.22888 5.44244 2.51919C4.78781 2.77878 4.23476 3.11738 3.67043 3.68172C3.11738 4.23476 2.76749 4.78781 2.51919 5.45372C2.27088 6.08578 2.10158 6.80813 2.05643 7.88036C2.01129 8.94131 2 9.27991 2 12C2 14.7088 2 15.0474 2.05643 16.1196C2.10158 17.1919 2.28217 17.9255 2.51919 18.5576C2.77878 19.2122 3.11738 19.7652 3.67043 20.3296C4.23476 20.8826 4.78781 21.2325 5.44244 21.4808C6.08578 21.7291 6.80813 21.8984 7.86907 21.9436C8.94131 21.9887 9.27991 22 12 22C14.7088 22 15.0474 22 16.1196 21.9436C17.1806 21.8984 17.9142 21.7178 18.5463 21.4808C19.2137 21.2306 19.8184 20.8377 20.3183 20.3296C20.8826 19.7652 21.2212 19.2009 21.4695 18.5576C21.7178 17.9142 21.8871 17.1919 21.9436 16.1196C21.9887 15.0587 22 14.7201 22 12C22 9.2912 21.9887 8.9526 21.9436 7.88036C21.9225 7.05065 21.7622 6.23037 21.4695 5.45372C21.2189 4.78649 20.8261 4.18182 20.3183 3.68172C19.754 3.11738 19.2122 2.77878 18.5463 2.51919C17.7686 2.23315 16.9482 2.08051 16.1196 2.06772C15.0474 2.01129 14.7088 2 12 2ZM11.0971 3.80587H12C14.6637 3.80587 14.9797 3.80587 16.0406 3.8623C16.6724 3.8686 17.2985 3.98313 17.8916 4.2009C18.3657 4.38149 18.693 4.59594 19.0429 4.94582C19.3928 5.29571 19.6072 5.63431 19.7991 6.09706C19.9345 6.45824 20.0925 6.97743 20.1377 7.95937C20.1828 9.00903 20.1941 9.32506 20.1941 12C20.1941 14.6637 20.1941 14.9797 20.1377 16.0406C20.1314 16.6724 20.0169 17.2985 19.7991 17.8916C19.6185 18.3657 19.3928 18.693 19.0429 19.0429C18.7043 19.3928 18.3657 19.6072 17.8916 19.7878C17.2992 20.0094 16.6731 20.1278 16.0406 20.1377C14.9797 20.1828 14.6637 20.1941 12 20.1941C9.32506 20.1941 9.00903 20.1941 7.95937 20.1377C7.3238 20.1322 6.69388 20.0177 6.09706 19.7991C5.63431 19.6072 5.307 19.3928 4.94582 19.0429C4.60722 18.7043 4.38149 18.3657 4.2009 17.8916C3.98313 17.2985 3.8686 16.6724 3.8623 16.0406C3.80587 14.9797 3.79458 14.6637 3.79458 12C3.79458 9.32506 3.80587 9.00903 3.85102 7.95937C3.85602 7.32375 3.97057 6.69376 4.18962 6.09706C4.38149 5.63431 4.59594 5.307 4.94582 4.94582C5.29571 4.60722 5.62302 4.38149 6.09706 4.2009C6.69376 3.98185 7.32375 3.86731 7.95937 3.8623C8.87359 3.81716 9.23476 3.80587 11.0971 3.79458V3.80587ZM17.3386 5.46501C17.1815 5.46501 17.0259 5.49596 16.8808 5.55608C16.7356 5.6162 16.6037 5.70433 16.4926 5.81542C16.3815 5.92652 16.2934 6.05841 16.2333 6.20356C16.1732 6.34871 16.1422 6.50429 16.1422 6.6614C16.1422 6.81851 16.1732 6.97408 16.2333 7.11924C16.2934 7.26439 16.3815 7.39628 16.4926 7.50737C16.6037 7.61847 16.7356 7.70659 16.8808 7.76672C17.0259 7.82684 17.1815 7.85779 17.3386 7.85779C17.6559 7.85779 17.9602 7.73174 18.1846 7.50737C18.4089 7.28301 18.535 6.9787 18.535 6.6614C18.535 6.3441 18.4089 6.03979 18.1846 5.81542C17.9602 5.59106 17.6559 5.46501 17.3386 5.46501ZM12 6.86456C11.3256 6.86456 10.6578 6.99739 10.0348 7.25547C9.41169 7.51355 8.84556 7.89182 8.36869 8.36869C7.89182 8.84556 7.51355 9.41169 7.25547 10.0348C6.99739 10.6578 6.86456 11.3256 6.86456 12C6.86456 12.6744 6.99739 13.3422 7.25547 13.9652C7.51355 14.5883 7.89182 15.1544 8.36869 15.6313C8.84556 16.1082 9.41169 16.4864 10.0348 16.7445C10.6578 17.0026 11.3256 17.1354 12 17.1354C13.362 17.1354 14.6682 16.5944 15.6313 15.6313C16.5944 14.6682 17.1354 13.362 17.1354 12C17.1354 10.638 16.5944 9.33178 15.6313 8.36869C14.6682 7.40561 13.362 6.86456 12 6.86456ZM12 8.67043C12.4372 8.67043 12.8702 8.75655 13.2742 8.92388C13.6781 9.0912 14.0452 9.33646 14.3544 9.64564C14.6635 9.95482 14.9088 10.3219 15.0761 10.7258C15.2434 11.1298 15.3296 11.5628 15.3296 12C15.3296 12.4372 15.2434 12.8702 15.0761 13.2742C14.9088 13.6781 14.6635 14.0452 14.3544 14.3544C14.0452 14.6635 13.6781 14.9088 13.2742 15.0761C12.8702 15.2434 12.4372 15.3296 12 15.3296C11.1169 15.3296 10.2701 14.9788 9.64564 14.3544C9.02122 13.7299 8.67043 12.8831 8.67043 12C8.67043 11.1169 9.02122 10.2701 9.64564 9.64564C10.2701 9.02122 11.1169 8.67043 12 8.67043Z"></path></svg>
                            </a>
                            <a href="https://www.facebook.com/people/LiveTagus/61583577115985/" target="_blank" rel="noopener noreferrer" class="hover:opacity-70 transition-opacity" aria-label="Facebook">
                                <svg fill="currentColor" width="20" height="20" viewBox="0 0 24 24"><path d="M23 12C23 5.92487 18.0751 0.999996 12 0.999996C5.92488 0.999996 1 5.92487 1 12C1 17.1588 4.55146 21.4874 9.34266 22.6761V15.3614H7.07438V12H9.34266V10.5516C9.34266 6.80751 11.037 5.07215 14.7128 5.07215C15.4096 5.07215 16.6121 5.20877 17.104 5.34544V8.39261C16.8444 8.36529 16.3935 8.3516 15.8332 8.3516C14.0295 8.3516 13.3326 9.03484 13.3326 10.8112V12H16.9256L16.3084 15.3614H13.3326V22.9194C18.7792 22.2616 23 17.624 23 12Z"></path></svg>
                            </a>
                            <a href="https://bsky.app/profile/livetagus.pt" target="_blank" rel="noopener noreferrer" class="hover:opacity-70 transition-opacity" aria-label="Bluesky">
                                <svg fill="currentColor" width="20" height="20" viewBox="0 0 24 24"><path d="M6.33526 4.37382C8.62822 6.09522 11.0945 9.58551 12.0001 11.4586C12.9056 9.58565 15.3718 6.09519 17.6649 4.37382C19.3193 3.13172 22 2.17066 22 5.22881C22 5.83957 21.6498 10.3595 21.4445 11.0933C20.7306 13.6444 18.1292 14.2951 15.8152 13.9013C19.86 14.5897 20.8889 16.87 18.6668 19.1502C14.4465 23.4809 12.601 18.0636 12.1278 16.6755C12.0412 16.4211 12.0006 16.302 12 16.4033C11.9994 16.302 11.9588 16.4211 11.8721 16.6755C11.3993 18.0636 9.55378 23.481 5.33322 19.1502C3.11103 16.87 4.13995 14.5896 8.18483 13.9013C5.87077 14.2951 3.26934 13.6444 2.55555 11.0933C2.35016 10.3594 2 5.8395 2 5.22881C2 2.17066 4.68074 3.13172 6.33515 4.37382H6.33526Z"></path></svg>
                            </a>
                        </div>
                    </div>
                    
                    <p class="text-xs text-zinc-500 max-w-xs leading-relaxed mt-2">
                        LiveTagus • <span id="footer-version-display">a verificar versão...</span><br><br>
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
                            <img id="netlify-badge-footer" src="./imagens/netlify-light.svg" alt="Deploys by Netlify" width="114" height="51" />
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

  // CSP: Delegação de eventos para os botões de tema
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

  const logoLight = "./imagens/logotransparente.svg";
  const logoDark = "./imagens/icon.svg";
  const badgeDark = "./imagens/netlify-dark.svg";
  const badgeLight = "./imagens/netlify-light.svg";

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
      // .then(() => console.log("[SW] Registado com sucesso"))
      .catch((err) => console.log("[SW] Falha ao registar:", err));
  }

  // 2. Injetar Script Offline
  if (!document.querySelector('script[src="./offline.js"]')) {
    const script = document.createElement("script");
    script.src = "./offline.js";
    script.defer = true;
    document.head.appendChild(script);
  }
})();

// --- ATUALIZAÇÃO DINÂMICA DE VERSÃO ---
async function updateAppVersion() {
  const menuVersionEl = document.getElementById("menu-version-display");
  const footerVersionEl = document.getElementById("footer-version-display");
  const roadmapVersionEl = document.getElementById("roadmap-version-display"); //roadmap

  // versao default
  let version = "v.base";

  try {
    const res = await fetch("./sw.js");
    if (res.ok) {
      const text = await res.text();
      const match = text.match(
        /CACHE_NAME\s*=\s*["']livetagus-(v\.[^"']+)["']/,
      );

      if (match && match[1]) {
        version = match[1]; // retirar apenas versão
      }
    }
  } catch (err) {
    console.warn("[App Version] Não foi possível ler a versão do sw.js", err);
  }

  // Atualiza os textos na interface
  if (menuVersionEl) menuVersionEl.textContent = `LiveTagus • ${version}`;
  if (footerVersionEl) footerVersionEl.textContent = version;
  if (roadmapVersionEl) roadmapVersionEl.textContent = `Versão: ${version}`; // ROadmap
}

/* Filename: roadmap.js */

// 1. Definição dos Ícones Lucide
window.lucide = {
  createIcons: () => {
    const icons = {
      "arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
      "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
      pause:
        '<rect width="4" height="16" x="6" y="4" /><rect width="4" height="16" x="14" y="4" />',
      play: '<polygon points="5 3 19 12 5 21 5 3" />',
      eraser:
        '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
      settings:
        '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
      "refresh-cw":
        '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
      sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
      moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
      x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
      trophy:
        '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
      "git-commit-horizontal":
        '<circle cx="12" cy="12" r="3"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="15" x2="21" y1="12" y2="12"/>',
      menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
      info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
      "train-front":
        '<path d="M8 31V7a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v24"/><rect width="12" height="10" x="6" y="11" rx="1"/><path d="M9 15h6"/><path d="M9 19h6"/><path d="m5 26 3-2"/><path d="m19 26-3-2"/>',
      clock:
        '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
      "map-pin":
        '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
      map: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
      "code-2":
        '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>',
    };

    document.querySelectorAll("[data-lucide]").forEach((element) => {
      const key = element.getAttribute("data-lucide");
      if (!icons[key]) return;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "24");
      svg.setAttribute("height", "24");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      const currentClasses = element.getAttribute("class") || "";
      svg.setAttribute(
        "class",
        `lucide lucide-${key} ${currentClasses}`.trim(),
      );
      if (element.id) svg.setAttribute("id", element.id);
      svg.innerHTML = icons[key];
      element.parentNode.replaceChild(svg, element);
    });
  },
};

// 2. Função para carregar os commits do GitHub
async function loadGitHubCommits() {
  const container = document.getElementById("commits-container");
  const repo = "simonsays16/livetagus";
  const apiUrl = `https://api.github.com/repos/${repo}/commits?per_page=10`;

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error("Falha ao carregar commits");
    const commits = await response.json();

    let html = "";

    commits.forEach((item) => {
      const msg = item.commit.message.split("\n")[0];
      if (msg.startsWith("Merge pull request")) return;

      const date = new Date(item.commit.author.date);
      const formattedDate = date.toLocaleDateString("pt-PT", {
        day: "numeric",
        month: "short",
      });
      const sha = item.sha.substring(0, 7);
      const author = item.commit.author.name;

      html += `
          <div class="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg border border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5 hover:border-zinc-300 dark:hover:border-white/20 transition-all">
              <div class="flex flex-col gap-1">
                  <div class="flex items-center gap-2">
                      <span class="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                          ${sha}
                      </span>
                      <span class="text-[10px] text-zinc-400 uppercase tracking-wide">
                          ${formattedDate}
                      </span>
                  </div>
                  <p class="text-sm font-medium text-zinc-900 dark:text-white line-clamp-1 group-hover:line-clamp-none transition-all">
                      ${msg}
                  </p>
              </div>
              <div class="flex items-center gap-4 shrink-0">
                  <span class="text-[10px] text-zinc-500">
                      por <span class="text-zinc-900 dark:text-zinc-300 font-bold">${author}</span>
                  </span>
                  <a href="${item.html_url}" target="_blank" class="p-2 rounded-full bg-white dark:bg-black border border-zinc-200 dark:border-white/10 text-zinc-400 hover:text-black dark:hover:text-white transition-colors">
                      <i data-lucide="code-2" class="block w-4 h-4"></i>
                  </a>
              </div>
          </div>
      `;
    });

    container.innerHTML = html;
    window.lucide.createIcons();
  } catch (error) {
    console.error(error);
    container.innerHTML = `
      <div class="text-center py-8 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg">
          <p class="text-zinc-500 mb-2">Não foi possível carregar o histórico automático.</p>
          <a href="https://github.com/${repo}/commits/main" target="_blank" class="text-sm font-bold underline">Ver no GitHub</a>
      </div>
    `;
  }
}

// 3. Inicializar tudo quando a página carrega
document.addEventListener("DOMContentLoaded", () => {
  window.lucide.createIcons();
  loadGitHubCommits();
});

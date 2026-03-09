/* Filename: tabs.js */

document.addEventListener("DOMContentLoaded", () => {
  // Classes para os estados dos botões
  const activeClass = [
    "bg-white",
    "dark:bg-zinc-800",
    "shadow-sm",
    "text-zinc-900",
    "dark:text-white",
  ];
  const inactiveClass = [
    "text-zinc-400",
    "hover:text-zinc-600",
    "dark:hover:text-zinc-200",
    "bg-transparent",
    "shadow-none",
  ];

  // Função genérica para alternar abas
  function setupTabs(btn1Id, btn2Id, content1Id, content2Id) {
    const btn1 = document.getElementById(btn1Id);
    const btn2 = document.getElementById(btn2Id);
    const content1 = document.getElementById(content1Id);
    const content2 = document.getElementById(content2Id);

    // Se os elementos não existirem nesta página, ignoramos e não dá erro
    if (!btn1 || !btn2 || !content1 || !content2) return;

    btn1.addEventListener("click", () => {
      content1.classList.remove("hidden");
      content2.classList.add("hidden");

      btn1.classList.add(...activeClass);
      btn1.classList.remove(...inactiveClass);
      btn2.classList.remove(...activeClass);
      btn2.classList.add(...inactiveClass);
    });

    btn2.addEventListener("click", () => {
      content1.classList.add("hidden");
      content2.classList.remove("hidden");

      btn2.classList.add(...activeClass);
      btn2.classList.remove(...inactiveClass);
      btn1.classList.remove(...activeClass);
      btn1.classList.add(...inactiveClass);
    });
  }

  // Inicializar para a página "Código de Conduta" e "Licença"
  setupTabs("btn-pt", "btn-en", "content-pt", "content-en");

  // Inicializar para a página "Privacidade"
  setupTabs("btn-terms", "btn-privacy", "content-terms", "content-privacy");
});

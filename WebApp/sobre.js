/* Filename: sobre.js */

document.addEventListener("DOMContentLoaded", () => {
  // Configurar Event Listeners dos botões de navegação
  const btnGeral = document.getElementById("tab-btn-geral");
  const btnAjuda = document.getElementById("tab-btn-ajuda");
  const btnTech = document.getElementById("tab-btn-tech");

  if (btnGeral) btnGeral.addEventListener("click", () => switchTab("geral"));
  if (btnAjuda) btnAjuda.addEventListener("click", () => switchTab("ajuda"));
  if (btnTech) btnTech.addEventListener("click", () => switchTab("tech"));
});

function switchTab(tabId) {
  // 1. Esconder todos os conteúdos
  document.querySelectorAll(".tab-content").forEach((content) => {
    content.classList.add("hidden");
  });

  // 2. Desativar todos os botões (remover estilo ativo)
  document.querySelectorAll('button[role="tab"]').forEach((btn) => {
    btn.classList.remove("tab-active");
    btn.classList.add("tab-inactive");
    btn.setAttribute("aria-selected", "false");
  });

  // 3. Mostrar o conteúdo selecionado
  const selectedContent = document.getElementById("content-" + tabId);
  if (selectedContent) {
    selectedContent.classList.remove("hidden");
    // Reiniciar a animação
    selectedContent.style.animation = "none";
    selectedContent.offsetHeight; /* trigger reflow */
    selectedContent.style.animation = null;
  }

  // 4. Ativar o botão selecionado
  const selectedBtn = document.getElementById("tab-btn-" + tabId);
  if (selectedBtn) {
    selectedBtn.classList.remove("tab-inactive");
    selectedBtn.classList.add("tab-active");
    selectedBtn.setAttribute("aria-selected", "true");
  }
}

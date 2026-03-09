/**
 * lucide-icons.js
 * Implementação customizada e leve dos ícones Lucide usados na app.
 * Extraído do <script> inline do <head> para conformidade com CSP.
 */

window.lucide = {
  createIcons: () => {
    const icons = {
      moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
      "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
      "arrow-right-left":
        '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
      "refresh-cw":
        '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
      x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
      "train-track":
        '<path d="M2 17 17 2"/><path d="m2 14 8 8"/><path d="m5 11 8 8"/><path d="m8 8 8 8"/><path d="m11 5 8 8"/><path d="m14 2 8 8"/><path d="M7 22 22 7"/>',
      info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
      "alert-triangle":
        '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
      "gamepad-2":
        '<line x1="6" x2="10" y1="12" y2="12"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="15" x2="15.01" y1="13" y2="13"/><line x1="18" x2="18.01" y1="11" y2="11"/><rect width="20" height="12" x="2" y="6" rx="2"/>',
      download:
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
      "chevron-down": '<path d="m6 9 6 6 6-6"/>',
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
